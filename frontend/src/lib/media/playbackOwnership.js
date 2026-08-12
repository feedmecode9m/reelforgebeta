/**
 * Single active video bandwidth owner.
 * At most one of: hero background | theater player | intentional preview.
 * Theater always wins; preview yields to theater; hero yields to preview/theater.
 */

import { writable, get } from 'svelte/store';

/** @typedef {'none' | 'hero' | 'preview' | 'theater'} PlaybackOwner */

/** @type {import('svelte/store').Writable<PlaybackOwner>} */
export const playbackOwner = writable(/** @type {PlaybackOwner} */ ('none'));

/** @type {string} */
let ownerReason = '';

/** @type {Record<PlaybackOwner, number>} */
const RANK = {
    none: 0,
    hero: 1,
    preview: 2,
    theater: 3
};

/**
 * @param {PlaybackOwner | string | null | undefined} who
 * @returns {PlaybackOwner}
 */
function normalizeOwner(who) {
    const w = String(who || 'none').trim().toLowerCase();
    if (w === 'hero' || w === 'preview' || w === 'theater' || w === 'none') {
        return /** @type {PlaybackOwner} */ (w);
    }
    return 'none';
}

/**
 * @returns {PlaybackOwner}
 */
export function getPlaybackOwner() {
    return get(playbackOwner);
}

/**
 * @returns {{ owner: PlaybackOwner; reason: string }}
 */
export function getPlaybackOwnerSnapshot() {
    return { owner: get(playbackOwner), reason: ownerReason };
}

/**
 * @param {PlaybackOwner | string} requested
 * @returns {boolean}
 */
export function canStartPlayback(requested) {
    const next = normalizeOwner(requested);
    const current = get(playbackOwner);
    if (next === 'none') return false;
    if (current === 'none' || current === next) return true;
    if (next === 'theater') return true;
    if (next === 'preview' && current === 'hero') return true;
    if (next === 'hero' && current === 'hero') return true;
    return (RANK[next] || 0) > (RANK[current] || 0);
}

/**
 * Claim exclusive bandwidth ownership. Higher-rank owners override lower rank.
 * @param {PlaybackOwner | string} requested
 * @param {string} [reason]
 * @returns {boolean} true if claimed (or already held by same owner)
 */
export function claimPlaybackOwner(requested, reason = '') {
    const next = normalizeOwner(requested);
    if (next === 'none') return false;

    const current = get(playbackOwner);
    if (current === next) {
        ownerReason = reason || ownerReason;
        return true;
    }

    if (!canStartPlayback(next) && current !== 'none') {
        if (import.meta.env?.DEV) {
            console.info('[PLAYBACK_OWNER_DENIED]', {
                requested: next,
                current,
                reason: reason || null,
                ts: new Date().toISOString()
            });
        }
        return false;
    }

    playbackOwner.set(next);
    ownerReason = String(reason || '').trim();
    if (import.meta.env?.DEV || typeof window !== 'undefined') {
        console.info('[PLAYBACK_OWNER]', {
            owner: next,
            previous: current,
            reason: ownerReason || null,
            ts: new Date().toISOString()
        });
    }
    return true;
}

/**
 * Release ownership when the owner matches (or force with '*').
 * @param {PlaybackOwner | string} expected
 * @param {string} [reason]
 * @returns {boolean}
 */
export function releasePlaybackOwner(expected, reason = '') {
    const cur = get(playbackOwner);
    const exp = String(expected || '').trim().toLowerCase();
    if (exp !== '*' && normalizeOwner(exp) !== cur) {
        return false;
    }
    playbackOwner.set('none');
    ownerReason = String(reason || '').trim();
    if (import.meta.env?.DEV) {
        console.info('[PLAYBACK_OWNER]', {
            owner: 'none',
            previous: cur,
            reason: ownerReason || null,
            ts: new Date().toISOString()
        });
    }
    return true;
}

/**
 * Helpers for MediaRenderer / diagnostics.
 * @param {HTMLVideoElement | null | undefined} el
 * @param {PlaybackOwner | string} [role]
 */
export function tagVideoPlaybackRole(el, role = '') {
    if (!el || typeof el.setAttribute !== 'function') return;
    const r = String(role || '').trim();
    if (r) el.setAttribute('data-playback-owner-role', r);
    el.setAttribute('data-playback-owner-active', getPlaybackOwner());
}

/**
 * Hero / Vault / feed preview must not attach or start network media while Theater owns playback.
 * Theater primary (role theater) is never blocked.
 *
 * @param {PlaybackOwner | string | null | undefined} role
 * @returns {boolean} true when role may bind a media source
 */
export function canAttachMediaForRole(role) {
    const r = String(role || '')
        .trim()
        .toLowerCase();
    if (!r || r === 'theater') return true;
    if (r === 'hero' || r === 'preview') {
        return getPlaybackOwner() !== 'theater';
    }
    return canStartPlayback(r);
}

/** @type {string} */
let theaterProtectedReelId = '';
/** @type {string} */
let theaterProtectedMasterUrl = '';

/**
 * Record the Theater-owned reel master so Hero/preview cannot reattach it mid-session.
 * @param {string} reelId
 * @param {string} masterUrl
 */
export function setTheaterProtectedMaster(reelId, masterUrl) {
    theaterProtectedReelId = String(reelId || '').trim();
    theaterProtectedMasterUrl = String(masterUrl || '').trim();
}

export function clearTheaterProtectedMaster() {
    theaterProtectedReelId = '';
    theaterProtectedMasterUrl = '';
}

export function getTheaterProtectedReelId() {
    return theaterProtectedReelId;
}

/**
 * True when `url` is the Theater-owned reel's bare master (not `.playback.mp4`).
 * Only active while playback owner is theater.
 *
 * @param {string | null | undefined} url
 * @returns {boolean}
 */
export function isTheaterProtectedMasterUrl(url) {
    if (getPlaybackOwner() !== 'theater') return false;
    const u = String(url || '')
        .split('?')[0]
        .trim();
    if (!u) return false;
    if (u.includes('.playback.mp4')) return false;
    const master = theaterProtectedMasterUrl.split('?')[0].trim();
    if (master && u === master) return true;
    if (theaterProtectedReelId && u.includes(`${theaterProtectedReelId}.mp4`)) return true;
    return false;
}
