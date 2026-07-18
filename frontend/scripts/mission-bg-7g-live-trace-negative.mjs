#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:5173/';
const CHROMIUM = '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const TAGS = ['[BG7G_DROP]', '[BG7G_UPLOAD]', '[BG7G_API]', '[BG7G_STORE]', '[BG7G_RENDER]'];

function ensureMp4() {
  const p = '/tmp/bg7g-live-trace.mp4';
  if (!fs.existsSync(p)) {
    execSync(`ffmpeg -y -f lavfi -i color=c=green:s=640x360:d=2 -c:v libx264 -pix_fmt yuv420p -movflags +faststart ${p}`, { stdio: 'ignore' });
  }
  return p;
}

async function dropOn(page, selector, filePath) {
  const b64 = fs.readFileSync(filePath).toString('base64');
  const name = path.basename(filePath);
  return page.evaluate(async ({ sel, mp4B64, name }) => {
    const target = document.querySelector(sel);
    if (!target) return { ok: false, reason: 'missing_target', selector: sel };
    const bytes = Uint8Array.from(atob(mp4B64), (c) => c.charCodeAt(0));
    const file = new File([bytes], name, { type: 'video/mp4' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
    target.dispatchEvent(new DragEvent('dragenter', opts));
    target.dispatchEvent(new DragEvent('dragover', opts));
    target.dispatchEvent(new DragEvent('drop', opts));
    return { ok: true, selector: sel, fileName: name, fileSize: file.size };
  }, { sel: selector, mp4B64: b64, name });
}

async function runScenario(name, fn) {
  const launch = { headless: true };
  if (fs.existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;
  const browser = await chromium.launch(launch);
  const context = await browser.newContext();
  const page = await context.newPage();
  const logs = [];
  const posts = [];
  page.on('console', (msg) => {
    const t = msg.text();
    if (TAGS.some((tag) => t.includes(tag))) logs.push({ text: t, ts: new Date().toISOString() });
  });
  page.on('response', async (res) => {
    if (res.request().method() === 'POST' && res.url().includes('/api/reels')) {
      posts.push({ status: res.status(), url: res.url() });
    }
  });
  let result = {};
  try { result = await fn(page, ensureMp4()); } catch (e) { result = { error: String(e) }; }
  await browser.close();
  return { name, result, bg7gLogCount: logs.length, logs, postCount: posts.length, posts };
}

async function main() {
  const scenarios = [];

  scenarios.push(await runScenario('homepage_hero_stage_no_studio', async (page, mp4) => {
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const hasStage = await page.locator('.hero-stage').count();
    const hasDropZone = await page.locator('.hero-drop-zone').count();
    const drop = await dropOn(page, '.hero-stage', mp4);
    return { hasStage, hasDropZone, drop };
  }));

  scenarios.push(await runScenario('studio_closed_vault_on_blurred_main', async (page, mp4) => {
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const drop = await dropOn(page, '.video-vault-drop', mp4);
    const vaultVisible = await page.locator('.video-vault-drop').count();
    return { drop, vaultVisible, studioOpen: await page.locator('.control-center-container').count() };
  }));

  scenarios.push(await runScenario('hero_replace_without_content_tab', async (page, mp4) => {
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
    await page.click('.ghost-trigger');
    const pw = page.locator('.admin-login-panel input[type="password"]').first();
    if (await pw.count()) { await pw.fill('Gaff1505!'); await page.locator('.admin-login-panel .submit-btn').first().click(); }
    await page.waitForSelector('.control-center-container');
    // stay on default tab, not Content
    const heroVisible = await page.locator('.hero-drop-zone').count();
    const drop = await dropOn(page, '.hero-drop-zone', mp4);
    return { heroVisible, drop };
  }));

  scenarios.push(await runScenario('drop_only_no_dragover_vault', async (page, mp4) => {
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
    await page.click('.ghost-trigger');
    const pw = page.locator('.admin-login-panel input[type="password"]').first();
    if (await pw.count()) { await pw.fill('Gaff1505!'); await page.locator('.admin-login-panel .submit-btn').first().click(); }
    await page.waitForSelector('.control-center-container');
    await page.locator('button[role="tab"]').filter({ hasText: 'Content' }).first().click();
    await page.waitForSelector('.video-vault-drop');
    const b64 = fs.readFileSync(mp4).toString('base64');
    const res = await page.evaluate(async ({ mp4B64, name }) => {
      const target = document.querySelector('.video-vault-drop');
      const bytes = Uint8Array.from(atob(mp4B64), (c) => c.charCodeAt(0));
      const file = new File([bytes], name, { type: 'video/mp4' });
      const dt = new DataTransfer(); dt.items.add(file);
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
      return true;
    }, { mp4B64: b64, name: path.basename(mp4) });
    await page.waitForTimeout(5000);
    return { dropOnly: res };
  }));

  console.log(JSON.stringify(scenarios, null, 2));
}
main();
