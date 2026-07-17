/**
 * PRODUCT-06A — Unified creator action router.
 * Tab-first workflow navigation and completion loop for readiness actions.
 * Does not alter readiness calculations or feature panels.
 */

import {
    buildTaskNavigation,
    WORKFLOW_NAV_TARGETS
} from '../series/workflowEngine.js';
import { seriesCatalog } from '../series/seriesStore.js';
import { get } from 'svelte/store';
import {
    executeWorkflowNavigation,
    navigationTargetExists
} from './studioWorkflowNavigation.js';

/**
 * @param {string} tab
 * @param {string} dashboardSection
 */
function activateWorkspaceTab(tab, dashboardSection) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
        new CustomEvent('reelforge:search-navigate', {
            detail: {
                workspaceTab: tab,
                dashboardSection,
                targetType: 'studio_tab',
                targetId: tab
            }
        })
    );
}

export const CREATOR_PRODUCTION_UPDATED = 'reelforge:creator-production-updated';

/** @typedef {'Production' | 'Content' | 'Overview' | 'Teams' | 'Analytics' | 'Automation' | 'System'} CreatorWorkspaceTab */

/** @type {Record<import('../series/workflowEngine.js').WorkflowNavTarget, CreatorWorkspaceTab>} */
export const WORKFLOW_TARGET_TABS = {
    'reel-attach': 'Production',
    'metadata-editor': 'Content',
    'release-scheduler': 'Content',
    'episode-editor': 'Content'
};

/**
 * @typedef {Object} CreatorActionContext
 * @property {string | null} episodeId
 * @property {string} source
 * @property {string | null} actionType
 * @property {'Production' | null} returnTab
 */

/** @type {CreatorActionContext | null} */
let lastCreatorActionContext = null;

/**
 * @param {string} selector
 * @param {number} [maxMs]
 */
function waitForSelector(selector, maxMs = 4000) {
    if (typeof window === 'undefined' || !selector) {
        return Promise.resolve(false);
    }

    return new Promise((resolve) => {
        const started = Date.now();

        const tick = () => {
            if (navigationTargetExists(selector)) {
                resolve(true);
                return;
            }
            if (Date.now() - started >= maxMs) {
                resolve(false);
                return;
            }
            window.setTimeout(tick, 50);
        };

        tick();
    });
}

/**
 * @param {import('../series/workflowEngine.js').WorkflowNavigation} navigation
 * @param {string | null | undefined} actionType
 */
function applyCreatorNavOverrides(navigation, actionType) {
    const nav = { ...navigation };

    if (nav.target === 'reel-attach') {
        nav.selector = '[data-testid="episode-reel-attach-panel"]';
    } else if (actionType === 'missing-thumbnail') {
        nav.selector = '[data-content-panel="assets"]';
    }

    return nav;
}

/**
 * @param {import('../series/workflowEngine.js').WorkflowNavigation} navigation
 */
function inferActionTypeFromNav(navigation) {
    if (navigation.target === 'reel-attach') return 'missing-asset';
    if (navigation.target === 'episode-editor') return 'missing-thumbnail';
    if (navigation.target === 'release-scheduler') {
        return navigation.focusField === 'episodeStatus' ? 'unpublished-episode' : 'unscheduled-episode';
    }
    if (navigation.target === 'metadata-editor') {
        if (navigation.focusField === 'runtime') return 'missing-runtime';
        if (navigation.focusField === 'description') return 'missing-description';
        return 'missing-metadata';
    }
    return null;
}

/**
 * @param {string | null | undefined} episodeId
 */
function scrollToReadinessEpisode(episodeId) {
    if (!episodeId || typeof document === 'undefined') return;

    const row = document.querySelector(
        `[data-testid="readiness-episode-row"][data-episode-id="${episodeId}"]`
    );
    if (!(row instanceof HTMLElement)) return;

    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('workflow-nav-highlight');
    window.setTimeout(() => row.classList.remove('workflow-nav-highlight'), 2400);
}

/**
 * @param {CreatorActionContext | null} ctx
 */
