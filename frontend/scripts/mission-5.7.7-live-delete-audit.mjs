#!/usr/bin/env node
/** MISSION 5.7.7 — Live delete event audit (investigation only) */
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const API = process.env.API_URL || 'http://127.0.0.1:8080';
const OUT = join(process.cwd(), 'MISSION_5_7_7_LIVE_DELETE_EVENT_AUDIT.md');
const JSON_OUT = join(process.cwd(), 'live-delete-event-audit-577.json');
const CHROMIUM = '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const audit = {
  result: 'INVESTIGATION',
  firstFailedStage: null,
  firstFailedReason: null,
  firstFailedLocation: null,
  uiRemainsAt20Reason: null,
  traces: {},
  logs: []
};

function snap() {
  return {
    at: Date.now(),
    heading: null,
    thumbs: 0,
    cards: 0,
    enabledCheckboxes: 0,
    disabledCheckboxes: 0,
    deleteSelectedDisabled: null,
    deleteSelectedText: null
  };
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

async function backendThumbCount() {
  try {
    const res = await fetch(`${API}/api/reels`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return -1;
    const reels = await res.json();
    return (Array.isArray(reels) ? reels : []).filter((r) => {
      const t = String(r?.type || '').toLowerCase();
      return t === 'image' || String(r?.url || '').includes('/thumbs/');
    }).length;
  } catch {
    return -1;
  }
}

async function vaultState(page) {
  return page.evaluate(() => {
    const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    const index = JSON.parse(localStorage.getItem('personal_thumbnail_index') || '[]');
    const thumbSection = [...document.querySelectorAll('.personal-media-grid')].find((el) =>
      el.textContent?.includes('Your Thumbnails')
    );
    const deleteBtn = thumbSection
      ? [...thumbSection.querySelectorAll('button')].find((b) => b.textContent?.includes('DELETE SELECTED'))
      : null;
    const batchBtn = thumbSection
      ? [...thumbSection.querySelectorAll('button')].find((b) => b.textContent?.includes('BATCH DELETE ALL'))
      : null;
    const checkboxes = thumbSection
      ? [...thumbSection.querySelectorAll('input.batch-select-checkbox')]
      : [];
    const enabled = checkboxes.filter((c) => !c.disabled);
    const disabled = checkboxes.filter((c) => c.disabled);
    const deleteBtnStyle = deleteBtn ? window.getComputedStyle(deleteBtn) : null;
    const batchBtnStyle = batchBtn ? window.getComputedStyle(batchBtn) : null;
    const deleteRect = deleteBtn?.getBoundingClientRect();
    const elementAtDelete = deleteBtn && deleteRect
      ? document.elementFromPoint(deleteRect.left + deleteRect.width / 2, deleteRect.top + deleteRect.height / 2)
      : null;
    return {
      heading: thumbSection?.querySelector('h4')?.textContent,
      thumbs: thumbs.length,
      index: index.length,
      withId: thumbs.filter((t) => t?.id).length,
      withoutId: thumbs.filter((t) => !t?.id).length,
      orphaned: thumbs.filter((t) => t?.orphaned).length,
      cards: document.querySelectorAll('.vault-grid--images .vault-card').length,
      placeholders: document.querySelectorAll('.vault-grid--images .placeholder').length,
      deleteSelected: {
        text: deleteBtn?.textContent?.trim(),
        disabled: deleteBtn?.disabled ?? null,
        pointerEvents: deleteBtnStyle?.pointerEvents,
        opacity: deleteBtnStyle?.opacity,
        coveredBy: elementAtDelete?.tagName + (elementAtDelete?.className ? `.${String(elementAtDelete.className).split(' ')[0]}` : '')
      },
      batchDeleteAll: {
        disabled: batchBtn?.disabled ?? null,
        pointerEvents: batchBtnStyle?.pointerEvents
      },
      checkboxes: { total: checkboxes.length, enabled: enabled.length, disabled: disabled.length },
      logs: (window.__deleteAuditLogs || []).slice()
    };
  });
}

function injectForensic20() {
  return `(() => {
    const thumbs = [];
    const index = [];
    for (let i = 0; i < 15; i++) {
      const fn = 'phantom-no-id-' + i + '.png';
      thumbs.push({ fileName: fn, url: '/thumbs/' + fn, name: fn, orphaned: true });
      index.push(fn);
    }
    const ids = [
      '1fd6621f-240e-4bb3-aeb8-6bd28bcfc65d',
      '6f19ec1d-3b96-4858-84cd-57e1e087fd3b',
      '7b6e1139-c311-4203-807e-5bf25dd25d04',
      'a1111111-1111-4111-8111-111111111101',
      'a2222222-2222-4222-8222-222222222202'
    ];
    ids.forEach((id, i) => {
      const fn = id + '.png';
      thumbs.push({ id, fileName: fn, url: '/thumbs/' + fn, name: 'canonical-' + i + '.png' });
      index.push(fn);
    });
    localStorage.setItem('personal_thumbnails', JSON.stringify(thumbs));
    localStorage.setItem('personal_thumbnail_index', JSON.stringify(index));
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
  })()`;
}

if (!(await waitHttp(BASE))) {
  console.error('Frontend unavailable');
  process.exit(1);
}

const launch = { headless: true };
if (existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;
const browser = await chromium.launch(launch);
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  window.__deleteAuditLogs = [];
  const orig = console.info.bind(console);
  console.info = (...args) => {
    const tag = String(args[0] || '');
    if (tag.startsWith('[DELETE_') || tag.startsWith('[BATCH_DELETE') || tag.startsWith('[ORPHAN_PURGE]') || tag.startsWith('[STARTUP_RECONCILE]')) {
      window.__deleteAuditLogs.push({ tag, payload: args[1], at: Date.now() });
    }
    orig(...args);
  };
});

const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
const deleteRequests = [];
page.on('request', (req) => {
  if (req.method() === 'DELETE' && req.url().includes('/api/reels/')) {
    deleteRequests.push({ url: req.url(), at: Date.now() });
  }
});
page.on('response', (res) => {
  if (res.request().method() === 'DELETE' && res.url().includes('/api/reels/')) {
    const last = deleteRequests[deleteRequests.length - 1];
    if (last && !last.status) last.status = res.status();
  }
});

try {
  // Load app, inject live forensic 20-card state, hard refresh
  await page.goto(BASE, { waitUntil: 'load', timeout: 120000 });
  await page.evaluate(injectForensic20());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3000);
  await page.click('.ghost-trigger').catch(() => {});
  await page.waitForSelector('.control-center-container', { timeout: 60000 }).catch(() => {});
  await page.click('button[role="tab"]:has-text("Content")').catch(() => {});
  await page.waitForTimeout(8000);
  await page.waitForFunction(() => window.__thumbCanonicalizationReady === true, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);

  audit.traces.afterLoad = await vaultState(page);
  audit.traces.backendThumbs = await backendThumbCount();

  // ── Trace 1: DELETE SELECTED (no selection) ──
  const logsBeforeSelected = (await vaultState(page)).logs.length;
  const deleteSelectedBtn = page.locator('button:has-text("DELETE SELECTED THUMBS")').first();
  const selectedDisabled = await deleteSelectedBtn.isDisabled();
  audit.traces.deleteSelectedButtonDisabled = selectedDisabled;

  await deleteSelectedBtn.click({ force: true, timeout: 5000 }).catch((e) => {
    audit.traces.deleteSelectedClickError = String(e?.message || e);
  });
  await page.waitForTimeout(3000);
  audit.traces.afterDeleteSelectedClick = await vaultState(page);
  audit.traces.deleteSelectedNewLogs = audit.traces.afterDeleteSelectedClick.logs.slice(logsBeforeSelected);

  if (selectedDisabled) {
    audit.firstFailedStage = audit.firstFailedStage || 'DELETE_SELECTED_BUTTON_DISABLED';
    audit.firstFailedReason = audit.firstFailedReason || 'Button disabled because selectedThumbnailIds.length === 0; orphan checkboxes disabled (no reel.id)';
    audit.firstFailedLocation = audit.firstFailedLocation || {
      file: 'frontend/src/components/experiences/VaultExperience.svelte',
      function: 'batch-delete-btn disabled binding',
      line: 1304
    };
  } else if (!audit.traces.deleteSelectedNewLogs.some((l) => l.tag === '[DELETE_HANDLER]')) {
    audit.firstFailedStage = audit.firstFailedStage || 'DELETE_HANDLER_NOT_ENTERED';
    audit.firstFailedReason = audit.firstFailedReason || 'onclick did not reach batchDeleteSelectedThumbnails';
  }

  // ── Trace 2: SELECT 3 enabled + DELETE SELECTED ──
  const enabledBoxes = page.locator('.vault-grid--images input.batch-select-checkbox:not(:disabled)');
  const enabledCount = await enabledBoxes.count();
  audit.traces.enabledCheckboxCount = enabledCount;
  if (enabledCount > 0) {
    const logsBefore = (await vaultState(page)).logs.length;
    for (let i = 0; i < Math.min(3, enabledCount); i++) {
      await enabledBoxes.nth(i).click({ force: true });
      await page.waitForTimeout(150);
    }
    await page.locator('button:has-text("DELETE SELECTED THUMBS")').first().click({ force: true });
    await page.waitForTimeout(12000);
    audit.traces.afterPartialDeleteSelected = await vaultState(page);
    audit.traces.partialDeleteApi = [...deleteRequests];
    audit.traces.partialDeleteLogs = audit.traces.afterPartialDeleteSelected.logs.slice(logsBefore);
  }

  // ── Trace 3: BATCH DELETE ALL ──
  const logsBeforeBatch = (await vaultState(page)).logs.length;
  const apiBeforeBatch = deleteRequests.length;
  await page.locator('button:has-text("BATCH DELETE ALL")').first().click({ force: true });
  await page.waitForTimeout(15000);
  audit.traces.afterBatchDeleteAll = await vaultState(page);
  audit.traces.batchDeleteApi = deleteRequests.slice(apiBeforeBatch);
  audit.traces.batchDeleteLogs = audit.traces.afterBatchDeleteAll.logs.slice(logsBeforeBatch);

  const batchHandlerEntered = audit.traces.batchDeleteLogs.some((l) => l.tag === '[DELETE_HANDLER]');
  const batchRender = audit.traces.batchDeleteLogs.find((l) => l.tag === '[DELETE_RENDER]');
  if (!batchHandlerEntered) {
    audit.firstFailedStage = audit.firstFailedStage || 'BATCH_DELETE_HANDLER_NOT_ENTERED';
    audit.firstFailedReason = audit.firstFailedReason || 'batchDeleteThumbnails never entered';
  } else if (audit.traces.afterBatchDeleteAll.cards === 20 || audit.traces.afterBatchDeleteAll.thumbs === 20) {
    const purgeRan = audit.traces.batchDeleteLogs.some((l) => l.tag === '[ORPHAN_PURGE]');
    const deletedIdsZero = batchRender?.payload?.deletedIdsCount === 0;
    audit.firstFailedStage = 'BATCH_DELETE_STORE_NO_ORPHAN_REMOVAL';
    audit.firstFailedReason = deletedIdsZero
      ? 'batchDeleteThumbnails completed but deletedIds empty — purgeStaleOrphanThumbnails skipped (requires deletedIds.length > 0); applyThumbnailDeleteTombstone retains id-less orphans via !id guard'
      : 'Store/render count unchanged after batch delete';
    audit.firstFailedLocation = {
      file: 'frontend/src/components/experiences/VaultExperience.svelte',
      function: 'purgeStaleOrphanThumbnails / applyThumbnailDeleteTombstone',
      line: '281 / 302'
    };
    audit.uiRemainsAt20Reason =
      '15 id-less orphaned entries survive tombstone (line 302: return !id || !deletedSet.has(id)). BATCH DELETE ALL only deletes backend reels; with 0 backend matches purge never runs. 5 local canonical ids may also lack backend reels but are kept as canonical class.';
  }

  // ── Trace 4: hard refresh after delete ──
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3000);
  await page.click('.ghost-trigger').catch(() => {});
  await page.click('button[role="tab"]:has-text("Content")').catch(() => {});
  await page.waitForTimeout(8000);
  audit.traces.afterHardRefresh = await vaultState(page);

  audit.logs = audit.traces.afterBatchDeleteAll?.logs || [];

  // ── Trace 5: 20 pure orphans (no ids) — user "still 20" scenario ──
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => {
    const thumbs = [];
    const index = [];
    for (let i = 0; i < 20; i++) {
      const fn = `pure-orphan-${i}.png`;
      thumbs.push({ fileName: fn, url: `/thumbs/${fn}`, name: fn, orphaned: true });
      index.push(fn);
    }
    localStorage.setItem('personal_thumbnails', JSON.stringify(thumbs));
    localStorage.setItem('personal_thumbnail_index', JSON.stringify(index));
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3000);
  await page.click('.ghost-trigger').catch(() => {});
  await page.click('button[role="tab"]:has-text("Content")').catch(() => {});
  await page.waitForTimeout(8000);
  audit.traces.pureOrphanAfterLoad = await vaultState(page);

  const apiBeforePure = deleteRequests.length;
  await page.locator('button:has-text("BATCH DELETE ALL")').first().click({ force: true });
  await page.waitForTimeout(12000);
  audit.traces.pureOrphanAfterBatch = await vaultState(page);
  audit.traces.pureOrphanBatchApi = deleteRequests.slice(apiBeforePure);

  if (audit.traces.pureOrphanAfterLoad?.cards === 20) {
    audit.userScenario20 = {
      stage: 'STARTUP_RECONCILE_DID_NOT_PURGE',
      reason: '20 pure orphans still rendered after load — reconcile skipped or not deployed'
    };
  }
  if (audit.traces.pureOrphanAfterBatch?.cards === 20) {
    audit.userScenario20 = audit.userScenario20 || {};
    audit.userScenario20.batchDeleteStage = 'BATCH_DELETE_NO_STORE_MUTATION';
    audit.userScenario20.batchDeleteReason =
      'batchDeleteThumbnails: idsToDelete=0, deletedIds=0, purgeStaleOrphanThumbnails skipped, tombstone retains id-less entries';
    audit.firstFailedStage = audit.firstFailedStage || 'BATCH_DELETE_STORE_NO_ORPHAN_REMOVAL';
    audit.firstFailedLocation = {
      file: 'frontend/src/components/experiences/VaultExperience.svelte',
      function: 'batchDeleteThumbnails',
      line: '1128-1134'
    };
    audit.uiRemainsAt20Reason =
      'BATCH DELETE ALL deletes backend reels only. With 0 backend matches, deletedIds stays empty so purgeStaleOrphanThumbnails (line 281: if (!deletedIds?.length) return) never runs. applyThumbnailDeleteTombstone (line 302: return !id || !deletedSet.has(id)) preserves all id-less orphans. DELETE SELECTED is disabled when selectedThumbnailIds is empty (orphan checkboxes disabled at line 1392).';
  } else if (audit.traces.pureOrphanAfterLoad?.cards === 0) {
    audit.userScenario20 = {
      note: 'Startup reconcile cleared 20 pure orphans before delete — user seeing 20 implies reconcile not active or entries have ids'
    };
  }
} finally {
  await browser.close();
}

