#!/usr/bin/env node
/** MISSION 5.8 — Thumbnail vault state machine & permanent repair validation */
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';
import { spawnSync } from 'child_process';
import {
  timerEnabled,
  beginPhase,
  timed,
  sleep,
  waitHttpProfiled,
  fetchProfiled,
  count,
  writeProfileReport
} from './lib/missionTimer.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const API = process.env.API_URL || 'http://127.0.0.1:8080';
const OUT = join(process.cwd(), 'MISSION_5_8_VALIDATION.md');
const CHROMIUM = '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const RUN_ID = Date.now().toString(36);
const PROFILE = timerEnabled();
/** Application invariant — must match STORAGE_LIMITS.MAX_THUMBNAILS in src/lib/storage.js */
const MAX_THUMBNAILS = 20;
const WINDOW_SIZE = MAX_THUMBNAILS;

const PRIOR_MISSIONS = [
  'mission-5.5-validate.mjs',
  'mission-5.6-validate.mjs',
  'mission-5.6.5-validate.mjs',
  'mission-5.7-validate.mjs',
  'mission-5.7.1-validate.mjs',
  'mission-5.7.2-validate.mjs',
  'mission-5.7.3-validate.mjs',
  'mission-5.7.4-validate.mjs',
  'mission-5.7.5-render-audit.mjs',
  'mission-5.7.6-validate.mjs',
  'mission-5.7.7-live-delete-audit.mjs'
];

const report = {
  result: 'PASS',
  failureStage: null,
  failureReason: null,
  checks: {},
  priorMissions: {},
  invariantViolations: [],
  evidence: {}
};

function fail(stage, reason, evidence = {}) {
  report.result = 'FAIL';
  report.failureStage = stage;
  report.failureReason = reason;
  report.checks[stage] = 'FAIL';
  report.evidence[stage] = evidence;
  writeReport();
  if (PROFILE) writeProfileReport({ stoppedAt: stage, reason });
  console.error(`FAIL @ ${stage}: ${reason}`);
  process.exit(1);
}

function pass(stage, evidence = {}) {
  report.checks[stage] = 'PASS';
  if (Object.keys(evidence).length) report.evidence[stage] = evidence;
}

function writeReport() {
  const md = `# MISSION_5_8_VALIDATION

Generated: ${new Date().toISOString()}

## Result: ${report.result}

${report.failureStage ? `**Stopped at:** ${report.failureStage}\n\n**Reason:** ${report.failureReason}\n` : ''}

## Permanent repair

Single owner: \`thumbnailVault.js\`. Source of truth: \`personal_thumbnails\`. Collection derived via \`syncCollectionStore\`.

## Prior mission regression

| Mission | Result |
|---------|--------|
${Object.entries(report.priorMissions).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}

## 5.8 checks

| Check | Result |
|-------|--------|
${Object.entries(report.checks).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}

## Invariant violations

${report.invariantViolations.length ? report.invariantViolations.map((v) => `- ${v}`).join('\n') : 'None'}

## Evidence

\`\`\`json
${JSON.stringify(report.evidence, null, 2)}
\`\`\`
`;
  writeFileSync(OUT, md);
}

async function waitHttp(url) {
  return waitHttpProfiled(url, {
    maxAttempts: 60,
    delayMs: 1000,
    phase: `waitHttp:${url}`,
    label: url
  });
}

