#!/usr/bin/env node
/**
 * RC3-HERO-OWNER-01 — Canonical Hero State Ownership Trace
 *
 * Evidence only. No application source changes. No fixes. No commits. No deploys.
 *
 * Objective:
 *   Starting ONLY after a valid hero save exists (reelforge_hero_reel + matching heroAssetId),
 *   prove where heroAssetId becomes empty or fails to restore — by observing reads/writes
 *   to hero localStorage keys + related CustomEvents, with call stacks.
 *
 * Notes:
 * - We do not call internal module functions directly (bundled/minified). Instead we:
 *   - instrument localStorage.getItem/setItem/removeItem/clear
 *   - instrument dispatchEvent for hero-related CustomEvents
 *   - capture console tags emitted by production bundle ([HERO_LOAD], [HERO_SAVE], [HERO_REEL_SAVE], etc.)
 * - We seed a known-good hero state in localStorage (counts as “successful save exists” for this trace),
 *   then hard reload and observe whether anything overwrites it.
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
  path.join(__dirname, '..', 'artifacts', 'rc3-hero-owner-01.json');
const WAIT_MS = Number(process.env.WAIT_MS || 25000);
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const HERO_KEYS = /** @type {const} */ ({
  manager: 'reelforge_hero_manager_config',
  reel: 'reelforge_hero_reel',
  video: 'reelforge_hero_video',
  image: 'reelforge_hero_image'
});

function isoNow() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchSeedHeroReel() {
  const res = await fetch(`${API_URL}/api/reels?t=${Date.now()}`, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
  const catalog = await res.json();

  // Prefer the known RC2 hero reel if present.
  const preferredId = '192293f7-c784-46af-aa45-1bb15b6a4cc6';
  const preferred =
    catalog.find((r) => String(r?.id || '') === preferredId) ||
    catalog.find((r) => String(r?.category || '').toUpperCase() === 'HERO' && String(r?.status || '').toLowerCase() === 'ready') ||
    catalog.find((r) => String(r?.status || '').toLowerCase() === 'ready');
  if (!preferred) throw new Error('No catalog reel available for seeding');

  const url = String(preferred.url || preferred.videoUrl || preferred.video_url || '');
  if (!url) throw new Error('Seed reel missing url');

  // Persist the same structure heroReelIdentity expects.
  const urlPath = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url.startsWith('/') ? url : `/${url}`;
    }
  })();

  const fileName = String(preferred.fileName || preferred.filename || '').trim() || urlPath.split('/').pop() || '';
  return {
    id: String(preferred.id),
    fileName,
    name: String(preferred.name || preferred.title || 'Seed Hero'),
    url: urlPath,
    type: String(preferred.type || 'video/mp4'),
    backgroundSource: 'custom_video',
    category: preferred.category || null,
    status: preferred.status || null
  };
}

