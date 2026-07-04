import { writable, derived, get } from 'svelte/store';
import {
    DEFAULT_PUBLISHING_PROFILE,
    getPublishingProfile,
    normalizePublishingProfileId
} from './publishingProfiles.js';
import { isReelshortProfileActive } from '../vertical/reelshortProfile.js';
import { setTheaterFraming } from '../theater/theaterFraming.js';
import { logTheaterProfile } from '../theater/theaterDiagnostics.js';

export const PUBLISHING_PROFILE_STORAGE_KEY = 'reelforge_publishing_profile';
export const PUBLISHING_PROFILE_UPDATED_AT_KEY = 'reelforge_publishing_profile_updated_at';

/** @typedef {import('./publishingProfiles.js').PublishingProfileId} PublishingProfileId */

/** @returns {PublishingProfileId} */
function loadPublishingProfileId() {
    if (typeof window === 'undefined') return DEFAULT_PUBLISHING_PROFILE;

    if (isReelshortProfileActive()) return 'reelshort';

    const params = new URLSearchParams(window.location.search);
    const queryProfile = params.get('publishing') || params.get('profile');
    if (queryProfile === 'reelshort') return 'reelshort';
    if (queryProfile && getPublishingProfile(queryProfile)) {
        return normalizePublishingProfileId(queryProfile);
    }

    const stored = localStorage.getItem(PUBLISHING_PROFILE_STORAGE_KEY);
    return normalizePublishingProfileId(stored);
}

export const activePublishingProfile = writable(/** @type {PublishingProfileId} */ (DEFAULT_PUBLISHING_PROFILE));

export const publishingProfileConfig = derived(activePublishingProfile, (id) => getPublishingProfile(id));

export const metadataDisplayFlags = derived(publishingProfileConfig, (profile) => profile.metadataDisplay);

export const episodeNavigationFlags = derived(publishingProfileConfig, (profile) => profile.episodeNavigation);

export const theaterChromeFlags = derived(publishingProfileConfig, (profile) => profile.theaterChrome);

/** Back-compat alias for vertical immersive chrome behaviors. */
export const immersiveVerticalChrome = derived(theaterChromeFlags, (chrome) => chrome.immersive916);

let initialized = false;

export function initPublishingProfile() {
    if (initialized) return;
    initialized = true;
    const id = loadPublishingProfileId();
    activePublishingProfile.set(id);
    logTheaterProfile({ from: null, to: id, phase: 'init', suppressesTheater: false });
    applyProfileSideEffects(id);
}

/** @param {PublishingProfileId} id */
export function setActivePublishingProfile(id) {
    const prev = get(activePublishingProfile);
    const next = normalizePublishingProfileId(id);
    activePublishingProfile.set(next);
    if (typeof window !== 'undefined') {
        localStorage.setItem(PUBLISHING_PROFILE_STORAGE_KEY, next);
        localStorage.setItem(PUBLISHING_PROFILE_UPDATED_AT_KEY, String(Date.now()));
        window.dispatchEvent(
            new CustomEvent('reelforge:sync-schedule', { detail: { domain: 'publishingState' } })
        );
    }
    logTheaterProfile({
        from: prev,
        to: next,
        suppressesTheater: false,
        immersive916: getPublishingProfile(next).theaterChrome.immersive916
    });
    applyProfileSideEffects(next);
}

/** @param {PublishingProfileId} id */
function applyProfileSideEffects(id) {
    const profile = getPublishingProfile(id);
    setTheaterFraming(profile.theaterChrome.defaultFraming);
}

/** @param {import('svelte/store').Writable<boolean>} reelshortActiveStore */
export function syncReelshortActiveStore(reelshortActiveStore) {
    return immersiveVerticalChrome.subscribe((active) => {
        reelshortActiveStore.set(active && get(activePublishingProfile) === 'reelshort');
    });
}
