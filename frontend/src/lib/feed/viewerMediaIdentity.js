/**
 * Phase 6.5 — Viewer media identity + premium card intelligence.
 *
 * Video assets are canonical discovery cards.
 * Thumbnails / upload artifacts are poster artwork only — never separate shelf cards
 * unless explicitly marked publishable image content.
 *
 * Presentation-only. No category / title / description writes.
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

const MEDIA_EXT = /\.(mov|mp4|webm|m4v|avi|mkv|jpe?g|png|gif|webp|avif)(\b|$)/i;
const UUID_LIKE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMG_CAMERA = /^img[_\s-]?\d{2,}$/i;
const UPLOAD_TEMP =
    /^(blob|tmp|temp|upload|pending|hero-(video|image)-|reelforge[_-]upload)[-_]?/i;

/**
 * Basename without query/hash/path.
 * @param {unknown} value
 */
export function viewerMediaBasename(value) {
    const raw = text(value).split('?')[0].split('#')[0];
    if (!raw) return '';
    return (raw.split(/[\\/]/).pop() || raw).trim();
}

/**
 * @param {unknown} value
 */
export function stripViewerMediaExtension(value) {
    return viewerMediaBasename(value).replace(MEDIA_EXT, '').trim();
}

/**
 * True when a title/label is unsafe for audience cards (UUID, IMG_####, raw filename).
 * Empty string is unsafe (no display). Prefer blank over ugly metadata.
 * @param {unknown} value
 */
export function isUnsafeViewerCardTitle(value) {
    const raw = text(value);
    if (!raw) return true;
    if (MEDIA_EXT.test(raw)) return true;
    if (UUID_LIKE.test(raw)) return true;
    if (UUID_LIKE.test(stripViewerMediaExtension(raw))) return true;
    if (UPLOAD_TEMP.test(raw)) return true;
    const stem = stripViewerMediaExtension(raw);
    if (IMG_CAMERA.test(stem) || IMG_CAMERA.test(raw.replace(MEDIA_EXT, '').trim())) return true;
    // ALL_CAPS_SNAKE storage labels
    if (/^[A-Z0-9]+([_-][A-Z0-9]+){1,}$/.test(raw) && raw.includes('_')) return true;
    if (/^\d{6,}$/.test(raw)) return true;
    if (raw.length > 64 && !/\s/.test(raw)) return true;
    return false;
}

/**
 * Creator/edited/meaningful title only — never invent; blank if unsafe.
 * @param {Record<string, unknown> | null | undefined} reel
 * @param {{ title?: string } | null | undefined} [projection]
 * @returns {string}
 */
export function resolveSafeViewerCardTitle(reel = {}, projection = null) {
    const candidates = [
        text(projection?.title),
        text(reel?.persistentTitle),
        text(reel?.creatorTitle),
        text(reel?.editedTitle),
        text(reel?.displayTitle),
        text(reel?.title),
        text(reel?.name)
    ];
    for (const candidate of candidates) {
        if (!candidate) continue;
        if (isUnsafeViewerCardTitle(candidate)) continue;
        return candidate;
    }
    return '';
}

/**
 * Explicit opt-in for standalone image discovery cards.
 * Vault membership alone is not enough.
 * @param {Record<string, unknown> | null | undefined} reel
 */
export function isExplicitlyPublishableViewerImage(reel) {
    if (!reel || typeof reel !== 'object') return false;
    if (reel.publishableImage === true || reel.isPublishableImage === true) return true;
    if (reel.discoveryImage === true || reel.viewerPublishable === true) return true;
    if (reel.creatorPublished === true && reel.publishAsImage === true) return true;
    const kind = text(reel.contentKind || reel.discoveryKind || reel.publishKind).toLowerCase();
    if (kind === 'published_image' || kind === 'publishable_image' || kind === 'image_content') {
        return true;
    }
    return false;
}

