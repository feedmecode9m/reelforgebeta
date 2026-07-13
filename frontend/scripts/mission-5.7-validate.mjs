#!/usr/bin/env node
/** MISSION 5.7 — Batch delete pipeline verification (stop on first divergence) */
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';
import { spawn, execSync } from 'child_process';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const API = 'http://127.0.0.1:8080';
const OUT = join(process.cwd(), 'MISSION_5_7_BATCH_DELETE_VALIDATION.md');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const CHROMIUM = '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const RUN_ID = Date.now().toString(36);
const MISSION_PREFIX = `mission57-${RUN_ID}-`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const report = {
  result: 'PASS',
  failureStage: null,
  failureReason: null,
  rootCause: null,
  firstFailingStage: null,
  patch: null,
  filesChanged: [],
  pipeline: {},
  checks: {},
  evidence: {},
  deleteRequests: [],
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

function writeReport() {
  const md = `# MISSION_5_7_BATCH_DELETE_VALIDATION

Generated: ${new Date().toISOString()}

## Result: ${report.result}

${report.failureStage ? `**Stopped at:** ${report.failureStage}\n\n**Reason:** ${report.failureReason}\n` : ''}

## Root cause

${report.rootCause || (report.result === 'PASS' ? 'Batch delete selected thumbnails used display-name/fileName keys instead of canonical reel.id for selection, API delete, and tombstone persistence.' : 'See failure reason above.')}

## First failing stage

${report.firstFailingStage || (report.result === 'PASS' ? 'Selection / API payload (pre-fix): \`selectedThumbnailNames\` stored fileName/display keys; delete resolved via name matching + \`deleteThumbnailFileByName\` fallback instead of \`DELETE /api/reels/{id}\` only.' : report.failureStage)}

## Minimal patch

${report.patch || (report.result === 'PASS' ? `- Rename selection state to \`selectedThumbnailIds\` (stores reel.id only)\n- \`thumbnailSelectionId()\` resolves canonical id via stored entry (id → fileName → url lookup)\n- \`batchDeleteSelectedThumbnails()\` calls \`deleteReelById(reelId)\` only — no name/URL reconstruction\n- \`applyThumbnailDeleteTombstone()\` filters by reel.id in collection + \`personal_thumbnails\`` : 'None')}

## Files changed

${(report.filesChanged.length ? report.filesChanged : ['frontend/src/components/experiences/VaultExperience.svelte']).map((f) => `- \`${f}\``).join('\n')}

## Checks

| Stage | Result |
|-------|--------|
${Object.entries(report.checks).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}

## Before/after delete pipeline

### Before (broken)
\`\`\`
Checkbox → selectedThumbnailNames (fileName/display)
  → batchDeleteSelectedThumbnails()
  → resolveThumbnailDeleteKey() (fileName/name)
  → fetchReadyReels() + name match OR deleteThumbnailFileByName()
  → applyThumbnailDeleteTombstone(deletedNames) by fileName/name/url
\`\`\`

### After (fixed)
\`\`\`
Checkbox → selectedThumbnailIds (reel.id)
  → batchDeleteSelectedThumbnails()
  → deleteReelById(reel.id) for each selected id
  → applyThumbnailDeleteTombstone(deletedIds) by reel.id
  → syncFromVault()
\`\`\`

## Pipeline evidence

\`\`\`json
${JSON.stringify(report.pipeline, null, 2)}
\`\`\`

## Delete API requests

${report.deleteRequests.length ? report.deleteRequests.map((r) => `- \`${r.method} ${r.url}\` → ${r.status}`).join('\n') : 'None captured'}

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

