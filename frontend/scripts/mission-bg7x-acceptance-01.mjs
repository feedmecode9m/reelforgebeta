#!/usr/bin/env node
/**
 * BG7X-ACCEPTANCE-01 — production browser signed-upload acceptance.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app/').replace(/\/?$/, '/');
const OUT_JSON = path.join(ROOT, 'artifacts/bg7x-acceptance-01.json');
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const VIDEO_DROP = '[aria-label="Video drop zone"]';

const FIXTURES = {
  A: {
    label: 'MICROS_STIRRED_V3.MOV',
    path: '/home/youloose2dafish/projects/reelforge/public/videos/0b41788c-e751-4a69-9831-8d87f566e4cd.mov',
    fileName: 'MICROS_STIRRED_V3.MOV',
    mime: 'video/quicktime',
    observeMs: 420000
  },
  B: {
    label: 'condo_v1_2.mp4',
    path: '/home/youloose2dafish/projects/reelforge/public/videos/d1b48f55-51e1-40d3-a563-f46cb61643c6.mp4',
    fileName: 'condo_v1_2.mp4',
    mime: 'video/mp4',
    observeMs: 300000
  }
};

const MARKERS = [
  '[BG7G_UPLOAD]',
  '[UPLOAD_STAGE]',
  '[BG7X_R2_PUT]',
  '[BG7X_FINALIZE]',
  '[UPLOAD_SUCCESS]',
  '[BG7X_UPLOAD_TIMEOUT]',
  '[BG7G_SIGNED_UPLOAD]'
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pickLogs(logs, since = 0) {
  return logs.slice(since).filter((line) => MARKERS.some((m) => line.includes(m)));
}

async function loginStudio(page) {
  if (!(await page.locator('.control-center-overlay').isVisible().catch(() => false))) {
    await page.locator('button.ghost-trigger').click({ timeout: 60000 });
  }
  await page.waitForSelector('.control-center-overlay', { timeout: 60000 });
  if (!(await page.locator('.logout-btn').isVisible().catch(() => false))) {
    let ok = false;
    for (const password of ['Gaff1505!', 'SMART_PRODUCTION', 'admin123']) {
      await page.locator('.admin-login-panel input[type="password"]').fill(password);
      await page.locator('.admin-login-panel button.submit-btn').click();
      await sleep(2500);
      if (await page.locator('.logout-btn').isVisible().catch(() => false)) {
        ok = true;
        break;
      }
    }
    if (!ok) throw new Error('Studio login failed');
  }
  const tab = page.locator('[data-studio-workspace-tabs] button', { hasText: 'Content' });
  if (await tab.isVisible().catch(() => false)) await tab.click();
  await page.waitForSelector(VIDEO_DROP, { timeout: 90000 });
}

async function clearVaultStorage(page) {
  await page.evaluate(() => {
    localStorage.removeItem('personal_video_vault');
    localStorage.removeItem('reel_vault');
  });
}

async function dropFile(page, filePath, fileName, mimeType) {
  const stat = fs.statSync(filePath);
  if (stat.size > 30 * 1024 * 1024) {
    return { ok: false, reason: 'fixture exceeds in-browser drop limit; network observation only via API path not used here' };
  }
  const b64 = fs.readFileSync(filePath).toString('base64');
  return page.evaluate(
    async ({ sel, b64Data, name, mime }) => {
      const target = document.querySelector(sel);
      if (!target) return { ok: false, reason: `missing ${sel}` };
      const bin = atob(b64Data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], name, { type: mime });
      const dt = new DataTransfer();
      dt.items.add(file);
      const common = { bubbles: true, cancelable: true, dataTransfer: dt };
      target.dispatchEvent(new DragEvent('dragenter', common));
      target.dispatchEvent(new DragEvent('dragover', common));
      target.dispatchEvent(new DragEvent('drop', common));
      return { ok: true, size: file.size, name: file.name, type: file.type };
    },
    { sel: VIDEO_DROP, b64Data: b64, name: fileName, mime: mimeType }
  );
}

async function observeCase(page, caseId, network, consoleLogs) {
  const fx = FIXTURES[caseId];
  const netBefore = network.length;
  const logBefore = consoleLogs.length;
  const startedAt = Date.now();

  await clearVaultStorage(page);
  const drop = await dropFile(page, fx.path, fx.fileName, fx.mime);
  if (!drop.ok) {
    return { caseId, label: fx.label, pass: false, error: drop.reason, logs: pickLogs(consoleLogs, logBefore) };
  }

  const deadline = Date.now() + fx.observeMs;
  let lastSnapshot = null;
  while (Date.now() < deadline) {
    const slice = network.slice(netBefore);
    const sign = slice.find((n) => n.method === 'POST' && /\/api\/uploads\/sign/.test(n.url) && n.status);
    const finalize = slice.find((n) => n.method === 'POST' && /\/api\/reels\/finalize/.test(n.url) && n.status);
    const reelPost = slice.find(
      (n) => n.method === 'POST' && /\/api\/reels(\?|$)/.test(n.url) && !/\/finalize/.test(n.url) && n.status
    );
    const put = slice.filter((n) => n.method === 'PUT' && /r2\.cloudflarestorage\.com/.test(n.url));
    const putDone = put.find((n) => n.status >= 200 && n.status < 300);
    const putStarted = put.length > 0;
    const logs = pickLogs(consoleLogs, logBefore);
    const successLog = logs.some((l) => l.includes('[UPLOAD_SUCCESS]'));
    const timeoutLog = logs.some((l) => l.includes('[BG7X_UPLOAD_TIMEOUT]'));
    const errors = consoleLogs.slice(logBefore).filter((l) => /error|failed|ERR_/i.test(l));

    lastSnapshot = {
      sign: sign ? { status: sign.status, url: sign.url } : null,
      putStarted,
      put: putDone ? { status: putDone.status } : put[put.length - 1] || null,
      finalize: finalize ? { status: finalize.status } : null,
      reelPost: reelPost ? { status: reelPost.status } : null,
      successLog,
      timeoutLog,
      elapsedMs: Date.now() - startedAt
    };

    if (caseId === 'A') {
      if (sign?.status === 200 && putStarted && finalize?.status === 202) break;
      if (successLog) break;
    }
    if (caseId === 'B') {
      if (sign?.status === 200 && putStarted) break;
      if (timeoutLog || errors.length > 3) break;
      if (finalize?.status || reelPost?.status === 400) break;
    }
    await sleep(2000);
  }

  const vaultItems = await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('personal_video_vault');
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  });

  const logs = pickLogs(consoleLogs, logBefore);
  const passA =
    lastSnapshot?.sign?.status === 200 &&
    lastSnapshot?.putStarted &&
    lastSnapshot?.finalize?.status === 202;
  const passB =
    lastSnapshot?.sign?.status === 200 && lastSnapshot?.putStarted;

  return {
    caseId,
    label: fx.label,
    fileName: fx.fileName,
    bytes: fs.statSync(fx.path).size,
    pass: caseId === 'A' ? passA || lastSnapshot?.successLog : passB,
    snapshot: lastSnapshot,
    vaultItemCount: vaultItems,
    diagnosticLogs: logs.slice(-40),
    errors: consoleLogs.slice(logBefore).filter((l) => /error|failed|ERR_/i.test(l)).slice(-20)
  };
}

async function healthChecks() {
  const health = await fetch(`${FRONTEND_URL}api/health`).then(async (r) => ({
    url: `${FRONTEND_URL}api/health`,
    status: r.status,
    body: await r.text().catch(() => '')
  }));
  const reels = await fetch(`${FRONTEND_URL}api/reels?limit=1`).then(async (r) => ({
    url: `${FRONTEND_URL}api/reels`,
    status: r.status,
    ok: r.ok
  }));
  return { health, reels };
}

async function main() {
  const cases = (process.env.CASES || 'A,B').split(',').map((s) => s.trim());
  const health = await healthChecks();

  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const network = [];
  const consoleLogs = [];

  page.on('requestfinished', async (req) => {
    const url = req.url();
    if (!/\/api\/|r2\.cloudflarestorage\.com/.test(url)) return;
    network.push({
      method: req.method(),
      url,
      status: req.response()?.status() || null
    });
  });
  page.on('console', (msg) => {
    const t = msg.text();
    consoleLogs.push(t);
  });

  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await loginStudio(page);

  const bundleMarker = await page.evaluate(async () => {
    const scripts = [...document.querySelectorAll('script[src*="/assets/index-"]')].map((s) => s.src);
    const src = scripts[0];
    if (!src) return { has6e6: false, hasBg7xR2Put: false, src: null };
    const res = await fetch(src);
    const text = await res.text();
    return {
      src,
      has6e6: text.includes('6e6'),
      hasBg7xR2Put: text.includes('BG7X_R2_PUT')
    };
  });

  const results = [];
  for (const caseId of cases) {
    if (!FIXTURES[caseId]) continue;
    console.log(`[BG7X_ACCEPTANCE] case ${caseId} ${FIXTURES[caseId].label}`);
    results.push(await observeCase(page, caseId, network, consoleLogs));
  }

  await browser.close();

  const report = {
    mission: 'BG7X-ACCEPTANCE-01',
    timestamp: new Date().toISOString(),
    frontendUrl: FRONTEND_URL,
    postDeployHealth: health,
    productionBundle: bundleMarker,
    results,
    summary: {
      caseA: results.find((r) => r.caseId === 'A')?.pass ?? null,
      caseB: results.find((r) => r.caseId === 'B')?.pass ?? null
    }
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  console.log(`Wrote ${OUT_JSON}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
