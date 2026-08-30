/**
 * whale-purse — host half.
 *
 * DeepSeek 账户余额 + 会话用量花费读出，直接挂进 DSH Web profile 的组合层
 * （`~/.dsh/profiles/web/cordis.patch.yml` 的 insert 条目，热重载生效）。
 *
 * - 通过凭据缝（credentials seam，默认 `DEEPSEEK_API_KEY`）查询官方
 *   Get User Balance 接口，30s 缓存 + 并发去重。
 * - 通过 `sessionProjections` 注册表读取当前会话的 `tokenUsage` 投影
 *   （与内置 stats 行同一套记账），按官方价格折算花费。
 * - 价格内置官方预设，并每 6h 自动抓取官方定价页；2026-08-17 起峰谷
 *   定价自动生效（北京 9:00-12:00 / 14:00-18:00 为高峰）。
 * - 浏览器半边走同源 JSON 接口：/api/whale-purse/balance、/api/whale-purse/balance/refresh、
 *   /api/whale-purse/balance/cost。
 *
 * 本文件零依赖（不 import 任何包），作为纯 ESM cordis 插件被 Loader 加载。
 * @module whale-purse
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 插件名：与 cordis.patch.yml 的 insert.name 及客户端 bundle id 一致。 */
export const name = 'whale-purse'

/** 需要的服务（Loader 会在 apply 前解析好）。 */
export const inject = ['webServer', 'sessions']

const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'
const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_REFRESH_INTERVAL_SECONDS = 30
const DEFAULT_PRICING_REFRESH_HOURS = 6
/** 官方定价页（自动刷新价格的来源）。 */
const PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'
/** 峰谷定价生效时间：2026-08-17 00:00 北京时间（UTC+8）。 */
const PEAK_PRICING_START_MS = Date.UTC(2026, 7, 16, 16, 0, 0)
/** baseUrl 长度护栏（防 SSRF/误配）。 */
const MAX_BASE_URL_LENGTH = 256
/** 面板内设置的本地持久化文件（用户无需手改 YAML）。 */
const WHALE_PURSE_SETTINGS_PATH = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'whale-purse.settings.json')

// ---------------------------------------------------------------------------
// 价格模型（官方 2026-08-14 快照，元 / 百万 tokens）
// ---------------------------------------------------------------------------

/** 当前（峰谷生效前）单价：缓存命中输入 / 未命中输入 / 输出。 */
const CURRENT_PRESETS = {
  flash: { cacheRead: 0.02, input: 1, output: 2 },
  pro: { cacheRead: 0.025, input: 3, output: 6 },
}

/** 峰谷定价表（2026-08-17 起生效），空闲时段价格为高峰的一半。 */
const PEAK_PRESETS = {
  flash: {
    offPeak: { cacheRead: 0.05, input: 1.5, output: 4.5 },
    peak: { cacheRead: 0.10, input: 3.0, output: 9.0 },
  },
  pro: {
    offPeak: { cacheRead: 0.15, input: 4.5, output: 13.5 },
    peak: { cacheRead: 0.30, input: 9.0, output: 27.0 },
  },
}

/** 去掉 HTML 标签与脚本/样式块，压平空白（保持单元格顺序）。 */
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 取文本里所有 `x元` 数字，顺序保留。 */
function priceValues(text) {
  const values = []
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*元/g)) {
    const value = Number(match[1])
    if (Number.isFinite(value)) values.push(value)
  }
  return values
}

/** 抽出三个 bucket 的价格单元格文本（命中读 / 未命中读 / 输出）。 */
function priceSections(html) {
  const hit = /百万tokens输入（缓存命中）([\s\S]{0,600}?)百万tokens输入（缓存未命中）([\s\S]{0,600}?)百万tokens输出([\s\S]{0,600}?)(?:并发限制|扣费规则|$)/i.exec(stripHtml(html))
  return hit === null ? undefined : [hit[1], hit[2], hit[3]]
}

/**
 * 解析无峰谷标签的“统一价”表：每个 bucket 单元格只有两个价格
 * （flash、pro）。当前官方页已是峰谷表时返回 undefined，由内置
 * CURRENT_PRESETS 继续负责生效日前的历史价。
 */
function parseCurrentTable(html) {
  const sections = priceSections(html)
  if (sections === undefined) return undefined
  if (sections.some((cell) => /空闲时段|高峰时段/.test(cell))) return undefined
  const buckets = sections.map((cell) => priceValues(cell))
  if (buckets.some((values) => values.length < 2)) return undefined
  return {
    flash: { cacheRead: buckets[0][0], input: buckets[1][0], output: buckets[2][0] },
    pro: { cacheRead: buckets[0][1], input: buckets[1][1], output: buckets[2][1] },
  }
}

/**
 * 解析峰谷定价表。新版页面把 flash/pro 作为列放在 bucket 单元格里：
 * `空闲时段 0.05元 0.15元 高峰时段 0.10元 0.30元`；
 * 同时兼容旧版“模型名 + 空闲时段… 高峰时段…”的逐行写法。
 */
