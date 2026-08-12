/**
 * Catalog media inventory — durable identity + progressive poster↔MP4 enrichment.
 *
 * Hard rules:
 * - Never use filename as canonical identity.
 * - Never merge unrelated assets on filename similarity.
 * - Temp keys are in-memory only (temp: prefix); never persist as SoT.
 * - Poster→MP4 and MP4→poster enrich the SAME card.
 */

import { resolveVaultCardProjection } from '../content/vaultCardProjection.js';
import { classifyContent, normalizeDiscoveryShelf } from './contentClassifier.js';

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * Reject bare filenames and ephemeral presentation ids as durable keys.
 * @param {string} raw
 * @returns {boolean}
 */
export function isDurableMediaId(raw) {
    const id = text(raw);
    if (!id) return false;
    if (id.startsWith('temp:')) return false;
    if (id.startsWith('presentation-placeholder-')) return false;
    if (id.startsWith('ai-black-stories-')) return false;
    // Bare filename (has media extension, no path separators) — never canonical.
    if (/^[^\s/\\]+\.(mp4|m4v|mov|webm|mkv|jpg|jpeg|png|webp|gif|avif)$/i.test(id)) {
        return false;
    }
    return true;
}

/**
 * Durable URL identity: same media object path, not a bare filename.
 * @param {string} rawUrl
 * @returns {string}
 */
export function normalizeDurableMediaUrl(rawUrl) {
    const url = text(rawUrl);
    if (!url) return '';
    if (url.startsWith('blob:') || url.startsWith('data:')) return '';
    try {
        if (/^https?:\/\//i.test(url)) {
            const u = new URL(url);
            const path = u.pathname.replace(/\/+$/, '') || u.pathname;
            // Path must look like a durable media path (not "/" or empty).
            if (!path || path === '/') return '';
            // Reject paths that are only a bare filename at root of host without vault-like segment.
            const segments = path.split('/').filter(Boolean);
            if (segments.length === 1 && /\.(mp4|jpg|jpeg|png|webp|gif)$/i.test(segments[0])) {
                // Single-segment file at URL root — weak; still usable if UUID-like stem.
                const stem = segments[0].replace(/\.[^.]+$/, '');
                if (!isDurableMediaId(stem) && !/^[0-9a-f-]{20,}$/i.test(stem)) return '';
            }
            return `${u.origin}${path}`.toLowerCase();
        }
    } catch {
        /* fall through */
    }
    // Relative durable path (/thumbs/uuid.jpg, /media/...)
    if (url.startsWith('/')) {
        const path = url.split('?')[0].split('#')[0].replace(/\/+$/, '');
        if (path.length < 2) return '';
        return path.toLowerCase();
    }
    return '';
}

let tempKeySeq = 0;

/**
 * Resolve canonical media id — never filename.
 * @param {Record<string, unknown> | null | undefined} item
 * @returns {{ id: string, durable: boolean }}
 */
