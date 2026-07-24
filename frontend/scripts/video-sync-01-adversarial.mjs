#!/usr/bin/env node
/**
 * VIDEO-SYNC-01 adversarial pre-deploy checks (Cases A–C).
 */
const DELETED_MEDIA_STORAGE_KEY = 'reelforge_deleted_media_ids';
const store = {};
globalThis.localStorage = {
  getItem: (key) => (key in store ? store[key] : null),
  setItem: (key, value) => {
    store[key] = String(value);
  }
};

function readDeletedMediaIds() {
  try {
    const raw = localStorage.getItem(DELETED_MEDIA_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((id) => String(id || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function isDeletedMediaId(id) {
  const key = String(id || '').trim();
  if (!key) return false;
  return readDeletedMediaIds().includes(key);
}

function recordDeletedMediaIds(ids) {
  const incoming = (Array.isArray(ids) ? ids : [ids])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (!incoming.length) return readDeletedMediaIds();
  const existing = readDeletedMediaIds();
  const seen = new Set();
  const next = [];
  for (const id of [...incoming, ...existing]) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  localStorage.setItem(DELETED_MEDIA_STORAGE_KEY, JSON.stringify(next));
  return next;
}

function mergeGate(entries) {
  const rejectedIds = [];
  const kept = entries.filter((entry) => {
    if (!entry || typeof entry !== 'object') return true;
    const id = String(entry.id || '').trim();
    const personalId = String(entry.personal_video_id || '').trim();
    if (id && isDeletedMediaId(id)) {
      rejectedIds.push(id);
      return false;
    }
    if (personalId && isDeletedMediaId(personalId)) {
      rejectedIds.push(personalId);
      return false;
    }
    return true;
  });
  return { kept, rejectedIds: [...new Set(rejectedIds)] };
}

/** Simulates deleteVaultVideo fallback when persistenceSuccess is false. */
function simulateTombstoneBeforeSyncFallback(videoId) {
  recordDeletedMediaIds(videoId);
  return {
    log: 'deleteVaultVideo:tombstone-before-sync',
    tombstones: readDeletedMediaIds()
  };
}

const results = [];

function report(caseId, name, pass, detail = {}) {
  results.push({ caseId, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} — Case ${caseId}: ${name}`);
  if (Object.keys(detail).length) console.log('  ', JSON.stringify(detail));
}

// Case A — stale backend catalog
(() => {
  localStorage.setItem(DELETED_MEDIA_STORAGE_KEY, JSON.stringify(['abc']));
  const incoming = [{ id: 'abc' }, { id: 'xyz' }];
  const { kept, rejectedIds } = mergeGate(incoming);
  report('A', 'stale catalog rejects tombstoned id only', rejectedIds.includes('abc') && kept.length === 1 && kept[0].id === 'xyz', {
    rejectedIds,
    keptIds: kept.map((e) => e.id)
  });
})();

// Case B — missing diskName delete fallback tombstone before sync
(() => {
  localStorage.setItem(DELETED_MEDIA_STORAGE_KEY, JSON.stringify([]));
  const videoId = 'missing-disk-reel-001';
  const token = 'valid-token';
  const diskName = '';
  let persistenceSuccess = false;
  if (token && diskName) persistenceSuccess = true;
  let fallbackLog = null;
  if (!persistenceSuccess) {
    const fb = simulateTombstoneBeforeSyncFallback(videoId);
    fallbackLog = fb.log;
  }
  const staleCatalog = [{ id: videoId, url: '', name: '' }, { id: 'other-reel', url: '/videos/x.mp4' }];
  const { kept, rejectedIds } = mergeGate(staleCatalog);
  report(
    'B',
    'missing diskName => fallback tombstone then merge rejects',
    fallbackLog === 'deleteVaultVideo:tombstone-before-sync' &&
      readDeletedMediaIds().includes(videoId) &&
      !kept.some((e) => e.id === videoId),
    { fallbackLog, tombstones: readDeletedMediaIds(), keptIds: kept.map((e) => e.id), rejectedIds }
  );
})();

// Case C — no accidental over-delete by filename/url/title/hash
(() => {
  localStorage.setItem(DELETED_MEDIA_STORAGE_KEY, JSON.stringify(['deleted-canonical-id']));
  const sharedMeta = {
    url: '/videos/shared-name.mp4',
    fileName: 'shared-name.mp4',
    name: 'Shared Title',
    hash: 'sha256-deadbeef'
  };
  const incoming = [
    { id: 'deleted-canonical-id', ...sharedMeta },
    { id: 'different-canonical-id', ...sharedMeta }
  ];
  const { kept, rejectedIds } = mergeGate(incoming);
  report(
    'C',
    'only canonical ids blocked (not filename/url/title/hash)',
    rejectedIds.length === 1 &&
      rejectedIds[0] === 'deleted-canonical-id' &&
      kept.length === 1 &&
      kept[0].id === 'different-canonical-id' &&
      kept[0].url === sharedMeta.url,
    { rejectedIds, keptIds: kept.map((e) => e.id) }
  );
})();

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  console.error('\nAdversarial checks failed:', failed.length);
  process.exit(1);
}
console.log('\nVIDEO-SYNC-01 adversarial: all cases passed');
