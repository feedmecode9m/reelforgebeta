#!/usr/bin/env node
/**
 * MISSION RC3-DELETE-01 — Hero / Trending Ghost Item Deletion Boundary
 *
 * Evidence only. No application source changes. No fixes. No commits. No deploys.
 *
 * Objective:
 *   Identify where deletion fails for "HERO" / "Trending" items that remain visible after delete.
 *
 * Method:
 *  - Static inventory of delete handlers (studio feed + hero vault + vault experiences).
 *  - Runtime Playwright capture:
 *      - confirm the "RECENTLY ADDED PRODUCTIONS" list contains items
 *      - delete one HERO item (via StudioLauncher delete modal confirm)
 *      - delete one Trending item (via StudioLauncher delete modal confirm)
 *      - capture localStorage before/after + storage ops call stacks
 *      - capture network DELETE /api/reels/{id} + subsequent GET /api/reels
 *      - reload, re-check list for persistence of deleted items
 *
 * Output:
 *   frontend/artifacts/rc3-delete-01-ghost-item-boundary.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app/').replace(
  /\/?$/,
  '/'
);
const API_URL = (process.env.API_URL || FRONTEND_URL).replace(/\/$/, '');
const OUT =
  process.env.OUT ||
  path.join(__dirname, '..', 'artifacts', 'rc3-delete-01-ghost-item-boundary.json');
const WAIT_MS = Number(process.env.WAIT_MS || 25000);
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const STORAGE_KEYS_OF_INTEREST = [
  'reelforge_hero_manager_config',
  'reelforge_hero_reel',
  'reelforge_hero_video',
  'reelforge_hero_image',
  'reelforge_feed',
  'reel_vault',
  'personal_video_vault',
  'video_vault_index',
  'personal_thumbnails',
  'personal_thumbnail_index'
];

function isoNow() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safePreview(value, max = 140) {
  const s = String(value ?? '');
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function trimStack(stack, maxLines = 14) {
  return String(stack || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, maxLines);
}

function summarizeStorageValue(raw) {
  const text = raw == null ? null : String(raw);
  if (text == null) return { present: false, len: 0, preview: null, jsonType: null, jsonSize: null };
  const out = { present: true, len: text.length, preview: safePreview(text), jsonType: null, jsonSize: null };
  try {
    const parsed = JSON.parse(text);
    out.jsonType = Array.isArray(parsed) ? 'array' : typeof parsed;
    out.jsonSize = Array.isArray(parsed)
      ? parsed.length
      : parsed && typeof parsed === 'object'
        ? Object.keys(parsed).length
        : null;
  } catch {
    // ignore
  }
  return out;
}

async function snapshotLocalStorage(page) {
  return await page.evaluate((keys) => {
    /** @type {Record<string, {present: boolean, len: number, preview: string|null, raw: string|null}>} */
    const picked = {};
    for (const k of keys) {
      try {
        const v = window.localStorage.getItem(k);
        picked[k] = {
          present: v != null,
          len: v ? v.length : 0,
          preview: v ? (v.length <= 140 ? v : `${v.slice(0, 140)}…`) : null,
          raw: v
        };
      } catch (e) {
        picked[k] = { present: false, len: 0, preview: null, raw: null };
      }
    }
    // Also include any additional keys matching patterns so we don't miss the stale source.
    const extra = {};
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (!key) continue;
        if (keys.includes(key)) continue;
        if (!/(hero|feed|vault|reel|video|thumb|thumbnail|series|workflow|notif|reelforge)/i.test(key)) continue;
        const v = window.localStorage.getItem(key);
        extra[key] = {
          present: v != null,
          len: v ? v.length : 0,
          preview: v ? (v.length <= 140 ? v : `${v.slice(0, 140)}…`) : null
        };
      }
    } catch {
      // ignore
    }
    return { picked, extra, ts: Date.now() };
  }, STORAGE_KEYS_OF_INTEREST);
}

async function readDeleteModal(page) {
  const visible = await page.locator('.delete-modal-overlay').isVisible().catch(() => false);
  if (!visible) return { visible: false, title: null, categoryLabel: null };
  const title = await page.locator('.delete-reel-title').textContent().catch(() => null);
  const categoryLabel = await page.locator('.delete-details span').textContent().catch(() => null);
  return { visible: true, title: title ? String(title).trim() : null, categoryLabel: categoryLabel ? String(categoryLabel).trim() : null };
}

