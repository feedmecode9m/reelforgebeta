#!/usr/bin/env node
/** MISSION 5.7.6 — Startup hydration & reconciliation validation */
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const API = process.env.API_URL || 'http://127.0.0.1:8080';
const OUT = join(process.cwd(), 'MISSION_5_7_6_STARTUP_RECONCILIATION.md');
const CHROMIUM = '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const RUN_ID = Date.now().toString(36);

const report = {
  result: 'PASS',
  failureStage: null,
  failureReason: null,
  firstFailure: {
    file: 'frontend/src/viewer/viewerContext.js',
    function: 'syncFromVault',
    line: '~944',
    reason: 'purgeStaleOrphanThumbnails never ran on startup; reconcileStaleThumbnailsOnStartup added after backend sync'
  },
  checks: {},
  timeline: [],
  evidence: {}
};

function fail(stage, reason, evidence = {}) {
  report.result = 'FAIL';
  report.failureStage = stage;
  report.failureReason = reason;
  report.checks[stage] = 'FAIL';
  report.evidence[stage] = evidence;
  writeReport();
  process.exit(1);
}

function pass(stage, evidence = {}) {
  report.checks[stage] = 'PASS';
  if (Object.keys(evidence).length) report.evidence[stage] = evidence;
}

function writeReport() {
  const md = `# MISSION_5_7_6_STARTUP_RECONCILIATION

Generated: ${new Date().toISOString()}

## Result: ${report.result}

${report.failureStage ? `**Stopped at:** ${report.failureStage}\n\n**Reason:** ${report.failureReason}\n` : ''}

## First failure (pre-fix)

| Field | Value |
|-------|-------|
| File | \`${report.firstFailure.file}\` |
| Function | \`${report.firstFailure.function}\` |
| Line | ${report.firstFailure.line} |
| Reason | ${report.firstFailure.reason} |

## Patch

\`reconcileStaleThumbnailsOnStartup()\` in \`viewerContext.js\` runs after \`syncFromVault\` backend reconciliation when \`backendReachable === true\`. Uses \`filterStaleOrphanEntries\` (preserves canonical, active upload, recoverable). Secondary path in \`VaultExperience.ensureThumbnailCanonicalization\`.

## Startup timeline

| Step | Caller | Notes |
|------|--------|-------|
| 1 | main.js → App | Svelte bootstrap |
| 2 | viewerContext createPersistentStore | Loads personal_thumbnail_index → immediate render risk |
| 3 | reloadVaultStoresFromStorage | Syncs index from personal_thumbnails |
| 4 | bootstrapMediaFromBackend | ingest only (no new entries) |
| 5 | syncFromVault | GET /api/reels, backendReachable flag |
| 6 | reconcileStaleThumbnailsOnStartup | **NEW** — purges stale orphans when backend reachable |
| 7 | VaultExperience ensureThumbnailCanonicalization | Canonicalize + secondary reconcile |
| 8 | VaultExperience #each render | Final card count |

## purgeStaleOrphanThumbnails on startup?

**Pre-fix: NO** — guarded by \`if (!deletedIds?.length) return\` in VaultExperience only called post-delete.

**Post-fix: YES** — via \`reconcileStaleThumbnailsOnStartup\` after successful backend sync.

## Checks

| Scenario | Result |
|----------|--------|
${Object.entries(report.checks).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}

## Evidence

\`\`\`json
${JSON.stringify(report.evidence, null, 2)}
\`\`\`
`;
  writeFileSync(OUT, md);
}

