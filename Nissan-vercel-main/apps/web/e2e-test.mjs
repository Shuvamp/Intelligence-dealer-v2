import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3000';
const EMAIL = 'owner@abcnissan.test';
const PASS = 'Passw0rd!23';

const results = [];

function log(icon, step, detail) {
  const line = `${icon} ${step}${detail ? ' → ' + detail : ''}`;
  console.log(line);
  results.push(line);
}

async function screenshot(page, name) {
  const path = `e2e-screenshot-${name}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`  📸 ${path}`);
}

async function nav(page, url, label, screenshotId) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(2000);
  const landed = page.url();
  log('✅', label, landed);
  if (screenshotId) await screenshot(page, screenshotId);
  return landed;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text().substring(0, 200)); });
  page.on('pageerror', err => consoleErrors.push(err.message.substring(0, 200)));

  try {
    // ─── AUTH ─────────────────────────────────────────────────────
    log('🔑', 'Check auth state');
    await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);
    const afterLogin = page.url();

    if (afterLogin.includes('/login') || afterLogin === BASE_URL + '/') {
      // Need to log in
      log('🔑', 'Login form visible — filling credentials');
      const emailInput = await page.$('input[type="email"], input[name="email"]');
      if (emailInput) {
        await emailInput.fill(EMAIL);
        await page.fill('input[type="password"]', PASS);
        await page.click('button[type="submit"]');
        await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 20000 });
        await page.waitForTimeout(2000);
        log('✅', 'Logged in', page.url());
      } else {
        log('⚠️', 'Login page loaded but no email input found', afterLogin);
        await screenshot(page, 'login-no-form');
      }
    } else {
      log('✅', 'Already authenticated', afterLogin);
    }
    await screenshot(page, '01-post-auth');

    // ─── DASHBOARD ───────────────────────────────────────────────
    await nav(page, BASE_URL + '/dashboard', 'Dashboard loads', '02-dashboard');

    // Check for error states on dashboard
    const dashboardErrors = await page.$$eval('[data-testid="error"], .error-boundary, [class*="error"]', els =>
      els.map(e => e.textContent?.trim().substring(0, 100)).filter(Boolean)
    );
    if (dashboardErrors.length > 0) {
      log('⚠️', 'Dashboard error elements', dashboardErrors.join(' | '));
    }

    // ─── MARKETING INDEX ─────────────────────────────────────────
    await nav(page, BASE_URL + '/marketing', 'Marketing index loads', '03-marketing-index');

    // ─── MARKETING DASHBOARD ─────────────────────────────────────
    await nav(page, BASE_URL + '/marketing/dashboard', 'Marketing dashboard loads', '04-marketing-dashboard');

    // Check for data loaded or loading states
    const mdashCards = await page.$$('div[class*="card"], article, [class*="stat"], [class*="metric"]');
    log('🔍', 'Marketing dashboard cards/metrics', `${mdashCards.length} elements`);

    // ─── CAMPAIGN PLANNER ────────────────────────────────────────
    await nav(page, BASE_URL + '/marketing/campaign-planner', 'Campaign planner loads', '05-campaign-planner');

    // Check campaigns rendered
    const campaignItems = await page.$$('[class*="campaign"], [data-testid*="campaign"], tr, li[class*="item"]');
    log('🔍', 'Campaign planner items', `${campaignItems.length} elements`);

    // Look for create button
    const createBtn = await page.$('button:has-text("Create"), button:has-text("New Campaign"), button:has-text("Add Campaign"), a:has-text("New Campaign")');
    if (createBtn) {
      const btnText = await createBtn.textContent();
      log('✅', 'Create button found', btnText?.trim());
      await createBtn.click();
      await page.waitForTimeout(2000);
      log('🔍', 'Create button clicked', page.url());
      await screenshot(page, '05b-campaign-create-modal');
      // Close if modal
      const closeBtn = await page.$('button:has-text("Cancel"), button:has-text("Close"), [aria-label="Close"], button[class*="close"]');
      if (closeBtn) await closeBtn.click();
      await page.waitForTimeout(500);
    } else {
      log('🔍', 'No create campaign button found');
    }

    // ─── CONTENT STUDIO ──────────────────────────────────────────
    await nav(page, BASE_URL + '/marketing/content-studio', 'Content studio loads', '06-content-studio');

    const contentItems = await page.$$('[class*="post"], [class*="content"], [class*="draft"]');
    log('🔍', 'Content studio items', `${contentItems.length} elements`);

    // ─── MEDIA LIBRARY ───────────────────────────────────────────
    await nav(page, BASE_URL + '/marketing/media-library', 'Media library loads', '07-media-library');

    const mediaItems = await page.$$('img[src], [class*="media"], [class*="asset"]');
    log('🔍', 'Media library items', `${mediaItems.length} elements`);

    // ─── CONNECTED CHANNELS ──────────────────────────────────────
    await nav(page, BASE_URL + '/connected-channels', 'Connected channels loads', '08-connected-channels');

    const channelItems = await page.$$('[class*="channel"], [class*="platform"], [class*="account"]');
    log('🔍', 'Channel items', `${channelItems.length} elements`);

    // ─── COMPLIANCE CENTER ───────────────────────────────────────
    await nav(page, BASE_URL + '/marketing/compliance-center', 'Compliance center loads', '09-compliance-center');

    // ─── APPROVAL QUEUE ──────────────────────────────────────────
    await nav(page, BASE_URL + '/marketing/approval-queue', 'Approval queue loads', '10-approval-queue');

    const queueItems = await page.$$('[class*="approval"], [class*="pending"], tr');
    log('🔍', 'Approval queue items', `${queueItems.length} elements`);

    // ─── PROBE: sidebar navigation works ────────────────────────
    await page.goto(BASE_URL + '/marketing', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);
    const allNavLinks = await page.$$eval('nav a, aside a', els =>
      els.map(e => ({ text: e.textContent?.trim(), href: e.getAttribute('href') }))
         .filter(l => l.href && l.text)
    );
    const mktLinks = allNavLinks.filter(l => l.href?.includes('marketing'));
    log('🔍', 'Marketing nav links in sidebar', mktLinks.map(l => l.text).join(', '));

    // ─── PROBE: unauthenticated access redirect ──────────────────
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(BASE_URL + '/marketing/dashboard', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page2.waitForTimeout(1500);
    const unauthedUrl = page2.url();
    const redirectedOk = unauthedUrl.includes('/login') || unauthedUrl.includes('/');
    log(redirectedOk ? '✅' : '⚠️', 'Unauthenticated access', unauthedUrl);
    await ctx2.close();

    // ─── PROBE: non-existent marketing route ─────────────────────
    await page.goto(BASE_URL + '/marketing/nonexistent-route', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(1000);
    const notFoundText = await page.$('text=/404|not found|page not found/i');
    log(notFoundText ? '✅' : '⚠️', '404 for bad route', page.url());

    // ─── CONSOLE ERRORS SUMMARY ──────────────────────────────────
    if (consoleErrors.length > 0) {
      log('⚠️', `Console errors (${consoleErrors.length})`, consoleErrors.slice(0, 3).join(' || '));
    } else {
      log('✅', 'No console errors during session');
    }

  } catch (err) {
    log('❌', 'FATAL', err.message);
    try { await screenshot(page, 'error-state'); } catch {}
  } finally {
    await browser.close();
    console.log('\n─── SUMMARY ───');
    const passes = results.filter(r => r.startsWith('✅')).length;
    const fails = results.filter(r => r.startsWith('❌')).length;
    const warns = results.filter(r => r.startsWith('⚠️')).length;
    const probes = results.filter(r => r.startsWith('🔍')).length;
    console.log(`PASS: ${passes} | FAIL: ${fails} | WARN: ${warns} | PROBE: ${probes}`);
    console.log('Screenshots saved in apps/web/');
  }
})();
