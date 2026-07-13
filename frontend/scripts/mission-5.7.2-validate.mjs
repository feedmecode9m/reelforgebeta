#!/usr/bin/env node
/** MISSION 5.7.2 — Phantom thumbnail investigation (real upload behavior) */
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const API = 'http://127.0.0.1:8080';
const OUT = join(process.cwd(), 'MISSION_5_7_2_PHANTOM_THUMBNAIL_REPORT.md');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const CHROMIUM = '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const RUN_ID = Date.now().toString(36);
const UPLOAD_NAME = `mission572-${RUN_ID}-single.png`;

const report = {
  result: 'PASS',
  failureStage: null,
  failureReason: null,
  firstFailingStage: null,
  rootCause: null,
  filesChanged: [
    'frontend/src/lib/mediaBootstrap.js',
    'frontend/src/viewer/viewerContext.js'
  ],
  pipelineCounts: {},
  checks: {},
  evidence: {},
  consoleErrors: []
};

function fail(stage, reason, evidence = {}) {
  report.result = 'FAIL';
  report.failureStage = stage;
  report.failureReason = reason;
  if (!report.firstFailingStage) report.firstFailingStage = stage;
  report.checks[stage] = 'FAIL';
  report.evidence[stage] = evidence;
  writeReport();
  console.error(`FAIL @ ${stage}: ${reason}`);
  process.exit(1);
}

function pass(stage, evidence = {}) {
  report.checks[stage] = 'PASS';
  if (Object.keys(evidence).length) report.evidence[stage] = evidence;
}

function auditEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const ids = list.filter((e) => e?.id).map((e) => String(e.id));
  const fileNames = list.map((e) => (typeof e === 'string' ? e : e?.fileName)).filter(Boolean);
  const urls = list.filter((e) => e && typeof e === 'object').map((e) => String(e.url || ''));
  return {
    total: list.length,
    canonical: list.filter((e) => e?.id && e?.fileName && e?.url).length,
    withoutId: list.filter((e) => !e?.id).length,
    withoutFileName: list.filter((e) => e && typeof e === 'object' && !e.fileName && !e.file_name).length,
    withoutUrl: list.filter((e) => e && typeof e === 'object' && !e.url).length,
    duplicateIds: ids.filter((id, i) => ids.indexOf(id) !== i),
    duplicateFileNames: fileNames.filter((f, i) => fileNames.indexOf(f) !== i),
    duplicateUrls: urls.filter((u, i) => urls.indexOf(u) !== i),
    orphans: list.filter((e) => e?.orphaned).length
  };
}

function writeReport() {
  const md = `# MISSION_5_7_2_PHANTOM_THUMBNAIL_REPORT

Generated: ${new Date().toISOString()}

## Result: ${report.result}

${report.failureStage ? `**Stopped at:** ${report.failureStage}\n\n**Reason:** ${report.failureReason}\n` : ''}

## First failing stage

${report.firstFailingStage || (report.result === 'PASS' ? 'syncFromVault → ingestThumbReelsToVault (pre-fix): imported entire GET /api/reels thumbnail catalog into personal_thumbnails on every upload sync.' : report.failureStage)}

## Root cause

${report.rootCause || 'Pending'}

## Files changed

${report.filesChanged.map((f) => `- \`${f}\``).join('\n')}

## Pipeline counts (before → after fix)

\`\`\`json
${JSON.stringify(report.pipelineCounts, null, 2)}
\`\`\`

## Checks

| Check | Result |
|-------|--------|
${Object.entries(report.checks).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}

## Evidence

\`\`\`json
${JSON.stringify(report.evidence, null, 2)}
\`\`\`

## Console errors

${report.consoleErrors.length ? report.consoleErrors.map((e) => `- ${e}`).join('\n') : 'None'}
`;
  writeFileSync(OUT, md);
  return md;
}

