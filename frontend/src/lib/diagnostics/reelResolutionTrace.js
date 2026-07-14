/**
 * Mission BG-5B — canonical reel resolution trace (logging only).
 * ENTRY / EXIT / elapsed / return payload / exceptions.
 */

/**
 * @param {string} fn
 * @param {Record<string, unknown>} [meta]
 */
export function reelResEntry(fn, meta = {}) {
    console.info(`[REEL_RES] ENTRY ${fn}`, {
        timestamp: new Date().toISOString(),
        t0: performance.now(),
        ...meta
    });
}

/**
 * @param {string} fn
 * @param {number} t0
 * @param {Record<string, unknown>} [meta]
 */
export function reelResExit(fn, t0, meta = {}) {
    console.info(`[REEL_RES] EXIT ${fn}`, {
        timestamp: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - t0),
        ...meta
    });
}

/**
 * @param {string} fn
 * @param {number} t0
 * @param {Error | unknown} error
 * @param {Record<string, unknown>} [meta]
 */
export function reelResThrow(fn, t0, error, meta = {}) {
    console.info(`[REEL_RES] EXCEPTION ${fn}`, {
        timestamp: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - t0),
        error: error?.message || String(error),
        ...meta
    });
}

/**
 * @param {string} label
 * @param {unknown} before
 * @param {unknown} after
 * @param {Record<string, unknown>} [meta]
 */
export function reelResStoreMutation(label, before, after, meta = {}) {
    console.info(`[REEL_RES] STORE ${label}`, {
        timestamp: new Date().toISOString(),
        trigger: meta.trigger || 'unknown',
        oldValue: before,
        newValue: after,
        ...meta
    });
}

/**
 * @param {string} fn
 * @param {Record<string, unknown> | null | undefined} reel
 * @param {Record<string, unknown>} [meta]
 */
export function reelResReelSnapshot(fn, reel, meta = {}) {
    console.info(`[REEL_RES] REEL ${fn}`, {
        timestamp: new Date().toISOString(),
        id: reel?.id ?? null,
        url: reel?.url ?? null,
        thumbnailUrl: reel?.thumbnailUrl ?? reel?.thumbnail_url ?? null,
        status: reel?.status ?? null,
        ready: String(reel?.status || '').toLowerCase() === 'ready',
        category: reel?.category ?? null,
        type: reel?.type ?? null,
        ...meta
    });
}

/**
 * @param {string} branch
 * @param {Record<string, unknown>} [meta]
 */
export function reelResNormalizeBranch(branch, meta = {}) {
    console.info(`[REEL_RES] NORMALIZE_BRANCH ${branch}`, {
        timestamp: new Date().toISOString(),
        ...meta
    });
}
