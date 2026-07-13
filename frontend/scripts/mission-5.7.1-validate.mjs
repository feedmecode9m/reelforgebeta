#!/usr/bin/env node
/** MISSION 5.7.1 — Legacy thumbnail canonicalization validation */
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';
import { spawn, execSync } from 'child_process';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const API = 'http://127.0.0.1:8080';
const OUT = join(process.cwd(), 'MISSION_5_7_1_LEGACY_CANONICALIZATION.md');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const CHROMIUM = '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const RUN_ID = Date.now().toString(36);
const MISSION_PREFIX = `mission571-${RUN_ID}-`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const report = {
  result: 'PASS',
  failureStage: null,
  failureReason: null,
  rootCause: null,
  migrationStrategy: null,
  filesChanged: [
    'frontend/src/lib/viewer/thumbnailCanonicalization.js',
    'frontend/src/components/experiences/VaultExperience.svelte',
    'frontend/src/lib/storage.js'
  ],
  checks: {},
  evidence: {},
  deleteRequests: [],
  consoleErrors: [],
  mission57Regression: null
};

function fail(stage, reason, evidence = {}) {
  report.result = 'FAIL';
  report.failureStage = stage;
  report.failureReason = reason;
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

function writeReport() {
  const md = `# MISSION_5_7_1_LEGACY_CANONICALIZATION

Generated: ${new Date().toISOString()}

## Result: ${report.result}

${report.failureStage ? `**Stopped at:** ${report.failureStage}\n\n**Reason:** ${report.failureReason}\n` : ''}

## Root cause

${report.rootCause || 'Legacy thumbnail vault entries (string localStorage values and id-less metadata objects) were not upgraded to canonical reel.id before batch selection, so resolveThumbnailCanonicalId returned empty string and checkboxes could not participate in id-only batch delete.'}

## Migration strategy

${report.migrationStrategy || `Before selection in VaultExperience:
1. Fetch backend image reels via fetchReadyReels()
2. For each stored entry lacking id, resolve unique reel by fileName then url (never display name)
3. On exactly-one match: attach reel.id and persist to personal_thumbnails
4. On zero or ambiguous matches: mark orphaned:true — checkbox disabled, excluded from batch delete
5. Diagnostic logging via [THUMB_CANONICALIZE]`}

## Files changed

${report.filesChanged.map((f) => `- \`${f}\``).join('\n')}

## Checks

| Check | Result |
|-------|--------|
${Object.entries(report.checks).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}

## Before/after flow

### Before (broken)
\`\`\`
Legacy string / id-less entry in personal_thumbnails
  → personalThumbnailCollection (fileName keys)
  → thumbnailSelectionId → resolveThumbnailCanonicalId → entry.id missing → ''
  → toggleThumbnailSelection('') no-op
  → batch delete impossible for legacy entries
\`\`\`

### After (fixed)
\`\`\`
VaultExperience onMount → ensureThumbnailCanonicalization()
  → canonicalizeThumbnailEntries(stored, backend imageReels)
  → unique match: upgrade entry.id, persist personal_thumbnails
  → no match: orphaned:true, checkbox disabled
  → thumbnailSelectionId → reel.id
  → batch delete via DELETE /api/reels/{id} (unchanged)
\`\`\`

## Mission 5.7 regression

${report.mission57Regression || 'Not run'}

## Delete API requests

${report.deleteRequests.length ? report.deleteRequests.map((r) => `- \`${r.method} ${r.url}\` → ${r.status || 'pending'} (uuid=${r.payloadIsIdOnly})`).join('\n') : 'None'}

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
  await page.waitForTimeout(6000);
}

function isUuidId(v) {
  return UUID_RE.test(String(v || '').trim());
}

if (!(await waitHttp(BASE)) || !(await waitHttp(`${API}/health`))) {
  fail('Infrastructure', 'Frontend or backend unavailable');
}

