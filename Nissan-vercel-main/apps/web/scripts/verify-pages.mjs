import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const OUT = new URL('../.verify/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 150)) })
page.on('requestfailed', (r) => { if (r.url().includes('_serverFn')) errors.push('reqfail ' + r.failure()?.errorText) })
const res = {}
async function check(path, mustText, shot) {
  await page.goto('http://localhost:3000' + path, { waitUntil: 'domcontentloaded' })
  const ok = await page.locator(`text=${mustText}`).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
  await page.waitForTimeout(1100)
  await page.screenshot({ path: OUT + shot, fullPage: false })
  return ok
}
try {
  await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type=email]'); await page.waitForTimeout(1500)
  await page.fill('input[type=email]', 'owner@abcnissan.test')
  await page.fill('input[type=password]', 'Passw0rd!23')
  await page.click('button:has-text("Sign in")')
  await page.waitForURL('**/dashboard', { timeout: 20000 })

  res.reportsSales = await check('/reports', 'Sales Performance', '16-reports.png')
  res.reportsTeam = await page.locator('text=/Team Performance|Team/i').first().isVisible().catch(() => false)
  res.settings = await check('/settings', 'Subscription', '17-settings.png')
  res.price20 = await page.locator('text=$20').first().isVisible().catch(() => false)
  res.currentPlan = await page.locator('text=Current plan').first().isVisible().catch(() => false)
  console.log(JSON.stringify({ ...res, errors }, null, 2))
} catch (e) {
  console.log('SCRIPT ERROR:', e.message, '| errors:', errors); process.exitCode = 1
} finally { await browser.close() }