/**
 * Image/upload artifacts that must never become discovery cards.
 * @param {Record<string, unknown> | null | undefined} reel
 * @returns {{ artifact: boolean, reason: string }}
 */
export function classifyViewerImageArtifact(reel) {
    if (!reel || typeof reel !== 'object') {
        return { artifact: false, reason: '' };
    }

    const title = text(reel.title || reel.name || reel.displayTitle);
    const fileName = text(reel.fileName || reel.file_name || reel.filename || reel.originalFilename);
    const urlBase = viewerMediaBasename(reel.url || reel.thumbnailUrl || reel.posterUrl);
    const stem = stripViewerMediaExtension(fileName || urlBase || title);

    if (reel.isGeneratedThumbnail === true || reel.generatedThumbnail === true) {
        return { artifact: true, reason: 'generated_thumbnail' };
    }
    if (reel.isUploadArtifact === true || reel.uploadArtifact === true) {
        return { artifact: true, reason: 'upload_artifact_flag' };
    }
    // Synthetic personal-thumb feed injections are artwork sources, not discovery titles
    // unless the creator thumbnail vault explicitly published the still.
    if (reel.isPersonalThumbnail === true && isExplicitlyPublishableViewerImage(reel)) {
        return { artifact: false, reason: '' };
    }
    if (reel.isPersonalThumbnail === true && !isExplicitlyPublishableViewerImage(reel)) {
        return { artifact: true, reason: 'personal_thumbnail_injection' };
    }
    if (IMG_CAMERA.test(stem) || IMG_CAMERA.test(stripViewerMediaExtension(title))) {
        return { artifact: true, reason: 'camera_img_name' };
    }
    if (UUID_LIKE.test(stem) || UUID_LIKE.test(stripViewerMediaExtension(urlBase))) {
        return { artifact: true, reason: 'uuid_filename' };
    }
    if (isUnsafeViewerCardTitle(title) && !isExplicitlyPublishableViewerImage(reel)) {
        // Title is camera/uuid/extension junk → treat as artifact for discovery.
        if (MEDIA_EXT.test(title) || IMG_CAMERA.test(stripViewerMediaExtension(title))) {
            return { artifact: true, reason: 'unsafe_image_title' };
        }
        if (UUID_LIKE.test(stripViewerMediaExtension(title))) {
            return { artifact: true, reason: 'uuid_title' };
        }
    }
    return { artifact: false, reason: '' };
}

/**
 * Should this image become a discovery shelf card?
 * @param {Record<string, unknown> | null | undefined} reel
 * @returns {{ allow: boolean, reason: string }}
 */
export function evaluateViewerImageDiscoveryEligibility(reel) {
    const artifact = classifyViewerImageArtifact(reel);
    if (artifact.artifact) {
        return { allow: false, reason: `image_artifact:${artifact.reason}` };
    }
    if (!isExplicitlyPublishableViewerImage(reel)) {
        return { allow: false, reason: 'image_not_publishable' };
    }
    return { allow: true, reason: 'publishable_image' };
}

/**
 * @param {unknown} value
 * @returns {'video' | 'image' | 'other'}
 */
export function classifyViewerMediaKindLite(value) {
    if (!value || typeof value !== 'object') return 'other';
    const reel = /** @type {Record<string, unknown>} */ (value);
    const type = text(reel.type || reel.mediaType || reel.media_type).toLowerCase();
    const url = text(reel.url || reel.mediaUrl || reel.video_url || reel.playbackUrl);
    const fileName = text(reel.fileName || reel.file_name || reel.filename);
    if (
        type === 'video' ||
        type.startsWith('video/') ||
        /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url) ||
        /\.(mp4|mov|webm|m4v)$/i.test(fileName) ||
        url.includes('/videos/') ||
        (url.includes('/prod/') && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url.split('?')[0]))
    ) {
        return 'video';
    }
    if (
        type === 'image' ||
        type === 'thumbnail' ||
        type.startsWith('image/') ||
        reel.isPersonalThumbnail ||
        reel.isCatalogImage ||
        /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url) ||
        url.includes('/thumbs/')
    ) {
        return 'image';
    }
    return 'other';
}

