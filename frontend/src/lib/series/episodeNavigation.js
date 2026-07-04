/**
 * Episode navigation — drawer, swipe, countdown → openTheaterReel.
 */

import { getNextEpisode } from './seriesStore.js';
import { resolveReelForEpisode } from './episodeBridge.js';
import { logEpisodeBridgeDiag } from './episodeBridgeDiagnostics.js';
import { logNextEpisodeDiag } from './nextEpisodeDiagnostics.js';

let findReelInFeedFn = () => null;
let openTheaterReelFn = () => {};
let getCurrentEpisodeIdFn = () => null;
let getAllFeedReelsFn = () => [];

/** @param {{ findReelInFeed?: (id: string) => Record<string, unknown> | null; openTheaterReel?: (reel: Record<string, unknown>) => void; getCurrentEpisodeId?: () => string | null; getAllFeedReels?: () => Record<string, unknown>[] }} deps */
export function configureEpisodeNavigation(deps = {}) {
    if (deps.findReelInFeed) findReelInFeedFn = deps.findReelInFeed;
    if (deps.openTheaterReel) openTheaterReelFn = deps.openTheaterReel;
    if (deps.getCurrentEpisodeId) getCurrentEpisodeIdFn = deps.getCurrentEpisodeId;
    if (deps.getAllFeedReels) getAllFeedReelsFn = deps.getAllFeedReels;
}

/**
 * @param {'countdown' | 'swipe' | 'drawer' | 'manual' | 'card' | 'keyboard' | 'controller'} source
 * @param {string} [targetEpisodeId]
 */
export function navigateToEpisode(source, targetEpisodeId) {
    const currentEpisodeId = getCurrentEpisodeIdFn();
    let episodeId = targetEpisodeId || null;

    const autoAdvanceSources = new Set(['countdown', 'swipe', 'card', 'keyboard', 'controller']);
    if (!episodeId && autoAdvanceSources.has(source) && currentEpisodeId) {
        episodeId = getNextEpisode(currentEpisodeId)?.episode?.episodeId ?? null;
    }

    if (!episodeId) {
        logEpisodeBridgeDiag(source === 'swipe' ? 'SWIPE_NAV' : 'NEXT_EPISODE', {
            currentEpisode: currentEpisodeId,
            targetEpisode: null,
            reelId: null,
            reason: 'no-target-episode'
        });
        return false;
    }

    const nextCtx = getNextEpisode(currentEpisodeId || episodeId);
    const targetCtx = source === 'drawer' ? null : autoAdvanceSources.has(source) ? nextCtx : null;

    const reel = resolveReelForEpisode(episodeId, findReelInFeedFn, getAllFeedReelsFn);
    if (!reel) {
        const tag =
            source === 'drawer'
                ? 'DRAWER_SELECT'
                : source === 'swipe'
                  ? 'SWIPE_NAV'
                  : 'NEXT_EPISODE';
        logEpisodeBridgeDiag(tag, {
            currentEpisode: currentEpisodeId,
            targetEpisode: episodeId,
            reelId: null,
            reason: 'reel-not-found'
        });
        return false;
    }

    const tag =
        source === 'drawer' ? 'DRAWER_SELECT' : source === 'swipe' ? 'SWIPE_NAV' : 'NEXT_EPISODE';

    logEpisodeBridgeDiag('EPISODE_NAV', {
        source,
        currentEpisode: currentEpisodeId,
        targetEpisode: episodeId,
        reelId: reel.id
    });
    logEpisodeBridgeDiag(tag, {
        currentEpisode: currentEpisodeId,
        targetEpisode: episodeId,
        reelId: reel.id,
        seasonNumber: targetCtx?.season?.seasonNumber ?? reel.seasonNumber ?? null,
        episodeNumber: targetCtx?.episode?.episodeNumber ?? reel.episodeNumber ?? null
    });

    if (source === 'card' || source === 'keyboard' || source === 'controller' || source === 'countdown' || source === 'swipe') {
        logNextEpisodeDiag('NEXT_EPISODE_NAVIGATE', {
            source,
            currentEpisode: currentEpisodeId,
            targetEpisode: episodeId,
            reelId: reel.id,
            seasonNumber: targetCtx?.season?.seasonNumber ?? reel.seasonNumber ?? null,
            episodeNumber: targetCtx?.episode?.episodeNumber ?? reel.episodeNumber ?? null
        });
    }

    openTheaterReelFn(reel);
    return true;
}

/** Countdown / video-end auto-advance. */
export function navigateToNextEpisode(source = 'countdown') {
    return navigateToEpisode(source);
}

/** Swipe-up gesture advance. */
export function navigateOnSwipeUp() {
    return navigateToEpisode('swipe');
}

/**
 * Handle NextEpisodeCard activation (click, Enter, or controller action).
 * @param {'click' | 'keyboard' | 'controller'} interaction
 */
export function handleNextEpisodeCardActivate(interaction = 'click') {
    const currentEpisodeId = getCurrentEpisodeIdFn();
    const nextEpisodeId = currentEpisodeId ? getNextEpisode(currentEpisodeId)?.episode?.episodeId ?? null : null;

    logNextEpisodeDiag('NEXT_EPISODE_CLICK', {
        interaction,
        currentEpisode: currentEpisodeId,
        targetEpisode: nextEpisodeId
    });

    const source =
        interaction === 'keyboard' ? 'keyboard' : interaction === 'controller' ? 'controller' : 'card';
    return navigateToNextEpisode(source);
}

/**
 * Svelte action — wires click + keyboard activation for NextEpisodeCard.
 * @param {HTMLElement} node
 */
export function nextEpisodeCardController(node) {
    /** @param {MouseEvent | KeyboardEvent} event */
    function handleActivate(event) {
        if (event.type === 'keydown') {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
        }
        event.stopPropagation();
        handleNextEpisodeCardActivate(event.type === 'keydown' ? 'keyboard' : 'click');
    }

    node.addEventListener('click', handleActivate);
    node.addEventListener('keydown', handleActivate);

    return {
        destroy() {
            node.removeEventListener('click', handleActivate);
            node.removeEventListener('keydown', handleActivate);
        }
    };
}

/**
 * @param {string} episodeId
 */
export function navigateFromDrawer(episodeId) {
    return navigateToEpisode('drawer', episodeId);
}
