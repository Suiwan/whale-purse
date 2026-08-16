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
 * - 浏览器半边走同源 JSON 接口：/api/balance、/api/balance/refresh、
 *   /api/balance/cost。
 *
 * 本文件零依赖（不 import 任何包），作为纯 ESM cordis 插件被 Loader 加载。
 * @module whale-purse
 */

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

/** 价格数字正则：`0.02元`、`1元`、`3.0元`。不要加 `g`：会被 parsePriceCell 重复 exec，`lastIndex` 跨调用污染。 */
const PRICE_RE = /(\d+(?:\.\d+)?)\s*元/

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

/** 从形如 `0.02元` 的单元格文本里解析出数字；失败返回 undefined。 */
function parsePriceCell(text) {
  const match = PRICE_RE.exec(text)
  if (match === null) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

/**
 * 解析当前单价表：三行 bucket 标签，各自携带 flash 与 pro 两个价格格。
 * @returns { { flash: object, pro: object } | undefined }
 */
function parseCurrentTable(html) {
  const text = stripHtml(html)
  const hit = /百万tokens输入（缓存命中）([\s\S]{0,400}?)百万tokens输入（缓存未命中）([\s\S]{0,400}?)百万tokens输出([\s\S]{0,400}?)(?:并发限制|$)/i.exec(text)
  if (hit === null) return undefined
  const cacheReadFlash = parsePriceCell(hit[1])
  const inputFlash = parsePriceCell(hit[2])
  const outputFlash = parsePriceCell(hit[3])
  if (cacheReadFlash === undefined || inputFlash === undefined || outputFlash === undefined) return undefined
  const second = (cell) => parsePriceCell(cell.replace(/^\s*(\d+(?:\.\d+)?元)/, ''))
  return {
    flash: { cacheRead: cacheReadFlash, input: inputFlash, output: outputFlash },
    pro: {
      cacheRead: second(hit[1]) ?? cacheReadFlash,
      input: second(hit[2]) ?? inputFlash,
      output: second(hit[3]) ?? outputFlash,
    },
  }
}

/**
 * 解析峰谷定价表：`deepseek-v4-flash 空闲时段 x元 y元 z元 高峰时段 a元 b元 c元`。
 * @returns { { flash: object, pro: object } | undefined }
 */
function parsePeakTable(html) {
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
    if (current === undefined) return { fetchedAt, error: 'pricing table not found' }
    const peak = parsePeakTable(html)
    return { fetchedAt, current, ...(peak === undefined ? {} : { peak }) }
  } catch (error) {
    return { fetchedAt, error: friendlyError(error, '定价页获取') }
  }
}

/**
 * 当前时刻是否为北京高峰时段：9:00-12:00、14:00-18:00。
 */
function isPeakHour(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value)
  if (Number.isNaN(hour)) return false
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
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

// ---------------------------------------------------------------------------
// 余额服务
// ---------------------------------------------------------------------------

