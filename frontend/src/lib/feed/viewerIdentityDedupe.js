/**
 * Phase 6.4 — Viewer semantic identity deduplication.
 *
 * Prefer playable MP4/video as the canonical viewer card.
 * Matching thumbnail/image assets become poster / fallback artwork only —
 * never a second card for the same identity.
 *
 * Does NOT delete vault thumbnails, change upload validation, NLP, or shelves.
 */

import { stripPersonalThumbPrefix } from '../viewer/thumbnailDestinationIdentity.js';
import {
    evaluateViewerImageDiscoveryEligibility,
    resolveSafeViewerCardTitle
} from './viewerMediaIdentity.js';

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * Source filename stem — strip path + extension, normalize separators.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeSourceFilename(value) {
    const raw = text(value);
    if (!raw) return '';
    const base = raw.split(/[\\/]/).pop() || raw;
    return base
        .replace(/\.(mp4|mov|webm|m4v|avi|mkv|jpe?g|png|webp|gif|avif)$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Canonical title for identity matching (presentation-safe; no invention).
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeCanonicalTitle(value) {
    return text(value)
        .toLowerCase()
        .replace(/\.(mp4|mov|webm|m4v|avi|mkv|jpe?g|png|webp|gif|avif)$/i, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Local media kind detection — avoids pulling Vite-bound reelContract into Node validators.
 * @param {Record<string, unknown> | null | undefined} reel
 * @returns {'video' | 'image' | 'other'}
 */
export function classifyViewerMediaKind(reel) {
    if (!reel || typeof reel !== 'object') return 'other';
    const type = text(reel.type || reel.mediaType || reel.media_type).toLowerCase();
    const url = text(reel.url || reel.mediaUrl || reel.video_url || reel.playbackUrl);
    const mime = text(reel.mimeType || reel.mime_type || reel.contentType).toLowerCase();
    const fileName = text(reel.fileName || reel.file_name || reel.filename);

    if (
        type === 'video' ||
        type.startsWith('video/') ||
        mime.startsWith('video/') ||
        /\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i.test(url) ||
        /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(fileName) ||
        (url.includes('/prod/') && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url.split('?')[0])) ||
        url.includes('/videos/')
    ) {
        return 'video';
    }

    if (
        type === 'image' ||
        type === 'thumbnail' ||
        type.startsWith('image/') ||
        mime.startsWith('image/') ||
        reel.isPersonalThumbnail ||
        reel.isCatalogImage ||
        /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url) ||
        url.includes('/thumbs/')
    ) {
        return 'image';
    }

    return 'other';
}

/**
 * @param {Record<string, unknown>} reel
 * @returns {string}
 */
export function resolveViewerAssetId(reel) {
    const raw = text(
        reel.id || reel.mediaAssetId || reel.assetId || reel.reelId || reel.personal_video_id
    );
    return stripPersonalThumbPrefix(raw) || raw;
}

/**
 * @param {Record<string, unknown>} reel
 * @returns {string}
 */
function artworkUrlOf(reel) {
    const kind = classifyViewerMediaKind(reel);
    return (
        text(reel.posterUrl) ||
        text(reel.thumbnailUrl) ||
        text(reel.thumbnail_url) ||
        text(reel.imageUrl) ||
        (kind === 'image' ? text(reel.url) : '')
    );
}

/**
 * @param {Record<string, unknown>} reel
 * @returns {string}
 */
function videoUrlOf(reel) {
    if (classifyViewerMediaKind(reel) !== 'video') return '';
    return text(reel.url || reel.video_url || reel.mediaUrl || reel.playbackUrl);
}

/**
 * Linked thumbnail / parent video identity signals (rule 4).
 * @param {Record<string, unknown>} reel
 * @returns {{ linkedIds: string[], artworkUrls: string[], filename: string, title: string, assetId: string }}
 */
export function collectViewerIdentitySignals(reel) {
    const row = reel && typeof reel === 'object' ? reel : {};
    const assetId = resolveViewerAssetId(row);
    const linkedIds = [
        assetId,
        text(row.personal_video_id),
        text(row.videoId),
        text(row.video_id),
        text(row.linkedReelId),
        text(row.linked_reel_id),
        text(row.parentReelId),
        text(row.parent_id),
        text(row.thumbnailId),
        text(row.thumbnail_id),
        text(row.posterAssetId),
        text(row.poster_asset_id),
        text(row.linkedThumbnailId),
        text(row.linked_thumbnail_id)
    ]
        .map((id) => stripPersonalThumbPrefix(id) || id)
        .map((id) => text(id))
        .filter(Boolean);

    const artworkUrls = [
        artworkUrlOf(row),
        text(row.url),
        text(row.posterUrl),
        text(row.thumbnailUrl),
        text(row.thumbnail_url)
    ]
        .map((u) => text(u))
        .filter(Boolean)
        .map((u) => u.split('?')[0].toLowerCase());

    const filename = normalizeSourceFilename(
        row.fileName || row.file_name || row.filename || row.originalFilename || row.name
    );
    const title = normalizeCanonicalTitle(row.title || row.name || row.persistentTitle);

    return {
        assetId,
        linkedIds: [...new Set(linkedIds)],
        artworkUrls: [...new Set(artworkUrls)],
        filename,
        title
    };
}

/**
 * Identity match priority:
 * 1. reel / asset ID (incl. personal_video_id links)
 * 2. source filename normalization
 * 3. canonical title normalization
 * 4. linked thumbnail metadata / artwork URL overlap
 *
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 * @returns {{ matched: boolean, via: string }}
 */
export function matchViewerIdentity(a, b) {
    const sa = collectViewerIdentitySignals(a);
    const sb = collectViewerIdentitySignals(b);

    // 1 — ID / linked asset id
    for (const id of sa.linkedIds) {
        if (sb.linkedIds.includes(id)) {
            return { matched: true, via: 'asset_id' };
        }
    }

    // 2 — source filename stem
    if (sa.filename && sb.filename && sa.filename === sb.filename) {
        return { matched: true, via: 'source_filename' };
    }

    // 3 — canonical title
    if (sa.title && sb.title && sa.title === sb.title) {
        return { matched: true, via: 'canonical_title' };
    }

    // 4 — linked thumbnail metadata / shared artwork URL
    const aArt = new Set(sa.artworkUrls);
    for (const url of sb.artworkUrls) {
        if (url && aArt.has(url)) {
            return { matched: true, via: 'linked_thumbnail' };
        }
    }

    return { matched: false, via: '' };
}

/**
 * One resolved media object for ViewerSemanticCard.
 * @param {Record<string, unknown>} canonicalReel
 * @param {Record<string, unknown> | null} [artworkReel]
 * @param {string} [shelf]
 * @param {string[]} [themes]
 * @returns {{
 *   mediaSource: 'video' | 'image';
 *   poster: string;
 *   fallbackMedia: string;
 *   title: string;
 *   shelf: string;
 *   themes: string[];
 *   metadata: Record<string, unknown>;
 *   mediaUrl: string;
 *   canonicalReelId: string;
 *   absorbedArtworkId: string;
 * }}
 */
export function buildResolvedViewerMedia(canonicalReel, artworkReel = null, shelf = '', themes = []) {
    const kind = classifyViewerMediaKind(canonicalReel);
    const mediaSource = kind === 'video' ? 'video' : 'image';
    const mediaUrl = mediaSource === 'video' ? videoUrlOf(canonicalReel) : text(canonicalReel?.url);
    const posterFromSibling = artworkReel ? artworkUrlOf(artworkReel) : '';
    const poster =
        posterFromSibling ||
        artworkUrlOf(canonicalReel) ||
        (mediaSource === 'image' ? mediaUrl : '');
    const title = resolveSafeViewerCardTitle(canonicalReel);
    const shelfOut = text(shelf || canonicalReel?.category || '');

    return {
        mediaSource,
        poster,
        fallbackMedia: posterFromSibling || poster,
        title,
        shelf: shelfOut,
        themes: Array.isArray(themes) ? themes.map(String).filter(Boolean) : [],
        metadata: {
            assetId: resolveViewerAssetId(canonicalReel),
            absorbedArtworkId: artworkReel ? resolveViewerAssetId(artworkReel) : '',
            matchVia: text(canonicalReel?.__identityMatchVia),
            filename: text(canonicalReel?.fileName || canonicalReel?.file_name || ''),
            description: text(canonicalReel?.description),
            invented: false
        },
        mediaUrl,
        canonicalReelId: resolveViewerAssetId(canonicalReel),
        absorbedArtworkId: artworkReel ? resolveViewerAssetId(artworkReel) : ''
    };
}

/**
 * @param {Array<{ reel: Record<string, unknown>; shelf: string }>} items
 * @returns {{
 *   items: Array<{
 *     reel: Record<string, unknown>;
 *     shelf: string;
 *     resolvedMedia: ReturnType<typeof buildResolvedViewerMedia>;
 *     absorbedIds: string[];
 *   }>;
 *   suppressedIds: Set<string>;
 *   pairs: Array<{ videoId: string; imageId: string; via: string }>;
 * }}
 */
export function resolveViewerIdentityCards(items) {
    /** @type {Array<{ reel: Record<string, unknown>; shelf: string; index: number }>} */
    const rows = [];
    (items || []).forEach((item, index) => {
        if (!item?.reel || typeof item.reel !== 'object') return;
        rows.push({ reel: item.reel, shelf: text(item.shelf), index });
    });

    /** @type {number[]} */
    const parent = rows.map((_, i) => i);
    const find = (i) => {
        let cur = i;
        while (parent[cur] !== cur) cur = parent[cur];
        let walk = i;
        while (parent[walk] !== walk) {
            const next = parent[walk];
            parent[walk] = cur;
            walk = next;
        }
        return cur;
    };
    const unite = (a, b) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[rb] = ra;
    };

    /** @type {Array<{ videoId: string; imageId: string; via: string }>} */
    const pairs = [];

    for (let i = 0; i < rows.length; i += 1) {
        for (let j = i + 1; j < rows.length; j += 1) {
            const kindA = classifyViewerMediaKind(rows[i].reel);
            const kindB = classifyViewerMediaKind(rows[j].reel);
            const videoImagePair =
                (kindA === 'video' && kindB === 'image') || (kindA === 'image' && kindB === 'video');
            if (!videoImagePair) continue;
            const match = matchViewerIdentity(rows[i].reel, rows[j].reel);
            if (!match.matched) continue;
            unite(i, j);
            const videoRow = kindA === 'video' ? rows[i] : rows[j];
            const imageRow = kindA === 'image' ? rows[i] : rows[j];
            pairs.push({
                videoId: resolveViewerAssetId(videoRow.reel),
                imageId: resolveViewerAssetId(imageRow.reel),
                via: match.via
            });
        }
    }

    /** @type {Map<number, number[]>} */
    const clusters = new Map();
    rows.forEach((_, i) => {
        const root = find(i);
        if (!clusters.has(root)) clusters.set(root, []);
        clusters.get(root).push(i);
    });

    /** @type {Set<string>} */
    const suppressedIds = new Set();
    /** @type {Array<{ reel: Record<string, unknown>; shelf: string; resolvedMedia: ReturnType<typeof buildResolvedViewerMedia>; absorbedIds: string[] }>} */
    const out = [];

    for (const members of clusters.values()) {
        const memberRows = members.map((i) => rows[i]);
        const videos = memberRows.filter((r) => classifyViewerMediaKind(r.reel) === 'video');
        const images = memberRows.filter((r) => classifyViewerMediaKind(r.reel) === 'image');
        const others = memberRows.filter((r) => classifyViewerMediaKind(r.reel) === 'other');

        if (videos.length > 0) {
            // Prefer first video in feed order; absorb matching images as poster only.
            const canonical = videos[0];
            const artwork = images[0] || null;
            const via =
                pairs.find(
                    (p) =>
                        p.videoId === resolveViewerAssetId(canonical.reel) &&
                        artwork &&
                        p.imageId === resolveViewerAssetId(artwork.reel)
                )?.via || (artwork ? 'cluster' : '');

            const enriched = {
                ...canonical.reel,
                __identityMatchVia: via
            };
            if (artwork) {
                const poster = artworkUrlOf(artwork.reel);
                if (poster) {
                    enriched.thumbnailUrl = text(enriched.thumbnailUrl) || poster;
                    enriched.posterUrl = text(enriched.posterUrl) || poster;
                    enriched.thumbnail_url = enriched.thumbnailUrl;
                }
            }

            const absorbedIds = [
                ...videos.slice(1).map((v) => resolveViewerAssetId(v.reel)),
                ...images.map((img) => resolveViewerAssetId(img.reel))
            ].filter(Boolean);

            absorbedIds.forEach((id) => suppressedIds.add(id));
            // Extra video siblings in the same identity cluster are suppressed (rare).
            videos.slice(1).forEach((v) => {
                const id = resolveViewerAssetId(v.reel);
                if (id) suppressedIds.add(id);
            });

            out.push({
                reel: enriched,
                shelf: canonical.shelf,
                resolvedMedia: buildResolvedViewerMedia(
                    enriched,
                    artwork?.reel || null,
                    canonical.shelf
                ),
                absorbedIds,
                order: canonical.index
            });

            // Unmatched "other" in cluster stay visible.
            others.forEach((o) => {
                out.push({
                    reel: o.reel,
                    shelf: o.shelf,
                    resolvedMedia: buildResolvedViewerMedia(o.reel, null, o.shelf),
                    absorbedIds: [],
                    order: o.index
                });
            });
            continue;
        }

        // Image-only or other — keep as individual cards only when publishable (Phase 6.5).
        memberRows.forEach((row) => {
            const kind = classifyViewerMediaKind(row.reel);
            if (kind === 'image') {
                const discovery = evaluateViewerImageDiscoveryEligibility(row.reel);
                if (!discovery.allow) {
                    const id = resolveViewerAssetId(row.reel);
                    if (id) suppressedIds.add(id);
                    return;
                }
            }
            out.push({
                reel: row.reel,
                shelf: row.shelf,
                resolvedMedia: buildResolvedViewerMedia(row.reel, null, row.shelf),
                absorbedIds: [],
                order: row.index
            });
        });
    }

    out.sort((a, b) => a.order - b.order);

    return {
        items: out.map(({ order: _order, ...rest }) => rest),
        suppressedIds,
        pairs
    };
}

/**
 * Presentation-only feed map dedupe: suppress absorbed image cards; enrich video posters.
 * Placeholders / presentation-only slots pass through unchanged.
 *
 * @param {Record<string, unknown[]> | null | undefined} feedMap
 * @returns {{
 *   feedMap: Record<string, unknown[]>;
 *   suppressedIds: Set<string>;
 *   pairs: Array<{ videoId: string; imageId: string; via: string }>;
 *   resolvedById: Map<string, ReturnType<typeof buildResolvedViewerMedia>>;
 * }}
 */
export function dedupeViewerFeedIdentities(feedMap) {
    const map = feedMap && typeof feedMap === 'object' ? feedMap : {};
    /** @type {Array<{ reel: Record<string, unknown>; shelf: string }>} */
    const realItems = [];
    /** @type {Map<string, Array<{ reel: Record<string, unknown>; index: number }>>} */
    const shelfPlaceholders = new Map();

    for (const [shelf, items] of Object.entries(map)) {
        if (shelf === 'Auto-Detect' || shelf === 'HERO') continue;
        const list = Array.isArray(items) ? items : [];
        list.forEach((reel, index) => {
            if (!reel || typeof reel !== 'object') return;
            if (
                reel.isPresentationOnly ||
                reel.layoutOnly ||
                reel.isPlaceholder ||
                reel.isBlackStoriesPlaceholder
            ) {
                if (!shelfPlaceholders.has(shelf)) shelfPlaceholders.set(shelf, []);
                shelfPlaceholders.get(shelf).push({ reel, index });
                return;
            }
            realItems.push({ reel: /** @type {Record<string, unknown>} */ (reel), shelf });
        });
    }

    const resolved = resolveViewerIdentityCards(realItems);
    /** @type {Map<string, ReturnType<typeof buildResolvedViewerMedia>>} */
    const resolvedById = new Map();
    /** @type {Map<string, { reel: Record<string, unknown>; shelf: string }>} */
    const survivors = new Map();

    for (const item of resolved.items) {
        const id = resolveViewerAssetId(item.reel);
        if (!id) continue;
        if (resolved.suppressedIds.has(id)) continue;
        survivors.set(id, { reel: item.reel, shelf: item.shelf });
        resolvedById.set(id, item.resolvedMedia);
    }

    /** @type {Record<string, unknown[]>} */
    const outMap = {};
    for (const shelf of Object.keys(map)) {
        const original = Array.isArray(map[shelf]) ? map[shelf] : [];
        /** @type {unknown[]} */
        const next = [];
        for (const reel of original) {
            if (!reel || typeof reel !== 'object') continue;
            if (
                reel.isPresentationOnly ||
                reel.layoutOnly ||
                reel.isPlaceholder ||
                reel.isBlackStoriesPlaceholder
            ) {
                next.push(reel);
                continue;
            }
            const id = resolveViewerAssetId(/** @type {Record<string, unknown>} */ (reel));
            if (!id) continue;
            if (resolved.suppressedIds.has(id)) continue;
            const survivor = survivors.get(id);
            // Only emit the canonical card on its original shelf (or first survivor shelf).
            if (survivor && survivor.shelf === shelf) {
                next.push(survivor.reel);
            } else if (survivor && text(reel.category) === shelf && !next.some((r) => resolveViewerAssetId(/** @type {Record<string, unknown>} */ (r)) === id)) {
                next.push(survivor.reel);
            } else if (!survivor) {
                next.push(reel);
            } else if (
                survivor.shelf !== shelf &&
                resolveViewerAssetId(survivor.reel) === id &&
                String(/** @type {Record<string, unknown>} */ (reel).id || '') ===
                    String(survivor.reel.id || '')
            ) {
                // Same reel listed on multiple shelves — keep shelf listing but use enriched reel.
                next.push(survivor.reel);
            }
        }
        outMap[shelf] = next;
    }

    return {
        feedMap: outMap,
        suppressedIds: resolved.suppressedIds,
        pairs: resolved.pairs,
        resolvedById
    };
}
