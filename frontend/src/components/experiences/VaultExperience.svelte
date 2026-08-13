<script>
  import { onMount, onDestroy } from 'svelte';
  import { get, writable } from 'svelte/store';
  import { createVaultUtils } from '../../lib/viewer/vaultUtils.js';
  import { isImage, isVideo } from '../../lib/vaultMedia.js';
  import MediaRenderer from '../media/MediaRenderer.svelte';
  import MediaThumbnail from '../media/MediaThumbnail.svelte';
  import {
    claimPlaybackOwner,
    releasePlaybackOwner,
    canStartPlayback,
    getPlaybackOwner
  } from '../../lib/media/playbackOwnership.js';
  import { resolvePlayableMediaUrl } from '../../lib/media/resolvePlayableMediaUrl.js';
  import VaultEngagementBadge from '../vertical/VaultEngagementBadge.svelte';
  import { reelshortActive } from '../vertical/ReelshortExperience.svelte';
  import { isMicroDramaContent } from '../../lib/vertical/reelshortProfile.js';
  import {
    allowDrop,
    buildVaultPayload,
    setVaultDragData,
    parseVaultPayload,
    logDrag,
    VAULT_SOURCES
  } from '../../lib/drag-drop.js';
  import { pipelineDiag, pipelineCheckpoint } from '../../lib/diagnostics/pipelineDiag.js';
  import { reelResStoreMutation, reelResReelSnapshot } from '../../lib/diagnostics/reelResolutionTrace.js';
  import { isVideoReel } from '../../lib/api/reelContract.js';
  import {
    logVaultRenderGate,
    logVaultPlaceholderGate
  } from '../../lib/diagnostics/renderGateForensics.js';
  import { uploadMedia, uploadThumbnail, fetchReadyReels as apiFetchReadyReels, deleteReelById as apiDeleteReelById } from '../../lib/api/media.js';
  import { acceptVaultImageUploadResponse } from '../../lib/vault/normalizeVaultAsset.js';
  import {
    resolveThumbnailUploadMediaUrl,
    isAcceptableThumbnailUploadMedia
  } from '../../lib/vault/resolveThumbnailUploadMediaUrl.js';
  import { logHeroImagePipeline, saveHeroManagerConfig } from '../../lib/hero/heroIntelligence.js';
  import {
    resolveActiveHeroVideoReel,
    heroReelToVaultItem,
    clearHeroReel
  } from '../../lib/hero/heroReelIdentity.js';
  import { isHeroAsset } from '../../lib/hero/heroDomainGuard.js';
  import { reelToVaultEntry } from '../../lib/api/reelContract.js';
  import { sealVaultSeriesIdentityForStorage } from '../../lib/series/vaultSeriesInference.js';
  import {
    resolveCreatorCardMutationTarget,
    applyIdentityToVaultListByMediaAssetId,
    applyPackageToVaultListByMediaAssetId,
    assertNoCrossWrite,
    resolveMediaAssetId
  } from '../../lib/vault/vaultCreatorCardTargeting.js';
  import { saveCreatorCatalogMetadata, previewCreatorShelfClassification } from '../../lib/feed/creatorCatalogMetadata.js';
  import VaultEpisodeCreatorStatus from '../series/VaultEpisodeCreatorStatus.svelte';
  import { validateVideoFile } from '../../lib/runtime-guards.js';
  import { API_BASE_URL, toRelativeMediaPath, SIGNED_UPLOADS_MIN_BYTES } from '../../lib/config.js';
  import {
    ADMIN_SESSION_TOKEN_KEY,
    getAdminAuthHeaders,
    getAdminToken,
    isInvalidSessionError
  } from '../../lib/api.js';
  import { ALLOW_UI_PLACEHOLDERS } from '../../lib/mediaBootstrap.js';
  import { fetchWithRetry } from '../../lib/api.js';
  import { SYNC_DOMAIN } from '../../lib/viewer/domainSync.js';
  import { isDemoDebugMode } from '../../lib/debugMode.js';
  import { setPendingUploads, noteFailedUpload } from '../../lib/diagnostics/pipelineSnapshot.js';
  import {
    filterStaleOrphanEntries,
    isThumbnailImageReel,
    thumbnailEntryFileKey
  } from '../../lib/viewer/thumbnailCanonicalization.js';
  import { resolveVaultCardProjection } from '../../lib/content/vaultCardProjection.js';
  import {
    reconcileThumbnailVault,
    deleteThumbnailVaultEntries,
    appendThumbnailVaultEntry,
    removeThumbnailVaultByIndex,
    syncCollectionStore,
    readThumbnailVault
  } from '../../lib/viewer/thumbnailVault.js';
  import { assertDeleteReducedCount } from '../../lib/viewer/thumbnailInvariants.js';
  import {
    applyCanonicalDeleteClientEffects,
    isGhostVideoVaultEntry
  } from '../../lib/deletionSync.js';
  import { vaultForensic } from '../../lib/diagnostics/vaultForensics.js';
  import {
    trackUploadLockRegister,
    trackUploadLockBlock,
    trackUploadLockRemove,
    noteUploadLockReelId,
    hasActiveUploadLock,
    isUploadLockStale,
    isUploadLockAbandoned,
    supersedeStaleUploadLock,
    getUploadLockAgeMs,
    getUploadLockIdleMs,
    getActiveUploadLockCount,
    UPLOAD_LOCK_STALE_MS,
    uploadLockStaleMsForSize,
    touchUploadLockProgress
  } from '../../lib/diagnostics/uploadLockDiag.js';
  import {
    createUploadAttemptContext,
    logUploadStage,
    logUploadError,
    patchUploadDiagContext
  } from '../../lib/diagnostics/uploadStageDiag.js';
  import { appendUploadIdentityToFormData } from '../../lib/api/uploadIdentity.js';
  import { bindEpisodeToFeedReel } from '../../lib/series/seriesStore.js';
  import { clearUploadCheckpoint } from '../../lib/diagnostics/uploadRecovery.js';
  import {
    filterVideoVaultVisible,
    hideVideoVaultAsset,
    isDurableVideoVaultWorkspaceAsset,
    isVideoVaultHidden,
    isVideoVaultStubPurgeTarget,
    readVideoVaultHiddenIds,
    restoreVideoVaultAsset,
    VIDEO_VAULT_HIDDEN_STORAGE_KEY
  } from '../../lib/vault/videoVaultWorkspace.js';

  export let showPersonalControls = true;

  export let personalThumbnailCollection;
  export let personalVideos;
  export let personalThumbnailIndex;
  export let pendingThumbnail;
  export let thumbnailDragActive;
  export let videoDragActive;
  export let uploadStatus;
  export let personalStudioMode;
  export let usePersonalThumbnails;
  export let personalVideoCollection;
  export let newTitle;
  export let feed;

  export let CONFIG;
  export let resourceManager;
  export let AI_CLEANUP_AGENT;
  export let UIAgent;
  /** @type {ReturnType<typeof createVaultUtils> | null} */
  export let vaultUtils = null;
  /** @type {(preserveLocal?: boolean) => Promise<void>} */
  export let syncFromVault = async () => {};
  /** @type {(domains: string | string[], options?: Record<string, unknown>) => Promise<void>} */
  export let syncDomain = async () => {};
  /** @type {(videos: unknown[]) => void} */
  export let persistPersonalVault = () => {};
  /** @type {(key: string, value: unknown) => { ok?: boolean }} */
  export let storageSet = () => ({ ok: true });
  /** @type {() => string} */
  export let getFallbackImage = () => '';
  /** Optional catalog episode binding for vault uploads (from studio attach flow). */
  export let uploadEpisodeId = '';
  /** Optional series context for upload diagnostics. */
  export let uploadSeriesId = '';
  let vaultDeleteDragActive = false;
  /** Shelf category for vault uploads (video + thumbnail). */
  let vaultUploadCategory = 'Trending';
  /** Hidden file input for MP4 vault click-to-upload fallback. */
  let videoFileInputEl;
  /** Local pending MP4 preview (Accept/Reject) — mirrors thumbnail vault. */
  const pendingVaultVideo = writable(null);
  /** Prevents double-ACCEPT / duplicate uploadMedia. */
  let vaultAcceptInFlight = false;
  /** Near-miss drag hint when pointer is over Studio but outside the upload zone. */
  let vaultNearMissHint = '';
  let vaultNearMissClearTimer = null;
  /** @type {((event: DragEvent) => void) | null} */
  let vaultDocDragOverHandler = null;
  /** @type {((event: DragEvent) => void) | null} */
  let vaultDocDropHandler = null;
  /**
   * Soft-hide revision — bump when workspace hide set changes so vaultDisplayVideos re-filters.
   * Persisted separately under VIDEO_VAULT_HIDDEN_STORAGE_KEY (not durable media delete).
   */
  let vaultHideRevision = 0;
  /**
   * Most recent soft-remove for in-place Undo (same asset id; no re-upload).
   * @type {{ assetId: string; name: string; at: number } | null}
   */
  let lastSoftRemoved = null;
  /** Per-asset edit signal for VaultEpisodeCreatorStatus (no media re-upload). */
  let vaultEditSignals = /** @type {Record<string, number>} */ ({});
  /**
   * Phase 20: per-asset package save ack for VaultEpisodeCreatorStatus feedback.
   * @type {Record<string, { saveToken?: number; ok?: boolean; shelf?: string; explicit?: boolean; error?: string; savedAt?: number }>}
   */
  let vaultPackageSaveFeedback = {};
  $: vaultShelfCategories = (CONFIG?.CATEGORIES ?? []).filter((c) => c !== 'Auto-Detect');
  let deleteAuditLogged = false;
  let selectedThumbnailIds = [];
  let selectedVideoIds = [];
  let thumbnailCanonicalizationDone = false;
  /** @type {Record<string, number>} fileName → put percent */
  let vaultUploadPercents = {};
  /** Single content-vault card allowed to mount a live <video> (hover). */
  let activeVaultVideoPreviewId = '';
  let thumbnailCanonInFlight = false;
  // BG-7X: prevent identical duplicate uploads while an upload is in-flight (see uploadLockDiag.js).
  const VAULT_UPLOAD_TIMEOUT_MS_LARGE = 20 * 60 * 1000;
  const VAULT_UPLOAD_TIMEOUT_MS_DEFAULT = 5 * 60 * 1000;

  $: utils =
    vaultUtils ||
    createVaultUtils({ CONFIG, personalThumbnailCollection, getFallbackImage });

  $: ({
    getVaultImageReel,
    getVaultVideoReel,
    handleVaultThumbnailError,
    handleVaultVideoLoaded,
    handleVaultVideoElementError,
    logVaultCardLayoutDiagnostics,
    vaultCardDiagnostics,
    logVaultImageError,
    logVaultFieldAudit,
    getStoredThumbnailEntries
  } = utils);
  $: if (typeof window !== 'undefined' && getVaultImageReel) {
    const collection = ($personalThumbnailCollection ?? []).filter(Boolean);
    collection.forEach((img, i) => {
      const stored = getStoredThumbnailEntries();
      const reel = getVaultImageReel(img, i);
      const key = typeof img === 'string' ? img : String(img?.fileName || img?.file_name || img?.id || '').trim();
      const entry = stored.find((t) => {
        if (!t) return false;
        if (typeof t === 'string') return String(t).trim() === key;
        return String(t.fileName || t.file_name || '').trim() === key || String(t.id || '').trim() === key;
      });
      console.info('[VAULT_RENDER]', {
        renderIndex: i,
        storeOrigin: 'personalThumbnailCollection',
        componentOrigin: 'VaultExperience',
        collectionItem: img,
        displayName: reel?.name,
        id: entry && typeof entry === 'object' ? entry.id : undefined,
        fileName: entry && typeof entry === 'object' ? entry.fileName || entry.file_name : key,
        url: reel?.url,
        thumbnail: entry && typeof entry === 'object' ? entry.thumbnail : undefined,
        thumbnailUrl: reel?.thumbnailUrl,
        placeholder: !(isImage(reel) && reel?.url),
        orphaned: entry && typeof entry === 'object' ? Boolean(entry.orphaned) : undefined,
        active_upload: entry && typeof entry === 'object' ? Boolean(String(entry.url || '').startsWith('blob:') || String(entry.url || '').startsWith('data:')) : false,
        ts: new Date().toISOString()
      });
    });
  }
  /** Hero background videos are excluded from persisted vault storage but shown in the grid. */
  function mergeHeroVideoIntoVaultDisplay(videos) {
    const list = (videos ?? []).filter(Boolean);
    const hero = resolveActiveHeroVideoReel();
    if (!hero?.id || !hero?.url) return list;
    const alreadyListed = list.some((item) => {
      const id = String(item?.id || '').trim();
      const fileName = String(item?.fileName || item?.file_name || '').trim();
      return (id && id === hero.id) || (fileName && fileName === hero.fileName);
    });
    if (alreadyListed) return list;
    return [heroReelToVaultItem(hero), ...list];
  }

  /**
   * Presentation list only. Soft-hidden ids stay in personalVideos (and Hero binding)
   * so hard refresh can still hydrate media while the workspace card stays reversible.
   */
  $: vaultDisplayVideos = (() => {
    void vaultHideRevision;
    const merged = mergeHeroVideoIntoVaultDisplay($personalVideos);
    return filterVideoVaultVisible(merged, readVideoVaultHiddenIds());
  })();

  $: console.info('[VAULT_ITEM_COUNT]', {
    images: ($personalThumbnailCollection ?? []).filter(Boolean).length,
    videos: vaultDisplayVideos.length,
    persistedVideos: ($personalVideos ?? []).filter(Boolean).length,
    softHiddenVideos: readVideoVaultHiddenIds().length,
    ts: new Date().toISOString()
  });
  $: demoDebugMode = isDemoDebugMode();
  $: shouldShowVaultDemoCards =
    ALLOW_UI_PLACEHOLDERS &&
    (demoDebugMode ||
    (($personalVideos?.length ?? 0) === 0 && ($personalThumbnailCollection?.length ?? 0) === 0));
  $: if (typeof window !== 'undefined') {
    console.info('[DEMO_DEBUG]', {
      personalVideosLength: ($personalVideos ?? []).filter(Boolean).length,
      personalThumbsLength: ($personalThumbnailCollection ?? []).filter(Boolean).length,
      shouldShowDemo: shouldShowVaultDemoCards,
      debugParam: demoDebugMode ? 'demo' : null,
      timestamp: new Date().toISOString()
    });
    if (demoDebugMode) {
      console.info('[DEMO_FALLBACK_TRIGGERED]', { source: 'VaultExperience', reason: 'debug=demo' });
    }
  }

  function resolveThumbnailPath(nameOrUrl, index = 0) {
    return utils.resolveThumbnailPath(nameOrUrl, index);
  }

  function authHeaders() {
    return getAdminAuthHeaders();
  }

  function requireAdminSessionForDelete() {
    if (getAdminToken()) return true;
    uploadStatus.set('🔐 Studio login required — open Studio, sign in, then retry delete');
    resourceManager.setTimeout(() => uploadStatus.set('Standby'), 5000);
    return false;
  }

  let adminSessionReady = false;

  function refreshAdminSessionReady() {
    adminSessionReady = Boolean(getAdminToken());
  }

  async function fetchReadyReels() {
    try {
      return await apiFetchReadyReels(authHeaders());
    } catch (e) {
      console.error('fetchReadyReels failed, returning empty array', e);
      return [];
    }
  }

  async function deleteReelById(reelId) {
    const t0 = Date.now();
    vaultForensic('VAULT_DELETE_START', {
      vaultType: 'unknown',
      assetId: String(reelId || ''),
      fileName: null,
      storageLocation: null,
      backendEndpoint: `${API_BASE_URL}/api/reels/${reelId}`,
      result: 'delete_start'
    });
    console.info('[DELETE_API]', { stage: 'start', reelId, ts: t0 });
    try {
      await apiDeleteReelById(reelId, authHeaders());
      vaultForensic('VAULT_DELETE_SUCCESS', {
        vaultType: 'unknown',
        assetId: String(reelId || ''),
        fileName: null,
        storageLocation: null,
        backendEndpoint: `${API_BASE_URL}/api/reels/${reelId}`,
        result: 'delete_success'
      });
      console.info('[DELETE_API]', { stage: 'success', reelId, elapsedMs: Date.now() - t0 });
      return true;
    } catch (e) {
      vaultForensic('VAULT_DELETE_FAIL', {
        vaultType: 'unknown',
        assetId: String(reelId || ''),
        fileName: null,
        storageLocation: null,
        backendEndpoint: `${API_BASE_URL}/api/reels/${reelId}`,
        result: String(e?.message || e)
      });
      console.info('[DELETE_API]', {
        stage: 'failure',
        reelId,
        elapsedMs: Date.now() - t0,
        error: String(e?.message || e)
      });
      console.error('deleteReelById failed', e);
      return false;
    }
  }

  async function ensureThumbnailCanonicalization() {
    if (thumbnailCanonInFlight || typeof window === 'undefined') return;
    if (thumbnailCanonicalizationDone) {
      window.__thumbCanonicalizationReady = true;
      return;
    }

    thumbnailCanonInFlight = true;
    window.__thumbCanonicalizationReady = false;
    try {
      let backendReachable = false;
      let imageReels = [];
      try {
        const res = await fetchWithRetry(
          `${API_BASE_URL}/api/reels?t=${Date.now()}`,
          { headers: authHeaders() },
          { retries: 2, retryDelayMs: 500 }
        );
        backendReachable = res.ok;
        if (res.ok) {
          const body = await res.json().catch(() => []);
          const reels = Array.isArray(body) ? body : [];
          imageReels = reels.filter(isThumbnailImageReel);
        } else {
          console.warn(`[STARTUP_RECONCILE] Backend returned ${res.status}, skipping ghost reconcile`);
        }
      } catch (e) {
        console.info('[STARTUP_RECONCILE]', {
          action: 'skipped',
          reason: 'fetch_failed',
          source: 'VaultExperience.ensureThumbnailCanonicalization',
          ts: new Date().toISOString()
        });
      }

      if (backendReachable) {
        const pending = get(pendingThumbnail);
        const pendingFileKeys = new Set();
        if (pending?.name) pendingFileKeys.add(String(pending.name).trim());
        const reconciled = reconcileThumbnailVault(imageReels, {
          backendReachable: true,
          pendingFileKeys,
          storageKey: CONFIG.THUMBNAIL_STORAGE_KEY
        });
        console.info('[STARTUP_RECONCILE]', {
          action: reconciled.purged.length ? 'purge' : 'noop',
          source: 'VaultExperience.ensureThumbnailCanonicalization',
          examined: reconciled.examined ?? reconciled.entries.length,
          purgedCount: reconciled.purged.length,
          remaining: reconciled.entries.length,
          ts: new Date().toISOString()
        });
      }

      // Never write stale snapshots — derive collection from authoritative vault only.
      syncCollectionStore(personalThumbnailCollection, CONFIG.THUMBNAIL_STORAGE_KEY);
      thumbnailCanonicalizationDone = true;
      window.__thumbCanonicalizationReady = true;
    } finally {
      thumbnailCanonInFlight = false;
    }
  }

  onMount(async () => {
    refreshAdminSessionReady();
    // Near-miss feedback: Studio open + video file dragged outside upload zone.
    vaultDocDragOverHandler = (event) => {
      const types = Array.from(event?.dataTransfer?.types || []);
      if (!types.includes('Files')) return;
      const path = event.composedPath?.() || [];
      const overUpload = path.some(
        (n) =>
          n?.classList?.contains?.('video-vault-drop') &&
          !String(n?.getAttribute?.('aria-label') || '')
            .toLowerCase()
            .includes('delete')
      );
      const overDelete = path.some(
        (n) => n?.getAttribute?.('aria-label') === 'Delete drop zone'
      );
      if (overUpload || overDelete) {
        vaultNearMissHint = '';
        return;
      }
      event.preventDefault();
      vaultNearMissHint = 'Drop on UPLOAD VIDEO zone — not here';
      if (vaultNearMissClearTimer) clearTimeout(vaultNearMissClearTimer);
      vaultNearMissClearTimer = setTimeout(() => {
        vaultNearMissHint = '';
      }, 1200);
    };
    vaultDocDropHandler = (event) => {
      const path = event.composedPath?.() || [];
      const overVault = path.some(
        (n) =>
          n?.classList?.contains?.('video-vault-drop') ||
          n?.classList?.contains?.('personal-media-grid')
      );
      if (overVault) return;
      const files = Array.from(event?.dataTransfer?.files || []);
      const looksVideo = files.some((f) => {
        const name = String(f?.name || '').toLowerCase();
        const type = String(f?.type || '').toLowerCase();
        return type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/.test(name);
      });
      if (!looksVideo) return;
      event.preventDefault();
      vaultNearMissHint = 'Missed upload zone — drop on UPLOAD VIDEO (MP4/MOV)';
      uploadStatus.set('⚠️ Drop on the UPLOAD VIDEO zone to stage your MP4');
      if (vaultNearMissClearTimer) clearTimeout(vaultNearMissClearTimer);
      vaultNearMissClearTimer = setTimeout(() => {
        vaultNearMissHint = '';
        uploadStatus.set('Standby');
      }, 4000);
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('dragover', vaultDocDragOverHandler, true);
      document.addEventListener('drop', vaultDocDropHandler, true);
    }
    // Repair failed/interrupted stubs that still hold dead blob URLs (blocks ⚠ placeholder).
    personalVideos.update((videos) => {
      let changed = false;
      const next = (Array.isArray(videos) ? videos : []).map((item) => {
        const state = String(item?.uploadState || '');
        if (state !== 'failed' && state !== 'interrupted') return item;
        const url = String(item?.url || '').trim();
        if (!url) return item;
        changed = true;
        if (url.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(url);
          } catch {
            /* ignore */
          }
          try {
            resourceManager.revokeBlobUrl?.(url);
          } catch {
            /* ignore */
          }
        }
        return { ...item, url: '' };
      });
      if (changed) {
        try {
          persistPersonalVault(next);
        } catch {
          /* ignore */
        }
        console.info('[MP4_FAILED_REPAIR]', {
          clearedDeadUrls: true,
          ts: new Date().toISOString()
        });
      }
      return changed ? next : videos;
    });
    // Drop feed cards that point at unfinished vault stubs (causes Theater "No Video Available").
    try {
      const vault = get(personalVideos) || [];
      const badIds = new Set(
        vault
          .filter((v) => {
            const state = String(v?.uploadState || '');
            return (
              v?.isOptimisticLocal ||
              state === 'failed' ||
              state === 'interrupted' ||
              state === 'pending_accept' ||
              state === 'uploading' ||
              String(v?.id || '').startsWith('local-upload-') ||
              String(v?.id || '').startsWith('local-pending-')
            );
          })
          .map((v) => String(v?.id || '').trim())
          .filter(Boolean)
      );
      if (badIds.size && feed?.update) {
        feed.update((currentFeed) => {
          const next = { ...currentFeed };
          let removed = 0;
          for (const cat of Object.keys(next)) {
            const before = next[cat]?.length || 0;
            next[cat] = (next[cat] || []).filter((r) => {
              const pid = String(r?.personal_video_id || r?.id || '').trim();
              return !(r?.isPersonalVideo && pid && badIds.has(pid));
            });
            removed += before - (next[cat]?.length || 0);
          }
          if (removed) {
            console.info('[FEED_SCRUB_FAILED_VAULT]', {
              removed,
              badIds: [...badIds],
              ts: new Date().toISOString()
            });
          }
          return next;
        });
      }
    } catch {
      /* ignore */
    }
    const onSessionChange = () => refreshAdminSessionReady();
    window.addEventListener('reelforge:admin-session-changed', onSessionChange);
    window.addEventListener('AUTH_SESSION_EXPIRED', onSessionChange);
    const onStorage = (event) => {
      if (event.key === ADMIN_SESSION_TOKEN_KEY || event.key === null) {
        refreshAdminSessionReady();
      }
    };
    window.addEventListener('storage', onStorage);
    const onBeforeUnload = (event) => {
      if (getActiveUploadLockCount() <= 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    const onVaultUploadProgress = (event) => {
      const detail = event?.detail || {};
      const fileName = String(detail.fileName || '').trim();
      const percent = Number(detail.percent);
      if (!fileName || Number.isNaN(percent)) return;
      if (String(detail.phase || '') !== 'put') return;
      vaultUploadPercents = { ...vaultUploadPercents, [fileName]: Math.max(0, Math.min(100, percent)) };
    };
    window.addEventListener('reelforge:upload-progress', onVaultUploadProgress);
    await ensureThumbnailCanonicalization();
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('reelforge:admin-session-changed', onSessionChange);
      window.removeEventListener('AUTH_SESSION_EXPIRED', onSessionChange);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('reelforge:upload-progress', onVaultUploadProgress);
      if (typeof document !== 'undefined') {
        if (vaultDocDragOverHandler) {
          document.removeEventListener('dragover', vaultDocDragOverHandler, true);
        }
        if (vaultDocDropHandler) {
          document.removeEventListener('drop', vaultDocDropHandler, true);
        }
      }
      if (vaultNearMissClearTimer) clearTimeout(vaultNearMissClearTimer);
    };
  });

  onDestroy(() => {
    if (typeof document !== 'undefined') {
      if (vaultDocDragOverHandler) {
        document.removeEventListener('dragover', vaultDocDragOverHandler, true);
        vaultDocDragOverHandler = null;
      }
      if (vaultDocDropHandler) {
        document.removeEventListener('drop', vaultDocDropHandler, true);
        vaultDocDropHandler = null;
      }
    }
    if (vaultNearMissClearTimer) clearTimeout(vaultNearMissClearTimer);
  });

  $: thumbVaultSize = ($personalThumbnailCollection ?? []).filter(Boolean).length;
  $: if (typeof window !== 'undefined') {
    const rendered = document.querySelectorAll('.vault-grid--images .vault-card').length;
    console.info('[DELETE_REACTIVE]', {
      storeCount: thumbVaultSize,
      renderedCount: rendered,
      selectedCount: selectedThumbnailIds.length,
      ts: Date.now()
    });
  }
  $: if (typeof window !== 'undefined' && thumbVaultSize >= 0) {
    void ensureThumbnailCanonicalization();
  }

  function basenameFromMediaRef(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const clean = raw.split('?')[0].split('#')[0];
    const tail = clean.split('/').pop() || '';
    return tail.trim();
  }

  async function deleteThumbnailFileByName(filename) {
    const encoded = encodeURIComponent(String(filename || '').trim());
    if (!encoded) return false;
    const paths = [`/api/storage/file/${encoded}`, `/api/media/storage/${encoded}`];
    for (const path of paths) {
      const res = await fetch(path, { method: 'DELETE', headers: authHeaders() });
      if (res.ok) return true;
      if (res.status !== 404) return false;
    }
    return false;
  }

  function buildDeletePurgeCtx() {
    return {
      feed,
      personalVideos,
      activeReel: writable(null),
      actions: {
        persistFeed: (nextFeed) => storageSet(CONFIG?.FEED_STORAGE_KEY || 'reelforge_feed', nextFeed),
        persistVault: persistPersonalVault
      }
    };
  }

  function applyVideoDeleteTombstone(deletedIds) {
    if (!deletedIds?.length) return;
    applyCanonicalDeleteClientEffects(
      { ctx: buildDeletePurgeCtx() },
      { reelIds: deletedIds }
    );
  }

  async function applyVideoDeleteThumbnailCleanup(deletedIds) {
    if (!deletedIds?.length) return;
    const imageReels = (await fetchReadyReels()).filter(isThumbnailImageReel);
    deleteThumbnailVaultEntries(deletedIds, imageReels, {
      backendReachable: true,
      storageKey: CONFIG.THUMBNAIL_STORAGE_KEY
    });
    syncCollectionStore(personalThumbnailCollection, CONFIG.THUMBNAIL_STORAGE_KEY);
    await purgeStaleOrphanThumbnails(deletedIds, imageReels);
  }

  async function purgeStaleOrphanThumbnails(deletedIds, imageReels = null) {
    const reels = imageReels || (await fetchReadyReels()).filter(isThumbnailImageReel);
    const pending = get(pendingThumbnail);
    const pendingFileKeys = new Set();
    if (pending?.name) pendingFileKeys.add(String(pending.name).trim());
    const result = reconcileThumbnailVault(reels, {
      backendReachable: true,
      pendingFileKeys,
      storageKey: CONFIG.THUMBNAIL_STORAGE_KEY,
      purgeGhostCanonical: true,
      purgeMarkedOrphans: true
    });
    syncCollectionStore(personalThumbnailCollection, CONFIG.THUMBNAIL_STORAGE_KEY);
    if (result.purged.length) {
      console.info('[ORPHAN_PURGE]', {
        deletedIds: [...(deletedIds || [])],
        purgedCount: result.purged.length,
        purged: result.purged,
        remaining: result.entries.length
      });
    }
    return { purged: result.purged };
  }

  function applyThumbnailDeleteTombstone(deletedIds, failedIds = [], imageReels = []) {
    if (!deletedIds?.length && !failedIds?.length) return;
    if (deletedIds?.length) {
      applyCanonicalDeleteClientEffects(
        { ctx: buildDeletePurgeCtx() },
        { reelIds: deletedIds }
      );
    }
    const before = get(personalThumbnailCollection).length;
    const stored = getStoredThumbnailEntries();
    const deletedFileKeys = [...deletedIds, ...failedIds]
      .map((id) => {
        const entry = stored.find((t) => t && typeof t === 'object' && String(t.id || '').trim() === String(id || '').trim());
        return String(entry?.fileName || entry?.file_name || '').trim() || basenameFromMediaRef(entry?.url || '');
      })
      .filter(Boolean);
    const result = deleteThumbnailVaultEntries(deletedIds, imageReels, {
      backendReachable: true,
      storageKey: CONFIG.THUMBNAIL_STORAGE_KEY,
      failedIds,
      deletedFileKeys
    });
    syncCollectionStore(personalThumbnailCollection, CONFIG.THUMBNAIL_STORAGE_KEY);
    const after = get(personalThumbnailCollection).length;
    console.info('[DELETE_STORE]', {
      action: 'applyThumbnailDeleteTombstone',
      deletedIds: [...deletedIds],
      failedIds: [...failedIds],
      deletedFileKeys,
      before,
      after,
      purged: result.purged?.length || 0,
      ts: Date.now()
    });
    assertDeleteReducedCount(before, after, deletedIds.length + failedIds.length);
  }

  function logDeletePipeline(vault, stage, payload = {}) {
    console.info('[DELETE_PIPELINE]', { vault, stage, ...payload, timestamp: Date.now() });
  }

  function resolveThumbnailStoredEntry(item, index = 0) {
    const stored = getStoredThumbnailEntries();
    const key = typeof item === 'string' ? String(item || '').trim() : '';
    if (key) {
      for (const entry of stored) {
        if (!entry) continue;
        if (typeof entry === 'string') {
          if (String(entry).trim() === key) {
            const objectMatch = stored.find(
              (candidate) =>
                candidate &&
                typeof candidate === 'object' &&
                (String(candidate.fileName || candidate.file_name || '').trim() === key ||
                  basenameFromMediaRef(candidate.url || candidate.thumbnailUrl || '') === key)
            );
            return objectMatch || { fileName: key };
          }
          continue;
        }
        const id = String(entry.id || '').trim();
        const fileName = String(entry.fileName || entry.file_name || '').trim();
        const urlName = basenameFromMediaRef(entry.url || entry.thumbnailUrl || '');
        if (key === id || key === fileName || key === urlName) return entry;
      }
    }
    const aligned = stored.find((entry, idx) => {
      if (!entry || typeof entry !== 'object') return false;
      return idx === index && String(entry.fileName || entry.file_name || '').trim() === key;
    });
    if (aligned) return aligned;
    return null;
  }

  function resolveThumbnailCanonicalId(item, index = 0) {
    const entry = resolveThumbnailStoredEntry(item, index);
    return String(entry?.id || '').trim();
  }

  function resolveThumbnailDeleteKey(item) {
    const stored = getStoredThumbnailEntries();
    if (typeof item === 'string') {
      const key = String(item || '').trim();
      if (!key) return '';
      const entry = stored.find((t) => {
        if (typeof t === 'string') return String(t).trim() === key;
        const name = String(t?.name || '').trim();
        const fileName = String(t?.fileName || '').trim();
        const urlName = basenameFromMediaRef(t?.url || t?.thumbnailUrl || '');
        return key === name || key === fileName || key === urlName;
      });
      if (typeof entry === 'string') return String(entry).trim();
      return String(entry?.fileName || entry?.name || key).trim();
    }
    if (!item || typeof item !== 'object') return '';
    return String(
      item.fileName ||
      basenameFromMediaRef(item.url) ||
      basenameFromMediaRef(item.thumbnailUrl) ||
      item.name ||
      item.id ||
      item.title ||
      ''
    ).trim();
  }

  function thumbnailSelectionId(item, index = 0) {
    return resolveThumbnailCanonicalId(item, index);
  }

  function resolveThumbnailNameFromPayload(payload) {
    const direct = String(payload?.id || payload?.name || payload?.title || '').trim();
    if (direct && !direct.startsWith('personal-thumb-')) return direct;
    const path = String(payload?.src || payload?.url || '').trim();
    if (!path) return direct.replace(/^personal-thumb-/, '');
    return path.split('/').pop() || direct.replace(/^personal-thumb-/, '');
  }

  function toggleThumbnailSelection(reelId) {
    const key = String(reelId || '').trim();
    if (!key) return;
    const wasSelected = selectedThumbnailIds.includes(key);
    selectedThumbnailIds = selectedThumbnailIds.includes(key)
      ? selectedThumbnailIds.filter((entry) => entry !== key)
      : [...selectedThumbnailIds, key];
    console.info('[BATCH_SELECT]', {
      selectedCount: selectedThumbnailIds.length,
      selectedIds: [...selectedThumbnailIds]
    });
    console.info('[BATCH_SELECT_TOGGLE]', {
      itemId: key,
      action: wasSelected ? 'removed' : 'added',
      newCount: selectedThumbnailIds.length
    });
  }

  function toggleVideoSelection(videoId) {
    const key = String(videoId || '').trim();
    if (!key) return;
    selectedVideoIds = selectedVideoIds.includes(key)
      ? selectedVideoIds.filter((entry) => entry !== key)
      : [...selectedVideoIds, key];
  }

  function existingVideoVaultIds() {
    return (get(personalVideos) || [])
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean);
  }

  function canonicalizeVideoSelectionAfterDelete(deletedIds = [], traceCtx = {}) {
    const selectedIds = [...selectedVideoIds];
    const existingVaultIds = existingVideoVaultIds();
    const remainingSelectedIds = selectedIds.filter((id) => existingVaultIds.includes(id));
    selectedVideoIds = remainingSelectedIds;
    console.info('[MP4_DELETE_TRACE]', {
      beforeCount: traceCtx.beforeCount ?? get(personalVideos).length,
      selectedIds: traceCtx.selectedIds ?? selectedIds,
      deletedIds: [...deletedIds],
      afterCount: get(personalVideos).length,
      remainingSelectedIds: [...remainingSelectedIds],
      batchDeleteVisible: remainingSelectedIds.length > 0
    });
    return remainingSelectedIds;
  }

  function formatVaultVideoSizeLabel(video) {
    const n = Number(video?.size);
    if (!Number.isFinite(n) || n <= 0) return '—';
    return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  }

  /**
   * Poster-first vault grid — only one hover preview may mount a decoder.
   * @param {string} videoId
   */
  function activateVaultVideoPreview(videoId) {
    const id = String(videoId || '').trim();
    if (!id) return;
    if (getPlaybackOwner() === 'theater') return;
    if (!canStartPlayback('preview') && getPlaybackOwner() !== 'preview') return;
    if (activeVaultVideoPreviewId === id) return;
    activeVaultVideoPreviewId = id;
    claimPlaybackOwner('preview', `content-vault:${id}`);
  }

  /**
   * @param {string} videoId
   */
  function deactivateVaultVideoPreview(videoId) {
    const id = String(videoId || '').trim();
    if (id && activeVaultVideoPreviewId && id !== activeVaultVideoPreviewId) return;
    activeVaultVideoPreviewId = '';
    if (getPlaybackOwner() === 'preview') {
      releasePlaybackOwner('preview', 'content-vault-leave');
      claimPlaybackOwner('hero', 'content-vault-return');
    }
  }

  function isHeroInjectedVaultCard(videoRef) {
    if (!videoRef || typeof videoRef !== 'object') return false;
    if (videoRef.isHeroBackground === true) return true;
    const hero = resolveActiveHeroVideoReel();
    if (!hero?.id) return false;
    const id = String(videoRef.id || '').trim();
    const fileName = String(videoRef.fileName || videoRef.file_name || videoRef.name || '').trim();
    return (
      (id && id === hero.id) ||
      (fileName && fileName === String(hero.fileName || hero.name || '').trim())
    );
  }

  /**
   * Outline / hero-injected stubs are often absent from personalVideos (hero filter)
   * or stuck behind window.confirm on mobile. Purge local + hero pointer with no confirm.
   */
  function purgeLocalVaultVideoStub(videoRef, reason = 'ghost_purge') {
    const id = String(videoRef?.id || '').trim();
    const ghostName = String(
      videoRef?.fileName || videoRef?.file_name || videoRef?.name || videoRef?.title || ''
    ).trim();
    const ghostSize = Number(videoRef?.size || 0);
    const clearHero = isHeroInjectedVaultCard(videoRef);

    console.info('[MP4_GHOST_PURGE]', {
      reason,
      id: id || null,
      name: ghostName || null,
      clearHero,
      ts: new Date().toISOString()
    });

    if (id) {
      applyVideoDeleteTombstone([id]);
    }

    personalVideos.update((vault) => {
      const next = (Array.isArray(vault) ? vault : []).filter((item) => {
        if (!item || typeof item !== 'object') return false;
        const itemId = String(item.id || '').trim();
        if (id && itemId === id) return false;
        const n = String(item.fileName || item.file_name || item.name || item.title || '').trim();
        if (ghostName && n === ghostName) {
          if (isGhostVideoVaultEntry(item) || !Number.isFinite(Number(item.size))) return false;
        }
        return true;
      });
      try {
        persistPersonalVault(next);
      } catch {
        /* ignore */
      }
      return next;
    });

    if (typeof window !== 'undefined') {
      try {
        const key = CONFIG.VIDEO_VAULT_KEY;
        const raw = JSON.parse(localStorage.getItem(key) || '[]');
        const cleaned = (Array.isArray(raw) ? raw : []).filter((item) => {
          const itemId = String(item?.id || '').trim();
          if (id && itemId === id) return false;
          const n = String(item?.fileName || item?.file_name || item?.name || item?.title || '').trim();
          if (ghostName && n === ghostName && isGhostVideoVaultEntry(item)) return false;
          return true;
        });
        localStorage.setItem(key, JSON.stringify(cleaned));
      } catch {
        /* ignore */
      }
    }

    if (clearHero) {
      clearHeroReel();
      try {
        saveHeroManagerConfig({ heroAssetId: '', backgroundSource: 'selection' });
      } catch {
        /* ignore */
      }
    }

    if (ghostName && Number.isFinite(ghostSize) && ghostSize > 0) {
      trackUploadLockRemove(`${ghostName.toLowerCase()}|${ghostSize}`, { reason });
    }

    uploadStatus.set('✅ Removed leftover vault stub');
    resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
    return true;
  }

  /**
   * Reversible workspace remove: hide from Video Vault UI only.
   * Never routes durable Hero-bound assets to stub purge / clearHeroReel.
   * @param {Record<string, unknown> | null | undefined} video
   */
  function softRemoveFromVideoVault(video) {
    if (!video || typeof video !== 'object') return;

    // True stub / failed chrome → legacy local purge only for non-durable entries.
    if (!isDurableVideoVaultWorkspaceAsset(video)) {
      purgeFailedVaultVideo(video);
      return;
    }

    const assetId = String(
      resolveMediaAssetId(video) || video?.id || video?.assetId || video?.mediaAssetId || ''
    ).trim();
    if (!assetId) {
      uploadStatus.set('❌ Video not found');
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
      return;
    }

    hideVideoVaultAsset(assetId);
    // Session-only Undo affordance. Not persisted — after hard refresh the
    // asset simply stays hidden (no Undo bar resurrection).
    lastSoftRemoved = {
      assetId,
      name: String(video?.name || video?.fileName || video?.title || assetId),
      at: Date.now()
    };
    selectedVideoIds = selectedVideoIds.filter((id) => String(id || '').trim() !== assetId);
    vaultHideRevision += 1;

    console.info('[VIDEO_VAULT_SOFT_REMOVE]', {
      action: 'soft-remove-from-vault',
      assetId,
      storageKey: VIDEO_VAULT_HIDDEN_STORAGE_KEY,
      personalVideosStillHeld: (get(personalVideos) || []).some(
        (item) => String(item?.id || '').trim() === assetId
      ),
      heroInjectedCard: isHeroInjectedVaultCard(video),
      durableWorkspaceAsset: true,
      heroUntouched: true,
      durableMediaUntouched: true,
      ts: new Date().toISOString()
    });

    uploadStatus.set('Removed from Video Vault — Undo');
  }

  /** Restore last soft-removed asset identity without re-upload or duplicate. */
  function undoLastVideoVaultSoftRemove() {
    const assetId = String(lastSoftRemoved?.assetId || '').trim();
    if (!assetId) {
      uploadStatus.set('Nothing to restore');
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
      return;
    }
    const { restored } = restoreVideoVaultAsset(assetId);
    const restoredName = lastSoftRemoved?.name || assetId;
    lastSoftRemoved = null;
    vaultHideRevision += 1;

    console.info('[VIDEO_VAULT_SOFT_RESTORE]', {
      action: 'restore-to-vault',
      assetId,
      restored,
      duplicate: false,
      reupload: false,
      ts: new Date().toISOString()
    });

    uploadStatus.set(
      restored
        ? `Restored to Video Vault: ${String(restoredName).slice(0, 48)}`
        : 'Already visible in Video Vault'
    );
    resourceManager.setTimeout(() => uploadStatus.set('Standby'), 3000);
  }

  /**
   * Open existing asset package/identity editor — no re-upload.
   * @param {Record<string, unknown> | null | undefined} video
   */
  function requestVaultVideoEdit(video) {
    const assetId = String(
      resolveMediaAssetId(video) || video?.id || video?.assetId || video?.mediaAssetId || ''
    ).trim();
    if (!assetId) return;
    vaultEditSignals = {
      ...vaultEditSignals,
      [assetId]: Number(vaultEditSignals[assetId] || 0) + 1
    };
    console.info('[VIDEO_VAULT_EDIT]', {
      action: 'edit-existing-asset',
      assetId,
      reupload: false,
      ts: new Date().toISOString()
    });
  }

  async function handleVideoDelete(videoId, videoRef = null) {
    console.info('[MP4_DELETE_TAP]', {
      videoId: String(videoId || '').trim() || null,
      name: String(videoRef?.name || videoRef?.fileName || ''),
      ghost: videoRef ? isGhostVideoVaultEntry(videoRef) : null,
      heroCard: videoRef ? isHeroInjectedVaultCard(videoRef) : null,
      hasUrl: Boolean(String(videoRef?.url || videoRef?.src || '').trim()),
      size: videoRef?.size ?? null,
      ts: new Date().toISOString()
    });
    uploadStatus.set('🗑️ Removing vault item…');

    const beforeCount = get(personalVideos).length;
    const selectedIds = [...selectedVideoIds];
    const id = String(videoId || videoRef?.id || '').trim();
    const ref =
      videoRef ||
      (id ? (get(personalVideos) || []).find((item) => String(item?.id || '').trim() === id) : null);

    // Outline / display-only chrome: never block on confirm.
    // Durable Hero-bound assets (same id as Hero) must NOT fall through to
    // purgeLocalVaultVideoStub — that path clearHeroReel + tombstones.
    if (
      ref &&
      !isDurableVideoVaultWorkspaceAsset(ref) &&
      (isGhostVideoVaultEntry(ref) ||
        isVideoVaultStubPurgeTarget(ref, { isHeroInjected: isHeroInjectedVaultCard(ref) }))
    ) {
      purgeLocalVaultVideoStub(ref, 'tap_ghost_or_hero_stub');
      canonicalizeVideoSelectionAfterDelete([id].filter(Boolean), {
        beforeCount,
        selectedIds
      });
      return;
    }

    if (!id) {
      if (ref) {
        purgeLocalVaultVideoStub(ref, 'tap_no_id');
        return;
      }
      uploadStatus.set('❌ Video not found');
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
      return;
    }

    const inVault = (get(personalVideos) || []).some((item) => String(item?.id || '').trim() === id);
    if (!inVault) {
      // Display-only card (hero merge) — purge hero pointer so the card cannot resurrect.
      purgeLocalVaultVideoStub(ref || { id, name: 'video', isHeroBackground: true }, 'tap_display_only');
      canonicalizeVideoSelectionAfterDelete([id], { beforeCount, selectedIds });
      return;
    }

    await AI_CLEANUP_AGENT.deleteVaultVideo(id);
    if (get(personalVideos).length < beforeCount) {
      canonicalizeVideoSelectionAfterDelete([id], {
        beforeCount,
        selectedIds
      });
    }
  }

  /** Stop card drag from stealing taps on ✕ / Select (touch + desktop). */
  function stopVaultCardDragGesture(event) {
    event?.stopPropagation?.();
  }

  $: {
    const availableIds = new Set();
    for (const entry of getStoredThumbnailEntries()) {
      if (!entry || typeof entry !== 'object') continue;
      const id = String(entry.id || '').trim();
      if (id) availableIds.add(id);
    }
    const collection = get(personalThumbnailCollection) || [];
    for (let i = 0; i < collection.length; i += 1) {
      const id = resolveThumbnailCanonicalId(collection[i], i);
      if (id) availableIds.add(id);
    }
    const filteredThumbs = selectedThumbnailIds.filter((entry) => availableIds.has(entry));
    if (filteredThumbs.length !== selectedThumbnailIds.length) {
      selectedThumbnailIds = filteredThumbs;
    }
    const availableVideos = new Set(
      (get(personalVideos) || []).map((item) => String(item?.id || '').trim()).filter(Boolean)
    );
    const filteredVideos = selectedVideoIds.filter((entry) => availableVideos.has(entry));
    if (filteredVideos.length !== selectedVideoIds.length) {
      selectedVideoIds = filteredVideos;
    }
  }

  export async function batchDeleteSelectedThumbnails() {
    console.info('[DELETE_HANDLER]', {
      handler: 'batchDeleteSelectedThumbnails',
      entered: true,
      ts: Date.now()
    });
    const selected = [...selectedThumbnailIds];
    console.info('[DELETE_CLICK]', { button: 'DELETE_SELECTED_THUMBS', selectedCount: selected.length });
    console.info('[DELETE_SELECTION]', { selectedIds: selected, storeSize: get(personalThumbnailCollection).length });
    console.info('[BATCH_DELETE_CLICK]', {
      selectedCount: selected.length
    });
    if (!selected.length) {
      console.info('[DELETE_HANDLER]', {
        handler: 'batchDeleteSelectedThumbnails',
        earlyReturn: 'aborted_no_selection',
        ts: Date.now()
      });
      logDeletePipeline('thumbnail-vault', 'aborted_no_selection', {
        selectedThumbnailIds: [...selectedThumbnailIds],
        storeSize: get(personalThumbnailCollection).length
      });
      uploadStatus.set('⚠️ Select thumbnails to delete');
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
      return;
    }
    if (!confirm(`⚠️ Permanently delete ${selected.length} selected thumbnails?`)) return;
    console.info('[BATCH_DELETE_CONFIRM]', {
      itemCount: selected.length
    });
    console.info('[BATCH_DELETE_START]', {
      totalSelected: selected.length,
      selectedIds: [...selected]
    });
    const beforeCount = get(personalThumbnailCollection).length;
    logDeletePipeline('thumbnail-vault', 'delete_targets', {
      selectedIds: [...selected],
      resolvedAssetIds: [...selected],
      storeSizeBefore: beforeCount
    });
    let removed = 0;
    let backendFailures = 0;
    const deletedIds = [];
    const ghostIds = [];
    const storedSnapshot = getStoredThumbnailEntries();
    const feedCleanupNames = [];
    const reelsBefore = await fetchReadyReels();
    const imageReels = (reelsBefore || []).filter(isThumbnailImageReel);
    for (let i = 0; i < selected.length; i += 1) {
      const reelId = String(selected[i] || '').trim();
      if (!reelId) continue;
      console.info('[BATCH_DELETE_ITERATION]', {
        current: i + 1,
        total: selected.length,
        itemId: reelId
      });
      const deleted = await deleteReelById(reelId);
      if (deleted) {
        removed += 1;
        deletedIds.push(reelId);
        const entry = storedSnapshot.find((t) => t && String(t.id || '').trim() === reelId);
        const fileName = String(entry?.fileName || entry?.file_name || basenameFromMediaRef(entry?.url || '')).trim();
        if (fileName) feedCleanupNames.push(fileName);
      } else {
        backendFailures += 1;
        ghostIds.push(reelId);
      }
      console.info('[BATCH_DELETE_ITEM]', {
        index: i + 1,
        itemId: reelId,
        registrySizeBefore: get(personalThumbnailCollection).length
      });
    }
    if (deletedIds.length > 0 || ghostIds.length > 0) {
      applyThumbnailDeleteTombstone(deletedIds, ghostIds, imageReels);
      for (const fileName of feedCleanupNames) {
        AI_CLEANUP_AGENT.removeThumbnailFromCategories(fileName);
      }
    }
    let persisted = true;
    try {
      await syncDomain([SYNC_DOMAIN.THUMBNAIL, SYNC_DOMAIN.FEED], { preserveLocal: true, force: true });
      const reelsAfter = await fetchReadyReels();
      const imageReelsAfter = (reelsAfter || []).filter(isThumbnailImageReel);
      applyThumbnailDeleteTombstone(deletedIds, ghostIds, imageReelsAfter);
      await purgeStaleOrphanThumbnails([...deletedIds, ...ghostIds], imageReelsAfter);
    } catch {
      persisted = false;
    }
    selectedThumbnailIds = [];
    const afterCount = get(personalThumbnailCollection).length;
    const renderedAfter = typeof document !== 'undefined'
      ? document.querySelectorAll('.vault-grid--images .vault-card').length
      : -1;
    console.info('[DELETE_RENDER]', {
      mechanism: 'selected',
      beforeCount,
      afterCount,
      renderedAfter,
      deletedIdsCount: deletedIds.length,
      removed,
      ts: Date.now()
    });
    logDeletePipeline('thumbnail-vault', 'store_after', {
      storeSizeBefore: beforeCount,
      storeSizeAfter: afterCount,
      deletedCount: removed
    });
    console.info('[BATCH_STORE_UPDATE]', {
      beforeCount,
      afterCount
    });
    console.info('[BATCH_PERSIST]', {
      success: persisted && backendFailures === 0 && removed > 0
    });
    console.info('[BATCH_UI_REFRESH]', {
      newCount: afterCount
    });
    console.info('[BATCH_DELETE_COMPLETE]', {
      deletedCount: removed,
      finalRegistrySize: afterCount
    });
    uploadStatus.set(
      removed > 0
        ? `🗑️ Deleted ${removed}/${selected.length} selected thumbnails`
        : `❌ Delete failed — could not remove selected thumbnails`
    );
    resourceManager.setTimeout(() => uploadStatus.set('Standby'), 3000);
  }

  export async function batchDeleteSelectedVideos() {
    const selected = [...selectedVideoIds];
    if (!selected.length) {
      logDeletePipeline('video-vault', 'aborted_no_selection', {
        selectedVideoIds: [...selectedVideoIds],
        storeSize: get(personalVideos).length
      });
      uploadStatus.set('⚠️ Select videos to delete');
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
      return;
    }
    console.info('[DELETE_HANDLER_FIRED]', {
      mechanism: 'batch',
      vault: 'video-vault',
      mode: 'selected',
      itemCount: selected.length,
      timestamp: Date.now()
    });
    if (!confirm(`⚠️ Permanently delete ${selected.length} selected videos?`)) return;
    if (!requireAdminSessionForDelete()) return;
    console.info('[DELETE_CONFIRMED]', {
      mechanism: 'batch',
      vault: 'video-vault',
      mode: 'selected',
      itemCount: selected.length,
      timestamp: Date.now()
    });
    const beforeCount = get(personalVideos).length;
    const selectedIdsBeforeDelete = [...selected];
    logDeletePipeline('video-vault', 'delete_targets', {
      selectedIds: [...selected],
      resolvedAssetIds: [...selected],
      storeSizeBefore: beforeCount
    });
    let removed = 0;
    const deletedIds = [];
    for (const reelId of selected) {
      if (await deleteReelById(reelId)) {
        removed += 1;
        deletedIds.push(String(reelId || '').trim());
      }
    }
    if (deletedIds.length > 0) {
      const imageReels = (await fetchReadyReels()).filter(isThumbnailImageReel);
      applyVideoDeleteTombstone(deletedIds);
      await purgeStaleOrphanThumbnails(deletedIds, imageReels);
      await syncDomain([SYNC_DOMAIN.VIDEO, SYNC_DOMAIN.FEED], { preserveLocal: true, force: true });
      canonicalizeVideoSelectionAfterDelete(deletedIds, {
        beforeCount,
        selectedIds: selectedIdsBeforeDelete
      });
    }
    const afterCount = get(personalVideos).length;
    logDeletePipeline('video-vault', 'store_after', {
      storeSizeBefore: beforeCount,
      storeSizeAfter: afterCount,
      deletedCount: removed
    });
    console.info('[DELETE_STORE_UPDATE]', { vault: 'video-vault', mechanism: 'batch', mode: 'selected', beforeCount, afterCount, timestamp: Date.now() });
    console.info('[DELETE_PERSISTENCE]', { vault: 'video-vault', mechanism: 'batch', mode: 'selected', success: removed > 0, removed, attempted: selected.length, timestamp: Date.now() });
    console.info('[DELETE_UI_REFRESH]', { vault: 'video-vault', mechanism: 'batch', mode: 'selected', newCount: afterCount, timestamp: Date.now() });
    console.info('[DELETE_COMPLETE]', { vault: 'video-vault', mechanism: 'batch', mode: 'selected', removed, timestamp: Date.now() });
    uploadStatus.set(
      removed > 0
        ? `🗑️ Deleted ${removed}/${selected.length} selected videos`
        : `❌ Delete failed — could not remove selected videos`
    );
    resourceManager.setTimeout(() => uploadStatus.set('Standby'), 3000);
  }

  export function handleVaultDeleteDragEnter(event) {
    allowDrop(event);
    vaultDeleteDragActive = true;
  }

  export function handleVaultDeleteDragLeave(event) {
    event.preventDefault();
    vaultDeleteDragActive = false;
  }

  export function handleVaultDeleteDragOver(event) {
    allowDrop(event);
    vaultDeleteDragActive = true;
  }

  export async function handleVaultDeleteDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    vaultDeleteDragActive = false;
    const osFiles = Array.from(event.dataTransfer?.files || []);
    if (osFiles.length > 0 && !parseVaultPayload(event.dataTransfer)) {
      await handleVaultVideoDrop(event);
      return;
    }
    const payload = parseVaultPayload(event.dataTransfer);
    if (!payload) {
      uploadStatus.set('⚠️ Nothing to delete from drop payload');
      return;
    }
    console.info('[DELETE_HANDLER_FIRED]', {
      mechanism: 'drag-drop',
      vault: payload.type === 'thumbnail' ? 'thumbnail-vault' : 'video-vault',
      itemId: String(payload.id || ''),
      itemName: String(payload.title || payload.name || ''),
      timestamp: Date.now()
    });
    if (payload.type === 'thumbnail') {
      const targetName = resolveThumbnailNameFromPayload(payload);
      const collection = get(personalThumbnailCollection);
      const index = collection.findIndex((name) => String(name || '').trim() === targetName);
      if (index < 0) {
        uploadStatus.set(`⚠️ Thumbnail not found: ${targetName || 'unknown item'}`);
        return;
      }
      await handleThumbnailRemove(index);
      return;
    }
    await handleVideoDelete(payload.id);
  }

  $: if (!deleteAuditLogged) {
    deleteAuditLogged = true;
    console.info('[DELETE_AUDIT_START]', { scope: 'vault-experience', timestamp: Date.now() });
    console.info('[DELETE_HANDLER_ATTACHED]', { vault: 'thumbnail-vault', mechanism: 'single', timestamp: Date.now() });
    console.info('[DELETE_HANDLER_ATTACHED]', { vault: 'video-vault', mechanism: 'single', timestamp: Date.now() });
    console.info('[DELETE_HANDLER_ATTACHED]', { vault: 'thumbnail-vault', mechanism: 'batch', timestamp: Date.now() });
    console.info('[DELETE_HANDLER_ATTACHED]', { vault: 'video-vault', mechanism: 'batch', timestamp: Date.now() });
    console.info('[DELETE_HANDLER_ATTACHED]', { vault: 'vault-delete-zone', mechanism: 'drag-drop', timestamp: Date.now() });
  }

  export function handleVaultThumbnailDragEnter() {
    thumbnailDragActive.set(true);
    logDrag('thumbnail-vault:dragenter');
  }

  export function handleVaultThumbnailDragLeave() {
    thumbnailDragActive.set(false);
  }

  export function handleVaultThumbnailDragOver(event) {
    allowDrop(event);
  }

  export async function handleVaultThumbnailDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    thumbnailDragActive.set(false);
    logDrag('thumbnail-vault:drop');
    pipelineDiag('DND', 'handleVaultThumbnailDrop', 'VaultExperience.svelte', { result: 'drop_received' });
    console.info('[DROP_RECEIVED]', {
      vault: 'thumbnail',
      fileCount: event.dataTransfer?.files?.length || 0,
      ts: new Date().toISOString()
    });
    vaultForensic('VAULT_DROP', {
      vaultType: 'thumbnail',
      fileName: event.dataTransfer?.files?.[0]?.name || null,
      storageLocation: 'pendingThumbnail',
      backendEndpoint: null,
      result: 'drop_received'
    });

    const file = Array.from(event.dataTransfer?.files || []).find((f) => f.type.startsWith('image/'));
    if (!file) {
      pipelineDiag('DND', 'handleVaultThumbnailDrop', 'VaultExperience.svelte', { result: 'rejected_not_image' });
      uploadStatus.set('⚠️ Please drop an image');
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 3000);
      return;
    }

    const preview = resourceManager.addBlobUrl(URL.createObjectURL(file));
    const pending = {
      file,
      preview,
      name: file.name,
      size: file.size,
      type: file.type
    };
    pendingThumbnail.set(pending);
    pipelineDiag('DND', 'handleVaultThumbnailDrop', 'VaultExperience.svelte', {
      fileName: pending.name,
      result: 'preview_pending_accept'
    });
    logVaultFieldAudit('thumbnail-vault:drop (local only — upload happens on Accept)', {
      name: pending.name,
      type: pending.type,
      size: pending.size,
      preview: pending.preview
    });
    logDrag('thumbnail-vault:drop', { name: pending.name, type: pending.type, size: pending.size });
    uploadStatus.set(`🖼️ Preview: ${file.name} - Accept or Reject`);
  }

  export function handleVaultVideoDragEnter(event) {
    allowDrop(event);
    videoDragActive.set(true);
    logDrag('video-vault:dragenter');
    const probe = event?.dataTransfer?.files?.[0];
    console.info('[MP4_DROP_START]', {
      fileName: probe?.name || null,
      fileSize: probe?.size ?? null,
      fileType: probe?.type || null,
      eventType: 'dragenter'
    });
    console.info('[BG7G_DROP]', {
      ts: new Date().toISOString(),
      component: 'handleVaultVideoDragEnter',
      file: 'VaultExperience.svelte',
      fileName: null,
      fileSize: null,
      uploadUrl: null,
      state: 'dragenter',
      fileCount: event?.dataTransfer?.types?.length || 0
    });
  }

  export function handleVaultVideoDragLeave(event) {
    const related = event?.relatedTarget;
    if (related && event.currentTarget?.contains?.(related)) return;
    videoDragActive.set(false);
  }

  export function handleVaultVideoDragOver(event) {
    allowDrop(event);
  }

  export async function handleVaultVideoDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    videoDragActive.set(false);
    const dropFiles = Array.from(event.dataTransfer?.files || []);
    const probe = dropFiles[0];
    console.info('[MP4_DROP_START]', {
      fileName: probe?.name || null,
      fileSize: probe?.size ?? null,
      fileType: probe?.type || null,
      eventType: 'drop',
      fileCount: dropFiles.length
    });
    console.info('[BG7G_DROP]', {
      ts: new Date().toISOString(),
      component: 'handleVaultVideoDrop',
      file: 'VaultExperience.svelte',
      fileName: null,
      fileSize: null,
      uploadUrl: null,
      state: 'drop_received',
      fileCount: event.dataTransfer?.files?.length || 0
    });
    logDrag('video-vault:drop');
    pipelineDiag('DND', 'handleVaultVideoDrop', 'VaultExperience.svelte', { result: 'drop_received' });
    pipelineCheckpoint('DROP_RECEIVED', {
      filename: null,
      vault: 'mp4',
      kind: 'mp4-vault',
      id: null,
      fileCount: event.dataTransfer?.files?.length || 0,
      timestamp: new Date().toISOString()
    });
    console.info('[DROP_RECEIVED]', {
      vault: 'video',
      fileCount: event.dataTransfer?.files?.length || 0,
      ts: new Date().toISOString()
    });
    vaultForensic('VAULT_DROP', {
      vaultType: 'video',
      fileName: event.dataTransfer?.files?.[0]?.name || null,
      storageLocation: CONFIG?.VIDEO_VAULT_KEY || 'personal_video_vault',
      backendEndpoint: `${API_BASE_URL}/api/reels`,
      result: 'drop_received'
    });

    const file = dropFiles.find((f) => {
      const type = (f.type || '').toLowerCase();
      const name = (f.name || '').toLowerCase();
      return (
        type.startsWith('video/') ||
        (type === 'application/octet-stream' && /\.(mp4|mov|webm|m4v)$/.test(name)) ||
        name.endsWith('.mp4') ||
        name.endsWith('.mov') ||
        name.endsWith('.webm') ||
        name.endsWith('.m4v')
      );
    });

    if (!file) {
      console.info('[MP4_DROP_REJECTED]', {
        reason: 'no_valid_video_in_transfer',
        fileCount: dropFiles.length,
        types: dropFiles.map((f) => f.type || 'unknown'),
        names: dropFiles.map((f) => f.name || 'unknown'),
        sizes: dropFiles.map((f) => f.size ?? null)
      });
      console.info('[BG7G_DROP]', {
        ts: new Date().toISOString(),
        component: 'handleVaultVideoDrop',
        file: 'VaultExperience.svelte',
        fileName: null,
        fileSize: null,
        uploadUrl: null,
        state: 'failure',
        reason: 'rejected_invalid_file'
      });
      pipelineDiag('DND', 'handleVaultVideoDrop', 'VaultExperience.svelte', { result: 'rejected_invalid_file' });
      uploadStatus.set('⚠️ Drop a valid video file');
      return;
    }
    stagePendingVaultVideo(file, 'drop');
  }

  /** Blob <video> previews freeze the tab on large MP4s (e.g. condo ~346MB). */
  const VAULT_BLOB_PREVIEW_MAX_BYTES = 24 * 1024 * 1024;

  function clearPendingVaultVideo() {
    const current = get(pendingVaultVideo);
    if (current?.preview) {
      try {
        URL.revokeObjectURL(current.preview);
      } catch {
        /* ignore */
      }
      try {
        resourceManager.revokeBlobUrl?.(current.preview);
      } catch {
        /* ignore */
      }
    }
    const pendingId = String(current?.id || '').trim();
    if (pendingId || current) {
      personalVideos.update((videos) =>
        (Array.isArray(videos) ? videos : []).filter((item) => {
          if (!item) return false;
          if (pendingId && String(item.id || '').trim() === pendingId) return false;
          if (String(item.uploadState || '') === 'pending_accept') return false;
          return true;
        })
      );
    }
    pendingVaultVideo.set(null);
  }

  function stagePendingVaultVideo(file, source = 'drop') {
    if (!file) return;
    if (Number(file.size || 0) <= 0) {
      console.info('[MP4_DROP_REJECTED]', {
        reason: 'zero_byte_file',
        fileName: file.name || null,
        fileSize: file.size,
        source
      });
      uploadStatus.set('⚠️ Empty file rejected — choose a real MP4/MOV');
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 4000);
      return;
    }
    if (file.size > CONFIG.MAX_VIDEO_SIZE) {
      uploadStatus.set(`⚠️ Video too large. Max ${CONFIG.MAX_VIDEO_SIZE / 1024 / 1024}MB`);
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 3000);
      return;
    }
    clearPendingVaultVideo();
    vaultAcceptInFlight = false;
    const skipBlobPreview = Number(file.size || 0) > VAULT_BLOB_PREVIEW_MAX_BYTES;
    let preview = '';
    if (!skipBlobPreview) {
      preview =
        typeof resourceManager?.addBlobUrl === 'function'
          ? resourceManager.addBlobUrl(URL.createObjectURL(file))
          : URL.createObjectURL(file);
    }
    const pendingId = `local-pending-${Date.now()}`;
    const pending = {
      id: pendingId,
      file,
      preview,
      skipBlobPreview,
      name: file.name,
      size: file.size,
      type: file.type || 'video/mp4'
    };
    // Insert grid card immediately — never attach 362MB blob as card media.
    const stagedCard = {
      id: pendingId,
      name: file.name,
      fileName: file.name,
      title: file.name,
      url: '',
      type: file.type || 'video/mp4',
      size: file.size,
      addedAt: new Date().toISOString(),
      uploadState: 'pending_accept',
      isOptimisticLocal: true
    };
    personalVideos.update((videos) => {
      const next = [
        stagedCard,
        ...(Array.isArray(videos) ? videos : []).filter(
          (item) =>
            item &&
            String(item.uploadState || '') !== 'pending_accept' &&
            !String(item.id || '').startsWith('local-pending-')
        )
      ];
      try {
        persistPersonalVault(next);
      } catch {
        /* ignore */
      }
      return next;
    });
    pendingVaultVideo.set(pending);
    console.info('[MP4_PENDING_PREVIEW]', {
      source,
      fileName: pending.name,
      fileSize: pending.size,
      fileType: pending.type,
      pendingId,
      skipBlobPreview,
      ts: new Date().toISOString()
    });
    console.info('[VIDEO_VAULT_INSERT]', {
      source: 'stagePendingVaultVideo',
      id: pendingId,
      uploadState: 'pending_accept',
      url: preview ? String(preview).slice(0, 80) : '',
      skipBlobPreview,
      ts: new Date().toISOString()
    });
    pipelineDiag('DND', 'stagePendingVaultVideo', 'VaultExperience.svelte', {
      fileName: pending.name,
      result: skipBlobPreview ? 'pending_accept_no_blob_preview' : 'preview_pending_accept'
    });
    const sizeMb = (Number(file.size || 0) / (1024 * 1024)).toFixed(1);
    uploadStatus.set(
      skipBlobPreview
        ? `🎬 ${file.name} (${sizeMb} MB) staged — preview skipped for large files. Ready to upload — click ACCEPT`
        : `🎬 ${file.name} (${sizeMb} MB) staged. Ready to upload — click ACCEPT`
    );
  }

  export async function acceptPendingVideo() {
    console.info('[MP4_PENDING_ACCEPT_CLICK]', {
      hasPending: Boolean(get(pendingVaultVideo)?.file),
      adminSessionReady,
      acceptInFlight: vaultAcceptInFlight,
      ts: new Date().toISOString()
    });
    if (vaultAcceptInFlight) {
      uploadStatus.set('⏳ Upload already in progress');
      return;
    }
    const pending = get(pendingVaultVideo);
    if (!pending?.file) {
      uploadStatus.set('⚠️ No pending video to accept');
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
      return;
    }
    if (Number(pending.size || pending.file?.size || 0) <= 0) {
      uploadStatus.set('⚠️ Empty file rejected — choose a real MP4/MOV');
      clearPendingVaultVideo();
      return;
    }
    if (!getAdminToken()) {
      uploadStatus.set('🔐 Studio login required — open Studio, sign in, then Accept');
      refreshAdminSessionReady();
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 5000);
      return;
    }
    vaultAcceptInFlight = true;
    console.info('[MP4_PENDING_ACCEPT]', {
      fileName: pending.name,
      fileSize: pending.size,
      skipBlobPreview: Boolean(pending.skipBlobPreview),
      ts: new Date().toISOString()
    });
    const file = pending.file;
    const previewUrl = String(pending.preview || '').trim();
    const pendingId = String(pending.id || '').trim();
    const optimisticId = pendingId.startsWith('local-pending-')
      ? `local-upload-${Date.now()}`
      : pendingId || `local-upload-${Date.now()}`;
    // Clear pending UI without revoking blob until processVaultVideoFile finishes replace.
    pendingVaultVideo.set(null);
    const optimisticEntry = {
      id: optimisticId,
      name: file.name,
      fileName: file.name,
      title: file.name,
      url: '',
      type: file.type || 'video/mp4',
      size: file.size,
      addedAt: new Date().toISOString(),
      uploadState: 'uploading',
      isOptimisticLocal: true
    };
    personalVideos.update((videos) => {
      const filtered = (Array.isArray(videos) ? videos : []).filter((item) => {
        if (!item) return false;
        if (pendingId && String(item.id || '').trim() === pendingId) return false;
        if (String(item.uploadState || '') === 'pending_accept') return false;
        return true;
      });
      const next = [optimisticEntry, ...filtered];
      try {
        persistPersonalVault(next);
      } catch {
        /* ignore */
      }
      return next;
    });
    console.info('[VIDEO_VAULT_INSERT]', {
      source: 'acceptPendingVideo:optimistic',
      id: optimisticId,
      url: '',
      size: file.size,
      uploadState: 'uploading',
      ts: new Date().toISOString()
    });
    uploadStatus.set(
      `⬆️ Uploading ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB) — keep this tab open`
    );
    try {
      await processVaultVideoFile(file, 'pending_accept', {
        optimisticId,
        previewUrl
      });
    } catch (err) {
      console.error('[MP4_PENDING_ACCEPT_ERROR]', {
        message: err?.message || String(err),
        ts: new Date().toISOString()
      });
      markOptimisticVaultUploadFailed(optimisticId, err?.message || 'accept_threw');
      uploadStatus.set(`❌ Failed: ${err?.message || 'unknown error'} — tap Retry upload`);
    } finally {
      vaultAcceptInFlight = false;
    }
  }

  export function rejectPendingVideo() {
    const pending = get(pendingVaultVideo);
    console.info('[MP4_PENDING_REJECT]', {
      fileName: pending?.name || null,
      ts: new Date().toISOString()
    });
    clearPendingVaultVideo();
    uploadStatus.set('Rejected video');
    resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
  }

  function markOptimisticVaultUploadFailed(optimisticId, detail = '') {
    const id = String(optimisticId || '').trim();
    if (!id) return;
    personalVideos.update((videos) => {
      const next = (Array.isArray(videos) ? videos : []).map((item) => {
        if (String(item?.id || '').trim() !== id) return item;
        const deadUrl = String(item?.url || '').trim();
        if (deadUrl.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(deadUrl);
          } catch {
            /* ignore */
          }
          try {
            resourceManager.revokeBlobUrl?.(deadUrl);
          } catch {
            /* ignore */
          }
        }
        return {
          ...item,
          // Clear dead preview so the ⚠ placeholder branch always wins over MediaRenderer.
          url: '',
          uploadState: 'failed',
          uploadError: String(detail || 'upload_failed')
        };
      });
      try {
        persistPersonalVault(next);
      } catch {
        /* ignore */
      }
      return next;
    });
    // Remove any feed cards that pointed at this unfinished upload.
    try {
      feed.update((currentFeed) => {
        const next = { ...currentFeed };
        for (const cat of Object.keys(next)) {
          next[cat] = (next[cat] || []).filter(
            (r) => !(r?.isPersonalVideo && String(r?.personal_video_id || r?.id || '') === id)
          );
        }
        return next;
      });
    } catch {
      /* ignore */
    }
  }

  function purgeFailedVaultVideo(video) {
    const id = String(video?.id || '').trim();
    if (!id) return;
    console.info('[MP4_FAILED_PURGE]', {
      id,
      fileName: video?.fileName || video?.name || null,
      uploadError: video?.uploadError || null,
      ts: new Date().toISOString()
    });
    handleVideoDelete(id, video);
  }

  function retryFailedVaultVideo(video) {
    const id = String(video?.id || '').trim();
    const err = String(video?.uploadError || '');
    console.info('[MP4_FAILED_RETRY]', {
      id,
      fileName: video?.fileName || video?.name || null,
      uploadError: err || null,
      ts: new Date().toISOString()
    });
    refreshAdminSessionReady();
    if (isInvalidSessionError(err) || /invalid_session/i.test(err)) {
      if (!getAdminToken()) {
        uploadStatus.set('🔐 Sign in via Studio first, then tap Retry upload again');
        resourceManager.setTimeout(() => uploadStatus.set('Standby'), 6000);
        return;
      }
    }
    if (id) {
      personalVideos.update((videos) => {
        const next = (Array.isArray(videos) ? videos : []).filter(
          (item) => String(item?.id || '').trim() !== id
        );
        try {
          persistPersonalVault(next);
        } catch {
          /* ignore */
        }
        return next;
      });
      try {
        feed.update((currentFeed) => {
          const next = { ...currentFeed };
          for (const cat of Object.keys(next)) {
            next[cat] = (next[cat] || []).filter(
              (r) => !(r?.isPersonalVideo && String(r?.personal_video_id || r?.id || '') === id)
            );
          }
          return next;
        });
      } catch {
        /* ignore */
      }
    }
    uploadStatus.set('🔁 Choose the MP4 again to retry upload');
    openVaultVideoFilePicker();
  }

  function removeOptimisticVaultEntry(optimisticId) {
    const id = String(optimisticId || '').trim();
    if (!id) return;
    personalVideos.update((videos) => {
      const next = (Array.isArray(videos) ? videos : []).filter(
        (item) => String(item?.id || '').trim() !== id
      );
      try {
        persistPersonalVault(next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  /**
   * Creator identity confirmation → seal vault identity only.
   * Target is always event.detail.mediaAssetId (never display index / S/E / filename).
   * Preserves mediaAssetId / playback refs; does not touch catalog order or publish state.
   * @param {{ seriesLabel?: string; seasonNumber?: number; episodeNumber?: number; mediaAssetId?: string }} detail
   * @param {string} [cardMediaAssetId]
   */
  function confirmVaultVideoIdentity(detail, cardMediaAssetId = '') {
    const target = resolveCreatorCardMutationTarget(detail, cardMediaAssetId);
    const id = target.mediaAssetId;
    if (!id) {
      console.warn('[VAULT_IDENTITY_CONFIRM]', target.reason || 'missing mediaAssetId');
      return;
    }
    if (!target.ok) {
      console.warn('[VAULT_CARD_TARGET_MISMATCH]', {
        action: 'identity',
        reason: target.reason,
        mediaAssetId: id
      });
    }
    personalVideos.update((videos) => {
      const list = Array.isArray(videos) ? videos : [];
      try {
        const { list: next, mutated } = applyIdentityToVaultListByMediaAssetId(list, id, {
          seriesLabel: detail?.seriesLabel,
          seasonNumber: detail?.seasonNumber,
          episodeNumber: detail?.episodeNumber
        });
        const cross = assertNoCrossWrite(list, next, id);
        if (!cross.ok) {
          console.error('[VAULT_CROSS_WRITE_BLOCKED]', { action: 'identity', mediaAssetId: id, violations: cross.violations });
        }
        console.info('[VAULT_CARD_MUTATION]', {
          action: 'identity',
          mediaAssetId: id,
          cardMediaAssetId: String(cardMediaAssetId || '').trim() || null,
          mutated,
          crossWriteOk: cross.ok
        });
        if (!mutated) return list;
        try {
          persistPersonalVault(next);
        } catch {
          /* ignore */
        }
        return next;
      } catch (err) {
        console.warn('[VAULT_IDENTITY_CONFIRM]', err);
        return list;
      }
    });
  }

  /**
   * Creator episode package (title / description / artwork / tags / category).
   * Target is always event.detail.mediaAssetId (never display index / S/E / filename).
   * Vault enrichment preserves presentation; creatorCatalogMetadata writes feed authority
   * into existing reel_titles_persistent + reelforge_series_metadata (+ category PATCH).
   * Phase 20: returns save feedback for VaultEpisodeCreatorStatus (saving → saved/error).
   * @param {{ title?: string; description?: string; artworkUrl?: string; mediaAssetId?: string; tags?: string; category?: string; saveToken?: number }} detail
   * @param {string} [cardMediaAssetId]
   */
  function saveVaultEpisodeEnrichment(detail, cardMediaAssetId = '') {
    const target = resolveCreatorCardMutationTarget(detail, cardMediaAssetId);
    const id = target.mediaAssetId;
    const saveToken = Number(detail?.saveToken) || 0;
    const feedbackKey = id || String(cardMediaAssetId || '').trim() || '_unknown';
    /** @type {{ saveToken: number; ok: boolean; shelf: string; explicit: boolean; error: string; savedAt: number }} */
    const feedback = {
      saveToken,
      ok: false,
      shelf: 'Trending',
      explicit: false,
      error: '',
      savedAt: Date.now()
    };

    const publishFeedback = () => {
      vaultPackageSaveFeedback = { ...vaultPackageSaveFeedback, [feedbackKey]: feedback };
    };

    if (!id) {
      console.warn('[VAULT_EPISODE_ENRICH]', target.reason || 'missing mediaAssetId');
      feedback.error = 'Missing media asset id';
      publishFeedback();
      return feedback;
    }
    if (!target.ok) {
      console.warn('[VAULT_CARD_TARGET_MISMATCH]', {
        action: 'package',
        reason: target.reason,
        mediaAssetId: id
      });
    }
    personalVideos.update((videos) => {
      const list = Array.isArray(videos) ? videos : [];
      try {
        const { list: next, mutated } = applyPackageToVaultListByMediaAssetId(list, id, {
          title: detail?.title,
          description: detail?.description,
          artworkUrl: detail?.artworkUrl
        });
        const cross = assertNoCrossWrite(list, next, id);
        if (!cross.ok) {
          console.error('[VAULT_CROSS_WRITE_BLOCKED]', { action: 'package', mediaAssetId: id, violations: cross.violations });
        }
        console.info('[VAULT_CARD_MUTATION]', {
          action: 'package',
          mediaAssetId: id,
          cardMediaAssetId: String(cardMediaAssetId || '').trim() || null,
          mutated,
          crossWriteOk: cross.ok
        });
        if (!mutated) return list;
        try {
          persistPersonalVault(next);
        } catch {
          /* ignore */
        }
        return next;
      } catch (err) {
        console.warn('[VAULT_EPISODE_ENRICH]', err);
        return list;
      }
    });
    // Phase 17 — durable catalog metadata for Smart Catalog (existing stores only).
    try {
      const savedMeta = saveCreatorCatalogMetadata(id, {
        title: detail?.title,
        description: detail?.description,
        tags: detail?.tags,
        category: detail?.category
      });
      console.info('[CREATOR_CATALOG_METADATA]', {
        mediaAssetId: id,
        hasTitle: Boolean(String(detail?.title || '').trim()),
        hasDescription: Boolean(String(detail?.description || '').trim()),
        hasTags: Boolean(String(detail?.tags || '').trim()),
        category: String(detail?.category || 'Trending')
      });
      // Immediate live-feed reshelf from reel_titles_persistent (no reload).
      // Mirror/PATCH failures inside saveCreatorCatalogMetadata must not block this —
      // primary local metadata remains authoritative when savedMeta is returned.
      if (savedMeta) {
        try {
          AI_CLEANUP_AGENT?.applyPersistedTitlesOverlay?.();
        } catch (overlayErr) {
          console.warn('[CREATOR_CATALOG_METADATA] post-save overlay', overlayErr);
        }
        const vaultList = Array.isArray(get(personalVideos)) ? get(personalVideos) : [];
        const matched = vaultList.find((v) => String(v?.id || '').trim() === id);
        const preview = previewCreatorShelfClassification({
          title: detail?.title,
          description: detail?.description,
          tags: detail?.tags,
          category: detail?.category,
          fileName: String(matched?.fileName || matched?.name || '')
        });
        feedback.ok = true;
        feedback.shelf = preview.primaryCategory || 'Trending';
        feedback.explicit = Boolean(preview.explicit);
        feedback.error = '';
      } else {
        feedback.error = 'Metadata could not be saved';
      }
    } catch (err) {
      console.warn('[CREATOR_CATALOG_METADATA]', err);
      feedback.error = err instanceof Error ? err.message : 'Metadata save failed';
    }
    publishFeedback();
    return feedback;
  }

  function isVaultVideoFileCandidate(f) {
    if (!f) return false;
    const type = (f.type || '').toLowerCase();
    const name = (f.name || '').toLowerCase();
    return (
      type.startsWith('video/') ||
      (type === 'application/octet-stream' && /\.(mp4|mov|webm|m4v)$/.test(name)) ||
      name.endsWith('.mp4') ||
      name.endsWith('.mov') ||
      name.endsWith('.webm') ||
      name.endsWith('.m4v')
    );
  }

  /** Click-to-upload fallback when OS / browser DnD never fires drop. */
  function openVaultVideoFilePicker() {
    if (get(pendingVaultVideo)) return;
    console.info('[MP4_FILE_PICKER]', { action: 'open', ts: new Date().toISOString() });
    videoFileInputEl?.click?.();
  }

  async function handleVaultVideoFileInput(event) {
    const files = Array.from(event?.currentTarget?.files || []);
    const file = files.find((f) => isVaultVideoFileCandidate(f));
    try {
      if (event?.currentTarget) event.currentTarget.value = '';
    } catch {
      /* ignore */
    }
    console.info('[MP4_FILE_PICKER]', {
      action: 'selected',
      fileName: file?.name || null,
      fileSize: file?.size ?? null,
      fileCount: files.length,
      ts: new Date().toISOString()
    });
    if (!file) {
      uploadStatus.set('⚠️ Choose a valid MP4/MOV file');
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 3000);
      return;
    }
    stagePendingVaultVideo(file, 'file_picker');
  }

  async function processVaultVideoFile(file, source = 'drop', options = {}) {
    const optimisticId = String(options?.optimisticId || '').trim();
    const previewUrl = String(options?.previewUrl || '').trim();
    console.info('[MP4_UPLOAD_SOURCE]', {
      source,
      fileName: file?.name || null,
      fileSize: file?.size ?? null,
      fileType: file?.type || null,
      optimisticId: optimisticId || null,
      ts: new Date().toISOString()
    });
    console.info('[MP4_DROP_ACCEPTED]', {
      fileName: file.name,
      uploadPath: 'processVaultVideoFile→uploadMedia'
    });
    console.info('[BG7G_DROP]', {
      ts: new Date().toISOString(),
      component: 'handleVaultVideoDrop',
      file: 'VaultExperience.svelte',
      fileName: file.name,
      fileSize: file.size,
      uploadUrl: null,
      state: 'file_accepted',
      mime: file.type || ''
    });
    pipelineCheckpoint('DROP_RECEIVED', {
      filename: file.name,
      vault: 'mp4',
      kind: 'mp4-vault',
      id: null,
      timestamp: new Date().toISOString()
    });

    if (file.size > CONFIG.MAX_VIDEO_SIZE) {
      uploadStatus.set(`⚠️ Video too large. Max ${CONFIG.MAX_VIDEO_SIZE / 1024 / 1024}MB`);
      markOptimisticVaultUploadFailed(optimisticId, 'too_large');
      return;
    }

    const incomingName = String(file?.name || '').trim();
    const incomingSize = Number(file?.size || 0);
    const uploadKey = `${incomingName.toLowerCase()}|${incomingSize}`;

    if (!getAdminToken()) {
      uploadStatus.set('🔐 Studio login required — open Studio, sign in, then retry upload');
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 5000);
      markOptimisticVaultUploadFailed(optimisticId, 'missing_auth');
      return;
    }

    // Only short-circuit when this drop is the *already-active* hero file (same name+size).
    // Matching bare fileName via isHeroAsset() blocked normal Video Vault / re-drops.
    const activeHero = resolveActiveHeroVideoReel();
    const heroFileName = String(activeHero?.fileName || activeHero?.name || '').trim();
    const heroSize = Number(activeHero?.size || 0);
    if (
      activeHero?.url &&
      incomingName &&
      heroFileName &&
      incomingName === heroFileName &&
      (!heroSize || !incomingSize || heroSize === incomingSize)
    ) {
      console.info('[BG7W_HERO_VAULT_GATE]', {
        reelId: String(activeHero?.id || '').trim(),
        blocked: false,
        reason: 'active_hero_file_already_displayed',
        fileName: incomingName
      });
      uploadStatus.set(`✅ Hero background — visible in vault below`);
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2500);
      removeOptimisticVaultEntry(optimisticId);
      return;
    }

    // BG-7X: pre-upload dedupe gate (avoid creating duplicate backend assets).
    try {
      if (hasActiveUploadLock(uploadKey)) {
        if (isUploadLockStale(uploadKey) || isUploadLockAbandoned(uploadKey)) {
          supersedeStaleUploadLock(uploadKey, {
            incomingName,
            incomingSize,
            abandoned: isUploadLockAbandoned(uploadKey)
          });
        } else {
          const ageSec = Math.round(getUploadLockAgeMs(uploadKey) / 1000);
          const idleSec = Math.round(getUploadLockIdleMs(uploadKey) / 1000);
          const staleMs = uploadLockStaleMsForSize(incomingSize);
          const retrySec = Math.max(1, Math.ceil((staleMs - getUploadLockIdleMs(uploadKey)) / 1000));
          trackUploadLockBlock(uploadKey, {
            existingId: '',
            reason: 'in_flight_name_and_size_match'
          });
          console.info('[BG7X_UPLOAD_DEDUPE]', {
            blocked: true,
            reason: 'in_flight_name_and_size_match',
            existingId: '',
            incomingName,
            incomingSize,
            ageSec,
            idleSec,
            retrySec,
            staleMs
          });
          uploadStatus.set(
            `⏳ Upload in progress (${ageSec}s). Retry in ~${retrySec}s if stuck.`
          );
          resourceManager.setTimeout(() => uploadStatus.set('Standby'), 4000);
          markOptimisticVaultUploadFailed(optimisticId, 'in_flight_lock');
          return;
        }
      }
      const persisted = JSON.parse(
        (typeof window !== 'undefined' ? localStorage.getItem(CONFIG.VIDEO_VAULT_KEY) : null) || '[]'
      );
      const existing = Array.isArray(persisted) ? persisted : [];
      const match = existing.find((item) => {
        if (!item || typeof item !== 'object') return false;
        // Ignore the optimistic card we just inserted for this Accept.
        if (item.isOptimisticLocal || String(item.uploadState || '') === 'uploading') return false;
        if (optimisticId && String(item.id || '').trim() === optimisticId) return false;
        const existingSize = Number(item?.size || 0);
        if (!incomingSize || !existingSize || existingSize !== incomingSize) return false;
        const existingFileName = String(item?.fileName || item?.file_name || '').trim();
        const existingName = String(item?.name || item?.title || '').trim();
        return (
          (existingFileName && incomingName && existingFileName === incomingName) ||
          (existingName && incomingName && existingName === incomingName)
        );
      });
      if (match) {
        // Outline-only leftover (no playable URL) must not block re-upload of the same file.
        if (isGhostVideoVaultEntry(match)) {
          const ghostId = String(match?.id || '').trim();
          console.info('[BG7X_UPLOAD_DEDUPE]', {
            blocked: false,
            reason: 'ghost_outline_purged_for_reupload',
            existingId: ghostId,
            incomingName,
            incomingSize
          });
          if (ghostId) {
            applyVideoDeleteTombstone([ghostId]);
          } else {
            personalVideos.update((vault) => {
              const next = (Array.isArray(vault) ? vault : []).filter((item) => {
                if (!item || typeof item !== 'object') return false;
                const existingSize = Number(item?.size || 0);
                if (!incomingSize || existingSize !== incomingSize) return true;
                const existingFileName = String(item?.fileName || item?.file_name || '').trim();
                const existingName = String(item?.name || item?.title || '').trim();
                const sameName =
                  (existingFileName && existingFileName === incomingName) ||
                  (existingName && existingName === incomingName);
                return !sameName;
              });
              try {
                persistPersonalVault(next);
              } catch {
                /* ignore */
              }
              return next;
            });
          }
          trackUploadLockRemove(uploadKey, { reason: 'ghost_outline_purged_for_reupload' });
          // fall through to start a fresh upload
        } else {
          console.info('[BG7X_UPLOAD_DEDUPE]', {
            blocked: true,
            reason: 'name_or_fileName_and_size_match',
            existingId: String(match?.id || '').trim(),
            incomingName,
            incomingSize
          });
          uploadStatus.set(`✅ Already in vault: ${incomingName || 'video'}`);
          resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
          removeOptimisticVaultEntry(optimisticId);
          return match;
        }
      }
    } catch (e) {
      console.warn('[BG7X_UPLOAD_DEDUPE]', {
        blocked: false,
        reason: 'exception_fallback_to_upload',
        detail: e?.message || String(e)
      });
    }

    trackUploadLockRegister(uploadKey, { reason: 'upload_reserved' });
    setPendingUploads(getActiveUploadLockCount());

    const validation = await validateVideoFile(file);
    if (!validation.valid) {
      trackUploadLockRemove(uploadKey, { reason: 'validation_failed' });
      setPendingUploads(getActiveUploadLockCount());
      console.info('[MP4_UPLOAD_ERROR]', {
        stage: 'validateVideoFile',
        error: validation.reason || 'Invalid video file'
      });
      console.info('[BG7G_DROP]', {
        ts: new Date().toISOString(),
        component: 'validateVideoFile',
        file: 'VaultExperience.svelte',
        fileName: file.name,
        fileSize: file.size,
        uploadUrl: null,
        state: 'failure',
        reason: validation.reason || 'Invalid video file'
      });
      uploadStatus.set(`⚠️ ${validation.reason || 'Invalid video file'}`);
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 3000);
      markOptimisticVaultUploadFailed(optimisticId, validation.reason || 'validation_failed');
      return;
    }

    const uploadDiagCtx = createUploadAttemptContext({
      uploadKey,
      fileName: incomingName,
      fileSize: incomingSize
    });
    const uploadTimeoutMs =
      Number(file.size || 0) >= SIGNED_UPLOADS_MIN_BYTES
        ? VAULT_UPLOAD_TIMEOUT_MS_LARGE
        : VAULT_UPLOAD_TIMEOUT_MS_DEFAULT;
    let uploadTimedOut = false;
    const uploadAbortController = new AbortController();
    uploadDiagCtx.abortSignal = uploadAbortController.signal;
    let uploadAbortTimer;
    try {
    logUploadStage(uploadDiagCtx, 'LOCK_ACQUIRED', {
      pendingLockCountBeforeAdd: getActiveUploadLockCount()
    });
    touchUploadLockProgress(uploadKey);
    setPendingUploads(getActiveUploadLockCount());
    console.info('[BG7G_UPLOAD]', {
      ts: new Date().toISOString(),
      component: 'handleVaultVideoDrop',
      file: 'VaultExperience.svelte',
      fileName: file.name,
      fileSize: file.size,
      uploadUrl: `${API_BASE_URL}/api/reels`,
      state: 'upload_start'
    });
    uploadStatus.set(
      `🎬 Uploading ${incomingName} (${Math.round(incomingSize / 1024 / 1024)}MB) — keep this tab open`
    );
    console.info('[MP4_UPLOAD_BEGIN]', {
      fileName: file.name,
      size: file.size
    });
    vaultForensic('VAULT_UPLOAD_START', {
      vaultType: 'video',
      fileName: file.name,
      storageLocation: CONFIG?.VIDEO_VAULT_KEY || 'personal_video_vault',
      backendEndpoint: `${API_BASE_URL}/api/reels`,
      result: 'upload_start'
    });
    pipelineDiag('UPLOAD', 'handleVaultVideoDrop', 'VaultExperience.svelte', {
      fileName: file.name,
      result: 'upload_start'
    });
    pipelineCheckpoint('UPLOAD_STARTED', {
      vault: 'mp4',
      filename: file.name,
      size: file.size
    });
    console.info('[UPLOAD_STARTED]', {
      vault: 'video',
      name: file.name,
      type: file.type || '',
      size: file.size || 0,
      ts: new Date().toISOString()
    });
      const formData = new FormData();
      formData.append('video', file);
      formData.append('category', vaultUploadCategory || 'Trending');
      appendUploadIdentityToFormData(formData, {
        episodeId: uploadEpisodeId,
        seriesId: uploadSeriesId,
        source: uploadEpisodeId ? 'vault:studio_attach' : 'vault:drop'
      });
      logUploadStage(uploadDiagCtx, 'UPLOAD_MEDIA_BEGIN');
      uploadAbortTimer = setTimeout(() => {
        uploadTimedOut = true;
        console.warn('[BG7X_UPLOAD_TIMEOUT]', {
          uploadAttemptId: uploadDiagCtx.uploadAttemptId,
          fileName: file.name,
          fileSize: file.size,
          timeoutMs: uploadTimeoutMs
        });
        uploadAbortController.abort();
      }, uploadTimeoutMs);
      const response = await uploadMedia(formData, getAdminAuthHeaders(), uploadDiagCtx);
      logUploadStage(uploadDiagCtx, 'UPLOAD_MEDIA_RETURNED', {
        reelId: response?.id || ''
      });
      if (response?.id) {
        noteUploadLockReelId(uploadKey, String(response.id));
        patchUploadDiagContext(uploadDiagCtx, { reelId: String(response.id) });
        const boundEpisodeId = String(uploadEpisodeId || '').trim();
        if (boundEpisodeId) {
          bindEpisodeToFeedReel(String(response.id), boundEpisodeId, {
            source: 'vault_upload_finalize'
          });
        }
      }
      console.info('[BG7G_UPLOAD]', {
        ts: new Date().toISOString(),
        component: 'handleVaultVideoDrop',
        file: 'VaultExperience.svelte',
        fileName: file.name,
        fileSize: file.size,
        uploadUrl:
          response?.url ||
          response?.videoUrl ||
          response?.video_url ||
          `${API_BASE_URL}/api/reels`,
        state: 'success',
        reelId: response?.id || null
      });
      logVaultFieldAudit('POST /api/reels response (video vault drop)', response);
      reelResReelSnapshot('handleVaultVideoDrop:uploadResponse', response, { vault: 'mp4' });

      const resolvedUrl =
        response?.url ||
        response?.videoUrl ||
        response?.video_url ||
        '';
      const canonicalFileName =
        response?.fileName ||
        response?.file_name ||
        (resolvedUrl ? String(resolvedUrl).split('/').pop()?.split('?')[0] || '' : '');
      const normalizedResponse = {
        ...response,
        url: resolvedUrl,
        thumbnailUrl:
          response?.thumbnailUrl ||
          response?.thumbnail_url ||
          response?.thumbnailPath ||
          response?.thumbnail_path ||
          '',
        name: file.name || response?.name || response?.title || 'Untitled',
        fileName: canonicalFileName
      };

      const vaultEntry = reelToVaultEntry(normalizedResponse);
      reelResReelSnapshot('handleVaultVideoDrop:vaultEntry', vaultEntry, {
        vault: 'mp4',
        isVideoUrl: Boolean(vaultEntry?.url && String(vaultEntry.url).includes('/videos/'))
      });
      // Durable Hero Vault identity (seriesLabel S/E) from file/title labels — not admin metadata
      const entry = /** @type {Record<string, unknown>} */ (
        sealVaultSeriesIdentityForStorage({
          ...vaultEntry,
          size: file.size,
          type: file.type || vaultEntry.type,
          addedAt: response.createdAt || response.created_at || new Date().toISOString()
        }) || {
          ...vaultEntry,
          size: file.size,
          type: file.type || vaultEntry.type,
          addedAt: response.createdAt || response.created_at || new Date().toISOString()
        }
      );
      if (isHeroAsset(entry)) {
        // Still show in MP4 vault — hero domain should not hide a successful content upload.
        console.warn('[BG7W_HERO_VAULT_GATE]', {
          reelId: String(entry?.id || '').trim(),
          blocked: false,
          reason: 'hero_identity_match_allowed_in_content_vault',
          fileName: entry.fileName || file.name
        });
      }
      console.info('[VIDEO_VAULT_INSERT]', {
        source: 'VaultExperience.processVaultVideoFile',
        id: entry.id || '',
        mime: entry.type || '',
        url: entry.url || '',
        thumbnail: entry.thumbnail || '',
        optimisticId: optimisticId || null,
        ts: new Date().toISOString()
      });

      personalVideos.update((videos) => {
        const before = videos;
        const identityKey = (item) => {
          const rawUrl = String(item?.url || item?.video_url || '').trim();
          const canonicalUrl = rawUrl ? toRelativeMediaPath(rawUrl) : '';
          if (canonicalUrl && !canonicalUrl.startsWith('blob:')) return canonicalUrl;
          const fileName = String(item?.fileName || item?.file_name || '').trim();
          if (fileName) return `name:${fileName}`;
          return String(item?.id || '').trim();
        };
        const incomingKey = identityKey(entry);
        const filtered = videos.filter((item) => {
          const itemId = String(item?.id || '').trim();
          if (optimisticId && itemId === optimisticId) return false;
          if (item?.isOptimisticLocal && String(item?.fileName || item?.name || '') === String(file.name)) {
            return false;
          }
          const existingKey = identityKey(item);
          const match = Boolean(incomingKey) && Boolean(existingKey) && incomingKey === existingKey;
          if (match) {
            console.info('[BG7W_VIDEO_DEDUPE]', {
              incomingId: String(entry?.id || '').trim(),
              existingId: String(item?.id || '').trim(),
              matchKey: incomingKey
            });
          }
          return !match;
        });
        const next = [{ ...entry, uploadState: 'ready' }, ...filtered];
        if (next.length > CONFIG.MAX_VAULT_ITEMS) next.pop();
        console.info('[BG7G_STORE]', {
          ts: new Date().toISOString(),
          component: 'personalVideos.update',
          file: 'VaultExperience.svelte',
          fileName: entry.fileName || entry.name || file.name,
          fileSize: file.size,
          uploadUrl: entry.url || null,
          state: 'success',
          beforeCount: before.length,
          afterCount: next.length,
          entryId: entry.id || null
        });
        reelResStoreMutation('personalVideos', before, next, {
          trigger: 'processVaultVideoFile',
          entryId: entry.id,
          entryUrl: entry.url
        });
        return next;
      });
      if (previewUrl && previewUrl.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(previewUrl);
        } catch {
          /* ignore */
        }
        try {
          resourceManager.revokeBlobUrl?.(previewUrl);
        } catch {
          /* ignore */
        }
      }
      console.info('[STORE_UPDATE]', {
        store: 'personalVideos',
        count: get(personalVideos).length,
        latest: entry?.id || entry?.name || '',
        ts: new Date().toISOString()
      });
      console.info('[STORE_WRITE]', {
        store: CONFIG.VIDEO_VAULT_KEY,
        count: get(personalVideos).length,
        ts: new Date().toISOString()
      });
      persistPersonalVault(get(personalVideos));
      AI_CLEANUP_AGENT.distributeVideoToFeed(entry);
      pipelineDiag('VIEWER', 'handleVaultVideoDrop', 'VaultExperience.svelte', {
        assetId: entry.id,
        fileName: file.name,
        result: 'distributed_to_feed'
      });
      feed.update((current) => ({ ...current }));
      console.info('[BG7G_RENDER]', {
        ts: new Date().toISOString(),
        component: 'handleVaultVideoDrop',
        file: 'VaultExperience.svelte',
        fileName: entry.fileName || entry.name || file.name,
        fileSize: file.size,
        uploadUrl: entry.url || null,
        state: 'vault_grid_refresh',
        vaultCount: get(personalVideos).length,
        hasPlayableUrl: Boolean(entry.url)
      });
      console.info('[UPLOAD_SUCCESS]', {
        vault: 'video',
        id: entry.id,
        url: entry.url,
        thumbnail: entry.thumbnail || '',
        ts: new Date().toISOString()
      });
      uploadStatus.set(`✅ Added to vault & feed: ${file.name}`);
      clearUploadCheckpoint(uploadKey);
      vaultForensic('VAULT_UPLOAD_SUCCESS', {
        vaultType: 'video',
        assetId: entry.id || null,
        fileName: entry.fileName || file.name,
        storageLocation: entry.url || null,
        backendEndpoint: `${API_BASE_URL}/api/reels`,
        result: 'canonical_created'
      });
      pipelineCheckpoint('VIDEO_READY', {
        vault: 'mp4',
        videoSrc: entry.url,
        reelId: entry.id
      });
      pipelineDiag('UPLOAD', 'handleVaultVideoDrop', 'VaultExperience.svelte', {
        assetId: entry.id,
        fileName: file.name,
        result: 'success'
      });
    } catch (error) {
      const failedError = uploadTimedOut
        ? new Error(`Vault upload timed out after ${uploadTimeoutMs}ms`)
        : error;
      logUploadError(uploadDiagCtx, failedError);
      noteFailedUpload();
      console.info('[MP4_UPLOAD_ERROR]', {
        stage: uploadTimedOut ? 'upload_timeout' : 'uploadMedia',
        error: failedError?.message || String(failedError)
      });
      console.info('[BG7G_UPLOAD]', {
        ts: new Date().toISOString(),
        component: 'handleVaultVideoDrop',
        file: 'VaultExperience.svelte',
        fileName: file?.name || null,
        fileSize: file?.size ?? null,
        uploadUrl: `${API_BASE_URL}/api/reels`,
        state: 'failure',
        reason: failedError?.message || String(failedError)
      });
      console.error('Failed to process video:', failedError);
      pipelineDiag('UPLOAD', 'handleVaultVideoDrop', 'VaultExperience.svelte', {
        fileName: file?.name || null,
        result: 'error',
        detail: failedError?.message || String(failedError)
      });
      console.error('[UPLOAD_FAILED]', {
        vault: 'video',
        name: file?.name || '',
        error: failedError?.message || String(failedError),
        ts: new Date().toISOString()
      });
      uploadStatus.set(`❌ Failed: ${failedError.message}`);
      if (isInvalidSessionError(failedError)) {
        uploadStatus.set('🔐 Studio session expired — sign in via Studio, then tap Retry upload');
        refreshAdminSessionReady();
        markOptimisticVaultUploadFailed(optimisticId, 'invalid_session — sign in via Studio, then Retry');
      } else {
        markOptimisticVaultUploadFailed(optimisticId, failedError?.message || 'upload_failed');
      }
      vaultForensic('VAULT_UPLOAD_FAIL', {
        vaultType: 'video',
        fileName: file?.name || null,
        storageLocation: CONFIG?.VIDEO_VAULT_KEY || 'personal_video_vault',
        backendEndpoint: `${API_BASE_URL}/api/reels`,
        result: failedError?.message || String(failedError)
      });
    } finally {
      if (uploadAbortTimer != null) {
        clearTimeout(uploadAbortTimer);
      }
      logUploadStage(uploadDiagCtx, 'FINALLY_ENTERED', {
        pendingLockCountBeforeDelete: getActiveUploadLockCount()
      });
      trackUploadLockRemove(uploadKey, {
        existingId: uploadDiagCtx?.reelId || '',
        reason: 'finally'
      });
      logUploadStage(uploadDiagCtx, 'LOCK_RELEASED', {
        pendingLockCountAfterDelete: getActiveUploadLockCount()
      });
      setPendingUploads(getActiveUploadLockCount());
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
    }
  }

  export function handleVaultVideoDragStart(event, video) {
    const target = /** @type {HTMLElement | null} */ (event?.target);
    if (
      target?.closest?.(
        '.thumb-delete-btn, .batch-select-label, .batch-select-checkbox, .vault-card-actions, .vault-soft-remove-bar'
      )
    ) {
      event.preventDefault();
      return;
    }
    if (!video || !event.dataTransfer) return;
    if (isGhostVideoVaultEntry(video)) {
      event.preventDefault();
      return;
    }
    const src = video.url || video.src || video.thumbnail || '';
    const payload = {
      id: video.id,
      type: 'video',
      src,
      title: video.name || video.title || 'Untitled',
      duration: video.duration || 0,
      vault: 'video-vault'
    };
    event.dataTransfer.setData('application/json', JSON.stringify(payload));
    const vaultPayload = buildVaultPayload(VAULT_SOURCES.MP4, { ...video, src, url: src });
    const dragImageEl = event.currentTarget.querySelector('img');
    setVaultDragData(event.dataTransfer, vaultPayload, dragImageEl);
    logDrag('vault-video:dragstart', payload);
  }

  export function handleThumbnailVaultDragStart(event, item, index) {
    if (!event.dataTransfer) return;
    const stored = JSON.parse(
      (typeof window !== 'undefined' ? localStorage.getItem(CONFIG.THUMBNAIL_STORAGE_KEY) : null) ||
        '[]'
    ).find((entry) => entry && entry.name === item);
    const src = resolveThumbnailPath(stored?.url || item, index);
    const payload = {
      id: item,
      type: 'thumbnail',
      src,
      title: item,
      vault: 'thumbnail-vault'
    };
    event.dataTransfer.setData('application/json', JSON.stringify(payload));
    const vaultPayload = buildVaultPayload(VAULT_SOURCES.THUMBNAIL, {
      id: item,
      name: item,
      url: src,
      src,
      thumbnail: src,
      type: stored?.type || 'image/jpeg',
      size: stored?.size || 0,
      addedAt: stored?.addedAt
    });
    const dragImageEl = event.currentTarget.querySelector('img');
    setVaultDragData(event.dataTransfer, vaultPayload, dragImageEl);
    logDrag('vault-thumbnail:dragstart', payload);
  }

  export async function acceptPendingThumbnail() {
    const pending = get(pendingThumbnail);
    if (!pending) return;
    if (!getAdminToken()) {
      uploadStatus.set('Studio login required.');
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 3000);
      return;
    }
    const { file, preview, name } = pending;
    pipelineDiag('UPLOAD', 'acceptPendingThumbnail', 'VaultExperience.svelte', {
      fileName: name,
      result: 'accept_start'
    });
    uploadStatus.set('📤 Uploading thumbnail...');
    vaultForensic('VAULT_ACCEPT', {
      vaultType: 'thumbnail',
      fileName: name,
      storageLocation: CONFIG?.THUMBNAIL_STORAGE_KEY || 'personal_thumbnails',
      backendEndpoint: `${API_BASE_URL}/api/reels`,
      result: 'accept_start'
    });
    vaultForensic('VAULT_UPLOAD_START', {
      vaultType: 'thumbnail',
      fileName: name,
      storageLocation: 'backend',
      backendEndpoint: `${API_BASE_URL}/api/reels`,
      result: 'upload_start'
    });
    try {
      const response = await uploadThumbnail(file, getAdminAuthHeaders(), {
        title: name,
        category: vaultUploadCategory || 'Trending'
      });
      logVaultFieldAudit('POST /api/reels response', response);

      // Metadata normalizer (optional enrichment). Never gate acceptance solely on it.
      const normalized =
        acceptVaultImageUploadResponse(response, { fallbackName: name }) || null;

      // Path gate: relative /thumbs/* OR absolute https://…/thumbs/* — reject empty/blob only.
      // Do NOT require startsWith('/thumbs/') after toRelativeMediaPath (breaks Netlify absolute URLs).
      const thumbPath = resolveThumbnailUploadMediaUrl({
        normalized,
        response: response && typeof response === 'object' ? response : {}
      });
      const id = String(normalized?.id || response?.id || '').trim();
      const status = String(response?.status || normalized?.status || 'ready')
        .trim()
        .toLowerCase();
      const statusOk =
        !status ||
        status === 'ready' ||
        status === 'complete' ||
        status === 'completed';

      if (
        !id ||
        !statusOk ||
        !thumbPath ||
        !isAcceptableThumbnailUploadMedia(response, normalized)
      ) {
        throw new Error(`Invalid upload response: ${JSON.stringify(response)}`);
      }

      const entryName =
        String(thumbPath).split('/').pop()?.split('?')[0] ||
        normalized?.displayTitle ||
        name;
      const entry = {
        id,
        fileName: entryName,
        name: name || normalized?.title || response?.name || entryName,
        title: name || normalized?.title || response?.title || entryName,
        displayTitle: normalized?.displayTitle || name || entryName,
        type: response.type || response.media_type || 'image',
        url: thumbPath,
        thumbnailUrl: thumbPath,
        status: statusOk ? 'ready' : status,
        keywords: normalized?.keywords || [],
        size: response.size ?? file.size,
        addedAt: new Date().toISOString()
      };
      if (isHeroAsset(entry)) {
        uploadStatus.set('⚠️ Hero media blocked from thumbnail vault');
        return;
      }
      console.info('[HERO_VAULT_INSERT]', {
        source: 'VaultExperience.acceptPendingThumbnail',
        id: entry.id || entryName,
        mime: entry.type || '',
        storage: thumbPath,
        destination: 'thumbnail-vault',
        ts: new Date().toISOString()
      });

      appendThumbnailVaultEntry(entry, CONFIG.THUMBNAIL_STORAGE_KEY);
      syncCollectionStore(personalThumbnailCollection, CONFIG.THUMBNAIL_STORAGE_KEY);
      AI_CLEANUP_AGENT.distributeThumbnailAcrossCategories(entryName, thumbPath, id);
      console.info('[PLACEHOLDER_INSERT]', {
        source: 'VaultExperience.acceptPendingThumbnail',
        trigger: 'AI_CLEANUP_AGENT.distributeThumbnailAcrossCategories',
        thumbnailName: entryName,
        ts: new Date().toISOString()
      });
      console.info('[STORE_UPDATE]', {
        store: 'personalThumbnailCollection',
        count: get(personalThumbnailCollection).length,
        latest: entryName,
        ts: new Date().toISOString()
      });
      console.info('[UPLOAD_SUCCESS]', {
        vault: 'thumbnail',
        id: entry.id || '',
        path: thumbPath,
        ts: new Date().toISOString()
      });
      uploadStatus.set(`✅ ${name} uploaded`);
      vaultForensic('VAULT_UPLOAD_SUCCESS', {
        vaultType: 'thumbnail',
        assetId: entry.id || null,
        fileName: entryName,
        storageLocation: thumbPath,
        backendEndpoint: `${API_BASE_URL}/api/reels`,
        result: 'canonical_created'
      });
      pipelineDiag('UPLOAD', 'acceptPendingThumbnail', 'VaultExperience.svelte', {
        assetId: entry.id || entryName,
        fileName: name,
        result: 'success'
      });
      logHeroImagePipeline('vault-upload', {
        assetId: entry.id || entryName,
        assetType: entry.type || 'image/jpeg',
        mediaUrl: thumbPath,
        resolved: true
      });
      await syncDomain([SYNC_DOMAIN.THUMBNAIL, SYNC_DOMAIN.FEED], { preserveLocal: true, force: true });
      pipelineDiag('VIEWER', 'acceptPendingThumbnail', 'VaultExperience.svelte', {
        assetId: entry.id || entryName,
        fileName: name,
        result: 'sync_complete'
      });
      if (preview?.startsWith('blob:')) resourceManager.revokeBlobUrl(preview);
      pendingThumbnail.set(null);
    } catch (error) {
      console.error('Upload failed:', error);
      if (isInvalidSessionError(error)) {
        uploadStatus.set('Studio session expired. Please sign in again.');
      } else {
        uploadStatus.set(`❌ Upload failed: ${error.message || 'check backend'}`);
      }
      pipelineDiag('UPLOAD', 'acceptPendingThumbnail', 'VaultExperience.svelte', {
        fileName: name,
        result: 'error',
        detail: error?.message || String(error)
      });
      console.error('[UPLOAD_FAILED]', {
        vault: 'thumbnail',
        name,
        error: error?.message || String(error),
        ts: new Date().toISOString()
      });
      vaultForensic('VAULT_UPLOAD_FAIL', {
        vaultType: 'thumbnail',
        fileName: name,
        storageLocation: CONFIG?.THUMBNAIL_STORAGE_KEY || 'personal_thumbnails',
        backendEndpoint: `${API_BASE_URL}/api/reels`,
        result: error?.message || String(error)
      });
    }
    resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
  }

  export function rejectPendingThumbnail() {
    const pending = get(pendingThumbnail);
    if (pending?.preview?.startsWith('blob:')) resourceManager.revokeBlobUrl(pending.preview);
    pendingThumbnail.set(null);
    uploadStatus.set('🗑️ Rejected');
    resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
  }

  export function handleThumbnailRemove(index) {
    AI_CLEANUP_AGENT.handleThumbnailRemove(index);
  }

  export async function batchDeleteThumbnails() {
    console.info('[DELETE_HANDLER]', {
      handler: 'batchDeleteThumbnails',
      entered: true,
      ts: Date.now()
    });
    console.info('[DELETE_CLICK]', {
      button: 'BATCH_DELETE_ALL',
      storeSize: get(personalThumbnailCollection).length
    });
    console.info('[DELETE_HANDLER_FIRED]', {
      mechanism: 'batch',
      vault: 'thumbnail-vault',
      itemCount: get(personalThumbnailCollection).length,
      timestamp: Date.now()
    });
    if (!confirm(`⚠️ Permanently delete ALL ${get(personalThumbnailCollection).length} thumbnails?`)) {
      return;
    }
    console.info('[DELETE_CONFIRMED]', {
      mechanism: 'batch',
      vault: 'thumbnail-vault',
      timestamp: Date.now()
    });
    uploadStatus.set('🗑️ Deleting thumbnails from backend...');
    try {
      const beforeCount = get(personalThumbnailCollection).length;
      const reels = await fetchReadyReels();
      const idsToDelete = reels
        .filter((reel) => {
        const type = String(reel?.type || '').toLowerCase();
        return type === 'image' || String(reel?.url || '').includes('/thumbs/');
        })
        .map((reel) => reel.id)
        .filter(Boolean);
      let removed = 0;
      const deletedIds = [];
      for (const reelId of idsToDelete) {
        // Backend reel delete is authoritative (DB + disk + WS DELETED).
        if (await deleteReelById(reelId)) {
          removed += 1;
          deletedIds.push(String(reelId || '').trim());
        }
      }
      const reelsPostDelete = await fetchReadyReels();
      const imageReels = (reelsPostDelete || []).filter(isThumbnailImageReel);
      if (deletedIds.length > 0 || removed > 0) {
        applyThumbnailDeleteTombstone(deletedIds, [], imageReels);
      }
      await syncDomain([SYNC_DOMAIN.THUMBNAIL, SYNC_DOMAIN.FEED], { preserveLocal: true, force: true });
      const reelsAfter = await fetchReadyReels();
      const imageReelsAfter = (reelsAfter || []).filter(isThumbnailImageReel);
      applyThumbnailDeleteTombstone(deletedIds, [], imageReelsAfter);
      await purgeStaleOrphanThumbnails(deletedIds, imageReelsAfter);
      const afterCount = get(personalThumbnailCollection).length;
      const renderedAfter = typeof document !== 'undefined'
        ? document.querySelectorAll('.vault-grid--images .vault-card').length
        : -1;
      console.info('[DELETE_RENDER]', {
        mechanism: 'batch',
        beforeCount,
        afterCount,
        renderedAfter,
        deletedIdsCount: deletedIds.length,
        idsToDeleteCount: idsToDelete.length,
        removed,
        ts: Date.now()
      });
      console.info('[DELETE_STORE_UPDATE]', {
        vault: 'thumbnail-vault',
        mechanism: 'batch',
        beforeCount,
        afterCount,
        timestamp: Date.now()
      });
      console.info('[DELETE_PERSISTENCE]', {
        vault: 'thumbnail-vault',
        mechanism: 'batch',
        success: removed > 0 || idsToDelete.length === 0,
        removed,
        attempted: idsToDelete.length,
        timestamp: Date.now()
      });
      console.info('[DELETE_UI_REFRESH]', {
        vault: 'thumbnail-vault',
        newCount: afterCount,
        timestamp: Date.now()
      });
      console.info('[DELETE_COMPLETE]', {
        mechanism: 'batch',
        vault: 'thumbnail-vault',
        removed,
        timestamp: Date.now()
      });
      uploadStatus.set(`🗑️ Deleted ${removed}/${idsToDelete.length} thumbnail reels`);
    } catch (error) {
      console.error('Batch thumbnail delete failed:', error);
      uploadStatus.set(`❌ Batch delete failed: ${error?.message || 'unknown error'}`);
    } finally {
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 3000);
    }
  }

  export async function batchDeleteVideos() {
    const videos = get(personalVideos);
    console.info('[DELETE_HANDLER_FIRED]', {
      mechanism: 'batch',
      vault: 'video-vault',
      itemCount: videos.length,
      timestamp: Date.now()
    });
    if (!videos.length) {
      uploadStatus.set('⚠️ No videos to delete');
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
      return;
    }
    if (!confirm(`⚠️ Permanently delete ALL ${videos.length} videos from MP4 vault?`)) {
      return;
    }
    if (!requireAdminSessionForDelete()) return;
    console.info('[DELETE_CONFIRMED]', {
      mechanism: 'batch',
      vault: 'video-vault',
      timestamp: Date.now()
    });
    uploadStatus.set('🗑️ Deleting videos from backend...');
    try {
      const beforeCount = videos.length;
      const selectedIdsBeforeDelete = [...selectedVideoIds];
      const idsToDelete = videos.map((video) => video?.id).filter(Boolean);
      let removed = 0;
      const deletedIds = [];
      for (const reelId of idsToDelete) {
        if (await deleteReelById(reelId)) {
          removed += 1;
          deletedIds.push(String(reelId || '').trim());
        }
      }
      if (deletedIds.length > 0) {
        applyVideoDeleteTombstone(deletedIds);
        await applyVideoDeleteThumbnailCleanup(deletedIds);
        await syncDomain([SYNC_DOMAIN.VIDEO, SYNC_DOMAIN.FEED], { preserveLocal: true, force: true });
        canonicalizeVideoSelectionAfterDelete(deletedIds, {
          beforeCount,
          selectedIds: selectedIdsBeforeDelete
        });
      }
      const afterCount = get(personalVideos).length;
      console.info('[DELETE_STORE_UPDATE]', {
        vault: 'video-vault',
        mechanism: 'batch',
        beforeCount,
        afterCount,
        timestamp: Date.now()
      });
      console.info('[DELETE_PERSISTENCE]', {
        vault: 'video-vault',
        mechanism: 'batch',
        success: removed > 0 || idsToDelete.length === 0,
        removed,
        attempted: idsToDelete.length,
        timestamp: Date.now()
      });
      console.info('[DELETE_UI_REFRESH]', {
        vault: 'video-vault',
        newCount: afterCount,
        timestamp: Date.now()
      });
      console.info('[DELETE_COMPLETE]', {
        mechanism: 'batch',
        vault: 'video-vault',
        removed,
        timestamp: Date.now()
      });
      uploadStatus.set(`🗑️ Deleted ${removed}/${idsToDelete.length} video reels`);
    } catch (error) {
      console.error('Batch video delete failed:', error);
      uploadStatus.set(`❌ Batch delete failed: ${error?.message || 'unknown error'}`);
    } finally {
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 3000);
    }
  }
