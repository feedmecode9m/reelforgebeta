import { safeStorageSet, clearOldestThumbnailData } from '../lib/storage.js';

export const HERO_STATE_KEY = 'heroBackgroundState';
export const HERO_STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const HERO_TIMEUPDATE_DEBOUNCE_MS = 500;
export const HERO_RESUME_TOAST_THRESHOLD_S = 10;

const DEBUG = false;

/** @typedef {{ currentTime: number; paused: boolean; volume: number; muted: boolean; playbackRate: number; timestamp: number }} HeroBackgroundState */

/**
 * @returns {HeroBackgroundState | null}
 */
export function loadHeroBackgroundState() {
    if (typeof window === 'undefined') return null;

    try {
        const raw = localStorage.getItem(HERO_STATE_KEY);
        if (!raw) return null;

        const state = JSON.parse(raw);
        if (!state || typeof state !== 'object') return null;

        const age = Date.now() - (state.timestamp || 0);
        if (age > HERO_STATE_MAX_AGE_MS) {
            if (DEBUG) console.log('[heroStore] restore skipped — state older than 24h');
            localStorage.removeItem(HERO_STATE_KEY);
            return null;
        }

        if (DEBUG) console.log('[heroStore] restore loaded', state);
        return state;
    } catch (error) {
        console.warn('[heroStore] failed to load state', error);
        return null;
    }
}

/**
 * @param {HTMLVideoElement | null | undefined} video
 * @returns {HeroBackgroundState | null}
 */
export function captureHeroBackgroundState(video) {
    if (!video) return null;

    return {
        currentTime: video.currentTime || 0,
        paused: video.paused,
        volume: video.volume,
        muted: video.muted,
        playbackRate: video.playbackRate || 1,
        timestamp: Date.now()
    };
}

/**
 * @param {HeroBackgroundState | null | undefined} state
 */
export function saveHeroBackgroundState(state) {
    if (typeof window === 'undefined' || !state) return;

    if (DEBUG) console.log('[heroStore] save', state);

    const result = safeStorageSet(HERO_STATE_KEY, state, {
        thumbnailKey: 'personal_thumbnails'
    });

    if (!result.ok && result.error?.name === 'QuotaExceededError') {
        clearOldestThumbnailData('personal_thumbnails', 5);
        safeStorageSet(HERO_STATE_KEY, state, {
            thumbnailKey: 'personal_thumbnails',
            skipEviction: true
        });
    }
}

/**
 * @param {HTMLVideoElement} video
 * @param {HeroBackgroundState} state
 * @param {{ onRestoring?: (active: boolean) => void; onResumeToast?: (message: string) => void }} [callbacks]
 * @returns {Promise<boolean>}
 */
export async function restoreHeroBackgroundState(video, state, callbacks = {}) {
    if (!video || !state) return false;

    const { onRestoring, onResumeToast } = callbacks;

    try {
        onRestoring?.(true);

        video.volume = typeof state.volume === 'number' ? state.volume : 1;
        video.muted = Boolean(state.muted);
        video.playbackRate = typeof state.playbackRate === 'number' ? state.playbackRate : 1;

        const targetTime = typeof state.currentTime === 'number' ? state.currentTime : 0;
        if (targetTime > 0 && Number.isFinite(video.duration) && video.duration > 0) {
            video.currentTime = Math.min(targetTime, video.duration - 0.05);
        } else if (targetTime > 0) {
            video.currentTime = targetTime;
        }

        if (targetTime >= HERO_RESUME_TOAST_THRESHOLD_S) {
            onResumeToast?.('Resuming...');
        }

        const shouldAutoplay = state.paused === false || Boolean(video.autoplay);
        if (shouldAutoplay) {
            try {
                await video.play();
            } catch (playError) {
                if (DEBUG) console.log('[heroStore] autoplay blocked on restore', playError);
                video.muted = true;
                try {
                    await video.play();
                } catch {
                    // Browser autoplay policy — remain paused
                }
            }
        } else {
            video.pause();
        }

        if (DEBUG) {
            console.log('[heroStore] restore applied', {
                currentTime: video.currentTime,
                paused: video.paused,
                volume: video.volume,
                muted: video.muted,
                playbackRate: video.playbackRate
            });
        }

        return true;
    } catch (error) {
        console.warn('[heroStore] restore failed', error);
        return false;
    } finally {
        onRestoring?.(false);
    }
}

/**
 * @param {HTMLVideoElement} video
 * @param {{ onRestoring?: (active: boolean) => void; onResumeToast?: (message: string) => void }} [callbacks]
 * @returns {() => void}
 */
export function attachHeroPersistence(video, callbacks = {}) {
    let timeupdateTimer = null;
    let restoring = false;

    const persist = () => {
        if (restoring) return;
        saveHeroBackgroundState(captureHeroBackgroundState(video));
    };

    const debouncedTimeUpdate = () => {
        if (restoring) return;
        clearTimeout(timeupdateTimer);
        timeupdateTimer = setTimeout(persist, HERO_TIMEUPDATE_DEBOUNCE_MS);
    };

    const onPlay = persist;
    const onPause = persist;
    const onVolumeChange = persist;
    const onRateChange = persist;

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('volumechange', onVolumeChange);
    video.addEventListener('ratechange', onRateChange);
    video.addEventListener('timeupdate', debouncedTimeUpdate);

    const savedState = loadHeroBackgroundState();
    if (savedState) {
        restoring = true;
        const applyRestore = () => {
            restoreHeroBackgroundState(video, savedState, callbacks).finally(() => {
                restoring = false;
            });
        };

        if (video.readyState >= 1) {
            applyRestore();
        } else {
            video.addEventListener('loadedmetadata', applyRestore, { once: true });
        }
    }

    return () => {
        clearTimeout(timeupdateTimer);
        video.removeEventListener('play', onPlay);
        video.removeEventListener('pause', onPause);
        video.removeEventListener('volumechange', onVolumeChange);
        video.removeEventListener('ratechange', onRateChange);
        video.removeEventListener('timeupdate', debouncedTimeUpdate);
        persist();
    };
}
