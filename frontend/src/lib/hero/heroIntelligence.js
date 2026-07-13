/**
 * Phase 33 — intelligent hero command surface + showcase selection.
 * Aggregates production signals for the hero command center without touching playback.
 */

import { getOperationsSnapshot } from '../observability/platformMetrics.js';
import { loadWatchProgressMap } from '../series/seriesWatchProgress.js';
import { buildReleaseCenterSnapshot } from '../release/releaseCenter.js';
import { getEpisodeById, getSeriesById, seriesCatalog } from '../series/seriesStore.js';
import { get } from 'svelte/store';
import { TEAM_STORAGE_KEY } from '../teams/creatorTeams.js';
import { METRICS_STORAGE_KEY } from '../observability/platformMetrics.js';
import { buildCommandCenterSnapshot } from '../command/commandCenter.js';
import { buildCreatorCopilotBrief } from '../copilot/creatorCopilot.js';
import { getUnreadCount } from '../notifications/notificationCenter.js';
import { computeProductionReadiness, computeSeriesHealth } from '../series/productionHealth.js';
import { getWorkflowOperationsSnapshot, getWorkflowTasksForSeries } from '../workflow/workflowEngine.js';
import { isWatchTrackingEnabled } from '../watch/watchTracker.js';
import { toRelativeMediaPath } from '../config.js';
import { resolveUserPosterUrl } from '../vaultMedia.js';
import { searchMarketplaceListings } from '../marketplace/marketplaceEngine.js';
import {
    buildHeroAssetRegistry,
    isVideoHeroAssetType,
    normalizeHeroAssetRecord,
    resolveHeroAssetById
} from './heroAssetBridge.js';
import {
    loadHeroReel,
    saveHeroReel,
    heroReelToVaultItem,
    applyHeroReelToStores,
    migrateLegacyHeroStorageIfNeeded,
    HERO_REEL_STORAGE_KEY
} from './heroReelIdentity.js';

export const HERO_MODES = /** @type {const} */ ([
    'TRENDING',
    'MOST_WATCHED',
    'HIGHEST_COMPLETION',
    'UPCOMING_RELEASE',
    'CREATOR_SPOTLIGHT',
    'TEAM_PICK',
    'EDITORS_CHOICE'
]);

/** @deprecated legacy aliases — normalized by normalizeHeroMode() */
export const LEGACY_HERO_MODES = /** @type {const} */ ([
    'CINEMATIC',
    'SERIES_SPOTLIGHT',
    'CREATOR_PICK'
]);

export const HERO_SOURCES = /** @type {const} */ ([
    'trending',
    'most_watched',
    'highest_completion',
    'upcoming_release',
    'creator_spotlight',
    'team_pick',
    'editors_choice',
    'featured_series',
    'featured_release',
    'continue_watching',
    'studio_priority'
]);

/** Phase 33 discovery hero types shown in Hero Manager. */
export const HERO_DISCOVERY_TYPES = /** @type {const} */ ([
    'FEATURED_RELEASE',
    'CONTINUE_WATCHING',
    'TRENDING',
    'UPCOMING_PREMIERE',
    'TEAM_SPOTLIGHT',
    'STUDIO_PRIORITY'
]);

/** @type {Record<typeof HERO_DISCOVERY_TYPES[number], typeof HERO_SOURCES[number]>} */
export const DISCOVERY_TYPE_SOURCES = {
    FEATURED_RELEASE: 'featured_release',
    CONTINUE_WATCHING: 'continue_watching',
    TRENDING: 'trending',
    UPCOMING_PREMIERE: 'upcoming_release',
    TEAM_SPOTLIGHT: 'team_pick',
    STUDIO_PRIORITY: 'studio_priority'
};

export const HERO_MANAGER_STORAGE_KEY = 'reelforge_hero_manager_config';
export const HERO_CAROUSEL_TRANSITIONS = /** @type {const} */ ([
    'fade',
    'cinematic_blur',
    'slide',
    'zoom'
]);
export const HERO_SLIDE_TYPES = /** @type {const} */ ([
    'video',
    'image',
    'featured_release',
    'admin_image',
    'admin_video',
    'upcoming_release',
    'team_spotlight',
    'marketplace_spotlight',
    'revenue_milestone',
    'creator_spotlight',
    'discovery_recommendation',
    'sentinel_recommendation'
]);

const HERO_VIDEO_STORAGE_KEY = 'reelforge_hero_video';
const HERO_IMAGE_STORAGE_KEY = 'reelforge_hero_image';

function mimeFromStoredValue(value, fallback = '') {
    const raw = String(value || '');
    const dataMime = raw.match(/^data:([^;]+);/i)?.[1] || '';
    if (dataMime) return dataMime.toLowerCase();
    if (HERO_VIDEO_EXTENSIONS.test(raw)) return 'video/mp4';
    if (HERO_IMAGE_EXTENSIONS.test(raw)) return 'image/jpeg';
    return String(fallback || '').toLowerCase();
}

const HERO_IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif)(\?|$)/i;
const HERO_VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/i;
const HERO_SCORE_MEMO_TTL_MS = 5_000;
const HERO_CANDIDATE_MEMO_TTL_MS = 1_500;
const HERO_DIAG_COOLDOWN_MS = 1_200;

/** @type {string} */
let lastAssetResolveSignature = '';

/** @type {string} */
let lastHeroImagePipelineSignature = '';
/** @type {Map<string, { at: number; value: HeroScoreBreakdown }>} */
const heroScoreMemo = new Map();
/** @type {{ key: string; at: number; value: HeroCandidate[] } | null} */
let heroCandidatesMemo = null;
/** @type {Map<string, number>} */
const heroDiagMemo = new Map();

/**
 * Structured hero image pipeline diagnostics (Phase 43B).
 * @param {'vault-upload' | 'hero-save' | 'asset-resolve' | 'store-update' | 'hero-render' | 'dom-visible'} stage
 * @param {Record<string, unknown>} [detail]
 */
export function logHeroImagePipeline(stage, detail = {}) {
    const payload = {
        stage,
        assetId: detail.assetId ?? '',
        assetType: detail.assetType ?? '',
        mediaUrl: detail.mediaUrl ?? '',
        resolved: detail.resolved ?? false,
        visible: detail.visible ?? false,
        ...detail,
        timestamp: Date.now()
    };
    const signature = `${stage}|${payload.assetId}|${payload.mediaUrl}|${payload.resolved}|${payload.visible}`;
    if (stage === 'hero-render' || stage === 'dom-visible') {
        if (signature === lastHeroImagePipelineSignature) return;
        lastHeroImagePipelineSignature = signature;
    }
    console.log(`[HERO_IMAGE_PIPELINE] ${JSON.stringify(payload)}`);
}

export const HERO_BACKGROUND_STYLES = /** @type {const} */ ([
    'image',
    'video',
    'ambient_motion',
    'cinematic_blur',
    'gradient_overlay'
]);

/** @typedef {typeof HERO_BACKGROUND_STYLES[number]} HeroBackgroundStyle */

/**
 * @typedef {Object} HeroManagerConfig
 * @property {typeof HERO_DISCOVERY_TYPES[number] | typeof HERO_MODES[number]} heroType
 * @property {'selection' | 'custom_image' | 'custom_video'} backgroundSource
 * @property {string} heroAssetId
 * @property {HeroBackgroundStyle} backgroundStyle
 * @property {boolean} autoRotate
 * @property {number} rotateIntervalMs
 * @property {typeof HERO_DISCOVERY_TYPES[number][]} spotlightPriority
 * @property {Array<{ id: string; label: string; heroType: typeof HERO_DISCOVERY_TYPES[number]; active: boolean; scheduleStart?: string; scheduleEnd?: string }>} seasonalCampaigns
 * @property {number} carouselDurationMs
 * @property {typeof HERO_CAROUSEL_TRANSITIONS[number]} carouselTransitionStyle
 * @property {typeof HERO_SLIDE_TYPES[number]} carouselPriority
 * @property {string} heroTypography
 * @property {boolean} autoplayEnabled
 * @property {Array<{ type: typeof HERO_SLIDE_TYPES[number]; order: number; durationMs: number; enabled: boolean }>} carouselSlideOverrides
 * @property {string} heroLabel
 * @property {string} heroTitle
 * @property {string} heroSubtitle
 * @property {string} heroDescription
 * @property {string} ctaPrimaryLabel
 * @property {string} ctaPrimaryTarget
 * @property {string} ctaSecondaryLabel
 * @property {string} ctaSecondaryTarget
 * @property {string} campaignType
 * @property {string} featuredCollection
 * @property {string} featuredSeries
 * @property {'draft' | 'published' | 'scheduled'} storyStatus
 * @property {string} storyScheduledFor
 */

/**
 * @typedef {Object} HeroBackgroundPresentation
 * @property {HeroBackgroundStyle} style
 * @property {string[]} containerClasses
 * @property {string[]} overlayClasses
 * @property {boolean} useVideo
 * @property {boolean} useImage
 * @property {boolean} ambientMotion
 * @property {boolean} cinematicBlur
 * @property {boolean} gradientOverlay
 * @property {'selection' | 'custom_image' | 'custom_video'} backgroundSource
 * @property {string} backgroundAsset
 * @property {string} assetId
 * @property {boolean} vaultMatch
 * @property {string} mediaUrl
 * @property {string} assetType
 * @property {string} videoUrl
 * @property {string} imageUrl
 */

/**
 * @typedef {Object} HeroBackgroundAssetResolution
 * @property {string} assetId
 * @property {boolean} vaultMatch
 * @property {string} mediaUrl
 * @property {string} assetType
 * @property {string} videoUrl
 * @property {string} imageUrl
 */

/** Default bundled hero loop served from public/videos (excluded from reel catalog). */
export const DEFAULT_HERO_BACKGROUND_VIDEO = '/videos/hero-background.mp4';

/**
 * @param {string | null | undefined} isoDate
 * @returns {number | null}
 */
function parseDateStart(isoDate) {
    const value = String(isoDate || '').trim();
    if (!value) return null;
    const ts = Date.parse(`${value}T00:00:00`);
    return Number.isFinite(ts) ? ts : null;
}

/**
 * @param {string | null | undefined} isoDate
 * @returns {number | null}
 */
function parseDateEnd(isoDate) {
    const value = String(isoDate || '').trim();
    if (!value) return null;
    const ts = Date.parse(`${value}T23:59:59`);
    return Number.isFinite(ts) ? ts : null;
}

/**
 * @param {{ scheduleStart?: string; scheduleEnd?: string }} campaign
 * @param {number} [now]
 */
function isCampaignScheduledActive(campaign, now = Date.now()) {
    const start = parseDateStart(campaign?.scheduleStart);
    const end = parseDateEnd(campaign?.scheduleEnd);
    if (start != null && now < start) return false;
    if (end != null && now > end) return false;
    return true;
}

/** @returns {HeroManagerConfig['carouselSlideOverrides']} */
function getDefaultCarouselSlideOverrides() {
    return HERO_SLIDE_TYPES.map((type, index) => ({
        type,
        order: index + 1,
        durationMs: 8000,
        enabled: true
    }));
}

