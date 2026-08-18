/**
 * Smart Production Studio overlay for the Los Angeles episode guide.
 *
 * Presentation / draft-fill only. Does not PATCH vault, rewrite identity, or
 * persist catalog until Creator Catalog / Content Intelligence save.
 * Viewer Theater headings stay episode titles (Arrival, …) — never Vic G / Motherland.
 */

import {
    LA_PRODUCTION_EPISODES,
    LA_PRODUCTION_SYNOPSIS,
    episodeGuideSearchText,
    getLaProductionEpisodeByNumber,
    presentLaProductionEpisode,
    shouldPreferLaGuideTitle
} from './laProductionEpisodeGuide.js';

/** Studio series field when replacing Vic G / Motherland — not used as Theater H2. */
export const LA_PRODUCTION_STUDIO_SERIES_TITLE = 'Los Angeles Production';

export const LA_PRODUCTION_STUDIO_GENRE = 'Behind the scenes';

export const LA_PRODUCTION_DISCOVERY = Object.freeze({
    mood: ['anticipation', 'nightlife', 'creative', 'candid'],
    topics: ['Los Angeles', 'music video', 'behind the scenes', 'soundstage'],
    audienceInterests: ['music', 'behind the scenes', 'production'],
    searchKeywords: [
        'Los Angeles',
        'music video',
        'behind the scenes',
        ...LA_PRODUCTION_EPISODES.map((ep) => ep.title)
    ],
    sponsorshipCategories: ['Music'],
    collectionCategories: ['Behind the scenes', 'Music']
});

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

/**
 * Vic G / Motherland as a heading — never the production-facing series name.
 * @param {unknown} value
 */
export function isLaProductionPlaceholderHeading(value) {
    return /^(vic[\s_-]?g|motherland)$/i.test(text(value));
}

/**
 * @param {unknown} series
 * @param {unknown[]} [feedReels]
 * @returns {unknown[]}
 */
export function collectStudioFamilyItems(series, feedReels) {
    const items = [];
    if (!series || typeof series !== 'object') return items;
    const rec = /** @type {Record<string, unknown>} */ (series);
    items.push(rec.title, rec.description);
    const reels = Array.isArray(feedReels) ? feedReels : [];
    for (const season of Array.isArray(rec.seasons) ? rec.seasons : []) {
        const s = season && typeof season === 'object' ? /** @type {Record<string, unknown>} */ (season) : {};
        for (const ep of Array.isArray(s.episodes) ? s.episodes : []) {
            items.push(ep);
            if (ep && typeof ep === 'object') {
                const row = /** @type {Record<string, unknown>} */ (ep);
                const reelId = text(row.reelId);
                const reel = reels.find((r) => r && String(/** @type {Record<string, unknown>} */ (r).id) === reelId);
                if (reel) items.push(reel);
            }
        }
    }
    return items.filter((item) => item != null && item !== '');
}

/**
 * @param {{
 *   familyItems?: unknown[];
 *   seriesTitle?: string;
 *   episode?: unknown;
 *   title?: string;
 *   fileName?: string;
 *   episodeNumber?: number | string;
 *   currentTitle?: string;
 *   currentDescription?: string;
 * }} input
 */
export function presentStudioEpisodeGuide(input) {
    const presented = presentLaProductionEpisode(input);
    if (!presented.active) {
        return {
            active: false,
            title: text(input?.currentTitle || input?.title),
            description: text(input?.currentDescription),
            episodeNumber: null
        };
    }
    const currentTitle = text(input?.currentTitle || input?.title);
    const prefer =
        shouldPreferLaGuideTitle(currentTitle) ||
        isLaProductionPlaceholderHeading(currentTitle) ||
        !currentTitle;
    return {
        active: true,
        episodeNumber: presented.episodeNumber,
        title: prefer ? presented.title || currentTitle : currentTitle,
        description: text(input?.currentDescription) || presented.description || ''
    };
}

/**
 * Creator Catalog editor suggestion — does not write until Save.
 *
 * @param {unknown} episode
 * @param {unknown[]} familyItems
 * @param {unknown} [reel]
 */
export function suggestCreatorCatalogEpisodeFields(episode, familyItems, reel) {
    const rec = episode && typeof episode === 'object' ? /** @type {Record<string, unknown>} */ (episode) : {};
    const reelRec = reel && typeof reel === 'object' ? /** @type {Record<string, unknown>} */ (reel) : {};
    const currentTitle = text(rec.title);
    const currentDescription = text(rec.description);
    const presented = presentStudioEpisodeGuide({
        familyItems,
        episode,
        title: currentTitle || reelRec.title || reelRec.name,
        fileName: reelRec.fileName || reelRec.file_name || reelRec.url || reelRec.mediaUrl,
        episodeNumber: rec.episodeNumber,
        currentTitle,
        currentDescription
    });
    if (!presented.active || !presented.title) {
        return { active: false, title: currentTitle, description: currentDescription, episodeNumber: null };
    }
    return {
        active: true,
        episodeNumber: presented.episodeNumber,
        title: presented.title,
        description: presented.description || currentDescription,
        titleChanged: presented.title !== currentTitle,
        descriptionChanged: Boolean(presented.description) && presented.description !== currentDescription
    };
}

