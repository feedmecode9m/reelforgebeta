/**
 * Phase 33 — intelligent hero command surface + showcase selection.
 * Aggregates production signals for the hero command center without touching playback.
 */

import { getOperationsSnapshot } from '../observability/platformMetrics.js';
import { loadWatchProgressMap } from '../series/seriesWatchProgress.js';
import { buildReleaseCenterSnapshot } from '../release/releaseCenter.js';
import { getEpisodeById, getSeriesById, seriesCatalog } from '../series/seriesStore.js';
import { resolveReelForEpisode } from '../series/episodeBridge.js';
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
    buildViewerCopyPatchFromTruth,
    resolveHeroAssetTruth
} from './heroViewerTruth.js';
import {
    analyzeHeroTitle,
    buildHeroManagerPatchFromTitleIntel
} from './heroTitleIntelligence.js';
import {
    loadHeroReel,
    saveHeroReel,
    heroReelFromUploadResponse,
    heroReelToVaultItem,
    applyHeroReelToStores,
    migrateLegacyHeroStorageIfNeeded,
    refreshHeroReelLegacyMirror,
    HERO_REEL_STORAGE_KEY
} from './heroReelIdentity.js';
import {
    loadHeroRecord,
    applyHeroRecordToStores,
    applyHeroRecordBackground,
    selectHeroAsset,
    setHeroMode,
    projectHeroRecordToManagerPointer,
    projectHeroRecordToReel,
    inspectHeroRecordStorage,
    mergeHeroRecordIntoManagerConfig,
    migrateLegacyHeroRecordIfNeeded
} from './heroRecord.js';
import {
    getLastHeroConfigSource,
    hydrateHeroPresentationFromServer,
    logHeroSource,
    pushHeroPresentationToServer,
    sanitizeHeroConfigLocationIntelligence,
    setLastHeroConfigSource,
    enrichPresentationConfigFromLocalIdentity
} from './heroPresentationSync.js';

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
const VIDEO_VAULT_STORAGE_KEY = 'personal_video_vault';
const THUMB_VAULT_STORAGE_KEY = 'personal_thumbnails';
const FEED_STORAGE_KEY = 'reelforge_feed';

/** Prevents loadHeroManagerConfig ↔ saveHeroManagerConfig recovery recursion. */
let heroIdentityRecoveryInFlight = false;
/** Prevents unwanted-dump demotion from re-entering load/save. */
let heroUnwantedDumpDemotionInFlight = false;

