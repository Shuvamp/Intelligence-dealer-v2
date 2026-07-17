import { chromium } from 'playwright'

const BASE = 'http://localhost:3002'

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('console', (m) => console.log('[console]', m.type(), m.text()))
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('requestfailed', (r) => console.log('[requestfailed]', r.method(), r.url(), '->', r.failure()?.errorText))
page.on('response', (r) => { if (!r.ok()) console.log('[response !ok]', r.status(), r.url()) })

console.log('-> login')
await page.goto(`${BASE}/login`, { waitUntil: 'load' })
await page.waitForTimeout(3000)
await page.fill('input[type="email"]', 'owner@abcnissan.test')
await page.fill('input[type="password"]', 'Passw0rd!23')
await page.click('button:has-text("Sign in")')
await page.waitForURL('**/dashboard**', { timeout: 20000 })
console.log('logged in, at', page.url())

console.log('-> media library')
await page.goto(`${BASE}/marketing/media-library`, { waitUntil: 'load' })
await page.waitForTimeout(2000)
await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 15000 })

const fileInput = page.locator('input[type="file"]')
await fileInput.setInputFiles(String.raw`C:\Users\New User\AppData\Local\Temp\upload-test\test-pixel.png`)

await page.waitForSelector('text=Upload Asset', { timeout: 10000 })
console.log('dialog open')
await page.fill('input[placeholder*="Magnite Red"]', 'Playwright Test Asset')
await page.selectOption('select >> nth=0', 'logo')

const [uploadResp] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/_serverFn/') || r.request().method() === 'POST', { timeout: 20000 }).catch(() => null),
  page.click('button:has-text("Upload")'),
])

await page.waitForTimeout(2000)
await page.screenshot({ path: String.raw`C:\Users\New User\AppData\Local\Temp\upload-test\post-click.png` })
await page.waitForSelector('text=Upload Asset', { state: 'detached', timeout: 20000 })
console.log('upload dialog closed - upload succeeded')

await page.waitForSelector('text=Playwright Test Asset', { timeout: 10000 })
console.log('asset visible in grid')

// grab the file_url via the img src near the asset name, or via list view
await page.click('button:has-text("List")').catch(() => {})
const rowText = await page.locator('text=Playwright Test Asset').first().locator('xpath=ancestor::tr').textContent().catch(() => null)
console.log('row text:', rowText)

await page.screenshot({ path: String.raw`C:\Users\New User\AppData\Local\Temp\upload-test\after-upload.png` })

await browser.close()
console.log('DONE')
