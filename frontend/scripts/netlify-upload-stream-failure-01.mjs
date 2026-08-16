#!/usr/bin/env node
/**
 * NETLIFY-UPLOAD-STREAM-FAILURE-01 — determine where the R2 PUT stream is interrupted.
 * Investigation only — no production upload architecture changes.
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
const OUT_JSON = path.join(ROOT, 'artifacts/netlify-upload-stream-failure-01.json');
const OUT_MD = path.join(ROOT, 'artifacts/NETLIFY_UPLOAD_STREAM_FAILURE_01.md');
const API_URL = (process.env.API_URL || 'https://reelforge-deploy-production.up.railway.app').replace(/\/$/, '');
const NETLIFY_ORIGIN = (process.env.NETLIFY_ORIGIN || 'https://strong-lolly-a9fcb4.netlify.app').replace(/\/$/, '');
const LOCAL_ORIGIN = `http://127.0.0.1:${Number(process.env.LOCAL_PORT || 4173)}`;
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const TARGET_BYTES = Number(process.env.STREAM_PROBE_BYTES || 30 * 1024 * 1024);
const PROGRESS_INTERVAL_MS = Number(process.env.PROGRESS_INTERVAL_MS || 2000);
const UPLOAD_TIMEOUT_MS = Number(process.env.UPLOAD_TIMEOUT_MS || 900000);

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
  const dir = path.join('/tmp', `stream-failure-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'probe_30m.mp4');
  const condo = '/home/youloose2dafish/Downloads/condo_v1_2.mp4';
  if (fs.existsSync(condo)) {
    execFileSync(
      'ffmpeg',
      ['-y', '-hide_banner', '-loglevel', 'error', '-i', condo, '-fs', '30M', '-c', 'copy', filePath],
      { stdio: 'ignore' }
    );
  } else {
    execFileSync('dd', [`if=/dev/zero`, `of=${filePath}`, 'bs=1M', 'count=26'], { stdio: 'ignore' });
  }
  return { dir, filePath, size: fs.statSync(filePath).size };
}

async function signUpload(token, sizeBytes, label) {
  const res = await fetch(`${API_URL}/api/uploads/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      filename: 'probe_30m.mp4',
      contentType: 'video/mp4',
      sizeBytes,
      title: `STREAM-FAILURE-01 ${label}`,
      category: 'Trending'
    })
  });
  const body = await res.json();
  if (!res.ok || !body.uploadUrl) {
    throw new Error(`sign failed http=${res.status} body=${JSON.stringify(body)}`);
  }
  return { http: res.status, body, sizeBytes };
}

function analyzeProgress(samples, totalBytes) {
  if (!samples.length) {
    return {
      sampleCount: 0,
      totalBytes,
      conclusion: 'no_progress_samples'
    };
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  const durationMs = last.elapsedMs - first.elapsedMs;
  const bytesDelta = last.loaded - first.loaded;
  const avgRateBps = durationMs > 0 ? Math.round((bytesDelta * 1000) / durationMs) : 0;
  let maxIdleMs = 0;
  let maxIdleAtSample = null;
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const cur = samples[i];
    const idleMs = cur.elapsedMs - prev.elapsedMs;
    const byteDelta = cur.loaded - prev.loaded;
    if (byteDelta === 0 && idleMs > maxIdleMs) {
      maxIdleMs = idleMs;
      maxIdleAtSample = cur;
    }
  }
  const lastProgress = [...samples].reverse().find((s) => s.loaded > 0) || last;
  const stalledBeforeFailure = maxIdleMs >= PROGRESS_INTERVAL_MS * 2;
  const progressActiveUntilEnd = !stalledBeforeFailure && last.loaded > 0 && last.loaded < totalBytes;
  return {
    sampleCount: samples.length,
    totalBytes,
    firstSample: first,
    lastSample: last,
    lastProgressSample: lastProgress,
    bytesAtFailure: last.loaded,
    percentAtFailure: totalBytes > 0 ? Number(((last.loaded / totalBytes) * 100).toFixed(2)) : 0,
    elapsedMsAtFailure: last.elapsedMs,
    avgRateBps,
    maxIdleMs,
    maxIdleAtSample,
    stalledBeforeFailure,
    progressActiveUntilEnd,
    finalLoadedEqualsTotal: last.loaded >= totalBytes
  };
}

function classifyTermination({ analysis, failed, cdpFailed, xhrResult }) {
  const hypotheses = [];
  if (xhrResult?.outcome === 'cors_preflight_block' || (failed?.length && failed.every((f) => (f.errorText || '').includes('CORS')))) {
    hypotheses.push({ id: 'cors_preflight', confidence: 'high', note: 'Failure before upload body sent (Path A)' });
  }
  if (analysis?.elapsedMsAtFailure != null && analysis.elapsedMsAtFailure < 5000 && analysis.bytesAtFailure === 0) {
    hypotheses.push({ id: 'immediate_network_or_cors', confidence: 'high', note: 'Failed within 5s with zero bytes uploaded' });
  }
  if (analysis?.stalledBeforeFailure) {
    hypotheses.push({
      id: 'inactivity_timeout',
      confidence: 'medium',
      note: `Upload progress stalled for ${analysis.maxIdleMs}ms before failure`
    });
  }
  if (analysis?.progressActiveUntilEnd) {
    hypotheses.push({
      id: 'active_stream_cut',
      confidence: 'medium',
      note: 'Bytes were still advancing when connection dropped — likely external termination mid-stream'
    });
  }
  if (analysis?.bytesAtFailure > 0 && analysis?.percentAtFailure >= 99) {
    hypotheses.push({ id: 'late_stage_drop', confidence: 'medium', note: 'Failure near completion — possible response/finalization boundary' });
  }
  const cdp = cdpFailed?.[0];
  if (cdp?.errorText === 'net::ERR_FAILED' && analysis?.bytesAtFailure > 0) {
    hypotheses.push({
      id: 'silent_connection_reset',
      confidence: 'medium',
      note: 'ERR_FAILED after bytes sent, no HTTP response — TCP/TLS closed without application response'
    });
  }
  if (cdp?.blockedReason) {
    hypotheses.push({ id: 'browser_policy_block', confidence: 'high', note: cdp.blockedReason });
  }
  return hypotheses;
}

function writeDiagnosticPage(dir) {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Stream Failure Probe</title></head>
<body><script>
window.__STREAM_PROBE__ = { events: [] };
function log(evt) { window.__STREAM_PROBE__.events.push({ ...evt, ts: Date.now() }); }

function makeSyntheticFile(sizeBytes, name) {
  const chunkSize = 1024 * 1024;
  const chunks = [];
  let remaining = sizeBytes;
  while (remaining > 0) {
    const n = Math.min(chunkSize, remaining);
    chunks.push(new Uint8Array(n).fill(0x41));
    remaining -= n;
  }
  return new File(chunks, name, { type: 'video/mp4', lastModified: Date.now() });
}

async function loadFileFromUrl(url, name) {
  const res = await fetch(url);
  const blob = await res.blob();
  return new File([blob], name, { type: 'video/mp4', lastModified: Date.now() });
}

window.runStreamProbe = async ({ uploadUrl, fileSize, fileUrl, fileName, progressIntervalMs, timeoutMs }) => {
  const t0 = performance.now();
  const progress = [];
  let xhrResult = null;
  let timer = null;
  const file = fileUrl
    ? await loadFileFromUrl(fileUrl, fileName || 'probe_30m.mp4')
    : makeSyntheticFile(fileSize, fileName || 'probe_30m.mp4');
  log({ stage: 'file_ready', size: file.size, origin: location.origin, synthetic: !fileUrl });

  await new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const sample = () => {
      const sample = {
        elapsedMs: Math.round(performance.now() - t0),
        loaded: xhr.upload?.loaded ?? 0,
        total: xhr.upload?.total ?? file.size,
        readyState: xhr.readyState,
        status: xhr.status
      };
      progress.push(sample);
      log({ stage: 'progress', ...sample });
    };
    timer = setInterval(sample, progressIntervalMs);
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', 'video/mp4');
    xhr.upload.onloadstart = () => log({ stage: 'upload_start', elapsedMs: Math.round(performance.now() - t0) });
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        log({ stage: 'progress_event', elapsedMs: Math.round(performance.now() - t0), loaded: evt.loaded, total: evt.total });
      }
    };
    xhr.onload = () => {
      clearInterval(timer);
      sample();
      xhrResult = {
        outcome: 'complete',
        status: xhr.status,
        ok: xhr.status >= 200 && xhr.status < 300,
        elapsedMs: Math.round(performance.now() - t0),
        responseHeaders: xhr.getAllResponseHeaders()
      };
      log({ stage: 'xhr_complete', ...xhrResult });
      resolve();
    };
    xhr.onerror = () => {
      clearInterval(timer);
      sample();
      xhrResult = {
        outcome: 'error',
        status: xhr.status,
        readyState: xhr.readyState,
        elapsedMs: Math.round(performance.now() - t0),
        error: 'xhr.onerror'
      };
      log({ stage: 'xhr_error', ...xhrResult });
      resolve();
    };
    xhr.onabort = () => {
      clearInterval(timer);
      sample();
      xhrResult = {
        outcome: 'abort',
        elapsedMs: Math.round(performance.now() - t0),
        error: 'xhr.onabort'
      };
      log({ stage: 'xhr_abort', ...xhrResult });
      resolve();
    };
    xhr.ontimeout = () => {
      clearInterval(timer);
      sample();
      xhrResult = {
        outcome: 'timeout',
        elapsedMs: Math.round(performance.now() - t0),
        error: 'xhr.ontimeout'
      };
      log({ stage: 'xhr_timeout', ...xhrResult });
      resolve();
    };
    xhr.timeout = timeoutMs;
    log({ stage: 'xhr_send', uploadUrlHost: new URL(uploadUrl).host, fileSize: file.size });
    xhr.send(file);
  });

  return { progress, xhrResult, events: window.__STREAM_PROBE__.events, fileSize: file.size, origin: location.origin };
};
</script></body></html>`;
  const htmlPath = path.join(dir, 'stream-probe.html');
  fs.writeFileSync(htmlPath, html);
  return htmlPath;
}

function startLocalServers(htmlPath, filePath, htmlPort, filePort) {
  const fileServer = http.createServer((req, res) => {
    if (req.url === '/file') {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': String(fs.statSync(filePath).size),
        'Access-Control-Allow-Origin': '*'
      });
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
      pageServer.listen(htmlPort, '127.0.0.1', () => {
        resolve({
          fileServer,
          pageServer,
          pageOrigin: `http://127.0.0.1:${htmlPort}`,
          fileUrl: `http://127.0.0.1:${filePort}/file`
        });
      });
    });
  });
}

async function runBrowserStreamProbe({ pageOrigin, uploadUrl, fileSize, fileUrl, fileName, label }) {
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const cdpEvents = [];
  const failed = [];

  cdp.on('Network.loadingFailed', (e) => {
    if (String(e.requestId || '').length) {
      cdpEvents.push({ type: 'loadingFailed', ...e });
    }
  });
  cdp.on('Network.requestWillBeSent', (e) => {
    if (String(e.request?.url || '').includes('r2.cloudflarestorage.com')) {
      cdpEvents.push({
        type: 'requestWillBeSent',
        requestId: e.requestId,
        method: e.request.method,
        url: e.request.url.slice(0, 140),
        headers: e.request.headers
      });
    }
  });
  cdp.on('Network.responseReceived', (e) => {
    if (String(e.response?.url || '').includes('r2.cloudflarestorage.com')) {
      cdpEvents.push({
        type: 'responseReceived',
        requestId: e.requestId,
        status: e.response.status,
        headers: e.response.headers,
        protocol: e.response.protocol
      });
    }
  });
  cdp.on('Network.dataSent', (e) => {
    cdpEvents.push({ type: 'dataSent', ...e });
  });

  page.on('requestfailed', (req) => {
    if (req.url().includes('r2.cloudflarestorage.com')) {
      failed.push({
        url: req.url().slice(0, 140),
        method: req.method(),
        errorText: req.failure()?.errorText || null,
        failure: req.failure() || null
      });
    }
  });

  await page.goto(`${pageOrigin}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const result = await page.evaluate(
    async ({ uploadUrl, fileSize, fileUrl, fileName, progressIntervalMs, timeoutMs }) => {
      if (typeof window.runStreamProbe !== 'function') return { error: 'harness missing' };
      return window.runStreamProbe({ uploadUrl, fileSize, fileUrl, fileName, progressIntervalMs, timeoutMs });
    },
    {
      uploadUrl,
      fileSize,
      fileUrl: fileUrl || null,
      fileName: fileName || 'probe_30m.mp4',
      progressIntervalMs: PROGRESS_INTERVAL_MS,
      timeoutMs: UPLOAD_TIMEOUT_MS
    }
  );
  await sleep(1000);
  await browser.close();

  const putCdpFailed = cdpEvents.filter((e) => e.type === 'loadingFailed');
  const analysis = analyzeProgress(result.progress || [], result.fileSize || fileSize);
  return {
    label,
    pageOrigin,
    result,
    analysis,
    failed,
    cdpEvents,
    cdpFailed: putCdpFailed,
    hypotheses: classifyTermination({ analysis, failed, cdpFailed: putCdpFailed, xhrResult: result.xhrResult })
  };
}

async function runNetlifyOriginProbe(token, uploadUrl, fileSize) {
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const cdpEvents = [];
  const failed = [];

  cdp.on('Network.loadingFailed', (e) => cdpEvents.push({ type: 'loadingFailed', ...e }));
  cdp.on('Network.dataSent', (e) => cdpEvents.push({ type: 'dataSent', ...e }));
  cdp.on('Network.responseReceived', (e) => {
    if (String(e.response?.url || '').includes('r2.cloudflarestorage.com')) {
      cdpEvents.push({
        type: 'responseReceived',
        requestId: e.requestId,
        status: e.response.status,
        headers: e.response.headers
      });
    }
  });
  page.on('requestfailed', (req) => {
    if (req.url().includes('r2.cloudflarestorage.com')) {
      failed.push({
        url: req.url().slice(0, 140),
        method: req.method(),
        errorText: req.failure()?.errorText || null
      });
    }
  });

  await page.goto(`${NETLIFY_ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const result = await page.evaluate(
    async ({ uploadUrl, fileSize, progressIntervalMs, timeoutMs }) => {
      const progress = [];
      const events = [];
      const log = (evt) => events.push({ ...evt, ts: Date.now() });
      const t0 = performance.now();
      let xhrResult = null;
      const chunks = [];
      let remaining = fileSize;
      while (remaining > 0) {
        const n = Math.min(1024 * 1024, remaining);
        chunks.push(new Uint8Array(n).fill(0x41));
        remaining -= n;
      }
      const file = new File(chunks, 'probe_30m.mp4', { type: 'video/mp4', lastModified: Date.now() });
      log({ stage: 'file_ready', size: file.size, origin: location.origin });

      await new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        const sample = () => {
          progress.push({
            elapsedMs: Math.round(performance.now() - t0),
            loaded: xhr.upload?.loaded ?? 0,
            total: xhr.upload?.total ?? file.size,
            readyState: xhr.readyState,
            status: xhr.status
          });
        };
        const timer = setInterval(sample, progressIntervalMs);
        xhr.open('PUT', uploadUrl, true);
        xhr.setRequestHeader('Content-Type', 'video/mp4');
        xhr.onload = () => {
          clearInterval(timer);
          sample();
          xhrResult = { outcome: 'complete', status: xhr.status, elapsedMs: Math.round(performance.now() - t0) };
          resolve();
        };
        xhr.onerror = () => {
          clearInterval(timer);
          sample();
          xhrResult = { outcome: 'error', status: xhr.status, elapsedMs: Math.round(performance.now() - t0), error: 'xhr.onerror' };
          resolve();
        };
        xhr.onabort = () => {
          clearInterval(timer);
          sample();
          xhrResult = { outcome: 'abort', elapsedMs: Math.round(performance.now() - t0), error: 'xhr.onabort' };
          resolve();
        };
        xhr.timeout = timeoutMs;
        xhr.send(file);
      });

      return { progress, xhrResult, events, fileSize: file.size, origin: location.origin };
    },
    { uploadUrl, fileSize, progressIntervalMs: PROGRESS_INTERVAL_MS, timeoutMs: UPLOAD_TIMEOUT_MS }
  );

  await sleep(1000);
  await browser.close();
  const analysis = analyzeProgress(result.progress || [], result.fileSize || fileSize);
  const putCdpFailed = cdpEvents.filter((e) => e.type === 'loadingFailed');
  return {
    label: 'netlify_production_origin',
    pageOrigin: NETLIFY_ORIGIN,
    result,
    analysis,
    failed,
    cdpEvents,
    cdpFailed: putCdpFailed,
    hypotheses: classifyTermination({ analysis, failed, cdpFailed: putCdpFailed, xhrResult: result.xhrResult })
  };
}

function curlStreamProbe(uploadUrl, filePath, label) {
  const samples = [];
  const started = Date.now();
  const args = [
    '-sS',
    '-X',
    'PUT',
    '-H',
    'Content-Type: video/mp4',
    '--data-binary',
    `@${filePath}`,
    '-w',
    '__META__%{http_code}|%{time_total}|%{size_upload}|%{speed_upload}|%{http_version}',
    uploadUrl
  ];
  const child = spawnSync('curl', args, { encoding: 'utf8', timeout: UPLOAD_TIMEOUT_MS });
  const elapsedMs = Date.now() - started;
  const out = child.stdout || '';
  const meta = out.includes('__META__') ? out.split('__META__')[1].trim().split('|') : [];
  return {
    label,
    exitCode: child.status,
    stderr: (child.stderr || '').slice(0, 500),
    http: meta[0] || null,
    timeTotalSec: meta[1] ? Number(meta[1]) : null,
    sizeUpload: meta[2] ? Number(meta[2]) : null,
    speedUpload: meta[3] ? Number(meta[3]) : null,
    httpVersion: meta[4] || null,
    elapsedMs,
    samples
  };
}

function nodeStreamProbe(uploadUrl, filePath, label) {
  return new Promise((resolve) => {
    const url = new URL(uploadUrl);
    const totalBytes = fs.statSync(filePath).size;
    const samples = [];
    const started = Date.now();
    let uploaded = 0;
    let responseHeaders = null;
    let statusCode = null;
    let error = null;

    const req = https.request(
      {
        method: 'PUT',
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(totalBytes)
        }
      },
      (res) => {
        statusCode = res.statusCode;
        responseHeaders = res.headers;
        res.resume();
        res.on('end', () => {
          clearInterval(timer);
          resolve({
            label,
            outcome: 'complete',
            http: statusCode,
            elapsedMs: Date.now() - started,
            uploaded,
            totalBytes,
            samples,
            responseHeaders: {
              'cf-ray': responseHeaders?.['cf-ray'] || null,
              'x-amz-request-id': responseHeaders?.['x-amz-request-id'] || null,
              etag: responseHeaders?.etag || null
            }
          });
        });
      }
    );

    req.on('error', (err) => {
      clearInterval(timer);
      error = err.message;
      resolve({
        label,
        outcome: 'error',
        error,
        elapsedMs: Date.now() - started,
        uploaded,
        totalBytes,
        samples
      });
    });

    const timer = setInterval(() => {
      samples.push({
        elapsedMs: Date.now() - started,
        loaded: uploaded,
        total: totalBytes
      });
    }, PROGRESS_INTERVAL_MS);

    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => {
      uploaded += chunk.length;
    });
    stream.pipe(req);
  });
}

async function corsPreflight(uploadUrl, origin) {
  const res = await fetch(uploadUrl, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type'
    }
  }).catch((e) => ({ ok: false, status: 0, error: e.message, headers: new Headers() }));
  const headers = {};
  if (res.headers) {
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
  }
  return { origin, http: res.status || 0, ok: res.ok || false, error: res.error || null, responseHeaders: headers };
}

function renderMarkdown(report) {
  const netlify = report.scenarios.netlifyOrigin;
  const local = report.scenarios.localOrigin;
  const curl = report.scenarios.curlBaseline;
  const node = report.scenarios.nodeBaseline;

  return `# NETLIFY-UPLOAD-STREAM-FAILURE-01

**Mode:** Investigation only — no upload architecture changes  
**Timestamp:** ${report.timestamp}  
**Raw JSON:** \`frontend/artifacts/netlify-upload-stream-failure-01.json\`

---

## Mission questions

| Question | Netlify origin | Local origin | curl baseline | Node https baseline |
|----------|----------------|--------------|---------------|---------------------|
| Consistent time threshold? | ${netlify?.analysis?.elapsedMsAtFailure ?? 'n/a'} ms | ${local?.analysis?.elapsedMsAtFailure ?? 'n/a'} ms | ${curl?.timeTotalSec != null ? `${Math.round(curl.timeTotalSec * 1000)} ms` : 'n/a'} | ${node?.elapsedMs ?? 'n/a'} ms |
| Consistent byte threshold? | ${netlify?.analysis?.bytesAtFailure ?? 'n/a'} / ${netlify?.analysis?.totalBytes ?? 'n/a'} (${netlify?.analysis?.percentAtFailure ?? 'n/a'}%) | ${local?.analysis?.bytesAtFailure ?? 'n/a'} / ${local?.analysis?.totalBytes ?? 'n/a'} (${local?.analysis?.percentAtFailure ?? 'n/a'}%) | ${curl?.sizeUpload ?? 'n/a'} bytes | ${node?.uploaded ?? 'n/a'} bytes |
| Progress stalled before failure? | ${netlify?.analysis?.stalledBeforeFailure ? 'yes' : 'no'} | ${local?.analysis?.stalledBeforeFailure ? 'yes' : 'no'} | n/a | n/a |
| Progress active until failure? | ${netlify?.analysis?.progressActiveUntilEnd ? 'yes' : 'no'} | ${local?.analysis?.progressActiveUntilEnd ? 'yes' : 'no'} | n/a | n/a |
| HTTP response received? | ${netlify?.result?.xhrResult?.status ?? 'none'} | ${local?.result?.xhrResult?.status ?? 'none'} | ${curl?.http ?? 'none'} | ${node?.http ?? 'none'} |

---

## CORS preflight (post-cleanup header set)

| Origin | HTTP | Allow-Origin |
|--------|------|--------------|
| Netlify production | ${report.cors.netlify.http} | ${report.cors.netlify.responseHeaders['access-control-allow-origin'] || 'missing'} |
| Local preview | ${report.cors.local.http} | ${report.cors.local.responseHeaders['access-control-allow-origin'] || 'missing'} |

**Note:** Updated \`r2-cors.json\` includes local dev origins, but the live R2 bucket must have CORS reapplied for local preflight to pass.

---

## Netlify production origin (Path B probe)

- **Outcome:** ${netlify?.result?.xhrResult?.outcome || 'unknown'}
- **Elapsed:** ${netlify?.analysis?.elapsedMsAtFailure ?? 'n/a'} ms
- **Bytes uploaded:** ${netlify?.analysis?.bytesAtFailure ?? 'n/a'} (${netlify?.analysis?.percentAtFailure ?? 'n/a'}%)
- **Average rate:** ${netlify?.analysis?.avgRateBps ?? 'n/a'} B/s
- **Max idle gap:** ${netlify?.analysis?.maxIdleMs ?? 'n/a'} ms
- **Playwright error:** ${(netlify?.failed || []).map((f) => f.errorText).join(', ') || 'none'}
- **CDP loadingFailed:** ${JSON.stringify((netlify?.cdpFailed || []).map((e) => ({ errorText: e.errorText, canceled: e.canceled })))}

### Hypotheses (Netlify)

${(netlify?.hypotheses || []).map((h) => `- **${h.id}** (${h.confidence}): ${h.note}`).join('\n') || '- none'}

---

## Local origin probe

- **Outcome:** ${local?.result?.xhrResult?.outcome || 'unknown'}
- **Elapsed:** ${local?.analysis?.elapsedMsAtFailure ?? 'n/a'} ms
- **Bytes uploaded:** ${local?.analysis?.bytesAtFailure ?? 'n/a'} (${local?.analysis?.percentAtFailure ?? 'n/a'}%)
- **Playwright error:** ${(local?.failed || []).map((f) => f.errorText).join(', ') || 'none'}

### Hypotheses (Local)

${(local?.hypotheses || []).map((h) => `- **${h.id}** (${h.confidence}): ${h.note}`).join('\n') || '- none'}

---

## Transport baselines (same signed URL, no browser CORS)

| Probe | Outcome | HTTP | Uploaded | Elapsed |
|-------|---------|------|----------|---------|
| curl | ${curl?.http ? 'complete' : curl?.exitCode === 0 ? 'complete' : 'error'} | ${curl?.http ?? 'n/a'} | ${curl?.sizeUpload ?? 'n/a'} | ${curl?.timeTotalSec ?? 'n/a'} s |
| node https | ${node?.outcome} | ${node?.http ?? 'n/a'} | ${node?.uploaded ?? 'n/a'} | ${Math.round((node?.elapsedMs || 0) / 1000)} s |

---

## Who closes the connection?

${report.conclusion}

---

## Recommended next step

${report.recommendation}
`;
}

async function main() {
  const fixture = ensureFixture();
  const token = await apiLogin();
  const sign = await signUpload(token, fixture.size, 'stream-failure');
  const uploadUrl = sign.body.uploadUrl;

  const cors = {
    netlify: await corsPreflight(uploadUrl, NETLIFY_ORIGIN),
    local: await corsPreflight(uploadUrl, LOCAL_ORIGIN)
  };

  const htmlPath = writeDiagnosticPage(fixture.dir);
  const htmlPort = 8771;
  const filePort = 8772;
  const servers = await startLocalServers(htmlPath, fixture.filePath, htmlPort, filePort);

  console.log('[stream-failure] Running Netlify-origin XHR probe (Path B)...');
  const netlifyOrigin = await runNetlifyOriginProbe(token, uploadUrl, fixture.size);

  console.log('[stream-failure] Running local-origin XHR probe...');
  const localOrigin = await runBrowserStreamProbe({
    pageOrigin: servers.pageOrigin,
    uploadUrl,
    fileSize: fixture.size,
    fileUrl: servers.fileUrl,
    fileName: 'probe_30m.mp4',
    label: 'local_harness_origin'
  });

  servers.fileServer.close();
  servers.pageServer.close();

  console.log('[stream-failure] Running curl baseline...');
  const curlBaseline = curlStreamProbe(uploadUrl, fixture.filePath, 'curl_put');

  console.log('[stream-failure] Running Node https baseline...');
  const nodeBaseline = await nodeStreamProbe(uploadUrl, fixture.filePath, 'node_https_put');

  let conclusion = 'Inconclusive — inspect raw progress samples in JSON.';
  let recommendation =
    'Re-run after R2 bucket CORS is updated from r2-cors.json; compare Netlify-origin browser bytes-at-failure against curl/node completion.';

  if (netlifyOrigin.analysis.bytesAtFailure === 0 && netlifyOrigin.analysis.elapsedMsAtFailure < 5000) {
    conclusion =
      'Netlify-origin probe failed before meaningful upload bytes — may indicate auth/signature/CORS regression rather than mid-stream drop.';
  } else if (netlifyOrigin.analysis.progressActiveUntilEnd && curlBaseline.http === '200') {
    conclusion =
      'Browser upload bytes were still advancing when the connection dropped, while curl completed — points to browser/runtime or browser-specific network path termination, not R2 signature rejection.';
    recommendation =
      'If pattern repeats with stable time/byte ceiling, justify resumable/multipart uploads or a non-browser upload proxy; do not implement until a second confirming run.';
  } else if (netlifyOrigin.analysis.stalledBeforeFailure) {
    conclusion =
      'Upload progress stalled before failure — consistent with inactivity/idle timeout on an intermediary.';
    recommendation = 'Test with keep-alive/trickle uploads and measure whether stall duration correlates with failure time.';
  } else if (netlifyOrigin.result?.xhrResult?.outcome === 'complete') {
    conclusion = 'Browser upload completed in this run — mid-stream failure may be intermittent or environment-specific.';
    recommendation = 'Run multiple trials from production user network; capture HAR with progress timeline.';
  }

  const report = {
    mission: 'NETLIFY-UPLOAD-STREAM-FAILURE-01',
    timestamp: new Date().toISOString(),
    constraints: {
      noDeploy: true,
      noArchitectureChange: true,
      cleanupAppliedInRepo: ['r2-cors.json dev origins', 'media.js omit X-Upload-Token on R2 PUT']
    },
    fixture: {
      path: fixture.filePath,
      sizeBytes: fixture.size,
      progressIntervalMs: PROGRESS_INTERVAL_MS,
      uploadTimeoutMs: UPLOAD_TIMEOUT_MS
    },
    sign: {
      uploadUrlHost: new URL(uploadUrl).host,
      sizeBytes: fixture.size
    },
    cors,
    scenarios: {
      netlifyOrigin,
      localOrigin,
      curlBaseline,
      nodeBaseline
    },
    conclusion,
    recommendation
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUT_MD, renderMarkdown(report));
  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Wrote ${OUT_MD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
