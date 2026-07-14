<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { createVaultUtils } from '../../lib/viewer/vaultUtils.js';
  import { isImage, isVideo } from '../../lib/vaultMedia.js';
  import MediaRenderer from '../media/MediaRenderer.svelte';
  import MediaThumbnail from '../media/MediaThumbnail.svelte';
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
  import { logHeroImagePipeline } from '../../lib/hero/heroIntelligence.js';
  import { reelToVaultEntry } from '../../lib/api/reelContract.js';
  import { validateVideoFile } from '../../lib/runtime-guards.js';
  import { API_BASE_URL, toRelativeMediaPath } from '../../lib/config.js';
  import { fetchWithRetry } from '../../lib/api.js';
  import { isHeroAsset } from '../../lib/hero/heroDomainGuard.js';
  import { isDemoDebugMode } from '../../lib/debugMode.js';
  import {
    filterStaleOrphanEntries,
    isThumbnailImageReel,
    thumbnailEntryFileKey
  } from '../../lib/viewer/thumbnailCanonicalization.js';
  import {
    reconcileThumbnailVault,
    deleteThumbnailVaultEntries,
    appendThumbnailVaultEntry,
    removeThumbnailVaultByIndex,
    syncCollectionStore,
    readThumbnailVault
  } from '../../lib/viewer/thumbnailVault.js';
  import { assertDeleteReducedCount } from '../../lib/viewer/thumbnailInvariants.js';

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
  /** @type {(videos: unknown[]) => void} */
  export let persistPersonalVault = () => {};
  /** @type {(key: string, value: unknown) => { ok?: boolean }} */
  export let storageSet = () => ({ ok: true });
  /** @type {() => string} */
  export let getFallbackImage = () => '';
  let vaultDeleteDragActive = false;
  let deleteAuditLogged = false;
  let selectedThumbnailIds = [];
  let selectedVideoIds = [];
  let thumbnailCanonicalizationDone = false;
  let thumbnailCanonInFlight = false;

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
  $: console.info('[VAULT_ITEM_COUNT]', {
    images: ($personalThumbnailCollection ?? []).filter(Boolean).length,
    videos: ($personalVideos ?? []).filter(Boolean).length,
    ts: new Date().toISOString()
  });
  $: demoDebugMode = isDemoDebugMode();
  $: shouldShowVaultDemoCards =
    demoDebugMode ||
    (($personalVideos?.length ?? 0) === 0 && ($personalThumbnailCollection?.length ?? 0) === 0);
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
    const token =
      typeof window !== 'undefined' ? localStorage.getItem('reelforge_admin_session_token') : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
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
    console.info('[DELETE_API]', { stage: 'start', reelId, ts: t0 });
    try {
      await apiDeleteReelById(reelId, authHeaders());
      console.info('[DELETE_API]', { stage: 'success', reelId, elapsedMs: Date.now() - t0 });
      return true;
    } catch (e) {
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
    await ensureThumbnailCanonicalization();
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

  function applyVideoDeleteTombstone(deletedIds) {
    if (!deletedIds?.length) return;
    const deletedIdSet = new Set(deletedIds.map((id) => String(id || '').trim()).filter(Boolean));
    personalVideos.update((videos) =>
      (videos || []).filter((video) => !deletedIdSet.has(String(video?.id || '').trim()))
    );
    persistPersonalVault(get(personalVideos));
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
    const before = get(personalThumbnailCollection).length;
    const result = deleteThumbnailVaultEntries(deletedIds, imageReels, {
      backendReachable: true,
      storageKey: CONFIG.THUMBNAIL_STORAGE_KEY,
      failedIds
    });
    syncCollectionStore(personalThumbnailCollection, CONFIG.THUMBNAIL_STORAGE_KEY);
    const after = get(personalThumbnailCollection).length;
    console.info('[DELETE_STORE]', {
      action: 'applyThumbnailDeleteTombstone',
      deletedIds: [...deletedIds],
      failedIds: [...failedIds],
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
      await syncFromVault(true, true);
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
    console.info('[DELETE_CONFIRMED]', {
      mechanism: 'batch',
      vault: 'video-vault',
      mode: 'selected',
      itemCount: selected.length,
      timestamp: Date.now()
    });
    const beforeCount = get(personalVideos).length;
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
      applyVideoDeleteTombstone(deletedIds);
    }
    await syncFromVault(true, true);
    applyVideoDeleteTombstone(deletedIds);
    selectedVideoIds = [];
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
    await AI_CLEANUP_AGENT.deleteVaultVideo(payload.id);
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

  export function handleVaultVideoDragEnter() {
    videoDragActive.set(true);
    logDrag('video-vault:dragenter');
  }

  export function handleVaultVideoDragLeave() {
    videoDragActive.set(false);
  }

  export function handleVaultVideoDragOver(event) {
    allowDrop(event);
  }

  export async function handleVaultVideoDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    videoDragActive.set(false);
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

    const file = Array.from(event.dataTransfer?.files || []).find((f) => {
      const type = (f.type || '').toLowerCase();
      const name = (f.name || '').toLowerCase();
      return (
        type.startsWith('video/') ||
        name.endsWith('.mp4') ||
        name.endsWith('.mov') ||
        name.endsWith('.webm')
      );
    });

    if (!file) {
      pipelineDiag('DND', 'handleVaultVideoDrop', 'VaultExperience.svelte', { result: 'rejected_invalid_file' });
      uploadStatus.set('⚠️ Drop a valid video file');
      return;
    }
    pipelineCheckpoint('DROP_RECEIVED', {
      filename: file.name,
      vault: 'mp4',
      kind: 'mp4-vault',
      id: null,
      timestamp: new Date().toISOString()
    });

    if (file.size > CONFIG.MAX_VIDEO_SIZE) {
      uploadStatus.set(`⚠️ Video too large. Max ${CONFIG.MAX_VIDEO_SIZE / 1024 / 1024}MB`);
      return;
    }

    const validation = await validateVideoFile(file);
    if (!validation.valid) {
      uploadStatus.set(`⚠️ ${validation.reason || 'Invalid video file'}`);
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 3000);
      return;
    }

    uploadStatus.set('🎬 Uploading to backend...');
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
    try {
      const formData = new FormData();
      formData.append('video', file);
      const token =
        typeof window !== 'undefined' ? localStorage.getItem('reelforge_admin_session_token') : null;
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await uploadMedia(formData, headers);
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
      const entry = {
        ...vaultEntry,
        size: file.size,
        type: file.type || vaultEntry.type,
        addedAt: response.createdAt || response.created_at || new Date().toISOString()
      };
      if (isHeroAsset(entry)) {
        uploadStatus.set('⚠️ Hero media blocked from content vault');
        return;
      }
      console.info('[VIDEO_VAULT_INSERT]', {
        source: 'VaultExperience.handleVaultVideoDrop',
        id: entry.id || '',
        mime: entry.type || '',
        url: entry.url || '',
        thumbnail: entry.thumbnail || '',
        ts: new Date().toISOString()
      });

      personalVideos.update((videos) => {
        const before = videos;
        const next = [entry, ...videos.filter((item) => item?.id !== entry.id && item?.url !== entry.url)];
        if (next.length > CONFIG.MAX_VAULT_ITEMS) next.pop();
        reelResStoreMutation('personalVideos', before, next, {
          trigger: 'handleVaultVideoDrop',
          entryId: entry.id,
          entryUrl: entry.url
        });
        return next;
      });
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
      console.info('[UPLOAD_SUCCESS]', {
        vault: 'video',
        id: entry.id,
        url: entry.url,
        thumbnail: entry.thumbnail || '',
        ts: new Date().toISOString()
      });
      uploadStatus.set(`✅ Added to vault & feed: ${file.name}`);
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
      console.error('Failed to process video:', error);
      pipelineDiag('UPLOAD', 'handleVaultVideoDrop', 'VaultExperience.svelte', {
        fileName: file?.name || null,
        result: 'error',
        detail: error?.message || String(error)
      });
      console.error('[UPLOAD_FAILED]', {
        vault: 'video',
        name: file?.name || '',
        error: error?.message || String(error),
        ts: new Date().toISOString()
      });
      uploadStatus.set('❌ Failed to process video');
    } finally {
      resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
    }
  }

  export function handleVaultVideoDragStart(event, video) {
    if (!video || !event.dataTransfer) return;
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
    const { file, preview, name } = pending;
    pipelineDiag('UPLOAD', 'acceptPendingThumbnail', 'VaultExperience.svelte', {
      fileName: name,
      result: 'accept_start'
    });
    uploadStatus.set('📤 Uploading thumbnail...');
    console.info('[UPLOAD_STARTED]', {
      vault: 'thumbnail',
      name,
      type: file?.type || '',
      size: file?.size || 0,
      ts: new Date().toISOString()
    });
    try {
      const token =
        typeof window !== 'undefined' ? localStorage.getItem('reelforge_admin_session_token') : null;
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const response = await uploadThumbnail(file, headers, { title: name });
      logVaultFieldAudit('POST /api/reels response', response);

      const rawThumbPath =
        response.thumbnailPath ||
        response.thumbnail_path ||
        response.thumbnailUrl ||
        response.thumbnail_url ||
        response.url;
      const thumbPath = toRelativeMediaPath(rawThumbPath);
      if (!thumbPath || !String(thumbPath).startsWith('/thumbs/')) {
        throw new Error(`Invalid upload response: ${JSON.stringify(response)}`);
      }

      const entryName = String(thumbPath).split('/').pop() || name;
      const entry = {
        id: String(response.id || ''),
        fileName: entryName,
        name: name,
        title: name,
        type: response.type || response.media_type || 'image',
        url: thumbPath,
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
      AI_CLEANUP_AGENT.distributeThumbnailAcrossCategories(entryName, thumbPath);
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
      await syncFromVault(true, true);
      pipelineDiag('VIEWER', 'acceptPendingThumbnail', 'VaultExperience.svelte', {
        assetId: entry.id || entryName,
        fileName: name,
        result: 'sync_complete'
      });
      if (preview?.startsWith('blob:')) resourceManager.revokeBlobUrl(preview);
      pendingThumbnail.set(null);
    } catch (error) {
      console.error('Upload failed:', error);
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
      uploadStatus.set(`❌ Upload failed: ${error.message || 'check backend'}`);
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
      await syncFromVault(true, true);
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
    console.info('[DELETE_CONFIRMED]', {
      mechanism: 'batch',
      vault: 'video-vault',
      timestamp: Date.now()
    });
    uploadStatus.set('🗑️ Deleting videos from backend...');
    try {
      const beforeCount = videos.length;
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
        const deletedIdSet = new Set(deletedIds);
        personalVideos.update((items) =>
          (items || []).filter((video) => !deletedIdSet.has(String(video?.id || '').trim()))
        );
        persistPersonalVault(get(personalVideos));
      }
      await syncFromVault(true, true);
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
  <h4>Your Thumbnails ({$personalThumbnailCollection.length})</h4>
  <div style="display: flex; justify-content: space-between; align-items: center;">
    <p class="thumbnail-hint">Click thumbnail to remove • Drag & drop to add</p>
    <div style="display: flex; gap: 8px;">
      <button
        class="batch-delete-btn"
        data-vault="thumbnail"
        on:click={() => {
          console.info('[DELETE_CLICK]', { button: 'DELETE_SELECTED_THUMBS_DOM', disabled: selectedThumbnailIds.length === 0 });
          batchDeleteSelectedThumbnails();
        }}
        disabled={selectedThumbnailIds.length === 0}
      >
        🗑️ DELETE SELECTED THUMBS ({selectedThumbnailIds.length})
      </button>
      <button
        class="batch-delete-btn"
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
          <button class="accept-btn" on:click={acceptPendingThumbnail}>✅ ACCEPT</button>
          <button class="reject-btn" on:click={rejectPendingThumbnail}>❌ REJECT</button>
        </div>
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
        {#if isImage(reel) && reel.url}
          <MediaThumbnail
            url={reel.url}
            alt={reel.name}
            loading="lazy"
            className="vault-grid-visual {i === ($personalThumbnailIndex % $personalThumbnailCollection.length) ? 'active' : ''}"
            on:load={(event) =>
              (console.info('[IMAGE_RENDER]', { index: i, url: reel.url, ts: new Date().toISOString() }),
              logVaultCardLayoutDiagnostics(event.currentTarget.closest('.vault-card'), `thumb-${i}:load`))}
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

<div class="personal-media-grid">
  <h4>Video Vault ({$personalVideos.length})</h4>
  <div style="display: flex; justify-content: space-between; align-items: center;">
    <p class="thumbnail-hint">Drop MP4/MOV • Auto-categorizes into feed</p>
    <div style="display: flex; gap: 8px;">
      <button
        class="batch-delete-btn"
        data-vault="video"
        on:click={batchDeleteSelectedVideos}
        disabled={selectedVideoIds.length === 0}
      >
        🗑️ DELETE SELECTED VIDEOS ({selectedVideoIds.length})
      </button>
      <button
        class="batch-delete-btn"
        on:click={batchDeleteVideos}
        disabled={$personalVideos.length === 0}
      >
        🗑️ BATCH DELETE ALL
      </button>
    </div>
  </div>
  <div
    class="drop-zone video-vault-drop"
    class:active={$videoDragActive}
    on:dragenter={handleVaultVideoDragEnter}
    on:dragover={handleVaultVideoDragOver}
    on:dragleave={handleVaultVideoDragLeave}
    on:drop={handleVaultVideoDrop}
    role="group"
    aria-label="Video drop zone"
  >
    <div class="drop-placeholder">
      <span class="drop-icon">🎬</span>
      <span>DROP VIDEO HERE (MP4/MOV)</span>
      <small>Max 50MB • Appears instantly</small>
    </div>
  </div>
  <div
    class="drop-zone video-vault-drop"
    class:active={vaultDeleteDragActive}
    on:dragenter={handleVaultDeleteDragEnter}
    on:dragover={handleVaultDeleteDragOver}
    on:dragleave={handleVaultDeleteDragLeave}
    on:drop={handleVaultDeleteDrop}
    role="group"
    aria-label="Delete drop zone"
  >
    <div class="drop-placeholder">
      <span class="drop-icon">🗑️</span>
      <span>DROP VAULT ITEM HERE TO DELETE</span>
      <small>Supports dragged thumbnail/video cards</small>
    </div>
  </div>
  {#if $personalVideos.length > 0}
    <div class="thumbnail-grid vault-grid vault-grid--videos video-vault-grid">
      {#each $personalVideos.filter(Boolean) as video, vi (video?.id || video?.url || video?.fileName || `video-${vi}`)}
        {#if video}
          {@const reel = getVaultVideoReel(video)}
          {@const microDrama = isMicroDramaContent(video) || isMicroDramaContent(reel)}
          {@const _vaultRenderGateBranch = logVaultRenderGate(video, reel, vi, { isVideo, isVideoReel })}
          <div
            class="vault-card thumbnail-item video-vault-item"
            class:video={isVideo(reel)}
            class:micro-drama={microDrama}
            use:vaultCardDiagnostics={`video-${vi}`}
            draggable="true"
            on:dragstart={(event) => handleVaultVideoDragStart(event, video)}
            role="listitem"
          >
            {#if $reelshortActive && microDrama}
              <VaultEngagementBadge itemId={video.id || reel.name} />
            {/if}
            {#if isVideo(reel) && reel.url}
              <MediaRenderer
                type="video"
                url={reel.url}
                poster={reel.thumbnailUrl || undefined}
                useSourceElement={true}
                muted
                playsinline
                preload="metadata"
                className="vault-grid-visual vault-grid-video"
                width="100%"
                height="100%"
                on:loadeddata={(event) => {
                  console.info('[VIDEO_RENDER]', { index: vi, url: reel.url, ts: new Date().toISOString() });
                  pipelineCheckpoint('VIDEO_ATTACHED', {
                    vault: 'mp4',
                    videoSrc: reel.url,
                    reelId: video?.id || reel?.id || null
                  });
                  handleVaultVideoLoaded(event, reel);
                }}
                on:loadedmetadata={(event) =>
                  logVaultCardLayoutDiagnostics(
                    event.currentTarget.closest('.vault-card'),
                    `video-${vi}:load`
                  )}
                on:error={(event) => handleVaultVideoElementError(event, video, reel)}
              />
            {:else}
              {@const _vaultPlaceholderGate = logVaultPlaceholderGate(video, reel, vi)}
              <div class="placeholder" aria-hidden="true">▶</div>
            {/if}
            <div class="vault-grid-chrome">
              <span class="thumbnail-label">🎬 {reel.name?.substring(0, 12)}...</span>
              <span class="video-size-badge">{(video?.size / 1024 / 1024).toFixed(1)}MB</span>
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
                on:click|stopPropagation={() => AI_CLEANUP_AGENT.deleteVaultVideo(video.id)}
                aria-label="Delete video {video.name}"
              >
                ✕
              </button>
              <label class="batch-select-label">
                <input
                  type="checkbox"
                  class="batch-select-checkbox"
                  checked={selectedVideoIds.includes(String(video?.id || '').trim())}
                  on:change|stopPropagation={() => toggleVideoSelection(String(video?.id || '').trim())}
                />
                Select
              </label>
            </div>
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
