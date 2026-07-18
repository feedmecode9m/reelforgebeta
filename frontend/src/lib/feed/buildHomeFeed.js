/**
 * Canonical homepage feed builder — single authority for feed eligibility and card assembly.
 * Feed eligibility ≠ playback eligibility (hero videos may appear as cards; playback routes separately).
 */
import { isVideoReel, isImageReel } from '../api/reelContract.js';
import { isHeroAsset } from '../hero/heroDomainGuard.js';
import { toRelativeMediaPath } from '../config.js';
import { buildDemoFeedReels } from '../demoPlaceholders.js';
import { logBg7nStage } from '../diagnostics/bg7nPipelineTrace.js';
import {
    logBg7pShelfDistribution,
    logBg7pCatalogToShelfMapping
} from '../diagnostics/bg7pShelfDistribution.js';

export const FEED_SHELVES = ['Trending', 'Romance', 'Cyber-Action', 'Suspense'];

/** @returns {Record<string, unknown[]>} */
export function emptyFeedMap() {
    return {
        Trending: [],
        Romance: [],
        'Cyber-Action': [],
        Suspense: []
    };
}

/** @param {string} [category] */
export function mapFeedCategory(category) {
    const cat = String(category || 'Trending').trim();
    if (cat === 'Network') return 'Trending';
    if (cat === 'Love' || cat === 'Drama') return 'Romance';
    if (cat === 'Action') return 'Cyber-Action';
    if (FEED_SHELVES.includes(cat)) return cat;
    return 'Trending';
}

/** @param {Record<string, unknown> | null | undefined} reel */
export function isDeletedReel(reel) {
    const status = String(reel?.status || '').trim().toLowerCase();
    return status === 'deleted' || reel?.deleted === true;
}

/**
 * @param {Record<string, unknown>} reel
 * @returns {{ eligible: boolean, rejectionReason: string, cardType: 'video' | 'image' | null, isHeroFeedCard?: boolean }}
 */
export function evaluateFeedEligibility(reel) {
    if (isDeletedReel(reel)) {
        return { eligible: false, rejectionReason: 'deleted', cardType: null };
    }
    if (isImageReel(reel)) {
        return { eligible: true, rejectionReason: 'thumbnail_card', cardType: 'image' };
    }
    if (isVideoReel(reel)) {
        const hero = isHeroAsset(reel);
        return {
            eligible: true,
            rejectionReason: hero ? 'hero_video_card' : 'video_card',
            cardType: 'video',
            isHeroFeedCard: hero
        };
    }
    return { eligible: false, rejectionReason: 'unknown_media_type', cardType: null };
}

/**
 * @param {Record<string, unknown>} reel
 * @param {string} thumbnailStorageKey
 */
function resolveReelThumbnailFromVault(reel, thumbnailStorageKey) {
    if (reel.thumbnailUrl) {
        return toRelativeMediaPath(String(reel.thumbnailUrl)) || reel.thumbnailUrl;
    }
    if (typeof window === 'undefined') return reel.thumbnailUrl || '';
    const storedThumbs = JSON.parse(localStorage.getItem(thumbnailStorageKey) || '[]');
    const fileKey = String(reel.fileName || reel.file_name || '').trim();
    const entry = (Array.isArray(storedThumbs) ? storedThumbs : []).find((t) => {
        if (!t) return false;
        if (typeof t === 'string') return t === fileKey;
        const byFile = String(t.fileName || t.file_name || '').trim();
        const byUrl = String(t.url || '').trim();
        return (
            (fileKey && byFile === fileKey) ||
            (byUrl && toRelativeMediaPath(byUrl) === toRelativeMediaPath(String(reel.url || '')))
        );
    });
    if (entry && typeof entry === 'object' && entry.url) {
        return toRelativeMediaPath(String(entry.url)) || entry.url;
    }
    if (fileKey) {
        const match = (Array.isArray(storedThumbs) ? storedThumbs : []).find(
            (t) => t && String(t.fileName || t.file_name || '').trim() === fileKey
        );
        if (match?.url) {
            return toRelativeMediaPath(String(match.url)) || match.url;
        }
    }
    return reel.thumbnailUrl || '';
}

/**
 * @param {Record<string, unknown>} reel
 * @param {{ eligible: boolean, rejectionReason: string, cardType: 'video' | 'image' | null, isHeroFeedCard?: boolean }} eligibility
 * @param {{ preserveLocal?: boolean, localTitles?: Record<string, { title?: string, title_original?: string }>, thumbnailStorageKey?: string }} options
 */
