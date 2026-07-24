#!/usr/bin/env node
/**
 * VIDEO-SYNC-01 — local merge tombstone gate (no browser, no deploy).
 * Mirrors mergeVideoVaultEntries rejectTombstonedVaultEntries logic.
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

const deletedId = 'dead-beef-1111-2222-3333-444455556666';
const otherId = 'live-cafe-aaaa-bbbb-cccc-dddddddddddd';
localStorage.setItem(DELETED_MEDIA_STORAGE_KEY, JSON.stringify([deletedId]));

const catalog = [
  { id: deletedId, url: '/videos/tombstoned.mp4', name: 'tombstoned.mp4' },
  { id: otherId, url: '/videos/kept.mp4', name: 'kept.mp4' }
];

const { kept, rejectedIds } = mergeGate(catalog);
const cases = [
  {
    name: 'tombstoned id rejected during backend projection',
    pass: rejectedIds.includes(deletedId) && !kept.some((e) => e.id === deletedId)
  },
  {
    name: 'non-tombstoned id kept',
    pass: kept.some((e) => e.id === otherId)
  },
  {
    name: 'backend catalog briefly contains tombstoned id => still rejected',
    pass: (() => {
      const { kept: k, rejectedIds: r } = mergeGate([
        { id: deletedId, url: '/videos/stale-catalog.mp4' },
        { id: otherId, url: '/videos/kept.mp4' }
      ]);
      return r.includes(deletedId) && k.length === 1 && k[0].id === otherId;
    })()
  },
  {
    name: 'no tombstone => merge cannot reject (documents !diskName gap)',
    pass: (() => {
      localStorage.setItem(DELETED_MEDIA_STORAGE_KEY, JSON.stringify([]));
      const r = mergeGate([{ id: 'orphan-id', url: '/videos/x.mp4' }]);
      return r.kept.length === 1 && r.rejectedIds.length === 0;
    })()
  }
];

let allPass = true;
for (const c of cases) {
  console.log(`${c.pass ? 'PASS' : 'FAIL'} — ${c.name}`);
  if (!c.pass) allPass = false;
}

if (!allPass) process.exit(1);
console.log('VIDEO-SYNC-01 merge gate: all local cases passed');