async function openControlCenter(page) {
  const overlay = page.locator('.control-center-overlay');
  const alreadyOpen = await overlay.isVisible().catch(() => false);
  if (!alreadyOpen) {
    const btn = page.locator('button.ghost-trigger');
    await btn.waitFor({ timeout: 60000 });
    await btn.click();
  }

  // Control center overlay must be present.
  await page.waitForSelector('.control-center-overlay', { timeout: 60000 });
  await page.waitForSelector('.control-center-container', { timeout: 60000 });

  // The "RECENTLY ADDED PRODUCTIONS" section is behind admin auth. If the login panel is visible,
  // unlock using a documented local/dev password to match real user flow.
  const loginVisible = await page.locator('.admin-login-panel').isVisible().catch(() => false);
  if (loginVisible) {
    const input = page.locator('.admin-login-panel input[type="password"]');
    await input.fill(process.env.ADMIN_PASSWORD || 'SMART_PRODUCTION');
    await page.locator('.admin-login-panel button.submit-btn').click();
    // Wait for either success (logout button) or an error message.
    await page
      .waitForSelector('.logout-btn, .admin-login-panel .login-error', { timeout: 60000 })
      .catch(() => {});
  }

  // Navigate to the workspace "Content" tab (where the "RECENTLY ADDED PRODUCTIONS" list lives).
  const contentTab = page.locator('[data-studio-workspace-tabs] button', { hasText: 'Content' });
  if (await contentTab.isVisible().catch(() => false)) {
    await contentTab.click();
  }

  // Wait until the asset list is reachable (best proxy for the target list).
  await page.waitForSelector('.asset-list', { timeout: 60000 });
}

async function listRecentProductionCards(page) {
  // Cards are rendered as .asset-item.smart-item blocks.
  const rows = page.locator('.asset-list .asset-item.smart-item');
  const count = await rows.count();
  /** @type {Array<{index:number, category:string|null, detectionMeta:string|null, hasVideoBadge:boolean, titlePreview:string|null}>} */
  const items = [];
  for (let i = 0; i < Math.min(count, 20); i++) {
    const row = rows.nth(i);
    const category = await row.locator('.smart-category').textContent().catch(() => null);
    const detectionMeta = await row.locator('.detection-meta').textContent().catch(() => null);
    const hasVideoBadge = await row.locator('.video-badge').isVisible().catch(() => false);
    const titleVal = await row.locator('input.asset-title-input').inputValue().catch(() => null);
    items.push({
      index: i,
      category: category ? String(category).trim() : null,
      detectionMeta: detectionMeta ? String(detectionMeta).trim() : null,
      hasVideoBadge,
      titlePreview: titleVal ? safePreview(String(titleVal).trim(), 60) : null
    });
  }
  return { count, items };
}

async function clickDeleteForCategory(page, categoryName) {
  const rows = page.locator('.asset-list .asset-item.smart-item');
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const cat = await row.locator('.smart-category').textContent().catch(() => null);
    if (String(cat || '').trim() !== categoryName) continue;
    const detectionMeta = await row.locator('.detection-meta').textContent().catch(() => null);
    // Prefer manually placed entries for match with baseline cards.
    if (!String(detectionMeta || '').includes('Manually placed')) {
      continue;
    }
    await row.locator('button.delete-btn').click();
    return { ok: true, clickedIndex: i, category: categoryName, detectionMeta: String(detectionMeta || '').trim() };
  }
  // Fallback: first matching category regardless of auto/manual.
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const cat = await row.locator('.smart-category').textContent().catch(() => null);
    if (String(cat || '').trim() !== categoryName) continue;
    const detectionMeta = await row.locator('.detection-meta').textContent().catch(() => null);
    await row.locator('button.delete-btn').click();
    return { ok: true, clickedIndex: i, category: categoryName, detectionMeta: String(detectionMeta || '').trim() };
  }
  return { ok: false, clickedIndex: -1, category: categoryName, detectionMeta: null };
}

async function confirmDeleteModal(page) {
  await page.waitForSelector('.delete-modal-overlay', { timeout: 20000 });
  const modal = await readDeleteModal(page);
  await page.locator('button.delete-confirm-btn').click();
  // Wait for modal to disappear (success path clears deleteConfirmReel).
  await page.waitForSelector('.delete-modal-overlay', { state: 'detached', timeout: 60000 }).catch(async () => {
    // If it stayed open, capture a snapshot anyway (failure path keeps modal open).
    await sleep(1500);
  });
  const after = await readDeleteModal(page);
  return { before: modal, after };
}