function parsePeakTable(html) {
  const sections = priceSections(html)
  if (sections !== undefined) {
    const offPeak = sections.map((cell) => priceValues(/空闲时段([\s\S]*?)(?:高峰时段|$)/.exec(cell)?.[1] ?? ''))
    const peak = sections.map((cell) => priceValues(/高峰时段([\s\S]*?)$/.exec(cell)?.[1] ?? ''))
    if (offPeak.every((values) => values.length >= 2) && peak.every((values) => values.length >= 2)) {
      return {
        flash: {
          offPeak: { cacheRead: offPeak[0][0], input: offPeak[1][0], output: offPeak[2][0] },
          peak: { cacheRead: peak[0][0], input: peak[1][0], output: peak[2][0] },
        },
        pro: {
          offPeak: { cacheRead: offPeak[0][1], input: offPeak[1][1], output: offPeak[2][1] },
          peak: { cacheRead: peak[0][1], input: peak[1][1], output: peak[2][1] },
        },
      }
    }
  }

  const text = stripHtml(html)
  const row = /deepseek-v4-(flash|pro)\s+空闲时段\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+高峰时段\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元/gi
  const result = {}
  for (const match of text.matchAll(row)) {
    result[match[1]] = {
      offPeak: { cacheRead: Number(match[2]), input: Number(match[3]), output: Number(match[4]) },
      peak: { cacheRead: Number(match[5]), input: Number(match[6]), output: Number(match[7]) },
    }
  }
  if (result.flash === undefined || result.pro === undefined) return undefined
  return result
}

/**
 * 抓取并解析官方定价页。失败时返回内置预设并记录 error，绝不抛出。
 * @param fetchImpl - 可注入的 fetch（测试用）。
 * @param timeoutMs - 超时毫秒。
 */
async function fetchPricing(fetchImpl = globalThis.fetch, timeoutMs = 15_000) {
  const fetchedAt = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      response = await fetchImpl(PRICING_URL, { signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) return { fetchedAt, error: `pricing page HTTP ${response.status}` }
    const html = await response.text()
    const current = parseCurrentTable(html)
    const peak = parsePeakTable(html)
    if (current === undefined && peak === undefined) return { fetchedAt, error: 'pricing table not found' }
    return {
      fetchedAt,
      ...(current === undefined ? {} : { current }),
      ...(peak === undefined ? {} : { peak }),
    }
  } catch (error) {
    return { fetchedAt, error: friendlyError(error, '定价页获取') }
  }
}

/** 北京小时读取器：复用 formatter，避免每条事件都新建 Intl.DateTimeFormat。 */
const BEIJING_HOUR_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  hour: 'numeric',
  hour12: false,
  hourCycle: 'h23',
})

/**
 * 当前时刻是否为北京高峰时段：9:00-12:00、14:00-18:00。
 */
function isPeakHour(now = new Date()) {
  const parts = BEIJING_HOUR_FORMATTER.formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value)
  if (Number.isNaN(hour)) return false
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

/** 北京完整时间读取器，用于计算下一个峰/谷切换点。 */
const BEIJING_DATETIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** 下一个峰谷切换的 UTC epoch ms（北京 9:00 / 12:00 / 14:00 / 18:00）。 */
function nextPeakBoundary(now = new Date()) {
  const parts = BEIJING_DATETIME_FORMATTER.formatToParts(now)
  const get = (type) => Number(parts.find((p) => p.type === type)?.value)
  const year = get('year')
  const month = get('month')
  const day = get('day')
  const minuteOfDay = get('hour') * 60 + get('minute')
  for (const hour of [9, 12, 14, 18]) {
    if (minuteOfDay < hour * 60) return Date.UTC(year, month - 1, day, hour, 0, 0) - 8 * 3600 * 1000
  }
  return Date.UTC(year, month - 1, day + 1, 9, 0, 0) - 8 * 3600 * 1000
}

/**
 * 是否 DeepSeek 系模型：以 model id 为主，provider 只在 model id 缺失时兜底。
 * 第三方 provider 可能也带 deepseek 字样，不能作为主要判定依据。
 */
function isDeepSeekModel(modelId, provider) {
  if (typeof modelId === 'string' && modelId !== '' && /deepseek/i.test(modelId)) return true
  const empty = modelId === undefined || modelId === ''
  return empty && typeof provider === 'string' && /^(deepseek|deepseek-official)$/i.test(provider)
}

/**
 * 把 provider/model id 归一化到 flash/pro。
 * 非 DeepSeek model（如 gpt-5-pro / qwen2.5-flash）返回 'other' —— 调用方应跳过计价；
 * 无模型信息返回 undefined。
 */
function normalizeModel(modelId, provider) {
  if (typeof modelId !== 'string' || modelId === '') return undefined
  if (!isDeepSeekModel(modelId, provider)) return 'other'
  if (/pro/i.test(modelId)) return 'pro'
  if (/flash/i.test(modelId)) return 'flash'
  // DeepSeek 但无法细分档位（如 deepseek-chat / deepseek-reasoner）按 flash 估算。
  return 'flash'
}


/** 解析 base URL 为 `{ origin, prefix }`。 */
function parseBaseUrl(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`whale-purse: invalid baseUrl "${raw}"`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`whale-purse: baseUrl must be http(s), got "${url.protocol}"`)
  }
  return { origin: url.origin, prefix: url.pathname.replace(/\/+$/, '') }
}