/** @returns {HeroManagerConfig} */
export function getDefaultHeroManagerConfig() {
    return {
        heroType: 'TRENDING',
        backgroundSource: 'selection',
        heroAssetId: '',
        backgroundStyle: 'video',
        autoRotate: false,
        rotateIntervalMs: 30_000,
        spotlightPriority: [...HERO_DISCOVERY_TYPES],
        seasonalCampaigns: [
            {
                id: 'winter-premiere',
                label: 'Winter Premiere Push',
                heroType: 'UPCOMING_PREMIERE',
                active: false,
                scheduleStart: '',
                scheduleEnd: ''
            },
            {
                id: 'studio-sprint',
                label: 'Studio Sprint Spotlight',
                heroType: 'STUDIO_PRIORITY',
                active: false,
                scheduleStart: '',
                scheduleEnd: ''
            }
        ],
        carouselDurationMs: 8000,
        carouselTransitionStyle: 'fade',
        carouselPriority: 'video',
        heroTypography: 'cinematic',
        autoplayEnabled: true,
        carouselSlideOverrides: getDefaultCarouselSlideOverrides(),
        heroLabel: 'LOOK@ZAKANDA PRESENTS',
        heroTitle: 'Black Warrior: Land, Legacy & Liberation',
        heroSubtitle: 'A cinematic spotlight on generational Black land stewardship.',
        heroDescription: 'Discover the families preserving generations of Black land ownership in Alabama.',
        ctaPrimaryLabel: 'Watch Now',
        ctaPrimaryTarget: '/watch',
        ctaSecondaryLabel: 'Learn More',
        ctaSecondaryTarget: '/series/neon-vengeance',
        campaignType: 'editorial_story',
        featuredCollection: 'Black Legacy Stories',
        featuredSeries: 'Neon Vengeance',
        storyStatus: 'draft',
        storyScheduledFor: ''
    };
}

/** @returns {HeroManagerConfig} */
export function loadHeroManagerConfig() {
    if (typeof window === 'undefined') return getDefaultHeroManagerConfig();
    try {
        const raw = localStorage.getItem(HERO_MANAGER_STORAGE_KEY);
        if (!raw) return getDefaultHeroManagerConfig();
        const parsed = JSON.parse(raw);
        const resolvedHeroAssetId = String(
            parsed.heroAssetId || parsed.backgroundAsset || ''
        ).trim();
        const config = {
            ...getDefaultHeroManagerConfig(),
            ...parsed,
            heroAssetId: resolvedHeroAssetId,
            spotlightPriority: Array.isArray(parsed.spotlightPriority)
                ? parsed.spotlightPriority.filter((type) =>
                      HERO_DISCOVERY_TYPES.includes(type) || HERO_MODES.includes(type)
                  )
                : getDefaultHeroManagerConfig().spotlightPriority,
            seasonalCampaigns: Array.isArray(parsed.seasonalCampaigns)
                ? parsed.seasonalCampaigns.map((campaign) => ({
                      ...campaign,
                      scheduleStart: String(campaign?.scheduleStart || ''),
                      scheduleEnd: String(campaign?.scheduleEnd || '')
                  }))
                : getDefaultHeroManagerConfig().seasonalCampaigns,
            carouselDurationMs:
                Number(parsed.carouselDurationMs) > 1000
                    ? Number(parsed.carouselDurationMs)
                    : getDefaultHeroManagerConfig().carouselDurationMs,
            carouselTransitionStyle: HERO_CAROUSEL_TRANSITIONS.includes(parsed.carouselTransitionStyle)
                ? parsed.carouselTransitionStyle
                : getDefaultHeroManagerConfig().carouselTransitionStyle,
            carouselPriority: HERO_SLIDE_TYPES.includes(parsed.carouselPriority)
                ? parsed.carouselPriority
                : getDefaultHeroManagerConfig().carouselPriority,
            heroTypography:
                typeof parsed.heroTypography === 'string' && parsed.heroTypography.trim()
                    ? parsed.heroTypography
                    : getDefaultHeroManagerConfig().heroTypography,
            autoplayEnabled:
                typeof parsed.autoplayEnabled === 'boolean'
                    ? parsed.autoplayEnabled
                    : getDefaultHeroManagerConfig().autoplayEnabled,
            heroLabel:
                typeof parsed.heroLabel === 'string'
                    ? parsed.heroLabel
                    : getDefaultHeroManagerConfig().heroLabel,
            heroTitle:
                typeof parsed.heroTitle === 'string'
                    ? parsed.heroTitle
                    : getDefaultHeroManagerConfig().heroTitle,
            heroSubtitle:
                typeof parsed.heroSubtitle === 'string'
                    ? parsed.heroSubtitle
                    : getDefaultHeroManagerConfig().heroSubtitle,
            heroDescription:
                typeof parsed.heroDescription === 'string'
                    ? parsed.heroDescription
                    : getDefaultHeroManagerConfig().heroDescription,
            ctaPrimaryLabel:
                typeof parsed.ctaPrimaryLabel === 'string'
                    ? parsed.ctaPrimaryLabel
                    : getDefaultHeroManagerConfig().ctaPrimaryLabel,
            ctaPrimaryTarget:
                typeof parsed.ctaPrimaryTarget === 'string'
                    ? parsed.ctaPrimaryTarget
                    : getDefaultHeroManagerConfig().ctaPrimaryTarget,
            ctaSecondaryLabel:
                typeof parsed.ctaSecondaryLabel === 'string'
                    ? parsed.ctaSecondaryLabel
                    : getDefaultHeroManagerConfig().ctaSecondaryLabel,
            ctaSecondaryTarget:
                typeof parsed.ctaSecondaryTarget === 'string'
                    ? parsed.ctaSecondaryTarget
                    : getDefaultHeroManagerConfig().ctaSecondaryTarget,
            campaignType:
                typeof parsed.campaignType === 'string'
                    ? parsed.campaignType
                    : getDefaultHeroManagerConfig().campaignType,
            featuredCollection:
                typeof parsed.featuredCollection === 'string'
                    ? parsed.featuredCollection
                    : getDefaultHeroManagerConfig().featuredCollection,
            featuredSeries:
                typeof parsed.featuredSeries === 'string'
                    ? parsed.featuredSeries
                    : getDefaultHeroManagerConfig().featuredSeries,
            storyStatus:
                parsed.storyStatus === 'published' || parsed.storyStatus === 'scheduled'
                    ? parsed.storyStatus
                    : 'draft',
            storyScheduledFor:
                typeof parsed.storyScheduledFor === 'string'
                    ? parsed.storyScheduledFor
                    : getDefaultHeroManagerConfig().storyScheduledFor,
            carouselSlideOverrides: Array.isArray(parsed.carouselSlideOverrides)
                ? parsed.carouselSlideOverrides
                      .map((override) => ({
                          type: HERO_SLIDE_TYPES.includes(override?.type)
                              ? override.type
                              : null,
                          order: Number(override?.order) || 0,
                          durationMs: Math.max(2500, Number(override?.durationMs) || 8000),
                          enabled: override?.enabled !== false
                      }))
                      .filter((override) => Boolean(override.type))
                : getDefaultHeroManagerConfig().carouselSlideOverrides
        };
        console.info('[HERO_LOAD]', {
            key: HERO_MANAGER_STORAGE_KEY,
            backgroundSource: config.backgroundSource,
            heroAssetId: config.heroAssetId || '',
            ts: new Date().toISOString()
        });
        return config;
    } catch {
        return getDefaultHeroManagerConfig();
    }
}

/**
 * @typedef {Object} HeroCarouselSlide
 * @property {string} id
 * @property {typeof HERO_SLIDE_TYPES[number]} type
 * @property {string} title
 * @property {string} subtitle
 * @property {string} [detail]
 * @property {string} [videoUrl]
 * @property {string} [imageUrl]
 * @property {string} [countdownLabel]
 * @property {number} durationMs
 * @property {number} priority
 * @property {Record<string, unknown>} [meta]
 */

/**
 * @param {Record<string, unknown> | Record<string, unknown>[]} feed
 * @param {{ seriesId?: string; limit?: number }} [options]
 * @returns {HeroCarouselSlide[]}
 */