async function openStudio(page) {
  const endAll = PROFILE ? beginPhase('openStudio', { reason: 'browser_navigation_and_waits' }) : () => {};
  await timed('openStudio:goto', () => page.goto(BASE, { waitUntil: 'load', timeout: 120000 }), { reason: 'browser_goto' });
  if (PROFILE) count('browserGoto');
  await sleep(2000, 'openStudio post-goto settle', 'openStudio');
  await timed('openStudio:ghost-click', () => page.click('.ghost-trigger').catch(() => {}), { reason: 'browser_click' });
  await timed(
    'openStudio:control-center',
    () => page.waitForSelector('.control-center-container', { timeout: 60000 }).catch(() => {}),
    { reason: 'browser_wait_selector', timeout: 60000 }
  );
  await timed('openStudio:content-tab', () => page.click('button[role="tab"]:has-text("Content")').catch(() => {}), { reason: 'browser_click' });
  await sleep(5000, 'openStudio content tab settle', 'openStudio');
  await timed(
    'openStudio:canonicalization-ready',
    () => page.waitForFunction(() => window.__thumbCanonicalizationReady === true, null, { timeout: 45000 }).catch(() => {}),
    { reason: 'browser_wait_function', timeout: 45000 }
  );
  await sleep(2000, 'openStudio post-canonicalization settle', 'openStudio');
  endAll();
}

async function vaultSnap(page) {
  const m = await vaultMetrics(page);
  return {
    thumbs: m.localStorageCount,
    index: m.indexCount,
    cards: m.renderCount,
    withId: m.withId,
    ghostCanonical: m.canonicalCount,
    indexMatches: m.indexCount === m.localStorageCount
  };
}

async function vaultMetrics(page) {
  return page.evaluate(() => {
    const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    const index = JSON.parse(localStorage.getItem('personal_thumbnail_index') || '[]');
    const cards = document.querySelectorAll('.vault-grid--images .vault-card');
    const ids = thumbs.map((t) => String(t?.id || '').trim()).filter(Boolean);
    const uniqueIds = new Set(ids);
    const duplicateIds = ids.length - uniqueIds.size;
    const orphanCount = thumbs.filter((t) => t?.orphaned === true || (t && !t.id && t.vaultState !== 'CANONICAL')).length;
    const canonicalCount = thumbs.filter((t) => t?.vaultState === 'CANONICAL' && t?.id).length;
    const placeholderCards = document.querySelectorAll(
      '.vault-grid--images .vault-card.placeholder, .vault-grid--images .vault-card.is-placeholder'
    ).length;
    const renderCount = cards.length;
    const localStorageCount = thumbs.length;
    const indexCount = index.length;
    const storageAligned = localStorageCount === indexCount && localStorageCount === renderCount;
    const phantomCards = Math.max(0, renderCount - localStorageCount) + placeholderCards;
    return {
      localStorageCount,
      indexCount,
      renderCount,
      withId: ids.length,
      uniqueIdCount: uniqueIds.size,
      duplicateIds,
      orphanCount,
      canonicalCount,
      phantomCards,
      storageAligned,
      storageDivergence: !storageAligned
    };
  });
}

async function fetchBackendThumbCount() {
  const reels = await fetchProfiled(`${API}/api/reels`, {}, 'throughput:backend-reels')
    .then((r) => r.json())
    .catch(() => []);
  return (Array.isArray(reels) ? reels : []).filter((r) => String(r?.url || '').includes('/thumbs/')).length;
}