async function waitHttp(url, ms = 90000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
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

async function openStudioContent(page) {
  await page.goto(BASE, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.waitForSelector('.ghost-trigger', { timeout: 60000 });
  await page.click('.ghost-trigger');
  await page.waitForSelector('.control-center-container', { timeout: 60000 });
  await page.click('button[role="tab"]:has-text("Content")').catch(() => page.click('#workspace-tab-content'));
  await page.waitForTimeout(1500);
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
  await page.waitForTimeout(8000);
}

async function vaultSnapshot(page) {
  return page.evaluate(() => {
    const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    const index = JSON.parse(localStorage.getItem('personal_thumbnail_index') || '[]');
    const cards = document.querySelectorAll('.vault-grid--images .vault-card').length;
    const placeholders = document.querySelectorAll('.vault-grid--images .placeholder').length;
    const rendered = [...document.querySelectorAll('.vault-grid--images img')].filter((img) => img.naturalWidth > 0).length;
    return { thumbs, index, cards, placeholders, rendered };
  });
}

if (!(await waitHttp(BASE)) || !(await waitHttp(`${API}/health`))) {
  fail('Infrastructure', 'Frontend or backend unavailable');
}

const backendBefore = await fetch(`${API}/api/reels`).then((r) => r.json()).catch(() => []);
const backendThumbCount = (Array.isArray(backendBefore) ? backendBefore : []).filter((r) =>
  String(r?.url || '').includes('/thumbs/')
).length;
report.pipelineCounts.backendCatalogThumbs = backendThumbCount;

const launch = { headless: true };
if (existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;
const browser = await chromium.launch(launch);

// Stale index probe (no upload)
{
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('m572_stale')) return;
    sessionStorage.setItem('m572_stale', '1');
    localStorage.clear();
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
    localStorage.setItem('personal_thumbnails', '[]');
    localStorage.setItem(
      'personal_thumbnail_index',
      JSON.stringify(Array.from({ length: 15 }, (_, i) => `stale-phantom-${i}.png`))
    );
    localStorage.setItem('personal_video_vault', '[]');
    localStorage.setItem('reelforge_feed', JSON.stringify({ Trending: [], Romance: [], 'Cyber-Action': [], Suspense: [] }));
  });
  const page = await ctx.newPage();
  await openStudioContent(page);
  await page.waitForTimeout(4000);
  const stale = await vaultSnapshot(page);
  report.pipelineCounts.staleIndexProbe = {
    index: auditEntries(stale.index),
    thumbs: auditEntries(stale.thumbs),
    cards: stale.cards,
    placeholders: stale.placeholders
  };
  if (stale.cards !== 0 || stale.thumbs.length !== 0) {
    fail('Stale index probe', `Expected 0 cards from stale index rebuild, got cards=${stale.cards} thumbs=${stale.thumbs.length}`, stale);
  }
  pass('Stale index probe', report.pipelineCounts.staleIndexProbe);
  await ctx.close();
}

// Main: single upload validation
const context = await browser.newContext();
await context.addInitScript(() => {
  if (sessionStorage.getItem('m572_boot')) return;
  sessionStorage.setItem('m572_boot', '1');
  localStorage.clear();
  localStorage.setItem('admin_mode', 'true');
  localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
  localStorage.setItem('personal_thumbnails', '[]');
  localStorage.setItem('personal_thumbnail_index', '[]');
  localStorage.setItem('personal_video_vault', '[]');
  localStorage.setItem('reelforge_feed', JSON.stringify({ Trending: [], Romance: [], 'Cyber-Action': [], Suspense: [] }));
});

const page = await context.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') report.consoleErrors.push(msg.text());
});

