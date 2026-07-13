/**
 * Viewer runtime context — Phase 26 decomposition.
 */
import { writable, derived, get } from 'svelte/store';
import { API_BASE_URL, BACKEND_URL, checkBackendHealth, fetchWithRetry, getAdminAuthorizationHeader, notifyBackendReconnecting } from '../lib/api.js';
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
    hasUserHeroOverride,
    hydrateHeroBackgroundStores,
    initHeroIntelligence,
    loadHeroManagerConfig,
    mapPlatformHeroMode,
    selectHeroContent,
    startHeroRotation,
    stopHeroRotation
} from '../lib/hero/heroIntelligence.js';
import { isHeroAsset, filterNonHeroAssets } from '../lib/hero/heroDomainGuard.js';
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
diagnoseStalePlaceholders
} from '../lib/deletionSync.js';
import { normalizeReel, normalizeReels, createLocalReel, isVideoReel, assertReelContract } from '../lib/api/reelContract.js';
import { resolveTheaterPlayback, logTheaterHandshake } from '../lib/media/theaterPlayback.js';
import {
watchSessionStart,
watchOnPlay,
watchOnPause,
watchOnComplete,
watchOnExit
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
import { buildDemoFeedReels } from '../lib/demoPlaceholders.js';
import {
ALLOW_UI_PLACEHOLDERS,
bootstrapMediaFromBackend,
feedHasRealContent,
hasLocalMediaCache,
hydrateVaultFromReels,
reelsToVideoVaultEntries
} from '../lib/mediaBootstrap.js';
import { createContentAgents } from '../lib/viewer/contentAgents.js';
import {
  filterStaleOrphanEntries,
  isThumbnailImageReel,
  thumbnailEntryFileKey
} from '../lib/viewer/thumbnailCanonicalization.js';
import {
  reconcileThumbnailVault,
  syncCollectionStore,
  readThumbnailVault,
  writeThumbnailVault,
  deriveCollectionKeys,
  upgradeThumbnailVaultFromBackendReels,
  THUMBNAIL_KEY
} from '../lib/viewer/thumbnailVault.js';
import { traceThumbStoreWrite } from '../lib/viewer/thumbStoreWriteTrace.js';
import { createAiCleanupAgent } from '../lib/viewer/aiCleanupAgent.js';
import { createUiAgent } from '../lib/viewer/uiAgent.js';
import { createVaultUtils } from '../lib/viewer/vaultUtils.js';
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
MAX_VIDEO_SIZE: 500 * 1024 * 1024,
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
const filtered = filterNonHeroAssets(videos);
safeLocalStorageSet(CONFIG.VIDEO_VAULT_KEY, filtered, {
thumbnailKey: CONFIG.THUMBNAIL_STORAGE_KEY,
minimalFields: ['id', 'name', 'fileName', 'type', 'size', 'addedAt', 'thumbnail']
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
storageSet(CONFIG.FEED_STORAGE_KEY, value);
});
}
const categories = writable([]);
const loading = writable(true);
const contentEmpty = writable(false);
const adminMode = createPersistentStore('admin_mode', false);
const controlCenterOpen = writable(false);
const uploadStatus = createValidatedStore('Standby', (v) => typeof v === 'string');
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
if (reel?.id) reels.push(reel);
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
const report = bridgeFeedReelsToCatalog(getAllFeedReels());
patchFeedWithEpisodeBindings();
const assetCoverage = auditEpisodeAssets(getAllFeedReels(), true);
if (import.meta.env.DEV) {
const coverage = auditEpisodeBridgeCoverage(getAllFeedReels());
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
return;
}
openTheaterReel(reel);
logTheaterState({
source: 'viewer-openTheater-complete',
activeReelId: get(activeReel)?.id ?? null,
visible: Boolean(get(activeReel)),
resolvedFromFeed: Boolean(findReelInFeed(reel?.id))
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
if (!customName?.trim() || customName === originalName) return;
store.update((current) => ({
...current,
[originalName]: customName.trim()
}));
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
store.update((current) => ({
...current,
[reelId]: {
...titleData,
savedAt: new Date().toISOString()
}
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
const categoryCounts = derived(feed, ($feed) => {
const counts = {};
Object.keys($feed).forEach((cat) => {
if (cat !== 'Auto-Detect' && $feed[cat]) {
counts[cat] = $feed[cat].filter((r) => !r.isPlaceholder).length;
}
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
const getImg = (reel, category, i) => UIAgent.getImg?.(reel, category, i) || getRandomThumb();
// ==========================================
// 🚀 FIXED DRAG & DROP HANDLERS
// ==========================================

// THUMBNAIL VAULT DROP ZONE
// ==========================================
// Vault → Studio drag-and-drop
// ==========================================
function getAdminToken() {
return typeof window !== 'undefined' ? localStorage.getItem('reelforge_admin_session_token') : null;
}
// ==========================================
// Thumbnail Handlers (for personal vault)
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
const nonHeroThumbs = filterNonHeroAssets(thumbs);
writeThumbnailVault(nonHeroThumbs, CONFIG.THUMBNAIL_STORAGE_KEY);
syncCollectionStore(personalThumbnailCollection, CONFIG.THUMBNAIL_STORAGE_KEY);
console.info('[VAULT_RELOAD]', {
action: 'reloadVaultStoresFromStorage:mutate',
personal_thumbnails: nonHeroThumbs.length,
ts: new Date().toISOString()
});
} else {
setPersonalThumbnailCollection([], 'reloadVaultStoresFromStorage:clear');
writeThumbnailVault([], CONFIG.THUMBNAIL_STORAGE_KEY);
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
const filteredStoredVideos = filterNonHeroAssets(storedVideos);
personalVideos.set(filteredStoredVideos.map((video) => ({
...video,
url: video.url ? toRelativeMediaPath(video.url) : '',
thumbnail: resolveUserPosterUrl(video.thumbnail) || ''
})));
console.info('[STORE_UPDATE]', {
store: 'personalVideos',
count: filteredStoredVideos.length,
ts: new Date().toISOString()
});
}
}
function mergeVideoVaultEntries(existingEntries = [], incomingEntries = []) {
const merged = [];
const seen = new Set();
for (const entry of [...existingEntries, ...incomingEntries]) {
if (!entry || typeof entry !== 'object') continue;
if (isHeroAsset(entry)) continue;
const rawUrl = String(entry.url || '').trim();
const canonicalUrl = rawUrl ? toRelativeMediaPath(rawUrl) : '';
const key = canonicalUrl || String(entry.fileName || entry.name || '').trim();
if (!key || seen.has(key)) continue;
seen.add(key);
merged.push(entry);
}
return merged;
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
const debugApi = import.meta.env.VITE_DEBUG_API === 'true';
if (debugApi) console.info('[SYNC_DEBUG] syncFromVault:start', { preserveLocal, now });
try {
const localTitles = get(persistentTitles);
let rawData = [];
let backendReachable = false;
uploadStatus.set('🔄 Syncing with backend...');
const healthy = await checkBackendHealth();
if (!healthy) {
if (isStorageFull()) {
uploadStatus.set('Backend offline and storage full. Clear local data or free up space.');
loading.set(false);
return;
}
uploadStatus.set('🔄 Backend reconnecting...');
notifyBackendReconnecting();
console.warn('⚠️ Backend health check failed before sync');
if (!hasStorageSpaceFor([])) {
uploadStatus.set('Backend offline and storage full. Clear local data or free up space.');
loading.set(false);
return;
}
rawData = normalizeReels(JSON.parse(localStorage.getItem(CONFIG.VAULT_KEY) || '[]'), 'localStorage fallback');
} else {
const res = await fetchWithRetry(
`${API_BASE_URL}/api/reels?t=${Date.now()}`,
{ headers: getAdminAuthorizationHeader(getAdminToken()) },
{ retries: 3, retryDelayMs: 750 }
);
// Any successful catalog response means backend is reachable for reconcile.
if (res.ok) {
backendReachable = true;
const contentType = res.headers.get('content-type') || '';
if (!contentType.includes('application/json')) throw new Error(`Expected JSON but received ${contentType}`);
rawData = normalizeReels(await res.json(), 'GET /api/reels');
logVaultFieldAuditList('GET /api/reels response (syncFromVault)', rawData);
uploadStatus.set('✅ Synced with backend');
} else {
backendReachable = false;
console.warn(`⚠️ Backend returned ${res.status}, preserving local vault (offline reconcile skipped)`);
uploadStatus.set(`⚠️ Sync failed (${res.status}) — showing saved content`);
rawData = normalizeReels(JSON.parse(localStorage.getItem(CONFIG.VAULT_KEY) || '[]'), 'localStorage fallback');
}
}
// Build feed from backend / vault
const hydratedFeed = {};
const allCategories = [...new Set(rawData.map(r => r.category || 'Trending'))];
allCategories.forEach(cat => hydratedFeed[cat] = []);
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
const seenVideoUrls = new Set();
rawData.forEach((reel) => {
if (!isVideoReel(reel)) return;
if (isHeroAsset(reel)) return;
const videoKey = String(reel.url || '').trim();
if (!videoKey || seenVideoUrls.has(videoKey)) return;
seenVideoUrls.add(videoKey);
if (preserveLocal && localTitles[reel.id]) {
reel.title = localTitles[reel.id].title;
reel.title_original = localTitles[reel.id].title_original;
reel._localModified = true;
} else {
reel.title_original = reel.title || reel.name || reel.title_original || '';
}
reel.isPlaceholder = false;
reel.isPersonalVideo = true;
reel.isPersonalThumbnail = false;
reel.personal_video_id = reel.personal_video_id || reel.id;
reel.match = reel.match || '🎬 EPISODE';
reel.url = toRelativeMediaPath(String(reel.url || reel.video_url || '')) || reel.url;
if (reel.thumbnailUrl) {
reel.thumbnailUrl = toRelativeMediaPath(String(reel.thumbnailUrl)) || reel.thumbnailUrl;
} else if (!reel.thumbnailUrl) {
const storedThumbs = JSON.parse((typeof window !== 'undefined' ? localStorage.getItem(CONFIG.THUMBNAIL_STORAGE_KEY) : null) || '[]');
const fileKey = String(reel.fileName || reel.file_name || '').trim();
const entry = (Array.isArray(storedThumbs) ? storedThumbs : []).find((t) => {
if (!t) return false;
if (typeof t === 'string') return t === fileKey;
const byId = String(t.id || '').trim();
const byFile = String(t.fileName || t.file_name || '').trim();
const byUrl = String(t.url || '').trim();
return (fileKey && byFile === fileKey) || (byUrl && toRelativeMediaPath(byUrl) === toRelativeMediaPath(String(reel.url || '')));
});
if (entry && typeof entry === 'object' && entry.url) {
reel.thumbnailUrl = toRelativeMediaPath(String(entry.url)) || entry.url;
} else if (fileKey) {
const match = (Array.isArray(storedThumbs) ? storedThumbs : []).find((t) => t && String(t.fileName || t.file_name || '').trim() === fileKey);
if (match?.url) {
reel.thumbnailUrl = toRelativeMediaPath(String(match.url)) || match.url;
}
}
}
const cat = reel.category || 'Trending';
if (!hydratedFeed[cat]) hydratedFeed[cat] = [];
hydratedFeed[cat].unshift(reel);
});
const cleanedFeed = { 'Trending': [], 'Romance': [], 'Cyber-Action': [], 'Suspense': [] };
Object.keys(hydratedFeed).forEach(cat => {
const targetCat = cat === 'Network' ? 'Trending' : cat === 'Love' || cat === 'Drama' ? 'Romance' : cat === 'Action' ? 'Cyber-Action' : cat;
if (cleanedFeed[targetCat]) cleanedFeed[targetCat].push(...hydratedFeed[cat]);
else cleanedFeed['Trending'].push(...hydratedFeed[cat]);
});
const backendVideoUrls = new Set(
rawData
.filter((r) => isVideoReel(r))
.map((r) => toRelativeMediaPath(String(r.url || r.video_url || '').split('?')[0]))
.filter((url) => url.startsWith('/videos/'))
);
const { feed: prunedFeed } = pruneFeedAgainstBackendVideos(cleanedFeed, backendVideoUrls);
if (!backendReachable) {
const personalVideosList = get(personalVideos);
personalVideosList.forEach((video) => {
let exists = false;
Object.values(prunedFeed).forEach((catArray) => {
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
feed.set(prunedFeed);
categories.set(Object.keys(prunedFeed));
const feedWrite = storageSet(CONFIG.FEED_STORAGE_KEY, prunedFeed);
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
writeThumbnailVault([], CONFIG.THUMBNAIL_STORAGE_KEY);
syncCollectionStore(personalThumbnailCollection, CONFIG.THUMBNAIL_STORAGE_KEY);
personalVideos.set([]);
storageSet(CONFIG.VIDEO_VAULT_KEY, []);
const demoFeed = {
'Trending': buildDemoFeedReels(),
'Romance': [],
'Cyber-Action': [],
'Suspense': []
};
feed.set(demoFeed);
categories.set(Object.keys(demoFeed));
contentEmpty.set(!ALLOW_UI_PLACEHOLDERS);
storageSet(CONFIG.FEED_STORAGE_KEY, demoFeed);
console.info('[SYNC_RECONCILE_EMPTY_BACKEND]', {
stage: 'authoritative-empty-catalog:demo-feed',
demoCount: demoFeed.Trending.length,
allowUiPlaceholders: ALLOW_UI_PLACEHOLDERS,
ts: new Date().toISOString()
});
} else if (backendReachable && rawData.length > 0) {
const videoReelCount = rawData.filter((r) => isVideoReel(r)).length;
console.log(
`[syncFromVault] Loaded ${rawData.length} reels from [backend] (${videoReelCount} playable video, thumbs → placeholders)`
);
contentEmpty.set(videoReelCount > 0 || get(personalThumbnailCollection).length > 0);
const backendVaultVideos = reelsToVideoVaultEntries(rawData);
const existingVaultVideos = JSON.parse((typeof window !== 'undefined' ? localStorage.getItem(CONFIG.VIDEO_VAULT_KEY) : null) || '[]');
const mergedVaultVideos = mergeVideoVaultEntries(existingVaultVideos, backendVaultVideos);
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
count: nonHeroMergedVaultVideos.length,
ts: new Date().toISOString()
});
console.info('[HERO_STORE_WRITE]', {
stage: 'syncFromVault:video-vault-persist',
key: CONFIG.VIDEO_VAULT_KEY,
count: nonHeroMergedVaultVideos.length,
heroAssetId: heroAssetIdSnapshot,
ts: new Date().toISOString()
});
persistPersonalVault(nonHeroMergedVaultVideos);
console.log(
`[syncFromVault] Video vault merged (local + backend): ${existingVaultVideos.length} + ${backendVaultVideos.length} => ${nonHeroMergedVaultVideos.length}`
);
if (!AI_CLEANUP_AGENT.syncThumbnailsToFeed()) return;
diagnoseStalePlaceholders(get(feed));
} else if (!backendReachable) {
console.log('🌐 Backend unreachable, using localStorage data');
uploadStatus.set('⚠️ Backend unreachable — showing saved content');
if (!AI_CLEANUP_AGENT.syncThumbnailsToFeed()) return;
AI_CLEANUP_AGENT.syncVideoVaultToFeed();
}
const flatFeedCount = Object.values(get(feed)).flat().length;
if (flatFeedCount === 0 && ALLOW_UI_PLACEHOLDERS) {
const demoFeed = {
'Trending': buildDemoFeedReels(),
'Romance': [],
'Cyber-Action': [],
'Suspense': []
};
feed.set(demoFeed);
categories.set(Object.keys(demoFeed));
storageSet(CONFIG.FEED_STORAGE_KEY, demoFeed);
console.info('[DEMO_FEED_INJECTED]', {
demoCount: demoFeed.Trending.length,
reason: 'empty-feed-after-sync',
ts: new Date().toISOString()
});
}
} catch (err) {
console.error('❌ Sync Error:', err);
if (isStorageFull()) {
uploadStatus.set('Backend offline and storage full. Clear local data or free up space.');
loading.set(false);
return;
}
uploadStatus.set('❌ Sync failed — showing saved content offline');
console.log('⚠️ Network failure, falling back to localStorage');
if (!AI_CLEANUP_AGENT.syncThumbnailsToFeed()) return;
AI_CLEANUP_AGENT.syncVideoVaultToFeed();
} finally {
lastSyncFromVaultAt = Date.now();
syncFromVaultInFlight = null;
if (debugApi) console.info('[SYNC_DEBUG] syncFromVault:finish', { at: lastSyncFromVaultAt });
loading.set(false);
resourceManager.setTimeout(() => {
if (get(uploadStatus).startsWith('✅') || get(uploadStatus).startsWith('⚠️') || get(uploadStatus).startsWith('❌')) {
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

function applyManagerBackgroundFromConfig(config = loadHeroManagerConfig()) {
  return applyHeroManagerBackground(config, getHeroBackgroundStores());
}

function handleHeroManagerUpdated(event) {
  const config = event?.detail || loadHeroManagerConfig();
  if (config.backgroundSource === 'custom_video' || config.backgroundSource === 'custom_image') {
    applyManagerBackgroundFromConfig(config);
  } else if (!hasUserHeroOverride(CONFIG)) {
    applyHeroBackgroundFromIntelligence();
  }
  const feedSnapshot = get(feed);
  heroSelection.set(
    selectHeroContent(config.heroType, feedSnapshot, {
      fallbackTitle: 'Neon Vengeance',
      fallbackSubtitle: 'The code was his legacy. The betrayal was his rebirth.'
    })
  );
  if (config.autoRotate) {
    startHeroRotation(feedSnapshot, (selection) => {
      heroSelection.set(selection);
      if (hasUserHeroOverride(CONFIG)) return;
      const managerConfig = loadHeroManagerConfig();
      if (managerConfig.backgroundSource === 'selection') {
        applyHeroSelection(selection, getHeroBackgroundStores(), {
          respectUserOverride: true,
          config: CONFIG,
          applyBackground: true,
          clearVideoForPosterOnly: false
        });
      } else {
        applyManagerBackgroundFromConfig(managerConfig);
      }
    });
  } else {
    stopHeroRotation();
  }
}

function applyHeroBackgroundFromIntelligence() {
  const managerConfig = loadHeroManagerConfig();
  const stores = getHeroBackgroundStores();

  if (hasUserHeroOverride(CONFIG)) {
    if (managerConfig.backgroundSource === 'custom_video' || managerConfig.backgroundSource === 'custom_image') {
      applyManagerBackgroundFromConfig(managerConfig);
    }
    return;
  }

  if (managerConfig.backgroundSource === 'selection') {
    applyHeroSelection(get(heroSelection), stores, {
      respectUserOverride: true,
      config: CONFIG,
      applyBackground: true,
      clearVideoForPosterOnly: false
    });
  } else {
    applyManagerBackgroundFromConfig(managerConfig);
  }
}

function applyHeroIntelligence(force = false) {
  if (typeof window === 'undefined') return;
  if (!force && hasUserHeroOverride(CONFIG)) return;

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
    fallbackTitle: 'Neon Vengeance',
    fallbackSubtitle: 'The code was his legacy. The betrayal was his rebirth.'
  }));

  buildHeroCommandBrief(
    get(heroSelection)?.seriesId || 'series-neon-vengeance',
    feedSnapshot
  );

  applyHeroBackgroundFromIntelligence();

  startHeroRotation(feedSnapshot, (selection) => {
    heroSelection.set(selection);
    if (hasUserHeroOverride(CONFIG)) return;
    const activeManagerConfig = loadHeroManagerConfig();
    if (activeManagerConfig.backgroundSource === 'selection') {
      applyHeroSelection(selection, getHeroBackgroundStores(), {
        respectUserOverride: true,
        config: CONFIG,
        applyBackground: true,
        clearVideoForPosterOnly: false
      });
    } else {
      applyManagerBackgroundFromConfig(activeManagerConfig);
    }
  });
  heroIntelligenceApplied = true;
}

function handleGhostHoverEnter() { ghostHoverActive.set(true); }
function handleGhostHoverLeave() { ghostHoverActive.set(false); }

function toggleControlCenter() {
  controlCenterOpen.update(v => !v);
  if (get(controlCenterOpen)) {
    recordStudioUsage({ source: 'control-center' });
    if (get(adminMode)) {
      studioRefs.experience?.loadStudioHierarchy();
      studioRefs.experience?.loadWatchContinue();
    }
  }
  if (!get(controlCenterOpen)) unlockBodyScroll();
}
function logout() {
  adminMode.set(false); controlCenterOpen.set(false);
  localStorage.removeItem('reelforge_admin_session_token');
  uploadStatus.set('🔐 Admin logged out');
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
findReelInFeed,
watchSessionStart,
getPersonalVideos: () => get(personalVideos),
resolveTheaterPlayback,
logTheaterHandshake,
isVideoReel,
reupload: {
deleteProduction: (id) => UIAgent.deleteProduction(id),
openControlCenter: () => controlCenterOpen.set(true),
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
uploadStatus.set(`🔄 ${e.detail?.message || 'Backend reconnecting...'}`);
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
controlCenterOpen.set(true);
}
};
resourceManager.addEventListener(window, 'reelforge:backend-reconnecting', onBackendReconnecting);
resourceManager.addEventListener(window, 'reelforge:workflow-navigate', handleWorkflowNavigate);
resourceManager.addEventListener(window, 'reelforge:search-open-reel', onSearchOpenReel);
resourceManager.addEventListener(window, 'reelforge:search-navigate', onSearchNavigate);
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
console.info('[HERO_LOAD]', {
stage: 'viewer:onMount:hero-storage-keys',
videoKey: CONFIG.HERO_VIDEO_STORAGE_KEY,
imageKey: CONFIG.HERO_IMAGE_STORAGE_KEY,
hasVideo: Boolean(savedHeroVideoRaw),
hasImage: Boolean(savedHeroImage),
ts: new Date().toISOString()
});
if (savedHeroVideo?.startsWith('blob:')) {
clearHeroVideoStorage();
savedHeroVideo = null;
heroDebugLog('Viewer.svelte:onMount:hydrate', 'dropped expired blob hero video from storage', {}, 'B');
}
heroDebugLog('Viewer.svelte:onMount:hydrate', 'loaded hero keys from localStorage', {
savedHeroVideoPreview: savedHeroVideo ? savedHeroVideo.slice(0, 120) : null,
savedHeroVideoLen: savedHeroVideo?.length || 0,
savedHeroImagePreview: savedHeroImage ? savedHeroImage.slice(0, 80) : null,
savedHeroImageLen: savedHeroImage?.length || 0,
storeVideoBefore: get(HERO_BACKGROUND_VIDEO)?.slice(0, 120) || '',
storeImageBefore: get(HERO_POSTER_IMAGE)?.slice(0, 80) || '',
imageHeroMode: isPersistedImageHero(savedHeroImage)
}, 'B');

const hydrateResult = await hydrateHeroBackgroundStores(getHeroBackgroundStores(), {
  ...CONFIG,
  resolveVideoUrl: normalizeVideoUrl
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
const unsubscribeHeroVideo = HERO_BACKGROUND_VIDEO.subscribe(v => {
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
const filteredStoredVideos = filterNonHeroAssets(storedVideos);
personalVideos.set(filteredStoredVideos.map((video) => {
const normalized = {
...video,
url: video.url ? toRelativeMediaPath(video.url) : '',
thumbnail: resolveUserPosterUrl(video.thumbnail) || ''
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

const unsubscribeVault = personalVideos.subscribe(vault => {
persistPersonalVault(vault);
});

reloadVaultStoresFromStorage();
const thumbCount = get(personalThumbnailCollection).length;
if (thumbCount > 0) {
console.log(`[onMount] Loaded ${thumbCount} thumbnails from [${hadLocalCache ? 'localStorage' : 'backend'}]`);
if (!isStorageFull()) {
resourceManager.setTimeout(() => AI_CLEANUP_AGENT.syncThumbnailsToFeed(), 100);
}
} else {
console.log('[onMount] Loaded 0 thumbnails from [none]');
}

await syncFromVault(true);
if (hasUserHeroOverride(CONFIG)) {
applyManagerBackgroundFromConfig(loadHeroManagerConfig());
}
runEpisodeBridgeSync('post-sync');
applyHeroIntelligence(true);
const onHeroIntelRefresh = () => applyHeroIntelligence(false);
const onHeroManagerUpdated = (event) => handleHeroManagerUpdated(event);
window.addEventListener('reelforge:metrics-updated', onHeroIntelRefresh);
window.addEventListener('reelforge:release-schedule-updated', onHeroIntelRefresh);
window.addEventListener('reelforge:hero-manager-updated', onHeroManagerUpdated);
AI_CLEANUP_AGENT.init();
if (!isStorageFull()) {
resourceManager.setTimeout(() => AI_CLEANUP_AGENT.syncVideoVaultToFeed(), 200);
}

const closeWs = connectReelEventSocket({
onCreated: (reel) => {
if (!reel?.id) return;
const reelId = String(reel.id);
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
purgeMediaFromClientState(
{ feed, personalVideos, activeReel, actions: {
closeTheater: () => theaterManager.close(),
persistFeed: (f) => storageSet(CONFIG.FEED_STORAGE_KEY, f),
persistVault: (v) => storageSet(CONFIG.VAULT_KEY, v)
}},
{ reelId: id }
);
}
});

resourceManager.setTimeout(() => { if (get(loading)) { console.warn('Safety timeout: forcing loading.set(false) after 5 seconds'); loading.set(false); } }, 5000);
return () => {
closeWs();
window.removeEventListener('reelforge:metrics-updated', onHeroIntelRefresh);
window.removeEventListener('reelforge:release-schedule-updated', onHeroIntelRefresh);
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
