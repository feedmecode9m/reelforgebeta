/**
 * Thumbnail Vault — single owner for personal thumbnail lifecycle.
 * Source of truth: personal_thumbnails (metadata). Collection is derived only.
 */
import { get } from 'svelte/store';
import { storeThumbnailMetadata } from '../storage.js';
import { isImageReel } from '../api/reelContract.js';
import { toRelativeMediaPath } from '../config.js';
import { isHeroAsset } from '../hero/heroDomainGuard.js';
import {
  classifyThumbnailEntry,
  filterStaleOrphanEntries,
  canonicalizeThumbnailEntries,
  thumbnailEntryFileKey,
  isThumbnailImageReel
} from './thumbnailCanonicalization.js';
import { assertThumbnailVaultInvariants } from './thumbnailInvariants.js';
import { traceThumbStoreWrite } from './thumbStoreWriteTrace.js';
import { enterThumbnailVaultWrite, exitThumbnailVaultWrite } from './thumbnailOwnerGuard.js';
import { vaultForensic } from '../diagnostics/vaultForensics.js';

export const THUMBNAIL_STATES = {
  UPLOAD_PENDING: 'UPLOAD_PENDING',
  INGESTING: 'INGESTING',
  CANONICAL: 'CANONICAL',
  ORPHANED: 'ORPHANED',
  SELECTED: 'SELECTED',
  DELETING: 'DELETING',
  DELETED: 'DELETED',
  PURGED: 'PURGED'
};

const THUMBNAIL_KEY = 'personal_thumbnails';
const INDEX_MIRROR_KEY = 'personal_thumbnail_index';
const PERSONAL_THUMB_IDS_KEY = 'personal_thumbnail_reel_ids';

/** @returns {string[]} */
function readPersonalThumbnailReelIds() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(PERSONAL_THUMB_IDS_KEY) || '[]');
    return Array.isArray(parsed)
      ? [...new Set(parsed.map((id) => String(id || '').trim()).filter(Boolean))]
      : [];
  } catch {
    return [];
  }
}

/** @param {string[]} ids */
function writePersonalThumbnailReelIds(ids) {
  if (typeof window === 'undefined') return [];
  const list = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean))];
  localStorage.setItem(PERSONAL_THUMB_IDS_KEY, JSON.stringify(list));
  return list;
}

/** @param {string} reelId */
function addPersonalThumbnailReelId(reelId) {
  const id = String(reelId || '').trim();
  if (!id) return readPersonalThumbnailReelIds();
  return writePersonalThumbnailReelIds([...readPersonalThumbnailReelIds(), id]);
}

/** @param {string[]} reelIds */
function removePersonalThumbnailReelIds(reelIds = []) {
  const remove = new Set(reelIds.map((id) => String(id || '').trim()).filter(Boolean));
  if (!remove.size) return readPersonalThumbnailReelIds();
  return writePersonalThumbnailReelIds(readPersonalThumbnailReelIds().filter((id) => !remove.has(id)));
}

/** @param {Record<string, unknown>} reel */
function backendThumbReelToVaultEntry(reel) {
  const url = String(reel?.url || '');
  const relUrl = url ? toRelativeMediaPath(url) : '';
  const fileName =
    String(reel?.fileName || reel?.file_name || '').trim() ||
    (relUrl ? relUrl.split('/').pop()?.split('?')[0] || '' : '');
  const displayName = String(reel?.name || reel?.title || fileName);
  const reelId = reel?.id ? String(reel.id) : '';
  return {
    id: reelId,
    fileName,
    url: relUrl || (fileName ? `/thumbs/${fileName.replace(/^thumbs\//, '')}` : ''),
    name: displayName,
    title: displayName,
    origin: 'backend_hydrate',
    vaultState: reelId ? THUMBNAIL_STATES.CANONICAL : THUMBNAIL_STATES.INGESTING
  };
}

function isBackendThumbReel(reel) {
  return isImageReel(reel) && String(reel?.url || '').includes('/thumbs/');
}

/** @param {unknown[]} entries */
function dedupeThumbEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (typeof entry === 'string') {
      const key = String(entry).trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }
    const id = typeof entry === 'object' ? String(entry?.id || '').trim() : '';
    const url = String(entry?.url || '').trim();
    const name = String(entry?.name || '').trim();
    const fileName = String(entry?.fileName || '').trim();
    const key = id || url || fileName || name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** @param {unknown} entry */
