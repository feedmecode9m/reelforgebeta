<script>
import { onMount, onDestroy } from 'svelte';
import { activeReel } from './components/theater/TheaterExperience.svelte';
import { resolveDisplayUrl } from './components/media/resolveDisplayUrl.js';
import { logFinalMediaUrl } from './lib/config.js';
import { logTheaterState } from './lib/theater/theaterDiagnostics.js';
import { createViewerContext } from './viewer/viewerContext.js';
import './viewer/viewer.css';
import ObservabilityBridge from './components/viewer/ObservabilityBridge.svelte';
import NotificationBridge from './components/viewer/NotificationBridge.svelte';
import HeroExperienceBridge from './components/viewer/HeroExperienceBridge.svelte';
import FeedExperienceBridge from './components/viewer/FeedExperienceBridge.svelte';
import TheaterExperienceBridge from './components/viewer/TheaterExperienceBridge.svelte';
import StudioLauncher from './components/viewer/StudioLauncher.svelte';
import GlobalOperationStatus from './components/viewer/GlobalOperationStatus.svelte';
import BackendHealthBanner from './components/viewer/BackendHealthBanner.svelte';
import FeaturedCollectionPanel from './components/discovery/FeaturedCollectionPanel.svelte';

const ctx = createViewerContext();

const {
  feed,
  controlCenterOpen,
  deleteConfirmReel,
  ghostHoverActive,
  HERO_BACKGROUND_VIDEO,
  HERO_POSTER_IMAGE,
  heroVideoFailed,
  heroVideoLoaded,
  heroRestoring,
  heroResumeToast,
  heroPendingFile,
  heroIsDragOver,
  heroPreviewUrl,
  personalVideos,
  uploadStatus,
  resourceManager,
  CONFIG,
  syncFromVault,
  persistPersonalVault,
  viewerHydrationReady,
  loading,
  normalizedFeed,
  totalReelsCount,
  personalThumbnailCollection,
  adminMode,
  feedCardVideoFallbacks,
  feedCardImageFallbacks,
  UIAgent,
  categoryNames,
  hasPlayableVideo,
  getImg,
  AI_CLEANUP_AGENT,
  handleCardClick,
  handleCardVideoError,
  vaultUtils,
  AI_IMAGE_GENERATOR,
  BLACK_STORIES_MATCHER,
  studioRefs,
  categoryCounts,
  storageHealth,
  aiMaintenanceMode,
  isCleaning,
  lastAiCleanup,
  studioSeriesMetadataReelId,
  studioHierarchyEnabled,
  studioHierarchyLoading,
  studioHierarchyError,
  studioProjectTree,
  studioCatalogProjectId,
  studioFormSeriesTitle,
  studioFormSeasonNumber,
  studioFormEpisodeTitle,
  studioFormEpisodeNumber,
  studioSelectedSeriesId,
  studioSelectedSeasonId,
  studioAttachEpisodeId,
  studioAttachReelId,
  watchContinueEnabled,
  watchContinueItems,
  watchContinueLoading,
  personalThumbnailIndex,
  pendingThumbnail,
  thumbnailDragActive,
  videoDragActive,
  personalStudioMode,
  usePersonalThumbnails,
  personalVideoCollection,
  newTitle,
  newCategory,
  selectedFile,
  videoSource,
  dragActive,
  isAutoDetecting,
  detectedCategory,
  isDeleting,
  storageSet,
  clearApplicationCache,
  resetAllLocalData,
  getFallbackImage,
  startStudioWalkthrough,
  toggleControlCenter,
  logout,
  handleEpisodeAssetChanged,
  handleGhostHoverEnter,
  handleGhostHoverLeave,
  getAllFeedReels,
  mountViewer,
  destroyViewer,
  lockBodyScroll,
  unlockBodyScroll,
  heroSelection
} = ctx;

let cleanupMount = () => {};
onMount(async () => {
  cleanupMount = await mountViewer() || (() => {});
});
onDestroy(() => {
  cleanupMount();
  destroyViewer();
});

$: modalOpen = $controlCenterOpen || $activeReel || $deleteConfirmReel;

let _theaterDebugLastActiveReelId = /** @type {string | null} */ (null);
$: if (typeof window !== 'undefined') {
  const nextId = $activeReel?.id ?? null;
  if (nextId !== _theaterDebugLastActiveReelId) {
    logTheaterState({
      from: _theaterDebugLastActiveReelId,
      to: nextId,
      visible: Boolean($activeReel),
      reelTitle: $activeReel?.title ?? $activeReel?.name ?? null,
      modalOpen: Boolean($controlCenterOpen || $activeReel || $deleteConfirmReel)
    });
    _theaterDebugLastActiveReelId = nextId;
  }
}

$: if ($HERO_BACKGROUND_VIDEO && !$heroVideoFailed && !$HERO_BACKGROUND_VIDEO.startsWith('blob:')) {
  logFinalMediaUrl('hero-video', resolveDisplayUrl($HERO_BACKGROUND_VIDEO, 'video', 'hero-video'));
}
$: if ($HERO_POSTER_IMAGE && !$HERO_POSTER_IMAGE.startsWith('data:')) {
  logFinalMediaUrl('hero-poster', resolveDisplayUrl($HERO_POSTER_IMAGE, 'poster', 'hero-poster'));
}
$: if (typeof document !== 'undefined') {
  if (modalOpen) lockBodyScroll();
  else unlockBodyScroll();
}

