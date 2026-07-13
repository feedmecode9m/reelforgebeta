const HERO_MANAGER_STORAGE_KEY = 'reelforge_hero_manager_config';
const HERO_VIDEO_STORAGE_KEY = 'reelforge_hero_video';
const HERO_IMAGE_STORAGE_KEY = 'reelforge_hero_image';
const HERO_REEL_STORAGE_KEY = 'reelforge_hero_reel';
const HERO_DEFAULT_VIDEO = '/videos/hero-background.mp4';

function normalize(value) {
  return String(value || '').trim();
}

function normalizeUrl(value) {
  return normalize(value).split('?')[0];
}

function isHeroCategory(candidate = {}) {
  const category = normalize(
    candidate?.category ||
    candidate?.content_category ||
    candidate?.contentCategory ||
    candidate?.mediaCategory
  ).toUpperCase();
  return category === 'HERO';
}

function readHeroManagerSnapshot() {
  if (typeof window === 'undefined') {
    return { heroAssetId: '', backgroundSource: 'selection' };
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(HERO_MANAGER_STORAGE_KEY) || '{}');
    return {
      heroAssetId: normalize(parsed?.heroAssetId),
      backgroundSource: normalize(parsed?.backgroundSource || 'selection')
    };
  } catch {
    return { heroAssetId: '', backgroundSource: 'selection' };
  }
}

function readHeroStorageSnapshot() {
  if (typeof window === 'undefined') {
    return { heroVideo: '', heroImage: '' };
  }
  return {
    heroVideo: normalize(localStorage.getItem(HERO_VIDEO_STORAGE_KEY)),
    heroImage: normalize(localStorage.getItem(HERO_IMAGE_STORAGE_KEY))
  };
}

function readHeroReelSnapshot() {
  if (typeof window === 'undefined') {
    return { id: '', fileName: '', url: '' };
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(HERO_REEL_STORAGE_KEY) || 'null');
    return {
      id: normalize(parsed?.id),
      fileName: normalize(parsed?.fileName),
      url: normalizeUrl(parsed?.url)
    };
  } catch {
    return { id: '', fileName: '', url: '' };
  }
}

export function getHeroDomainSnapshot() {
  return {
    manager: readHeroManagerSnapshot(),
    storage: readHeroStorageSnapshot(),
    reel: readHeroReelSnapshot()
  };
}

export function isHeroAsset(candidate = {}, options = {}) {
  const snapshot = options.snapshot || getHeroDomainSnapshot();
  const managerHeroId = normalize(snapshot?.manager?.heroAssetId);
  const heroVideo = normalize(snapshot?.storage?.heroVideo);
  const heroImage = normalize(snapshot?.storage?.heroImage);
  const reelId = normalize(snapshot?.reel?.id);
  const reelFileName = normalize(snapshot?.reel?.fileName);
  const reelUrl = normalizeUrl(snapshot?.reel?.url);

  if (isHeroCategory(candidate)) return true;

  const id = normalize(candidate?.id || candidate?.assetId || candidate?.heroAssetId);
  const fileName = normalize(candidate?.fileName || candidate?.file_name);
  const name = normalize(candidate?.name || candidate?.title);
  const url = normalize(candidate?.url || candidate?.mediaUrl || candidate?.videoUrl || candidate?.video_url);
  const thumbnail = normalize(
    candidate?.thumbnail || candidate?.thumbnailUrl || candidate?.thumbnail_url || candidate?.posterUrl
  );

  const normalizedUrl = normalizeUrl(url);
  const normalizedThumb = normalizeUrl(thumbnail);
  const normalizedHeroVideo = normalizeUrl(heroVideo);
  const normalizedHeroImage = normalizeUrl(heroImage);

  if (reelId && id && id === reelId) return true;
  if (reelId && managerHeroId && id === managerHeroId && managerHeroId === reelId) return true;
  if (reelFileName && fileName && fileName === reelFileName) return true;
  if (reelUrl && normalizedUrl && normalizedUrl === reelUrl) return true;
  if (reelUrl && normalizedThumb && normalizedThumb === reelUrl) return true;
  if (id && managerHeroId && id === managerHeroId) return true;
  if (name.toLowerCase().includes('hero-background')) return true;
  if (normalizedUrl && normalizedUrl === HERO_DEFAULT_VIDEO) return true;
  if (normalizedUrl && normalizedHeroVideo && normalizedUrl === normalizedHeroVideo) return true;
  if (normalizedUrl && normalizedHeroImage && normalizedUrl === normalizedHeroImage) return true;
  if (normalizedThumb && normalizedHeroImage && normalizedThumb === normalizedHeroImage) return true;
  if (url && heroVideo && url === heroVideo) return true;
  if (url && heroImage && url === heroImage) return true;

  return false;
}

export function filterNonHeroAssets(items = [], options = {}) {
  if (!Array.isArray(items)) return [];
  const snapshot = options.snapshot || getHeroDomainSnapshot();
  return items.filter((item) => !isHeroAsset(item, { snapshot }));
}
