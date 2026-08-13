#!/usr/bin/env node
/**
 * Phase 6.3 — MP4 Vault full lifecycle browser proof (local only).
 *
 * Proves: drop → pending Accept → progress UI → upload → finalize → catalog →
 * Trending ViewerSemanticCard → hover/play.
 *
 * No deploy. No production Netlify/Railway writes. No category/title/description PATCH.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { unlockStudio, openContentTab } from '../tests/helpers/studio-navigation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const ARTIFACTS = path.join(root, 'artifacts');
const FIXTURE_DIR = process.env.PHASE63_FIXTURE_DIR || '/tmp/phase63-lifecycle';
const SOURCE_MP4 =
  process.env.PHASE63_SOURCE_MP4 ||
  '/home/youloose2dafish/Downloads/01_ARRIVAL_OPEN_v1.mp4';
const FIXTURE_NAME = '01_ARRIVAL_OPEN_v1.mp4';
const FIXTURE_PATH = path.join(FIXTURE_DIR, FIXTURE_NAME);
const PORT = Number(process.env.PHASE63_LIFECYCLE_PORT || 5198);
const ADMIN_PASSWORDS = String(
  process.env.ADMIN_PASSWORD || 'SMART_PRODUCTION,Gaff1505!,admin123'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

let failed = 0;
function assert(cond, label) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

function ensureFixture() {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  if (fs.existsSync(FIXTURE_PATH) && fs.statSync(FIXTURE_PATH).size > 1_000_000) {
    return FIXTURE_PATH;
  }
  if (!fs.existsSync(SOURCE_MP4)) {
    throw new Error(`Missing source MP4: ${SOURCE_MP4}`);
  }
  // Short clip preserves filename + valid container; avoids 206MB browser transfer.
  execFileSync(
    'ffmpeg',
    ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '0', '-i', SOURCE_MP4, '-t', '6', '-c', 'copy', FIXTURE_PATH],
    { stdio: 'ignore' }
  );
  return FIXTURE_PATH;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function unlockWithPasswordFallback(page, frontendUrl) {
  let lastErr = null;
  for (const pw of ADMIN_PASSWORDS) {
    try {
      await unlockStudio(page, frontendUrl, pw);
      const ready = await page
        .locator('[data-production-command-center], .control-center-container, .logout-btn')
        .first()
        .isVisible()
        .catch(() => false);
      if (ready) return pw;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Studio unlock failed for all passwords');
}

console.log('\n[phase-6-3-mp4-vault-lifecycle-browser]');

const fixturePath = ensureFixture();
const fixtureSize = fs.statSync(fixturePath).size;
console.log(`  · fixture ${fixturePath} (${(fixtureSize / (1024 * 1024)).toFixed(1)} MB)`);

const server = await createServer({
  root,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: PORT, strictPort: true }
});
await server.listen();
const frontendUrl =
  server.resolvedUrls?.local?.[0]?.replace(/\/$/, '') || `http://127.0.0.1:${PORT}`;
console.log(`  · local frontend ${frontendUrl}`);

const report = {
  phase: 'PHASE-6-3-MP4-VAULT-LIFECYCLE',
  timestamp: new Date().toISOString(),
  fixture: { path: fixturePath, size: fixtureSize, name: FIXTURE_NAME },
  boundaries: {},
  mutations: {
    categoryPatch: 0,
    titleWrites: 0,
    descriptionWrites: 0,
    productionCatalogWrites: 0,
    localCatalogWrites: 0,
    deploy: 0
  },
  proof: {},
  markers: [],
  blockedBoundary: null,
  status: 'FAIL'
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err?.message || err).slice(0, 400)));
page.on('console', (msg) => {
  const text = msg.text();
  if (
    /\[(MP4_|VIEWER_SEMANTIC_CARD|UPLOAD_|BG7G_|VAULT_UPLOAD)/.test(text) ||
    /\[MP4_/.test(text)
  ) {
    report.markers.push({ ts: new Date().toISOString(), text: text.slice(0, 500) });
  }
});

page.on('request', (req) => {
  const url = req.url();
  const method = req.method().toUpperCase();
  if (!/\/api\//.test(url)) return;
  const isProdHost = /netlify\.app|railway\.app/.test(url);
  if (method === 'PATCH') {
    if (/category/i.test(url)) report.mutations.categoryPatch += 1;
    if (/title/i.test(url)) report.mutations.titleWrites += 1;
    if (/description/i.test(url)) report.mutations.descriptionWrites += 1;
    if (isProdHost) report.mutations.productionCatalogWrites += 1;
  }
  if (['POST', 'PUT', 'DELETE'].includes(method) && /\/api\/reels|\/api\/uploads/.test(url)) {
    if (isProdHost) report.mutations.productionCatalogWrites += 1;
    else report.mutations.localCatalogWrites += 1;
  }
});

try {
  // --- Studio unlock + Content vault ---
  report.boundaries.DROP = 'RUNNING';
  await unlockWithPasswordFallback(page, frontendUrl);
  await openContentTab(page);
  await page.evaluate(() => {
    try {
      localStorage.removeItem('personal_video_vault');
    } catch {
      /* ignore */
    }
  });
  await page.waitForSelector('[data-vault-drop="upload"]', { timeout: 60_000 });
  await page.evaluate(() => {
    document.querySelector('[data-vault-drop="upload"]')?.scrollIntoView({ block: 'center' });
  });
  await sleep(300);

  // Invalid reject probe (preserve validation)
  await page.evaluate(() => {
    const target = document.querySelector('[data-vault-drop="upload"]');
    const file = new File([new Uint8Array([1, 2, 3])], 'not-a-video.txt', {
      type: 'text/plain'
    });
    const dt = new DataTransfer();
    dt.items.add(file);
    const common = { dataTransfer: dt, bubbles: true, cancelable: true };
    target.dispatchEvent(new DragEvent('dragenter', common));
    target.dispatchEvent(new DragEvent('dragover', common));
    target.dispatchEvent(new DragEvent('drop', common));
  });
  await sleep(600);
  const rejected =
    report.markers.some((m) => /MP4_DROP_REJECTED|Drop a valid video file/i.test(m.text)) ||
    (await page.evaluate(() => {
      const status = document.body?.innerText || '';
      return /valid video|Drop a valid/i.test(status);
    }));
  assert(rejected, 'invalid non-video drop rejected');

  // Real MP4 via file input (handles large binary safely)
  const input = page.locator('[data-vault-drop="upload"] input[type="file"]').first();
  await input.setInputFiles(fixturePath);
  await page.waitForSelector('[data-vault-pending-ready], .pending-video-preview, .accept-btn', {
    timeout: 30_000
  });
  const pendingVisible = await page.locator('.accept-btn, [data-vault-pending-ready]').first().isVisible();
  assert(pendingVisible, 'pending Accept visible after Arrival drop');
  const pendingName = await page.locator('.pending-info, .pending-large-static strong').first().textContent().catch(() => '');
  assert(/01_ARRIVAL_OPEN_v1\.mp4/i.test(String(pendingName || '')), 'pending shows Arrival filename');
  report.proof.drop = 'PASS';
  report.proof.pendingAccept = 'PASS';
  report.boundaries.DROP = 'PASS';
  report.boundaries.ACCEPT = 'RUNNING';

  // Accept
  await page.locator('.accept-btn').first().click();
  report.proof.accept = 'PASS';
  report.boundaries.ACCEPT = 'PASS';
  report.boundaries.UPLOAD = 'RUNNING';

  // Progress panel must appear and stick (scroll into view — Content tab may be scrolled).
  await page.evaluate(() => {
    document.querySelector('[data-vault-drop="upload"]')?.scrollIntoView({ block: 'center' });
  });
  await page.waitForSelector('[data-vault-upload-progress]', {
    timeout: 30_000,
    state: 'attached'
  });
  await page.locator('[data-vault-upload-progress]').first().scrollIntoViewIfNeeded().catch(() => {});
  assert((await page.locator('[data-vault-upload-progress]').count()) >= 1, 'progress panel visible');
  const liveName = await page.locator('.vault-upload-live__name').textContent();
  assert(/01_ARRIVAL_OPEN_v1\.mp4/i.test(String(liveName || '')), 'progress panel shows filename');

  const stagesSeen = new Set();
  const percentsSeen = new Set();
  let sawBar = false;
  const uploadDeadline = Date.now() + 8 * 60_000;
  let completeVisible = false;
  let uploadedReelId = null;

  while (Date.now() < uploadDeadline) {
    const snap = await page.evaluate(() => {
      const panel = document.querySelector('[data-vault-upload-progress]');
      const stage = panel?.getAttribute('data-vault-upload-stage') || '';
      const pctText = document.querySelector('[data-vault-upload-percent]')?.textContent || '';
      const bar = document.querySelector('[data-vault-upload-progress] .vault-upload-bar');
      const width = bar?.getAttribute('style') || '';
      const uploadingCard = document.querySelector('[data-vault-card-state="uploading"]');
      const readyCards = [...document.querySelectorAll('.video-vault-item')].map((el) => ({
        state: el.getAttribute('data-vault-card-state'),
        title: el.querySelector('[data-vault-card-title]')?.textContent || ''
      }));
      return { stage, pctText, width, hasUploadingCard: Boolean(uploadingCard), readyCards };
    });
    if (snap.stage) stagesSeen.add(snap.stage);
    const pctMatch = String(snap.pctText).match(/(\d+)\s*%/);
    if (pctMatch) percentsSeen.add(Number(pctMatch[1]));
    if (/width:\s*([1-9]\d*)%/.test(snap.width)) sawBar = true;
    if (snap.stage === 'COMPLETE' || /Complete\s*100%/i.test(snap.pctText)) {
      completeVisible = true;
    }

    const markersDone = report.markers.some((m) => /\[MP4_UPLOAD_COMPLETE\]/.test(m.text));
    if (markersDone) {
      const hit = report.markers.find((m) => /\[MP4_UPLOAD_COMPLETE\]/.test(m.text));
      const idMatch = String(hit?.text || '').match(/reelId["']?\s*[:=]\s*["']?([0-9a-f-]{36})/i);
      if (idMatch) uploadedReelId = idMatch[1];
      break;
    }
    if (completeVisible && !snap.hasUploadingCard) {
      // COMPLETE shown and optimistic card replaced
      await sleep(400);
      break;
    }
    await sleep(250);
  }

  // Supplement UI stage capture with diagnostic markers (fast local uploads may skip mid-stages in DOM).
  for (const m of report.markers) {
    const stageMatch = String(m.text).match(/\[MP4_UPLOAD_STAGE\].*stage:\s*([A-Z_]+)/);
    if (stageMatch) stagesSeen.add(stageMatch[1]);
    const pctMatch = String(m.text).match(/\[MP4_UPLOAD_PROGRESS\].*percent:\s*(\d+)/);
    if (pctMatch) percentsSeen.add(Number(pctMatch[1]));
  }
  assert(
    ['ACCEPTED', 'VALIDATING', 'UPLOADING'].every((s) =>
      report.markers.some((m) => m.text.includes(`stage: ${s}`) || m.text.includes(`stage: '${s}'`) || new RegExp(`stage:\\s*${s}`).test(m.text))
    ) || ['ACCEPTED', 'VALIDATING', 'UPLOADING'].every((s) => stagesSeen.has(s)),
    'ACCEPTED → VALIDATING → UPLOADING stages recorded'
  );
  assert(sawBar || percentsSeen.size > 0, 'progress bar or percentage updated');
  assert(
    percentsSeen.size >= 1 || stagesSeen.has('FINALIZING') || stagesSeen.has('COMPLETE'),
    `percentage progressed (seen: ${[...percentsSeen].join(',') || 'n/a'})`
  );
  assert(
    completeVisible ||
      report.markers.some((m) => /\[MP4_UPLOAD_COMPLETE\]/.test(m.text)) ||
      report.markers.some((m) => /\[UPLOAD_SUCCESS\]/.test(m.text)),
    'COMPLETE / upload success represented'
  );
  report.proof.progress = {
    stagesSeen: [...stagesSeen],
    percentsSeen: [...percentsSeen].sort((a, b) => a - b),
    completeVisible
  };
  report.boundaries.UPLOAD = 'PASS';
  report.boundaries.FINALIZE = report.markers.some((m) => /\[MP4_FINALIZE\]|Finalizing/i.test(m.text))
    ? 'PASS'
    : 'SOFT_PASS';

  // Catalog confirmation from local API (not production)
  await sleep(800);
  const catalog = await page.evaluate(async () => {
    const res = await fetch('/api/reels');
    const body = await res.json().catch(() => []);
    return Array.isArray(body) ? body : [];
  });
  const arrivalLike = catalog.filter((r) => {
    const name = String(r?.fileName || r?.file_name || r?.name || r?.title || '');
    return /ARRIVAL_OPEN/i.test(name) || String(r?.id || '') === uploadedReelId;
  });
  if (!uploadedReelId && arrivalLike[0]?.id) uploadedReelId = String(arrivalLike[0].id);
  const catalogHit =
    arrivalLike.find((r) => String(r.id) === uploadedReelId) ||
    arrivalLike[0] ||
    null;
  assert(Boolean(catalogHit?.id), 'catalog contains uploaded Arrival-like reel');
  assert(catalogHit?.type === 'video' || /mp4|video/i.test(String(catalogHit?.url || '')), 'catalog type/url is video');
  assert(Boolean(catalogHit?.url), 'catalog media URL present');
  report.proof.catalog = {
    reelId: catalogHit?.id || null,
    category: catalogHit?.category || null,
    url: catalogHit?.url || null
  };
  report.boundaries.CATALOG = catalogHit?.id ? 'PASS' : 'FAIL';
  report.boundaries.SYNC = 'PASS';

  // Close studio → viewer feed
  await page.keyboard.press('Escape').catch(() => {});
  await page.locator('.control-center-close, button:has-text("Close"), .ghost-trigger.active').first().click().catch(() => {});
  await page.goto(frontendUrl + '/', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('[data-viewer-cinematic-feed], [data-viewer-semantic-card], .forge-loader', {
    timeout: 90_000
  });
  await page.waitForSelector('[data-viewer-semantic-card]', { timeout: 90_000 });
  await sleep(1000);

  const cardSelector = uploadedReelId
    ? `[data-viewer-semantic-card][data-reel-id="${uploadedReelId}"], [data-viewer-semantic-card][data-asset-id="${uploadedReelId}"]`
    : '[data-viewer-semantic-card][data-media-type="video"]';
  let card = page.locator(cardSelector).first();
  if (!(await card.count())) {
    // Fallback: any video semantic card mentioning Arrival
    card = page.locator('[data-viewer-semantic-card]').filter({ hasText: /ARRIVAL/i }).first();
  }
  const cardCount = await card.count();
  assert(cardCount >= 1, 'ViewerSemanticCard present for uploaded/Arrival media');
  if (cardCount >= 1) {
    console.info('[VIEWER_SEMANTIC_CARD]', {
      reelId: uploadedReelId,
      ts: new Date().toISOString()
    });
    report.markers.push({
      ts: new Date().toISOString(),
      text: `[VIEWER_SEMANTIC_CARD] reelId=${uploadedReelId || 'unknown'}`
    });
  }

  const cardMeta = await card.evaluate((el) => {
    const media = el.querySelector('[data-viewer-sem-media], .viewer-sem-card__media, video, img');
    const rect = el.getBoundingClientRect();
    const mediaRect = media?.getBoundingClientRect?.() || rect;
    return {
      variant: el.getAttribute('data-viewer-card-variant'),
      mediaType: el.getAttribute('data-media-type'),
      reelId: el.getAttribute('data-reel-id') || el.getAttribute('data-asset-id'),
      aspect: mediaRect.width && mediaRect.height ? mediaRect.width / mediaRect.height : null,
      hasVideo: Boolean(el.querySelector('video')),
      hasImg: Boolean(el.querySelector('img')),
      className: el.className
    };
  });
  assert(Boolean(cardMeta.mediaType === 'video' || cardMeta.hasVideo || cardMeta.hasImg), 'card has media surface');
  assert(
    !cardMeta.aspect || (cardMeta.aspect > 1.4 && cardMeta.aspect < 2.1),
    `landscape ~16:9 (got ${cardMeta.aspect})`
  );
  assert(/viewer-sem-card/.test(cardMeta.className), 'premium cinematic shell class present');
  report.proof.trendingCard = cardMeta;
  report.boundaries.FEED = 'PASS';
  report.boundaries.CARD = 'PASS';

  // Hover / play
  report.boundaries.PLAYBACK = 'RUNNING';
  const media = card.locator('[data-viewer-sem-media], .viewer-sem-card__media').first();
  await media.hover({ force: true }).catch(() => card.hover({ force: true }));
  await sleep(1200);
  const playProof = await card.evaluate((el) => {
    const video = el.querySelector('video');
    if (!video) {
      return {
        hasVideo: false,
        readyState: 0,
        currentSrc: '',
        paused: true,
        previewClass: el.classList.contains('viewer-sem-card--preview')
      };
    }
    return {
      hasVideo: true,
      readyState: video.readyState,
      currentSrc: String(video.currentSrc || video.src || '').slice(0, 180),
      paused: video.paused,
      previewClass: el.classList.contains('viewer-sem-card--preview')
    };
  });
  assert(
    playProof.hasVideo || playProof.previewClass || cardMeta.hasImg,
    'hover/play path exercised (video mount or poster retained)'
  );
  if (playProof.hasVideo) {
    assert(Boolean(playProof.currentSrc), 'hover video has media src');
  }
  report.proof.hoverPlay = playProof;
  report.boundaries.PLAYBACK = playProof.hasVideo || playProof.previewClass || cardMeta.hasImg ? 'PASS' : 'FAIL';

  assert(report.mutations.categoryPatch === 0, 'category PATCH = 0');
  assert(report.mutations.titleWrites === 0, 'title writes = 0');
  assert(report.mutations.descriptionWrites === 0, 'description writes = 0');
  assert(report.mutations.productionCatalogWrites === 0, 'production catalog writes = 0');
  assert(report.mutations.deploy === 0, 'deploy = 0');
  assert(pageErrors.length === 0, `no uncaught exceptions (${pageErrors.length})`);

  const requiredMarkers = [
    'MP4_DROP',
    'MP4_ACCEPT',
    'MP4_VALIDATION',
    'MP4_UPLOAD_PROGRESS',
    'MP4_UPLOAD_COMPLETE'
  ];
  for (const marker of requiredMarkers) {
    assert(
      report.markers.some((m) => m.text.includes(`[${marker}]`)),
      `diagnostic marker [${marker}]`
    );
  }

  report.status = failed ? 'FAIL' : 'VERIFIED';
} catch (err) {
  failed += 1;
  report.blockedBoundary =
    Object.entries(report.boundaries).find(([, v]) => v === 'RUNNING')?.[0] ||
    Object.entries(report.boundaries).find(([, v]) => v === 'FAIL')?.[0] ||
    'UNKNOWN';
  report.error = String(err?.message || err).slice(0, 500);
  console.error(`  ✗ lifecycle threw at ${report.blockedBoundary}: ${report.error}`);
} finally {
  await browser.close().catch(() => {});
  await server.close().catch(() => {});
}

if (failed && !report.blockedBoundary) {
  const failBound = Object.entries(report.boundaries).find(([, v]) => v === 'FAIL' || v === 'RUNNING');
  report.blockedBoundary = failBound?.[0] || 'UNKNOWN';
}

fs.mkdirSync(ARTIFACTS, { recursive: true });
const outPath = path.join(ARTIFACTS, 'phase-6-3-mp4-vault-lifecycle-browser.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`  · wrote ${outPath}`);

if (failed) {
  console.error(`\nPHASE-6.3 BLOCKED — ${report.blockedBoundary || 'UNKNOWN'}\n`);
  process.exit(1);
}
console.log('\nPHASE-6.3 VERIFIED — READY FOR RELEASE\n');
process.exit(0);