export function deriveEntryState(entry, imageReels = [], options = {}) {
  const classification = classifyThumbnailEntry(entry, imageReels, options);
  const id = String(entry?.id || '').trim();
  const url = String(entry?.url || '');

  if (url.startsWith('blob:') || url.startsWith('data:')) {
    return THUMBNAIL_STATES.UPLOAD_PENDING;
  }
  if (entry?.orphaned) return THUMBNAIL_STATES.ORPHANED;
  if (classification.class === 'stale') return THUMBNAIL_STATES.ORPHANED;
  if (id) return THUMBNAIL_STATES.CANONICAL;
  if (classification.class === 'recoverable') return THUMBNAIL_STATES.INGESTING;
  return THUMBNAIL_STATES.ORPHANED;
}

/** @param {unknown[]} entries */
export function deriveCollectionKeys(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      if (typeof entry === 'string') return String(entry).trim();
      return thumbnailEntryFileKey(entry);
    })
    .filter(Boolean);
}

/** @param {string} [storageKey] */
export function readThumbnailVault(storageKey = THUMBNAIL_KEY) {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(storageKey) || '[]');
  } catch {
    return [];
  }
}

/**
 * Atomic metadata write + derived index mirror. Collection store updated by caller via syncCollectionStore.
 * @param {unknown[]} entries
 * @param {string} [storageKey]
 */
export function writeThumbnailVault(entries, storageKey = THUMBNAIL_KEY) {
  enterThumbnailVaultWrite();
  try {
  const prev = readThumbnailVault(storageKey);
  const list = (Array.isArray(entries) ? entries : []).map((entry) => {
    if (typeof entry === 'string') {
      const fileName = String(entry).trim();
      if (!fileName) return entry;
      entry = {
        fileName,
        url: `/thumbs/${fileName.replace(/^thumbs\//, '')}`,
        name: fileName,
        origin: 'legacy_string'
      };
    }
    if (!entry || typeof entry !== 'object') return entry;
    if (entry.vaultState) {
      if (entry.vaultState === THUMBNAIL_STATES.ORPHANED) {
        return { ...entry, orphaned: true, vaultState: THUMBNAIL_STATES.ORPHANED };
      }
      return entry;
    }
    const state = deriveEntryState(entry, [], {});
    return { ...entry, vaultState: state };
  });
  storeThumbnailMetadata(storageKey, list);
  if (typeof window !== 'undefined') {
    const keys = deriveCollectionKeys(list);
    try {
      const prevIndex = JSON.parse(localStorage.getItem(INDEX_MIRROR_KEY) || '[]');
      localStorage.setItem(INDEX_MIRROR_KEY, JSON.stringify(keys));
      traceThumbStoreWrite('writeThumbnailVault:indexMirror', 'personal_thumbnail_index', prevIndex, keys, {
        storageKey
      });
    } catch {
      // mirror is non-authoritative
    }
  }
  traceThumbStoreWrite('writeThumbnailVault', 'personal_thumbnails', prev, list, { storageKey });
  vaultForensic('VAULT_PERSIST', {
    vaultType: 'thumbnail',
    assetId: list[0]?.id || null,
    fileName: list[0]?.fileName || list[0]?.name || null,
    storageLocation: storageKey,
    backendEndpoint: null,
    result: 'localStorage_write',
    count: list.length
  });
  return list;
  } finally {
    exitThumbnailVaultWrite();
  }
}

/**
 * @param {import('svelte/store').Writable<string[]>} collectionStore
 * @param {string} [storageKey]
 */
export function syncCollectionStore(collectionStore, storageKey = THUMBNAIL_KEY) {
  const entries = readThumbnailVault(storageKey);
  const keys = deriveCollectionKeys(entries);
  const prevKeys = get(collectionStore) || [];
  collectionStore.set(keys);
  traceThumbStoreWrite('syncCollectionStore', 'personalThumbnailCollection', prevKeys, keys, { storageKey });
  return { entries, keys };
}