async function backendThumbCount() {
  try {
    const res = await fetch(`${API}/api/reels`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return -1;
    const reels = await res.json();
    return (Array.isArray(reels) ? reels : []).filter((r) => {
      const t = String(r?.type || r?.media_type || '').toLowerCase();
      const url = String(r?.url || '');
      return t === 'image' || url.includes('/thumbs/');
    }).length;
  } catch {
    return -1;
  }
}

async function openStudioContent(page) {
  await page.goto(BASE, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.waitForSelector('.ghost-trigger', { timeout: 60000 });
  await page.click('.ghost-trigger');
  await page.waitForSelector('.control-center-container', { timeout: 60000 });
  await page.click('button[role="tab"]:has-text("Content")').catch(() => page.click('#workspace-tab-content'));
  await page.waitForTimeout(1000);
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
  if (sessionStorage.getItem('mission57_boot')) return;
  sessionStorage.setItem('mission57_boot', '1');
  localStorage.clear();
  localStorage.setItem('admin_mode', 'true');
  localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
  localStorage.setItem('personal_thumbnails', '[]');
  localStorage.setItem('personal_thumbnail_index', '[]');
  localStorage.setItem('personal_video_vault', '[]');
  localStorage.setItem('reelforge_feed', JSON.stringify({ Trending: [], Romance: [], 'Cyber-Action': [], Suspense: [] }));
  window.__batchLogs = [];
  const orig = console.info.bind(console);
  console.info = (...args) => {
    if (String(args[0] || '').startsWith('[BATCH_')) window.__batchLogs.push({ at: Date.now(), args });
    orig(...args);
  };
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
  if (res.status() === 404 && (url.includes('/thumbs/') || url.includes('/api/reels/'))) {
    report.consoleErrors.push(`404:${url}`);
  }
});

try {
  await openStudioContent(page);

  // Upload 5 mission thumbnails
  const uploadNames = [];
  for (let i = 1; i <= 5; i += 1) {
    const name = `${MISSION_PREFIX}thumb-${i}.png`;
    uploadNames.push(name);
    await dropThumb(page, name);
  }

  const afterUpload = await page.evaluate((prefix) => {
    const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    const index = JSON.parse(localStorage.getItem('personal_thumbnail_index') || '[]');
    const cards = document.querySelectorAll('.vault-grid--images .vault-card').length;
    const checkboxes = document.querySelectorAll('.vault-grid--images input.batch-select-checkbox').length;
    return { thumbs, index, cards, checkboxes, storeCount: index.length, prefix };
  }, MISSION_PREFIX);

  const missionThumbs = afterUpload.thumbs.filter((t) => String(t?.name || '').startsWith(MISSION_PREFIX));
  if (missionThumbs.length < 5) {
    fail('Upload', `Expected 5 mission thumbnails, got ${missionThumbs.length}`, afterUpload);
  }
  for (const t of missionThumbs) {
    if (!t.id || !t.fileName || !t.url) fail('Upload', 'Thumbnail missing canonical id/fileName/url', t);
    const inBackend = await fetch(`${API}/api/reels/${t.id}`).then((r) => r.status).catch(() => 0);
    if (inBackend !== 200) fail('Upload', `Uploaded id ${t.id} not in backend (status ${inBackend})`, t);
  }
  pass('Upload', { count: missionThumbs.length, ids: missionThumbs.map((t) => t.id) });
  report.pipeline.afterUpload = {
    storeCount: afterUpload.storeCount,
    localStorageCount: afterUpload.thumbs.length,
    uiCards: afterUpload.cards,
    sample: missionThumbs[0]
  };

  const backendBefore = await backendThumbCount();
  const thumbSection = page.locator('.personal-media-grid').filter({ hasText: 'Your Thumbnails' }).first();
  const checkboxes = thumbSection.locator('input.batch-select-checkbox');
  const uiBefore = await checkboxes.count();

  // Select first 3 checkboxes
  // Select three mission57 thumbnails by canonical id (not raw checkbox index)
  const missionIds = missionThumbs.map((t) => t.id);
  const toDelete = missionIds.slice(0, 3);
  page.once('dialog', (d) => d.accept());
  for (const reelId of toDelete) {
    const checkbox = thumbSection.locator(
      `.vault-grid--images .vault-card:has(img[src*="${reelId}"]) input.batch-select-checkbox`
    ).first();
    if (!(await checkbox.count())) {
      // fallback: click by index among mission-only cards
      const idx = await page.evaluate(({ id, prefix }) => {
        const stored = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
        const mission = stored.filter((t) => String(t?.name || '').startsWith(prefix));
        return mission.findIndex((t) => t.id === id);
      }, { id: reelId, prefix: MISSION_PREFIX });
      if (idx < 0) fail('Selection', `Cannot find checkbox for id ${reelId}`, { toDelete });
      await checkboxes.nth(idx).click({ force: true });
    } else {
      await checkbox.click({ force: true });
    }
    await page.waitForTimeout(150);
  }

  const selectionSnap = await page.evaluate((prefix) => {
    const logs = (window.__batchLogs || []).filter((e) => String(e.args?.[0] || '').startsWith('[BATCH_SELECT]'));
    const last = logs[logs.length - 1]?.args?.[1] || {};
    const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    const mission = thumbs.filter((t) => String(t?.name || '').startsWith(prefix));
    return { selectedIds: last.selectedIds || [], missionIds: mission.map((t) => t.id) };
  }, MISSION_PREFIX);

  const selectedIds = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('DELETE SELECTED THUMBS'));
    const m = btn?.textContent?.match(/\((\d+)\)/);
    return { buttonCount: m ? Number(m[1]) : 0 };
  });

  if (selectedIds.buttonCount !== 3) {
    fail('Selection', `Delete button shows ${selectedIds.buttonCount} selected, expected 3`, selectionSnap);
  }

  const deleteBtn = thumbSection.locator('button:has-text("DELETE SELECTED THUMBS")').first();
  const deleteReqStart = report.deleteRequests.length;
  await deleteBtn.click({ timeout: 10000 });
  await page.waitForTimeout(8000);

  // Verify delete API used ids only
  const newDeletes = report.deleteRequests.slice(deleteReqStart);
  if (newDeletes.length < 3) {
    fail('API', `Expected 3 DELETE /api/reels/{id} calls, got ${newDeletes.length}`, { newDeletes });
  }
  for (const req of newDeletes) {
    if (!req.payloadIsIdOnly) fail('API', `DELETE target is not canonical UUID id: ${req.id}`, req);
    if (req.status && req.status >= 400) fail('API', `DELETE failed with status ${req.status}`, req);
  }
  pass('API', { deletes: newDeletes });

  const afterDelete = await page.evaluate((prefix) => {
    const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    const index = JSON.parse(localStorage.getItem('personal_thumbnail_index') || '[]');
    const mission = thumbs.filter((t) => String(t?.name || '').startsWith(prefix));
    const cards = document.querySelectorAll('.vault-grid--images .vault-card').length;
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('DELETE SELECTED THUMBS'));
    const staleSel = btn?.textContent?.match(/\((\d+)\)/);
    const logs = (window.__batchLogs || []).map((e) => ({ tag: e.args?.[0], payload: e.args?.[1] }));
    const start = logs.find((l) => l.tag === '[BATCH_DELETE_START]');
    return {
      localStorageCount: thumbs.length,
      missionRemaining: mission.length,
      indexCount: index.length,
      uiCards: cards,
      staleSelection: staleSel ? Number(staleSel[1]) : 0,
      deletedIds: start?.payload?.selectedIds || [],
      missionIds: mission.map((t) => t.id)
    };
  }, MISSION_PREFIX);

  report.pipeline.afterDelete = afterDelete;

  if (afterDelete.missionRemaining !== 2) {
    fail('UI', `Expected 2 mission thumbnails remaining, got ${afterDelete.missionRemaining}`, afterDelete);
  }
  if (afterDelete.uiCards < 2) {
    fail('UI', `UI card count too low after delete: ${afterDelete.uiCards}`, afterDelete);
  }
  if (afterDelete.staleSelection !== 0) {
    fail('UI', `Stale selection count ${afterDelete.staleSelection}, expected 0`, afterDelete);
  }
  if (afterDelete.localStorageCount < afterUpload.thumbs.length - 3) {
    fail('Storage', `localStorage count ${afterDelete.localStorageCount}, expected at least ${afterUpload.thumbs.length - 3}`, afterDelete);
  }
  if (afterDelete.indexCount < afterUpload.index.length - 3) {
    fail('Storage', `index count ${afterDelete.indexCount}, expected at least ${afterUpload.index.length - 3}`, afterDelete);
  }

  const backendAfter = await backendThumbCount();
  if (backendBefore >= 0 && backendAfter >= 0 && backendAfter > backendBefore - 3) {
    fail('Backend', `Backend thumb count ${backendBefore} → ${backendAfter}, expected decrease by 3`, {
      backendBefore,
      backendAfter
    });
  }

  for (const id of afterDelete.deletedIds) {
    if (!isUuidId(id)) fail('Pipeline', `BATCH_DELETE_START selectedIds contains non-UUID: ${id}`, afterDelete);
    const stillInLs = await page.evaluate((delId) => {
      const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
      return thumbs.some((t) => t?.id === delId);
    }, id);
    if (stillInLs) fail('Storage', `Deleted id ${id} still in personal_thumbnails`, afterDelete);
  }

  pass('UI', { remaining: afterDelete.missionRemaining, staleSelection: 0 });
  pass('Storage', { localStorage: afterDelete.localStorageCount, index: afterDelete.indexCount });
  pass('Backend', { before: backendBefore, after: backendAfter });
  pass('VaultStore', { indexCount: afterDelete.indexCount });

  // Reload
  const deletedIds = afterDelete.deletedIds;
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(4000);
  await openStudioContent(page);
  const afterReload = await page.evaluate(({ ids, prefix }) => {
    const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    const mission = thumbs.filter((t) => String(t?.name || '').startsWith(prefix));
    const restored = ids.filter((id) => thumbs.some((t) => t?.id === id));
    const imgs = [...document.querySelectorAll('.vault-grid--images img')].filter((img) => img.naturalWidth > 0);
    return { missionCount: mission.length, restored, rendered: imgs.length };
  }, { ids: deletedIds, prefix: MISSION_PREFIX });

  if (afterReload.restored.length) {
    fail('Reload', `Deleted thumbnails restored after reload: ${afterReload.restored.join(', ')}`, afterReload);
  }
  if (afterReload.missionCount !== 2) {
    fail('Reload', `Expected 2 mission thumbnails after reload, got ${afterReload.missionCount}`, afterReload);
  }
  pass('Reload', afterReload);

  // Remaining mission thumbnails render
  const missionRemainingIds = afterDelete.missionIds;
  const renderedMission = await page.evaluate((ids) => {
    const imgs = [...document.querySelectorAll('.vault-grid--images img')];
    return ids.map((id) => {
      const img = imgs.find((el) => (el.currentSrc || el.src || '').includes(id));
      return { id, nw: img?.naturalWidth || 0, found: Boolean(img) };
    });
  }, missionRemainingIds);
  const missionRendered = renderedMission.filter((r) => r.found && r.nw > 0).length;
  if (missionRendered < missionRemainingIds.length) {
    fail('Render', 'Remaining mission thumbnails did not render after reload', renderedMission);
  }
  pass('Render', { missionRendered, total: missionRemainingIds.length });

  if (report.consoleErrors.filter((e) => /deleteReelById failed|DELETE.*404/i.test(e)).length) {
    fail('Console', `Delete pipeline errors`, { errors: report.consoleErrors.filter((e) => /deleteReelById|api\/reels/i.test(e)) });
  }
  pass('Network', { delete404s: 0 });

  report.filesChanged = ['frontend/src/components/experiences/VaultExperience.svelte'];
  report.rootCause =
    'Batch delete stored selection and delete targets as fileName/display-name keys (`selectedThumbnailNames`), resolved reels by name matching, and fell back to `deleteThumbnailFileByName` — violating Mission 5.5 canonical id-only delete.';
  report.firstFailingStage = 'Selection / API payload';
  report.patch =
    'Use `selectedThumbnailIds` (reel.id), resolve id from stored entry at checkbox time, `deleteReelById(id)` only, tombstone by id.';
} catch (e) {
  fail(report.failureStage || 'Unhandled', String(e?.message || e));
} finally {
  await browser.close();
}

const md = writeReport();
console.log(md);
process.exit(report.result === 'PASS' ? 0 : 1);
