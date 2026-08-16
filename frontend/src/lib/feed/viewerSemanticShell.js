/**
 * Viewer cinematic card shell — sync presentation from existing ReelForge data.
 *
 * Phase 6.2: delegates enrichment to semanticCardIntelligence.
 * Phase 6.4: identity-first dedupe (video canonical; thumbnail as poster only).
 * Does NOT invent titles/descriptions/creators/episodes/genres/ratings.
 * Themes affect presentation only — never shelf placement.
 */

import { enrichSemanticCard } from './semanticCardIntelligence.js';
import {
    buildResolvedViewerMedia,
    dedupeViewerFeedIdentities,
    resolveViewerAssetId
} from './viewerIdentityDedupe.js';

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * Build a viewer-facing cinematic shell from an existing reel + optional projection.
 * Missing fields stay empty.
 *
 * @param {Record<string, unknown>} reel
 * @param {{
 *   title?: string;
 *   category?: string;
 *   posterUrl?: string;
 *   description?: string;
 * }} [projection]
 * @param {{
 *   mediaSource?: string;
 *   poster?: string;
 *   fallbackMedia?: string;
 *   title?: string;
 *   shelf?: string;
 *   themes?: string[];
 *   metadata?: Record<string, unknown>;
 *   mediaUrl?: string;
 * } | null} [resolvedMedia]
 */
export function buildViewerSemanticShell(reel = {}, projection = {}, resolvedMedia = null) {
    const posterOverride =
        text(resolvedMedia?.poster) ||
        text(resolvedMedia?.fallbackMedia) ||
        text(projection.posterUrl);
    const enriched = enrichSemanticCard(reel, {
        ...projection,
        ...(posterOverride ? { posterUrl: posterOverride } : {})
    });

    const media =
        resolvedMedia ||
        buildResolvedViewerMedia(
            reel,
            null,
            text(projection.category) || enriched.shelf,
            enriched.themes
        );

    return {
        assetId: enriched.assetId,
        title: text(projection.title) || enriched.title || text(resolvedMedia?.title),
        shelf: text(resolvedMedia?.shelf) || enriched.shelf,
        duration: enriched.duration,
        durationLabel: enriched.durationLabel,
        resolution: enriched.resolution,
        aspectRatio: enriched.aspectRatio || '16:9',
        artworkUrl: text(media.poster) || enriched.artworkUrl,
        mediaUrl: text(media.mediaUrl) || enriched.mediaUrl,
        mediaType: text(media.mediaSource) || enriched.mediaType,
        themes: Array.isArray(media.themes) && media.themes.length ? media.themes : enriched.themes,
        contentType: enriched.contentType,
        mood: enriched.mood,
        audience: enriched.audience,
        badges: enriched.badges,
        displayHierarchy: enriched.displayHierarchy,
        presentation: enriched.presentation,
        presentationFamily: enriched.presentation?.family || 'neutral',
        presentationCssClass: enriched.presentation?.cssClass || 'sem-card--theme-neutral',
        animationBehavior: enriched.presentation?.animation || 'lift',
        resolvedMedia: media,
        // Explicitly omitted / never invented for viewer shell:
        inventedDescription: false,
        inventedGenre: false,
        inventedCreator: false,
        inventedEpisode: false,
        inventedRating: false,
        suggestedCategory: '',
        categoryWritten: false
    };
}

/**
 * Collect real (non-placeholder) reels from a feed map for featured/browse layouts.
 * Phase 6.4/6.5: identity-deduped — matching thumbnails absorbed; artifacts suppressed.
 *
 * @param {Record<string, unknown[]> | null | undefined} feedMap
 * @returns {Array<{
 *   reel: Record<string, unknown>;
 *   shelf: string;
 *   resolvedMedia?: ReturnType<typeof buildResolvedViewerMedia>;
 * }>}
 */
export function collectRealViewerReels(feedMap) {
    const deduped = dedupeViewerFeedIdentities(feedMap);
    /** @type {Array<{ reel: Record<string, unknown>; shelf: string; resolvedMedia?: ReturnType<typeof buildResolvedViewerMedia> }>} */
    const out = [];
    /** @type {Set<string>} */
    const seen = new Set();
    const map = deduped.feedMap && typeof deduped.feedMap === 'object' ? deduped.feedMap : {};
    for (const [shelf, items] of Object.entries(map)) {
        if (shelf === 'Auto-Detect' || shelf === 'HERO') continue;
        for (const reel of items || []) {
            if (!reel || typeof reel !== 'object') continue;
            if (reel.isPresentationOnly || reel.layoutOnly || reel.isPlaceholder) continue;
            if (reel.isBlackStoriesPlaceholder) continue;
            const id = resolveViewerAssetId(/** @type {Record<string, unknown>} */ (reel));
            if (!id || seen.has(id)) continue;
            if (deduped.suppressedIds.has(id)) continue;
            seen.add(id);
            out.push({
                reel: /** @type {Record<string, unknown>} */ (reel),
                shelf,
                resolvedMedia: deduped.resolvedById.get(id)
            });
        }
    }
    return out;
}

/**
 * Presentation feed map with identity-absorbed thumbnails removed from card slots.
 * @param {Record<string, unknown[]> | null | undefined} feedMap
 */
export function collectIdentityDedupedFeedMap(feedMap) {
    return dedupeViewerFeedIdentities(feedMap);
}
