/**
 * Viewer cinematic card shell — sync presentation from existing ReelForge data.
 *
 * Phase 6.2: delegates enrichment to semanticCardIntelligence.
 * Does NOT invent titles/descriptions/creators/episodes/genres/ratings.
 * Themes affect presentation only — never shelf placement.
 */

import { enrichSemanticCard } from './semanticCardIntelligence.js';

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
 */
export function buildViewerSemanticShell(reel = {}, projection = {}) {
    const enriched = enrichSemanticCard(reel, projection);

    return {
        assetId: enriched.assetId,
        title: enriched.title,
        shelf: enriched.shelf,
        duration: enriched.duration,
        durationLabel: enriched.durationLabel,
        resolution: enriched.resolution,
        aspectRatio: enriched.aspectRatio || '16:9',
        artworkUrl: enriched.artworkUrl,
        mediaUrl: enriched.mediaUrl,
        mediaType: enriched.mediaType,
        themes: enriched.themes,
        contentType: enriched.contentType,
        mood: enriched.mood,
        audience: enriched.audience,
        badges: enriched.badges,
        displayHierarchy: enriched.displayHierarchy,
        presentation: enriched.presentation,
        presentationFamily: enriched.presentation?.family || 'neutral',
        presentationCssClass: enriched.presentation?.cssClass || 'sem-card--theme-neutral',
        animationBehavior: enriched.presentation?.animation || 'lift',
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
 * @param {Record<string, unknown[]> | null | undefined} feedMap
 * @returns {Array<{ reel: Record<string, unknown>; shelf: string }>}
 */
export function collectRealViewerReels(feedMap) {
    /** @type {Array<{ reel: Record<string, unknown>; shelf: string }>} */
    const out = [];
    /** @type {Set<string>} */
    const seen = new Set();
    const map = feedMap && typeof feedMap === 'object' ? feedMap : {};
    for (const [shelf, items] of Object.entries(map)) {
        if (shelf === 'Auto-Detect' || shelf === 'HERO') continue;
        for (const reel of items || []) {
            if (!reel || typeof reel !== 'object') continue;
            if (reel.isPresentationOnly || reel.layoutOnly || reel.isPlaceholder) continue;
            if (reel.isBlackStoriesPlaceholder) continue;
            const id = text(reel.id);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            out.push({ reel: /** @type {Record<string, unknown>} */ (reel), shelf });
        }
    }
    return out;
}