export function buildHeroCarouselSlides(feed, options = {}) {
    const config = loadHeroManagerConfig();
    const feedReels = flattenFeedReels(feed);
    const seriesId = options.seriesId || FEATURED_SERIES_ID;
    const limit = Math.max(3, Number(options.limit) || 10);
    const defaultDurationMs = Math.max(2500, Number(config.carouselDurationMs) || 8000);
    const selected = selectHeroContent(config.heroType, feedReels, { seriesId });
    const featured = buildFeaturedReleaseCandidate(feedReels, seriesId);
    const upcoming = buildUpcomingReleaseCandidate(feedReels, seriesId);
    const team = buildTeamPickCandidate(feedReels);
    const creator = buildCreatorSpotlightCandidate(feedReels);
    const revenue = buildRevenueMilestoneCandidate(feedReels, seriesId);
    const sentinel = typeof window !== 'undefined'
        ? window.__reelforgeSentinel?.masterAnalysis?.(seriesId, feedReels, { emitDiagnostics: false })
        : null;
    const listings = searchMarketplaceListings({ activeOnly: true }).slice(0, 1);
    const now = Date.now();
    const activeCampaign = config.seasonalCampaigns.find(
        (item) => item.active && isCampaignScheduledActive(item, now)
    );

    /** @type {HeroCarouselSlide[]} */
    const slides = [];

    if (selected?.videoUrl) {
        slides.push({
            id: `slide-video:${selected.reelId || selected.title}`,
            type: 'video',
            title: selected.title,
            subtitle: selected.insight || selected.subtitle || 'Cinematic spotlight',
            detail: selected.seriesTitle || '',
            videoUrl: selected.videoUrl,
            imageUrl: selected.posterUrl || '',
            durationMs: defaultDurationMs,
            priority: config.carouselPriority === 'video' ? 0 : 2,
            meta: { source: selected.source }
        });
    } else {
        slides.push({
            id: 'slide-video:fallback',
            type: 'video',
            title: selected?.title || 'Featured Hero Stage',
            subtitle: selected?.insight || selected?.subtitle || 'Cinematic default loop',
            detail: selected?.seriesTitle || '',
            videoUrl: DEFAULT_HERO_BACKGROUND_VIDEO,
            imageUrl: selected?.posterUrl || '',
            durationMs: defaultDurationMs,
            priority: config.carouselPriority === 'video' ? 0 : 2,
            meta: { source: selected?.source || 'featured_series', fallback: true }
        });
    }

    if (featured) {
        slides.push({
            id: `slide-featured:${featured.episodeId || featured.seriesId || featured.title}`,
            type: 'featured_release',
            title: featured.title,
            subtitle: featured.subtitle || 'Featured release spotlight',
            detail: featured.insight || featured.seriesTitle || 'Now premiering on ReelForge',
            videoUrl: featured.videoUrl || '',
            imageUrl: featured.posterUrl || '',
            durationMs: defaultDurationMs,
            priority: config.carouselPriority === 'featured_release' ? 0 : 1,
            meta: { source: featured.source, episodeId: featured.episodeId || null }
        });
    }

    if (selected?.posterUrl) {
        slides.push({
            id: `slide-image:${selected.reelId || selected.title}`,
            type: 'image',
            title: selected.seriesTitle || selected.title,
            subtitle: selected.subtitle || selected.insight || 'Featured visual',
            detail: selected.insight || '',
            imageUrl: selected.posterUrl,
            durationMs: defaultDurationMs,
            priority: config.carouselPriority === 'image' ? 0 : 3,
            meta: { source: selected.source }
        });
    }

    const managerAsset = resolveHeroBackgroundAsset(config, null, { log: false });
    if (config.backgroundSource === 'custom_image' && managerAsset.imageUrl) {
        slides.push({
            id: `slide-admin-image:${managerAsset.assetId || 'custom'}`,
            type: 'admin_image',
            title: 'Admin Image Campaign',
            subtitle: 'Curated visual from Hero Manager',
            detail: managerAsset.assetId ? `Asset ${managerAsset.assetId}` : 'Asset registry override',
            imageUrl: managerAsset.imageUrl,
            durationMs: defaultDurationMs,
            priority: config.carouselPriority === 'admin_image' ? 0 : 2,
            meta: { source: 'hero_manager' }
        });
    }

    if (config.backgroundSource === 'custom_video' && managerAsset.videoUrl) {
        slides.push({
            id: `slide-admin-video:${managerAsset.assetId || 'custom'}`,
            type: 'admin_video',
            title: 'Admin Video Campaign',
            subtitle: 'Cinematic override from Hero Manager',
            detail: managerAsset.assetId ? `Asset ${managerAsset.assetId}` : 'Asset registry override',
            videoUrl: managerAsset.videoUrl,
            imageUrl: managerAsset.imageUrl || selected?.posterUrl || '',
            durationMs: defaultDurationMs,
            priority: config.carouselPriority === 'admin_video' ? 0 : 2,
            meta: { source: 'hero_manager' }
        });
    }

    if (upcoming) {
        const releaseDate = String(upcoming.meta?.releaseDate || '');
        const releaseTs = releaseDate ? Date.parse(`${releaseDate}T00:00:00`) : NaN;
        const days = Number.isFinite(releaseTs) ? Math.max(0, Math.ceil((releaseTs - Date.now()) / 86400000)) : null;
        slides.push({
            id: `slide-release:${upcoming.episodeId || upcoming.title}`,
            type: 'upcoming_release',
            title: upcoming.title,
            subtitle: upcoming.subtitle || 'Upcoming release',
            detail: upcoming.meta?.releaseDate ? `Releases ${upcoming.meta.releaseDate}` : 'Release pending schedule',
            countdownLabel: days == null ? 'Coming soon' : days === 0 ? 'Today' : `${days}d`,
            imageUrl: upcoming.posterUrl || '',
            durationMs: defaultDurationMs,
            priority: config.carouselPriority === 'upcoming_release' ? 0 : 1,
            meta: { source: upcoming.source, daysUntilLaunch: days }
        });
    }

    if (team) {
        slides.push({
            id: `slide-team:${team.seriesId || team.title}`,
            type: 'team_spotlight',
            title: 'Team Spotlight',
            subtitle: team.subtitle || team.title,
            detail: team.meta?.teamMember ? `Featuring ${team.meta.teamMember}` : 'Latest team highlight',
            imageUrl: team.posterUrl || '',
            durationMs: defaultDurationMs,
            priority: config.carouselPriority === 'team_spotlight' ? 0 : 4,
            meta: { source: team.source }
        });
    }

    if (listings[0]) {
        slides.push({
            id: `slide-market:${listings[0].listingId}`,
            type: 'marketplace_spotlight',
            title: 'Marketplace Spotlight',
            subtitle: listings[0].service.title,
            detail: listings[0].categoryLabel || listings[0].service.category || 'Creator marketplace',
            durationMs: defaultDurationMs,
            priority: config.carouselPriority === 'marketplace_spotlight' ? 0 : 5,
            meta: { listingId: listings[0].listingId }
        });
    }

    if (revenue) {
        slides.push({
            id: `slide-revenue:${seriesId}`,
            type: 'revenue_milestone',
            title: 'Revenue Milestone',
            subtitle: revenue.subtitle,
            detail: revenue.detail,
            durationMs: defaultDurationMs,
            priority: config.carouselPriority === 'revenue_milestone' ? 0 : 6,
            meta: { mrrCents: revenue.mrrCents, arrCents: revenue.arrCents }
        });
    }

    if (creator) {
        slides.push({
            id: `slide-creator:${creator.seriesId || creator.title}`,
            type: 'creator_spotlight',
            title: 'Creator Spotlight',
            subtitle: creator.subtitle || creator.title,
            detail: creator.meta?.creatorName ? `by ${creator.meta.creatorName}` : 'Featured creator',
            imageUrl: creator.posterUrl || '',
            durationMs: defaultDurationMs,
            priority: config.carouselPriority === 'creator_spotlight' ? 0 : 6,
            meta: { source: creator.source }
        });
    }

    if (sentinel?.recommendations?.length) {
        const recommendation = sentinel.recommendations[0];
        slides.push({
            id: `slide-discovery:${seriesId}`,
            type: 'discovery_recommendation',
            title: 'Discovery Recommendation',
            subtitle: recommendation,
            detail: sentinel.executiveSummary || 'Prioritized by discovery intelligence',
            durationMs: defaultDurationMs,
            priority: config.carouselPriority === 'discovery_recommendation' ? 0 : 8,
            meta: { threatLevel: sentinel.threatLevel, riskLevel: sentinel.riskLevel }
        });
        slides.push({
            id: `slide-sentinel:${seriesId}`,
            type: 'sentinel_recommendation',
            title: 'Sentinel Recommendation',
            subtitle: recommendation,
            detail: sentinel.executiveSummary || '',
            durationMs: defaultDurationMs,
            priority: config.carouselPriority === 'sentinel_recommendation' ? 0 : 9,
            meta: { threatLevel: sentinel.threatLevel, riskLevel: sentinel.riskLevel }
        });
    }

    const overrideMap = new Map(
        (config.carouselSlideOverrides || []).map((override) => [override.type, override])
    );

    const ranked = slides
        .filter((slide) => {
            const override = overrideMap.get(slide.type);
            return override?.enabled !== false;
        })
        .map((slide) => {
            const override = overrideMap.get(slide.type);
            const order = Number.isFinite(override?.order) ? Number(override.order) : slide.priority + 1;
            const durationMs = Math.max(
                2500,
                Number(override?.durationMs || slide.durationMs || defaultDurationMs)
            );
            return {
                ...slide,
                durationMs,
                priority: config.carouselPriority === slide.type ? -1 : order
            };
        })
        .sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title))
        .slice(0, limit);

    logHeroIntelligenceDiag('HERO_CAROUSEL', {
        slideCount: ranked.length,
        transitionStyle: config.carouselTransitionStyle,
        durationMs: defaultDurationMs,
        priority: config.carouselPriority,
        autoplayEnabled: config.autoplayEnabled !== false
    });
    for (const slide of ranked.slice(0, 8)) {
        logHeroIntelligenceDiag('HERO_SLIDE', {
            id: slide.id,
            type: slide.type,
            title: slide.title,
            durationMs: slide.durationMs,
            priority: slide.priority
        });
    }
    logHeroIntelligenceDiag('HERO_CAMPAIGN', {
        activeCampaignId: activeCampaign?.id || null,
        activeCampaignLabel: activeCampaign?.label || null,
        scheduled: Boolean(activeCampaign),
        scheduleStart: activeCampaign?.scheduleStart || null,
        scheduleEnd: activeCampaign?.scheduleEnd || null
    });

    return ranked;
}

/** @param {Partial<HeroManagerConfig>} patch */
export function saveHeroManagerConfig(patch = {}) {
    const merged = { ...loadHeroManagerConfig(), ...patch };
    const registry = buildHeroAssetRegistry(loadHeroVaultItems());
    if (!merged.heroAssetId) {
        const legacyAssetId = String(merged.backgroundAsset || '').trim();
        const legacyMediaUrl = String(merged.backgroundVideo || merged.backgroundImage || '').trim();
        const resolvedFromLegacyId = legacyAssetId
            ? resolveHeroAssetById(legacyAssetId, loadHeroVaultItems())
            : null;
        const resolvedFromLegacyUrl = legacyMediaUrl
            ? registry.find((asset) => asset.mediaUrl === (toRelativeMediaPath(legacyMediaUrl) || legacyMediaUrl))
            : null;
        merged.heroAssetId = String(
            resolvedFromLegacyId?.assetId || resolvedFromLegacyUrl?.assetId || legacyAssetId || ''
        ).trim();
    }

    const {
        backgroundAsset: _legacyAsset,
        backgroundVideo: _legacyVideo,
        backgroundImage: _legacyImage,
        ...sanitized
    } = merged;
    const next = {
        ...sanitized,
        heroAssetId: String(sanitized.heroAssetId || '').trim(),
        updatedAt: Date.now()
    };
    if (typeof window !== 'undefined') {
        localStorage.setItem(HERO_MANAGER_STORAGE_KEY, JSON.stringify(next));
        console.info('[HERO_ASSET_ID_TRACE]', {
            stage: 'saveHeroManagerConfig:write',
            assetId: next.heroAssetId || '',
            heroAssetId: next.heroAssetId || '',
            source: 'reelforge_hero_manager_config',
            timestamp: Date.now()
        });
        console.info('[HERO_SAVE]', {
            key: HERO_MANAGER_STORAGE_KEY,
            heroAssetId: next.heroAssetId || '',
            backgroundSource: next.backgroundSource || '',
            ts: new Date().toISOString()
        });
        console.info('[HERO_STORE_WRITE]', {
            key: HERO_MANAGER_STORAGE_KEY,
            heroAssetId: next.heroAssetId || '',
            backgroundSource: next.backgroundSource || '',
            ts: new Date().toISOString()
        });
        console.info('[HERO_VAULT_INSERT]', {
            source: 'hero-manager-config',
            heroAssetId: next.heroAssetId || '',
            backgroundSource: next.backgroundSource || '',
            ts: new Date().toISOString()
        });
        logHeroIntelligenceDiag('HERO_BACKGROUND_SAVE', {
            storageKey: HERO_MANAGER_STORAGE_KEY,
            backgroundSource: next.backgroundSource,
            heroAssetId: next.heroAssetId || ''
        });
        if (next.backgroundSource === 'custom_image') {
            const previewResolved = resolveHeroBackgroundAsset(next, null, { log: false });
            logHeroImagePipeline('hero-save', {
                assetId: next.heroAssetId || previewResolved.assetId || '',
                assetType: previewResolved.assetType || 'image',
                mediaUrl: previewResolved.mediaUrl || '',
                resolved: Boolean(previewResolved.imageUrl)
            });
        }
        window.dispatchEvent(new CustomEvent('reelforge:hero-manager-updated', { detail: next }));
    }
    return next;
}

/** @param {string | null | undefined} type */
export function normalizeDiscoveryHeroType(type) {
    const upper = String(type || 'TRENDING').toUpperCase();
    if (HERO_DISCOVERY_TYPES.includes(/** @type {typeof HERO_DISCOVERY_TYPES[number]} */ (upper))) {
        return /** @type {typeof HERO_DISCOVERY_TYPES[number]} */ (upper);
    }
    const legacyMap = {
        UPCOMING_RELEASE: 'UPCOMING_PREMIERE',
        MOST_WATCHED: 'TRENDING',
        HIGHEST_COMPLETION: 'CONTINUE_WATCHING',
        TEAM_PICK: 'TEAM_SPOTLIGHT',
        CREATOR_SPOTLIGHT: 'STUDIO_PRIORITY',
        EDITORS_CHOICE: 'FEATURED_RELEASE'
    };
    if (legacyMap[upper]) return legacyMap[upper];
    return 'TRENDING';
}

/** @returns {Record<string, unknown>[]} */
export function loadHeroVaultItems() {
    if (typeof window === 'undefined') return [];
    try {
        migrateLegacyHeroStorageIfNeeded();
        const manager = loadHeroManagerConfig();
        const reel = loadHeroReel();
        if (!reel?.id || !reel?.url) return [];
        if (String(manager?.heroAssetId || '').trim() !== reel.id) return [];
        console.info('[HERO_STORE_READ]', {
            stage: 'loadHeroVaultItems',
            key: HERO_REEL_STORAGE_KEY,
            id: reel.id,
            fileName: reel.fileName,
            url: reel.url,
            ts: new Date().toISOString()
        });
        return [heroReelToVaultItem(reel)];
    } catch {
        return [];
    }
}

/**
 * @param {string | null | undefined} url
 * @param {string | null | undefined} [mimeHint]
 */
