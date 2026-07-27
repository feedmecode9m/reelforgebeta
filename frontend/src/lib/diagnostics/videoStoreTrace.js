/**
 * BG-VIDEO-STORE-01 — trace playable video count through vault sync boundaries.
 * Instrumentation only; does not alter filter outcomes.
 */

/**
 * @param {unknown[]} items
 */
function idsFromItems(items) {
    return (Array.isArray(items) ? items : [])
        .map((item) => String(item?.id || '').trim())
        .filter(Boolean);
}

/**
 * @param {string} stage
 * @param {unknown[]} input
 * @param {unknown[]} output
 * @param {{ reasons?: string | Record<string, string>; removed?: Array<{ id: string; reason: string }>; extra?: Record<string, unknown> }} [meta]
 */
export function traceVideoStoreBoundary(stage, input, output, meta = {}) {
    const inputArr = Array.isArray(input) ? input : [];
    const outputArr = Array.isArray(output) ? output : [];
    const inputIds = idsFromItems(inputArr);
    const outputIds = idsFromItems(outputArr);
    const removedSet = new Set(outputIds);
    const removedIds = inputIds.filter((id) => !removedSet.has(id));
    /** @type {Record<string, string>} */
    const reasonsById = {};
    if (Array.isArray(meta.removed)) {
        for (const entry of meta.removed) {
            if (entry?.id) reasonsById[String(entry.id)] = String(entry.reason || 'removed');
        }
    }
    console.log('[VIDEO_STORE_TRACE]', {
        stage,
        inputCount: inputArr.length,
        outputCount: outputArr.length,
        inputIds,
        outputIds,
        removedIds,
        removalReasons: removedIds.map((id) => reasonsById[id] || meta.reasons || 'unknown'),
        reasons: meta.reasons ?? null,
        ...(meta.extra || {})
    });
}

/**
 * @param {string} stage
 * @param {unknown[]} items
 * @param {(item: Record<string, unknown>, index: number) => boolean} predicate
 * @param {(item: Record<string, unknown>, index: number) => string} reasonFor
 */
export function traceVideoStoreFilter(stage, items, predicate, reasonFor) {
    const inputArr = Array.isArray(items) ? items : [];
    /** @type {Array<{ id: string; reason: string }>} */
    const removed = [];
    const output = inputArr.filter((item, index) => {
        const keep = predicate(/** @type {Record<string, unknown>} */ (item), index);
        if (!keep) {
            removed.push({
                id: String(item?.id || '').trim() || `index:${index}`,
                reason: reasonFor(/** @type {Record<string, unknown>} */ (item), index)
            });
        }
        return keep;
    });
    traceVideoStoreBoundary(stage, inputArr, output, {
        removed,
        reasons: removed.length ? 'filter_rejected' : 'none'
    });
    return output;
}