function returnToReadinessBoard(ctx) {
    if (!ctx || ctx.returnTab !== 'Production') return;
    if (ctx.source !== 'readiness-board' && ctx.source !== 'workflow-task') return;

    activateWorkspaceTab('Production', 'production');

    window.setTimeout(() => scrollToReadinessEpisode(ctx.episodeId), 350);
    lastCreatorActionContext = null;
}

/**
 * Route an existing workflow navigation target: tab switch → wait for mount → scroll/focus.
 * @param {import('../series/workflowEngine.js').WorkflowNavigation} navigation
 * @param {{ actionType?: string | null; source?: string; episodeId?: string | null }} [options]
 */
export async function routeWorkflowNavigation(navigation, options = {}) {
    if (typeof window === 'undefined' || !navigation?.target) return false;

    const actionType =
        options.actionType ||
        inferActionTypeFromNav(navigation) ||
        null;
    const episodeId = navigation.episodeId || options.episodeId || null;
    const nav = applyCreatorNavOverrides(navigation, actionType);
    const tab = WORKFLOW_TARGET_TABS[nav.target] || 'Production';
    const dashboardSection = tab === 'Production' ? 'production' : 'content';

    if (options.source === 'readiness-board' || options.source === 'workflow-task') {
        lastCreatorActionContext = {
            episodeId,
            source: options.source,
            actionType,
            returnTab: 'Production'
        };
    }

    activateWorkspaceTab(tab, dashboardSection);

    window.dispatchEvent(
        new CustomEvent('reelforge:workflow-navigate', {
            detail: {
                target: nav.target,
                episodeId: nav.episodeId,
                reelId: nav.reelId,
                focusField: nav.focusField
            }
        })
    );

    const primarySelector = nav.selector || WORKFLOW_NAV_TARGETS[nav.target];
    let ready = await waitForSelector(primarySelector);

    if (!ready && nav.selector !== WORKFLOW_NAV_TARGETS[nav.target]) {
        ready = await waitForSelector(WORKFLOW_NAV_TARGETS[nav.target], 2000);
        if (ready) {
            nav.selector = WORKFLOW_NAV_TARGETS[nav.target];
        }
    }

    if (!ready) return false;

    return executeWorkflowNavigation(nav);
}

/**
 * Navigate from a readiness/action recommendation.
 * @param {{ actionType: string; episodeId: string; reelId?: string | null; source?: string }} params
 */
export function navigateCreatorAction({ actionType, episodeId, reelId = null, source = 'readiness-board' }) {
    const nav = buildTaskNavigation(
        /** @type {import('../series/workflowEngine.js').WorkflowActionType} */ (actionType),
        episodeId,
        reelId
    );

    if (!nav.target) return false;

    void routeWorkflowNavigation(nav, { actionType, episodeId, source });
    return true;
}

/**
 * @param {{ episodeId?: string | null; reelId?: string | null; actionType?: string | null; source?: string }} detail
 */
export function emitCreatorProductionUpdated(detail = {}) {
    if (typeof window === 'undefined') return;

    const payload = {
        episodeId: detail.episodeId || null,
        reelId: detail.reelId || null,
        actionType: detail.actionType || null,
        source: detail.source || 'unknown',
        timestamp: Date.now()
    };

    if (!payload.episodeId && payload.reelId) {
        const catalogEpisode = findEpisodeIdForReel(payload.reelId);
        if (catalogEpisode) payload.episodeId = catalogEpisode;
    }

    window.dispatchEvent(
        new CustomEvent(CREATOR_PRODUCTION_UPDATED, { detail: payload })
    );

    const ctx = lastCreatorActionContext;
    if (!ctx) return;

    const episodeMatch = !payload.episodeId || !ctx.episodeId || payload.episodeId === ctx.episodeId;
    if (episodeMatch) {
        returnToReadinessBoard(ctx);
    }
}

/**
 * @param {string | null | undefined} reelId
 * @returns {string | null}
 */
function findEpisodeIdForReel(reelId) {
    if (!reelId) return null;

    for (const series of get(seriesCatalog)) {
        for (const season of series.seasons || []) {
            for (const episode of season.episodes || []) {
                if (String(episode.reelId) === String(reelId)) {
                    return episode.episodeId;
                }
            }
        }
    }

    return null;
}