async function pullRuntimeOps(page) {
  return await page.evaluate(() => {
    const ops = Array.isArray(window.__rc3DeleteOps) ? window.__rc3DeleteOps : [];
    const logs = Array.isArray(window.__rc3DeleteConsole) ? window.__rc3DeleteConsole : [];
    return { ops, logs };
  });
}

function classifyVerdict(evidence) {
  const d = evidence.runtime?.deletions || [];
  if (d.length === 0) return 'INSUFFICIENT EVIDENCE';
  const anyHandler = d.some((x) => x.consoleTags.some((t) => t.tag === 'DELETE_HANDLER_FIRED'));
  if (!anyHandler) return 'DELETE NEVER EXECUTES';
  const anyDeleteRequest = d.some((x) => x.network.deleteRequests.length > 0);
  const anyDeleteOk = d.some((x) => x.network.deleteRequests.some((r) => r.ok));
  if (anyDeleteRequest && !anyDeleteOk) return 'DELETE EXECUTES BUT STORAGE REMAINS';
  // If delete succeeded but item still present after reload, boundary is rehydrate/recreate.
  const anyStillVisible = d.some((x) => x.postReload?.stillVisible === true);
  if (anyDeleteOk && anyStillVisible) {
    const backendStillHas = d.some((x) => x.postReload?.backendContainsDeletedId === true);
    if (backendStillHas) return 'WRONG ID USED FOR DELETE';
    return 'DELETE REMOVES STORAGE BUT UI REHYDRATES';
  }
  // If delete succeeded and the item is gone from backend + UI after reload, the reported bug was not reproduced.
  if (anyDeleteOk && !anyStillVisible) return 'INSUFFICIENT EVIDENCE';
  return 'INSUFFICIENT EVIDENCE';
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const report = {
    mission: 'RC3-DELETE-01',
    generatedAt: isoNow(),
    frontendUrl: FRONTEND_URL,
    apiUrl: API_URL,
    static: {
      handlers: [
        {
          scope: 'studio-feed (HERO / Trending / manually placed cards)',
          file: 'frontend/src/lib/viewer/uiAgent.js',
          function: 'UIAgent.deleteProduction(id) → UIAgent.confirmDelete()',
          caller: 'frontend/src/components/experiences/StudioExperience.svelte (Content tab: RECENTLY ADDED PRODUCTIONS DELETE) → frontend/src/components/viewer/StudioLauncher.svelte delete modal confirm',
          event: 'Control Center → Content → RECENTLY ADDED PRODUCTIONS → click DELETE then click CONFIRM DELETE',
          storageKeysAffected: ['reelforge_feed (via feed.subscribe + syncFromVault)', 'reel_vault (offline fallback only)']
        },
        {
          scope: 'backend deletion (authoritative reels)',
          file: 'frontend/src/lib/viewer/contentAgents.js',
          function: 'ProductionAgent.deleteReel(reelId)',
          caller: 'UIAgent.confirmDelete()',
          event: 'invoked after modal confirm',
          storageKeysAffected: ['reelforge_feed (indirect via syncFromVault)', 'personal_video_vault (indirect via purge logic if matches)']
        },
        {
          scope: 'API delete primitive',
          file: 'frontend/src/lib/api/media.js',
          function: 'deleteReelById(reelId, headers)',
          caller: 'ProductionAgent.deleteReel / VaultExperience / HeroManagerPanel',
          event: 'fetch DELETE /api/reels/{id}',
          storageKeysAffected: []
        },
        {
          scope: 'hero-vault deletion (hero registry card)',
          file: 'frontend/src/components/studio/HeroManagerPanel.svelte',
          function: 'deleteHeroVaultAsset(item)',
          caller: 'HeroManagerPanel UI (native confirm dialog)',
          event: 'click hero vault delete button → window.confirm',
          storageKeysAffected: ['reelforge_hero_video', 'reelforge_hero_image', 'reelforge_hero_manager_config (if deleting selected hero asset)']
        },
        {
          scope: 'vault deletion (personal video / thumbnail vault)',
          file: 'frontend/src/components/experiences/VaultExperience.svelte',
          function: 'deleteReelById(reelId) + apply*DeleteTombstone + batch delete flows',
          caller: 'VaultExperience UI buttons (single + batch delete)',
          event: 'click delete controls in vault grids',
          storageKeysAffected: ['personal_video_vault', 'video_vault_index', 'personal_thumbnails', 'personal_thumbnail_index']
        }
      ]
    },
    runtime: {
      capture: { startedAt: null, endedAt: null },
      deletions: []
    },
    verdict: null
  };

  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    headless: true
  });

  const context = await browser.newContext();
  await context.addInitScript(() => {
    // Storage ops capture (evidence only)
    const ops = [];
    const consoleLog = [];
    Object.defineProperty(window, '__rc3DeleteOps', { value: ops, configurable: false, writable: false });
    Object.defineProperty(window, '__rc3DeleteConsole', { value: consoleLog, configurable: false, writable: false });

    const orig = {
      lsGet: window.localStorage.getItem.bind(window.localStorage),
      lsSet: window.localStorage.setItem.bind(window.localStorage),
      lsRemove: window.localStorage.removeItem.bind(window.localStorage),
      ssGet: window.sessionStorage.getItem.bind(window.sessionStorage)
    };

    function record(op) {
      try {
        ops.push(op);
      } catch {
        // ignore
      }
    }

    function stack() {
      try {
        throw new Error('__rc3_delete_stack__');
      } catch (e) {
        return String(e?.stack || '');
      }
    }

    // Wrap localStorage methods (no storage reads inside record to avoid recursion).
    window.localStorage.getItem = function (key) {
      const t0 = Date.now();
      const v = orig.lsGet(key);
      record({ ts: t0, storageType: 'localStorage', op: 'getItem', key: String(key), valueLen: v ? String(v).length : 0, stack: stack() });
      return v;
    };
    window.localStorage.setItem = function (key, value) {
      const t0 = Date.now();
      const v = value == null ? '' : String(value);
      record({ ts: t0, storageType: 'localStorage', op: 'setItem', key: String(key), valueLen: v.length, stack: stack() });
      return orig.lsSet(key, value);
    };
    window.localStorage.removeItem = function (key) {
      const t0 = Date.now();
      record({ ts: t0, storageType: 'localStorage', op: 'removeItem', key: String(key), valueLen: 0, stack: stack() });
      return orig.lsRemove(key);
    };

    // Capture high-signal console tags emitted by app code.
    const origInfo = console.info.bind(console);
    console.info = (...args) => {
      try {
        if (args?.[0] && typeof args[0] === 'string' && args[0].startsWith('[') && args[0].includes('DELETE')) {
          consoleLog.push({ ts: Date.now(), level: 'info', args: args.slice(0, 3) });
        }
      } catch {
        // ignore
      }
      return origInfo(...args);
    };

    // Expose a cheap getter for whether admin token exists (read via original getter to avoid double-logging).
    window.__rc3DeleteHasAdminToken = () => {
      try {
        return Boolean(orig.lsGet('reelforge_admin_session_token'));
      } catch {
        return false;
      }
    };

    // Expose phase marker storage read without recursion (kept for parity with earlier missions).
    window.__rc3DeletePhase = () => {
      try {
        return String(orig.ssGet('__rc3_delete_phase__') || '');
      } catch {
        return '';
      }
    };
  });

  const page = await context.newPage();

  /** @type {Array<{ts:number, url:string, method:string, status:number|null, ok:boolean|null, kind:string}>} */
  const net = [];
  page.on('request', (req) => {
    const url = req.url();
    const method = req.method();
    if (!url.includes('/api/')) return;
    if (!/(\/api\/reels\b|\/api\/reels\/)/.test(url)) return;
    net.push({ ts: Date.now(), url, method, status: null, ok: null, kind: 'request' });
  });
  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('/api/')) return;
    if (!/(\/api\/reels\b|\/api\/reels\/)/.test(url)) return;
    const status = res.status();
    net.push({ ts: Date.now(), url, method: res.request().method(), status, ok: res.ok(), kind: 'response' });
  });

  report.runtime.capture.startedAt = isoNow();

  await page.goto(FRONTEND_URL, { waitUntil: 'load', timeout: 60000 });
  await openControlCenter(page);

  const adminTokenPresent = await page.evaluate(() => window.__rc3DeleteHasAdminToken?.() || false);
  const beforeCards = await listRecentProductionCards(page);
  const beforeStorage = await snapshotLocalStorage(page);

  const deletions = [];

  for (const categoryName of ['HERO', 'Trending']) {
    // Ensure control center is open and cards are present (it may close after interactions).
    await openControlCenter(page);

    const pre = {
      categoryName,
      startedAt: isoNow(),
      adminTokenPresent,
      listBefore: await listRecentProductionCards(page),
      storageBefore: beforeStorage,
      click: null,
      modal: null,
      storageAfter: null,
      listAfter: null,
      runtimeOps: null,
      consoleTags: [],
      network: { deleteRequests: [], catalogGets: [] },
      postReload: null,
      endedAt: null
    };

    pre.click = await clickDeleteForCategory(page, categoryName);
    if (!pre.click.ok) {
      pre.endedAt = isoNow();
      deletions.push(pre);
      continue;
    }

    pre.modal = await confirmDeleteModal(page);

    // Small settle to allow syncFromVault writes/logs to complete.
    await sleep(3000);
    pre.storageAfter = await snapshotLocalStorage(page);
    pre.listAfter = await listRecentProductionCards(page);

    const pulled = await pullRuntimeOps(page);
    pre.runtimeOps = {
      ops: pulled.ops.slice(-250).map((o) => ({
        ts: o.ts,
        storageType: o.storageType,
        op: o.op,
        key: o.key,
        valueLen: o.valueLen,
        stack: trimStack(o.stack)
      })),
      logs: pulled.logs.slice(-80)
    };

    // Parse console tag payloads into a normalized list (best-effort).
    pre.consoleTags = (pre.runtimeOps.logs || [])
      .map((l) => {
        const msg = l.args?.[0];
        const payload = l.args?.[1];
        if (typeof msg !== 'string') return null;
        const tag = msg.replace(/^\[|\]$/g, '');
        return { ts: l.ts, tag, payload: payload && typeof payload === 'object' ? payload : null };
      })
      .filter(Boolean);

    // Network slice for this deletion window (from click until now).
    const windowStart = new Date(pre.startedAt).getTime() - 500;
    const windowEnd = Date.now() + 500;
    const netWindow = net.filter((e) => e.ts >= windowStart && e.ts <= windowEnd);
    const deleteReqs = [];
    const gets = [];
    for (const e of netWindow) {
      const isDelete = e.method === 'DELETE' && /\/api\/reels\//.test(e.url);
      const isGet = e.method === 'GET' && /\/api\/reels(\?|$)/.test(e.url);
      if (isDelete && e.kind === 'response') {
        deleteReqs.push({ ts: e.ts, url: e.url, status: e.status, ok: e.ok });
      }
      if (isGet && e.kind === 'response') {
        gets.push({ ts: e.ts, url: e.url, status: e.status, ok: e.ok });
      }
    }
    pre.network.deleteRequests = deleteReqs;
    pre.network.catalogGets = gets;

    // Determine deleted id from either DELETE URL or console tags.
    const deletedId =
      deleteReqs[0]?.url?.match(/\/api\/reels\/([^/?#]+)/)?.[1] ||
      pre.consoleTags.find((t) => t.tag === 'DELETE_COMPLETE')?.payload?.itemId ||
      pre.consoleTags.find((t) => t.tag === 'DELETE_CONFIRMED')?.payload?.itemId ||
      null;

    // Reload and check whether the deleted id is present in backend catalog + UI list.
    await page.reload({ waitUntil: 'load', timeout: 60000 });
    await openControlCenter(page);
    const afterReloadCards = await listRecentProductionCards(page);
    const afterReloadStorage = await snapshotLocalStorage(page);

    // Pull backend catalog directly to avoid UI inference.
    let catalog = [];
    let catalogError = null;
    try {
      const res = await fetch(`${API_URL}/api/reels?t=${Date.now()}`, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`GET /api/reels HTTP ${res.status}`);
      const body = await res.json();
      catalog = Array.isArray(body) ? body : [];
    } catch (e) {
      catalogError = String(e?.message || e);
    }

    const backendContainsDeletedId = Boolean(
      deletedId && catalog.some((r) => String(r?.id || '') === String(deletedId))
    );

    // UI "still visible" heuristic: same category + same display title (from modal) present after reload.
    const displayName = pre.modal?.before?.title ? String(pre.modal.before.title).replace(/^"|"$/g, '') : null;
    const stillVisible =
      Boolean(displayName) &&
      afterReloadCards.items.some(
        (it) => String(it.category || '') === categoryName && String(it.titlePreview || '').includes(displayName.slice(0, 10))
      );

    pre.postReload = {
      deletedId: deletedId ? decodeURIComponent(String(deletedId)) : null,
      displayName,
      listAfterReload: afterReloadCards,
      storageAfterReload: afterReloadStorage,
      backendCatalogCount: catalog.length,
      backendCatalogError: catalogError,
      backendContainsDeletedId,
      stillVisible
    };

    pre.endedAt = isoNow();
    deletions.push(pre);
  }

  report.runtime.deletions = deletions;
  report.runtime.capture.endedAt = isoNow();
  report.verdict = classifyVerdict(report);

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

