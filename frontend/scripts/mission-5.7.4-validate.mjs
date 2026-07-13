#!/usr/bin/env node
/** MISSION 5.7.4 — Orphan thumbnail lifecycle validation */
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';
import { execSync } from 'child_process';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const OUT = join(process.cwd(), 'MISSION_5_7_4_ORPHAN_LIFECYCLE.md');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const CHROMIUM = '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const RUN_ID = Date.now().toString(36);

const report = {
  result: 'PASS',
  failureStage: null,
  failureReason: null,
  filesChanged: [
    'frontend/src/lib/viewer/thumbnailCanonicalization.js',
    'frontend/src/components/experiences/VaultExperience.svelte',
    'frontend/src/viewer/viewerContext.js',
    'frontend/src/lib/storage.js',
    'frontend/src/lib/viewer/vaultUtils.js'
  ],
  checks: {},
  evidence: {},
  mission57Regression: null
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
  const md = `# MISSION_5_7_4_ORPHAN_LIFECYCLE

Generated: ${new Date().toISOString()}

## Result: ${report.result}

${report.failureStage ? `**Stopped at:** ${report.failureStage}\n\n**Reason:** ${report.failureReason}\n` : ''}

## Root cause (pre-fix)

\`applyThumbnailDeleteTombstone\` retained all id-less entries via \`!id || !deletedSet.has(id)\`. Orphan rows (\`orphaned: true\`) survived every successful backend delete; vault count never dropped for phantom cards.

## Patch

After successful backend delete, \`purgeStaleOrphanThumbnails()\` classifies entries (recoverable / stale / active_upload) and removes **stale** orphans only from \`personal_thumbnails\`, \`personal_thumbnail_index\`, and viewer collection.

## Files changed

${report.filesChanged.map((f) => `- \`${f}\``).join('\n')}

## Checks

| Check | Result |
|-------|--------|
${Object.entries(report.checks).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}

## Mission 5.7 regression

${report.mission57Regression || 'Not run'}

## Evidence

\`\`\`json
${JSON.stringify(report.evidence, null, 2)}
\`\`\`
`;
  writeFileSync(OUT, md);
}

async function waitHttp(url) {
  for (let i = 0; i < 90; i++) {
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
  await page.click('.ghost-trigger');
  await page.waitForSelector('.control-center-container', { timeout: 60000 });
  await page.click('button[role="tab"]:has-text("Content")').catch(() => {});
  await page.waitForTimeout(2000);
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
  await page.waitForTimeout(7000);
}

async function vaultSnap(page) {
  return page.evaluate(() => {
    const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    const index = JSON.parse(localStorage.getItem('personal_thumbnail_index') || '[]');
    return {
      heading: [...document.querySelectorAll('h4')].find((h) => h.textContent?.includes('Your Thumbnails'))?.textContent,
      thumbs: thumbs.length,
      index: index.length,
      cards: document.querySelectorAll('.vault-grid--images .vault-card').length,
      placeholders: document.querySelectorAll('.vault-grid--images .placeholder').length,
      withId: thumbs.filter((t) => t?.id).length,
      stale: thumbs.filter((t) => t?.orphaned).length,
      activeBlob: thumbs.filter((t) => {
        const url = String(t?.url || '');
        return url.startsWith('blob:') || url.startsWith('data:');
      }).length,
      orphanLogs: (window.__liveTrace || []).filter((e) => e.tag === '[ORPHAN_PURGE]')
    };
  });
}

if (!(await waitHttp(BASE))) fail('Infrastructure', 'Frontend unavailable');

const launch = { headless: true };
if (existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;
const browser = await chromium.launch(launch);
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  if (!sessionStorage.getItem('m574_boot')) {
    sessionStorage.setItem('m574_boot', '1');
    localStorage.clear();
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
    localStorage.setItem('personal_thumbnails', '[]');
    localStorage.setItem('personal_thumbnail_index', '[]');
  }
  window.__liveTrace = window.__liveTrace || [];
  if (!window.__m574TraceHooked) {
    window.__m574TraceHooked = true;
    const orig = console.info.bind(console);
    console.info = (...args) => {
      if (String(args[0] || '') === '[ORPHAN_PURGE]') {
        window.__liveTrace.push({ tag: '[ORPHAN_PURGE]', payload: args[1] });
      }
      orig(...args);
    };
  }
});

