// Smoke test for whale-purse non-DeepSeek detection (runs against real lib/index.js source).
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const src = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '')
  + '\n;globalThis.__wpTest = { normalizeModel, isDeepSeekModel, BalanceService, CURRENT_PRESETS, PEAK_PRESETS }\n'

const sandbox = {
  console, Date, Intl, URL, URLSearchParams, Map, Set, WeakMap,
  Number, String, Math, JSON, Promise, AbortController,
  setTimeout, clearTimeout, setInterval, clearInterval,
  // 模块顶层常量用到的导入符号（方法内部用到的 fs 符号不会被本次测试触达）
  join: (...args) => args.join('/'),
  homedir: () => '/home/test',
  process: { env: {} },
}
vm.createContext(sandbox)
vm.runInContext(src, sandbox)
const { normalizeModel, isDeepSeekModel, BalanceService, CURRENT_PRESETS, PEAK_PRESETS } = sandbox.__wpTest

let failures = 0
function check(label, actual, expected) {
  const ok = Object.is(actual, expected)
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  =>  ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
}

// --- normalizeModel / isDeepSeekModel ---
check('deepseek-v4-flash -> flash', normalizeModel('deepseek-v4-flash'), 'flash')
check('deepseek-v4-pro -> pro', normalizeModel('deepseek-v4-pro'), 'pro')
check('deepseek-v4-flash-vision-exp -> flash', normalizeModel('deepseek-v4-flash-vision-exp'), 'flash')
check('deepseek-chat (legacy) -> flash', normalizeModel('deepseek-chat'), 'flash')
check('gpt-5-pro -> other (KEY FIX)', normalizeModel('gpt-5-pro'), 'other')
check('qwen2.5-flash -> other (KEY FIX)', normalizeModel('qwen2.5-flash'), 'other')
check('claude-sonnet-4 -> other', normalizeModel('claude-sonnet-4'), 'other')
check('gpt-4o -> other', normalizeModel('gpt-4o'), 'other')
check("'' -> undefined", normalizeModel(''), undefined)
check('undefined -> undefined', normalizeModel(undefined), undefined)
check('custom model on deepseek provider -> flash', normalizeModel('my-custom', 'deepseek-official'), 'flash')
check('deepseek model on foreign provider -> pro', normalizeModel('deepseek-v4-pro', 'openai'), 'pro')
check('isDeepSeekModel gpt-4o -> false', isDeepSeekModel('gpt-4o'), false)
check('isDeepSeekModel deepseek-v4-flash -> true', isDeepSeekModel('deepseek-v4-flash'), true)

// --- service-level behavior (avoid constructor network call) ---
const svc = Object.create(BalanceService.prototype)
svc.model = 'auto'
svc.pricingSnapshot = { fetchedAt: Date.now(), current: CURRENT_PRESETS, peak: PEAK_PRESETS }
svc.ctx = { get: () => undefined }
svc.sessionUsageCache = new WeakMap()

check('modelOf deepseek-v4-flash -> flash', svc.modelOf('deepseek-v4-flash'), 'flash')
check('modelOf gpt-5-pro -> other', svc.modelOf('gpt-5-pro'), 'other')
check('modelOf undefined -> flash fallback', svc.modelOf(undefined), 'flash')
check('modelOf gpt-4o provider openai -> other', svc.modelOf('gpt-4o', 'openai'), 'other')

const explicit = Object.create(BalanceService.prototype)
explicit.model = 'pro'
check('explicit pro forces tier', explicit.modelOf('gpt-4o'), 'pro')

const headerEvent = (model, provider) => ({ type: 'request/header', data: { header: { config: { model, provider } } } })
const usage = { inputTokens: 100000, outputTokens: 50000, cacheReadTokens: 0, cacheWriteTokens: 0 }
const assistantEvent = (model, provider, time = 1700000000000) => ({ type: 'assistant/message', time, data: { usage, turn: 1 } })
const userEvent = (text) => ({ type: 'user/message', data: { content: [{ kind: 'text', text }] } })

check('sessionModel deepseek -> flash', svc.sessionModel({ events: [headerEvent('deepseek-v4-flash', 'deepseek-official')] }), 'flash')
check('sessionModel gpt-4o -> other', svc.sessionModel({ events: [headerEvent('gpt-4o', 'openai')] }), 'other')
check('sessionModel no events -> flash', svc.sessionModel({ events: [] }), 'flash')
check('sessionModel last header wins (pro then gpt) -> other', svc.sessionModel({ events: [headerEvent('deepseek-v4-pro'), headerEvent('gpt-4o')] }), 'other')
check('sessionModel last header wins (gpt then pro) -> pro', svc.sessionModel({ events: [headerEvent('gpt-4o'), headerEvent('deepseek-v4-pro')] }), 'pro')
check('sessionModel user-only -> flash', svc.sessionModel({ events: [userEvent('hi')] }), 'flash')

// --- messageCostOf ---
check('messageCostOf other -> null', svc.messageCostOf(assistantEvent(), 'other'), null)
check('messageCostOf flash -> cost', svc.messageCostOf(assistantEvent(), 'flash').cost > 0, true)

// --- sessionCost ---
const pureOther = svc.sessionCost({ events: [headerEvent('gpt-4o', 'openai'), assistantEvent()] })
check('sessionCost other model -> cost 0', pureOther.cost, 0)
check('sessionCost other model -> pricing.model other', pureOther.pricing.model, 'other')
check('sessionCost other model -> breakdown zero', pureOther.breakdown.input + pureOther.breakdown.output, 0)

const pureFlash = svc.sessionCost({ events: [headerEvent('deepseek-v4-flash', 'deepseek-official'), assistantEvent()] })
check('sessionCost flash model -> cost > 0', pureFlash.cost > 0, true)
check('sessionCost flash model -> pricing.model flash', pureFlash.pricing.model, 'flash')

const mixed = svc.sessionCost({ events: [headerEvent('deepseek-v4-flash', 'deepseek-official'), assistantEvent(), headerEvent('gpt-4o', 'openai'), assistantEvent()] })
check('mixed session prices deepseek part only', mixed.cost, pureFlash.cost)
check('mixed session pricing.model other', mixed.pricing.model, 'other')

// --- messageCosts / dailyCosts fold non-deepseek away ---
const msgs = svc.messageCosts({ events: [headerEvent('deepseek-v4-flash'), assistantEvent(), headerEvent('gpt-4o'), assistantEvent()] })
check('messageCosts keeps deepseek turn only', msgs.length, 1)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