class BalanceService {
  constructor(ctx, config = {}) {
    this.ctx = ctx
    this.apiKeyEnv = config.apiKeyEnv ?? DEFAULT_API_KEY_ENV
    this.baseUrl = String(config.baseUrl ?? DEFAULT_BASE_URL).slice(0, MAX_BASE_URL_LENGTH)
    this.refreshIntervalMs = Math.max(0, (config.refreshIntervalSeconds ?? DEFAULT_REFRESH_INTERVAL_SECONDS) * 1_000)
    this.model = config.model === 'pro' ? 'pro' : 'flash'
    this.enabled = config.enabled ?? true
    this.cached = undefined
    this.cachedAt = 0
    this.inflight = undefined
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

  /** 当前生效单价：官方页优先；峰谷表在生效日后按北京时段取带。 */
  effectivePrices() {
    const snapshot = this.pricingSnapshot ?? { current: CURRENT_PRESETS }
    const current = snapshot.current?.[this.model] ?? CURRENT_PRESETS[this.model]
    const peak = snapshot.peak?.[this.model]
    if (peak !== undefined && Date.now() >= PEAK_PRICING_START_MS) {
      const inPeak = isPeakHour()
      const band = inPeak ? peak.peak : peak.offPeak
      return { ...band, band: inPeak ? 'peak' : 'off-peak' }
    }
    return { ...current, band: 'standard' }
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

  /** 重新抓取官方定价页；失败保留上一快照。 */
  async refreshPricing() {
    const snapshot = await fetchPricing()
    if (snapshot.current !== undefined) this.pricingSnapshot = snapshot
    else this.pricingSnapshot = { fetchedAt: snapshot.fetchedAt, current: CURRENT_PRESETS, peak: PEAK_PRESETS, error: snapshot.error }
  }

  /**
   * 一个会话的 token 用量 + 估算花费。读官方 `tokenUsage` 投影（dsh-token-meter
   * 注册），拿不到时降级为全零。
   */
  sessionCost(session) {
    const registry = this.ctx.get('sessionProjections')
    let usage
    if (registry !== undefined && typeof registry.snapshot === 'function') {
      const value = registry.snapshot(session)?.values?.tokenUsage
      if (value !== null && typeof value === 'object') usage = value
    }
    const buckets = usage ?? {}
    const uncachedInputTokens = Number(buckets.uncachedInputTokens) || 0
    const outputTokens = Number(buckets.outputTokens) || 0
    const cacheReadTokens = Number(buckets.cacheReadTokens) || 0
    const cacheWriteTokens = Number(buckets.cacheWriteTokens) || 0
    const prices = this.effectivePrices()
    const breakdown = {
      input: costOfTokens(uncachedInputTokens, prices.input),
      cacheRead: costOfTokens(cacheReadTokens, prices.cacheRead),
      cacheWrite: 0, // DeepSeek 缓存写入不单独计费
      output: costOfTokens(outputTokens, prices.output),
    }
    const cost = breakdown.input + breakdown.cacheRead + breakdown.cacheWrite + breakdown.output
    return {
      uncachedInputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      cost,
      currency: 'CNY',
      breakdown,
      pricing: {
        model: this.model,
        cacheReadPerMillion: prices.cacheRead,
        inputPerMillion: prices.input,
        outputPerMillion: prices.output,
        band: prices.band,
        peakPricingActive: Date.now() >= PEAK_PRICING_START_MS,
      },
    }
  }

  /** 单条 assistant 消息事件 → 花费条目；无 usage 返回 null。 */
  messageCostOf(event) {
    const usage = event?.data?.usage
    if (usage === undefined || usage === null) return null
    const uncachedInputTokens = Number(usage.inputTokens) || 0
    const outputTokens = Number(usage.outputTokens) || 0
    const cacheReadTokens = Number(usage.cacheReadTokens) || 0
    const cacheWriteTokens = Number(usage.cacheWriteTokens) || 0
    const prices = this.effectivePrices()
    const cost = costOfTokens(uncachedInputTokens, prices.input)
      + costOfTokens(cacheReadTokens, prices.cacheRead)
      + costOfTokens(outputTokens, prices.output)
    return {
      time: Number(event.time) || 0,
      tokens: uncachedInputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
      cost,
    }
  }

  /** 一个会话的最近 N 条消息花费（倒序：最新在前），附带对应的用户问题文本。
      同一个 turn 的多条 assistant 消息（agent 多步循环）合并为一条。 */
  messageCosts(session, limit = 20) {
    const events = session?.events
    if (!Array.isArray(events)) return []
    const byTurn = new Map()
    let currentQuestion = ''
    for (const event of events) {
      if (event.type === 'user/message') {
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
        const cost = this.messageCostOf(event)
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

  /** 近 N 天每天花费（跨所有 live 会话聚合，按本地时区归天）。 */
  dailyCosts(sessionsList, days = 7) {
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
    for (const session of sessionsList ?? []) {
      const events = session?.events
      if (!Array.isArray(events)) continue
      for (const event of events) {
        if (event.type !== 'assistant/message') continue
        const cost = this.messageCostOf(event)
        if (cost === null) continue
        const bucket = buckets.get(dayKey(cost.time))
        if (bucket !== undefined) {
          bucket.cost += cost.cost
          bucket.tokens += cost.tokens
        }
      }
    }
    return [...buckets.values()].map((b) => ({
      date: b.date,
      cost: Math.round(b.cost * 10000) / 10000,
      tokens: b.tokens,
    }))
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
        ...(total === undefined || Number.isNaN(total) ? {} : { total, currency: buckets[0].currency }),
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
  ctx.provide('usageMeter', service)

  const resolveSession = (id) => {
    const sessions = ctx.get('sessions')
    const session = sessions !== undefined && typeof sessions.get === 'function' ? sessions.get(id) : undefined
    if (session === undefined) return undefined
    return { session, cost: service.sessionCost(session) }
  }

  const routes = [
    getRoute('/api/balance', () => service.view()),
    getRoute('/api/balance/refresh', () => service.refresh()),
    getRequestRoute('/api/balance/cost', (req) => {
      const id = sessionParam(req)
      if (id === undefined) return { ok: false, error: 'missing-session' }
      const resolved = resolveSession(id)
      if (resolved === undefined) return { ok: false, error: 'unknown-session' }
      return { ok: true, ...resolved.cost }
    }),
    /** 近 N 天每天花费（跨所有 live 会话）。 */
    getRequestRoute('/api/balance/daily', (req) => {
      const raw = req.url ?? ''
      const q = raw.indexOf('?')
      const days = q < 0 ? 7 : (Number(new URLSearchParams(raw.slice(q + 1)).get('days')) || 7)
      const sessions = ctx.get('sessions')
      const list = sessions !== undefined && typeof sessions.list === 'function' ? sessions.list() : []
      return { ok: true, items: service.dailyCosts(list, Math.min(Math.max(days, 1), 30)) }
    }),
    /** 当前会话最近 N 条消息花费。 */
    getRequestRoute('/api/balance/messages', (req) => {
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