const page = await ctx.newPage();
try {
  await openStudio(page);

  await dropThumb(page, `m574-canonical-a-${RUN_ID}.png`);
  await dropThumb(page, `m574-canonical-b-${RUN_ID}.png`);

  const canonical = await page.evaluate(() => JSON.parse(localStorage.getItem('personal_thumbnails') || '[]'));
  if (canonical.filter((t) => t?.id).length < 2) fail('Setup', 'Expected 2 canonical uploads', { canonical });

  const b64 = PNG.toString('base64');
  await page.evaluate(
    ({ b64 }) => {
      const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
      const index = JSON.parse(localStorage.getItem('personal_thumbnail_index') || '[]');
      for (let i = 0; i < 5; i++) {
        const fn = `stale-orphan-${i}.png`;
        thumbs.push({ fileName: fn, url: `/thumbs/${fn}`, name: fn });
        index.push(fn);
      }
      thumbs.push({
        fileName: 'active-upload-blob.png',
        url: `data:image/png;base64,${b64}`,
        name: 'active-upload-blob.png'
      });
      index.push('active-upload-blob.png');
      localStorage.setItem('personal_thumbnails', JSON.stringify(thumbs));
      localStorage.setItem('personal_thumbnail_index', JSON.stringify(index));
    },
    { b64 }
  );

  await page.reload({ waitUntil: 'load' });
  await openStudio(page);
  await page.waitForFunction(() => window.__thumbCanonicalizationReady === true, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const pre = await vaultSnap(page);
  if (pre.thumbs !== 8) fail('Setup', `Expected 8 vault entries, got ${pre.thumbs}`, pre);
  if (pre.stale < 5) fail('Setup', `Expected 5 stale orphans after canonicalization, got ${pre.stale}`, pre);
  pass('Setup', pre);

  const thumbSection = page.locator('.personal-media-grid').filter({ hasText: 'Your Thumbnails' }).first();
  const enabled = thumbSection.locator('input.batch-select-checkbox:not(:disabled)');
  if ((await enabled.count()) < 1) fail('Selection', 'No selectable canonical thumbnails');

  page.once('dialog', (d) => d.accept());
  await enabled.first().click({ force: true });
  await page.waitForTimeout(200);
  await thumbSection.locator('button:has-text("DELETE SELECTED THUMBS")').click();
  await page.waitForTimeout(12000);

  const post = await vaultSnap(page);
  report.evidence.afterDelete = post;

  if (post.withId !== 1) fail('Canonical survive', `Expected 1 canonical remaining, got ${post.withId}`, post);
  if (post.stale !== 0) fail('Stale orphans removed', `Expected 0 stale orphans, got ${post.stale}`, post);
  if (post.activeBlob !== 1) fail('Active upload preserved', `Expected 1 blob entry, got ${post.activeBlob}`, post);
  if (post.thumbs !== 2) fail('Count updates', `Expected 2 entries (1 canonical + 1 active), got ${post.thumbs}`, post);
  if (post.placeholders > 0) fail('Zero phantoms', `Expected 0 placeholder cards, got ${post.placeholders}`, post);
  if (!post.orphanLogs?.length) fail('Orphan purge log', 'Expected [ORPHAN_PURGE] log', post);

  pass('Canonical survive', { withId: post.withId });
  pass('Stale orphans removed', { stale: post.stale });
  pass('Active upload preserved', { activeBlob: post.activeBlob });
  pass('Count updates', { thumbs: post.thumbs, cards: post.cards });
  pass('Zero phantoms', { placeholders: post.placeholders });

  await page.reload({ waitUntil: 'load' });
  await openStudio(page);
  await page.waitForTimeout(3000);
  const reload = await vaultSnap(page);
  if (reload.thumbs !== 2 || reload.stale !== 0) fail('Reload', 'Stale orphans restored or count wrong after reload', reload);
  pass('Reload', reload);
} catch (e) {
  fail(report.failureStage || 'Unhandled', String(e?.message || e));
} finally {
  await browser.close();
}

try {
  execSync('node scripts/mission-5.7-validate.mjs', { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  report.mission57Regression = 'PASS';
  report.checks['Mission 5.7 regression'] = 'PASS';
} catch (e) {
  report.mission57Regression = `FAIL: ${e.stderr || e.message}`;
  fail('Mission 5.7 regression', report.mission57Regression);
}

writeReport();
console.log(`PASS — ${OUT}`);
process.exit(0);
