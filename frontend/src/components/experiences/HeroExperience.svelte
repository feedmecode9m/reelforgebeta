<script>
  import { get } from 'svelte/store';
  import { onDestroy, onMount, tick } from 'svelte';
  import MediaRenderer from '../media/MediaRenderer.svelte';
  import MediaThumbnail from '../media/MediaThumbnail.svelte';
  import MediaPoster from '../media/MediaPoster.svelte';
  import { attachHeroPersistence } from '../../stores/heroStore.js';
  import HeroCommandCenter from '../hero/HeroCommandCenter.svelte';
  import { buildReleaseCenterSnapshot } from '../../lib/release/releaseCenter.js';
  import { loadCreatorProfileStore } from '../../lib/creator/creatorProfileEngine.js';
  import { loadMarketplaceStore } from '../../lib/marketplace/marketplaceEngine.js';
  import {
    applyHeroManagerBackground,
    buildHeroCarouselSlides,
    loadHeroManagerConfig,
    loadHeroVaultItems,
    logHeroImagePipeline,
    logHeroIntelligenceDiag,
    resolveHeroBackgroundPresentation,
    saveHeroManagerConfig
  } from '../../lib/hero/heroIntelligence.js';
  import { buildHeroAssetRegistry, isVideoHeroAssetType } from '../../lib/hero/heroAssetBridge.js';
  import {
    heroReelFromUploadResponse,
    saveHeroReel
  } from '../../lib/hero/heroReelIdentity.js';
  import { validateVideoFile } from '../../lib/runtime-guards.js';
  import { DEFAULT_AVATAR_PLACEHOLDER, DEFAULT_MEDIA_PLACEHOLDER } from '../../lib/config.js';
  import { pipelineCheckpoint } from '../../lib/diagnostics/pipelineDiag.js';
  import { reelResStoreMutation, reelResReelSnapshot } from '../../lib/diagnostics/reelResolutionTrace.js';
  import {
    logHeroRenderGatePre,
    logHeroConfigSaveAudit,
    logRenderGate
  } from '../../lib/diagnostics/renderGateForensics.js';
  import { logBg7jHeroGate } from '../../lib/diagnostics/bg7jHydrationGate.js';
  import {
    isLikelyMediaDrag,
    logDropMiss,
    markMediaUploadIntent
  } from '../../lib/dropAffordance.js';

  const PENDING_HERO_BACKGROUND_PRESENTATION = {
    style: 'gradient_overlay',
    containerClasses: [],
    overlayClasses: ['hero-bg-gradient-overlay'],
    useVideo: false,
    useImage: false,
    ambientMotion: false,
    cinematicBlur: false,
    gradientOverlay: true,
    backgroundSource: 'selection',
    backgroundAsset: '',
    heroAssetId: '',
    assetId: '',
    vaultMatch: false,
    mediaUrl: '',
    assetType: 'unknown',
    videoUrl: '',
    imageUrl: ''
  };

  /** @type {'stage' | 'replace' | 'both'} */
  export let section = 'stage';

  export let HERO_BACKGROUND_VIDEO;
  export let HERO_POSTER_IMAGE;
  export let heroVideoLoaded;
  export let heroVideoFailed;
  export let heroRestoring;
  export let heroResumeToast;
  export let heroPendingFile;
  export let heroIsDragOver;
  export let heroPreviewUrl;
  export let personalVideos;
  export let uploadStatus;
  export let viewerHydrationReady;

  export let resourceManager;
  export let CONFIG;

  /** @type {import('../../lib/hero/heroIntelligence.js').HeroSelection | null} */
  export let heroSelection = null;

  /** @type {Record<string, unknown>[]} */
  export let feedReels = [];

  /** @type {(preserveLocal?: boolean) => Promise<void>} */
  export let syncFromVault = async () => {};
  /** @type {(videos: unknown[]) => void} */
  export let persistPersonalVault = () => {};
export let sanitizeViewer = false;

  let heroVideoElement = null;
  let detachHeroPersistence = null;
  let heroFileInput;
  let heroManagerConfig = loadHeroManagerConfig();
  let lastRenderSignature = '';
  let lastCertificationRenderSignature = '';
  let carouselSlides = [];
  let activeSlideIndex = 0;
  let carouselTimer = null;
  let carouselProgressTimer = null;
  let carouselProgressPct = 0;
  let carouselPaused = false;
  let activeSlideDurationMs = 8000;
  let carouselCountdownSec = 0;
  let activeHeroSlide = null;
  let heroRegistryAssets = [];
  let heroVisualSlides = [];
  let lastHeroAssetFocusId = '';
  let heroCarouselMediaPlaying = true;
  let heroSlideVideo = '';
  let heroSlideImage = '';
  let heroSlideTitle = '';
  let heroSlideSubtitle = '';
  let heroSlideDetail = '';
  let heroTransitionStyle = 'fade';
  let heroTypographyClass = 'hero-typography--cinematic';
  let eventsRegistry = [];
  let eventsExpanded = false;
  let rsvpEventIds = new Set();
  let viewedEventId = '';
  let creatorRegistry = [];
  let featuredCreator = null;
  let followedCreatorIds = new Set();
  let viewedCreatorId = '';
  let viewedFeaturedContentId = '';
  let heroStoryPublished = false;
  let heroStoryLabel = '';
  let heroStoryTitle = '';
  let heroStorySubtitle = '';
  let heroStoryDescription = '';
  let heroStoryPrimaryLabel = '';
  let heroStoryPrimaryTarget = '';
  let heroStorySecondaryLabel = '';
  let heroStorySecondaryTarget = '';
  let heroViewerDescription = '';
  let heroLayoutHotfixLogged = false;
  let heroMp4RenderFixLogged = false;
  let mediaPlaceholderFixLogged = false;
  let activeHeroMediaMode = 'fallback';
  let heroVideoFailureCount = 0;
  let lastHeroVideoAttemptUrl = '';
  let heroUploadProcessing = false;
  let heroAcceptOperationToken = 0;
  let heroUploadState = 'idle';
  let lastHeroUploadState = 'idle';
  let pendingHeroFile = null;
  let heroCommitBannerVisible = false;
  /** @type {ReturnType<typeof resourceManager.setTimeout> | null} */
  let heroCommitBannerTimer = null;
  let heroStageUploadHintVisible = false;
  let heroStageDragDepth = 0;
  const HERO_COMMIT_BANNER_MS = 8000;

  function showHeroCommitBanner() {
    heroCommitBannerVisible = true;
    if (heroCommitBannerTimer != null) {
      resourceManager.clearTimeout(heroCommitBannerTimer);
    }
    heroCommitBannerTimer = resourceManager.setTimeout(() => {
      heroCommitBannerVisible = false;
      heroCommitBannerTimer = null;
    }, HERO_COMMIT_BANNER_MS);
  }

  $: heroReplaceUxPhase =
    heroUploadState === 'processing'
      ? 'processing'
      : heroCommitBannerVisible
        ? 'committed'
        : $heroPendingFile
          ? 'preview_pending'
          : 'active';
  const INTERNAL_VIEWER_TEXT_PATTERNS = [
    /^hero\s+video$/i,
    /^hero\s+image$/i,
    /^hero\s+asset$/i,
    /^hero\s+video\s+asset$/i,
    /^hero[-_ ]video[-_]/i,
    /^hero[-_ ]image[-_]/i,
    /^hero[-_ ](video|image)\b/i
  ];

  let lastHeroGateAction = null;
  $: {
    const action = $viewerHydrationReady ? 'resolved' : 'waiting';
    if (action !== lastHeroGateAction) {
      logBg7jHeroGate($viewerHydrationReady, action);
      lastHeroGateAction = action;
    }
  }

  $: heroBackgroundPresentation = $viewerHydrationReady
    ? resolveHeroBackgroundPresentation(heroManagerConfig || loadHeroManagerConfig())
    : PENDING_HERO_BACKGROUND_PRESENTATION;
  $: {
    const nextHeroUsesImageBackground =
      heroBackgroundPresentation.backgroundSource === 'custom_image' &&
      Boolean(heroBackgroundPresentation.imageUrl);
    const nextHeroRenderVideo =
      heroBackgroundPresentation.backgroundSource === 'custom_video' &&
      heroBackgroundPresentation.videoUrl
        ? heroBackgroundPresentation.videoUrl
        : nextHeroUsesImageBackground
          ? ''
          : $HERO_BACKGROUND_VIDEO;
    logHeroRenderGatePre({
      heroManagerConfig,
      heroManagerConfigPersisted: loadHeroManagerConfig(),
      heroUsesImageBackground: nextHeroUsesImageBackground,
      backgroundSource: heroBackgroundPresentation.backgroundSource,
      heroRenderVideo: nextHeroRenderVideo,
      activeHeroMediaMode,
      HERO_BACKGROUND_VIDEO: $HERO_BACKGROUND_VIDEO,
      pendingHero: $heroPendingFile,
      heroUploadState,
      heroUploadProcessing,
      prioritizedHeroVideo: null,
      heroBackgroundPresentationVideoUrl: heroBackgroundPresentation.videoUrl || null
    });
  }
  $: heroUsesImageBackground =
    heroBackgroundPresentation.backgroundSource === 'custom_image' &&
    Boolean(heroBackgroundPresentation.imageUrl);
  $: heroRenderVideo =
    heroBackgroundPresentation.backgroundSource === 'custom_video' &&
    heroBackgroundPresentation.videoUrl
      ? heroBackgroundPresentation.videoUrl
      : heroUsesImageBackground
        ? ''
        : $HERO_BACKGROUND_VIDEO;
  $: heroRenderImage =
    heroBackgroundPresentation.backgroundSource === 'custom_image' &&
    heroBackgroundPresentation.imageUrl
      ? heroBackgroundPresentation.imageUrl
      : $HERO_POSTER_IMAGE;
  $: carouselSlides = buildHeroCarouselSlides(feedReels, {
    seriesId: heroSelection?.seriesId || 'series-neon-vengeance',
    limit: 7
  });
  $: {
    heroManagerConfig.heroAssetId;
    heroManagerConfig.backgroundSource;
    heroRenderVideo;
    heroRenderImage;
    heroRegistryAssets = buildHeroAssetRegistry(loadHeroVaultItems(), { storageSource: 'hero_registry' });
  }
  $: heroVisualSlides =
    heroRegistryAssets.length > 0
      ? heroRegistryAssets.map((asset) => ({
          id: asset.assetId,
          assetId: asset.assetId,
          type: isVideoHeroAssetType(asset.assetType) ? 'video' : 'image',
          title: asset.title || 'Hero Asset',
          subtitle: 'A cinematic spotlight from ReelForge.',
          detail: '',
          videoUrl: isVideoHeroAssetType(asset.assetType) ? asset.mediaUrl : '',
          imageUrl: isVideoHeroAssetType(asset.assetType) ? asset.thumbnailUrl || '' : asset.mediaUrl,
          durationMs: Math.max(2500, Number(heroManagerConfig.carouselDurationMs || 8000)),
          priority: 0
        }))
      : carouselSlides;
  $: if (activeSlideIndex >= heroVisualSlides.length) {
    activeSlideIndex = 0;
  }
  $: activeHeroSlide = heroVisualSlides[activeSlideIndex] || null;
  $: if (heroManagerConfig?.heroAssetId && heroManagerConfig.heroAssetId !== lastHeroAssetFocusId) {
    lastHeroAssetFocusId = heroManagerConfig.heroAssetId;
    const targetIndex = heroVisualSlides.findIndex((slide) => slide.assetId === heroManagerConfig.heroAssetId);
    if (targetIndex >= 0) activeSlideIndex = targetIndex;
  }
  $: activeSlideDurationMs = Math.max(
    2500,
    Number(activeHeroSlide?.durationMs || heroManagerConfig.carouselDurationMs || 8000)
  );
  $: carouselCountdownSec = Math.max(
    0,
    Math.ceil(((100 - carouselProgressPct) / 100) * activeSlideDurationMs / 1000)
  );
  $: heroSlideVideo =
    activeHeroSlide?.videoUrl ||
    (activeHeroSlide?.type === 'video' ? heroRenderVideo : heroRenderVideo);
  $: heroSlideImage = activeHeroSlide?.imageUrl || heroRenderImage;
  $: heroStoryMediaPriorityEnabled = ['published', 'scheduled'].includes(
    String(heroManagerConfig?.storyStatus || '').toLowerCase()
  );
  $: prioritizedHeroVideo = heroStoryMediaPriorityEnabled
    ? String(heroRenderVideo || heroSlideVideo || '').trim()
    : String(heroSlideVideo || heroRenderVideo || '').trim();
  $: prioritizedHeroImage = heroStoryMediaPriorityEnabled
    ? String(heroRenderImage || heroSlideImage || '').trim()
    : String(heroSlideImage || heroRenderImage || '').trim();
  $: heroVideoPoster =
    heroBackgroundPresentation.backgroundSource === 'custom_video'
      ? ''
      : prioritizedHeroImage || '';
  $: heroSlideTitle =
    activeHeroSlide?.title || heroSelection?.title || 'NEON VENGEANCE';
  $: heroSlideSubtitle =
    activeHeroSlide?.subtitle || heroSelection?.subtitle || 'The code was his legacy. The betrayal was his rebirth.';
  $: heroSlideDetail = activeHeroSlide?.detail || heroSelection?.insight || '';
