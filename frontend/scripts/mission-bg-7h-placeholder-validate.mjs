#!/usr/bin/env node
/** BG-7H — Placeholder disable validation (fresh session) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND =
  process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app';
const NETLIFY_PASSWORD = process.env.NETLIFY_DROP_PASSWORD || '';
const OUT_JSON = '/tmp/bg7h-placeholder-validation.json';
const OUT_SCREENSHOT = path.join(__dirname, '..', 'artifacts', 'bg-7h-placeholder-disable-screenshot.png');
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const report = {
  generatedAt: new Date().toISOString(),
  frontend: FRONTEND,
  checks: {},
  api: {},
  bundle: {},
  localStorage: {},
  dom: {},
  console: []
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  const res = await fetch(url.startsWith('http') ? url : `${FRONTEND}${url}`, {
    signal: AbortSignal.timeout(20000)
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const apiRes = await fetchJson(`${FRONTEND}/api/reels`);
report.api = {
  status: apiRes.status,
  count: Array.isArray(apiRes.body) ? apiRes.body.length : 0,
  trendingVideos: Array.isArray(apiRes.body)
    ? apiRes.body.filter((r) => r?.type === 'video' && String(r?.category || '').toUpperCase() !== 'HERO').length
    : 0,
  hero: Array.isArray(apiRes.body)
    ? apiRes.body.filter((r) => String(r?.category || '').toUpperCase() === 'HERO').length
    : 0
};

const launch = { headless: true };
if (fs.existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;
const browser = await chromium.launch(launch);
const context = await browser.newContext(
  NETLIFY_PASSWORD
    ? { httpCredentials: { username: 'My-Drop-Site', password: NETLIFY_PASSWORD } }
    : {}
);
await context.addInitScript(() => {
  localStorage.clear();
  sessionStorage.clear();
});
const page = await context.newPage();

page.on('console', (msg) => {
  const text = msg.text();
  if (/DEMO_FEED|placeholder|syncFromVault|VAULT_SYNC|allowUiPlaceholders/i.test(text)) {
    report.console.push({ type: msg.type(), text: text.slice(0, 500) });
  }
});

await page.goto(FRONTEND, { waitUntil: 'domcontentloaded', timeout: 120000 });
const bundleMatch = (await page.content()).match(/index-[A-Za-z0-9_-]+\.js/);
report.bundle.name = bundleMatch ? bundleMatch[0] : null;

await page
  .waitForFunction(
    () => {
      try {
        const feed = JSON.parse(localStorage.getItem('reelforge_feed') || '{}');
        return Object.values(feed).flat().some((r) => String(r?.url || '').includes('/videos/'));
      } catch {
        return false;
      }
    },
    { timeout: 90000 }
  )
  .catch(() => {});

await sleep(2000);
await fs.promises.mkdir(path.dirname(OUT_SCREENSHOT), { recursive: true });
await page.screenshot({ path: OUT_SCREENSHOT, fullPage: false });

const state = await page.evaluate(() => {
  const feed = JSON.parse(localStorage.getItem('reelforge_feed') || '{}');
  const flat = Object.values(feed).flat();
  const videos = flat.filter((r) => String(r?.url || '').includes('/videos/'));
  const placeholders = flat.filter(
    (r) =>
      r?.isPlaceholder ||
      String(r?.url || '').includes('via.placeholder.com') ||
      String(r?.thumbnailUrl || '').includes('via.placeholder.com')
  );
  const videoEls = Array.from(document.querySelectorAll('video')).map((v) => v.currentSrc || v.src || '');
  const imgEls = Array.from(document.querySelectorAll('img')).map((i) => i.src || '');
  const vaultDemo = document.body.innerHTML.includes('Demo Placeholder Cards');
  return {
    flatFeedCount: flat.length,
    videoFeedCount: videos.length,
    placeholderCount: placeholders.length,
    videoEls: videoEls.filter(Boolean),
    viaInDom:
      document.body.innerHTML.includes('via.placeholder.com') ||
      imgEls.some((s) => s.includes('via.placeholder.com')),
    vaultDemoCardsVisible: vaultDemo,
    feedSample: videos.slice(0, 3).map((r) => ({ id: r.id, url: r.url, isPlaceholder: !!r.isPlaceholder }))
  };
});

report.localStorage = state;
report.dom = {
  realVideoSrcs: state.videoEls.filter((s) => s.includes('/videos/')).length,
  viaPlaceholderInDom: state.viaInDom,
  vaultDemoCardsVisible: state.vaultDemoCardsVisible
};

report.checks = {
  apiReachable: report.api.status === 200,
  feedHasRealVideos: state.videoFeedCount >= 5,
  noDemoPlaceholdersInFeed: state.placeholderCount === 0,
  noViaPlaceholderInDom: !state.viaInDom,
  noVaultDemoCards: !state.vaultDemoCardsVisible,
  noDemoFeedInjectedConsole: !report.console.some((c) => c.text.includes('[DEMO_FEED_INJECTED]')),
  bundleHasPlaceholderInjectionPath: report.bundle.hasDemoInjectPath
};

report.pass = Object.values(report.checks).every((v) => v === true);

// Fetch deployed bundle snippet for DEMO_FEED_INJECTED
if (report.bundle.name) {
  try {
    const bundleRes = await fetch(`${FRONTEND}/assets/${report.bundle.name}`, { signal: AbortSignal.timeout(20000) });
    const js = await bundleRes.text();
    report.bundle.hasDemoInjectPath = js.includes('DEMO_FEED_INJECTED');
    report.bundle.hasEmptyFeedAfterSync = js.includes('empty-feed-after-sync');
  } catch (e) {
    report.bundle.error = String(e);
  }
}

await browser.close();
fs.writeFileSync(OUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.checks, null, 2));
console.log('PASS', report.pass);