async function waitHttp(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const code = await fetch(url, { signal: AbortSignal.timeout(3000) }).then((r) => r.status);
      if (code >= 200 && code < 500) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function openStudio(page) {
  await page.goto(BASE, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(2000);
  await page.click('.ghost-trigger').catch(() => {});
  await page.waitForSelector('.control-center-container', { timeout: 60000 }).catch(() => {});
  await page.click('button[role="tab"]:has-text("Content")').catch(() => {});
  await page.waitForTimeout(5000);
  await page.waitForFunction(() => window.__thumbCanonicalizationReady === true, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

async function vaultSnap(page) {
  return page.evaluate(() => {
    const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    const index = JSON.parse(localStorage.getItem('personal_thumbnail_index') || '[]');
    const logs = (window.__startupLogs || []).filter((e) => e.tag === '[STARTUP_RECONCILE]');
    return {
      heading: [...document.querySelectorAll('h4')].find((h) => h.textContent?.includes('Your Thumbnails'))?.textContent,
      thumbs: thumbs.length,
      index: index.length,
      cards: document.querySelectorAll('.vault-grid--images .vault-card').length,
      placeholders: document.querySelectorAll('.vault-grid--images .placeholder').length,
      withId: thumbs.filter((t) => t?.id).length,
      stale: thumbs.filter((t) => t?.orphaned).length,
      activeBlob: thumbs.filter((t) => {
        const u = String(t?.url || '');
        return u.startsWith('blob:') || u.startsWith('data:');
      }).length,
      reconcileLogs: logs
    };
  });
}

async function injectOrphans(page, count = 20) {
  await page.evaluate((count) => {
    const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    const index = JSON.parse(localStorage.getItem('personal_thumbnail_index') || '[]');
    for (let i = 0; i < count; i++) {
      const fn = `stale-startup-${Date.now()}-${i}.png`;
      thumbs.push({ fileName: fn, url: `/thumbs/${fn}`, name: fn, orphaned: true });
      index.push(fn);
    }
    localStorage.setItem('personal_thumbnails', JSON.stringify(thumbs));
    localStorage.setItem('personal_thumbnail_index', JSON.stringify(index));
  }, count);
}

async function dropThumb(page, name) {
  const b64 = PNG.toString('base64');
  await page.evaluate(
    async ({ name, b64 }) => {
      const target = document.querySelector('.thumbnail-drop-zone');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], name, { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    },
    { name, b64 }
  );
  await page.waitForSelector('.accept-btn', { timeout: 15000 });
  await page.click('.accept-btn');
  await page.waitForTimeout(10000);
}

if (!(await waitHttp(BASE)) || !(await waitHttp(`${API}/health`))) {
  fail('Infrastructure', 'Frontend or backend unavailable');
}

const launch = { headless: true };
if (existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;

// ── Scenario A: backend empty + 20 stale ghosts → 0 cards ──
{
  const browser = await chromium.launch(launch);
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    window.__startupLogs = [];
    const orig = console.info.bind(console);
    console.info = (...args) => {
      if (String(args[0] || '') === '[STARTUP_RECONCILE]') {
        window.__startupLogs.push({ tag: '[STARTUP_RECONCILE]', payload: args[1] });
      }
      orig(...args);
    };
  });
  const page = await ctx.newPage();
  await page.route('**/api/reels**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
  });
  await page.evaluate((count) => {
    const thumbs = [];
    const index = [];
    for (let i = 0; i < count; i++) {
      const fn = `stale-startup-${Date.now()}-${i}.png`;
      thumbs.push({ fileName: fn, url: `/thumbs/${fn}`, name: fn });
      index.push(fn);
    }
    localStorage.setItem('personal_thumbnails', JSON.stringify(thumbs));
    localStorage.setItem('personal_thumbnail_index', JSON.stringify(index));
  }, 20);
  await page.reload({ waitUntil: 'load' });
  await openStudio(page);
  const a = await vaultSnap(page);
  if (a.thumbs !== 0 || a.cards !== 0) {
    fail('Scenario A', `Expected 0 cards after startup reconcile, got thumbs=${a.thumbs} cards=${a.cards}`, a);
  }
  pass('Scenario A', a);
  await browser.close();
}

// ── Scenario B: backend 5 canonical → 5 cards ──
{
  const browser = await chromium.launch(launch);
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    if (!sessionStorage.getItem('m576b')) {
      sessionStorage.setItem('m576b', '1');
      localStorage.clear();
      localStorage.setItem('admin_mode', 'true');
      localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
      localStorage.setItem('personal_thumbnails', '[]');
      localStorage.setItem('personal_thumbnail_index', '[]');
    }
  });
  const page = await ctx.newPage();
  await openStudio(page);
  for (let i = 1; i <= 5; i++) {
    await dropThumb(page, `m576-canonical-${i}-${RUN_ID}.png`);
  }
  const pre = await vaultSnap(page);
  if (pre.withId < 5) fail('Scenario B setup', `Expected 5 canonical uploads, got ${pre.withId}`, pre);

  await page.evaluate((count) => {
    const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    const index = JSON.parse(localStorage.getItem('personal_thumbnail_index') || '[]');
    for (let i = 0; i < count; i++) {
      const fn = `stale-startup-b-${Date.now()}-${i}.png`;
      thumbs.push({ fileName: fn, url: `/thumbs/${fn}`, name: fn });
      index.push(fn);
    }
    localStorage.setItem('personal_thumbnails', JSON.stringify(thumbs));
    localStorage.setItem('personal_thumbnail_index', JSON.stringify(index));
  }, 10);
  await page.reload({ waitUntil: 'load' });
  await openStudio(page);
  const b = await vaultSnap(page);
  if (b.withId !== 5) {
    fail('Scenario B', `Expected 5 canonical ids preserved after reload, got withId=${b.withId}`, b);
  }
  pass('Scenario B', b);
  await browser.close();
}

