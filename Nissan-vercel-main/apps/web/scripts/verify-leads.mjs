import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const OUT = new URL('../.verify/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const errors = []

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text().slice(0, 200)}`) })
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
page.on('requestfailed', (r) => { if (r.url().includes('_serverFn')) errors.push(`[reqfail] ${r.failure()?.errorText}`) })

try {
  // login ABC owner
  await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type=email]', { timeout: 15000 })
  await page.waitForTimeout(1500)
  await page.fill('input[type=email]', 'owner@abcnissan.test')
  await page.fill('input[type=password]', 'Passw0rd!23')
  await page.click('button:has-text("Sign in")')
  await page.waitForURL('**/dashboard', { timeout: 20000 })

  // board
  await page.goto('http://localhost:3000/leads', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('h1:has-text("Lead Pipeline")', { timeout: 15000 })
  await page.waitForTimeout(1300)
  const cardCount = await page.locator('a[href^="/leads/"]').count()
  await page.screenshot({ path: OUT + '05-leads-board.png', fullPage: true })

  // open first lead
  await page.locator('a[href^="/leads/"]').first().click()
  await page.waitForURL(/\/leads\/[0-9a-f-]{36}/, { timeout: 15000 })
  await page.waitForSelector('text=Pipeline', { timeout: 15000 })
  await page.waitForTimeout(1000)
  const hasTimeline = await page.locator('text=/Next Best Action|Activity|Timeline/i').first().isVisible().catch(() => false)
  await page.screenshot({ path: OUT + '06-lead-detail.png', fullPage: true })

  console.log(JSON.stringify({ cardCount, hasTimeline, detailUrl: page.url(), errors }, null, 2))
} catch (e) {
  console.log('SCRIPT ERROR:', e.message)
  console.log('errors:', errors)
  await page.screenshot({ path: OUT + 'leads-error.png', fullPage: true }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