export function inferHeroAssetType(url, mimeHint = '') {
    const lower = String(url || '').toLowerCase();
    const mime = String(mimeHint || '').toLowerCase();
    if (mime.startsWith('video/') || HERO_VIDEO_EXTENSIONS.test(lower)) {
        if (lower.endsWith('.mp4')) return 'mp4';
        if (lower.endsWith('.webm')) return 'webm';
        if (lower.endsWith('.mov')) return 'mov';
        return 'video';
    }
    if (mime.startsWith('image/') || HERO_IMAGE_EXTENSIONS.test(lower)) {
        if (lower.endsWith('.png')) return 'png';
        if (lower.endsWith('.webp')) return 'webp';
        if (lower.endsWith('.gif')) return 'gif';
        return 'jpg';
    }
    return 'unknown';
}

/**
 * @param {HeroManagerConfig} [config]
 * @param {Record<string, unknown>[] | null} [vaultItems]
 * @param {{ log?: boolean }} [options]
 * @returns {HeroBackgroundAssetResolution}
 */
export function resolveHeroBackgroundAsset(config = loadHeroManagerConfig(), vaultItems = null, options = {}) {
    const items = vaultItems || loadHeroVaultItems();
    const heroAssetId = String(config.heroAssetId || config.backgroundAsset || '').trim();
    const canonicalReel = loadHeroReel();
    console.info('[HERO_CLASSIFY]', {
        stage: 'resolveHeroBackgroundAsset:start',
        heroAssetId,
        canonicalReelId: canonicalReel?.id || '',
        backgroundSource: config.backgroundSource || '',
        vaultItemsCount: Array.isArray(items) ? items.length : 0,
        ts: new Date().toISOString()
    });

    let bridgeAsset = null;
    if (canonicalReel?.id && canonicalReel?.url && heroAssetId === canonicalReel.id) {
        bridgeAsset = normalizeHeroAssetRecord(heroReelToVaultItem(canonicalReel), {
            storageSource: 'hero_reel'
        });
    }
    if (!bridgeAsset) {
        bridgeAsset = resolveHeroAssetById(heroAssetId, items);
    }
    const resolvedAsset = bridgeAsset;
    const mediaUrl = resolvedAsset?.mediaUrl || '';
    const resolvedAssetType = resolvedAsset?.assetType || 'unknown';
    const videoUrl = isVideoHeroAssetType(resolvedAssetType) ? mediaUrl : '';
    const imageUrl = isVideoHeroAssetType(resolvedAssetType)
        ? resolvedAsset?.thumbnailUrl || ''
        : mediaUrl;

    const resolved = {
        assetId: canonicalReel?.id || heroAssetId || resolvedAsset?.assetId || '',
        vaultMatch: Boolean(bridgeAsset),
        mediaUrl,
        assetType: resolvedAssetType,
        videoUrl,
        imageUrl
    };
    console.info('[HERO_ASSET_ID_TRACE]', {
        stage: 'resolveHeroBackgroundAsset:resolved',
        assetId: resolved.assetId || '',
        heroAssetId,
        source: 'resolveHeroBackgroundAsset',
        timestamp: Date.now()
    });
    console.info('[HERO_ROUTE]', {
        stage: 'resolveHeroBackgroundAsset:resolved',
        heroAssetId,
        resolvedAssetId: resolved.assetId || '',
        assetType: resolved.assetType || '',
        mediaUrl: resolved.mediaUrl || '',
        videoUrl: resolved.videoUrl || '',
        imageUrl: resolved.imageUrl || '',
        vaultMatch: resolved.vaultMatch,
        ts: new Date().toISOString()
    });

    if (options.log !== false) {
        const signature = `${resolved.assetId}|${resolved.mediaUrl}|${resolved.assetType}|${config.backgroundSource}`;
        if (signature !== lastAssetResolveSignature) {
            lastAssetResolveSignature = signature;
            logHeroIntelligenceDiag('HERO_ASSET_RESOLVE', {
                assetId: resolved.assetId,
                vaultMatch: resolved.vaultMatch,
                mediaUrl: resolved.mediaUrl,
                assetType: resolved.assetType
            });
        }
    }

    if (config.backgroundSource === 'custom_image') {
        logHeroImagePipeline('asset-resolve', {
            assetId: resolved.assetId,
            assetType: resolved.assetType,
            mediaUrl: resolved.mediaUrl,
            resolved: Boolean(resolved.imageUrl)
        });
    }

    return resolved;
}

/**
 * @param {HeroManagerConfig} [config]
 * @param {{ setVideo?: (url: string) => void; setPoster?: (url: string) => void; setFailed?: (failed: boolean) => void }} [stores]
 * @param {{ vaultItems?: Record<string, unknown>[] | null; respectSelection?: boolean }} [options]
 */
export function applyHeroManagerBackground(config = loadHeroManagerConfig(), stores = {}, options = {}) {
    if (options.respectSelection !== false && config.backgroundSource === 'selection') {
        return false;
    }

    const resolved = resolveHeroBackgroundAsset(config, options.vaultItems ?? null, { log: true });

    if (config.backgroundSource === 'custom_video' && resolved.videoUrl && stores.setVideo) {
        stores.setVideo(resolved.videoUrl);
        stores.setFailed?.(false);
        if (resolved.imageUrl && stores.setPoster) {
            stores.setPoster(resolved.imageUrl);
        }
        logHeroIntelligenceDiag('HERO_ASSET_TYPE', {
            assetType: resolved.assetType,
            mediaUrl: resolved.mediaUrl
        });
        return true;
    }

    if (config.backgroundSource === 'custom_image' && resolved.imageUrl && stores.setPoster && stores.setVideo) {
        stores.setPoster(resolved.imageUrl);
        stores.setVideo('');
        stores.setFailed?.(false);
        logHeroIntelligenceDiag('HERO_ASSET_TYPE', {
            assetType: resolved.assetType,
            mediaUrl: resolved.mediaUrl
        });
        logHeroImagePipeline('store-update', {
            assetId: resolved.assetId,
            assetType: resolved.assetType,
            mediaUrl: resolved.mediaUrl,
            resolved: true
        });
        return true;
    }

    if (config.backgroundSource === 'custom_image') {
        logHeroImagePipeline('store-update', {
            assetId: resolved.assetId,
            assetType: resolved.assetType,
            mediaUrl: resolved.mediaUrl,
            resolved: false
        });
    }

    return false;
}

/** @param {HeroManagerConfig} [config] @returns {HeroBackgroundPresentation} */
export function resolveHeroBackgroundPresentation(config = loadHeroManagerConfig(), vaultItems = null) {
    const style = HERO_BACKGROUND_STYLES.includes(config.backgroundStyle)
        ? config.backgroundStyle
        : 'gradient_overlay';
    const resolved = resolveHeroBackgroundAsset(config, vaultItems, { log: true });

    return {
        style,
        containerClasses: [
            style === 'ambient_motion' ? 'hero-bg-ambient-motion' : '',
            style === 'cinematic_blur' ? 'hero-bg-cinematic-blur' : ''
        ].filter(Boolean),
        overlayClasses: [
            style === 'gradient_overlay' ? 'hero-bg-gradient-overlay' : '',
            style === 'cinematic_blur' ? 'hero-bg-cinematic-overlay' : ''
        ].filter(Boolean),
        useVideo: style === 'video' || config.backgroundSource === 'custom_video' || style === 'ambient_motion',
        useImage: style === 'image' || config.backgroundSource === 'custom_image',
        ambientMotion: style === 'ambient_motion',
        cinematicBlur: style === 'cinematic_blur',
        gradientOverlay: style === 'gradient_overlay',
        backgroundSource: config.backgroundSource,
        backgroundAsset: config.heroAssetId || '',
        heroAssetId: config.heroAssetId || '',
        assetId: resolved.assetId,
        vaultMatch: resolved.vaultMatch,
        mediaUrl: resolved.mediaUrl,
        assetType: resolved.assetType,
        videoUrl: resolved.videoUrl,
        imageUrl: resolved.imageUrl
    };
}

/** @type {Record<typeof HERO_MODES[number], typeof HERO_SOURCES[number]>} */
export const MODE_SOURCE_MAP = {
    TRENDING: 'trending',
    MOST_WATCHED: 'most_watched',
    HIGHEST_COMPLETION: 'highest_completion',
    UPCOMING_RELEASE: 'upcoming_release',
    CREATOR_SPOTLIGHT: 'creator_spotlight',
    TEAM_PICK: 'team_pick',
    EDITORS_CHOICE: 'editors_choice'
};

/** @type {Record<string, typeof HERO_MODES[number]>} */
export const LEGACY_MODE_ALIASES = {
    CINEMATIC: 'HIGHEST_COMPLETION',
    SERIES_SPOTLIGHT: 'EDITORS_CHOICE',
    CREATOR_PICK: 'CREATOR_SPOTLIGHT'
};

const FEATURED_SERIES_ID = 'series-neon-vengeance';

/**
 * @typedef {Object} HeroScoreBreakdown
 * @property {number} views
 * @property {number} completionRate
 * @property {number} releasePriority
 * @property {number} teamPriority
 * @property {number} publishingStatus
 * @property {number} total
 */

/**
 * @typedef {Object} HeroCandidate
 * @property {typeof HERO_SOURCES[number]} source
 * @property {string} title
 * @property {string} subtitle
 * @property {string} [seriesId]
 * @property {string} [seriesTitle]
 * @property {string} [episodeId]
 * @property {string} [reelId]
 * @property {string} [videoUrl]
 * @property {string} [posterUrl]
 * @property {number} score
 * @property {HeroScoreBreakdown} [scoreBreakdown]
 * @property {string} [insight]
 * @property {Record<string, unknown>} [meta]
 */

/**
 * @typedef {HeroCandidate & { mode: typeof HERO_MODES[number] }} HeroSelection
 */

/**
 * @typedef {Object} HeroCommandPrimaryCard
 * @property {string} seriesId
 * @property {string} seriesTitle
 * @property {number} readinessPercent
 * @property {string} biggestBlocker
 */

/**
 * @typedef {Object} HeroCommandSecondaryCard
 * @property {string} id
 * @property {string} label
 * @property {string} value
 * @property {string} [detail]
 */

/**
 * @typedef {Object} HeroCommandBrief
 * @property {string} seriesId
 * @property {HeroCommandPrimaryCard} primary
 * @property {HeroCommandSecondaryCard[]} secondary
 * @property {Record<string, unknown>} aggregates
 */

/**
 * @param {'HERO_INTELLIGENCE' | 'HERO_SELECTION' | 'HERO_SCORE' | 'HERO_BLOCKER' | 'HERO_RECOMMENDATION' | 'HERO_ROTATION' | 'HERO_TRANSITION' | 'HERO_CAMPAIGN' | 'HERO_PRIORITY' | 'HERO_CAROUSEL' | 'HERO_SLIDE' | 'HERO_BACKGROUND_SAVE' | 'HERO_ASSET_RESOLVE' | 'HERO_RENDER' | 'HERO_VISIBILITY' | 'HERO_ASSET_TYPE' | 'HERO_CERTIFICATION' | 'HERO_RENDER_SUCCESS' | 'HERO_RENDER_FAILURE'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logHeroIntelligenceDiag(tag, detail = {}) {
    const key = `${tag}:${JSON.stringify(detail)}`;
    const now = Date.now();
    const lastAt = heroDiagMemo.get(key) || 0;
    if (now - lastAt < HERO_DIAG_COOLDOWN_MS) return;
    heroDiagMemo.set(key, now);
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @param {string | null | undefined} mode */
export function normalizeHeroMode(mode) {
    const upper = String(mode || 'TRENDING').toUpperCase();
    if (HERO_MODES.includes(/** @type {typeof HERO_MODES[number]} */ (upper))) {
        return /** @type {typeof HERO_MODES[number]} */ (upper);
    }
    if (LEGACY_MODE_ALIASES[upper]) return LEGACY_MODE_ALIASES[upper];
    return 'TRENDING';
}

