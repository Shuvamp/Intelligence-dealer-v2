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
try {
  await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type=email]'); await page.waitForTimeout(1500)
  await page.fill('input[type=email]', (process.env.VERIFY_EMAIL || 'owner@abcnissan.test'))
  await page.fill('input[type=password]', (process.env.VERIFY_PASSWORD || 'Passw0rd!23'))
  await page.click('button:has-text("Sign in")')
  await page.waitForURL('**/dashboard', { timeout: 20000 })

  // nav has a Subscription item now
  res.subNavItem = await page.locator('a:has-text("Subscription")').first().isVisible().catch(() => false)
  // devtools badge gone (the TanStack devtools trigger button)
  res.devtoolsGone = (await page.locator('[data-testid="tsqd-open-btn"], .tsqd-open-btn, [aria-label*="devtools" i]').count()) === 0

  await page.goto('http://localhost:3000/settings', { waitUntil: 'domcontentloaded' })
  res.settingsProfile = await page.locator('text=Your profile').first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
  res.settingsTeam = await page.locator('text=Team members').first().isVisible().catch(() => false)
  await page.waitForTimeout(1100)
  await page.screenshot({ path: OUT + '19-settings-real.png', fullPage: false })

  await page.goto('http://localhost:3000/subscription', { waitUntil: 'domcontentloaded' })
  res.subscriptionPage = await page.locator('text=Subscription & Billing').first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
  await page.waitForTimeout(1000)
  await page.screenshot({ path: OUT + '20-subscription.png', fullPage: false })

  console.log(JSON.stringify({ ...res, errors }, null, 2))
} catch (e) {
  console.log('SCRIPT ERROR:', e.message, '| errors:', errors); process.exitCode = 1
} finally { await browser.close() }
