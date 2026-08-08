/**
 * Pure hero presentation helpers (no network) — safe for Node validation scripts.
 */
import { analyzeHeroTitle } from './heroTitleIntelligence.js';

/** @type {'localStorage' | 'backend' | 'default' | null} */
let lastHeroConfigSource = null;

/** @returns {'localStorage' | 'backend' | 'default' | null} */
export function getLastHeroConfigSource() {
    return lastHeroConfigSource;
}

/**
 * @param {'localStorage' | 'backend' | 'default'} source
 */
export function setLastHeroConfigSource(source) {
    lastHeroConfigSource = source;
}

/**
 * Diagnostic: where the active hero came from.
 * @param {{
 *   source: 'localStorage' | 'backend' | 'default';
 *   heroAssetId?: string;
 *   title?: string;
 *   backgroundUrl?: string;
 * }} detail
 */
export function logHeroSource(detail) {
    const payload = {
        source: detail.source,
        heroAssetId: String(detail.heroAssetId || '').trim() || null,
        resolvedTitle: String(detail.title || '').trim() || null,
        resolvedBackgroundUrl: String(detail.backgroundUrl || '').trim() || null,
        ts: new Date().toISOString()
    };
    lastHeroConfigSource = detail.source;
    console.info('[HERO_SOURCE]', payload);
    return payload;
}

/**
 * Repair stored intelligence location/tags without rewriting creator title.
 * @param {Record<string, unknown>} config
 * @returns {Record<string, unknown>}
 */
export function sanitizeHeroConfigLocationIntelligence(config) {
    if (!config || typeof config !== 'object') return config;
    const prevIntelRaw =
        config.heroTitleIntelligence && typeof config.heroTitleIntelligence === 'object'
            ? /** @type {Record<string, unknown>} */ (config.heroTitleIntelligence)
            : null;
    const title = String(
        config.heroTitle ||
            config.heroAssetTitle ||
            (prevIntelRaw ? prevIntelRaw.normalizedTitle : '') ||
            ''
    ).trim();
    if (!title) return config;

    const intelligence = analyzeHeroTitle(title, { isVideo: true });
    if (!intelligence?.location) return config;

    const next = { ...config };
    const creatorTitle =
        String(
            (prevIntelRaw && prevIntelRaw.normalizedTitle) ||
                config.heroTitle ||
                intelligence.normalizedTitle ||
                title
        ).trim() || title;

    const discoveryTags = Array.from(
        new Set([
            ...(Array.isArray(prevIntelRaw?.discoveryTags) ? prevIntelRaw.discoveryTags : []),
            ...(intelligence.discoveryTags || [])
        ])
    );

    next.heroTitleIntelligence = {
        ...(prevIntelRaw || intelligence),
        location: intelligence.location,
        discoveryTags,
        locationAliases: intelligence.locationAliases || prevIntelRaw?.locationAliases,
        normalizedTitle: creatorTitle
    };

    if (next.heroStoryContext && typeof next.heroStoryContext === 'object') {
        const story = /** @type {Record<string, unknown>} */ (next.heroStoryContext);
        next.heroStoryContext = {
            ...story,
            location: intelligence.location,
            discoveryTags,
            heroAssetTitle: String(story.heroAssetTitle || '').trim() || creatorTitle,
            headline: String(story.headline || '').trim() || creatorTitle
        };
    }

    return next;
}

/**
 * @param {Record<string, unknown>} config
 */
