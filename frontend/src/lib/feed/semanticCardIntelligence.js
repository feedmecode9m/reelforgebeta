/**
 * Phase 6.2 — Semantic Premium Card Intelligence
 *
 * Sync, presentation-only enrichment pipeline.
 * Reuses semanticThemeSignals + presentationThemeSystem + media field helpers.
 *
 * NEVER:
 * - writes categories / PATCH shelves
 * - invents descriptions, actors, creators, episodes, genres, ratings
 * - treats themes as shelf placement
 */

import { extractSemanticThemes } from './semanticThemeSignals.js';
import { derivePresentationTheme } from './presentationThemeSystem.js';
import {
    deriveMediaPresentationFields,
    formatDurationLabel
} from './semanticCardProfile.js';
import { normalizeActiveShelf } from './discoveryTaxonomy.js';

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function stringList(value) {
    if (Array.isArray(value)) return value.map((v) => text(v)).filter(Boolean);
    const raw = text(value);
    if (!raw) return [];
    return raw
        .split(/[,|;]/)
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * @param {Record<string, unknown>} asset
 * @returns {string}
 */
function resolveMediaType(asset = {}) {
    const type = text(asset.mediaType || asset.media_type || asset.type).toLowerCase();
    const url = text(asset.url || asset.video_url || asset.mediaUrl);
    if (type === 'video' || type.startsWith('video/')) return 'video';
    if (type === 'image' || type === 'thumbnail' || type.startsWith('image/')) return 'image';
    if (url.includes('/videos/') || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)) return 'video';
    if (url.includes('/thumbs/') || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url)) return 'image';
    return type || '';
}

/**
 * @param {Record<string, unknown>} asset
 * @param {{
 *   title?: string;
 *   category?: string;
 *   posterUrl?: string;
 *   description?: string;
 * }} [projection]
 * @returns {{
 *   assetId: string;
 *   title: string;
 *   filename: string;
 *   description: string;
 *   tags: string[];
 *   mediaType: string;
 *   shelf: string;
 *   duration: number | null;
 *   durationLabel: string;
 *   resolution: string;
 *   aspectRatio: string;
 *   artworkUrl: string;
 *   mediaUrl: string;
 *   themes: string[];
 *   contentType: string;
 *   mood: string;
 *   audience: string;
 *   visualTheme: import('./presentationThemeSystem.js').PresentationTheme & {
 *     cardVariant: string;
 *     visualEmphasis: string;
 *     badges: string[];
 *   };
 *   presentation: import('./presentationThemeSystem.js').PresentationTheme & {
 *     cardVariant: string;
 *     visualEmphasis: string;
 *     badges: string[];
 *   };
 *   badges: string[];
 *   displayHierarchy: {
 *     media: string;
 *     title: string;
 *     shelf: string;
 *     badges: string[];
 *     mood: string;
 *     audience: string;
 *     duration: string;
 *     resolution: string;
 *     themes: string[];
 *   };
 *   inventedDescription: false;
 *   inventedGenre: false;
 *   inventedCreator: false;
 *   inventedEpisode: false;
 *   inventedRating: false;
 *   suggestedCategory: '';
 *   categoryWritten: false;
 * }}
 */
export function enrichSemanticCard(asset = {}, projection = {}) {
    const row = asset && typeof asset === 'object' ? asset : {};
    const assetId = text(row.id || row.mediaAssetId || row.assetId || row.reelId);

    const title =
        text(projection.title) ||
        text(row.title) ||
        text(row.name) ||
        text(row.persistentTitle) ||
        '';

    const filename =
        text(row.fileName || row.file_name || row.filename) ||
        text(row.name) ||
        '';

    // Existing description only — never invent.
    const description = text(projection.description || row.description || '');
    const tags = stringList(
        Array.isArray(row.tags) && row.tags.length
            ? row.tags
            : row.keywords || projection.tags || []
    );

    const mediaType = resolveMediaType(row);
    const mediaFields = deriveMediaPresentationFields(row);

    const artworkUrl =
        text(projection.posterUrl) ||
        text(row.thumbnailUrl) ||
        text(row.posterUrl) ||
        text(row.imageUrl) ||
        (mediaType === 'image' ? text(row.url) : '');

    const mediaUrl = mediaType === 'video' ? text(row.url || row.video_url || row.mediaUrl) : '';

    // Approved shelf only — never NLP suggestion as published truth.
    const shelfRaw =
        text(projection.category) || text(row.category) || text(row.shelfCategory) || '';
    const shelf = normalizeActiveShelf(shelfRaw) || shelfRaw;

    const fileNameStem = filename.replace(/\.[^/.]+$/, '');
    const themePack = extractSemanticThemes(
        {
            title,
            description,
            tags,
            seriesTitle: text(row.seriesTitle || row.seriesName),
            episodeTitle: text(row.episodeTitle),
            fileName: filename,
            fileNameStem,
            mediaKind: mediaType || text(row.type || row.mediaType)
        },
        row
    );

    const presentation = derivePresentationTheme({
        themes: themePack.themes,
        contentType: themePack.contentType,
        // Do not feed shelf suggestions into presentation from this layer.
        suggestedCategory: '',
        aspectRatio: mediaFields.aspectRatio || '16:9',
        hasDescription: Boolean(description),
        identityConfidence: text(row.identityConfidence || '')
    });

    /** @type {string[]} */
    const badges = Array.isArray(presentation.badges)
        ? presentation.badges.map(String).filter(Boolean)
        : [];

    const durationLabel = formatDurationLabel(mediaFields.durationSec);

    const displayHierarchy = {
        media: artworkUrl || mediaUrl || '',
        title,
        shelf,
        badges,
        mood: text(themePack.mood),
        audience: text(themePack.audience),
        duration: durationLabel,
        resolution: mediaFields.resolution,
        themes: Array.isArray(themePack.themes) ? themePack.themes.map(String) : []
    };

    return {
        assetId,
        title,
        filename,
        description,
        tags,
        mediaType,
        shelf,
        duration: mediaFields.durationSec,
        durationLabel,
        resolution: mediaFields.resolution,
        aspectRatio: mediaFields.aspectRatio || '16:9',
        artworkUrl,
        mediaUrl,
        themes: themePack.themes,
        contentType: themePack.contentType,
        mood: themePack.mood,
        audience: themePack.audience,
        visualTheme: presentation,
        presentation,
        badges,
        displayHierarchy,
        // Safety flags — enrichment never fabricates these fields.
        inventedDescription: false,
        inventedGenre: false,
        inventedCreator: false,
        inventedEpisode: false,
        inventedRating: false,
        // Explicit: this layer never suggests or writes shelf category.
        suggestedCategory: '',
        categoryWritten: false
    };
}
