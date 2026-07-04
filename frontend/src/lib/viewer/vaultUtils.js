// Vault helper utilities extracted from Viewer.svelte
import { get } from 'svelte/store';
import { resolveDisplayUrl } from '../../components/media/resolveDisplayUrl.js';
import { toRelativeMediaPath, logFinalMediaUrl, videoMimeForPath } from '../config.js';
import { isFakeThumbUrl } from '../vaultMedia.js';

export function createVaultUtils(deps) {
  const { CONFIG, personalThumbnailCollection, getFallbackImage } = deps;

  function logVaultFieldAudit(label, payload, expectedFields = ['id', 'name', 'type', 'url']) {
  const item = payload && typeof payload === 'object' ? payload : {};
  const keys = Object.keys(item);
  const missingExpected = expectedFields.filter((field) => !(field in item));
  const aliases = {
  id: item.id,
  name: item.name ?? item.title ?? item.filename,
  type: item.type,
  url: item.url ?? item.video_url ?? item.thumbnail_url ?? item.src
  };
  console.group(`[Vault Field Audit] ${label}`);
  console.log('Keys returned:', keys);
  console.log('Expected id/name/type/url — missing:', missingExpected.length ? missingExpected : '(none)');
  console.log('Resolved aliases:', aliases);
  console.log('Full payload:', payload);
  console.groupEnd();
  return { keys, missingExpected, aliases };
  }
  function logVaultFieldAuditList(label, items, expectedFields = ['id', 'name', 'type', 'url']) {
  const list = Array.isArray(items) ? items : [];
  console.group(`[Vault Field Audit] ${label} (${list.length} items)`);
  if (list.length === 0) {
  console.log('No items returned');
  console.groupEnd();
  return;
  }
  list.slice(0, 3).forEach((item, index) => logVaultFieldAudit(`${label}[${index}]`, item, expectedFields));
  if (list.length > 3) console.log(`… and ${list.length - 3} more`);
  console.groupEnd();
  }
  function getStoredThumbnailEntries() {
  if (typeof window === 'undefined') return [];
  try {
  return JSON.parse(localStorage.getItem(CONFIG.THUMBNAIL_STORAGE_KEY) || '[]');
  } catch {
  return [];
  }
  }
  /** Raw thumbnail path for MediaRenderer/MediaThumbnail — does not resolve URLs. */
  function resolveThumbnailPath(nameOrUrl, index = 0) {
  if (!nameOrUrl) return getFallbackImage();
  if (typeof nameOrUrl === 'object') {
  const direct = nameOrUrl.url || nameOrUrl.thumbnailUrl || nameOrUrl.thumbnail_url;
  if (direct) return resolveThumbnailPath(direct, index);
  if (nameOrUrl.name) return resolveThumbnailPath(nameOrUrl.name, index);
  return getFallbackImage();
  }
  const value = String(nameOrUrl).trim();
  if (!value) return getFallbackImage();
  if (value.startsWith('data:') || value.startsWith('blob:')) return value;
  if (value.startsWith('/thumbs/') || value.startsWith('/videos/')) return value;
  const stored = getStoredThumbnailEntries();
  const entry = stored.find((t) => t && (t.name === value || t.url === value));
  if (entry?.url && !entry.url.startsWith('data:') && !entry.url.startsWith('blob:')) {
  return entry.url.startsWith('/') ? entry.url : `/thumbs/${entry.url.replace(/^\/+/, '')}`;
  }
  if (entry?.preview) return entry.preview;
  if (/\.(jpe?g|png|webp|gif)$/i.test(value)) return `/thumbs/${value}`;
  const collection = get(personalThumbnailCollection);
  const name = collection[index % Math.max(collection.length, 1)];
  if (name && name !== value) {
  const byIndex = stored.find((t) => t && t.name === name);
  if (byIndex?.url && !byIndex.url.startsWith('data:') && !byIndex.url.startsWith('blob:')) {
  return byIndex.url.startsWith('/') ? byIndex.url : `/thumbs/${byIndex.url.replace(/^\/+/, '')}`;
  }
  if (byIndex?.preview) return byIndex.preview;
  if (/\.(jpe?g|png|webp|gif)$/i.test(name)) return `/thumbs/${name}`;
  }
  return getFallbackImage();
  }
  function handleVaultThumbnailError(event, item) {
  handleVaultMediaError(event, item, 'thumbnail');
  }
  function handleVaultVideoThumbError(event, video) {
  handleVaultMediaError(event, video, 'video');
  }
  function handleVaultVideoElementError(event, video, reel) {
  const el = event.currentTarget;
  const card = el?.closest('.vault-card');
  const mediaError = el?.error;
  console.error('❌ Video load failed:', {
  name: video?.name,
  url: reel?.url,
  mime: videoMimeForPath(reel?.url),
  currentSrc: el?.currentSrc || el?.src,
  code: mediaError?.code,
  message: mediaError?.message,
  timestamp: new Date().toISOString()
  });
  if (el) {
  el.style.display = 'none';
  el.removeAttribute('src');
  }
  const placeholder = document.createElement('div');
  placeholder.className = 'placeholder video-placeholder';
  placeholder.setAttribute('aria-hidden', 'true');
  placeholder.textContent = '▶';
  if (card && !card.querySelector('.video-placeholder, .placeholder')) {
  card.insertBefore(placeholder, card.querySelector('.vault-grid-chrome'));
  }
  logVaultCardLayoutDiagnostics(card, `video-${video?.name || 'unknown'}-error`);
  }
  function handleVaultVideoLoaded(event, reel) {
  const el = event.currentTarget;
  console.log('✅ Video loaded:', {
  url: reel?.url,
  mime: videoMimeForPath(reel?.url),
  videoWidth: el?.videoWidth,
  videoHeight: el?.videoHeight
  });
  logVaultCardLayoutDiagnostics(el?.closest('.vault-card'), 'video:loadeddata');
  }
  function handleVaultMediaError(event, item, kind = 'thumbnail') {
  const img = event.currentTarget;
  const card = img?.closest('.vault-card, .vault-grid-card');
  console.error(`[Vault ${kind} Img Error]`, item, img?.src);
  logVaultImageError(img, img?.src);
  if (img) {
  img.style.display = 'none';
  img.removeAttribute('src');
  }
  const mediaLayer = img?.closest('.vault-grid-media') || img?.parentElement;
  const fallback = mediaLayer?.querySelector('.video-placeholder, .thumbnail-placeholder, .placeholder');
  if (fallback) {
  fallback.style.display = 'grid';
  fallback.setAttribute('aria-hidden', 'false');
  } else if (card) {
  const placeholder = document.createElement('div');
  placeholder.className = kind === 'video' ? 'video-placeholder placeholder' : 'thumbnail-placeholder placeholder';
  placeholder.setAttribute('aria-hidden', 'true');
  placeholder.textContent = kind === 'video' ? '▶' : '🖼️';
  card.insertBefore(placeholder, card.querySelector('.vault-grid-chrome'));
  }
  logVaultCardLayoutDiagnostics(card, `${kind}-error`);
  }
  function logVaultCardLayoutDiagnostics(card, label = 'vault-card') {
  if (!card || typeof window === 'undefined') return;
  const img = card.querySelector('img');
  const videoEl = card.querySelector('video');
  const deleteBtn = card.querySelector('.thumb-delete-btn');
  const mediaLayer = card.querySelector('.vault-grid-media');
  const cardRect = card.getBoundingClientRect();
  const cardStyle = getComputedStyle(card);
  console.group(`[Vault Card Layout] ${label}`);
  console.log('card rendered size', { width: Math.round(cardRect.width), height: Math.round(cardRect.height) });
  console.log('card computed', {
  aspectRatio: cardStyle.aspectRatio,
  overflow: cardStyle.overflow,
  position: cardStyle.position,
  zIndex: cardStyle.zIndex,
  minHeight: cardStyle.minHeight,
  maxHeight: cardStyle.maxHeight
  });
  if (mediaLayer) {
  const mediaStyle = getComputedStyle(mediaLayer);
  console.log('media layer z-index', mediaStyle.zIndex);
  }
  if (img) {
  const imgStyle = getComputedStyle(img);
  console.log('img', {
  rendered: { width: img.offsetWidth, height: img.offsetHeight },
  natural: { width: img.naturalWidth, height: img.naturalHeight },
  zIndex: imgStyle.zIndex,
  display: imgStyle.display
  });
  }
  if (videoEl) {
  const videoStyle = getComputedStyle(videoEl);
  console.log('video', {
  rendered: { width: videoEl.offsetWidth, height: videoEl.offsetHeight },
  intrinsic: { width: videoEl.videoWidth, height: videoEl.videoHeight },
  zIndex: videoStyle.zIndex,
  display: videoStyle.display
  });
  }
  if (deleteBtn) {
  const btnStyle = getComputedStyle(deleteBtn);
  const chrome = card.querySelector('.vault-grid-chrome');
  console.log('delete button', { zIndex: btnStyle.zIndex, pointerEvents: btnStyle.pointerEvents, chromeZ: chrome ? getComputedStyle(chrome).zIndex : null });
  }
  console.groupEnd();
  }
  function vaultCardDiagnostics(node, label = 'vault-card') {
  const log = () => logVaultCardLayoutDiagnostics(node, label);
  requestAnimationFrame(log);
  const img = node.querySelector('img');
  const videoEl = node.querySelector('video');
  const onLoad = () => logVaultCardLayoutDiagnostics(node, `${label}:load`);
  if (img) img.addEventListener('load', onLoad);
  if (videoEl) videoEl.addEventListener('loadedmetadata', onLoad);
  return {
  destroy() {
  if (img) img.removeEventListener('load', onLoad);
  if (videoEl) videoEl.removeEventListener('loadedmetadata', onLoad);
  }
  };
  }
  /** Vault grid card: image reel — always use backend /thumbs/ path, never base64. */
  function getVaultImageReel(item, index = 0) {
  const stored = getStoredThumbnailEntries();
  const name = typeof item === 'string' ? item : item?.name;
  const entry = stored.find((t) => t && (t.name === name || t.name === item));
  let path = entry?.url || (typeof item === 'object' ? item?.url : null) || '';
  if (!path || path.startsWith('data:') || path.startsWith('blob:') || isFakeThumbUrl(path)) {
  path = name ? `/thumbs/${name}` : '';
  } else {
  path = toRelativeMediaPath(path);
  if (!path.startsWith('/thumbs/') && !path.startsWith('/videos/') && !path.startsWith('blob:') && !path.startsWith('data:')) {
  path = `/thumbs/${path.replace(/^\/+/, '')}`;
  }
  }
  const url = path || '';
  if (url) logFinalMediaUrl('vault-thumbnail', resolveDisplayUrl(url, 'thumbnail', 'getVaultImageReel'));
  return {
  name: entry?.name || name || `Image ${index + 1}`,
  type: 'image',
  url,
  thumbnailUrl: null
  };
  }

  /** Vault grid card: video reel — raw paths; MediaRenderer resolves at render. */
  function getVaultVideoReel(video) {
  const name = video?.name || 'Video';
  const url = video?.url || video?.src || video?.video_url || '';
  if (url) logFinalMediaUrl('vault-video', resolveDisplayUrl(url, 'video', 'getVaultVideoReel'));
  const thumbnailUrl = video?.thumbnail || video?.thumbnailUrl || null;
  const rawType = video?.type || '';
  const type =
  rawType === 'video' || String(rawType).startsWith('video/') || isVideo({ name, url, type: 'video' })
  ? 'video'
  : 'video';
  return { name, type, url, thumbnailUrl };
  }
  function logVaultImageError(img, src) {
  console.error('[Vault Image Error]', {
  src,
  naturalWidth: img?.naturalWidth,
  naturalHeight: img?.naturalHeight,
  complete: img?.complete
  });
  }

  return {
    logVaultFieldAudit,
    logVaultFieldAuditList,
    getStoredThumbnailEntries,
    resolveThumbnailPath,
    handleVaultThumbnailError,
    handleVaultVideoThumbError,
    handleVaultVideoElementError,
    handleVaultVideoLoaded,
    handleVaultMediaError,
    logVaultCardLayoutDiagnostics,
    vaultCardDiagnostics,
    getVaultImageReel,
    getVaultVideoReel,
    logVaultImageError
  };
}