/**
 * Resolve canonical video + optional poster from a catalog/feed slice.
 * Suppresses image artifacts as cards; attaches usable artwork when linked.
 *
 * @param {Array<Record<string, unknown>>} items
 * @returns {{
 *   canonical: Array<{
 *     reel: Record<string, unknown>;
 *     posterUrl: string;
 *     title: string;
 *     kind: 'video' | 'image';
 *     attachedPosterId: string;
 *   }>;
 *   suppressed: Array<{
 *     assetId: string;
 *     title: string;
 *     reason: string;
 *     mediaUrl: string;
 *   }>;
 *   diagnostics: {
 *     canonicalVideos: number;
 *     publishableImages: number;
 *     suppressedImageArtifacts: number;
 *     missingIdentityLinks: number;
 *     attachedPosters: number;
 *     rows: Array<Record<string, unknown>>;
 *   };
 * }}
 */
export function resolveViewerMediaIdentities(items = []) {
    const list = (items || []).filter((r) => r && typeof r === 'object');
    /** @type {Array<Record<string, unknown>>} */
    const videos = [];
    /** @type {Array<Record<string, unknown>>} */
    const images = [];
    for (const reel of list) {
        const kind = classifyViewerMediaKindLite(reel);
        if (kind === 'video') videos.push(reel);
        else if (kind === 'image') images.push(reel);
    }

    /** @type {Map<string, Record<string, unknown>>} */
    const videoById = new Map();
    for (const v of videos) {
        const id = text(v.id);
        if (id) videoById.set(id, v);
    }

    /** @type {Array<{ assetId: string; title: string; reason: string; mediaUrl: string }>} */
    const suppressed = [];
    /** @type {Map<string, string>} */
    const posterByVideoId = new Map();
    let missingIdentityLinks = 0;
    let attachedPosters = 0;

    for (const img of images) {
        const id = text(img.id);
        const title = text(img.title || img.name);
        const mediaUrl = text(img.url || img.thumbnailUrl);
        const artifact = classifyViewerImageArtifact(img);
        const linked =
            text(img.personal_video_id) ||
            text(img.videoId) ||
            text(img.linkedReelId) ||
            text(img.parentReelId);
        const publishable = isExplicitlyPublishableViewerImage(img);

        const keepVaultStill =
            img.isPersonalThumbnail === true && publishable && !artifact.artifact;

        if (linked && videoById.has(linked)) {
            const art = text(img.url || img.thumbnailUrl || img.posterUrl);
            if (art && !posterByVideoId.has(linked)) {
                posterByVideoId.set(linked, art);
                attachedPosters += 1;
            }
            if (!keepVaultStill) {
                suppressed.push({
                    assetId: id,
                    title,
                    reason: artifact.artifact
                        ? `attached_poster:${artifact.reason}`
                        : 'attached_poster:linked_video',
                    mediaUrl
                });
                continue;
            }
        }

        // Match poster-by-URL against video thumbnailUrl (same asset artwork).
        // Shared artwork across multiple videos is presentation only — do not bind identity.
        let matchedVideoId = '';
        const imgUrlNorm = mediaUrl.split('?')[0].toLowerCase();
        if (imgUrlNorm) {
            /** @type {string[]} */
            const matchingIds = [];
            for (const v of videos) {
                const thumbs = [
                    text(v.thumbnailUrl),
                    text(v.posterUrl),
                    text(v.thumbnail_url)
                ]
                    .map((u) => u.split('?')[0].toLowerCase())
                    .filter(Boolean);
                if (thumbs.includes(imgUrlNorm)) {
                    const vid = text(v.id);
                    if (vid) matchingIds.push(vid);
                }
            }
            if (matchingIds.length === 1) {
                matchedVideoId = matchingIds[0];
            }
        }
        if (matchedVideoId) {
            if (!posterByVideoId.has(matchedVideoId) && mediaUrl) {
                posterByVideoId.set(matchedVideoId, mediaUrl);
                attachedPosters += 1;
            }
            if (!keepVaultStill) {
                suppressed.push({
                    assetId: id,
                    title,
                    reason: 'attached_poster:shared_thumbnail_url',
                    mediaUrl
                });
                continue;
            }
        }

        if (artifact.artifact || !publishable) {
            if (!linked) missingIdentityLinks += 1;
            suppressed.push({
                assetId: id,
                title,
                reason: artifact.artifact
                    ? `suppressed_artifact:${artifact.reason}`
                    : 'suppressed_not_publishable',
                mediaUrl
            });
            continue;
        }

        // Explicitly publishable image — keep as its own canonical card below.
    }

    /** @type {Array<{ reel: Record<string, unknown>; posterUrl: string; title: string; kind: 'video' | 'image'; attachedPosterId: string }>} */
    const canonical = [];

    for (const v of videos) {
        const id = text(v.id);
        const attached = posterByVideoId.get(id) || '';
        const posterUrl =
            attached ||
            text(v.thumbnailUrl) ||
            text(v.posterUrl) ||
            text(v.thumbnail_url) ||
            '';
        const enriched = attached
            ? {
                  ...v,
                  thumbnailUrl: text(v.thumbnailUrl) || attached,
                  posterUrl: text(v.posterUrl) || attached
              }
            : v;
        const attachedPosterId =
            suppressed.find(
                (s) =>
                    s.reason.startsWith('attached_poster') &&
                    (posterUrl.includes(s.assetId) || s.mediaUrl === attached)
            )?.assetId || '';

        canonical.push({
            reel: enriched,
            posterUrl,
            title: resolveSafeViewerCardTitle(enriched),
            kind: 'video',
            attachedPosterId
        });
    }

    for (const img of images) {
        const id = text(img.id);
        if (suppressed.some((s) => s.assetId === id)) continue;
        if (!isExplicitlyPublishableViewerImage(img)) continue;
        if (classifyViewerImageArtifact(img).artifact) continue;
        canonical.push({
            reel: img,
            posterUrl: text(img.url || img.thumbnailUrl || img.posterUrl),
            title: resolveSafeViewerCardTitle(img),
            kind: 'image',
            attachedPosterId: ''
        });
    }

    /** @type {Array<Record<string, unknown>>} */
    const diagRows = [
        ...canonical.map((c) => ({
            role: 'canonical',
            kind: c.kind,
            assetId: text(c.reel.id),
            title: c.title,
            posterUrl: c.posterUrl,
            attachedPosterId: c.attachedPosterId
        })),
        ...suppressed.map((s) => ({
            role: 'suppressed',
            kind: 'image',
            assetId: s.assetId,
            title: s.title,
            reason: s.reason,
            mediaUrl: s.mediaUrl
        }))
    ];

    return {
        canonical,
        suppressed,
        diagnostics: {
            canonicalVideos: canonical.filter((c) => c.kind === 'video').length,
            publishableImages: canonical.filter((c) => c.kind === 'image').length,
            suppressedImageArtifacts: suppressed.length,
            missingIdentityLinks,
            attachedPosters,
            rows: diagRows
        }
    };
}

/**
 * Console-friendly diagnostic snapshot (no network, no writes).
 * @param {Array<Record<string, unknown>>} items
 * @param {string} [stage]
 */
export function logViewerMediaIdentityDiagnostics(items, stage = 'viewer-media-identity') {
    const result = resolveViewerMediaIdentities(items);
    const payload = {
        stage,
        ...result.diagnostics,
        timestamp: new Date().toISOString()
    };
    try {
        console.info('[VIEWER_MEDIA_IDENTITY]', payload);
    } catch {
        /* ignore */
    }
    return result;
}
