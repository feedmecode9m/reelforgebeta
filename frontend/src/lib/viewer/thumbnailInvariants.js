/**
 * Runtime thumbnail vault invariants (Mission 5.8).
 */
import { classifyThumbnailEntry, thumbnailEntryFileKey } from './thumbnailCanonicalization.js';

const CANONICAL = 'CANONICAL';
const ORPHANED = 'ORPHANED';

const ENABLED =
  typeof import.meta !== 'undefined' &&
  (import.meta.env?.DEV === true || import.meta.env?.VITE_THUMBNAIL_INVARIANTS === 'true');

/** @param {string} name @param {string} message @param {Record<string, unknown>} [detail] */
function assert(name, message, detail = {}) {
  if (!ENABLED) return;
  console.error('[THUMBNAIL_INVARIANT_VIOLATION]', { name, message, ...detail });
  if (import.meta.env?.VITE_THUMBNAIL_INVARIANT_STRICT === 'true') {
    throw new Error(`[${name}] ${message}`);
  }
}

/**
 * @param {unknown[]} entries
 * @param {Record<string, unknown>[]} imageReels
 * @param {{ backendReachable?: boolean; label?: string }} [ctx]
 */
export function assertThumbnailVaultInvariants(entries, imageReels = [], ctx = {}) {
  if (!ENABLED || typeof window === 'undefined') return;

  const list = Array.isArray(entries) ? entries : [];
  const backendReachable = Boolean(ctx.backendReachable);
  const backendIds = new Set(
    (imageReels || []).map((r) => String(r?.id || '').trim()).filter(Boolean)
  );

  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (!entry || typeof entry !== 'object') continue;

    const id = String(entry.id || '').trim();
    const url = String(entry.url || '');
    const state = entry.vaultState;
    const fileKey = thumbnailEntryFileKey(entry);

    if (!state) {
      assert('HAS_STATE', 'Every thumbnail must have vaultState', { fileKey, index: i });
      continue;
    }

    if (entry.orphaned && id) {
      assert('ORPHAN_NO_ID', 'Orphan entry must not have synthetic id', { fileKey, index: i });
    }

    if (state === CANONICAL) {
      assert('CANONICAL_HAS_ID', 'Canonical thumbnail must have id', { fileKey, index: i });
      if (backendReachable && id && backendIds.size >= 0 && !backendIds.has(id)) {
        if (!url.startsWith('blob:') && !url.startsWith('data:')) {
          assert('NO_GHOST_CANONICAL', '404 reel may not remain canonical when backend reachable', {
            id,
            fileKey,
            index: i
          });
        }
      }
    }

    if (url.startsWith('blob:') || url.startsWith('data:')) {
      assert('TRANSIENT_NOT_ORPHAN', 'Active upload must not be orphaned', {
        fileKey,
        orphaned: entry.orphaned,
        index: i
      });
    }

    const classification = classifyThumbnailEntry(entry, imageReels);
    if (classification.class === 'stale' && state === CANONICAL) {
      assert('NO_STALE_CANONICAL', 'Stale entry cannot be canonical state', { fileKey, index: i });
    }
  }

  if (backendReachable && backendIds.size === 0 && list.length > 0) {
    const nonUpload = list.filter((e) => {
      const u = String(e?.url || '');
      return !u.startsWith('blob:') && !u.startsWith('data:');
    });
    if (nonUpload.some((e) => String(e?.id || '').trim())) {
      assert(
        'BACKEND_EMPTY_CANONICAL',
        'Backend empty implies no ghost canonical entries',
        { count: nonUpload.length, label: ctx.label }
      );
    }
  }

  const keys = list.map((e) => thumbnailEntryFileKey(e)).filter(Boolean);
  const dup = keys.filter((k, idx) => keys.indexOf(k) !== idx);
  if (dup.length) {
    assert('NO_DUPLICATE_KEYS', 'Duplicate fileKeys in vault', { duplicates: [...new Set(dup)] });
  }
}

/**
 * @param {number} before
 * @param {number} after
 * @param {number} deletedCount
 */
export function assertDeleteReducedCount(before, after, deletedCount) {
  if (!ENABLED || deletedCount <= 0) return;
  if (after >= before) {
    assert('DELETE_MUST_REDUCE', 'Delete success must reduce collection when ids removed', {
      before,
      after,
      deletedCount
    });
  }
}
