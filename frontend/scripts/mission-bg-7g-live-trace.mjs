#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:5173/';
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8080';
const OUT = process.env.OUT || '/tmp/bg-7g-live-trace.json';
const CHROMIUM = '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const TAGS = ['[BG7G_DROP]', '[BG7G_UPLOAD]', '[BG7G_API]', '[BG7G_STORE]', '[BG7G_RENDER]'];
const EXPECTED = ['[BG7G_DROP]', '[BG7G_UPLOAD]', '[BG7G_API]', '[BG7G_STORE]', '[BG7G_RENDER]'];

function ensureMp4() {
  const p = '/tmp/bg7g-live-trace.mp4';
  if (!fs.existsSync(p)) {
    execSync(
      `ffmpeg -y -f lavfi -i color=c=green:s=640x360:d=2 -c:v libx264 -pix_fmt yuv420p -movflags +faststart ${p}`,
      { stdio: 'ignore' }
    );
  }
  const st = fs.statSync(p);
  if (st.size > 50 * 1024 * 1024) throw new Error('test mp4 too large');
  return p;
}

async function parseConsole(msg) {
  const parts = [];
  for (const arg of msg.args()) {
    try { parts.push(await arg.jsonValue()); } catch { parts.push(arg.toString()); }
  }
  const tag = parts.find((p) => typeof p === 'string' && TAGS.some((t) => p.startsWith(t)));
  const payload = parts.find((p) => p && typeof p === 'object' && !Array.isArray(p)) || null;
  return { tag: tag || null, payload, text: msg.text(), level: msg.type(), ts: new Date().toISOString() };
}

function tagName(entry) {
  if (entry.tag) return entry.tag.replace('[', '').replace(']', '');
  for (const t of TAGS) if (entry.text?.includes(t)) return t.slice(1, -1);
  return null;
}

function analyzeCase(logs, networkPosts) {
  const ordered = logs.filter((l) => tagName(l));
  const last = ordered.at(-1) || null;
  const seen = new Set(ordered.map((l) => {
    for (const t of TAGS) if ((l.tag || l.text || '').includes(t)) return t;
    return null;
  }).filter(Boolean));
  let firstMissing = null;
  for (const t of EXPECTED) {
    if (!seen.has(t)) { firstMissing = t; break; }
  }
  const post = networkPosts.find((p) => p.method === 'POST' && p.url.includes('/api/reels'));
  const postResp = networkPosts.find((p) => p.phase === 'response' && p.url.includes('/api/reels'));
  const storeOk = [...seen].includes('[BG7G_STORE]') && ordered.some((l) => (l.payload?.state === 'success' || l.text?.includes('success')));
  const renderOk = seen.has('[BG7G_RENDER]');
  return {
    logCount: ordered.length,
    logs: ordered,
    lastSuccessful: last,
    firstMissingExpected: firstMissing,
    postOccurred: Boolean(post || postResp),
    postStatus: postResp?.status ?? null,
    postReelId: postResp?.body?.id ?? null,
    storeMutation: storeOk,
    renderUpdate: renderOk,
    seenTags: [...seen]
  };
}

async function openStudio(page) {
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.ghost-trigger', { timeout: 60000 });
  await page.click('.ghost-trigger');
  const pw = page.locator('.admin-login-panel input[type="password"]').first();
  if (await pw.count()) {
    await pw.fill(process.env.ADMIN_PASSWORD || 'Gaff1505!');
    const btn = page.locator('.admin-login-panel .submit-btn').first();
    if (await btn.count()) await btn.click(); else await pw.press('Enter');
  }
  await page.waitForSelector('.control-center-container', { timeout: 60000 });
  const tab = page.locator('button[role="tab"]').filter({ hasText: 'Content' }).first();
  if (await tab.count()) await tab.click();
  else await page.click('#workspace-tab-content').catch(() => {});
  await page.waitForTimeout(1500);
  await page.waitForSelector('.video-vault-drop', { timeout: 60000 });
}

async function syntheticDrop(page, selector, filePath, mime = 'video/mp4') {
  const b64 = fs.readFileSync(filePath).toString('base64');
  const fileName = path.basename(filePath);
  return page.evaluate(async ({ sel, mp4B64, name, mimeType }) => {
    const target = document.querySelector(sel);
    if (!target) throw new Error(`Missing selector ${sel}`);
    const bytes = Uint8Array.from(atob(mp4B64), (c) => c.charCodeAt(0));
    const file = new File([bytes], name, { type: mimeType });
    const dt = new DataTransfer();
    dt.items.add(file);
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
    target.dispatchEvent(new DragEvent('dragenter', opts));
    target.dispatchEvent(new DragEvent('dragover', opts));
    target.dispatchEvent(new DragEvent('drop', opts));
    return { selector: sel, fileName: name, fileSize: file.size };
  }, { sel: selector, mp4B64: b64, name: fileName, mimeType: mime });
}

