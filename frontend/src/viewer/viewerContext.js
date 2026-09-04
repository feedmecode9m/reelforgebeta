/**
 * Viewer runtime context — Phase 26 decomposition.
 */
import { writable, derived, get } from 'svelte/store';
import { API_BASE_URL, BACKEND_URL, checkBackendHealth, fetchWithRetry, getAdminAuthHeaders, clearAdminSession, notifyBackendReconnecting } from '../lib/api.js';
import { canAccessStudio, logout as authLogout, refreshSession as refreshAuthSession } from '../lib/auth/index.js';
import { deleteMediaFile, uploadMedia, uploadThumbnail } from '../lib/api/media.js';
import {
initReelshortProfile,
configureReelshortExperience,
clearTheaterCountdown
} from '../components/vertical/ReelshortExperience.svelte';
import { auditEpisodeAssets } from '../lib/series/episodeAssetStatus.js';
import { initSeriesMetadata, resolveSeriesContextForReel, getEpisodeById } from '../lib/series/seriesStore.js';
import { initStudioSync } from '../lib/sync/studioSync.js';
import { recordStudioUsage, initPlatformMetrics } from '../lib/observability/platformMetrics.js';
import { initObservabilityCenter } from '../lib/observability/observabilityCenter.js';
import { initWorkflowEngine } from '../lib/workflow/workflowEngine.js';
import { initCreatorTeams } from '../lib/teams/creatorTeams.js';
import { initNotificationCenter } from '../lib/notifications/notificationCenter.js';
import { initEpisodePipeline } from '../lib/pipeline/episodePipeline.js';
import { initCommandCenter } from '../lib/command/commandCenter.js';
import {
        applyHeroManagerBackground,
        applyHeroSelection,
        buildHeroCommandBrief,
        hasDurableHeroOverride,
        hasUserHeroOverride,
        hydrateHeroBackgroundStores,
        hydrateHeroBackgroundStoresSync,
        initHeroIntelligence,
        loadHeroManagerConfig,
        mapPlatformHeroMode,
        selectHeroContent,
        startHeroRotation,
        stopHeroRotation,
        logHeroConfigBootTrace
    } from '../lib/hero/heroIntelligence.js';
import {
    loadHeroRecord,
    applyHeroRecordBackground,
    mergeHeroRecordIntoManagerConfig
} from '../lib/hero/heroRecord.js';
import { loadHeroReel, resolveActiveHeroVideoReel, heroReelToVaultItem } from '../lib/hero/heroReelIdentity.js';
import { isHeroAsset, filterNonHeroAssets } from '../lib/hero/heroDomainGuard.js';
import { sealVaultAssetsWithEnrichment } from '../lib/series/vaultEpisodeEnrichment.js';
import { mergeTitleIntoPersistentMap } from '../lib/content/persistentTitleMap.js';
import {
    reconcileFeedToCanonicalShelves,
    syncCategoryAliasStore
} from '../lib/feed/discoveryTaxonomy.js';
import {
    PERSONAL_VIDEO_VAULT_MINIMAL_FIELDS,
    overlayLocalCreatorVaultAuthority,
    indexVaultAssetsByMediaId,
    pickDurableVaultStillUrl
} from '../lib/vault/vaultCreatorAuthority.js';
import { shouldStreamDiagnostics } from '../lib/diagnostics/pipelineSnapshot.js';
import { notifyInterruptedUploads } from '../lib/diagnostics/uploadRecovery.js';
import { getActiveUploadLockCount } from '../lib/diagnostics/uploadLockDiag.js';
import { initReleaseCenter } from '../lib/release/releaseCenter.js';
import { initPredictiveRepairEngine } from '../lib/repair/predictiveRepairEngine.js';
import { initCreatorKnowledgeGraph } from '../lib/graph/creatorKnowledgeGraph.js';
import { initStudioAudioEngine } from '../lib/studio/studioAudioEngine.js';
import { initStudioAppearanceEngine } from '../lib/studio/studioAppearance.js';
import { initCreatorCopilot } from '../lib/copilot/creatorCopilot.js';
import { initStudioAssistant } from '../lib/copilot/studioAssistant.js';
import { initSeriesApi } from '../lib/api/seriesApi.js';
import {
    bridgeFeedReelsToCatalog,
    auditEpisodeBridgeCoverage,
    applyEpisodeFieldsToReel
} from '../lib/series/episodeBridge.js';
import { configureEpisodeNavigation } from '../lib/series/episodeNavigation.js';
import { runPlatformAudit } from '../lib/platform/platformAudit.js';
import { initSecurityAuditEngine } from '../lib/security/securityAuditEngine.js';
import { initThreatDetectionEngine } from '../lib/security/threatDetectionEngine.js';
import { initSecurityPolicyEngine } from '../lib/security/securityPolicyEngine.js';
import { initSecurityOperationsCenter } from '../lib/security/securityOperationsCenter.js';
import { initSentinelAssistant } from '../lib/sentinel/sentinelAssistant.js';
import { initDiscoveryEngine } from '../lib/discovery/discoveryEngine.js';
import { initHomepageDiscoveryFeed } from '../lib/discovery/homepageDiscoveryFeed.js';
import { initCreatorHomeFeed } from '../lib/discovery/creatorHomeFeed.js';
import { initDiscoveryFeedEngine } from '../lib/discovery/discoveryFeedEngine.js';
import { initCreatorProfileEngine } from '../lib/creator/creatorProfileEngine.js';
import { initMonetizationHub } from '../lib/monetization/monetizationHub.js';
import { initSupportReelforge } from '../lib/support/supportReelforge.js';
import { initDailyEngagementSystem } from '../lib/engagement/dailyEngagement.js';
import { initUniversalSearchEngine } from '../lib/search/universalSearchEngine.js';
import { initDeepNavigation } from '../lib/navigation/deepNavigation.js';
import { initRevenueEngine } from '../lib/revenue/revenueEngine.js';
import { initRevenueCore } from '../lib/revenue/revenueCore.js';
import { initRevenueDashboard } from '../lib/revenue/revenueDashboard.js';
import { initMonetizationAI } from '../lib/revenue/monetizationAI.js';
import { initMarketplaceEngine } from '../lib/marketplace/marketplaceEngine.js';
import { initEnterpriseManager } from '../lib/enterprise/enterpriseManager.js';
import { initProductionPipelineEngine } from '../lib/workflows/productionPipelineEngine.js';
import { initReportingEngine } from '../lib/reporting/reportingEngine.js';
import { initPublishingProfile } from '../lib/publishing/publishingProfileStore.js';
import { logTheaterOpen, logTheaterState } from '../lib/theater/theaterDiagnostics.js';
import { logMobilePlayTrace } from '../lib/device/mobileExperienceDiagnostics.js';
import { resolveDisplayUrl } from '../components/media/resolveDisplayUrl.js';
import { connectReelEventSocket } from '../lib/wsReelEvents.js';
import { toBackendMediaUrl, toRelativeMediaPath, logResolvedMediaUrl, logFinalMediaUrl, videoMimeForPath, auditRenderedMediaUrls } from '../lib/config.js';
import {
resolveUserPosterUrl,
filenameFromMediaRef
} from '../lib/vaultMedia.js';
import {
logDeletionPropagation,
purgeMediaFromClientState,
pruneFeedAgainstBackendVideos,
videoInventoryKey,
diagnoseStalePlaceholders,
applyCanonicalDeleteClientEffects,
filterOutDeletedMedia,
filterDeletedFromFeedMap,
isDeletedMediaId,
reconcileTombstonesAgainstCatalog,
isPendingLocalVideoVaultEntry
} from '../lib/deletionSync.js';
import { normalizeReel, normalizeReels, createLocalReel, isVideoReel, assertReelContract } from '../lib/api/reelContract.js';
import { resolveTheaterPlayback, logTheaterHandshake } from '../lib/media/theaterPlayback.js';
import {
watchSessionStart,
watchOnPlay,
watchOnPause,
watchOnComplete,
watchOnExit,
watchOnProgress,
watchApplyResume
} from '../lib/watch/watchTracker.js';
import { safeFirstFile, logUploadError, safeFn, isValidVideoType, validateVideoFile, sanitizeGoogleDriveUrl, isValidVideoUrl } from '../lib/runtime-guards.js';
import {
prepareStorageOnStartup,
safeStorageSet,
storeThumbnailMetadata,
safeLocalStorageSet,
clearOldestThumbnailData,
clearThumbnailRelatedData,
getLocalStorageSize,
hasStorageSpaceFor,
isStorageFull,
wouldExceedQuota,
logStorageState,
resetLocalData,
formatBytes
} from '../lib/storage.js';
import {
    buildHomeFeed,
    applyPlaceholderFallbackIfEmpty,
    countRealFeedCards,
    emptyFeedMap
} from '../lib/feed/buildHomeFeed.js';
import { logViewerMediaIdentityDiagnostics } from '../lib/feed/viewerMediaIdentity.js';
import {
ALLOW_UI_PLACEHOLDERS,
bootstrapMediaFromBackend,
feedHasRealContent,
hasLocalMediaCache,
hydrateVaultFromReels,
reelsToVideoVaultEntries
} from '../lib/mediaBootstrap.js';
import { pipelineCheckpoint, pipelineDiag } from '../lib/diagnostics/pipelineDiag.js';
import { logBg7jHydrationReady } from '../lib/diagnostics/bg7jHydrationGate.js';
import { logBg7kCatalogReceive, logBg7kPlaceholderFallback } from '../lib/diagnostics/bg7kCardRenderTrace.js';
import { traceCatalogFeedDecisions, emitBg7lFeedSummary } from '../lib/diagnostics/bg7lFeedContract.js';
import {
    logBg7nStage,
    logBg7nLocalStorageFeed
} from '../lib/diagnostics/bg7nPipelineTrace.js';
import { logBg7pShelfDistribution } from '../lib/diagnostics/bg7pShelfDistribution.js';
import { reelResReelSnapshot, reelResStoreMutation } from '../lib/diagnostics/reelResolutionTrace.js';
import { createContentAgents } from '../lib/viewer/contentAgents.js';
import {
  logHeroBackgroundVideoChange,
  logPersonalVideosChange
} from '../lib/diagnostics/renderGateForensics.js';
import { traceVideoStoreBoundary } from '../lib/diagnostics/videoStoreTrace.js';
import {
  filterStaleOrphanEntries,
  isThumbnailImageReel,
  thumbnailEntryFileKey
} from '../lib/viewer/thumbnailCanonicalization.js';
import {
  reconcileThumbnailVault,
  syncCollectionStore,
  readThumbnailVault,
  deriveCollectionKeys,
  upgradeThumbnailVaultFromBackendReels,
  THUMBNAIL_KEY
} from '../lib/viewer/thumbnailVault.js';
import { traceThumbStoreWrite } from '../lib/viewer/thumbStoreWriteTrace.js';
import { createAiCleanupAgent } from '../lib/viewer/aiCleanupAgent.js';
import { createUiAgent } from '../lib/viewer/uiAgent.js';
import { createVaultUtils, resolveDurableViewerPoster } from '../lib/viewer/vaultUtils.js';
import {
  activeReel,
  theaterManager,
  openTheaterReel,
  configureTheaterExperience
} from '../components/theater/TheaterExperience.svelte';