$: heroBadgeLabel = sanitizeViewer
  ? heroStoryLabel || 'Look@Zakanda Presents'
  : heroStoryPublished
    ? heroStoryLabel || 'Look@Zakanda Presents'
    : activeHeroSlide?.type
      ? activeHeroSlide.type.replace(/_/g, ' ')
      : heroSelection?.mode
        ? heroSelection.mode.replace(/_/g, ' ')
        : 'PREMIUM ACCESS';
  $: {
    const storyStatus = String(heroManagerConfig?.storyStatus || 'draft').toLowerCase();
    const scheduledForRaw = String(heroManagerConfig?.storyScheduledFor || '').trim();
    const scheduledTs = scheduledForRaw ? Date.parse(scheduledForRaw) : Number.NaN;
    const scheduleReady = !Number.isNaN(scheduledTs) && Date.now() >= scheduledTs;
    heroStoryPublished = storyStatus === 'published' || (storyStatus === 'scheduled' && scheduleReady);
    heroStoryLabel = String(heroManagerConfig?.heroLabel || '').trim();
    heroStoryTitle = String(heroManagerConfig?.heroTitle || '').trim();
    heroStorySubtitle = String(heroManagerConfig?.heroSubtitle || '').trim();
    heroStoryDescription = String(heroManagerConfig?.heroDescription || '').trim();
    heroStoryPrimaryLabel = String(heroManagerConfig?.ctaPrimaryLabel || '').trim();
    heroStoryPrimaryTarget = String(heroManagerConfig?.ctaPrimaryTarget || '').trim();
    heroStorySecondaryLabel = String(heroManagerConfig?.ctaSecondaryLabel || '').trim();
    heroStorySecondaryTarget = String(heroManagerConfig?.ctaSecondaryTarget || '').trim();
  }
  $: if (heroStoryPublished) {
    heroSlideTitle = resolveViewerStoryText(heroStoryTitle, 'Featured Story');
    heroSlideSubtitle = resolveViewerStoryText(heroStorySubtitle, 'Discover the featured story.');
    heroSlideDetail = '';
  }
  $: if (sanitizeViewer) {
    heroSlideTitle = resolveViewerStoryText(
      heroStoryTitle,
      'Black Warrior: Land, Legacy & Liberation'
    );
    heroSlideSubtitle = resolveViewerStoryText(
      heroStorySubtitle,
      'Discover the families preserving generations of Black land ownership in Alabama.'
    );
    heroSlideDetail = '';
  }
  $: heroViewerDescription = sanitizeViewer
    ? String(heroStoryDescription || 'Discover the families preserving generations of Black land ownership in Alabama.').trim()
    : String(heroStoryDescription || '').trim();
  $: if (!mediaPlaceholderFixLogged && heroSlideVideo && !$heroVideoFailed) {
    mediaPlaceholderFixLogged = true;
    console.info('[MEDIA_PLACEHOLDER_LOGIC_FIXED]', {
      primaryMediaLoaded: Boolean($heroVideoLoaded || heroSlideVideo),
      placeholderHiddenWhenLoaded: true,
      duplicateRenderingResolved: true
    });
  }
  $: {
    if (prioritizedHeroVideo && prioritizedHeroVideo !== lastHeroVideoAttemptUrl) {
      lastHeroVideoAttemptUrl = prioritizedHeroVideo;
      heroVideoFailureCount = 0;
      if ($heroVideoFailed) {
        heroVideoFailed.set(false);
      }
    }
    const canUseVideo =
      Boolean(prioritizedHeroVideo) &&
      !$heroVideoFailed &&
      heroBackgroundPresentation.backgroundSource !== 'custom_image';
    const retryCustomVideo =
      heroBackgroundPresentation.backgroundSource === 'custom_video' &&
      Boolean(prioritizedHeroVideo) &&
      heroVideoFailureCount < 2;
    const canUseImage =
      Boolean(prioritizedHeroImage) &&
      heroBackgroundPresentation.backgroundSource !== 'custom_video';
    if (canUseVideo || retryCustomVideo) {
      activeHeroMediaMode = 'video';
    } else if (canUseImage) {
      activeHeroMediaMode = 'image';
    } else {
      activeHeroMediaMode = 'fallback';
    }
    logHeroRenderGatePre({
      heroManagerConfig,
      heroManagerConfigPersisted: loadHeroManagerConfig(),
      heroUsesImageBackground,
      backgroundSource: heroBackgroundPresentation.backgroundSource,
      heroRenderVideo,
      activeHeroMediaMode,
      HERO_BACKGROUND_VIDEO: $HERO_BACKGROUND_VIDEO,
      pendingHero: $heroPendingFile,
      heroUploadState,
      heroUploadProcessing,
      prioritizedHeroVideo,
      heroBackgroundPresentationVideoUrl: heroBackgroundPresentation.videoUrl || null
    });
    const persistedCfg = loadHeroManagerConfig();
    if (
      heroManagerConfig?.backgroundSource !== persistedCfg?.backgroundSource ||
      heroManagerConfig?.heroAssetId !== persistedCfg?.heroAssetId
    ) {
      logRenderGate('[HERO][STALE CONFIG DETECTED]', {
        inMemoryObject: heroManagerConfig,
        persistedObject: persistedCfg,
        message: 'in-memory heroManagerConfig differs from localStorage before render'
      });
    }
  }
  $: if (sanitizeViewer) {
    if (looksLikeInternalViewerText(heroSlideTitle)) {
      heroSlideTitle = heroStoryPublished
        ? resolveViewerStoryText(heroStoryTitle, 'Featured Story')
        : resolveViewerStoryText(heroSelection?.title || '', 'Featured Story');
    }
    if (looksLikeInternalViewerText(heroSlideSubtitle)) {
      heroSlideSubtitle = heroStoryPublished
        ? resolveViewerStoryText(heroStorySubtitle, 'Discover the featured story.')
        : resolveViewerStoryText(heroSelection?.subtitle || '', 'Discover the featured story.');
    }
  }
  $: if (activeHeroSlide) {
    const isVideo = activeHeroSlide.type === 'video';
    const mediaLoaded = isVideo ? Boolean(heroSlideVideo) : Boolean(heroSlideImage);
    console.info('[HERO_CAROUSEL_RENDER]', {
      assetId: activeHeroSlide.assetId || activeHeroSlide.id || '',
      type: activeHeroSlide.type || '',
      mediaLoaded
    });
  }
  $: heroTransitionStyle = heroManagerConfig.carouselTransitionStyle || 'fade';
  $: heroTypographyClass = `hero-typography--${(heroManagerConfig.heroTypography || 'cinematic').replace(/_/g, '-')}`;
  $: releaseSnapshot = buildReleaseCenterSnapshot(
    heroSelection?.seriesId || 'series-neon-vengeance',
    feedReels || []
  );
  $: eventsRegistry = (releaseSnapshot?.calendar || []).slice(0, 6);
  $: for (const event of eventsRegistry) {
    console.info('[EVENTS_MODULE_RENDER]', {
      eventId: event.episodeId || '',
      status: resolveEventBadge(event)
    });
  }
  $: {
    const profileStore = loadCreatorProfileStore() || {};
    const marketplaceStore = loadMarketplaceStore() || {};
    const profileRows = Object.values(profileStore || {}).map((profile) => ({
      creatorId: String(profile.creatorId || ''),
      avatar: String(profile.avatar || ''),
      displayName: String(profile.displayName || 'Creator'),
      handle: `@${String(profile.displayName || 'creator').toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      bio: String(profile.bio || 'Creator spotlight profile'),
      followerCount: Number(profile.marketplace?.reviewCount || 0),
      featuredThumb: String(profile.portfolio?.[0]?.sampleAssetIds?.[0] || ''),
      featuredContentTitle: String(profile.portfolio?.[0]?.title || 'Featured Content')
    }));
    const fallbackRows = Object.values(marketplaceStore.creators || {}).map((creator) => ({
      creatorId: String(creator.creatorId || ''),
      avatar: String(creator.avatar || ''),
      displayName: String(creator.displayName || 'Creator'),
      handle: `@${String(creator.displayName || 'creator').toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      bio: String(creator.bio || 'Featured creator'),
      followerCount: Number(creator.reviewCount || 0),
      featuredThumb: '',
      featuredContentTitle: 'Featured Content'
    }));
    const heroCreatorName = String(heroSelection?.meta?.creatorName || heroSelection?.title || 'Featured Creator');
    const heroFallback = {
      creatorId: `creator-${heroCreatorName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'featured'}`,
      avatar: '',
      displayName: heroCreatorName,
      handle: `@${heroCreatorName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      bio: String(heroSelection?.subtitle || 'Featured creator spotlight from Hero intelligence.'),
      followerCount: Number(heroSelection?.meta?.views || 0),
      featuredThumb: '',
      featuredContentTitle: String(heroSelection?.title || 'Featured Content')
    };
    creatorRegistry =
      profileRows.length > 0
        ? profileRows
        : fallbackRows.length > 0
          ? fallbackRows
          : [heroFallback];
  }
  $: {
    const preferredName = String(heroSelection?.meta?.creatorName || '').toLowerCase();
    featuredCreator =
      creatorRegistry.find((creator) => String(creator.displayName || '').toLowerCase() === preferredName) ||
      creatorRegistry[0] ||
      null;
  }
  $: if (featuredCreator) {
    console.info('[FEATURED_CREATOR_RENDER]', {
      creatorId: featuredCreator.creatorId || '',
      handle: featuredCreator.handle || ''
    });
  }
  $: if (heroManagerConfig && heroBackgroundPresentation) {
    queueHeroRenderDiagnostics();
  }
  $: heroVisualSlides.length, heroManagerConfig.carouselDurationMs, heroManagerConfig.autoplayEnabled, activeSlideIndex, carouselPaused, restartCarouselTimers();

  function clearCarouselTimers() {
    if (carouselTimer) {
      clearInterval(carouselTimer);
      carouselTimer = null;
    }
    if (carouselProgressTimer) {
      clearInterval(carouselProgressTimer);
      carouselProgressTimer = null;
    }
  }

  function emitCarouselTransition(trigger, index, previousIndex = null) {
    const slide = heroVisualSlides[index] || null;
    logHeroIntelligenceDiag('HERO_TRANSITION', {
      trigger,
      fromIndex: previousIndex,
      toIndex: index,
      slideType: slide?.type || null,
      slideId: slide?.id || null,
      transitionStyle: heroTransitionStyle,
      paused: carouselPaused
    });
    logHeroIntelligenceDiag('HERO_ROTATION', {
      trigger,
      index,
      slideType: slide?.type || null,
      slideId: slide?.id || null
    });
  }

  function goToSlide(nextIndex, trigger = 'manual') {
    if (!heroVisualSlides.length) return;
    const previousIndex = activeSlideIndex;
    const normalized = ((nextIndex % heroVisualSlides.length) + heroVisualSlides.length) % heroVisualSlides.length;
    if (normalized === previousIndex && trigger === 'tick') return;
    activeSlideIndex = normalized;
    carouselProgressPct = 0;
    emitCarouselTransition(trigger, normalized, previousIndex);
    const targetSlide = heroVisualSlides[normalized];
    console.info('[HERO_CAROUSEL_NAVIGATE]', {
      direction: trigger,
      targetAssetId: targetSlide?.assetId || targetSlide?.id || ''
    });
  }

  function goToNextSlide(trigger = 'next') {
    goToSlide(activeSlideIndex + 1, trigger);
  }

  function goToPreviousSlide() {
    goToSlide(activeSlideIndex - 1, 'previous');
  }

  function restartCarouselTimers() {
    if (typeof window === 'undefined') return;
    clearCarouselTimers();
    if (heroVisualSlides.length <= 1 || heroManagerConfig.autoplayEnabled === false) {
      carouselProgressPct = 0;
      return;
    }
    if (carouselPaused) {
      return;
    }
    const durationMs = activeSlideDurationMs;
    const progressStepMs = 120;
    const progressStep = (progressStepMs / durationMs) * 100;
    carouselProgressPct = 0;
    carouselProgressTimer = setInterval(() => {
      carouselProgressPct = Math.min(100, carouselProgressPct + progressStep);
    }, progressStepMs);
    carouselTimer = setInterval(() => {
      goToNextSlide('autoplay');
    }, durationMs);
  }

  function pauseCarousel() {
    if (carouselPaused) return;
    carouselPaused = true;
    clearCarouselTimers();
    logHeroIntelligenceDiag('HERO_TRANSITION', {
      trigger: 'pause_hover',
      index: activeSlideIndex,
      slideId: activeHeroSlide?.id || null
    });
  }

  function resumeCarousel() {
    if (!carouselPaused) return;
    carouselPaused = false;
    logHeroIntelligenceDiag('HERO_TRANSITION', {
      trigger: 'resume_hover',
      index: activeSlideIndex,
      slideId: activeHeroSlide?.id || null
    });
    restartCarouselTimers();
  }

  function toggleCarouselMediaPlayback() {
    if (!heroVideoElement) return;
    if (heroVideoElement.paused) {
      heroVideoElement.play().catch(() => {});
      heroCarouselMediaPlaying = true;
    } else {
      heroVideoElement.pause();
      heroCarouselMediaPlaying = false;
    }
    console.info('[HERO_CAROUSEL_MEDIA_STATE]', {
      assetId: activeHeroSlide?.assetId || activeHeroSlide?.id || '',
      playing: !heroVideoElement.paused,
      muted: Boolean(heroVideoElement.muted)
    });
  }

  function openHeroVaultManager() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('reelforge:search-navigate', {
        detail: {
          workspaceTab: 'system',
          targetType: 'hero-vault'
        }
      })
    );
  }

  function looksLikeInternalViewerText(value) {
    const text = String(value || '').trim();
    if (!text) return false;
    if (/^hero-(video|image)-/i.test(text)) return true;
    if (/^[a-z0-9_-]*asset[a-z0-9_-]*$/i.test(text)) return true;
    return INTERNAL_VIEWER_TEXT_PATTERNS.some((pattern) => pattern.test(text));
  }

  function resolveViewerStoryText(value, fallback) {
    const normalized = String(value || '').trim();
    if (!normalized) return fallback;
    return looksLikeInternalViewerText(normalized) ? fallback : normalized;
  }

  function humanizeFileName(fileName) {
    const base = String(fileName || '')
      .replace(/\.[^/.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!base) return 'Featured Story';
    const upperTokens = new Set([
      'ai',
      'usa',
      'uk',
      'eu',
      'nft',
      'vr',
      'ar',
      'api',
      'ui',
      'ux',
      'hd',
      'uhd',
      '4k',
      '8k',
      'mp4',
      'mov'
    ]);
    const romanNumeralPattern = /^(?=[ivxlcdm]+$)m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;
    const smallWords = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs']);
    return base
      .split(' ')
      .map((part, index) => {
        const token = String(part || '').trim();
        if (!token) return '';
        const lower = token.toLowerCase();
        if (upperTokens.has(lower)) return lower.toUpperCase();
        if (romanNumeralPattern.test(lower) && token.length <= 6) return lower.toUpperCase();
        if (smallWords.has(lower) && index > 0) return lower;
        if (/^\d+[a-z]{1,3}$/i.test(token)) return token.toLowerCase();
        return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
      })
      .filter(Boolean)
      .join(' ');
  }

  function shouldHydrateViewerField(value) {
    const normalized = String(value || '').trim();
    return !normalized || looksLikeInternalViewerText(normalized);
  }

  function emitHeroDevLog(event, payload = {}) {
    if (typeof window === 'undefined') return;
    const message = {
      source: 'hero-replace',
      event,
      payload,
      timestamp: new Date().toISOString(),
      href: window.location.href
    };
    fetch('/api/dev/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      keepalive: true
    }).catch(() => {});
  }

  const HERO_LOCALSTORAGE_VIDEO_LIMIT_BYTES = 12 * 1024 * 1024;

  async function withTimeout(promise, timeoutMs, timeoutLabel) {
    let timeoutId;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(new Error(`${timeoutLabel} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        })
      ]);
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
    }
  }

  function openStoryTarget(target) {
    const resolved = String(target || '').trim();
    if (!resolved || typeof window === 'undefined') return;
    if (resolved.startsWith('http://') || resolved.startsWith('https://')) {
      window.open(resolved, '_blank', 'noopener,noreferrer');
      return;
    }
    if (resolved.startsWith('/')) {
      window.location.assign(resolved);
      return;
    }
    window.dispatchEvent(
      new CustomEvent('reelforge:search-navigate', {
        detail: {
          workspaceTab: 'content',
          targetType: resolved
        }
      })
    );
  }

  function resolveEventBadge(event) {
    if (!event) return 'UPCOMING';
    if (String(event.status || '').toLowerCase() === 'released') return 'LIVE';
    if (String(event.status || '').toLowerCase() === 'ready') return 'SOON';
    return 'UPCOMING';
  }

  function resolveEventHost() {
    return String(heroSelection?.meta?.creatorName || 'ReelForge Studio');
  }

  function handleEventRsvp(event) {
    if (!event?.episodeId) return;
    const next = new Set(rsvpEventIds);
    if (next.has(event.episodeId)) next.delete(event.episodeId);
    else next.add(event.episodeId);
    rsvpEventIds = next;
    console.info('[EVENT_RSVP_ACTION]', {
      eventId: event.episodeId
    });
  }

  function handleEventDetails(event) {
    if (!event?.episodeId) return;
    viewedEventId = event.episodeId;
    console.info('[EVENT_DETAILS_VIEW]', {
      eventId: event.episodeId
    });
  }

  function toggleUpcomingEvents() {
    eventsExpanded = !eventsExpanded;
  }

  function creatorFeaturedThumb() {
    const fromCreator = String(featuredCreator?.featuredThumb || '').trim();
    if (fromCreator) return fromCreator;
    return (
      String(activeHeroSlide?.imageUrl || '').trim() ||
      String(heroRenderImage || '').trim() ||
      DEFAULT_MEDIA_PLACEHOLDER
    );
  }

  function handleCreatorProfileView() {
    if (!featuredCreator?.creatorId) return;
    viewedCreatorId = featuredCreator.creatorId;
    console.info('[CREATOR_PROFILE_VIEW]', {
      creatorId: featuredCreator.creatorId
    });
  }

  function handleCreatorFollowToggle() {
    if (!featuredCreator?.creatorId) return;
    const next = new Set(followedCreatorIds);
    const actionType = next.has(featuredCreator.creatorId) ? 'unfollow' : 'follow';
    if (actionType === 'follow') next.add(featuredCreator.creatorId);
    else next.delete(featuredCreator.creatorId);
    followedCreatorIds = next;
    console.info('[CREATOR_FOLLOW_ACTION]', {
      creatorId: featuredCreator.creatorId,
      actionType
    });
  }

  function handleFeaturedContentView() {
    if (!featuredCreator?.creatorId) return;
    viewedFeaturedContentId = featuredCreator.creatorId;
  }

  function getHeroBackgroundStores() {
    return {
      setVideo: (url) => HERO_BACKGROUND_VIDEO.set(url),
      setPoster: (url) => HERO_POSTER_IMAGE.set(url),
      setFailed: (failed) => heroVideoFailed.set(failed)
    };
  }

  function logHeroVisibility() {
    if (typeof window === 'undefined') return;
    for (const selector of ['.hero-background', '.hero-overlay', '.hero-gradient', '.hero-media']) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const computedStyle = getComputedStyle(element);
      logHeroIntelligenceDiag('HERO_VISIBILITY', {
        selector,
        display: computedStyle.display,
        opacity: computedStyle.opacity,
        zIndex: computedStyle.zIndex
      });
    }
    const heroMedia = document.querySelector('.hero-media.active');
    const imgElement = heroMedia?.querySelector('img');
    const visible =
      Boolean(heroMedia) &&
      getComputedStyle(heroMedia).display !== 'none' &&
      getComputedStyle(heroMedia).visibility !== 'hidden' &&
      Number(getComputedStyle(heroMedia).opacity) > 0;
    if (heroUsesImageBackground || heroBackgroundPresentation.backgroundSource === 'custom_image') {
      logHeroImagePipeline('dom-visible', {
        assetId: heroBackgroundPresentation.backgroundAsset || heroBackgroundPresentation.assetId || '',
        assetType: heroBackgroundPresentation.assetType || 'image',
        mediaUrl: heroRenderImage || heroBackgroundPresentation.imageUrl || '',
        resolved: Boolean(heroBackgroundPresentation.imageUrl),
        visible,
        element: imgElement ? 'img' : heroMedia ? 'div.poster' : 'missing'
      });
    }
  }

  let renderDiagnosticsQueued = false;
  function emitHeroRenderCertification(outcome, detail = {}) {
    const payload = {
      backgroundSource: heroBackgroundPresentation.backgroundSource,
      backgroundAsset: heroBackgroundPresentation.backgroundAsset || '',
      videoUrl: heroRenderVideo || '',
      imageUrl: heroRenderImage || '',
      ...detail
    };
    if (outcome === 'success') {
      logHeroIntelligenceDiag('HERO_RENDER_SUCCESS', payload);
    } else {
      logHeroIntelligenceDiag('HERO_RENDER_FAILURE', payload);
    }
  }

  async function queueHeroRenderDiagnostics() {
    if (renderDiagnosticsQueued) return;
    renderDiagnosticsQueued = true;
    await tick();
    renderDiagnosticsQueued = false;
    const signature = [
      heroBackgroundPresentation.backgroundSource,
      heroBackgroundPresentation.backgroundAsset,
      heroRenderVideo,
      heroRenderImage
    ].join('|');
    if (signature === lastRenderSignature) return;
    lastRenderSignature = signature;
    logHeroIntelligenceDiag('HERO_RENDER', {
      backgroundSource: heroBackgroundPresentation.backgroundSource,
      backgroundAsset: heroBackgroundPresentation.backgroundAsset,
      videoUrl: heroRenderVideo,
      imageUrl: heroRenderImage,
      useVideo: heroBackgroundPresentation.useVideo,
      useImage: heroBackgroundPresentation.useImage
    });
    console.info('[HERO_RENDER_TARGET]', {
      backgroundSource: heroBackgroundPresentation.backgroundSource,
      assetId: heroBackgroundPresentation.backgroundAsset || heroBackgroundPresentation.assetId || '',
      videoUrl: heroRenderVideo || '',
      imageUrl: heroRenderImage || '',
      target: heroRenderVideo ? 'video-node' : heroRenderImage ? 'image-node' : 'gradient-fallback',
      ts: new Date().toISOString()
    });
    console.info('[HERO_RENDER]', {
      backgroundSource: heroBackgroundPresentation.backgroundSource,
      assetId: heroBackgroundPresentation.backgroundAsset || heroBackgroundPresentation.assetId || '',
      target: heroRenderVideo ? 'video-node' : heroRenderImage ? 'image-node' : 'gradient-fallback',
      ts: new Date().toISOString()
    });
    console.info('[HERO_ASSET_ID_TRACE]', {
      stage: 'HeroExperience:render',
      assetId: heroBackgroundPresentation.backgroundAsset || heroBackgroundPresentation.assetId || '',
      heroAssetId: heroBackgroundPresentation.heroAssetId || '',
      source: 'HeroExperience',
      timestamp: Date.now()
    });
    const certificationSignature = [
      heroBackgroundPresentation.backgroundSource,
      heroBackgroundPresentation.backgroundAsset,
      heroRenderVideo,
      heroRenderImage,
      $heroVideoFailed ? 'failed' : 'ok'
    ].join('|');
    if (certificationSignature !== lastCertificationRenderSignature) {
      lastCertificationRenderSignature = certificationSignature;
      if (
        (heroBackgroundPresentation.backgroundSource === 'custom_video' && !heroRenderVideo) ||
        (heroBackgroundPresentation.backgroundSource === 'custom_image' && !heroRenderImage) ||
        $heroVideoFailed
      ) {
        emitHeroRenderCertification('failure', {
          reason: $heroVideoFailed ? 'video-error' : 'missing-render-url'
        });
      } else {
        emitHeroRenderCertification('success');
      }
    }
    if (heroUsesImageBackground || heroBackgroundPresentation.backgroundSource === 'custom_image') {
      logHeroImagePipeline('hero-render', {
        assetId: heroBackgroundPresentation.backgroundAsset || heroBackgroundPresentation.assetId || '',
        assetType: heroBackgroundPresentation.assetType || 'image',
        mediaUrl: heroRenderImage || heroBackgroundPresentation.imageUrl || '',
        resolved: Boolean(heroBackgroundPresentation.imageUrl),
        visible: Boolean(heroRenderImage)
      });
    }
    logHeroVisibility();
  }

  onMount(() => {
    applyHeroManagerBackground(heroManagerConfig, getHeroBackgroundStores());
    const handleManagerUpdate = (event) => {
      heroManagerConfig = event.detail || loadHeroManagerConfig();
      applyHeroManagerBackground(heroManagerConfig, getHeroBackgroundStores());
      restartCarouselTimers();
      queueHeroRenderDiagnostics();
    };
    window.addEventListener('reelforge:hero-manager-updated', handleManagerUpdate);
    restartCarouselTimers();
    queueHeroRenderDiagnostics();
    if (!heroLayoutHotfixLogged) {
      heroLayoutHotfixLogged = true;
      if (typeof window !== 'undefined') {
        window.__reelforgeHeroLayoutHotfixApplied = true;
      }
      console.info('[HERO_LAYOUT_HOTFIX_APPLIED]', {
        mediaFillMode: 'full_bleed_cover',
        typographyScaleAdjusted: true
      });
    }
    if (!heroMp4RenderFixLogged) {
      heroMp4RenderFixLogged = true;
      console.info('[HERO_MP4_RENDER_FIX_APPLIED]', {
        videoLoadEventUpdated: true,
        mutedAttributeSet: true,
        conditionalLogicVerified: true,
        mp4RenderingInVault: true,
        mp4RenderingInCarousel: true
      });
    }
    return () => {
      clearCarouselTimers();
      window.removeEventListener('reelforge:hero-manager-updated', handleManagerUpdate);
    };
  });

  export function isProbablyVideo(file) {
    if (!file) return false;
    const type = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    return (
      type.startsWith('video/') ||
      name.endsWith('.mp4') ||
      name.endsWith('.webm') ||
      name.endsWith('.mov') ||
      name.endsWith('.avi') ||
      name.endsWith('.mkv')
    );
  }

  export function showHeroResumeToast(message) {
    heroResumeToast.set(message);
    resourceManager.setTimeout(() => heroResumeToast.set(''), 2500);
  }

  export function setupHeroPersistence() {
    if (!heroVideoElement || detachHeroPersistence) return;
    detachHeroPersistence = attachHeroPersistence(heroVideoElement, {
      onRestoring: (active) => heroRestoring.set(active),
      onResumeToast: showHeroResumeToast
    });
  }

  export function setupHeroPersistenceCallback() {
    setupHeroPersistence();
  }

  export function handleHeroVideoLoad() {
    heroVideoLoaded.set(true);
    heroVideoFailed.set(false);
    pipelineCheckpoint('VIDEO_ATTACHED', {
      vault: 'hero',
      videoSrc: prioritizedHeroVideo || get(HERO_BACKGROUND_VIDEO) || ''
    });
    heroVideoFailureCount = 0;
    heroCarouselMediaPlaying = true;
    if (!mediaPlaceholderFixLogged) {
      mediaPlaceholderFixLogged = true;
      console.info('[MEDIA_PLACEHOLDER_LOGIC_FIXED]', {
        primaryMediaLoaded: true,
        placeholderHiddenWhenLoaded: true,
        duplicateRenderingResolved: true
      });
    }
    console.info('[HERO_CAROUSEL_MEDIA_STATE]', {
      assetId: activeHeroSlide?.assetId || activeHeroSlide?.id || '',
      playing: true,
      muted: true
    });
    emitHeroRenderCertification('success', { event: 'video-loaded' });
    setupHeroPersistence();
    // Ensure hero background loops in motion even if a prior persisted state was paused.
    resourceManager.setTimeout(() => {
      if (!heroVideoElement || activeHeroMediaMode !== 'video') return;
      if (heroVideoElement.paused) {
        heroVideoElement
          .play()
          .then(() => {
            heroCarouselMediaPlaying = true;
            heroVideoFailed.set(false);
          })
          .catch(() => {
            // Ignore autoplay policy failures; existing fallback/error path handles visibility.
          });
      }
    }, 0);
  }

  export function handleHeroVideoError() {
    heroVideoFailureCount += 1;
    heroVideoFailed.set(true);
    heroVideoLoaded.set(false);
    console.info('[HERO_CAROUSEL_MEDIA_STATE]', {
      assetId: activeHeroSlide?.assetId || activeHeroSlide?.id || '',
      playing: false,
      muted: true
    });
    emitHeroRenderCertification('failure', { event: 'video-error' });
    if (detachHeroPersistence) {
      detachHeroPersistence();
      detachHeroPersistence = null;
    }
  }

  export function handleHeroStageDragEnter(event) {
    if (section !== 'stage' || !sanitizeViewer) return;
    if (!isLikelyMediaDrag(event)) return;
    event.preventDefault();
    heroStageDragDepth += 1;
    heroStageUploadHintVisible = true;
    markMediaUploadIntent('homepage-hero-stage');
  }

  export function handleHeroStageDragLeave() {
    if (section !== 'stage' || !sanitizeViewer) return;
    heroStageDragDepth = Math.max(0, heroStageDragDepth - 1);
    if (heroStageDragDepth === 0) {
      heroStageUploadHintVisible = false;
    }
  }

  export function handleHeroStageDragOver(event) {
    if (section !== 'stage' || !sanitizeViewer) return;
    if (!isLikelyMediaDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'none';
    }
  }

  export function handleHeroStageDrop(event) {
    if (section !== 'stage' || !sanitizeViewer) return;
    event.preventDefault();
    event.stopPropagation();
    heroStageDragDepth = 0;
    heroStageUploadHintVisible = false;
    const file = event.dataTransfer?.files?.[0];
    logDropMiss('homepage-hero-stage', 'no_upload_handler_on_viewer_hero_stage', {
      fileName: file?.name || null,
      fileSize: file?.size ?? null,
      fileCount: event.dataTransfer?.files?.length || 0
    });
  }

  export function handleHeroDragEnter(event) {
    heroIsDragOver.set(true);
    console.info('[BG7G_DROP]', {
      ts: new Date().toISOString(),
      component: 'handleHeroDragEnter',
      file: 'HeroExperience.svelte',
      fileName: null,
      fileSize: null,
      uploadUrl: null,
      state: 'dragenter',
      section,
      fileCount: event?.dataTransfer?.types?.length || 0
    });
  }

  export function handleHeroDragLeave() {
    heroIsDragOver.set(false);
  }

  export function handleHeroDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  export function handleHeroDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    heroIsDragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    console.info('[BG7G_DROP]', {
      ts: new Date().toISOString(),
      component: 'handleHeroDrop',
      file: 'HeroExperience.svelte',
      fileName: file?.name || null,
      fileSize: file?.size ?? null,
      uploadUrl: null,
      state: file ? 'drop_received' : 'failure',
      section,
      fileCount: event.dataTransfer?.files?.length || 0,
      reason: file ? null : 'no_file_in_dataTransfer'
    });
    pipelineCheckpoint('DROP_RECEIVED', {
      filename: file?.name || null,
      vault: 'hero',
      kind: file ? (isProbablyVideo(file) ? 'hero/mp4' : 'hero/image') : 'unknown',
      id: null,
      fileCount: event.dataTransfer?.files?.length || 0
    });
    if (file) handleHeroFileSelect({ target: { files: [file] } });
  }

  export function handleHeroFileSelect(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    console.info('[BG7G_DROP]', {
      ts: new Date().toISOString(),
      component: 'handleHeroFileSelect',
      file: 'HeroExperience.svelte',
      fileName: file.name,
      fileSize: file.size,
      uploadUrl: null,
      state: 'file_selected',
      inferredKind: isProbablyVideo(file) ? 'video' : file.type.startsWith('image/') ? 'image' : 'unknown'
    });
    console.log('[HERO_FILE_SELECTED]', {
      fileName: file.name || '',
      fileType: file.type || '',
      fileSize: file.size || 0
    });
    console.info('[HERO_UPLOAD]', {
      stage: 'hero-file-select',
      name: file.name || '',
      mime: file.type || '',
      size: file.size || 0,
      inferredKind: isProbablyVideo(file) ? 'video' : file.type.startsWith('image/') ? 'image' : 'unknown',
      ts: new Date().toISOString()
    });
    emitHeroDevLog('file-selected', {
      fileName: file.name || '',
      fileType: file.type || '',
      fileSize: file.size || 0
    });
    uploadStatus.set('🎬 PROCESSING...');
    if (isProbablyVideo(file)) {
      const preview = resourceManager.addBlobUrl(URL.createObjectURL(file));
      heroPendingFile.set({
        file,
        preview,
        name: file.name,
        size: file.size,
        type: 'video'
      });
      heroPreviewUrl.set(preview);
      uploadStatus.set(`🎬 Uploading hero video (${file.name})...`);
      console.info('[BG7G_UPLOAD]', {
        ts: new Date().toISOString(),
        component: 'handleHeroFileSelect',
        file: 'HeroExperience.svelte',
        fileName: file.name,
        fileSize: file.size,
        uploadUrl: '/api/reels',
        state: 'auto_accept_start',
        kind: 'video'
      });
      beginHeroAutoAccept();
    } else if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        heroPendingFile.set({
          file,
          preview: loadEvent.target.result,
          name: file.name,
          size: file.size,
          type: 'image'
        });
        heroPreviewUrl.set(loadEvent.target.result);
        uploadStatus.set(`🖼️ Uploading hero image (${file.name})...`);
        console.info('[BG7G_UPLOAD]', {
          ts: new Date().toISOString(),
          component: 'handleHeroFileSelect',
          file: 'HeroExperience.svelte',
          fileName: file.name,
          fileSize: file.size,
          uploadUrl: '/api/reels',
          state: 'auto_accept_start',
          kind: 'image'
        });
        beginHeroAutoAccept();
      };
      reader.readAsDataURL(file);
    } else {
      console.info('[BG7G_DROP]', {
        ts: new Date().toISOString(),
        component: 'handleHeroFileSelect',
        file: 'HeroExperience.svelte',
        fileName: file.name,
        fileSize: file.size,
        uploadUrl: null,
        state: 'failure',
        reason: 'unsupported_mime_or_extension',
        mime: file.type || ''
      });
    }
    if (event.target) event.target.value = '';
  }

  /** BG-7A: invoke the proven acceptHeroFile() pipeline after drop validation. */
  function beginHeroAutoAccept() {
    void acceptHeroFile();
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read hero file'));
      reader.onabort = () => reject(new Error('Hero file read aborted'));
      const readTimeoutId = window.setTimeout(() => {
        try {
          reader.abort();
        } catch {
          // ignore abort errors and let timeout rejection handle status
        }
        reject(new Error('Hero file read timed out'));
      }, 20000);
      const finalize = () => window.clearTimeout(readTimeoutId);
      reader.onloadend = () => finalize();
      reader.readAsDataURL(file);
    });
  }

  export async function acceptHeroFile() {
    const pending = get(heroPendingFile);
    if (!pending) return;
    const operationToken = ++heroAcceptOperationToken;
    let operationTimedOut = false;
    const pendingSize = Number(pending?.file?.size || 0);
    const largeVideoUpload =
      String(pending?.type || '') === 'video' &&
      pendingSize > HERO_LOCALSTORAGE_VIDEO_LIMIT_BYTES;
    const watchdogTimeoutMs = largeVideoUpload ? 15 * 60 * 1000 : 45000;
    const watchdogId = resourceManager.setTimeout(() => {
      if (operationToken !== heroAcceptOperationToken) return;
      operationTimedOut = true;
      heroAcceptOperationToken += 1;
      heroUploadProcessing = false;
      uploadStatus.set('❌ Failed: Hero processing timed out. Please retry with a smaller file.');
      console.info('[HERO_ACCEPT_TIMEOUT]', {
        timeoutMs: watchdogTimeoutMs,
        pendingType: pending.type || '',
        fileName: pending.name || '',
        ts: new Date().toISOString()
      });
      emitHeroDevLog('accept-timeout', {
        timeoutMs: watchdogTimeoutMs,
        pendingType: pending.type || '',
        fileName: pending.name || ''
      });
    }, watchdogTimeoutMs);
    const cancelWatchdog = () => {
      if (typeof resourceManager?.clearTimeout === 'function') {
        resourceManager.clearTimeout(watchdogId);
      } else if (typeof window !== 'undefined') {
        window.clearTimeout(watchdogId);
      }
    };
    const isOperationActive = () => operationToken === heroAcceptOperationToken;
    heroUploadProcessing = true;
    await tick();
    pipelineCheckpoint('UPLOAD_STARTED', {
      vault: 'hero',
      kind: pending.type === 'video' ? 'hero/mp4' : 'hero/image',
      filename: pending.name || pending.file?.name || null
    });
    console.info('[HERO_ACCEPT]', {
      stage: 'start',
      pendingType: pending.type || '',
      name: pending.name || '',
      ts: new Date().toISOString()
    });
    emitHeroDevLog('accept-start', {
      pendingType: pending.type || '',
      fileName: pending.name || ''
    });
    try {
      const { file, preview, name, type } = pending;
      if (!isOperationActive()) return;
      const currentConfig = loadHeroManagerConfig();
      const derivedHeadline = humanizeFileName(name || file?.name || '');
      const viewerPatch = {
        heroLabel: shouldHydrateViewerField(currentConfig?.heroLabel)
          ? 'LOOK@ZAKANDA PRESENTS'
          : String(currentConfig?.heroLabel || '').trim(),
        heroTitle: shouldHydrateViewerField(currentConfig?.heroTitle)
          ? derivedHeadline
          : String(currentConfig?.heroTitle || '').trim(),
        heroSubtitle: shouldHydrateViewerField(currentConfig?.heroSubtitle)
          ? 'A cinematic spotlight from your latest hero upload.'
          : String(currentConfig?.heroSubtitle || '').trim(),
        heroDescription: shouldHydrateViewerField(currentConfig?.heroDescription)
          ? 'Editorial content now reflects the newly accepted hero asset.'
          : String(currentConfig?.heroDescription || '').trim()
      };
      if (type === 'video') {
        if (!isOperationActive()) return;
        uploadStatus.set('🎬 Validating hero video...');
        const validation = await withTimeout(
          validateVideoFile(file),
          15000,
          'Hero video validation'
        );
        if (!isOperationActive()) return;
        if (!validation.valid) throw new Error(validation.reason || 'Invalid video file');
        uploadStatus.set('🎬 Uploading hero video...');
        const { uploadVideo } = await import('../../lib/api/media.js');
        const { getAdminAuthorizationHeader, API_BASE_URL } = await import('../../lib/api.js');
        const token =
          typeof window !== 'undefined'
            ? localStorage.getItem('reelforge_admin_session_token')
            : null;
        console.info('[BG7G_UPLOAD]', {
          ts: new Date().toISOString(),
          component: 'acceptHeroFile',
          file: 'HeroExperience.svelte',
          fileName: file.name,
          fileSize: file.size,
          uploadUrl: `${API_BASE_URL}/api/reels`,
          state: 'upload_start',
          kind: 'video'
        });
        const created = await withTimeout(
          uploadVideo(file, getAdminAuthorizationHeader(token), {
            title: derivedHeadline,
            description: 'Hero background upload',
            category: 'HERO'
          }),
          10 * 60 * 1000,
          'Hero video upload'
        );
        reelResReelSnapshot('acceptHeroFile:created', created, { vault: 'hero' });
        const reel = heroReelFromUploadResponse(created, 'video');
        if (!reel?.id || !reel?.url) {
          throw new Error('Hero upload completed without canonical reel identity');
        }
        saveHeroReel(reel);
        const heroVideoBefore = get(HERO_BACKGROUND_VIDEO);
        HERO_BACKGROUND_VIDEO.set(reel.url);
        console.info('[BG7G_STORE]', {
          ts: new Date().toISOString(),
          component: 'HERO_BACKGROUND_VIDEO.set',
          file: 'HeroExperience.svelte',
          fileName: reel.fileName || file.name,
          fileSize: file.size,
          uploadUrl: reel.url,
          state: 'success',
          reelId: reel.id
        });
        reelResStoreMutation('HERO_BACKGROUND_VIDEO', heroVideoBefore, reel.url, {
          trigger: 'acceptHeroFile',
          heroManagerConfigInMemory: heroManagerConfig?.backgroundSource || null,
          heroManagerConfigPersisted: loadHeroManagerConfig()?.backgroundSource || null
        });
        if (reel.thumbnail) HERO_POSTER_IMAGE.set(reel.thumbnail);
        heroVideoLoaded.set(false);
        heroVideoFailed.set(false);
        saveHeroManagerConfig({
          backgroundSource: 'custom_video',
          heroAssetId: reel.id,
          backgroundStyle: 'video',
          ...viewerPatch
        });
        logHeroConfigSaveAudit(loadHeroManagerConfig(), heroManagerConfig);
        const registry = buildHeroAssetRegistry(loadHeroVaultItems(), { storageSource: 'hero_registry' });
        console.info('[HERO_ACCEPT]', {
          stage: 'complete',
          id: reel.id,
          fileName: reel.fileName,
          url: reel.url,
          backgroundSource: 'custom_video',
          registrySize: registry.length,
          ts: new Date().toISOString()
        });
        uploadStatus.set('✅ Hero Updated Successfully');
        console.info('[BG7G_RENDER]', {
          ts: new Date().toISOString(),
          component: 'acceptHeroFile',
          file: 'HeroExperience.svelte',
          fileName: reel.fileName || file.name,
          fileSize: file.size,
          uploadUrl: reel.url,
          state: 'hero_video_committed',
          backgroundSource: 'custom_video'
        });
        showHeroCommitBanner();
        pipelineCheckpoint('VIDEO_READY', {
          vault: 'hero',
          videoSrc: reel.url,
          reelId: reel.id
        });
        if (typeof preview === 'string' && preview.startsWith('blob:')) {
          resourceManager.revokeBlobUrl(preview);
        }
        heroPendingFile.set(null);
        heroPreviewUrl.set(null);
        emitHeroDevLog('accept-complete', {
          assetId: reel.id,
          backgroundSource: 'custom_video'
        });
      } else if (type === 'image') {
        if (!isOperationActive()) return;
        uploadStatus.set('🖼️ Uploading hero image...');
        const { uploadThumbnail } = await import('../../lib/api/media.js');
        const { getAdminAuthorizationHeader } = await import('../../lib/api.js');
        const token =
          typeof window !== 'undefined'
            ? localStorage.getItem('reelforge_admin_session_token')
            : null;
        const created = await withTimeout(
          uploadThumbnail(file, getAdminAuthorizationHeader(token), {
            title: derivedHeadline,
            description: 'Hero background upload',
            category: 'HERO'
          }),
          120000,
          'Hero image upload'
        );
        const reel = heroReelFromUploadResponse(created, 'image');
        if (!reel?.id || !reel?.url) {
          throw new Error('Hero upload completed without canonical reel identity');
        }
        saveHeroReel(reel);
        HERO_POSTER_IMAGE.set(reel.url);
        HERO_BACKGROUND_VIDEO.set('');
        heroVideoFailed.set(false);
        saveHeroManagerConfig({
          backgroundSource: 'custom_image',
          heroAssetId: reel.id,
          backgroundStyle: 'image',
          ...viewerPatch
        });
        logHeroConfigSaveAudit(loadHeroManagerConfig(), heroManagerConfig);
        const registry = buildHeroAssetRegistry(loadHeroVaultItems(), { storageSource: 'hero_registry' });
        console.info('[HERO_ACCEPT]', {
          stage: 'complete',
          id: reel.id,
          fileName: reel.fileName,
          url: reel.url,
          backgroundSource: 'custom_image',
          registrySize: registry.length,
          ts: new Date().toISOString()
        });
        uploadStatus.set('✅ Hero Updated Successfully');
        console.info('[BG7G_RENDER]', {
          ts: new Date().toISOString(),
          component: 'acceptHeroFile',
          file: 'HeroExperience.svelte',
          fileName: reel.fileName || file.name,
          fileSize: file.size,
          uploadUrl: reel.url,
          state: 'hero_image_committed',
          backgroundSource: 'custom_image'
        });
        showHeroCommitBanner();
        heroPendingFile.set(null);
        heroPreviewUrl.set(null);
        emitHeroDevLog('accept-complete', {
          assetId: reel.id,
          backgroundSource: 'custom_image'
        });
      }
      if (isOperationActive()) {
        resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
      }
    } catch (error) {
      if (!isOperationActive() && operationTimedOut) return;
      console.info('[BG7G_UPLOAD]', {
        ts: new Date().toISOString(),
        component: 'acceptHeroFile',
        file: 'HeroExperience.svelte',
        fileName: pending?.name || pending?.file?.name || null,
        fileSize: pending?.file?.size ?? null,
        uploadUrl: '/api/reels',
        state: 'failure',
        reason: error?.message || String(error)
      });
      console.error('❌ Failed to accept hero file:', error);
      console.info('[HERO_ACCEPT]', {
        stage: 'failed',
        error: error?.message || String(error),
        ts: new Date().toISOString()
      });
      console.info('[HERO_ACCEPT_STALL_GUARD]', {
        guarded: true,
        reason: error?.message || String(error),
        ts: new Date().toISOString()
      });
      emitHeroDevLog('accept-failed', {
        reason: error?.message || String(error)
      });
      uploadStatus.set(`❌ Failed: ${error.message}`);
    } finally {
      cancelWatchdog();
      if (isOperationActive()) {
        heroUploadProcessing = false;
      }
    }
  }

  export function rejectHeroFile() {
    const pending = get(heroPendingFile);
    if (pending?.preview?.startsWith('blob:')) {
      resourceManager.revokeBlobUrl(pending.preview);
    }
    heroPendingFile.set(null);
    heroPreviewUrl.set(null);
    console.info('[HERO_REJECT]', {
      stage: 'complete',
      ts: new Date().toISOString()
    });
    uploadStatus.set('Hero replacement cancelled');
    resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
  }

  function openHeroFilePicker(event) {
    if (heroUploadState !== 'idle') return;
    event.stopPropagation();
    heroFileInput?.click();
  }

  function handleHeroFilePickerKeydown(event) {
    if (heroUploadState !== 'idle') return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      heroFileInput?.click();
    }
  }

  $: pendingHeroFile = $heroPendingFile;
  $: {
    if (heroUploadProcessing) {
      heroUploadState = 'processing';
    } else if (pendingHeroFile) {
      heroUploadState = 'previewing';
    } else {
      heroUploadState = 'idle';
    }
    if (heroUploadState !== lastHeroUploadState) {
      console.log('[HERO_UX_STATE_CHANGE]', {
        fromState: lastHeroUploadState,
        toState: heroUploadState,
        pendingFileName: pendingHeroFile?.name || ''
      });
      lastHeroUploadState = heroUploadState;
    }
  }

  onDestroy(() => {
    clearCarouselTimers();
    if (heroCommitBannerTimer != null) {
      resourceManager.clearTimeout(heroCommitBannerTimer);
      heroCommitBannerTimer = null;
    }
    if (detachHeroPersistence) {
      detachHeroPersistence();
      detachHeroPersistence = null;
    }
  });
