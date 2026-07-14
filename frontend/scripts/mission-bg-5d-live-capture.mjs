#!/usr/bin/env node
/** MISSION BG-5D — Live Render Gate Capture (diagnostics only) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:5173/';
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8080';
const OUT_JSON = path.join(__dirname, '..', 'artifacts', 'bg-5d-live-capture.json');
const VAULT_MP4 =
  process.env.VAULT_MP4 ||
  '/home/youloose2dafish/projects/reelforge/backend/public/videos/032ae0fc-ad18-47ad-8ea5-416583504ce0.mp4';
const HERO_MP4 =
  process.env.HERO_MP4 ||
  '/home/youloose2dafish/projects/reelforge/backend/public/videos/hero-background.mp4';
const CHROMIUM =
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const capture = {
  generatedAt: new Date().toISOString(),
  frontendUrl: FRONTEND_URL,
  apiBase: API_BASE,
  renderGateLogs: [],
  pipelineLogs: [],
  networkPosts: [],
  errors: []
};

async function serializeConsoleMsg(msg) {
  const parts = [];
  for (const arg of msg.args()) {
    try {
      parts.push(await arg.jsonValue());
    } catch {
      parts.push(arg.toString());
    }
  }
  const tag = parts.find((p) => typeof p === 'string' && p.startsWith('[RENDER_GATE]')) || msg.text();
  const payload = parts.find((p) => p && typeof p === 'object' && !Array.isArray(p)) || null;
  return { tag, payload, text: msg.text(), level: msg.type() };
}

function pushStructured(bucket, entry) {
  bucket.push({
    ts: new Date().toISOString(),
    wallMs: Date.now(),
    ...entry
  });
}

async function openStudioContent(page) {
  await page.goto(FRONTEND_URL, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.waitForSelector('.ghost-trigger', { timeout: 60000 });
  await page.click('.ghost-trigger');
  const passwordInput = page.locator('input[type="password"]').first();
  if (await passwordInput.count()) {
    await passwordInput.fill('Gaff1505!');
    await page.click('button:has-text("UNLOCK STUDIO")');
    await page.waitForTimeout(600);
  }
  await page.waitForSelector('.control-center-container', { timeout: 60000 });
  await page.click('button[role="tab"]:has-text("Content")').catch(() =>
    page.click('#workspace-tab-content')
  );
  await page.waitForTimeout(1000);
  await page.waitForSelector('.video-vault-drop', { timeout: 60000 });
}

async function dropVaultMp4(page, filePath) {
  const b64 = fs.readFileSync(filePath).toString('base64');
  const fileName = `bg5d-vault-${Date.now()}.mp4`;
  await page.evaluate(
    async ({ mp4B64, name }) => {
      const target = document.querySelector('.video-vault-drop');
      if (!target) throw new Error('Missing .video-vault-drop');
      const bytes = Uint8Array.from(atob(mp4B64), (c) => c.charCodeAt(0));
      const file = new File([bytes], name, { type: 'video/mp4' });
      const dt = new DataTransfer();
      dt.items.add(file);
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    },
    { mp4B64: b64, name: fileName }
  );
  return fileName;
}

async function waitForReelReady(reelId, maxMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`${API_BASE}/api/reels/${reelId}`);
      if (res.ok) {
        const body = await res.json();
        if (body?.status === 'ready' || body?.url) return body;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

async function scrollToHeroReplace(page) {
  await page.evaluate(() => {
    const el = document.querySelector('.hero-replace-section');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForSelector('.hero-replace-section', { timeout: 60000 });
}

async function main() {
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });

  const launch = { headless: true };
  if (fs.existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;

  const browser = await chromium.launch(launch);
  const context = await browser.newContext();
  await context.addInitScript(() => {
    if (sessionStorage.getItem('bg5d_boot')) return;
    sessionStorage.setItem('bg5d_boot', '1');
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_admin_session_token', 'rf_bg5d_capture');
  });
  const page = await context.newPage();

  page.on('console', async (msg) => {
    const text = msg.text();
    try {
      if (text.includes('[RENDER_GATE]')) {
        const parsed = await serializeConsoleMsg(msg);
        pushStructured(capture.renderGateLogs, parsed);
      } else if (text.includes('[PIPELINE]')) {
        const parsed = await serializeConsoleMsg(msg);
        pushStructured(capture.pipelineLogs, parsed);
      }
    } catch (err) {
      capture.errors.push(`console parse: ${err?.message || err}`);
    }
  });

  page.on('response', async (res) => {
    const url = res.url();
    if (res.request().method() === 'POST' && url.includes('/api/reels')) {
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      capture.networkPosts.push({
        ts: new Date().toISOString(),
        status: res.status(),
        url,
        body
      });
    }
  });

  capture.vaultTest = {};
  capture.heroTest = {};

  try {
    await openStudioContent(page);

    const vaultGateStart = capture.renderGateLogs.length;
    const vaultPipeStart = capture.pipelineLogs.length;
    const vaultPostStart = capture.networkPosts.length;

    capture.vaultTest.dropAt = new Date().toISOString();
    capture.vaultTest.dropFileName = await dropVaultMp4(page, VAULT_MP4);

    let postedReelId = null;
    const postDeadline = Date.now() + 30000;
    while (Date.now() < postDeadline && !postedReelId) {
      const posts = capture.networkPosts.slice(vaultPostStart);
      const hit = posts.find((p) => p.body?.id);
      if (hit) postedReelId = hit.body.id;
      await page.waitForTimeout(300);
    }
    capture.vaultTest.postReelId = postedReelId;

    if (postedReelId) {
      capture.vaultTest.apiReady = await waitForReelReady(postedReelId, 120000);
    }

    await page.waitForTimeout(10000);

    capture.vaultTest.renderGateSlice = capture.renderGateLogs.slice(vaultGateStart);
    capture.vaultTest.pipelineSlice = capture.pipelineLogs.slice(vaultPipeStart);
    capture.vaultTest.postSlice = capture.networkPosts.slice(vaultPostStart);

    await scrollToHeroReplace(page);
    const heroGateStart = capture.renderGateLogs.length;
    const heroPostStart = capture.networkPosts.length;

    const heroFileName = `bg5d-hero-${Date.now()}.mp4`;
    const heroInput = page.locator('.hero-replace-section input[type="file"]').first();
    await heroInput.setInputFiles({
      name: heroFileName,
      mimeType: 'video/mp4',
      buffer: fs.readFileSync(HERO_MP4)
    });
    capture.heroTest.fileSelectedAt = new Date().toISOString();

    const acceptBtn = page.locator('.hero-replace-section .accept-btn').first();
    await acceptBtn.waitFor({ state: 'visible', timeout: 15000 });
    await acceptBtn.click({ timeout: 5000 });
    capture.heroTest.acceptAt = new Date().toISOString();

    const processing = page.locator('.hero-replace-section .hero-loading-indicator:has-text("Processing hero asset")');
    try {
      await processing.waitFor({ state: 'visible', timeout: 8000 });
    } catch {
      // may resolve quickly
    }
    try {
      await processing.waitFor({ state: 'hidden', timeout: 120000 });
    } catch {
      capture.errors.push('Hero processing indicator did not clear within 120s');
    }

    await page.waitForTimeout(3000);
    capture.heroTest.preReloadSlice = capture.renderGateLogs.slice(heroGateStart);
    capture.heroTest.preReloadPosts = capture.networkPosts.slice(heroPostStart);

    const reloadGateStart = capture.renderGateLogs.length;
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(6000);
    capture.heroTest.postReloadSlice = capture.renderGateLogs.slice(reloadGateStart);
  } catch (err) {
    capture.errors.push(err?.stack || String(err));
  } finally {
    await browser.close();
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(capture, null, 2));
  console.log(`BG5D_CAPTURE_JSON=${OUT_JSON}`);
  console.log(`RENDER_GATE_COUNT=${capture.renderGateLogs.length}`);
  console.log(`ERRORS=${capture.errors.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
