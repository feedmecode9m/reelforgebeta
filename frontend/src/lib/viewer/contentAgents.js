import { get } from 'svelte/store';
import { deleteReelById } from '../api/media.js';
import { filenameFromMediaRef } from '../vaultMedia.js';
import { logDeletionPropagation, applyCanonicalDeleteClientEffects } from '../deletionSync.js';

export function createContentAgents(deps) {
  const {
    CONFIG,
    NEON_COLORS,
    resourceManager,
    feed,
    uploadStatus,
    personalThumbnailCollection,
    personalVideoCollection,
    personalThumbnailIndex,
    usePersonalThumbnails,
    newTitle,
    storageSet,
    getFallbackImage,
    getPersonalVideo,
    getPersonalThumbnail,
    getCategoryThumbnail,
    forceDisplayInStudio,
    syncFromVault,
    runClientMediaPurge
  } = deps;

  const AI_IMAGE_GENERATOR = {
  skinTones: {
  portrait: ['#3E2723', '#4E342E', '#5D4037'],
  mother: ['#4A3728', '#5D4037', '#6D4C41'],
  father: ['#2D1B14', '#3E2723', '#4E342E'],
  youth: ['#5D4037', '#795548', '#8D6E63'],
  love: ['#4E342E', '#6D4C41', '#8D6E63'],
  family: ['#3E2723', '#5D4037', '#795548'],
  joy: ['#5D4037', '#8D6E63', '#A1887F'],
  struggle: ['#2D1B14', '#3E2723', '#4E342E'],
  resilience: ['#3E2723', '#4E342E', '#6D4C41'],
  excellence: ['#4E342E', '#6D4C41', '#8D6E63'],
  community: ['#5D4037', '#6D4C41', '#8D6E63'],
  culture: ['#6D4C41', '#8D6E63', '#A1887F'],
  mystery: ['#1A1A1A', '#2D1B14', '#3E2723'],
  scene: ['#2D1B14', '#3E2723', '#4E342E'],
  barbershop: ['#1A1A1A', '#2D2D2D', '#3E2723']
  },
  generate(type, subtype, index) {
  try {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return this.getFallbackImage();
  canvas.width = 400;
  canvas.height = 600;
  const tones = this.skinTones[subtype] || this.skinTones.portrait;
  const gradient = ctx.createLinearGradient(0, 0, 400, 600);
  gradient.addColorStop(0, tones[0]);
  gradient.addColorStop(0.5, tones[1]);
  gradient.addColorStop(1, tones[2]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 400, 600);
  for (let i = 0; i < 5000; i++) {
  const x = Math.random() * 400;
  const y = Math.random() * 600;
  const alpha = Math.random() * 0.1;
  ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.fillRect(x, y, 2, 2);
  }
  ctx.fillStyle = tones[0];
  ctx.beginPath();
  ctx.arc(200, 200, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(200, 400, 100, 120, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#FFD700';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(200, 200, 70, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 215, 0, 0.9)';
  ctx.font = 'bold 20px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 4;
  ctx.fillText(subtype.toUpperCase(), 200, 520);
  ctx.font = '14px Inter, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fillText('Black Stories', 200, 545);
  return canvas.toDataURL('image/jpeg', 0.9);
  } catch (error) {
  console.error('AI image generation failed:', error);
  return this.getFallbackImage();
  }
  },
  getFallbackImage() {
  return getFallbackImage();
  }
  };
  // ==========================================
  // Category Detector
  // ==========================================
  const CATEGORY_DETECTOR = {
  keywords: {
  'Cyber-Action': ['cyber', 'hack', 'action', 'fight', 'chase', 'shoot', 'explosion', 'thriller', 'adventure', 'secret', 'agent', 'mission', 'combat', 'gun', 'weapon', 'war', 'battle', 'revenge', 'justice', 'crime', 'detective', 'investigation', 'spy', 'espionage', 'danger'],
  Romance: ['love', 'romance', 'heart', 'kiss', 'relationship', 'dating', 'couple', 'marriage', 'wedding', 'passion', 'desire', 'affair', 'sweet', 'tender', 'emotional', 'feelings', 'together', 'forever', 'soulmate', 'destiny', 'chemistry', 'attraction', 'connection'],
  Suspense: ['suspense', 'mystery', 'thriller', 'horror', 'fear', 'scary', 'dark', 'secret', 'hidden', 'danger', 'unknown', 'haunted', 'ghost', 'paranormal', 'psychological', 'twist', 'cliffhanger', 'tension', 'anxiety', 'dread', 'ominous', 'sinister', 'creepy'],
  Trending: ['viral', 'trending', 'popular', 'hot', 'latest', 'new', 'must watch', 'breaking', 'exclusive', 'premiere', 'special', 'barbershop', 'barber', 'haircut', 'micro', 'stirred']
  },
  detectFromTitle(title) {
  if (!title) return 'Trending';
  const titleLower = title.toLowerCase();
  if (titleLower.includes('barbershop') || titleLower.includes('barber') || titleLower.includes('haircut')) return 'Trending';
  if (titleLower.includes('viral') || titleLower.includes('trending') || titleLower.includes('popular') || titleLower.includes('hot') || titleLower.includes('latest') || titleLower.includes('breaking')) return 'Trending';
  const scores = {};
  Object.keys(this.keywords).forEach((category) => {
  scores[category] = this.keywords[category].filter((kw) => titleLower.includes(kw.toLowerCase())).length;
  });
  const maxCategory = Object.entries(scores).reduce((a, b) => a[1] > b[1] ? a : b);
  return maxCategory[1] > 1 ? maxCategory[0] : this.aiAssistCategory(titleLower);
  },
  aiAssistCategory(titleLower) {
  if (titleLower.length < 20) return 'Trending';
  const words = titleLower.split(/\s+/);
  if (words.length > 8) return 'Suspense';
  const emotionalWords = ['heart', 'soul', 'tears', 'pain', 'joy', 'fear'];
  if (emotionalWords.some((w) => titleLower.includes(w))) return 'Romance';
  const actionWords = ['run', 'fight', 'chase', 'escape', 'survive'];
  if (actionWords.some((w) => titleLower.includes(w))) return 'Cyber-Action';
  return 'Trending';
  },
  async analyzeVideoMetadata(videoFile) {
  return new Promise((resolve) => {
  if (!videoFile) { resolve(null); return; }
  const video = document.createElement('video');
  video.preload = 'metadata';
  const blobUrl = resourceManager.addBlobUrl(URL.createObjectURL(videoFile));
  video.src = blobUrl;
  video.onloadedmetadata = () => {
  const duration = video.duration;
  resourceManager.revokeBlobUrl(blobUrl);
  resolve({ duration, categoryHint: duration < 60 ? 'Trending' : duration > 300 ? 'Suspense' : null, resolution: `${video.videoWidth}x${video.videoHeight}`, isHighRes: video.videoWidth >= 1920 });
  };
  video.onerror = () => { resourceManager.revokeBlobUrl(blobUrl); resolve(null); };
  });
  },
  async recommendCategory(title, videoFile) {
  isAutoDetecting.set(true);
  uploadStatus.set('🤖 ANALYZING CONTENT FOR SMART CATEGORIZATION...');
  const titleCategory = this.detectFromTitle(title);
  const videoMetadata = await this.analyzeVideoMetadata(videoFile);
  let finalCategory = titleCategory;
  let confidence = 'High';
  if (videoMetadata) {
  if (videoMetadata.categoryHint && videoMetadata.categoryHint !== titleCategory) {
  if (videoMetadata.duration > 300 && titleCategory === 'Trending') { finalCategory = 'Suspense'; confidence = 'Medium'; }
  else if (videoMetadata.duration < 30 && (titleCategory === 'Suspense' || titleCategory === 'Cyber-Action')) { finalCategory = 'Trending'; confidence = 'Medium'; }
  }
  if (videoMetadata.isHighRes && finalCategory === 'Trending') { finalCategory = 'Cyber-Action'; confidence = 'Medium-High'; }
  }
  if (title.toLowerCase().includes('barbershop') || title.toLowerCase().includes('barber')) { finalCategory = 'Trending'; confidence = 'Very High'; }
  isAutoDetecting.set(false);
  return { category: finalCategory, confidence, titleCategory, videoMetadata };
  }
  };
  // ==========================================
  // AI Cleanup Agent
  // ==========================================
  // ==========================================
  // Production Agent
  // ==========================================
  const ProductionAgent = {
  deleteReel: async (reelId) => {
  if (!reelId) { console.error('❌ [PRODUCTION AGENT] No reel ID provided'); return false; }
  try {
  uploadStatus.set('🗑️ Deleting production...');
  const currentFeed = get(feed);
  const reel = Object.values(currentFeed).flat().find((r) => r && r.id === reelId);
  const filename = filenameFromMediaRef(reel) || (reelId.startsWith('reel-') ? reelId.substring(5) : reelId);
  console.info('[VAULT-DELETE-TRACE] ProductionAgent.deleteReel:start', {
    reelId: String(reelId),
    filename,
    videoUrl: reel?.url || reel?.video_url || null,
    ts: new Date().toISOString()
  });
  logDeletionPropagation('production-delete-start', { reelId, filename });
  const token = typeof window !== 'undefined' ? localStorage.getItem('reelforge_admin_session_token') : null;
  if (!token) throw new Error('Admin authentication required. Please log in as admin first.');
  await deleteReelById(reelId, { Authorization: `Bearer ${token}` });
  console.info('[VAULT-DELETE-TRACE] ProductionAgent.deleteReel:api_ok', {
    reelId: String(reelId),
    ts: new Date().toISOString()
  });
  applyCanonicalDeleteClientEffects(
    { purge: runClientMediaPurge },
    { reelId, filename, videoUrl: reel?.url || reel?.video_url }
  );
  console.info('[DELETE_PERSISTENCE]', {
  vault: String(reel?.category || 'studio-feed'),
  mechanism: 'single',
  success: true,
  itemId: String(reelId),
  timestamp: Date.now()
  });
  uploadStatus.set('✅ Production deleted successfully');
  resourceManager.setTimeout(() => uploadStatus.set('Standby'), 2000);
  return true;
  } catch (error) { console.error('❌ [PRODUCTION AGENT] Delete failed:', error); console.info('[DELETE_PERSISTENCE]', { vault: 'studio-feed', mechanism: 'single', success: false, itemId: String(reelId), error: error?.message || String(error), timestamp: Date.now() }); uploadStatus.set(`❌ Delete failed: ${error.message}`); resourceManager.setTimeout(() => uploadStatus.set('Standby'), 3000); return false; }
  }
  };
  
  // Vault utilities (factory)
  let vaultUtils;
  // Agents (factories — initialized after dependencies exist)
  let AI_CLEANUP_AGENT;
  let UIAgent;
  
  function initViewerAgents() {
  vaultUtils = createVaultUtils({ CONFIG, personalThumbnailCollection, getFallbackImage });
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
  BLACK_STORIES_MATCHER, hasPlayableVideo, syncFromVault
  });
  }
  const getImg = (reel, category, i) => UIAgent.getImg?.(reel, category, i) || getRandomThumb();
  // ==========================================
  // Black Stories Matcher
  // ==========================================
  const BLACK_STORIES_MATCHER = {
  getBarbershopImage(index) { const images = [CONFIG.USER_BARBERSHOP_IMAGE, () => AI_IMAGE_GENERATOR.generate('barbershop', 'scene', index), () => AI_IMAGE_GENERATOR.generate('barbershop', 'community', index + 1)]; const source = images[index % images.length]; return typeof source === 'function' ? source() : source; },
  getBlackStoriesRotation(category, index) {
  const categoryLower = category.toLowerCase();
  const agents = { cyberAction: [() => AI_IMAGE_GENERATOR.generate('character', 'resilience', 0), () => AI_IMAGE_GENERATOR.generate('character', 'struggle', 1), () => AI_IMAGE_GENERATOR.generate('character', 'excellence', 2)], romance: [() => AI_IMAGE_GENERATOR.generate('character', 'love', 0), () => AI_IMAGE_GENERATOR.generate('character', 'family', 1), () => AI_IMAGE_GENERATOR.generate('character', 'joy', 2)], suspense: [() => AI_IMAGE_GENERATOR.generate('character', 'struggle', 0), () => AI_IMAGE_GENERATOR.generate('character', 'mystery', 1), () => AI_IMAGE_GENERATOR.generate('character', 'resilience', 2)], trending: [() => AI_IMAGE_GENERATOR.generate('character', 'portrait', 0), () => AI_IMAGE_GENERATOR.generate('character', 'youth', 1), () => AI_IMAGE_GENERATOR.generate('character', 'community', 2)] };
  let pool = agents.trending;
  if (categoryLower.includes('cyber') || categoryLower.includes('action')) pool = agents.cyberAction;
  else if (categoryLower.includes('romance')) pool = agents.romance;
  else if (categoryLower.includes('suspense')) pool = agents.suspense;
  const generator = pool[index % pool.length];
  return typeof generator === 'function' ? generator() : generator;
  },
  fillBlackStoriesUntilVideo(existingCount, category) {
  const needed = Math.max(0, CONFIG.TARGET_LANDSCAPE_COUNT - existingCount);
  const placeholders = [];
  const usePersonal = get(usePersonalThumbnails);
  const thumbCollection = get(personalThumbnailCollection);
  const storyTitles = ['Legacy of Strength', "Mother's Love", "Father's Wisdom", 'Youth in Motion', 'Creative Expression', 'Community Unity', 'Overcoming Adversity', 'Black Excellence', 'Cultural Pride', 'Family Bonds', 'Artistic Vision', 'Resilient Spirit'];
  for (let i = 0; i < needed; i++) {
  let thumbnailUrl = usePersonal && thumbCollection.length > 0 ? getCategoryThumbnail(category, i) : this.getBlackStoriesRotation(category, i);
  if (!thumbnailUrl) thumbnailUrl = AI_IMAGE_GENERATOR.getFallbackImage();
  placeholders.push({ id: `ai-black-stories-${category}-${i}`, title: `${storyTitles[i % storyTitles.length]} - ${category}`, category, isPlaceholder: true, isBlackStoriesPlaceholder: true, isAIGenerated: !usePersonal, isPersonalThumbnail: usePersonal, match: usePersonal ? `${thumbCollection.length} PERSONAL THUMBNAILS AVAILABLE` : `${Math.floor(Math.random() * 15) + 85}% AI-GENERATED BLACK STORIES`, thumbnail_url: thumbnailUrl, normalized_thumbnail: thumbnailUrl, video_url: null, likes: Math.floor(Math.random() * 300) + 100, views: Math.floor(Math.random() * 1500) + 500, ai_tags: usePersonal ? ['personal-thumbnail', 'user-uploaded'] : ['ai-generated', 'black-stories', 'authentic', 'cultural', 'representation', 'micro-drama'], black_stories_theme: usePersonal ? 'user-personal-content' : 'ai-character', created_at: new Date(Date.now() - Math.random() * 86400000 * 30).toISOString() });
  }
  return placeholders;
  },
  matchToContent(title, category, index) {
  const titleLower = title.toLowerCase();
  if (titleLower.includes('barbershop') || titleLower.includes('barber')) return this.getBarbershopImage(index);
  const matchers = { resilience: () => AI_IMAGE_GENERATOR.generate('character', 'resilience', index), strength: () => AI_IMAGE_GENERATOR.generate('character', 'resilience', index), overcome: () => AI_IMAGE_GENERATOR.generate('character', 'resilience', index), joy: () => AI_IMAGE_GENERATOR.generate('character', 'joy', index), happy: () => AI_IMAGE_GENERATOR.generate('character', 'joy', index), pride: () => AI_IMAGE_GENERATOR.generate('character', 'excellence', index), community: () => AI_IMAGE_GENERATOR.generate('character', 'community', index), culture: () => AI_IMAGE_GENERATOR.generate('character', 'culture', index) };
  for (const [keyword, generator] of Object.entries(matchers)) { if (titleLower.includes(keyword)) return generator(); }
  return this.getBlackStoriesRotation(category, index);
  }
  };
  // ==========================================
  // Personal Upload System (local feed composer — NOT canonical HTTP upload)
  // Canonical file upload: createReel() → POST /api/reels
  // ==========================================
  const PersonalUploadSystem = {
  /** @deprecated Local-only title placement; does not POST files. Use Vault/Studio file upload → createReel. */
  async quickUpload(title, category = 'Trending') {
  const videoCollection = get(personalVideoCollection);
  if (!title || !videoCollection.length) { uploadStatus.set('ERROR: TITLE REQUIRED AND NO VIDEOS'); return; }
  uploadStatus.set('📤 QUICK UPLOAD...');
  try {
  const videoIndex = Math.floor(Math.random() * videoCollection.length);
  const thumbIndex = get(personalThumbnailIndex) % get(personalThumbnailCollection).length;
  const usePersonal = get(usePersonalThumbnails);
  const videoUrl = getPersonalVideo(videoIndex);
  const thumbnailUrl = usePersonal ? getPersonalThumbnail(thumbIndex) : BLACK_STORIES_MATCHER.matchToContent(title, category, thumbIndex);
  personalThumbnailIndex.update((i) => i + 1);
  const payload = { id: crypto.randomUUID(), title, category, video_url: videoUrl, thumbnail_url: thumbnailUrl, normalized_thumbnail: thumbnailUrl, likes: Math.floor(Math.random() * 1000) + 100, views: Math.floor(Math.random() * 5000) + 1000, is_personal_content: true, personal_video: videoCollection[videoIndex], personal_thumbnail: get(personalThumbnailCollection)[thumbIndex], created_at: new Date().toISOString() };
  const vault = JSON.parse((typeof window !== 'undefined' ? localStorage.getItem(CONFIG.VAULT_KEY) : null) || '[]');
  vault.push(payload);
  storageSet(CONFIG.VAULT_KEY, vault);
  uploadStatus.set(`✅ UPLOADED! Using ${videoCollection[videoIndex]}`);
  newTitle.set('');
  forceDisplayInStudio();
  await syncFromVault(true);
  return payload;
  } catch (error) { console.error('Quick upload error:', error); uploadStatus.set('❌ UPLOAD FAILED'); }
  },
  async batchUploadPersonalContent() {
  const videoCollection = get(personalVideoCollection);
  if (!videoCollection.length) { uploadStatus.set('NO PERSONAL VIDEOS'); return; }
  uploadStatus.set(`📦 BATCH UPLOADING ${videoCollection.length} VIDEOS...`);
  const batchTitles = ['Micro Stirred V3 - Director\'s Cut', 'Barbershop Chronicles Vol. 1', 'Urban Renaissance', 'The Cutting Edge', 'Style & Substance', 'Cultural Canvas', 'Modern Barber Artistry'];
  let successCount = 0;
  for (let i = 0; i < videoCollection.length && i < batchTitles.length; i++) { try { await this.quickUpload(batchTitles[i], 'Trending'); successCount++; await new Promise((resolve) => setTimeout(resolve, 1000)); } catch (error) { console.error(`Failed to upload ${videoCollection[i]}:`, error); } }
  uploadStatus.set(`✅ BATCH: ${successCount}/${videoCollection.length} UPLOADED`);
  await syncFromVault(true);
  }
  };
  return { AI_IMAGE_GENERATOR, CATEGORY_DETECTOR, ProductionAgent, BLACK_STORIES_MATCHER, PersonalUploadSystem };
}
