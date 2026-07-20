import { chromium } from 'playwright'
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
page.on('requestfailed', (r) => { if (r.url().includes('_serverFn')) errors.push(`reqfail ${r.failure()?.errorText}`) })

try {
  await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type=email]'); await page.waitForTimeout(1500)
  await page.fill('input[type=email]', (process.env.VERIFY_EMAIL || 'owner@abcnissan.test'))
  await page.fill('input[type=password]', (process.env.VERIFY_PASSWORD || 'Passw0rd!23'))
  await page.click('button:has-text("Sign in")')
  await page.waitForURL('**/dashboard', { timeout: 20000 })

  await page.goto('http://localhost:3000/leads', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('h1:has-text("Lead Pipeline")'); await page.waitForTimeout(1000)
  await page.locator('a[href^="/leads/"]').first().click()
  await page.waitForURL(/\/leads\/[0-9a-f-]{36}/, { timeout: 15000 })
  await page.waitForTimeout(800)

  // --- mutation 1: log a note ---
  const note = 'QA verify note ' + Math.floor(performance.now())
  await page.fill('textarea', note)
  await page.click('button:has-text("Log")')
  const noteAppeared = await page.locator(`text=${note}`).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false)

  // --- mutation 2: change stage to Contacted ---
  await page.locator('button:has-text("Contacted")').first().click()
  await page.waitForTimeout(1500)
  const movedEvent = await page.locator('text=/Moved to contacted/i').first().isVisible().catch(() => false)

  console.log(JSON.stringify({ noteAppeared, movedEvent, errors }, null, 2))
} catch (e) {
  console.log('SCRIPT ERROR:', e.message, '| errors:', errors)
  process.exitCode = 1
} finally {
  await browser.close()
}
