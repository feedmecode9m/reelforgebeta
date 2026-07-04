/**
 * Studio workflow navigation — scrolls to and focuses operational targets.
 */

import { WORKFLOW_NAV_TARGETS } from '../series/workflowEngine.js';

const HIGHLIGHT_CLASS = 'workflow-nav-highlight';

/**
 * @param {string} selector
 * @returns {boolean}
 */
export function navigationTargetExists(selector) {
    if (typeof document === 'undefined') return false;
    return Boolean(document.querySelector(selector));
}

/**
 * @param {HTMLElement} element
 */
function highlightElement(element) {
    element.classList.add(HIGHLIGHT_CLASS);
    window.setTimeout(() => element.classList.remove(HIGHLIGHT_CLASS), 2400);
}

/**
 * @param {import('../series/workflowEngine.js').WorkflowNavigation} navigation
 */
export function executeWorkflowNavigation(navigation) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;

    window.dispatchEvent(
        new CustomEvent('reelforge:workflow-navigate', {
            detail: {
                target: navigation.target,
                episodeId: navigation.episodeId,
                reelId: navigation.reelId,
                focusField: navigation.focusField
            }
        })
    );

    const baseSelector = WORKFLOW_NAV_TARGETS[navigation.target];
    const selector = navigation.selector || baseSelector;
    const element = document.querySelector(selector);

    if (!element) return false;

    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    highlightElement(/** @type {HTMLElement} */ (element));

    if (navigation.focusField && navigation.target !== 'episode-editor') {
        window.setTimeout(() => {
            const field = document.querySelector(
                `[data-series-metadata-editor] [data-workflow-field="${navigation.focusField}"]`
            );
            if (field instanceof HTMLElement) {
                field.focus();
                highlightElement(field);
            }
        }, 350);
    }

    return true;
}