/**
 * Hydrate an empty local vault from durable reel-id membership + backend catalog.
 * @param {Record<string, unknown>[]} reels
 * @param {string} [storageKey]
 * @returns {number}
 */
function hydrateEmptyThumbnailVaultFromBackendReels(reels, storageKey = THUMBNAIL_KEY) {
  const targetIds = new Set(readPersonalThumbnailReelIds());
  if (!targetIds.size) return 0;

  const entries = [];
  for (const reel of reels || []) {
    if (!isBackendThumbReel(reel)) continue;
    if (isHeroAsset(reel)) continue;
    const reelId = String(reel?.id || '').trim();
    if (!reelId || !targetIds.has(reelId)) continue;
    entries.push(backendThumbReelToVaultEntry(reel));
  }

  const deduped = dedupeThumbEntries(entries);
  if (deduped.length) {
    writeThumbnailVault(deduped, storageKey);
    traceThumbStoreWrite('hydrateEmptyThumbnailVaultFromBackendReels', storageKey, [], deduped);
    vaultForensic('VAULT_REFRESH_RESTORE', {
      vaultType: 'thumbnail',
      assetId: deduped.map((e) => e?.id).filter(Boolean).join(',') || null,
      fileName: null,
      storageLocation: storageKey,
      backendEndpoint: 'GET /api/reels',
      result: 'hydrate_empty_vault',
      count: deduped.length
    });
  }
  return deduped.length;
}

/**
 * Upgrade existing local vault entries from backend thumb reels; hydrate empty vault by reel.id membership.
 * @param {Record<string, unknown>[]} reels
 * @param {string} [storageKey]
 * @returns {number} entry count after upgrade
 */
export function upgradeThumbnailVaultFromBackendReels(reels, storageKey = THUMBNAIL_KEY) {
  const existing = readThumbnailVault(storageKey);
  if (!existing.length) return hydrateEmptyThumbnailVaultFromBackendReels(reels, storageKey);

  const entries = [...existing];
  let changed = false;

  for (const reel of reels || []) {
    if (!isBackendThumbReel(reel)) continue;
    if (isHeroAsset(reel)) continue;
    const url = String(reel?.url || '');
    const relUrl = url ? toRelativeMediaPath(url) : '';
    const fileName =
      String(reel?.fileName || reel?.file_name || '').trim() ||
      (relUrl ? relUrl.split('/').pop()?.split('?')[0] || '' : '');
    const displayName = String(reel?.name || reel?.title || fileName);
    const reelId = reel?.id ? String(reel.id) : '';
    const existingIdx = entries.findIndex((e) => {
      if (typeof e === 'string') {
        const key = String(e).trim();
        return (fileName && key === fileName) || (relUrl && key === relUrl.split('/').pop()?.split('?')[0]);
      }
      return (
        (reelId && e?.id === reelId) ||
        (fileName && e?.fileName === fileName) ||
        (relUrl && toRelativeMediaPath(String(e?.url || '')) === relUrl)
      );
    });
    if (existingIdx < 0) continue;
    if (typeof entries[existingIdx] === 'string') {
      const key = String(entries[existingIdx]).trim();
      entries[existingIdx] = {
        fileName: fileName || key,
        url: relUrl || `/thumbs/${key.replace(/^thumbs\//, '')}`,
        name: displayName || key,
        title: displayName || key,
        origin: 'legacy_string'
      };
      changed = true;
    }
    const target = entries[existingIdx];
    if (typeof target !== 'object' || !target) continue;
    if (reelId && target.id !== reelId) {
      target.id = reelId;
      changed = true;
    }
    if (fileName && target.fileName !== fileName) {
      target.fileName = fileName;
      changed = true;
    }
    if (relUrl && target.url !== (relUrl || target.url)) {
      target.url = relUrl || target.url;
      changed = true;
    }
    if (displayName && (target.name !== displayName || target.title !== displayName)) {
      target.name = displayName;
      target.title = displayName;
      changed = true;
    }
  }

  const deduped = dedupeThumbEntries(entries);
  if (changed || deduped.length !== existing.length) {
    writeThumbnailVault(deduped, storageKey);
    traceThumbStoreWrite('upgradeThumbnailVaultFromBackendReels', storageKey, existing, deduped);
  }
  return deduped.length;
}