/**
 * @param {Record<string, unknown> | Record<string, unknown>[]} feed
 * @returns {Record<string, unknown>[]}
 */
export function flattenFeedReels(feed) {
    if (Array.isArray(feed)) return feed.filter(Boolean);
    if (!feed || typeof feed !== 'object') return [];
    return Object.values(feed).flat().filter(Boolean);
}

/**
 * @param {Record<string, unknown>[]} feedReels
 * @param {string | null | undefined} reelId
 */
export function findReelInFeedList(feedReels, reelId) {
    if (!reelId) return null;
    return (
        feedReels.find(
            (reel) =>
                reel?.id === reelId ||
                reel?.reelId === reelId ||
                String(reel?.id || '') === String(reelId)
        ) || null
    );
}

/**
 * @param {Record<string, unknown> | null | undefined} reel
 * @param {string} [seriesPoster]
 */
export function resolveReelMedia(reel, seriesPoster = '') {
    const videoUrl = String(reel?.url || reel?.video_url || reel?.videoUrl || '').trim();
    const posterUrl = String(
        reel?.poster ||
            reel?.thumbnail ||
            reel?.thumb ||
            reel?.thumbnailUrl ||
            reel?.thumbnail_url ||
            seriesPoster ||
            ''
    ).trim();
    return { videoUrl, posterUrl };
}

/**
 * @param {HeroCandidate} candidate
 * @returns {HeroScoreBreakdown}
 */
export function scoreHeroCandidate(candidate) {
    const scoreMemoKey = JSON.stringify({
        source: candidate.source,
        episodeId: candidate.episodeId || null,
        reelId: candidate.reelId || null,
        title: candidate.title || '',
        views: Number(candidate.meta?.views || 0),
        completionPercent: Number(candidate.meta?.completionPercent || 0),
        daysUntilLaunch: candidate.meta?.daysUntilLaunch ?? null,
        releaseStatus: String(candidate.meta?.releaseStatus || candidate.meta?.episodeStatus || ''),
        teamActivity: Boolean(candidate.meta?.teamActivity),
        creatorName: String(candidate.meta?.creatorName || '')
    });
    const now = Date.now();
    const cached = heroScoreMemo.get(scoreMemoKey);
    if (cached && now - cached.at < HERO_SCORE_MEMO_TTL_MS) {
        return cached.value;
    }

    const views = Math.min(Number(candidate.meta?.views || 0), 100);
    const completionRate = Math.min(Number(candidate.meta?.completionPercent || 0), 100);
    const daysUntilLaunch =
        candidate.meta?.daysUntilLaunch == null ? null : Number(candidate.meta.daysUntilLaunch);
    let releasePriority = 20;
    if (daysUntilLaunch === 0) releasePriority = 100;
    else if (daysUntilLaunch === 1) releasePriority = 95;
    else if (daysUntilLaunch != null && daysUntilLaunch <= 7) releasePriority = 75;
    else if (candidate.source === 'upcoming_release') releasePriority = 60;

    const teamPriority =
        candidate.source === 'team_pick'
            ? 90
            : candidate.meta?.teamActivity
              ? 65
              : candidate.meta?.creatorName
                ? 45
                : 15;

    const status = String(candidate.meta?.releaseStatus || candidate.meta?.episodeStatus || '').toLowerCase();
    let publishingStatus = 35;
    if (status === 'published') publishingStatus = 85;
    else if (status === 'ready') publishingStatus = 75;
    else if (status === 'scheduled') publishingStatus = 70;

    const total = Math.round(
        views * 0.25 +
            completionRate * 0.25 +
            releasePriority * 0.2 +
            teamPriority * 0.15 +
            publishingStatus * 0.15
    );

    const breakdown = {
        views,
        completionRate,
        releasePriority,
        teamPriority,
        publishingStatus,
        total
    };

    logHeroIntelligenceDiag('HERO_SCORE', {
        source: candidate.source,
        episodeId: candidate.episodeId || null,
        ...breakdown
    });

    heroScoreMemo.set(scoreMemoKey, { at: now, value: breakdown });
    return breakdown;
}

/**
 * @param {HeroCandidate} candidate
 * @param {typeof HERO_MODES[number]} mode
 */
export function buildHeroInsight(candidate, mode) {
    const completion = Math.round(Number(candidate.meta?.completionPercent || candidate.scoreBreakdown?.completionRate || 0));
    const views = Number(candidate.meta?.views || 0);
    const daysUntilLaunch = candidate.meta?.daysUntilLaunch;

    switch (mode) {
        case 'MOST_WATCHED':
            return views > 0 ? `Most Watched This Week · ${views} views` : 'Most Watched This Week';
        case 'TRENDING':
            return views > 0 ? `Trending Now · ${views} views` : 'Most Watched This Week';
        case 'HIGHEST_COMPLETION':
            return completion > 0 ? `${completion}% Completion Rate` : 'Highest Completion Rate';
        case 'UPCOMING_RELEASE':
            if (daysUntilLaunch === 0) return 'Launching Today';
            if (daysUntilLaunch === 1) return 'Launching Tomorrow';
            if (daysUntilLaunch != null) return `Launching in ${daysUntilLaunch} days`;
            return 'Upcoming Release';
        case 'CREATOR_SPOTLIGHT':
            return candidate.meta?.creatorName
                ? `Creator Spotlight · ${candidate.meta.creatorName}`
                : 'Creator Spotlight';
        case 'TEAM_PICK':
            return candidate.meta?.teamMember
                ? `Team Pick · ${candidate.meta.teamMember}`
                : 'Team Pick';
        case 'EDITORS_CHOICE':
            return "Editor's Choice";
        case 'FEATURED_RELEASE':
        case 'UPCOMING_PREMIERE':
            if (daysUntilLaunch === 0) return 'Featured Release · Launching Today';
            if (daysUntilLaunch === 1) return 'Featured Release · Launching Tomorrow';
            if (daysUntilLaunch != null) return `Featured Release · ${daysUntilLaunch} days out`;
            return 'Featured Release Spotlight';
        case 'CONTINUE_WATCHING':
            return completion > 0 ? `Continue Watching · ${completion}% complete` : 'Continue Watching';
        case 'TEAM_SPOTLIGHT':
            return candidate.meta?.teamMember
                ? `Team Spotlight · ${candidate.meta.teamMember}`
                : 'Team Spotlight';
        case 'STUDIO_PRIORITY':
            return candidate.meta?.studioPriority
                ? `Studio Priority · ${candidate.meta.studioPriority}`
                : 'Studio Priority Spotlight';
        default:
            return candidate.subtitle || 'Featured on ReelForge';
    }
}

/**
 * @param {string} episodeId
 * @param {Record<string, unknown>[]} feedReels
 * @param {typeof HERO_SOURCES[number]} source
 * @param {number} score
 * @param {string} subtitle
 * @param {Record<string, unknown>} [meta]
 * @returns {HeroCandidate | null}
 */
function candidateFromEpisode(episodeId, feedReels, source, score, subtitle, meta = {}) {
    const ctx = getEpisodeById(episodeId);
    if (!ctx) return null;
    const { series, episode } = ctx;
    const reel =
        findReelInFeedList(feedReels, episode.reelId) ||
        findReelInFeedList(feedReels, String(episode.reelId || ''));
    const media = resolveReelMedia(reel, series.poster || '');
    const candidate = {
        source,
        title: episode.title || series.title,
        subtitle: subtitle || series.description || '',
        seriesId: series.id,
        seriesTitle: series.title,
        episodeId: episode.episodeId,
        reelId: reel?.id ? String(reel.id) : episode.reelId || undefined,
        videoUrl: media.videoUrl || undefined,
        posterUrl: media.posterUrl || series.poster || undefined,
        score,
        meta: {
            ...meta,
            episodeStatus: episode.status
        }
    };
    candidate.scoreBreakdown = scoreHeroCandidate(candidate);
    candidate.score = candidate.scoreBreakdown.total;
    return candidate;
}

/** @param {Record<string, unknown>[]} feedReels */
function buildMostWatchedCandidate(feedReels) {
    const snapshot = getOperationsSnapshot();
    const top = snapshot.mostWatchedEpisodes?.[0];
    if (!top?.episodeId) return null;
    return candidateFromEpisode(
        top.episodeId,
        feedReels,
        'most_watched',
        80,
        `Fan favorite · ${top.views || 0} views this week`,
        { views: top.views || 0 }
    );
}

/** @param {Record<string, unknown>[]} feedReels */
function buildTrendingCandidate(feedReels) {
    const mostWatched = buildMostWatchedCandidate(feedReels);
    if (!mostWatched) return null;
    return {
        ...mostWatched,
        source: 'trending',
        subtitle: `Trending now · ${mostWatched.meta?.views || 0} views this week`
    };
}

/** @param {Record<string, unknown>[]} feedReels */
function buildHighestCompletionCandidate(feedReels) {
    const progress = loadWatchProgressMap();
    const entries = Object.entries(progress)
        .map(([key, value]) => ({ key, percent: Number(value) || 0 }))
        .filter((entry) => entry.percent > 0)
        .sort((a, b) => b.percent - a.percent);

    for (const entry of entries) {
        const byEpisode = getEpisodeById(entry.key);
        const episodeId = byEpisode?.episode?.episodeId || entry.key;
        const candidate = candidateFromEpisode(
            episodeId,
            feedReels,
            'highest_completion',
            70,
            `${entry.percent}% completion rate · fan favorite`,
            { completionPercent: entry.percent }
        );
        if (candidate) return candidate;
    }
    return null;
}

/** @param {Record<string, unknown>[]} feedReels @param {string} [seriesId] */
function buildUpcomingReleaseCandidate(feedReels, seriesId = FEATURED_SERIES_ID) {
    const release = buildReleaseCenterSnapshot(seriesId, feedReels);
    const now = Date.now();
    const upcoming = (release.calendar || [])
        .filter(
            (entry) =>
                (entry.status === 'scheduled' || entry.status === 'ready') &&
                entry.releaseDate
        )
        .map((entry) => ({
            entry,
            ts: Date.parse(`${entry.releaseDate}T${entry.releaseTime || '00:00'}:00`)
        }))
        .filter((row) => !Number.isNaN(row.ts))
        .sort((a, b) => {
            const aFuture = a.ts >= now;
            const bFuture = b.ts >= now;
            if (aFuture !== bFuture) return aFuture ? -1 : 1;
            return Math.abs(a.ts - now) - Math.abs(b.ts - now);
        });

    const next = upcoming[0]?.entry;
    if (!next?.episodeId) return null;

    const daysUntilLaunch = release.releaseHealth?.daysUntilLaunch ?? null;
    const candidate = candidateFromEpisode(
        next.episodeId,
        feedReels,
        'upcoming_release',
        85,
        release.premiereCountdown?.label || 'Upcoming premiere',
        {
            releaseDate: next.releaseDate,
            releaseStatus: next.status,
            daysUntilLaunch
        }
    );
    if (candidate && daysUntilLaunch != null) {
        candidate.scoreBreakdown = scoreHeroCandidate(candidate);
        candidate.score = candidate.scoreBreakdown.total;
    }
    return candidate;
}