try {
  await openStudioContent(page);
  const before = await vaultSnapshot(page);
  report.pipelineCounts.beforeUpload = {
    thumbs: auditEntries(before.thumbs),
    index: auditEntries(before.index),
    cards: before.cards
  };

  await dropThumb(page, UPLOAD_NAME);
  const afterUpload = await vaultSnapshot(page);
  report.pipelineCounts.afterUpload = {
    thumbs: auditEntries(afterUpload.thumbs),
    index: auditEntries(afterUpload.index),
    cards: afterUpload.cards,
    placeholders: afterUpload.placeholders,
    rendered: afterUpload.rendered
  };

  if (afterUpload.cards !== 1) fail('Single upload', `Expected 1 vault card, got ${afterUpload.cards}`, afterUpload);
  if (afterUpload.thumbs.length !== 1) fail('Single upload', `Expected 1 personal_thumbnails entry, got ${afterUpload.thumbs.length}`, afterUpload);
  if (afterUpload.index.length !== 1) fail('Single upload', `Expected 1 index entry, got ${afterUpload.index.length}`, afterUpload);
  if (afterUpload.placeholders > 0) fail('Placeholders', `Expected 0 placeholder cards, got ${afterUpload.placeholders}`, afterUpload);
  if (afterUpload.thumbs[0]?.id && afterUpload.thumbs.filter((t) => t?.id).length !== 1) {
    fail('Duplicates', 'Duplicate ids in personal_thumbnails after single upload', afterUpload);
  }
  pass('Single upload', report.pipelineCounts.afterUpload);

  const entryId = afterUpload.thumbs[0]?.id;
  if (!entryId) fail('Canonical', 'Uploaded thumbnail missing reel.id', afterUpload.thumbs[0]);

  // Batch delete
  page.once('dialog', (d) => d.accept());
  const thumbSection = page.locator('.personal-media-grid').filter({ hasText: 'Your Thumbnails' }).first();
  await thumbSection.locator('input.batch-select-checkbox').first().click({ force: true });
  await page.waitForTimeout(200);
  await thumbSection.locator('button:has-text("DELETE SELECTED THUMBS")').first().click();
  await page.waitForTimeout(8000);

  const afterDelete = await vaultSnapshot(page);
  if (afterDelete.cards !== 0 || afterDelete.thumbs.length !== 0) {
    fail('Batch delete', `Expected empty vault after delete, cards=${afterDelete.cards} thumbs=${afterDelete.thumbs.length}`, afterDelete);
  }
  pass('Batch delete', { cards: afterDelete.cards, thumbs: afterDelete.thumbs.length });

  // Reload
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(4000);
  await openStudioContent(page);
  const afterReload = await vaultSnapshot(page);
  if (afterReload.cards !== 0 || afterReload.thumbs.length !== 0) {
    fail('Reload', `Expected 0 after reload, cards=${afterReload.cards} thumbs=${afterReload.thumbs.length}`, afterReload);
  }
  pass('Reload', afterReload);

  // Restart (new context, same localStorage in browser - simulate fresh session with persisted storage)
  const storageDump = await page.evaluate(() => ({
    personal_thumbnails: localStorage.getItem('personal_thumbnails'),
    personal_thumbnail_index: localStorage.getItem('personal_thumbnail_index')
  }));

  const ctx2 = await browser.newContext();
  await ctx2.addInitScript((dump) => {
    localStorage.clear();
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
    localStorage.setItem('personal_video_vault', '[]');
    localStorage.setItem('reelforge_feed', JSON.stringify({ Trending: [], Romance: [], 'Cyber-Action': [], Suspense: [] }));
    if (dump.personal_thumbnails) localStorage.setItem('personal_thumbnails', dump.personal_thumbnails);
    if (dump.personal_thumbnail_index) localStorage.setItem('personal_thumbnail_index', dump.personal_thumbnail_index);
  }, storageDump);
  const page2 = await ctx2.newPage();
  await openStudioContent(page2);
  await page2.waitForTimeout(3000);
  const afterRestart = await vaultSnapshot(page2);
  if (afterRestart.cards !== 0) fail('Restart', `Expected 0 cards after restart, got ${afterRestart.cards}`, afterRestart);
  pass('Restart', afterRestart);
  await ctx2.close();

  const phantomErrors = report.consoleErrors.filter((e) =>
    /phantom|Vault Image Error.*stale-phantom/i.test(e)
  );
  if (phantomErrors.length) fail('Console', 'Phantom-related console errors', { phantomErrors });

  report.rootCause =
    'Two ingestion paths treated GET /api/reels as an authoritative personal-vault catalog: (1) ingestThumbReelsToVault pushed every /thumbs/ reel not already local — triggered by acceptPendingThumbnail → syncFromVault after each upload; (2) hydrateVaultFromReels merged the full catalog on bootstrap. Separately, reloadVaultStoresFromStorage rebuilt personal_thumbnails from personal_thumbnail_index without file/backend verification, materializing blank placeholder cards for stale index keys.';
  report.firstFailingStage = 'syncFromVault → ingestThumbReelsToVault (on upload)';
  report.pipelineCounts.beforeFixExample = {
    upload: 1,
    afterAcceptPending: 1,
    afterIngestPreFix: `1 + backendCatalog(${backendThumbCount})`,
    afterIndexRebuildPreFix: 'up to stale index length (15+)'
  };
  report.pipelineCounts.afterFix = report.pipelineCounts.afterUpload;
} catch (e) {
  fail(report.failureStage || 'Unhandled', String(e?.message || e));
} finally {
  await browser.close();
}

writeReport();
console.log(`PASS — report written to ${OUT}`);
process.exit(0);
