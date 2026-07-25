#!/usr/bin/env node
/**
 * BG7X-R2-PUT-01 — sign → curl PUT → finalize E2E (outside browser).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts/bg7x-r2-put-01.json');
const API_URL = (process.env.API_URL || 'https://reelforge-deploy-production.up.railway.app').replace(/\/$/, '');
const PUT_TIMEOUT_MS = Number(process.env.PUT_TIMEOUT_MS || 900000);

const CASES = [
  {
    id: 'mov_18mb',
    label: 'MICROS_STIRRED_V3.MOV',
    path: '/home/youloose2dafish/projects/reelforge/public/videos/0b41788c-e751-4a69-9831-8d87f566e4cd.mov',
    fileName: 'MICROS_STIRRED_V3.MOV',
    contentType: 'video/quicktime'
  },
  {
    id: 'mp4_362mb',
    label: 'condo_v1_2.mp4',
    path: '/home/youloose2dafish/projects/reelforge/public/videos/d1b48f55-51e1-40d3-a563-f46cb61643c6.mp4',
    fileName: 'condo_v1_2.mp4',
    contentType: 'video/mp4'
  }
];

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

function parsePresignedUrl(url) {
  const u = new URL(url);
  const q = Object.fromEntries(u.searchParams.entries());
  return {
    host: u.host,
    objectKey: u.pathname.split('/').slice(2).join('/'),
    signedHeaders: q['X-Amz-SignedHeaders'] || null,
    expiresSec: q['X-Amz-Expires'] || null,
    algorithm: q['X-Amz-Algorithm'] || null,
    xId: q['x-id'] || null
  };
}

async function signUpload(token, fixture) {
  const sizeBytes = fs.statSync(fixture.path).size;
  const t0 = Date.now();
  const res = await fetch(`${API_URL}/api/uploads/sign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      filename: fixture.fileName,
      contentType: fixture.contentType,
      sizeBytes,
      title: `BG7X-R2-PUT-01-${fixture.id}`,
      category: 'Trending'
    })
  });
  const body = await res.json().catch(() => ({}));
  return {
    http: res.status,
    durationMs: Date.now() - t0,
    body,
    sizeBytes,
    presigned: body.uploadUrl ? parsePresignedUrl(body.uploadUrl) : null
  };
}

function classifyPutFailure(meta, stderr, exitCode) {
  const err = String(stderr || '');
  if (/timed out|timeout/i.test(err)) {
    return { layer: 'client_timeout', detail: err.slice(0, 300) };
  }
  if (meta.http && meta.http !== '000' && Number(meta.http) >= 400) {
    return { layer: 'r2_rejection', detail: `HTTP ${meta.http}` };
  }
  if (exitCode !== 0 && (!meta.http || meta.http === '000')) {
    if (/SSL|TLS|connection reset|Broken pipe|Empty reply/i.test(err)) {
      return { layer: 'network_stall', detail: err.slice(0, 300) };
    }
    return { layer: 'network_stall', detail: err.slice(0, 300) || `exit=${exitCode}` };
  }
  return { layer: 'none', detail: null };
}

function curlPutProbe(uploadUrl, filePath, headers, label) {
  const hdrPath = `/tmp/bg7x-r2-put-${label}.hdr`;
  const bodyPath = `/tmp/bg7x-r2-put-${label}.body`;
  const args = [
    '-sS',
    '-D',
    hdrPath,
    '-o',
    bodyPath,
    '-w',
    '__META__%{http_code}|%{time_namelookup}|%{time_connect}|%{time_appconnect}|%{time_starttransfer}|%{time_total}|%{size_upload}|%{speed_upload}|%{http_version}'
  ];
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  args.push('-X', 'PUT', '--data-binary', `@${filePath}`, uploadUrl);

  const uploadStart = new Date().toISOString();
  const t0 = Date.now();
  const p = spawnSync('curl', args, { encoding: 'utf8', timeout: PUT_TIMEOUT_MS });
  const uploadEnd = new Date().toISOString();
  const out = p.stdout || '';
  const meta = out.includes('__META__') ? out.split('__META__')[1].trim().split('|') : [];
  const hdr = fs.existsSync(hdrPath) ? fs.readFileSync(hdrPath, 'utf8') : '';
  const responseBody = fs.existsSync(bodyPath) ? fs.readFileSync(bodyPath, 'utf8').slice(0, 500) : '';

  const result = {
    label,
    uploadStart,
    uploadEnd,
    durationMs: Date.now() - t0,
    exitCode: p.status,
    stderr: (p.stderr || '').slice(0, 500),
    http: meta[0] || null,
    timeNameLookupSec: meta[1] || null,
    timeConnectSec: meta[2] || null,
    timeAppConnectSec: meta[3] || null,
    timeStartTransferSec: meta[4] || null,
    timeTotalSec: meta[5] || null,
    sizeUpload: meta[6] || null,
    speedUpload: meta[7] || null,
    httpVersion: meta[8] || null,
    timeToFirstByteSec: meta[4] || null,
    cfRay: (hdr.match(/cf-ray:\s*(.+)/i) || [])[1]?.trim() || null,
    xAmzRequestId: (hdr.match(/x-amz-request-id:\s*(.+)/i) || [])[1]?.trim() || null,
    responseHeaders: hdr.split('\r\n').slice(0, 15),
    responseBodyPreview: responseBody
  };
  result.failureClass = classifyPutFailure(result, p.stderr, p.status);
  return result;
}

async function finalizeUpload(token, uploadId) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${API_URL}/api/reels/finalize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        uploadId,
        title: `BG7X-R2-PUT-01 finalize ${uploadId.slice(0, 8)}`,
        category: 'Trending'
      })
    });
    const body = await res.json().catch(() => ({}));
    return {
      http: res.status,
      durationMs: Date.now() - t0,
      body,
      error: null
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return {
      http: null,
      durationMs: Date.now() - t0,
      body: null,
      error: {
        name: err.name,
        message: err.message,
        cause: err.cause ? String(err.cause) : null,
        layer: /ETIMEDOUT|HeadersTimeout|timeout/i.test(`${err.message}${err.cause}`)
          ? 'client_timeout'
          : 'network_stall'
      }
    };
  }
}

async function runCase(token, fixture) {
  if (!fs.existsSync(fixture.path)) {
    return {
      id: fixture.id,
      skipped: true,
      reason: `fixture missing: ${fixture.path}`
    };
  }

  const sign = await signUpload(token, fixture);
  if (sign.http !== 200 || !sign.body?.uploadUrl) {
    return {
      id: fixture.id,
      fixture: { ...fixture, sizeBytes: sign.sizeBytes },
      sign,
      boundary: 'sign_failed',
      put: null,
      finalize: null
    };
  }

  const putHeaders = { 'Content-Type': fixture.contentType };
  const put = curlPutProbe(sign.body.uploadUrl, fixture.path, putHeaders, fixture.id);

  let finalize = null;
  let boundary = 'put_failed';
  if (put.http && Number(put.http) >= 200 && Number(put.http) < 300) {
    finalize = await finalizeUpload(token, sign.body.uploadId);
    if (finalize.error) {
      boundary = finalize.error.layer === 'client_timeout' ? 'finalize_client_timeout' : 'finalize_network_error';
    } else if (finalize.http >= 200 && finalize.http < 300) {
      boundary = 'e2e_success';
    } else {
      boundary = 'finalize_failed';
    }
  } else {
    boundary = put.failureClass.layer === 'client_timeout' ? 'put_client_timeout' : 'put_failed';
  }

  return {
    id: fixture.id,
    fixture: {
      label: fixture.label,
      fileName: fixture.fileName,
      contentType: fixture.contentType,
      sizeBytes: sign.sizeBytes
    },
    presignedRequirements: {
      contentTypeMustMatchSign: fixture.contentType,
      contentLengthBehavior: 'curl sets Content-Length from file size automatically',
      requiredUploadHeaders: ['Content-Type (must match signed content-type)'],
      omitHeaders: ['X-Upload-Token (Railway direct only; omitted for R2)'],
      method: 'PUT',
      expiresSec: sign.presigned?.expiresSec || null,
      signedHeaders: sign.presigned?.signedHeaders || null
    },
    sign,
    put,
    finalize,
    boundary
  };
}

async function main() {
  const token = await apiLogin();
  const selected = process.env.CASES
    ? CASES.filter((c) => process.env.CASES.split(',').map((s) => s.trim()).includes(c.id))
    : CASES;

  const results = [];
  for (const fixture of selected) {
    console.log(`[BG7X_R2_PUT] running ${fixture.id} (${fixture.label})`);
    results.push(await runCase(token, fixture));
  }

  const report = {
    mission: 'BG7X-R2-PUT-01',
    timestamp: new Date().toISOString(),
    apiUrl: API_URL,
    putTimeoutMs: PUT_TIMEOUT_MS,
    results,
    summary: {
      boundaries: results.map((r) => ({ id: r.id, boundary: r.boundary || r.reason })),
      firstFailingBoundary:
        results.find((r) => r.boundary && r.boundary !== 'e2e_success')?.boundary ||
        (results.every((r) => r.boundary === 'e2e_success') ? 'none' : 'unknown')
    }
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`Wrote ${OUT}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