/** @param {Record<string, unknown>[]} feedReels @param {string} [seriesId] */
function buildFeaturedSeriesCandidate(feedReels, seriesId = FEATURED_SERIES_ID) {
    const series = getSeriesById(seriesId) || get(get(seriesCatalog))?.[0];
    if (!series) return null;

    const published = series.seasons
        .flatMap((season) => season.episodes)
        .filter((episode) => episode.status === 'published' && episode.reelId)
        .sort((a, b) => b.episodeNumber - a.episodeNumber);

    const episode = published[0] || series.seasons[0]?.episodes[0];
    if (episode) {
        const candidate = candidateFromEpisode(
            episode.episodeId,
            feedReels,
            'featured_series',
            75,
            series.description || 'Featured series spotlight',
            { featured: true, releaseStatus: episode.status }
        );
        if (candidate) {
            return { ...candidate, title: series.title, subtitle: series.description || candidate.subtitle };
        }
    }

    const fallback = {
        source: 'featured_series',
        title: series.title,
        subtitle: series.description || 'Featured series spotlight',
        seriesId: series.id,
        seriesTitle: series.title,
        posterUrl: series.poster || undefined,
        score: 75,
        meta: { featured: true }
    };
    fallback.scoreBreakdown = scoreHeroCandidate(fallback);
    fallback.score = fallback.scoreBreakdown.total;
    return fallback;
}

/** @param {Record<string, unknown>[]} feedReels @param {string} [seriesId] */
function buildEditorsChoiceCandidate(feedReels, seriesId = FEATURED_SERIES_ID) {
    const series = getSeriesById(seriesId);
    if (!series) return buildFeaturedSeriesCandidate(feedReels, seriesId);

    const ranked = series.seasons
        .flatMap((season) => season.episodes)
        .filter((episode) => episode.status === 'published' || episode.status === 'ready')
        .map((episode) => {
            const progress = loadWatchProgressMap()[episode.episodeId] || 0;
            return { episode, progress };
        })
        .sort((a, b) => b.progress - a.progress || b.episode.episodeNumber - a.episode.episodeNumber);

    const pick = ranked[0]?.episode;
    if (!pick) return buildFeaturedSeriesCandidate(feedReels, seriesId);

    const candidate = candidateFromEpisode(
        pick.episodeId,
        feedReels,
        'editors_choice',
        78,
        "Editor's Choice · curated for spotlight",
        {
            completionPercent: ranked[0]?.progress || 0,
            releaseStatus: pick.status,
            curated: true
        }
    );
    if (candidate) {
        candidate.title = pick.title || series.title;
    }
    return candidate;
}

/** @param {Record<string, unknown>[]} feedReels */
function buildCreatorSpotlightCandidate(feedReels) {
    let creatorName = 'Creator';
    let seriesId = FEATURED_SERIES_ID;

    if (typeof window !== 'undefined') {
        try {
            const raw = localStorage.getItem(TEAM_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                const team =
                    (parsed.teams || []).find((item) => item.seriesId === FEATURED_SERIES_ID) ||
                    (parsed.teams || [])[0];
                const teamId = team?.id;
                const activity = teamId ? parsed.activity?.[teamId] || [] : [];
                const latest = activity[0];
                const members = teamId ? parsed.members?.[teamId] || [] : [];
                const owner = members.find((m) => m.role === 'OWNER') || members[0];
                creatorName =
                    latest?.displayName ||
                    latest?.display_name ||
                    owner?.displayName ||
                    owner?.display_name ||
                    creatorName;
                if (team?.seriesId) seriesId = team.seriesId;
            }
        } catch {
            /* ignore */
        }

        try {
            const raw = localStorage.getItem(METRICS_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                const publishEvents = (parsed.events || [])
                    .filter((event) => event.type === 'publish_action')
                    .sort((a, b) => b.timestamp - a.timestamp);
                if (publishEvents[0]?.seriesId) seriesId = publishEvents[0].seriesId;
            }
        } catch {
            /* ignore */
        }
    }

    const featured = buildFeaturedSeriesCandidate(feedReels, seriesId);
    if (!featured) return null;

    const candidate = {
        ...featured,
        source: 'creator_spotlight',
        subtitle: `${creatorName} picks · ${featured.subtitle || featured.seriesTitle || 'Creator spotlight'}`,
        meta: { ...(featured.meta || {}), creatorName }
    };
    candidate.scoreBreakdown = scoreHeroCandidate(candidate);
    candidate.score = candidate.scoreBreakdown.total;
    return candidate;
}

/** @param {Record<string, unknown>[]} feedReels */
function buildTeamPickCandidate(feedReels) {
    let teamMember = 'Production Team';
    let seriesId = FEATURED_SERIES_ID;
    let episodeId = null;

    if (typeof window !== 'undefined') {
        try {
            const raw = localStorage.getItem(TEAM_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                const team =
                    (parsed.teams || []).find((item) => item.seriesId === FEATURED_SERIES_ID) ||
                    (parsed.teams || [])[0];
                const teamId = team?.id;
                const activity = teamId ? parsed.activity?.[teamId] || [] : [];
                const latest = activity[0];
                teamMember = latest?.displayName || latest?.display_name || teamMember;
                if (team?.seriesId) seriesId = team.seriesId;
                if (latest?.episodeId) episodeId = latest.episodeId;
            }
        } catch {
            /* ignore */
        }
    }

    if (episodeId) {
        const candidate = candidateFromEpisode(
            episodeId,
            feedReels,
            'team_pick',
            82,
            `Team Pick · ${teamMember} recommends this episode`,
            { teamMember, teamActivity: true }
        );
        if (candidate) return candidate;
    }

    const featured = buildFeaturedSeriesCandidate(feedReels, seriesId);
    if (!featured) return null;

    const candidate = {
        ...featured,
        source: 'team_pick',
        subtitle: `Team Pick · ${teamMember} recommends this series`,
        meta: { ...(featured.meta || {}), teamMember, teamActivity: true }
    };
    candidate.scoreBreakdown = scoreHeroCandidate(candidate);
    candidate.score = candidate.scoreBreakdown.total;
    return candidate;
}

/** @param {Record<string, unknown>[]} feedReels */
function buildContinueWatchingCandidate(feedReels) {
    const progress = loadWatchProgressMap();
    const entries = Object.entries(progress)
        .map(([key, value]) => ({ key, percent: Number(value) || 0 }))
        .filter((entry) => entry.percent >= 8 && entry.percent < 98)
        .sort((a, b) => b.percent - a.percent);

    for (const entry of entries) {
        const byEpisode = getEpisodeById(entry.key);
        const episodeId = byEpisode?.episode?.episodeId || entry.key;
        const candidate = candidateFromEpisode(
            episodeId,
            feedReels,
            'continue_watching',
            88,
            `Resume at ${entry.percent}% · pick up where you left off`,
            {
                completionPercent: entry.percent,
                watchTrackingEnabled: isWatchTrackingEnabled()
            }
        );
        if (candidate) return candidate;
    }
    return buildHighestCompletionCandidate(feedReels);
}

/**
 * @param {Record<string, unknown>[]} feedReels
 * @param {string} [seriesId]
 */
function buildRevenueMilestoneCandidate(feedReels, seriesId = FEATURED_SERIES_ID) {
    const dashboard = buildCommandCenterSnapshot(seriesId, feedReels);
    const revenueSummary = dashboard?.revenue?.summary;
    const mrrCents = Number(revenueSummary?.mrrCents || 0);
    const arrCents = Number(revenueSummary?.arrCents || 0);
    const seriesRevenueCents = Number(revenueSummary?.seriesRevenueCents || 0);
    const formatMoney = (cents) =>
        new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: 0
        }).format((Number(cents) || 0) / 100);
    const milestone =
        mrrCents >= 500_000
            ? 'MRR Breakout'
            : arrCents >= 10_000_000
              ? 'ARR Expansion'
              : seriesRevenueCents >= 2_000_000
                ? 'Series Revenue Lift'
                : 'Revenue Momentum';
    return {
        subtitle: `${milestone} · ${formatMoney(mrrCents)} MRR`,
        detail: `ARR ${formatMoney(arrCents)} · Series ${formatMoney(seriesRevenueCents)}`,
        mrrCents,
        arrCents
    };
}

/** @param {Record<string, unknown>[]} feedReels @param {string} [seriesId] */
function buildFeaturedReleaseCandidate(feedReels, seriesId = FEATURED_SERIES_ID) {
    const upcoming = buildUpcomingReleaseCandidate(feedReels, seriesId);
    if (upcoming) {
        return {
            ...upcoming,
            source: 'featured_release',
            subtitle: upcoming.subtitle || 'Featured release spotlight'
        };
    }

    const release = buildReleaseCenterSnapshot(seriesId, feedReels);
    const published = (release.calendar || []).find((entry) => entry.status === 'published');
    if (published?.episodeId) {
        const candidate = candidateFromEpisode(
            published.episodeId,
            feedReels,
            'featured_release',
            84,
            'Featured release · now streaming',
            { releaseStatus: 'published', featured: true }
        );
        if (candidate) return candidate;
    }

    return buildFeaturedSeriesCandidate(feedReels, seriesId);
}

/** @param {Record<string, unknown>[]} feedReels @param {string} [seriesId] */
function buildStudioPriorityCandidate(feedReels, seriesId = FEATURED_SERIES_ID) {
    const copilot = buildCreatorCopilotBrief(seriesId, feedReels);
    const readiness = computeProductionReadiness(feedReels, seriesId);
    const health = computeSeriesHealth(feedReels, seriesId);
    const top = copilot.topPriorities[0] || copilot.recommendedActions[0];
    const studioPriority = top?.title || copilot.biggestBlocker || 'Production sprint';

    const workflow = getWorkflowOperationsSnapshot(seriesId, feedReels);
    const episodeId =
        top?.episodeId ||
        getWorkflowTasksForSeries(seriesId).find((task) => task.status !== 'COMPLETE')?.episodeId;

    if (episodeId) {
        const candidate = candidateFromEpisode(
            episodeId,
            feedReels,
            'studio_priority',
            90,
            `Studio priority · ${studioPriority}`,
            {
                studioPriority,
                readiness: readiness.weightedPercent,
                openTasks: workflow.openTaskCount,
                missingAssets: health.missingAssets
            }
        );
        if (candidate) return candidate;
    }

    const featured = buildFeaturedSeriesCandidate(feedReels, seriesId);
    if (!featured) return null;

    const candidate = {
        ...featured,
        source: 'studio_priority',
        subtitle: `Studio priority · ${studioPriority}`,
        meta: {
            ...(featured.meta || {}),
            studioPriority,
            readiness: readiness.weightedPercent
        }
    };
    candidate.scoreBreakdown = scoreHeroCandidate(candidate);
    candidate.score = candidate.scoreBreakdown.total;
    return candidate;
}

/**
 * @param {HeroCandidate[]} candidates
 * @param {typeof HERO_DISCOVERY_TYPES[number][]} [priorityOrder]
 */
export function rankHeroPriorities(candidates, priorityOrder = loadHeroManagerConfig().spotlightPriority) {
    const order = priorityOrder.length ? priorityOrder : [...HERO_DISCOVERY_TYPES];
    const ranked = [...candidates]
        .map((candidate) => {
            const discoveryType =
                Object.entries(DISCOVERY_TYPE_SOURCES).find(([, source]) => source === candidate.source)?.[0] ||
                'TRENDING';
            const priorityIndex = order.indexOf(discoveryType);
            return {
                candidate,
                discoveryType,
                priorityIndex: priorityIndex === -1 ? order.length : priorityIndex,
                score: candidate.score || 0
            };
        })
        .sort((a, b) => a.priorityIndex - b.priorityIndex || b.score - a.score);

    logHeroIntelligenceDiag('HERO_PRIORITY', {
        ranked: ranked.slice(0, 6).map((row) => ({
            source: row.candidate.source,
            discoveryType: row.discoveryType,
            title: row.candidate.title,
            score: row.score,
            priorityIndex: row.priorityIndex
        }))
    });

    return ranked;
}

