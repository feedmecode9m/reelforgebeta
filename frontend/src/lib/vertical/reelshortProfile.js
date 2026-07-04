/** REELSHORT vertical micro-drama profile detection (visual layer only). */

const STORAGE_KEY = 'reelforge_viewer_profile';

/** @returns {boolean} */
export function isReelshortProfileActive() {
    if (import.meta.env.VITE_REELSHORT_PROFILE === 'true' || import.meta.env.VITE_REELSHORT_PROFILE === '1') {
        return true;
    }
    if (typeof window === 'undefined') return false;
    if (new URLSearchParams(window.location.search).get('profile') === 'reelshort') return true;
    return localStorage.getItem(STORAGE_KEY) === 'reelshort';
}

/** @param {boolean} active */
export function setReelshortProfileActive(active) {
    if (typeof window === 'undefined') return;
    if (active) localStorage.setItem(STORAGE_KEY, 'reelshort');
    else localStorage.removeItem(STORAGE_KEY);
}

/** @param {unknown} item */
export function isMicroDramaContent(item) {
    if (!item || typeof item !== 'object') return false;
    const tags = /** @type {{ ai_tags?: string[] }} */ (item).ai_tags;
    if (Array.isArray(tags)) {
        return tags.some((t) => String(t).toLowerCase().includes('micro-drama'));
    }
    const title = String(/** @type {{ title?: string; name?: string }} */ (item).title || item.name || '');
    return title.toLowerCase().includes('micro-drama') || title.toLowerCase().includes('micro drama');
}

/**
 * Deterministic mock engagement metrics for studio badges (visual only).
 * @param {string} id
 */
export function mockEngagementMetrics(id) {
    const seed = String(id || 'default')
        .split('')
        .reduce((a, c) => a + c.charCodeAt(0), 0);
    const hookPct = 35 + (seed % 56);
    const points = Array.from({ length: 8 }, (_, i) => {
        const y = 14 - ((seed * (i + 3)) % 12);
        const x = i * 12;
        return `${x},${y}`;
    }).join(' ');
    return {
        hookPct,
        hookClass: hookPct > 70 ? 'hook-good' : hookPct >= 40 ? 'hook-mid' : 'hook-low',
        sparkline: `M${points}`
    };
}