/**
 * @param {unknown} series
 * @param {unknown[]} familyItems
 */
export function suggestCreatorCatalogSeriesFields(series, familyItems) {
    const rec = series && typeof series === 'object' ? /** @type {Record<string, unknown>} */ (series) : {};
    const familyHit = (Array.isArray(familyItems) ? familyItems : []).some((item) => {
        const presented = presentStudioEpisodeGuide({
            familyItems,
            episode: item,
            title: episodeGuideSearchText(item),
            fileName: episodeGuideSearchText(item),
            currentTitle: episodeGuideSearchText(item)
        });
        return presented.active && Boolean(presented.title);
    });
    if (!familyHit) {
        return {
            active: false,
            seriesTitle: text(rec.title),
            seriesDescription: text(rec.description)
        };
    }
    const currentTitle = text(rec.title);
    return {
        active: true,
        seriesTitle: isLaProductionPlaceholderHeading(currentTitle)
            ? LA_PRODUCTION_STUDIO_SERIES_TITLE
            : currentTitle,
        seriesDescription: text(rec.description) || LA_PRODUCTION_SYNOPSIS,
        replacePlaceholderTitle: isLaProductionPlaceholderHeading(currentTitle)
    };
}

/**
 * In-memory overlay so category audit classifies Arrival / soundstage copy, not filenames.
 *
 * @param {Record<string, unknown>} asset
 * @param {unknown[]} familyItems
 * @returns {Record<string, unknown>}
 */
export function overlayLaProductionForClassification(asset, familyItems) {
    const row = asset && typeof asset === 'object' ? { ...asset } : {};
    const presented = presentStudioEpisodeGuide({
        familyItems,
        episode: row,
        title: row.title || row.name,
        fileName: row.fileName || row.file_name || row.url || row.mediaUrl,
        currentTitle: row.creatorTitle || row.persistentTitle || row.title || row.name,
        currentDescription: row.description,
        episodeNumber: row.episodeNumber
    });
    if (!presented.active || !presented.title) return row;
    return {
        ...row,
        enrichmentTitle: presented.title,
        description: text(row.description) || presented.description,
        studioGuideEpisodeNumber: presented.episodeNumber
    };
}

/**
 * Episode Operations / asset records — viewer-facing guide title.
 *
 * @param {{
 *   episodeTitle?: string;
 *   episodeNumber?: number;
 *   episode?: unknown;
 *   reel?: unknown;
 *   familyItems?: unknown[];
 * }} input
 */
export function presentEpisodeOperationTitle(input) {
    const current = text(input?.episodeTitle);
    const presented = presentStudioEpisodeGuide({
        familyItems: input?.familyItems,
        episode: input?.episode,
        title: current,
        fileName: episodeGuideSearchText(input?.reel),
        episodeNumber: input?.episodeNumber,
        currentTitle: current
    });
    if (presented.active && presented.title) return presented.title;
    return current;
}

/**
 * Guide description counts toward studio metadata completeness.
 *
 * @param {{
 *   episodeTitle?: string;
 *   episodeNumber?: number;
 *   episode?: unknown;
 *   reel?: unknown;
 *   familyItems?: unknown[];
 *   currentDescription?: string;
 * }} input
 */
export function presentEpisodeOperationDescription(input) {
    const presented = presentStudioEpisodeGuide({
        familyItems: input?.familyItems,
        episode: input?.episode,
        title: input?.episodeTitle,
        fileName: episodeGuideSearchText(input?.reel),
        episodeNumber: input?.episodeNumber,
        currentTitle: input?.episodeTitle,
        currentDescription: input?.currentDescription
    });
    return text(input?.currentDescription) || presented.description || '';
}

/**
 * Soft-fill Content Intelligence + Discovery Fields from the episode guide.
 *
 * @param {{
 *   series?: Record<string, unknown>;
 *   episode?: Record<string, unknown>;
 *   discovery?: Record<string, unknown>;
 *   community?: Record<string, unknown>;
 *   educational?: Record<string, unknown>;
 * }} models
 * @param {{
 *   familyItems?: unknown[];
 *   title?: string;
 *   fileName?: string;
 *   episodeNumber?: number | string;
 * }} context
 * @param {{ force?: boolean }} [options]
 */
