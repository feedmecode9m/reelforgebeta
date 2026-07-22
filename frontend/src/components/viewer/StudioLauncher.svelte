<script>
  import { onDestroy, tick } from 'svelte';
  import StudioExperience from '../experiences/StudioExperience.svelte';

  export let studioRefs;
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
  export let persistentTitles = null;
  export let matchToContent;
  export let vaultUtils;
  export let syncFromVault;
  export let persistPersonalVault;
  export let viewerHydrationReady;
  export let storageSet;
  export let clearApplicationCache;
  export let resetAllLocalData;
  export let getFallbackImage;
  export let startStudioWalkthrough;
  export let toggleControlCenter;
  export let logout;
  export let handleEpisodeAssetChanged;
  export let studioFeedReels;
  export let studioSeriesMetadataReelOptions;
  export let studioSeriesMetadataReelLabel;
  export let ghostHoverActive;
  export let deleteConfirmReel;
  export let isDeleting;
  export let handleGhostHoverEnter;
  export let handleGhostHoverLeave;

  let studioExperience = null;
  let studioWalkthrough = null;
  let deleteDialog = null;
  let previousFocusedElement = null;
  let deleteFocusTrapActive = false;
  $: studioRefs.experience = studioExperience;
  $: studioRefs.walkthrough = studioWalkthrough;

  const FOCUSABLE_SELECTOR = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(', ');

  function getDeleteFocusableElements() {
    if (!deleteDialog) return [];
    return Array.from(deleteDialog.querySelectorAll(FOCUSABLE_SELECTOR));
  }

  async function activateDeleteFocusTrap() {
    if (typeof document === 'undefined') return;
    deleteFocusTrapActive = true;
    previousFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await tick();
    const focusable = getDeleteFocusableElements();
    (focusable[0] || deleteDialog)?.focus();
  }

  function restoreDeleteFocus() {
    if (previousFocusedElement && typeof previousFocusedElement.focus === 'function') {
      previousFocusedElement.focus();
    }
    previousFocusedElement = null;
  }

  function closeDeleteDialog() {
    UIAgent.cancelDelete();
  }

  function handleDeleteOverlayClick(event) {
    if (event.target === event.currentTarget) closeDeleteDialog();
  }

  function handleDeleteDialogKeydown(event) {
    if (!$deleteConfirmReel) return;
    if (!deleteDialog) return;
    const activeElement = document.activeElement;
    if (activeElement && !deleteDialog.contains(activeElement)) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeDeleteDialog();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = getDeleteFocusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      deleteDialog?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function looksLikeUuid(value) {
    const text = String(value || '').trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text);
  }

  function getDeleteItemDisplayName(item) {
    const primaryLabel = [item?.name, item?.title].find((value) => {
      const text = String(value || '').trim();
      return text && !looksLikeUuid(text);
    });
    if (primaryLabel) return String(primaryLabel).trim();

    const idLabel = [item?.assetId, item?.id].find((value) => String(value || '').trim());
    if (idLabel) {
      const text = String(idLabel).trim();
      return looksLikeUuid(text) ? `${text.slice(0, 8)}...` : text;
    }

    return 'Untitled Item';
  }

  $: deleteItemDisplayName = getDeleteItemDisplayName($deleteConfirmReel);

  $: if ($deleteConfirmReel && !deleteFocusTrapActive) {
    void activateDeleteFocusTrap();
  }

  $: if (!$deleteConfirmReel && deleteFocusTrapActive) {
    deleteFocusTrapActive = false;
    restoreDeleteFocus();
  }

  onDestroy(() => {
    restoreDeleteFocus();
  });
</script>

<svelte:window on:keydown={handleDeleteDialogKeydown} />

<input type="file" id="file-input" accept="video/mp4,video/*" style="display: none" on:change={UIAgent.handleFileSelect} />
<button
  class="ghost-trigger"
  class:active={$ghostHoverActive}
  on:mouseenter={handleGhostHoverEnter}
  on:mouseleave={handleGhostHoverLeave}
  on:click={toggleControlCenter}
  on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleControlCenter(); } }}
  aria-label="Toggle Control Center"
>
  <span class="trigger-symbol">⌘</span>
</button>

{#if $deleteConfirmReel}
<div
  class="delete-modal-overlay"
  role="presentation"
  on:click={handleDeleteOverlayClick}
>
  <div
    bind:this={deleteDialog}
    class="delete-modal-container"
    role="dialog"
    aria-modal="true"
    aria-labelledby="delete-modal-title"
    tabindex="-1"
  >
    <div class="delete-modal-header"><h2 id="delete-modal-title" class="delete-modal-title">⚠️ CONFIRM DELETION</h2><button type="button" class="delete-modal-close" on:click={closeDeleteDialog} aria-label="Cancel deletion">✕</button></div>
    <div class="delete-modal-content"><div class="delete-warning-icon">🗑️</div><p class="delete-message">Are you sure you want to permanently delete:</p><h3 class="delete-reel-title">"{deleteItemDisplayName}"</h3><p class="delete-details">Category: <span style="color: {UIAgent.getStudioConfigs($deleteConfirmReel.category).color}">{UIAgent.getStudioConfigs($deleteConfirmReel.category).label}</span></p>{#if $deleteConfirmReel?.status}<p class="delete-details">Status: <span class="production-status-badge status-{String($deleteConfirmReel.status).toLowerCase()}">{String($deleteConfirmReel.status)}</span></p>{/if}{#if $deleteConfirmReel?.id}<p class="delete-details delete-id">ID: <code>{String($deleteConfirmReel.id)}</code></p>{/if}<p class="delete-warning-text">This action cannot be undone.</p></div>
    <div class="delete-modal-actions"><button type="button" class="delete-cancel-btn" on:click={closeDeleteDialog} disabled={$isDeleting}>CANCEL</button><button type="button" class="delete-confirm-btn" on:click={UIAgent.confirmDelete} disabled={$isDeleting}>{#if $isDeleting}<span class="delete-spinner"></span>DELETING...{:else}🗑️ CONFIRM DELETE{/if}</button></div>
  </div>
</div>
{/if}

<StudioExperience
  bind:this={studioExperience}
  bind:studioWalkthrough
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
  {CATEGORY_DETECTOR}
  {categoryNames}
  {persistentTitles}
  {matchToContent}
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
  {isDeleting}
  {deleteConfirmReel}
/>