function readLocalJsonArray(storageKey) {
    if (typeof window === 'undefined') return [];
    try {
        const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/**
 * Ready vault picks for the Hero Manager dropdown / cards.
 * Excludes local stubs, failed uploads, and non-playable blob previews.
 * @param {Record<string, unknown> | null | undefined} entry
 */
function isEligibleHeroVaultPick(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.isPlaceholder === true) return false;
    if (entry.isHeroInjected === true && !entry.url) return false;

    const id = String(entry.id || entry.assetId || entry.personal_video_id || '').trim();
    if (!id) return false;
    if (/^local-(pending|upload|interrupted)/i.test(id)) return false;

    const status = String(entry.status || entry.uploadStatus || 'ready').toLowerCase();
    if (status && status !== 'ready' && status !== 'complete' && status !== 'completed') {
        if (/fail|error|pending|upload|interrupt|process/.test(status)) return false;
    }
    if (entry.uploadError || entry.failed === true) return false;

    const url = String(
        entry.url ||
            entry.videoUrl ||
            entry.video_url ||
            entry.mediaUrl ||
            entry.thumbnail ||
            entry.thumbnailUrl ||
            entry.thumbnail_url ||
            ''
    ).trim();
    if (!url) return false;
    // Keep durable media only — not temporary browser object URLs.
    if (url.startsWith('blob:')) return false;

    return true;
}

/** @returns {Record<string, unknown>[]} */
function collectFeedVideoReelRecords() {
    if (typeof window === 'undefined') return [];
    try {
        const feed = JSON.parse(localStorage.getItem(FEED_STORAGE_KEY) || '{}');
        if (!feed || typeof feed !== 'object') return [];
        const records = [];
        for (const items of Object.values(feed)) {
            if (Array.isArray(items)) records.push(...items);
        }
        return records;
    } catch {
        return [];
    }
}

/** @param {Record<string, unknown> | null | undefined} record */
function isPlayableHeroVideoCandidate(record) {
    const id = String(record?.id || record?.assetId || '').trim();
    if (!id) return false;

    const url = toRelativeMediaPath(
        String(record?.url || record?.videoUrl || record?.video_url || record?.mediaUrl || '').trim()
    );
    if (!url || url.startsWith('blob:') || url.startsWith('data:')) return false;

    const defaultHeroUrl = toRelativeMediaPath(DEFAULT_HERO_BACKGROUND_VIDEO);
    if (url === defaultHeroUrl) return false;

    const nameBlob = [
        id,
        record?.name,
        record?.title,
        record?.fileName,
        record?.file_name,
        url
    ]
        .map((part) => String(part || ''))
        .join(' ');
    // Never promote personal dump uploads into the discovery hero stage.
    if (/micros[_-\s]?stirred/i.test(nameBlob)) return false;

    const mime = String(record?.type || record?.mime || record?.mimeType || '').toLowerCase();
    if (mime.startsWith('image/')) return false;

    const thumbnailOnly =
        !mime.startsWith('video/') &&
        !HERO_VIDEO_EXTENSIONS.test(url) &&
        !url.includes('/videos/') &&
        Boolean(record?.thumbnail || record?.thumbnailUrl || record?.thumbnail_url);
    if (thumbnailOnly) return false;

    return (
        mime.startsWith('video/') ||
        HERO_VIDEO_EXTENSIONS.test(url) ||
        url.includes('/videos/')
    );
}

/**
 * @param {Record<string, unknown>} record
 * @param {'reelforge_hero_reel' | 'personal_video_vault' | 'reelforge_feed'} source
 * @returns {{ reel: import('./heroReelIdentity.js').HeroReel; source: string; priority: number; sortTs: number } | null}
 */
function normalizeHeroRecoveryCandidate(record, source) {
    if (!isPlayableHeroVideoCandidate(record)) return null;
    const reel = heroReelFromUploadResponse(record, 'video');
    if (!reel?.id || !reel?.url) return null;

    const priority =
        source === 'reelforge_hero_reel' ? 0 : source === 'personal_video_vault' ? 1 : 2;
    const sortTs =
        source === 'personal_video_vault'
            ? Date.parse(
                  String(record?.addedAt || record?.createdAt || record?.created_at || '')
              ) || 0
            : 0;

    return { reel, source, priority, sortTs };
}

/** @returns {ReturnType<typeof normalizeHeroRecoveryCandidate>[]} */
function gatherHeroRecoveryCandidates() {
    /** @type {ReturnType<typeof normalizeHeroRecoveryCandidate>[]} */
    const candidates = [];
    const seenIds = new Set();

    const canonical = loadHeroReel();
    if (canonical) {
        const normalized = normalizeHeroRecoveryCandidate(canonical, 'reelforge_hero_reel');
        if (normalized && !seenIds.has(normalized.reel.id)) {
            seenIds.add(normalized.reel.id);
            candidates.push(normalized);
        }
    }

    for (const entry of readLocalJsonArray(VIDEO_VAULT_STORAGE_KEY)) {
        if (!entry || typeof entry !== 'object') continue;
        const normalized = normalizeHeroRecoveryCandidate(entry, 'personal_video_vault');
        if (normalized && !seenIds.has(normalized.reel.id)) {
            seenIds.add(normalized.reel.id);
            candidates.push(normalized);
        }
    }

    for (const entry of collectFeedVideoReelRecords()) {
        if (!entry || typeof entry !== 'object') continue;
        const normalized = normalizeHeroRecoveryCandidate(entry, 'reelforge_feed');
        if (normalized && !seenIds.has(normalized.reel.id)) {
            seenIds.add(normalized.reel.id);
            candidates.push(normalized);
        }
    }

    candidates.sort((a, b) => a.priority - b.priority || b.sortTs - a.sortTs);
    return candidates;
}

/**
 * Recover hero identity only for custom media modes missing a pointer.
 * Selection/none must never pull personal vault dumps (e.g. MICROS_STIRRED) into the menu hero.
 * @param {HeroManagerConfig | null | undefined} [baseConfig]
 * @returns {HeroManagerConfig | null}
 */
function attemptHeroIdentityRecovery(baseConfig = null) {
    if (heroIdentityRecoveryInFlight || typeof window === 'undefined') return null;

    const source = String(baseConfig?.backgroundSource || '').trim();
    if (source !== 'custom_image' && source !== 'custom_video') {
        console.info('[HERO_IDENTITY_RECOVERY]', {
            source: 'skipped',
            candidateCount: 0,
            selectedId: '',
            recovered: false,
            reason: `backgroundSource_${source || 'empty'}_not_custom`
        });
        return null;
    }

    heroIdentityRecoveryInFlight = true;
    try {
        const candidates = gatherHeroRecoveryCandidates();
        // Prefer canonical hero reel only — do not promote personal_video_vault dumps to hero.
        const preferred = candidates.find((item) => item?.source === 'reelforge_hero_reel') || null;
        const selected = preferred;

        console.info('[HERO_IDENTITY_RECOVERY]', {
            source: selected?.source || 'none',
            candidateCount: candidates.length,
            selectedId: selected?.reel?.id || '',
            recovered: Boolean(selected),
            reason: preferred ? 'canonical_hero_reel' : 'no_canonical_hero_reel'
        });

        if (!selected) return null;

        saveHeroReel(selected.reel);
        const saved = saveHeroManagerConfig({
            heroAssetId: selected.reel.id,
            backgroundSource:
                selected.reel.backgroundSource === 'custom_image' ? 'custom_image' : 'custom_video',
            backgroundStyle: selected.reel.backgroundSource === 'custom_image' ? 'image' : 'video'
        });

        if (baseConfig) {
            return {
                ...baseConfig,
                ...saved,
                heroAssetId: selected.reel.id,
                backgroundSource: saved.backgroundSource,
                backgroundStyle: saved.backgroundStyle
            };
        }
        return saved;
    } finally {
        heroIdentityRecoveryInFlight = false;
    }
}

/**
 * HeroReel peek without migrating/default-writing HeroRecord (safe during load paths).
 * @returns {import('./heroReelIdentity.js').HeroReel | null}
 */
function peekHeroReelWithoutMigrate() {
    if (typeof window === 'undefined') return null;
    try {
        const inspection = inspectHeroRecordStorage();
        if (inspection.state === 'valid' && inspection.record) {
            return projectHeroRecordToReel(inspection.record);
        }
        const raw = localStorage.getItem(HERO_REEL_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.id || !parsed?.url) return null;
        return {
            id: String(parsed.id),
            fileName: String(parsed.fileName || ''),
            name: String(parsed.name || 'Hero'),
            url: String(parsed.url),
            thumbnail: parsed.thumbnail ? String(parsed.thumbnail) : undefined,
            type: String(parsed.type || 'video/mp4'),
            backgroundSource:
                parsed.backgroundSource === 'custom_image' ? 'custom_image' : 'custom_video'
        };
    } catch {
        return null;
    }
}

/**
 * @param {HeroManagerConfig} config
 * @param {Partial<HeroManagerConfig>} [baseConfig]
 * @returns {HeroManagerConfig}
 */
function finalizeHeroManagerConfigLoad(config, baseConfig = null) {
    const source = String(config?.backgroundSource || '').trim();
    // Demote auto-promoted dump reels (e.g. MICROS_STIRRED) off the menu hero landscape.
    if (
        !heroUnwantedDumpDemotionInFlight &&
        !heroIdentityRecoveryInFlight &&
        (source === 'custom_video' || source === 'custom_image' || source === 'selection')
    ) {
        // Avoid loadHeroReel() here — migrate/default-write would steal the single identity write.
        const reel = peekHeroReelWithoutMigrate();
        const blob = [
            config?.heroAssetId,
            reel?.id,
            reel?.name,
            reel?.fileName,
            reel?.url
        ]
            .map((part) => String(part || ''))
            .join(' ');
        if (/micros[_-\s]?stirred/i.test(blob)) {
            console.info('[HERO_IDENTITY_RECOVERY]', {
                source: 'demote_unwanted_dump',
                candidateCount: 0,
                selectedId: String(config?.heroAssetId || ''),
                recovered: false,
                reason: 'micros_stirred_not_allowed_as_menu_hero'
            });
            heroUnwantedDumpDemotionInFlight = true;
            try {
                // Explicit identity clear (not via saveHeroManagerConfig side-effects).
                setHeroMode('none', { source: 'demote_unwanted_dump' });
                refreshHeroReelLegacyMirror();
                return (
                    saveHeroManagerConfig({
                        heroAssetId: '',
                        backgroundSource: 'none',
                        backgroundStyle: 'gradient_overlay'
                    }) || {
                        ...config,
                        heroAssetId: '',
                        backgroundSource: 'none',
                        backgroundStyle: 'gradient_overlay'
                    }
                );
            } finally {
                heroUnwantedDumpDemotionInFlight = false;
            }
        }
    }

    const heroAssetId = String(config?.heroAssetId || '').trim();
    if (heroAssetId || heroIdentityRecoveryInFlight) return config;
    // Blank menu or selection intelligence: never auto-inject vault videos as hero background.
    if (source === 'none' || source === 'selection' || !source) return config;
    if (source !== 'custom_image' && source !== 'custom_video') return config;

    const recovered = attemptHeroIdentityRecovery(baseConfig || config);
    return recovered || config;
}

function captureHeroConfigBootCaller(skipFrames = 2) {
    try {
        return (new Error().stack || '').split('\n')[skipFrames]?.trim() || 'unknown';
    } catch {
        return 'unknown';
    }
}

/**
 * Temporary boot diagnostics for hero manager config provenance.
 * @param {Record<string, unknown>} payload
 */
export function logHeroConfigBootTrace(payload = {}) {
    console.info('[HERO_CONFIG_BOOT_TRACE]', {
        ts: new Date().toISOString(),
        ...payload
    });
}
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
 * @property {'selection' | 'custom_image' | 'custom_video' | 'none'} backgroundSource
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
 * @property {string} [heroCopySourceAssetId]
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
 * @property {'selection' | 'custom_image' | 'custom_video' | 'none'} backgroundSource
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
        // Blank menu by default — never auto-surface vault dumps as hero landscape.
        backgroundSource: 'none',
        heroAssetId: '',
        backgroundStyle: 'gradient_overlay',
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
            // Leave empty so live vault title can become truth — avoids demo mismatch on personal heroes.
            heroTitle: '',
            heroSubtitle: '',
            heroDescription: '',
            heroCopySourceAssetId: '',
            heroAssetTitle: '',
            heroStoryContext: null,
            heroTitleIntelligence: null,
            contentIdentity: null,
            heroIntelligenceProposals: null,
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
    const caller = captureHeroConfigBootCaller(2);
    if (typeof window === 'undefined') {
        const config = getDefaultHeroManagerConfig();
        logHeroConfigBootTrace({
            site: 'loadHeroManagerConfig',
            caller,
            storageRawBeforeParse: null,
            heroAssetId: config.heroAssetId,
            backgroundSource: config.backgroundSource,
            configSource: 'getDefaultHeroManagerConfig',
            reason: 'ssr_no_window'
        });
        return config;
    }
    try {
        const raw = localStorage.getItem(HERO_MANAGER_STORAGE_KEY);
        if (!raw) {
            const defaultConfig = getDefaultHeroManagerConfig();
            const config = finalizeHeroManagerConfigLoad(defaultConfig);
            logHeroConfigBootTrace({
                site: 'loadHeroManagerConfig',
                caller,
                storageRawBeforeParse: null,
                heroAssetId: config.heroAssetId,
                backgroundSource: config.backgroundSource,
                configSource:
                    config.heroAssetId && config.backgroundSource === 'custom_video'
                        ? 'identity_recovery'
                        : 'getDefaultHeroManagerConfig',
                reason: config.heroAssetId ? 'identity_recovery' : 'no_storage_key'
            });
            return config;
        }
        const parsed = JSON.parse(raw);
        const parsedBackgroundSource = String(parsed.backgroundSource || 'selection').trim();
        const resolvedHeroAssetId =
            parsedBackgroundSource === 'none'
                ? ''
                : String(parsed.heroAssetId || parsed.backgroundAsset || '').trim();
        const config = {
            ...getDefaultHeroManagerConfig(),
            ...parsed,
            backgroundSource: parsedBackgroundSource || 'selection',
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
            heroCopySourceAssetId:
                typeof parsed.heroCopySourceAssetId === 'string'
                    ? String(parsed.heroCopySourceAssetId).trim()
                    : String(resolvedHeroAssetId || ''),
            heroAssetTitle:
                typeof parsed.heroAssetTitle === 'string' ? parsed.heroAssetTitle : '',
            heroStoryContext:
                parsed.heroStoryContext && typeof parsed.heroStoryContext === 'object'
                    ? parsed.heroStoryContext
                    : null,
            heroTitleIntelligence:
                parsed.heroTitleIntelligence && typeof parsed.heroTitleIntelligence === 'object'
                    ? parsed.heroTitleIntelligence
                    : null,
            contentIdentity:
                parsed.contentIdentity && typeof parsed.contentIdentity === 'object'
                    ? parsed.contentIdentity
                    : null,
            heroIntelligenceProposals:
                parsed.heroIntelligenceProposals && typeof parsed.heroIntelligenceProposals === 'object'
                    ? parsed.heroIntelligenceProposals
                    : null,
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
        // Repair stale NLP location in cache (La → Los Angeles) without server push.
        const locationSafe = sanitizeHeroConfigLocationIntelligence(config);
        setLastHeroConfigSource(locationSafe.heroAssetId ? 'localStorage' : 'default');
        console.info('[HERO_LOAD]', {
            key: HERO_MANAGER_STORAGE_KEY,
            backgroundSource: locationSafe.backgroundSource,
            heroAssetId: locationSafe.heroAssetId || '',
            ts: new Date().toISOString()
        });
        logHeroConfigBootTrace({
            site: 'loadHeroManagerConfig',
            caller,
            storageRawBeforeParse: raw,
            parsedHeroAssetId: String(parsed.heroAssetId || parsed.backgroundAsset || '').trim(),
            parsedBackgroundSource: String(parsed.backgroundSource || ''),
            heroAssetId: locationSafe.heroAssetId,
            backgroundSource: locationSafe.backgroundSource,
            configSource: 'localStorage_merged_with_defaults',
            reason: 'storage_hit'
        });
        return finalizeHeroManagerConfigLoad(locationSafe, locationSafe);
    } catch (error) {
        const defaultConfig = getDefaultHeroManagerConfig();
        const config = finalizeHeroManagerConfigLoad(defaultConfig);
        logHeroConfigBootTrace({
            site: 'loadHeroManagerConfig',
            caller,
            storageRawBeforeParse: localStorage.getItem(HERO_MANAGER_STORAGE_KEY),
            heroAssetId: config.heroAssetId,
            backgroundSource: config.backgroundSource,
            configSource:
                config.heroAssetId && config.backgroundSource === 'custom_video'
                    ? 'identity_recovery'
                    : 'getDefaultHeroManagerConfig',
            reason: config.heroAssetId ? 'identity_recovery' : 'parse_error',
            error: error?.message || String(error)
        });
        return config;
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

/**
 * @param {Partial<HeroManagerConfig>} patch
 * @param {{ skipServer?: boolean; source?: 'localStorage' | 'backend' | 'default' }} [options]
 * localStorage is cache only; unless skipServer, config is pushed to GET/PUT /api/hero/presentation.
 */
export function saveHeroManagerConfig(patch = {}, options = {}) {
    const existing = loadHeroManagerConfig();
    const merged = { ...existing, ...patch };
    if (String(merged.backgroundSource || '').trim() === 'none') {
        merged.heroAssetId = '';
        // Does not write HeroRecord — identity commits use selectHeroAsset / setHeroMode.
    }
    const patchBackgroundSource = String(patch.backgroundSource || '').trim();
    const patchClearsHeroAsset =
        Object.prototype.hasOwnProperty.call(patch, 'heroAssetId') &&
        !String(patch.heroAssetId || '').trim() &&
        Object.prototype.hasOwnProperty.call(patch, 'backgroundSource') &&
        (patchBackgroundSource === 'selection' || patchBackgroundSource === 'none');
    const persistedHeroAssetId = String(existing.heroAssetId || '').trim();
    if (
        Object.prototype.hasOwnProperty.call(patch, 'heroAssetId') &&
        !String(patch.heroAssetId || '').trim() &&
        persistedHeroAssetId &&
        !patchClearsHeroAsset
    ) {
        merged.heroAssetId = persistedHeroAssetId;
    }
    const registry = buildHeroAssetRegistry(loadHeroVaultItems());
    // Never rehydrate a vault asset when the user chose a blank menu backdrop.
    if (!merged.heroAssetId && String(merged.backgroundSource || '').trim() !== 'none') {
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
    // Fix NLP location persistence (e.g. "La" → "Los Angeles") without rewriting titles.
    const locationSafe = sanitizeHeroConfigLocationIntelligence(sanitized);
    // Ensure mediaUrl/posterUrl cache fields travel with heroAssetId for server push.
    const withMedia = enrichPresentationConfigFromLocalIdentity(locationSafe);
    const next = {
        ...withMedia,
        heroAssetId: String(withMedia.heroAssetId || '').trim(),
        updatedAt: Date.now()
    };
    if (typeof window !== 'undefined') {
        localStorage.setItem(HERO_MANAGER_STORAGE_KEY, JSON.stringify(next));
        const cacheSource = options.source || 'localStorage';
        setLastHeroConfigSource(cacheSource);
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
            mediaUrl: next.mediaUrl ? String(next.mediaUrl).slice(0, 80) : '',
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
        // Cache write only unless skipServer — never treat localStorage as SoT.
        if (options.skipServer !== true) {
            const pushPromise = pushHeroPresentationToServer(next);
            // Optional await path: saveHeroManagerConfig(..., { waitForServer: true })
            if (options.waitForServer === true) {
                // Synchronous callers ignore return; awaiters use persistHeroPresentationAwait.
                // Stored on next for debugging.
                next.__serverPush = pushPromise;
            } else {
                pushPromise.catch((err) => {
                    console.warn('[HERO_PRESENTATION] background push failed', err?.message || err);
                });
            }
        }
        window.dispatchEvent(new CustomEvent('reelforge:hero-manager-updated', { detail: next }));
    }
    return next;
}

/**
 * Explicit awaitable publish of current manager config (or patch) to PUT /api/hero/presentation.
 * Use from Hero Manager after user selects a background.
 * @param {Partial<HeroManagerConfig>} [patch]
 * @returns {Promise<{ ok: boolean; config: HeroManagerConfig; server: Record<string, unknown> | null; error?: string }>}
 */
export async function persistHeroPresentationToServer(patch = {}) {
    const config =
        patch && Object.keys(patch).length
            ? saveHeroManagerConfig(patch, { skipServer: true })
            : loadHeroManagerConfig();
    try {
        const server = await pushHeroPresentationToServer(config);
        if (!server) {
            return {
                ok: false,
                config,
                server: null,
                error: 'Server write failed or skipped (login required / empty payload)'
            };
        }
        return { ok: true, config, server };
    } catch (error) {
        return {
            ok: false,
            config,
            server: null,
            error: error?.message || String(error)
        };
    }
}

/**
 * Hydrate manager cache from server-side presentation (backend source of truth).
 * @returns {Promise<{ hydrated: boolean; config: HeroManagerConfig | null; source: string }>}
 */
export async function hydrateHeroManagerConfigFromServer() {
    return hydrateHeroPresentationFromServer(
        (patch, opts) => saveHeroManagerConfig(patch, opts),
        () => loadHeroManagerConfig()
    );
}

export { logHeroSource, getLastHeroConfigSource };

/**
 * Shared hero video identity commit — ONE HeroRecord write, then manager pointer fields.
 * @param {import('./heroReelIdentity.js').HeroReel} reel
 * @returns {HeroManagerConfig | null}
 */
export function commitHeroVideoIdentity(reel) {
    if (!reel?.id || !reel?.url) return null;

    const mediaUrl = toRelativeMediaPath(String(reel.url)) || String(reel.url).trim();
    const posterUrl = reel.thumbnail
        ? toRelativeMediaPath(String(reel.thumbnail)) || String(reel.thumbnail).trim()
        : '';

    const record = selectHeroAsset({
        assetId: String(reel.id).trim(),
        mediaUrl,
        videoUrl: mediaUrl,
        posterUrl,
        mediaKind: 'video',
        fileName: String(reel.fileName || '').trim(),
        title: String(reel.name || 'Hero').trim(),
        source: 'commit_hero_video_identity'
    });
    if (!record) return null;

    refreshHeroReelLegacyMirror();

    console.info('[HERO_IDENTITY_COMMIT]', {
        stage: 'commitHeroVideoIdentity',
        reelId: reel.id,
        url: mediaUrl,
        revision: record.revision,
        ts: new Date().toISOString()
    });

    return saveHeroManagerConfig({
        heroAssetId: reel.id,
        backgroundSource: 'custom_video',
        backgroundStyle: 'video'
    });
}

/**
 * Keep Hero Viewer Content aligned with the active Vault Hero file title (Edit Title truth).
 * @param {string} assetId
 * @param {{
 *   extraItems?: Record<string, unknown>[] | null;
 *   force?: boolean;
 *   previousTitle?: string;
 *   overrideTitle?: string;
 * }} [options]
 * @returns {HeroManagerConfig | null}
 */
export function syncHeroViewerCopyFromAsset(assetId, options = {}) {
    const id = String(assetId || '').trim();
    if (!id) return null;
    const vaultItems = loadHeroVaultItems(options.extraItems || null);
    let truth = resolveHeroAssetTruth(id, vaultItems);
    if (!truth && options.overrideTitle) {
        truth = {
            assetId: id,
            title: String(options.overrideTitle).trim(),
            mediaUrl: '',
            thumbnailUrl: '',
            assetType: 'video',
            isVideo: true,
            mimeType: ''
        };
    }
    if (options.overrideTitle && truth) {
        truth = { ...truth, title: String(options.overrideTitle).trim() || truth.title };
    }
    if (!truth?.title) return null;

    const existing = loadHeroManagerConfig();
    const intelBundle = buildHeroManagerPatchFromTitleIntel(id, truth.title, {
        isVideo: truth.isVideo,
        force: Boolean(options.force),
        previous: {
            heroTitle: existing.heroTitle,
            heroSubtitle: existing.heroSubtitle,
            heroDescription: existing.heroDescription
        }
    });
    // When force or previous title was the old asset name, always bind.
    let patch = intelBundle.patch;
    if (!options.force) {
        patch = buildViewerCopyPatchFromTruth(truth, {
            heroTitle: existing.heroTitle,
            heroSubtitle: existing.heroSubtitle,
            heroDescription: existing.heroDescription,
            heroCopySourceAssetId: existing.heroCopySourceAssetId,
            force: false,
            _previousAssetTitle: options.previousTitle
        });
    }
    if (!Object.keys(patch).length) return existing;

    console.info('[HERO_VIEWER_TRUTH_SYNC]', {
        assetId: truth.assetId,
        title: truth.title,
        intelligence: intelBundle.intelligence,
        patchKeys: Object.keys(patch),
        force: Boolean(options.force),
        ts: new Date().toISOString()
    });
    return saveHeroManagerConfig(patch);
}

/**
 * Promote any ready Video Vault / Thumbnail Vault entry to the live menu hero background.
 * ONE HeroRecord write for identity; manager keeps compatibility fields only.
 * @param {string | null | undefined} assetId
 * @param {Record<string, unknown>[] | null} [extraItems]
 * @returns {HeroManagerConfig | null}
 */
export function commitHeroAssetSelection(assetId, extraItems = null) {
    const id = String(assetId || '').trim();
    if (!id) {
        const blank = setHeroMode('none', { source: 'commit_hero_asset_clear' });
        if (!blank) return null;
        refreshHeroReelLegacyMirror();
        return saveHeroManagerConfig({
            heroAssetId: '',
            backgroundSource: 'none',
            backgroundStyle: 'gradient_overlay',
            heroCopySourceAssetId: ''
        });
    }

    const vaultItems = loadHeroVaultItems(extraItems);
    let asset = resolveHeroAssetById(id, vaultItems);
    if (!asset) {
        const raw = vaultItems.find(
            (entry) =>
                String(entry?.id || entry?.assetId || '').trim() === id ||
                String(entry?.fileName || entry?.file_name || '').trim() === id
        );
        asset = raw ? normalizeHeroAssetRecord(raw, { storageSource: 'vault_pick' }) : null;
    }
    if (!asset?.assetId || !asset?.mediaUrl) {
        console.warn('[HERO_ASSET_SELECT_MISS]', { assetId: id, vaultCount: vaultItems.length });
        return null;
    }

    const isVideo = isVideoHeroAssetType(asset.assetType);
    const mediaKind = /** @type {'image' | 'video'} */ (isVideo ? 'video' : 'image');
    const mediaUrl = String(asset.mediaUrl || '').trim();
    const posterUrl = isVideo
        ? String(asset.thumbnailUrl || '').trim()
        : mediaUrl;

    const existing = loadHeroManagerConfig();
    const truth = resolveHeroAssetTruth(
        { ...asset, title: asset.title },
        vaultItems
    ) || {
        assetId: asset.assetId,
        title: String(asset.title || 'Hero'),
        mediaUrl: asset.mediaUrl,
        thumbnailUrl: asset.thumbnailUrl || '',
        assetType: asset.assetType,
        isVideo,
        mimeType: String(asset.mimeType || '')
    };
    try {
        const map = JSON.parse(localStorage.getItem('reel_titles_persistent') || '{}');
        const persisted = String(map?.[asset.assetId]?.title || map?.[asset.assetId]?.title_original || '').trim();
        if (persisted) truth.title = persisted;
    } catch {
        /* ignore */
    }
    const intelBundle = buildHeroManagerPatchFromTitleIntel(asset.assetId, truth.title, {
        isVideo,
        force: true,
        previous: {
            heroTitle: existing.heroTitle,
            heroSubtitle: existing.heroSubtitle,
            heroDescription: existing.heroDescription
        }
    });

    const beforeRevision = Number(inspectHeroRecordStorage()?.record?.revision) || 0;

    const record = selectHeroAsset({
        assetId: asset.assetId,
        mediaUrl,
        videoUrl: isVideo ? mediaUrl : '',
        posterUrl,
        mediaKind,
        fileName: String(asset.title || asset.assetId),
        title: String(truth.title || asset.title || 'Hero'),
        heroTitle: intelBundle.patch?.heroTitle,
        heroSubtitle: intelBundle.patch?.heroSubtitle,
        heroDescription: intelBundle.patch?.heroDescription,
        source: 'commit_hero_asset_selection'
    });
    if (!record) return null;

    refreshHeroReelLegacyMirror();

    console.info('[HERO_VAULT_SELECT]', {
        stage: 'commitHeroAssetSelection',
        assetId: record.assetId,
        backgroundSource: isVideo ? 'custom_video' : 'custom_image',
        mediaUrl: record.mediaUrl,
        title: record.title,
        revision: record.revision,
        revisionDelta: record.revision - beforeRevision,
        ts: new Date().toISOString()
    });

    const pointer = projectHeroRecordToManagerPointer(record);
    return saveHeroManagerConfig({
        heroAssetId: pointer.heroAssetId,
        backgroundSource: /** @type {any} */ (pointer.backgroundSource),
        backgroundStyle: pointer.backgroundStyle || (isVideo ? 'video' : 'image'),
        // Durable media URLs for PUT /api/hero/presentation (not only asset id).
        mediaUrl,
        posterUrl,
        backgroundMediaUrl: mediaUrl,
        ...intelBundle.patch
    });
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

/**
 * Catalog of pickable hero media: Video Vault + Thumbnail Vault + feed + active hero.
 * Used by the Vault Hero Asset dropdown so admins can choose any ready vault video/image.
 * @param {Record<string, unknown>[] | null} [extraItems] optional live store rows (e.g. personalVideos)
 * @returns {Record<string, unknown>[]}
 */
export function loadHeroVaultItems(extraItems = null) {
    if (typeof window === 'undefined') return Array.isArray(extraItems) ? extraItems : [];
    try {
        // Do not migrateLegacyHeroStorageIfNeeded here — listing vault picks must not
        // invent a default HeroRecord (identity writes stay owned by select*/set*/commit*).
        /** @type {Record<string, unknown>[]} */
        const collected = [];
        const seen = new Set();

        /**
         * @param {Record<string, unknown>} entry
         * @param {string} source
         */
        const push = (entry, source) => {
            if (!isEligibleHeroVaultPick(entry)) return;
            const entryId = String(entry.id || entry.assetId || entry.personal_video_id || '').trim();
            if (!entryId || seen.has(entryId)) return;
            seen.add(entryId);
            collected.push({
                ...entry,
                id: entryId,
                _heroPickSource: source
            });
        };

        for (const entry of readLocalJsonArray(VIDEO_VAULT_STORAGE_KEY)) {
            if (entry && typeof entry === 'object') push(/** @type {Record<string, unknown>} */ (entry), 'video_vault');
        }
        for (const entry of readLocalJsonArray(THUMB_VAULT_STORAGE_KEY)) {
            if (entry && typeof entry === 'object') push(/** @type {Record<string, unknown>} */ (entry), 'thumbnail_vault');
        }
        for (const entry of collectFeedVideoReelRecords()) {
            if (entry && typeof entry === 'object') push(/** @type {Record<string, unknown>} */ (entry), 'feed');
        }
        if (Array.isArray(extraItems)) {
            for (const entry of extraItems) {
                if (entry && typeof entry === 'object') {
                    push(/** @type {Record<string, unknown>} */ (entry), 'live_store');
                }
            }
        }

        const reel = peekHeroReelWithoutMigrate();
        if (reel?.id && reel?.url) {
            push(/** @type {Record<string, unknown>} */ (heroReelToVaultItem(reel)), 'active_hero');
        }

        // Videos first (natural hero backgrounds), then images.
        collected.sort((a, b) => {
            const aUrl = String(a.url || a.mediaUrl || a.videoUrl || '');
            const bUrl = String(b.url || b.mediaUrl || b.videoUrl || '');
            const aVideo = HERO_VIDEO_EXTENSIONS.test(aUrl) || String(a.type || '').startsWith('video/');
            const bVideo = HERO_VIDEO_EXTENSIONS.test(bUrl) || String(b.type || '').startsWith('video/');
            if (aVideo !== bVideo) return aVideo ? -1 : 1;
            const aName = String(a.title || a.name || a.fileName || a.id || '');
            const bName = String(b.title || b.name || b.fileName || b.id || '');
            return aName.localeCompare(bName);
        });

        console.info('[HERO_REGISTRY_TRACE]', {
            stage: 'loadHeroVaultItems:expanded',
            vaultItemsCount: collected.length,
            videoVault: readLocalJsonArray(VIDEO_VAULT_STORAGE_KEY).length,
            thumbVault: readLocalJsonArray(THUMB_VAULT_STORAGE_KEY).length,
            feed: collectFeedVideoReelRecords().length,
            extra: Array.isArray(extraItems) ? extraItems.length : 0,
            ts: new Date().toISOString()
        });
        return collected;
    } catch {
        return Array.isArray(extraItems) ? extraItems : [];
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
    // Server presentation cache: mediaUrl/poster on manager when vault not hydrated yet.
    if (!bridgeAsset) {
        const cachedMedia = String(
            config.mediaUrl || config.backgroundMediaUrl || config.backgroundVideo || config.backgroundImage || ''
        ).trim();
        if (cachedMedia && heroAssetId) {
            const isVideo =
                isVideoHeroAssetType(inferHeroAssetType(cachedMedia)) ||
                String(config.backgroundSource || '').includes('video');
            bridgeAsset = normalizeHeroAssetRecord(
                {
                    id: heroAssetId,
                    assetId: heroAssetId,
                    url: cachedMedia,
                    mediaUrl: cachedMedia,
                    thumbnail: String(config.posterUrl || '').trim() || undefined,
                    type: isVideo ? 'video/mp4' : 'image/jpeg',
                    name: String(config.heroTitle || config.heroAssetTitle || 'Hero')
                },
                { storageSource: 'server_presentation_cache' }
            );
        }
    }
    const resolvedAsset = bridgeAsset;
    const mediaUrl = resolvedAsset?.mediaUrl || '';
    const resolvedAssetType = resolvedAsset?.assetType || 'unknown';
    const videoUrl = isVideoHeroAssetType(resolvedAssetType) ? mediaUrl : '';
    const imageUrl = isVideoHeroAssetType(resolvedAssetType)
        ? resolvedAsset?.thumbnailUrl || String(config.posterUrl || '').trim() || ''
        : mediaUrl;

    const resolved = {
        assetId: canonicalReel?.id || heroAssetId || resolvedAsset?.assetId || '',
        vaultMatch: Boolean(bridgeAsset),
        mediaUrl,
        assetType: resolvedAssetType,
        videoUrl,
        imageUrl
    };
    const signature = `${resolved.assetId}|${resolved.mediaUrl}|${resolved.assetType}|${config.backgroundSource}|${config.heroTitle || ''}`;
    if (options.log !== false && signature !== lastAssetResolveSignature) {
        const sourceTag =
            getLastHeroConfigSource() ||
            (heroAssetId ? 'localStorage' : 'default');
        logHeroSource({
            source: sourceTag,
            heroAssetId: resolved.assetId || heroAssetId,
            title: String(config.heroTitle || config.heroAssetTitle || ''),
            backgroundUrl: resolved.mediaUrl || resolved.videoUrl || resolved.imageUrl || ''
        });
    }
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
    // HeroRecord is authoritative for identity / blank / selected custom assets.
    const record = loadHeroRecord();

    if (record.mode === 'none') {
        return applyHeroRecordToStores(record, stores);
    }

    if (record.mode === 'asset') {
        return applyHeroRecordToStores(record, stores);
    }

    // selection — intelligence / selection resolver owns media (unless respectSelection false).
    if (options.respectSelection !== false && (record.mode === 'selection' || config.backgroundSource === 'selection')) {
        return false;
    }

    // Compatibility fallback when record is selection but caller forces manager custom paths.
    if (config.backgroundSource === 'none') {
        stores.setVideo?.('');
        stores.setPoster?.('');
        stores.setFailed?.(false);
        return true;
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

/**
 * @param {{
 *   episodeId?: string | null;
 *   resolvedReelId?: string;
 *   foundInFeed?: boolean;
 *   hasVideoUrl?: boolean;
 *   source?: string;
 * }} payload
 */
export function logHeroIdentityBridge(payload) {
    console.info('[HERO_IDENTITY_BRIDGE]', {
        episodeId: payload.episodeId || null,
        resolvedReelId: payload.resolvedReelId || '',
        foundInFeed: payload.foundInFeed === true,
        hasVideoUrl: payload.hasVideoUrl === true,
        reason: payload.reason || null,
        source: payload.source || 'candidateFromEpisode',
        ts: new Date().toISOString()
    });
}

/**
 * Selection-mode presentation — uses episode candidate identity, not hero vault config.
 * @param {HeroManagerConfig} config
 * @param {HeroSelection | null | undefined} selection
 * @param {string} style
 * @returns {HeroBackgroundPresentation}
 */
function resolveSelectionHeroBackgroundPresentation(config, selection, style) {
    const reelId = String(selection?.reelId || '').trim();
    const videoUrlRaw = String(selection?.videoUrl || '').trim();
    const posterUrlRaw = String(selection?.posterUrl || '').trim();
    const videoUrl = videoUrlRaw ? toRelativeMediaPath(videoUrlRaw) || videoUrlRaw : '';
    const posterUrl = posterUrlRaw
        ? resolveUserPosterUrl(posterUrlRaw) || toRelativeMediaPath(posterUrlRaw) || posterUrlRaw
        : '';
    const mediaUrl = videoUrl || posterUrl;
    const assetType = mediaUrl ? inferHeroAssetType(mediaUrl) : 'unknown';
    const isVideo = isVideoHeroAssetType(assetType);

    console.info('[HERO_ROUTE]', {
        stage: 'resolveHeroBackgroundPresentation:selection',
        heroAssetId: config.heroAssetId || '',
        resolvedAssetId: reelId,
        assetType,
        mediaUrl,
        videoUrl: isVideo ? mediaUrl : videoUrl,
        imageUrl: isVideo ? posterUrl : mediaUrl || posterUrl,
        vaultMatch: false,
        ts: new Date().toISOString()
    });

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
        useVideo: style === 'video' || style === 'ambient_motion' || Boolean(videoUrl),
        useImage: style === 'image' || Boolean(!videoUrl && posterUrl),
        ambientMotion: style === 'ambient_motion',
        cinematicBlur: style === 'cinematic_blur',
        gradientOverlay: style === 'gradient_overlay',
        backgroundSource: config.backgroundSource,
        backgroundAsset: reelId,
        heroAssetId: config.heroAssetId || '',
        assetId: reelId,
        vaultMatch: false,
        mediaUrl,
        assetType,
        videoUrl: isVideo ? mediaUrl : videoUrl,
        imageUrl: isVideo ? posterUrl : mediaUrl || posterUrl
    };
}

/** @param {HeroManagerConfig} [config] @param {Record<string, unknown>[] | null} [vaultItems] @param {HeroSelection | null} [selection] @returns {HeroBackgroundPresentation} */
export function resolveHeroBackgroundPresentation(
    config = loadHeroManagerConfig(),
    vaultItems = null,
    selection = null
) {
    const style = HERO_BACKGROUND_STYLES.includes(config.backgroundStyle)
        ? config.backgroundStyle
        : 'gradient_overlay';

    if (config.backgroundSource === 'none') {
        console.info('[HERO_ROUTE]', {
            stage: 'resolveHeroBackgroundPresentation:none',
            heroAssetId: '',
            resolvedAssetId: '',
            assetType: 'none',
            mediaUrl: '',
            videoUrl: '',
            imageUrl: '',
            vaultMatch: false,
            ts: new Date().toISOString()
        });
        return {
            style: 'gradient_overlay',
            containerClasses: [],
            overlayClasses: ['hero-bg-gradient-overlay'],
            useVideo: false,
            useImage: false,
            ambientMotion: false,
            cinematicBlur: false,
            gradientOverlay: true,
            backgroundSource: 'none',
            backgroundAsset: '',
            heroAssetId: '',
            assetId: '',
            vaultMatch: false,
            mediaUrl: '',
            assetType: 'none',
            videoUrl: '',
            imageUrl: ''
        };
    }

    if (config.backgroundSource === 'selection') {
        return resolveSelectionHeroBackgroundPresentation(config, selection, style);
    }

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
    if (Array.isArray(feed)) {
        return feed.filter(
            (reel) => reel && !reel.isPresentationOnly && !reel.layoutOnly
        );
    }
    if (!feed || typeof feed !== 'object') return [];
    return Object.values(feed)
        .flat()
        .filter((reel) => reel && !reel.isPresentationOnly && !reel.layoutOnly);
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
    const reel = resolveReelForEpisode(
        episodeId,
        (reelId) => findReelInFeedList(feedReels, reelId),
        () => feedReels
    );
    const media = resolveReelMedia(reel, series.poster || '');
    const resolvedReelId = reel?.id ? String(reel.id) : '';
    const videoUrl = media.videoUrl || undefined;

    if (!reel || !videoUrl) {
        logHeroIdentityBridge({
            episodeId,
            resolvedReelId,
            foundInFeed: Boolean(reel?.id),
            hasVideoUrl: false,
            reason: 'missing_playable_media',
            source: 'candidateFromEpisode_rejected'
        });
        return null;
    }

    const posterUrl = media.posterUrl || series.poster || undefined;
    const mediaUrl = videoUrl || posterUrl || undefined;

    logHeroIdentityBridge({
        episodeId,
        resolvedReelId,
        foundInFeed: Boolean(reel?.id),
        hasVideoUrl: true,
        source: 'candidateFromEpisode'
    });

    const candidate = {
        source,
        title: episode.title || series.title,
        subtitle: subtitle || series.description || '',
        seriesId: series.id,
        seriesTitle: series.title,
        episodeId: episode.episodeId,
        reelId: resolvedReelId || undefined,
        videoUrl,
        posterUrl,
        score,
        meta: {
            ...meta,
            episodeStatus: episode.status,
            resolvedReel: reel
                ? {
                      id: resolvedReelId,
                      videoUrl: videoUrl || '',
                      thumbnailUrl: posterUrl || '',
                      mediaUrl: mediaUrl || ''
                  }
                : undefined
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
 * True when the viewer has an explicit HeroRecord override (asset or intentional blank).
 * Selection mode is NOT an override — intelligence may choose the background.
 * @param {{ HERO_VIDEO_STORAGE_KEY?: string; HERO_IMAGE_STORAGE_KEY?: string; HERO_VIDEO_PATHS?: string[] }} [config]
 */
export function hasUserHeroOverride(config = {}) {
    if (typeof window === 'undefined') return false;
    void config;
    const record = loadHeroRecord();
    if (record.mode === 'none') return true;
    if (record.mode === 'asset' && String(record.assetId || '').trim() && String(record.mediaUrl || '').trim()) {
        return true;
    }
    return false;
}

/**
 * Synchronously restore hero background from HeroRecord (source of truth).
 * One-way legacy migration may seed HeroRecord first; legacy reel/video/image keys
 * never override a valid HeroRecord during hydration.
 *
 * @param {{ setVideo?: (url: string) => void; setPoster?: (url: string) => void; setFailed?: (failed: boolean) => void }} stores
 * @param {{ HERO_VIDEO_STORAGE_KEY?: string; HERO_IMAGE_STORAGE_KEY?: string }} [appConfig]
 * @returns {'unchanged' | 'image' | 'video' | 'pending_default'}
 */
export function hydrateHeroBackgroundStoresSync(stores = {}, appConfig = {}) {
    if (typeof window === 'undefined') return 'unchanged';
    void appConfig;

    // Populate HeroRecord from legacy keys when missing (does not authorize those keys after).
    migrateLegacyHeroRecordIfNeeded();
    let record = loadHeroRecord();
    const manager = loadHeroManagerConfig();

    // Product default: manager none + soft default selection → intentional blank menu.
    if (
        (record.mode === 'selection' &&
            (record.source === 'migrate_default_selection' ||
                record.source === 'default' ||
                !record.updatedAt)) &&
        String(manager.backgroundSource || '').trim() === 'none'
    ) {
        stores.setVideo?.('');
        stores.setPoster?.('');
        stores.setFailed?.(false);
        console.info('[HERO_LOAD]', {
            stage: 'hydrateHeroBackgroundStoresSync:default_blank',
            backgroundSource: 'none',
            recordMode: record.mode,
            ts: new Date().toISOString()
        });
        return 'unchanged';
    }

    // Explicit manager none aligned into record via migrate — clear without resurrecting legacy media.
    if (record.mode === 'none') {
        applyHeroRecordToStores(record, stores);
        console.info('[HERO_LOAD]', {
            stage: 'hydrateHeroBackgroundStoresSync:none',
            backgroundSource: 'none',
            heroAssetId: '',
            revision: record.revision,
            ts: new Date().toISOString()
        });
        return 'unchanged';
    }

    if (record.mode === 'asset') {
        const kind = applyHeroRecordBackground(record, stores);
        console.info('[HERO_LOAD]', {
            stage: 'hydrateHeroBackgroundStoresSync:record_asset',
            assetId: record.assetId || '',
            mediaKind: record.mediaKind || '',
            mediaUrl: record.mediaUrl || '',
            revision: record.revision,
            result: kind,
            ts: new Date().toISOString()
        });
        return kind === 'pending_default' ? 'pending_default' : kind;
    }

    // selection — intelligence resolves background later; do not read legacy media keys.
    stores.setFailed?.(false);
    console.info('[HERO_LOAD]', {
        stage: 'hydrateHeroBackgroundStoresSync:selection',
        heroAssetId: '',
        revision: record.revision,
        ts: new Date().toISOString()
    });
    return 'pending_default';
}

/**
 * Restore hero background from HeroRecord, then optional server default when selection is pending.
 * @param {{ setVideo?: (url: string) => void; setPoster?: (url: string) => void; setFailed?: (failed: boolean) => void }} stores
 * @param {{ HERO_VIDEO_STORAGE_KEY?: string; HERO_IMAGE_STORAGE_KEY?: string; HERO_VIDEO_PATHS?: string[]; resolveVideoUrl?: (path: string) => string }} [appConfig]
 */
export async function hydrateHeroBackgroundStores(stores = {}, appConfig = {}) {
    if (typeof window === 'undefined') return 'unchanged';

    const syncResult = hydrateHeroBackgroundStoresSync(stores, appConfig);
    if (syncResult !== 'pending_default') {
        return syncResult;
    }

    // Only selection/pending may accept server defaults. Never resurrect over none/asset.
    const record = loadHeroRecord();
    if (record.mode === 'none' || record.mode === 'asset') {
        return applyHeroRecordBackground(record, stores);
    }

    const defaultPaths = appConfig.HERO_VIDEO_PATHS?.length
        ? appConfig.HERO_VIDEO_PATHS
        : [DEFAULT_HERO_BACKGROUND_VIDEO];
    const resolveVideoUrl =
        appConfig.resolveVideoUrl ||
        ((path) => (path.startsWith('http') || path.startsWith('blob:') ? path : path));

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
        hydrateHeroBackgroundStoresSync,
        hydrateHeroBackgroundStores,
        DEFAULT_HERO_BACKGROUND_VIDEO,
        loadHeroVaultItems,
        commitHeroVideoIdentity,
        commitHeroAssetSelection,
        syncHeroViewerCopyFromAsset,
        analyzeHeroTitle,
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
