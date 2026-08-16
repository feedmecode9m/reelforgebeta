#!/usr/bin/env node
/**
 * R2-UPLOAD-RELIABILITY-02 — fresh presigned URL per probe (investigation only).
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
const OUT_JSON = path.join(ROOT, 'artifacts/r2-upload-reliability-02.json');
const OUT_MD = path.join(ROOT, 'artifacts/R2_UPLOAD_RELIABILITY_02.md');
const API_URL = (process.env.API_URL || 'https://reelforge-deploy-production.up.railway.app').replace(/\/$/, '');
const NETLIFY_ORIGIN = (process.env.NETLIFY_ORIGIN || 'https://strong-lolly-a9fcb4.netlify.app').replace(/\/$/, '');
const LOCAL_PAGE_PORT = Number(process.env.LOCAL_PAGE_PORT || 8781);
const LOCAL_FILE_PORT = Number(process.env.LOCAL_FILE_PORT || 8782);
const LOCAL_ORIGIN = `http://127.0.0.1:${LOCAL_PAGE_PORT}`;
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const SIZE_TIERS_MB = (process.env.RELIABILITY_SIZE_TIERS_MB || '50,250')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => n > 0);
const UPLOAD_TIMEOUT_MS = Number(process.env.UPLOAD_TIMEOUT_MS || 7200000);
const PROGRESS_INTERVAL_MS = Number(process.env.PROGRESS_INTERVAL_MS || 5000);
const RUN_STRESS_500 = process.env.RELIABILITY_STRESS_500 === '1';
const PROBES = (process.env.RELIABILITY_PROBES || 'A,B,C,D').split(',').map((s) => s.trim().toUpperCase());
const BROWSER_MAX_MB = Number(process.env.RELIABILITY_BROWSER_MAX_MB || 50);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isoNow() {
  return new Date().toISOString();
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

function ensureFixture(sizeBytes) {
  const dir = path.join('/tmp', `r2-reliability-02-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const labelMb = Math.round(sizeBytes / (1024 * 1024));
  const filePath = path.join(dir, `probe_${labelMb}m.mp4`);
  const condo = '/home/youloose2dafish/Downloads/condo_v1_2.mp4';
  if (fs.existsSync(condo) && sizeBytes <= 60 * 1024 * 1024) {
    execFileSync(
      'ffmpeg',
      ['-y', '-hide_banner', '-loglevel', 'error', '-i', condo, '-fs', `${labelMb}M`, '-c', 'copy', filePath],
      { stdio: 'ignore' }
    );
  } else {
    execFileSync('dd', ['if=/dev/zero', `of=${filePath}`, 'bs=1M', `count=${Math.ceil(sizeBytes / (1024 * 1024))}`], {
      stdio: 'ignore'
    });
    const stat = fs.statSync(filePath);
    if (stat.size > sizeBytes) {
      fs.truncateSync(filePath, sizeBytes);
    } else if (stat.size < sizeBytes) {
      const fd = fs.openSync(filePath, 'a');
      fs.writeSync(fd, Buffer.alloc(sizeBytes - stat.size));
      fs.closeSync(fd);
    }
  }
  const size = fs.statSync(filePath).size;
  return { dir, filePath, sizeBytes: size, labelMb };
}

async function freshSign(token, sizeBytes, probeId, tierMb) {
  const signStartedAt = isoNow();
  const signStartedMs = Date.now();
  const res = await fetch(`${API_URL}/api/uploads/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      filename: `reliability_${tierMb}m_${probeId}.mp4`,
      contentType: 'video/mp4',
      sizeBytes,
      title: `R2-RELIABILITY-02 ${probeId} ${tierMb}MB`,
      category: 'Trending'
    })
  });
  const body = await res.json().catch(() => ({}));
  const signCompletedMs = Date.now();
  if (!res.ok || !body.uploadUrl) {
    throw new Error(`sign failed probe=${probeId} http=${res.status} body=${JSON.stringify(body)}`);
  }
  const uploadUrl = String(body.uploadUrl);
  return {
    signRequestTimestamp: signStartedAt,
    signCompletedTimestamp: isoNow(),
    signElapsedMs: signCompletedMs - signStartedMs,
    signHttp: res.status,
    uploadId: body.uploadId,
    reelId: body.reelId,
    storageKey: body.storageKey,
    expiresAt: body.expiresAt,
    maxBytes: body.maxBytes,
    uploadUrlHost: new URL(uploadUrl).host,
    uploadUrlRedacted: `${new URL(uploadUrl).origin}${new URL(uploadUrl).pathname}?[REDACTED]`,
    objectKey: String(body.storageKey || ''),
    uploadUrl
  };
}

function classifyProbe(result) {
  if (result.outcome === 'complete') return 'success';
  if (result.corsError) return 'cors_blocked';
  if (result.httpStatus === 502 || result.httpStatus === 503) return 'midstream_gateway_error';
  if (result.bytesSent > 0 && result.outcome === 'error') return 'midstream_connection_drop';
  if (result.bytesSent === 0 && result.elapsedSec < 10) return 'immediate_failure';
  if (result.outcome === 'timeout') return 'timeout';
  return 'error_other';
}

function nodeHttpsPut(sign, filePath, sizeBytes) {
  return new Promise((resolve) => {
    const url = new URL(sign.uploadUrl);
    const uploadStartTimestamp = isoNow();
    const uploadStartMs = Date.now();
    let bytesSent = 0;
    const progressSamples = [];
    const timer = setInterval(() => {
      progressSamples.push({
        elapsedMs: Date.now() - uploadStartMs,
        bytesSent
      });
    }, PROGRESS_INTERVAL_MS);

    const req = https.request(
      {
        method: 'PUT',
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(sizeBytes)
        },
        timeout: UPLOAD_TIMEOUT_MS
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          clearInterval(timer);
          progressSamples.push({ elapsedMs: Date.now() - uploadStartMs, bytesSent });
          const responseBody = Buffer.concat(chunks).toString('utf8').slice(0, 500);
          resolve({
            probe: 'A',
            transport: 'node_https_put',
            freshSign: true,
            uploadId: sign.uploadId,
            storageKey: sign.storageKey,
            signRequestTimestamp: sign.signRequestTimestamp,
            signCompletedTimestamp: sign.signCompletedTimestamp,
            uploadStartTimestamp,
            uploadEndTimestamp: isoNow(),
            signElapsedMs: sign.signElapsedMs,
            uploadElapsedMs: Date.now() - uploadStartMs,
            elapsedSec: Number(((Date.now() - uploadStartMs) / 1000).toFixed(2)),
            outcome: res.statusCode >= 200 && res.statusCode < 300 ? 'complete' : 'error',
            httpStatus: res.statusCode,
            bytesSent,
            bytesAcknowledged: res.headers['content-length'] ? Number(res.headers['content-length']) : null,
            failureReason:
              res.statusCode >= 200 && res.statusCode < 300
                ? null
                : `HTTP ${res.statusCode} ${responseBody.slice(0, 200)}`,
            responseHeaders: {
              etag: res.headers.etag || null,
              'cf-ray': res.headers['cf-ray'] || null,
              'x-amz-request-id': res.headers['x-amz-request-id'] || null,
              'content-type': res.headers['content-type'] || null
            },
            progressSamples,
            classification: null
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });

    req.on('error', (err) => {
      clearInterval(timer);
      progressSamples.push({ elapsedMs: Date.now() - uploadStartMs, bytesSent });
      resolve({
        probe: 'A',
        transport: 'node_https_put',
        freshSign: true,
        uploadId: sign.uploadId,
        storageKey: sign.storageKey,
        signRequestTimestamp: sign.signRequestTimestamp,
        signCompletedTimestamp: sign.signCompletedTimestamp,
        uploadStartTimestamp,
        uploadEndTimestamp: isoNow(),
        signElapsedMs: sign.signElapsedMs,
        uploadElapsedMs: Date.now() - uploadStartMs,
        elapsedSec: Number(((Date.now() - uploadStartMs) / 1000).toFixed(2)),
        outcome: err.message === 'timeout' ? 'timeout' : 'error',
        httpStatus: null,
        bytesSent,
        bytesAcknowledged: null,
        failureReason: err.message,
        responseHeaders: {},
        progressSamples,
        classification: null
      });
    });

    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => {
      bytesSent += chunk.length;
    });
    stream.pipe(req);
  });
}

function curlPut(sign, filePath, sizeBytes) {
  const hdrPath = `/tmp/r2rel-curl-${sign.uploadId}.hdr`;
  const bodyPath = `/tmp/r2rel-curl-${sign.uploadId}.body`;
  const uploadStartTimestamp = isoNow();
  const uploadStartMs = Date.now();
  const args = [
    '-sS',
    '-D',
    hdrPath,
    '-o',
    bodyPath,
    '-w',
    '__META__%{http_code}|%{time_total}|%{size_upload}|%{speed_upload}|%{http_version}',
    '-X',
    'PUT',
    '-H',
    'Content-Type: video/mp4',
    '--data-binary',
    `@${filePath}`,
    sign.uploadUrl
  ];
  const p = spawnSync('curl', args, { encoding: 'utf8', timeout: UPLOAD_TIMEOUT_MS });
  const uploadEndMs = Date.now();
  const out = p.stdout || '';
  const meta = out.includes('__META__') ? out.split('__META__')[1].trim().split('|') : [];
  const hdr = fs.existsSync(hdrPath) ? fs.readFileSync(hdrPath, 'utf8') : '';
  const responseBody = fs.existsSync(bodyPath) ? fs.readFileSync(bodyPath, 'utf8').slice(0, 500) : '';
  const http = meta[0] ? Number(meta[0]) : null;
  const bytesSent = meta[2] ? Number(meta[2]) : null;
  return {
    probe: 'B',
    transport: 'curl_put',
    freshSign: true,
    uploadId: sign.uploadId,
    storageKey: sign.storageKey,
    signRequestTimestamp: sign.signRequestTimestamp,
    signCompletedTimestamp: sign.signCompletedTimestamp,
    uploadStartTimestamp,
    uploadEndTimestamp: isoNow(),
    signElapsedMs: sign.signElapsedMs,
    uploadElapsedMs: uploadEndMs - uploadStartMs,
    elapsedSec: Number(((uploadEndMs - uploadStartMs) / 1000).toFixed(2)),
    outcome: http >= 200 && http < 300 ? 'complete' : 'error',
    httpStatus: http,
    bytesSent,
    bytesAcknowledged: null,
    failureReason: http >= 200 && http < 300 ? null : `HTTP ${http} ${responseBody.slice(0, 200)}`,
    responseHeaders: {
      'cf-ray': (hdr.match(/cf-ray:\s*(.+)/i) || [])[1]?.trim() || null,
      'x-amz-request-id': (hdr.match(/x-amz-request-id:\s*(.+)/i) || [])[1]?.trim() || null,
      etag: (hdr.match(/etag:\s*(.+)/i) || [])[1]?.trim() || null
    },
    curlMeta: {
      exitCode: p.status,
      stderr: (p.stderr || '').slice(0, 300),
      timeTotalSec: meta[1] ? Number(meta[1]) : null,
      speedUpload: meta[3] ? Number(meta[3]) : null,
      httpVersion: meta[4] || null
    },
    classification: null
  };
}

function writeBrowserHarness(dir) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>R2 Reliability 02</title></head><body><script>
window.runReliabilityXhr = async ({ uploadUrl, fileUrl, fileSize, fileName, timeoutMs, progressIntervalMs, synthetic }) => {
  const t0 = performance.now();
  const progressSamples = [];
  let file;
  if (synthetic) {
    const chunks = [];
    let remaining = fileSize;
    while (remaining > 0) {
      const n = Math.min(1024 * 1024, remaining);
      chunks.push(new Uint8Array(n).fill(0x41));
      remaining -= n;
    }
    file = new File(chunks, fileName || 'probe.mp4', { type: 'video/mp4', lastModified: Date.now() });
  } else {
    const res = await fetch(fileUrl);
    const blob = await res.blob();
    file = new File([blob], fileName || 'probe.mp4', { type: 'video/mp4', lastModified: Date.now() });
  }
  const uploadStartMs = performance.now();
  let xhrResult = null;
  await new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const sample = () => {
      progressSamples.push({
        elapsedMs: Math.round(performance.now() - uploadStartMs),
        bytesSent: xhr.upload?.loaded ?? 0,
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
      xhrResult = {
        outcome: 'complete',
        status: xhr.status,
        responseHeaders: xhr.getAllResponseHeaders(),
        elapsedMs: Math.round(performance.now() - uploadStartMs)
      };
      resolve();
    };
    xhr.onerror = () => {
      clearInterval(timer);
      sample();
      xhrResult = {
        outcome: 'error',
        status: xhr.status,
        readyState: xhr.readyState,
        error: 'xhr.onerror',
        elapsedMs: Math.round(performance.now() - uploadStartMs)
      };
      resolve();
    };
    xhr.onabort = () => {
      clearInterval(timer);
      sample();
      xhrResult = { outcome: 'abort', error: 'xhr.onabort', elapsedMs: Math.round(performance.now() - uploadStartMs) };
      resolve();
    };
    xhr.ontimeout = () => {
      clearInterval(timer);
      sample();
      xhrResult = { outcome: 'timeout', error: 'xhr.ontimeout', elapsedMs: Math.round(performance.now() - uploadStartMs) };
      resolve();
    };
    xhr.timeout = timeoutMs;
    xhr.send(file);
  });
  const last = progressSamples[progressSamples.length - 1] || {};
  return {
    origin: location.origin,
    fileSize: file.size,
    xhrResult,
    progressSamples,
    bytesSent: last.bytesSent ?? 0,
    uploadElapsedMs: xhrResult?.elapsedMs ?? Math.round(performance.now() - uploadStartMs)
  };
};
</script></body></html>`;
  const htmlPath = path.join(dir, 'reliability.html');
  fs.writeFileSync(htmlPath, html);
  return htmlPath;
}

function startLocalServers(htmlPath, filePath) {
  const fileServer = http.createServer((req, res) => {
    if (req.url === '/file') {
      const size = fs.statSync(filePath).size;
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': String(size),
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const pageServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(htmlPath).pipe(res);
  });
  return new Promise((resolve) => {
    fileServer.listen(LOCAL_FILE_PORT, '127.0.0.1', () => {
      pageServer.listen(LOCAL_PAGE_PORT, '127.0.0.1', () => {
        resolve({
          fileServer,
          pageServer,
          fileUrl: `http://127.0.0.1:${LOCAL_FILE_PORT}/file`
        });
      });
    });
  });
}

async function browserXhrPut(sign, options) {
  const {
    pageOrigin,
    probe,
    fileUrl,
    sizeBytes,
    synthetic,
    labelMb
  } = options;
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');

  const cdpFailed = [];
  cdp.on('Network.loadingFailed', (e) => {
    if (String(e.type || '') === 'XHR' || String(e.type || '') === 'Preflight') {
      cdpFailed.push(e);
    }
  });

  const playwrightFailed = [];
  page.on('requestfailed', (req) => {
    if (req.url().includes('r2.cloudflarestorage.com')) {
      playwrightFailed.push({
        url: req.url().slice(0, 140),
        errorText: req.failure()?.errorText || null
      });
    }
  });

  const uploadStartTimestamp = isoNow();
  const useLocalHarness = pageOrigin.startsWith('http://127.0.0.1') || pageOrigin.startsWith('http://localhost');
  if (useLocalHarness) {
    await page.goto(`${pageOrigin}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  } else {
    await page.goto(`${pageOrigin}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  }

  const result = useLocalHarness
    ? await page.evaluate(
        async ({ uploadUrl, fileUrl, fileSize, timeoutMs, progressIntervalMs, synthetic, fileName }) => {
          if (typeof window.runReliabilityXhr !== 'function') return { error: 'harness missing' };
          return window.runReliabilityXhr({
            uploadUrl,
            fileUrl: synthetic ? null : fileUrl,
            fileSize,
            fileName,
            timeoutMs,
            progressIntervalMs,
            synthetic
          });
        },
        {
          uploadUrl: sign.uploadUrl,
          fileUrl,
          fileSize: sizeBytes,
          fileName: `reliability_${labelMb}m_${probe}.mp4`,
          timeoutMs: UPLOAD_TIMEOUT_MS,
          progressIntervalMs: PROGRESS_INTERVAL_MS,
          synthetic: Boolean(synthetic)
        }
      )
    : await page.evaluate(
        async ({ uploadUrl, fileSize, timeoutMs, progressIntervalMs, fileName }) => {
          const progressSamples = [];
          const chunks = [];
          let remaining = fileSize;
          while (remaining > 0) {
            const n = Math.min(1024 * 1024, remaining);
            chunks.push(new Uint8Array(n).fill(0x41));
            remaining -= n;
          }
          const file = new File(chunks, fileName || 'probe.mp4', { type: 'video/mp4', lastModified: Date.now() });
          const uploadStartMs = performance.now();
          let xhrResult = null;
          await new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            const sample = () => {
              progressSamples.push({
                elapsedMs: Math.round(performance.now() - uploadStartMs),
                bytesSent: xhr.upload?.loaded ?? 0,
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
              xhrResult = {
                outcome: 'complete',
                status: xhr.status,
                responseHeaders: xhr.getAllResponseHeaders(),
                elapsedMs: Math.round(performance.now() - uploadStartMs)
              };
              resolve();
            };
            xhr.onerror = () => {
              clearInterval(timer);
              sample();
              xhrResult = {
                outcome: 'error',
                status: xhr.status,
                readyState: xhr.readyState,
                error: 'xhr.onerror',
                elapsedMs: Math.round(performance.now() - uploadStartMs)
              };
              resolve();
            };
            xhr.onabort = () => {
              clearInterval(timer);
              sample();
              xhrResult = { outcome: 'abort', error: 'xhr.onabort', elapsedMs: Math.round(performance.now() - uploadStartMs) };
              resolve();
            };
            xhr.ontimeout = () => {
              clearInterval(timer);
              sample();
              xhrResult = { outcome: 'timeout', error: 'xhr.ontimeout', elapsedMs: Math.round(performance.now() - uploadStartMs) };
              resolve();
            };
            xhr.timeout = timeoutMs;
            xhr.send(file);
          });
          const last = progressSamples[progressSamples.length - 1] || {};
          return {
            origin: location.origin,
            fileSize: file.size,
            xhrResult,
            progressSamples,
            bytesSent: last.bytesSent ?? 0,
            uploadElapsedMs: xhrResult?.elapsedMs ?? 0
          };
        },
        {
          uploadUrl: sign.uploadUrl,
          fileSize: sizeBytes,
          fileName: `reliability_${labelMb}m_${probe}.mp4`,
          timeoutMs: UPLOAD_TIMEOUT_MS,
          progressIntervalMs: PROGRESS_INTERVAL_MS
        }
      );
  await sleep(500);
  await browser.close();

  const corsError = cdpFailed.find((e) => e.corsErrorStatus)?.corsErrorStatus?.corsError || null;
  const httpStatus = result.xhrResult?.status || null;
  const bytesSent = result.bytesSent ?? 0;
  const row = {
    probe,
    transport: probe === 'C' ? 'browser_xhr_netlify_origin' : 'browser_xhr_localhost_origin',
    freshSign: true,
    pageOrigin,
    uploadId: sign.uploadId,
    storageKey: sign.storageKey,
    signRequestTimestamp: sign.signRequestTimestamp,
    signCompletedTimestamp: sign.signCompletedTimestamp,
    uploadStartTimestamp,
    uploadEndTimestamp: isoNow(),
    signElapsedMs: sign.signElapsedMs,
    uploadElapsedMs: result.uploadElapsedMs || 0,
    elapsedSec: Number(((result.uploadElapsedMs || 0) / 1000).toFixed(2)),
    outcome: result.xhrResult?.outcome || (result.error ? 'error' : 'unknown'),
    httpStatus,
    bytesSent,
    bytesAcknowledged: null,
    failureReason:
      result.xhrResult?.outcome === 'complete'
        ? null
        : result.xhrResult?.error ||
          playwrightFailed[0]?.errorText ||
          corsError ||
          result.error ||
          'unknown',
    responseHeaders: result.xhrResult?.responseHeaders || null,
    corsError,
    playwrightFailed,
    cdpFailed: cdpFailed.map((e) => ({
      errorText: e.errorText,
      canceled: e.canceled,
      corsError: e.corsErrorStatus?.corsError || null
    })),
    progressSamples: result.progressSamples || [],
    classification: null
  };
  row.classification = classifyProbe(row);
  return row;
}

async function runTier(token, fixture, tierMb, servers) {
  const tierResults = [];
  const sizeBytes = fixture.sizeBytes;

  if (PROBES.includes('A')) {
    console.log(`[reliability] Tier ${tierMb}MB Probe A (Node HTTPS) — fresh sign`);
    const signA = await freshSign(token, sizeBytes, 'A', tierMb);
    const probeA = await nodeHttpsPut(signA, fixture.filePath, sizeBytes);
    probeA.sizeTierMb = tierMb;
    probeA.classification = classifyProbe(probeA);
    tierResults.push(probeA);
  }

  if (PROBES.includes('B')) {
    console.log(`[reliability] Tier ${tierMb}MB Probe B (curl) — fresh sign`);
    const signB = await freshSign(token, sizeBytes, 'B', tierMb);
    const probeB = curlPut(signB, fixture.filePath, sizeBytes);
    probeB.sizeTierMb = tierMb;
    probeB.classification = classifyProbe(probeB);
    tierResults.push(probeB);
  }

  if (PROBES.includes('C') && tierMb <= BROWSER_MAX_MB) {
    console.log(`[reliability] Tier ${tierMb}MB Probe C (Browser Netlify) — fresh sign`);
    const signC = await freshSign(token, sizeBytes, 'C', tierMb);
    const probeC = await browserXhrPut(signC, {
      pageOrigin: NETLIFY_ORIGIN,
      probe: 'C',
      fileUrl: servers?.fileUrl,
      filePath: fixture.filePath,
      sizeBytes,
      synthetic: true,
      labelMb: tierMb
    });
    probeC.sizeTierMb = tierMb;
    tierResults.push(probeC);
  } else if (PROBES.includes('C') && tierMb > BROWSER_MAX_MB) {
    tierResults.push({
      probe: 'C',
      transport: 'browser_xhr_netlify_origin',
      freshSign: false,
      sizeTierMb: tierMb,
      outcome: 'skipped',
      failureReason: `Browser probe skipped above ${BROWSER_MAX_MB}MB (runtime); use RELIABILITY_BROWSER_MAX_MB to override`,
      classification: 'skipped'
    });
  }

  if (PROBES.includes('D') && tierMb <= BROWSER_MAX_MB) {
    console.log(`[reliability] Tier ${tierMb}MB Probe D (Browser localhost) — fresh sign`);
    const signD = await freshSign(token, sizeBytes, 'D', tierMb);
    const probeD = await browserXhrPut(signD, {
      pageOrigin: LOCAL_ORIGIN,
      probe: 'D',
      fileUrl: servers.fileUrl,
      filePath: fixture.filePath,
      sizeBytes,
      synthetic: false,
      labelMb: tierMb
    });
    probeD.sizeTierMb = tierMb;
    tierResults.push(probeD);
  } else if (PROBES.includes('D') && tierMb > BROWSER_MAX_MB) {
    tierResults.push({
      probe: 'D',
      transport: 'browser_xhr_localhost_origin',
      freshSign: false,
      sizeTierMb: tierMb,
      outcome: 'skipped',
      failureReason: `Browser probe skipped above ${BROWSER_MAX_MB}MB (runtime); use RELIABILITY_BROWSER_MAX_MB to override`,
      classification: 'skipped'
    });
  }

  return tierResults;
}

function renderMarkdown(report) {
  const matrixRows = report.results
    .map(
      (r) =>
        `| ${r.sizeTierMb}MB | ${r.probe} | ${r.transport} | ${r.freshSign ? 'yes' : r.outcome === 'skipped' ? 'n/a' : 'no'} | ${r.uploadId ? `${r.uploadId.slice(0, 8)}…` : '—'} | ${r.outcome} | ${r.httpStatus ?? 'n/a'} | ${r.bytesSent ?? 'n/a'} | ${r.elapsedSec != null ? `${r.elapsedSec}s` : '—'} | ${r.classification} | ${r.failureReason || '—'} |`
    )
    .join('\n');

  const q1 = report.answers.freshUrlEliminatesFailures;
  const q2 = report.answers.browserOnly;
  const q3 = report.answers.netlifyOnly;
  const q4 = report.answers.sizeCorrelation;
  const q5 = report.answers.resumableJustified;

  return `# R2-UPLOAD-RELIABILITY-02

**Mode:** Investigation only — no production code changes  
**Timestamp:** ${report.timestamp}  
**Raw JSON:** \`frontend/artifacts/r2-upload-reliability-02.json\`  
**Harness:** \`frontend/scripts/r2-upload-reliability-02.mjs\`

---

## Executive Summary

${report.executiveSummary}

---

## Environment

| Field | Value |
|-------|-------|
| API | \`${report.environment.apiUrl}\` |
| Netlify origin | \`${report.environment.netlifyOrigin}\` |
| Local origin | \`${report.environment.localOrigin}\` |
| Size tiers (MB) | ${report.environment.sizeTiersMb.join(', ')} |
| Upload timeout | ${report.environment.uploadTimeoutMs} ms |
| Probes run | ${report.environment.probes.join(', ')} |

---

## Signed upload flow (Task 1)

| Item | Value |
|------|-------|
| Sign endpoint | \`POST ${report.flow.signEndpoint}\` |
| Auth | \`Authorization: Bearer <admin token>\` (admin session required) |
| Request body | \`filename\`, \`contentType\`, \`sizeBytes\`, optional \`title\`, \`description\`, \`category\` |
| TTL | ${report.flow.ttlSeconds}s default (\`SIGNED_UPLOAD_TTL_SECONDS\`, min 300) |
| Max size | ${report.flow.maxBytes} bytes default (\`SIGNED_UPLOAD_MAX_BYTES\`, 512 MiB) |
| R2 PUT Content-Type | Must match signed content type (\`video/mp4\` for probes) |
| Signed headers | \`content-type;host\` (AWS SigV4 presign) |
| PUT URL single-use? | **No** — presigned URL is reusable until expiry for the same object key; each sign creates a **new** \`uploadId\`, \`reelId\`, \`storageKey\`, and URL |
| Frontend helper | \`uploadVideoSigned()\` in \`frontend/src/lib/api/media.js\` |
| R2 implementation | \`R2Storage::presigned_put_url()\` in \`backend/src/storage/r2.rs\` |

---

## Probe Matrix

| Size | Probe | Transport | Fresh URL | Upload ID | Outcome | HTTP | Bytes sent | Elapsed | Class | Failure |
|------|-------|-----------|-----------|-----------|---------|------|------------|---------|-------|---------|
${matrixRows}

---

## Failure Classification

${report.failureClassification.map((f) => `- **${f.class}** (${f.count}): ${f.note}`).join('\n')}

---

## Evidence

### Success criteria answers

1. **Does a fresh presigned URL eliminate failures?** ${q1}
2. **Does failure correlate with browser only?** ${q2}
3. **Does failure correlate with Netlify only?** ${q3}
4. **Does failure correlate with payload size?** ${q4}
5. **Is resumable upload actually justified?** ${q5}

### Per-tier summary

${report.tierSummaries.map((t) => `#### ${t.tierMb}MB\n\n${t.summary}`).join('\n\n')}

---

## Recommendation

${report.recommendation}
`;
}

function analyzeResults(results) {
  const byClass = {};
  for (const r of results) {
    byClass[r.classification] = (byClass[r.classification] || 0) + 1;
  }
  const failureClassification = Object.entries(byClass).map(([cls, count]) => ({
    class: cls,
    count,
    note:
      cls === 'success'
        ? 'Upload completed with HTTP 2xx'
        : cls === 'cors_blocked'
          ? 'Browser blocked at CORS preflight (Path A)'
          : cls === 'midstream_gateway_error'
            ? 'HTTP 502/503 after partial upload'
            : cls === 'midstream_connection_drop'
              ? 'Bytes sent but no successful HTTP response'
              : cls === 'immediate_failure'
                ? 'Failed in <10s with zero bytes'
                : 'See probe row'
  }));

  const failures = results.filter((r) => r.outcome !== 'complete' && r.outcome !== 'skipped');
  const successes = results.filter((r) => r.outcome === 'complete');

  const browserFails = failures.filter((r) => r.probe === 'C' || r.probe === 'D');
  const cliFails = failures.filter((r) => r.probe === 'A' || r.probe === 'B');
  const netlifyFails = failures.filter((r) => r.probe === 'C');
  const localFails = failures.filter((r) => r.probe === 'D');

  const byTier = {};
  for (const r of results) {
    byTier[r.sizeTierMb] = byTier[r.sizeTierMb] || { ok: 0, fail: 0, probes: [] };
    byTier[r.sizeTierMb].probes.push(r);
    if (r.outcome === 'complete') byTier[r.sizeTierMb].ok += 1;
    else byTier[r.sizeTierMb].fail += 1;
  }

  const tierSummaries = Object.entries(byTier).map(([tierMb, data]) => {
    const lines = data.probes.map(
      (p) =>
        `- Probe ${p.probe} (${p.transport}): **${p.outcome}** HTTP ${p.httpStatus ?? 'n/a'}, ${p.bytesSent ?? 0} bytes, ${p.elapsedSec}s`
    );
    return {
      tierMb: Number(tierMb),
      summary: lines.join('\n')
    };
  });

  const sizeCorrelation =
    Object.keys(byTier).length > 1
      ? Object.entries(byTier)
          .map(([mb, d]) => `${mb}MB: ${d.ok}/${d.ok + d.fail} succeeded`)
          .join('; ')
      : 'single tier only';

  const freshUrlEliminates =
    failures.length === 0
      ? 'Yes — all fresh-URL probes succeeded in this run.'
      : failures.every((f) => f.classification === 'cors_blocked')
        ? 'Partially — transport probes succeeded; only CORS-blocked browser local probes failed (not URL reuse).'
        : `No — ${failures.length} probe(s) still failed with fresh URLs: ${failures.map((f) => `${f.probe}@${f.sizeTierMb}MB(${f.classification})`).join(', ')}`;

  const browserOnly =
    browserFails.length > 0 && cliFails.length === 0
      ? 'Yes — CLI probes succeeded while browser probes failed.'
      : cliFails.length > 0 && browserFails.length === 0
        ? 'No — CLI probes failed while browser succeeded (if any).'
        : browserFails.length > 0 && cliFails.length > 0
          ? 'Mixed — both browser and CLI saw failures.'
          : 'No failures observed.';

  const netlifyOnly =
    netlifyFails.length > 0 && !localFails.some((f) => f.classification !== 'cors_blocked')
      ? 'Netlify browser failed; local failed only on CORS (expected until bucket CORS applied).'
      : netlifyFails.length === 0 && localFails.length > 0
        ? 'No — local failed, Netlify browser succeeded.'
        : netlifyFails.length === 0
          ? 'No — Netlify browser probes succeeded.'
          : 'Netlify browser showed failures — see matrix.';

  const resumableJustified =
    failures.some((f) => f.classification === 'midstream_connection_drop' || f.classification === 'midstream_gateway_error')
      ? 'Possibly — mid-stream failures observed on fresh URLs; collect user-network HAR before committing to multipart.'
      : failures.length === 0
        ? 'Not yet — all fresh-URL probes completed in this environment.'
        : 'Not yet — failures are CORS/immediate class, not sustained mid-stream drops on fresh URLs.';

  const executiveSummary =
    successes.length === results.length
      ? `All ${results.length} probes succeeded with independent presigned URLs across ${Object.keys(byTier).length} size tier(s).`
      : `${successes.length}/${results.length} probes succeeded. Failures: ${failures.map((f) => `Probe ${f.probe} ${f.sizeTierMb}MB (${f.classification})`).join('; ') || 'none'}.`;

  const recommendation =
    failures.some((f) => f.classification === 'cors_blocked')
      ? 'Apply `r2-cors.json` to the live R2 bucket before re-testing Probe D. '
      : '';
  const rec2 =
    failures.some((f) => f.classification === 'midstream_gateway_error' || f.classification === 'midstream_connection_drop')
      ? 'Investigate mid-stream 502/drops with parallel fresh-URL runs from user uplink; consider resumable uploads only if reproduced with byte progress evidence.'
      : 'Do not implement multipart/resumable uploads until Path B mid-stream failure reproduces on fresh URLs from a production-like uplink.';

  return {
    failureClassification,
    tierSummaries,
    executiveSummary,
    recommendation: recommendation + rec2,
    answers: {
      freshUrlEliminatesFailures: freshUrlEliminates,
      browserOnly,
      netlifyOnly,
      sizeCorrelation: sizeCorrelation,
      resumableJustified
    }
  };
}

async function main() {
  const tiers = [...SIZE_TIERS_MB];
  if (RUN_STRESS_500 && !tiers.includes(500)) tiers.push(500);

  const token = await apiLogin();
  const htmlDir = path.join('/tmp', `r2-reliability-html-${Date.now()}`);
  fs.mkdirSync(htmlDir, { recursive: true });
  const htmlPath = writeBrowserHarness(htmlDir);

  const allResults = [];
  const fixtures = {};

  for (const tierMb of tiers) {
    const sizeBytes = tierMb * 1024 * 1024;
    console.log(`[reliability] Preparing ${tierMb}MB fixture`);
    const fixture = ensureFixture(sizeBytes);
    fixtures[tierMb] = { path: fixture.filePath, sizeBytes: fixture.sizeBytes };
    const servers = await startLocalServers(htmlPath, fixture.filePath);
    try {
      const tierResults = await runTier(token, fixture, tierMb, servers);
      allResults.push(...tierResults);
    } finally {
      servers.fileServer.close();
      servers.pageServer.close();
    }
  }

  const analysis = analyzeResults(allResults);
  const report = {
    mission: 'R2-UPLOAD-RELIABILITY-02',
    timestamp: isoNow(),
    environment: {
      apiUrl: API_URL,
      netlifyOrigin: NETLIFY_ORIGIN,
      localOrigin: LOCAL_ORIGIN,
      sizeTiersMb: tiers,
      uploadTimeoutMs: UPLOAD_TIMEOUT_MS,
      probes: PROBES,
      browserMaxMb: BROWSER_MAX_MB
    },
    flow: {
      signEndpoint: `${API_URL}/api/uploads/sign`,
      ttlSeconds: 3600,
      maxBytes: 536870912,
      signedHeaders: 'content-type;host',
      putUrlSingleUse: false,
      frontendHelper: 'uploadVideoSigned() in frontend/src/lib/api/media.js',
      r2Implementation: 'presigned_put_url() in backend/src/storage/r2.rs'
    },
    fixtures,
    results: allResults,
    ...analysis
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUT_MD, renderMarkdown(report));
  const backupJson = OUT_JSON.replace('.json', `-${Date.now()}.json`);
  fs.copyFileSync(OUT_JSON, backupJson);
  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Wrote ${OUT_MD}`);
  console.log(`Backup ${backupJson}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