function validateThroughputWindow(stage, metrics, backendCount, opts = {}) {
  const failures = [];
  const {
    maxCapacity = MAX_THUMBNAILS,
    expectEmpty = false,
    checkBackend = true,
    backendTolerance = 2
  } = opts;

  if (metrics.storageDivergence) {
    failures.push(
      `storage divergence localStorage=${metrics.localStorageCount} index=${metrics.indexCount} render=${metrics.renderCount}`
    );
  }
  if (metrics.duplicateIds > 0) {
    failures.push(`duplicate ids: ${metrics.duplicateIds}`);
  }
  if (metrics.phantomCards > 0) {
    failures.push(`phantom cards: ${metrics.phantomCards}`);
  }
  if (metrics.localStorageCount > maxCapacity) {
    failures.push(`capacity exceeded: ${metrics.localStorageCount} > ${maxCapacity}`);
  }
  if (expectEmpty) {
    if (metrics.localStorageCount !== 0) failures.push(`expected empty vault, got ${metrics.localStorageCount}`);
    if (metrics.renderCount !== 0) failures.push(`expected 0 render cards, got ${metrics.renderCount}`);
    if (metrics.orphanCount > 0) failures.push(`orphan accumulation after delete: ${metrics.orphanCount}`);
  } else if (metrics.withId > 0 && metrics.withId !== metrics.uniqueIdCount) {
    failures.push(`canonical identity broken: withId=${metrics.withId} unique=${metrics.uniqueIdCount}`);
  }
  if (checkBackend && !expectEmpty && metrics.withId > 0) {
    const delta = Math.abs(backendCount - metrics.withId);
    if (delta > backendTolerance) {
      failures.push(`backend divergence: backend=${backendCount} vaultIds=${metrics.withId}`);
    }
  }
  if (checkBackend && expectEmpty && backendCount > backendTolerance) {
    failures.push(`backend not drained: backend=${backendCount}`);
  }
  if (failures.length) {
    fail(stage, failures.join('; '), { metrics, backendCount });
  }
}

async function batchDeleteAllThumbnails(page, phase = 'throughput') {
  page.once('dialog', (d) => d.accept());
  await timed(`${phase}:batch-delete-click`, () => page.evaluate(() => {
    const grids = [...document.querySelectorAll('.personal-media-grid')];
    const thumbSection = grids.find((g) => g.textContent?.includes('Your Thumbnails'));
    const scope = thumbSection?.closest('section') || thumbSection?.parentElement || document;
    const btn = [...scope.querySelectorAll('button')].find((b) => /BATCH DELETE ALL/i.test(b.textContent || ''));
    btn?.click();
  }), { reason: 'browser_evaluate_delete' });
  if (PROFILE) count('deletes');
  await sleep(15000, `${phase} batch delete settle`, phase);
}

async function runRollingUploadThroughput(page, { totalUploads, runId, stagePrefix }) {
  const stats = {
    totalProcessed: 0,
    totalUploads: 0,
    totalDeletes: 0,
    failures: 0,
    windows: []
  };
  let uploadSeq = 0;

  while (stats.totalUploads < totalUploads) {
    const windowIndex = stats.windows.length;
    const batchSize = Math.min(WINDOW_SIZE, totalUploads - stats.totalUploads);

    let pre = await vaultMetrics(page);
    if (pre.localStorageCount + batchSize > MAX_THUMBNAILS) {
      const deleted = pre.localStorageCount;
      await batchDeleteAllThumbnails(page, `${stagePrefix}:w${windowIndex}:make-room`);
      stats.totalDeletes += deleted;
      const postRoll = await vaultMetrics(page);
      const backendRoll = await fetchBackendThumbCount();
      validateThroughputWindow(`${stagePrefix} window ${windowIndex} make-room`, postRoll, backendRoll, {
        expectEmpty: true,
        checkBackend: true,
        backendTolerance: 3
      });
      stats.windows.push({ window: windowIndex, phase: 'make-room', deleted: deleted, metrics: postRoll, backend: backendRoll });
    }

    for (let i = 0; i < batchSize; i++) {
      await dropThumb(page, `m58-stress-${runId}-u${uploadSeq++}.png`);
      stats.totalProcessed += 1;
    }
    stats.totalUploads += batchSize;

    const postUpload = await vaultMetrics(page);
    const backend = await fetchBackendThumbCount();
    validateThroughputWindow(`${stagePrefix} window ${windowIndex} post-upload`, postUpload, backend, {
      checkBackend: true,
      backendTolerance: 3
    });
    stats.windows.push({
      window: windowIndex,
      phase: 'upload',
      uploaded: batchSize,
      metrics: postUpload,
      backend,
      duplicateIds: postUpload.duplicateIds,
      orphanCount: postUpload.orphanCount,
      renderCount: postUpload.renderCount,
      localStorageCount: postUpload.localStorageCount
    });

    if (stats.totalUploads < totalUploads) {
      const preDelete = await vaultMetrics(page);
      const deleted = preDelete.localStorageCount;
      if (deleted > 0) {
        await batchDeleteAllThumbnails(page, `${stagePrefix}:w${windowIndex}:roll-delete`);
        stats.totalDeletes += deleted;
        const postDelete = await vaultMetrics(page);
        const backendAfter = await fetchBackendThumbCount();
        validateThroughputWindow(`${stagePrefix} window ${windowIndex} post-roll-delete`, postDelete, backendAfter, {
          expectEmpty: true,
          checkBackend: true,
          backendTolerance: 3
        });
        stats.windows.push({
          window: windowIndex,
          phase: 'roll-delete',
          deleted,
          metrics: postDelete,
          backend: backendAfter
        });
      }
    }
  }

  return stats;
}