export function createViewerContext() {
// ==========================================
// Constants & Configuration
// ==========================================
const DEFAULT_SIGNED_UPLOAD_MAX_BYTES = 2_147_483_648; // 2 GiB
function resolveMaxVideoSizeBytes() {
  const raw = (
    import.meta.env.VITE_MAX_VIDEO_SIZE_BYTES ||
    import.meta.env.VITE_SIGNED_UPLOAD_MAX_BYTES ||
    ''
  )
    .toString()
    .trim();
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_SIGNED_UPLOAD_MAX_BYTES;
}

const CONFIG = Object.freeze({
CATEGORIES: ['Auto-Detect', 'Trending', 'Cyber-Action', 'Romance', 'Suspense'],
HERO_VIDEO_PATHS: [
'/videos/hero-background.mp4',
'/hero-background.mp4',
'/videos/hero-background.MOV',
'/hero-background.MOV'
],
USER_BARBERSHOP_IMAGE: 'Gemini_Generated_Image_n2kch2n2kch2n2kc.png',
VIDEO_VAULT_KEY: 'personal_video_vault',
HERO_VIDEO_STORAGE_KEY: 'reelforge_hero_video',
HERO_IMAGE_STORAGE_KEY: 'reelforge_hero_image',
CATEGORY_NAMES_KEY: 'reelforge_category_names',
THUMBNAIL_STORAGE_KEY: 'personal_thumbnails',
THUMBNAIL_INDEX_KEY: 'personal_thumbnail_index',
TITLES_STORAGE_KEY: 'reel_titles_persistent',
RECENTLY_VIEWED_KEY: 'recently_viewed',
VAULT_KEY: 'reel_vault',
TITLES_KEY: 'reel_titles',
VIDEO_VAULT_INDEX_KEY: 'video_vault_index',
FEED_STORAGE_KEY: 'reelforge_feed',
MAX_VIDEO_SIZE: resolveMaxVideoSizeBytes(),
MAX_VAULT_ITEMS: 20,
MAX_RECENT_ITEMS: 50,
CLEANUP_INTERVAL: 5 * 60 * 1000,
MAX_VAULT_AGE: 7 * 24 * 60 * 60 * 1000,
HEALTH_CHECK_DELAY: 2000,
TARGET_LANDSCAPE_COUNT: 12,
ADMIN_PASSWORD: import.meta.env.VITE_ADMIN_PASSWORD || 'admin123'
});
const DEBUG_MEDIA = import.meta.env.DEV;
const NEON_COLORS = Object.freeze({
red: '#E50914',
cyan: '#00f2ff',
pink: '#ff00ff',
gold: '#FFD700'
});

// BG-7W: transient admission gate to prevent hero reels racing into the video vault
// before hero identity/config is persisted.
const pendingHeroAssetIds = new Set();
let heroUploadInFlight = false;
// ==========================================
// Safe LocalStorage with Quota Protection
// ==========================================
function storageSet(key, value) {
return safeStorageSet(key, value, { thumbnailKey: CONFIG.THUMBNAIL_STORAGE_KEY });
}
function clearApplicationCache() {
clearThumbnailRelatedData();
clearOldestThumbnailData(CONFIG.THUMBNAIL_STORAGE_KEY, 5);
logStorageState('after-clear-cache');
uploadStatus.set('🧹 Cache cleared');
resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
}
function resetAllLocalData() {
if (!confirm('Reset ALL local data? Auth tokens and settings will be cleared and the page will reload.')) return;
resetLocalData();
}
function persistPersonalVault(videos) {
const inputVideos = Array.isArray(videos) ? videos : [];
let filtered = filterOutDeletedMedia(inputVideos);
// Hero MP4s belong in personal_video_vault (Hero Vault inventory). Feed
// distribution still uses filterNonHeroAssets; stripping them here made the
// selected Hero vanish from storage after refresh.
try {
  const existing = JSON.parse(
    (typeof window !== 'undefined' ? localStorage.getItem(CONFIG.VIDEO_VAULT_KEY) : null) || '[]'
  );
  const inputIds = new Set(
    filtered.map((row) => String(row?.id || '').trim()).filter(Boolean)
  );
  for (const row of Array.isArray(existing) ? existing : []) {
    if (!row || typeof row !== 'object') continue;
    if (!isHeroAsset(row)) continue;
    const id = String(row.id || '').trim();
    if (id && isDeletedMediaId(id)) continue;
    if (id && inputIds.has(id)) continue;
    filtered.push(row);
    if (id) inputIds.add(id);
  }
} catch {
  /* keep incoming list */
}
// Seal durable seriesIdentity from Hero Vault title labels before write
filtered = sealVaultAssetsWithEnrichment(filtered);
traceVideoStoreBoundary('persistPersonalVault:filterOutDeletedMedia', inputVideos, filtered, {
reasons: 'filterOutDeletedMedia+retainHeroVaultRows'
});
if (pendingHeroAssetIds.size) {
  const before = filtered.length;
  /** @type {Array<{ id: string; reason: string }>} */
  const pendingRemoved = [];
  filtered = filtered.filter((v) => {
    const id = String(v?.id || '').trim();
    const blocked = Boolean(id) && pendingHeroAssetIds.has(id);
    if (blocked) {
      pendingRemoved.push({ id, reason: 'hero_pending' });
      console.info('[BG7W_HERO_VAULT_GATE]', { reelId: id, blocked: true, reason: 'hero_pending' });
    }
    return !blocked;
  });
  // Re-seal after pending filter (entries not restructured, but keep identity path consistent)
  filtered = sealVaultAssetsWithEnrichment(filtered);
  traceVideoStoreBoundary('persistPersonalVault:pendingHeroAssetIds', inputVideos, filtered, {
    removed: pendingRemoved,
    reasons: 'pendingHeroAssetIds'
  });
  if (before !== filtered.length) {
    console.info('[BG7W_HERO_VAULT_GATE]', {
      reelId: '',
      blocked: true,
      reason: 'hero_pending:persistPersonalVault',
      before,
      after: filtered.length
    });
  }
}
console.info('[BG7G_STORE]', {
ts: new Date().toISOString(),
component: 'persistPersonalVault',
file: 'viewerContext.js',
fileName: filtered[0]?.fileName || filtered[0]?.name || null,
fileSize: filtered[0]?.size ?? null,
uploadUrl: filtered[0]?.url || null,
state: 'persist_start',
count: filtered.length,
storageKey: CONFIG.VIDEO_VAULT_KEY
});
safeLocalStorageSet(CONFIG.VIDEO_VAULT_KEY, filtered, {
// Do not pass thumbnailKey here — that trips THUMB_OWNER_VIOLATION on every video persist.
quotaEvictThumbnailKey: CONFIG.THUMBNAIL_STORAGE_KEY,
// Keep uploadState so dedupe can ignore in-flight optimistic cards after reload.
// blob:/data: urls are stripped inside safeLocalStorageSet (memory-only preview).
// episodeEnrichment + seriesIdentity (incl. confirmedByCreator) must survive hard reload.
minimalFields: PERSONAL_VIDEO_VAULT_MINIMAL_FIELDS
});
}
// ==========================================
// Store Factory
// ==========================================
function createPersistentStore(key, defaultValue) {
const { subscribe, set, update } = writable(defaultValue, (set) => {
if (typeof window === 'undefined') return;
try {
const saved = localStorage.getItem(key);
if (saved) {
const parsed = JSON.parse(saved);
set(parsed);
}
} catch (e) {
console.error(`Failed to load ${key}:`, e);
}
return () => {};
});
const persistValue = (value) => {
if (typeof window === 'undefined') return;
try {
localStorage.setItem(key, JSON.stringify(value));
} catch (e) {
console.error(`Failed to persist ${key}:`, e);
}
};
return {
subscribe,
set: (value) => {
persistValue(value);
set(value);
},
update: (updater) => {
update((current) => {
const next = updater(current);
persistValue(next);
return next;
});
}
};
}
function createValidatedStore(defaultValue, validator = null) {
const { subscribe, set, update } = writable(defaultValue);
return {
subscribe,
set: (value) => {
if (validator && !validator(value)) {
console.warn('Invalid value rejected:', value);
return;
}
set(value);
},
update
};
}
// ==========================================
// Core State Stores
// ==========================================
const feed = writable({});
// Persist feed to localStorage automatically
if (typeof window !== 'undefined') {
feed.subscribe(value => {
logBg7nStage('feed.subscribe', value);
storageSet(CONFIG.FEED_STORAGE_KEY, value);
});
}
const categories = writable([]);
const loading = writable(true);
const contentEmpty = writable(false);
// Phase 0: adminMode is ephemeral UI state only (never sticky authority from localStorage).
const adminMode = writable(false);
const controlCenterOpen = writable(false);
const uploadStatus = createValidatedStore('Standby', (v) => typeof v === 'string');

function isUploadFlowActive() {
  if (getActiveUploadLockCount() > 0) return true;
  const status = String(get(uploadStatus) || '');
  return /Uploading|Processing|Finalizing|🎬/.test(status);
}

function setUploadStatusIfIdle(message) {
  if (isUploadFlowActive()) return;
  uploadStatus.set(message);
}

function applyUploadProgressDetail(detail = {}) {
  const fileName = String(detail.fileName || '').trim();
  const percent = detail.percent;
  const phase = String(detail.phase || '');
  const stage = String(detail.stage || '');
  const loaded = Number(detail.loaded);
  const total = Number(detail.total);
  if (phase === 'finalize') {
    uploadStatus.set(`🎬 Finalizing ${fileName || 'video'}…`);
    return;
  }
  if (phase === 'ingest') {
    uploadStatus.set(
      `🎬 Processing ${fileName || 'video'} on server${stage ? ` (${stage})` : ''}…`
    );
    return;
  }
  if (fileName && percent != null && !Number.isNaN(Number(percent))) {
    let etaHint = '';
    if (
      Number.isFinite(loaded) &&
      Number.isFinite(total) &&
      loaded > 0 &&
      total > loaded
    ) {
      // Rough ETA from instantaneous cumulative rate since progress events started
      // is unknown here — show remaining MB instead.
      const remainMb = ((total - loaded) / (1024 * 1024)).toFixed(0);
      etaHint = ` · ~${remainMb} MB left`;
    }
    const transport =
      String(detail.transport || '') === 'r2-multipart' ? ' (parallel chunks)' : '';
    uploadStatus.set(
      `🎬 Uploading ${fileName} — ${percent}%${etaHint}${transport} (keep tab open)`
    );
  }
}

const newTitle = writable('');
const newCategory = writable('Auto-Detect');
const selectedFile = writable(null);
const videoSource = writable('');
const isAutoDetecting = writable(false);
const detectedCategory = writable('');
const personalThumbnailCollection = writable([]);
function setPersonalThumbnailCollection(value, functionName) {
  const prev = get(personalThumbnailCollection) || [];
  personalThumbnailCollection.set(value);
  traceThumbStoreWrite(functionName, 'personalThumbnailCollection', prev, value);
}
const personalVideos = writable([]);
const viewerHydrationReady = writable(false);
const usePersonalThumbnails = writable(false);
const personalStudioMode = writable(false);
const personalThumbnailIndex = writable(0);
const personalVideoCollection = writable([
'20260205_090759907.MOV',
'20260205_091335137.MOV',
'20260205_091335137(1).MOV',
'20260205_091348538.MOV',
'20260205_091348538(1).MOV',
'IMG_1614.MOV',
'MICROS_STIRRED_V3(4).MOV'
]);
const heroVideoLoaded = writable(false);
const heroVideoFailed = writable(false);
const heroRestoring = writable(false);
const heroResumeToast = writable('');
let heroVideoElement;
let detachHeroPersistence = null;
const deleteConfirmReel = writable(null);
const isDeleting = writable(false);
const pendingVideo = writable(null);
const pendingThumbnail = writable(null);
const isReplacingHero = writable(false);
const ghostHoverActive = writable(false);
const thumbnailDragActive = writable(false);
const videoDragActive = writable(false);
const dragActive = writable(false);
const studioHierarchyEnabled = writable(false);
const studioHierarchyLoading = writable(false);
const studioHierarchyError = writable('');
const studioProjectTree = writable(null);
const studioCatalogProjectId = writable('');
const studioFormSeriesTitle = writable('');
const studioFormSeasonNumber = writable(1);
const studioFormEpisodeTitle = writable('');
const studioFormEpisodeNumber = writable(1);
const studioSelectedSeriesId = writable('');
const studioSelectedSeasonId = writable('');
const studioAttachEpisodeId = writable('');
const studioAttachReelId = writable('');
const studioSeriesMetadataReelId = writable('');
const watchContinueEnabled = writable(false);
const watchContinueItems = writable([]);
const watchContinueLoading = writable(false);
const feedCardVideoFallbacks = writable(new Set());
const feedCardImageFallbacks = writable(/** @type {Record<string, string>} */ ({}));
const aiMaintenanceMode = writable(true);
const isCleaning = writable(false);
const lastAiCleanup = writable(null);
const storageHealth = writable({ score: 100, issues: [] });
const HERO_BACKGROUND_VIDEO = writable(CONFIG.HERO_VIDEO_PATHS[0]);
const HERO_POSTER_IMAGE = writable('');
const heroVideoAttempt = writable(0);
const heroPendingFile = writable(null);
const heroIsDragOver = writable(false);
const heroPreviewUrl = writable(null);
/** @type {import('./lib/hero/heroIntelligence.js').HeroSelection | null} */
const heroSelection = writable(/** @type {import('../lib/hero/heroIntelligence.js').HeroSelection | null} */ (null));
let heroIntelligenceApplied = false;
const categoryRotationIndices = writable({
'Trending': 0,
'Romance': 0,
'Cyber-Action': 0,
'Suspense': 0
});
let adminPasswordInput = '';
let adminLoginError = '';
let adminInputElement;
/** @type {{ experience: import('../components/experiences/StudioExperience.svelte').default | null, walkthrough: import('../components/studio/StudioWalkthrough.svelte').default | null }} */
const studioRefs = { experience: null, walkthrough: null };

function startStudioWalkthrough() {
    studioRefs.walkthrough?.startWalkthrough();
}
function getAllFeedReels() {
/** @type {Record<string, unknown>[]} */
const reels = [];
const fromNormalized = get(normalizedFeed);
for (const cat of Object.keys(fromNormalized)) {
for (const reel of fromNormalized[cat] || []) {
if (reel?.id && !reel.isPresentationOnly && !reel.layoutOnly) reels.push(reel);
}
}
return reels;
}

function patchFeedWithEpisodeBindings() {
feed.update((currentFeed) => {
const next = { ...currentFeed };
let changed = false;
for (const cat of Object.keys(next)) {
next[cat] = (next[cat] || []).map((reel) => {
if (!reel?.id) return reel;
const ctx = resolveSeriesContextForReel(reel);
if (!ctx) return reel;
changed = true;
return applyEpisodeFieldsToReel(reel, ctx);
});
}
return changed ? next : currentFeed;
});
}

function runEpisodeBridgeSync(source = 'init') {
/** Merge feed shelves + personal vault so inference sees vault-only UUIDs. */
const byId = new Map();
for (const reel of getAllFeedReels()) {
if (reel?.id) byId.set(String(reel.id), reel);
}
const vault = get(personalVideos);
if (Array.isArray(vault)) {
for (const video of vault) {
if (video?.id) byId.set(String(video.id), video);
}
}
const combined = [...byId.values()];
const report = bridgeFeedReelsToCatalog(combined);
patchFeedWithEpisodeBindings();
const assetCoverage = auditEpisodeAssets(combined, true);
if (import.meta.env.DEV) {
const coverage = auditEpisodeBridgeCoverage(combined);
console.log(`[EPISODE_BRIDGE] ${JSON.stringify({ source, ...report, ...coverage })}`);
}
return { ...report, assetCoverage };
}

function handleEpisodeAssetChanged() {
patchFeedWithEpisodeBindings();
runEpisodeBridgeSync('studio-attach');
}

/** @param {Event} event */
function handleWorkflowNavigate(event) {
const detail = /** @type {CustomEvent} */ (event).detail || {};
const { target, episodeId, reelId } = detail;
const resolvedReelId =
    reelId ||
    (episodeId ? getEpisodeById(episodeId)?.episode?.reelId : null) ||
    '';
if (resolvedReelId && (target === 'metadata-editor' || target === 'release-scheduler')) {
studioSeriesMetadataReelId.set(resolvedReelId);
}
if (target === 'reel-attach' && episodeId) {
studioAttachEpisodeId.set(episodeId);
}
}

function findReelInFeed(reelId) {
if (!reelId) return null;
const fromNormalized = get(normalizedFeed);
for (const cat of Object.keys(fromNormalized)) {
const found = fromNormalized[cat]?.find((r) => r?.id === reelId);
if (found) return found;
}
const fromFeed = get(feed);
for (const cat of Object.keys(fromFeed)) {
const found = fromFeed[cat]?.find((r) => r?.id === reelId);
if (found) return normalizeReel(found, 'theater-open');
}
return null;
}

/** Feed shelf card click → theater (wired as onOpenTheater from ReelshortExperience). @param {Record<string, unknown>} reel */
function handleCardClick(reel) {
logMobilePlayTrace('VIEWER_HANDLE_CARD_CLICK', {
assetId: String(reel?.id || '').trim(),
title: String(reel?.title || reel?.name || '').trim(),
mediaUrl: String(reel?.url || reel?.playbackUrl || reel?.mediaUrl || reel?.videoUrl || '').trim(),
resolver: 'viewerContext.handleCardClick',
source: 'viewer-handleCardClick',
playCalled: false
});
logTheaterOpen(reel, {
source: 'viewer-handleCardClick',
isPlaceholder: Boolean(reel?.isPlaceholder),
hasPlayableVideo: hasPlayableVideo(reel),
activeReelIdBefore: get(activeReel)?.id ?? null,
loading: get(loading),
controlCenterOpen: get(controlCenterOpen)
});
openTheater(reel);
}

/** Primary theater open entry from Viewer. @param {Record<string, unknown>} reel */
function openTheater(reel) {
if (!reel) {
logTheaterOpen(null, { source: 'viewer-openTheater', aborted: true, reason: 'no-reel' });
logMobilePlayTrace('VIEWER_OPEN_THEATER_ABORTED', {
resolver: 'viewerContext.openTheater',
reason: 'no-reel',
playCalled: false
});
return;
}
logMobilePlayTrace('VIEWER_OPEN_THEATER', {
assetId: String(reel?.id || '').trim(),
title: String(reel?.title || reel?.name || '').trim(),
mediaUrl: String(reel?.url || reel?.playbackUrl || reel?.mediaUrl || reel?.videoUrl || '').trim(),
resolver: 'viewerContext.openTheater → openTheaterReel',
source: 'viewer-openTheater',
playCalled: false
});
openTheaterReel(reel);
logTheaterState({
source: 'viewer-openTheater-complete',
activeReelId: get(activeReel)?.id ?? null,
visible: Boolean(get(activeReel)),
resolvedFromFeed: Boolean(findReelInFeed(reel?.id))
});
logMobilePlayTrace('VIEWER_OPEN_THEATER_COMPLETE', {
assetId: String(get(activeReel)?.id || reel?.id || '').trim(),
title: String(get(activeReel)?.title || reel?.title || '').trim(),
mediaUrl: String(
get(activeReel)?.url ||
get(activeReel)?.playbackUrl ||
reel?.url ||
reel?.playbackUrl ||
''
).trim(),
resolver: 'viewerContext.openTheater.complete',
source: 'viewer-openTheater-complete',
viewerOpen: Boolean(get(activeReel))
});
}

/**
 * VIEWER-1 / Phase 3: open a title queued from Account (Continue Watching / My List).
 * @param {{ reelId?: string; title?: string | null; thumbnailUrl?: string | null; positionSeconds?: number | null; durationSeconds?: number | null; completed?: boolean; resume?: boolean } | null | undefined} [req]
 */
function tryConsumeAccountPlay(req) {
  import('../lib/viewer/pendingPlay.js').then(({ takeAccountPlay, resolveAccountPlayReel }) => {
    const play = req && req.reelId ? req : takeAccountPlay();
    if (!play?.reelId) return;

    const fromFeed = findReelInFeed(play.reelId);
    const fromVault = get(personalVideos).find((v) => String(v?.id || '') === String(play.reelId));
    const reel =
      fromFeed ||
      (fromVault ? normalizeReel(fromVault, 'account-play') : null) ||
      resolveAccountPlayReel(play, findReelInFeed);

    if (!reel) return;

    // Guard: without a playback URL, theater can only open catalog-known titles.
    const playableUrl = reel.url || reel.videoUrl || reel.src || reel.playbackUrl;
    if (!playableUrl && !fromFeed && !fromVault) {
      if (import.meta.env.DEV) {
        console.warn('[account-play] reel not in catalog', play.reelId);
      }
      uploadStatus.set('That title isn’t available to play right now.');
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 3500);
      return;
    }

    // Resume is already seeded by queueAccountPlay when requested.
    openTheater(reel);
  }).catch(() => {
    /* ignore */
  });
}

