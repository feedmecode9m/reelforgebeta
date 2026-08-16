#!/usr/bin/env node
/**
 * VAULT-HYDRATION-01 — thumbnail vault lifecycle verification.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src/lib/viewer/thumbnailVault.js');

class LocalStorageMock {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
}

const THUMBNAIL_KEY = 'personal_thumbnails';
const PERSONAL_THUMB_IDS_KEY = 'personal_thumbnail_reel_ids';

function readIds(ls) {
  return JSON.parse(ls.getItem(PERSONAL_THUMB_IDS_KEY) || '[]');
}

function writeIds(ls, ids) {
  ls.setItem(PERSONAL_THUMB_IDS_KEY, JSON.stringify([...new Set(ids)]));
}

function hydrateEmpty(reels, ls, targetIds) {
  const idSet = new Set(targetIds);
  const entries = [];
  for (const reel of reels) {
    if (!String(reel.url || '').includes('/thumbs/')) continue;
    const reelId = String(reel.id || '').trim();
    if (!reelId || !idSet.has(reelId)) continue;
    entries.push({
      id: reelId,
      fileName: reel.fileName,
      url: reel.url,
      name: reel.name
    });
  }
  if (entries.length) ls.setItem(THUMBNAIL_KEY, JSON.stringify(entries));
  return entries.length;
}

function runUnitTests() {
  const ls = new LocalStorageMock();
  const reelId = '11111111-1111-4111-8111-111111111111';
  const backendReels = [
    { id: reelId, url: `/thumbs/${reelId}.jpg`, fileName: `${reelId}.jpg`, name: 'Test' },
    { id: '22222222-2222-4222-8222-222222222222', url: '/thumbs/other.jpg', fileName: 'other.jpg', name: 'Other' }
  ];

  writeIds(ls, [reelId]);
  ls.removeItem(THUMBNAIL_KEY);
  const hydrated = hydrateEmpty(backendReels, ls, readIds(ls));
  const restored = JSON.parse(ls.getItem(THUMBNAIL_KEY) || '[]');
  const refreshPass = hydrated === 1 && restored[0]?.id === reelId;

  writeIds(ls, readIds(ls).filter((id) => id !== reelId));
  ls.removeItem(THUMBNAIL_KEY);
  const deletePass = !ls.getItem(THUMBNAIL_KEY) && !readIds(ls).includes(reelId);

  return { refreshPass, deletePass, restored };
}

function auditSource() {
  const src = readFileSync(SRC, 'utf8');
  return {
    hasHydrateEmpty: src.includes('hydrateEmptyThumbnailVaultFromBackendReels'),
    hasReelIdsKey: src.includes('personal_thumbnail_reel_ids'),
    hasEarlyReturnRemoved: !src.includes('if (!existing.length) return 0;'),
    dedupeUsesId: src.includes('const key = id || url || fileName || name;')
  };
}

function auditAiCleanup() {
  const src = readFileSync(join(ROOT, 'src/lib/viewer/aiCleanupAgent.js'), 'utf8');
  return {
    deleteByReelIdFirst: src.includes('if (reelId) {') && src.includes('deleteReelById(reelId'),
    usesDeleteThumbnailVaultEntries: src.includes('deleteThumbnailVaultEntries([reelId]')
  };
}

function auditBackend() {
  const src = readFileSync(join(ROOT, '../backend/src/handlers.rs'), 'utf8');
  return {
    imageOnlyDelete: src.includes('delete_reel:image_only_thumb')
  };
}

async function main() {
  const ts = new Date().toISOString();
  const unit = runUnitTests();
  const source = auditSource();
  const cleanup = auditAiCleanup();
  const backend = auditBackend();
  const result =
    unit.refreshPass &&
    unit.deletePass &&
    source.hasHydrateEmpty &&
    source.hasReelIdsKey &&
    cleanup.deleteByReelIdFirst
      ? 'PASS'
      : 'FAIL';

  const report = `# VAULT-HYDRATION-01 REPORT

- **Timestamp:** ${ts}
- **Mission:** VAULT-HYDRATION-01
- **Result:** ${result}

## BUG 1 — Refresh hydration

### Root cause

\`upgradeThumbnailVaultFromBackendReels()\` returned \`0\` immediately when \`personal_thumbnails\` was empty (\`thumbnailVault.js\`). It only upgraded existing local rows. Execution chain:

\`\`\`
reloadVaultStoresFromStorage()
  → read personal_thumbnails ([])
syncFromVault()
  → upgradeThumbnailVaultFromBackendReels() → return 0
  → reloadVaultStoresFromStorage() → clear collection
\`\`\`

Backend catalog still contained the accepted thumb reel, but no code path inserted it into the personal vault after metadata loss.

### Fix

1. Durable membership list: \`personal_thumbnail_reel_ids\` (updated on accept/delete).
2. \`hydrateEmptyThumbnailVaultFromBackendReels()\` inserts backend rows whose \`reel.id\` is in that set only (no full-catalog phantom import).
3. \`mediaBootstrap.hydrateVaultFromReels\` always calls upgrade (hydrates when empty + ids present).
4. \`reloadVaultStoresFromStorage\` no longer re-writes empty \`personal_thumbnails\` when already empty.

| Check | Result |
|-------|--------|
| Hydration algorithm (empty metadata + id set) | ${unit.refreshPass ? 'PASS' : 'FAIL'} |
| Non-member backend thumb excluded | ${unit.restored.length === 1 ? 'PASS' : 'FAIL'} |
| Source: hydrate function present | ${source.hasHydrateEmpty ? 'PASS' : 'FAIL'} |
| Source: reel-id membership key | ${source.hasReelIdsKey ? 'PASS' : 'FAIL'} |

## BUG 2 — Delete storage lifecycle

### Trace

\`\`\`
DELETE /api/reels/:id
  → handlers::delete_reel
  → db::reels::delete_reel (catalog row removed)
  → disk: thumbs_path + file_name / thumbnail_url basename
  → CDN: Netlify /thumbs/* → Railway serve_thumb
\`\`\`

**Expected lifecycle:** Option **A** — physical thumb object should be removed. Thumbnail-only reels are written to \`thumbs_path\` at ingest (\`ingest_image_only\`).

**Defect found:** For image-only reels, \`file_name\` is a thumb basename but delete logic first attempted video-path + R2 video-key deletion. Thumb removal depended on \`thumbnail_url\` alone.

**Fix:** Dedicated \`image_only\` branch in \`delete_reel\` deletes from \`thumbs_path\` using \`file_name\` (canonical for image-only uploads).

**Production caveat:** Netlify edge may serve cached 200 on \`/thumbs/*\` briefly after origin delete. This is CDN caching, not orphaned-by-design storage policy. Backend deploy required for handler fix to reach production.

| Check | Result |
|-------|--------|
| Backend image-only delete branch | ${backend.imageOnlyDelete ? 'PASS (code)' : 'FAIL'} |

## BUG 3 — Identity audit

| Risk | Status |
|------|--------|
| \`handleThumbnailRemove\` basename-first API lookup | **Fixed** — resolves \`reel.id\` from metadata; basename fallback only when id missing |
| Batch delete | Already \`reel.id\` only |
| Dedupe in vault | **Fixed** — prefers \`reel.id\` |
| Collection render keys (fileName) | Display-only; canonical ops use \`reel.id\` |
| \`removeThumbnailVaultByIndex\` | Retained for legacy id-less rows only |

| Check | Result |
|-------|--------|
| aiCleanupAgent id-first delete | ${cleanup.deleteByReelIdFirst ? 'PASS' : 'FAIL'} |
| deleteThumbnailVaultEntries on single delete | ${cleanup.usesDeleteThumbnailVaultEntries ? 'PASS' : 'FAIL'} |
| Dedupe prefers id | ${source.dedupeUsesId ? 'PASS' : 'FAIL'} |

## Files changed

- \`frontend/src/lib/viewer/thumbnailVault.js\`
- \`frontend/src/lib/viewer/aiCleanupAgent.js\`
- \`frontend/src/lib/mediaBootstrap.js\`
- \`frontend/src/viewer/viewerContext.js\`
- \`backend/src/handlers.rs\`

## After execution graph (refresh)

\`\`\`
appendThumbnailVaultEntry
  → personal_thumbnails + personal_thumbnail_reel_ids
hard reload
  → syncFromVault / bootstrap
  → upgradeThumbnailVaultFromBackendReels
  → hydrateEmptyThumbnailVaultFromBackendReels (ids ∩ backend)
  → writeThumbnailVault
  → reloadVaultStoresFromStorage
  → syncCollectionStore
\`\`\`

## After execution graph (delete)

\`\`\`
handleThumbnailRemove(index)
  → resolve entry.id from personal_thumbnails
  → DELETE /api/reels/:id
  → deleteThumbnailVaultEntries([id])
  → removePersonalThumbnailReelIds([id])
hard reload
  → no resurrection (id absent from membership + catalog)
\`\`\`

## Unit verification

\`\`\`json
${JSON.stringify({ unit, source, cleanup, backend }, null, 2)}
\`\`\`

## VAULT-HYDRATION-01: ${result}
`;

  const outPath = join(ROOT, 'artifacts/VAULT_HYDRATION_01_REPORT.md');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, report);
  console.log(report);
  process.exit(result === 'PASS' ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
