/**
 * Phase 68 — Deep Navigation Engine.
 * Routes search results to real ReelForge destinations.
 */

import { getEpisodeById } from '../series/seriesStore.js';
import { routeWorkflowNavigation } from '../studio/creatorActionRouter.js';

/**
 * @typedef {Object} DeepNavigationTarget
 * @property {'studio_tab' | 'workflow' | 'episode' | 'reel' | 'marketplace_listing' | 'command_center_page' | 'security_incident' | 'revenue_section'} type
 * @property {string} [tab]
 * @property {string} [section]
 * @property {string} [dashboardSection]
 * @property {string} [episodeId]
 * @property {string} [reelId]
 * @property {string} [listingId]
 * @property {string} [incidentId]
 * @property {import('../series/workflowEngine.js').WorkflowNavigation} [workflowNavigation]
 * @property {Record<string, unknown>} [meta]
 */

export const ROUTE_DESTINATION_MAP = {
    studio_tab: 'Studio workspace tab + optional section',
    command_center_page: 'Command Center dashboard section',
    episode: 'Studio > Series > Season > Episode focus',
    workflow: 'Workflow board + workflow task focus',
    reel: 'Theater reel open flow',
    marketplace_listing: 'Marketplace Hub listing focus',
    revenue_section: 'Revenue dashboard section',
    security_incident: 'SOC dashboard section'
};

/**
 * @param {'NAVIGATION_TARGET' | 'NAVIGATION_SUCCESS' | 'NAVIGATION_FAILURE'} tag
 * @param {Record<string, unknown>} detail
 */
function emitNavigationDiagnostic(tag, detail) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/**
 * @param {Record<string, unknown>} detail
 */
function dispatchSearchNavigate(detail) {
    if (typeof window === 'undefined') return false;
    window.dispatchEvent(new CustomEvent('reelforge:search-navigate', { detail }));
    return true;
}

/**
 * @param {string} tab
 * @param {{ dashboardSection?: string | null; section?: string | null; source?: string }} [options]
 */
export function navigateToStudioTab(tab, options = {}) {
    const targetTab = String(tab || '').trim();
    if (!targetTab || typeof window === 'undefined') {
        emitNavigationDiagnostic('NAVIGATION_FAILURE', {
            route: 'studio_tab',
            reason: 'invalid_tab',
            target: { tab: targetTab }
        });
        return false;
    }

    emitNavigationDiagnostic('NAVIGATION_TARGET', {
        route: 'studio_tab',
        target: { tab: targetTab, section: options.section || null, dashboardSection: options.dashboardSection || null }
    });

    const ok = dispatchSearchNavigate({
        workspaceTab: targetTab,
        dashboardSection: options.dashboardSection || null,
        targetType: 'studio_tab',
        targetId: targetTab,
        section: options.section || null
    });
    emitNavigationDiagnostic(ok ? 'NAVIGATION_SUCCESS' : 'NAVIGATION_FAILURE', {
        route: 'studio_tab',
        source: options.source || 'direct_api',
        target: { tab: targetTab, section: options.section || null, dashboardSection: options.dashboardSection || null }
    });
    return ok;
}

/**
 * @param {string} episodeId
 * @param {{ reelId?: string; tab?: string; dashboardSection?: string; source?: string }} [options]
 */
