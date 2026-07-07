import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const OUT = new URL('../.verify/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const errors = []

async function login(page, email) {
  await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type=email]', { timeout: 15000 })
  await page.waitForTimeout(1500) // let the client hydrate so the React submit runs
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', 'Passw0rd!23')
  await page.click('button:has-text("Sign in")')
  await page.waitForURL('**/dashboard', { timeout: 20000 })
  await page.waitForSelector('h1', { timeout: 15000 })
  await page.waitForTimeout(1400) // let the staggered load-in finish before any screenshot
}

async function customers(page) {
  await page.goto('http://localhost:3000/customers', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('h1:has-text("Customers")', { timeout: 15000 })
  await page.waitForTimeout(900)
  return page.locator('[data-testid="customer-row"]').count()
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text().slice(0, 160)}`)
})
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
page.on('requestfailed', (r) => {
  if (r.url().includes('_serverFn'))
    errors.push(`[requestfailed] ${r.failure()?.errorText}`)
})

try {
  // 1. ABC owner
  await login(page, 'owner@abcnissan.test')
  const greeting = await page.locator('h1').first().innerText()
  const tenantName = await page.locator('header >> text=ABC Nissan').first().isVisible().catch(() => false)
  await page.screenshot({ path: OUT + '01-dashboard-abc.png', fullPage: true })

  const abcRows = await customers(page)
  await page.screenshot({ path: OUT + '02-customers-abc.png', fullPage: true })

  // 2. sign out, then XYZ sales (different tenant + branding + plan gating)
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded' })
  await page.click('button[aria-label="Sign out"]')
  await page.waitForURL('**/login', { timeout: 15000 })
  await login(page, 'sales@xyznissan.test')
  await page.screenshot({ path: OUT + '04-dashboard-xyz.png', fullPage: true })
  const xyzRows = await customers(page)
  await page.screenshot({ path: OUT + '03-customers-xyz.png', fullPage: true })

  console.log(JSON.stringify({
    greeting,
    tenantHeaderVisible: tenantName,
    abcCustomerRows: abcRows,
    xyzCustomerRows: xyzRows,
    errors,
  }, null, 2))
} catch (e) {
  console.log('SCRIPT ERROR:', e.message)
  console.log('errors:', errors)
  await page.screenshot({ path: OUT + 'error-state.png', fullPage: true }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
