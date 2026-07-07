import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const OUT = new URL('../.verify/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 160)))
page.on('requestfailed', (r) => { if (r.url().includes('_serverFn')) errors.push('reqfail ' + r.failure()?.errorText) })

const result = {}
async function visit(path, waitText, shot) {
  await page.goto('http://localhost:3000' + path, { waitUntil: 'domcontentloaded' })
  const ok = await page.locator(`text=${waitText}`).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
  await page.waitForTimeout(1100)
  await page.screenshot({ path: OUT + shot, fullPage: true })
  return ok
}

try {
  await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type=email]'); await page.waitForTimeout(1500)
  await page.fill('input[type=email]', 'owner@abcnissan.test')
  await page.fill('input[type=password]', 'Passw0rd!23')
  await page.click('button:has-text("Sign in")')
  await page.waitForURL('**/dashboard', { timeout: 20000 })

  result.intelligence = await visit('/intelligence', 'Intelligence', '07-intelligence.png')
  result.marketing = await visit('/marketing', 'Marketing', '08-marketing.png')
  result.generate = await visit('/marketing/generate', 'Generat', '09-marketing-generate.png')
  result.calendar = await visit('/marketing/calendar', 'Calendar', '10-marketing-calendar.png')
  result.approvals = await visit('/marketing/approvals', 'Approval', '11-marketing-approvals.png')

  // Copilot — load + live conversation via a suggested prompt
  await page.goto('http://localhost:3000/copilot', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=Executive Copilot', { timeout: 15000 })
  await page.waitForTimeout(1000)
  await page.screenshot({ path: OUT + '12-copilot.png', fullPage: true })
  // click first suggested prompt -> triggers send
  await page.locator('button:has-text("Which leads should I call")').first().click().catch(async () => {
    await page.locator('button', { hasText: '?' }).first().click()
  })
  const reply = await page.locator('text=/hot leads|call these|focus/i').first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false)
  await page.waitForTimeout(800)
  await page.screenshot({ path: OUT + '13-copilot-reply.png', fullPage: true })
  result.copilotReply = reply

  console.log(JSON.stringify({ ...result, errors }, null, 2))
} catch (e) {
  console.log('SCRIPT ERROR:', e.message, '| errors:', errors)
  await page.screenshot({ path: OUT + 'modules-error.png', fullPage: true }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