/** @deprecated Use upgradeThumbnailVaultFromBackendReels */
export function ingestThumbReelsToVault(reels, storageKey = THUMBNAIL_KEY) {
  return upgradeThumbnailVaultFromBackendReels(reels, storageKey);
}

/**
 * Single reconciliation path — startup, post-delete, post-sync.
 * @param {Record<string, unknown>[]} imageReels
 * @param {{ backendReachable?: boolean; pendingFileKeys?: Set<string>; storageKey?: string; purgeGhostCanonical?: boolean; purgeMarkedOrphans?: boolean }} [options]
 */
export function reconcileThumbnailVault(imageReels = [], options = {}) {
  const {
    backendReachable = false,
    pendingFileKeys = new Set(),
    storageKey = THUMBNAIL_KEY,
    purgeGhostCanonical = true,
    purgeMarkedOrphans = false
  } = options;

  if (!backendReachable) {
    return { entries: readThumbnailVault(storageKey), purged: [], changed: false, skipped: 'offline' };
  }

  let entries = readThumbnailVault(storageKey);
  const { entries: canonicalized, changed: canonChanged } = canonicalizeThumbnailEntries(entries, imageReels);
  entries = canonicalized;

  const backendIds = new Set(
    (imageReels || []).filter(isThumbnailImageReel).map((r) => String(r?.id || '').trim()).filter(Boolean)
  );

  const kept = [];
  const purged = [];

  for (const raw of entries) {
    const normalized = raw && typeof raw === 'object' ? raw : null;
    const id = String(normalized?.id || '').trim();
    const classification = classifyThumbnailEntry(raw, imageReels, { pendingFileKeys, backendReachable: true });

    if (classification.class === 'orphaned') {
      if (purgeMarkedOrphans) {
        purged.push({
          fileKey: thumbnailEntryFileKey(normalized || {}),
          reason: classification.reason,
          type: 'orphaned'
        });
        continue;
      }
      const state = deriveEntryState(raw, imageReels, { pendingFileKeys });
      const next = normalized ? { ...normalized, vaultState: state, orphaned: true } : raw;
      kept.push(next);
      continue;
    }

    if (classification.class === 'stale') {
      purged.push({ fileKey: thumbnailEntryFileKey(normalized || {}), reason: classification.reason, type: 'stale' });
      continue;
    }

    if (purgeGhostCanonical && id && backendIds.size >= 0 && !backendIds.has(id)) {
      const url = String(normalized?.url || '');
      if (!url.startsWith('blob:') && !url.startsWith('data:')) {
        purged.push({ fileKey: thumbnailEntryFileKey(normalized || {}), id, reason: 'ghost_canonical_404', type: 'ghost' });
        continue;
      }
    }

    const state = deriveEntryState(raw, imageReels, { pendingFileKeys });
    const next = normalized ? { ...normalized, vaultState: state } : raw;
    if (state === THUMBNAIL_STATES.CANONICAL && next.orphaned) delete next.orphaned;
    kept.push(next);
  }

  const changed = purged.length > 0 || canonChanged;
  if (changed) {
    writeThumbnailVault(kept, storageKey);
  }

  const result = { entries: kept, purged, changed, examined: entries.length };
  assertThumbnailVaultInvariants(kept, imageReels, { backendReachable, label: 'reconcile' });
  return result;
}

/**
 * Single delete path — tombstone by id + reconcile stale/ghost.
 * @param {string[]} deletedIds
 * @param {Record<string, unknown>[]} imageReels
 * @param {{ backendReachable?: boolean; pendingFileKeys?: Set<string>; storageKey?: string; failedIds?: string[] }} [options]
 */