/** @param {Record<string, unknown> | Record<string, unknown>[]} feed @param {{ seriesId?: string }} [options] */
export function buildHeroCandidates(feed, options = {}) {
    const feedReels = flattenFeedReels(feed);
    const seriesId = options.seriesId || FEATURED_SERIES_ID;
    const feedSignature = feedReels
        .map((reel) =>
            [
                reel?.id || reel?.reelId || '',
                reel?.episodeId || reel?.episode_id || '',
                reel?.url || reel?.video_url || reel?.videoUrl || '',
                reel?.thumbnail || reel?.thumbnailUrl || ''
            ].join('|')
        )
        .join('||');
    const memoKey = `${seriesId}::${feedSignature}`;
    const now = Date.now();
    if (
        heroCandidatesMemo &&
        heroCandidatesMemo.key === memoKey &&
        now - heroCandidatesMemo.at < HERO_CANDIDATE_MEMO_TTL_MS
    ) {
        return heroCandidatesMemo.value;
    }

    const candidates = [
        buildTrendingCandidate(feedReels),
        buildMostWatchedCandidate(feedReels),
        buildHighestCompletionCandidate(feedReels),
        buildContinueWatchingCandidate(feedReels),
        buildUpcomingReleaseCandidate(feedReels, seriesId),
        buildFeaturedReleaseCandidate(feedReels, seriesId),
        buildCreatorSpotlightCandidate(feedReels),
        buildTeamPickCandidate(feedReels),
        buildStudioPriorityCandidate(feedReels, seriesId),
        buildEditorsChoiceCandidate(feedReels, seriesId),
        buildFeaturedSeriesCandidate(feedReels, seriesId)
    ].filter(Boolean);

    rankHeroPriorities(/** @type {HeroCandidate[]} */ (candidates));

    logHeroIntelligenceDiag('HERO_INTELLIGENCE', {
        candidateCount: candidates.length,
        sources: candidates.map((item) => item.source),
        seriesId
    });

    const resolvedCandidates = /** @type {HeroCandidate[]} */ (candidates);
    heroCandidatesMemo = { key: memoKey, at: now, value: resolvedCandidates };
    return resolvedCandidates;
}

/**
 * @param {string | typeof HERO_MODES[number] | typeof LEGACY_HERO_MODES[number]} [mode]
 * @param {Record<string, unknown> | Record<string, unknown>[]} feed
 * @param {{ seriesId?: string; fallbackTitle?: string; fallbackSubtitle?: string }} [options]
 * @returns {HeroSelection}
 */
export function selectHeroContent(mode = 'TRENDING', feed, options = {}) {
    const upper = String(mode || 'TRENDING').toUpperCase();
    const resolvedMode = normalizeHeroMode(mode);
    const discoveryType = HERO_DISCOVERY_TYPES.includes(/** @type {typeof HERO_DISCOVERY_TYPES[number]} */ (upper))
        ? /** @type {typeof HERO_DISCOVERY_TYPES[number]} */ (upper)
        : null;
    const candidates = buildHeroCandidates(feed, options);
    const preferredSource = discoveryType
        ? DISCOVERY_TYPE_SOURCES[discoveryType]
        : MODE_SOURCE_MAP[resolvedMode];

    const activeCampaign = loadHeroManagerConfig().seasonalCampaigns.find(
        (item) => item.active && isCampaignScheduledActive(item)
    );
    const campaignSource = activeCampaign
        ? DISCOVERY_TYPE_SOURCES[normalizeDiscoveryHeroType(activeCampaign.heroType)]
        : null;
    logHeroIntelligenceDiag('HERO_CAMPAIGN', {
        mode: 'selection',
        activeCampaignId: activeCampaign?.id || null,
        activeCampaignLabel: activeCampaign?.label || null,
        scheduleStart: activeCampaign?.scheduleStart || null,
        scheduleEnd: activeCampaign?.scheduleEnd || null
    });

    const selected =
        (campaignSource ? candidates.find((item) => item.source === campaignSource) : null) ||
        candidates.find((item) => item.source === preferredSource) ||
        rankHeroPriorities(candidates)[0]?.candidate ||
        candidates.sort((a, b) => b.score - a.score)[0] ||
        {
            source: 'featured_series',
            title: options.fallbackTitle || 'Neon Vengeance',
            subtitle: options.fallbackSubtitle || 'The code was his legacy. The betrayal was his rebirth.',
            seriesId: options.seriesId || FEATURED_SERIES_ID,
            score: 0
        };

    const displayMode = discoveryType || resolvedMode;

    /** @type {HeroSelection} */
    const selection = {
        ...selected,
        mode: /** @type {typeof HERO_MODES[number]} */ (displayMode),
        insight: buildHeroInsight(selected, displayMode)
    };

    if (!selection.scoreBreakdown) {
        selection.scoreBreakdown = scoreHeroCandidate(selection);
        selection.score = selection.scoreBreakdown.total;
    }

    logHeroIntelligenceDiag('HERO_SELECTION', {
        mode: selection.mode,
        source: selection.source,
        title: selection.title,
        insight: selection.insight,
        episodeId: selection.episodeId || null,
        reelId: selection.reelId || null,
        score: selection.score
    });

    return selection;
}

/**
 * @param {{ HERO_VIDEO_STORAGE_KEY?: string; HERO_IMAGE_STORAGE_KEY?: string; HERO_VIDEO_PATHS?: string[] }} config
 */
export function hasUserHeroOverride(config = {}) {
    if (typeof window === 'undefined') return false;
    const canonical = loadHeroReel();
    if (canonical?.id && canonical?.url) return true;

    const defaultPaths = new Set([
        DEFAULT_HERO_BACKGROUND_VIDEO,
        ...(config.HERO_VIDEO_PATHS || [])
    ]);

    const managerConfig = loadHeroManagerConfig();
    if (managerConfig.backgroundSource === 'custom_video' || managerConfig.backgroundSource === 'custom_image') {
        if (String(managerConfig.heroAssetId || '').trim()) return true;
    }
    return false;
}

/**
 * Restore hero background from localStorage, manager config, then server default asset.
 * @param {{ setVideo?: (url: string) => void; setPoster?: (url: string) => void; setFailed?: (failed: boolean) => void }} stores
 * @param {{ HERO_VIDEO_STORAGE_KEY?: string; HERO_IMAGE_STORAGE_KEY?: string; HERO_VIDEO_PATHS?: string[]; resolveVideoUrl?: (path: string) => string }} [appConfig]
 */
export async function hydrateHeroBackgroundStores(stores = {}, appConfig = {}) {
    if (typeof window === 'undefined') return 'unchanged';

    migrateLegacyHeroStorageIfNeeded();
    const managerConfig = loadHeroManagerConfig();
    const canonicalReel = loadHeroReel();
    if (
        canonicalReel?.url &&
        String(managerConfig?.heroAssetId || '').trim() === canonicalReel.id &&
        (managerConfig.backgroundSource === 'custom_image' ||
            managerConfig.backgroundSource === 'custom_video')
    ) {
        applyHeroReelToStores(canonicalReel, stores);
        console.info('[HERO_LOAD]', {
            stage: 'hydrateHeroBackgroundStores:hero_reel',
            id: canonicalReel.id,
            url: canonicalReel.url,
            backgroundSource: canonicalReel.backgroundSource,
            ts: new Date().toISOString()
        });
        return canonicalReel.backgroundSource === 'custom_image' ? 'image' : 'video';
    }

    const videoKey = appConfig.HERO_VIDEO_STORAGE_KEY || 'reelforge_hero_video';
    const imageKey = appConfig.HERO_IMAGE_STORAGE_KEY || 'reelforge_hero_image';
    const defaultPaths = appConfig.HERO_VIDEO_PATHS?.length
        ? appConfig.HERO_VIDEO_PATHS
        : [DEFAULT_HERO_BACKGROUND_VIDEO];
    const resolveVideoUrl =
        appConfig.resolveVideoUrl ||
        ((path) => (path.startsWith('http') || path.startsWith('blob:') ? path : path));

    let savedVideo = localStorage.getItem(videoKey);
    const savedImage = localStorage.getItem(imageKey);
    if (savedVideo?.startsWith('blob:')) {
        try {
            localStorage.removeItem(videoKey);
        } catch {
            /* ignore */
        }
        savedVideo = null;
    }

    if (
        (managerConfig.backgroundSource === 'custom_image' ||
            managerConfig.backgroundSource === 'custom_video') &&
        applyHeroManagerBackground(managerConfig, stores)
    ) {
        console.info('[HERO_LOAD]', {
            stage: 'hydrateHeroBackgroundStores:manager',
            backgroundSource: managerConfig.backgroundSource,
            heroAssetId: managerConfig.heroAssetId || '',
            ts: new Date().toISOString()
        });
        logHeroIntelligenceDiag('HERO_BACKGROUND_SAVE', {
            phase: 'hydrate',
            source: 'manager',
            backgroundSource: managerConfig.backgroundSource
        });
        return managerConfig.backgroundSource === 'custom_image' ? 'image' : 'video';
    }

    if (savedImage?.startsWith('data:')) {
        stores.setPoster?.(savedImage);
        stores.setVideo?.('');
        stores.setFailed?.(false);
        if (savedVideo) {
            try {
                localStorage.removeItem(videoKey);
            } catch {
                /* ignore */
            }
        }
        logHeroIntelligenceDiag('HERO_BACKGROUND_SAVE', {
            phase: 'hydrate',
            source: 'customizer_image',
            imageLen: savedImage.length
        });
        return 'image';
    }

    const persistedPoster = resolveUserPosterUrl(savedImage);
    if (persistedPoster) {
        stores.setPoster?.(persistedPoster);
        stores.setVideo?.('');
        stores.setFailed?.(false);
        if (savedVideo) {
            try {
                localStorage.removeItem(videoKey);
            } catch {
                /* ignore */
            }
        }
        logHeroIntelligenceDiag('HERO_BACKGROUND_SAVE', {
            phase: 'hydrate',
            source: 'persisted_thumb',
            image: persistedPoster
        });
        return 'image';
    }

    if (savedVideo) {
        stores.setVideo?.(savedVideo);
        if (savedImage) stores.setPoster?.(savedImage);
        stores.setFailed?.(false);
        logHeroIntelligenceDiag('HERO_BACKGROUND_SAVE', {
            phase: 'hydrate',
            source: 'customizer_video',
            video: savedVideo
        });
        return 'video';
    }

    for (const path of defaultPaths) {
        const resolvedUrl = resolveVideoUrl(path);
        try {
            const res = await fetch(resolvedUrl, { method: 'HEAD' });
            if (res.ok) {
                stores.setVideo?.(path);
                stores.setFailed?.(false);
                logHeroIntelligenceDiag('HERO_BACKGROUND_SAVE', {
                    phase: 'hydrate',
                    source: 'server_default',
                    video: path
                });
                return 'default';
            }
        } catch {
            /* try next candidate */
        }
    }

    stores.setFailed?.(true);
    stores.setVideo?.('');
    logHeroIntelligenceDiag('HERO_BACKGROUND_SAVE', {
        phase: 'hydrate',
        source: 'missing',
        tried: defaultPaths
    });
    return 'missing';
}

/**
 * @param {HeroSelection} selection
 * @param {{ setVideo?: (url: string) => void; setPoster?: (url: string) => void; setFailed?: (failed: boolean) => void }} stores
 * @param {{ respectUserOverride?: boolean; config?: Record<string, unknown> }} [options]
 */
