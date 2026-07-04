import { writable, get } from 'svelte/store';

export const THEATER_FRAMING_KEY = 'reelforge_theater_framing';
export const FRAMING_MODES = /** @type {const} */ (['fill', 'fit', 'smart']);
/** @typedef {(typeof FRAMING_MODES)[number]} TheaterFramingMode */
export const DEFAULT_THEATER_FRAMING = /** @type {TheaterFramingMode} */ ('smart');

/** @param {string | null | undefined} value */
function normalizeFraming(value) {
    return FRAMING_MODES.includes(/** @type {TheaterFramingMode} */ (value))
        ? /** @type {TheaterFramingMode} */ (value)
        : DEFAULT_THEATER_FRAMING;
}

/** @returns {TheaterFramingMode} */
function loadTheaterFraming() {
    if (typeof window === 'undefined') return DEFAULT_THEATER_FRAMING;
    return normalizeFraming(localStorage.getItem(THEATER_FRAMING_KEY));
}

export const theaterFraming = writable(loadTheaterFraming());

/** @param {TheaterFramingMode} mode */
export function setTheaterFraming(mode) {
    const next = normalizeFraming(mode);
    theaterFraming.set(next);
    if (typeof window !== 'undefined') {
        localStorage.setItem(THEATER_FRAMING_KEY, next);
    }
}

export function cycleTheaterFraming() {
    const current = get(theaterFraming);
    const idx = FRAMING_MODES.indexOf(current);
    setTheaterFraming(FRAMING_MODES[(idx + 1) % FRAMING_MODES.length]);
}