/** 截断错误正文。 */
function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max)}..`
}

/**
 * 把底层错误映射为可读文案：超时/中断（AbortError）统一归为「请求超时」，
 * 避免把浏览器的 "This operation was aborted" 原样抛给用户。
 */
function friendlyError(error, label) {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  if (name === 'AbortError' || /abort/i.test(message)) return `${label}（请求超时）`
  return message || `${label}失败`
}

/** token 数按单价折算金额。 */
function costOfTokens(count, perMillion) {
  if (count <= 0 || !Number.isFinite(count)) return 0
  return (count / 1_000_000) * perMillion
}

/** 四桶 token 计数的零值。 */
function emptyTokenBuckets() {
  return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

/** 从 provider usage 读数生成四桶 token 计数。 */
function tokenBucketsOf(usage) {
  return {
    uncachedInputTokens: Number(usage?.inputTokens) || 0,
    outputTokens: Number(usage?.outputTokens) || 0,
    cacheReadTokens: Number(usage?.cacheReadTokens) || 0,
    cacheWriteTokens: Number(usage?.cacheWriteTokens) || 0,
  }
}

/** 从 tokenUsage 投影读数生成四桶 token 计数（字段名与 provider usage 不同）。 */
function projectionBucketsOf(usage) {
  return {
    uncachedInputTokens: Number(usage?.uncachedInputTokens) || 0,
    outputTokens: Number(usage?.outputTokens) || 0,
    cacheReadTokens: Number(usage?.cacheReadTokens) || 0,
    cacheWriteTokens: Number(usage?.cacheWriteTokens) || 0,
  }
}

/**
 * DSH「在新会话中新建分支」会在新会话里带入父会话已发生的 seed 事件，
 * 同时用 `seedLength` 标记 seed 的末尾 seq。seed 部分已在父会话计过费，
 * 不应再算进当前分支会话；非分支会话返回 0（从第一条事件开始计费）。
 * @param {object} sessionLike - session 或持久化 snapshot header。
 * @returns {number} seed 边界 seq（该 seq 及之后的事件才属于本会话新产生的内容）。
 */
function seedStartSeq(sessionLike) {
  const raw = sessionLike?.seedLength
    ?? sessionLike?.header?.seedLength
    ?? sessionLike?.events?.[0]?.seedLength
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** 事件是否属于分支 seed 之前的“历史 checkout”部分。 */
function isSeedEvent(event, boundary) {
  if (boundary <= 0) return false
  const seq = Number(event?.seq)
  return Number.isFinite(seq) && seq < boundary
}

/** 把 addend 的四桶 token 计数累加到 target（原地修改 target）。 */
function addTokenBuckets(target, addend) {
  target.uncachedInputTokens += addend.uncachedInputTokens
  target.outputTokens += addend.outputTokens
  target.cacheReadTokens += addend.cacheReadTokens
  target.cacheWriteTokens += addend.cacheWriteTokens
  return target
}

/** total - subtrahend，每桶下限 0（投影可能落后于已落盘事件）。 */
function subtractTokenBuckets(total, subtrahend) {
  return {
    uncachedInputTokens: Math.max(0, total.uncachedInputTokens - subtrahend.uncachedInputTokens),
    outputTokens: Math.max(0, total.outputTokens - subtrahend.outputTokens),
    cacheReadTokens: Math.max(0, total.cacheReadTokens - subtrahend.cacheReadTokens),
    cacheWriteTokens: Math.max(0, total.cacheWriteTokens - subtrahend.cacheWriteTokens),
  }
}

/** 把 buckets 按 prices 折算的金额累加进 breakdown（缓存写入不单独计费）。 */
function addBucketCost(breakdown, buckets, prices) {
  breakdown.input += costOfTokens(buckets.uncachedInputTokens, prices.input)
  breakdown.cacheRead += costOfTokens(buckets.cacheReadTokens, prices.cacheRead)
  breakdown.cacheWrite += 0
  breakdown.output += costOfTokens(buckets.outputTokens, prices.output)
  return breakdown
}

// ---------------------------------------------------------------------------
// 余额服务
// ---------------------------------------------------------------------------

class BalanceService {
  constructor(ctx, config = {}) {
    this.ctx = ctx
    this.apiKeyEnv = config.apiKeyEnv ?? DEFAULT_API_KEY_ENV
    this.baseUrl = String(config.baseUrl ?? DEFAULT_BASE_URL).slice(0, MAX_BASE_URL_LENGTH)
    this.refreshIntervalMs = Math.max(0, (config.refreshIntervalSeconds ?? DEFAULT_REFRESH_INTERVAL_SECONDS) * 1_000)
    const userSettings = this.loadUserSettings()
    this.userSettings = userSettings
    const model = userSettings.model ?? config.model
    this.model = model === 'pro' ? 'pro' : model === 'flash' ? 'flash' : 'auto'
    const threshold = userSettings.lowBalanceThreshold ?? config.lowBalanceThreshold
    this.lowBalanceThreshold = Number.isFinite(threshold) ? Math.max(0, Number(threshold)) : 10
    const budget = userSettings.dailyBudget ?? config.dailyBudget
    this.dailyBudget = budget === undefined || budget === null || budget === ''
      ? undefined
      : (Number.isFinite(Number(budget)) ? Math.max(0, Number(budget)) : undefined)
    this.enabled = config.enabled ?? true
    this.cached = undefined
    this.cachedAt = 0
    this.inflight = undefined
    /** 已落盘事件的分桶缓存：key 为 live session 对象，价格快照变化时重扫。 */
    this.sessionUsageCache = new WeakMap()
    /** 已持久化会话的事件缓存：key 为 session id，按 persistence revision 复用。 */
    this.persistedEventCache = new Map()
    /** 价格快照：先落内置预设，后台再刷新官方页。 */
    this.pricingSnapshot = { fetchedAt: Date.now(), current: CURRENT_PRESETS, peak: PEAK_PRESETS }
    this.pricingTimer = undefined
    void this.refreshPricing()
    const cadenceMs = (config.pricingRefreshHours ?? DEFAULT_PRICING_REFRESH_HOURS) * 3_600_000
    this.pricingTimer = setInterval(() => { void this.refreshPricing() }, cadenceMs)
    this.pricingTimer.unref?.()
  }

  dispose() {
    clearInterval(this.pricingTimer)
    this.pricingTimer = undefined
  }

  /** 当前生效单价（默认模型）：官方页优先；峰谷表在生效日后按北京时段取带。 */

  /** 读取面板内设置的本地 JSON；不存在或损坏时返回空对象。 */
  loadUserSettings() {
    try {
      if (!existsSync(WHALE_PURSE_SETTINGS_PATH)) return {}
      const raw = JSON.parse(readFileSync(WHALE_PURSE_SETTINGS_PATH, 'utf8'))
      if (raw === null || typeof raw !== 'object') return {}
      return {
        model: raw.model === 'pro' || raw.model === 'flash' || raw.model === 'auto' ? raw.model : undefined,
        lowBalanceThreshold: Number.isFinite(Number(raw.lowBalanceThreshold)) ? Math.max(0, Number(raw.lowBalanceThreshold)) : undefined,
        dailyBudget: raw.dailyBudget === undefined || raw.dailyBudget === null || raw.dailyBudget === ''
          ? undefined
          : (Number.isFinite(Number(raw.dailyBudget)) ? Math.max(0, Number(raw.dailyBudget)) : undefined),
      }
    } catch {
      return {}
    }
  }

  /** 把面板设置写入本地 JSON（目录不存在时自动创建）。 */
  saveUserSettings(settings) {
    try {
      const dir = join(WHALE_PURSE_SETTINGS_PATH, '..')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(WHALE_PURSE_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8')
    } catch (error) {
      this.ctx.logger?.warn?.(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /** 当前面板设置视图。 */
  settingsView() {
    return {
      model: this.model,
      lowBalanceThreshold: this.lowBalanceThreshold,
      dailyBudget: this.dailyBudget,
    }
  }

  /** 应用面板设置：立即更新内存并持久化。 */
  applySettings(patch = {}) {
    const next = {
      model: patch.model === 'pro' || patch.model === 'flash' || patch.model === 'auto' ? patch.model : this.model,
      lowBalanceThreshold: Number.isFinite(Number(patch.lowBalanceThreshold))
        ? Math.max(0, Number(patch.lowBalanceThreshold))
        : this.lowBalanceThreshold,
      dailyBudget: patch.dailyBudget === undefined || patch.dailyBudget === null || patch.dailyBudget === ''
        ? undefined
        : (Number.isFinite(Number(patch.dailyBudget)) ? Math.max(0, Number(patch.dailyBudget)) : this.dailyBudget),
    }
    this.userSettings = next
    this.model = next.model
    this.lowBalanceThreshold = next.lowBalanceThreshold
    this.dailyBudget = next.dailyBudget
    this.saveUserSettings(next)
    return this.settingsView()
  }

  effectivePrices() {
    return this.pricesFor(this.model, Date.now())
  }

  /** 指定模型 + 时刻的单价。历史消息按各自 event.time 和实际模型调用本方法。 */
  pricesFor(model, epochMs) {
    const snapshot = this.pricingSnapshot ?? { current: CURRENT_PRESETS }
    const safe = model === 'pro' || model === 'flash' ? model : 'flash'
    const current = snapshot.current?.[safe] ?? CURRENT_PRESETS[safe]
    const peak = snapshot.peak?.[safe]
    if (peak !== undefined && epochMs >= PEAK_PRICING_START_MS) {
      const inPeak = isPeakHour(new Date(epochMs))
      const band = inPeak ? peak.peak : peak.offPeak
      return { ...band, band: inPeak ? 'peak' : 'off-peak' }
    }
    return { ...current, band: 'standard' }
  }

  /**
   * 指定时刻生效的单价（使用当前配置模型）。
   */
  effectivePricesAt(epochMs) {
    return this.pricesFor(this.model, epochMs)
  }

  /** 已按 band 分桶的历史 tokens 折算时，直接取对应模型 + band 的单价。 */
  pricesForBand(model, band) {
    const snapshot = this.pricingSnapshot ?? { current: CURRENT_PRESETS }
    const safe = model === 'pro' || model === 'flash' ? model : 'flash'
    const current = snapshot.current?.[safe] ?? CURRENT_PRESETS[safe]
    const peak = snapshot.peak?.[safe]
    if (band === 'peak' && peak !== undefined) return { ...peak.peak, band: 'peak' }
    if (band === 'off-peak' && peak !== undefined) return { ...peak.offPeak, band: 'off-peak' }
    return { ...current, band: 'standard' }
  }

  /** auto 模式下把 provider/model 归一化；显式 pro/flash 时始终返回该模型。
      非 DeepSeek 模型返回 'other'（调用方跳过计价）。 */
  modelOf(modelId, provider) {
    if (this.model === 'pro' || this.model === 'flash') return this.model
    const model = normalizeModel(modelId, provider)
    if (model === 'other') return 'other'
    return model ?? 'flash'
  }

  /** 从 request/header 事件读取实际模型（含 provider 判定）。 */
  headerModelOf(event) {
    const header = event?.data?.header
    return this.modelOf(header?.config?.model, header?.config?.provider)
  }

  /** auto 模式无任何请求头时的兜底模型。 */
  fallbackModel() {
    return this.model === 'pro' || this.model === 'flash' ? this.model : 'flash'
  }

  /** 会话最近一次 request/header 里实际使用的模型；auto 模式下用于整会话计价。
      最近一条头即当前模型：确认非 DeepSeek 立即返回 'other'，不回溯更旧的头。
      分支会话会忽略 seed 里的历史 request/header，只看新建分支后的事件。 */
  sessionModel(session) {
    if (this.model === 'pro' || this.model === 'flash') return this.model
    const events = session?.events
    if (Array.isArray(events)) {
      const boundary = seedStartSeq(session)
      for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i]
        if (event?.type !== 'request/header') continue
        if (isSeedEvent(event, boundary)) continue
        const model = this.headerModelOf(event)
        if (model === 'other') return 'other'
        if (model !== undefined) return model
      }
    }
    return 'flash'
  }

  /** RPC/HTTP：最近的余额视图；缓存窗口内直接返回，并发查询去重。 */
  async view() {
    if (!this.enabled) return { fetchedAt: Date.now(), available: false, balances: [], error: 'disabled' }
    const now = Date.now()
    if (this.cached !== undefined && now - this.cachedAt < this.refreshIntervalMs && this.refreshIntervalMs > 0) {
      return this.cached
    }
    if (this.inflight !== undefined) return this.inflight
    /** 缓存窗口从“发起请求”起算：否则客户端按 refreshIntervalSeconds 精确轮询时，响应耗时会让下一次轮询总是命中旧缓存，实际刷新周期翻倍。 */
    const startedAt = now
    this.inflight = this.query().then((view) => {
      this.cached = view
      this.cachedAt = startedAt
      return view
    }).finally(() => {
      this.inflight = undefined
    })
    return this.inflight
  }

  /** 强制刷新（绕过缓存窗口）。 */
  async refresh() {
    const view = await this.query()
    this.cached = view
    this.cachedAt = Date.now()
    return view
  }

  /** 重新抓取官方定价页；只覆盖抓取到的部分，缺失部分沿用上一快照/内置预设。 */
  async refreshPricing() {
    const snapshot = await fetchPricing()
    const previous = this.pricingSnapshot
    if (snapshot.current !== undefined || snapshot.peak !== undefined) {
      this.pricingSnapshot = {
        fetchedAt: snapshot.fetchedAt,
        current: snapshot.current ?? previous?.current ?? CURRENT_PRESETS,
        peak: snapshot.peak ?? previous?.peak ?? PEAK_PRESETS,
      }
    } else {
      this.pricingSnapshot = { fetchedAt: snapshot.fetchedAt, current: CURRENT_PRESETS, peak: PEAK_PRESETS, error: snapshot.error }
    }
  }

  /**
   * 从 live session 的已落盘 assistant/message 事件扫描最终用量，按事件时间
   * 分入 standard/off-peak/peak 三档，并按实际模型拆 flash/pro。
   * 结果按 session 对象 + 事件尾部引用 + 价格快照缓存；事件日志或价格快照变化时重扫。
   */
  finalizedUsage(session) {
    const events = session?.events
    if (!Array.isArray(events)) return undefined
    const lastEvent = events.length > 0 ? events[events.length - 1] : undefined
    const boundary = seedStartSeq(session)
    const cached = this.sessionUsageCache.get(session)
    if (cached !== undefined
      && cached.eventCount === events.length
      && cached.lastEvent === lastEvent
      && cached.boundary === boundary
      && cached.pricingSnapshot === this.pricingSnapshot) {
      return cached
    }
    const fullTotals = emptyTokenBuckets()
    const totals = emptyTokenBuckets()
    const byBand = {
      standard: { flash: emptyTokenBuckets(), pro: emptyTokenBuckets() },
      'off-peak': { flash: emptyTokenBuckets(), pro: emptyTokenBuckets() },
      peak: { flash: emptyTokenBuckets(), pro: emptyTokenBuckets() },
    }
    let currentModel = this.fallbackModel()
    for (const event of events) {
      if (event.type === 'request/header') {
        currentModel = this.headerModelOf(event)
        continue
      }
      if (event.type !== 'assistant/message') continue
      const usage = event.data?.usage
      if (usage === undefined || usage === null) continue
      // 非 DeepSeek 模型的用量不计入花费（'other' 只在 auto 模式出现）。
      if (currentModel === 'other') continue
      const time = Number(event.time) || 0
      const band = this.pricesFor(currentModel, time > 0 ? time : Date.now()).band
      const buckets = tokenBucketsOf(usage)
      addTokenBuckets(fullTotals, buckets)
      // 分支会话里 seed 部分已经在父会话计过费，只累计 seed 之后的新增消息。
      if (isSeedEvent(event, boundary)) continue
      addTokenBuckets(totals, buckets)
      addTokenBuckets(byBand[band][currentModel], buckets)
    }
    const entry = {
      eventCount: events.length,
      lastEvent,
      boundary,
      pricingSnapshot: this.pricingSnapshot,
      totals,
      byBand,
      fullTotals,
      seedTotals: subtractTokenBuckets(fullTotals, totals),
    }
    this.sessionUsageCache.set(session, entry)
    return entry
  }

  /**
   * 一个会话的 token 用量 + 估算花费。
   * 历史部分按每条消息的 event.time + 实际模型计价；投影总量超出已落盘事件
   * 的部分视为进行中的增量，按会话当前模型和当前时段价计价。
   */
  sessionCost(session) {
    const finalized = this.finalizedUsage(session)
    const sessionModel = this.sessionModel(session)
    const registry = this.ctx.get('sessionProjections')
    let projected
    if (registry !== undefined && typeof registry.snapshot === 'function') {
      const value = registry.snapshot(session)?.values?.tokenUsage
      if (value !== null && typeof value === 'object') projected = projectionBucketsOf(value)
    }
    // 分支会话的 tokenUsage 投影也包含 seed 历史，这里把 seed 用量扣掉，
    // 让「本会话」只反映新建分支后实际新产生的 token/花费。
    if (projected !== undefined && finalized?.seedTotals !== undefined) {
      projected = subtractTokenBuckets(projected, finalized.seedTotals)
    }
    const totals = projected ?? finalized?.totals ?? emptyTokenBuckets()
    const live = projected !== undefined && finalized !== undefined
      ? subtractTokenBuckets(projected, finalized.totals)
      : projected ?? emptyTokenBuckets()
    // 会话当前模型非 DeepSeek：不估算花费。已落盘的 DeepSeek 用量（混合会话里
    // 切到其它模型之前的部分）仍按实际模型计价，进行中/投影部分不计。
    const nonDeepSeek = sessionModel === 'other'
    const currentPrices = nonDeepSeek ? undefined : this.pricesFor(sessionModel, Date.now())
    const breakdown = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
    if (finalized !== undefined) {
      for (const band of ['standard', 'off-peak', 'peak']) {
        for (const model of ['flash', 'pro']) {
          addBucketCost(breakdown, finalized.byBand[band][model], this.pricesForBand(model, band))
        }
      }
    }
    if (currentPrices !== undefined) addBucketCost(breakdown, live, currentPrices)
    const cost = breakdown.input + breakdown.cacheRead + breakdown.cacheWrite + breakdown.output
    return {
      uncachedInputTokens: totals.uncachedInputTokens,
      outputTokens: totals.outputTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cacheWriteTokens: totals.cacheWriteTokens,
      cost,
      currency: 'CNY',
      breakdown,
      pricing: nonDeepSeek
        ? {
          model: 'other',
          cacheReadPerMillion: 0,
          inputPerMillion: 0,
          outputPerMillion: 0,
          band: 'standard',
          peakPricingActive: Date.now() >= PEAK_PRICING_START_MS,
          nextChangeAt: nextPeakBoundary(),
        }
        : {
          model: sessionModel,
          cacheReadPerMillion: currentPrices.cacheRead,
          inputPerMillion: currentPrices.input,
          outputPerMillion: currentPrices.output,
          band: currentPrices.band,
          peakPricingActive: Date.now() >= PEAK_PRICING_START_MS,
          nextChangeAt: nextPeakBoundary(),
        },
    }
  }

  /** 单条 assistant 消息事件 → 花费条目；按事件时间和实际模型计价，无 usage 返回 null。 */
  messageCostOf(event, model = this.fallbackModel()) {
    const usage = event?.data?.usage
    if (usage === undefined || usage === null) return null
    // 非 DeepSeek 模型不估算花费。
    if (model === 'other') return null
    const time = Number(event.time) || 0
    const buckets = tokenBucketsOf(usage)
    const prices = this.pricesFor(model, time > 0 ? time : Date.now())
    const cost = costOfTokens(buckets.uncachedInputTokens, prices.input)
      + costOfTokens(buckets.cacheReadTokens, prices.cacheRead)
      + costOfTokens(buckets.outputTokens, prices.output)
    return {
      time,
      tokens: buckets.uncachedInputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens,
      cost,
    }
  }

  /** 一个会话的最近 N 条消息花费（倒序：最新在前），附带对应的用户问题文本。
      同一个 turn 的多条 assistant 消息（agent 多步循环）合并为一条。 */
  messageCosts(session, limit = 20) {
    const events = session?.events
    if (!Array.isArray(events)) return []
    const byTurn = new Map()
    const boundary = seedStartSeq(session)
    let currentQuestion = ''
    let currentModel = this.fallbackModel()
    for (const event of events) {
      if (isSeedEvent(event, boundary)) continue
      if (event.type === 'request/header') {
        currentModel = this.headerModelOf(event)
      } else if (event.type === 'user/message') {
        const blocks = event.data?.content
        if (Array.isArray(blocks)) {
          const text = blocks
            .filter((b) => (b?.kind === 'text' || b?.type === 'text'))
            .map((b) => b?.text ?? '')
            .join('')
            .trim()
          if (text !== '') currentQuestion = text
        }
      } else if (event.type === 'assistant/message') {
        const cost = this.messageCostOf(event, currentModel)
        if (cost === null) continue
        const turn = Number(event.data?.turn)
        const entry = byTurn.get(turn)
        if (entry !== undefined) {
          entry.tokens += cost.tokens
          entry.cost += cost.cost
          entry.time = cost.time
        } else {
          byTurn.set(turn, {
            turn,
            question: currentQuestion.slice(0, 120),
            tokens: cost.tokens,
            cost: cost.cost,
            time: cost.time,
          })
        }
      }
    }
    return [...byTurn.values()]
      .sort((a, b) => a.turn - b.turn)
      .slice(-limit)
      .reverse()
  }

  /**
   * 近 N 天每天花费。live 会话之外，在 sessionPersistence 可用时合并
   * 已保存会话（按 revision 复用上次读到的事件，避免每 10s 全量重读）；
   * 每条 assistant 消息按自己的事件时间计价。
   */
  async dailyCosts(sessionsList, days = 7) {
    const dayKey = (epochMs) => {
      const d = new Date(epochMs)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    const now = new Date()
    const buckets = new Map()
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const key = dayKey(d.getTime())
      buckets.set(key, { date: d.getTime(), cost: 0, tokens: 0 })
    }
    const foldEvents = (events, boundary = 0) => {
      if (!Array.isArray(events)) return
      let currentModel = this.fallbackModel()
      for (const event of events) {
        if (isSeedEvent(event, boundary)) continue
        if (event.type === 'request/header') {
          currentModel = this.headerModelOf(event)
        } else if (event.type === 'assistant/message') {
          const cost = this.messageCostOf(event, currentModel)
          if (cost === null) continue
          const bucket = buckets.get(dayKey(cost.time))
          if (bucket !== undefined) {
            bucket.cost += cost.cost
            bucket.tokens += cost.tokens
          }
        }
      }
    }

    const seen = new Set()
    for (const session of sessionsList ?? []) {
      const events = session?.events
      if (!Array.isArray(events)) continue
      if (session?.id !== undefined) seen.add(String(session.id))
      foldEvents(events, seedStartSeq(session))
    }

    let coverage = 'live'
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence !== undefined && typeof persistence.readFrom === 'function') {
      try {
        const hasSnapshots = typeof persistence.listSnapshots === 'function'
        const hasList = typeof persistence.list === 'function'
        if (hasSnapshots || hasList) {
          coverage = 'live+persisted'
          const snapshots = hasSnapshots
            ? await persistence.listSnapshots()
            : (await persistence.list()).map((header) => ({ header }))
          for (const snapshot of snapshots) {
            const id = snapshot.header?.id
            if (id === undefined) continue
            const key = String(id)
            if (seen.has(key)) continue
            const cached = this.persistedEventCache.get(key)
            let events
            if (cached !== undefined && snapshot.revision !== undefined && cached.revision === snapshot.revision) {
              events = cached.events
            } else {
              try {
                const read = await persistence.readFrom(id, 0)
                events = Array.isArray(read?.events) ? read.events : []
                this.persistedEventCache.set(key, { revision: snapshot.revision, events })
              } catch {
                continue
              }
            }
            seen.add(key)
            foldEvents(events, seedStartSeq(snapshot?.header ?? snapshot) || seedStartSeq({ events }))
          }
        }
      } catch (error) {
        this.ctx.logger?.warn?.(error instanceof Error ? error : new Error(String(error)))
        coverage = 'live'
      }
    }

    const items = [...buckets.values()].map((b) => ({
      date: b.date,
      cost: Math.round(b.cost * 10000) / 10000,
      tokens: b.tokens,
    }))
    const todayCost = items.length > 0 ? items[items.length - 1].cost : 0
    return {
      coverage,
      budget: this.dailyBudget,
      budgetExceeded: this.dailyBudget !== undefined && todayCost > this.dailyBudget,
      items,
    }
  }

  /** 查询官方 Get User Balance。 */
  async query() {
    const fetchedAt = Date.now()
    try {
      const key = await this.resolveApiKey()
      if (key === undefined) {
        return {
          fetchedAt,
          available: false,
          balances: [],
          error: `no API key (store ${this.apiKeyEnv} via the credentials seam, or export it in the environment)`,
        }
      }
      const { origin, prefix } = parseBaseUrl(this.baseUrl)
      const url = `${origin}${prefix}/user/balance`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)
      let response
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        return {
          fetchedAt,
          available: false,
          balances: [],
          error: `Get User Balance failed: HTTP ${response.status}${body ? ` — ${truncate(body, 200)}` : ''}`,
        }
      }
      const payload = await response.json()
      const buckets = Array.isArray(payload.balance_infos)
        ? payload.balance_infos.map((b) => ({
          currency: String(b.currency ?? ''),
          total_balance: String(b.total_balance ?? '0'),
          granted_balance: String(b.granted_balance ?? '0'),
          topped_up_balance: String(b.topped_up_balance ?? '0'),
        })).filter((b) => b.currency !== '')
        : []
      const total = buckets.length === 1 ? Number(buckets[0].total_balance) : undefined
      return {
        fetchedAt,
        available: payload.is_available !== false,
        balances: buckets,
        ...(total === undefined || Number.isNaN(total) ? {} : {
          total,
          currency: buckets[0].currency,
          lowBalance: total < this.lowBalanceThreshold,
          lowBalanceThreshold: this.lowBalanceThreshold,
        }),
      }
    } catch (error) {
      return {
        fetchedAt,
        available: false,
        balances: [],
        error: friendlyError(error, '余额查询'),
      }
    }
  }

  /** 凭据缝 → 启动环境 → process.env，逐层解析 API key。 */
  async resolveApiKey() {
    const credentials = this.ctx.get('credentials')
    if (credentials !== undefined && typeof credentials.resolve === 'function') {
      const hit = await credentials.resolve(this.apiKeyEnv)
      if (hit !== undefined && typeof hit.value === 'string' && hit.value.length > 0) return hit.value
    }
    const launchEnvironment = this.ctx.get('launchEnvironment')
    const ambient = launchEnvironment?.get?.(String(this.apiKeyEnv))
    if (ambient !== undefined && typeof ambient.value === 'string' && ambient.value.length > 0) return ambient.value
    const env = process.env[this.apiKeyEnv]
    if (typeof env === 'string' && env.length > 0) return env
    return undefined
  }
}

// ---------------------------------------------------------------------------
// HTTP 路由
// ---------------------------------------------------------------------------

/** 写一个 JSON 响应。 */
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function requireMethod(req, res, method) {
  if (req.method === method) return true
  json(res, 405, { ok: false, error: 'method-not-allowed' })
  return false
}

function getRoute(path, run) {
  return {
    kind: 'exact',
    path,
    handler: (req, res) => {
      if (!requireMethod(req, res, 'GET')) return
      Promise.resolve(run()).then((value) => json(res, 200, value), (error) => {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

function getRequestRoute(path, run) {
  return {
    kind: 'exact',
    path,
    handler: (req, res) => {
      if (!requireMethod(req, res, 'GET')) return
      Promise.resolve(run(req)).then((value) => json(res, 200, value), (error) => {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

/** 读取请求体并解析为 JSON；失败返回 undefined。 */
function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 1_000_000) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(body.length === 0 ? {} : JSON.parse(body))
      } catch {
        resolve(undefined)
      }
    })
    req.on('error', () => resolve(undefined))
  })
}

/** 读请求 URL 里的 `session` 查询参数。 */
function sessionParam(req) {
  const raw = req.url ?? ''
  const q = raw.indexOf('?')
  if (q < 0) return undefined
  const value = new URLSearchParams(raw.slice(q + 1)).get('session')
  return value === null || value === '' ? undefined : value
}

// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------

/**
 * 注册余额服务与 HTTP 路由。
 * @param ctx - cordis 上下文。
 * @param config - 组合配置（cordis.patch.yml insert 里的 config 字段）。
 */
export function apply(ctx, config = {}) {
  const service = new BalanceService(ctx, config)
  /** 暴露给其它插件/诊断用。 */
  ctx.provide('whalePurse', service)

  const resolveSession = (id) => {
    const sessions = ctx.get('sessions')
    const session = sessions !== undefined && typeof sessions.get === 'function' ? sessions.get(id) : undefined
    if (session === undefined) return undefined
    return { session, cost: service.sessionCost(session) }
  }

  const routes = [
    getRoute('/api/whale-purse/balance', () => service.view()),
    getRoute('/api/whale-purse/balance/refresh', () => service.refresh()),
    {
      kind: 'exact',
      path: '/api/whale-purse/settings',
      handler: async (req, res) => {
        if (req.method === 'GET') {
          json(res, 200, { ok: true, ...service.settingsView() })
          return
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req)
          if (body === undefined) {
            json(res, 400, { ok: false, error: 'invalid-json' })
            return
          }
          try {
            json(res, 200, { ok: true, ...service.applySettings(body) })
          } catch (error) {
            json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        json(res, 405, { ok: false, error: 'method-not-allowed' })
      },
    },
    getRequestRoute('/api/whale-purse/balance/cost', (req) => {
      const id = sessionParam(req)
      if (id === undefined) return { ok: false, error: 'missing-session' }
      const resolved = resolveSession(id)
      if (resolved === undefined) return { ok: false, error: 'unknown-session' }
      return { ok: true, ...resolved.cost }
    }),
    /** 近 N 天每天花费（live + 可用时的持久化会话）。 */
    getRequestRoute('/api/whale-purse/balance/daily', async (req) => {
      const raw = req.url ?? ''
      const q = raw.indexOf('?')
      const days = q < 0 ? 7 : (Number(new URLSearchParams(raw.slice(q + 1)).get('days')) || 7)
      const sessions = ctx.get('sessions')
      const list = sessions !== undefined && typeof sessions.list === 'function' ? sessions.list() : []
      const daily = await service.dailyCosts(list, Math.min(Math.max(days, 1), 30))
      return { ok: true, coverage: daily.coverage, budget: daily.budget, budgetExceeded: daily.budgetExceeded, items: daily.items }
    }),
    /** 当前会话最近 N 条消息花费。 */
    getRequestRoute('/api/whale-purse/balance/messages', (req) => {
      const id = sessionParam(req)
      if (id === undefined) return { ok: false, error: 'missing-session' }
      const raw = req.url ?? ''
      const q = raw.indexOf('?')
      const limit = q < 0 ? 20 : (Number(new URLSearchParams(raw.slice(q + 1)).get('limit')) || 20)
      const resolved = resolveSession(id)
      if (resolved === undefined) return { ok: false, error: 'unknown-session' }
      return { ok: true, items: service.messageCosts(resolved.session, Math.min(Math.max(limit, 1), 100)) }
    }),
  ]

  const registerRoutes = () => {
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) {
        try { dispose() } catch { /* 卸载时尽力而为 */ }
      }
    }
  }

  let disposeRoutes = registerRoutes()
  if (typeof ctx.effect === 'function') ctx.effect(() => disposeRoutes, 'whale-purse: routes')

  return () => {
    disposeRoutes()
    disposeRoutes = () => {}
    service.dispose()
  }
}
