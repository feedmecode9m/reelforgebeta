<script>
  import { get } from 'svelte/store';
  import { onDestroy, tick } from 'svelte';
  import { authenticateAdmin } from '../../lib/api.js';
  import {
    fetchStudioStatus,
    fetchStudioProjects,
    fetchProjectTree,
    createStudioSeries,
    createStudioSeason,
    createStudioEpisode,
    attachReelToEpisode,
    backfillStudioHierarchy
  } from '../../lib/api/studio.js';
  import { fetchContinueWatching } from '../../lib/api/watch.js';
  import {
    sanitizeGoogleDriveUrl,
    isValidVideoUrl,
    validateVideoFile
  } from '../../lib/runtime-guards.js';
  import { getLocalStorageSize, formatBytes } from '../../lib/storage.js';
  import PlatformConfigPanel from '../studio/PlatformConfigPanel.svelte';
  import StudioAmbientAudioPanel from '../studio/StudioAmbientAudioPanel.svelte';
  import StudioAppearancePanel from '../studio/StudioAppearancePanel.svelte';
  import SentinelSecurityCard from '../studio/SentinelSecurityCard.svelte';
  import SentinelAssistantPanel from '../studio/SentinelAssistantPanel.svelte';
  import CreatorOnboardingWizard from '../studio/CreatorOnboardingWizard.svelte';
  import HeroManagerPanel from '../studio/HeroManagerPanel.svelte';
  import MonetizationPanel from '../studio/MonetizationPanel.svelte';
  import MarketplaceDashboard from '../marketplace/MarketplaceDashboard.svelte';
  import RevenueDashboard from '../revenue/RevenueDashboard.svelte';
  import PlatformPublishingProfiles from '../studio/PlatformPublishingProfiles.svelte';
  import PublishingProfileSelector from '../publishing/PublishingProfileSelector.svelte';
  import SeriesMetadataEditor from '../series/SeriesMetadataEditor.svelte';
  import ContentIntelligencePanel from '../studio/ContentIntelligencePanel.svelte';
  import CollectionsManagerPanel from '../studio/CollectionsManagerPanel.svelte';
  import ProductionCommandCenter from '../studio/ProductionCommandCenter.svelte';
  import DeveloperDiagnosticsCenter from '../diagnostics/DeveloperDiagnosticsCenter.svelte';
  import EpisodeReelAttachmentPanel from '../studio/EpisodeReelAttachmentPanel.svelte';
  import { emitCreatorProductionUpdated } from '../../lib/studio/creatorActionRouter.js';
  import StudioWalkthrough from '../studio/StudioWalkthrough.svelte';
  import VaultExperience from './VaultExperience.svelte';
  import HeroExperience from './HeroExperience.svelte';
  import {
    consumeMediaUploadIntent,
    requestStudioContentTab
  } from '../../lib/dropAffordance.js';

  export let studioWalkthrough = null;

  export let controlCenterOpen;
  export let adminMode;
  export let uploadStatus;
  export let newTitle;
  export let newCategory;
  export let selectedFile;
  export let videoSource;
  export let dragActive;
  export let isAutoDetecting;
  export let detectedCategory;
  export let feed;
  export let categoryCounts;
  export let storageHealth;
  export let aiMaintenanceMode;
  export let isCleaning;
  export let lastAiCleanup;
  export let studioSeriesMetadataReelId;
  export let studioHierarchyEnabled;
  export let studioHierarchyLoading;
  export let studioHierarchyError;
  export let studioProjectTree;
  export let studioCatalogProjectId;
  export let studioFormSeriesTitle;
  export let studioFormSeasonNumber;
  export let studioFormEpisodeTitle;
  export let studioFormEpisodeNumber;
  export let studioSelectedSeriesId;
  export let studioSelectedSeasonId;
  export let studioAttachEpisodeId;
  export let studioAttachReelId;
  export let watchContinueEnabled;
  export let watchContinueItems;
  export let watchContinueLoading;
  export let personalThumbnailCollection;
  export let personalVideos;
  export let personalThumbnailIndex;
  export let pendingThumbnail;
  export let thumbnailDragActive;
  export let videoDragActive;
  export let personalStudioMode;
  export let usePersonalThumbnails;
  export let personalVideoCollection;
  export let HERO_BACKGROUND_VIDEO;
  export let HERO_POSTER_IMAGE;
  export let heroVideoLoaded;
  export let heroVideoFailed;
  export let heroRestoring;
  export let heroResumeToast;
  export let heroPendingFile;
  export let heroIsDragOver;
  export let heroPreviewUrl;

  export let CONFIG;
  export let resourceManager;
  export let UIAgent;
  export let AI_CLEANUP_AGENT;
  export let CATEGORY_DETECTOR;
  export let categoryNames;
  /** @type {{ saveTitle?: (reelId: string, titleData: { title?: string, title_original?: string }) => void } | null} */
  export let persistentTitles = null;
  export let matchToContent;
  export let vaultUtils;
  /** @type {(preserveLocal?: boolean) => Promise<void>} */
  export let syncFromVault;
  /** @type {(videos: unknown[]) => void} */
  export let persistPersonalVault;
  export let viewerHydrationReady;
  /** @type {(key: string, value: unknown) => { ok?: boolean }} */
  export let storageSet;
  /** @type {() => void} */
  export let clearApplicationCache;
  /** @type {() => void} */
  export let resetAllLocalData;
  /** @type {() => string} */
  export let getFallbackImage;
  /** @type {() => void} */
  export let startStudioWalkthrough;
  /** @type {() => void} */
  export let toggleControlCenter;
  /** @type {() => void} */
  export let logout;
  /** @type {(event: CustomEvent) => void} */
  export let handleEpisodeAssetChanged;

  export let studioFeedReels = [];
  export let studioSeriesMetadataReelOptions = [];
  export let studioSeriesMetadataReelLabel = '';
  /** @type {import('svelte/store').Writable<boolean>} */
  export let isDeleting;
  /** @type {import('svelte/store').Writable<Record<string, unknown> | null>} */
  export let deleteConfirmReel;

  let adminPasswordInput = '';
  let adminLoginError = '';
  let adminInputElement;
  let controlCenterDialog = null;
  let controlCenterFocusTrapActive = false;
  let controlCenterWasOpen = false;
  let previousFocusedElement = null;

  /** Studio inventory browse controls (view-only; do not mutate $feed). */
  let studioInventoryQuery = '';
  /** @type {'newest' | 'oldest' | 'title'} */
  let studioInventorySort = 'newest';

  /** @type {string | null} */
  let renameBusyId = null;
  /** @type {Record<string, { kind: 'saving' | 'saved' | 'local' | 'error'; message: string }>} */
  let renameRowFeedback = {};

  /** Selection by canonical reel.id only (UI foundation; does not mutate $feed). */
  /** @type {Record<string, true>} */
  let studioInventorySelected = {};
  /** @type {HTMLInputElement | null} */
  let studioSelectAllCheckbox = null;
  /**
   * UI-only bulk action lifecycle. Never triggers API/mutation.
   * @type {'idle' | 'reviewing' | 'confirming' | 'executing' | 'success' | 'failed'}
   */
  let studioBulkActionState = 'idle';

  /**
   * Map known backend/catalog status only — do not invent states.
   * @param {Record<string, unknown> | null | undefined} reel
   */
  function resolveProductionStatus(reel) {
    const status = String(reel?.status || '').trim().toLowerCase();
    if (status === 'pending' || status === 'processing' || status === 'ready' || status === 'failed') {
      return status;
    }
    return '';
  }

  /**
   * @param {Record<string, unknown> | null | undefined} reel
   */
  function resolveProductionType(reel) {
    const type = String(reel?.type || '').trim().toLowerCase();
    if (type === 'video' || type === 'image') return type;
    if (reel?.isCatalogImage || reel?.isPersonalThumbnail) return 'image';
    if (reel?.isPersonalVideo) return 'video';
    return '';
  }

  /**
   * @param {string} reelId
   * @param {'saving' | 'saved' | 'local' | 'error'} kind
   * @param {string} message
   */
  function setRenameRowFeedback(reelId, kind, message) {
    if (!reelId) return;
    renameRowFeedback = { ...renameRowFeedback, [reelId]: { kind, message } };
  }

  function clearRenameRowFeedback(reelId) {
    if (!reelId || !renameRowFeedback[reelId]) return;
    const next = { ...renameRowFeedback };
    delete next[reelId];
    renameRowFeedback = next;
  }

  /** @param {unknown} reelId */
  function normalizeInventorySelectionId(reelId) {
    return String(reelId ?? '').trim();
  }

  /**
   * Selectable = canonical id present and not a placeholder.
   * @param {Record<string, unknown> | null | undefined} reel
   */
  function isSelectableInventoryReel(reel) {
    if (!reel || reel.isPlaceholder) return false;
    return !!normalizeInventorySelectionId(reel.id);
  }

  /** @param {string} id */
  function findInventoryReelById(id) {
    const needle = normalizeInventorySelectionId(id);
    if (!needle) return null;
    return (
      studioInventoryBase.find((reel) => normalizeInventorySelectionId(reel?.id) === needle) || null
    );
  }

  function setBulkActionState(next) {
    const allowed = new Set(['idle', 'reviewing', 'confirming', 'executing', 'success', 'failed']);
    if (!allowed.has(next)) return;
    // Safety: never enter executing — no bulk mutation path exists yet.
    if (next === 'executing' || next === 'success' || next === 'failed') {
      studioBulkActionState = studioInventorySelectedCount > 0 ? 'reviewing' : 'idle';
      return;
    }
    studioBulkActionState = next;
  }

  /** @param {string | number | null | undefined} reelId */
  function toggleInventorySelection(reelId) {
    const id = normalizeInventorySelectionId(reelId);
    if (!id) return;
    const currentlySelected = !!studioInventorySelected[id];
    if (!currentlySelected) {
      const reel = findInventoryReelById(id);
      if (!isSelectableInventoryReel(reel)) return;
    }
    const next = { ...studioInventorySelected };
    if (currentlySelected) delete next[id];
    else next[id] = true;
    studioInventorySelected = next;
  }

  function selectAllVisibleInventory() {
    const next = { ...studioInventorySelected };
    for (const reel of studioInventoryView) {
      if (!isSelectableInventoryReel(reel)) continue;
      next[normalizeInventorySelectionId(reel.id)] = true;
    }
    studioInventorySelected = next;
  }

  function clearVisibleInventorySelection() {
    const next = { ...studioInventorySelected };
    for (const reel of studioInventoryView) {
      const id = normalizeInventorySelectionId(reel?.id);
      if (id) delete next[id];
    }
    studioInventorySelected = next;
  }

  function clearInventorySelection() {
    studioInventorySelected = {};
    setBulkActionState('idle');
  }

  function toggleSelectAllVisibleInventory() {
    if (studioInventoryAllVisibleSelected) clearVisibleInventorySelection();
    else selectAllVisibleInventory();
  }

  function enterBulkConfirmPreview() {
    if (studioInventorySelectedCount === 0) return;
    setBulkActionState('confirming');
  }

  function cancelBulkConfirmPreview() {
    setBulkActionState(studioInventorySelectedCount > 0 ? 'reviewing' : 'idle');
  }

  /** Full production inventory from feed — placeholders excluded, no visibility cap. */
  $: studioInventoryBase = Object.values($feed || {})
    .flat()
    .filter((reel) => reel && !reel.isPlaceholder);

  /** Filtered/sorted view of studioInventoryBase for operator browsing. */
  $: studioInventoryView = (() => {
    const q = studioInventoryQuery.trim().toLowerCase();
    const list = [...studioInventoryBase];
    const filtered = q
      ? list.filter((reel) => {
          const title = String(reel.title || reel.name || '').toLowerCase();
          const fileName = String(reel.file_name || reel.fileName || '').toLowerCase();
          const category = String(reel.category || '').toLowerCase();
          const status = String(reel.status || '').toLowerCase();
          return (
            title.includes(q) ||
            fileName.includes(q) ||
            category.includes(q) ||
            (status && status.includes(q))
          );
        })
      : list;
    if (studioInventorySort === 'oldest') {
      filtered.sort(
        (a, b) =>
          new Date(a.created_at || a.createdAt || 0).getTime() -
          new Date(b.created_at || b.createdAt || 0).getTime()
      );
    } else if (studioInventorySort === 'title') {
      filtered.sort((a, b) =>
        String(a.title || a.name || '').localeCompare(String(b.title || b.name || ''), undefined, {
          sensitivity: 'base'
        })
      );
    } else {
      filtered.sort(
        (a, b) =>
          new Date(b.created_at || b.createdAt || 0).getTime() -
          new Date(a.created_at || a.createdAt || 0).getTime()
      );
    }
    return filtered;
  })();

  $: studioInventoryVisibleIds = studioInventoryView
    .filter((reel) => isSelectableInventoryReel(reel))
    .map((reel) => normalizeInventorySelectionId(reel.id));
  $: studioInventorySelectedIds = Object.keys(studioInventorySelected);
  $: studioInventorySelectedCount = studioInventorySelectedIds.length;
  $: studioInventorySelectedSummary = studioInventorySelectedIds.map((id) => {
    const reel = findInventoryReelById(id);
    return {
      id,
      title: String(reel?.title || reel?.name || id),
      category: String(reel?.category || ''),
      status: resolveProductionStatus(reel)
    };
  });
  $: studioInventoryAllVisibleSelected =
    studioInventoryVisibleIds.length > 0 &&
    studioInventoryVisibleIds.every((id) => !!studioInventorySelected[id]);
  $: studioInventorySomeVisibleSelected =
    studioInventoryVisibleIds.some((id) => !!studioInventorySelected[id]) &&
    !studioInventoryAllVisibleSelected;
  $: if (studioSelectAllCheckbox) {
    studioSelectAllCheckbox.indeterminate = studioInventorySomeVisibleSelected;
  }

  // Drop selections for ids no longer selectable (deleted / placeholder / missing).
  $: {
    const validIds = new Set(
      studioInventoryBase
        .filter((reel) => isSelectableInventoryReel(reel))
        .map((reel) => normalizeInventorySelectionId(reel.id))
    );
    const selectedIds = Object.keys(studioInventorySelected);
    if (selectedIds.some((id) => !validIds.has(id))) {
      const next = /** @type {Record<string, true>} */ ({});
      for (const id of selectedIds) {
        if (validIds.has(id)) next[id] = true;
      }
      studioInventorySelected = next;
    }
  }

  // Keep bulk UI state aligned with selection — never invent executing/success/failed.
  $: if (studioInventorySelectedCount === 0 && studioBulkActionState !== 'idle') {
    studioBulkActionState = 'idle';
  } else if (studioInventorySelectedCount > 0 && studioBulkActionState === 'idle') {
    studioBulkActionState = 'reviewing';
  }

  const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(', ');

  /** @param {CustomEvent<{ reelId?: string }>} event */
  function handleMetadataSaved(event) {
    const reelId = event.detail?.reelId || '';
    emitCreatorProductionUpdated({
      reelId,
      actionType: 'missing-metadata',
      source: 'metadata-editor'
    });
    if (typeof handleEpisodeAssetChanged === 'function') {
      handleEpisodeAssetChanged();
    }
  }

  export async function handleUploadWithFaces() {
    const title = get(newTitle);
    const sourceUrl = get(videoSource);
    const file = get(selectedFile);
    const categoryChoice = get(newCategory);

    if (!title || (!sourceUrl && !file)) {
      uploadStatus.set('ERROR: TITLE AND VIDEO REQUIRED');
      return;
    }

    let targetCategory = categoryChoice;
    let detectionResult = null;

    if (categoryChoice === 'Auto-Detect') {
      uploadStatus.set('🔍 AUTO-DETECTING...');
      detectionResult = await CATEGORY_DETECTOR.recommendCategory(title, file);
      targetCategory = detectionResult.category;
      uploadStatus.set(`✅ AUTO-PLACED: ${targetCategory} (${detectionResult.confidence})`);
    }

    uploadStatus.set(`📤 UPLOADING TO ${targetCategory}...`);
    try {
      let videoRef = file
        ? resourceManager.addBlobUrl(URL.createObjectURL(file))
        : sanitizeGoogleDriveUrl(sourceUrl.trim());

      if (file) {
        const validation = await validateVideoFile(file);
        if (!validation.valid) {
          uploadStatus.set(`ERROR: ${validation.reason || 'Invalid video file'}`);
          return;
        }
        const token =
          typeof window !== 'undefined' ? localStorage.getItem('reelforge_admin_session_token') : null;
        const { uploadMedia } = await import('../../lib/api/media.js');
        const { getAdminAuthorizationHeader } = await import('../../lib/api.js');
        const formData = new FormData();
        formData.append('video', file);
        formData.append('title', title);
        formData.append('category', targetCategory);
        await uploadMedia(formData, getAdminAuthorizationHeader(token));
        uploadStatus.set(`✅ SUCCESS! Placed in ${targetCategory}`);
        newTitle.set('');
        videoSource.set('');
        selectedFile.set(null);
        newCategory.set('Auto-Detect');
        forceDisplayInStudio();
        await syncFromVault(true);
        return;
      }

      if (!isValidVideoUrl(videoRef)) {
        uploadStatus.set('ERROR: Invalid video URL — use a direct MP4/MOV link or browse a file');
        return;
      }

      const thumbnailUrl = matchToContent(title, targetCategory, 0) || getFallbackImage();
      const payload = {
        id: crypto.randomUUID(),
        title,
        category: targetCategory,
        video_url: videoRef,
        thumbnail_url: thumbnailUrl,
        normalized_thumbnail: thumbnailUrl,
        likes: 0,
        auto_detected: categoryChoice === 'Auto-Detect',
        detection_confidence: detectionResult?.confidence || 'Manual',
        created_at: new Date().toISOString(),
        type: 'video'
      };

      const vault = JSON.parse(
        (typeof window !== 'undefined' ? localStorage.getItem(CONFIG.VAULT_KEY) : null) || '[]'
      );
      vault.push(payload);
      storageSet(CONFIG.VAULT_KEY, vault);
      uploadStatus.set(`✅ SUCCESS! Placed in ${targetCategory}`);
      newTitle.set('');
      videoSource.set('');
      selectedFile.set(null);
      newCategory.set('Auto-Detect');
      forceDisplayInStudio();
      await syncFromVault(true);
    } catch (error) {
      console.error('Upload error:', error);
      uploadStatus.set('❌ UPLOAD FAILED');
    }
  }

  export function detectCategoryFromTitle() {
    const title = get(newTitle);
    if (!title || title.length < 3) {
      detectedCategory.set('');
      return;
    }
    resourceManager.setTimeout(() => {
      if (get(newCategory) === 'Auto-Detect') {
        const suggested = CATEGORY_DETECTOR.detectFromTitle(title);
        detectedCategory.set(suggested);
        uploadStatus.set(`🎯 SUGGESTED: ${suggested}`);
        resourceManager.setTimeout(() => {
          if (get(uploadStatus).includes('SUGGESTED')) uploadStatus.set('Standby');
        }, 3000);
      }
    }, 500);
  }

  export async function attemptAdminLogin() {
    const password = adminPasswordInput.trim();
    if (!password) {
      adminLoginError = '❌ Password cannot be empty';
      return;
    }
    try {
      const result = await authenticateAdmin(password);
      if (result.success) {
        storageSet('reelforge_admin_session_token', result.token || 'backend_token');
        adminMode.set(true);
        controlCenterOpen.set(true);
        adminLoginError = '';
        adminPasswordInput = '';
        uploadStatus.set('✅ Admin access granted');
        setTimeout(() => uploadStatus.set('Standby'), 2000);
        await loadWatchContinue();
        return;
      }
      adminLoginError = '❌ Authentication failed';
    } catch (error) {
      console.warn('⚠️ Backend unreachable, attempting secure local dev fallback:', error.message);
      const localPasswords = ['Gaff1505!', 'SMART_PRODUCTION', CONFIG.ADMIN_PASSWORD || 'admin123'];
      if (localPasswords.includes(password)) {
        storageSet('reelforge_admin_session_token', 'dev_local_session');
        adminMode.set(true);
        controlCenterOpen.set(true);
        adminLoginError = '';
        adminPasswordInput = '';
        uploadStatus.set('✅ Admin access granted (Local Dev Mode)');
        setTimeout(() => uploadStatus.set('Standby'), 2000);
        await loadWatchContinue();
      } else {
        adminLoginError = '❌ Authentication failed: Backend unreachable & password incorrect';
      }
    }
  }

  export async function loadWatchContinue() {
    watchContinueLoading.set(true);
    try {
      const result = await fetchContinueWatching({ limit: 10 });
      if (result.disabled) {
        watchContinueEnabled.set(false);
        watchContinueItems.set([]);
      } else {
        watchContinueEnabled.set(true);
        watchContinueItems.set(result.items || []);
      }
    } catch {
      watchContinueEnabled.set(false);
      watchContinueItems.set([]);
    } finally {
      watchContinueLoading.set(false);
    }
  }

  export async function loadStudioHierarchy() {
    studioHierarchyLoading.set(true);
    studioHierarchyError.set('');
    try {
      const status = await fetchStudioStatus();
      if (status?.disabled) {
        studioHierarchyEnabled.set(false);
        studioProjectTree.set(null);
        return;
      }
      studioHierarchyEnabled.set(true);
      const projects = await fetchStudioProjects();
      if (!projects?.length) {
        studioProjectTree.set(null);
        return;
      }
      studioCatalogProjectId.set(projects[0].id);
      const tree = await fetchProjectTree(projects[0].id);
      studioProjectTree.set(tree);
    } catch (error) {
      studioHierarchyEnabled.set(false);
      studioHierarchyError.set(error?.message || 'Failed to load studio hierarchy');
    } finally {
      studioHierarchyLoading.set(false);
    }
  }

  export async function runStudioBackfill() {
    try {
      uploadStatus.set('🔄 Backfilling reel hierarchy...');
      const result = await backfillStudioHierarchy();
      await loadStudioHierarchy();
      uploadStatus.set(
        `✅ Backfill: ${result.episodes_created} episodes, ${result.reels_unlinked} unlinked`
      );
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 3000);
    } catch (error) {
      uploadStatus.set(`❌ Backfill failed: ${error.message}`);
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 3000);
    }
  }

  export async function handleCreateStudioSeries() {
    const title = get(studioFormSeriesTitle).trim();
    const projectId = get(studioCatalogProjectId);
    if (!title || !projectId) return;
    try {
      await createStudioSeries({ project_id: projectId, title });
      studioFormSeriesTitle.set('');
      await loadStudioHierarchy();
      uploadStatus.set(`✅ Series "${title}" created`);
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
    } catch (error) {
      uploadStatus.set(`❌ ${error.message}`);
    }
  }

  export async function handleCreateStudioSeason() {
    const seriesId = get(studioSelectedSeriesId);
    if (!seriesId) return;
    try {
      await createStudioSeason({
        series_id: seriesId,
        season_number: Number(get(studioFormSeasonNumber)) || 1,
        title: `Season ${Number(get(studioFormSeasonNumber)) || 1}`
      });
      await loadStudioHierarchy();
      uploadStatus.set('✅ Season created');
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
    } catch (error) {
      uploadStatus.set(`❌ ${error.message}`);
    }
  }

  export async function handleCreateStudioEpisode() {
    const seasonId = get(studioSelectedSeasonId);
    const title = get(studioFormEpisodeTitle).trim();
    if (!seasonId || !title) return;
    try {
      await createStudioEpisode({
        season_id: seasonId,
        episode_number: Number(get(studioFormEpisodeNumber)) || 1,
        title
      });
      studioFormEpisodeTitle.set('');
      await loadStudioHierarchy();
      uploadStatus.set(`✅ Episode "${title}" created`);
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
    } catch (error) {
      uploadStatus.set(`❌ ${error.message}`);
    }
  }

  export async function handleAttachReelToEpisode() {
    const episodeId = get(studioAttachEpisodeId);
    const reelId = get(studioAttachReelId);
    if (!episodeId || !reelId) return;
    try {
      await attachReelToEpisode(episodeId, reelId);
      studioAttachEpisodeId.set('');
      studioAttachReelId.set('');
      await loadStudioHierarchy();
      uploadStatus.set('✅ Reel attached to episode');
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
    } catch (error) {
      uploadStatus.set(`❌ ${error.message}`);
    }
  }

  export function forceDisplayInStudio() {
    uploadStatus.set('🔄 SYNCHRONIZING...');
    resourceManager.setTimeout(() => {
      uploadStatus.set('✅ CONTENT VISIBLE');
      if (get(adminMode)) feed.update((current) => ({ ...current }));
    }, 1000);
  }

  export async function updateReelTitle(reel, nextTitle) {
    if (!reel?.id || !nextTitle?.trim()) return;
    const trimmed = nextTitle.trim();
    // Compare against title_original only — do not fall back to reel.title.
    // Input handlers mutate reel.title before blur/Enter, which would skip persistence.
    const original = String(reel.title_original ?? '').trim();
    if (original && trimmed === original) {
      reel.title = trimmed;
      return;
    }
    const reelId = String(reel.id);
    reel.title = trimmed;
    reel.title_original = trimmed;
    reel._localModified = true;
    // Durable title source: canonical reel.id → persistentTitles / TITLES_STORAGE_KEY
    persistentTitles?.saveTitle?.(reelId, {
      title: trimmed,
      title_original: trimmed
    });
    feed.update((currentFeed) => {
      const next = { ...currentFeed };
      Object.keys(next).forEach((cat) => {
        next[cat] = next[cat].map((item) =>
          item.id === reel.id
            ? { ...item, title: trimmed, title_original: trimmed, _localModified: true }
            : item
        );
      });
      return next;
    });
    renameBusyId = reelId;
    setRenameRowFeedback(reelId, 'saving', 'Saving…');
    uploadStatus.set(`💾 SAVING: "${trimmed}"...`);
    let syncedWithBackend = false;
    try {
      const res = await fetch(`/api/reels/${reel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed })
      });
      if (res.ok) {
        const updated = await res.json();
        reel.title = updated.title || trimmed;
        reel._syncedWithBackend = true;
        syncedWithBackend = true;
        setRenameRowFeedback(reelId, 'saved', 'Synced');
        uploadStatus.set(`✅ SYNCED: "${reel.title}"`);
      } else {
        throw new Error(`Backend error ${res.status}`);
      }
    } catch {
      // Backend title PATCH is unavailable — keep local persistence; do not claim sync.
      setRenameRowFeedback(reelId, 'local', 'Saved locally');
      uploadStatus.set(`✅ SAVED LOCALLY: "${trimmed}"`);
    }
    // Avoid destructive resync after failed title persistence (would rebuild from backend titles).
    if (syncedWithBackend) {
      resourceManager.setTimeout(() => syncFromVault(true), 500);
    }
    resourceManager.setTimeout(() => {
      if (renameBusyId === reelId) renameBusyId = null;
      clearRenameRowFeedback(reelId);
      uploadStatus.set('Standby');
    }, 2000);
  }

  export async function unveilToCloud(source) {
    const reelLike = typeof source === 'object' ? source : { url: source };
    const src = reelLike.url || reelLike.video_url;
    if (!src || !isValidVideoUrl(sanitizeGoogleDriveUrl(src))) {
      uploadStatus.set('⚠️ No valid video source to unveil');
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2500);
      return;
    }
    uploadStatus.set('🚀 Unveiling to cloud vault...');
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`Could not read video (${response.status})`);
      const blob = await response.blob();
      const validation = await validateVideoFile(blob);
      if (!validation.valid) throw new Error(validation.reason || 'Invalid video file');
      const filename = src.split('/').pop() || 'video.mp4';
      const file = new File([blob], filename, { type: blob.type || 'video/mp4' });
      const formData = new FormData();
      formData.append('video', file);
      const token =
        typeof window !== 'undefined' ? localStorage.getItem('reelforge_admin_session_token') : null;
      const { uploadMedia } = await import('../../lib/api/media.js');
      const { getAdminAuthorizationHeader } = await import('../../lib/api.js');
      await uploadMedia(formData, getAdminAuthorizationHeader(token));
      uploadStatus.set(`✅ Unveiled ${filename} to vault`);
      await syncFromVault(true);
    } catch (error) {
      console.error('unveilToCloud failed:', error);
      uploadStatus.set(`❌ Unveil failed: ${error.message}`);
    } finally {
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 3000);
    }
  }

  function handleOverlayClick(event) {
    if (event.target === event.currentTarget) toggleControlCenter();
  }

  function getOverlayFocusableElements() {
    if (!controlCenterDialog) return [];
    return Array.from(controlCenterDialog.querySelectorAll(FOCUSABLE_SELECTOR));
  }

  async function activateOverlayFocusTrap() {
    if (typeof document === 'undefined') return;
    controlCenterFocusTrapActive = true;
    previousFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await tick();
    const focusable = getOverlayFocusableElements();
    (focusable[0] || controlCenterDialog)?.focus();
  }

  function restoreOverlayFocus() {
    if (previousFocusedElement && typeof previousFocusedElement.focus === 'function') {
      previousFocusedElement.focus();
    }
    previousFocusedElement = null;
  }

  function handleWindowOverlayKeydown(event) {
    if (!$controlCenterOpen) return;
    if (!controlCenterDialog) return;
    const active = document.activeElement;
    if (active && !controlCenterDialog.contains(active)) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      toggleControlCenter();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = getOverlayFocusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      controlCenterDialog?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  $: if ($controlCenterOpen && !controlCenterFocusTrapActive) {
    void activateOverlayFocusTrap();
  }

  $: if (!$controlCenterOpen && controlCenterFocusTrapActive) {
    controlCenterFocusTrapActive = false;
    restoreOverlayFocus();
  }

  $: if ($controlCenterOpen && $adminMode && !controlCenterWasOpen) {
    controlCenterWasOpen = true;
    if (consumeMediaUploadIntent()) {
      requestStudioContentTab({ scrollUploadZones: true, source: 'media-upload-intent' });
    }
  } else if (!$controlCenterOpen) {
    controlCenterWasOpen = false;
  }

  onDestroy(() => {
    restoreOverlayFocus();
  });
</script>

<svelte:window on:keydown={handleWindowOverlayKeydown} />

<StudioWalkthrough
  bind:this={studioWalkthrough}
  feedReels={studioFeedReels}
  seriesId={$studioSelectedSeriesId || 'series-neon-vengeance'}
/>

{#if $controlCenterOpen}
  <div
    class="control-center-overlay smart-studio-overlay"
    role="presentation"
    on:click={handleOverlayClick}
  >
    <div
      bind:this={controlCenterDialog}
      class="control-center-container"
      role="dialog"
      aria-modal="true"
      aria-label="Smart Production Studio"
      tabindex="-1"
      data-studio-theme-shell
    >
      <header class="control-center-header">
        <div>
          <h2>🤖 SMART PRODUCTION STUDIO</h2>
          <p>AI-Powered Content Placement & Health Maintenance</p>
        </div>
        <div class="control-center-actions">
          {#if $adminMode}
            <button
              type="button"
              class="guide-me-btn"
              data-studio-guide-me
              on:click={startStudioWalkthrough}
              title="Guide Me production coach"
            >
              Guide Me
            </button>
            <button type="button" class="refresh-btn" on:click={() => syncFromVault(true)} title="Refresh content">
              🔄
            </button>
            <button type="button" class="logout-btn" on:click={logout} title="Logout Admin">🔐 LOGOUT</button>
          {/if}
          <button type="button" class="close-x" on:click={toggleControlCenter}>✕</button>
        </div>
      </header>

      {#if $adminMode}
        <ProductionCommandCenter
          feedReels={studioFeedReels}
          on:changed={handleEpisodeAssetChanged}
        >
          <div slot="production" class="studio-workspace-slot forge-zone">
<CreatorOnboardingWizard
  seriesId={studioFeedReels?.[0]?.seriesId || 'series-neon-vengeance'}
  feedReels={studioFeedReels}
/>
<EpisodeReelAttachmentPanel
  {uploadStatus}
  {studioAttachEpisodeId}
  {studioAttachReelId}
  personalVideos={$personalVideos}
  studioProjectTree={$studioProjectTree}
  loadStudioHierarchy={loadStudioHierarchy}
  onAttached={handleEpisodeAssetChanged}
/>
<div class="smart-header">
              <div class="ai-badge">AI-POWERED</div>
              <h3>Smart Category Detection Active</h3>
              <p class="smart-subtitle">Content will be automatically placed in optimal category</p>
            </div>
            <label class="input-label-wrapper">
              PRODUCTION TITLE *
              <input
                bind:value={$newTitle}
                placeholder="e.g. 'Barbershop Stories'"
                on:input={detectCategoryFromTitle}
              />
            </label>
            <div class="category-detection-hint">
              {#if $detectedCategory && $newCategory === 'Auto-Detect'}
                <div class="detection-preview">
                  <span class="detection-icon">🎯</span>
                  <span class="detection-text">
                    Will place in:
                    <strong style="color: {UIAgent.getStudioConfigs($detectedCategory).color}">
                      {$detectedCategory}
                    </strong>
                  </span>
                </div>
              {/if}
            </div>
            <label class="input-label-wrapper">
              CATEGORY PLACEMENT
              <div class="category-selector">
                <select bind:value={$newCategory}>
                  {#each CONFIG.CATEGORIES as cat}
                    <option value={cat}>
                      {#if cat === 'Auto-Detect'}
                        🤖 {cat} (Recommended)
                      {:else}
                        📁 {cat}
                      {/if}
                    </option>
                  {/each}
                </select>
              </div>
            </label>
            <label class="input-label-wrapper">
              VIDEO SOURCE
              <div class="source-options">
                <div class="url-input">
                  <input bind:value={$videoSource} placeholder="https://example.com/video.mp4" />
                  <span class="input-label-or">OR</span>
                </div>
                <div class="file-upload-section">
                  <button class="browse-btn" on:click={UIAgent.handleFileBrowse}>📁 BROWSE FOR VIDEO FILE</button>
                  <div
                    class="file-drop-zone"
                    class:active={$dragActive}
                    on:dragenter={() => dragActive.set(true)}
                    on:dragleave={() => dragActive.set(false)}
                    on:dragover={(event) => {
                      event.preventDefault();
                      dragActive.set(true);
                    }}
                    on:drop={UIAgent.handleDrop}
                    role="group"
                    aria-label="Video file drop zone"
                  >
                    <span>Or drop video file here</span>
                  </div>
                  {#if $selectedFile}
                    <div class="file-info">
                      <div class="file-details">
                        <span class="file-name">🎬 {$selectedFile?.name}</span>
                        <span class="file-size">
                          ({($selectedFile?.size / 1024 / 1024).toFixed(1)} MB)
                        </span>
                      </div>
                      <button
                        class="clear-file"
                        on:click={() => {
                          selectedFile.set(null);
                          videoSource.set('');
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  {/if}
                </div>
              </div>
            </label>
            {#if $isAutoDetecting}
              <div class="processing-indicator">
                <div class="processing-spinner"></div>
                <span>🤖 ANALYZING...</span>
              </div>
            {/if}
            <button
              class="submit-btn {$newCategory === 'Auto-Detect' ? 'ai-submit' : ''}"
              on:click={handleUploadWithFaces}
              disabled={$isAutoDetecting}
            >
              {#if $isAutoDetecting}
                <span class="ai-thinking">🤖 Analyzing...</span>
              {:else if $newCategory === 'Auto-Detect'}
                <span class="ai-upload">📤 UPLOAD WITH SMART PLACEMENT</span>
              {:else}
                <span>📤 UPLOAD TO {$newCategory}</span>
              {/if}
            </button>
          <div class="studio-hierarchy-section">
            <div class="smart-header">
              <div class="ai-badge">📁 PRODUCTION HIERARCHY</div>
              <h3>Project → Series → Season → Episode</h3>
              <p class="smart-subtitle">Additive metadata layer — playback unchanged</p>
            </div>
            {#if $studioHierarchyLoading}
              <p class="hierarchy-hint">Loading hierarchy...</p>
            {:else if !$studioHierarchyEnabled}
              <p class="hierarchy-hint">
                Studio hierarchy API disabled. Set <code>REELFORGE_STUDIO_HIERARCHY=true</code> on the
                backend.
              </p>
            {:else if $studioHierarchyError}
              <p class="hierarchy-error">{$studioHierarchyError}</p>
            {:else}
              <div class="hierarchy-actions">
                <button class="force-cleanup-btn" type="button" on:click={runStudioBackfill}>
                  ↻ Backfill reels → episodes
                </button>
                <button class="force-cleanup-btn" type="button" on:click={loadStudioHierarchy}>
                  🔄 Refresh tree
                </button>
              </div>
              {#if $studioProjectTree}
                <p class="hierarchy-project-name"><strong>{$studioProjectTree.name}</strong></p>
                <div class="hierarchy-tree">
                  {#each $studioProjectTree.series as series}
                    <details class="hierarchy-series" open>
                      <summary>
                        {series.title}
                        <span class="hierarchy-meta">({series.seasons?.length || 0} seasons)</span>
                      </summary>
                      {#each series.seasons as season}
                        <details class="hierarchy-season">
                          <summary>
                            S{season.season_number}{#if season.title}: {season.title}{/if}
                            <span class="hierarchy-meta">({season.episodes?.length || 0} eps)</span>
                          </summary>
                          <ul class="hierarchy-episodes">
                            {#each season.episodes as episode}
                              <li>
                                S{season.season_number}E{episode.episode_number} — {episode.title}
                                {#if episode.reel_id}
                                  <span class="hierarchy-reel-badge" title={episode.reel_id}>🎬 linked</span>
                                {:else}
                                  <span class="hierarchy-reel-badge orphan">no reel</span>
                                {/if}
                              </li>
                            {/each}
                          </ul>
                        </details>
                      {/each}
                    </details>
                  {/each}
                  {#if !$studioProjectTree.series?.length}
                    <p class="hierarchy-hint">No series yet — create one below or run backfill.</p>
                  {/if}
                </div>
              {/if}
              <div class="hierarchy-forms">
                <label class="input-label-wrapper">
                  NEW SERIES
                  <input bind:value={$studioFormSeriesTitle} placeholder="Series title" />
                </label>
                <button
                  class="quick-upload-btn"
                  type="button"
                  on:click={handleCreateStudioSeries}
                  disabled={!$studioFormSeriesTitle.trim()}
                >
                  + Add series
                </button>
                <label class="input-label-wrapper">
                  SERIES
                  <select bind:value={$studioSelectedSeriesId}>
                    <option value="">Select series...</option>
                    {#each $studioProjectTree?.series || [] as series}
                      <option value={series.id}>{series.title}</option>
                    {/each}
                  </select>
                </label>
                <label class="input-label-wrapper">
                  SEASON #
                  <input type="number" min="1" bind:value={$studioFormSeasonNumber} />
                </label>
                <button
                  class="quick-upload-btn"
                  type="button"
                  on:click={handleCreateStudioSeason}
                  disabled={!$studioSelectedSeriesId}
                >
                  + Add season
                </button>
                <label class="input-label-wrapper">
                  SEASON
                  <select bind:value={$studioSelectedSeasonId}>
                    <option value="">Select season...</option>
                    {#each ($studioProjectTree?.series || [])
                      .flatMap((series) =>
                        (series.seasons || []).map((season) => ({ ...season, seriesTitle: series.title }))
                      ) as season}
                      <option value={season.id}>{season.seriesTitle} — S{season.season_number}</option>
                    {/each}
                  </select>
                </label>
                <label class="input-label-wrapper">
                  EPISODE #
                  <input type="number" min="1" bind:value={$studioFormEpisodeNumber} />
                </label>
                <label class="input-label-wrapper">
                  EPISODE TITLE
                  <input bind:value={$studioFormEpisodeTitle} placeholder="Episode title" />
                </label>
                <button
                  class="quick-upload-btn"
                  type="button"
                  on:click={handleCreateStudioEpisode}
                  disabled={!$studioSelectedSeasonId || !$studioFormEpisodeTitle.trim()}
                >
                  + Add episode
                </button>
              </div>
            {/if}
          </div>
          </div>
          <div slot="content" class="studio-workspace-slot">
<div class="series-metadata-studio-section">
              <div class="smart-header">
                <div class="ai-badge">📺 SERIES METADATA</div>
                <h3>Episode Catalog Editor</h3>
                <p class="smart-subtitle">
                  Edit series fields — persisted to localStorage, read by Theater
                </p>
              </div>
              <label class="input-label-wrapper">
                LINK TO REEL
                <select bind:value={$studioSeriesMetadataReelId}>
                  <option value="">Select production reel...</option>
                  {#each studioSeriesMetadataReelOptions as reel (reel.id)}
                    <option value={reel.id}>{reel.title || reel.name || reel.id}</option>
                  {/each}
                </select>
              </label>
              <SeriesMetadataEditor
                reelId={$studioSeriesMetadataReelId}
                reelLabel={studioSeriesMetadataReelLabel}
                on:saved={handleMetadataSaved}
              />
            </div>
            <PublishingProfileSelector />
            <div class="personal-studio-section" data-content-panel="assets">
              <div class="smart-header">
                <div class="ai-badge">🎬 PERSONAL CONTENT STUDIO</div>
                <h3>Media Vault</h3>
                <p class="smart-subtitle">
                  Upload, browse, and drag media into the feed — synced with the backend catalog
                </p>
              </div>

              <VaultExperience
                {personalThumbnailCollection}
                {personalVideos}
                {personalThumbnailIndex}
                {pendingThumbnail}
                {thumbnailDragActive}
                {videoDragActive}
                {uploadStatus}
                {personalStudioMode}
                {usePersonalThumbnails}
                {personalVideoCollection}
                {newTitle}
                {feed}
                {CONFIG}
                {resourceManager}
                {AI_CLEANUP_AGENT}
                {UIAgent}
                {vaultUtils}
                {syncFromVault}
                {persistPersonalVault}
                {storageSet}
                {getFallbackImage}
              />
            </div>
            <ContentIntelligencePanel />
            <CollectionsManagerPanel />
            <div class="asset-manager" data-content-panel="collections">
            <div class="smart-header">
              <div class="ai-badge">LIVE CONTENT</div>
              <h3>Smart Category Distribution</h3>
            </div>
            <div class="distribution-center">
              <h3 class="glow-text">Smart Category Distribution</h3>
              <div class="category-chips-grid">
                {#each Object.entries($categoryCounts) as [name, count]}
                  {@const catConfig = UIAgent.getStudioConfigs(name)}
                  {@const displayName = categoryNames.getName(name)}
                  <div class="category-chip futuristic-card" style="border-color: {catConfig.color}">
                    <span
                      contenteditable="true"
                      on:blur={(event) =>
                        UIAgent.renameCategory(name, event.currentTarget.textContent || '')}
                      class="editable-label"
                      style="color: {catConfig.color}"
                    >
                      {displayName}
                    </span>
                    <span class="count-badge" style="background: {catConfig.color}">{count} items</span>
                    <div
                      class="glow-line"
                      style="background: linear-gradient(90deg, transparent, {catConfig.color}, transparent)"
                    ></div>
                  </div>
                {/each}
              </div>
            </div>
<HeroExperience
              section="replace"
              {HERO_BACKGROUND_VIDEO}
              {HERO_POSTER_IMAGE}
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
            />

            <div class="category-stats">
              {#each Object.keys($feed).filter((cat) => cat !== 'Auto-Detect') as cat}
                {#if $feed[cat]}
                  {@const catConfig = UIAgent.getStudioConfigs(cat)}
                  {@const displayName = categoryNames.getName(cat)}
                  <div class="stat-item">
                    <span
                      class="stat-category"
                      style="border-left: 3px solid {catConfig.color}; color: {catConfig.color}"
                    >
                      {displayName}
                    </span>
                    <span class="stat-count">
                      {$feed[cat].filter((reel) => !reel.isPlaceholder).length} items
                    </span>
                    <span class="personal-count" style="color: {catConfig.color}">
                      ({$feed[cat].filter((reel) => reel.isPersonalThumbnail).length} personal thumbs)
                    </span>
                    <span class="video-count" style="color: {catConfig.color}">
                      ({$feed[cat].filter((reel) => reel.isPersonalVideo).length} personal videos)
                    </span>
                  </div>
                {/if}
              {/each}
            </div>

            <div class="input-label-wrapper studio-inventory-section">
              <div class="studio-inventory-heading">RECENTLY ADDED PRODUCTIONS</div>
              <div class="studio-inventory-toolbar" role="group" aria-label="Production inventory filters">
                <label class="studio-inventory-select-all">
                  <input
                    bind:this={studioSelectAllCheckbox}
                    type="checkbox"
                    class="studio-inventory-checkbox"
                    checked={studioInventoryAllVisibleSelected}
                    disabled={studioInventoryVisibleIds.length === 0}
                    on:change={toggleSelectAllVisibleInventory}
                    aria-label="Select all visible productions"
                  />
                  <span>Select visible</span>
                </label>
                <input
                  type="search"
                  class="studio-inventory-search"
                  bind:value={studioInventoryQuery}
                  placeholder="Search title, filename, category, status…"
                  aria-label="Search productions"
                />
                <select
                  class="studio-inventory-sort"
                  bind:value={studioInventorySort}
                  aria-label="Sort productions"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="title">Title A–Z</option>
                </select>
                <span class="studio-inventory-count" aria-live="polite">
                  {studioInventoryView.length}/{studioInventoryBase.length}
                </span>
              </div>
              {#if studioInventorySelectedCount > 0}
                <div
                  class="studio-bulk-toolbar"
                  role="region"
                  aria-label="Bulk production actions"
                  data-bulk-action-state={studioBulkActionState}
                >
                  <span class="studio-bulk-count" aria-live="polite">
                    {studioInventorySelectedCount} selected
                  </span>
                  <span class="studio-bulk-state" aria-live="polite">
                    State: {studioBulkActionState}
                  </span>
                  <button
                    type="button"
                    class="studio-bulk-btn"
                    on:click={clearInventorySelection}
                  >
                    Clear selection
                  </button>
                  {#if studioBulkActionState !== 'confirming'}
                    <button
                      type="button"
                      class="studio-bulk-btn"
                      on:click={enterBulkConfirmPreview}
                    >
                      Review selection
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="studio-bulk-btn"
                      on:click={cancelBulkConfirmPreview}
                    >
                      Back to review
                    </button>
                  {/if}
                  <button
                    type="button"
                    class="studio-bulk-btn is-placeholder"
                    disabled
                    title="Bulk delete requires backend support — not available yet"
                  >
                    Bulk delete
                  </button>
                  <button
                    type="button"
                    class="studio-bulk-btn is-placeholder"
                    disabled
                    title="Bulk category update requires backend support — not available yet"
                  >
                    Bulk category
                  </button>
                  <button
                    type="button"
                    class="studio-bulk-btn is-placeholder"
                    disabled
                    title="Bulk export requires backend support — not available yet"
                  >
                    Bulk export
                  </button>
                  <div class="studio-bulk-summary" aria-label="Selected productions summary">
                    <div class="studio-bulk-summary-title">Selected items</div>
                    <ul class="studio-bulk-summary-list">
                      {#each studioInventorySelectedSummary as item (item.id)}
                        <li>
                          <span class="studio-bulk-summary-name">{item.title}</span>
                          <code class="studio-bulk-summary-id">{item.id}</code>
                          {#if item.category}
                            <span class="studio-bulk-summary-meta">{item.category}</span>
                          {/if}
                          {#if item.status}
                            <span class="studio-bulk-summary-meta">{item.status}</span>
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  </div>
                  {#if studioBulkActionState === 'confirming'}
                    <div
                      class="studio-bulk-confirm-preview"
                      role="group"
                      aria-label="Bulk action confirmation preview"
                    >
                      <div class="studio-bulk-confirm-title">Confirmation preview</div>
                      <p class="studio-bulk-confirm-copy">
                        {studioInventorySelectedCount} production{studioInventorySelectedCount === 1 ? '' : 's'}
                        ready for a future bulk action. No bulk mutation will run.
                      </p>
                      <ul class="studio-bulk-summary-list">
                        {#each studioInventorySelectedSummary as item (item.id)}
                          <li>
                            <span class="studio-bulk-summary-name">{item.title}</span>
                            <code class="studio-bulk-summary-id">{item.id}</code>
                          </li>
                        {/each}
                      </ul>
                      <button
                        type="button"
                        class="studio-bulk-btn is-placeholder"
                        disabled
                        title="Bulk confirmation is preview-only until backend support exists"
                      >
                        Confirm bulk action (unavailable)
                      </button>
                    </div>
                  {/if}
                </div>
              {/if}
              {#if !$viewerHydrationReady}
                <p class="studio-inventory-feedback is-loading" role="status">Loading productions…</p>
              {:else if $uploadStatus && $uploadStatus !== 'Standby'}
                <p
                  class="studio-inventory-feedback"
                  class:is-loading={/SAVING|SYNCING|Deleting|DELETING|UPLOADING/i.test($uploadStatus)}
                  class:is-error={/^❌|ERROR:/i.test($uploadStatus)}
                  class:is-ok={/^✅/i.test($uploadStatus)}
                  role="status"
                >
                  {$uploadStatus}
                </p>
              {/if}
              <div class="asset-list">
                {#each studioInventoryView as reel (reel.id)}
                  {@const reelId = String(reel.id)}
                  {@const reelConfig = UIAgent.getStudioConfigs(reel.category)}
                  {@const productionStatus = resolveProductionStatus(reel)}
                  {@const productionType = resolveProductionType(reel)}
                  {@const rowFeedback = renameRowFeedback[reelId] || null}
                  {@const rowSelected = !!studioInventorySelected[reelId]}
                  {@const rowDeleting =
                    !!$isDeleting && $deleteConfirmReel && String($deleteConfirmReel.id) === reelId}
                  <div
                    class="asset-item smart-item"
                    class:is-selected={rowSelected}
                    class:is-deleting={rowDeleting}
                    class:is-rename-busy={renameBusyId === reelId}
                    style="border-left: 4px solid {reelConfig.color}"
                  >
                    <label class="studio-inventory-row-select">
                      <input
                        type="checkbox"
                        class="studio-inventory-checkbox"
                        checked={rowSelected}
                        disabled={rowDeleting}
                        on:change={() => toggleInventorySelection(reelId)}
                        aria-label="Select production {reel.title || reelId}"
                      />
                    </label>
                    <div class="asset-info">
                      <div class="editable-title-wrapper">
                        <input
                          type="text"
                          value={reel.title || ''}
                          disabled={rowDeleting || renameBusyId === reelId}
                          on:input={(event) => (reel.title = event.currentTarget.value)}
                          on:blur={() => updateReelTitle(reel, reel.title)}
                          on:keydown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              updateReelTitle(reel, reel.title);
                            }
                          }}
                          placeholder="Enter title..."
                          class="asset-title-input"
                          aria-label="Edit production title"
                        />
                        {#if rowFeedback}
                          <small
                            class="title-save-feedback"
                            class:is-saving={rowFeedback.kind === 'saving'}
                            class:is-saved={rowFeedback.kind === 'saved'}
                            class:is-local={rowFeedback.kind === 'local'}
                            class:is-error={rowFeedback.kind === 'error'}
                          >
                            {rowFeedback.message}
                          </small>
                        {:else if reel.title !== reel.title_original}
                          <small class="title-changed">Changed</small>
                        {/if}
                      </div>
                      <div class="asset-meta">
                        <span
                          class="smart-category"
                          style="background: {reelConfig.color}20; color: {reelConfig.color}"
                        >
                          {reel.category}
                        </span>
                        {#if productionStatus}
                          <span class="production-status-badge status-{productionStatus}">
                            {productionStatus}
                          </span>
                        {/if}
                        {#if productionType}
                          <span class="production-type-badge type-{productionType}">
                            {productionType}
                          </span>
                        {/if}
                        {#if productionStatus === 'failed' && (reel.error_message || reel.errorMessage)}
                          <span class="production-error-text" title={String(reel.error_message || reel.errorMessage)}>
                            {reel.error_message || reel.errorMessage}
                          </span>
                        {/if}
                        {#if reel.auto_detected}
                          <span class="detection-meta">
                            🤖 Auto-placed ({reel.detection_confidence || 'High'})
                          </span>
                        {:else}
                          <span class="detection-meta">📤 Manually placed</span>
                        {/if}
                        {#if reel.isPersonalVideo}
                          <span class="video-badge">🎬 Video</span>
                        {/if}
                      </div>
                    </div>
                    <div class="button-group">
                      {#if reel.isPersonalVideo}
                        <button
                          class="unveil-btn"
                          disabled={rowDeleting || !!$isDeleting}
                          on:click={() =>
                            unveilToCloud(reel.file_name || reel.personal_video || reel.video_url)}
                          title="Upload to cloud"
                        >
                          🚀 UNVEIL
                        </button>
                      {/if}
                      <button
                        class="delete-btn"
                        disabled={!!$isDeleting}
                        aria-busy={rowDeleting}
                        on:click={() => UIAgent.deleteProduction(reel.id)}
                        title="Delete production (confirmation required)"
                      >
                        {rowDeleting ? 'DELETING…' : 'DELETE'}
                      </button>
                    </div>
                  </div>
                {/each}
                {#if studioInventoryBase.length > 0 && studioInventoryView.length === 0}
                  <p class="studio-inventory-empty">No productions match this search.</p>
                {/if}
              </div>
            </div>
          </div>
          </div>
          <div slot="analytics" class="studio-workspace-slot">
            <RevenueDashboard
              seriesId={$studioSelectedSeriesId || 'series-neon-vengeance'}
              feedReels={studioFeedReels}
            />
            <MarketplaceDashboard
              seriesId={$studioSelectedSeriesId || 'series-neon-vengeance'}
              feedReels={studioFeedReels}
            />
          </div>
          <div slot="system" class="studio-workspace-slot">
          <DeveloperDiagnosticsCenter
            {adminMode}
            {feed}
            {personalThumbnailCollection}
            {personalVideos}
            {viewerHydrationReady}
            {HERO_BACKGROUND_VIDEO}
            {HERO_POSTER_IMAGE}
            {heroVideoFailed}
            {heroVideoLoaded}
            {heroPendingFile}
            {storageHealth}
            {uploadStatus}
          />
          <SentinelSecurityCard />
          <SentinelAssistantPanel feedReels={studioFeedReels} seriesId={$studioSelectedSeriesId || 'series-neon-vengeance'} />
          <HeroManagerPanel
            feedReels={studioFeedReels}
            {feed}
            {personalVideos}
            {persistPersonalVault}
            {storageSet}
            {syncFromVault}
            {CONFIG}
          />
          <StudioAppearancePanel />
<PlatformPublishingProfiles />
          <PlatformConfigPanel
            active={$controlCenterOpen}
            onStatus={(msg) => {
              uploadStatus.set(msg);
              resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2500);
            }}
          />
          <StudioAmbientAudioPanel studioOpen={$controlCenterOpen && $adminMode} />
          <MonetizationPanel
            active={$controlCenterOpen}
            onStatus={(msg) => {
              uploadStatus.set(msg);
              resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2500);
            }}
          />

          {#if $watchContinueEnabled}
            <div class="hierarchy-section watch-continue-section" data-watch-continue>
              <h4 class="hierarchy-title">Continue watching (API)</h4>
              {#if $watchContinueLoading}
                <p class="hierarchy-hint">Loading progress...</p>
              {:else if $watchContinueItems.length === 0}
                <p class="hierarchy-hint">No in-progress titles for this viewer.</p>
              {:else}
                <ul class="watch-continue-list">
                  {#each $watchContinueItems as item}
                    <li class="watch-continue-item">
                      <span>{item.episode_title || item.reel_title || item.reel_id}</span>
                      <span class="watch-continue-pct">{Math.round(item.completion_percent)}%</span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}
            <div class="asset-manager">
<div class="ai-maintenance-panel">
              <div class="smart-header ai-header">
                <div class="ai-badge pulse">🤖 AI MAINTENANCE</div>
                <h3>Autonomous Data Hygiene</h3>
              </div>
              <div class="health-dashboard">
                <div
                  class="health-score"
                  class:good={$storageHealth.score >= 80}
                  class:warning={$storageHealth.score >= 60 && $storageHealth.score < 80}
                  class:critical={$storageHealth.score < 60}
                >
                  <svg viewBox="0 0 36 36" class="health-ring">
                    <path
                      class="health-ring-bg"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                    <path
                      class="health-ring-fill"
                      stroke-dasharray="{$storageHealth.score}, 100"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                  </svg>
                  <div class="health-percent">{$storageHealth.score}%</div>
                  <span class="health-label">HEALTH</span>
                </div>
                {#if $storageHealth.issues?.length > 0}
                  <div class="health-issues">
                    <small>⚠️ {$storageHealth.issues.length} items need attention</small>
                    <ul>
                      {#each $storageHealth.issues as issue}
                        <li>{issue}</li>
                      {/each}
                    </ul>
                  </div>
                {/if}
                <div class="health-details">
                  <small>
                    Vault: {$storageHealth.details?.vault || 0} | Thumbs:
                    {$storageHealth.details?.thumbs || 0} | Videos:
                    {$storageHealth.details?.videos || 0}
                  </small>
                </div>
                <div class="storage-metrics">
                  <div class="metric">
                    <span class="metric-value">
                      {JSON.parse(
                        (typeof window !== 'undefined' ? localStorage.getItem(CONFIG.VAULT_KEY) : null) ||
                          '[]'
                      ).length}
                    </span>
                    <span class="metric-label">Active Records</span>
                  </div>
                  <div class="metric">
                    <span class="metric-value">{resourceManager.blobUrls.size}</span>
                    <span class="metric-label">Temp Blobs</span>
                  </div>
                  <div class="metric">
                    <span class="metric-value">{formatBytes(getLocalStorageSize())}</span>
                    <span class="metric-label">Local Storage</span>
                  </div>
                  <div class="metric">
                    <span class="metric-value">
                      {$lastAiCleanup
                        ? new Date($lastAiCleanup.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit'
                          })
                        : 'Never'}
                    </span>
                    <span class="metric-label">Last Cleanup</span>
                  </div>
                </div>
              </div>
              <div class="ai-controls">
                <div class="toggle-row">
                  <label class="ai-toggle">
                    <input
                      type="checkbox"
                      checked={$aiMaintenanceMode}
                      on:change={(event) => AI_CLEANUP_AGENT.setMaintenanceMode(event.target.checked)}
                    />
                    <span class="toggle-slider"></span>
                    <span class="toggle-label">
                      {$aiMaintenanceMode ? 'Auto-Cleanup ON' : 'Auto-Cleanup PAUSED'}
                    </span>
                  </label>
                  <button
                    class="force-cleanup-btn"
                    on:click={() => AI_CLEANUP_AGENT.forceCleanup()}
                    disabled={$isCleaning}
                    class:cleaning={$isCleaning}
                    title="Trigger immediate AI analysis"
                  >
                    {#if $isCleaning}
                      <span class="mini-spinner"></span>
                      <span>SCANNING...</span>
                    {:else}
                      <span>⚡ FORCE SCAN</span>
                    {/if}
                  </button>
                  <button
                    class="force-cleanup-btn clear-cache-btn"
                    on:click={clearApplicationCache}
                    title="Clear cached feed/thumbnail data"
                  >
                    🧹 CLEAR CACHE
                  </button>
                  <button
                    class="force-cleanup-btn reset-data-btn"
                    on:click={resetAllLocalData}
                    title="Clear all localStorage and reload"
                  >
                    ♻️ RESET LOCAL DATA
                  </button>
                </div>
                {#if $lastAiCleanup}
                  <div class="last-cleanup-log" class:has-error={$lastAiCleanup.error}>
                    <small>
                      {#if $lastAiCleanup.error}
                        <span class="error-text">❌ {$lastAiCleanup.error}</span>
                      {:else}
                        <span>
                          Last: {$lastAiCleanup.actions?.length || 0} actions •
                          {$lastAiCleanup.duration || '0ms'} • Health:
                          {$lastAiCleanup.healthAfter?.score || '??'}%
                        </span>
                        {#if $lastAiCleanup.forced}
                          <span class="forced-badge">[FORCED]</span>
                        {/if}
                      {/if}
                    </small>
                  </div>
                {/if}
              </div>
              <div class="ai-rules">
                <h4>🧠 AI Retention Policy</h4>
                <ul>
                  <li class:active={true}>Keep: Accessed in last 48 hours</li>
                  <li class:active={true}>Keep: Valid video + thumbnail</li>
                  <li class:active={true}>Archive: Stale &gt; 7 days, no access</li>
                  <li class:active={true}>Purge: Broken blob URLs immediately</li>
                  <li class:active={true}>Auto-clean when health &lt; 70%</li>
                </ul>
              </div>
            </div>
          </div>
        </ProductionCommandCenter>
      {:else}
        <div class="admin-login-panel">
          <div class="smart-header">
            <div class="ai-badge pulse">🔐 ADMIN ACCESS REQUIRED</div>
            <h3>Smart Studio requires authentication</h3>
            <p class="smart-subtitle">Please log in as admin to access this feature.</p>
          </div>
          <div class="login-form">
            <label class="input-label-wrapper">
              ADMIN PASSWORD
              <input
                bind:this={adminInputElement}
                type="password"
                bind:value={adminPasswordInput}
                placeholder="Enter admin password"
                on:keydown={(event) => {
                  if (event.key === 'Enter') attemptAdminLogin();
                }}
              />
            </label>
            {#if adminLoginError}
              <div class="login-error">{adminLoginError}</div>
            {/if}
            <button class="submit-btn" on:click={attemptAdminLogin}>🔓 UNLOCK STUDIO</button>
            <p class="login-hint">
              Use <code>Gaff1505!</code> or <code>SMART_PRODUCTION</code> (case‑sensitive)
            </p>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}
