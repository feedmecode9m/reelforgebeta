#!/usr/bin/env node
/**
 * BG-NOTIFICATION-LOOP-01 — post-deploy validation harness.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const FRONTEND_URL = 'https://strong-lolly-a9fcb4.netlify.app/';
const OUT = path.join(ROOT, 'artifacts/bg-notification-loop-01.json');
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const VIDEO_DROP = '[aria-label="Video drop zone"]';
const CONDO = '/home/youloose2dafish/projects/reelforge/public/videos/d1b48f55-51e1-40d3-a563-f46cb61643c6.mp4';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loginStudio(page) {
  if (!(await page.locator('.control-center-overlay').isVisible().catch(() => false))) {
    await page.locator('button.ghost-trigger').click({ timeout: 60000 });
  }
  await page.waitForSelector('.control-center-overlay', { timeout: 60000 });
  if (!(await page.locator('.logout-btn').isVisible().catch(() => false))) {
    for (const password of ['Gaff1505!', 'SMART_PRODUCTION', 'admin123']) {
      await page.locator('.admin-login-panel input[type="password"]').fill(password);
      await page.locator('.admin-login-panel button.submit-btn').click();
      await sleep(2500);
      if (await page.locator('.logout-btn').isVisible().catch(() => false)) break;
    }
  }
  const tab = page.locator('[data-studio-workspace-tabs] button', { hasText: 'Content' });
  if (await tab.isVisible().catch(() => false)) await tab.click();
}

function classifyNotificationRequests(url) {
  if (/\/api\/notifications\/status/.test(url)) return 'status';
  if (/\/api\/notifications(\?|$)/.test(url)) return 'list';
  return 'other';
}

async function main() {
  const notificationCalls = [];
  const consoleLogs = [];
  const networkAll = [];

  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  const context = await browser.newContext();
  await context.clearCookies();
  const page = await context.newPage();

  page.on('console', (msg) => consoleLogs.push(msg.text()));
  page.on('response', (res) => {
    const url = res.url();
    const req = res.request();
    networkAll.push({ method: req.method(), url, status: res.status() });
    if (/notifications/.test(url)) {
      notificationCalls.push({
        at: Date.now(),
        kind: classifyNotificationRequests(url),
        method: req.method(),
        url,
        status: res.status()
      });
    }
  });

  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });

  notificationCalls.length = 0;

  const bundle = await page.evaluate(async () => {
    const src = [...document.querySelectorAll('script[src*="/assets/index-"]')][0]?.src || null;
    if (!src) return { src: null, hasNotifyFalse: false, hasRefreshInFlight: false };
    const text = await fetch(src).then((r) => r.text());
    return {
      src,
      hasNotifyFalse: text.includes('notify:!1') || text.includes('notify: false'),
      hasRefreshInFlight: text.includes('refreshInFlight')
    };
  });

  await sleep(15000);

  const statusCount = notificationCalls.filter((c) => c.kind === 'status').length;
  const listCount = notificationCalls.filter((c) => c.kind === 'list').length;
  const storm = statusCount > 3 || listCount > 3;

  const threatLogs = consoleLogs.filter((l) =>
    /\[THREAT_EVENT\]|notification_loop|endpoint_burst/i.test(l)
  );

  await loginStudio(page);
  await page.waitForSelector(VIDEO_DROP, { timeout: 90000 }).catch(() => {});

  const uploadLogsBefore = consoleLogs.length;
  const netBefore = networkAll.length;

  // Sign-only observation: trigger upload path start via sign API from page context isn't full drop for 362MB.
  // Observe signed path markers by initiating sign through studio if possible — use file input if exists.
  const fileInput = page.locator('input[type="file"]').first();
  if (await fileInput.count()) {
    await fileInput.setInputFiles(CONDO).catch(() => {});
  }

  await sleep(20000);

  const uploadStageLogs = consoleLogs
    .slice(uploadLogsBefore)
    .filter((l) => l.includes('[UPLOAD_STAGE]'))
    .slice(0, 20);

  const uploadNetwork = networkAll.slice(netBefore).filter((n) =>
    /\/api\/(uploads\/sign|reels)/.test(n.url)
  );

  await browser.close();

  const report = {
    mission: 'BG-NOTIFICATION-LOOP-01',
    timestamp: new Date().toISOString(),
    deployId: '6a6541e1a77bc9e6fb16cd62',
    bundle,
    notificationProbe: {
      observeMs: 15000,
      statusRequests: statusCount,
      listRequests: listCount,
      totalNotificationRequests: notificationCalls.length,
      stormDetected: storm,
      calls: notificationCalls.slice(0, 20)
    },
    consoleThreats: threatLogs,
    uploadObservation: {
      uploadStageLogs,
      uploadNetwork: uploadNetwork.slice(0, 10)
    },
    pass:
      !storm &&
      statusCount <= 2 &&
      listCount <= 2 &&
      threatLogs.length === 0
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
