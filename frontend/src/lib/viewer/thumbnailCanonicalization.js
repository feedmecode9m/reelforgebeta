import { toRelativeMediaPath } from '../config.js';
import { filenameFromMediaRef } from '../vaultMedia.js';
import { isImageReel } from '../api/reelContract.js';

/** @param {unknown} reel */
export function isThumbnailImageReel(reel) {
  return isImageReel(reel) && String(reel?.url || '').includes('/thumbs/');
}

/** @param {unknown} entry */
function normalizeThumbnailEntry(entry) {
  if (typeof entry === 'string') {
    const fileName = filenameFromMediaRef(entry) || String(entry).trim();
    if (!fileName) return null;
    return {
      fileName,
      url: `/thumbs/${fileName.replace(/^thumbs\//, '')}`,
      name: fileName,
      origin: 'legacy_string'
    };
  }
  if (!entry || typeof entry !== 'object') return null;
  const fileName =
    String(entry.fileName || entry.file_name || '').trim() ||
    filenameFromMediaRef(entry.url || entry.thumbnailUrl);
  const url = entry.url
    ? toRelativeMediaPath(String(entry.url))
    : fileName
      ? `/thumbs/${fileName.replace(/^thumbs\//, '')}`
      : '';
  return {
    ...entry,
    fileName: fileName || undefined,
    url: url || entry.url,
    origin: entry.origin || 'metadata_object'
  };
}

/** @param {Record<string, unknown>} entry */
export function thumbnailEntryFileKey(entry) {
  return (
    String(entry?.fileName || entry?.file_name || '').trim() ||
    filenameFromMediaRef(entry?.url) ||
    ''
  );
}

/** @param {Record<string, unknown>} entry */
function thumbnailEntryUrl(entry) {
  const url = entry?.url ? toRelativeMediaPath(String(entry.url)) : '';
  if (url) return url;
  const fileName = thumbnailEntryFileKey(entry);
  return fileName ? `/thumbs/${fileName.replace(/^thumbs\//, '')}` : '';
}

/** @param {Record<string, unknown>} reel */
function reelFileKey(reel) {
  return (
    String(reel.fileName || reel.file_name || '').trim() ||
    filenameFromMediaRef(reel.url || reel.thumbnailUrl || reel.thumbnail_url)
  );
}

/** @param {Record<string, unknown>} reel */
function reelCanonicalUrl(reel) {
  return toRelativeMediaPath(String(reel.url || reel.thumbnailUrl || reel.thumbnail_url || ''));
}

/**
 * Resolve a unique backend image reel for an id-less vault entry.
 * Order: fileName → url (never display name).
 * @param {Record<string, unknown>} entry
 * @param {Record<string, unknown>[]} imageReels
 */
export function resolveUniqueThumbnailReel(entry, imageReels) {
  const fileName = thumbnailEntryFileKey(entry);
  const url = thumbnailEntryUrl(entry);
  const reels = (imageReels || []).filter((r) => String(r?.id || '').trim());

  if (fileName) {
    const byFileName = reels.filter((reel) => reelFileKey(reel) === fileName);
    if (byFileName.length === 1) {
      return { reel: byFileName[0], matchBy: 'fileName', matchCount: 1 };
    }
    if (byFileName.length > 1) {
      return { ambiguous: true, matchBy: 'fileName', matchCount: byFileName.length };
    }
  }

  if (url) {
    const byUrl = reels.filter((reel) => {
      const reelUrl = reelCanonicalUrl(reel);
      return reelUrl === url || (fileName && reelUrl.endsWith(`/${fileName}`));
    });
    if (byUrl.length === 1) {
      return { reel: byUrl[0], matchBy: 'url', matchCount: 1 };
    }
    if (byUrl.length > 1) {
      return { ambiguous: true, matchBy: 'url', matchCount: byUrl.length };
    }
  }

  return { noMatch: true, matchCount: 0 };
}

/**
 * Classify id-less / orphan thumbnail vault entries.
 * A recoverable — unique backend match exists
 * B stale — no backend match, safe to purge after successful delete
 * C active_upload — pending/blob entry, preserve
 * @param {unknown} entry
 * @param {Record<string, unknown>[]} imageReels
 * @param {{ pendingFileKeys?: Set<string> }} [options]
 */