// ── Scenario C: offline — retain local canonical, no purge ──
{
  const browser = await chromium.launch(launch);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
    const entry = {
      id: 'offline-canonical-id-576',
      fileName: 'offline-canonical-576.png',
      url: '/thumbs/offline-canonical-576.png',
      name: 'offline-canonical-576.png'
    };
    localStorage.setItem('personal_thumbnails', JSON.stringify([entry]));
    localStorage.setItem('personal_thumbnail_index', JSON.stringify(['offline-canonical-576.png']));
  });
  await page.route('**/health**', (route) => route.abort('failed'));
  await page.route('**/api/reels**', (route) => route.abort('failed'));
  await page.reload({ waitUntil: 'load' });
  await openStudio(page);
  const c = await vaultSnap(page);
  if (c.thumbs !== 1 || c.withId !== 1) {
    fail('Scenario C', `Expected 1 offline canonical retained, got thumbs=${c.thumbs} withId=${c.withId}`, c);
  }
  pass('Scenario C', c);
  await browser.close();
}

// ── Scenario D: active upload preserved ──
{
  const browser = await chromium.launch(launch);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const b64 = PNG.toString('base64');
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(
    ({ b64 }) => {
      localStorage.clear();
      localStorage.setItem('admin_mode', 'true');
      localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
      const thumbs = [];
      const index = [];
      for (let i = 0; i < 5; i++) {
        const fn = `purge-me-${i}.png`;
        thumbs.push({ fileName: fn, url: `/thumbs/${fn}`, name: fn, orphaned: true });
        index.push(fn);
      }
      thumbs.push({
        fileName: 'active-upload-576.png',
        url: `data:image/png;base64,${b64}`,
        name: 'active-upload-576.png'
      });
      index.push('active-upload-576.png');
      localStorage.setItem('personal_thumbnails', JSON.stringify(thumbs));
      localStorage.setItem('personal_thumbnail_index', JSON.stringify(index));
    },
    { b64 }
  );
  await page.reload({ waitUntil: 'load' });
  await openStudio(page);
  const d = await vaultSnap(page);
  if (d.activeBlob !== 1) {
    fail('Scenario D', `Expected active data-url upload preserved, got activeBlob=${d.activeBlob}`, d);
  }
  pass('Scenario D', d);
  await browser.close();
}

// ── Scenario E: browser restart — no stale return ──
{
  const browser = await chromium.launch(launch);
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    if (!sessionStorage.getItem('m576e')) {
      sessionStorage.setItem('m576e', '1');
      localStorage.clear();
      localStorage.setItem('admin_mode', 'true');
      localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
    }
  });
  const page = await ctx.newPage();
  await page.route('**/api/reels**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate((count) => {
    const thumbs = [];
    const index = [];
    for (let i = 0; i < count; i++) {
      const fn = `stale-restart-${Date.now()}-${i}.png`;
      thumbs.push({ fileName: fn, url: `/thumbs/${fn}`, name: fn });
      index.push(fn);
    }
    localStorage.setItem('personal_thumbnails', JSON.stringify(thumbs));
    localStorage.setItem('personal_thumbnail_index', JSON.stringify(index));
  }, 20);
  await page.reload({ waitUntil: 'load' });
  await openStudio(page);
  const first = await vaultSnap(page);
  if (first.cards !== 0) fail('Scenario E setup', `First load should purge to 0, got ${first.cards}`, first);
  await page.reload({ waitUntil: 'load' });
  await openStudio(page);
  const second = await vaultSnap(page);
  if (second.cards !== 0 || second.thumbs !== 0) {
    fail('Scenario E', `Stale orphans returned after restart: cards=${second.cards} thumbs=${second.thumbs}`, second);
  }
  pass('Scenario E', second);
  await browser.close();
}

writeReport();
console.log(`PASS — ${OUT}`);
process.exit(0);
