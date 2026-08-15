// Vault helper utilities extracted from Viewer.svelte
import { get } from 'svelte/store';
import { resolveDisplayUrl } from '../../components/media/resolveDisplayUrl.js';
import { toRelativeMediaPath, logFinalMediaUrl, videoMimeForPath } from '../config.js';
import { isFakeThumbUrl, filenameFromMediaRef } from '../vaultMedia.js';
import { pickDurableVaultStillUrl } from '../vault/vaultCreatorAuthority.js';
import { isVaultVideoMediaUrl } from '../vault/normalizeVaultAsset.js';

const UUID_FILE_STEM =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fileStemFromName(name) {
  return String(name || '').replace(/\.[^.]+$/i, '');
}

function isUuidThumbFileName(name) {
  const base = filenameFromMediaRef(name) || String(name || '').trim();
  return UUID_FILE_STEM.test(fileStemFromName(base));
}

/**
 * Local disk thumbs are `/thumbs/{id}.jpg`. Original camera names
 * (`IMG_0121.JPEG`) are not served after refresh / blob expiry.
 */
export function durableImageVaultUrl(entry, item) {
  const id = String(
    entry?.id || (item && typeof item === 'object' ? item.id : '') || ''
  ).trim();
  const candidates = [
    entry?.url,
    entry?.thumbnailUrl,
    entry?.thumbnail_url,
    entry?.thumbnail,
    item && typeof item === 'object' ? item.url : '',
    item && typeof item === 'object' ? item.thumbnailUrl : '',
    item && typeof item === 'object' ? item.thumbnail_url : ''
  ];
  for (const candidate of candidates) {
    const s = String(candidate || '').trim();
    if (!s || s.startsWith('blob:') || s.startsWith('data:')) continue;
    if (isVaultVideoMediaUrl(s)) continue;
    const base = filenameFromMediaRef(s);
    const stem = fileStemFromName(base);
    if (id && stem && stem.toLowerCase() !== id.toLowerCase() && !isUuidThumbFileName(base)) {
      continue;
    }
    if (/^https?:\/\//i.test(s) || s.startsWith('/thumbs/')) return s;
  }
  if (id) return `/thumbs/${id}.jpg`;
  const fileName = String(entry?.fileName || entry?.file_name || '').trim();
  if (fileName && isUuidThumbFileName(fileName)) {
    const base = filenameFromMediaRef(fileName) || fileName.replace(/^thumbs\//i, '');
    return `/thumbs/${base.replace(/^thumbs\//i, '')}`;
  }
  return '';
}

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
  const raw = JSON.parse(localStorage.getItem(CONFIG.THUMBNAIL_STORAGE_KEY) || '[]');
  console.info('[VAULT_STORAGE]', {
  key: CONFIG.THUMBNAIL_STORAGE_KEY,
  action: 'getStoredThumbnailEntries',
  count: Array.isArray(raw) ? raw.length : 0,
  ts: new Date().toISOString()
  });
  return raw;
  } catch {
  return [];
  }
  }
  /** Raw thumbnail path for MediaRenderer/MediaThumbnail — does not resolve URLs. */
  function thumbPathFromFileKey(key) {
    const basename = filenameFromMediaRef(String(key || '').trim());
    if (!basename || !/\.(jpe?g|png|gif|webp)$/i.test(basename)) return '';
    return `/thumbs/${basename.replace(/^thumbs\//, '')}`;
  }
  function findStoredThumbnailEntry(stored, item, index = 0) {
  const key = typeof item === 'string' ? item.trim() : String(item?.fileName || item?.file_name || item?.id || item?.url || '').trim();
  if (key) {
  const keyBase = filenameFromMediaRef(key);
  for (const t of stored) {
    if (typeof t === 'string') {
      const raw = String(t).trim();
      if (raw === key || raw === keyBase || filenameFromMediaRef(raw) === keyBase) {
        const fileName = filenameFromMediaRef(raw) || raw;
        return { fileName, url: thumbPathFromFileKey(fileName) };
      }
      continue;
    }
  }
  const byId = stored.find((t) => t && typeof t === 'object' && String(t.id || '').trim() === key);
  if (byId) return byId;
  const byFile = stored.find((t) => t && typeof t === 'object' && String(t.fileName || t.file_name || '').trim() === key);
  if (byFile) return byFile;
  const byName = stored.find((t) => {
    if (!t || typeof t !== 'object') return false;
    const name = String(t.name || t.title || '').trim();
    return name === key || (keyBase && name === keyBase);
  });
  if (byName) return byName;
  if (keyBase && keyBase !== key) {
    const byFileBase = stored.find(
      (t) => t && typeof t === 'object' && String(t.fileName || t.file_name || '').trim() === keyBase
    );
    if (byFileBase) return byFileBase;
  }
  const byUrl = stored.find((t) => {
  if (!t?.url || typeof t !== 'object') return false;
  const rel = toRelativeMediaPath(String(t.url));
  return rel === key || rel.endsWith(`/${key}`) || filenameFromMediaRef(t.url) === key || filenameFromMediaRef(t.url) === keyBase;
  });
  if (byUrl) return byUrl;
  }
  return null;
  }
  function resolveThumbnailPath(nameOrUrl, index = 0) {
  if (!nameOrUrl) return getFallbackImage();
  if (typeof nameOrUrl === 'object') {
    const durable = durableImageVaultUrl(nameOrUrl, nameOrUrl);
    if (durable) return durable;
  const direct = nameOrUrl.url || nameOrUrl.thumbnailUrl || nameOrUrl.thumbnail_url;
  if (direct) return resolveThumbnailPath(direct, index);
  if (nameOrUrl.fileName || nameOrUrl.file_name) return resolveThumbnailPath(nameOrUrl.fileName || nameOrUrl.file_name, index);
  if (nameOrUrl.id) return resolveThumbnailPath(nameOrUrl.id, index);
  return getFallbackImage();
  }
  const value = String(nameOrUrl).trim();
  if (!value) return getFallbackImage();
  if (value.startsWith('data:') || value.startsWith('blob:')) return value;
  const stored = getStoredThumbnailEntries();
  const entry = findStoredThumbnailEntry(stored, value, index);
  const durable = durableImageVaultUrl(entry, typeof nameOrUrl === 'object' ? nameOrUrl : { fileName: value, url: value });
  if (durable) return durable;
  // Absolute API thumbs (Netlify/Railway) — never re-prefix as `/thumbs/https://…`.
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/thumbs/') || value.startsWith('/videos/')) return value;
  if (entry?.url && !entry.url.startsWith('data:') && !entry.url.startsWith('blob:')) {
  const raw = String(entry.url).trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const rel = toRelativeMediaPath(raw);
  if (/^https?:\/\//i.test(rel)) return rel;
  return rel.startsWith('/thumbs/') ? rel : `/thumbs/${rel.replace(/^\/+/, '').replace(/^thumbs\//, '')}`;
  }
  if (entry?.preview) return entry.preview;
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
  const logDomFace = () => {
    if (!import.meta.env.DEV) return;
    if (!String(label).startsWith('video-') && !String(label).startsWith('thumb-')) return;
    const img = node.querySelector('img');
    const ph = node.querySelector('.placeholder');
    const csImg = img ? getComputedStyle(img) : null;
    const csPh = ph ? getComputedStyle(ph) : null;
    const csCard = getComputedStyle(node);
    const src = img?.currentSrc || img?.getAttribute('src') || '';
    const cardRect = node.getBoundingClientRect();
    const imgRect = img?.getBoundingClientRect();
    const cx = cardRect.left + cardRect.width / 2;
    const cy = cardRect.top + cardRect.height / 2;
    const hit = typeof document !== 'undefined' ? document.elementFromPoint(cx, cy) : null;
    const covering = [...node.children]
      .filter((ch) => ch !== img)
      .map((ch) => {
        const r = ch.getBoundingClientRect();
        const cs = getComputedStyle(ch);
        return {
          cls: String(ch.className || '').slice(0, 80),
          zIndex: cs.zIndex,
          opacity: cs.opacity,
          bg: cs.backgroundColor,
          w: Math.round(r.width),
          h: Math.round(r.height)
        };
      });
    console.info('[LOCAL_VAULT_DOM_FACE_TRACE]', {
      assetId: String(node.getAttribute('data-vault-asset-id') || ''),
      cardFaceRender: String(node.getAttribute('data-vault-face-render') || ''),
      cardFaceSrc: String(node.getAttribute('data-vault-face-src') || ''),
      imgExists: Boolean(img),
      imgSrc: src,
      imgIsMp4: /\.mp4(\?|$)/i.test(src),
      display: csImg?.display || '',
      visibility: csImg?.visibility || '',
      opacity: csImg?.opacity || '',
      zIndex: csImg?.zIndex || '',
      placeholderExists: Boolean(ph),
      placeholderVisibility: csPh?.visibility || '',
      placeholderDisplay: csPh?.display || '',
      placeholderZIndex: csPh?.zIndex || '',
      ts: new Date().toISOString()
    });
    console.info('[LOCAL_VAULT_VISUAL_TRACE]', {
      assetId: String(node.getAttribute('data-vault-asset-id') || ''),
      cardRect: {
        w: Math.round(cardRect.width),
        h: Math.round(cardRect.height)
      },
      imgRect: imgRect
        ? { w: Math.round(imgRect.width), h: Math.round(imgRect.height) }
        : null,
      imgPosition: csImg?.position || '',
      imgZIndex: csImg?.zIndex || '',
      cardOverflow: csCard.overflow,
      cardContain: csCard.contain,
      coveringSiblings: covering,
      elementFromPoint: hit
        ? {
            tag: hit.tagName,
            cls: String(hit.className || '').slice(0, 80)
          }
        : null,
      ts: new Date().toISOString()
    });
  };
  requestAnimationFrame(() => {
    log();
    logDomFace();
  });
  const img = node.querySelector('img');
  const videoEl = node.querySelector('video');
  const onLoad = () => {
    logVaultCardLayoutDiagnostics(node, `${label}:load`);
    logDomFace();
  };
  if (img) img.addEventListener('load', onLoad);
  if (videoEl) videoEl.addEventListener('loadedmetadata', onLoad);
  return {
  destroy() {
  if (img) img.removeEventListener('load', onLoad);
  if (videoEl) videoEl.removeEventListener('loadedmetadata', onLoad);
  }
  };
  }
  /** Vault grid card: image reel — only from stored vault entry (never invent /thumbs/ ghosts). */
  function getVaultImageReel(item, index = 0) {
  const stored = getStoredThumbnailEntries();
  const lookupKey = typeof item === 'string' ? item : String(item?.fileName || item?.file_name || item?.id || '').trim();
  let entry = findStoredThumbnailEntry(stored, lookupKey || item, index);
  // Collection keys without a matching metadata entry must render as empty placeholders —
  // synthesizing /thumbs/{key} after delete made "placeholder" cards keep showing images.
  // Exception: in-memory collection objects still carrying url/fileName (e.g. after a
  // quota wipe of personal_thumbnails) should keep rendering until sync restores metadata.
  if (!entry && item && typeof item === 'object') {
    const directUrl = String(item.url || item.thumbnailUrl || item.thumbnail_url || '').trim();
    const fileName = String(item.fileName || item.file_name || '').trim();
    if (directUrl || fileName) {
      entry = {
        id: item.id,
        title: item.title || item.name,
        name: item.name || item.title,
        fileName: fileName || filenameFromMediaRef(directUrl),
        url: directUrl,
        orphaned: item.orphaned === true
      };
    }
  }
  if (!entry && typeof item === 'string') {
    const base = filenameFromMediaRef(item) || String(item).trim();
    // Collection still lists this key — rebuild path even if metadata was quota-wiped.
    // Delete flows remove the key from the collection, so this does not resurrect deletes.
    // Do not invent `/thumbs/IMG_0121.JPEG` — that file is not on disk after refresh.
    if (base && /\.(jpe?g|png|gif|webp)$/i.test(base) && isUuidThumbFileName(base)) {
      entry = { fileName: base, url: thumbPathFromFileKey(base), name: base };
    }
  }
  if (!entry) {
    return {
      name: `Image ${index + 1}`,
      type: 'image',
      url: '',
      thumbnailUrl: null,
      missing: true
    };
  }
  let path = entry?.url || (typeof item === 'object' ? item?.url || item?.thumbnailUrl : null) || '';
  if (path.startsWith('data:') || path.startsWith('blob:')) {
    const displayName = entry?.title || entry?.name || `Image ${index + 1}`;
    return {
      name: displayName,
      type: 'image',
      url: path,
      thumbnailUrl: path
    };
  }
  const recovered = durableImageVaultUrl(entry, item);
  if (recovered) {
    const displayName = entry?.title || entry?.name || `Image ${index + 1}`;
    if (import.meta.env.DEV) {
      console.info('[LOCAL_VAULT_FACE_TRACE]', {
        stage: 'getVaultImageReel',
        assetId: String(entry?.id || item?.id || ''),
        url: recovered,
        fileName: String(entry?.fileName || ''),
        storedUrl: String(entry?.url || ''),
        renderMode: 'image',
        ts: new Date().toISOString()
      });
    }
    return {
      name: displayName,
      type: 'image',
      url: recovered,
      thumbnailUrl: recovered
    };
  }
  if (entry && typeof entry === 'object' && (entry.orphaned || entry.vaultState === 'ORPHANED')) {
    return {
      name: entry.title || entry.name || `Image ${index + 1}`,
      type: 'image',
      url: '',
      thumbnailUrl: null,
      orphaned: true
    };
  }
  if (!path || isFakeThumbUrl(path)) {
  const diskKey = String(entry?.fileName || entry?.file_name || '').trim() || filenameFromMediaRef(entry?.url);
  path =
    diskKey && isUuidThumbFileName(diskKey)
      ? `/thumbs/${diskKey.replace(/^\/+/, '').replace(/^thumbs\//, '')}`
      : '';
  } else {
  path = toRelativeMediaPath(path);
  if (
    !path.startsWith('/thumbs/') &&
    !path.startsWith('/videos/') &&
    !path.startsWith('blob:') &&
    !path.startsWith('data:') &&
    !/^https?:\/\//i.test(path)
  ) {
  const diskKey = String(entry?.fileName || entry?.file_name || '').trim() || filenameFromMediaRef(path);
  path = diskKey ? `/thumbs/${diskKey.replace(/^\/+/, '').replace(/^thumbs\//, '')}` : '';
  }
  }
  const url = path || '';
  const displayName = entry?.title || entry?.name || `Image ${index + 1}`;
  if (url) logFinalMediaUrl('vault-thumbnail', resolveDisplayUrl(url, 'thumbnail', 'getVaultImageReel'));
  return {
  name: displayName,
  type: 'image',
  url,
  thumbnailUrl: url || null
  };
  }

  /**
   * Image vault (`personal_thumbnails`) still bound to this video by id / filename.
   * Image rows typically store the JPEG on `url`, not `thumbnailUrl`.
   */
  function pickBoundThumbnailVaultStill(video) {
    const id = String(video?.id || video?.assetId || '').trim();
    if (!id) return '';
    let collection = [];
    try {
      collection = Array.isArray(get(personalThumbnailCollection))
        ? get(personalThumbnailCollection)
        : [];
    } catch {
      collection = [];
    }
    for (const row of collection) {
      if (!row) continue;
      if (typeof row === 'string') {
        const raw = row.trim();
        if (!raw.includes(id)) continue;
        const asUrl =
          raw.startsWith('http') || raw.startsWith('/')
            ? raw
            : `/thumbs/${filenameFromMediaRef(raw)}`;
        if (asUrl && !isVaultVideoMediaUrl(asUrl)) return asUrl;
        continue;
      }
      const pid = String(row.personal_video_id || row.videoId || '').trim();
      const rid = String(row.id || row.assetId || '').trim();
      const fileName = String(
        row.fileName || row.file_name || filenameFromMediaRef(row.url) || ''
      ).trim();
      const url = String(row.url || row.thumbnailUrl || row.thumbnail || '').trim();
      const linked =
        pid === id ||
        rid === id ||
        fileName.startsWith(id) ||
        url.includes(`/${id}.`) ||
        url.includes(`/thumbs/${id}`);
      if (!linked) continue;
      const durable = pickDurableVaultStillUrl(row);
      if (durable) return durable;
      if (url && !url.startsWith('blob:') && !url.startsWith('data:') && !isVaultVideoMediaUrl(url)) {
        return url;
      }
    }
    return '';
  }

  function pickVaultPlaybackUrl(video) {
    const candidates = [
      video?.url,
      video?.src,
      video?.video_url,
      video?.videoUrl,
      video?.mediaUrl
    ];
    for (const candidate of candidates) {
      const s = String(candidate ?? '').trim();
      if (!s) continue;
      if (s.startsWith('blob:') || s.startsWith('data:')) return s;
      if (isVaultVideoMediaUrl(s)) return s;
    }
    return '';
  }

  /** Vault grid card: video reel — raw paths; MediaRenderer resolves at render. */
  function getVaultVideoReel(video) {
  const name = video?.name || 'Video';
  const url = pickVaultPlaybackUrl(video);
  if (url) logFinalMediaUrl('vault-video', resolveDisplayUrl(url, 'video', 'getVaultVideoReel'));
  const boundStill = pickBoundThumbnailVaultStill(video);
  const durableStill = pickDurableVaultStillUrl(video) || boundStill;
  const blobPreview = [video?.localPreviewUrl, video?.previewUrl, video?.thumbnailUrl]
    .map((v) => String(v || '').trim())
    .find((s) => s.startsWith('blob:') || s.startsWith('data:')) || '';
  const thumbnailUrl = durableStill || blobPreview || '';
  const reel = {
    name,
    type: 'video',
    url,
    thumbnailUrl,
    thumbnail: durableStill || video?.thumbnail || '',
    posterUrl: durableStill || video?.posterUrl || video?.poster_url || '',
    previewUrl: video?.previewUrl || '',
    localPreviewUrl: video?.localPreviewUrl || ''
  };
  if (import.meta.env.DEV) {
    const face = { src: durableStill || blobPreview || '', render: durableStill ? 'image' : blobPreview ? 'local-preview' : 'empty' };
    console.info('[LOCAL_VAULT_FACE_TRACE]', {
      stage: 'getVaultVideoReel',
      assetId: String(video?.id || video?.assetId || ''),
      url: reel.url,
      thumbnail: String(video?.thumbnail || ''),
      thumbnailUrl: String(video?.thumbnailUrl || ''),
      posterUrl: String(video?.posterUrl || ''),
      previewUrl: String(video?.previewUrl || ''),
      localPreviewUrl: String(video?.localPreviewUrl || ''),
      boundFromThumbnailVault: Boolean(boundStill && boundStill === durableStill),
      resolvedFace: { src: thumbnailUrl, render: face.render },
      renderMode: face.render,
      ts: new Date().toISOString()
    });
  }
  return reel;
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