</script>

{#if showPersonalControls}
  <div class="personal-controls">
    <div class="toggle-group">
      <button
        class="toggle-btn {$personalStudioMode ? 'active' : ''}"
        on:click={UIAgent.togglePersonalStudioMode}
      >
        {$personalStudioMode ? '🎬 PERSONAL MODE ON' : '🎬 PERSONAL MODE OFF'}
      </button>
      <button
        class="toggle-btn {$usePersonalThumbnails ? 'active' : ''}"
        on:click={UIAgent.togglePersonalThumbnails}
      >
        {$usePersonalThumbnails ? '🖼️ USING YOUR THUMBNAILS' : '🖼️ USE YOUR THUMBNAILS'}
      </button>
    </div>
    <div class="personal-stats">
      <div class="stat-card">
        <span class="stat-label">Your Images</span>
        <span class="stat-value">{$personalThumbnailCollection.length}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Your Videos</span>
        <span class="stat-value">{$personalVideos.length}</span>
      </div>
    </div>
    <div class="quick-upload-actions">
      <button
        class="quick-upload-btn"
        on:click={UIAgent.quickUploadPersonal}
        disabled={!$newTitle || $personalVideoCollection.length === 0}
      >
        🚀 QUICK UPLOAD WITH PERSONAL VIDEO
      </button>
      <button
        class="batch-upload-btn"
        on:click={UIAgent.batchUploadPersonal}
        disabled={$personalVideoCollection.length === 0}
      >
        📦 BATCH UPLOAD ALL VIDEOS
      </button>
    </div>
  </div>
{/if}

<div class="personal-media-grid">
  <div class="vault-category-row">
    <label class="input-label-wrapper">
      SHELF CATEGORY (uploads)
      <div class="category-selector">
        <select bind:value={vaultUploadCategory} aria-label="Vault upload shelf category">
          {#each vaultShelfCategories as cat}
            <option value={cat}>📁 {cat}</option>
          {/each}
        </select>
      </div>
    </label>
  </div>
  <h4>Your Thumbnails ({$personalThumbnailCollection.length})</h4>
  <div class="vault-batch-toolbar">
    <p class="thumbnail-hint">Click thumbnail to remove • Drag & drop to add</p>
    <div class="vault-batch-actions">
      <button
        type="button"
        class="batch-delete-btn"
        data-vault="thumbnail"
        on:click={() => {
          console.info('[DELETE_CLICK]', { button: 'DELETE_SELECTED_THUMBS_DOM', disabled: selectedThumbnailIds.length === 0 });
          batchDeleteSelectedThumbnails();
        }}
        disabled={selectedThumbnailIds.length === 0}
      >
        🗑️ DELETE SELECTED ({selectedThumbnailIds.length})
      </button>
      <button
        type="button"
        class="batch-delete-btn batch-delete-btn--all"
        on:click={() => {
          console.info('[DELETE_CLICK]', { button: 'BATCH_DELETE_ALL_DOM' });
          batchDeleteThumbnails();
        }}
      >🗑️ BATCH DELETE ALL</button>
    </div>
  </div>
  <div
    class="thumbnail-drop-zone"
    class:drag-active={$thumbnailDragActive}
    on:dragenter={handleVaultThumbnailDragEnter}
    on:dragover={handleVaultThumbnailDragOver}
    on:dragleave={handleVaultThumbnailDragLeave}
    on:drop={handleVaultThumbnailDrop}
    role="group"
    aria-label="Thumbnail drop zone"
  >
    {#if $pendingThumbnail}
      <div class="pending-preview">
        <MediaThumbnail
          url={$pendingThumbnail.preview}
          raw
          alt="Pending"
          className="pending-thumbnail"
        />
        <div class="pending-actions">
          <button
            class="accept-btn"
            disabled={!adminSessionReady}
            on:click={acceptPendingThumbnail}
          >
            ✅ ACCEPT
          </button>
          <button class="reject-btn" on:click={rejectPendingThumbnail}>❌ REJECT</button>
        </div>
        {#if !adminSessionReady}
          <p class="pending-login-hint">Studio login required.</p>
        {/if}
        <p class="pending-info">
          {$pendingThumbnail?.name} • {($pendingThumbnail?.size / 1024).toFixed(0)} KB
        </p>
      </div>
    {:else}
      <div class="drop-placeholder">
        <span class="drop-icon">🖼️</span>
        <span>Drop image here to add</span>
        <small>Supports: JPG, PNG, WEBP</small>
      </div>
    {/if}
  </div>
  <div class="thumbnail-grid vault-grid vault-grid--images">
    {#each ($personalThumbnailCollection ?? []).filter(Boolean) as img, i (img?.id || img?.url || img?.fileName || `${img}-${i}`)}
      {@const reel = getVaultImageReel(img, i)}
      {@const selectId = thumbnailSelectionId(img, i)}
      <div
        class="vault-card thumbnail-item"
        class:image={isImage(reel)}
        use:vaultCardDiagnostics={`thumb-${i}`}
        draggable="true"
        on:dragstart={(event) => handleThumbnailVaultDragStart(event, img, i)}
        role="listitem"
      >
        {#if isImage(reel) && reel.url && !reel.orphaned && !reel.missing}
          <MediaThumbnail
            url={reel.url}
            raw={String(reel.url || '').startsWith('blob:') || String(reel.url || '').startsWith('data:')}
            alt={reel.name}
            loading="lazy"
            className="vault-grid-visual {i === ($personalThumbnailIndex % $personalThumbnailCollection.length) ? 'active' : ''}"
            on:load={(event) =>
              (() => {
                const currentTarget = event?.currentTarget;
                console.info('[IMAGE_RENDER]', { index: i, url: reel.url, ts: new Date().toISOString() });
                logVaultCardLayoutDiagnostics(currentTarget?.closest?.('.vault-card'), `thumb-${i}:load`);
              })()}
            on:error={(event) => {
              console.error('[Vault] Image failed:', reel.url);
              handleVaultThumbnailError(event, img);
            }}
          />
        {:else}
          <div class="placeholder" aria-hidden="true">🖼️</div>
        {/if}
        <div class="vault-grid-chrome">
          <span class="thumbnail-label">IMG {i + 1}</span>
          {#if i === ($personalThumbnailIndex % $personalThumbnailCollection.length)}
            <span class="next-badge">NEXT</span>
          {/if}
          <button
            type="button"
            class="thumb-delete-btn"
            on:click|stopPropagation={() => handleThumbnailRemove(i)}
            aria-label="Remove thumbnail {i + 1}"
          >
            ✕
          </button>
          <label class="batch-select-label" class:orphan-entry={!selectId}>
            <input
              type="checkbox"
              class="batch-select-checkbox"
              disabled={!selectId}
              checked={selectId && selectedThumbnailIds.includes(selectId)}
              on:change|stopPropagation={() => toggleThumbnailSelection(selectId)}
            />
            {!selectId ? 'Orphan' : 'Select'}
          </label>
        </div>
      </div>
    {/each}
  </div>
</div>

<div class="personal-media-grid"
  on:dragenter={handleVaultVideoDragEnter}
  on:dragover={handleVaultVideoDragOver}
  on:dragleave={handleVaultVideoDragLeave}
  on:drop={handleVaultVideoDrop}
>
  <h4>Video Vault ({vaultDisplayVideos.length})</h4>
  <div class="vault-batch-toolbar">
    <p class="thumbnail-hint">UPLOAD: drop MP4/MOV → ACCEPT → upload into catalog/feed</p>
    <div class="vault-batch-actions">
      <button
        type="button"
        class="batch-delete-btn"
        data-vault="video"
        on:click={batchDeleteSelectedVideos}
        disabled={selectedVideoIds.length === 0}
      >
        🗑️ DELETE SELECTED ({selectedVideoIds.length})
      </button>
      <button
        type="button"
        class="batch-delete-btn batch-delete-btn--all"
        data-vault="video"
        on:click={batchDeleteVideos}
      >
        🗑️ BATCH DELETE ALL
      </button>
    </div>
  </div>
  {#if lastSoftRemoved?.assetId}
    <div
      class="vault-soft-remove-bar"
      data-vault-soft-remove-undo
      role="status"
      aria-live="polite"
    >
      <span class="vault-soft-remove-bar__msg">
        Removed from Video Vault
        {#if lastSoftRemoved.name}
          <strong>{String(lastSoftRemoved.name).slice(0, 42)}</strong>
        {/if}
        — reversible (media kept)
      </span>
      <button
        type="button"
        class="vault-soft-remove-bar__undo"
        data-vault-soft-restore
        on:click|stopPropagation={undoLastVideoVaultSoftRemove}
      >
        Undo
      </button>
    </div>
  {/if}
  {#if vaultNearMissHint}
    <div class="vault-near-miss-hint" role="status" aria-live="polite" data-vault-near-miss>
      {vaultNearMissHint}
    </div>
  {/if}
  <div
    class="drop-zone video-vault-drop video-vault-drop--upload"
    class:active={$videoDragActive}
    class:has-pending={Boolean($pendingVaultVideo)}
    on:dragenter={handleVaultVideoDragEnter}
    on:dragover={handleVaultVideoDragOver}
    on:dragleave={handleVaultVideoDragLeave}
    on:drop={handleVaultVideoDrop}
    on:click={() => {
      if (!$pendingVaultVideo && !vaultAcceptInFlight) openVaultVideoFilePicker();
    }}
    on:keydown={(event) => {
      if ($pendingVaultVideo || vaultAcceptInFlight) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openVaultVideoFilePicker();
      }
    }}
    role="button"
    tabindex="0"
    aria-label="Upload video drop zone — drop or click to choose MP4/MOV, then ACCEPT to upload"
    data-vault-drop="upload"
  >
    <input
      bind:this={videoFileInputEl}
      type="file"
      accept="video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.webm,.m4v"
      class="vault-file-input"
      aria-hidden="true"
      tabindex="-1"
      on:change={handleVaultVideoFileInput}
      on:click|stopPropagation
    />
    {#if $pendingVaultVideo}
      <div class="pending-preview pending-video-preview" on:click|stopPropagation role="group">
        {#if $pendingVaultVideo.skipBlobPreview || !$pendingVaultVideo.preview}
          <div class="pending-large-static" aria-hidden="true">
            <span class="pending-large-icon">🎬</span>
            <strong>{$pendingVaultVideo.name}</strong>
            <small>
              {(($pendingVaultVideo.size || 0) / (1024 * 1024)).toFixed(1)} MB — preview skipped for large
              files (intentional). Ready to upload — click ACCEPT.
            </small>
          </div>
        {:else}
          <video
            class="pending-video"
            src={$pendingVaultVideo.preview}
            muted
            playsinline
            controls
            preload="metadata"
          ></video>
        {/if}
        <p class="pending-ready-banner" data-vault-pending-ready>
          Ready to upload — click ACCEPT
        </p>
        <div class="pending-actions">
          <button
            type="button"
            class="accept-btn"
            class:is-disabled={!adminSessionReady || vaultAcceptInFlight}
            disabled={!adminSessionReady || vaultAcceptInFlight}
            on:click|stopPropagation={acceptPendingVideo}
          >
            {vaultAcceptInFlight ? '⬆️ UPLOADING…' : '✅ ACCEPT'}
          </button>
          <button
            type="button"
            class="reject-btn"
            disabled={vaultAcceptInFlight}
            on:click|stopPropagation={rejectPendingVideo}
          >
            ❌ REJECT
          </button>
        </div>
        {#if !adminSessionReady}
          <p class="pending-login-hint">Studio login required to upload.</p>
        {/if}
        <p class="pending-info">
          {$pendingVaultVideo.name} • {(($pendingVaultVideo.size || 0) / (1024 * 1024)).toFixed(1)} MB
        </p>
        <p class="pending-flow-hint">Flow: DROP → PENDING → ACCEPT → UPLOADING → READY</p>
      </div>
    {:else}
      <div class="drop-placeholder">
        <span class="drop-icon">🎬</span>
        <span>UPLOAD VIDEO (MP4/MOV)</span>
        <small>DROP → ACCEPT → UPLOAD · Max {CONFIG.MAX_VIDEO_SIZE / 1024 / 1024}MB</small>
        <small>Large files skip preview on purpose — ACCEPT still required</small>
        <span class="vault-file-picker-hint">or click to choose a file</span>
      </div>
    {/if}
  </div>
  <div
    class="drop-zone video-vault-drop video-vault-drop--delete"
    class:active={vaultDeleteDragActive}
    on:dragenter={handleVaultDeleteDragEnter}
    on:dragover={handleVaultDeleteDragOver}
    on:dragleave={handleVaultDeleteDragLeave}
    on:drop={handleVaultDeleteDrop}
    role="group"
    aria-label="Delete drop zone"
    data-vault-drop="delete"
  >
    <div class="drop-placeholder">
      <span class="drop-icon">🗑️</span>
      <span>DELETE ZONE — vault cards only</span>
      <small>Not for file upload — drag existing vault cards here to remove</small>
    </div>
  </div>
  {#if vaultDisplayVideos.length > 0}
    <div class="thumbnail-grid vault-grid vault-grid--videos video-vault-grid">
      {#each vaultDisplayVideos.filter(Boolean) as video, vi (resolveMediaAssetId(video) || `video-fallback-${vi}`)}
        {#if video}
          {@const cardMediaAssetId = resolveMediaAssetId(video)}
          {@const reel = getVaultVideoReel(video)}
          {@const microDrama = isMicroDramaContent(video) || isMicroDramaContent(reel)}
          {@const isUploadingCard =
            video.uploadState === 'uploading' || String(video?.id || '').startsWith('local-upload-')}
          {@const isFailedCard =
            video.uploadState === 'failed' || video.uploadState === 'interrupted'}
          {@const isPendingCard =
            video.uploadState === 'pending_accept' || String(video?.id || '').startsWith('local-pending-')}
          {@const uploadPct =
            vaultUploadPercents[String(video?.fileName || video?.name || '').trim()] ??
            vaultUploadPercents[String(video?.name || '').trim()] ??
            null}
          {@const isGhostOnly =
            isGhostVideoVaultEntry(video) && !isDurableVideoVaultWorkspaceAsset(video)}
          {@const isStubPurgeCard = isVideoVaultStubPurgeTarget(video, {
            isGhost: isGhostOnly,
            // Hero inject alone must not mark durable vault assets as stubs.
            isHeroInjected:
              isHeroInjectedVaultCard(video) && !isDurableVideoVaultWorkspaceAsset(video)
          })}
          {@const isGhostCard =
            isStubPurgeCard || isFailedCard || isPendingCard}
          {@const vaultCard = resolveVaultCardProjection(cardMediaAssetId || video?.id || reel?.id, {
            reel: { ...reel, ...(video || {}) }
          })}
          {@const _vaultRenderGateBranch = logVaultRenderGate(video, reel, vi, { isVideo, isVideoReel })}
          <div
            class="vault-card thumbnail-item video-vault-item video"
            class:micro-drama={microDrama}
            class:ghost-outline={isGhostCard && !isFailedCard && !isPendingCard && !isUploadingCard}
            class:vault-card--uploading={isUploadingCard}
            class:vault-card--failed={isFailedCard}
            class:vault-card--pending={isPendingCard}
            use:vaultCardDiagnostics={`video-${vi}`}
            draggable={!isGhostCard && !isUploadingCard}
            on:dragstart={(event) => handleVaultVideoDragStart(event, video)}
            on:pointerenter={() => {
              if (isVideo(reel) && reel.url && !isGhostCard && !isUploadingCard && !isFailedCard && !isPendingCard) {
                activateVaultVideoPreview(String(video?.id || reel?.id || ''));
              }
            }}
            on:pointerleave={() =>
              deactivateVaultVideoPreview(String(video?.id || reel?.id || ''))}
            role="listitem"
            data-vault-preview-active={String(activeVaultVideoPreviewId) === String(video?.id || reel?.id || '')
              ? 'true'
              : 'false'}
          >
            {#if $reelshortActive && microDrama}
              <VaultEngagementBadge itemId={video.id || reel.name} />
            {/if}
            {#if isPendingCard}
              <div class="placeholder vault-uploading-preview vault-pending-face" aria-hidden="true">
                <span>🎬</span>
                <small>Pending Accept</small>
              </div>
            {:else if isUploadingCard}
              <div class="placeholder vault-uploading-preview vault-pending-face" aria-hidden="true">
                <span>⬆</span>
                <small>
                  {uploadPct != null
                    ? `Uploading ${uploadPct}%`
                    : `Uploading ${(Number(video.size || 0) / (1024 * 1024)).toFixed(0)} MB`}
                </small>
                <div class="vault-upload-track" aria-hidden="true">
                  <div
                    class="vault-upload-bar"
                    style="width: {uploadPct != null ? uploadPct : 8}%"
                  ></div>
                </div>
              </div>
            {:else if isFailedCard}
              <div class="placeholder vault-interrupted-preview vault-pending-face" aria-hidden="true">
                <span>⚠</span>
                <small>{video.uploadState === 'interrupted' ? 'Interrupted' : 'Upload failed'}</small>
              </div>
            {:else if isVideo(reel) && reel.url}
              {@const previewActive =
                String(activeVaultVideoPreviewId) === String(video?.id || reel?.id || '')}
              {@const vaultPreviewPlayUrl = resolvePlayableMediaUrl(reel, 'vault_preview') || reel.url}
              {#if previewActive}
                <MediaRenderer
                  type="video"
                  url={vaultPreviewPlayUrl}
                  poster={reel.thumbnailUrl || undefined}
                  raw={String(vaultPreviewPlayUrl || '').startsWith('blob:') || String(vaultPreviewPlayUrl || '').startsWith('data:')}
                  useSourceElement={true}
                  muted
                  playsinline
                  autoplay={true}
                  loop={true}
                  preload="metadata"
                  playbackRole="preview"
                  className="vault-grid-visual vault-grid-video"
                  width="100%"
                  height="100%"
                  on:loadeddata={(event) => {
                    console.info('[VIDEO_RENDER]', { index: vi, url: vaultPreviewPlayUrl, ts: new Date().toISOString() });
                    pipelineCheckpoint('VIDEO_ATTACHED', {
                      vault: 'mp4',
                      videoSrc: vaultPreviewPlayUrl,
                      reelId: video?.id || reel?.id || null
                    });
                    handleVaultVideoLoaded(event, reel);
                  }}
                  on:loadedmetadata={(event) =>
                    logVaultCardLayoutDiagnostics(
                      event?.currentTarget?.closest?.('.vault-card'),
                      `video-${vi}:load`
                    )}
                  on:error={(event) => handleVaultVideoElementError(event, video, reel)}
                />
              {:else if reel.thumbnailUrl}
                <MediaThumbnail
                  url={reel.thumbnailUrl}
                  alt={reel.name || reel.title || 'Video poster'}
                  lazyLoad={true}
                  className="vault-grid-visual vault-grid-poster"
                />
              {:else}
                <div
                  class="placeholder vault-poster-first"
                  data-vault-poster-first
                  aria-hidden="true"
                >
                  <span>▶</span>
                  <small>Hover to preview</small>
                </div>
              {/if}
            {:else}
              {@const _vaultPlaceholderGate = logVaultPlaceholderGate(video, reel, vi)}
              <div class="placeholder" aria-hidden="true">▶</div>
            {/if}
            <div class="vault-grid-chrome">
              {#if vaultCard.title}
                <span class="thumbnail-label" data-vault-card-title>{vaultCard.title}</span>
              {/if}
              {#if vaultCard.description}
                <span class="vault-card-description" data-vault-card-description
                  >{vaultCard.description.length > 80
                    ? `${vaultCard.description.slice(0, 80)}…`
                    : vaultCard.description}</span
                >
              {/if}
              <span class="video-size-badge">{formatVaultVideoSizeLabel(video)}</span>
              {#if video.uploadState === 'pending_accept'}
                <span class="upload-state-badge" title="Waiting for Accept">🎬 Pending Accept</span>
              {:else if video.uploadState === 'uploading'}
                <span class="upload-state-badge" title="Upload in progress">⬆ Uploading</span>
              {:else if video.uploadState === 'interrupted'}
                <span
                  class="upload-state-badge upload-state-badge--interrupted"
                  title="Upload interrupted by refresh — drop the file again to finish"
                >
                  ⚠ Interrupted — re-drop file
                </span>
              {:else if video.uploadState === 'failed'}
                <span class="upload-state-badge upload-state-badge--failed" title={video.uploadError || 'Upload failed'}>
                  ⚠ Failed{video.uploadError ? `: ${String(video.uploadError).slice(0, 40)}` : ''}
                </span>
              {/if}
              {#if video.urlExpired}
                <span
                  class="expired-badge"
                  title="Video URL expired after page reload. Please re-upload."
                >
                  ⚠️ Expired
                </span>
              {/if}
              <button
                type="button"
                class="thumb-delete-btn"
                data-vault-action={isStubPurgeCard || isFailedCard || isPendingCard
                  ? 'purge-stub'
                  : 'soft-remove'}
                on:pointerdown={stopVaultCardDragGesture}
                on:mousedown={stopVaultCardDragGesture}
                on:touchstart={stopVaultCardDragGesture}
                on:click|stopPropagation|preventDefault={() =>
                  isStubPurgeCard || isFailedCard || isPendingCard
                    ? purgeFailedVaultVideo(video)
                    : softRemoveFromVideoVault(video)}
                aria-label={
                  isStubPurgeCard || isFailedCard || isPendingCard
                    ? `Remove stub ${video.name || ''}`
                    : `Remove ${video.name || 'video'} from Video Vault`
                }
                title={
                  isStubPurgeCard || isFailedCard || isPendingCard
                    ? 'Remove leftover stub'
                    : 'Remove from Video Vault (reversible — does not delete the file or Hero)'
                }
              >
                ✕
              </button>
              {#if !isStubPurgeCard && !isFailedCard && !isPendingCard && !isUploadingCard}
                <div class="vault-card-actions" data-vault-card-actions>
                  <button
                    type="button"
                    class="vault-card-action vault-card-action--edit"
                    data-vault-edit
                    on:pointerdown={stopVaultCardDragGesture}
                    on:mousedown={stopVaultCardDragGesture}
                    on:touchstart={stopVaultCardDragGesture}
                    on:click|stopPropagation|preventDefault={() => requestVaultVideoEdit(video)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    class="vault-card-action vault-card-action--remove"
                    data-vault-soft-remove
                    on:pointerdown={stopVaultCardDragGesture}
                    on:mousedown={stopVaultCardDragGesture}
                    on:touchstart={stopVaultCardDragGesture}
                    on:click|stopPropagation|preventDefault={() => softRemoveFromVideoVault(video)}
                  >
                    Remove
                  </button>
                </div>
              {/if}
              {#if video.uploadState === 'failed' || video.uploadState === 'interrupted'}
                <button
                  type="button"
                  class="ghost-purge-btn ghost-retry-btn"
                  on:pointerdown={stopVaultCardDragGesture}
                  on:mousedown={stopVaultCardDragGesture}
                  on:touchstart={stopVaultCardDragGesture}
                  on:click|stopPropagation|preventDefault={() => retryFailedVaultVideo(video)}
                >
                  Retry upload
                </button>
                <button
                  type="button"
                  class="ghost-purge-btn"
                  style="top: calc(50% + 2.2rem);"
                  on:pointerdown={stopVaultCardDragGesture}
                  on:mousedown={stopVaultCardDragGesture}
                  on:touchstart={stopVaultCardDragGesture}
                  on:click|stopPropagation|preventDefault={() => purgeFailedVaultVideo(video)}
                >
                  Remove stub
                </button>
              {:else if isStubPurgeCard}
                <button
                  type="button"
                  class="ghost-purge-btn"
                  on:pointerdown={stopVaultCardDragGesture}
                  on:mousedown={stopVaultCardDragGesture}
                  on:touchstart={stopVaultCardDragGesture}
                  on:click|stopPropagation|preventDefault={() => purgeFailedVaultVideo(video)}
                >
                  Remove stub
                </button>
              {/if}
              <label class="batch-select-label">
                <input
                  type="checkbox"
                  class="batch-select-checkbox"
                  checked={selectedVideoIds.includes(String(video?.id || '').trim())}
                  on:pointerdown={stopVaultCardDragGesture}
                  on:change|stopPropagation={() => toggleVideoSelection(String(video?.id || '').trim())}
                />
                Select
              </label>
            </div>
            {#if !isUploadingCard && !isFailedCard && !isPendingCard && !isStubPurgeCard}
              <VaultEpisodeCreatorStatus
                asset={video}
                active={true}
                editSignal={vaultEditSignals[cardMediaAssetId] || 0}
                packageSaveFeedback={vaultPackageSaveFeedback[cardMediaAssetId] || null}
                on:confirmIdentity={(event) =>
                  confirmVaultVideoIdentity(event.detail || {}, cardMediaAssetId)}
                on:savePackage={(event) =>
                  saveVaultEpisodeEnrichment(event.detail || {}, cardMediaAssetId)}
              />
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>
<!-- 🎯 DEMO: Visible placeholder cards when no personal media exists (FOR SHARING) -->
{#if shouldShowVaultDemoCards}
  <div style="padding:3rem 2rem;text-align:center;background:#f8fafc;border-radius:12px;margin:2rem 0;border:1px dashed #cbd5e1;">
    <h3 style="margin:0 0 1.5rem 0;color:#1e293b;font-size:1.25rem;font-weight:600;">✨ Demo Placeholder Cards</h3>
    <p style="margin:0 0 2rem 0;color:#64748b;font-size:1rem;">No personal media yet. Here are demo cards to show your backend is connected:</p>
    
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.5rem;max-width:1200px;margin:0 auto;">
      <!-- Demo Card 1: Neon Vengeance -->
      <article style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08);background:white;">
        <img src="https://via.placeholder.com/480x270.png?text=Neon+Vengeance" alt="Neon Vengeance (Demo)" style="width:100%;height:180px;object-fit:cover;display:block;" onerror="this.src='https://via.placeholder.com/480x270?text=Image+Error'"/>
        <div style="padding:1rem;">
          <h4 style="margin:0 0 0.5rem 0;font-size:1.05rem;font-weight:600;color:#1e293b;">Neon Vengeance (Demo)</h4>
          <p style="margin:0 0 1rem 0;color:#64748b;font-size:0.9rem;">series-neon-vengeance</p>
          <div style="display:flex;align-items:center;gap:0.5rem;"><span style="padding:0.25rem 0.75rem;background:#22c55e;color:white;border-radius:9999px;font-size:0.8rem;font-weight:500;">Ready</span><span style="color:#64748b;font-size:0.85rem;">Readiness: 100%</span></div>
        </div>
      </article>
      <!-- Demo Card 2: Vault Chronicles -->
      <article style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08);background:white;">
        <img src="https://via.placeholder.com/480x270.png?text=Vault+Chronicles" alt="Vault Chronicles (Demo)" style="width:100%;height:180px;object-fit:cover;display:block;" onerror="this.src='https://via.placeholder.com/480x270?text=Image+Error'"/>
        <div style="padding:1rem;">
          <h4 style="margin:0 0 0.5rem 0;font-size:1.05rem;font-weight:600;color:#1e293b;">Vault Chronicles (Demo)</h4>
          <p style="margin:0 0 1rem 0;color:#64748b;font-size:0.9rem;">series-vault-chronicles</p>
          <div style="display:flex;align-items:center;gap:0.5rem;"><span style="padding:0.25rem 0.75rem;background:#22c55e;color:white;border-radius:9999px;font-size:0.8rem;font-weight:500;">Ready</span><span style="color:#64748b;font-size:0.85rem;">Readiness: 100%</span></div>
        </div>
      </article>
      <!-- Demo Card 3: Trending Shorts -->
      <article style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08);background:white;">
        <img src="https://via.placeholder.com/480x270.png?text=Trending+Shorts" alt="Trending Shorts (Demo)" style="width:100%;height:180px;object-fit:cover;display:block;" onerror="this.src='https://via.placeholder.com/480x270?text=Image+Error'"/>
        <div style="padding:1rem;">
          <h4 style="margin:0 0 0.5rem 0;font-size:1.05rem;font-weight:600;color:#1e293b;">Trending Shorts (Demo)</h4>
          <p style="margin:0 0 1rem 0;color:#64748b;font-size:0.9rem;">series-trending-shorts</p>
          <div style="display:flex;align-items:center;gap:0.5rem;"><span style="padding:0.25rem 0.75rem;background:#22c55e;color:white;border-radius:9999px;font-size:0.8rem;font-weight:500;">Ready</span><span style="color:#64748b;font-size:0.85rem;">Readiness: 100%</span></div>
        </div>
      </article>
    </div>
    <p style="margin:2rem 0 0 0;color:#94a3b8;font-size:0.85rem;font-style:italic;">Upload your first reel to replace these demo cards.</p>
  </div>
{/if}
