/** BG-7N — downstream feed pipeline trace (instrumentation only). */

/** @type {Set<string>} */
let mediaRendererCardIds = new Set();

/**
 * @param {unknown} source
 * @returns {Record<string, unknown>[]}
 */
export function flattenFeedCards(source) {
    if (!source) return [];
    if (Array.isArray(source)) return source.filter(Boolean);
    if (typeof source === 'object') {
        return Object.values(/** @type {Record<string, unknown[]>} */ (source)).flat().filter(Boolean);
    }
    return [];
}

/**
 * @param {unknown} source
 * @returns {string[]}
 */
export function feedCardIds(source) {
    return flattenFeedCards(source)
        .map((r) => String(r?.id || '').trim())
        .filter(Boolean);
}

/**
 * @param {string} stage
 * @param {unknown} source
 * @param {Record<string, unknown>} [extra]
 */
export function logBg7nStage(stage, source, extra = {}) {
    const ids = feedCardIds(source);
    console.info('[BG7N_STAGE]', {
        stage,
        count: ids.length,
        first: ids[0] ?? null,
        last: ids[ids.length - 1] ?? null,
        ...extra,
        timestamp: new Date().toISOString()
    });
}

/** @param {string} reelId */
export function noteBg7nMediaRendererCard(reelId) {
    const id = String(reelId || '').trim();
    if (id) mediaRendererCardIds.add(id);
}

export function flushBg7nMediaRendererStage() {
    const ids = [...mediaRendererCardIds];
    logBg7nStage('MediaRenderer', ids, { mountedCardVisuals: ids.length });
}

export function resetBg7nMediaRendererCards() {
    mediaRendererCardIds = new Set();
}

/**
 * @param {ParentNode | null | undefined} root
 */
export function logBg7nDomStage(root) {
    const scope = root && 'querySelectorAll' in root ? root : document;
    const nodes = scope.querySelectorAll('.reel-card');
    const ids = [...nodes]
        .map((n) => n.getAttribute('data-reel-id') || '')
        .filter(Boolean);
    logBg7nStage('DOM:reel-card', ids, { domNodes: nodes.length });
}

export function logBg7nLocalStorageFeed() {
    if (typeof window === 'undefined') return;
    try {
        const raw = localStorage.getItem('reelforge_feed') || '{}';
        const parsed = JSON.parse(raw);
        logBg7nStage('localStorage:reelforge_feed', parsed);
    } catch (err) {
        console.info('[BG7N_STAGE]', {
            stage: 'localStorage:reelforge_feed',
            count: 0,
            first: null,
            last: null,
            error: String(err?.message || err),
            timestamp: new Date().toISOString()
        });
    }
}

export function logBg7nLoadingGate(loading) {
    console.info('[BG7N_STAGE]', {
        stage: 'FeedExperience:loading',
        count: loading ? -1 : 0,
        first: null,
        last: null,
        loading: Boolean(loading),
        blocksRender: Boolean(loading),
        timestamp: new Date().toISOString()
    });
}
