import { chromium } from 'playwright'
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
page.on('requestfailed', (r) => { if (r.url().includes('_serverFn')) errors.push('reqfail ' + r.failure()?.errorText) })
try {
  await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type=email]'); await page.waitForTimeout(1500)
  await page.fill('input[type=email]', 'owner@abcnissan.test')
  await page.fill('input[type=password]', 'Passw0rd!23')
  await page.click('button:has-text("Sign in")')
  await page.waitForURL('**/dashboard', { timeout: 20000 })

  await page.goto('http://localhost:3000/marketing/generate', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[placeholder="e.g. Magnite"]', { timeout: 15000 })
  await page.waitForTimeout(1800) // let the client hydrate so the controlled input + enable-logic wire up
  await page.fill('input[placeholder="e.g. Magnite"]', 'Magnite')
  await page.waitForSelector('button:has-text("Generate"):not([disabled])', { timeout: 8000 })
  await page.click('button:has-text("Generate")')
  // a caption appears in the "Generated draft" preview after the agent runs (template fallback)
  const ok = await page.locator('text=/Nissan Magnite|#Nissan|book your test drive/i').first()
    .waitFor({ timeout: 20000 }).then(() => true).catch(() => false)
  await page.waitForTimeout(600)
  await page.screenshot({ path: new URL('../.verify/14-marketing-generate-result.png', import.meta.url).pathname, fullPage: true })
  console.log(JSON.stringify({ captionGenerated: ok, errors }, null, 2))
} catch (e) {
  console.log('SCRIPT ERROR:', e.message, '| errors:', errors)
  process.exitCode = 1
} finally {
  await browser.close()
}
