/**
 * 小红书配图：整页截图（鲸鱼娘悬浮 + 面板打开两种状态）。
 */
import { chromium } from '/private/tmp/pwcli-npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core/index.mjs'

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Users/lizijian/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  args: ['--headless=new'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
page.setDefaultTimeout(90_000)

try {
  await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded' })
  const ball = page.getByTestId('usage-meter-ball')
  await ball.waitFor({ state: 'visible', timeout: 60000 })
  await page.waitForTimeout(4000) // 等余额加载
  await page.screenshot({ path: 'assets/shot-floating.png' })

  await ball.click()
  const panel = page.getByTestId('usage-meter-panel')
  await panel.waitFor({ state: 'visible', timeout: 10000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'assets/shot-panel.png' })

  console.log('shots saved')
} catch (e) {
  console.log('ERROR:', e instanceof Error ? e.message : String(e))
} finally {
  await browser.close()
}