export function applyHeroSelection(selection, stores = {}, options = {}) {
    const respectOverride = options.respectUserOverride !== false;
    const applyBackground = options.applyBackground !== false;
    const clearVideoForPosterOnly = options.clearVideoForPosterOnly === true;

    if (applyBackground && respectOverride && hasUserHeroOverride(options.config || {})) {
        logHeroIntelligenceDiag('HERO_SELECTION', {
            applied: false,
            reason: 'user_override',
            mode: selection.mode,
            source: selection.source
        });
        return false;
    }

    if (applyBackground) {
        if (selection.videoUrl && stores.setVideo) {
            stores.setVideo(selection.videoUrl);
            stores.setFailed?.(false);
        } else if (selection.posterUrl && stores.setPoster) {
            stores.setPoster(selection.posterUrl);
            if (!selection.videoUrl && stores.setVideo && clearVideoForPosterOnly) {
                stores.setVideo('');
                stores.setFailed?.(false);
            }
        }
    }

    logHeroIntelligenceDiag('HERO_SELECTION', {
        applied: true,
        mode: selection.mode,
        source: selection.source,
        insight: selection.insight,
        backgroundApplied: applyBackground,
        hasVideo: Boolean(selection.videoUrl),
        hasPoster: Boolean(selection.posterUrl)
    });

    if (typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent('reelforge:hero-intelligence-updated', { detail: selection })
        );
    }

    return true;
}

/** @param {string | null | undefined} platformHeroMode */
export function mapPlatformHeroMode(platformHeroMode) {
    const upper = String(platformHeroMode || '').toUpperCase();
    switch (upper) {
        case 'FEATURED_SERIES':
            return 'EDITORS_CHOICE';
        case 'LATEST_RELEASE':
        case 'PROMOTED':
            return 'UPCOMING_RELEASE';
        case 'CAROUSEL':
            return 'CREATOR_SPOTLIGHT';
        case 'STATIC':
        case 'OFF':
            return 'HIGHEST_COMPLETION';
        default:
            return normalizeHeroMode(upper);
    }
}

/**
 * @param {string} [seriesId]
 * @param {Record<string, unknown> | Record<string, unknown>[]} [feed]
 * @returns {HeroCommandBrief}
 */
export function buildHeroCommandBrief(seriesId = FEATURED_SERIES_ID, feed) {
    const feedReels = flattenFeedReels(feed);
    const resolvedSeriesId = seriesId || FEATURED_SERIES_ID;
    const snapshot = buildCommandCenterSnapshot(resolvedSeriesId, feedReels);
    const copilot = buildCreatorCopilotBrief(resolvedSeriesId, feedReels);
    const health = computeSeriesHealth(feedReels, resolvedSeriesId);
    const readiness = computeProductionReadiness(feedReels, resolvedSeriesId);
    const workflow = getWorkflowOperationsSnapshot(resolvedSeriesId, feedReels);
    const release = buildReleaseCenterSnapshot(resolvedSeriesId, feedReels);
    const analytics = getOperationsSnapshot(resolvedSeriesId);
    const series = getSeriesById(resolvedSeriesId);
    const seriesTitle = series?.title || 'Neon Vengeance';

    const biggestBlocker =
        copilot.biggestBlocker ||
        snapshot.workflow.bottlenecks[0]?.title ||
        (health.missingAssets > 0 ? `${health.missingAssets} missing assets` : 'No critical blockers');

    logHeroIntelligenceDiag('HERO_BLOCKER', {
        seriesId: resolvedSeriesId,
        blocker: biggestBlocker,
        missingAssets: health.missingAssets,
        openTasks: workflow.openTaskCount,
        readiness: readiness.weightedPercent
    });

    const recommendations = copilot.recommendedActions?.slice(0, 4) || copilot.topPriorities?.slice(0, 4) || [];
    for (const rec of recommendations) {
        logHeroIntelligenceDiag('HERO_RECOMMENDATION', {
            seriesId: resolvedSeriesId,
            id: rec.id,
            title: rec.title,
            priority: rec.priority,
            impact: rec.impact
        });
    }

    const nextReleaseEntry = snapshot.releases.entries[0];
    const nextReleaseLabel = nextReleaseEntry
        ? `${nextReleaseEntry.title || nextReleaseEntry.episodeId} · ${nextReleaseEntry.releaseDate || 'TBD'}`
        : release.premiereCountdown?.days != null
          ? `Premiere in ${release.premiereCountdown.days} days`
          : 'No release scheduled';

    const criticalTasks = workflow.openTaskCount;
    const teamLine =
        snapshot.team.recentActivity[0]
            ? `${snapshot.team.recentActivity[0].user}: ${snapshot.team.recentActivity[0].type || 'activity'}`
            : snapshot.team.activityCount > 0
              ? `${snapshot.team.activityCount} recent updates`
              : 'No recent team activity';

    const brief = {
        seriesId: resolvedSeriesId,
        primary: {
            seriesId: resolvedSeriesId,
            seriesTitle,
            readinessPercent: readiness.weightedPercent,
            biggestBlocker
        },
        secondary: [
            {
                id: 'next-release',
                label: 'Next Release',
                value: nextReleaseLabel,
                detail: snapshot.releases.activeCount
                    ? `${snapshot.releases.activeCount} active release${snapshot.releases.activeCount === 1 ? '' : 's'}`
                    : 'Schedule the next drop'
            },
            {
                id: 'missing-assets',
                label: 'Missing Assets',
                value: String(health.missingAssets),
                detail: `${health.assetCoverage}% asset coverage`
            },
            {
                id: 'critical-tasks',
                label: 'Open Critical Tasks',
                value: String(criticalTasks),
                detail:
                    snapshot.notifications.unreadCount > 0
                        ? `${snapshot.notifications.unreadCount} unread alerts`
                        : `${getUnreadCount()} notifications`
            },
            {
                id: 'team-activity',
                label: 'Team Activity',
                value: String(snapshot.team.activityCount),
                detail: teamLine
            }
        ],
        aggregates: {
            readiness,
            health,
            workflow,
            releaseHealth: release.releaseHealth,
            notifications: snapshot.notifications,
            publishingVelocity: analytics.publishingVelocity,
            studioProductivity: analytics.studioProductivity,
            copilotRecommendations: recommendations.length
        }
    };

    logHeroIntelligenceDiag('HERO_INTELLIGENCE', {
        surface: 'command-center',
        seriesId: resolvedSeriesId,
        readinessPercent: brief.primary.readinessPercent,
        biggestBlocker: brief.primary.biggestBlocker,
        missingAssets: health.missingAssets,
        openTasks: criticalTasks,
        publishingVelocity: analytics.publishingVelocity,
        unreadNotifications: snapshot.notifications.unreadCount
    });

    return brief;
}

let heroIntelligenceInitialized = false;
/** @type {ReturnType<typeof setInterval> | null} */
let heroRotationTimer = null;

/**
 * @param {Record<string, unknown> | Record<string, unknown>[]} feed
 * @param {{ seriesId?: string; apply?: (selection: HeroSelection) => void }} [options]
 */
export function rotateHeroSelection(feed, options = {}) {
    const config = loadHeroManagerConfig();
    const order = config.spotlightPriority.length ? config.spotlightPriority : [...HERO_DISCOVERY_TYPES];
    const currentType = normalizeDiscoveryHeroType(config.heroType);
    const currentIndex = order.indexOf(currentType);
    const nextType = order[(currentIndex + 1) % order.length] || order[0] || 'TRENDING';
    const nextConfig = saveHeroManagerConfig({ heroType: nextType });
    const selection = selectHeroContent(nextType, feed, { seriesId: options.seriesId });

    logHeroIntelligenceDiag('HERO_ROTATION', {
        from: currentType,
        to: nextType,
        autoRotate: nextConfig.autoRotate,
        title: selection.title,
        source: selection.source
    });
    console.info('[HERO_ROTATE]', {
        from: currentType,
        to: nextType,
        title: selection.title || '',
        source: selection.source || '',
        ts: new Date().toISOString()
    });
    logHeroIntelligenceDiag('HERO_TRANSITION', {
        trigger: 'hero_rotation',
        from: currentType,
        to: nextType,
        transitionStyle: nextConfig.carouselTransitionStyle
    });

    options.apply?.(selection);
    return selection;
}

/** @param {Record<string, unknown> | Record<string, unknown>[]} feed @param {(selection: HeroSelection) => void} [apply] */
export function startHeroRotation(feed, apply) {
    if (typeof window === 'undefined') return;
    stopHeroRotation();
    const config = loadHeroManagerConfig();
    if (!config.autoRotate) return;

    heroRotationTimer = window.setInterval(() => {
        rotateHeroSelection(feed, { apply });
    }, Math.max(10_000, config.rotateIntervalMs || 30_000));

    logHeroIntelligenceDiag('HERO_ROTATION', {
        phase: 'rotation_started',
        intervalMs: config.rotateIntervalMs,
        priority: config.spotlightPriority
    });
    console.info('[HERO_ROTATE]', {
        phase: 'rotation_started',
        intervalMs: config.rotateIntervalMs,
        enabled: config.autoRotate,
        ts: new Date().toISOString()
    });
    logHeroIntelligenceDiag('HERO_TRANSITION', {
        trigger: 'rotation_start',
        intervalMs: config.rotateIntervalMs,
        enabled: config.autoRotate
    });
}

export function stopHeroRotation() {
    if (heroRotationTimer) {
        clearInterval(heroRotationTimer);
        heroRotationTimer = null;
    }
}

/** @param {Partial<HeroManagerConfig>} patch @param {Record<string, unknown> | Record<string, unknown>[]} [feed] */
export function updateHeroManagerConfig(patch, feed = {}) {
    const config = saveHeroManagerConfig(patch);
    const selection = selectHeroContent(config.heroType, feed);
    rankHeroPriorities(buildHeroCandidates(feed));
    if (config.autoRotate) {
        startHeroRotation(feed);
    } else {
        stopHeroRotation();
    }
    return { config, selection };
}

export function initHeroIntelligence() {
    if (typeof window === 'undefined' || heroIntelligenceInitialized) return;
    heroIntelligenceInitialized = true;

    window.__reelforgeHeroIntelligence = {
        HERO_MODES,
        LEGACY_HERO_MODES,
        HERO_SOURCES,
        HERO_DISCOVERY_TYPES,
        HERO_BACKGROUND_STYLES,
        HERO_CAROUSEL_TRANSITIONS,
        HERO_SLIDE_TYPES,
        HERO_MANAGER_STORAGE_KEY,
        MODE_SOURCE_MAP,
        DISCOVERY_TYPE_SOURCES,
        buildHeroCandidates,
        buildHeroCarouselSlides,
        buildHeroInsight,
        buildHeroCommandBrief,
        scoreHeroCandidate,
        selectHeroContent,
        applyHeroSelection,
        hasUserHeroOverride,
        mapPlatformHeroMode,
        normalizeHeroMode,
        normalizeDiscoveryHeroType,
        loadHeroManagerConfig,
        saveHeroManagerConfig,
        getDefaultHeroManagerConfig,
        resolveHeroBackgroundPresentation,
        resolveHeroBackgroundAsset,
        applyHeroManagerBackground,
        hydrateHeroBackgroundStores,
        DEFAULT_HERO_BACKGROUND_VIDEO,
        loadHeroVaultItems,
        inferHeroAssetType,
        rankHeroPriorities,
        rotateHeroSelection,
        startHeroRotation,
        stopHeroRotation,
        updateHeroManagerConfig,
        logHeroIntelligenceDiag,
        logHeroImagePipeline
    };

    logHeroIntelligenceDiag('HERO_INTELLIGENCE', {
        phase: 'engine_initialized',
        discoveryTypes: HERO_DISCOVERY_TYPES,
        backgroundStyles: HERO_BACKGROUND_STYLES
    });
}