async function runRollingDeleteThroughput(page, { totalDeletes, runId, stagePrefix }) {
  const stats = {
    totalProcessed: 0,
    totalUploads: 0,
    totalDeletes: 0,
    failures: 0,
    windows: []
  };
  let uploadSeq = 0;

  while (stats.totalDeletes < totalDeletes) {
    const windowIndex = stats.windows.length;
    const batchSize = Math.min(WINDOW_SIZE, totalDeletes - stats.totalDeletes);

    const pre = await vaultMetrics(page);
    if (pre.localStorageCount > 0) {
      fail(`${stagePrefix} window ${windowIndex} setup`, `Expected empty vault before cycle, got ${pre.localStorageCount}`, pre);
    }

    for (let i = 0; i < batchSize; i++) {
      await dropThumb(page, `m58-del-${runId}-u${uploadSeq++}.png`);
      stats.totalUploads += 1;
      stats.totalProcessed += 1;
    }

    const postUpload = await vaultMetrics(page);
    const backendUpload = await fetchBackendThumbCount();
    validateThroughputWindow(`${stagePrefix} window ${windowIndex} pre-delete`, postUpload, backendUpload, {
      checkBackend: true,
      backendTolerance: 3
    });

    const toDelete = postUpload.localStorageCount;
    await batchDeleteAllThumbnails(page, `${stagePrefix}:w${windowIndex}:delete`);
    stats.totalDeletes += toDelete;
    stats.totalProcessed += toDelete;

    const postDelete = await vaultMetrics(page);
    const backend = await fetchBackendThumbCount();
    validateThroughputWindow(`${stagePrefix} window ${windowIndex} post-delete`, postDelete, backend, {
      expectEmpty: true,
      checkBackend: true,
      backendTolerance: 3
    });
    stats.windows.push({
      window: windowIndex,
      phase: 'delete-cycle',
      uploaded: batchSize,
      deleted: toDelete,
      metrics: postDelete,
      backend,
      duplicateIds: postDelete.duplicateIds,
      orphanCount: postDelete.orphanCount,
      renderCount: postDelete.renderCount,
      localStorageCount: postDelete.localStorageCount
    });
  }

  return stats;
}

async function injectGhostCanonicals(page, count = 20) {
  await page.evaluate((count) => {
    const thumbs = [];
    for (let i = 0; i < count; i++) {
      const fn = `ghost-58-${i}.png`;
      thumbs.push({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        fileName: fn,
        url: `/thumbs/${fn}`,
        name: fn,
        vaultState: 'CANONICAL'
      });
    }
    localStorage.setItem('personal_thumbnails', JSON.stringify(thumbs));
    localStorage.setItem('personal_thumbnail_index', JSON.stringify(thumbs.map((t) => t.fileName)));
  }, count);
}