async function main() {
  const mp4 = ensureMp4();
  const report = { generatedAt: new Date().toISOString(), frontendUrl: FRONTEND_URL, apiBase: API_BASE, mp4, caseA: {}, caseB: {}, errors: [] };
  const launch = { headless: true };
  if (fs.existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;
  const browser = await chromium.launch(launch);
  const context = await browser.newContext();
  await context.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_admin_session_token', 'rf_bg7g_live_trace');
  });

  async function runCase(name, dropFn, waitMs = 45000) {
    const page = await context.newPage();
    const logs = [];
    const networkPosts = [];
    page.on('console', async (msg) => {
      const text = msg.text();
      if (!TAGS.some((t) => text.includes(t))) return;
      try { logs.push(await parseConsole(msg)); } catch (e) { report.errors.push(String(e)); }
    });
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/reels')) {
        networkPosts.push({ phase: 'request', method: 'POST', url: req.url(), ts: new Date().toISOString() });
      }
    });
    page.on('response', async (res) => {
      if (res.request().method() === 'POST' && res.url().includes('/api/reels')) {
        let body = null;
        try { body = await res.json(); } catch { body = null; }
        networkPosts.push({ phase: 'response', status: res.status(), url: res.url(), body, ts: new Date().toISOString() });
      }
    });
    try {
      await openStudio(page);
      const start = logs.length;
      const netStart = networkPosts.length;
      await dropFn(page, mp4);
      const deadline = Date.now() + waitMs;
      while (Date.now() < deadline) {
        const hasApi = networkPosts.slice(netStart).some((n) => n.phase === 'response');
        const hasRender = logs.slice(start).some((l) => (l.tag || l.text || '').includes('[BG7G_RENDER]'));
        const hasFail = logs.slice(start).some((l) => l.payload?.state === 'failure');
        if (hasRender || hasFail || (hasApi && Date.now() > deadline - 10000)) break;
        await page.waitForTimeout(500);
      }
      await page.waitForTimeout(3000);
      const slice = logs.slice(start);
      const netSlice = networkPosts.slice(netStart);
      const analysis = analyzeCase(slice, netSlice);
      report[name] = { drop: await dropFn.meta, analysis, logs: slice, network: netSlice };
    } catch (e) {
      report[name] = { error: String(e?.stack || e), logs, network: networkPosts };
      report.errors.push(`${name}: ${e}`);
    } finally {
      await page.close();
    }
  }

  async function vaultDrop(page, file) {
    return syntheticDrop(page, '.video-vault-drop', file);
  }
  vaultDrop.meta = { target: '.video-vault-drop', label: 'Video Vault DROP VIDEO HERE' };

  async function heroDrop(page, file) {
    await page.evaluate(() => document.querySelector('.hero-replace-section')?.scrollIntoView({ block: 'center' }));
    await page.waitForSelector('.hero-drop-zone', { timeout: 30000 });
    return syntheticDrop(page, '.hero-drop-zone', file);
  }
  heroDrop.meta = { target: '.hero-drop-zone', label: 'Hero Replace Background drop zone' };

  await runCase('caseA', vaultDrop, 90000);
  await runCase('caseB', heroDrop, 120000);

  // enrich with source line lookup for first failure
  function failureStage(analysis) {
    const last = analysis.lastSuccessful;
    if (!last) return { stage: 'pre-drop', fn: 'unknown', file: 'unknown', line: null };
    const p = last.payload || {};
    return {
      stage: p.state || 'unknown',
      fn: p.component || null,
      file: p.file || null,
      evidence: last
    };
  }
  report.caseA.forensic = failureStage(report.caseA.analysis || {});
  report.caseB.forensic = failureStage(report.caseB.analysis || {});

  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('OUT=' + OUT);
  console.log('CASE_A_LOGS=' + (report.caseA.analysis?.logCount ?? 0));
  console.log('CASE_B_LOGS=' + (report.caseB.analysis?.logCount ?? 0));
  console.log(JSON.stringify({ caseA: report.caseA.analysis, caseB: report.caseB.analysis }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
