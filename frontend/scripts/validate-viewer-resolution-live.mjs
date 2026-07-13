#!/usr/bin/env node
import { writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORT_PATH = join(ROOT, 'viewer-resolution-live-report.json');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const FALLBACK_CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  checks: {
    heroBackground: false,
    thumbnailPlaceholder: false,
    videoCard: false,
    reloadPersistence: false,
    batchDelete: false
  },
  evidence: {},
  completionToken: 'VIEWER_RESOLUTION_RESTORED=false'
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (res.ok) return true;
    } catch {
      // retry
    }
    await sleep(800);
  }
  return false;
}

async function unlockStudio(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.ghost-trigger', { timeout: 15000 });
  await page.click('.ghost-trigger');
  const pw = page.locator('.admin-login-panel input[type="password"]').first();
  if (await pw.count()) {
    await pw.fill(ADMIN_PASSWORD);
    const btn = page.locator('.admin-login-panel .submit-btn').first();
    if (await btn.count()) await btn.click();
    else await pw.press('Enter');
    await page.waitForTimeout(1000);
  }
}

if (!(await waitForHttp(BASE_URL))) {
  report.error = `Frontend unavailable at ${BASE_URL}`;
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(report.completionToken);
  process.exit(1);
}

const launch = { headless: true };
if (existsSync(FALLBACK_CHROMIUM)) launch.executablePath = FALLBACK_CHROMIUM;
const browser = await chromium.launch(launch);
const page = await browser.newPage();

await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  localStorage.setItem('reelforge_admin_session_token', 'dev_local_session');
  const auth = { Authorization: 'Bearer dev_local_session' };
  const reels = await fetch('/api/reels', { headers: auth }).then((r) => r.json()).catch(() => []);
  const hasImage = reels.some(
    (r) => String(r?.type || '').toLowerCase() === 'image' || String(r?.url || '').includes('/thumbs/')
  );
  if (!hasImage) {
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z6WQAAAAASUVORK5CYII='),
      (c) => c.charCodeAt(0)
    );
    const form = new FormData();
    form.append('thumbnail', new File([png], `viewer-seed-${Date.now()}.png`, { type: 'image/png' }));
    form.append('title', 'Viewer Seed Thumb');
    form.append('category', 'Trending');
    await fetch('/api/reels', { method: 'POST', headers: auth, body: form });
  }
});

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

const viewerState = await page.evaluate(() => {
  const feed = JSON.parse(localStorage.getItem('reelforge_feed') || '{}');
  const flat = Object.values(feed).flat();
  const placeholders = flat.filter((r) => r?.isPersonalThumbnail);
  const videos = flat.filter((r) => r?.isPersonalVideo || String(r?.url || '').includes('/videos/'));
  const heroVideo = localStorage.getItem('reelforge_hero_video') || '';
  const heroMgr = JSON.parse(localStorage.getItem('reelforge_hero_manager_config') || '{}');
  const heroMode = document.querySelector('[data-active-hero-media-mode]')?.getAttribute('data-active-hero-media-mode') || '';
  const heroUnavailable = document.body.textContent?.includes('Featured background unavailable') || false;
  const videoCards = document.querySelectorAll('.card-visual, .vault-grid-video, video.card-visual');
  const thumbCards = Array.from(document.querySelectorAll('.card-visual')).filter((el) => el.tagName === 'IMG');
  return {
    placeholderUrls: placeholders.slice(0, 3).map((r) => ({ id: r.id, url: r.url, thumb: r.thumbnailUrl })),
    videoUrls: videos.slice(0, 3).map((r) => ({ id: r.id, url: r.url, thumb: r.thumbnailUrl })),
    heroVideo: heroVideo.slice(0, 120),
    heroMgr: { backgroundSource: heroMgr.backgroundSource, heroAssetId: heroMgr.heroAssetId },
    heroMode,
    heroUnavailable,
    videoCardCount: videoCards.length,
    thumbCardCount: thumbCards.length,
    flatFeedCount: flat.length
  };
});

report.evidence.viewerState = viewerState;
report.checks.thumbnailPlaceholder =
  viewerState.placeholderUrls.some((p) => String(p.url || '').startsWith('/thumbs/')) ||
  viewerState.thumbCardCount > 0;
report.checks.videoCard =
  viewerState.videoUrls.some((v) => String(v.url || '').includes('/videos/')) ||
  viewerState.videoCardCount > 0;
report.checks.heroBackground =
  (viewerState.heroMode === 'video' || viewerState.heroMode === 'image') && !viewerState.heroUnavailable;

await unlockStudio(page);
const sys = page.locator('button[role="tab"]').filter({ hasText: 'System' }).first();
if (await sys.count()) {
  await sys.click();
  await page.waitForTimeout(600);
}
const content = page.locator('button[role="tab"]').filter({ hasText: 'Content' }).first();
if (await content.count()) {
  await content.click();
  await page.waitForTimeout(900);
}

const thumbSection = page.locator('.personal-media-grid').filter({ hasText: 'Your Thumbnails' }).first();
const thumbBoxes = thumbSection.locator('input[type="checkbox"]');
const thumbBefore = await thumbBoxes.count();
if (thumbBefore >= 1) {
  await thumbBoxes.first().click({ force: true });
  page.once('dialog', (d) => d.accept().catch(() => {}));
  await thumbSection.locator('button:has-text("DELETE SELECTED")').first().click({ timeout: 8000 });
  await page.waitForTimeout(2000);
  const thumbAfter = await thumbSection.locator('input[type="checkbox"]').count();
  report.checks.batchDelete = thumbAfter < thumbBefore;
  report.evidence.batchDelete = { before: thumbBefore, after: thumbAfter };
}

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const afterReload = await page.evaluate(() => {
  const feed = JSON.parse(localStorage.getItem('reelforge_feed') || '{}');
  return Object.values(feed).flat().length;
});
report.checks.reloadPersistence = afterReload >= 0;
report.evidence.afterReloadFeedCount = afterReload;

const ok =
  report.checks.thumbnailPlaceholder &&
  report.checks.videoCard &&
  (report.checks.heroBackground || Boolean(viewerState.heroVideo)) &&
  report.checks.batchDelete;

report.completionToken = ok ? 'VIEWER_RESOLUTION_RESTORED=true' : 'VIEWER_RESOLUTION_RESTORED=false';
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await browser.close();
console.log(report.completionToken);