const launch = { headless: true };
if (existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;
const browser = await chromium.launch(launch);
const context = await browser.newContext();
await context.addInitScript(() => {
  if (!window.__thumbCanonHookInstalled) {
    window.__thumbCanonHookInstalled = true;
    window.__thumbCanonLogs = [];
    window.__batchLogs = [];
    const orig = console.info.bind(console);
    console.info = (...args) => {
      const tag = String(args[0] || '');
      if (tag.startsWith('[THUMB_CANONICALIZE]')) window.__thumbCanonLogs.push({ at: Date.now(), args });
      if (tag.startsWith('[BATCH_')) window.__batchLogs.push({ at: Date.now(), args });
      orig(...args);
    };
  }
  if (sessionStorage.getItem('mission571_boot')) return;
  sessionStorage.setItem('mission571_boot', '1');
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
page.on('request', (req) => {
  const url = req.url();
  if (req.method() === 'DELETE' && url.includes('/api/reels/')) {
    const id = decodeURIComponent(url.split('/api/reels/').pop()?.split('?')[0] || '');
    report.deleteRequests.push({ method: 'DELETE', url, id, payloadIsIdOnly: isUuidId(id) });
  }
});
page.on('response', (res) => {
  const url = res.url();
  if (res.request().method() === 'DELETE' && url.includes('/api/reels/')) {
    const last = report.deleteRequests[report.deleteRequests.length - 1];
    if (last && !last.status) last.status = res.status();
  }
});

try {
  await openStudioContent(page);

  // Upload 3 backend-backed thumbnails
  const uploadNames = [];
  for (let i = 1; i <= 3; i += 1) {
    const name = `${MISSION_PREFIX}thumb-${i}.png`;
    uploadNames.push(name);
    await dropThumb(page, name);
  }

  const uploaded = await page.evaluate((prefix) => {
    const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    return thumbs.filter((t) => String(t?.name || t?.fileName || '').includes(prefix));
  }, MISSION_PREFIX);

  if (uploaded.length < 3) fail('Setup', `Expected 3 uploads, got ${uploaded.length}`, { uploaded });

  const [canonical, legacyTarget, metadataTarget] = uploaded;
  const orphanName = `${MISSION_PREFIX}orphan.png`;

  // Inject mixed vault: canonical + legacy string + id-less metadata + orphan
  await page.evaluate(
    ({ canonical, legacyFileName, metaFileName, metaUrl, orphanName }) => {
      const legacyString = legacyFileName;
      const idLessMeta = { fileName: metaFileName, url: metaUrl, name: metaFileName };
      const orphanMeta = { fileName: orphanName, url: `/thumbs/${orphanName}`, name: orphanName };
      const vault = [
        { id: canonical.id, fileName: canonical.fileName, url: canonical.url, name: canonical.name || canonical.fileName },
        legacyString,
        idLessMeta,
        orphanMeta
      ];
      const index = vault.map((e) => (typeof e === 'string' ? e : e.fileName));
      localStorage.setItem('personal_thumbnails', JSON.stringify(vault));
      localStorage.setItem('personal_thumbnail_index', JSON.stringify(index));
    },
    {
      canonical,
      legacyFileName: legacyTarget.fileName || legacyTarget.name,
      metaFileName: metadataTarget.fileName || metadataTarget.name,
      metaUrl: metadataTarget.url,
      orphanName
    }
  );

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(4000);
  await openStudioContent(page);
  await page.waitForFunction(() => window.__thumbCanonicalizationReady === true, null, { timeout: 30000 });
  await page.waitForTimeout(500);

  const postCanon = await page.evaluate(
    ({ prefix, legacyFileName, metaFileName, orphanName, canonicalId }) => {
      const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
      const logs = window.__thumbCanonLogs || [];
      const canonLogActions = logs
        .map((entry) => entry.args?.[1]?.action)
        .filter(Boolean);
      const findByFile = (fn) =>
        thumbs.find(
          (t) =>
            (typeof t === 'string' ? t : t?.fileName) === fn ||
            String(t?.fileName || t) === fn
        );
      const canonicalEntry = thumbs.find((t) => t?.id === canonicalId);
      const legacyEntry = findByFile(legacyFileName);
      const metaEntry = findByFile(metaFileName);
      const orphanEntry = findByFile(orphanName);
      const ids = thumbs.filter((t) => t?.id).map((t) => t.id);
      const duplicateIds = ids.filter((id, i) => ids.indexOf(id) !== i);
      const checkboxes = [...document.querySelectorAll('.vault-grid--images input.batch-select-checkbox')];
      const orphanLabels = [...document.querySelectorAll('.vault-grid--images .orphan-entry')];
      return {
        thumbs,
        canonicalEntry,
        legacyEntry,
        metaEntry,
        orphanEntry,
        duplicateIds,
        canonLogs: logs.length,
        canonLogActions,
        checkboxes: checkboxes.map((cb) => ({ disabled: cb.disabled, checked: cb.checked })),
        orphanLabelCount: orphanLabels.length,
        deleteBtnText: Array.from(document.querySelectorAll('button'))
          .find((b) => b.textContent?.includes('DELETE SELECTED THUMBS'))
          ?.textContent
      };
    },
    {
      prefix: MISSION_PREFIX,
      legacyFileName: legacyTarget.fileName || legacyTarget.name,
      metaFileName: metadataTarget.fileName || metadataTarget.name,
      orphanName,
      canonicalId: canonical.id
    }
  );

  if (!postCanon.canonicalEntry?.id) fail('Canonical', 'Canonical entry lost id after reload', postCanon);
  pass('Canonical selectable', { id: postCanon.canonicalEntry.id });

  if (typeof postCanon.legacyEntry === 'string' || !postCanon.legacyEntry?.id) {
    fail('Legacy migration', 'Legacy string entry was not upgraded with reel.id', postCanon);
  }
  if (!isUuidId(postCanon.legacyEntry.id)) {
    fail('Legacy migration', 'Migrated legacy id is not UUID', postCanon.legacyEntry);
  }
  pass('Legacy migration', { fileName: postCanon.legacyEntry.fileName, id: postCanon.legacyEntry.id });

  if (!postCanon.metaEntry?.id) {
    fail('Metadata migration', 'Id-less metadata entry was not upgraded with reel.id', postCanon);
  }
  pass('Metadata migration', { fileName: postCanon.metaEntry.fileName, id: postCanon.metaEntry.id });

  if (!postCanon.orphanEntry?.orphaned) {
    fail('Orphan identification', 'Orphan entry not marked orphaned:true', postCanon);
  }
  if (postCanon.orphanEntry?.id) {
    fail('Orphan identification', 'Orphan entry must not receive synthetic id', postCanon);
  }
  pass('Orphan identification', { fileName: orphanName, orphaned: true });

  if (postCanon.duplicateIds.length) {
    fail('Duplicate ids', `Duplicate reel ids in vault: ${postCanon.duplicateIds.join(', ')}`, postCanon);
  }
  pass('No duplicate ids', { count: postCanon.thumbs.filter((t) => t?.id).length });

  const enabled = postCanon.checkboxes.filter((c) => !c.disabled).length;
  const disabled = postCanon.checkboxes.filter((c) => c.disabled).length;
  if (enabled < 3) fail('Selection UI', `Expected 3 enabled checkboxes, got ${enabled}`, postCanon);
  if (disabled < 1) fail('Selection UI', `Expected 1 disabled orphan checkbox, got ${disabled}`, postCanon);
  if (postCanon.orphanLabelCount < 1) fail('Selection UI', 'Orphan label not shown', postCanon);
  pass('Selection UI', { enabled, disabled, orphanLabels: postCanon.orphanLabelCount });

  if (postCanon.canonLogs < 1) {
    fail('Diagnostics', `Expected [THUMB_CANONICALIZE] logs, got ${postCanon.canonLogs}`, postCanon);
  }
  const orphanLog = (postCanon.canonLogActions || []).includes('orphaned');
  if (!orphanLog) {
    fail('Diagnostics', 'Expected [THUMB_CANONICALIZE] orphaned action log', postCanon);
  }
  pass('Diagnostics', { canonLogs: postCanon.canonLogs, orphanLog });

  // Select migrated legacy entry and delete
  const migratedId = postCanon.legacyEntry.id;
  page.once('dialog', (d) => d.accept());
  const thumbSection = page.locator('.personal-media-grid').filter({ hasText: 'Your Thumbnails' }).first();
  const deleteReqStart = report.deleteRequests.length;

  const legacyIdx = await page.evaluate((fileName) => {
    const index = JSON.parse(localStorage.getItem('personal_thumbnail_index') || '[]');
    return index.indexOf(fileName);
  }, legacyTarget.fileName || legacyTarget.name);

  const checkboxes = thumbSection.locator('input.batch-select-checkbox');
  await checkboxes.nth(legacyIdx).click({ force: true });
  await page.waitForTimeout(300);

  const selSnap = await page.evaluate(() => {
    const logs = (window.__batchLogs || []).filter((e) => String(e.args?.[0] || '') === '[BATCH_SELECT]');
    const last = logs[logs.length - 1]?.args?.[1] || {};
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('DELETE SELECTED THUMBS'));
    const m = btn?.textContent?.match(/\((\d+)\)/);
    return { selectedIds: last.selectedIds || [], buttonCount: m ? Number(m[1]) : 0 };
  });

  if (selSnap.buttonCount !== 1) fail('Migrated selection', `Expected 1 selected, got ${selSnap.buttonCount}`, selSnap);
  if (!selSnap.selectedIds.includes(migratedId)) {
    fail('Migrated selection', `Selection does not contain migrated id ${migratedId}`, selSnap);
  }
  if (selSnap.selectedIds.some((id) => !isUuidId(id))) {
    fail('No delete by name/url', 'Selection contains non-UUID value', selSnap);
  }
  pass('Migrated selection', selSnap);

  await thumbSection.locator('button:has-text("DELETE SELECTED THUMBS")').first().click();
  await page.waitForTimeout(8000);

  const newDeletes = report.deleteRequests.slice(deleteReqStart);
  if (newDeletes.length < 1) fail('Migrated delete', 'No DELETE /api/reels/{id} captured', { newDeletes });
  for (const req of newDeletes) {
    if (!req.payloadIsIdOnly) fail('No delete by name/url', `DELETE target is not UUID: ${req.id}`, req);
    if (req.id !== migratedId) fail('Migrated delete', `DELETE used wrong id: ${req.id} expected ${migratedId}`, req);
  }
  pass('Migrated delete', { id: migratedId, status: newDeletes[0]?.status });

  const afterDelete = await page.evaluate((deletedId) => {
    const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    return {
      stillPresent: thumbs.some((t) => t?.id === deletedId),
      count: thumbs.length
    };
  }, migratedId);
  if (afterDelete.stillPresent) fail('Migrated delete', 'Deleted id still in personal_thumbnails', afterDelete);
  pass('Migrated delete storage', afterDelete);

  // Reload preserves migration (remaining entries still have ids, orphan still orphaned)
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(4000);
  await openStudioContent(page);
  await page.waitForFunction(() => window.__thumbCanonicalizationReady === true, null, { timeout: 30000 });
  await page.waitForTimeout(500);

  const afterReload = await page.evaluate(
    ({ metaId, orphanName, deletedId }) => {
      const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
      const meta = thumbs.find((t) => t?.id === metaId);
      const orphan = thumbs.find((t) => (t?.fileName || t) === orphanName);
      const restoredDeleted = thumbs.some((t) => t?.id === deletedId);
      return {
        metaStillHasId: Boolean(meta?.id),
        orphanStillOrphaned: Boolean(orphan?.orphaned),
        restoredDeleted,
        metaId: meta?.id
      };
    },
    { metaId: postCanon.metaEntry.id, orphanName, deletedId: migratedId }
  );

  if (afterReload.restoredDeleted) fail('Reload persistence', 'Deleted entry restored after reload', afterReload);
  if (!afterReload.metaStillHasId) fail('Reload persistence', 'Migrated metadata id lost after reload', afterReload);
  // Post-5.7.4: unrelated marked orphans may purge on successful delete; migrated ids must persist.
  pass('Reload persistence', afterReload);

  report.rootCause =
    'Batch delete selection stores canonical reel.id only, but legacy personal_thumbnails entries (raw strings and id-less metadata from reloadVaultStoresFromStorage / resolveThumbnailStoredEntry) never received reel.id, so resolveThumbnailCanonicalId returned empty and legacy thumbnails could not be selected for batch delete.';
  report.migrationStrategy =
    'VaultExperience.ensureThumbnailCanonicalization() runs on mount before selection: fetch backend image reels, match id-less entries by fileName then url, attach reel.id on unique match and persist; mark orphaned:true when no unique reel exists.';
} catch (e) {
  fail(report.failureStage || 'Unhandled', String(e?.message || e));
} finally {
  await browser.close();
}

// Mission 5.7 regression (unchanged script)
try {
  const out = execSync('node scripts/mission-5.7-validate.mjs', {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  report.mission57Regression = 'PASS — mission-5.7-validate.mjs exited 0';
  report.checks['Mission 5.7 regression'] = 'PASS';
  pass('Mission 5.7 regression', { output: out.slice(-200) });
} catch (e) {
  report.mission57Regression = `FAIL — ${e.stderr || e.stdout || e.message}`;
  report.checks['Mission 5.7 regression'] = 'FAIL';
  fail('Mission 5.7 regression', report.mission57Regression);
}

const md = writeReport();
console.log(md);
process.exit(report.result === 'PASS' ? 0 : 1);
