import { chromium } from 'playwright'
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
page.on('requestfailed', (r) => { if (r.url().includes('_serverFn')) errors.push('reqfail ' + r.failure()?.errorText) })
try {
  await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type=email]'); await page.waitForTimeout(1500)
  await page.fill('input[type=email]', (process.env.VERIFY_EMAIL || 'owner@abcnissan.test'))
  await page.fill('input[type=password]', (process.env.VERIFY_PASSWORD || 'Passw0rd!23'))
  await page.click('button:has-text("Sign in")')
  await page.waitForURL('**/dashboard', { timeout: 20000 })

  await page.goto('http://localhost:3000/copilot', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=Executive Copilot', { timeout: 15000 })
  await page.waitForTimeout(1500)
  await page.locator('button:has-text("Which leads should I call")').first().click()
  const reply = await page.locator('text=/hot leads|call these|follow|focus/i').first()
    .waitFor({ timeout: 20000 }).then(() => true).catch(() => false)
  await page.waitForTimeout(600)
  await page.screenshot({ path: new URL('../.verify/15-copilot-fallback.png', import.meta.url).pathname, fullPage: false })
  console.log(JSON.stringify({ replied: reply, errors }, null, 2))
} catch (e) {
  console.log('SCRIPT ERROR:', e.message, '| errors:', errors)
  process.exitCode = 1
} finally {
  await browser.close()
}
