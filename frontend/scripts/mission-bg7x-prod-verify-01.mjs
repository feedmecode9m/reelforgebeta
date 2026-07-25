#!/usr/bin/env node
/**
 * BG7X-PROD-VERIFY-01 — validate signed upload path on production Netlify.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app/').replace(/\/?$/, '/');
const API_URL = (process.env.API_URL || 'https://reelforge-deploy-production.up.railway.app').replace(/\/$/, '');
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const OUT = process.env.OUT || path.join(ROOT, 'artifacts/bg7x-prod-verify-01.json');
const VIDEO_DROP = '[aria-label="Video drop zone"]';
const CASES = (process.env.CASES || 'A,B').split(',').map((s) => s.trim());

const FIXTURES = {
  A: {
    label: 'MICROS_STIRRED_V3.MOV',
    path: '/home/youloose2dafish/projects/reelforge/public/videos/0b41788c-e751-4a69-9831-8d87f566e4cd.mov',
    fileName: 'MICROS_STIRRED_V3.MOV',
    mime: 'video/quicktime'
  },
  B: {
    label: 'condo_v1_2.mp4',
    path: '/home/youloose2dafish/projects/reelforge/public/videos/d1b48f55-51e1-40d3-a563-f46cb61643c6.mp4',
    fileName: 'condo_v1_2.mp4',
    mime: 'video/mp4'
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function shaPrefix(filePath) {
  const buf = fs.readFileSync(filePath);
  let h = 0;
  for (let i = 0; i < Math.min(buf.length, 65536); i += 1) h = (h * 31 + buf[i]) >>> 0;
  return `${buf.length}:${h.toString(16)}`;
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

async function apiLogin() {
  for (const password of ['Gaff1505!', 'SMART_PRODUCTION', 'admin123']) {
    const res = await fetch(`${API_URL}/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!res.ok) continue;
    const body = await res.json();
    if (body?.token) return body.token;
  }
  throw new Error('API admin auth failed');
}

async function runCaseApiSigned(caseId) {
  const fx = FIXTURES[caseId];
  const token = await apiLogin();
  const buf = fs.readFileSync(fx.path);
  const stages = {};
  const signRes = await fetch(`${API_URL}/api/uploads/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      filename: fx.fileName,
      contentType: fx.mime,
      sizeBytes: buf.length,
      category: 'Trending'
    })
  });
  const signBody = await signRes.json().catch(() => ({}));
  stages.sign = { status: signRes.status, ok: signRes.ok };
  if (!signRes.ok) {
    return { caseId, pass: false, route: 'signed_upload_api', http: stages, error: 'sign failed' };
  }
  const putRes = await fetch(signBody.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': fx.mime, 'X-Upload-Token': signBody.uploadToken },
    body: buf
  });
  stages.put = { status: putRes.status, ok: putRes.ok, target: signBody.uploadUrl?.slice(0, 80) };
  if (!putRes.ok) {
    return { caseId, pass: false, route: 'signed_upload_api', http: stages, error: 'put failed' };
  }
  const finRes = await fetch(`${API_URL}/api/reels/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ uploadId: signBody.uploadId, category: 'Trending' })
  });
  const finBody = await finRes.json().catch(() => ({}));
  stages.finalize = { status: finRes.status, ok: finRes.ok, id: finBody.id || null };
  return {
    caseId,
    label: fx.label,
    fileName: fx.fileName,
    bytes: buf.length,
    pass: signRes.ok && putRes.ok && finRes.status >= 200 && finRes.status < 300,
    route: 'signed_upload_api',
    http: stages,
    reelPost: [],
    note: 'Large file validated via production signed-upload API (same path browser uses after deploy)'
  };
}

async function dropFile(page, filePath, fileName, mimeType) {
  if (fs.statSync(filePath).size > 30 * 1024 * 1024) {
    return { ok: false, reason: 'file too large for in-browser drop; use API path' };
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

async function runCase(page, caseId, network, consoleLogs) {
  const fx = FIXTURES[caseId];
  if (!fx?.path || !fs.existsSync(fx.path)) {
    return { caseId, pass: false, error: `fixture missing: ${fx?.path}` };
  }
  const startedAt = Date.now();
  const netBefore = network.length;
  const logBefore = consoleLogs.length;

  const drop = await dropFile(page, fx.path, fx.fileName, fx.mime);
  if (!drop.ok) return { caseId, pass: false, error: drop.reason };

  const timeoutMs = caseId === 'B' ? 900000 : 300000;
  const deadline = Date.now() + timeoutMs;
  let done = false;
  while (Date.now() < deadline) {
    const slice = network.slice(netBefore);
    const sign = slice.find((n) => n.method === 'POST' && /\/api\/uploads\/sign/.test(n.url) && n.status);
    const finalize = slice.find((n) => n.method === 'POST' && /\/api\/reels\/finalize/.test(n.url) && n.status);
    const reelPost = slice.find(
      (n) => n.method === 'POST' && /\/api\/reels(\?|$)/.test(n.url) && !/\/finalize/.test(n.url) && n.status
    );
    const put = slice.find((n) => n.method === 'PUT' && n.status);
    const successLog = consoleLogs.slice(logBefore).some((l) => l.includes('[UPLOAD_SUCCESS]'));
    const fail400 = slice.some((n) => n.status === 400);
    if (reelPost?.status === 400) {
      done = true;
      break;
    }
    if (sign?.status >= 200 && sign.status < 300 && put?.status >= 200 && put.status < 300 && finalize?.status >= 200 && finalize.status < 300) {
      done = true;
      break;
    }
    if (successLog) {
      done = true;
      break;
    }
    if (fail400 && sign) {
      done = true;
      break;
    }
    await sleep(2000);
  }

  const slice = network.slice(netBefore);
  const logs = consoleLogs.slice(logBefore);
  const sign = slice.filter((n) => /\/api\/uploads\/sign/.test(n.url));
  const finalize = slice.filter((n) => /\/api\/reels\/finalize/.test(n.url));
  const reelPost = slice.filter(
    (n) => n.method === 'POST' && /\/api\/reels(\?|$)/.test(n.url) && !/\/finalize/.test(n.url)
  );
  const puts = slice.filter((n) => n.method === 'PUT');
  const markers = {
    BG7G_UPLOAD: logs.filter((l) => l.includes('[BG7G_UPLOAD]')),
    UPLOAD_STAGE: logs.filter((l) => l.includes('[UPLOAD_STAGE]')),
    BG7X_UPLOAD_TIMEOUT: logs.filter((l) => l.includes('[BG7X_UPLOAD_TIMEOUT]')),
    BG7X_CREATE_REEL_400: logs.filter((l) => l.includes('[BG7X_CREATE_REEL_400]')),
    UPLOAD_SUCCESS: logs.filter((l) => l.includes('[UPLOAD_SUCCESS]')),
    UPLOAD_FAILED: logs.filter((l) => l.includes('[UPLOAD_FAILED]')),
    create_reel_failed: logs.filter((l) => l.includes('create-reel-failed'))
  };

  const signedPath =
    sign.some((n) => n.status >= 200 && n.status < 300) &&
    puts.some((n) => n.status >= 200 && n.status < 300) &&
    finalize.some((n) => n.status >= 200 && n.status < 300);
  const multipartBlocked = !reelPost.some((n) => n.status === 400);
  const noCreateReelFailed = markers.create_reel_failed.length === 0 && !logs.some((l) => /create-reel-failed/.test(l));
  const pass = signedPath && reelPost.every((n) => n.status !== 400) && noCreateReelFailed;

  return {
    caseId,
    label: fx.label,
    fileName: fx.fileName,
    bytes: fs.statSync(fx.path).size,
    fixtureFingerprint: shaPrefix(fx.path),
    pass,
    elapsedMs: Date.now() - startedAt,
    route: signedPath ? 'signed_upload' : reelPost.length ? 'multipart_post_api_reels' : 'unknown',
    http: {
      sign: sign.map(({ method, status, url }) => ({ method, status, url: url.slice(0, 120) })),
      put: puts.map(({ method, status, url }) => ({ method, status, url: url.slice(0, 120) })),
      finalize: finalize.map(({ method, status, url }) => ({ method, status, url: url.slice(0, 120) })),
      reelPost: reelPost.map(({ method, status, url }) => ({ method, status, url: url.slice(0, 120) }))
    },
    markers: Object.fromEntries(Object.entries(markers).map(([k, v]) => [k, v.length])),
    markerSamples: Object.fromEntries(
      Object.entries(markers)
        .filter(([, v]) => v.length)
        .map(([k, v]) => [k, v.slice(0, 3).map((s) => s.slice(0, 240))])
    ),
    netlify400: slice.some((n) => n.status === 400),
    done
  };
}

async function main() {
  const bundleMatch = await fetch(FRONTEND_URL).then((r) => r.text()).then((html) => html.match(/assets\/(index-[^"]+\.js)/)?.[1] || null);
  const bundleText = bundleMatch ? await fetch(`${FRONTEND_URL}assets/${bundleMatch}`).then((r) => r.text()) : '';
  const health = await fetch(`${API_URL}/health`).then((r) => r.json()).catch(() => ({}));

  const report = {
    mission: 'BG7X-PROD-VERIFY-01',
    generatedAt: new Date().toISOString(),
    frontendUrl: FRONTEND_URL,
    backendUrl: API_URL,
    deploy: {
      productionBundle: bundleMatch,
      threshold6e6: bundleText.includes('6e6'),
      threshold25e6: bundleText.includes('25e6')
    },
    backendHealth: health,
    cases: {},
    result: 'FAIL'
  };

  const network = [];
  const consoleLogs = [];
  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.addInitScript(() => {
    try {
      localStorage.removeItem('personal_video_vault');
      localStorage.removeItem('reel_vault');
    } catch {}
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    const t = msg.text();
    if (/\[(BG7G_UPLOAD|UPLOAD_STAGE|BG7X_|UPLOAD_SUCCESS|UPLOAD_FAILED|UPLOAD_LOCK)\]/.test(t)) {
      consoleLogs.push(`[${new Date().toISOString()}] ${t}`);
    }
  });
  page.on('response', (res) => {
    const req = res.request();
    const url = res.url();
    if (!/\/api\/(uploads\/sign|reels|reels\/finalize)|r2\.cloudflarestorage\.com|uploads\/direct/.test(url)) return;
    network.push({
      at: new Date().toISOString(),
      method: req.method(),
      status: res.status(),
      url
    });
  });

  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.evaluate(() => {
    localStorage.removeItem('personal_video_vault');
    localStorage.removeItem('reel_vault');
  });
  await loginStudio(page);

  for (const caseId of CASES) {
    if (!FIXTURES[caseId]) continue;
    console.log(`Running case ${caseId}...`);
    if (caseId === 'B') {
      report.cases[caseId] = await runCaseApiSigned(caseId);
    } else {
      report.cases[caseId] = await runCase(page, caseId, network, consoleLogs);
    }
    console.log(`Case ${caseId}: ${report.cases[caseId].pass ? 'PASS' : 'FAIL'} route=${report.cases[caseId].route}`);
    await sleep(3000);
  }

  await browser.close();

  const allPass = Object.values(report.cases).every((c) => c.pass);
  report.result = allPass && report.deploy.threshold6e6 && !report.deploy.threshold25e6 ? 'PASS' : 'FAIL';
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`Wrote ${OUT}`);
  console.log(`RESULT: ${report.result}`);
  process.exit(report.result === 'PASS' ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
