#!/usr/bin/env node
/**
 * MISSION RC3-VAULT-ARCH-01 — Vault Persistence Contract Comparison
 *
 * Evidence only. No application source changes. No fixes. No refactors.
 *
 * Compare persistence lifecycle of:
 *  1) Thumbnail Vault
 *  2) MP4 Vault
 *  3) Hero Background Vault
 *
 * Produces:
 *  frontend/artifacts/rc3-vault-arch-01-persistence-comparison.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app/').replace(
  /\/?$/,
  '/'
);
const API_URL = (process.env.API_URL || FRONTEND_URL).replace(/\/$/, '');
const OUT =
  process.env.OUT ||
  path.join(__dirname, '..', 'artifacts', 'rc3-vault-arch-01-persistence-comparison.json');
const WAIT_MS = Number(process.env.WAIT_MS || 25000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'SMART_PRODUCTION';
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const KEY = {
  // thumbnail vault
  THUMBS: 'personal_thumbnails',
  THUMBS_INDEX: 'personal_thumbnail_index',
  // mp4 vault
  VIDEO_VAULT: 'personal_video_vault',
  VIDEO_INDEX: 'video_vault_index',
  // feed + offline vault
  FEED: 'reelforge_feed',
  REEL_VAULT: 'reel_vault',
  // hero
  HERO_MANAGER: 'reelforge_hero_manager_config',
  HERO_REEL: 'reelforge_hero_reel',
  HERO_VIDEO: 'reelforge_hero_video',
  HERO_IMAGE: 'reelforge_hero_image'
};

const STORAGE_KEYS_OF_INTEREST = Object.values(KEY);

function isoNow() {
  return new Date().toISOString();
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function trimStack(stack, maxLines = 14) {
  return String(stack || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, maxLines);
}

function ensureFixtures() {
  const dir = '/tmp/rc3-vault-arch-01';
  fs.mkdirSync(dir, { recursive: true });
  const png = path.join(dir, 'thumb.png');
  const mp4 = path.join(dir, 'video.mp4');

  if (!fs.existsSync(png)) {
    execFileSync(
      'ffmpeg',
      ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=48x48:d=0.1', '-frames:v', '1', png],
      { stdio: 'ignore' }
    );
  }
  if (!fs.existsSync(mp4)) {
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=160x90:rate=15',
        '-t',
        '1',
        '-pix_fmt',
        'yuv420p',
        mp4
      ],
      { stdio: 'ignore' }
    );
  }
  return { png, mp4 };
}

async function snapshotLocalStorage(page) {
  return await page.evaluate((keys) => {
    const picked = {};
    for (const k of keys) {
      try {
        const v = window.localStorage.getItem(k);
        picked[k] = {
          present: v != null,
          len: v ? String(v).length : 0,
          preview: v ? (v.length <= 180 ? v : `${v.slice(0, 180)}…`) : null
        };
      } catch {
        picked[k] = { present: false, len: 0, preview: null };
      }
    }
    return { picked, ts: Date.now() };
  }, STORAGE_KEYS_OF_INTEREST);
}

async function openControlCenterAndLogin(page) {
  const overlay = page.locator('.control-center-overlay');
  if (!(await overlay.isVisible().catch(() => false))) {
    const btn = page.locator('button.ghost-trigger');
    await btn.waitFor({ timeout: 60000 });
    await btn.click();
  }
  await page.waitForSelector('.control-center-overlay', { timeout: 60000 });
  await page.waitForSelector('.control-center-container', { timeout: 60000 });

  const loginVisible = await page.locator('.admin-login-panel').isVisible().catch(() => false);
  if (loginVisible) {
    const input = page.locator('.admin-login-panel input[type="password"]');
    await input.fill(ADMIN_PASSWORD);
    await page.locator('.admin-login-panel button.submit-btn').click();
    await page.waitForSelector('.logout-btn, .admin-login-panel .login-error', { timeout: 60000 });
  }

  // Navigate to Content tab (VaultExperience + HeroExperience.replace + RECENTLY ADDED PRODUCTIONS).
  const contentTab = page.locator('[data-studio-workspace-tabs] button', { hasText: 'Content' });
  if (await contentTab.isVisible().catch(() => false)) {
    await contentTab.click();
  }
  await page.waitForSelector('[data-workspace-panel-content]', { timeout: 60000 });
}

async function openSystemTab(page) {
  const systemTab = page.locator('[data-studio-workspace-tabs] button', { hasText: 'System' });
  if (await systemTab.isVisible().catch(() => false)) {
    await systemTab.click();
  }
  await page.waitForSelector('[data-workspace-panel-system]', { timeout: 60000 });
}

async function dropFileOnSelector(page, selector, filePath, mimeType) {
  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString('base64');
  const name = path.basename(filePath);
  await page.waitForSelector(selector, { timeout: 60000 });
  await page.evaluate(
    async ({ selector, b64, name, mimeType }) => {
      function b64ToBytes(b64Text) {
        const bin = atob(b64Text);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      }
      const target = document.querySelector(selector);
      if (!target) throw new Error(`drop target not found: ${selector}`);
      const bytes = b64ToBytes(b64);
      const file = new File([bytes], name, { type: mimeType });
      const dt = new DataTransfer();
      dt.items.add(file);
      const common = { dataTransfer: dt, bubbles: true, cancelable: true };
      target.dispatchEvent(new DragEvent('dragenter', common));
      target.dispatchEvent(new DragEvent('dragover', common));
      target.dispatchEvent(new DragEvent('drop', common));
    },
    { selector, b64, name, mimeType }
  );
}

async function waitForLocalStorageJsonArraySize(page, key, minSize, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const size = await page.evaluate((k) => {
      try {
        const raw = window.localStorage.getItem(k);
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed.length : -1;
      } catch {
        return -1;
      }
    }, key);
    if (size >= minSize) return size;
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${key} size >= ${minSize}`);
}

async function pullRuntimeOps(page) {
  return await page.evaluate(() => {
    const ops = Array.isArray(window.__rc3VaultOps) ? window.__rc3VaultOps : [];
    const logs = Array.isArray(window.__rc3VaultConsole) ? window.__rc3VaultConsole : [];
    return { ops, logs };
  });
}

function classifyIdentityThumbnail(entry) {
  if (!entry || typeof entry !== 'object') return { canonical: null, identities: [] };
  const identities = [
    { field: 'id', value: String(entry.id || '').trim() || null },
    { field: 'fileName', value: String(entry.fileName || entry.file_name || '').trim() || null },
    { field: 'url', value: String(entry.url || '').trim() || null },
    { field: 'name', value: String(entry.name || '').trim() || null }
  ].filter((x) => x.value);
  const canonical =
    identities.find((x) => x.field === 'fileName') ||
    identities.find((x) => x.field === 'url') ||
    identities.find((x) => x.field === 'id') ||
    identities[0] ||
    null;
  return { canonical: canonical ? `${canonical.field}:${canonical.value}` : null, identities };
}

function classifyIdentityVideo(entry) {
  if (!entry || typeof entry !== 'object') return { canonical: null, identities: [] };
  const identities = [
    { field: 'id', value: String(entry.id || '').trim() || null },
    { field: 'fileName', value: String(entry.fileName || entry.file_name || '').trim() || null },
    { field: 'url', value: String(entry.url || '').trim() || null },
    { field: 'name', value: String(entry.name || '').trim() || null }
  ].filter((x) => x.value);
  const canonical =
    identities.find((x) => x.field === 'id') ||
    identities.find((x) => x.field === 'url') ||
    identities.find((x) => x.field === 'fileName') ||
    identities[0] ||
    null;
  return { canonical: canonical ? `${canonical.field}:${canonical.value}` : null, identities };
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const fixtures = ensureFixtures();

  const report = {
    mission: 'RC3-VAULT-ARCH-01',
    generatedAt: isoNow(),
    frontendUrl: FRONTEND_URL,
    apiUrl: API_URL,
    fixtures: { png: fixtures.png, mp4: fixtures.mp4 },
    static: {
      thumbnail: {
        uploadEntryPoint: 'frontend/src/components/experiences/VaultExperience.svelte: handleVaultThumbnailDrop() → acceptPendingThumbnail()',
        identityCreation: 'uploadThumbnail(file) → createReel(FormData) → response.id + response.thumbnailPath/url',
        canonicalId: ['fileName (thumb basename)', 'id (reel id)'],
        storageWriter: [
          'frontend/src/lib/viewer/thumbnailVault.js: appendThumbnailVaultEntry() → writeThumbnailVault()',
          'frontend/src/lib/storage.js: storeThumbnailMetadata()'
        ],
        storageKeys: [KEY.THUMBS, KEY.THUMBS_INDEX],
        backendWriter: 'frontend/src/lib/api/media.js: createReel() POST /api/reels (thumbnail)',
        cacheOrIndex: [
          'frontend/src/lib/viewer/thumbnailVault.js: personal_thumbnail_index (mirror)',
          'frontend/src/lib/viewer/thumbnailCanonicalization.js + reconcile on startup'
        ],
        rendererReader: [
          'frontend/src/components/experiences/VaultExperience.svelte: $personalThumbnailCollection (keys) → getStoredThumbnailEntries() → MediaThumbnail',
          'frontend/src/viewer/viewerContext.js: reloadVaultStoresFromStorage() uses readThumbnailVault/syncCollectionStore'
        ],
        deletePath: [
          'frontend/src/lib/viewer/aiCleanupAgent.js: handleThumbnailRemove(index) → deleteReelById(imageReel.id) OR deleteMediaFile(filename) → removeThumbnailVaultByIndex(fileKey)',
          'frontend/src/lib/viewer/thumbnailVault.js: removeThumbnailVaultByIndex()'
        ]
      },
      mp4: {
        uploadEntryPoint: 'frontend/src/components/experiences/VaultExperience.svelte: handleVaultVideoDrop()',
        identityCreation: 'uploadMedia(FormData(video)) → createReel() → response.id + response.url + response.fileName',
        canonicalId: ['id (reel id)', 'url (/videos/...)', 'fileName'],
        storageWriter: [
          'frontend/src/components/experiences/VaultExperience.svelte: personalVideos.update() → persistPersonalVault()',
          'frontend/src/viewer/viewerContext.js: persistPersonalVault() → safeLocalStorageSet(minimalFields)'
        ],
        storageKeys: [KEY.VIDEO_VAULT],
        backendWriter: 'frontend/src/lib/api/media.js: createReel() POST /api/reels (video)',
        cacheOrIndex: [
          'frontend/src/viewer/viewerContext.js: feed.subscribe → reelforge_feed',
          'frontend/src/viewer/viewerContext.js: syncFromVault() merges backend reels + local personal_video_vault'
        ],
        rendererReader: [
          'frontend/src/viewer/viewerContext.js: onMount loads localStorage personal_video_vault → personalVideos store',
          'frontend/src/components/experiences/VaultExperience.svelte: $personalVideos → MediaRenderer(video)'
        ],
        deletePath: [
          'frontend/src/lib/viewer/aiCleanupAgent.js: deleteVaultVideo(videoId) → deleteReelById(videoId) → runClientMediaPurge() → syncFromVault(true)'
        ]
      },
      hero: {
        uploadEntryPoint: 'frontend/src/components/experiences/HeroExperience.svelte: handleHeroFileSelect() → acceptHeroFile()',
        identityCreation: 'createReel(FormData(video|image)) → reel.id used as heroAssetId; saveHeroReel() persists reel object',
        canonicalId: ['heroAssetId (== reel.id)', 'hero reel id', 'backgroundSource'],
        storageWriter: [
          'frontend/src/lib/hero/heroReelIdentity.js: saveHeroReel() → localStorage reelforge_hero_reel',
          'frontend/src/lib/hero/heroIntelligence.js: saveHeroManagerConfig() → localStorage reelforge_hero_manager_config',
          'frontend/src/viewer/viewerContext.js: HERO_BACKGROUND_VIDEO/HERO_POSTER_IMAGE subscriptions may clear hero video/image keys when empty'
        ],
        storageKeys: [KEY.HERO_MANAGER, KEY.HERO_REEL, KEY.HERO_VIDEO, KEY.HERO_IMAGE],
        backendWriter: 'frontend/src/lib/api/media.js: createReel() POST /api/reels (hero media)',
        cacheOrIndex: [
          'hero selection gates in heroIntelligence/loadHeroVaultItems() (manager.heroAssetId must match reel.id)',
          'heroAssetRegistry store (HeroManagerPanel)'
        ],
        rendererReader: [
          'frontend/src/viewer/viewerContext.js: onMount reads reelforge_hero_video/image then hydrateHeroBackgroundStores()',
          'frontend/src/components/experiences/HeroExperience.svelte: heroManagerConfig.heroAssetId + HERO_BACKGROUND_VIDEO/HERO_POSTER_IMAGE'
        ],
        deletePath: [
          'frontend/src/components/studio/HeroManagerPanel.svelte: deleteHeroVaultAsset(item) → deleteReelById(reelId) → localStorage.removeItem(hero_video/image) → saveHeroManagerConfig(heroAssetId="")'
        ]
      }
    },
    runtime: {
      capture: { startedAt: null, endedAt: null },
      thumbnail: null,
      mp4: null,
      hero: null
    },
    verdict: null
  };

  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  const context = await browser.newContext();

  // Auto-accept confirms used by vault deletes + hero deletes.
  context.on('page', (p) => {
    p.on('dialog', (d) => d.accept().catch(() => {}));
  });

  await context.addInitScript((keys) => {
    const ops = [];
    const logs = [];
    Object.defineProperty(window, '__rc3VaultOps', { value: ops, configurable: false, writable: false });
    Object.defineProperty(window, '__rc3VaultConsole', { value: logs, configurable: false, writable: false });

    const orig = {
      lsGet: window.localStorage.getItem.bind(window.localStorage),
      lsSet: window.localStorage.setItem.bind(window.localStorage),
      lsRemove: window.localStorage.removeItem.bind(window.localStorage)
    };

    function stack() {
      try {
        throw new Error('__rc3_vault_stack__');
      } catch (e) {
        return String(e?.stack || '');
      }
    }

    function record(op) {
      try {
        if (keys.includes(op.key)) ops.push(op);
      } catch {
        // ignore
      }
    }

    window.localStorage.getItem = function (key) {
      const t0 = Date.now();
      const v = orig.lsGet(key);
      record({ ts: t0, storageType: 'localStorage', op: 'getItem', key: String(key), valueLen: v ? String(v).length : 0, stack: stack() });
      return v;
    };
    window.localStorage.setItem = function (key, value) {
      const t0 = Date.now();
      const s = value == null ? '' : String(value);
      record({ ts: t0, storageType: 'localStorage', op: 'setItem', key: String(key), valueLen: s.length, stack: stack() });
      return orig.lsSet(key, value);
    };
    window.localStorage.removeItem = function (key) {
      const t0 = Date.now();
      record({ ts: t0, storageType: 'localStorage', op: 'removeItem', key: String(key), valueLen: 0, stack: stack() });
      return orig.lsRemove(key);
    };

    const origInfo = console.info.bind(console);
    const origWarn = console.warn.bind(console);
    const origErr = console.error.bind(console);
    function maybeLog(level, args) {
      const first = args?.[0];
      if (typeof first !== 'string') return;
      if (!first.startsWith('[')) return;
      if (!/(UPLOAD|DELETE|HERO_|HERO|VAULT|STORE_WRITE|STORE_UPDATE|HERO_ROUTE)/.test(first)) return;
      logs.push({ ts: Date.now(), level, args: args.slice(0, 3) });
    }
    console.info = (...args) => { try { maybeLog('info', args); } catch {} return origInfo(...args); };
    console.warn = (...args) => { try { maybeLog('warn', args); } catch {} return origWarn(...args); };
    console.error = (...args) => { try { maybeLog('error', args); } catch {} return origErr(...args); };
  }, STORAGE_KEYS_OF_INTEREST);

  const page = await context.newPage();

  /** @type {Array<{ts:number, url:string, method:string, status:number|null, ok:boolean|null, kind:string}>} */
  const net = [];
  page.on('request', (req) => {
    const url = req.url();
    if (!url.includes('/api/')) return;
    if (!/(\/api\/reels\b|\/api\/reels\/|\/api\/storage\/file\/|\/api\/media\/storage\/)/.test(url)) return;
    net.push({ ts: Date.now(), url, method: req.method(), status: null, ok: null, kind: 'request' });
  });
  page.on('response', (res) => {
    const url = res.url();
    if (!url.includes('/api/')) return;
    if (!/(\/api\/reels\b|\/api\/reels\/|\/api\/storage\/file\/|\/api\/media\/storage\/)/.test(url)) return;
    net.push({ ts: Date.now(), url, method: res.request().method(), status: res.status(), ok: res.ok(), kind: 'response' });
  });

  report.runtime.capture.startedAt = isoNow();

  await page.goto(FRONTEND_URL, { waitUntil: 'load', timeout: 60000 });
  await openControlCenterAndLogin(page);

  // ------------------------------
  // THUMBNAIL VAULT — upload → reload → delete → reload
  // ------------------------------
  {
    await openControlCenterAndLogin(page);
    const before = await snapshotLocalStorage(page);
    const beforeSize = await page.locator('.vault-grid--images .vault-card').count().catch(() => 0);

    await dropFileOnSelector(page, '.thumbnail-drop-zone', fixtures.png, 'image/png');
    await page.waitForSelector('.thumbnail-drop-zone .accept-btn', { timeout: 60000 });
    await page.click('.thumbnail-drop-zone .accept-btn');

    // Wait for local vault to grow.
    const baseCount = await page.evaluate((k) => {
      try {
        return JSON.parse(window.localStorage.getItem(k) || '[]').length;
      } catch {
        return 0;
      }
    }, KEY.THUMBS);
    await waitForLocalStorageJsonArraySize(page, KEY.THUMBS, baseCount + 1, 60000);
    await sleep(1500);

    const after = await snapshotLocalStorage(page);
    const afterSize = await page.locator('.vault-grid--images .vault-card').count().catch(() => 0);

    const storedThumbs = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) || '[]'), KEY.THUMBS);
    const created = Array.isArray(storedThumbs) ? storedThumbs[storedThumbs.length - 1] : null;
    const identity = classifyIdentityThumbnail(created);

    // Reload: ensure the new entry is still present.
    await page.reload({ waitUntil: 'load', timeout: 60000 });
    await openControlCenterAndLogin(page);
    const afterReload = await snapshotLocalStorage(page);
    const afterReloadSize = await page.locator('.vault-grid--images .vault-card').count().catch(() => 0);
    const storedAfterReload = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) || '[]'), KEY.THUMBS);
    const stillPresent = Array.isArray(storedAfterReload)
      ? storedAfterReload.some((e) => {
          if (!e || typeof e !== 'object') return false;
          return (
            (created?.id && String(e.id || '') === String(created.id)) ||
            (created?.fileName && String(e.fileName || '') === String(created.fileName)) ||
            (created?.url && String(e.url || '') === String(created.url))
          );
        })
      : false;

    // Delete: remove the last rendered thumbnail card (newest is appended).
    const cards = page.locator('.vault-grid--images .vault-card');
    const cardCount = await cards.count();
    if (cardCount > 0) {
      await cards.nth(cardCount - 1).locator('.thumb-delete-btn').click();
      await sleep(2000);
    }
    await page.reload({ waitUntil: 'load', timeout: 60000 });
    await openControlCenterAndLogin(page);
    const afterDeleteReload = await snapshotLocalStorage(page);

    const storedAfterDeleteReload = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) || '[]'), KEY.THUMBS);
    const presentAfterDelete = Array.isArray(storedAfterDeleteReload)
      ? storedAfterDeleteReload.some((e) => {
          if (!e || typeof e !== 'object') return false;
          return (
            (created?.id && String(e.id || '') === String(created.id)) ||
            (created?.fileName && String(e.fileName || '') === String(created.fileName)) ||
            (created?.url && String(e.url || '') === String(created.url))
          );
        })
      : false;

    const pulled = await pullRuntimeOps(page);
    report.runtime.thumbnail = {
      ui: { beforeCount: beforeSize, afterCount: afterSize, afterReloadCount: afterReloadSize },
      storage: { before, after, afterReload, afterDeleteReload },
      createdEntry: created,
      identity,
      persistence: { stillPresentAfterReload: stillPresent, presentAfterDeleteReload: presentAfterDelete },
      ops: pulled.ops.slice(-300).map((o) => ({ ...o, stack: trimStack(o.stack) })),
      logs: pulled.logs.slice(-200),
      network: net.slice(-400)
    };
  }

  // ------------------------------
  // MP4 VAULT — upload → reload → delete → reload
  // ------------------------------
  {
    await openControlCenterAndLogin(page);
    const before = await snapshotLocalStorage(page);
    const beforeVault = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) || '[]'), KEY.VIDEO_VAULT);
    const beforeCount = Array.isArray(beforeVault) ? beforeVault.length : 0;

    let created = null;
    let identity = { canonical: null, identities: [] };
    let after = null;
    let afterReload = null;
    let afterDeleteReload = null;
    let stillPresent = false;
    let presentAfterDelete = false;
    let error = null;

    try {
      const postPromise = page.waitForResponse(
        (res) => res.request().method() === 'POST' && /\/api\/reels(\?|$)/.test(res.url()),
        { timeout: 120000 }
      );
      await dropFileOnSelector(
        page,
        'div.video-vault-drop[aria-label="Video drop zone"]',
        fixtures.mp4,
        'video/mp4'
      );

      const postRes = await postPromise.catch(() => null);
      const body = postRes ? await postRes.json().catch(() => null) : null;
      const createdId = body && typeof body === 'object' ? String(body.id || '').trim() : '';

      // Wait until local vault contains the created id (VaultExperience inserts at head, then persistPersonalVault writes).
      if (createdId) {
        const t0 = Date.now();
        while (Date.now() - t0 < 120000) {
          const found = await page.evaluate(({ k, id }) => {
            try {
              const arr = JSON.parse(window.localStorage.getItem(k) || '[]');
              if (!Array.isArray(arr)) return false;
              return arr.some((e) => e && typeof e === 'object' && String(e.id || '').trim() === id);
            } catch {
              return false;
            }
          }, { k: KEY.VIDEO_VAULT, id: createdId });
          if (found) break;
          await sleep(250);
        }
      } else {
        // Fallback: wait for array size to grow (best-effort).
        await waitForLocalStorageJsonArraySize(page, KEY.VIDEO_VAULT, beforeCount + 1, 120000);
      }

      await sleep(1500);
      after = await snapshotLocalStorage(page);
      const afterVault = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) || '[]'), KEY.VIDEO_VAULT);
      created = Array.isArray(afterVault)
        ? (createdId
            ? afterVault.find((e) => e && typeof e === 'object' && String(e.id || '').trim() === createdId) || afterVault[0]
            : afterVault[0])
        : null;
      identity = classifyIdentityVideo(created);

      await page.reload({ waitUntil: 'load', timeout: 60000 });
      await openControlCenterAndLogin(page);
      afterReload = await snapshotLocalStorage(page);
      const vaultAfterReload = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) || '[]'), KEY.VIDEO_VAULT);
      stillPresent = Array.isArray(vaultAfterReload)
        ? vaultAfterReload.some((e) => e && typeof e === 'object' && created?.id && String(e.id || '') === String(created.id))
        : false;

      // Delete: click delete on the first video vault card (VaultExperience inserts new at head; UI may render it early).
      const vCards = page.locator('.vault-grid--videos .vault-card');
      if ((await vCards.count()) > 0) {
        await vCards.first().locator('.thumb-delete-btn').click();
        await sleep(2500);
      }
      await page.reload({ waitUntil: 'load', timeout: 60000 });
      await openControlCenterAndLogin(page);
      afterDeleteReload = await snapshotLocalStorage(page);
      const vaultAfterDeleteReload = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) || '[]'), KEY.VIDEO_VAULT);
      presentAfterDelete = Array.isArray(vaultAfterDeleteReload)
        ? vaultAfterDeleteReload.some((e) => e && typeof e === 'object' && created?.id && String(e.id || '') === String(created.id))
        : false;
    } catch (e) {
      error = String(e?.message || e);
      after = await snapshotLocalStorage(page).catch(() => null);
    }

    const pulled = await pullRuntimeOps(page);
    report.runtime.mp4 = {
      error,
      storage: { before, after, afterReload, afterDeleteReload },
      createdEntry: created,
      identity,
      persistence: { stillPresentAfterReload: stillPresent, presentAfterDeleteReload: presentAfterDelete },
      ops: pulled.ops.slice(-300).map((o) => ({ ...o, stack: trimStack(o.stack) })),
      logs: pulled.logs.slice(-200),
      network: net.slice(-400)
    };
  }

  // ------------------------------
  // HERO BACKGROUND — upload → reload → delete (hero vault) → reload
  // ------------------------------
  {
    await openControlCenterAndLogin(page);
    const before = await snapshotLocalStorage(page);

    // Upload via hidden input in Hero Replace.
    const heroInput = page.locator('.hero-replace-section input[type="file"]');
    await heroInput.waitFor({ state: 'attached', timeout: 60000 });
    await heroInput.setInputFiles(fixtures.mp4);

    // Wait for hero manager + reel to appear (these are the core persisted identities).
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      const ok = await page.evaluate(({ mk, rk }) => {
        try {
          const m = JSON.parse(window.localStorage.getItem(mk) || 'null');
          const r = JSON.parse(window.localStorage.getItem(rk) || 'null');
          return Boolean(m && typeof m === 'object' && m.heroAssetId && r && typeof r === 'object' && r.id);
        } catch {
          return false;
        }
      }, { mk: KEY.HERO_MANAGER, rk: KEY.HERO_REEL });
      if (ok) break;
      await sleep(300);
    }
    await sleep(2000);

    const after = await snapshotLocalStorage(page);
    const manager = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) || 'null'), KEY.HERO_MANAGER);
    const reel = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) || 'null'), KEY.HERO_REEL);
    const heroAssetId = String(manager?.heroAssetId || '').trim() || null;

    await page.reload({ waitUntil: 'load', timeout: 60000 });
    await openControlCenterAndLogin(page);
    const afterReload = await snapshotLocalStorage(page);
    const managerAfterReload = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) || 'null'), KEY.HERO_MANAGER);
    const reelAfterReload = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) || 'null'), KEY.HERO_REEL);
    const stillPresent =
      Boolean(heroAssetId) &&
      String(managerAfterReload?.heroAssetId || '').trim() === heroAssetId &&
      String(reelAfterReload?.id || '').trim() === heroAssetId;

    // Delete via HeroManagerPanel hero vault (System tab).
    await openSystemTab(page);
    await page.waitForSelector('[data-hero-vault]', { timeout: 60000 });
    if (heroAssetId) {
      const card = page.locator(`[data-hero-vault-card][data-asset-id="${heroAssetId}"]`);
      if (await card.count()) {
        await card.first().locator('button', { hasText: 'Delete' }).click();
        await sleep(2500);
      }
    }

    await page.reload({ waitUntil: 'load', timeout: 60000 });
    await openControlCenterAndLogin(page);
    const afterDeleteReload = await snapshotLocalStorage(page);
    const managerAfterDeleteReload = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) || 'null'), KEY.HERO_MANAGER);
    const reelAfterDeleteReload = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) || 'null'), KEY.HERO_REEL);
    const presentAfterDelete =
      Boolean(heroAssetId) &&
      (String(managerAfterDeleteReload?.heroAssetId || '').trim() === heroAssetId ||
        String(reelAfterDeleteReload?.id || '').trim() === heroAssetId);

    const pulled = await pullRuntimeOps(page);
    report.runtime.hero = {
      storage: { before, after, afterReload, afterDeleteReload },
      manager,
      reel,
      canonical: { heroAssetId },
      persistence: { stillPresentAfterReload: stillPresent, presentAfterDeleteReload: presentAfterDelete },
      ops: pulled.ops.slice(-300).map((o) => ({ ...o, stack: trimStack(o.stack) })),
      logs: pulled.logs.slice(-200),
      network: net.slice(-500)
    };
  }

  report.runtime.capture.endedAt = isoNow();

  // Architecture verdict (static + runtime). We only claim failures that appear in runtime evidence.
  const runtimeFailures = {
    thumbLostOnReload: report.runtime.thumbnail && report.runtime.thumbnail.persistence?.stillPresentAfterReload === false,
    mp4LostOnReload: report.runtime.mp4 && report.runtime.mp4.persistence?.stillPresentAfterReload === false,
    heroLostOnReload: report.runtime.hero && report.runtime.hero.persistence?.stillPresentAfterReload === false
  };
  const anyLost = runtimeFailures.thumbLostOnReload || runtimeFailures.mp4LostOnReload || runtimeFailures.heroLostOnReload;
  if (!anyLost) {
    report.verdict = 'INSUFFICIENT EVIDENCE';
  } else if (runtimeFailures.mp4LostOnReload && !runtimeFailures.heroLostOnReload) {
    report.verdict = 'MP4 HAS UNIQUE PERSISTENCE FAILURE';
  } else if (runtimeFailures.heroLostOnReload && !runtimeFailures.mp4LostOnReload) {
    report.verdict = 'HERO HAS UNIQUE PERSISTENCE FAILURE';
  } else {
    report.verdict = 'MULTIPLE SOURCES CREATE STATE DRIFT';
  }

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