function prepareFeedCard(reel, eligibility, options) {
    const { preserveLocal = false, localTitles = {}, thumbnailStorageKey = 'personal_thumbnails' } = options;
    const copy = { ...reel };

    if (preserveLocal && localTitles[String(reel.id || '')]) {
        const saved = localTitles[String(reel.id)];
        copy.title = saved.title;
        copy.title_original = saved.title_original;
        copy._localModified = true;
    } else {
        copy.title_original = copy.title || copy.name || copy.title_original || '';
    }

    copy.isPlaceholder = false;

    if (eligibility.cardType === 'video') {
        copy.isPersonalThumbnail = false;
        if (eligibility.isHeroFeedCard) {
            copy.isHeroFeedCard = true;
            copy.isPersonalVideo = false;
        } else {
            copy.isPersonalVideo = true;
            copy.personal_video_id = copy.personal_video_id || copy.id;
        }
        copy.match = copy.match || '🎬 EPISODE';
        copy.url = toRelativeMediaPath(String(copy.url || copy.video_url || '')) || copy.url;
        const thumb = resolveReelThumbnailFromVault(copy, thumbnailStorageKey);
        if (thumb) copy.thumbnailUrl = thumb;
    } else if (eligibility.cardType === 'image') {
        copy.isPersonalVideo = false;
        copy.isPersonalThumbnail = false;
        copy.isCatalogImage = true;
        copy.match = copy.match || '🖼 IMAGE';
        copy.url = toRelativeMediaPath(String(copy.url || '')) || copy.url;
        copy.thumbnailUrl =
            toRelativeMediaPath(String(copy.thumbnailUrl || copy.url || '')) || copy.thumbnailUrl || copy.url;
    }

    return copy;
}

/**
 * Build homepage feed cards from backend catalog. Does not inject demo placeholders.
 * @param {Record<string, unknown>[]} catalog
 * @param {{
 *   preserveLocal?: boolean,
 *   localTitles?: Record<string, { title?: string, title_original?: string }>,
 *   thumbnailStorageKey?: string,
 *   dedupeVideos?: boolean
 * }} [options]
 */
export function buildHomeFeed(catalog, options = {}) {
    const { dedupeVideos = true, thumbnailStorageKey = 'personal_thumbnails' } = options;
    const hydratedFeed = emptyFeedMap();
    /** @type {Array<Record<string, unknown>>} */
    const decisions = [];
    const seenVideoUrls = new Set();

    for (const reel of catalog || []) {
        const eligibility = evaluateFeedEligibility(reel);
        const baseDecision = {
            reelId: String(reel?.id || ''),
            category: String(reel?.category || 'Trending'),
            mediaType: isVideoReel(reel) ? 'video' : isImageReel(reel) ? 'image' : 'unknown',
            eligible: eligibility.eligible,
            rejectionReason: eligibility.rejectionReason,
            gate: 'buildHomeFeed'
        };

        if (!eligibility.eligible) {
            decisions.push(baseDecision);
            continue;
        }

        if (eligibility.cardType === 'video' && dedupeVideos) {
            const videoKey = String(reel.url || reel.video_url || '').trim();
            if (!videoKey) {
                decisions.push({
                    ...baseDecision,
                    eligible: false,
                    rejectionReason: 'missing_video_url',
                    gate: 'buildHomeFeed:dedupe'
                });
                continue;
            }
            if (seenVideoUrls.has(videoKey)) {
                decisions.push({
                    ...baseDecision,
                    eligible: false,
                    rejectionReason: 'duplicate_video_url',
                    gate: 'buildHomeFeed:dedupe'
                });
                continue;
            }
            seenVideoUrls.add(videoKey);
        }

        const card = prepareFeedCard(reel, eligibility, { ...options, thumbnailStorageKey });
        const shelf = mapFeedCategory(String(card.category || 'Trending'));
        if (!hydratedFeed[shelf]) hydratedFeed[shelf] = [];
        hydratedFeed[shelf].unshift(card);
        decisions.push(baseDecision);
    }

    const cards = Object.values(hydratedFeed).flat().filter((r) => r && !r.isPlaceholder);

    logBg7nStage('buildHomeFeed', cards);
    logBg7pShelfDistribution('buildHomeFeed', hydratedFeed, cards);
    logBg7pCatalogToShelfMapping(catalog || [], hydratedFeed);

    return {
        feed: hydratedFeed,
        cards,
        cardCount: cards.length,
        decisions,
        placeholders: []
    };
}

/**
 * Demo placeholder injection — only call when buildHomeFeed returned zero real cards.
 * @param {boolean} [allowPlaceholders=true]
 */
export function injectPlaceholderCards(allowPlaceholders = true) {
    if (!allowPlaceholders) return emptyFeedMap();
    return {
        Trending: buildDemoFeedReels(),
        Romance: [],
        'Cyber-Action': [],
        Suspense: []
    };
}

/**
 * @param {Record<string, unknown[]>} feedMap
 * @param {boolean} [allowPlaceholders=true]
 */
export function applyPlaceholderFallbackIfEmpty(feedMap, allowPlaceholders = true) {
    const realCount = Object.values(feedMap || {})
        .flat()
        .filter((r) => r && !r.isPlaceholder).length;
    if (realCount > 0) {
        return { feed: feedMap, placeholdersInjected: false, placeholderCount: 0 };
    }
    if (!allowPlaceholders) {
        return { feed: feedMap, placeholdersInjected: false, placeholderCount: 0 };
    }
    const withPlaceholders = injectPlaceholderCards(true);
    return {
        feed: withPlaceholders,
        placeholdersInjected: true,
        placeholderCount: withPlaceholders.Trending.length
    };
}

/** @param {Record<string, unknown[]>} feedMap */
export function countRealFeedCards(feedMap) {
    return Object.values(feedMap || {}).flat().filter((r) => r && !r.isPlaceholder).length;
}