function trimStack(stack, maxLines = 14) {
  return String(stack || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, maxLines);
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const seed = await fetchSeedHeroReel();

  const report = {
    mission: 'RC3-HERO-OWNER-01',
    baseline: ['RC1-2026-07-19-POST-08C', 'RC2 MP4 Acceptance PASS', 'RC2 Hero Persistence PASS'],
    productionBundleExpected: '/assets/index-Btl25zBV.js',
    generatedAt: isoNow(),
    frontendUrl: FRONTEND_URL,
    apiUrl: API_URL,
    seed,
    capture: {
      startedAt: null,
      seededAt: null,
      reloadedAt: null,
      endedAt: null
    },
    evidence: {
      bundle: null,
      console: [],
      heroConsole: [],
      pageErrors: [],
      storageOps: [],
      customEvents: [],
      finalStorageSnapshot: null
    },
    derived: {
      // boundary detection results:
      boundary: null,
      boundaryEventId: null,
      boundaryReason: '',
      verdict: 'INSUFFICIENT EVIDENCE'
    }
  };

  // --- Init script: storage + event instrumentation ---
  const initScript = `
(() => {
  const HERO_KEYS = ${JSON.stringify(HERO_KEYS)};
  const TRACK_KEYS = new Set(Object.values(HERO_KEYS));
  const MAX = 1200;

  function now() {
    return {
      iso: new Date().toISOString(),
      perf: typeof performance !== 'undefined' ? performance.now() : null,
      origin: typeof performance !== 'undefined' ? performance.timeOrigin : null
    };
  }

  function safeParseJson(raw) {
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function summarizeKey(key, raw) {
    if (raw == null) return { present: false, length: 0, heroAssetId: null, reelId: null };
    const parsed = safeParseJson(raw);
    const heroAssetId = parsed && typeof parsed === 'object' ? String(parsed.heroAssetId || parsed.backgroundAsset || '').trim() : null;
    const reelId = parsed && typeof parsed === 'object' ? String(parsed.id || '').trim() : null;
    return { present: true, length: String(raw).length, heroAssetId, reelId };
  }

  function push(arr, row) {
    arr.push(row);
    if (arr.length > MAX) arr.shift();
  }

  const out = (window.__rc3HeroOwner01 = window.__rc3HeroOwner01 || {
    startedAt: new Date().toISOString(),
    storageOps: [],
    customEvents: [],
    notes: []
  });

  // Track a "trigger label" to annotate ops from the harness (seed, reload, etc.)
  window.__rc3HeroOwner01Trigger = window.__rc3HeroOwner01Trigger || '';

  // ---- Wrap localStorage methods (without changing semantics) ----
  const ls = window.localStorage;
  const orig = {
    getItem: ls.getItem.bind(ls),
    setItem: ls.setItem.bind(ls),
    removeItem: ls.removeItem.bind(ls),
    clear: ls.clear.bind(ls)
  };

  function capture(op, key, nextValue) {
    if (key && !TRACK_KEYS.has(String(key))) return;
    const clock = now();
    const stack = new Error('RC3-HERO-OWNER-01 stack').stack;
    const prevRaw = key ? orig.getItem(String(key)) : null;
    const prev = key ? summarizeKey(String(key), prevRaw) : null;
    const nextRaw = nextValue !== undefined ? String(nextValue) : null;
    const next = key ? summarizeKey(String(key), nextRaw) : null;
    const row = {
      id: out.storageOps.length + 1,
      ts: clock.iso,
      perfNowMs: clock.perf,
      trigger: window.__rc3HeroOwner01Trigger || '',
      op,
      key: key ? String(key) : null,
      prev,
      next,
      stack: stack ? stack.split('\\n').map((l) => l.trim()).slice(0, 18) : []
    };
    push(out.storageOps, row);
  }

  ls.getItem = function(key) {
    capture('getItem', key);
    return orig.getItem(String(key));
  };
  ls.setItem = function(key, value) {
    capture('setItem', key, value);
    return orig.setItem(String(key), String(value));
  };
  ls.removeItem = function(key) {
    capture('removeItem', key);
    return orig.removeItem(String(key));
  };
  ls.clear = function() {
    capture('clear', null);
    return orig.clear();
  };

  // ---- Capture CustomEvents that represent ownership boundaries ----
  const origDispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function(event) {
    try {
      const type = event && event.type;
      if (type === 'reelforge:hero-manager-updated' || type === 'reelforge:hero-reel-updated') {
        const clock = now();
        const stack = new Error('RC3-HERO-OWNER-01 event stack').stack;
        const detail = event && event.detail ? event.detail : null;
        const heroAssetId = detail && typeof detail === 'object' ? String(detail.heroAssetId || detail.backgroundAsset || '').trim() : '';
        push(out.customEvents, {
          id: out.customEvents.length + 1,
          ts: clock.iso,
          trigger: window.__rc3HeroOwner01Trigger || '',
          type,
          heroAssetId,
          detailKeys: detail && typeof detail === 'object' ? Object.keys(detail) : [],
          stack: stack ? stack.split('\\n').map((l) => l.trim()).slice(0, 18) : []
        });
      }
    } catch (e) {
      out.notes.push(String(e?.message || e));
    }
    return origDispatch.call(this, event);
  };
})();
`;

  const launch = { headless: true };
  if (fs.existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;
  const browser = await chromium.launch(launch);
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  report.capture.startedAt = isoNow();
  await page.addInitScript(initScript);

  page.on('console', (msg) => {
    const row = { ts: isoNow(), type: msg.type(), text: msg.text().slice(0, 4000) };
    report.evidence.console.push(row);
    if (report.evidence.console.length > 800) report.evidence.console.shift();

    if (
      /\\[(HERO_LOAD|HERO_SAVE|HERO_REEL_SAVE|HERO_STORE_READ|HERO_CLASSIFY|HERO_ASSET_ID_TRACE|BG7V_HERO_RESTORE_REASON)\\]/.test(
        row.text
      )
    ) {
      report.evidence.heroConsole.push(row);
      if (report.evidence.heroConsole.length > 400) report.evidence.heroConsole.shift();
    }
  });
  page.on('pageerror', (err) => {
    report.evidence.pageErrors.push({
      ts: isoNow(),
      message: String(err?.message || err),
      stack: String(err?.stack || '').slice(0, 2000)
    });
  });

  // Navigate to establish origin storage access.
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  report.evidence.bundle = await page.evaluate(() => {
    const s = document.querySelector('script[src*="assets/index-"]');
    return s ? s.getAttribute('src') : null;
  });

  // Clear hero keys first to ensure seed establishes the “successful save exists” boundary.
  await page.evaluate((KEYS) => {
    window.__rc3HeroOwner01Trigger = 'pre-seed:clear';
    for (const k of Object.values(KEYS)) localStorage.removeItem(k);
    window.__rc3HeroOwner01Trigger = '';
  }, HERO_KEYS);

  // Seed valid hero save (manager + reel) — this is the start boundary for this mission.
  report.capture.seededAt = isoNow();
  await page.evaluate(
    ({ KEYS, seed }) => {
      window.__rc3HeroOwner01Trigger = 'seed:write_valid_hero_state';
      const manager = {
        backgroundSource: 'custom_video',
        backgroundStyle: 'video',
        heroAssetId: seed.id,
        updatedAt: Date.now()
      };
      const reel = {
        id: seed.id,
        fileName: seed.fileName,
        name: seed.name,
        url: seed.url,
        type: seed.type,
        backgroundSource: 'custom_video'
      };
      localStorage.setItem(KEYS.reel, JSON.stringify(reel));
      localStorage.setItem(KEYS.manager, JSON.stringify(manager));
      window.__rc3HeroOwner01Trigger = '';
    },
    { KEYS: HERO_KEYS, seed }
  );

  // Verify the seeded state exists before we start boundary search.
  const seededSnapshot = await page.evaluate((KEYS) => {
    function parse(key) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    }
    const mgr = parse(KEYS.manager);
    const reel = parse(KEYS.reel);
    return {
      manager: mgr,
      reel,
      valid: Boolean(mgr?.heroAssetId && reel?.id && reel?.url && String(mgr.heroAssetId) === String(reel.id))
    };
  }, HERO_KEYS);
  if (!seededSnapshot?.valid) {
    throw new Error(`RC3-HERO-OWNER-01: seed failed to establish valid hero save`);
  }

  // Hard reload to observe the restore chain + any overwrites.
  report.capture.reloadedAt = isoNow();
  await page.evaluate(() => {
    window.__rc3HeroOwner01Trigger = 'reload:hard';
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(WAIT_MS);
  await page.evaluate(() => {
    window.__rc3HeroOwner01Trigger = '';
  });

  // Pull out init-script evidence buffers.
  const inPage = await page.evaluate((KEYS) => {
    const out = window.__rc3HeroOwner01 || {};
    function parse(key) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    }
    return {
      storageOps: out.storageOps || [],
      customEvents: out.customEvents || [],
      notes: out.notes || [],
      finalStorage: {
        manager: parse(KEYS.manager),
        reel: parse(KEYS.reel),
        video: localStorage.getItem(KEYS.video),
        image: localStorage.getItem(KEYS.image)
      }
    };
  }, HERO_KEYS);

  report.evidence.storageOps = inPage.storageOps || [];
  report.evidence.customEvents = inPage.customEvents || [];
  report.evidence.finalStorageSnapshot = inPage.finalStorage || null;
  if (inPage.notes?.length) {
    report.evidence.console.push({ ts: isoNow(), type: 'info', text: `[RC3-HERO-OWNER-01 notes] ${inPage.notes.join(' | ')}` });
  }

  // --- Boundary detection (first proven ownership break after the valid seed) ---
  // Only consider ops after the seed trigger.
  const ops = report.evidence.storageOps;
  const afterSeed = ops.filter((o) => o.trigger !== 'pre-seed:clear'); // keep seed + post-seed + reload

  function isHeroManagerKey(o) {
    return o?.key === HERO_KEYS.manager;
  }
  function isHeroReelKey(o) {
    return o?.key === HERO_KEYS.reel;
  }
  function wroteEmptyHeroAssetId(o) {
    if (!isHeroManagerKey(o) || o.op !== 'setItem') return false;
    // next.heroAssetId may be null when parse fails; treat as non-proof.
    return o.next && typeof o.next.heroAssetId === 'string' && o.next.heroAssetId === '';
  }
  function removedHeroReel(o) {
    return isHeroReelKey(o) && (o.op === 'removeItem' || o.op === 'clear');
  }
  function overwroteManagerWithDefaults(o) {
    // Proof-only heuristic: a setItem that sets heroAssetId='' AND backgroundSource==='selection' (if parsed).
    if (!isHeroManagerKey(o) || o.op !== 'setItem') return false;
    const rawLen = o.next?.length || 0;
    const parsed = o.next || {};
    // The summarizer only extracts heroAssetId/reelId; we can't see backgroundSource here.
    // Therefore default-overwrite must be proven via console tag [HERO_SAVE] / [HERO_LOAD] downstream.
    return rawLen > 0 && parsed.heroAssetId === '';
  }

  // Find first offending op that is NOT our explicit seed.
  const boundaryCandidates = afterSeed.filter((o) => {
    if (o.trigger && o.trigger.startsWith('seed:')) return false;
    return wroteEmptyHeroAssetId(o) || removedHeroReel(o);
  });

  if (boundaryCandidates.length) {
    const b = boundaryCandidates[0];
    report.derived.boundaryEventId = b.id;
    if (wroteEmptyHeroAssetId(b)) {
      report.derived.boundary = 'A.heroAssetId written as \"\"';
      report.derived.verdict = 'VALID HERO STATE OVERWRITTEN';
      report.derived.boundaryReason = `Observed localStorage.setItem(${HERO_KEYS.manager}) writing heroAssetId=\"\" after valid seed.`;
    } else if (removedHeroReel(b)) {
      report.derived.boundary = 'B.Hero reel removed';
      report.derived.verdict = 'VALID HERO STATE OVERWRITTEN';
      report.derived.boundaryReason = `Observed localStorage.${b.op}(${HERO_KEYS.reel}) after valid seed.`;
    } else if (overwroteManagerWithDefaults(b)) {
      report.derived.boundary = 'D.Default configuration overwrites saved configuration';
      report.derived.verdict = 'DEFAULT CONFIGURATION REPLACES SAVED STATE';
      report.derived.boundaryReason = `Observed manager key overwritten to empty heroAssetId after valid seed.`;
    } else {
      report.derived.boundary = 'unknown';
      report.derived.verdict = 'INSUFFICIENT EVIDENCE';
      report.derived.boundaryReason = 'Boundary candidate found but did not match proof rules.';
    }
  } else {
    // No overwrite/removal observed in storage ops (within WAIT_MS).
    report.derived.boundary = 'F.No overwrite exists (within observation window)';
    report.derived.verdict = 'NO STATE OWNERSHIP DEFECT FOUND';
    report.derived.boundaryReason =
      'After a valid seed existed, no localStorage write removed the hero reel or wrote heroAssetId=\"\" (excluding the seed itself).';
  }

  report.capture.endedAt = isoNow();

  await context.close();
  await browser.close();

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.info('[RC3-HERO-OWNER-01] wrote', OUT);
  console.info('[RC3-HERO-OWNER-01] verdict', report.derived.verdict);
}

main().catch((err) => {
  console.error('[RC3-HERO-OWNER-01] failed', err);
  process.exit(1);
});