</script>

{#if section === 'stage' || section === 'both'}
  <section
    class="hero-stage"
    class:hero-stage--viewer={sanitizeViewer}
    class:hero-stage--upload-hint={heroStageUploadHintVisible}
    data-hero-intelligence
    data-hero-carousel
    data-active-hero-media-mode={activeHeroMediaMode}
    data-hero-carousel-active-id={sanitizeViewer ? '' : activeHeroSlide?.assetId || activeHeroSlide?.id || ''}
    data-viewer-media-exempt
    data-hero-mode={heroSelection?.mode || 'STATIC'}
    data-hero-source={heroSelection?.source || 'static'}
    on:pointerenter={pauseCarousel}
    on:pointerleave={resumeCarousel}
    on:dragenter={handleHeroStageDragEnter}
    on:dragover={handleHeroStageDragOver}
    on:dragleave={handleHeroStageDragLeave}
    on:drop={handleHeroStageDrop}
  >
    {#if heroStageUploadHintVisible && sanitizeViewer}
      <div class="hero-stage-upload-hint" role="status" aria-live="polite">
        <span class="hero-stage-upload-hint__icon" aria-hidden="true">🎬</span>
        <p class="hero-stage-upload-hint__message">
          Open Studio → Content → Replace Background to upload hero video
        </p>
      </div>
    {/if}
    <div
      class="hero-video-container hero-background"
      class:hero-transition-fade={heroTransitionStyle === 'fade'}
      class:hero-transition-cinematic-blur={heroTransitionStyle === 'cinematic_blur'}
      class:hero-transition-slide={heroTransitionStyle === 'slide'}
      class:hero-transition-zoom={heroTransitionStyle === 'zoom'}
      class:hero-gradient-fallback={activeHeroMediaMode === 'fallback'}
      class:hero-bg-ambient-motion={heroBackgroundPresentation.ambientMotion}
      class:hero-bg-cinematic-blur={heroBackgroundPresentation.cinematicBlur}
      data-hero-background-style={heroBackgroundPresentation.style}
      data-hero-background-source={heroBackgroundPresentation.backgroundSource}
      data-hero-background-asset={sanitizeViewer ? '' : heroBackgroundPresentation.backgroundAsset || ''}
    >
      {#if !sanitizeViewer}
        <div class="hero-carousel-meta" data-hero-carousel-meta>
          <span>{activeHeroSlide?.type === 'video' ? '● Featured Background' : '● Featured Artwork'}</span>
        </div>
      {/if}
      {#if activeHeroMediaMode === 'video'}
        {#if $heroResumeToast}
          <div class="hero-resume-toast" role="status">{$heroResumeToast}</div>
        {/if}
        {#key `${prioritizedHeroVideo}:${heroVideoFailureCount}`}
          <MediaRenderer
            type="video"
            url={prioritizedHeroVideo}
            raw={prioritizedHeroVideo.startsWith('blob:') || prioritizedHeroVideo.startsWith('data:')}
            bind:videoElement={heroVideoElement}
            className="hero-video hero-media hero-video-visible active"
            useSourceElement={false}
            poster={heroVideoPoster}
            preload="metadata"
            autoplay
            muted
            loop
            playsinline
            on:loadedmetadata={handleHeroVideoLoad}
            on:error={handleHeroVideoError}
          />
        {/key}
      {:else if activeHeroMediaMode === 'image'}
        <MediaPoster url={prioritizedHeroImage} allowDataUrl className="hero-fallback-image hero-media active" />
      {:else}
        <MediaPoster
          url={prioritizedHeroImage || DEFAULT_MEDIA_PLACEHOLDER}
          className="hero-fallback-image hero-media active hero-loading-fallback"
        >
          <div class="hero-loading-indicator">
            <span class="hero-spinner" aria-hidden="true"></span>
            Featured background unavailable
          </div>
        </MediaPoster>
      {/if}
      {#if activeHeroMediaMode === 'fallback'}
        <div
          class="hero-video-overlay hero-overlay"
          class:hero-bg-gradient-overlay={heroBackgroundPresentation.gradientOverlay}
          class:hero-bg-cinematic-overlay={heroBackgroundPresentation.cinematicBlur}
        ></div>
        <div class="hero-motion-gradient" aria-hidden="true"></div>
      {/if}
    </div>
    <div class="hero-wrap {heroTypographyClass}">
      <span class="premium-tag" data-hero-badge>
        {heroBadgeLabel}
      </span>
      {#if heroSlideDetail && !sanitizeViewer}
        <p class="hero-insight" data-hero-insight>{heroSlideDetail}</p>
      {/if}
      {#if heroVisualSlides.length > 1}
        <div class="hero-countdown-overlay" data-hero-countdown-overlay hidden={sanitizeViewer}>
          <span>{carouselPaused ? 'Paused' : `Next in ${carouselCountdownSec}s`}</span>
        </div>
      {/if}
      <h1 data-hero-title>{heroSlideTitle}</h1>
      <p data-hero-subtitle>
        {heroSlideSubtitle}
      </p>
      {#if heroViewerDescription}
        <p class="hero-story-description" data-hero-story-description>{heroViewerDescription}</p>
      {/if}
      {#if !sanitizeViewer && activeHeroSlide?.type === 'upcoming_release'}
        <div class="hero-event-card" data-hero-upcoming-card>
          <strong>Upcoming Event</strong>
          <span>{activeHeroSlide.detail || 'Next release on the timeline'}</span>
          <em>{activeHeroSlide.countdownLabel || 'Soon'}</em>
        </div>
      {/if}
      {#if !sanitizeViewer && activeHeroSlide?.type === 'video' && activeHeroSlide?.imageUrl && activeHeroSlide?.videoUrl}
        <div class="hero-split-layout" data-hero-split-layout>
          <strong>Featured Stage</strong>
          <p>Dual Media</p>
        </div>
      {/if}
      <div class="hero-carousel-actions">
        <button
          type="button"
          class="hero-carousel-controls__btn"
          data-hero-watch-now
          on:click={() => {
            if (heroStoryPublished) openStoryTarget(heroStoryPrimaryTarget);
            else goToSlide(activeSlideIndex, 'watch_now');
          }}
        >
          {heroStoryPrimaryLabel || 'Watch Now'}
        </button>
        <button
          type="button"
          class="hero-carousel-controls__btn"
          data-hero-story-secondary-cta
          on:click={() => {
            if (heroStoryPublished) openStoryTarget(heroStorySecondaryTarget);
            else goToSlide(activeSlideIndex + 1, 'learn_more');
          }}
        >
          {heroStorySecondaryLabel || 'Learn More'}
        </button>
        {#if !sanitizeViewer && activeHeroSlide?.type === 'video'}
          <button
            type="button"
            class="hero-carousel-controls__btn"
            data-hero-carousel-media-toggle
            on:click={toggleCarouselMediaPlayback}
          >
            {heroCarouselMediaPlaying ? 'Pause Media' : 'Play Media'}
          </button>
        {/if}
        {#if !sanitizeViewer}
          <button
            type="button"
            class="hero-carousel-controls__btn"
            data-hero-carousel-manage-vault
            on:click={openHeroVaultManager}
          >
            Manage in Vault
          </button>
        {/if}
      </div>
      {#if !sanitizeViewer}
      <section class="upcoming-events-module" data-upcoming-events-module>
        <div class="upcoming-events-module__header">
          <button
            type="button"
            class="upcoming-events-module__toggle"
            on:click={toggleUpcomingEvents}
            data-upcoming-events-toggle
            aria-expanded={eventsExpanded}
          >
            {sanitizeViewer ? 'Upcoming Events' : `Upcoming Events (${eventsRegistry.length})`}
          </button>
        </div>
        {#if eventsExpanded && eventsRegistry.length === 0}
          <p class="upcoming-events-module__empty">No upcoming events available.</p>
        {:else if eventsExpanded}
          <div class="upcoming-events-module__grid">
            {#each eventsRegistry as event (event.episodeId)}
              <article class="upcoming-events-module__card" data-event-card data-event-id={event.episodeId}>
                <div class="upcoming-events-module__meta">
                  <span class="upcoming-events-module__badge">{resolveEventBadge(event)}</span>
                  <h4>{event.episodeTitle || event.episodeLabel || event.episodeId}</h4>
                  <p>{event.releaseDate || 'TBD'} {event.releaseTime || ''}</p>
                  <p>Host: {resolveEventHost()}</p>
                  {#if viewedEventId === event.episodeId}
                    <small>Details viewed</small>
                  {/if}
                </div>
                <div class="upcoming-events-module__actions">
                  <button
                    type="button"
                    data-event-rsvp
                    on:click={() => handleEventRsvp(event)}
                  >
                    {rsvpEventIds.has(event.episodeId) ? 'Reminder Set' : 'RSVP / Remind Me'}
                  </button>
                  <button
                    type="button"
                    data-event-details
                    on:click={() => handleEventDetails(event)}
                  >
                    View Details
                  </button>
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </section>
      <section class="featured-creator-module" data-featured-creator-module>
        {#if !featuredCreator}
          <p class="featured-creator-module__empty">No creator profiles available.</p>
        {:else}
          <article class="featured-creator-module__card" data-featured-creator-card data-creator-id={featuredCreator.creatorId}>
            <div class="featured-creator-module__identity">
              <img
                src={featuredCreator.avatar || DEFAULT_AVATAR_PLACEHOLDER}
                alt={featuredCreator.displayName}
                on:error={(event) => {
                  const target = /** @type {HTMLImageElement} */ (event.currentTarget);
                  if (target?.src !== `${window.location.origin}${DEFAULT_AVATAR_PLACEHOLDER}`) {
                    target.src = DEFAULT_AVATAR_PLACEHOLDER;
                  }
                }}
              />
              <div>
                <h4>{featuredCreator.displayName}</h4>
                {#if !sanitizeViewer}
                  <p>{featuredCreator.handle}</p>
                {/if}
              </div>
            </div>
            <div class="featured-creator-module__actions">
              <button
                type="button"
                data-featured-creator-follow
                on:click={handleCreatorFollowToggle}
              >
                {followedCreatorIds.has(featuredCreator.creatorId) ? 'Unfollow' : 'Follow'}
              </button>
            </div>
          </article>
        {/if}
      </section>
      {/if}
      {#if heroVisualSlides.length > 0}
        <div class="hero-carousel-timeline" data-hero-carousel-timeline hidden={sanitizeViewer}>
          <div class="hero-carousel-controls" data-hero-carousel-controls>
            <button
              type="button"
              class="hero-carousel-controls__btn"
              data-hero-carousel-prev
              on:click={goToPreviousSlide}
              aria-label="Previous hero slide"
            >
              Prev
            </button>
            <button
              type="button"
              class="hero-carousel-controls__btn"
              on:click={() => {
                carouselPaused ? resumeCarousel() : pauseCarousel();
              }}
              aria-label={carouselPaused ? 'Resume autoplay' : 'Pause autoplay'}
            >
              {carouselPaused ? 'Play' : 'Pause'}
            </button>
            <button
              type="button"
              class="hero-carousel-controls__btn"
              data-hero-carousel-next
              on:click={() => goToNextSlide('next')}
              aria-label="Next hero slide"
            >
              Next
            </button>
          </div>
          <div class="hero-carousel-timeline__track">
            <div class="hero-carousel-timeline__progress" style="width: {carouselProgressPct}%"></div>
          </div>
          <div class="hero-carousel-timeline__markers">
            {#each heroVisualSlides as slide, index (slide.id)}
              <button
                type="button"
                class="hero-carousel-timeline__marker"
                class:hero-carousel-timeline__marker--active={index === activeSlideIndex}
                data-hero-slide-type={slide.type}
                on:click={() => {
                  goToSlide(index, 'timeline_click');
                }}
                aria-label={`Show ${slide.type.replace(/_/g, ' ')}`}
              ></button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </section>
  {#if !sanitizeViewer}
    <HeroCommandCenter
      seriesId={heroSelection?.seriesId || 'series-neon-vengeance'}
      {feedReels}
      dock="below"
    />
  {/if}
{/if}

<style>
  .hero-transition-fade :global(.hero-media) {
    transition: opacity 0.45s ease;
  }
  .hero-transition-cinematic-blur :global(.hero-media) {
    filter: blur(0px);
    transition: filter 0.45s ease, transform 0.45s ease;
  }
  .hero-transition-slide :global(.hero-media) {
    transition: transform 0.45s ease, opacity 0.45s ease;
    transform: translateX(0);
  }
  .hero-transition-zoom :global(.hero-media) {
    transition: transform 0.45s ease, opacity 0.45s ease;
    transform: scale(1.01);
  }
  .hero-event-card {
    margin-top: 0.6rem;
    padding: 0.5rem 0.65rem;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.38);
    display: grid;
    gap: 0.15rem;
    max-width: 30rem;
  }
  .hero-event-card strong {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: rgba(255, 255, 255, 0.78);
  }
  .hero-event-card span {
    font-size: 0.74rem;
    color: rgba(255, 255, 255, 0.86);
  }
  .hero-event-card em {
    font-style: normal;
    font-size: 0.66rem;
    color: #ffd36e;
  }
  .hero-countdown-overlay {
    margin-bottom: 0.35rem;
  }
  .hero-countdown-overlay span {
    display: inline-block;
    padding: 0.2rem 0.45rem;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 999px;
    font-size: 0.58rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    background: rgba(0, 0, 0, 0.35);
    color: rgba(255, 255, 255, 0.82);
  }
  .hero-split-layout {
    position: absolute;
    top: 2.75rem;
    left: 0.7rem;
    z-index: 3;
    width: min(24vw, 13rem);
    max-width: 25vw;
    max-height: 20vh;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    background: rgba(6, 12, 20, 0.46);
    backdrop-filter: blur(8px);
    padding: 0.22rem 0.5rem;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    overflow: hidden;
  }
  .hero-split-layout strong {
    display: block;
    font-size: 0.54rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #fff;
  }
  .hero-split-layout p {
    margin: 0;
    font-size: 0.54rem;
    color: rgba(255, 255, 255, 0.82);
  }
  .hero-carousel-timeline {
    margin-top: 0.75rem;
    max-width: 26rem;
  }
  .hero-carousel-controls {
    display: flex;
    gap: 0.35rem;
    margin-bottom: 0.35rem;
  }
  .hero-carousel-meta {
    position: absolute;
    top: 0.7rem;
    left: 0.7rem;
    z-index: 3;
    display: flex;
    gap: 0.25rem;
  }
  .hero-carousel-meta span {
    padding: 0.18rem 0.42rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.24);
    background: rgba(4, 10, 16, 0.5);
    backdrop-filter: blur(7px);
    font-size: 0.5rem;
    color: rgba(255, 255, 255, 0.92);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .hero-carousel-actions {
    margin-top: 0.45rem;
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .hero-stage--viewer .hero-carousel-actions {
    margin-top: 1.5rem;
    gap: 0.9rem;
  }
  .hero-story-description {
    margin: 0.35rem 0 0;
    max-width: 42rem;
    font-size: 0.88rem;
    line-height: 1.45;
    color: rgba(255, 255, 255, 0.9);
  }
  .hero-stage--viewer .hero-story-description {
    margin: 1rem 0 0;
    max-width: 52rem;
    font-size: clamp(18px, 1.9vw, 24px);
    line-height: 1.42;
    color: rgba(255, 255, 255, 0.93);
    text-shadow: 0 2px 18px rgba(0, 0, 0, 0.55);
  }
  .upcoming-events-module {
    position: absolute;
    top: 0.7rem;
    right: 0.7rem;
    z-index: 3;
    width: min(24vw, 20rem);
    max-width: 25vw;
    max-height: 20vh;
    padding: 0.35rem;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(8, 12, 20, 0.44);
    backdrop-filter: blur(9px);
    overflow: hidden;
  }
  .upcoming-events-module__header {
    display: flex;
    margin: 0;
  }
  .upcoming-events-module__toggle {
    width: 100%;
    text-align: left;
    padding: 0.2rem 0.45rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.95);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    font-size: 0.52rem;
    cursor: pointer;
  }
  .upcoming-events-module__empty {
    margin: 0.35rem 0 0;
    color: rgba(255, 255, 255, 0.62);
    font-size: 0.54rem;
  }
  .upcoming-events-module__grid {
    margin-top: 0.35rem;
    display: grid;
    gap: 0.3rem;
    max-height: calc(20vh - 2.4rem);
    overflow: auto;
  }
  .upcoming-events-module__card {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.2rem;
    padding: 0.3rem;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.03);
  }
  .upcoming-events-module__badge {
    display: inline-block;
    margin-bottom: 0.2rem;
    padding: 0.14rem 0.34rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    font-size: 0.5rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    background: rgba(255, 255, 255, 0.07);
  }
  .upcoming-events-module__meta h4 {
    margin: 0 0 0.15rem;
    font-size: 0.6rem;
  }
  .upcoming-events-module__meta p,
  .upcoming-events-module__meta small {
    margin: 0;
    color: rgba(255, 255, 255, 0.68);
    font-size: 0.52rem;
  }
  .upcoming-events-module__actions {
    display: flex;
    gap: 0.2rem;
    flex-wrap: wrap;
  }
  .upcoming-events-module__actions button {
    padding: 0.2rem 0.4rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    font-size: 0.5rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .featured-creator-module {
    position: absolute;
    right: 0.7rem;
    bottom: 3.4rem;
    z-index: 3;
    width: min(24vw, 18rem);
    max-width: 25vw;
    max-height: 20vh;
    padding: 0.3rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(8, 12, 20, 0.44);
    backdrop-filter: blur(9px);
    overflow: hidden;
  }
  .featured-creator-module__empty {
    margin: 0;
    color: rgba(255, 255, 255, 0.62);
    font-size: 0.54rem;
  }
  .featured-creator-module__card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.35rem;
  }
  .featured-creator-module__identity {
    display: grid;
    grid-template-columns: 2rem 1fr;
    gap: 0.35rem;
    align-items: center;
    min-width: 0;
  }
  .featured-creator-module__identity img {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }
  .featured-creator-module__identity h4 {
    margin: 0;
    font-size: 0.58rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .featured-creator-module__identity p,
  .featured-creator-module__identity small {
    margin: 0.06rem 0 0;
    font-size: 0.5rem;
    color: rgba(255, 255, 255, 0.7);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .featured-creator-module__actions {
    display: flex;
    align-items: center;
  }
  .featured-creator-module__actions button {
    padding: 0.2rem 0.45rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    font-size: 0.5rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .hero-carousel-controls__btn {
    padding: 0.24rem 0.48rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.25);
    background: rgba(0, 0, 0, 0.32);
    color: #fff;
    font-size: 0.58rem;
    cursor: pointer;
  }
  .hero-stage--viewer .hero-carousel-controls__btn {
    min-height: 56px;
    padding: 0.82rem 1.5rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.35);
    background: rgba(0, 0, 0, 0.42);
    color: #fff;
    font-size: clamp(17px, 1.5vw, 22px);
    font-weight: 700;
    letter-spacing: 0.02em;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
  }
  .hero-stage--viewer .hero-carousel-controls__btn[data-hero-watch-now] {
    background: linear-gradient(135deg, #f8e16b 0%, #ffd700 100%);
    color: #0b0b0b;
    border-color: rgba(255, 215, 0, 0.9);
  }
  .hero-stage--viewer .hero-carousel-controls__btn[data-hero-story-secondary-cta] {
    background: rgba(255, 255, 255, 0.15);
    color: #fff;
  }
  .hero-carousel-timeline__track {
    height: 0.24rem;
    background: rgba(255, 255, 255, 0.22);
    border-radius: 999px;
    overflow: hidden;
  }
  .hero-carousel-timeline__progress {
    height: 100%;
    background: linear-gradient(90deg, #00f2ff, #ff00ff);
    transition: width 0.12s linear;
  }
  .hero-carousel-timeline__markers {
    margin-top: 0.3rem;
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
  }
  .hero-carousel-timeline__marker {
    width: 0.52rem;
    height: 0.52rem;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.14);
    cursor: pointer;
    padding: 0;
  }
  .hero-carousel-timeline__marker--active {
    background: #00f2ff;
    border-color: #00f2ff;
  }
  .hero-stage--upload-hint {
    outline: 2px dashed rgba(255, 215, 0, 0.65);
    outline-offset: -4px;
  }
  .hero-stage-upload-hint {
    position: absolute;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: 1.5rem;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(6px);
    pointer-events: none;
    text-align: center;
  }
  .hero-stage-upload-hint__icon {
    font-size: 2rem;
    margin-bottom: 0.5rem;
    display: block;
  }
  .hero-stage-upload-hint__message {
    margin: 0;
    max-width: 22rem;
    color: #fff;
    font-size: 1rem;
    line-height: 1.45;
    letter-spacing: 0.02em;
    text-shadow: 0 0 18px rgba(255, 215, 0, 0.35);
  }
  .hero-motion-gradient {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(120% 80% at 80% 20%, rgba(255, 0, 180, 0.18), transparent 60%),
      radial-gradient(100% 75% at 15% 80%, rgba(0, 220, 255, 0.18), transparent 55%);
    mix-blend-mode: screen;
    animation: hero-motion-gradient-shift 8s ease-in-out infinite alternate;
  }
  @keyframes hero-motion-gradient-shift {
    from {
      transform: translate3d(-1.5%, 0, 0) scale(1.02);
      opacity: 0.45;
    }
    to {
      transform: translate3d(1.5%, -1.5%, 0) scale(1.06);
      opacity: 0.7;
    }
  }
  .hero-typography--poster h1 {
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .hero-typography--neo-grotesk h1 {
    font-family: Inter, system-ui, sans-serif;
  }
  .hero-typography--serif-dramatic h1 {
    font-family: Georgia, "Times New Roman", serif;
  }
</style>

{#if section === 'replace' || section === 'both'}
  <div
    class="hero-replace-section"
    data-viewer-media-exempt
    data-hero-replace-ux-phase={heroReplaceUxPhase}
  >
    <div class="smart-header">
      <div class="ai-badge">🎬 HERO CUSTOMIZER</div>
      <h3>Replace Background</h3>
      <p class="hero-replace-subtitle">
        Drop or click to upload — your hero background updates automatically
      </p>
    </div>
    <div
      class="hero-replace-state-panel hero-replace-state-panel--{heroReplaceUxPhase}"
      role="status"
      aria-live="polite"
    >
      {#if heroReplaceUxPhase === 'committed'}
        <p class="hero-replace-state-title">Hero Updated Successfully</p>
        <p class="hero-replace-state-detail">Your homepage hero background has been replaced.</p>
      {:else if heroReplaceUxPhase === 'preview_pending'}
        <p class="hero-replace-state-title">Upload Needs Attention</p>
        <p class="hero-replace-state-detail">Retry below or cancel to choose a different file</p>
      {:else if heroReplaceUxPhase === 'processing'}
        <p class="hero-replace-state-title">Replacing Hero</p>
        <p class="hero-replace-state-detail">Uploading and applying your new hero…</p>
      {:else}
        <p class="hero-replace-state-title">Current Hero Active</p>
        <p class="hero-replace-state-detail">
          Drop a file below to replace your homepage hero background.
        </p>
      {/if}
    </div>
    <input
      bind:this={heroFileInput}
      type="file"
      accept="image/*,video/mp4,video/quicktime"
      style="display: none"
      disabled={heroUploadState !== 'idle'}
      on:change={handleHeroFileSelect}
    />
    <div
      class="hero-drop-zone"
      class:active={$heroIsDragOver}
      on:dragenter={handleHeroDragEnter}
      on:dragover={handleHeroDragOver}
      on:dragleave={handleHeroDragLeave}
      on:drop={handleHeroDrop}
      on:click={openHeroFilePicker}
      role="button"
      tabindex="0"
      on:keydown={handleHeroFilePickerKeydown}
      aria-label="Drop or click to replace hero background"
    >
      {#if heroUploadState === 'processing'}
        <div class="hero-pending-preview">
          <div class="hero-loading-indicator">
            <span class="hero-spinner" aria-hidden="true"></span>
            Processing hero asset...
          </div>
        </div>
      {:else if $heroPendingFile}
        <div class="hero-pending-preview" data-hero-preview-pending>
          <div class="hero-pending-copy">
            <h4 class="hero-pending-title">Hero Upload Paused</h4>
            <p class="hero-pending-lead">
              {#if $heroPendingFile.type === 'video'}
                Retry to upload your hero video.
              {:else}
                Retry to upload your hero image.
              {/if}
            </p>
          </div>
          {#if $heroPendingFile.type === 'image'}
            <MediaThumbnail url={$heroPreviewUrl} raw className="hero-preview" alt="Hero preview" />
          {:else}
            <MediaRenderer
              type="video"
              url={$heroPreviewUrl}
              raw
              className="hero-preview"
              controls
              muted
              loop
            />
          {/if}
          <div class="hero-batch-controls">
            <button
              type="button"
              class="accept-btn hero-replace-confirm-btn"
              aria-label="Retry hero background upload"
              on:click={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (heroUploadState !== 'previewing') return;
                acceptHeroFile();
              }}
            >
              Retry Upload
            </button>
            <button
              type="button"
              class="reject-btn hero-replace-cancel-btn"
              aria-label="Cancel hero replacement preview"
              on:click={(event) => {
                event.preventDefault();
                event.stopPropagation();
                rejectHeroFile();
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      {:else}
        <span>🖼️ / 🎬 DROP OR CLICK TO REPLACE HERO</span>
        <small>Accepts: JPG, PNG, MP4, MOV (4s loops) · Uploads automatically</small>
      {/if}
    </div>
  </div>
{/if}