$: studioFeedReels = ($feed, getAllFeedReels());
$: studioSeriesMetadataReelOptions = Object.values($feed)
  .flat()
  .filter((r) => r && !r.isPlaceholder)
  .sort((a, b) => new Date(b.created_at || b.createdAt || 0).getTime() - new Date(a.created_at || a.createdAt || 0).getTime())
  .slice(0, 12);
$: studioSeriesMetadataReelLabel = (() => {
  const reel = studioSeriesMetadataReelOptions.find((r) => r.id === $studioSeriesMetadataReelId);
  return reel?.title || reel?.name || $studioSeriesMetadataReelId || '';
})();
</script>

<ObservabilityBridge />
<BackendHealthBanner />
<GlobalOperationStatus {uploadStatus} />

<main class:blur={$activeReel || $controlCenterOpen}>
  <header>
    <h1>REELFORGE</h1>
  </header>
  <HeroExperienceBridge
    {HERO_BACKGROUND_VIDEO}
    {HERO_POSTER_IMAGE}
    heroSelection={$heroSelection}
    feedReels={studioFeedReels}
    {heroVideoLoaded}
    {heroVideoFailed}
    {heroRestoring}
    {heroResumeToast}
    {heroPendingFile}
    {heroIsDragOver}
    {heroPreviewUrl}
    {personalVideos}
    {uploadStatus}
    {resourceManager}
    {CONFIG}
    {syncFromVault}
    {persistPersonalVault}
    {viewerHydrationReady}
    sanitizeViewer={true}
  />
  <FeaturedCollectionPanel />
  <NotificationBridge />
  <FeedExperienceBridge
    {loading}
    {feed}
    {normalizedFeed}
    {totalReelsCount}
    {personalThumbnailCollection}
    {personalVideos}
    {adminMode}
    {feedCardVideoFallbacks}
    {feedCardImageFallbacks}
    {UIAgent}
    {categoryNames}
    {hasPlayableVideo}
    {getImg}
    {AI_CLEANUP_AGENT}
    {handleCardClick}
    {handleCardVideoError}
    logVaultImageError={vaultUtils?.logVaultImageError}
  />
  <footer><p>© 2026 REELFORGE PRODUCTION CORP. // ALL RIGHTS ENFORCED</p></footer>
</main>

<TheaterExperienceBridge
  {personalVideos}
  {UIAgent}
  {AI_IMAGE_GENERATOR}
  logVaultImageError={vaultUtils?.logVaultImageError}
/>

<svelte:window on:keydown={(e) => { if (e.key === 'Escape') { if ($deleteConfirmReel) UIAgent.cancelDelete(); if ($controlCenterOpen) toggleControlCenter(); } }} />

<StudioLauncher
  {studioRefs}
  {controlCenterOpen}
  {adminMode}
  {uploadStatus}
  {newTitle}
  {newCategory}
  {selectedFile}
  {videoSource}
  {dragActive}
  {isAutoDetecting}
  {detectedCategory}
  {feed}
  {categoryCounts}
  {storageHealth}
  {aiMaintenanceMode}
  {isCleaning}
  {lastAiCleanup}
  {studioSeriesMetadataReelId}
  {studioHierarchyEnabled}
  {studioHierarchyLoading}
  {studioHierarchyError}
  {studioProjectTree}
  {studioCatalogProjectId}
  {studioFormSeriesTitle}
  {studioFormSeasonNumber}
  {studioFormEpisodeTitle}
  {studioFormEpisodeNumber}
  {studioSelectedSeriesId}
  {studioSelectedSeasonId}
  {studioAttachEpisodeId}
  {studioAttachReelId}
  {watchContinueEnabled}
  {watchContinueItems}
  {watchContinueLoading}
  {personalThumbnailCollection}
  {personalVideos}
  {personalThumbnailIndex}
  {pendingThumbnail}
  {thumbnailDragActive}
  {videoDragActive}
  {personalStudioMode}
  {usePersonalThumbnails}
  {personalVideoCollection}
  {HERO_BACKGROUND_VIDEO}
  {HERO_POSTER_IMAGE}
  {heroVideoLoaded}
  {heroVideoFailed}
  {heroRestoring}
  {heroResumeToast}
  {heroPendingFile}
  {heroIsDragOver}
  {heroPreviewUrl}
  {CONFIG}
  {resourceManager}
  {UIAgent}
  {AI_CLEANUP_AGENT}
  CATEGORY_DETECTOR={ctx.CATEGORY_DETECTOR}
  {categoryNames}
  matchToContent={BLACK_STORIES_MATCHER.matchToContent.bind(BLACK_STORIES_MATCHER)}
  {vaultUtils}
  {syncFromVault}
  {persistPersonalVault}
  {viewerHydrationReady}
  {storageSet}
  {clearApplicationCache}
  {resetAllLocalData}
  {getFallbackImage}
  {startStudioWalkthrough}
  {toggleControlCenter}
  {logout}
  {handleEpisodeAssetChanged}
  {studioFeedReels}
  {studioSeriesMetadataReelOptions}
  {studioSeriesMetadataReelLabel}
  {ghostHoverActive}
  {deleteConfirmReel}
  {isDeleting}
  {handleGhostHoverEnter}
  {handleGhostHoverLeave}
/>
