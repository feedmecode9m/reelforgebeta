import { get } from 'svelte/store';
import { createLocalReel } from '../api/reelContract.js';
import { deleteMediaFile, deleteReelById, fetchReadyReels } from '../api/media.js';
import { filenameFromMediaRef } from '../vaultMedia.js';
import { toRelativeMediaPath } from '../config.js';
import { logDeletionPropagation, filterOutDeletedMedia, applyCanonicalDeleteClientEffects } from '../deletionSync.js';
import { isStorageFull, wouldExceedQuota } from '../storage.js';
import { isHeroAsset, filterNonHeroAssets } from '../hero/heroDomainGuard.js';
import { removeThumbnailVaultByIndex, syncCollectionStore } from './thumbnailVault.js';
import { traceThumbStoreWrite } from './thumbStoreWriteTrace.js';
import { pipelineCheckpoint } from '../diagnostics/pipelineDiag.js';

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
  const token = typeof window !== 'undefined' ? localStorage.getItem('reelforge_admin_session_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
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
  const categoriesList = ['Trending', 'Romance', 'Cyber-Action', 'Suspense'];
  const detectedCategory = CATEGORY_DETECTOR.detectFromTitle(videoData.name.replace(/\.[^/.]+$/, ''));
  const primaryCategory = categoriesList.includes(detectedCategory) ? detectedCategory : 'Trending';
  feed.update((currentFeed) => {
  const newFeed = { ...currentFeed };
  categoriesList.forEach((cat) => {
  if (!newFeed[cat]) newFeed[cat] = [];
  const removedPlaceholders = newFeed[cat].filter(
  (r) => r.isPlaceholder && (r.personal_video_id === videoData.id || (r.url && videoData.url && r.url === videoData.url))
  );
  if (removedPlaceholders.length > 0) {
  removedPlaceholders.forEach((old) => {
  pipelineCheckpoint('PLACEHOLDER_REPLACED', { oldId: old.id, newId: String(videoData.id), vault: 'mp4' });
  });
  }
  // Remove any previously distributed copies of the same personal video.
  newFeed[cat] = newFeed[cat].filter(
  (r) =>
  !(
  (r.isPersonalVideo && r.personal_video_id === videoData.id) ||
  (r.url && videoData.url && r.url === videoData.url)
  )
  );
  });
  const reel = {
  ...createLocalReel({
  id: String(videoData.id),
  name: videoData.name.replace(/\.[^/.]+$/, ''),
  type: 'video',
  url: toRelativeMediaPath(String(videoData.url || '')) || String(videoData.url || ''),
  thumbnailUrl: videoData.thumbnail ? (toRelativeMediaPath(String(videoData.thumbnail)) || String(videoData.thumbnail)) : '',
  category: primaryCategory,
  isPlaceholder: false,
  isPersonalVideo: true,
  personal_video_id: videoData.id,
  likes: Math.floor(Math.random() * 200) + 50,
  views: Math.floor(Math.random() * 1000) + 100,
  match: '🎬 PRIMARY',
  auto_detected: true,
  detection_confidence: 'High',
  createdAt: videoData.addedAt || new Date().toISOString()
  })
  };
  console.info('[HERO_ROUTE]', {
  stage: 'AI_CLEANUP_AGENT.distributeVideoToFeed',
  id: String(videoData?.id || ''),
  url: String(videoData?.url || ''),
  mime: String(videoData?.type || ''),
  destination: `feed:${primaryCategory}`,
  ts: new Date().toISOString()
  });
  newFeed[primaryCategory].unshift(reel);
  return newFeed;
  });
  // Force UI refresh and persist feed
  feed.update(f => ({ ...f }));
  storageSet(CONFIG.FEED_STORAGE_KEY, get(feed));
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
  },
  distributeThumbnailAcrossCategories(thumbnailName, base64Data) {
  if (isHeroAsset({ id: thumbnailName, name: thumbnailName, url: base64Data, thumbnail: base64Data })) return;
  const categoriesList = ['Trending', 'Romance', 'Cyber-Action', 'Suspense'];
  const detectedCategory = CATEGORY_DETECTOR.detectFromTitle(String(thumbnailName || '').replace(/\.[^/.]+$/, ''));
  const primaryCategory = categoriesList.includes(detectedCategory) ? detectedCategory : 'Trending';
  feed.update((currentFeed) => {
  const newFeed = { ...currentFeed };
  categoriesList.forEach((cat) => {
  if (!newFeed[cat]) newFeed[cat] = [];
  // Keep a single source placeholder per thumbnail across the full feed.
  newFeed[cat] = newFeed[cat].filter((r) => !(r.isPlaceholder && r.personal_thumbnail === thumbnailName));
  });
  const placeholder = createLocalReel({
  id: `personal-thumb-${thumbnailName}`,
  name: `Personal Content - ${primaryCategory}`,
  category: primaryCategory,
  type: 'image',
  url: base64Data,
  thumbnailUrl: base64Data,
  isPlaceholder: true,
  isPersonalThumbnail: true,
  personal_thumbnail: thumbnailName,
  likes: Math.floor(Math.random() * 100) + 50,
  views: Math.floor(Math.random() * 500) + 100,
  match: 'PERSONAL THUMBNAIL',
  ai_tags: ['personal-thumbnail', 'user-uploaded']
  });
  console.info('[PLACEHOLDER_INSERT]', {
  stage: 'AI_CLEANUP_AGENT.distributeThumbnailAcrossCategories',
  placeholderId: placeholder.id,
  thumbnailName: String(thumbnailName || ''),
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
  feed.update((currentFeed) => { const newFeed = {}; Object.keys(currentFeed).forEach((cat) => { newFeed[cat] = currentFeed[cat].filter((r) => !(r.isPlaceholder && r.personal_thumbnail === thumbnailName)); }); return newFeed; });
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
  // Remove stale thumbnail placeholders and rebuild from authoritative thumbnail store.
  categoriesList.forEach((cat) => {
  newFeed[cat] = (newFeed[cat] || []).filter((r) => !r?.isPlaceholder || !r?.isPersonalThumbnail);
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
  let thumbUrl = '';
  if (rawThumbUrl) {
    const rel = toRelativeMediaPath(rawThumbUrl);
    thumbUrl = rel.startsWith('/thumbs/') ? rel : (fileKey ? `/thumbs/${fileKey}` : '');
  } else if (fileKey) {
    thumbUrl = `/thumbs/${fileKey}`;
  }
  if (!thumbUrl) return;
  const displayLabel = typeof thumb === 'string' ? thumb : String(thumb.title || thumb.name || fileKey);
  const detectedCategory = CATEGORY_DETECTOR.detectFromTitle(String(displayLabel).replace(/\.[^/.]+$/, ''));
  const primaryCategory = categoriesList.includes(detectedCategory) ? detectedCategory : 'Trending';
  const placeholder = createLocalReel({ id: thumb.id ? `personal-thumb-${thumb.id}` : `personal-thumb-${fileKey}`, name: `Personal Content ${thumbIndex + 1} - ${primaryCategory}`, category: primaryCategory, type: 'image', url: thumbUrl, thumbnailUrl: thumbUrl, isPlaceholder: true, isPersonalThumbnail: true, personal_thumbnail: fileKey, likes: Math.floor(Math.random() * 100) + 50, views: Math.floor(Math.random() * 500) + 100, match: 'PERSONAL THUMBNAIL', ai_tags: ['personal-thumbnail', 'user-uploaded'], createdAt: thumbAddedAt || new Date().toISOString() });
  console.info('[PLACEHOLDER_INSERT]', {
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
  return true;
  },
  async handleThumbnailRemove(index) {
  const collection = get(personalThumbnailCollection);
  if (!collection || index < 0 || index >= collection.length) { console.warn('⚠️ [THUMB DELETE] Invalid index or empty collection'); return; }
  const thumbnailName = collection[index];
  if (!thumbnailName) { console.warn('⚠️ [THUMB DELETE] No thumbnail name at index', index); return; }
  console.info('[DELETE_HANDLER_FIRED]', {
  mechanism: 'single',
  vault: 'thumbnail-vault',
  itemId: String(thumbnailName),
  itemName: String(thumbnailName),
  timestamp: Date.now()
  });
  console.info('[DELETE_CONFIRMATION_SHOWN]', {
  mechanism: 'single',
  vault: 'thumbnail-vault',
  itemId: String(thumbnailName),
  itemName: String(thumbnailName),
  timestamp: Date.now()
  });
  if (!confirm(`Delete thumbnail "${thumbnailName}" permanently?`)) return;
  console.info('[DELETE_CONFIRMED]', {
  mechanism: 'single',
  vault: 'thumbnail-vault',
  itemId: String(thumbnailName),
  timestamp: Date.now()
  });
  uploadStatus.set(`🗑️ Deleting ${thumbnailName}...`);
  try {
  const beforeCount = collection.length;
  const token = typeof window !== 'undefined' ? localStorage.getItem('reelforge_admin_session_token') : null;
  let persistenceSuccess = false;
  if (token) {
  console.log(`🗑️ [THUMB DELETE] Calling backend API for: ${thumbnailName}`);
  try {
  const reels = await fetchReadyReels(this.authHeaders());
  const imageReel = reels.find((reel) => {
  const type = String(reel?.type || '').toLowerCase();
  if (!(type === 'image' || String(reel?.url || '').includes('/thumbs/'))) return false;
  const byThumb = this.mediaBasename(reel?.thumbnailUrl || reel?.thumbnail_url || reel?.url);
  const byFile = this.mediaBasename(reel?.fileName || reel?.file_name || '');
  return byThumb === thumbnailName || byFile === thumbnailName;
  });
  if (imageReel?.id) {
  await deleteReelById(imageReel.id, this.authHeaders());
  persistenceSuccess = true;
  applyCanonicalDeleteClientEffects(
    { purge: runClientMediaPurge },
    { reelId: imageReel.id, videoUrl: imageReel?.url || imageReel?.thumbnailUrl }
  );
  } else {
  // Fallback for legacy records when no reel id mapping is found.
  await deleteMediaFile(thumbnailName, this.authHeaders());
  persistenceSuccess = true;
  }
  console.log(`✅ [THUMB DELETE] Backend deletion successful: ${thumbnailName}`);
  } catch (apiError) { console.warn('⚠️ [THUMB DELETE] Backend API call failed:', apiError); }
  } else { console.warn('⚠️ [THUMB DELETE] No admin token available, skipping backend deletion'); }
  removeThumbnailVaultByIndex(thumbnailName, CONFIG.THUMBNAIL_STORAGE_KEY);
  syncCollectionStore(personalThumbnailCollection, CONFIG.THUMBNAIL_STORAGE_KEY);
  AI_CLEANUP_AGENT.removeThumbnailFromCategories(thumbnailName);
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
  itemId: String(thumbnailName),
  timestamp: Date.now()
  });
  uploadStatus.set('✅ Thumbnail deleted');
  } catch (err) { console.error('❌ [THUMB DELETE] Failed:', err); uploadStatus.set(`❌ Delete failed: ${err.message}`); }
  resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
  },
  deleteVaultVideo: async (videoId) => {
  if (!videoId) return;
  const vault = get(personalVideos);
  const video = vault.find(v => v.id === videoId);
  if (!video) { uploadStatus.set('❌ Video not found'); resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000); return; }
  console.info('[DELETE_HANDLER_FIRED]', {
  mechanism: 'single',
  vault: 'video-vault',
  itemId: String(videoId),
  itemName: String(video.name || ''),
  timestamp: Date.now()
  });
  console.info('[DELETE_CONFIRMATION_SHOWN]', {
  mechanism: 'single',
  vault: 'video-vault',
  itemId: String(videoId),
  itemName: String(video.name || ''),
  timestamp: Date.now()
  });
  if (!confirm(`Delete "${video.name}" permanently?`)) return;
  console.info('[DELETE_CONFIRMED]', {
  mechanism: 'single',
  vault: 'video-vault',
  itemId: String(videoId),
  timestamp: Date.now()
  });
  uploadStatus.set(`🗑️ Deleting ${video.name}...`);
  try {
  const beforeCount = vault.length;
  const token = typeof window !== 'undefined' ? localStorage.getItem('reelforge_admin_session_token') : null;
  const diskName = filenameFromMediaRef(video) || video.name;
  let persistenceSuccess = false;
  if (token && diskName) {
  logDeletionPropagation('vault-delete-request', { diskName, videoId });
  try {
  await deleteReelById(videoId, AI_CLEANUP_AGENT.authHeaders());
  persistenceSuccess = true;
  applyCanonicalDeleteClientEffects(
    { purge: runClientMediaPurge },
    { reelId: videoId, filename: diskName, videoUrl: video?.url }
  );
  logDeletionPropagation('vault-delete-backend-ok', { diskName });
  } catch (apiError) { console.warn('⚠️ [VAULT DELETE] Backend API call failed:', apiError); }
  } else { console.warn('⚠️ [VAULT DELETE] No admin token or filename available, skipping backend deletion'); }
  if (!persistenceSuccess) {
  runClientMediaPurge({ filename: diskName, reelId: videoId, videoUrl: video?.url });
  }
  if (video.url && video.url.startsWith('blob:')) { URL.revokeObjectURL(video.url); resourceManager.revokeBlobUrl(video.url); }
  uploadStatus.set('✅ Video deleted');
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
  success: persistenceSuccess,
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
  } catch (err) { console.error('Delete failed:', err); uploadStatus.set(`❌ Delete failed: ${err.message}`); }
  resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
  }
  };
  return AI_CLEANUP_AGENT;
}
