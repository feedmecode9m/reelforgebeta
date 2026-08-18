import { get } from 'svelte/store';
import { createLocalReel } from '../api/reelContract.js';
import { deleteMediaFile, deleteReelById, fetchReadyReels } from '../api/media.js';
import { getAdminAuthHeaders, getAdminToken } from '../api.js';
import { isInvalidSessionError } from '../adminSession.js';
import { filenameFromMediaRef } from '../vaultMedia.js';
import { toRelativeMediaPath } from '../config.js';
import { durableImageVaultUrl, resolveDurableViewerPoster } from './vaultUtils.js';
import { lookupPersistentTitleEntry, mediaRecordPlaybackKey } from '../content/persistentTitleMap.js';
import {
  logDeletionPropagation,
  filterOutDeletedMedia,
  applyCanonicalDeleteClientEffects,
  isGhostVideoVaultEntry
} from '../deletionSync.js';
import { isStorageFull, wouldExceedQuota } from '../storage.js';
import { isHeroAsset, filterNonHeroAssets } from '../hero/heroDomainGuard.js';
import { clearHeroReel, resolveActiveHeroVideoReel } from '../hero/heroReelIdentity.js';
import { trackUploadLockRemove } from '../diagnostics/uploadLockDiag.js';
import {
  deleteThumbnailVaultEntries,
  readThumbnailVault,
  removeThumbnailVaultByIndex,
  syncCollectionStore
} from './thumbnailVault.js';
import { isThumbnailImageReel } from './thumbnailCanonicalization.js';
import { shouldSynthesizePersonalThumbnailFeedCard } from './thumbnailDestinationIdentity.js';
import { evaluateViewerImageDiscoveryEligibility, isUnsafeViewerCardTitle } from '../feed/viewerMediaIdentity.js';
import {
  findCanonicalFeedMatch,
  matchCanonicalFeedIdentity,
  normalizeMediaUrl,
  removeCanonicalFeedMatches,
  resolveProtectedFeedTitle
} from '../feed/canonicalMediaIdentity.js';
import { traceThumbStoreWrite } from './thumbStoreWriteTrace.js';
import { pipelineCheckpoint } from '../diagnostics/pipelineDiag.js';
import { vaultForensic } from '../diagnostics/vaultForensics.js';
import {
  hydrateCatalogItemWithCreatorMetadata
} from '../feed/creatorCatalogMetadata.js';
import { classifyContent } from '../feed/contentClassifier.js';
import { applyCatalogMetadata, resolveCatalogMetadata } from '../feed/catalogMetadata.js';

function isCameraRollThumbPath(url) {
  const base = filenameFromMediaRef(url);
  return /^(IMG_|DSC_|PXL_|MVIMG)/i.test(String(base || ''));
}

function feedCardNeedsVaultPoster(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.isPlaceholder || row.isPresentationOnly) return false;
  const url = String(row.url || row.mediaUrl || '');
  const type = String(row.type || '');
  const isVid =
    row.isPersonalVideo === true ||
    type.startsWith('video') ||
    url.includes('/videos/') ||
    /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url);
  if (!isVid) return false;
  const poster = String(row.thumbnailUrl || row.posterUrl || row.thumbnail || '').trim();
  if (!poster) return true;
  if (poster.startsWith('blob:') || poster.startsWith('data:')) return true;
  if (isCameraRollThumbPath(poster)) return true;
  return false;
}

function stampFeedPoster(row, thumbUrl) {
  return { ...row, thumbnailUrl: thumbUrl, posterUrl: thumbUrl, thumbnail: thumbUrl };
}

function attachVaultStillToFeedMap(newFeed, categoriesList, thumbUrl, linkedId) {
  if (!thumbUrl) return newFeed;
  const link = String(linkedId || '').trim();
  for (const cat of categoriesList) {
    newFeed[cat] = (newFeed[cat] || []).map((r) => {
      if (!r || typeof r !== 'object') return r;
      const id = String(r.id || '').trim();
      const vid = String(r.personal_video_id || '').trim();
      if (link && (id === link || vid === link)) return stampFeedPoster(r, thumbUrl);
      if (feedCardNeedsVaultPoster(r)) return stampFeedPoster(r, thumbUrl);
      return r;
    });
  }
  return newFeed;
}

function ensureVideoOnTrendingShelf(newFeed, reel) {
  const id = String(reel?.id || '').trim();
  if (!id || !reel) return newFeed;
  if (!newFeed.Trending) newFeed.Trending = [];
  const already = newFeed.Trending.some((r) => String(r?.id || '').trim() === id);
  if (already) return newFeed;
  newFeed.Trending = [{ ...reel, category: 'Trending' }, ...newFeed.Trending];
  return newFeed;
}

function seedPlaybackTitleMap(titles, titleByPlayback, videoVaultKey = 'personal_video_vault') {
  const push = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const saved = lookupPersistentTitleEntry(titles, entry);
    const play = mediaRecordPlaybackKey(entry);
    if (saved?.title && play && !titleByPlayback.has(play)) {
      titleByPlayback.set(play, saved);
    }
  };
  try {
    const vault = JSON.parse(
      (typeof window !== 'undefined' ? localStorage.getItem(videoVaultKey) : null) || '[]'
    );
    if (Array.isArray(vault)) vault.forEach(push);
  } catch {
    /* ignore */
  }
  try {
    const hero = JSON.parse(
      (typeof window !== 'undefined' ? localStorage.getItem('reelforge_hero_reel') : null) || 'null'
    );
    push(hero);
  } catch {
    /* ignore */
  }
}

function resolvePersistentTitleForMedia(titles, probes, videoVaultKey = 'personal_video_vault') {
  const list = Array.isArray(probes) ? probes : [probes];
  for (const probe of list) {
    if (!probe || typeof probe !== 'object') continue;
    const hit = lookupPersistentTitleEntry(titles, probe);
    if (hit?.title) return hit;
  }
  const titleByPlayback = new Map();
  seedPlaybackTitleMap(titles, titleByPlayback, videoVaultKey);
  for (const probe of list) {
    if (!probe || typeof probe !== 'object') continue;
    const play = mediaRecordPlaybackKey(probe);
    const hit = play ? titleByPlayback.get(play) : null;
    if (hit?.title) return hit;
  }
  return null;
}

