#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { chromium } from 'playwright';

const FRONTEND_URL = 'https://strong-lolly-a9fcb4.netlify.app/';
const API_URL = 'https://reelforge-deploy-production.up.railway.app';
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const thumb = '/tmp/vh03-playwright-thumb.jpg';
if (!fs.existsSync(thumb)) {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=320x240:d=0.1', '-frames:v', '1', thumb]);
}

async function getLs(page, key) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), key);
}

async function main() {
  const logs = [];
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  const context = await browser.newContext();
  context.on('page', (p) => p.on('dialog', (d) => d.accept().catch(() => {})));
  await context.addInitScript(() => {
    if (sessionStorage.getItem('vh03t')) return;
    sessionStorage.setItem('vh03t', '1');
    localStorage.clear();
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (/\[VAULT_|\[DELETE_/.test(t)) logs.push(t.slice(0, 300));
  });
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (!(await page.locator('.control-center-overlay').isVisible().catch(() => false))) {
    await page.locator('button.ghost-trigger').click();
  }
  if (await page.locator('.admin-login-panel').isVisible().catch(() => false)) {
    await page.locator('.admin-login-panel input[type="password"]').fill('admin123');
    await page.locator('.admin-login-panel button.submit-btn').click();
    await sleep(2000);
  }
  await page.locator('[data-studio-workspace-tabs] button', { hasText: 'Content' }).click().catch(() => {});
  await page.waitForSelector('.thumbnail-drop-zone', { timeout: 60000 });

  const buf = fs.readFileSync(thumb);
  await page.evaluate(({ b64, name }) => {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    const file = new File([out], name, { type: 'image/jpeg' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const common = { dataTransfer: dt, bubbles: true, cancelable: true };
    const target = document.querySelector('.thumbnail-drop-zone');
    target.dispatchEvent(new DragEvent('dragenter', common));
    target.dispatchEvent(new DragEvent('dragover', common));
    target.dispatchEvent(new DragEvent('drop', common));
  }, { b64: buf.toString('base64'), name: path.basename(thumb) });

  await page.waitForSelector('.thumbnail-drop-zone .accept-btn', { timeout: 30000 });
  const postP = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/reels(\?|$)/.test(r.url()), { timeout: 120000 });
  await page.click('.thumbnail-drop-zone .accept-btn');
  const postRes = await postP;
  const postBody = await postRes.json().catch(() => ({}));
  await page.waitForFunction(() => {
    try {
      const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
      const ids = JSON.parse(localStorage.getItem('personal_thumbnail_reel_ids') || '[]');
      return thumbs.length > 0 && ids.length > 0;
    } catch { return false; }
  }, { timeout: 60000 }).catch(() => null);
  const thumbs = await getLs(page, 'personal_thumbnails');
  const ids = await getLs(page, 'personal_thumbnail_reel_ids');
  console.log('ACCEPT', { post: postRes.status(), id: postBody.id, thumbs: thumbs?.length, ids });

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(8000);
  const after = await getLs(page, 'personal_thumbnails');
  const idsAfter = await getLs(page, 'personal_thumbnail_reel_ids');
  const survives = Array.isArray(after) && after.some((e) => String(e.id) === String(postBody.id));
  console.log('REFRESH', { survives, count: after?.length, idsAfter });

  await browser.close();
  console.log('LOGS', logs.slice(-20));
}

main().catch((e) => { console.error(e); process.exit(1); });
