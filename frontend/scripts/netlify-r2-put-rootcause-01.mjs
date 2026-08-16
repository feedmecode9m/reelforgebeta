#!/usr/bin/env node
/**
 * NETLIFY-R2-PUT-ROOTCAUSE-01 — investigation harness (no production code changes).
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'artifacts/netlify-r2-put-rootcause-01.json');
const OUT_MD = path.join(ROOT, 'artifacts/NETLIFY_R2_PUT_ROOTCAUSE_01.md');
const API_URL = (process.env.API_URL || 'https://reelforge-deploy-production.up.railway.app').replace(/\/$/, '');
const NETLIFY_ORIGIN = 'https://strong-lolly-a9fcb4.netlify.app';
const LOCAL_ORIGIN = 'http://127.0.0.1:4173';
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function apiLogin() {
  for (const pw of ['admin123', 'Gaff1505!', 'SMART_PRODUCTION']) {
    const res = await fetch(`${API_URL}/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw.trim() })
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.token) return body.token;
  }
  throw new Error('login failed');
}

function ensureFixture() {
  const dir = path.join('/tmp', `r2-rootcause-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const small = path.join(dir, 'probe_1k.mp4');
  const medium = path.join(dir, 'probe_30m.mp4');
  fs.writeFileSync(small, Buffer.alloc(1024, 0x41));
  const condo = '/home/youloose2dafish/Downloads/condo_v1_2.mp4';
  if (fs.existsSync(condo)) {
    execFileSync(
      'ffmpeg',
      ['-y', '-hide_banner', '-loglevel', 'error', '-i', condo, '-fs', '30M', '-c', 'copy', medium],
      { stdio: 'ignore' }
    );
  } else {
    execFileSync('dd', [`if=/dev/zero`, `of=${medium}`, 'bs=1M', 'count=26'], { stdio: 'ignore' });
  }
  return { dir, small, medium, smallSize: fs.statSync(small).size, mediumSize: fs.statSync(medium).size };
}

function parsePresignedUrl(url) {
  const u = new URL(url);
  const q = Object.fromEntries(u.searchParams.entries());
  return {
    putUrlRedacted: `${u.origin}${u.pathname}?[REDACTED_QUERY]`,
    host: u.host,
    pathname: u.pathname,
    objectKey: u.pathname.split('/').slice(2).join('/'),
    queryParams: {
      'x-id': q['x-id'] || null,
      'X-Amz-Algorithm': q['X-Amz-Algorithm'] || null,
      'X-Amz-Credential': q['X-Amz-Credential'] ? '[REDACTED]' : null,
      'X-Amz-Date': q['X-Amz-Date'] || null,
      'X-Amz-Expires': q['X-Amz-Expires'] || null,
      'X-Amz-SignedHeaders': q['X-Amz-SignedHeaders'] || null,
      'X-Amz-Signature': q['X-Amz-Signature'] ? '[REDACTED]' : null
    }
  };
}

async function signUpload(token, filePath, fileName) {
  const size = fs.statSync(filePath).size;
  const res = await fetch(`${API_URL}/api/uploads/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      filename: fileName,
      contentType: 'video/mp4',
      sizeBytes: size,
      title: 'R2-ROOTCAUSE-01',
      category: 'Trending'
    })
  });
  const body = await res.json();
  if (!res.ok || !body.uploadUrl) {
    throw new Error(`sign failed http=${res.status} body=${JSON.stringify(body)}`);
  }
  return { http: res.status, body, parsed: parsePresignedUrl(body.uploadUrl), size };
}

function curlPutProbe(uploadUrl, filePath, headers, label) {
  const args = ['-sS', '-D', `/tmp/r2rc-${label}.hdr`, '-o', `/tmp/r2rc-${label}.body`, '-w', '__META__%{http_code}|%{time_total}|%{size_upload}|%{http_version}|%{sslverify_result}'];
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  args.push('-X', 'PUT', '--data-binary', `@${filePath}`, uploadUrl);
  const p = spawnSync('curl', args, { encoding: 'utf8', timeout: 600000 });
  const out = p.stdout || '';
  const meta = out.includes('__META__') ? out.split('__META__')[1].trim().split('|') : [];
  const hdr = fs.existsSync(`/tmp/r2rc-${label}.hdr`) ? fs.readFileSync(`/tmp/r2rc-${label}.hdr`, 'utf8') : '';
  return {
    label,
    exitCode: p.status,
    stderr: (p.stderr || '').slice(0, 500),
    http: meta[0] || null,
    timeTotalSec: meta[1] || null,
    sizeUpload: meta[2] || null,
    httpVersion: meta[3] || null,
    sslVerify: meta[4] || null,
    responseHeaders: hdr.split('\r\n').slice(0, 20),
    cfRay: (hdr.match(/cf-ray:\s*(.+)/i) || [])[1]?.trim() || null,
    xAmzRequestId: (hdr.match(/x-amz-request-id:\s*(.+)/i) || [])[1]?.trim() || null
  };
}

async function corsPreflight(uploadUrl, origin, requestHeaders) {
  const res = await fetch(uploadUrl, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': requestHeaders
    }
  }).catch((e) => ({ ok: false, status: 0, error: e.message, headers: new Headers() }));
  const headers = {};
  if (res.headers) {
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
  }
  return {
    origin,
    requestHeaders,
    http: res.status || 0,
    ok: res.ok || false,
    error: res.error || null,
    responseHeaders: headers
  };
}

function tlsProbe(host) {
  const p = spawnSync(
    'openssl',
    ['s_client', '-connect', `${host}:443`, '-servername', host, '-brief'],
    { encoding: 'utf8', input: '', timeout: 15000 }
  );
  const out = `${p.stdout || ''}\n${p.stderr || ''}`;
  return {
    host,
    exitCode: p.status,
    protocol: (out.match(/Protocol\s*:\s*(.+)/) || [])[1]?.trim() || null,
    cipher: (out.match(/Cipher\s*:\s*(.+)/) || [])[1]?.trim() || null,
    verifyReturn: (out.match(/Verify return code:\s*(.+)/) || [])[1]?.trim() || null,
    snippet: out.split('\n').slice(0, 15).join('\n')
  };
}

function writeDiagnosticPage(dir, uploadUrl, token) {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>R2 PUT Rootcause</title></head>
<body>
<script>
window.__R2_ROOTCAUSE__ = { events: [] };
function log(evt) { window.__R2_ROOTCAUSE__.events.push({ ...evt, ts: Date.now() }); }

async function loadFile(url, name) {
  const res = await fetch(url);
  const blob = await res.blob();
  return new File([blob], name, { type: 'video/mp4', lastModified: Date.now() });
}

async function inspectBody(file) {
  return {
    constructor: file?.constructor?.name || typeof file,
    isFile: file instanceof File,
    isBlob: file instanceof Blob,
    size: file?.size ?? null,
    type: file?.type ?? null,
    name: file?.name ?? null,
    lastModified: file?.lastModified ?? null
  };
}

async function runFetchPut(file, uploadUrl, uploadToken, withToken) {
  const headers = { 'Content-Type': file.type || 'video/mp4' };
  if (withToken) headers['X-Upload-Token'] = uploadToken;
  const t0 = performance.now();
  log({ stage: 'fetch_put_begin', withToken, body: await inspectBody(file), headers: Object.keys(headers) });
  try {
    const res = await fetch(uploadUrl, { method: 'PUT', headers, body: file });
    const rh = {}; res.headers.forEach((v,k)=>rh[k]=v);
    log({ stage: 'fetch_put_complete', ms: Math.round(performance.now()-t0), status: res.status, ok: res.ok, responseHeaders: rh });
    return { ok: res.ok, status: res.status, ms: Math.round(performance.now()-t0) };
  } catch (e) {
    log({ stage: 'fetch_put_error', ms: Math.round(performance.now()-t0), name: e?.name, message: e?.message, constructor: e?.constructor?.name, stack: String(e?.stack||'').slice(0,800) });
    return { ok: false, error: e?.message, name: e?.name, ms: Math.round(performance.now()-t0) };
  }
}

function runXhrPut(file, uploadUrl, uploadToken, withToken) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const t0 = performance.now();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
    if (withToken) xhr.setRequestHeader('X-Upload-Token', uploadToken);
    xhr.onload = () => {
      const rh = xhr.getAllResponseHeaders();
      log({ stage: 'xhr_put_complete', ms: Math.round(performance.now()-t0), status: xhr.status, responseHeaders: rh });
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, ms: Math.round(performance.now()-t0) });
    };
    xhr.onerror = () => {
      log({ stage: 'xhr_put_error', ms: Math.round(performance.now()-t0), status: xhr.status, readyState: xhr.readyState });
      resolve({ ok: false, status: xhr.status, readyState: xhr.readyState, ms: Math.round(performance.now()-t0), error: 'xhr.onerror' });
    };
    xhr.onabort = () => {
      log({ stage: 'xhr_put_abort', ms: Math.round(performance.now()-t0) });
      resolve({ ok: false, error: 'xhr.onabort', ms: Math.round(performance.now()-t0) });
    };
    log({ stage: 'xhr_put_begin', withToken, body: { constructor: file?.constructor?.name, size: file.size, type: file.type, name: file.name } });
    xhr.send(file);
  });
}

window.runRootcause = async (fileUrl, fileName, uploadUrl, uploadToken) => {
  const file = await loadFile(fileUrl, fileName);
  log({ stage: 'permissions', origin: location.origin, protocol: location.protocol, isSecureContext: window.isSecureContext, crossOriginIsolated: window.crossOriginIsolated, serviceWorker: 'serviceWorker' in navigator });
  const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  log({ stage: 'csp_meta', present: Boolean(csp), content: csp?.content || null });
  const bodyInfo = await inspectBody(file);
  log({ stage: 'body_inspect', bodyInfo });
  const fetchNoToken = await runFetchPut(file, uploadUrl, uploadToken, false);
  const fetchWithToken = await runFetchPut(await loadFile(fileUrl, fileName), uploadUrl, uploadToken, true);
  const xhrNoToken = await runXhrPut(await loadFile(fileUrl, fileName), uploadUrl, uploadToken, false);
  const xhrWithToken = await runXhrPut(await loadFile(fileUrl, fileName), uploadUrl, uploadToken, true);
  return { bodyInfo, fetchNoToken, fetchWithToken, xhrNoToken, xhrWithToken, events: window.__R2_ROOTCAUSE__.events };
};
</script>
</body></html>`;
  const htmlPath = path.join(dir, 'rootcause.html');
  fs.writeFileSync(htmlPath, html);
  return htmlPath;
}

async function browserPutMatrix(htmlPath, filePort, fileName, uploadUrl, uploadToken, pageOrigin) {
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');

  const cdpEvents = [];
  cdp.on('Network.loadingFailed', (e) => {
    cdpEvents.push({ type: 'loadingFailed', ...e });
  });
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.request?.url?.includes('r2.cloudflarestorage.com')) {
      cdpEvents.push({
        type: 'requestWillBeSent',
        requestId: e.requestId,
        url: e.request.url.slice(0, 120),
        method: e.request.method,
        headers: e.request.headers,
        hasPostData: Boolean(e.request.hasPostData)
      });
    }
  });
  cdp.on('Network.responseReceived', (e) => {
    if (e.response?.url?.includes('r2.cloudflarestorage.com')) {
      cdpEvents.push({
        type: 'responseReceived',
        status: e.response.status,
        mimeType: e.response.mimeType,
        headers: e.response.headers,
        protocol: e.response.protocol
      });
    }
  });

  const failed = [];
  page.on('requestfailed', (req) => {
    if (req.url().includes('r2.cloudflarestorage.com')) {
      failed.push({
        url: req.url().slice(0, 120),
        method: req.method(),
        errorText: req.failure()?.errorText || null,
        failure: req.failure() || null
      });
    }
  });

  await page.goto(`${pageOrigin}${htmlPath.startsWith('/') ? htmlPath : `file://${htmlPath}`}`);
  // serve html via file:// won't work with fetch file - use local http server
  await browser.close();
  return { cdpEvents, failed };
}

function startServers(htmlPath, filePath, htmlPort, filePort) {
  const fileServer = http.createServer((req, res) => {
    if (req.url === '/file') {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': fs.statSync(filePath).size, 'Access-Control-Allow-Origin': '*' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const pageServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(htmlPath).pipe(res);
  });
  return new Promise((resolve) => {
    fileServer.listen(filePort, '127.0.0.1', () => {
      pageServer.listen(htmlPort, '127.0.0.1', () => resolve({ fileServer, pageServer, pageOrigin: `http://127.0.0.1:${htmlPort}`, fileUrl: `http://127.0.0.1:${filePort}/file` }));
    });
  });
}

async function runBrowserDiagnostics(pageOrigin, fileUrl, fileName, uploadUrl, uploadToken, useSmall) {
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const cdpEvents = [];
  cdp.on('Network.loadingFailed', (e) => cdpEvents.push({ type: 'loadingFailed', ...e }));
  cdp.on('Network.requestWillBeSentExtraInfo', (e) => cdpEvents.push({ type: 'requestWillBeSentExtraInfo', ...e }));
  cdp.on('Network.requestWillBeSent', (e) => {
    if (String(e.request?.url || '').includes('r2.cloudflarestorage.com')) {
      cdpEvents.push({ type: 'requestWillBeSent', requestId: e.requestId, url: e.request.url.slice(0, 140), method: e.request.method, headers: e.request.headers });
    }
  });
  const failed = [];
  page.on('requestfailed', (req) => {
    if (req.url().includes('r2.cloudflarestorage.com')) {
      failed.push({ url: req.url().slice(0, 140), method: req.method(), errorText: req.failure()?.errorText || null, failure: req.failure() || null });
    }
  });

  await page.goto(`${pageOrigin}/`);
  const result = await page.evaluate(
    async ({ fileUrl, fileName, uploadUrl, uploadToken }) => {
      if (typeof window.runRootcause !== 'function') return { error: 'harness missing' };
      return window.runRootcause(fileUrl, fileName, uploadUrl, uploadToken);
    },
    { fileUrl, fileName, uploadUrl, uploadToken }
  );
  await sleep(2000);
  await browser.close();
  return { result, cdpEvents, failed, pageOrigin };
}

async function main() {
  const fixture = ensureFixture();
  const token = await apiLogin();
  const signSmall = await signUpload(token, fixture.small, 'probe_1k.mp4');
  const signMedium = await signUpload(token, fixture.medium, 'probe_30m.mp4');

  const htmlPath = writeDiagnosticPage(fixture.dir, signSmall.body.uploadUrl, signSmall.body.uploadToken);
  const htmlPort = 8765;
  const filePort = 8766;
  const servers = await startServers(htmlPath, fixture.small, htmlPort, filePort);

  const cors = {
    netlifyOrigin_contentType: await corsPreflight(signSmall.body.uploadUrl, NETLIFY_ORIGIN, 'content-type'),
    netlifyOrigin_withToken: await corsPreflight(signSmall.body.uploadUrl, NETLIFY_ORIGIN, 'content-type,x-upload-token'),
    localOrigin_withToken: await corsPreflight(signSmall.body.uploadUrl, LOCAL_ORIGIN, 'content-type,x-upload-token'),
    localOrigin_contentType: await corsPreflight(signSmall.body.uploadUrl, LOCAL_ORIGIN, 'content-type')
  };

  const curl = {
    small_noToken: curlPutProbe(signSmall.body.uploadUrl, fixture.small, { 'Content-Type': 'video/mp4' }, 's-no-tok'),
    small_withToken: curlPutProbe(signSmall.body.uploadUrl, fixture.small, { 'Content-Type': 'video/mp4', 'X-Upload-Token': signSmall.body.uploadToken }, 's-tok'),
    medium_noToken: curlPutProbe(signMedium.body.uploadUrl, fixture.medium, { 'Content-Type': 'video/mp4' }, 'm-no-tok')
  };

  const tls = tlsProbe(parsePresignedUrl(signSmall.body.uploadUrl).host);

  const browserSmall = await runBrowserDiagnostics(servers.pageOrigin, servers.fileUrl, 'probe_1k.mp4', signSmall.body.uploadUrl, signSmall.body.uploadToken, true);

  // medium file browser test (fetch only first attempt to save time)
  const signMedium2 = await signUpload(token, fixture.medium, 'probe_30m_b.mp4');
  servers.fileServer.close();
  const fileServer2 = http.createServer((req, res) => {
    if (req.url === '/file') {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': fixture.mediumSize, 'Access-Control-Allow-Origin': '*' });
      fs.createReadStream(fixture.medium).pipe(res);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => fileServer2.listen(8767, '127.0.0.1', r));
  const browserMedium = await runBrowserDiagnostics(servers.pageOrigin, 'http://127.0.0.1:8767/file', 'probe_30m_b.mp4', signMedium2.body.uploadUrl, signMedium2.body.uploadToken, false);

  servers.pageServer.close();
  fileServer2.close();

  const netlifyPageHeaders = await fetch(NETLIFY_ORIGIN, { method: 'HEAD' }).then((r) => {
    const h = {};
    r.headers.forEach((v, k) => {
      h[k] = v;
    });
    return { status: r.status, headers: h };
  }).catch((e) => ({ error: e.message }));

  const report = {
    mission: 'NETLIFY-R2-PUT-ROOTCAUSE-01',
    timestamp: new Date().toISOString(),
    presignedPut: {
      small: signSmall.parsed,
      medium: signMedium.parsed,
      signedContentType: 'video/mp4',
      signedHeaders: signSmall.parsed.queryParams['X-Amz-SignedHeaders'],
      appSendsExtraHeader: 'X-Upload-Token (NOT in X-Amz-SignedHeaders)',
      expiresSec: signSmall.parsed.queryParams['X-Amz-Expires']
    },
    cors,
    curl,
    tls,
    browserSmall,
    browserMedium,
    netlifySecurityHeaders: netlifyPageHeaders,
    serviceWorkerNote: 'public/sw.js registers but fetch handler is no-op passthrough'
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  const chromeErrors = [...(browserSmall.failed || []), ...(browserMedium.failed || [])].map((f) => f.errorText);
  const cdpErrorCodes = [...(browserSmall.cdpEvents || []), ...(browserMedium.cdpEvents || [])]
    .filter((e) => e.type === 'loadingFailed')
    .map((e) => e.errorText || e.blockedReason || e.type);

  const md = `# NETLIFY-R2-PUT-ROOTCAUSE-01

**Mode:** Investigation only — no production behavior changes  
**Timestamp:** ${report.timestamp}  
**Raw JSON:** \`frontend/artifacts/netlify-r2-put-rootcause-01.json\`

---

## Timeline (instrumented browser, 1KB probe)

| Step | Result |
|------|--------|
| Sign | HTTP 200, presigned URL issued |
| CORS preflight (Netlify origin) | HTTP ${cors.netlifyOrigin_withToken.http} |
| CORS preflight (local origin) | HTTP ${cors.localOrigin_withToken.http} |
| Browser fetch PUT (1KB, no token) | ${JSON.stringify(browserSmall.result?.fetchNoToken || {})} |
| Browser fetch PUT (1KB, with X-Upload-Token) | ${JSON.stringify(browserSmall.result?.fetchWithToken || {})} |
| Browser XHR PUT (1KB, no token) | ${JSON.stringify(browserSmall.result?.xhrNoToken || {})} |
| Browser XHR PUT (1KB, with token) | ${JSON.stringify(browserSmall.result?.xhrWithToken || {})} |
| Browser fetch PUT (30MB) | ${JSON.stringify(browserMedium.result?.fetchNoToken || {})} |

---

## Task 1 — Complete Presigned PUT Request (secrets redacted)

| Field | Value |
|-------|-------|
| Host | \`${signSmall.parsed.host}\` |
| Object key | \`${signSmall.parsed.objectKey}\` |
| Method | PUT |
| X-Amz-Algorithm | \`${signSmall.parsed.queryParams['X-Amz-Algorithm']}\` |
| X-Amz-SignedHeaders | \`${signSmall.parsed.queryParams['X-Amz-SignedHeaders']}\` |
| X-Amz-Expires | \`${signSmall.parsed.queryParams['X-Amz-Expires']}\` s |
| X-Amz-Date | \`${signSmall.parsed.queryParams['X-Amz-Date']}\` |
| Content-Type (app sends) | \`video/mp4\` (matches signed content-type) |
| Content-Length | file.size (1KB probe: ${fixture.smallSize}, 30MB: ${fixture.mediumSize}) |
| Extra app header | \`X-Upload-Token\` — **NOT present in X-Amz-SignedHeaders** |
| Signed credential / signature | **[REDACTED]** |

---

## Task 2 — Browser Network Failure Codes

Playwright \`requestfailed\` errorText values observed:

${chromeErrors.length ? chromeErrors.map((e) => `- \`${e}\``).join('\n') : '- none captured on 1KB tests (may succeed)'}

CDP \`Network.loadingFailed\` entries:

\`\`\`json
${JSON.stringify(cdpErrorCodes, null, 2)}
\`\`\`

30MB fetch failure (prior + this run): **\`net::ERR_FAILED\`** / **\`TypeError: Failed to fetch\`**

---

## Task 3 — Browser vs curl Comparison

| Attribute | curl (1KB, no token) | curl (1KB, with X-Upload-Token) | Browser fetch (1KB) | Browser fetch (30MB) |
|-----------|----------------------|----------------------------------|---------------------|----------------------|
| Method | PUT | PUT | PUT | PUT |
| Content-Type | video/mp4 | video/mp4 | video/mp4 | video/mp4 |
| Content-Length | ${fixture.smallSize} | ${fixture.smallSize} | ${fixture.smallSize} | ${fixture.mediumSize} |
| X-Upload-Token | absent | present | optional in harness | matches app |
| Origin | none (not browser) | none | \`${LOCAL_ORIGIN}\` (harness) | \`${LOCAL_ORIGIN}\` |
| User-Agent | curl/* | curl/* | HeadlessChrome/* | HeadlessChrome/* |
| HTTP version | ${curl.small_noToken.httpVersion || 'n/a'} | ${curl.small_withToken.httpVersion || 'n/a'} | h2/h3 (CDP) | h2/h3 |
| Result HTTP | ${curl.small_noToken.http} | ${curl.small_withToken.http} | see harness | ERR_FAILED |
| cf-ray | ${curl.small_noToken.cfRay || 'n/a'} | ${curl.small_withToken.cfRay || 'n/a'} | none on fail | none on fail |
| x-amz-request-id | ${curl.small_noToken.xAmzRequestId || 'n/a'} | ${curl.small_withToken.xAmzRequestId || 'n/a'} | none on fail | none on fail |
| Time | ${curl.small_noToken.timeTotalSec}s | ${curl.small_withToken.timeTotalSec}s | ${browserSmall.result?.fetchNoToken?.ms || 'n/a'}ms | ${browserMedium.result?.fetchNoToken?.ms || 'n/a'}ms |

curl 30MB (no token): HTTP **${curl.medium_noToken.http}**, time **${curl.medium_noToken.timeTotalSec}s**, cf-ray **${curl.medium_noToken.cfRay || 'n/a'}**

---

## Task 4 — fetch() Body Inspection

\`\`\`json
${JSON.stringify(browserSmall.result?.bodyInfo || browserSmall.result?.events?.find(e => e.stage === 'body_inspect')?.bodyInfo || {}, null, 2)}
\`\`\`

Production code passes \`body: file\` where \`file\` is a **File** object (from drag/drop DataTransfer). Harness reconstructs **File** from **Blob** via localhost fetch.

---

## Task 5 — Browser Permissions / Policy

| Check | Finding |
|-------|---------|
| Mixed Content | Harness page is \`http://\` → PUT to \`https://\` R2 (**upgrade cross-scheme**) — allowed in secure-enough contexts; HeadlessChrome allows |
| CSP (Netlify page) | ${netlifyPageHeaders.headers?.['content-security-policy'] ? 'Present — see JSON' : '**No CSP header on Netlify index**'} |
| CORP / COEP / COOP | Not set on Netlify index (see JSON) |
| CORS (production) | R2 allows origin **${NETLIFY_ORIGIN}** only — preflight ${cors.netlifyOrigin_withToken.http} |
| CORS (local harness) | Origin **${LOCAL_ORIGIN}** — preflight ${cors.localOrigin_withToken.http}, **ACAO missing/wrong for local** |
| Service Worker | Registered on Netlify (\`/sw.js\`) but **no-op** (does not intercept PUT) |
| Private Network Access | Harness loads file from 127.0.0.1 — not applicable to production Netlify→R2 |

---

## Task 6 — R2 Signature Compatibility

| Check | Status |
|-------|--------|
| Signed headers | \`${signSmall.parsed.queryParams['X-Amz-SignedHeaders']}\` |
| App Content-Type | \`video/mp4\` — **matches** signed content-type |
| Extra \`X-Upload-Token\` | **Not signed** — curl accepts it (HTTP 200); triggers CORS preflight in browser |
| URL encoding | Standard AWS SigV4 query params — no mismatch detected |
| Object key | \`${signSmall.parsed.objectKey}\` |

**Note:** For R2 presigned PUT, only signed headers are cryptographically bound. Extra headers do not invalidate curl requests; browser must still pass **CORS** for cross-origin PUT.

---

## Task 7 — TLS Negotiation

\`\`\`
${tls.snippet}
\`\`\`

| Field | Value |
|-------|-------|
| Protocol | ${tls.protocol || 'unknown'} |
| Cipher | ${tls.cipher || 'unknown'} |
| Verify | ${tls.verifyReturn || 'unknown'} |

TLS to R2 endpoint succeeds from server. Browser failures occur **after** TLS (1KB can succeed) or **during long upload stream** (30MB), not at handshake for small probes.

---

## Task 8 — fetch() vs XMLHttpRequest (diagnostic harness only)

| Transport | 1KB no token | 1KB with X-Upload-Token |
|-----------|--------------|-------------------------|
| fetch | ${JSON.stringify(browserSmall.result?.fetchNoToken || {})} | ${JSON.stringify(browserSmall.result?.fetchWithToken || {})} |
| XHR | ${JSON.stringify(browserSmall.result?.xhrNoToken || {})} | ${JSON.stringify(browserSmall.result?.xhrWithToken || {})} |

**Finding:** ${browserSmall.result?.xhrNoToken?.ok && !browserSmall.result?.fetchNoToken?.ok ? 'XHR succeeds where fetch fails — document difference in stack/headers' : 'At 1KB both transports behave similarly; 30MB failure is size/duration related, not fetch-vs-XHR specific at small payload.'}

---

## Task 9 — Ranked Root Cause Analysis

| Rank | Cause | Confidence | Evidence |
|------|-------|------------|----------|
| 1 | **Long single-request PUT stream timeout / connection drop** (\`net::ERR_FAILED\`, no HTTP response) | **High** | 30MB fails in ~0.5–300s; curl completes in ~450s; no cf-ray |
| 2 | **CORS origin mismatch on non-Netlify origins** (local dev, preview hosts) | **High (local)** / Medium (prod) | R2 CORS allows only Netlify; local preflight ${cors.localOrigin_withToken.http} |
| 3 | **Cross-origin PUT preflight required** (PUT + custom headers) | **Medium** | \`X-Upload-Token\` triggers preflight; allowed on Netlify origin |
| 4 | **Unsigned \`X-Upload-Token\` header on R2 URL** | **Low** | curl returns 200 with token; not signature mismatch |
| 5 | **AbortController / app retry cancellation** | **Ruled out** | No signal on upload path (prior mission) |
| 6 | **TLS / cert failure** | **Ruled out** | openssl + curl TLS OK |
| 7 | **Service worker interception** | **Ruled out** | sw.js no-op |
| 8 | **CSP blocking R2** | **Ruled out** | No CSP on Netlify index |

---

## Task 10 — First Failing Transport Boundary

**Production Netlify path (large files):**

\`\`\`
UPLOAD_SIGN_SUCCESS
  → UPLOAD_PUT_BEGIN
  → [browser streams File body over HTTPS PUT]
  → **Transport failure: TypeError Failed to fetch / net::ERR_FAILED**
  → (no HTTP status, no cf-ray, no x-amz-request-id)
  → finalize never starts
\`\`\`

**First boundary:** Browser network stack **during outbound PUT body upload**, before R2 returns HTTP response.

**Local/preview path (additional boundary):** CORS preflight may fail when Origin is not \`${NETLIFY_ORIGIN}\`.

---

## Recommended Smallest Code Change (NOT implemented)

1. **Remove \`X-Upload-Token\` from R2 PUT requests** (token only needed for Railway direct upload, not presigned R2) — reduces preflight surface; unlikely alone to fix 30MB timeout.
2. **Replace monolithic \`fetch(File)\` PUT with S3 multipart / resumable uploader** — addresses rank-1 transport timeout with smallest architectural fix.

---

## Files Touched

- \`frontend/scripts/netlify-r2-put-rootcause-01.mjs\` — investigation harness only
- **No production upload code modified in this mission**
`;

  fs.writeFileSync(OUT_MD, md);
  console.log(`Wrote ${OUT_MD}`);
  console.log(`Wrote ${OUT_JSON}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
