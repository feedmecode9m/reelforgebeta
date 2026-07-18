/** BG-7K — temporary feed card render gate audit (trace only). */

const MAX_NORMALIZE_LOGS = 20;
const MAX_CARD_RENDER_LOGS = 30;

let normalizeLogCount = 0;
let cardRenderLogCount = 0;

/**
 * @param {number} count
 * @param {string[]} sampleIds
 * @param {string} [source]
 */
export function logBg7kCatalogReceive(count, sampleIds = [], source = 'unknown') {
    console.info('[BG7K_CATALOG_RECEIVE]', {
        count,
        sampleIds: sampleIds.slice(0, 8),
        source,
        timestamp: new Date().toISOString()
    });
}

/**
 * @param {string} id
 * @param {string} originalUrl
 * @param {string} normalizedUrl
 * @param {string} thumbnailUrl
 * @param {string} [endpoint]
 */
export function logBg7kCardNormalize(id, originalUrl, normalizedUrl, thumbnailUrl, endpoint = 'unknown') {
    const force =
        !normalizedUrl ||
        (originalUrl && normalizedUrl !== originalUrl && normalizeLogCount >= MAX_NORMALIZE_LOGS);
    if (normalizeLogCount >= MAX_NORMALIZE_LOGS && !force) return;
    normalizeLogCount += 1;
    console.info('[BG7K_CARD_NORMALIZE]', {
        id: id || '',
        originalUrl: originalUrl || '',
        normalizedUrl: normalizedUrl || '',
        thumbnailUrl: thumbnailUrl || '',
        endpoint,
        timestamp: new Date().toISOString()
    });
}

/**
 * @param {string} id
 * @param {string} reason
 * @param {Record<string, unknown>} [extra]
 */
export function logBg7kPlaceholderFallback(id, reason, extra = {}) {
    console.info('[BG7K_PLACEHOLDER_FALLBACK]', {
        id: id || '',
        reason,
        ...extra,
        timestamp: new Date().toISOString()
    });
}

/**
 * @param {string} id
 * @param {string} mediaSrc
 * @param {Record<string, unknown>} [extra]
 */
export function logBg7kCardRender(id, mediaSrc, extra = {}) {
    if (cardRenderLogCount >= MAX_CARD_RENDER_LOGS) return;
    cardRenderLogCount += 1;
    console.info('[BG7K_CARD_RENDER]', {
        id: id || '',
        mediaSrc: mediaSrc || '',
        rendered: true,
        ...extra,
        timestamp: new Date().toISOString()
    });
}

/** Reset counters for test harness page reloads within same session. */
export function resetBg7kCardTraceCounters() {
    normalizeLogCount = 0;
    cardRenderLogCount = 0;
}
