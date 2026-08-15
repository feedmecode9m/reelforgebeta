/**
 * Phase 6.6.2 — Canonical media identity contract (audit + detection).
 *
 * One real piece of content = one canonical media identity.
 * Titles / posters / shelves / semantic cards are projections — never identity keys.
 *
 * Pure Node-safe helpers. Does not mutate catalog, categories, or production.
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * Normalize media URLs so localhost absolute and relative forms collide.
 * @param {unknown} url
 * @returns {string}
 */
export function normalizeMediaUrl(url) {
    const raw = text(url).split('?')[0].split('#')[0];
    if (!raw) return '';
    if (/^(blob:|data:)/i.test(raw)) return raw;
    try {
        if (/^https?:\/\//i.test(raw)) {
            const u = new URL(raw);
            return text(u.pathname);
        }
    } catch {
        /* fall through */
    }
    if (raw.startsWith('/')) return raw;
    if (/\.(mp4|m4v|mov|webm|mkv|jpe?g|png|webp|gif|avif)$/i.test(raw)) {
        if (/\.(jpe?g|png|webp|gif|avif)$/i.test(raw)) return `/thumbs/${raw.replace(/^\/+/, '')}`;
        return `/videos/${raw.replace(/^\/+/, '')}`;
    }
    return raw;
}

/**
 * Basename stem for filename-hash identity (never used as title authority).
 * @param {unknown} value
 * @returns {string}
 */