export function createAiCleanupAgent(deps) {
  const {
    CONFIG,
    resourceManager,
    feed,
    personalThumbnailCollection,
    personalVideos,
    personalVideoCollection,
    uploadStatus,
    storageHealth,
    aiMaintenanceMode,
    isCleaning,
    lastAiCleanup,
    CATEGORY_DETECTOR,
    storageSet,
    runClientMediaPurge,
    syncFromVault
  } = deps;

  const AI_CLEANUP_AGENT = {
  authHeaders() {
  return getAdminAuthHeaders();
  },
  mediaBasename(value) {
  return String(value || '').split('/').pop()?.split('?')[0] || '';
  },
  config: { maxVaultAge: CONFIG.MAX_VAULT_AGE, cleanupInterval: CONFIG.CLEANUP_INTERVAL, minFreeSpace: 50 * 1024 * 1024 },
  _lastHealthCleanupAt: 0,
  _healthCheckTimer: null,
  MIN_HEALTH_CLEANUP_GAP_MS: 30 * 1000,
  init() {
  console.log('🤖 AI Cleanup Agent initialized');
  this.scheduleCleanup();
  resourceManager.setTimeout(() => {
  this.performHealthCheck(false);
  if (isStorageFull()) {
  uploadStatus.set('Storage full, clear data to continue');
  return;
  }
  this.syncThumbnailsToFeed();
  this.syncVideoVaultToFeed();
  }, CONFIG.HEALTH_CHECK_DELAY);
  if (typeof window !== 'undefined') {
  resourceManager.addEventListener(window, 'storage', (e) => {
  if (e.key === CONFIG.TITLES_STORAGE_KEY || e.key === CONFIG.VIDEO_VAULT_INDEX_KEY) {
  this.scheduleHealthCheck(false);
  if (!isStorageFull()) {
  this.syncThumbnailsToFeed();
  this.syncVideoVaultToFeed();
  }
  }
  });
  }
  },
  scheduleHealthCheck(allowCleanup = false) {
  if (this._healthCheckTimer) clearTimeout(this._healthCheckTimer);
  this._healthCheckTimer = setTimeout(() => {
  this._healthCheckTimer = null;
  this.performHealthCheck(allowCleanup);
  }, 1500);
  },
  scheduleCleanup() {
  resourceManager.setInterval(() => { if (get(aiMaintenanceMode)) { console.log('🤖 Auto-cleanup triggered'); this.performIntelligentCleanup(); } }, this.config.cleanupInterval);
  },
  performHealthCheck(allowCleanup = false) {
  console.log('🤖 Performing health check...');
  const health = this.calculateHealthScore();
  storageHealth.set(health);
  if (allowCleanup && health.score < 70 && get(aiMaintenanceMode)) {
  const now = Date.now();
  if (!get(isCleaning) && now - this._lastHealthCleanupAt >= this.MIN_HEALTH_CLEANUP_GAP_MS) {
  console.log('🤖 Health below 70%, triggering auto-cleanup');
  this._lastHealthCleanupAt = now;
  this.performIntelligentCleanup();
  }
  }
  return health;
  },
  calculateHealthScore() {
  try {
  const vault = JSON.parse((typeof window !== 'undefined' ? localStorage.getItem(CONFIG.VAULT_KEY) : null) || '[]');
  const thumbCollection = get(personalThumbnailCollection);
  const videoVaultIndex = JSON.parse((typeof window !== 'undefined' ? localStorage.getItem(CONFIG.VIDEO_VAULT_INDEX_KEY) : null) || '[]');
  const total = vault.length + thumbCollection.length + videoVaultIndex.length;
  if (total === 0) return { score: 100, issues: [], details: { vault: 0, thumbs: 0, videos: 0 }, total: 0, valid: 0 };
  let valid = 0;
  const issues = [];
  const details = { vault: 0, thumbs: 0, videos: 0 };
  vault.forEach((reel) => {
  const vOk = this.validateVideoReference(reel.type === 'video' ? reel : null);
  const tOk = this.validateThumbnailReference(reel);
  if (vOk && tOk) { valid++; details.vault++; } else { if (!vOk) issues.push(`Missing video: ${reel.title || reel.id}`); if (!tOk) issues.push(`Missing thumbnail: ${reel.title || reel.id}`); }
  });
  thumbCollection.forEach((thumb) => { if (thumb && (thumb.startsWith('personal_') || thumb.includes('.'))) { valid++; details.thumbs++; } else { issues.push(`Invalid thumbnail: ${thumb}`); } });
  videoVaultIndex.forEach((video) => { if (video?.id && video?.name) { valid++; details.videos++; } else { issues.push(`Invalid video entry: ${video?.name || 'unknown'}`); } });
  const score = Math.min(100, Math.max(0, Math.round((valid / total) * 100)));
  return { score, issues: issues.slice(0, 5), details, total, valid };
  } catch (e) { console.error('Health calculation failed:', e); return { score: 0, issues: ['Health check failed: ' + e.message], details: {}, total: 0, valid: 0 }; }
  },
  async forceCleanup() {
  if (get(isCleaning)) { console.log('⏳ Cleanup already in progress'); return { status: 'already_running' }; }
  isCleaning.set(true);
  uploadStatus.set('🤖 AI ANALYZING STORAGE...');
  try {
  const result = await this.performIntelligentCleanup();
  const healthAfter = result.healthAfter?.score || '??';
  const actionsCount = result.actions?.length || 0;
  uploadStatus.set(`✅ AI CLEANUP: ${actionsCount} actions, ${healthAfter}% health`);
  lastAiCleanup.set({ ...result, forced: true, timestamp: new Date().toISOString() });
  storageHealth.set(this.calculateHealthScore());
  return result;
  } catch (error) {
  console.error('🤖 Force cleanup failed:', error);
  uploadStatus.set('❌ CLEANUP FAILED: ' + error.message);
  lastAiCleanup.set({ error: error.message, actions: [], timestamp: new Date().toISOString(), healthAfter: { score: 0, issues: [error.message] } });
  return { error: error.message };
  } finally {
  resourceManager.setTimeout(() => { isCleaning.set(false); resourceManager.setTimeout(() => uploadStatus.set('Standby'), 3000); }, 500);
  }
  },
  async performIntelligentCleanup() {
  const startTime = performance.now();
  const report = { timestamp: new Date().toISOString(), actions: [], freedSpace: 0, healthBefore: this.calculateHealthScore(), healthAfter: null, errors: [] };
  try {
  const blobCount = resourceManager.blobUrls.size;
  if (blobCount > 0) { resourceManager.cleanupAllBlobs(); report.actions.push(`Released ${blobCount} expired blob URLs`); report.freedSpace += blobCount * 1024 * 1024; }
  const vault = JSON.parse((typeof window !== 'undefined' ? localStorage.getItem(CONFIG.VAULT_KEY) : null) || '[]');
  const now = Date.now();
  const validEntries = vault.filter((reel) => { const age = now - new Date(reel.createdAt || reel.created_at || 0).getTime(); const hasValidVideo = reel.type !== 'video' || this.validateVideoReference(reel); const hasValidThumb = this.validateThumbnailReference(reel); const isAccessedRecently = this.wasAccessedRecently(reel.id); return isAccessedRecently || (hasValidVideo && hasValidThumb) || (age < this.config.maxVaultAge && hasValidVideo); });
  if (validEntries.length < vault.length) { storageSet(CONFIG.VAULT_KEY, validEntries); report.actions.push(`Archived ${vault.length - validEntries.length} stale records`); report.freedSpace += (vault.length - validEntries.length) * 2 * 1024; }
  const titles = JSON.parse((typeof window !== 'undefined' ? localStorage.getItem(CONFIG.TITLES_KEY) : null) || '{}');
  const validIds = new Set(validEntries.map((r) => r.id));
  let orphanedTitles = 0;
  Object.keys(titles).forEach((id) => { if (!validIds.has(id)) { delete titles[id]; orphanedTitles++; } });
  if (orphanedTitles > 0) { storageSet(CONFIG.TITLES_KEY, titles); report.actions.push(`Removed ${orphanedTitles} orphaned title entries`); }
  feed.update((currentFeed) => { const newFeed = {}; Object.keys(currentFeed).forEach((cat) => { newFeed[cat] = currentFeed[cat].filter((r) => !r.id || validIds.has(r.id) || r.isPlaceholder || r._localModified); }); return newFeed; });
  if (!isStorageFull()) {
  this.syncThumbnailsToFeed();
  this.syncVideoVaultToFeed();
  } else {
  uploadStatus.set('Storage full, clear data to continue');
  }
  report.healthAfter = this.calculateHealthScore();
  report.duration = `${(performance.now() - startTime).toFixed(1)}ms`;
  storageSet('last_ai_cleanup_report', report);
  return report;
  } catch (error) { console.error('AI Cleanup failed:', error); report.errors.push(error.message); report.healthAfter = this.calculateHealthScore(); return report; }
  },
  validateVideoReference(urlOrReel) {
  const url = typeof urlOrReel === 'object' ? urlOrReel?.url : urlOrReel;
  if (!url) return false;
  if (url.startsWith('blob:')) return false;
  if (url.startsWith('data:')) return true;
  if (url.startsWith('http')) return true;
  const videoCollection = get(personalVideoCollection);
  return videoCollection.includes(url) || ['.mp4', '.mov', '.MOV'].some((ext) => url.includes(ext));
  },
  validateThumbnailReference(urlOrReel) {
  const url = typeof urlOrReel === 'object' ? (urlOrReel?.thumbnailUrl || urlOrReel?.url) : urlOrReel;
  if (!url) return false;
  if (url.startsWith('data:')) return true;
  if (url.startsWith('blob:')) return false;
  if (url.startsWith('http')) return true;
  if (url.startsWith('/')) return true;
  const thumbCollection = get(personalThumbnailCollection);
  return thumbCollection.some((t) => url?.includes(t) || t === url);
  },
  wasAccessedRecently(reelId) {
  const recent = JSON.parse((typeof window !== 'undefined' ? localStorage.getItem(CONFIG.RECENTLY_VIEWED_KEY) : null) || '[]');
  const entry = recent?.find((r) => r && r.id === reelId);
  if (!entry) return false;
  const hoursSince = (Date.now() - entry.timestamp) / (1000 * 60 * 60);
  return hoursSince < 48;
  },
  recordAccess(reelId) {
  const recent = JSON.parse((typeof window !== 'undefined' ? localStorage.getItem(CONFIG.RECENTLY_VIEWED_KEY) : null) || '[]');
  const existing = recent.findIndex((r) => r.id === reelId);
  if (existing >= 0) { recent[existing].timestamp = Date.now(); recent[existing].count = (recent[existing].count || 0) + 1; } else { recent.push({ id: reelId, timestamp: Date.now(), count: 1 }); }
  if (recent.length > CONFIG.MAX_RECENT_ITEMS) recent.shift();
  storageSet(CONFIG.RECENTLY_VIEWED_KEY, recent);
  },
  setMaintenanceMode(enabled) { aiMaintenanceMode.set(enabled); uploadStatus.set(enabled ? '🤖 AI AUTO-MAINTENANCE ENABLED' : '🤖 AI MAINTENANCE PAUSED'); resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000); },
  distributeVideoToFeed(videoData) {
  if (isHeroAsset(videoData)) return;
  const state = String(videoData?.uploadState || '');
  if (
    state === 'failed' ||
    state === 'interrupted' ||
    state === 'pending_accept' ||
    state === 'uploading' ||
    videoData?.isOptimisticLocal
  ) {
    console.info('[FEED_DISTRIBUTE_SKIP]', {
      reason: 'non_ready_vault_entry',
      id: String(videoData?.id || ''),
      uploadState: state || null,
      ts: new Date().toISOString()
    });
    return;
  }
  const playableUrl = String(videoData?.url || videoData?.video_url || '').trim();
  if (!playableUrl || playableUrl.startsWith('blob:') || playableUrl.startsWith('data:')) {
    console.info('[FEED_DISTRIBUTE_SKIP]', {
      reason: 'missing_playable_url',
      id: String(videoData?.id || ''),
      ts: new Date().toISOString()
    });
    return;
  }
  const categoriesList = ['Trending', 'Romance', 'Cyber-Action', 'Suspense'];
  const stem = String(videoData.name || videoData.title || '').replace(/\.[^/.]+$/, '');
  const hydrated = hydrateCatalogItemWithCreatorMetadata({
    id: String(videoData.id || ''),
    title: stem,
    name: stem,
    fileName: videoData.fileName || videoData.name || '',
    description: videoData.description || '',
    tags: videoData.tags || [],
    category: videoData.category || 'Trending',
    type: 'video',
    url: videoData.url
  });
  const classified = classifyContent(
    applyCatalogMetadata(hydrated, resolveCatalogMetadata(hydrated))
  );
  const detectedCategory = classified.primaryCategory || CATEGORY_DETECTOR.detectFromTitle(stem);
  const primaryCategory = categoriesList.includes(detectedCategory) ? detectedCategory : 'Trending';
  const probe = {
    id: String(videoData.id || ''),
    personal_video_id: String(videoData.id || videoData.personal_video_id || ''),
    url: playableUrl,
    type: 'video'
  };

  feed.update((currentFeed) => {
  let newFeed = { ...currentFeed };
  categoriesList.forEach((cat) => {
    if (!newFeed[cat]) newFeed[cat] = [];
  });

  // Drop true placeholder slots that pointed at this identity (not real catalog twins).
  categoriesList.forEach((cat) => {
    const before = newFeed[cat] || [];
    const removedPlaceholders = before.filter(
      (r) =>
        r?.isPlaceholder &&
        matchCanonicalFeedIdentity(r, probe)
    );
    if (removedPlaceholders.length > 0) {
      removedPlaceholders.forEach((old) => {
        pipelineCheckpoint('PLACEHOLDER_REPLACED', {
          oldId: old.id,
          newId: String(videoData.id),
          vault: 'mp4'
        });
      });
      newFeed[cat] = before.filter(
        (r) => !(r?.isPlaceholder && matchCanonicalFeedIdentity(r, probe))
      );
    }
  });

  const existingMatch = findCanonicalFeedMatch(newFeed, probe);
  const vaultPlaybackUrl = String(videoData?.playbackUrl || videoData?.playback_url || '').trim();
  const vaultPlaybackStatus = String(
    videoData?.playbackStatus || videoData?.playback_status || ''
  ).trim();
  const relativeUrl = toRelativeMediaPath(String(videoData.url || '')) || String(videoData.url || '');
  const relativeThumb = (() => {
    const durable = resolveDurableViewerPoster(videoData, videoData);
    if (durable) return durable;
    const raw = String(videoData.thumbnail || '').trim();
    if (!raw || raw.startsWith('blob:') || raw.startsWith('data:')) return '';
    return toRelativeMediaPath(raw) || raw;
  })();

  let persistentEntry = null;
  try {
    const titles = JSON.parse(localStorage.getItem(CONFIG.TITLES_STORAGE_KEY) || '{}');
    persistentEntry = resolvePersistentTitleForMedia(
      titles,
      [videoData, existingMatch?.reel],
      CONFIG.VIDEO_VAULT_KEY
    );
  } catch {
    persistentEntry = null;
  }

  const protectedTitle = resolveProtectedFeedTitle({
    existing: existingMatch?.reel || null,
    persistent: persistentEntry,
    catalogTitle: String(videoData.title || '').replace(/\.[^/.]+$/, '') || '',
    filenameFallback: stem
  });

  if (existingMatch) {
    // Phase 6.6.2 — upsert: update existing canonical row; never insert a twin.
    const prev = existingMatch.reel;
    const merged = {
      ...prev,
      id: String(prev.id || videoData.id),
      personal_video_id: String(prev.personal_video_id || videoData.id),
      isPersonalVideo: true,
      isPlaceholder: false,
      type: 'video',
      url: relativeUrl || prev.url,
      thumbnailUrl: relativeThumb || prev.thumbnailUrl || prev.posterUrl || '',
      posterUrl: relativeThumb || prev.posterUrl || prev.thumbnailUrl || '',
      category: existingMatch.shelf || primaryCategory,
      title: protectedTitle.title || prev.title || stem,
      name: protectedTitle.title || prev.name || stem,
      title_original: protectedTitle.title_original || prev.title_original || protectedTitle.title,
      _localModified: protectedTitle.protected || Boolean(prev._localModified),
      ...(vaultPlaybackUrl ? { playbackUrl: vaultPlaybackUrl } : {}),
      ...(vaultPlaybackStatus ? { playbackStatus: vaultPlaybackStatus } : {})
    };
    if (!merged.playbackUrl || String(merged.playbackStatus || '').toLowerCase() !== 'ready') {
      const u = String(prev.playbackUrl || prev.playback_url || '').trim();
      const s = String(prev.playbackStatus || prev.playback_status || '').trim();
      if (u) merged.playbackUrl = merged.playbackUrl || u;
      if (s) merged.playbackStatus = merged.playbackStatus || s;
    }

    // Remove all identity matches (including same-shelf twins), then place one updated row.
    const stripped = removeCanonicalFeedMatches(newFeed, probe);
    newFeed = stripped.feedMap;
    const shelf = existingMatch.shelf || primaryCategory;
    if (!newFeed[shelf]) newFeed[shelf] = [];
    newFeed[shelf] = [merged, ...(newFeed[shelf] || [])];
    ensureVideoOnTrendingShelf(newFeed, merged);

    console.info('[CANONICAL_FEED_UPSERT]', {
      stage: 'AI_CLEANUP_AGENT.distributeVideoToFeed',
      action: 'update',
      id: String(videoData?.id || ''),
      shelf,
      removedTwins: stripped.removed,
      normalizedUrl: normalizeMediaUrl(relativeUrl),
      titleSource: protectedTitle.source,
      ts: new Date().toISOString()
    });
    return newFeed;
  }

  const reel = {
  ...createLocalReel({
  id: String(videoData.id),
  name: protectedTitle.title || stem,
  title: protectedTitle.title || stem,
  type: 'video',
  url: relativeUrl,
  thumbnailUrl: relativeThumb,
  category: primaryCategory,
  isPlaceholder: false,
  isPersonalVideo: true,
  personal_video_id: videoData.id,
  likes: Math.floor(Math.random() * 200) + 50,
  views: Math.floor(Math.random() * 1000) + 100,
  match: '🎬 PRIMARY',
  auto_detected: true,
  detection_confidence: 'High',
  createdAt: videoData.addedAt || new Date().toISOString(),
  ...(vaultPlaybackUrl ? { playbackUrl: vaultPlaybackUrl } : {}),
  ...(vaultPlaybackStatus ? { playbackStatus: vaultPlaybackStatus } : {})
  })
  };
  if (protectedTitle.protected) {
    reel.title_original = protectedTitle.title_original || protectedTitle.title;
    reel._localModified = true;
  } else {
    reel.title_original = protectedTitle.title_original || protectedTitle.title || stem;
  }

  // Inherit ready playback fields from any prior non-canonical leftovers.
  if (!reel.playbackUrl || String(reel.playbackStatus || '').toLowerCase() !== 'ready') {
    let inheritedUrl = '';
    let inheritedStatus = '';
    for (const cat of categoriesList) {
      for (const existing of currentFeed[cat] || []) {
        if (!existing || !matchCanonicalFeedIdentity(existing, probe)) continue;
        const u = String(existing.playbackUrl || existing.playback_url || '').trim();
        const s = String(existing.playbackStatus || existing.playback_status || '').trim();
        if (u && s.toLowerCase() === 'ready') {
          inheritedUrl = u;
          inheritedStatus = s;
          break;
        }
        if (!inheritedUrl && u) inheritedUrl = u;
        if (!inheritedStatus && s) inheritedStatus = s;
      }
      if (inheritedUrl && String(inheritedStatus).toLowerCase() === 'ready') break;
    }
    if (inheritedUrl) reel.playbackUrl = reel.playbackUrl || inheritedUrl;
    if (inheritedStatus) reel.playbackStatus = reel.playbackStatus || inheritedStatus;
  }

  console.info('[CANONICAL_FEED_UPSERT]', {
    stage: 'AI_CLEANUP_AGENT.distributeVideoToFeed',
    action: 'insert',
    id: String(videoData?.id || ''),
    shelf: primaryCategory,
    normalizedUrl: normalizeMediaUrl(relativeUrl),
    titleSource: protectedTitle.source,
    ts: new Date().toISOString()
  });
  console.info('[HERO_ROUTE]', {
  stage: 'AI_CLEANUP_AGENT.distributeVideoToFeed',
  id: String(videoData?.id || ''),
  url: String(videoData?.url || ''),
  mime: String(videoData?.type || ''),
  destination: `feed:${primaryCategory}`,
  ts: new Date().toISOString()
  });
  newFeed[primaryCategory].unshift(reel);
  ensureVideoOnTrendingShelf(newFeed, reel);
  return newFeed;
  });
  // Force UI refresh and persist feed
  feed.update(f => ({ ...f }));
  storageSet(CONFIG.FEED_STORAGE_KEY, get(feed));
  },
  /** Re-apply reel_titles_persistent (+ Phase 17 creator catalog fields) onto feed cards. */
  applyPersistedTitlesOverlay() {
    try {
      const titles = JSON.parse(
        (typeof window !== 'undefined' ? localStorage.getItem(CONFIG.TITLES_STORAGE_KEY) : null) || '{}'
      );
      if (!titles || typeof titles !== 'object') return;
      const ids = Object.keys(titles).filter((id) => {
        const entry = titles[id];
        if (!entry || typeof entry !== 'object') return false;
        return Boolean(
          entry.title ||
            entry.description ||
            entry.category ||
            entry.creatorCategory ||
            (Array.isArray(entry.tags) && entry.tags.length) ||
            // Phase 19: authored-empty description/tags/category still require overlay
            Object.prototype.hasOwnProperty.call(entry, 'description') ||
            Object.prototype.hasOwnProperty.call(entry, 'tags') ||
            Object.prototype.hasOwnProperty.call(entry, 'category') ||
            Object.prototype.hasOwnProperty.call(entry, 'creatorCategory')
        );
      });
      if (!ids.length) return;
      const shelves = ['Trending', 'Romance', 'Cyber-Action', 'Suspense'];
      feed.update((current) => {
        /** @type {Map<string, Record<string, unknown>>} */
        const byId = new Map();
        for (const cat of Object.keys(current || {})) {
          for (const item of current[cat] || []) {
            if (!item || item.isPlaceholder) continue;
            const id = String(item.id || item.personal_video_id || '').trim();
            if (!id || byId.has(id)) continue;
            byId.set(id, item);
          }
        }
        /** @type {Record<string, Array<Record<string, unknown>>>} */
        const next = { Trending: [], Romance: [], 'Cyber-Action': [], Suspense: [] };
        for (const cat of Object.keys(current || {})) {
          if (!next[cat]) next[cat] = [];
        }
        const titleByPlayback = new Map();
        seedPlaybackTitleMap(titles, titleByPlayback, CONFIG.VIDEO_VAULT_KEY);
        for (const item of byId.values()) {
          const seeded = lookupPersistentTitleEntry(titles, item);
          const play = mediaRecordPlaybackKey(item);
          if (seeded?.title && play && !titleByPlayback.has(play)) {
            titleByPlayback.set(play, seeded);
          }
        }
        for (const item of byId.values()) {
          const saved =
            lookupPersistentTitleEntry(titles, item) ||
            titleByPlayback.get(mediaRecordPlaybackKey(item)) ||
            null;
          let card = { ...item };
          if (saved?.title && !isUnsafeViewerCardTitle(saved.title)) {
            card.title = saved.title;
            card.name = saved.title;
            card.title_original = saved.title_original || saved.title;
            card._localModified = true;
          } else if (item.isPersonalThumbnail) {
            card.title = '';
            card.name = '';
          }
          // Phase 19: authored-empty description clears stale live evidence (not "no update").
          if (saved && Object.prototype.hasOwnProperty.call(saved, 'description')) {
            const desc = String(saved.description || '').trim();
            card.description = desc;
            if (desc) {
              card.enrichmentDescription = desc;
            } else {
              delete card.enrichmentDescription;
              delete card.heroDescription;
              delete card.episodeDescription;
            }
          }
          // Phase 19: authored-empty tags clear stale live evidence.
          if (saved && Object.prototype.hasOwnProperty.call(saved, 'tags')) {
            const tags = Array.isArray(saved.tags)
              ? saved.tags.map((t) => String(t || '').trim()).filter(Boolean)
              : String(saved.tags || '')
                  .split(/[,|]/)
                  .map((t) => t.trim())
                  .filter(Boolean);
            card.tags = tags;
            if (!tags.length) {
              delete card.ai_tags;
              delete card.keywords;
              delete card.discoveryTags;
            }
          }
          // Phase 18: if primary titles map has no explicit creator shelf, drop stale
          // creatorCategory from the live card before hydrate/classify.
          if (
            saved &&
            (Object.prototype.hasOwnProperty.call(saved, 'category') ||
              Object.prototype.hasOwnProperty.call(saved, 'creatorCategory')) &&
            !String(saved.category || saved.creatorCategory || '').trim()
          ) {
            delete card.creatorCategory;
            delete card.explicitCategory;
            if (
              String(card.categorySource || '') === 'creator' ||
              String(card.categorySource || '') === 'existing-category'
            ) {
              delete card.categorySource;
            }
            const soft = String(card.category || card.shelfCategory || '').trim();
            if (soft === 'Romance' || soft === 'Suspense' || soft === 'Cyber-Action') {
              card.category = 'Trending';
              delete card.shelfCategory;
            }
          }
          card = hydrateCatalogItemWithCreatorMetadata(card);
          const meta = resolveCatalogMetadata(card);
          const enriched = applyCatalogMetadata(card, meta);
          const classification = classifyContent(enriched);
          const primary = shelves.includes(classification.primaryCategory)
            ? classification.primaryCategory
            : 'Trending';
          card = {
            ...enriched,
            category: primary,
            categories: classification.categories,
            categoryConfidence: classification.confidence,
            classificationSource: classification.classificationSource,
            classificationSignals: classification.signals
          };
          if (!next[primary]) next[primary] = [];
          next[primary].push(card);
          // Discovery: also keep a reference on Trending when primary is a genre shelf.
          if (primary !== 'Trending') {
            const already = next.Trending.some((c) => String(c.id) === String(card.id));
            if (!already) next.Trending.push(card);
          }
        }
        return next;
      });
      storageSet(CONFIG.FEED_STORAGE_KEY, get(feed));
      // Same map must win over harvested catalog name on Video Vault rows after sync/rebuild.
      personalVideos.update((videos) => {
        const list = Array.isArray(videos) ? videos : [];
        let changed = false;
        const next = list.map((item) => {
          const id = String(item?.id || item?.personal_video_id || '').trim();
          const saved = id ? titles[id] : null;
          if (!saved?.title && !saved?.description && !(Array.isArray(saved?.tags) && saved.tags.length)) {
            return item;
          }
          changed = true;
          return {
            ...item,
            ...(saved?.title
              ? {
                  title: saved.title,
                  name: saved.title,
                  title_original: saved.title_original || saved.title,
                  _localModified: true
                }
              : {}),
            ...(saved?.description ? { description: saved.description } : {}),
            ...(Array.isArray(saved?.tags) && saved.tags.length ? { tags: saved.tags } : {})
          };
        });
        if (!changed) return list;
        try {
          storageSet(CONFIG.VIDEO_VAULT_KEY, next);
        } catch {
          /* ignore */
        }
        return next;
      });
    } catch {
      /* ignore */
    }
  },
  syncVideoVaultToFeed() {
  const videos = JSON.parse((typeof window !== 'undefined' ? localStorage.getItem(CONFIG.VIDEO_VAULT_KEY) : null) || '[]');
  const nonHeroVideos = filterOutDeletedMedia(filterNonHeroAssets(videos));
  console.info('[HERO_STORE_READ]', {
  stage: 'AI_CLEANUP_AGENT.syncVideoVaultToFeed',
  key: CONFIG.VIDEO_VAULT_KEY,
  count: Array.isArray(nonHeroVideos) ? nonHeroVideos.length : 0,
  ts: new Date().toISOString()
  });
  nonHeroVideos.forEach((v) => this.distributeVideoToFeed(v));
  this.applyPersistedTitlesOverlay();
  },
  distributeThumbnailAcrossCategories(thumbnailName, base64Data, reelId = '') {
  if (isHeroAsset({ id: reelId || thumbnailName, name: thumbnailName, url: base64Data, thumbnail: base64Data })) return;
  const categoriesList = ['Trending', 'Romance', 'Cyber-Action', 'Suspense'];
  const detectedCategory = CATEGORY_DETECTOR.detectFromTitle(String(thumbnailName || '').replace(/\.[^/.]+$/, ''));
  const primaryCategory = categoriesList.includes(detectedCategory) ? detectedCategory : 'Trending';
  const canonicalId = String(reelId || '').trim();
  feed.update((currentFeed) => {
  const newFeed = { ...currentFeed };
  categoriesList.forEach((cat) => {
  if (!newFeed[cat]) newFeed[cat] = [];
  // Keep a single source card per thumbnail across the full feed.
  newFeed[cat] = newFeed[cat].filter((r) => !(r.isPersonalThumbnail && r.personal_thumbnail === thumbnailName));
  if (canonicalId) {
    newFeed[cat] = newFeed[cat].filter(
      (r) => !(r.isPersonalThumbnail && (String(r.id || '') === `personal-thumb-${canonicalId}` || String(r.id || '') === canonicalId))
    );
  }
  });
  // Catalog image cards (buildHomeFeed + vault membership) own the reel id path.
  const thumbProbe = {
    id: canonicalId,
    fileName: thumbnailName,
    title: thumbnailName,
    name: thumbnailName,
    url: base64Data,
    type: 'image',
    isPersonalThumbnail: true,
    publishableImage: true
  };
  if (!shouldSynthesizePersonalThumbnailFeedCard(thumbProbe, newFeed)) {
    return newFeed;
  }
  // Phase 6.5 — personal thumbnails are poster artwork, not discovery cards.
  const discovery = evaluateViewerImageDiscoveryEligibility(thumbProbe);
  if (!discovery.allow) {
    console.info('[PERSONAL_THUMBNAIL_SKIP_DISCOVERY]', {
      stage: 'AI_CLEANUP_AGENT.distributeThumbnailAcrossCategories',
      reason: discovery.reason,
      thumbnailName,
      reelId: canonicalId,
      ts: new Date().toISOString()
    });
    const still = durableImageVaultUrl(
      { id: canonicalId, url: base64Data, fileName: thumbnailName },
      { id: canonicalId, url: base64Data, fileName: thumbnailName }
    ) || base64Data;
    attachVaultStillToFeedMap(newFeed, categoriesList, still, canonicalId);
    return newFeed;
  }
  const placeholder = createLocalReel({
  id: canonicalId ? `personal-thumb-${canonicalId}` : `personal-thumb-${thumbnailName}`,
  name: '',
  title: '',
  category: primaryCategory,
  type: 'image',
  url: base64Data,
  thumbnailUrl: base64Data,
  isPlaceholder: false,
  isPersonalThumbnail: true,
  personal_thumbnail: thumbnailName,
  publishableImage: true,
  ...(canonicalId ? { assetId: canonicalId } : {}),
  likes: Math.floor(Math.random() * 100) + 50,
  views: Math.floor(Math.random() * 500) + 100,
  match: 'PERSONAL THUMBNAIL',
  ai_tags: ['personal-thumbnail', 'user-uploaded']
  });
  console.info('[PERSONAL_THUMBNAIL_INSERT]', {
  stage: 'AI_CLEANUP_AGENT.distributeThumbnailAcrossCategories',
  placeholderId: placeholder.id,
  thumbnailName: String(thumbnailName || ''),
  reelId: canonicalId || null,
  destination: `feed:${primaryCategory}`,
  ts: new Date().toISOString()
  });
  newFeed[primaryCategory].unshift(placeholder);
  return newFeed;
  });
  storageSet(CONFIG.FEED_STORAGE_KEY, get(feed));
  uploadStatus.set('🤖 AI: Thumbnail synced to feed');
  resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
  },
  removeThumbnailFromCategories(thumbnailName) {
  if (!thumbnailName) return;
  feed.update((currentFeed) => { const newFeed = {}; Object.keys(currentFeed).forEach((cat) => { newFeed[cat] = currentFeed[cat].filter((r) => !(r.isPersonalThumbnail && r.personal_thumbnail === thumbnailName)); }); return newFeed; });
  storageSet(CONFIG.FEED_STORAGE_KEY, get(feed));
  },
  syncThumbnailsToFeed() {
  if (isStorageFull()) {
  console.warn('[storage] syncThumbnailsToFeed skipped — storage full');
  uploadStatus.set('Storage full, clear data to continue');
  return false;
  }
  const storedThumbs = JSON.parse((typeof window !== 'undefined' ? localStorage.getItem(CONFIG.THUMBNAIL_STORAGE_KEY) : null) || '[]');
  if (!storedThumbs || !Array.isArray(storedThumbs) || storedThumbs.length === 0) return true;
  const prevFeed = get(feed);
  const prevPlaceholders = Object.values(prevFeed).flat().filter((r) => r?.isPersonalThumbnail).length;
  const categoriesList = ['Trending', 'Romance', 'Cyber-Action', 'Suspense'];
  feed.update((currentFeed) => {
  const newFeed = { ...currentFeed };
  categoriesList.forEach((cat) => { if (!newFeed[cat]) newFeed[cat] = []; });
  // Remove stale personal thumbnail cards and rebuild from authoritative thumbnail store.
  categoriesList.forEach((cat) => {
  newFeed[cat] = (newFeed[cat] || []).filter((r) => !r?.isPersonalThumbnail);
  });
  storedThumbs.forEach((thumb, thumbIndex) => {
  if (!thumb) return;
  const thumbKey =
  typeof thumb === 'string'
  ? thumb
  : String(thumb.fileName || thumb.file_name || '').trim() || filenameFromMediaRef(thumb.url);
  const thumbAddedAt = typeof thumb === 'string' ? new Date().toISOString() : thumb.addedAt;
  if (typeof thumb === 'string') {
  if (isHeroAsset({ id: thumb, name: thumb, url: thumb, thumbnail: thumb })) return;
  } else {
  if (!thumbKey) return;
  if (isHeroAsset(thumb)) return;
  }
  const rawThumbUrl = typeof thumb === 'string' ? '' : String(thumb.url || '').trim();
  const fileKey = thumbKey;
  const thumbUrl =
    durableImageVaultUrl(
      typeof thumb === 'object' ? thumb : { fileName: fileKey, url: rawThumbUrl },
      typeof thumb === 'object' ? thumb : { fileName: fileKey, url: rawThumbUrl }
    ) ||
    (rawThumbUrl.startsWith('/thumbs/') ? rawThumbUrl : '') ||
    (fileKey && /^[0-9a-f]{8}-/i.test(fileKey) ? `/thumbs/${fileKey.replace(/^thumbs\//, '')}` : '');
  if (!thumbUrl) return;
  // Prefer catalog-owned image card (same reel id) when present — do not inject a second
  // synthetic personal-thumb-* representation for the same canonical asset.
  if (!shouldSynthesizePersonalThumbnailFeedCard(thumb, newFeed)) {
    console.info('[PERSONAL_THUMBNAIL_SKIP_DUAL]', {
      stage: 'AI_CLEANUP_AGENT.syncThumbnailsToFeed',
      reason: 'catalog_card_owns_canonical_id',
      reelId: typeof thumb === 'object' ? String(thumb.id || '') : '',
      thumbnailName: fileKey,
      ts: new Date().toISOString()
    });
    return;
  }
  const displayLabel = typeof thumb === 'string' ? thumb : String(thumb.title || thumb.name || fileKey);
  const linkedVideoId =
    typeof thumb === 'object' ? String(thumb.personal_video_id || '').trim() : '';
  const thumbProbe = {
    id: typeof thumb === 'object' ? String(thumb.id || '') : '',
    title: displayLabel,
    name: displayLabel,
    fileName: fileKey,
    url: thumbUrl,
    type: 'image',
    isPersonalThumbnail: true,
    publishableImage: true,
    ...(linkedVideoId ? { personal_video_id: linkedVideoId } : {})
  };
  // Vault stills stay on Trending as image cards; also stamp linked video posters.
  const discovery = evaluateViewerImageDiscoveryEligibility(thumbProbe);
  if (!discovery.allow) {
    const linkedId = linkedVideoId;
    attachVaultStillToFeedMap(newFeed, categoriesList, thumbUrl, linkedId);
    console.info('[PERSONAL_THUMBNAIL_SKIP_DISCOVERY]', {
      stage: 'AI_CLEANUP_AGENT.syncThumbnailsToFeed',
      reason: discovery.reason,
      thumbnailName: fileKey,
      linkedId,
      posterUrl: thumbUrl,
      ts: new Date().toISOString()
    });
    return;
  }
  const primaryCategory = 'Trending';
  attachVaultStillToFeedMap(newFeed, categoriesList, thumbUrl, linkedVideoId);
  const vaultStillId =
    typeof thumb === 'object' && thumb.id
      ? `personal-thumb-vault-${thumb.id}`
      : `personal-thumb-${fileKey}`;
  const placeholder = createLocalReel({ id: vaultStillId, name: '', title: '', category: 'Trending', type: 'image', url: thumbUrl, thumbnailUrl: thumbUrl, posterUrl: thumbUrl, isPlaceholder: false, isPersonalThumbnail: true, personal_thumbnail: fileKey, publishableImage: true, likes: Math.floor(Math.random() * 100) + 50, views: Math.floor(Math.random() * 500) + 100, match: 'PERSONAL THUMBNAIL', ai_tags: ['personal-thumbnail', 'user-uploaded'], createdAt: thumbAddedAt || new Date().toISOString() });
  console.info('[PERSONAL_THUMBNAIL_INSERT]', {
  stage: 'AI_CLEANUP_AGENT.syncThumbnailsToFeed',
  placeholderId: placeholder.id,
  thumbnailName: fileKey,
  destination: `feed:${primaryCategory}`,
  ts: new Date().toISOString()
  });
  newFeed[primaryCategory].push(placeholder);
  });
  return newFeed;
  });
  const nextFeed = get(feed);
  const nextPlaceholders = Object.values(nextFeed).flat().filter((r) => r?.isPersonalThumbnail).length;
  traceThumbStoreWrite('syncThumbnailsToFeed', 'reelforge_feed', prevPlaceholders, nextPlaceholders, {
    storedThumbCount: storedThumbs.length,
    first3: storedThumbs.slice(0, 3)
  });
  if (wouldExceedQuota(CONFIG.FEED_STORAGE_KEY, nextFeed)) {
  console.warn('[storage] syncThumbnailsToFeed aborted — projected feed exceeds quota');
  uploadStatus.set('Storage full, clear data to continue');
  return false;
  }
  const result = storageSet(CONFIG.FEED_STORAGE_KEY, nextFeed);
  if (!result.ok) {
  uploadStatus.set('Storage full, clear data to continue');
  return false;
  }
  this.applyPersistedTitlesOverlay();
  return true;
  },
  async handleThumbnailRemove(index) {
  const collection = get(personalThumbnailCollection);
  if (!collection || index < 0 || index >= collection.length) { console.warn('⚠️ [THUMB DELETE] Invalid index or empty collection'); return; }
  const thumbnailKey = collection[index];
  if (!thumbnailKey) { console.warn('⚠️ [THUMB DELETE] No thumbnail name at index', index); return; }
  const stored = readThumbnailVault(CONFIG.THUMBNAIL_STORAGE_KEY);
  const keyStr = typeof thumbnailKey === 'string'
    ? String(thumbnailKey).trim()
    : String(thumbnailKey?.fileName || thumbnailKey?.file_name || thumbnailKey?.id || '').trim();
  const entry = stored.find((candidate) => {
    if (!candidate) return false;
    if (typeof candidate === 'string') {
      const raw = String(candidate).trim();
      return raw === keyStr || filenameFromMediaRef(raw) === keyStr;
    }
    const id = String(candidate.id || '').trim();
    const fileName = String(candidate.fileName || candidate.file_name || '').trim();
    const urlName = filenameFromMediaRef(candidate.url || candidate.thumbnailUrl || '');
    if (typeof thumbnailKey === 'object' && thumbnailKey) {
      const objId = String(thumbnailKey.id || '').trim();
      const objFile = String(thumbnailKey.fileName || thumbnailKey.file_name || '').trim();
      if (objId && objId === id) return true;
      if (objFile && (objFile === fileName || objFile === urlName)) return true;
    }
    return keyStr === id || keyStr === fileName || keyStr === urlName;
  });
  const reelId = entry && typeof entry === 'object' ? String(entry.id || '').trim() : (typeof thumbnailKey === 'object' ? String(thumbnailKey.id || '').trim() : '');
  const fileKey =
    (entry && typeof entry === 'object'
      ? String(entry.fileName || entry.file_name || '').trim() || filenameFromMediaRef(entry.url || '')
      : '') ||
    (typeof thumbnailKey === 'string' ? keyStr : '') ||
    filenameFromMediaRef(typeof thumbnailKey === 'object' ? thumbnailKey.url : '') ||
    keyStr;
  console.info('[DELETE_HANDLER_FIRED]', {
  mechanism: 'single',
  vault: 'thumbnail-vault',
  itemId: reelId || String(fileKey || thumbnailKey),
  itemName: String(fileKey || thumbnailKey),
  timestamp: Date.now()
  });
  console.info('[DELETE_CONFIRMATION_SHOWN]', {
  mechanism: 'single',
  vault: 'thumbnail-vault',
  itemId: reelId || String(fileKey || thumbnailKey),
  itemName: String(fileKey || thumbnailKey),
  timestamp: Date.now()
  });
  if (!confirm(`Delete thumbnail "${fileKey || thumbnailKey}" permanently?`)) return;
  console.info('[DELETE_CONFIRMED]', {
  mechanism: 'single',
  vault: 'thumbnail-vault',
  itemId: reelId || String(fileKey || thumbnailKey),
  timestamp: Date.now()
  });
  uploadStatus.set(`🗑️ Deleting ${fileKey || thumbnailKey}...`);
  vaultForensic('VAULT_DELETE_START', {
    vaultType: 'thumbnail',
    assetId: reelId || String(fileKey || thumbnailKey),
    fileName: String(fileKey || thumbnailKey),
    storageLocation: CONFIG.THUMBNAIL_STORAGE_KEY,
    backendEndpoint: `${CONFIG?.API_BASE_URL || ''}/api/reels`,
    result: 'delete_start'
  });
  try {
  const beforeCount = collection.length;
  const token = getAdminToken();
  let persistenceSuccess = false;
  let deletedReelId = reelId;
  if (!token) {
    uploadStatus.set('🔐 Studio login required — open Studio, sign in, then retry delete');
    resourceManager.setTimeout(() => uploadStatus.set('Standby'), 5000);
    return;
  }
  console.log(`🗑️ [THUMB DELETE] Calling backend API for: ${reelId || fileKey || thumbnailKey}`);
  try {
  if (reelId) {
  await deleteReelById(reelId, this.authHeaders());
  persistenceSuccess = true;
  applyCanonicalDeleteClientEffects(
    { purge: runClientMediaPurge },
    { reelId, videoUrl: entry?.url || entry?.thumbnailUrl }
  );
  } else {
  const reels = await fetchReadyReels(this.authHeaders());
  const imageReel = reels.find((reel) => {
  const type = String(reel?.type || '').toLowerCase();
  if (!(type === 'image' || String(reel?.url || '').includes('/thumbs/'))) return false;
  const byThumb = this.mediaBasename(reel?.thumbnailUrl || reel?.thumbnail_url || reel?.url);
  const byFile = this.mediaBasename(reel?.fileName || reel?.file_name || '');
  return byThumb === fileKey || byFile === fileKey || byThumb === keyStr || byFile === keyStr;
  });
  if (imageReel?.id) {
  deletedReelId = String(imageReel.id);
  await deleteReelById(imageReel.id, this.authHeaders());
  persistenceSuccess = true;
  applyCanonicalDeleteClientEffects(
    { purge: runClientMediaPurge },
    { reelId: imageReel.id, videoUrl: imageReel?.url || imageReel?.thumbnailUrl }
  );
  } else if (fileKey) {
  await deleteMediaFile(fileKey, this.authHeaders());
  persistenceSuccess = true;
  }
  }
  console.log(`✅ [THUMB DELETE] Backend deletion successful: ${deletedReelId || fileKey || thumbnailKey}`);
  } catch (apiError) { console.warn('⚠️ [THUMB DELETE] Backend API call failed:', apiError); }
  const imageReels = persistenceSuccess
    ? (await fetchReadyReels(this.authHeaders()).catch(() => [])).filter(isThumbnailImageReel)
    : [];
  deleteThumbnailVaultEntries(deletedReelId ? [deletedReelId] : [], imageReels, {
    backendReachable: persistenceSuccess,
    storageKey: CONFIG.THUMBNAIL_STORAGE_KEY,
    deletedFileKeys: fileKey ? [fileKey] : [keyStr].filter(Boolean)
  });
  syncCollectionStore(personalThumbnailCollection, CONFIG.THUMBNAIL_STORAGE_KEY);
  if (fileKey) AI_CLEANUP_AGENT.removeThumbnailFromCategories(fileKey);
  if (keyStr && keyStr !== fileKey) AI_CLEANUP_AGENT.removeThumbnailFromCategories(keyStr);
  const afterCount = get(personalThumbnailCollection).length;
  console.info('[DELETE_STORE_UPDATE]', {
  mechanism: 'single',
  vault: 'thumbnail-vault',
  beforeCount,
  afterCount,
  timestamp: Date.now()
  });
  console.info('[DELETE_PERSISTENCE]', {
  mechanism: 'single',
  vault: 'thumbnail-vault',
  success: persistenceSuccess,
  timestamp: Date.now()
  });
  console.info('[DELETE_UI_REFRESH]', {
  mechanism: 'single',
  vault: 'thumbnail-vault',
  newCount: afterCount,
  timestamp: Date.now()
  });
  console.info('[DELETE_COMPLETE]', {
  mechanism: 'single',
  vault: 'thumbnail-vault',
  itemId: deletedReelId || String(fileKey || thumbnailKey),
  timestamp: Date.now()
  });
  vaultForensic(persistenceSuccess ? 'VAULT_DELETE_SUCCESS' : 'VAULT_DELETE_FAIL', {
    vaultType: 'thumbnail',
    assetId: deletedReelId || String(fileKey || thumbnailKey),
    fileName: String(fileKey || thumbnailKey),
    storageLocation: CONFIG.THUMBNAIL_STORAGE_KEY,
    backendEndpoint: `${CONFIG?.API_BASE_URL || ''}/api/reels`,
    result: persistenceSuccess ? 'delete_success' : 'backend_delete_failed_local_purged'
  });
  uploadStatus.set(persistenceSuccess ? '✅ Thumbnail deleted' : '⚠️ Removed locally — backend delete failed');
  } catch (err) { console.error('❌ [THUMB DELETE] Failed:', err); uploadStatus.set(`❌ Delete failed: ${err.message}`); }
  resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
  },
  deleteVaultVideo: async (videoId) => {
  if (!videoId) return;
  const vault = get(personalVideos);
  const video = vault.find(v => v.id === videoId);
  if (!video) { uploadStatus.set('❌ Video not found'); resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000); return; }
  const ghost =
    isGhostVideoVaultEntry(video) ||
    String(video?.uploadState || '') === 'interrupted' ||
    String(video?.uploadState || '') === 'failed' ||
    String(video?.uploadState || '') === 'pending_accept' ||
    String(videoId || '').startsWith('local-upload-') ||
    String(videoId || '').startsWith('local-pending-');
  console.info('[DELETE_HANDLER_FIRED]', {
  mechanism: 'single',
  vault: 'video-vault',
  itemId: String(videoId),
  itemName: String(video.name || ''),
  ghost,
  timestamp: Date.now()
  });
  if (!ghost) {
    console.info('[DELETE_CONFIRMATION_SHOWN]', {
      mechanism: 'single',
      vault: 'video-vault',
      itemId: String(videoId),
      itemName: String(video.name || ''),
      timestamp: Date.now()
    });
    if (!confirm(`Delete "${video.name}" permanently?`)) return;
  }
  console.info('[DELETE_CONFIRMED]', {
  mechanism: 'single',
  vault: 'video-vault',
  itemId: String(videoId),
  timestamp: Date.now()
  });
  // Ghost outline stubs: always allow local purge (no backend asset / expired blob).
  // Real assets still need Studio login for DELETE /api/reels/{id}.
  if (!ghost && !getAdminToken()) {
  uploadStatus.set('🔐 Studio login required — open Studio, sign in, then retry delete');
  resourceManager.setTimeout(() => uploadStatus.set('Standby'), 5000);
  return;
  }
  uploadStatus.set(`🗑️ Deleting ${video.name}...`);
  vaultForensic('VAULT_DELETE_START', {
    vaultType: 'video',
    assetId: String(videoId),
    fileName: String(video.name || ''),
    storageLocation: CONFIG.VIDEO_VAULT_KEY,
    backendEndpoint: `${CONFIG?.API_BASE_URL || ''}/api/reels/${videoId}`,
    result: ghost ? 'ghost_local_purge_start' : 'delete_start'
  });
  try {
  const beforeCount = vault.length;
  const diskName = filenameFromMediaRef(video) || video.name;
  const fileName = String(video.fileName || video.file_name || video.name || '').trim();
  const sizeBytes = Number(video.size || 0);
  logDeletionPropagation('vault-delete-request', { diskName, videoId, ghost });
  let persistenceSuccess = false;
  if (!ghost && getAdminToken()) {
    try {
      await deleteReelById(videoId, AI_CLEANUP_AGENT.authHeaders());
      persistenceSuccess = true;
      logDeletionPropagation('vault-delete-backend-ok', { diskName });
    } catch (apiError) {
      const detail = String(apiError?.message || apiError || '');
      // Missing backend row is expected for leftover failed-upload chrome.
      if (/404|not.?found|unknown reel/i.test(detail)) {
        console.warn('⚠️ [VIDEO DELETE] Backend asset already gone — purging local ghost', detail);
      } else if (
        isInvalidSessionError(apiError) ||
        /invalid_session|missing_authorization/i.test(detail)
      ) {
        uploadStatus.set('🔐 Studio session expired — sign in via Studio and retry delete');
        vaultForensic('VAULT_DELETE_FAIL', {
          vaultType: 'video',
          assetId: String(videoId),
          fileName: String(video.name || ''),
          storageLocation: CONFIG.VIDEO_VAULT_KEY,
          backendEndpoint: `${CONFIG?.API_BASE_URL || ''}/api/reels/${videoId}`,
          result: detail
        });
        resourceManager.setTimeout(() => uploadStatus.set('Standby'), 5000);
        return;
      } else {
        console.warn('⚠️ [VIDEO DELETE] Backend API call failed — still purging local:', detail);
      }
    }
  }

  applyCanonicalDeleteClientEffects(
    { purge: runClientMediaPurge },
    { reelId: videoId, filename: diskName, videoUrl: video?.url }
  );

  const hero = resolveActiveHeroVideoReel();
  if (hero?.id && String(hero.id) === String(videoId)) {
    clearHeroReel();
    console.info('[VIDEO_GHOST_PURGE]', { clearedHero: true, videoId });
  }

  if (fileName && sizeBytes > 0) {
    trackUploadLockRemove(`${fileName.toLowerCase()}|${sizeBytes}`, {
      reason: 'vault_video_deleted'
    });
  }

  const imageReels = persistenceSuccess
    ? (await fetchReadyReels(AI_CLEANUP_AGENT.authHeaders()).catch(() => [])).filter(isThumbnailImageReel)
    : [];
  deleteThumbnailVaultEntries([String(videoId)], imageReels, {
    backendReachable: persistenceSuccess,
    storageKey: CONFIG.THUMBNAIL_STORAGE_KEY
  });
  syncCollectionStore(personalThumbnailCollection, CONFIG.THUMBNAIL_STORAGE_KEY);
  if (video.url && video.url.startsWith('blob:')) { URL.revokeObjectURL(video.url); resourceManager.revokeBlobUrl(video.url); }
  const thumbKey = filenameFromMediaRef(video?.thumbnail || video?.thumbnailUrl || '');
  if (thumbKey) {
    removeThumbnailVaultByIndex(thumbKey, CONFIG.THUMBNAIL_STORAGE_KEY);
  }
  uploadStatus.set(persistenceSuccess ? '✅ Video deleted' : '✅ Removed leftover vault stub');
  await syncFromVault(true);
  const afterCount = get(personalVideos).length;
  console.info('[DELETE_STORE_UPDATE]', {
  mechanism: 'single',
  vault: 'video-vault',
  beforeCount,
  afterCount,
  timestamp: Date.now()
  });
  console.info('[DELETE_PERSISTENCE]', {
  mechanism: 'single',
  vault: 'video-vault',
  success: true,
  localOnly: !persistenceSuccess,
  ghost,
  timestamp: Date.now()
  });
  console.info('[DELETE_UI_REFRESH]', {
  mechanism: 'single',
  vault: 'video-vault',
  newCount: afterCount,
  timestamp: Date.now()
  });
  console.info('[DELETE_COMPLETE]', {
  mechanism: 'single',
  vault: 'video-vault',
  itemId: String(videoId),
  timestamp: Date.now()
  });
  vaultForensic(persistenceSuccess ? 'VAULT_DELETE_SUCCESS' : 'VAULT_DELETE_SUCCESS', {
    vaultType: 'video',
    assetId: String(videoId),
    fileName: String(video.name || ''),
    storageLocation: CONFIG.VIDEO_VAULT_KEY,
    backendEndpoint: `${CONFIG?.API_BASE_URL || ''}/api/reels/${videoId}`,
    result: persistenceSuccess ? 'delete_success' : 'local_ghost_purged'
  });
  } catch (err) {
  console.error('Delete failed:', err);
  const detail = String(err?.message || err || 'unknown error');
  const sessionError =
    isInvalidSessionError(err) ||
    /invalid_session|missing_authorization/i.test(detail);
  uploadStatus.set(
    sessionError
      ? '🔐 Studio session expired — sign in via Studio and retry delete'
      : `❌ Delete failed: ${detail}`
  );
  vaultForensic('VAULT_DELETE_FAIL', {
    vaultType: 'video',
    assetId: String(videoId),
    fileName: String(video.name || ''),
    storageLocation: CONFIG.VIDEO_VAULT_KEY,
    backendEndpoint: `${CONFIG?.API_BASE_URL || ''}/api/reels/${videoId}`,
    result: detail
  });
  }
  resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
  }
  };
  return AI_CLEANUP_AGENT;
}