let savedScrollY = 0;
let bodyScrollLocked = false;

function lockBodyScroll() {
if (typeof document === 'undefined' || bodyScrollLocked) return;
savedScrollY = window.scrollY;
document.body.style.overflow = 'hidden';
document.body.style.position = 'fixed';
document.body.style.top = `-${savedScrollY}px`;
document.body.style.width = '100%';
bodyScrollLocked = true;
}

function unlockBodyScroll() {
if (typeof document === 'undefined' || !bodyScrollLocked) return;
document.body.style.overflow = '';
document.body.style.position = '';
document.body.style.top = '';
document.body.style.width = '';
window.scrollTo(0, savedScrollY);
bodyScrollLocked = false;
}

// ==========================================
// Persistent Category Names Store
// ==========================================
function createPersistentCategoryStore() {
const store = createPersistentStore(CONFIG.CATEGORY_NAMES_KEY, {});
return {
subscribe: store.subscribe,
set: store.set,
update: store.update,
saveName: (originalName, customName) => {
const key = String(originalName || '').trim();
if (!key) return;
const next = String(customName || '').trim();
store.update((current) => {
const out = { ...(current || {}) };
if (!next || next === key) {
delete out[key];
return out;
}
out[key] = next;
return out;
});
},
getName: (originalName) => {
let result = originalName;
store.subscribe((current) => {
result = current[originalName] || originalName;
})();
return result;
},
reset: () => store.set({})
};
}
const categoryNames = createPersistentCategoryStore();
categoryNames.subscribe((current) => syncCategoryAliasStore(current));
// ==========================================
// Persistent Title Store
// ==========================================
function createPersistentTitleStore() {
const store = createPersistentStore(CONFIG.TITLES_STORAGE_KEY, {});
return {
subscribe: store.subscribe,
set: store.set,
update: store.update,
saveTitle: (reelId, titleData) => {
if (!reelId || !titleData?.title) return;
// Phase 22: merge-on-write — title-only edits must not wipe description/tags/category.
store.update((current) => mergeTitleIntoPersistentMap(current, reelId, {
title: titleData.title,
title_original: titleData.title_original ?? titleData.title,
savedAt: new Date().toISOString()
}));
},
getTitle: (reelId) => {
let result = null;
store.subscribe((current) => {
result = current[reelId] || null;
})();
return result;
}
};
}
const persistentTitles = createPersistentTitleStore();
// ==========================================
// Derived Stores
// ==========================================
function applyCanonicalFeed(next) {
const reconciled = reconcileFeedToCanonicalShelves(next);
feed.set(reconciled);
categories.set(Object.keys(reconciled));
return reconciled;
}
const CANONICAL_LIVE_SHELVES = ['Trending', 'Romance', 'Cyber-Action', 'Suspense'];
const categoryCounts = derived(feed, ($feed) => {
const counts = {};
CANONICAL_LIVE_SHELVES.forEach((cat) => {
const rows = Array.isArray($feed?.[cat]) ? $feed[cat] : [];
counts[cat] = rows.filter((r) => r && !r.isPlaceholder).length;
});
return counts;
});
const normalizedFeed = derived(feed, ($feed) => {
const normalized = {};
Object.keys($feed).forEach((cat) => {
if ($feed[cat]) {
normalized[cat] = $feed[cat].map((reel) => normalizeReel(reel, 'feed'));
}
});
return normalized;
});
if (typeof window !== 'undefined') {
normalizedFeed.subscribe((value) => {
logBg7nStage('normalizedFeed', value);
logBg7pShelfDistribution('normalizedFeed', value);
});
}
const totalReelsCount = derived(
feed,
($feed) => Object.values($feed).flat().filter((r) => !r.isPlaceholder).length
);
const hasPersonalContent = derived(
[personalThumbnailCollection, personalVideoCollection],
([$thumbs, $videos]) => $thumbs.length > 0 || $videos.length > 0
);
// ==========================================
// Resource Manager
// ==========================================
class ResourceManager {
constructor() {
this.blobUrls = new Set();
this.timeouts = new Set();
this.intervals = new Set();
this.listeners = new Map();
}
addBlobUrl(url) {
if (url?.startsWith('blob:')) this.blobUrls.add(url);
return url;
}
revokeBlobUrl(url) {
if (url && this.blobUrls.has(url)) {
URL.revokeObjectURL(url);
this.blobUrls.delete(url);
}
}
cleanupAllBlobs() {
this.blobUrls.forEach((url) => URL.revokeObjectURL(url));
this.blobUrls.clear();
}
setTimeout(fn, delay) {
const id = setTimeout(fn, delay);
this.timeouts.add(id);
return id;
}
setInterval(fn, delay) {
const id = setInterval(fn, delay);
this.intervals.add(id);
return id;
}
addEventListener(element, event, handler, options = {}) {
element.addEventListener(event, handler, options);
if (!this.listeners.has(element)) this.listeners.set(element, []);
this.listeners.get(element).push({ event, handler, options });
}
removeAllListeners() {
this.listeners.forEach((handlers, element) => {
handlers.forEach(({ event, handler, options }) => {
element.removeEventListener(event, handler, options);
});
});
this.listeners.clear();
}
clearAll() {
this.timeouts.forEach((id) => clearTimeout(id));
this.intervals.forEach((id) => clearInterval(id));
this.cleanupAllBlobs();
this.removeAllListeners();
this.timeouts.clear();
this.intervals.clear();
}
}
const resourceManager = new ResourceManager();
// ==========================================
// Utility Functions
// ==========================================
/** @deprecated Use resolveDisplayUrl directly — kept for HEAD probes and legacy callers. */
const normalizeThumbnailUrl = (url) => {
if (!url) return getFallbackImage();
const resolved = resolveDisplayUrl(url, 'thumbnail', 'normalizeThumbnailUrl');
return resolved || getFallbackImage();
};
/** @deprecated Use resolveDisplayUrl directly — kept for HEAD probes and legacy callers. */
const normalizeVideoUrl = (url) => resolveDisplayUrl(url, 'video', 'normalizeVideoUrl');
function hasPlayableVideo(reel) {
return isVideoReel(reel);
}
function getFallbackImage() {
const svg = encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#3E2723"/><stop offset="100%" style="stop-color:#1A1A1A"/></linearGradient></defs><rect fill="url(#g)" width="400" height="600"/><text fill="#FFD700" x="50%" y="50%" text-anchor="middle" font-family="system-ui" font-size="16" font-weight="bold">BLACK STORIES</text></svg>`
);
return `data:image/svg+xml,${svg}`;
}
function getPersonalVideo(index) {
const collection = get(personalVideoCollection);
if (!collection.length) return null;
return collection[index % collection.length];
}
function getPersonalThumbnail(index) {
const collection = get(personalThumbnailCollection);
if (!collection.length) return getFallbackImage();
return vaultUtils?.resolveThumbnailPath(collection[index % collection.length], index) || getFallbackImage();
}
function getRandomThumb() {
const collection = get(personalThumbnailCollection);
const svg = encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect fill="#1a1a1a" width="400" height="600"/><text fill="#666" x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="24">Loading...</text></svg>`
);
if (!collection.length) return `data:image/svg+xml,${svg}`;
const randomIndex = Math.floor(Math.random() * collection.length);
return getPersonalThumbnail(randomIndex) || `image/svg+xml,${svg}`;
}
function fileToBase64(file) {
return new Promise((resolve, reject) => {
const reader = new FileReader();
reader.onload = () => resolve(reader.result);
reader.onerror = () => reject(new Error('File read failed'));
reader.readAsDataURL(file);
});
}
// Added missing function: getCategoryThumbnail
function getCategoryThumbnail(category, index) {
// Fallback for missing thumbnails
const fallbacks = {
'Trending': NEON_COLORS.red,
'Cyber-Action': NEON_COLORS.cyan,
'Romance': NEON_COLORS.pink,
'Suspense': '#8B4513'
};
const color = fallbacks[category] || NEON_COLORS.gold;
const svg = encodeURIComponent(`
<svg width="400" height="600" viewBox="0 0 400 600" xmlns="http://www.w3.org/2000/svg">
<rect width="400" height="600" fill="${color}20"/>
<circle cx="200" cy="200" r="80" fill="${color}80"/>
<text x="200" y="520" fill="${color}" text-anchor="middle" font-family="system-ui" font-size="20" font-weight="bold">${category.toUpperCase()}</text>
</svg>
`);
return `image/svg+xml,${svg}`;
}
function runClientMediaPurge(match) {
return purgeMediaFromClientState(
{
feed,
personalVideos,
activeReel,
actions: {
closeTheater: () => theaterManager.close(),
persistFeed: (nextFeed) => storageSet(CONFIG.FEED_STORAGE_KEY, nextFeed),
persistVault: persistPersonalVault
}
},
match
);
}
function forceDisplayInStudio() { uploadStatus.set('🔄 SYNCHRONIZING...'); resourceManager.setTimeout(() => { uploadStatus.set('✅ CONTENT VISIBLE'); if (get(adminMode)) feed.update((f) => ({ ...f })); }, 1000); }

let AI_IMAGE_GENERATOR;
let CATEGORY_DETECTOR;
let ProductionAgent;
let BLACK_STORIES_MATCHER;
let PersonalUploadSystem;

function initContentAgents() {
  ({ AI_IMAGE_GENERATOR, CATEGORY_DETECTOR, ProductionAgent, BLACK_STORIES_MATCHER, PersonalUploadSystem } = createContentAgents({
    CONFIG, NEON_COLORS, resourceManager, feed, uploadStatus, personalThumbnailCollection,
    personalVideoCollection, personalThumbnailIndex, usePersonalThumbnails, newTitle, storageSet,
    getFallbackImage, getPersonalVideo, getPersonalThumbnail, getCategoryThumbnail, forceDisplayInStudio,
    syncFromVault, runClientMediaPurge
  }));
}

let vaultUtils;
let AI_CLEANUP_AGENT;
let UIAgent;

function initViewerAgents() {
  vaultUtils = createVaultUtils({ CONFIG, personalThumbnailCollection, getFallbackImage });
  initContentAgents();
  AI_CLEANUP_AGENT = createAiCleanupAgent({
    CONFIG, resourceManager, feed, personalThumbnailCollection, personalVideos,
    personalVideoCollection, uploadStatus, storageHealth, aiMaintenanceMode,
    isCleaning, lastAiCleanup, CATEGORY_DETECTOR, storageSet, runClientMediaPurge, syncFromVault
  });
  UIAgent = createUiAgent({
    NEON_COLORS, CONFIG, ALLOW_UI_PLACEHOLDERS, feed, deleteConfirmReel, isDeleting,
    categoryNames, uploadStatus, personalStudioMode, personalThumbnailCollection,
    usePersonalThumbnails, personalVideoCollection, newTitle, selectedFile, videoSource,
    dragActive, newCategory, feedCardImageFallbacks, ProductionAgent, PersonalUploadSystem,
    BLACK_STORIES_MATCHER, hasPlayableVideo
  });
}

initViewerAgents();
const getImg = (reel, category, i) => {
  const durable = resolveDurableViewerPoster(reel, reel);
  if (durable) return durable;
  if (reel?.isPlaceholder || reel?.isPresentationOnly || reel?.isGhost) {
    return UIAgent.getImg?.(reel, category, i) || getRandomThumb();
  }
  return '';
};
// ==========================================
// 🚀 FIXED DRAG & DROP HANDLERS
// ==========================================

// THUMBNAIL VAULT DROP ZONE
// ==========================================
// Vault → Studio drag-and-drop
// ==========================================
// ==========================================
// ==========================================
// Upload Handler with Faces
// ==========================================
// ==========================================
// Sync Function (fixed to merge personal videos)
// ==========================================
function reloadVaultStoresFromStorage() {
const thumbs = readThumbnailVault(CONFIG.THUMBNAIL_STORAGE_KEY);
console.info('[VAULT_RELOAD]', {
action: 'reloadVaultStoresFromStorage:start',
personal_thumbnails: thumbs.length,
ts: new Date().toISOString()
});
if (thumbs.length > 0) {
syncCollectionStore(personalThumbnailCollection, CONFIG.THUMBNAIL_STORAGE_KEY);
console.info('[VAULT_RELOAD]', {
action: 'reloadVaultStoresFromStorage:hydrate',
personal_thumbnails: thumbs.length,
ts: new Date().toISOString()
});
} else {
setPersonalThumbnailCollection([], 'reloadVaultStoresFromStorage:clear');
console.info('[VAULT_RELOAD]', {
action: 'reloadVaultStoresFromStorage:clear',
personal_thumbnails: 0,
ts: new Date().toISOString()
});
}
const storedVideos = JSON.parse((typeof window !== 'undefined' ? localStorage.getItem(CONFIG.VIDEO_VAULT_KEY) : null) || '[]');
console.info('[HERO_STORE_READ]', {
stage: 'reloadVaultStoresFromStorage:videos',
key: CONFIG.VIDEO_VAULT_KEY,
count: Array.isArray(storedVideos) ? storedVideos.length : 0,
ts: new Date().toISOString()
});
if (storedVideos.length > 0) {
const filteredStoredVideos = filterOutDeletedMedia(filterNonHeroAssets(storedVideos));
traceVideoStoreBoundary('reloadVaultStoresFromStorage:filterNonHeroAssets', storedVideos, filteredStoredVideos, {
reasons: 'filterNonHeroAssets+filterOutDeletedMedia'
});
// Rehydrate durable identity + episode package; seal legacy rows that predate seriesIdentity storage
const sealedVideos = sealVaultAssetsWithEnrichment(filteredStoredVideos);
personalVideos.set(sealedVideos.map((video) => {
const durableStill = pickDurableVaultStillUrl(video);
const resolvedStill = resolveUserPosterUrl(durableStill) || durableStill;
const playbackRaw = [video.url, video.videoUrl, video.video_url, video.mediaUrl]
  .map((value) => String(value || '').trim())
  .find((value) => {
    if (!value) return false;
    if (value.startsWith('blob:') || value.startsWith('data:')) return true;
    return /\/videos\//i.test(value) || /\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i.test(value);
  }) || '';
const next = {
...video,
url: playbackRaw ? toRelativeMediaPath(playbackRaw) : '',
...(resolvedStill
  ? { thumbnail: resolvedStill, thumbnailUrl: resolvedStill, posterUrl: resolvedStill }
  : {})
};
if (import.meta.env.DEV) {
  console.info('[LOCAL_VAULT_FACE_TRACE]', {
    stage: 'reloadVaultStoresFromStorage',
    assetId: String(video?.id || video?.assetId || ''),
    url: String(next.url || ''),
    thumbnail: String(next.thumbnail || ''),
    thumbnailUrl: String(next.thumbnailUrl || ''),
    posterUrl: String(next.posterUrl || ''),
    previewUrl: String(next.previewUrl || ''),
    localPreviewUrl: String(next.localPreviewUrl || ''),
    resolvedFace: resolvedStill
      ? { src: resolvedStill, render: 'image' }
      : { src: '', render: 'empty' },
    renderMode: resolvedStill ? 'image' : 'empty',
    ts: new Date().toISOString()
  });
}
return next;
}));
console.info('[STORE_UPDATE]', {
store: 'personalVideos',
count: sealedVideos.length,
ts: new Date().toISOString()
});
}
}
function mergeVideoVaultEntries(existingEntries = [], incomingEntries = [], options = {}) {
const { backendReachable = false } = options;
const incoming = Array.isArray(incomingEntries) ? incomingEntries : [];
/** VIDEO-SYNC-01: tombstoned canonical ids must never re-enter vault via catalog projection. */
const rejectTombstonedVaultEntries = (entries, mergeMode) => {
  const rejectedIds = [];
  const kept = (Array.isArray(entries) ? entries : []).filter((entry) => {
    if (!entry || typeof entry !== 'object') return true;
    const id = String(entry.id || '').trim();
    const personalId = String(entry.personal_video_id || '').trim();
    if (id && isDeletedMediaId(id)) {
      rejectedIds.push(id);
      return false;
    }
    if (personalId && isDeletedMediaId(personalId)) {
      rejectedIds.push(personalId);
      return false;
    }
    return true;
  });
  if (rejectedIds.length) {
    console.info('[VIDEO-SYNC-01] mergeVideoVaultEntries:tombstone-reject', {
      mergeMode,
      backendReachable,
      rejectedIds: [...new Set(rejectedIds)],
      incomingCount: entries.length,
      keptCount: kept.length,
      ts: new Date().toISOString()
    });
  }
  return kept;
};
/**
 * Prefer in-memory vault rows (optimistic / pending_accept still have blob urls)
 * over stale localStorage snapshots that strip blobs.
 */
function coalesceExistingVaultEntries(existing) {
  const fromArg = Array.isArray(existing) ? existing : [];
  let fromMemory = [];
  try {
    fromMemory = Array.isArray(get(personalVideos)) ? get(personalVideos) : [];
  } catch {
    fromMemory = [];
  }
  const seen = new Set();
  const out = [];
  for (const entry of [...fromMemory, ...fromArg]) {
    if (!entry || typeof entry !== 'object') continue;
    const id = String(entry.id || '').trim();
    const rawUrl = String(entry.url || '').trim();
    const key =
      id ||
      (rawUrl && !rawUrl.startsWith('blob:') ? toRelativeMediaPath(rawUrl) : '') ||
      String(entry.fileName || entry.name || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}
if (backendReachable) {
  // Online: backend catalog is source of truth for finalized videos, but in-flight /
  // interrupted local vault rows must survive hard refresh (PUT dies with the tab).
  const incomingClean = rejectTombstonedVaultEntries(incoming, 'backend-projection');
  const existing = coalesceExistingVaultEntries(existingEntries);
  const pendingLocal = rejectTombstonedVaultEntries(
    existing
      .filter((entry) => isPendingLocalVideoVaultEntry(entry))
      .map((entry) => {
        const state = String(entry?.uploadState || '');
        if (state === 'pending_accept') return entry;
        if (state === 'uploading') {
          const url = String(entry?.url || '').trim();
          const preview = String(
            entry?.previewUrl || entry?.localPreviewUrl || entry?.thumbnailUrl || ''
          ).trim();
          // Same-session blob preview still valid — keep uploading.
          if (url.startsWith('blob:') || preview.startsWith('blob:') || preview.startsWith('data:')) {
            return entry;
          }
          // After hard refresh blob was stripped from storage — mark interrupted.
          return {
            ...entry,
            uploadState: 'interrupted',
            uploadError: 'refresh_interrupted',
            url: '',
            isOptimisticLocal: true
          };
        }
        if (state === 'interrupted' || state === 'failed') {
          return entry;
        }
        if (entry?.isOptimisticLocal) {
          const url = String(entry?.url || '').trim();
          const preview = String(
            entry?.previewUrl || entry?.localPreviewUrl || entry?.thumbnailUrl || ''
          ).trim();
          if (
            state === 'uploading' &&
            (url.startsWith('blob:') || preview.startsWith('blob:') || preview.startsWith('data:'))
          ) {
            return entry;
          }
          return {
            ...entry,
            uploadState: state === 'uploading' ? 'interrupted' : state || 'interrupted',
            uploadError: entry.uploadError || 'refresh_interrupted',
            url: url.startsWith('blob:') ? '' : url,
            isOptimisticLocal: true
          };
        }
        return entry;
      }),
    'backend-projection-pending-local'
  );
  // Catalog projection first, but keep local creator identity + package by mediaAssetId.
  const localAuthorityById = indexVaultAssetsByMediaId(existing);
  const seen = new Set();
  const merged = [];
  for (const entry of incomingClean) {
    if (!entry || typeof entry !== 'object') continue;
    const rawUrl = String(entry.url || '').trim();
    const canonicalUrl =
      rawUrl && !rawUrl.startsWith('blob:') && !rawUrl.startsWith('data:')
        ? toRelativeMediaPath(rawUrl)
        : '';
    const key =
      canonicalUrl ||
      String(entry.fileName || entry.name || entry.id || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const id = String(entry.id || entry.mediaAssetId || '').trim();
    const local = id ? localAuthorityById.get(id) : null;
    merged.push(
      /** @type {Record<string, unknown>} */ (
        overlayLocalCreatorVaultAuthority(entry, local) || entry
      )
    );
  }
  for (const entry of pendingLocal) {
    if (!entry || typeof entry !== 'object') continue;
    const rawUrl = String(entry.url || '').trim();
    const canonicalUrl =
      rawUrl && !rawUrl.startsWith('blob:') && !rawUrl.startsWith('data:')
        ? toRelativeMediaPath(rawUrl)
        : '';
    const key =
      canonicalUrl ||
      String(entry.fileName || entry.name || entry.id || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  const localDurable = rejectTombstonedVaultEntries(
    existing.filter((entry) => !isPendingLocalVideoVaultEntry(entry)),
    'backend-projection-local-durable'
  );
  for (const entry of localDurable) {
    if (!entry || typeof entry !== 'object') continue;
    const rawUrl = String(entry.url || '').trim();
    if (!rawUrl || rawUrl.startsWith('blob:') || rawUrl.startsWith('data:')) continue;
    const canonicalUrl = toRelativeMediaPath(rawUrl);
    const key =
      canonicalUrl ||
      String(entry.fileName || entry.name || entry.id || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  console.info('[VIDEO-SYNC-01] mergeVideoVaultEntries:preserve-pending', {
    backendCount: incomingClean.length,
    pendingLocalCount: pendingLocal.length,
    mergedCount: merged.length,
    memoryCount: (() => {
      try {
        return get(personalVideos)?.length ?? 0;
      } catch {
        return 0;
      }
    })(),
    ts: new Date().toISOString()
  });
  return merged;
}
const merged = [];
const seen = new Set();
for (const entry of [...existingEntries, ...incoming]) {
if (!entry || typeof entry !== 'object') continue;
if (isHeroAsset(entry)) {
  const id = String(entry?.id || '').trim();
  console.info('[BG7W_HERO_VAULT_GATE]', { reelId: id, blocked: true, reason: 'hero_identity_match' });
  continue;
}
const pendingId = String(entry?.id || '').trim();
if (pendingId && pendingHeroAssetIds.has(pendingId)) {
  console.info('[BG7W_HERO_VAULT_GATE]', { reelId: pendingId, blocked: true, reason: 'hero_pending' });
  continue;
}
const rawUrl = String(entry.url || '').trim();
const canonicalUrl = rawUrl ? toRelativeMediaPath(rawUrl) : '';
const key = canonicalUrl || String(entry.fileName || entry.name || '').trim();
if (!key || seen.has(key)) continue;
seen.add(key);
merged.push(entry);
}
return rejectTombstonedVaultEntries(merged, 'offline-merge');
}
let syncFromVaultInFlight = null;
let lastSyncFromVaultAt = 0;
const wsCreatedSyncCooldownByReel = new Map();

function reconcileStaleThumbnailsOnStartup(rawData, backendReachable) {
if (!backendReachable || typeof window === 'undefined') {
console.info('[STARTUP_RECONCILE]', {
action: 'skipped',
reason: backendReachable ? 'no_window' : 'backend_unreachable',
ts: new Date().toISOString()
});
return { purged: [], examined: 0 };
}
const imageReels = (rawData || []).filter(isThumbnailImageReel);
const pending = get(pendingThumbnail);
const pendingFileKeys = new Set();
if (pending?.name) pendingFileKeys.add(String(pending.name).trim());
const result = reconcileThumbnailVault(imageReels, {
backendReachable: true,
pendingFileKeys,
storageKey: CONFIG.THUMBNAIL_STORAGE_KEY,
purgeGhostCanonical: true
});
syncCollectionStore(personalThumbnailCollection, CONFIG.THUMBNAIL_STORAGE_KEY);
console.info('[STARTUP_RECONCILE]', {
action: result.purged.length ? 'purge' : 'noop',
examined: result.examined ?? result.entries.length,
purgedCount: result.purged.length,
remaining: result.entries.length,
backendThumbReels: imageReels.length,
ts: new Date().toISOString()
});
return result;
}
async function syncFromVault(preserveLocal = false, force = false) {
if (syncFromVaultInFlight) return syncFromVaultInFlight;
const now = Date.now();
if (!force && now - lastSyncFromVaultAt < 5000) return;
syncFromVaultInFlight = (async () => {
pipelineCheckpoint('SYNC_FROM_VAULT', { phase: 'start', preserveLocal, force });
const announceSync = force;
const debugApi = import.meta.env.VITE_DEBUG_API === 'true';
if (debugApi) console.info('[SYNC_DEBUG] syncFromVault:start', { preserveLocal, now, announceSync });
let rawData = [];
let syncCompletedSuccessfully = false;
try {
// Merge in-memory + localStorage titles so Studio renames survive refresh/resync
// even if the persistentTitles store has not finished hydrating yet.
let localTitles = { ...get(persistentTitles) };
try {
  const fromLs = JSON.parse(localStorage.getItem(CONFIG.TITLES_STORAGE_KEY) || '{}');
  if (fromLs && typeof fromLs === 'object') {
    localTitles = { ...fromLs, ...localTitles };
  }
} catch {
  /* ignore */
}
let backendReachable = false;
if (announceSync) {
setUploadStatusIfIdle('🔄 Syncing with backend...');
}
const healthy = await checkBackendHealth();
if (!healthy) {
if (isStorageFull()) {
uploadStatus.set('Backend offline and storage full. Clear local data or free up space.');
loading.set(false);
return;
}
if (announceSync) {
uploadStatus.set('🔄 Backend reconnecting...');
notifyBackendReconnecting();
}
console.warn('⚠️ Backend health check failed before sync');
if (!hasStorageSpaceFor([])) {
uploadStatus.set('Backend offline and storage full. Clear local data or free up space.');
loading.set(false);
return;
}
rawData = filterOutDeletedMedia(
normalizeReels(JSON.parse(localStorage.getItem(CONFIG.VAULT_KEY) || '[]'), 'localStorage fallback')
);
} else {
const res = await fetchWithRetry(
`${API_BASE_URL}/api/reels?t=${Date.now()}`,
{ headers: getAdminAuthHeaders() },
{ retries: 3, retryDelayMs: 750 }
);
// Any successful catalog response means backend is reachable for reconcile.
if (res.ok) {
backendReachable = true;
const contentType = res.headers.get('content-type') || '';
if (!contentType.includes('application/json')) throw new Error(`Expected JSON but received ${contentType}`);
const normalizedCatalog = normalizeReels(await res.json(), 'GET /api/reels');
reconcileTombstonesAgainstCatalog(normalizedCatalog);
rawData = filterOutDeletedMedia(normalizedCatalog);
traceVideoStoreBoundary('syncFromVault:after_normalizeReels', [], rawData.filter((r) => isVideoReel(r)), {
reasons: 'normalizeReels+reconcileTombstonesAgainstCatalog+filterOutDeletedMedia then isVideoReel subset',
extra: { catalogCount: rawData.length }
});
console.info('[VAULT-DELETE-TRACE] syncFromVault:bootstrap_reload', {
  source: 'GET /api/reels',
  catalogCount: rawData.length,
  ids: rawData.map((r) => String(r?.id || '')).filter(Boolean).slice(0, 20),
  ts: new Date().toISOString()
});
logBg7kCatalogReceive(
rawData.length,
rawData.map((r) => String(r?.id || '')).filter(Boolean),
'syncFromVault:GET /api/reels'
);
logVaultFieldAuditList('GET /api/reels response (syncFromVault)', rawData);
if (announceSync) {
setUploadStatusIfIdle('✅ Synced with backend');
}
} else {
backendReachable = false;
console.warn(`⚠️ Backend returned ${res.status}, preserving local vault (offline reconcile skipped)`);
if (announceSync) {
uploadStatus.set(`⚠️ Sync failed (${res.status}) — showing saved content`);
}
rawData = filterOutDeletedMedia(
normalizeReels(JSON.parse(localStorage.getItem(CONFIG.VAULT_KEY) || '[]'), 'localStorage fallback')
);
}
}
// Build feed from backend / vault (eligibility delegated to buildHomeFeed)
const thumbsBeforeSync = readThumbnailVault(CONFIG.THUMBNAIL_STORAGE_KEY);
console.info('[VAULT_SYNC]', {
action: 'syncFromVault:pre-upgrade',
backendReels: rawData.length,
personal_thumbnails: thumbsBeforeSync.length,
ts: new Date().toISOString()
});
upgradeThumbnailVaultFromBackendReels(rawData, CONFIG.THUMBNAIL_STORAGE_KEY);
reloadVaultStoresFromStorage();
const thumbsAfterSync = readThumbnailVault(CONFIG.THUMBNAIL_STORAGE_KEY);
console.info('[VAULT_SYNC]', {
action: 'syncFromVault:post-reload',
personal_thumbnails: thumbsAfterSync.length,
collectionStore: get(personalThumbnailCollection).length,
ts: new Date().toISOString()
});
if (backendReachable) {
reconcileStaleThumbnailsOnStartup(rawData, true);
}
traceCatalogFeedDecisions(rawData, backendReachable ? 'syncFromVault:backend' : 'syncFromVault:localStorage');
const { feed: catalogFeed, cardCount: catalogCardCount } = buildHomeFeed(rawData, {
preserveLocal,
localTitles,
thumbnailStorageKey: CONFIG.THUMBNAIL_STORAGE_KEY
});
console.info('[BUILD_HOME_FEED]', {
catalogCount: rawData.length,
cardCount: catalogCardCount,
source: backendReachable ? 'syncFromVault:backend' : 'syncFromVault:localStorage',
ts: new Date().toISOString()
});
logViewerMediaIdentityDiagnostics(rawData, 'syncFromVault:catalog');
logViewerMediaIdentityDiagnostics(
  Object.values(catalogFeed).flat().filter(Boolean),
  'syncFromVault:buildHomeFeed'
);
const backendVideoUrls = new Set(
rawData
.filter((r) => isVideoReel(r))
.map((r) => videoInventoryKey(String(r.url || r.video_url || '')))
.filter((url) => url.startsWith('/videos/'))
);
const { feed: prunedFeed, removed: pruneRemoved } = pruneFeedAgainstBackendVideos(catalogFeed, backendVideoUrls);
const tombstoneSafeFeed = filterDeletedFromFeedMap(prunedFeed);
if (!backendReachable) {
const personalVideosList = filterOutDeletedMedia(get(personalVideos));
personalVideosList.forEach((video) => {
let exists = false;
Object.values(tombstoneSafeFeed).forEach((catArray) => {
if (catArray.some((reel) => reel.isPersonalVideo && reel.personal_video_id === video.id)) {
exists = true;
}
});
if (!exists) {
if (isHeroAsset(video)) return;
AI_CLEANUP_AGENT.distributeVideoToFeed(video);
}
});
}
const publishedFeed = applyCanonicalFeed(tombstoneSafeFeed);
logBg7nStage('feed.set:prunedFeed', publishedFeed);
logBg7pShelfDistribution('feed.set:prunedFeed', publishedFeed);
const feedWrite = storageSet(CONFIG.FEED_STORAGE_KEY, publishedFeed);
if (!feedWrite.ok) {
uploadStatus.set('Storage full, clear data to continue');
loading.set(false);
return;
}
diagnoseStalePlaceholders(prunedFeed);
if (backendReachable && rawData.length === 0) {
console.log('📭 Backend has no reels — hydrating from vault/thumbnails');
console.info('[SYNC_RECONCILE_EMPTY_BACKEND]', {
stage: 'authoritative-empty-catalog',
preserveLocal,
thumbCountBefore: get(personalThumbnailCollection).length,
videoCountBefore: get(personalVideos).length,
ts: new Date().toISOString()
});
// Empty catalog is not a vault delete — keep personal_thumbnails / membership.
// Do not hard-wipe in-flight / interrupted MP4 vault rows — empty catalog ≠ abandon upload stubs.
const existingVaultVideos = JSON.parse(
  (typeof window !== 'undefined' ? localStorage.getItem(CONFIG.VIDEO_VAULT_KEY) : null) || '[]'
);
const pendingOnly = mergeVideoVaultEntries(
  Array.isArray(existingVaultVideos) ? existingVaultVideos : [],
  [],
  { backendReachable: true }
);
personalVideos.set(filterNonHeroAssets(pendingOnly));
persistPersonalVault(pendingOnly);
console.info('[SYNC_RECONCILE_EMPTY_BACKEND]', {
stage: 'preserve-pending-video-vault',
pendingCount: pendingOnly.length,
ts: new Date().toISOString()
});
const { feed: demoFeed, placeholdersInjected: emptyCatalogPlaceholders } = applyPlaceholderFallbackIfEmpty(
emptyFeedMap(),
ALLOW_UI_PLACEHOLDERS
);
const publishedEmpty = applyCanonicalFeed(demoFeed);
logBg7nStage('feed.set:emptyBackend', publishedEmpty);
contentEmpty.set(!ALLOW_UI_PLACEHOLDERS || pendingOnly.length > 0);
storageSet(CONFIG.FEED_STORAGE_KEY, publishedEmpty);
console.info('[SYNC_RECONCILE_EMPTY_BACKEND]', {
stage: 'authoritative-empty-catalog:demo-feed',
demoCount: demoFeed.Trending.length,
allowUiPlaceholders: ALLOW_UI_PLACEHOLDERS,
catalogCardCount,
placeholdersInjected: emptyCatalogPlaceholders,
ts: new Date().toISOString()
});
} else if (backendReachable && rawData.length > 0) {
const videoReelCount = rawData.filter((r) => isVideoReel(r)).length;
const playableCatalog = rawData.filter((r) => isVideoReel(r));
traceVideoStoreBoundary('syncFromVault:playable_catalog', rawData, playableCatalog, {
reasons: 'isVideoReel',
extra: { catalogCount: rawData.length, videoReelCount }
});
console.log(
`[syncFromVault] Loaded ${rawData.length} reels from [backend] (${videoReelCount} playable video, thumbs → placeholders)`
);
contentEmpty.set(videoReelCount > 0 || get(personalThumbnailCollection).length > 0);
const backendVaultVideosRaw = reelsToVideoVaultEntries(rawData);
traceVideoStoreBoundary('syncFromVault:after_reelsToVideoVaultEntries', playableCatalog, backendVaultVideosRaw, {
reasons: 'reelsToVideoVaultEntries'
});
const backendVaultVideos = backendVaultVideosRaw.filter((entry) => {
const id = String(entry?.id || '').trim();
const blocked = Boolean(id) && pendingHeroAssetIds.has(id);
if (blocked) {
console.info('[BG7W_HERO_VAULT_GATE]', { reelId: id, blocked: true, reason: 'hero_pending' });
}
return !blocked;
});
/** @type {Array<{ id: string; reason: string }>} */
const pendingBackendRemoved = backendVaultVideosRaw
.filter((entry) => {
  const id = String(entry?.id || '').trim();
  return Boolean(id) && pendingHeroAssetIds.has(id);
})
.map((entry) => ({ id: String(entry?.id || ''), reason: 'hero_pending' }));
traceVideoStoreBoundary('syncFromVault:backendVaultVideos_pending_filter', backendVaultVideosRaw, backendVaultVideos, {
removed: pendingBackendRemoved,
reasons: 'pendingHeroAssetIds'
});
const existingVaultVideos = JSON.parse((typeof window !== 'undefined' ? localStorage.getItem(CONFIG.VIDEO_VAULT_KEY) : null) || '[]');
const mergedVaultVideosRaw = mergeVideoVaultEntries(existingVaultVideos, backendVaultVideos, {
backendReachable: true
});
traceVideoStoreBoundary('syncFromVault:mergeVideoVaultEntries', [...existingVaultVideos, ...backendVaultVideos], mergedVaultVideosRaw, {
reasons: 'mergeVideoVaultEntries:backend-projection',
extra: { existingCount: existingVaultVideos.length, incomingCount: backendVaultVideos.length }
});
const mergedVaultVideos = mergedVaultVideosRaw.filter((entry) => {
const id = String(entry?.id || '').trim();
const blocked = Boolean(id) && pendingHeroAssetIds.has(id);
if (blocked) {
console.info('[BG7W_HERO_VAULT_GATE]', { reelId: id, blocked: true, reason: 'hero_pending' });
}
return !blocked;
});
/** @type {Array<{ id: string; reason: string }>} */
const pendingMergedRemoved = mergedVaultVideosRaw
.filter((entry) => {
  const id = String(entry?.id || '').trim();
  return Boolean(id) && pendingHeroAssetIds.has(id);
})
.map((entry) => ({ id: String(entry?.id || ''), reason: 'hero_pending' }));
traceVideoStoreBoundary('syncFromVault:mergedVaultVideos_pending_filter', mergedVaultVideosRaw, mergedVaultVideos, {
removed: pendingMergedRemoved,
reasons: 'pendingHeroAssetIds'
});
const heroConfigSnapshot = loadHeroManagerConfig();
const heroAssetIdSnapshot = String(heroConfigSnapshot?.heroAssetId || '').trim();
for (const item of mergedVaultVideos) {
const id = String(item?.id || '').trim();
const url = String(item?.url || '').trim();
const mime = String(item?.type || '').toLowerCase();
const appearsVideo =
mime.startsWith('video/') ||
url.toLowerCase().includes('/videos/') ||
/\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i.test(url);
console.info('[VIDEO_VAULT_INSERT]', {
source: 'syncFromVault',
id,
url,
mime,
classification: appearsVideo ? 'video' : 'non-video',
matchesHeroAssetId: Boolean(heroAssetIdSnapshot) && heroAssetIdSnapshot === id,
heroAssetId: heroAssetIdSnapshot,
ts: new Date().toISOString()
});
}
const nonHeroMergedVaultVideos = filterNonHeroAssets(mergedVaultVideos);
/** @type {Array<{ id: string; reason: string }>} */
const heroFilteredRemoved = mergedVaultVideos
.filter((entry) => isHeroAsset(entry))
.map((entry) => ({ id: String(entry?.id || ''), reason: 'isHeroAsset:filterNonHeroAssets' }));
traceVideoStoreBoundary('syncFromVault:filterNonHeroAssets', mergedVaultVideos, nonHeroMergedVaultVideos, {
removed: heroFilteredRemoved,
reasons: 'filterNonHeroAssets'
});
personalVideos.set(nonHeroMergedVaultVideos);
console.info('[STORE_UPDATE]', {
store: 'personalVideos',
source: 'syncFromVault',
count: nonHeroMergedVaultVideos.length,
ts: new Date().toISOString()
});
console.info('[STORE_WRITE]', {
store: CONFIG.VIDEO_VAULT_KEY,
source: 'syncFromVault',
count: mergedVaultVideos.length,
ts: new Date().toISOString()
});
console.info('[HERO_STORE_WRITE]', {
stage: 'syncFromVault:video-vault-persist',
key: CONFIG.VIDEO_VAULT_KEY,
count: mergedVaultVideos.length,
heroAssetId: heroAssetIdSnapshot,
ts: new Date().toISOString()
});
persistPersonalVault(mergedVaultVideos);
// Master Edit defense: catalog harvest cannot revive names that lose to reel_titles_persistent.
try {
  AI_CLEANUP_AGENT.applyPersistedTitlesOverlay();
} catch {
  /* ignore */
}
console.log(
`[syncFromVault] Video vault merged (local + backend): ${existingVaultVideos.length} + ${backendVaultVideos.length} => ${nonHeroMergedVaultVideos.length}`
);
if (!AI_CLEANUP_AGENT.syncThumbnailsToFeed()) return;
AI_CLEANUP_AGENT.syncVideoVaultToFeed();
diagnoseStalePlaceholders(get(feed));
} else if (!backendReachable) {
console.log('🌐 Backend unreachable, using localStorage data');
uploadStatus.set('⚠️ Backend unreachable — showing saved content');
if (!AI_CLEANUP_AGENT.syncThumbnailsToFeed()) return;
AI_CLEANUP_AGENT.syncVideoVaultToFeed();
}
const flatFeedCount = countRealFeedCards(get(feed));
let demoInjected = false;
if (flatFeedCount === 0) {
const { feed: fallbackFeed, placeholdersInjected } = applyPlaceholderFallbackIfEmpty(
get(feed),
ALLOW_UI_PLACEHOLDERS
);
if (placeholdersInjected) {
const publishedFallback = applyCanonicalFeed(fallbackFeed);
logBg7nStage('feed.set:placeholderFallback', publishedFallback);
storageSet(CONFIG.FEED_STORAGE_KEY, publishedFallback);
demoInjected = true;
console.info('[DEMO_FEED_INJECTED]', {
demoCount: fallbackFeed.Trending.length,
reason: 'empty-feed-after-sync',
source: 'buildHomeFeed:applyPlaceholderFallbackIfEmpty',
ts: new Date().toISOString()
});
}
}
emitBg7lFeedSummary({
backendCatalogCount: rawData.length,
finalFeed: get(feed),
pruneRemoved,
demoInjected,
source: backendReachable ? 'syncFromVault:backend' : 'syncFromVault:offline'
});
logBg7nLocalStorageFeed();
syncCompletedSuccessfully = true;
} catch (err) {
console.error('❌ Sync Error:', err);
if (isStorageFull()) {
uploadStatus.set('Backend offline and storage full. Clear local data or free up space.');
loading.set(false);
return;
}
if (announceSync) {
uploadStatus.set('❌ Sync failed — showing saved content offline');
}
console.log('⚠️ Network failure, falling back to localStorage');
if (!AI_CLEANUP_AGENT.syncThumbnailsToFeed()) return;
AI_CLEANUP_AGENT.syncVideoVaultToFeed();
} finally {
lastSyncFromVaultAt = Date.now();
syncFromVaultInFlight = null;
pipelineCheckpoint('SYNC_FROM_VAULT', {
phase: 'finish',
count: rawData?.length ?? 0,
ids: (rawData || []).slice(0, 20).map((r) => r?.id).filter(Boolean)
});
if (debugApi) console.info('[SYNC_DEBUG] syncFromVault:finish', { at: lastSyncFromVaultAt });
loading.set(false);
resourceManager.setTimeout(() => {
if (isUploadFlowActive()) return;
if (syncCompletedSuccessfully && announceSync) {
uploadStatus.set('Standby');
return;
}
const status = get(uploadStatus);
if (announceSync && (status.startsWith('✅') || status.startsWith('⚠️') || status.startsWith('❌'))) {
uploadStatus.set('Standby');
}
}, 4000);
}
})();
return syncFromVaultInFlight;
}
// ==========================================
// Update Reel Title
// ==========================================
// ==========================================
// Hero Handlers
// ==========================================

function logVaultFieldAuditList(...args) {
  return vaultUtils?.logVaultFieldAuditList(...args);
}

function heroDebugLog(location, message, data = {}, hypothesisId = 'A', runId = 'post-fix') {
  if (import.meta.env.DEV) console.debug('[hero]', location, message, data);
  const ingestBase = import.meta.env.VITE_DEBUG_INGEST_URL || (import.meta.env.DEV ? '/ingest/80f69eaf-aa36-4951-9685-b8b1d86a3356' : '');
  if (!ingestBase) return;
  fetch(ingestBase, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '480721' }, body: JSON.stringify({ sessionId: '480721', runId, hypothesisId, location, message, data, timestamp: Date.now() }) }).catch(() => {});
}

function clearHeroVideoStorage() { try { localStorage.removeItem(CONFIG.HERO_VIDEO_STORAGE_KEY); } catch { /* ignore */ } }
function clearHeroImageStorage() { try { localStorage.removeItem(CONFIG.HERO_IMAGE_STORAGE_KEY); } catch { /* ignore */ } }
function isPersistedImageHero(savedHeroImage) {
  return Boolean(savedHeroImage?.startsWith('data:') || resolveUserPosterUrl(savedHeroImage));
}

async function resolveDefaultHeroVideo() {
  const current = get(HERO_BACKGROUND_VIDEO);
  if (current && (current.startsWith('blob:') || current.startsWith('data:'))) return;
  const pathsToTry = current && !CONFIG.HERO_VIDEO_PATHS.includes(current) ? [current, ...CONFIG.HERO_VIDEO_PATHS] : CONFIG.HERO_VIDEO_PATHS;
  for (const path of pathsToTry) {
    const resolvedUrl = normalizeVideoUrl(path);
    try {
      const res = await fetch(resolvedUrl, { method: 'HEAD' });
      if (res.ok) { HERO_BACKGROUND_VIDEO.set(path); heroVideoFailed.set(false); return; }
    } catch { /* continue */ }
  }
  heroVideoFailed.set(true);
  HERO_BACKGROUND_VIDEO.set('');
}

function getHeroBackgroundStores() {
  return {
    setVideo: (url) => HERO_BACKGROUND_VIDEO.set(url),
    setPoster: (url) => HERO_POSTER_IMAGE.set(url),
    setFailed: (failed) => heroVideoFailed.set(failed)
  };
}

function logHeroHydration(phase, extra = {}) {
  if (!shouldStreamDiagnostics()) return;
  console.info('[HERO_HYDRATION]', {
    phase,
    HERO_BACKGROUND_VIDEO: get(HERO_BACKGROUND_VIDEO),
    hydrationCompleteTimestamp: phase === 'after' ? new Date().toISOString() : undefined,
    ...extra
  });
}

if (typeof window !== 'undefined') {
  logHeroHydration('before');
  const syncHydrateResult = hydrateHeroBackgroundStoresSync(getHeroBackgroundStores(), {
    ...CONFIG,
    resolveVideoUrl: normalizeVideoUrl
  });
  const heroRecord = loadHeroRecord();
  const heroCfg = /** @type {any} */ (
    mergeHeroRecordIntoManagerConfig(loadHeroManagerConfig(), heroRecord)
  );
  logHeroConfigBootTrace({
    site: 'viewerContext:module-init',
    caller: 'viewerContext.js:module-init',
    storageRawBeforeParse: localStorage.getItem('reelforge_hero_manager_config'),
    heroAssetId: heroCfg?.heroAssetId || '',
    backgroundSource: heroCfg?.backgroundSource || '',
    configSource: 'HeroRecord+loadHeroManagerConfig',
    reason: 'post_hydrateHeroBackgroundStoresSync'
  });
  pipelineDiag('HERO_HYDRATE', 'hydrateHeroBackgroundStoresSync', 'viewerContext.js', {
    result: String(syncHydrateResult || ''),
    detail: {
      recordMode: String(heroRecord?.mode || ''),
      assetId: String(heroRecord?.assetId || heroCfg?.heroAssetId || '').trim(),
      source: String(heroCfg?.backgroundSource || '').trim(),
      mediaUrl: String(heroRecord?.mediaUrl || ''),
      storeVideo: String(get(HERO_BACKGROUND_VIDEO) || ''),
      storePoster: String(get(HERO_POSTER_IMAGE) || '')
    }
  });
  logHeroHydration('after', { result: syncHydrateResult, stage: 'module-init' });
}

/**
 * Apply HeroRecord identity to Viewer media stores.
 * @param {import('../lib/hero/heroRecord.js').HeroRecord | null | undefined} [record]
 * @returns {'unchanged' | 'image' | 'video' | 'pending_default'}
 */
function applyHeroRecordBackgroundToViewer(record = null) {
  const active = record || loadHeroRecord();
  return applyHeroRecordBackground(active, getHeroBackgroundStores());
}

/**
 * Live HeroRecord update while Viewer is mounted.
 * @param {CustomEvent} [event]
 */
function handleHeroRecordUpdated(event) {
  const detail = event?.detail;
  const record =
    detail && typeof detail === 'object' && detail.mode
      ? /** @type {import('../lib/hero/heroRecord.js').HeroRecord} */ (detail)
      : loadHeroRecord();

  console.info('[HERO_RECORD_VIEWER]', {
    stage: 'handleHeroRecordUpdated',
    mode: record.mode,
    assetId: record.assetId || '',
    revision: record.revision,
    ts: new Date().toISOString()
  });

  if (record.mode === 'none' || record.mode === 'asset') {
    applyHeroRecordBackgroundToViewer(record);
    return;
  }

  // selection — allow intelligence to resolve background.
  if (!hasUserHeroOverride(CONFIG)) {
    applyHeroBackgroundFromIntelligence();
  }
}

function applyManagerBackgroundFromConfig(config = loadHeroManagerConfig()) {
  // Prefer HeroRecord; manager patch remains for compatibility projection merge.
  const record = loadHeroRecord();
  if (record.mode === 'none' || record.mode === 'asset') {
    return applyHeroRecordBackgroundToViewer(record) !== 'pending_default';
  }
  if (record.mode === 'selection') {
    return false;
  }
  return applyHeroManagerBackground(config, getHeroBackgroundStores());
}

function handleHeroManagerUpdated(event) {
  const config = event?.detail || loadHeroManagerConfig();
  const record = loadHeroRecord();

  // Identity is owned by HeroRecord — never let manager-only patches ressurect stale media.
  if (record.mode === 'none' || record.mode === 'asset') {
    applyHeroRecordBackgroundToViewer(record);
  } else if (record.mode === 'selection') {
    if (hasDurableHeroOverride(CONFIG)) {
      applyHeroManagerBackground(loadHeroManagerConfig(), getHeroBackgroundStores(), { log: false });
    } else {
      applyHeroBackgroundFromIntelligence();
    }
  } else if (config.backgroundSource === 'none') {
    applyManagerBackgroundFromConfig(config);
  } else if (config.backgroundSource === 'custom_video' || config.backgroundSource === 'custom_image') {
    applyManagerBackgroundFromConfig(config);
  } else if (!hasUserHeroOverride(CONFIG)) {
    applyHeroBackgroundFromIntelligence();
  }

  const feedSnapshot = get(feed);
  heroSelection.set(
    selectHeroContent(config.heroType, feedSnapshot, {
      fallbackTitle: null,
      fallbackSubtitle: null
    })
  );
  if (config.autoRotate) {
    startHeroRotation(feedSnapshot, (selection) => {
      heroSelection.set(selection);
      const activeRecord = loadHeroRecord();
      if (activeRecord.mode === 'asset' || activeRecord.mode === 'none') {
        applyHeroRecordBackgroundToViewer(activeRecord);
        return;
      }
      if (hasDurableHeroOverride(CONFIG)) {
        applyHeroManagerBackground(loadHeroManagerConfig(), getHeroBackgroundStores(), { log: false });
        return;
      }
      if (hasUserHeroOverride(CONFIG)) return;
      if (activeRecord.mode === 'selection') {
        applyHeroSelection(selection, getHeroBackgroundStores(), {
          respectUserOverride: true,
          config: CONFIG,
          applyBackground: true,
          clearVideoForPosterOnly: false
        });
      }
    });
  } else {
    stopHeroRotation();
  }
}

function applyHeroBackgroundFromIntelligence() {
  const record = loadHeroRecord();
  const stores = getHeroBackgroundStores();

  if (record.mode === 'none') {
    applyHeroRecordBackgroundToViewer(record);
    return;
  }

  if (record.mode === 'asset') {
    // Never overwrite a chosen vault/asset identity with selection intelligence.
    applyHeroRecordBackgroundToViewer(record);
    return;
  }

  // PHASE-HERO-LOCK-1 — manager custom_* + heroAssetId locks even if record mode is still selection.
  if (hasDurableHeroOverride(CONFIG)) {
    applyHeroManagerBackground(loadHeroManagerConfig(), stores, { log: false });
    return;
  }

  // selection mode (unlocked)
  if (hasUserHeroOverride(CONFIG)) return;

  applyHeroSelection(get(heroSelection), stores, {
    respectUserOverride: true,
    config: CONFIG,
    applyBackground: true,
    clearVideoForPosterOnly: false
  });
}

function applyHeroIntelligence(force = false) {
  if (typeof window === 'undefined') return;
  const record = loadHeroRecord();
  // Asset / blank always re-apply identity; selection may early-return unless forced.
  if (!force && record.mode === 'selection' && hasUserHeroOverride(CONFIG)) return;

  const managerConfig = loadHeroManagerConfig();
  const mode =
    managerConfig.heroType ||
    mapPlatformHeroMode(
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('heroMode') ||
            localStorage.getItem('reelforge_hero_mode')
        : null
    );
  const feedSnapshot = get(feed);
  heroSelection.set(selectHeroContent(mode, feedSnapshot, {
    fallbackTitle: null,
    fallbackSubtitle: null
  }));

  buildHeroCommandBrief(
    get(heroSelection)?.seriesId || null,
    feedSnapshot
  );

  applyHeroBackgroundFromIntelligence();

  startHeroRotation(feedSnapshot, (selection) => {
    heroSelection.set(selection);
    const activeRecord = loadHeroRecord();
    if (activeRecord.mode === 'asset' || activeRecord.mode === 'none') {
      applyHeroRecordBackgroundToViewer(activeRecord);
      return;
    }
    if (hasDurableHeroOverride(CONFIG)) {
      applyHeroManagerBackground(loadHeroManagerConfig(), getHeroBackgroundStores(), { log: false });
      return;
    }
    if (hasUserHeroOverride(CONFIG)) return;
    applyHeroSelection(selection, getHeroBackgroundStores(), {
      respectUserOverride: true,
      config: CONFIG,
      applyBackground: true,
      clearVideoForPosterOnly: false
    });
  });
  heroIntelligenceApplied = true;
}

function handleGhostHoverEnter() { ghostHoverActive.set(true); }
function handleGhostHoverLeave() { ghostHoverActive.set(false); }

function toggleControlCenter() {
  if (!canAccessStudio()) {
    adminMode.set(false);
    controlCenterOpen.set(false);
    return;
  }
  const opening = !get(controlCenterOpen);
  adminMode.set(true);
  controlCenterOpen.set(opening);
  if (opening) {
    recordStudioUsage({ source: 'control-center' });
    studioRefs.experience?.loadStudioHierarchy();
    studioRefs.experience?.loadWatchContinue();
  } else {
    unlockBodyScroll();
  }
}

/** AUTH-UI-2: open production chrome from account menu only when authorized. */
function openStudioFromAccountMenu(source = 'account_menu') {
  if (!canAccessStudio()) {
    adminMode.set(false);
    controlCenterOpen.set(false);
    return;
  }
  adminMode.set(true);
  controlCenterOpen.set(true);
  recordStudioUsage({ source: String(source || 'account_menu') });
  studioRefs.experience?.loadStudioHierarchy();
  studioRefs.experience?.loadWatchContinue();
}
function logout() {
  adminMode.set(false);
  controlCenterOpen.set(false);
  clearAdminSession();
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem('admin_mode');
    } catch {
      /* ignore */
    }
  }
  authLogout().catch(() => {});
  uploadStatus.set('Signed out');
  resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
}

function loadWatchContinue() { return studioRefs.experience?.loadWatchContinue(); }

// Ghost/Control Center Handlers
// ==========================================
// ==========================================
// Keyboard Handler
// ==========================================
function handleKeyDown(e) { const currentReel = get(activeReel); if (e.key === 'Escape') { if (currentReel) { e.preventDefault(); theaterManager.close(); } else if (get(controlCenterOpen)) { e.preventDefault(); controlCenterOpen.set(false); } } }

function handleCardVideoError(event, reel) {
const video = event.currentTarget;
console.warn('❌ Video load failed (shelf card):', {
url: reel?.url,
mime: videoMimeForPath(reel?.url),
code: video?.error?.code,
message: video?.error?.message
});
logDeletionPropagation('shelf-video-error', {
reelId: reel?.id,
url: reel?.url,
code: video?.error?.code
});
if (reel?.id) {
logBg7kPlaceholderFallback(String(reel.id), 'video_load_error', {
url: reel?.url || '',
code: video?.error?.code ?? null
});
feedCardVideoFallbacks.update((ids) => {
const next = new Set(ids);
next.add(reel.id);
return next;
});
}
}
async function refreshContent() {
loading.set(true);
uploadStatus.set('🔄 Refreshing from backend...');
await bootstrapMediaFromBackend({
thumbnailKey: CONFIG.THUMBNAIL_STORAGE_KEY,
videoVaultKey: CONFIG.VIDEO_VAULT_KEY
});
reloadVaultStoresFromStorage();
await syncFromVault(true, true);
}

// ==========================================
// Helper Functions
// ==========================================
function checkIsVideo(file) {
  if (!file) return false;
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  return type.startsWith('video/') || name.endsWith('.mp4') || name.endsWith('.mov');
}

async function mountViewer() {
viewerHydrationReady.set(false);
pipelineCheckpoint('VIEWER_BOOTSTRAP', { phase: 'start' });
if (typeof window !== 'undefined') {
  const onAuthSessionExpired = () => {
    adminMode.set(false);
    controlCenterOpen.set(false);
    uploadStatus.set('Signed out');
    resourceManager.setTimeout(() => uploadStatus.set('Standby'), 4000);
  };
  resourceManager.addEventListener(window, 'AUTH_SESSION_EXPIRED', onAuthSessionExpired);
  // Phase 0: clear sticky admin_mode and re-derive purely from verified role.
  try {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem('admin_mode');
      } catch {
        /* ignore */
      }
    }
    await refreshAuthSession();
    if (!canAccessStudio()) {
      adminMode.set(false);
      controlCenterOpen.set(false);
    }
  } catch {
    adminMode.set(false);
    controlCenterOpen.set(false);
  }
}
initSeriesMetadata();
initStudioSync();
initWorkflowEngine();
initCreatorTeams();
initEpisodePipeline();
initCommandCenter();
initHeroIntelligence();
initReleaseCenter();
initPredictiveRepairEngine();
initCreatorKnowledgeGraph();
initStudioAudioEngine({
  bindStudioVisibility: (handler) => {
    controlCenterOpen.subscribe((open) => handler(open));
  },
  bindTheaterVisibility: (handler) => {
    activeReel.subscribe((reel) => handler(Boolean(reel)));
  }
});
initStudioAppearanceEngine({
  bindStudioRoot: (handler) => {
    controlCenterOpen.subscribe((open) => {
      if (!open) return;
      requestAnimationFrame(() => {
        handler(document.querySelector('.control-center-container'));
      });
    });
  }
});
initCreatorCopilot();
initStudioAssistant();
initSeriesApi();
initPublishingProfile();
runPlatformAudit();
initSecurityAuditEngine({ autoRun: true });
initThreatDetectionEngine({ bindFetch: true });
initSecurityPolicyEngine();
initSecurityOperationsCenter();
initSentinelAssistant();
initDiscoveryEngine();
initHomepageDiscoveryFeed();
initCreatorHomeFeed();
initDiscoveryFeedEngine();
initCreatorProfileEngine();
initMonetizationHub();
initSupportReelforge();
initDailyEngagementSystem();
initUniversalSearchEngine();
initDeepNavigation();
initRevenueCore();
initRevenueEngine();
initRevenueDashboard();
initMonetizationAI();
initMarketplaceEngine();
initEnterpriseManager();
initProductionPipelineEngine();
initReportingEngine();
configureEpisodeNavigation({
findReelInFeed,
openTheaterReel,
getAllFeedReels,
getCurrentEpisodeId: () => {
const reel = get(activeReel);
if (!reel) return null;
const ctx = resolveSeriesContextForReel(reel);
return ctx?.episode?.episodeId || reel.episodeId || reel.episode_id || null;
}
});
configureTheaterExperience({
resourceManager,
watchOnExit,
watchOnComplete,
watchOnPlay,
watchOnPause,
watchOnProgress,
watchApplyResume,
findReelInFeed,
watchSessionStart,
getPersonalVideos: () => {
  const videos = get(personalVideos);
  const hero = resolveActiveHeroVideoReel();
  if (!hero) return videos;
  if (videos.some((v) => String(v?.id || '') === hero.id)) return videos;
  return [heroReelToVaultItem(hero), ...videos];
},
resolveTheaterPlayback,
logTheaterHandshake,
isVideoReel,
reupload: {
deleteProduction: (id) => UIAgent.deleteProduction(id),
openControlCenter: () => {
  if (canAccessStudio()) {
    adminMode.set(true);
    controlCenterOpen.set(true);
  } else {
    adminMode.set(false);
    controlCenterOpen.set(false);
  }
},
setUploadStatus: (msg) => uploadStatus.set(msg),
scheduleStandby: () => resourceManager.setTimeout(() => uploadStatus.set('Standby'), 4000)
}
});
configureReelshortExperience({
watchOnComplete,
getTheaterVideo: () => theaterManager.videoElement
});
initReelshortProfile(resourceManager, loadWatchContinue);
console.log('[ReelForge media] BACKEND_URL =', BACKEND_URL, '| sample video =', toBackendMediaUrl('/videos/MICROS_STIRRED_V3.MOV'));
resourceManager.setTimeout(() => auditRenderedMediaUrls(), 2500);
prepareStorageOnStartup(CONFIG.THUMBNAIL_STORAGE_KEY);
const onBackendReconnecting = (e) => {
const status = get(uploadStatus);
if (status.startsWith('✅')) return;
uploadStatus.set(`🔄 ${e.detail?.message || 'Backend reconnecting...'}`);
};
const onEpisodePlayBlocked = (event) => {
const detail = event?.detail || {};
const episodeNumber = Number(detail.episodeNumber);
const badgeLabel = String(detail.badgeLabel || '').trim();
const accessMode = String(detail.accessMode || 'paid').toLowerCase();
const episodeLine =
  Number.isFinite(episodeNumber) && episodeNumber > 0
    ? `Episode ${Math.floor(episodeNumber)}`
    : 'This episode';
const gateLine = badgeLabel
  ? `${episodeLine} is ${badgeLabel}.`
  : accessMode === 'paid'
    ? `${episodeLine} requires paid access.`
    : `${episodeLine} is locked.`;
setUploadStatusIfIdle(`⚠️ ${gateLine} Pay or subscribe to continue.`);
resourceManager.setTimeout(() => {
  const statusNow = String(get(uploadStatus) || '');
  if (statusNow.startsWith('⚠️')) uploadStatus.set('Standby');
}, 4500);
};
const onSearchOpenReel = (event) => {
const detail = event?.detail || {};
const reelId = detail.reelId || null;
if (!reelId) return;
const reel = findReelInFeed(reelId);
if (reel) {
openTheater(reel);
}
};
const onSearchNavigate = (event) => {
const detail = event?.detail || {};
if (detail?.workspaceTab || detail?.dashboardSection || detail?.targetType) {
  if (canAccessStudio()) {
    adminMode.set(true);
    controlCenterOpen.set(true);
  } else {
    adminMode.set(false);
    controlCenterOpen.set(false);
  }
}
};
const onOpenStudio = (event) => {
  const source = event?.detail?.source || 'account_menu';
  openStudioFromAccountMenu(source);
};
const onAccountPlay = (event) => {
  const detail = event?.detail || null;
  if (detail?.reelId) tryConsumeAccountPlay(detail);
};
resourceManager.addEventListener(window, 'reelforge:backend-reconnecting', onBackendReconnecting);
resourceManager.addEventListener(window, 'reelforge:workflow-navigate', handleWorkflowNavigate);
resourceManager.addEventListener(window, 'reelforge:search-open-reel', onSearchOpenReel);
resourceManager.addEventListener(window, 'reelforge:search-navigate', onSearchNavigate);
resourceManager.addEventListener(window, 'reelforge:open-studio', onOpenStudio);
resourceManager.addEventListener(window, 'reelforge:account-play', onAccountPlay);
resourceManager.addEventListener(window, 'reelforge:episode-play-blocked', onEpisodePlayBlocked);
resourceManager.addEventListener(window, 'keydown', handleKeyDown);

const hadLocalCache = hasLocalMediaCache(CONFIG.THUMBNAIL_STORAGE_KEY, CONFIG.VIDEO_VAULT_KEY);
const cachedVideos = JSON.parse((typeof window !== 'undefined' ? localStorage.getItem(CONFIG.VIDEO_VAULT_KEY) : null) || '[]');
console.log(`[onMount] localStorage cache: ${hadLocalCache ? 'present' : 'empty'} (${cachedVideos.length} cached videos)`);

const bootstrap = await bootstrapMediaFromBackend({
thumbnailKey: CONFIG.THUMBNAIL_STORAGE_KEY,
videoVaultKey: CONFIG.VIDEO_VAULT_KEY
});
console.log(`[onMount] bootstrap result: ${bootstrap.source} (${bootstrap.thumbnails} thumbs, ${bootstrap.videos} videos)`);

const savedHeroVideoRaw = localStorage.getItem(CONFIG.HERO_VIDEO_STORAGE_KEY);
let savedHeroVideo = savedHeroVideoRaw;
const savedHeroImage = localStorage.getItem(CONFIG.HERO_IMAGE_STORAGE_KEY);
// Compatibility diagnostics only — mount hydration authority is HeroRecord (hydrateHeroBackgroundStores).
console.info('[HERO_LOAD]', {
stage: 'viewer:onMount:hero-storage-keys',
videoKey: CONFIG.HERO_VIDEO_STORAGE_KEY,
imageKey: CONFIG.HERO_IMAGE_STORAGE_KEY,
hasVideo: Boolean(savedHeroVideoRaw),
hasImage: Boolean(savedHeroImage),
recordMode: loadHeroRecord()?.mode || '',
ts: new Date().toISOString()
});
if (savedHeroVideo?.startsWith('blob:')) {
clearHeroVideoStorage();
savedHeroVideo = null;
heroDebugLog('Viewer.svelte:onMount:hydrate', 'dropped expired blob hero video from storage', {}, 'B');
}
heroDebugLog('Viewer.svelte:onMount:hydrate', 'legacy hero keys present (non-authoritative)', {
savedHeroVideoPreview: savedHeroVideo ? savedHeroVideo.slice(0, 120) : null,
savedHeroVideoLen: savedHeroVideo?.length || 0,
savedHeroImagePreview: savedHeroImage ? savedHeroImage.slice(0, 80) : null,
savedHeroImageLen: savedHeroImage?.length || 0,
storeVideoBefore: get(HERO_BACKGROUND_VIDEO)?.slice(0, 120) || '',
storeImageBefore: get(HERO_POSTER_IMAGE)?.slice(0, 80) || '',
imageHeroMode: isPersistedImageHero(savedHeroImage),
recordMode: loadHeroRecord()?.mode || ''
}, 'B');

console.info('[HERO_HYDRATION]', {
  phase: 'before-async',
  HERO_BACKGROUND_VIDEO: get(HERO_BACKGROUND_VIDEO),
  stage: 'mountViewer'
});
const hydrateResult = await hydrateHeroBackgroundStores(getHeroBackgroundStores(), {
  ...CONFIG,
  resolveVideoUrl: normalizeVideoUrl
});
console.info('[HERO_HYDRATION]', {
  phase: 'after-async',
  HERO_BACKGROUND_VIDEO: get(HERO_BACKGROUND_VIDEO),
  hydrationCompleteTimestamp: new Date().toISOString(),
  result: hydrateResult,
  stage: 'mountViewer'
});
console.info('[HERO_LOAD]', {
stage: 'viewer:onMount:hydrate-result',
result: hydrateResult,
ts: new Date().toISOString()
});
heroDebugLog('Viewer.svelte:onMount:postResolve', 'stores after hydrateHeroBackgroundStores', {
hydrateResult,
storeVideo: get(HERO_BACKGROUND_VIDEO)?.slice(0, 120) || '',
storeImage: get(HERO_POSTER_IMAGE)?.slice(0, 80) || '',
heroVideoFailed: get(heroVideoFailed)
}, 'A');
let prevHeroVideoForGate = get(HERO_BACKGROUND_VIDEO);
const unsubscribeHeroVideo = HERO_BACKGROUND_VIDEO.subscribe(v => {
if (prevHeroVideoForGate !== v) {
logHeroBackgroundVideoChange(prevHeroVideoForGate, v);
prevHeroVideoForGate = v;
}
if (!v) {
clearHeroVideoStorage();
heroDebugLog('Viewer.svelte:heroVideo:clearPersist', 'cleared hero video storage', { localStorageStillHas: Boolean(localStorage.getItem(CONFIG.HERO_VIDEO_STORAGE_KEY)) }, 'D');
}
});
const unsubscribeHeroImage = HERO_POSTER_IMAGE.subscribe(v => {
if (!v) {
clearHeroImageStorage();
heroDebugLog('Viewer.svelte:heroImage:clearPersist', 'cleared hero image storage', { localStorageStillHas: Boolean(localStorage.getItem(CONFIG.HERO_IMAGE_STORAGE_KEY)) }, 'D');
}
});

const storedVideos = JSON.parse((typeof window !== 'undefined' ? localStorage.getItem(CONFIG.VIDEO_VAULT_KEY) : null) || '[]');
console.log(`[onMount] Loaded ${storedVideos.length} videos from [${hadLocalCache ? 'localStorage' : 'backend'}]`);
if (storedVideos.length > 0) {
const filteredStoredVideos = filterOutDeletedMedia(filterNonHeroAssets(storedVideos));
personalVideos.set(filteredStoredVideos.map((video) => {
const durableStill = pickDurableVaultStillUrl(video);
const resolvedStill = resolveUserPosterUrl(durableStill) || durableStill;
const normalized = {
...video,
url: video.url ? toRelativeMediaPath(video.url) : '',
...(resolvedStill
  ? { thumbnail: resolvedStill, thumbnailUrl: resolvedStill, posterUrl: resolvedStill }
  : { thumbnail: resolveUserPosterUrl(video.thumbnail) || video.thumbnail || '' })
};
if (normalized.url && normalized.url.startsWith('blob:')) {
fetch(normalized.url, { method: 'HEAD' }).catch(() => {
personalVideos.update(vault => vault.map(v => v.id === video.id ? { ...v, urlExpired: true } : v));
if (get(HERO_BACKGROUND_VIDEO) === normalized.url) {
heroDebugLog('Viewer.svelte:vaultBlobExpired', 'reset hero due to expired vault blob', { expiredUrl: video.url?.slice(0, 80) || '', resetTo: CONFIG.HERO_VIDEO_PATHS[0] }, 'E');
HERO_BACKGROUND_VIDEO.set(CONFIG.HERO_VIDEO_PATHS[0]);
heroVideoFailed.set(true);
}
});
}
return normalized;
}));
}

let prevPersonalVideosForGate = get(personalVideos);
const unsubscribeVault = personalVideos.subscribe(vault => {
logPersonalVideosChange(prevPersonalVideosForGate, vault);
prevPersonalVideosForGate = vault;
persistPersonalVault(vault);
});

const onHeroUpload = (event) => {
const detail = event?.detail || {};
const phase = String(detail.phase || '').trim();
const reelId = String(detail.reelId || '').trim();
if (phase === 'start') {
heroUploadInFlight = true;
return;
}
if (phase === 'created') {
if (reelId) {
pendingHeroAssetIds.add(reelId);
console.info('[BG7W_HERO_VAULT_GATE]', { reelId, blocked: true, reason: 'hero_pending' });
}
return;
}
if (phase === 'committed') {
if (reelId) pendingHeroAssetIds.delete(reelId);
heroUploadInFlight = false;
}
};
if (typeof window !== 'undefined') {
window.addEventListener('reelforge:hero-upload', onHeroUpload);
}
const onUploadProgress = (event) => {
  applyUploadProgressDetail(event?.detail || {});
};
if (typeof window !== 'undefined') {
window.addEventListener('reelforge:upload-progress', onUploadProgress);
}

reloadVaultStoresFromStorage();
notifyInterruptedUploads((message) => uploadStatus.set(message));
const thumbCount = get(personalThumbnailCollection).length;
if (thumbCount > 0) {
console.log(`[onMount] Loaded ${thumbCount} thumbnails from [${hadLocalCache ? 'localStorage' : 'backend'}]`);
if (!isStorageFull()) {
resourceManager.setTimeout(() => AI_CLEANUP_AGENT.syncThumbnailsToFeed(), 100);
}
} else {
console.log('[onMount] Loaded 0 thumbnails from [none]');
}

await syncFromVault(true, true);
const hydratedPersonalVideosCount = get(personalVideos).length;
viewerHydrationReady.set(true);
logBg7jHydrationReady(true, hydratedPersonalVideosCount);
// Consumer account Continue Watching / My List → theater open after catalog ready.
tryConsumeAccountPlay();
pipelineCheckpoint('VIEWER_BOOTSTRAP', { phase: 'post-syncFromVault' });
if (hasUserHeroOverride(CONFIG)) {
applyHeroRecordBackgroundToViewer(loadHeroRecord());
}
{
const postSyncRecord = loadHeroRecord();
const postSyncHeroCfg = /** @type {any} */ (
  mergeHeroRecordIntoManagerConfig(loadHeroManagerConfig(), postSyncRecord)
);
logHeroConfigBootTrace({
  site: 'viewerContext:onMount-post-sync',
  caller: 'viewerContext.js:onMount',
  storageRawBeforeParse: localStorage.getItem('reelforge_hero_manager_config'),
  heroAssetId: postSyncHeroCfg?.heroAssetId || '',
  backgroundSource: postSyncHeroCfg?.backgroundSource || '',
  configSource: 'HeroRecord+loadHeroManagerConfig',
  reason: 'post_syncFromVault_before_applyHeroIntelligence'
});
}
runEpisodeBridgeSync('post-sync');
applyHeroIntelligence(true);
const onHeroIntelRefresh = () => applyHeroIntelligence(false);
const onHeroManagerUpdated = (event) => handleHeroManagerUpdated(event);
const onHeroRecordUpdated = (event) => handleHeroRecordUpdated(event);
const onHeroWatchNow = (event) => {
const reel = event?.detail?.reel;
if (reel) openTheater(reel);
};
const onHeroLearnMore = (event) => {
const reel = event?.detail?.reel;
if (reel) openTheater(reel);
};
window.addEventListener('reelforge:metrics-updated', onHeroIntelRefresh);
window.addEventListener('reelforge:release-schedule-updated', onHeroIntelRefresh);
window.addEventListener('reelforge:hero-manager-updated', onHeroManagerUpdated);
window.addEventListener('reelforge:hero-record-updated', onHeroRecordUpdated);
window.addEventListener('reelforge:hero-watch-now', onHeroWatchNow);
window.addEventListener('reelforge:hero-learn-more', onHeroLearnMore);
AI_CLEANUP_AGENT.init();
if (!isStorageFull()) {
resourceManager.setTimeout(() => AI_CLEANUP_AGENT.syncVideoVaultToFeed(), 200);
}

const closeWs = connectReelEventSocket({
onCreated: (reel) => {
if (!reel?.id) return;
reelResReelSnapshot('viewerContext:onCreated', reel, { listener: 'connectReelEventSocket.onCreated' });
const heroIgnored = isHeroAsset(reel);
reelResReelSnapshot('viewerContext:onCreated:heroFilter', reel, {
  heroIgnored,
  reason: heroIgnored ? 'isHeroAsset_true_syncFromVault_still_runs' : 'not_hero'
});
pipelineCheckpoint('CANONICAL_REEL_RECEIVED', {
source: 'websocket',
reelId: reel.id,
url: reel.url || reel.video_url || ''
});
const reelId = String(reel.id);
if (heroUploadInFlight) {
pendingHeroAssetIds.add(reelId);
console.info('[BG7W_HERO_VAULT_GATE]', { reelId, blocked: true, reason: 'hero_pending' });
}
const now = Date.now();
const lastAt = wsCreatedSyncCooldownByReel.get(reelId) || 0;
if (now - lastAt < 3000) return;
wsCreatedSyncCooldownByReel.set(reelId, now);
console.info('[HERO_ROUTE]', {
stage: 'websocket:onCreated',
reelId,
type: String(reel?.type || ''),
url: String(reel?.url || reel?.video_url || reel?.videoUrl || ''),
thumbnailUrl: String(reel?.thumbnailUrl || reel?.thumbnail_url || ''),
ts: new Date().toISOString()
});
console.log('[ws] CREATED — refreshing feed', reel.id);
if (typeof window !== 'undefined') {
window.dispatchEvent(new CustomEvent('reelforge:upload-updated', { detail: { reelId: reel.id } }));
}
syncFromVault(true).then(() => runEpisodeBridgeSync('ingestion'));
},
onDeleted: ({ id }) => {
if (!id) return;
console.log('[ws] DELETED — purging', id);
applyCanonicalDeleteClientEffects(
{ purge: runClientMediaPurge },
{ reelId: id }
);
}
});

resourceManager.setTimeout(() => { if (get(loading)) { console.warn('Safety timeout: forcing loading.set(false) after 5 seconds'); loading.set(false); } }, 5000);
return () => {
closeWs();
window.removeEventListener('reelforge:metrics-updated', onHeroIntelRefresh);
window.removeEventListener('reelforge:release-schedule-updated', onHeroIntelRefresh);
window.removeEventListener('reelforge:hero-manager-updated', onHeroManagerUpdated);
window.removeEventListener('reelforge:hero-record-updated', onHeroRecordUpdated);
window.removeEventListener('reelforge:hero-watch-now', onHeroWatchNow);
window.removeEventListener('reelforge:hero-learn-more', onHeroLearnMore);
if (typeof window !== 'undefined') {
window.removeEventListener('reelforge:hero-upload', onHeroUpload);
window.removeEventListener('reelforge:upload-progress', onUploadProgress);
}
unsubscribeVault();
unsubscribeHeroVideo();
unsubscribeHeroImage();
if (detachHeroPersistence) {
detachHeroPersistence();
detachHeroPersistence = null;
}
unlockBodyScroll();
resourceManager.clearAll();
};
}

function destroyViewer() {
  clearTheaterCountdown();
  unlockBodyScroll();
  resourceManager.clearAll();
}

  return {
    CONFIG, NEON_COLORS, DEBUG_MEDIA,
    feed, categories, loading, contentEmpty, adminMode, controlCenterOpen, uploadStatus,
    newTitle, newCategory, selectedFile, videoSource, isAutoDetecting, detectedCategory,
    personalThumbnailCollection, personalVideos, usePersonalThumbnails, personalStudioMode,
    personalThumbnailIndex, personalVideoCollection, heroVideoLoaded, heroVideoFailed,
    heroRestoring, heroResumeToast, deleteConfirmReel, isDeleting, pendingVideo, pendingThumbnail,
    isReplacingHero, ghostHoverActive, thumbnailDragActive, videoDragActive, dragActive,
    studioHierarchyEnabled, studioHierarchyLoading,
    studioHierarchyError, studioProjectTree, studioCatalogProjectId, studioFormSeriesTitle,
    studioFormSeasonNumber, studioFormEpisodeTitle, studioFormEpisodeNumber,
    studioSelectedSeriesId, studioSelectedSeasonId, studioAttachEpisodeId, studioAttachReelId,
    studioSeriesMetadataReelId, watchContinueEnabled, watchContinueItems, watchContinueLoading,
    feedCardVideoFallbacks, feedCardImageFallbacks,
    aiMaintenanceMode, isCleaning, lastAiCleanup, storageHealth,
    HERO_BACKGROUND_VIDEO, HERO_POSTER_IMAGE, heroVideoAttempt, heroPendingFile,
    heroIsDragOver, heroPreviewUrl, categoryRotationIndices,
    viewerHydrationReady,
    categoryNames, persistentTitles, categoryCounts, normalizedFeed, totalReelsCount, hasPersonalContent,
    resourceManager, vaultUtils, UIAgent, AI_CLEANUP_AGENT, AI_IMAGE_GENERATOR, CATEGORY_DETECTOR,
    ProductionAgent, BLACK_STORIES_MATCHER, PersonalUploadSystem,
    heroSelection, heroIntelligenceApplied, studioRefs,
    getAllFeedReels, patchFeedWithEpisodeBindings, runEpisodeBridgeSync, handleEpisodeAssetChanged,
    handleWorkflowNavigate, findReelInFeed, handleCardClick, openTheater,
    lockBodyScroll, unlockBodyScroll,
    storageSet, clearApplicationCache, resetAllLocalData, persistPersonalVault,
    syncFromVault, reloadVaultStoresFromStorage, applyHeroIntelligence,
    handleGhostHoverEnter, handleGhostHoverLeave, toggleControlCenter, logout, loadWatchContinue,
    handleKeyDown, handleCardVideoError, refreshContent, checkIsVideo, hasPlayableVideo, getImg,
    getFallbackImage, startStudioWalkthrough, logVaultFieldAuditList,
    mountViewer, destroyViewer
  };
}