async function dropThumb(page, name) {
  const phase = `upload:${name}`;
  const end = PROFILE ? beginPhase(phase, { reason: 'thumbnail_upload' }) : () => {};
  if (PROFILE) count('uploads');
  const b64 = PNG.toString('base64');
  await timed(`${phase}:drop`, () => page.evaluate(
    async ({ name, b64 }) => {
      const target = document.querySelector('.thumbnail-drop-zone');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], name, { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    },
    { name, b64 }
  ), { reason: 'browser_evaluate_drop' });
  await timed(
    `${phase}:accept-btn`,
    () => page.waitForSelector('.accept-btn', { timeout: 15000 }),
    { reason: 'browser_wait_selector', timeout: 15000 }
  );
  await timed(`${phase}:accept-click`, () => page.click('.accept-btn'), { reason: 'browser_click' });
  await sleep(5000, 'dropThumb post-accept ingest wait', phase);
  end();
}

function runPriorMissions() {
  const endAll = PROFILE ? beginPhase('prior-missions:all', { reason: 'spawnSync_regression_suite' }) : () => {};
  for (const script of PRIOR_MISSIONS) {
    const path = join(process.cwd(), 'scripts', script);
    if (!existsSync(path)) {
      report.priorMissions[script] = 'SKIP (missing)';
      continue;
    }
    console.log(`\n── Running ${script} ──`);
    const phase = `prior:${script}`;
    const end = PROFILE ? beginPhase(phase, { reason: 'spawnSync_child_mission' }) : () => {};
    if (PROFILE) count('priorMissionSpawns');
    const r = spawnSync('node', [path], {
      cwd: process.cwd(),
      env: { ...process.env, BASE_URL: BASE, API_URL: API },
      encoding: 'utf8',
      timeout: 600000
    });
    end({ exitCode: r.status });
    const ok = r.status === 0;
    report.priorMissions[script] = ok ? 'PASS' : `FAIL (exit ${r.status})`;
    if (!ok) {
      if (process.env.MISSION_PROFILE_CONTINUE === '1') {
        console.warn(`[MISSION_TIMER] continuing after ${script} failure (MISSION_PROFILE_CONTINUE=1)`);
        continue;
      }
      endAll();
      fail(`Prior mission: ${script}`, r.stderr?.slice(-500) || r.stdout?.slice(-500) || `exit ${r.status}`);
    }
  }
  endAll();
}

if (!(await timed('infrastructure:wait', async () => {
  const front = await waitHttp(BASE);
  const back = await waitHttp(`${API}/health`);
  return front && back;
}, { reason: 'frontend_and_backend_health' }))) {
  if (PROFILE) writeProfileReport({ stoppedAt: 'Infrastructure' });
  fail('Infrastructure', 'Frontend or backend unavailable');
}

const launch = { headless: true };
if (existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;

const endTotal = PROFILE ? beginPhase('mission-5.8:total', { reason: 'full_validation_run' }) : () => {};

// ── Prior missions regression (run before stress tests pollute backend) ──
runPriorMissions();

// ── 5.8-A: Ghost canonical purge (backend empty, 20 ghosts) ──
await timed('5.8-A:ghost-purge', async () => {
{
  const endLaunch = PROFILE ? beginPhase('5.8-A:browser-launch', { reason: 'chromium_launch' }) : () => {};
  const browser = await chromium.launch(launch);
  if (PROFILE) count('browserLaunches');
  endLaunch();
  const ctx = await browser.newContext();
  const violations = [];
  const page = await ctx.newPage();
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('[THUMBNAIL_INVARIANT_VIOLATION]')) violations.push(t);
  });
  await page.route('**/api/reels**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });
  await timed('5.8-A:goto', () => page.goto(BASE, { waitUntil: 'load' }), { reason: 'browser_goto' });
  if (PROFILE) count('browserGoto');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
  });
  await injectGhostCanonicals(page, 20);
  await timed('5.8-A:reload', () => page.reload({ waitUntil: 'load' }), { reason: 'browser_reload' });
  if (PROFILE) count('browserReloads');
  await openStudio(page);
  const a = await vaultSnap(page);
  if (a.thumbs !== 0 || a.cards !== 0) {
    fail('5.8-A ghost purge', `Expected 0 after ghost purge, got thumbs=${a.thumbs} cards=${a.cards}`, a);
  }
  pass('5.8-A ghost purge', a);
  report.invariantViolations.push(...violations);
  await browser.close();
}
});