export function seedContentIntelligenceFromLaGuide(models, context, options = {}) {
    const force = options.force === true;
    let presented = presentStudioEpisodeGuide({
        familyItems: context?.familyItems,
        title: context?.title,
        fileName: context?.fileName,
        currentTitle: context?.title,
        episodeNumber: context?.episodeNumber
    });
    if (
        !presented.active ||
        !presented.title ||
        isLaProductionPlaceholderHeading(presented.title)
    ) {
        const n = Number(context?.episodeNumber);
        const guide =
            (Number.isFinite(n) && n >= 1 ? getLaProductionEpisodeByNumber(n) : null) ||
            LA_PRODUCTION_EPISODES[0];
        presented = {
            active: true,
            title: guide.title,
            description: guide.description,
            episodeNumber: guide.episodeNumber
        };
    }

    const series = { ...(models.series || {}) };
    const episode = { ...(models.episode || {}) };
    const community = { ...(models.community || {}) };
    const educational = { ...(models.educational || {}) };
    const discovery = {
        mood: Array.isArray(models.discovery?.mood) ? [...models.discovery.mood] : [],
        topics: Array.isArray(models.discovery?.topics) ? [...models.discovery.topics] : [],
        audienceInterests: Array.isArray(models.discovery?.audienceInterests)
            ? [...models.discovery.audienceInterests]
            : [],
        searchKeywords: Array.isArray(models.discovery?.searchKeywords)
            ? [...models.discovery.searchKeywords]
            : [],
        sponsorshipCategories: Array.isArray(models.discovery?.sponsorshipCategories)
            ? [...models.discovery.sponsorshipCategories]
            : [],
        collectionCategories: Array.isArray(models.discovery?.collectionCategories)
            ? [...models.discovery.collectionCategories]
            : []
    };

    const fill = (obj, key, value) => {
        const next = text(value);
        if (!next) return;
        const cur = text(obj[key]);
        if (force || !cur || isLaProductionPlaceholderHeading(cur) || shouldPreferLaGuideTitle(cur)) {
            obj[key] = next;
        }
    };

    const seriesHeading =
        force ||
        !text(series.seriesTitle) ||
        isLaProductionPlaceholderHeading(series.seriesTitle) ||
        shouldPreferLaGuideTitle(series.seriesTitle)
            ? LA_PRODUCTION_STUDIO_SERIES_TITLE
            : series.seriesTitle;
    fill(series, 'seriesTitle', seriesHeading);
    fill(series, 'seriesDescription', LA_PRODUCTION_SYNOPSIS);
    fill(series, 'genre', LA_PRODUCTION_STUDIO_GENRE);
    fill(series, 'communityRepresented', 'Los Angeles creative community');
    fill(
        series,
        'historicalSignificance',
        'Independent music-video production documenting the Los Angeles shoot and the community around it.'
    );
    fill(episode, 'episodeTitle', presented.title);
    fill(episode, 'episodeDescription', presented.description);
    fill(episode, 'location', 'Los Angeles');
    if (presented.episodeNumber) {
        fill(episode, 'episodeNumber', String(presented.episodeNumber));
    }
    fill(episode, 'language', 'English');
    fill(community, 'communityRepresented', 'Los Angeles creative community');
    fill(community, 'culturalRegion', 'Los Angeles');
    fill(community, 'communityDescription', LA_PRODUCTION_SYNOPSIS);

    const mergeUnique = (list, values) => {
        const next = Array.isArray(list) ? [...list] : [];
        for (const value of values) {
            const v = text(value);
            if (!v) continue;
            if (next.some((item) => String(item).toLowerCase() === v.toLowerCase())) continue;
            next.push(v);
        }
        return next;
    };

    if (force || !Array.isArray(series.tags) || series.tags.length === 0) {
        series.tags = mergeUnique(series.tags, ['Los Angeles', 'behind the scenes', 'music video']);
    }
    if (force || !Array.isArray(series.educationalThemes) || series.educationalThemes.length === 0) {
        series.educationalThemes = mergeUnique(series.educationalThemes, [
            'music video production',
            'behind the scenes'
        ]);
    }
    if (force || !Array.isArray(episode.featuredPeople) || episode.featuredPeople.length === 0) {
        episode.featuredPeople = mergeUnique(episode.featuredPeople, ['Vic-G']);
    }
    if (force || !Array.isArray(episode.keywords) || episode.keywords.length === 0) {
        episode.keywords = mergeUnique(episode.keywords, [
            presented.title,
            'Los Angeles',
            'music video'
        ]);
    }
    if (force || !Array.isArray(educational.educationalThemes) || educational.educationalThemes.length === 0) {
        educational.educationalThemes = mergeUnique(educational.educationalThemes, [
            'music video production',
            'behind the scenes'
        ]);
    }
    fill(educational, 'recommendedAudience', 'Music and production audiences');

    discovery.mood = mergeUnique(discovery.mood, LA_PRODUCTION_DISCOVERY.mood);
    discovery.topics = mergeUnique(discovery.topics, LA_PRODUCTION_DISCOVERY.topics);
    discovery.audienceInterests = mergeUnique(
        discovery.audienceInterests,
        LA_PRODUCTION_DISCOVERY.audienceInterests
    );
    discovery.searchKeywords = mergeUnique(
        discovery.searchKeywords,
        LA_PRODUCTION_DISCOVERY.searchKeywords
    );
    discovery.sponsorshipCategories = mergeUnique(
        discovery.sponsorshipCategories,
        LA_PRODUCTION_DISCOVERY.sponsorshipCategories
    );
    discovery.collectionCategories = mergeUnique(
        discovery.collectionCategories,
        LA_PRODUCTION_DISCOVERY.collectionCategories
    );

    return {
        active: true,
        series,
        episode,
        discovery,
        community,
        educational,
        guideTitle: presented.title
    };
}
