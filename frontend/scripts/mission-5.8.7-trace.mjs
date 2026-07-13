#!/usr/bin/env node
/**
 * Mission 5.8.7 — Runtime thumbnail vault write chain tracer.
 * Reproduces: backend 0 thumb reels, localStorage 20 ghost entries, UI shows 20 cards.
 */
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const API = process.env.API_URL || 'http://127.0.0.1:8080';
const OUT_JSON = join(process.cwd(), 'mission-5.8.7-trace.json');
const GHOST_COUNT = Number(process.env.GHOST_COUNT || 20);

const CHROMIUM = '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const launch = { headless: true };
if (existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;

function makeGhostEntries(n, { orphaned = false, idless = false } = {}) {
  const entries = [];
  for (let i = 0; i < n; i++) {
    const id = idless ? '' : `ghost-${String(i).padStart(2, '0')}-0000-4000-8000-000000000000`;
    const entry = {
      fileName: `mission-587-ghost-${i}.png`,
      url: `/thumbs/mission-587-ghost-${i}.png`,
      name: `Ghost Thumb ${i}`,
      title: `Ghost Thumb ${i}`,
      vaultState: orphaned ? 'ORPHANED' : 'INGESTING',
      addedAt: new Date().toISOString()
    };
    if (id) entry.id = id;
    if (orphaned) entry.orphaned = true;
    entries.push(entry);
  }
  return entries;
}

async function waitHttp(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.status >= 200 && res.status < 500) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function fetchBackendReels() {
  const res = await fetch(`${API}/api/reels`);
  if (!res.ok) throw new Error(`Backend ${res.status}`);
  return res.json();
}

function stripThumbReels(reels) {
  return reels.filter((r) => {
    const url = String(r?.url || r?.video_url || '');
    return !url.includes('/thumbs/') && !String(r?.type || '').toLowerCase().startsWith('image/');
  });
}

async function main() {
  const frontendUp = await waitHttp(BASE);
  const backendUp = await waitHttp(`${API}/api/reels`);
  if (!frontendUp) throw new Error(`Frontend not reachable at ${BASE}`);
  if (!backendUp) throw new Error(`Backend not reachable at ${API}`);

  const rawReels = await fetchBackendReels();
  const videoOnlyReels = stripThumbReels(rawReels);
  const backendThumbCount = rawReels.length - videoOnlyReels.length;

  console.log(`[trace] backend reels=${rawReels.length} thumbs=${backendThumbCount} videoOnly=${videoOnlyReels.length}`);

  const legacyStrings = process.env.LEGACY_STRINGS === '1';
  const orphanedGhosts = process.env.ORPHANED_GHOSTS === '1';
  const idlessGhosts = process.env.IDLESS_GHOSTS === '1';
  const ghosts = legacyStrings
    ? Array.from({ length: GHOST_COUNT }, (_, i) => `mission-587-ghost-${i}.png`)
    : makeGhostEntries(GHOST_COUNT, { orphaned: orphanedGhosts, idless: idlessGhosts });
  const indexKeys = legacyStrings ? ghosts : ghosts.map((e) => e.fileName);

  const browser = await chromium.launch(launch);
  const context = await browser.newContext();
  const page = await context.newPage();

  const writeLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[THUMB_STORE_WRITE]')) {
      try {
        const json = text.replace(/^\[THUMB_STORE_WRITE\]\s*/, '');
        writeLogs.push(JSON.parse(json));
      } catch {
        writeLogs.push({ raw: text });
      }
    }
  });

  // Intercept catalog: return video reels only (0 thumb reels)
  await page.route('**/api/reels**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(videoOnlyReels)
    });
  });

  if (process.env.BACKEND_UNREACHABLE === '1') {
    await page.route('**/api/health**', async (route) => {
      await route.fulfill({ status: 503, body: 'unavailable' });
    });
    await page.route('**/health**', async (route) => {
      await route.fulfill({ status: 503, body: 'unavailable' });
    });
  }

  await page.addInitScript(
    ({ ghosts, indexKeys }) => {
      sessionStorage.setItem('__mission587_boot', '1');
      localStorage.setItem('personal_thumbnails', JSON.stringify(ghosts));
      localStorage.setItem('personal_thumbnail_index', JSON.stringify(indexKeys));
      localStorage.removeItem('__thumbWriteChain');
    },
    { ghosts, indexKeys }
  );

  await page.goto(`${BASE}?studio=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });

  // Wait for vault write chain to populate
  await page.waitForFunction(
    () => (window.__thumbWriteChain?.length || 0) > 0 || document.querySelector('h4')?.textContent?.includes('Your Thumbnails'),
    { timeout: 60000 }
  ).catch(() => {});
  await page.waitForTimeout(5000);

  // Open studio control center to render vault UI
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('reelforge:workflow-navigate', { detail: { workspaceTab: 'vault' } }));
  }).catch(() => {});
  await page.waitForTimeout(2000);
  const studioBtn = page.locator('button, [role="button"]').filter({ hasText: /studio|control center|vault/i }).first();
  if (await studioBtn.count()) {
    await studioBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }

  const snapshot = await page.evaluate(() => {
    const chain = window.__thumbWriteChain || [];
    let sessionChain = [];
    try {
      sessionChain = JSON.parse(sessionStorage.getItem('__thumbWriteChain') || '[]');
    } catch {
      sessionChain = [];
    }
    const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    const index = JSON.parse(localStorage.getItem('personal_thumbnail_index') || '[]');
    const heading = [...document.querySelectorAll('h4')].find((h) => h.textContent?.includes('Your Thumbnails'))?.textContent;
    const cards = document.querySelectorAll('.vault-grid--images .vault-card, .personal-media-grid .vault-card').length;
    return {
      chain,
      sessionChain,
      localThumbs: thumbs.length,
      localIndex: index.length,
      collectionLength: chain.filter((e) => e.store === 'personalThumbnailCollection').at(-1)?.newCount ?? null,
      heading,
      cardCount: cards,
      first3Local: thumbs.slice(0, 3)
    };
  });

  const mergedChain = snapshot.chain.length >= snapshot.sessionChain.length ? snapshot.chain : snapshot.sessionChain;
  const firstTwenty = mergedChain.find(
    (e) => e.newCount === GHOST_COUNT && (e.previousCount === 0 || e.previousCount < GHOST_COUNT)
  );
  const firstCollectionTwenty = mergedChain.find(
    (e) => e.store === 'personalThumbnailCollection' && e.newCount === GHOST_COUNT
  );

  const ownerViolations = mergedChain.filter((e) =>
    e.function === 'safeStorageSet' &&
    e.store === 'personal_thumbnails' &&
    !String(e.stack?.join(' ') || '').includes('thumbnailVault')
  );
  const mediaBootstrapWrites = mergedChain.filter((e) =>
    String(e.stack?.join(' ') || '').includes('mediaBootstrap')
  );

  const result = {
    scenario: {
      backendThumbReels: backendThumbCount,
      interceptedThumbReels: 0,
      seededLocalGhosts: GHOST_COUNT
    },
    ui: {
      heading: snapshot.heading,
      cardCount: snapshot.cardCount,
      localThumbs: snapshot.localThumbs,
      localIndex: snapshot.localIndex
    },
    firstFailureCandidate: firstTwenty || firstCollectionTwenty || null,
    ownerViolations,
    mediaBootstrapWrites,
    writeChain: mergedChain,
    consoleWriteLogs: writeLogs
  };

  mkdirSync(join(process.cwd()), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(result, null, 2));

  console.log(`[trace] UI heading: ${snapshot.heading}`);
  console.log(`[trace] write chain events: ${mergedChain.length}`);
  console.log(`[trace] first 20-entry mutation: ${result.firstFailureCandidate?.function || 'NOT FOUND'} @ ${result.firstFailureCandidate?.timestamp || 'n/a'}`);
  console.log(`[trace] mediaBootstrap writes: ${result.mediaBootstrapWrites.length}`);
  console.log(`[trace] owner violations (non-vault safeStorageSet): ${result.ownerViolations.length}`);

  console.log(`[trace] wrote ${OUT_JSON}`);

  await browser.close();
  process.exit(result.mediaBootstrapWrites.length === 0 && result.ownerViolations.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