export function navigateToEpisode(episodeId, options = {}) {
    const targetEpisodeId = String(episodeId || '').trim();
    const reelId = String(options.reelId || '').trim();
    if (!targetEpisodeId && reelId && typeof window !== 'undefined') {
        emitNavigationDiagnostic('NAVIGATION_TARGET', {
            route: 'reel',
            target: { reelId }
        });
        window.dispatchEvent(
            new CustomEvent('reelforge:search-open-reel', {
                detail: { reelId, episodeId: null }
            })
        );
        emitNavigationDiagnostic('NAVIGATION_SUCCESS', {
            route: 'reel',
            source: options.source || 'direct_api',
            target: { reelId }
        });
        return true;
    }
    if (!targetEpisodeId || typeof window === 'undefined') {
        emitNavigationDiagnostic('NAVIGATION_FAILURE', {
            route: 'episode',
            reason: 'invalid_episode_id',
            target: { episodeId: targetEpisodeId || null, reelId: options.reelId || null }
        });
        return false;
    }

    const ctx = getEpisodeById(targetEpisodeId);
    const resolvedReelId = String(options.reelId || ctx?.episode?.reelId || '').trim();

    emitNavigationDiagnostic('NAVIGATION_TARGET', {
        route: 'episode',
        target: {
            tab: options.tab || 'Content',
            seriesId: ctx?.series?.id || null,
            seasonNumber: ctx?.season?.seasonNumber || null,
            episodeId: targetEpisodeId,
            reelId: resolvedReelId || null
        }
    });

    if (resolvedReelId) {
        window.dispatchEvent(
            new CustomEvent('reelforge:search-open-reel', {
                detail: { reelId: resolvedReelId, episodeId: targetEpisodeId }
            })
        );
        dispatchSearchNavigate({
            workspaceTab: options.tab || 'Content',
            dashboardSection: options.dashboardSection || 'content',
            targetType: 'episode',
            targetId: targetEpisodeId,
            seriesId: ctx?.series?.id || null,
            seasonNumber: ctx?.season?.seasonNumber || null,
            episodeNumber: ctx?.episode?.episodeNumber || null
        });
        emitNavigationDiagnostic('NAVIGATION_SUCCESS', {
            route: 'episode',
            source: options.source || 'direct_api',
            target: {
                episodeId: targetEpisodeId,
                reelId: resolvedReelId,
                seriesId: ctx?.series?.id || null,
                seasonNumber: ctx?.season?.seasonNumber || null
            }
        });
        return true;
    }

    const ok = dispatchSearchNavigate({
        workspaceTab: options.tab || 'Content',
        dashboardSection: options.dashboardSection || 'content',
        targetType: 'episode',
        targetId: targetEpisodeId,
        seriesId: ctx?.series?.id || null,
        seasonNumber: ctx?.season?.seasonNumber || null,
        episodeNumber: ctx?.episode?.episodeNumber || null
    });
    emitNavigationDiagnostic(ok ? 'NAVIGATION_SUCCESS' : 'NAVIGATION_FAILURE', {
        route: 'episode',
        source: options.source || 'direct_api',
        target: {
            episodeId: targetEpisodeId,
            seriesId: ctx?.series?.id || null,
            seasonNumber: ctx?.season?.seasonNumber || null,
            reelId: null
        }
    });
    return ok;
}

/**
 * @param {import('../series/workflowEngine.js').WorkflowNavigation | { tab?: string; dashboardSection?: string; section?: string; source?: string }} workflowTarget
 */
export function navigateToWorkflow(workflowTarget) {
    if (typeof window === 'undefined') {
        emitNavigationDiagnostic('NAVIGATION_FAILURE', {
            route: 'workflow',
            reason: 'window_unavailable'
        });
        return false;
    }

    const target = workflowTarget || {};
    emitNavigationDiagnostic('NAVIGATION_TARGET', {
        route: 'workflow',
        target
    });
    if ('target' in target && target.target) {
        void routeWorkflowNavigation(
            /** @type {import('../series/workflowEngine.js').WorkflowNavigation} */ (target),
            {
                source: target.source || 'workflow',
                actionType: target.actionType || null,
                episodeId: target.episodeId || null
            }
        );
        emitNavigationDiagnostic('NAVIGATION_SUCCESS', {
            route: 'workflow',
            source: target.source || 'workflow_navigation',
            target: {
                target: target.target,
                episodeId: target.episodeId || null,
                reelId: target.reelId || null
            }
        });
        return true;
    }

    const ok = dispatchSearchNavigate({
        workspaceTab: target.tab || 'Production',
        dashboardSection: target.dashboardSection || 'production',
        targetType: 'workflow',
        targetId: target.section || 'workflow'
    });
    if (ok && typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent('reelforge:workflow-navigate', {
                detail: {
                    target: target.section || 'workflow',
                    dashboardSection: target.dashboardSection || 'production'
                }
            })
        );
    }
    emitNavigationDiagnostic(ok ? 'NAVIGATION_SUCCESS' : 'NAVIGATION_FAILURE', {
        route: 'workflow',
        source: target.source || 'direct_api',
        target: {
            tab: target.tab || 'Production',
            section: target.section || 'workflow',
            dashboardSection: target.dashboardSection || 'production'
        }
    });
    return ok;
}

/**
 * @param {string} listingId
 * @param {{ tab?: string; dashboardSection?: string; source?: string }} [options]
 */
export function navigateToMarketplace(listingId, options = {}) {
    if (typeof window === 'undefined') {
        emitNavigationDiagnostic('NAVIGATION_FAILURE', {
            route: 'marketplace_listing',
            reason: 'window_unavailable',
            target: { listingId: listingId || null }
        });
        return false;
    }
    const targetId = String(listingId || '').trim();
    emitNavigationDiagnostic('NAVIGATION_TARGET', {
        route: 'marketplace_listing',
        target: { listingId: targetId || null }
    });
    const ok = dispatchSearchNavigate({
        workspaceTab: options.tab || 'Analytics',
        dashboardSection: options.dashboardSection || 'marketplace',
        targetType: 'marketplace_listing',
        targetId: targetId || null
    });
    window.dispatchEvent(
        new CustomEvent('reelforge:marketplace-focus-listing', {
            detail: { listingId: targetId || null }
        })
    );
    emitNavigationDiagnostic(ok ? 'NAVIGATION_SUCCESS' : 'NAVIGATION_FAILURE', {
        route: 'marketplace_listing',
        source: options.source || 'direct_api',
        target: { listingId: targetId || null }
    });
    return ok;
}