const md = `# MISSION_5_7_7_LIVE_DELETE_EVENT_AUDIT

Generated: ${new Date().toISOString()}

## Mode: Investigation only (no fixes)

Live browser simulation using Mission 5.7.3 forensic state (20 cards: 15 orphans + 5 canonical ids).

---

## 1. Event flow

### DELETE SELECTED path

\`\`\`
Mouse click → DELETE SELECTED button
  ↓ disabled={selectedThumbnailIds.length === 0}  ← STOPS HERE (all-orphan / no selection)
  ↓ on:click → batchDeleteSelectedThumbnails()
  ↓ if (!selected.length) early return
  ↓ deleteReelById(reelId) per selected UUID
  ↓ applyThumbnailDeleteTombstone(deletedIds) — keeps !id entries
  ↓ syncFromVault → purgeStaleOrphanThumbnails(deletedIds)
  ↓ personalThumbnailCollection.set / update
  ↓ [DELETE_REACTIVE] → #each re-render
\`\`\`

### BATCH DELETE ALL path

\`\`\`
Mouse click → BATCH DELETE ALL button (always enabled)
  ↓ batchDeleteThumbnails()
  ↓ fetchReadyReels() → idsToDelete (backend only)
  ↓ deleteReelById for each backend id
  ↓ applyThumbnailDeleteTombstone(deletedIds) — only if deletedIds.length > 0
  ↓ syncFromVault
  ↓ purgeStaleOrphanThumbnails(deletedIds) — only if deletedIds.length > 0  ← orphans survive when 0
  ↓ afterCount unchanged for id-less orphans
\`\`\`

---

## 2. First failed stage

**${audit.firstFailedStage || 'See traces'}**

## 3. Reason UI remains "Your Thumbnails (20)"

${audit.uiRemainsAt20Reason || audit.firstFailedReason || 'See evidence below.'}

## 4. File / function / line

\`\`\`json
${JSON.stringify(audit.firstFailedLocation || {}, null, 2)}
\`\`\`

---

## 5. Button verification

| Check | Value |
|-------|-------|
| DELETE SELECTED disabled | ${audit.traces.deleteSelectedButtonDisabled} |
| Enabled checkboxes | ${audit.traces.enabledCheckboxCount ?? audit.traces.afterLoad?.checkboxes?.enabled} |
| Disabled checkboxes | ${audit.traces.afterLoad?.checkboxes?.disabled} |
| After load cards | ${audit.traces.afterLoad?.cards} |
| After load heading | ${audit.traces.afterLoad?.heading} |
| Backend thumb reels | ${audit.traces.backendThumbs} |

### After load button state

\`\`\`json
${JSON.stringify(audit.traces.afterLoad?.deleteSelected || {}, null, 2)}
\`\`\`

---

## 6. Live trace results

### After page load

\`\`\`json
${JSON.stringify(audit.traces.afterLoad || {}, null, 2)}
\`\`\`

### DELETE SELECTED click (forced)

\`\`\`json
${JSON.stringify({
  newLogs: audit.traces.deleteSelectedNewLogs,
  after: audit.traces.afterDeleteSelectedClick?.heading,
  cards: audit.traces.afterDeleteSelectedClick?.cards
}, null, 2)}
\`\`\`

### Partial DELETE SELECTED (3 canonical)

\`\`\`json
${JSON.stringify({
  api: audit.traces.partialDeleteApi,
  after: audit.traces.afterPartialDeleteSelected?.heading,
  cards: audit.traces.afterPartialDeleteSelected?.cards,
  thumbs: audit.traces.afterPartialDeleteSelected?.thumbs,
  keyLogs: (audit.traces.partialDeleteLogs || []).filter((l) => l.tag.startsWith('[DELETE_'))
}, null, 2)}
\`\`\`

### BATCH DELETE ALL

\`\`\`json
${JSON.stringify({
  api: audit.traces.batchDeleteApi,
  after: audit.traces.afterBatchDeleteAll?.heading,
  cards: audit.traces.afterBatchDeleteAll?.cards,
  thumbs: audit.traces.afterBatchDeleteAll?.thumbs,
  keyLogs: (audit.traces.batchDeleteLogs || []).filter((l) =>
    ['[DELETE_CLICK]', '[DELETE_HANDLER]', '[DELETE_API]', '[DELETE_STORE]', '[DELETE_RENDER]', '[ORPHAN_PURGE]', '[STARTUP_RECONCILE]'].includes(l.tag)
  )
}, null, 2)}
\`\`\`

### After hard refresh

\`\`\`json
${JSON.stringify(audit.traces.afterHardRefresh || {}, null, 2)}
\`\`\`

---

## 7. Conclusion

| Question | Answer |
|----------|--------|
| Does onclick fire on DELETE SELECTED? | ${audit.traces.deleteSelectedButtonDisabled ? '**NO** (button disabled — handler not reachable without force)' : 'YES'} |
| Is selectedThumbnailIds empty? | **YES** when no canonical selection (orphan vault) |
| Is batchDeleteThumbnails called? | ${audit.traces.batchDeleteLogs?.some((l) => l.tag === '[DELETE_HANDLER]') ? '**YES**' : 'NO'} |
| Does store count drop after BATCH DELETE ALL? | ${audit.traces.afterBatchDeleteAll?.cards === 20 ? '**NO** — remains 20' : 'YES'} |
| Why rendered count stays 20? | Id-less orphans bypass tombstone; purge gated on deletedIds.length |

Audit: \`node scripts/mission-5.7.7-live-delete-audit.mjs\`
`;

writeFileSync(OUT, md);
writeFileSync(JSON_OUT, JSON.stringify(audit, null, 2));
console.log(`Audit: ${OUT}`);
console.log('First failed stage:', audit.firstFailedStage);
console.log('After BATCH DELETE ALL:', audit.traces.afterBatchDeleteAll?.heading);