// ── 5.8-B: Index mirror equals metadata keys ──
await timed('5.8-B:index-sync', async () => {
{
  const browser = await chromium.launch(launch);
  if (PROFILE) count('browserLaunches');
  const page = await browser.newPage();
  await timed('5.8-B:goto', () => page.goto(BASE, { waitUntil: 'load' }), { reason: 'browser_goto' });
  if (PROFILE) count('browserGoto');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
  });
  await openStudio(page);
  await dropThumb(page, `m58-sync-${RUN_ID}.png`);
  const b = await vaultSnap(page);
  const reels = await fetchProfiled(`${API}/api/reels`, {}, '5.8-B:backend-reels').then((r) => r.json()).catch(() => []);
  const backendThumbs = (Array.isArray(reels) ? reels : []).filter((r) => String(r?.url || '').includes('/thumbs/')).length;
  if (b.thumbs !== b.index || b.thumbs !== b.cards) {
    fail('5.8-B index sync', `thumbs=${b.thumbs} index=${b.index} cards=${b.cards}`, b);
  }
  if (b.withId < 1 && backendThumbs > 0) {
    fail('5.8-B canonical id', `Expected canonical id after upload`, b);
  }
  pass('5.8-B index sync', { ...b, backendThumbs });
  await browser.close();
}
});

// ── 5.8-C: Hard refresh preserves consistency ──
await timed('5.8-C:hard-refresh', async () => {
{
  const browser = await chromium.launch(launch);
  if (PROFILE) count('browserLaunches');
  const page = await browser.newPage();
  await timed('5.8-C:goto', () => page.goto(BASE, { waitUntil: 'load' }), { reason: 'browser_goto' });
  if (PROFILE) count('browserGoto');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
  });
  await openStudio(page);
  await dropThumb(page, `m58-refresh-${RUN_ID}.png`);
  const pre = await vaultSnap(page);
  await timed('5.8-C:reload', () => page.reload({ waitUntil: 'load' }), { reason: 'browser_reload' });
  if (PROFILE) count('browserReloads');
  await openStudio(page);
  const post = await vaultSnap(page);
  if (post.thumbs !== pre.thumbs || post.cards !== pre.cards) {
    fail('5.8-C hard refresh', `pre=${JSON.stringify(pre)} post=${JSON.stringify(post)}`);
  }
  pass('5.8-C hard refresh', { pre, post });
  await browser.close();
}
});

// ── 5.8-D: Throughput stress — rolling upload windows (capacity ≤ MAX_THUMBNAILS) ──
await timed('5.8-D:stress-uploads', async () => {
{
  const browser = await chromium.launch(launch);
  if (PROFILE) count('browserLaunches');
  const page = await browser.newPage();
  await timed('5.8-D:goto', () => page.goto(BASE, { waitUntil: 'load' }), { reason: 'browser_goto' });
  if (PROFILE) count('browserGoto');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
  });
  await openStudio(page);
  const stressCount = Number(process.env.MISSION_5_8_STRESS || process.env.MISSION_58_STRESS || 10);
  const dStats = await runRollingUploadThroughput(page, {
    totalUploads: stressCount,
    runId: RUN_ID,
    stagePrefix: '5.8-D'
  });
  const summary = {
    stressTarget: stressCount,
    windowSize: WINDOW_SIZE,
    maxCapacity: MAX_THUMBNAILS,
    totalUploads: dStats.totalUploads,
    totalDeletes: dStats.totalDeletes,
    totalProcessed: dStats.totalProcessed,
    windowCycles: Math.ceil(stressCount / WINDOW_SIZE),
    failures: dStats.failures,
    lastWindow: dStats.windows[dStats.windows.length - 1] || null
  };
  if (dStats.totalUploads !== stressCount) {
    fail('5.8-D stress uploads', `Expected ${stressCount} uploads, got ${dStats.totalUploads}`, summary);
  }
  pass('5.8-D stress uploads', summary);
  await browser.close();
}
});

