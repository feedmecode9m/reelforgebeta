#!/usr/bin/env node
/** BG-7G — Fresh-session feed validation after Trending uploads */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app';
const OUT_JSON = '/tmp/bg7g-playwright-validation.json';
const OUT_SCREENSHOT = '/home/youloose2dafish/projects/reelforge/artifacts/bg-7g-feed-restore-screenshot.png';
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const report = {
  generatedAt: new Date().toISOString(),
  frontend: FRONTEND,
  checks: {},
  api: {},
  localStorage: {},
  dom: {},
  console: []
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const api = await fetchJson(`${FRONTEND}/api/reels`);
report.api = {
  status: api.status,
  count: Array.isArray(api.body) ? api.body.length : 0,
  hero: Array.isArray(api.body) ? api.body.filter((r) => String(r?.category || '').toUpperCase() === 'HERO').length : 0,
  trendingVideos: Array.isArray(api.body)
    ? api.body.filter((r) => r?.type === 'video' && String(r?.category || '').toUpperCase() !== 'HERO').length
    : 0,
  images: Array.isArray(api.body) ? api.body.filter((r) => r?.type === 'image').length : 0,
  feedReelIds: Array.isArray(api.body)
    ? api.body
        .filter((r) => r?.type === 'video' && String(r?.category || '').toUpperCase() !== 'HERO')
        .map((r) => r.id)
    : []
};

const launch = { headless: true };
if (fs.existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;
const browser = await chromium.launch(launch);
const context = await browser.newContext();
await context.addInitScript(() => {
  localStorage.clear();
  sessionStorage.clear();
});
const page = await context.newPage();

page.on('console', (msg) => {
  const text = msg.text();
  if (/DEMO_FEED|placeholder|syncFromVault|VAULT_SYNC/i.test(text)) {
    report.console.push({ type: msg.type(), text: text.slice(0, 500) });
  }
});

await page.goto(FRONTEND, { waitUntil: 'domcontentloaded', timeout: 120000 });
await sleep(10000);

await fs.promises.mkdir(path.dirname(OUT_SCREENSHOT), { recursive: true });
await page.screenshot({ path: OUT_SCREENSHOT, fullPage: false });

const state = await page.evaluate(() => {
  const feedRaw = localStorage.getItem('reelforge_feed') || '{}';
  let feed = {};
  try {
    feed = JSON.parse(feedRaw);
  } catch {
    feed = {};
  }
  const flat = Object.values(feed).flat();
  const videos = flat.filter(
    (r) => r?.isPersonalVideo || String(r?.url || '').includes('/videos/')
  );
  const placeholders = flat.filter(
    (r) =>
      r?.isPlaceholder ||
      String(r?.url || '').includes('via.placeholder.com') ||
      String(r?.thumbnailUrl || '').includes('via.placeholder.com')
  );
  const demoInjected = flat.some((r) => r?.isDemo || r?.demo === true);

  const videoEls = Array.from(document.querySelectorAll('video')).map((v) => ({
    src: v.currentSrc || v.src || '',
    readyState: v.readyState
  }));
  const imgEls = Array.from(document.querySelectorAll('img')).map((i) => i.src || '').slice(0, 20);
  const viaPlaceholderInDom =
    document.body.innerHTML.includes('via.placeholder.com') ||
    imgEls.some((s) => s.includes('via.placeholder.com')) ||
    videoEls.some((v) => v.src.includes('via.placeholder.com'));

  return {
    feedKeys: Object.keys(feed),
    flatFeedCount: flat.length,
    videoFeedCount: videos.length,
    placeholderCount: placeholders.length,
    demoInjected,
    videoFeedSample: videos.slice(0, 6).map((r) => ({
      id: r.id,
      url: r.url,
      category: r.category,
      isPlaceholder: !!r.isPlaceholder,
      isPersonalVideo: !!r.isPersonalVideo
    })),
    placeholderSample: placeholders.slice(0, 3).map((r) => ({ id: r.id, url: r.url })),
    videoEls: videoEls.filter((v) => v.src).slice(0, 8),
    viaPlaceholderInDom,
    personalVideoVault: JSON.parse(localStorage.getItem('personal_video_vault') || '[]').length
  };
});

report.localStorage = state;
report.dom = {
  videoElementCount: state.videoEls.length,
  realVideoSrcs: state.videoEls.filter((v) => v.src.includes('/videos/')).length,
  viaPlaceholderInDom: state.viaPlaceholderInDom
};

report.checks = {
  apiTrendingVideosGte5: report.api.trendingVideos >= 5,
  apiHeroEq2: report.api.hero === 2,
  apiImagesEq2: report.api.images === 2,
  feedHasRealVideos: state.videoFeedCount >= 5,
  noDemoPlaceholders: state.placeholderCount === 0 && !state.demoInjected,
  noViaPlaceholder: !state.viaPlaceholderInDom,
  realVideoElementsInDom: report.dom.realVideoSrcs >= 1,
  noDemoFeedInjectedConsole: !report.console.some((c) => c.text.includes('[DEMO_FEED_INJECTED]'))
};

report.pass =
  report.checks.apiTrendingVideosGte5 &&
  report.checks.apiHeroEq2 &&
  report.checks.feedHasRealVideos &&
  report.checks.noViaPlaceholder;

await browser.close();

fs.writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.checks, null, 2));
console.log('PASS', report.pass);
console.log('SCREENSHOT', OUT_SCREENSHOT);