export function buildServerPresentationPayload(config) {
    const c = sanitizeHeroConfigLocationIntelligence({ ...config });
    const heroAssetId = String(c.heroAssetId || '').trim();
    const mediaUrl = String(
        c.backgroundMediaUrl || c.mediaUrl || c.backgroundVideo || c.backgroundImage || ''
    ).trim();
    const posterUrl = String(c.posterUrl || c.backgroundPoster || '').trim();

    const presentation = {
        heroType: c.heroType,
        autoRotate: c.autoRotate,
        rotateIntervalMs: c.rotateIntervalMs,
        spotlightPriority: c.spotlightPriority,
        seasonalCampaigns: c.seasonalCampaigns,
        carouselDurationMs: c.carouselDurationMs,
        carouselTransitionStyle: c.carouselTransitionStyle,
        carouselPriority: c.carouselPriority,
        heroTypography: c.heroTypography,
        autoplayEnabled: c.autoplayEnabled,
        carouselSlideOverrides: c.carouselSlideOverrides,
        heroCopySourceAssetId: c.heroCopySourceAssetId,
        heroAssetTitle: c.heroAssetTitle,
        heroStoryContext: c.heroStoryContext,
        heroTitleIntelligence: c.heroTitleIntelligence,
        contentIdentity: c.contentIdentity,
        heroIntelligenceProposals: c.heroIntelligenceProposals,
        ctaPrimaryLabel: c.ctaPrimaryLabel,
        ctaPrimaryTarget: c.ctaPrimaryTarget,
        ctaSecondaryLabel: c.ctaSecondaryLabel,
        ctaSecondaryTarget: c.ctaSecondaryTarget,
        campaignType: c.campaignType,
        featuredCollection: c.featuredCollection,
        featuredSeries: c.featuredSeries,
        storyStatus: c.storyStatus,
        storyScheduledFor: c.storyScheduledFor,
        backgroundMediaUrl: mediaUrl || undefined
    };

    return {
        heroAssetId: heroAssetId || '',
        backgroundSource: String(c.backgroundSource || 'selection'),
        backgroundStyle: String(c.backgroundStyle || 'video'),
        mediaUrl: mediaUrl || '',
        posterUrl: posterUrl || '',
        heroLabel: String(c.heroLabel || ''),
        heroTitle: String(c.heroTitle || ''),
        heroSubtitle: String(c.heroSubtitle || ''),
        heroDescription: String(c.heroDescription || ''),
        presentation
    };
}

/**
 * @param {Record<string, unknown> | null | undefined} remote
 * @returns {Record<string, unknown> | null}
 */
export function mapServerPresentationToManagerPatch(remote) {
    if (!remote || typeof remote !== 'object') return null;
    const presentation =
        remote.presentation && typeof remote.presentation === 'object'
            ? /** @type {Record<string, unknown>} */ (remote.presentation)
            : {};

    const heroAssetId = String(remote.heroAssetId || presentation.heroAssetId || '').trim();
    if (
        !heroAssetId &&
        !String(remote.heroTitle || '').trim() &&
        !String(remote.mediaUrl || '').trim() &&
        Object.keys(presentation).length === 0
    ) {
        return null;
    }

    const patch = {
        ...presentation,
        heroAssetId,
        backgroundSource:
            String(remote.backgroundSource || presentation.backgroundSource || 'custom_video').trim() ||
            'custom_video',
        backgroundStyle: String(
            remote.backgroundStyle || presentation.backgroundStyle || 'video'
        ).trim(),
        heroLabel:
            remote.heroLabel != null
                ? String(remote.heroLabel)
                : presentation.heroLabel != null
                  ? String(presentation.heroLabel)
                  : undefined,
        heroTitle:
            remote.heroTitle != null
                ? String(remote.heroTitle)
                : presentation.heroTitle != null
                  ? String(presentation.heroTitle)
                  : undefined,
        heroSubtitle:
            remote.heroSubtitle != null
                ? String(remote.heroSubtitle)
                : presentation.heroSubtitle != null
                  ? String(presentation.heroSubtitle)
                  : undefined,
        heroDescription:
            remote.heroDescription != null
                ? String(remote.heroDescription)
                : presentation.heroDescription != null
                  ? String(presentation.heroDescription)
                  : undefined
    };

    for (const key of Object.keys(patch)) {
        if (patch[key] === undefined) delete patch[key];
    }

    return sanitizeHeroConfigLocationIntelligence(patch);
}