export function mediaFilenameHashKey(value) {
    const base = text(value).split(/[\\/]/).pop() || text(value);
    return base
        .replace(/\.(mp4|mov|webm|m4v|avi|mkv|jpe?g|png|webp|gif|avif)$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .trim();
}

/**
 * Resolve canonical identity fields for one media-like row.
 *
 * Priority:
 * 1. assetId / id
 * 2. personal_video_id
 * 3. normalized media URL
 * 4. filename hash
 * 5. explicit placeholderId
 *
 * Never uses title as identity.
 *
 * @param {Record<string, unknown> | null | undefined} reel
 * @param {{ source?: string; shelf?: string }} [meta]
 * @returns {{
 *   canonicalId: string;
 *   assetId: string;
 *   personalVideoId: string;
 *   mediaType: string;
 *   mediaUrl: string;
 *   normalizedMediaUrl: string;
 *   posterUrl: string;
 *   title: string;
 *   titleSource: string;
 *   shelfEligibility: string;
 *   placeholderId: string;
 *   isPlaceholder: boolean;
 *   isPresentationOnly: boolean;
 *   source: string;
 *   shelf: string;
 *   identityVia: string;
 * }}
 */
export function resolveCanonicalMediaIdentity(reel = {}, meta = {}) {
    const row = reel && typeof reel === 'object' ? reel : {};
    const assetId = text(row.id || row.assetId || row.mediaAssetId || row.reelId);
    const personalVideoId = text(row.personal_video_id || row.personalVideoId);
    const placeholderId = text(row.placeholderId || (row.isPlaceholder ? row.id : ''));
    const mediaUrl = text(row.url || row.mediaUrl || row.video_url || row.playbackUrl);
    const normalizedMediaUrl = normalizeMediaUrl(mediaUrl);
    const fileKey = mediaFilenameHashKey(
        row.fileName || row.file_name || row.filename || row.originalFilename || row.name || mediaUrl
    );
    const posterUrl = text(row.posterUrl || row.thumbnailUrl || row.thumbnail_url || row.thumbnail);

    let identityVia = '';
    let canonicalId = '';
    if (assetId) {
        canonicalId = assetId;
        identityVia = 'assetId';
    } else if (personalVideoId) {
        canonicalId = personalVideoId;
        identityVia = 'personal_video_id';
    } else if (normalizedMediaUrl && !normalizedMediaUrl.startsWith('blob:')) {
        canonicalId = `url:${normalizedMediaUrl}`;
        identityVia = 'normalizedMediaUrl';
    } else if (fileKey) {
        canonicalId = `file:${fileKey}`;
        identityVia = 'filenameHash';
    } else if (placeholderId) {
        canonicalId = `ph:${placeholderId}`;
        identityVia = 'placeholderId';
    }

    const title = text(row.title || row.name || row.displayTitle);
    let titleSource = 'none';
    if (row._localModified && title) titleSource = 'persistent_or_local_edit';
    else if (text(row.persistentTitle) || text(row.creatorTitle)) titleSource = 'creator_persistent';
    else if (title) titleSource = 'row_title_or_name';

    const isPlaceholder = Boolean(row.isPlaceholder || row.isBlackStoriesPlaceholder);
    const isPresentationOnly = Boolean(row.isPresentationOnly || row.layoutOnly);

    return {
        canonicalId,
        assetId,
        personalVideoId,
        mediaType: text(row.type || row.mediaType || row.media_type || (mediaUrl ? 'unknown' : '')),
        mediaUrl,
        normalizedMediaUrl,
        posterUrl,
        title,
        titleSource,
        shelfEligibility: text(row.category || meta.shelf || ''),
        placeholderId,
        isPlaceholder,
        isPresentationOnly,
        source: text(meta.source) || 'unknown',
        shelf: text(meta.shelf),
        identityVia
    };
}

/**
 * @param {Record<string, unknown> | null | undefined} a
 * @param {Record<string, unknown> | null | undefined} b
 * @returns {boolean}
 */
export function sameCanonicalMediaIdentity(a, b) {
    const left = resolveCanonicalMediaIdentity(a);
    const right = resolveCanonicalMediaIdentity(b);
    if (left.canonicalId && right.canonicalId && left.canonicalId === right.canonicalId) return true;
    if (left.assetId && right.assetId && left.assetId === right.assetId) return true;
    if (
        left.personalVideoId &&
        right.personalVideoId &&
        left.personalVideoId === right.personalVideoId
    ) {
        return true;
    }
    if (
        left.normalizedMediaUrl &&
        right.normalizedMediaUrl &&
        left.normalizedMediaUrl === right.normalizedMediaUrl &&
        !left.normalizedMediaUrl.startsWith('blob:')
    ) {
        return true;
    }
    return false;
}

/**
 * Detect duplicate identity clusters inside a feed map (same shelf or cross-shelf).
 *
 * @param {Record<string, unknown[]> | null | undefined} feedMap
 * @param {{ sourceHint?: string }} [options]
 * @returns {{
 *   duplicates: Array<{
 *     tag: 'DUPLICATE_IDENTITY_FOUND';
 *     canonicalId: string;
 *     assetId: string;
 *     records: number;
 *     shelves: string[];
 *     titles: string[];
 *     sources: string[];
 *     sameShelfDuplicate: boolean;
 *     titleDivergence: boolean;
 *     rows: Array<ReturnType<typeof resolveCanonicalMediaIdentity>>;
 *   }>;
 *   identities: Array<ReturnType<typeof resolveCanonicalMediaIdentity>>;
 *   uniqueCanonicalCount: number;
 *   realRowCount: number;
 * }}
 */
export function detectDuplicateIdentities(feedMap, options = {}) {
    const sourceHint = text(options.sourceHint) || 'feed';
    /** @type {Array<ReturnType<typeof resolveCanonicalMediaIdentity> & { _ref: Record<string, unknown> }>} */
    const identities = [];
    const map = feedMap && typeof feedMap === 'object' ? feedMap : {};

    for (const [shelf, items] of Object.entries(map)) {
        if (shelf === 'Auto-Detect' || shelf === 'HERO') continue;
        for (const reel of items || []) {
            if (!reel || typeof reel !== 'object') continue;
            if (reel.isPresentationOnly || reel.layoutOnly) continue;
            const resolved = resolveCanonicalMediaIdentity(/** @type {Record<string, unknown>} */ (reel), {
                shelf,
                source: text(reel.__identitySource) || sourceHint
            });
            if (!resolved.canonicalId) continue;
            identities.push({ ...resolved, _ref: /** @type {Record<string, unknown>} */ (reel) });
        }
    }

    /** @type {Map<string, typeof identities>} */
    const clusters = new Map();
    for (const row of identities) {
        if (!clusters.has(row.canonicalId)) clusters.set(row.canonicalId, []);
        clusters.get(row.canonicalId).push(row);
    }

    /** @type {Array<Record<string, unknown>>} */
    const duplicates = [];
    for (const [canonicalId, rows] of clusters.entries()) {
        if (rows.length < 2) continue;
        const shelves = [...new Set(rows.map((r) => r.shelf).filter(Boolean))];
        const titles = [...new Set(rows.map((r) => r.title).filter(Boolean))];
        const sources = [...new Set(rows.map((r) => r.source).filter(Boolean))];
        const sameShelfDuplicate = rows.some(
            (r, i) => rows.findIndex((x) => x.shelf === r.shelf) !== i
        );
        duplicates.push({
            tag: 'DUPLICATE_IDENTITY_FOUND',
            canonicalId,
            assetId: rows[0].assetId || '',
            records: rows.length,
            shelves,
            titles,
            sources,
            sameShelfDuplicate,
            titleDivergence: titles.length > 1,
            rows: rows.map(({ _ref, ...rest }) => rest)
        });
    }

    return {
        duplicates,
        identities: identities.map(({ _ref, ...rest }) => rest),
        uniqueCanonicalCount: clusters.size,
        realRowCount: identities.length
    };
}

/**
 * Collapse same-shelf duplicate rows to one canonical projection (pure).
 * Prefer edited / persistent title, then non-empty poster, then first row.
 *
 * @param {Record<string, unknown[]> | null | undefined} feedMap
 * @returns {{ feedMap: Record<string, unknown[]>; removed: number; report: ReturnType<typeof detectDuplicateIdentities> }}
 */
export function collapseSameShelfDuplicateIdentities(feedMap) {
    const report = detectDuplicateIdentities(feedMap, { sourceHint: 'collapse' });
    const map = feedMap && typeof feedMap === 'object' ? feedMap : {};
    /** @type {Record<string, unknown[]>} */
    const out = {};
    let removed = 0;

    for (const [shelf, items] of Object.entries(map)) {
        const list = Array.isArray(items) ? items : [];
        /** @type {unknown[]} */
        const next = [];
        /** @type {Map<string, number>} */
        const indexByCanonical = new Map();

        for (const reel of list) {
            if (!reel || typeof reel !== 'object') {
                next.push(reel);
                continue;
            }
            if (reel.isPresentationOnly || reel.layoutOnly) {
                next.push(reel);
                continue;
            }
            const id = resolveCanonicalMediaIdentity(/** @type {Record<string, unknown>} */ (reel), {
                shelf
            }).canonicalId;
            if (!id) {
                next.push(reel);
                continue;
            }
            if (!indexByCanonical.has(id)) {
                indexByCanonical.set(id, next.length);
                next.push(reel);
                continue;
            }
            const idx = indexByCanonical.get(id);
            const prev = /** @type {Record<string, unknown>} */ (next[idx]);
            const merged = preferCanonicalProjection(prev, /** @type {Record<string, unknown>} */ (reel));
            next[idx] = merged;
            removed += 1;
        }
        out[shelf] = next;
    }

    return { feedMap: out, removed, report };
}

/**
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 */
function preferCanonicalProjection(a, b) {
    const aEdited = Boolean(a._localModified) || Boolean(text(a.persistentTitle));
    const bEdited = Boolean(b._localModified) || Boolean(text(b.persistentTitle));
    const aTitle = text(a.title || a.name);
    const bTitle = text(b.title || b.name);
    let winner = a;
    let donor = b;
    if (bEdited && !aEdited) {
        winner = b;
        donor = a;
    } else if (aEdited === bEdited && bTitle && !aTitle) {
        winner = b;
        donor = a;
    }
    return {
        ...donor,
        ...winner,
        title: text(winner.title || winner.name) || text(donor.title || donor.name),
        name: text(winner.name || winner.title) || text(donor.name || donor.title),
        title_original: text(winner.title_original) || text(donor.title_original),
        thumbnailUrl: text(winner.thumbnailUrl || winner.posterUrl) || text(donor.thumbnailUrl || donor.posterUrl),
        posterUrl: text(winner.posterUrl) || text(donor.posterUrl),
        url: text(winner.url) || text(donor.url),
        personal_video_id: text(winner.personal_video_id) || text(donor.personal_video_id),
        _localModified: Boolean(winner._localModified || donor._localModified)
    };
}

/**
 * Match probe using only assetId → personal_video_id → normalizedMediaUrl.
 * Never title / filename / description.
 *
 * @param {Record<string, unknown> | null | undefined} existing
 * @param {Record<string, unknown> | null | undefined} probe
 * @returns {boolean}
 */
export function matchCanonicalFeedIdentity(existing, probe) {
    const left = existing && typeof existing === 'object' ? existing : {};
    const right = probe && typeof probe === 'object' ? probe : {};

    const leftAsset = text(left.id || left.assetId || left.mediaAssetId || left.reelId);
    const rightAsset = text(right.id || right.assetId || right.mediaAssetId || right.reelId);
    if (leftAsset && rightAsset && leftAsset === rightAsset) return true;

    const leftPersonal = text(left.personal_video_id || left.personalVideoId);
    const rightPersonal = text(right.personal_video_id || right.personalVideoId);
    if (leftPersonal && rightPersonal && leftPersonal === rightPersonal) return true;
    if (leftAsset && rightPersonal && leftAsset === rightPersonal) return true;
    if (leftPersonal && rightAsset && leftPersonal === rightAsset) return true;

    const leftUrl = normalizeMediaUrl(left.url || left.mediaUrl || left.video_url || left.playbackUrl);
    const rightUrl = normalizeMediaUrl(right.url || right.mediaUrl || right.video_url || right.playbackUrl);
    if (
        leftUrl &&
        rightUrl &&
        leftUrl === rightUrl &&
        !leftUrl.startsWith('blob:') &&
        !leftUrl.startsWith('data:')
    ) {
        return true;
    }
    return false;
}

/**
 * Locate first feed row matching vault/catalog probe.
 *
 * @param {Record<string, unknown[]> | null | undefined} feedMap
 * @param {Record<string, unknown>} probe
 * @returns {{ shelf: string; index: number; reel: Record<string, unknown> } | null}
 */
export function findCanonicalFeedMatch(feedMap, probe) {
    const map = feedMap && typeof feedMap === 'object' ? feedMap : {};
    for (const [shelf, items] of Object.entries(map)) {
        if (shelf === 'Auto-Detect' || shelf === 'HERO') continue;
        const list = Array.isArray(items) ? items : [];
        for (let i = 0; i < list.length; i += 1) {
            const reel = list[i];
            if (!reel || typeof reel !== 'object') continue;
            if (reel.isPresentationOnly || reel.layoutOnly) continue;
            if (matchCanonicalFeedIdentity(/** @type {Record<string, unknown>} */ (reel), probe)) {
                return {
                    shelf,
                    index: i,
                    reel: /** @type {Record<string, unknown>} */ (reel)
                };
            }
        }
    }
    return null;
}

const UNSAFE_TITLE =
    /(\.(mp4|mov|webm|m4v|avi|mkv|jpe?g|png|gif|webp|avif)\b)|(^img[_\s-]?\d{2,}$)|(^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$)/i;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isWeakFilenameTitle(value) {
    const raw = text(value);
    if (!raw) return true;
    if (UNSAFE_TITLE.test(raw)) return true;
    if (UNSAFE_TITLE.test(raw.replace(/\.[^.]+$/, ''))) return true;
    return false;
}

/**
 * Title priority for vault→feed upsert:
 * creator edited → persistent map → existing/catalog title → filename fallback.
 * Never overwrite a custom title with filename / UUID / camera names.
 *
 * @param {{
 *   existing?: Record<string, unknown> | null;
 *   persistent?: { title?: string; title_original?: string } | null;
 *   catalogTitle?: string;
 *   filenameFallback?: string;
 * }} options
 * @returns {{ title: string; title_original: string; protected: boolean; source: string }}
 */
export function resolveProtectedFeedTitle(options = {}) {
    const existing = options.existing && typeof options.existing === 'object' ? options.existing : {};
    const persistent = options.persistent && typeof options.persistent === 'object' ? options.persistent : {};

    const edited =
        text(existing._localModified ? existing.title || existing.name : '') ||
        text(existing.editedTitle) ||
        text(existing.creatorTitle) ||
        text(existing.persistentTitle);
    const fromMap = text(persistent.title);
    const existingTitle = text(existing.title || existing.name);
    const catalog = text(options.catalogTitle);
    const fallback = text(options.filenameFallback);

    if (edited && !isWeakFilenameTitle(edited)) {
        return {
            title: edited,
            title_original: text(existing.title_original) || edited,
            protected: true,
            source: 'creator_edited'
        };
    }
    if (fromMap && !isWeakFilenameTitle(fromMap)) {
        return {
            title: fromMap,
            title_original: text(persistent.title_original) || fromMap,
            protected: true,
            source: 'persistent_map'
        };
    }
    if (existingTitle && !isWeakFilenameTitle(existingTitle)) {
        return {
            title: existingTitle,
            title_original: text(existing.title_original) || existingTitle,
            protected: Boolean(existing._localModified),
            source: 'existing_catalog'
        };
    }
    if (catalog && !isWeakFilenameTitle(catalog)) {
        return {
            title: catalog,
            title_original: catalog,
            protected: false,
            source: 'catalog_title'
        };
    }
    if (fallback) {
        return {
            title: fallback,
            title_original: fallback,
            protected: false,
            source: 'filename_fallback'
        };
    }
    return { title: '', title_original: '', protected: false, source: 'none' };
}

/**
 * Remove every feed row that matches probe identity (all shelves).
 *
 * @param {Record<string, unknown[]>} feedMap
 * @param {Record<string, unknown>} probe
 * @returns {{ feedMap: Record<string, unknown[]>; removed: number }}
 */
export function removeCanonicalFeedMatches(feedMap, probe) {
    /** @type {Record<string, unknown[]>} */
    const out = {};
    let removed = 0;
    for (const [shelf, items] of Object.entries(feedMap || {})) {
        const list = Array.isArray(items) ? items : [];
        const next = list.filter((reel) => {
            if (!reel || typeof reel !== 'object') return true;
            if (reel.isPresentationOnly || reel.layoutOnly) return true;
            const hit = matchCanonicalFeedIdentity(/** @type {Record<string, unknown>} */ (reel), probe);
            if (hit) removed += 1;
            return !hit;
        });
        out[shelf] = next;
    }
    return { feedMap: out, removed };
}
