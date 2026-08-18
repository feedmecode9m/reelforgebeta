/**
 * Phase 22 — merge-on-write for reel_titles_persistent title-only mutations.
 *
 * reel_titles_persistent[id] is one durable metadata record.
 * Title-only saves must preserve description/tags/category/creatorCategory
 * and any other existing keys (including authored-empty clear sentinels).
 *
 * Node-safe pure helper — no Vite/config imports.
 */

/**
 * @param {Record<string, unknown> | null | undefined} prior
 * @param {{ title?: string; title_original?: string; savedAt?: string | number }} titlePatch
 * @returns {Record<string, unknown>}
 */
export function mergePersistentTitleEntry(prior, titlePatch = {}) {
    const base = prior && typeof prior === 'object' && !Array.isArray(prior) ? { ...prior } : {};
    const title = titlePatch.title != null ? String(titlePatch.title) : String(base.title || '');
    const titleOriginal =
        titlePatch.title_original != null
            ? String(titlePatch.title_original)
            : title || String(base.title_original || base.title || '');
    const savedAt =
        titlePatch.savedAt != null ? titlePatch.savedAt : new Date().toISOString();
    return {
        ...base,
        title,
        title_original: titleOriginal,
        savedAt
    };
}

/**
 * Apply a title-only patch onto a full titles map (immutable).
 *
 * @param {Record<string, Record<string, unknown>> | null | undefined} map
 * @param {string} reelId
 * @param {{ title?: string; title_original?: string; savedAt?: string | number }} titlePatch
 * @returns {Record<string, Record<string, unknown>>}
 */
export function mergeTitleIntoPersistentMap(map, reelId, titlePatch = {}) {
    const id = String(reelId || '').trim();
    const next = map && typeof map === 'object' && !Array.isArray(map) ? { ...map } : {};
    if (!id || !String(titlePatch?.title || '').trim()) return next;
    const prior = next[id] && typeof next[id] === 'object' ? next[id] : {};
    next[id] = mergePersistentTitleEntry(prior, titlePatch);
    return next;
}

/**
 * Identity keys a title save must fan out to (vault id, catalog id, playback UUID).
 * @param {Record<string, unknown> | null | undefined} entry
 * @returns {string[]}
 */
export function mediaPathAssetId(value) {
    const raw =
        typeof value === 'string'
            ? value
            : value && typeof value === 'object'
              ? mediaRecordPlaybackKey(value)
              : '';
    const path = String(raw || '')
        .split('?')[0]
        .split('#')[0]
        .toLowerCase();
    const match = path.match(
        /\/(?:videos|thumbs|prod)\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.[a-z0-9]+$/i
    );
    if (match) return match[1];
    const file = path.split('/').pop() || '';
    const stem = file.replace(/\.[a-z0-9]+$/i, '');
    if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            stem
        )
    ) {
        return stem;
    }
    return '';
}

export function mediaRecordTitleKeys(entry) {
    if (!entry || typeof entry !== 'object') return [];
    const seen = new Set();
    /** @type {string[]} */
    const out = [];
    const raw = [
        entry.id,
        entry.assetId,
        entry.personal_video_id,
        entry.mediaAssetId,
        entry.reelId,
        entry.heroAssetId,
        mediaPathAssetId(entry)
    ];
    for (const value of raw) {
        const id = value == null ? '' : String(value).trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

/**
 * @param {Record<string, unknown> | null | undefined} map
 * @param {Record<string, unknown> | null | undefined} entry
 * @returns {Record<string, unknown> | null}
 */
export function lookupPersistentTitleEntry(map, entry) {
    if (!map || typeof map !== 'object') return null;
    for (const id of mediaRecordTitleKeys(entry)) {
        const rec = map[id];
        if (rec && typeof rec === 'object' && String(rec.title || rec.title_original || '').trim()) {
            return rec;
        }
    }
    return null;
}

/**
 * Normalize playback URL for title fan-out (same file, different id).
 * @param {unknown} entry
 * @returns {string}
 */
export function mediaRecordPlaybackKey(entry) {
    if (!entry || typeof entry !== 'object') return '';
    const raw = String(
        entry.url || entry.mediaUrl || entry.video_url || entry.playbackUrl || ''
    ).trim();
    if (!raw || raw.startsWith('blob:') || raw.startsWith('data:')) return '';
    let path = raw.split('?')[0].split('#')[0].toLowerCase();
    try {
        if (/^https?:\/\//.test(path)) {
            path = new URL(path).pathname || path;
        }
    } catch {
        /* keep path */
    }
    const videoIdx = path.indexOf('/videos/');
    if (videoIdx >= 0) return path.slice(videoIdx);
    const thumbIdx = path.indexOf('/thumbs/');
    if (thumbIdx >= 0) return path.slice(thumbIdx);
    return path;
}

/**
 * Stamp a creator title onto a vault/feed row when id or playback file matches.
 * @param {Record<string, unknown> | null | undefined} entry
 * @param {string} assetId
 * @param {string} title
 * @param {string} [playbackKey]
 */
export function applyTitleFieldsToRecord(entry, assetId, title, playbackKey = '') {
    if (!entry || typeof entry !== 'object') return entry;
    const want = String(assetId || '').trim();
    const keys = mediaRecordTitleKeys(entry);
    const play = mediaRecordPlaybackKey(entry);
    const idHit = Boolean(want) && keys.includes(want);
    const urlHit = Boolean(playbackKey) && play === playbackKey;
    if (!idHit && !urlHit) return entry;
    return {
        ...entry,
        title,
        name: title,
        title_original: title,
        _localModified: true
    };
}