/**
 * @param {string} section
 * @param {{ tab?: string; dashboardSection?: string; source?: string }} [options]
 */
export function navigateToRevenue(section = 'revenue', options = {}) {
    const targetSection = String(section || 'revenue').trim() || 'revenue';
    emitNavigationDiagnostic('NAVIGATION_TARGET', {
        route: 'revenue_section',
        target: { section: targetSection }
    });
    const ok = dispatchSearchNavigate({
        workspaceTab: options.tab || 'Analytics',
        dashboardSection: options.dashboardSection || 'revenue',
        targetType: 'revenue_section',
        targetId: targetSection
    });
    emitNavigationDiagnostic(ok ? 'NAVIGATION_SUCCESS' : 'NAVIGATION_FAILURE', {
        route: 'revenue_section',
        source: options.source || 'direct_api',
        target: { section: targetSection }
    });
    return ok;
}

/**
 * @param {DeepNavigationTarget | null | undefined} target
 */
export function navigateToTarget(target) {
    const navigationTarget = target || null;
    if (!navigationTarget?.type) {
        emitNavigationDiagnostic('NAVIGATION_FAILURE', {
            route: 'target_router',
            reason: 'invalid_target',
            target: navigationTarget
        });
        return false;
    }

    emitNavigationDiagnostic('NAVIGATION_TARGET', {
        route: 'target_router',
        target: navigationTarget
    });

    switch (navigationTarget.type) {
        case 'studio_tab':
            return navigateToStudioTab(navigationTarget.tab || '', {
                dashboardSection: navigationTarget.dashboardSection || null,
                section: navigationTarget.section || null,
                source: 'target_router'
            });
        case 'command_center_page':
            return navigateToStudioTab(navigationTarget.tab || 'System', {
                dashboardSection: navigationTarget.dashboardSection || navigationTarget.section || null,
                source: 'target_router'
            });
        case 'workflow':
            return navigateToWorkflow(navigationTarget.workflowNavigation || {
                tab: navigationTarget.tab || 'Production',
                dashboardSection: navigationTarget.dashboardSection || 'production',
                section: navigationTarget.section || 'workflow',
                source: 'target_router'
            });
        case 'episode':
            return navigateToEpisode(navigationTarget.episodeId || '', {
                reelId: navigationTarget.reelId || '',
                tab: navigationTarget.tab || 'Content',
                dashboardSection: navigationTarget.dashboardSection || 'content',
                source: 'target_router'
            });
        case 'reel':
            return navigateToEpisode('', {
                reelId: navigationTarget.reelId || '',
                source: 'target_router'
            });
        case 'marketplace_listing':
            return navigateToMarketplace(navigationTarget.listingId || '', {
                tab: navigationTarget.tab || 'Analytics',
                dashboardSection: navigationTarget.dashboardSection || 'marketplace',
                source: 'target_router'
            });
        case 'revenue_section':
            return navigateToRevenue(navigationTarget.section || 'revenue', {
                tab: navigationTarget.tab || 'Analytics',
                dashboardSection: navigationTarget.dashboardSection || 'revenue',
                source: 'target_router'
            });
        case 'security_incident':
            return navigateToStudioTab(navigationTarget.tab || 'System', {
                dashboardSection: navigationTarget.dashboardSection || 'security',
                source: 'target_router'
            });
        default:
            emitNavigationDiagnostic('NAVIGATION_FAILURE', {
                route: 'target_router',
                reason: 'unsupported_target',
                target: {
                    type: navigationTarget.type
                }
            });
            return false;
    }
}

let deepNavigationInitialized = false;

export function initDeepNavigation() {
    if (typeof window === 'undefined' || deepNavigationInitialized) return window.__reelforgeNavigation || null;
    deepNavigationInitialized = true;
    window.__reelforgeNavigation = {
        ROUTE_DESTINATION_MAP,
        navigateToTarget,
        navigateToStudioTab,
        navigateToEpisode,
        navigateToWorkflow,
        navigateToMarketplace,
        navigateToRevenue
    };
    return window.__reelforgeNavigation;
}
