import { get } from 'svelte/store';

export function createUiAgent(deps) {
  const {
    NEON_COLORS,
    CONFIG,
    ALLOW_UI_PLACEHOLDERS,
    feed,
    deleteConfirmReel,
    isDeleting,
    categoryNames,
    uploadStatus,
    personalStudioMode,
    personalThumbnailCollection,
    usePersonalThumbnails,
    personalVideoCollection,
    newTitle,
    selectedFile,
    videoSource,
    dragActive,
    newCategory,
    feedCardImageFallbacks,
    ProductionAgent,
    PersonalUploadSystem,
    BLACK_STORIES_MATCHER,
    hasPlayableVideo,
    syncFromVault
  } = deps;

  const UIAgent = {
  configs: {
    'Trending': { color: NEON_COLORS.red, label: 'Trending' },
    'Cyber-Action': { color: NEON_COLORS.cyan, label: 'Cyber-Action' },
    'Romance': { color: NEON_COLORS.pink, label: 'Romance' },
    'Suspense': { color: '#8B4513', label: 'Suspense' },
    'Auto-Detect': { color: '#666', label: 'Auto-Detect' }
  },
  getStudioConfigs(category) { return this.configs[category] || { color: '#666', label: category }; },
  // Disable synthetic auto-pan on hover; it fights native wheel/touch scroll and causes row jitter.
  startScroll: (_e) => {},
  stopScroll: (_e) => {},
  fillLandscape: (reels, category) => {
  const real = [...(reels || [])]
  .filter((r) => ALLOW_UI_PLACEHOLDERS || (!r?.isPlaceholder && !r?.isBlackStoriesPlaceholder))
  .sort((a, b) => {
  const aVid = hasPlayableVideo(a) ? 0 : a?.isPlaceholder ? 2 : 1;
  const bVid = hasPlayableVideo(b) ? 0 : b?.isPlaceholder ? 2 : 1;
  return aVid - bVid;
  });
  if (!ALLOW_UI_PLACEHOLDERS) return real;
  if (!real.length) return BLACK_STORIES_MATCHER.fillBlackStoriesUntilVideo(0, category);
  if (real.length >= CONFIG.TARGET_LANDSCAPE_COUNT) return real;
  const placeholders = BLACK_STORIES_MATCHER.fillBlackStoriesUntilVideo(real.length, category);
  return [...real, ...placeholders];
  },
  handleImageError: (_imgElement, reel, category, index) => {
  if (!reel?.id) return;
  const fallback = BLACK_STORIES_MATCHER.matchToContent(reel.title || '', category, index);
  feedCardImageFallbacks.update((m) => ({ ...m, [reel.id]: fallback }));
  },
  deleteProduction: async (id) => {
    console.info('[DELETE_HANDLER_FIRED]', {
      mechanism: 'single',
      vault: 'studio-feed',
      itemId: String(id || ''),
      timestamp: Date.now()
    });
    const currentFeed = get(feed);
    const reel = Object.values(currentFeed).flat().find((r) => r && r.id === id);
    if (!reel) return;
    const normalizedLabel = String(reel.name || reel.title || '').trim();
    console.info('[DELETE_CONFIRMATION_SHOWN]', {
      itemId: String(reel.id || ''),
      itemName: normalizedLabel || 'Untitled Item',
      category: String(reel.category || ''),
      mechanism: 'single',
      timestamp: Date.now()
    });
    deleteConfirmReel.set({
      ...reel,
      name: normalizedLabel || reel.name,
      title: normalizedLabel || reel.title
    });
  },
  confirmDelete: async () => {
    const reel = get(deleteConfirmReel);
    if (!reel) return;
    isDeleting.set(true);
    try {
      console.info('[DELETE_CONFIRMED]', {
        itemId: String(reel.id || ''),
        mechanism: 'single',
        vault: String(reel.category || 'studio-feed'),
        timestamp: Date.now()
      });
      const beforeCount = Object.values(get(feed) || {}).flat().length;
      const success = await ProductionAgent.deleteReel(reel.id);
      if (!success) return;
      deleteConfirmReel.set(null);
      await syncFromVault(true);
      const afterCount = Object.values(get(feed) || {}).flat().length;
      console.info('[DELETE_STORE_UPDATE]', {
        vault: 'studio-feed',
        beforeCount,
        afterCount,
        mechanism: 'single',
        timestamp: Date.now()
      });
      console.info('[DELETE_UI_REFRESH]', {
        vault: 'studio-feed',
        newCount: afterCount,
        timestamp: Date.now()
      });
      console.info('[DELETE_COMPLETE]', {
        itemId: String(reel.id || ''),
        mechanism: 'single',
        timestamp: Date.now()
      });
    } finally {
      isDeleting.set(false);
    }
  },
  cancelDelete: () => {
    console.info('[DELETE_CANCELLED]', {
      scope: 'studio-feed',
      timestamp: Date.now()
    });
    deleteConfirmReel.set(null);
  },
  handleFileBrowse: () => { document.getElementById('file-input')?.click(); },
  handleFileSelect: (e) => { const file = e.target.files?.[0]; if (checkIsVideo(file)) { selectedFile.set(file); videoSource.set(''); } },
  handleDrop: (e) => { e.preventDefault(); dragActive.set(false); const file = e.dataTransfer?.files[0]; if (checkIsVideo(file)) { selectedFile.set(file); videoSource.set(''); } },
  async renameCategory(oldName, newName) { const trimmed = newName?.trim(); if (!trimmed || trimmed === oldName) return; categoryNames.saveName(oldName, trimmed); const currentFeed = get(feed); if (currentFeed[oldName]) { currentFeed[trimmed] = currentFeed[oldName].map((r) => ({ ...r, category: trimmed })); delete currentFeed[oldName]; feed.set({ ...currentFeed }); categories.set(Object.keys(currentFeed)); } uploadStatus.set('✅ Category Renamed & Persisted'); },
  togglePersonalStudioMode: () => { personalStudioMode.update((p) => { const newVal = !p; const thumbCount = get(personalThumbnailCollection).length; uploadStatus.set(newVal ? `🎬 PERSONAL STUDIO MODE ACTIVATED (${thumbCount} thumbnails)` : '🎬 PERSONAL STUDIO MODE DEACTIVATED'); return newVal; }); },
  togglePersonalThumbnails: () => { usePersonalThumbnails.update((u) => { const newVal = !u; const thumbCount = get(personalThumbnailCollection).length; uploadStatus.set(newVal ? `🖼️  USING PERSONAL THUMBNAILS (${thumbCount})` : '🖼️  USING AI-GENERATED THUMBNAILS'); return newVal; }); },
  quickUploadPersonal: () => { const nt = get(newTitle); if (!nt) { uploadStatus.set('ERROR: TITLE REQUIRED'); return; } PersonalUploadSystem.quickUpload(nt, 'Trending'); },
  batchUploadPersonal: () => { PersonalUploadSystem.batchUploadPersonalContent(); }
  };
  return UIAgent;
}