export function classifyThumbnailEntry(entry, imageReels, options = {}) {
  const normalized = normalizeThumbnailEntry(entry);
  if (!normalized) return { class: 'stale', reason: 'invalid_entry' };

  const id = String(normalized.id || '').trim();
  if (id) {
    if (options.backendReachable) {
      const backendIds = new Set(
        (imageReels || [])
          .filter(isThumbnailImageReel)
          .map((r) => String(r?.id || '').trim())
          .filter(Boolean)
      );
      const url = String(normalized.url || '');
      if (!url.startsWith('blob:') && !url.startsWith('data:') && !backendIds.has(id)) {
        return { class: 'stale', reason: 'ghost_canonical_404' };
      }
    }
    return { class: 'canonical', reason: 'has_id' };
  }

  const fileKey = thumbnailEntryFileKey(normalized);
  const pendingKeys = options.pendingFileKeys || new Set();
  if (fileKey && pendingKeys.has(fileKey)) {
    return { class: 'active_upload', reason: 'pending_thumbnail' };
  }

  const url = String(normalized.url || '');
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    return { class: 'active_upload', reason: 'transient_url' };
  }

  const resolution = resolveUniqueThumbnailReel(normalized, imageReels);
  if (resolution.reel) {
    return { class: 'recoverable', reason: 'unique_backend_match' };
  }

  if (normalized.orphaned || normalized.vaultState === 'ORPHANED') {
    return { class: 'orphaned', reason: 'orphaned' };
  }

  return {
    class: 'stale',
    reason: resolution.ambiguous ? `ambiguous_${resolution.matchBy}` : 'no_backend_match'
  };
}

/**
 * Remove stale orphan entries only (class B). Preserves canonical, recoverable, active upload.
 * @param {unknown[]} entries
 * @param {Record<string, unknown>[]} imageReels
 * @param {{ pendingFileKeys?: Set<string> }} [options]
 */
export function filterStaleOrphanEntries(entries, imageReels, options = {}) {
  const kept = [];
  const purged = [];

  for (const raw of Array.isArray(entries) ? entries : []) {
    const normalized = normalizeThumbnailEntry(raw);
    const classification = classifyThumbnailEntry(raw, imageReels, options);
    if (classification.class === 'orphaned') {
      kept.push(raw);
      continue;
    }
    if (classification.class === 'stale') {
      purged.push({
        fileKey: thumbnailEntryFileKey(normalized || {}),
        reason: classification.reason,
        orphaned: Boolean(normalized?.orphaned)
      });
      continue;
    }
    kept.push(raw);
  }

  return { entries: kept, purged };
}

/**
 * Upgrade id-less thumbnail entries from backend reels; mark orphans.
 * @param {unknown[]} entries
 * @param {Record<string, unknown>[]} imageReels
 */
export function canonicalizeThumbnailEntries(entries, imageReels) {
  const output = [];
  const orphans = [];
  const upgraded = [];
  let changed = false;

  for (const raw of Array.isArray(entries) ? entries : []) {
    const entry = normalizeThumbnailEntry(raw);
    if (!entry) continue;

    const fileKey = thumbnailEntryFileKey(entry);
    const existingId = String(entry.id || '').trim();

    if (entry.orphaned && !existingId) {
      output.push({ ...entry, orphaned: true });
      orphans.push({ fileKey, reason: 'orphaned', matchCount: 0, origin: entry.origin });
      console.info('[THUMB_CANONICALIZE]', {
        action: 'orphaned',
        reason: 'preserved_orphan',
        fileKey,
        origin: entry.origin
      });
      continue;
    }

    if (existingId) {
      const clean = { ...entry };
      delete clean.orphaned;
      output.push(clean);
      continue;
    }

    const activeUpload = classifyThumbnailEntry(entry, imageReels);
    if (activeUpload.class === 'active_upload') {
      const clean = { ...entry };
      delete clean.orphaned;
      output.push(clean);
      continue;
    }

    const resolution = resolveUniqueThumbnailReel(entry, imageReels);
    if (resolution.reel) {
      const id = String(resolution.reel.id).trim();
      const next = {
        ...entry,
        id,
        fileName: thumbnailEntryFileKey(entry) || reelFileKey(resolution.reel),
        url: thumbnailEntryUrl(entry) || reelCanonicalUrl(resolution.reel)
      };
      delete next.orphaned;
      output.push(next);
      upgraded.push({ fileKey, id, matchBy: resolution.matchBy, origin: entry.origin });
      changed = true;
      console.info('[THUMB_CANONICALIZE]', {
        action: 'upgraded',
        fileKey,
        id,
        matchBy: resolution.matchBy,
        origin: entry.origin
      });
      continue;
    }

    const reason = resolution.ambiguous
      ? `ambiguous_${resolution.matchBy}`
      : 'no_reel_match';
    output.push({ ...entry, orphaned: true });
    orphans.push({
      fileKey,
      reason,
      matchCount: resolution.matchCount ?? 0,
      origin: entry.origin
    });
    changed = changed || !entry.orphaned;
    console.info('[THUMB_CANONICALIZE]', {
      action: 'orphaned',
      fileKey,
      reason,
      matchCount: resolution.matchCount ?? 0,
      origin: entry.origin
    });
  }

  return { entries: output, orphans, upgraded, changed };
}