export function deleteThumbnailVaultEntries(deletedIds = [], imageReels = [], options = {}) {
  const {
    backendReachable = true,
    pendingFileKeys = new Set(),
    storageKey = THUMBNAIL_KEY,
    failedIds = []
  } = options;

  const deletedSet = new Set([...deletedIds, ...failedIds].map((id) => String(id || '').trim()).filter(Boolean));
  vaultForensic('VAULT_DELETE_START', {
    vaultType: 'thumbnail',
    assetId: [...deletedSet].join(',') || null,
    fileName: null,
    storageLocation: storageKey,
    backendEndpoint: null,
    result: 'delete_start',
    count: deletedSet.size
  });
  const before = readThumbnailVault(storageKey);

  const afterTombstone = before.filter((entry) => {
    if (!entry) return false;
    if (typeof entry === 'string') return true;
    const id = String(entry?.id || '').trim();
    return !id || !deletedSet.has(id);
  });

  writeThumbnailVault(afterTombstone, storageKey);
  removePersonalThumbnailReelIds([...deletedSet]);

  const reconcile = reconcileThumbnailVault(imageReels, {
    backendReachable,
    pendingFileKeys,
    storageKey,
    purgeGhostCanonical: backendReachable
  });

  vaultForensic('VAULT_DELETE_SUCCESS', {
    vaultType: 'thumbnail',
    assetId: [...deletedSet].join(',') || null,
    fileName: null,
    storageLocation: storageKey,
    backendEndpoint: null,
    result: 'delete_local_reconcile',
    after: reconcile.entries.length
  });

  return {
    before: before.length,
    afterTombstone: afterTombstone.length,
    after: reconcile.entries.length,
    purged: reconcile.purged,
    deletedIds: [...deletedSet]
  };
}

/**
 * @param {unknown} entry
 * @param {string} [storageKey]
 */
export function appendThumbnailVaultEntry(entry, storageKey = THUMBNAIL_KEY) {
  const stored = readThumbnailVault(storageKey);
  const id = String(entry?.id || '').trim();
  const fileKey = thumbnailEntryFileKey(entry);
  const url = String(entry?.url || '');

  const filtered = stored.filter((t) => {
    if (!t || typeof t !== 'object') return true;
    if (id && String(t.id || '').trim() === id) return false;
    if (fileKey && thumbnailEntryFileKey(t) === fileKey) return false;
    if (url.startsWith('data:') && String(t.url || '') === url) return false;
    return true;
  });

  const state = url.startsWith('blob:') || url.startsWith('data:')
    ? THUMBNAIL_STATES.UPLOAD_PENDING
    : id
      ? THUMBNAIL_STATES.CANONICAL
      : THUMBNAIL_STATES.INGESTING;

  const next = { ...entry, vaultState: state };
  if (state === THUMBNAIL_STATES.CANONICAL) delete next.orphaned;

  filtered.push(next);
  writeThumbnailVault(filtered, storageKey);
  if (id) addPersonalThumbnailReelId(id);
  assertThumbnailVaultInvariants(filtered, [], { backendReachable: false, label: 'append' });
  return filtered;
}

/**
 * Remove by canonical reel.id.
 * @param {string} reelId
 * @param {string} [storageKey]
 */
export function removeThumbnailVaultById(reelId, storageKey = THUMBNAIL_KEY) {
  const id = String(reelId || '').trim();
  if (!id) return readThumbnailVault(storageKey);
  const stored = readThumbnailVault(storageKey);
  const updated = stored.filter((t) => {
    if (!t || typeof t !== 'object') return true;
    return String(t.id || '').trim() !== id;
  });
  writeThumbnailVault(updated, storageKey);
  removePersonalThumbnailReelIds([id]);
  return updated;
}

/**
 * Remove by collection display key (legacy fileName fallback).
 * @param {string} fileKey
 * @param {string} [storageKey]
 */
export function removeThumbnailVaultByIndex(fileKey, storageKey = THUMBNAIL_KEY) {
  const stored = readThumbnailVault(storageKey);
  const key = String(fileKey || '').trim();
  const updated = stored.filter((t) => {
    if (!t) return false;
    if (typeof t === 'string') return String(t).trim() !== key;
    const fn = String(t.fileName || t.file_name || '').trim();
    const urlBase = String(t.url || '').split('/').pop()?.split('?')[0] || '';
    const name = String(t.name || '').trim();
    return fn !== key && urlBase !== key && name !== key;
  });
  writeThumbnailVault(updated, storageKey);
  return updated;
}

export {
  THUMBNAIL_KEY,
  INDEX_MIRROR_KEY,
  PERSONAL_THUMB_IDS_KEY,
  readPersonalThumbnailReelIds,
  writePersonalThumbnailReelIds
};