export function resolveCanonicalMediaId(item) {
    const row = item && typeof item === 'object' ? item : {};

    const candidates = [
        row.id,
        row.reelId,
        row.reel_id,
        row.assetId,
        row.mediaAssetId,
        row.media_asset_id,
        row.personal_video_id,
        row.vaultId,
        row.vault_id,
        row.mediaId,
        row.media_id
    ];

    for (const c of candidates) {
        const id = text(c);
        if (isDurableMediaId(id)) {
            return { id, durable: true };
        }
    }

    const identity =
        row.contentIdentity && typeof row.contentIdentity === 'object'
            ? /** @type {Record<string, unknown>} */ (row.contentIdentity)
            : null;
    if (identity) {
        for (const c of [identity.reelId, identity.id, identity.assetId]) {
            const id = text(c);
            if (isDurableMediaId(id)) {
                return { id, durable: true };
            }
        }
    }

    // Durable URL only when it safely identifies the same asset.
    const urlCandidates = [
        row.url,
        row.video_url,
        row.mediaUrl,
        row.posterUrl,
        row.thumbnailUrl,
        row.thumbnail_url
    ];
    for (const u of urlCandidates) {
        const norm = normalizeDurableMediaUrl(text(u));
        if (norm) {
            return { id: `url:${norm}`, durable: true };
        }
    }

    // Explicit prior temp key (in-memory enrichment only).
    const priorTemp = text(row._catalogTempKey || row.replacesTempKey);
    if (priorTemp.startsWith('temp:')) {
        return { id: priorTemp, durable: false };
    }

    tempKeySeq += 1;
    const tempId = `temp:${Date.now().toString(36)}-${tempKeySeq}`;
    return { id: tempId, durable: false };
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isPreferredUrl(value) {
    const u = text(value);
    if (!u) return false;
    if (u.startsWith('blob:') || u.startsWith('data:')) return false;
    return /^https?:\/\//i.test(u) || u.startsWith('/');
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function preferUrl(a, b) {
    const left = text(a);
    const right = text(b);
    if (!left) return right;
    if (!right) return left;
    if (isPreferredUrl(right) && !isPreferredUrl(left)) return right;
    if (isPreferredUrl(left) && !isPreferredUrl(right)) return left;
    if (/^https?:\/\//i.test(right) && !/^https?:\/\//i.test(left)) return right;
    return left;
}

/**
 * @param {Record<string, unknown>} item
 * @returns {'video' | 'image' | 'unknown'}
 */
function detectMediaKind(item) {
    const type = text(item.type || item.mediaType || item.primaryMediaType).toLowerCase();
    if (type === 'video') return 'video';
    if (type === 'image') return 'image';
    const videoUrl = text(item.url || item.video_url || item.mediaUrl);
    if (videoUrl && /\.(mp4|m4v|mov|webm|mkv)(\?|#|$)/i.test(videoUrl)) return 'video';
    if (videoUrl && !/\.(jpg|jpeg|png|webp|gif|avif)(\?|#|$)/i.test(videoUrl)) {
        // Non-image URL with video-ish fields
        if (item.video_url || item.isPersonalVideo || item.isHeroFeedCard) return 'video';
    }
    const poster = text(item.posterUrl || item.thumbnailUrl || item.thumbnail_url || item.url);
    if (poster && /\.(jpg|jpeg|png|webp|gif|avif)(\?|#|$)/i.test(poster)) return 'image';
    if (item.isCatalogImage || item.isPersonalThumbnail) return 'image';
    return 'unknown';
}

/**
 * Progressive enrichment merge of two card records for the same durable identity.
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>} incoming
 * @returns {Record<string, unknown>}
 */
export function enrichCatalogCard(base, incoming) {
    const a = base && typeof base === 'object' ? { ...base } : {};
    const b = incoming && typeof incoming === 'object' ? incoming : {};

    const kindA = detectMediaKind(a);
    const kindB = detectMediaKind(b);

    const videoUrlA = text(a.video_url || (kindA === 'video' ? a.url || a.mediaUrl : ''));
    const videoUrlB = text(b.video_url || (kindB === 'video' ? b.url || b.mediaUrl : ''));
    const posterA = text(
        a.posterUrl || a.thumbnailUrl || a.thumbnail_url || (kindA === 'image' ? a.url : '')
    );
    const posterB = text(
        b.posterUrl || b.thumbnailUrl || b.thumbnail_url || (kindB === 'image' ? b.url : '')
    );

    const mergedVideo = preferUrl(videoUrlA, videoUrlB);
    const mergedPoster = preferUrl(posterA, posterB);

    const titleA = text(a.title || a.name);
    const titleB = text(b.title || b.name);
    const title = titleA || titleB;
    const name = text(a.name) || text(b.name) || title;

    const categoryA = text(a.category);
    const categoryB = text(b.category);
    // Preserve prior category unless incoming brings an explicit non-soft shelf.
    const soft = new Set(['Trending', 'HERO', 'Network', 'Auto-Detect', '']);
    let category = categoryA || categoryB || 'Trending';
    if (categoryA && soft.has(categoryA) && categoryB && !soft.has(categoryB)) {
        category = categoryB;
    } else if (categoryA) {
        category = categoryA;
    } else if (categoryB) {
        category = categoryB;
    }

    /** @type {Record<string, unknown>} */
    const out = {
        ...a,
        ...b,
        id: text(a.id) && isDurableMediaId(text(a.id)) ? text(a.id) : text(b.id) || text(a.id),
        title: title || text(a.title) || text(b.title),
        name: name || title,
        description: text(a.description) || text(b.description),
        category,
        seriesName: text(a.seriesName || a.seriesTitle) || text(b.seriesName || b.seriesTitle),
        episodeTitle: text(a.episodeTitle) || text(b.episodeTitle),
        tags: Array.isArray(a.tags) && a.tags.length ? a.tags : b.tags,
        ai_tags: Array.isArray(a.ai_tags) && a.ai_tags.length ? a.ai_tags : b.ai_tags
    };

    if (mergedVideo) {
        out.url = mergedVideo;
        out.video_url = mergedVideo;
        out.mediaUrl = mergedVideo;
        out.type = 'video';
        out.mediaKind = 'video';
        out.playable = true;
        out.isCatalogImage = false;
        out.isPersonalThumbnail = false;
    } else {
        const imageUrl = mergedPoster || text(out.url);
        if (imageUrl) {
            out.url = imageUrl;
            out.type = 'image';
            out.mediaKind = 'image';
        }
        out.playable = false;
    }

    if (mergedPoster) {
        out.posterUrl = mergedPoster;
        out.thumbnailUrl = preferUrl(text(out.thumbnailUrl), mergedPoster) || mergedPoster;
        out.thumbnail_url = out.thumbnailUrl;
    }

    // Clear temp key once durable id is present.
    const durableId = text(out.id);
    if (isDurableMediaId(durableId) && !durableId.startsWith('url:')) {
        delete out._catalogTempKey;
    } else if (!out._catalogTempKey && text(a._catalogTempKey)) {
        out._catalogTempKey = a._catalogTempKey;
    }

    out._enrichedFromPoster = Boolean(mergedPoster && mergedVideo && (kindA === 'image' || kindB === 'image'));
    out._enrichedFromVideo = Boolean(mergedPoster && mergedVideo && (kindA === 'video' || kindB === 'video'));

    return out;
}

/**
 * Find existing card that should absorb incoming (same durable id, or temp+URL, or replacesTempKey).
 * @param {Map<string, Record<string, unknown>>} byId
 * @param {string} canonicalId
 * @param {Record<string, unknown>} incoming
 * @returns {string | null} map key
 */
function findMergeKey(byId, canonicalId, incoming) {
    if (byId.has(canonicalId)) return canonicalId;

    const replaces = text(incoming.replacesTempKey || incoming._catalogTempKey);
    if (replaces.startsWith('temp:') && byId.has(replaces)) return replaces;

    const inUrls = [
        normalizeDurableMediaUrl(text(incoming.url)),
        normalizeDurableMediaUrl(text(incoming.video_url)),
        normalizeDurableMediaUrl(text(incoming.mediaUrl)),
        normalizeDurableMediaUrl(text(incoming.posterUrl)),
        normalizeDurableMediaUrl(text(incoming.thumbnailUrl))
    ].filter(Boolean);

    if (!inUrls.length) return null;

    for (const [key, card] of byId.entries()) {
        const cardUrls = [
            normalizeDurableMediaUrl(text(card.url)),
            normalizeDurableMediaUrl(text(card.video_url)),
            normalizeDurableMediaUrl(text(card.mediaUrl)),
            normalizeDurableMediaUrl(text(card.posterUrl)),
            normalizeDurableMediaUrl(text(card.thumbnailUrl))
        ].filter(Boolean);
        if (cardUrls.some((u) => inUrls.includes(u))) {
            return key;
        }
    }
    return null;
}

/**
 * Merge inventory arrays into one card per durable identity.
 * @param {Array<Record<string, unknown>> | null | undefined} existing
 * @param {Array<Record<string, unknown>> | null | undefined} incoming
 * @returns {Array<Record<string, unknown>>}
 */
export function mergeMediaInventory(existing = [], incoming = []) {
    /** @type {Map<string, Record<string, unknown>>} */
    const byId = new Map();

    const seed = Array.isArray(existing) ? existing : [];
    const next = Array.isArray(incoming) ? incoming : [];

    for (const item of [...seed, ...next]) {
        if (!item || typeof item !== 'object') continue;
        const resolved = resolveCanonicalMediaId(item);
        let key = findMergeKey(byId, resolved.id, item);
        if (!key) key = resolved.id;

        const prior = byId.get(key);
        /** @type {Record<string, unknown>} */
        let card;
        if (prior) {
            card = enrichCatalogCard(prior, item);
        } else {
            card = { ...item };
            if (!resolved.durable) {
                card._catalogTempKey = resolved.id;
            }
            if (!text(card.id) || !isDurableMediaId(text(card.id))) {
                if (resolved.durable && !resolved.id.startsWith('url:')) {
                    card.id = resolved.id;
                } else if (resolved.durable && resolved.id.startsWith('url:')) {
                    // Keep original id if any; store url-key only as map identity.
                    card._urlIdentity = resolved.id;
                } else {
                    card._catalogTempKey = resolved.id;
                }
            }
            const kind = detectMediaKind(card);
            const videoUrl = text(card.video_url || (kind === 'video' ? card.url || card.mediaUrl : ''));
            const poster = text(
                card.posterUrl ||
                    card.thumbnailUrl ||
                    card.thumbnail_url ||
                    (kind === 'image' ? card.url : '')
            );
            if (videoUrl) {
                card.url = videoUrl;
                card.video_url = videoUrl;
                card.type = 'video';
                card.mediaKind = 'video';
                card.playable = true;
            } else {
                card.mediaKind = kind === 'image' ? 'image' : kind;
                card.playable = false;
                if (kind === 'image' && poster) {
                    card.url = poster;
                    card.type = 'image';
                }
            }
            if (poster) {
                card.posterUrl = poster;
                card.thumbnailUrl = preferUrl(text(card.thumbnailUrl), poster) || poster;
            }
        }

        // If we merged a temp key into a durable id, re-key the map.
        const durableId = text(card.id);
        const mapKey =
            isDurableMediaId(durableId) && !durableId.startsWith('url:')
                ? durableId
                : text(card._urlIdentity) || key;

        if (key !== mapKey && byId.has(key)) {
            byId.delete(key);
        }
        // Drop any other temp entry absorbed by URL match already handled via enrich.
        byId.set(mapKey, card);
    }

    return [...byId.values()];
}

/**
 * Project a rich feed catalog card (extends VaultCardProjection spirit).
 * @param {Record<string, unknown>} item
 * @param {{ classification?: ReturnType<typeof classifyContent> }} [options]
 * @returns {Record<string, unknown>}
 */
export function projectCatalogCard(item, options = {}) {
    const row = item && typeof item === 'object' ? { ...item } : {};
    const id = text(row.id) || text(row._catalogTempKey) || '';
    const classification = options.classification || classifyContent(row);
    const primary = normalizeDiscoveryShelf(classification.primaryCategory);

    let projection = {
        title: text(row.title || row.name),
        description: text(row.description),
        posterUrl: text(row.posterUrl || row.thumbnailUrl || row.thumbnail_url),
        mediaUrl: text(row.mediaUrl || row.video_url || (row.mediaKind === 'video' || row.type === 'video' ? row.url : '')),
        seriesLine: ''
    };

    try {
        if (id && isDurableMediaId(id) && !id.startsWith('url:') && !id.startsWith('temp:')) {
            const vault = resolveVaultCardProjection(id, { reel: row });
            projection = {
                title: vault.title || projection.title,
                description: vault.description || projection.description,
                posterUrl: vault.posterUrl || projection.posterUrl,
                mediaUrl: vault.mediaUrl || projection.mediaUrl,
                seriesLine: vault.seriesLine || ''
            };
        }
    } catch {
        /* keep lightweight projection */
    }

    const kindHint = detectMediaKind(row);
    const vaultMedia = text(projection.mediaUrl);
    const looksLikeVideoUrl =
        Boolean(vaultMedia) &&
        !/\.(jpg|jpeg|png|webp|gif|avif)(\?|#|$)/i.test(vaultMedia) &&
        (/\.(mp4|m4v|mov|webm|mkv)(\?|#|$)/i.test(vaultMedia) ||
            kindHint === 'video' ||
            text(row.type) === 'video' ||
            Boolean(row.video_url));

    const playable = Boolean(
        row.playable === true ||
            looksLikeVideoUrl ||
            (text(row.type) === 'video' && text(row.url || row.video_url || row.mediaUrl))
    );
    const mediaKind = playable
        ? 'video'
        : text(row.mediaKind) === 'image' || text(row.type) === 'image' || kindHint === 'image'
          ? 'image'
          : detectMediaKind(row);

    const posterUrl =
        projection.posterUrl ||
        text(row.posterUrl || row.thumbnailUrl || row.thumbnail_url) ||
        (mediaKind === 'image' ? text(row.url) : '');

    /** @type {Record<string, unknown>} */
    const card = {
        ...row,
        id: id || row.id,
        title: projection.title || text(row.title || row.name),
        name: text(row.name) || projection.title || text(row.title),
        description: projection.description || text(row.description),
        posterUrl,
        thumbnailUrl: preferUrl(text(row.thumbnailUrl), posterUrl) || posterUrl,
        mediaUrl: projection.mediaUrl || text(row.mediaUrl || row.video_url || ''),
        seriesLine: projection.seriesLine,
        category: primary,
        categories: classification.categories?.length
            ? classification.categories
            : [primary],
        categoryConfidence: classification.confidence,
        classificationSource: classification.classificationSource,
        classificationSignals: classification.signals,
        mediaKind,
        playable,
        ranking: Number(row.ranking) || 0,
        recommendationScore: Number(row.recommendationScore) || classification.confidence || 0,
        isPlaceholder: false
    };

    if (playable && card.mediaUrl) {
        card.url = card.mediaUrl;
        card.video_url = card.mediaUrl;
        card.type = 'video';
    } else if (mediaKind === 'image' && posterUrl) {
        card.url = text(row.url) && text(row.type) === 'image' ? text(row.url) : posterUrl;
        card.type = 'image';
        card.mediaUrl = '';
        card.playable = false;
    }

    return card;
}

/**
 * Reset temp key sequence (tests only).
 */
export function __resetCatalogTempKeySeqForTests() {
    tempKeySeq = 0;
}