// ── 5.8-E: Offline — local canonical retained, no ghost purge ──
await timed('5.8-E:offline', async () => {
{
  const browser = await chromium.launch(launch);
  if (PROFILE) count('browserLaunches');
  const page = await browser.newPage();
  await timed('5.8-E:goto', () => page.goto(BASE, { waitUntil: 'load' }), { reason: 'browser_goto' });
  if (PROFILE) count('browserGoto');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
    const entry = {
      id: 'offline-canonical-id-58',
      fileName: 'offline-canonical-58.png',
      url: '/thumbs/offline-canonical-58.png',
      name: 'offline-canonical-58.png',
      vaultState: 'CANONICAL'
    };
    localStorage.setItem('personal_thumbnails', JSON.stringify([entry]));
    localStorage.setItem('personal_thumbnail_index', JSON.stringify(['offline-canonical-58.png']));
  });
  await page.route('**/health**', (route) => route.abort('failed'));
  await page.route('**/api/reels**', (route) => route.abort('failed'));
  await timed('5.8-E:reload', () => page.reload({ waitUntil: 'load' }), { reason: 'browser_reload' });
  if (PROFILE) count('browserReloads');
  await openStudio(page);
  const e = await vaultSnap(page);
  if (e.thumbs !== 1 || e.withId !== 1) {
    fail('5.8-E offline', `Expected 1 offline canonical, got ${JSON.stringify(e)}`, e);
  }
  pass('5.8-E offline', e);
  await browser.close();
}
});

// ── 5.8-F: Throughput stress — rolling delete windows (upload N → delete N per cycle) ──
await timed('5.8-F:delete-stress', async () => {
{
  const browser = await chromium.launch(launch);
  if (PROFILE) count('browserLaunches');
  const page = await browser.newPage();
  await timed('5.8-F:goto', () => page.goto(BASE, { waitUntil: 'load' }), { reason: 'browser_goto' });
  if (PROFILE) count('browserGoto');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
  });
  await openStudio(page);
  const deleteStress = Number(process.env.MISSION_5_8_DELETE_STRESS || process.env.MISSION_58_DELETE_STRESS || 10);
  const fStats = await runRollingDeleteThroughput(page, {
    totalDeletes: deleteStress,
    runId: RUN_ID,
    stagePrefix: '5.8-F'
  });
  const summary = {
    deleteTarget: deleteStress,
    windowSize: WINDOW_SIZE,
    maxCapacity: MAX_THUMBNAILS,
    totalDeletes: fStats.totalDeletes,
    totalUploads: fStats.totalUploads,
    totalProcessed: fStats.totalProcessed,
    windowCycles: Math.ceil(deleteStress / WINDOW_SIZE),
    failures: fStats.failures,
    lastWindow: fStats.windows[fStats.windows.length - 1] || null
  };
  if (fStats.totalDeletes !== deleteStress) {
    fail('5.8-F delete stress', `Expected ${deleteStress} deletes, got ${fStats.totalDeletes}`, summary);
  }
  const post = await vaultMetrics(page);
  const backend = await fetchBackendThumbCount();
  if (post.localStorageCount !== 0 || post.renderCount !== 0) {
    fail('5.8-F delete stress', `Expected empty vault after throughput, got ${JSON.stringify(post)}`, { post, backend, summary });
  }
  pass('5.8-F delete stress', { ...summary, finalMetrics: post, backendCount: backend });
  await browser.close();
}
});

endTotal();
writeReport();
if (PROFILE) writeProfileReport({ result: report.result });
console.log('\n✅ MISSION 5.8 PASS — see MISSION_5_8_VALIDATION.md');
process.exit(0);
