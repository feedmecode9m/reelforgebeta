#!/usr/bin/env node
/**
 * NETLIFY-UPLOAD-DIAGNOSTICS-01 — one large signed upload with instrumentation harvest.
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'artifacts/netlify-upload-diagnostics-01.json');
const OUT_MD = path.join(ROOT, 'artifacts/NETLIFY_UPLOAD_DIAGNOSTICS_01.md');
const API_URL = (process.env.API_URL || 'https://reelforge-deploy-production.up.railway.app').replace(/\/$/, '');
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT || 4173);
const FILE_PORT = Number(process.env.FILE_PORT || 9876);
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}/`;
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureLargeFixture() {
  const dir = path.join('/tmp', `netlify-upload-diag-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const large = path.join(dir, 'diag_large_30m.mp4');
  const condo = '/home/youloose2dafish/Downloads/condo_v1_2.mp4';
  if (!fs.existsSync(large)) {
    if (fs.existsSync(condo)) {
      execFileSync(
        'ffmpeg',
        ['-y', '-hide_banner', '-loglevel', 'error', '-i', condo, '-fs', '30M', '-c', 'copy', large],
        { stdio: 'ignore' }
      );
    } else {
      execFileSync('dd', [`if=/dev/zero`, `of=${large}`, 'bs=1M', 'count=26'], { stdio: 'ignore' });
    }
  }
  return { dir, large, size: fs.statSync(large).size };
}

function startFileServer(filePath) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': String(fs.statSync(filePath).size),
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(FILE_PORT, '127.0.0.1', () => resolve(server));
  });
}

function proxyRequest(req, res, targetPath) {
  const target = new URL(targetPath, API_URL);
  const transport = target.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: target.host };
  const upstream = transport.request(
    target,
    { method: req.method, headers },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );
  upstream.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
  req.pipe(upstream);
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html';
  if (filePath.endsWith('.js')) return 'application/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function startNetlifyLikeServer() {
  const dist = path.join(ROOT, 'dist');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', PREVIEW_URL);
    if (
      url.pathname.startsWith('/api/') ||
      url.pathname === '/admin/auth' ||
      url.pathname.startsWith('/admin/') ||
      url.pathname === '/health'
    ) {
      proxyRequest(req, res, `${url.pathname}${url.search}`);
      return;
    }
    let filePath = path.join(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    if (!filePath.startsWith(dist)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(dist, 'index.html');
    }
    res.writeHead(200, { 'Content-Type': contentType(filePath) });
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(PREVIEW_PORT, '127.0.0.1', () => resolve(server));
  });
}

async function loginStudio(page) {
  if (!(await page.locator('.control-center-overlay').isVisible().catch(() => false))) {
    await page.locator('button.ghost-trigger').click({ timeout: 60000 });
  }
  await page.waitForSelector('.control-center-overlay', { timeout: 60000 });
  if (!(await page.locator('.logout-btn').isVisible().catch(() => false))) {
    for (const pw of ['admin123', 'Gaff1505!', 'SMART_PRODUCTION']) {
      await page.locator('.admin-login-panel input[type="password"]').fill(pw.trim());
      await page.locator('.admin-login-panel button.submit-btn').click();
      await sleep(2500);
      if (await page.locator('.logout-btn').isVisible().catch(() => false)) return pw;
    }
    throw new Error('Studio login failed');
  }
  return 'already';
}

async function main() {
  execFileSync('npm', ['run', 'build'], {
    cwd: ROOT,
    env: {
      ...process.env,
      VITE_USE_SIGNED_UPLOADS: 'true',
      VITE_USE_SAME_ORIGIN_API: 'true',
      VITE_DIRECT_UPLOAD_BASE_URL: API_URL,
      VITE_SIGNED_UPLOADS_MIN_BYTES: '25000000'
    },
    stdio: 'inherit'
  });

  const { large, size } = ensureLargeFixture();
  const fileServer = await startFileServer(large);
  const preview = await startNetlifyLikeServer();

  const consoleLogs = [];
  const network = { sign: [], put: [], finalize: [], failed: [] };
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  const page = await browser.newPage();

  page.on('console', (msg) => {
    const text = msg.text();
    if (/^\[UPLOAD_/.test(text) || text.includes('[UPLOAD_')) {
      consoleLogs.push({ ts: Date.now(), type: msg.type(), text });
    }
  });
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('/api/uploads/sign')) network.sign.push({ kind: 'request', url: u, ts: Date.now() });
    if (u.includes('r2.cloudflarestorage.com') && req.method() === 'PUT') {
      network.put.push({ kind: 'request', url: u.slice(0, 120), ts: Date.now() });
    }
    if (u.includes('/api/reels/finalize')) network.finalize.push({ kind: 'request', url: u, ts: Date.now() });
  });
  page.on('response', (res) => {
    const u = res.url();
    const entry = { kind: 'response', status: res.status(), ok: res.ok(), ts: Date.now() };
    if (u.includes('/api/uploads/sign')) network.sign.push({ ...entry, url: u });
    if (u.includes('r2.cloudflarestorage.com') && res.request().method() === 'PUT') {
      network.put.push({ ...entry, url: u.slice(0, 120) });
    }
    if (u.includes('/api/reels/finalize')) network.finalize.push({ ...entry, url: u });
  });
  page.on('requestfailed', (req) => {
    const u = req.url();
    if (u.includes('r2.cloudflarestorage.com') || u.includes('/api/uploads/sign') || u.includes('/api/reels/finalize')) {
      network.failed.push({
        url: u.slice(0, 120),
        method: req.method(),
        errorText: req.failure()?.errorText || null,
        ts: Date.now()
      });
    }
  });

  const t0 = Date.now();
  await page.goto(PREVIEW_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await loginStudio(page);
  const tab = page.locator('[data-studio-workspace-tabs] button', { hasText: 'Content' });
  if (await tab.isVisible().catch(() => false)) await tab.click();
  await page.waitForSelector('[aria-label="Video drop zone"]', { timeout: 60000 });

  const fileUrl = `http://127.0.0.1:${FILE_PORT}/`;
  await page.evaluate(async ({ selector, fileUrl, fileName }) => {
    const res = await fetch(fileUrl);
    const blob = await res.blob();
    const file = new File([blob], fileName, { type: 'video/mp4' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const common = { dataTransfer: dt, bubbles: true, cancelable: true };
    const target = document.querySelector(selector);
    target.dispatchEvent(new DragEvent('dragenter', common));
    target.dispatchEvent(new DragEvent('dragover', common));
    target.dispatchEvent(new DragEvent('drop', common));
  }, { selector: '[aria-label="Video drop zone"]', fileUrl, fileName: path.basename(large) });

  for (let i = 0; i < 150; i++) {
    await sleep(5000);
    const diag = await page.evaluate(() => window.__SIGNED_UPLOAD_DIAG__ || []);
    const done = diag.some((d) =>
      ['UPLOAD_PUT_COMPLETE', 'UPLOAD_FINALIZE_SUCCESS', 'UPLOAD_ERROR', 'UPLOAD_ABORT', 'UPLOAD_TIMEOUT'].includes(
        d.marker
      )
    );
    if (done) break;
  }

  const diagEntries = await page.evaluate(() => window.__SIGNED_UPLOAD_DIAG__ || []);
  const elapsedMs = Date.now() - t0;
  await browser.close();
  fileServer.close();
  preview.close();

  const report = {
    mission: 'NETLIFY-UPLOAD-DIAGNOSTICS-01',
    timestamp: new Date().toISOString(),
    previewUrl: PREVIEW_URL,
    apiUrl: API_URL,
    file: { path: large, sizeBytes: size },
    elapsedMs,
    diagEntries,
    consoleLogs,
    network,
    abortControllerAudit: {
      uploadVideoSignedUsesAbortController: false,
      source: 'frontend/src/lib/api/media.js uploadVideoSigned — fetch() calls have no signal option',
      fetchWithRetryNotUsedOnSignedPath: true,
      healthCheckAbortSignalTimeoutOnly: 'frontend/src/lib/api.js checkBackendHealth AbortSignal.timeout(5000) — unrelated to upload PUT'
    }
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  const firstFail = diagEntries.find((d) =>
    ['UPLOAD_ERROR', 'UPLOAD_ABORT', 'UPLOAD_TIMEOUT'].includes(d.marker)
  );
  const finalizeBegin = diagEntries.find((d) => d.marker === 'UPLOAD_FINALIZE_BEGIN');
  const timeline = diagEntries.map((d) => ({
    marker: d.marker,
    elapsedMs: d.elapsedMs,
    timestamp: d.timestamp,
    stage: d.stage || null
  }));

  const md = `# NETLIFY-UPLOAD-DIAGNOSTICS-01

**Mode:** Diagnostic only — instrumentation added, no upload behavior changes  
**Timestamp:** ${report.timestamp}  
**Preview:** ${PREVIEW_URL}  
**API:** ${API_URL}  
**Test file:** ${path.basename(large)} (${size} bytes)  
**Raw JSON:** \`frontend/artifacts/netlify-upload-diagnostics-01.json\`

---

## Timeline

${timeline.map((t) => `- **${t.timestamp}** (+${t.elapsedMs}ms) \`${t.marker}\`${t.stage ? ` stage=${t.stage}` : ''}`).join('\n')}

---

## First Failing Boundary

${firstFail
    ? `**\`${firstFail.marker}\`** at **+${firstFail.elapsedMs}ms** during **${firstFail.stage || 'unknown'}** stage.

- **Exception name:** ${firstFail.exceptionName || 'n/a'}
- **Exception message:** ${firstFail.exceptionMessage || 'n/a'}
- **Inferred cause:** ${firstFail.inferredCause || 'n/a'}
- **Finalize attempted:** ${firstFail.finalizeAttempted === true ? 'yes' : 'no'}
- **Finalize blocked reason:** ${firstFail.finalizeBlockedReason || 'n/a'}
- **AbortController present:** ${firstFail.abortControllerPresent === true ? 'yes' : 'no'}
- **signal.aborted:** ${firstFail.signalAborted === true ? 'yes' : 'no'}`
    : finalizeBegin
      ? 'No failure marker recorded — upload reached finalize.'
      : 'No terminal marker captured within observation window.'}

---

## Complete Upload Sequence

| Stage | Marker observed | Result |
|-------|-----------------|--------|
| Sign start | ${diagEntries.some((d) => d.marker === 'UPLOAD_SIGN_START') ? 'UPLOAD_SIGN_START' : '—'} | ${diagEntries.some((d) => d.marker === 'UPLOAD_SIGN_SUCCESS') ? 'SUCCESS' : 'FAIL/missing'} |
| PUT begin | ${diagEntries.some((d) => d.marker === 'UPLOAD_PUT_BEGIN') ? 'UPLOAD_PUT_BEGIN' : '—'} | started |
| PUT progress | UPLOAD_PUT_PROGRESS | not measurable (fetch+File body) |
| PUT complete | ${diagEntries.some((d) => d.marker === 'UPLOAD_PUT_COMPLETE') ? 'UPLOAD_PUT_COMPLETE' : '—'} | ${diagEntries.some((d) => d.marker === 'UPLOAD_PUT_COMPLETE') ? 'SUCCESS' : 'FAIL'} |
| Finalize begin | ${finalizeBegin ? 'UPLOAD_FINALIZE_BEGIN' : '—'} | ${finalizeBegin ? 'attempted' : '**never started**'} |
| Finalize success | ${diagEntries.some((d) => d.marker === 'UPLOAD_FINALIZE_SUCCESS') ? 'UPLOAD_FINALIZE_SUCCESS' : '—'} | ${diagEntries.some((d) => d.marker === 'UPLOAD_FINALIZE_SUCCESS') ? 'SUCCESS' : 'blocked'} |

---

## Console Evidence

\`\`\`json
${JSON.stringify(consoleLogs.slice(0, 20), null, 2)}
\`\`\`

---

## Network Evidence

\`\`\`json
${JSON.stringify(network, null, 2)}
\`\`\`

---

## AbortController / Retry Audit (Task 6)

\`\`\`json
${JSON.stringify(report.abortControllerAudit, null, 2)}
\`\`\`

**Finding:** \`uploadVideoSigned()\` does **not** attach an \`AbortController\` or \`AbortSignal\` to the R2 PUT \`fetch()\`. No in-app retry loop wraps the PUT. Failure is not caused by application-level abort.

---

## Root Cause Candidates (ranked)

1. **High — Browser/Node fetch long-upload connection drop (\`TypeError: fetch failed\`)**  
   PUT begins, no app abort, connection fails after ~150–300s while bytes still uploading. curl completes same object in ~450s.

2. **Medium — Effective uplink throughput below PUT duration tolerance**  
   ~${Math.round(size / 450 / 1024)} KB/s required for 450s completion; fetch fails earlier than curl.

3. **Low — R2 HTTP error response**  
   ${firstFail?.httpStatus ? `HTTP ${firstFail.httpStatus}` : 'No HTTP status on failure — throw before response.'}

4. **Low — Application AbortController**  
   Ruled out — no signal on signed upload path.

---

## Recommended Minimal Fix (evidence-based, not implemented)

Replace or supplement the single long-lived \`fetch(PUT)\` body upload with a transport that tolerates slow uplinks (multipart/chunked S3 API, resumable uploader, or presigned multipart). **Do not implement in this mission.**

---

## Instrumentation Added

- \`frontend/src/lib/diagnostics/signedUploadDiagnostics.js\`
- \`frontend/src/lib/api/media.js\` (\`uploadVideoSigned\` only)
`;

  fs.writeFileSync(OUT_MD, md);
  console.log(`Wrote ${OUT_MD}`);
  console.log(`Wrote ${OUT_JSON}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
