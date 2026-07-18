/** BG-7H — drag/drop discoverability helpers (UX only, no upload behavior). */

export const MEDIA_UPLOAD_INTENT_KEY = 'reelforge_media_upload_intent';
export const STUDIO_SELECT_CONTENT_TAB_EVENT = 'reelforge:studio-select-content-tab';

/**
 * @param {DragEvent} event
 * @returns {boolean}
 */
export function isLikelyMediaDrag(event) {
    const dt = event?.dataTransfer;
    if (!dt) return false;
    const types = Array.from(dt.types || []);
    if (types.includes('Files')) return true;
    return types.some((t) => /video|image|file/i.test(String(t)));
}

/** @param {string} source */
export function markMediaUploadIntent(source = 'unknown') {
    if (typeof window === 'undefined') return;
    try {
        sessionStorage.setItem(
            MEDIA_UPLOAD_INTENT_KEY,
            JSON.stringify({ source, at: Date.now() })
        );
    } catch {
        // ignore quota errors
    }
}

/** @returns {boolean} */
export function consumeMediaUploadIntent(maxAgeMs = 5 * 60 * 1000) {
    if (typeof window === 'undefined') return false;
    try {
        const raw = sessionStorage.getItem(MEDIA_UPLOAD_INTENT_KEY);
        if (!raw) return false;
        sessionStorage.removeItem(MEDIA_UPLOAD_INTENT_KEY);
        const parsed = JSON.parse(raw);
        const at = Number(parsed?.at || 0);
        if (!at || Date.now() - at > maxAgeMs) return false;
        return true;
    } catch {
        return false;
    }
}

/**
 * @param {string} surface
 * @param {string} reason
 * @param {{ fileName?: string | null; fileSize?: number | null; fileCount?: number; detail?: string }} [extra]
 */
export function logDropMiss(surface, reason, extra = {}) {
    console.info('[BG7H_DROP_MISS]', {
        surface,
        reason,
        ts: new Date().toISOString(),
        fileName: extra.fileName ?? null,
        fileSize: extra.fileSize ?? null,
        fileCount: extra.fileCount ?? null,
        detail: extra.detail ?? null
    });
}

/** @param {{ scrollUploadZones?: boolean; source?: string }} [detail] */
export function requestStudioContentTab(detail = {}) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(STUDIO_SELECT_CONTENT_TAB_EVENT, { detail }));
}
