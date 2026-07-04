import { get } from 'svelte/store';
import { activePublishingProfile } from '../publishing/publishingProfileStore.js';
import { recordTheaterOpen } from '../observability/platformMetrics.js';

/** @param {number} [stackIndex] */
export function theaterDebugCaller(stackIndex = 2) {
    try {
        return new Error().stack?.split('\n')[stackIndex]?.trim() || 'unknown';
    } catch (_) {
        return 'unknown';
    }
}

/** @returns {string} */
export function theaterDebugProfile() {
    try {
        return get(activePublishingProfile);
    } catch (_) {
        return 'unknown';
    }
}

/**
 * @param {string} tag
 * @param {Record<string, unknown>} [data]
 */
export function logTheaterDiag(tag, data = {}) {
    console.log(tag, {
        timestamp: Date.now(),
        profile: theaterDebugProfile(),
        caller: theaterDebugCaller(3),
        ...data
    });
}

/**
 * @param {Record<string, unknown> | null | undefined} reel
 * @param {Record<string, unknown>} [extra]
 */
export function logTheaterOpen(reel, extra = {}) {
    logTheaterDiag('[THEATER OPEN]', {
        reelId: reel?.id ?? null,
        reelTitle: reel?.title ?? reel?.name ?? null,
        reelUrl: reel?.url ?? reel?.video_url ?? null,
        isPlaceholder: Boolean(reel?.isPlaceholder),
        ...extra
    });
    if (reel) {
        recordTheaterOpen(reel, extra);
    }
}

/**
 * @param {Record<string, unknown>} [extra]
 */
export function logTheaterClose(extra = {}) {
    logTheaterDiag('[THEATER CLOSE]', extra);
}

/**
 * @param {Record<string, unknown>} [extra]
 */
export function logTheaterState(extra = {}) {
    logTheaterDiag('[THEATER STATE]', extra);
}

/**
 * @param {Record<string, unknown>} [extra]
 */
export function logTheaterProfile(extra = {}) {
    logTheaterDiag('[THEATER PROFILE]', extra);
}

/**
 * @param {Record<string, unknown>} [extra]
 */
export function logTheaterMedia(extra = {}) {
    logTheaterDiag('[THEATER MEDIA]', extra);
}
