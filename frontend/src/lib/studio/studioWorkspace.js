/**
 * Phase 26.5 — Smart Production Studio workspace shell.
 */

export const WORKSPACE_TABS = /** @type {const} */ ([
    'Overview',
    'Production',
    'Content',
    'Teams',
    'Analytics',
    'Automation',
    'System'
]);

export const WORKSPACE_TAB_STORAGE_KEY = 'reelforge_studio_workspace_tab';

/** @typedef {typeof WORKSPACE_TABS[number]} WorkspaceTab */

/**
 * @param {string} tag
 * @param {Record<string, unknown>} detail
 */
export function logStudioWorkspaceDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @returns {WorkspaceTab} */
export function loadWorkspaceTab() {
    if (typeof window === 'undefined') return 'Overview';
    try {
        const saved = localStorage.getItem(WORKSPACE_TAB_STORAGE_KEY);
        if (saved && WORKSPACE_TABS.includes(/** @type {WorkspaceTab} */ (saved))) {
            return /** @type {WorkspaceTab} */ (saved);
        }
    } catch {
        /* ignore */
    }
    return 'Overview';
}

/** @param {WorkspaceTab} tab */
export function saveWorkspaceTab(tab) {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(WORKSPACE_TAB_STORAGE_KEY, tab);
    } catch {
        /* ignore */
    }
}

/** @param {WorkspaceTab} tab */
export function workspaceTabSlug(tab) {
    return tab.toLowerCase();
}

let studioWorkspaceInitialized = false;

export function initStudioWorkspace() {
    if (typeof window === 'undefined' || studioWorkspaceInitialized) return;
    studioWorkspaceInitialized = true;

    logStudioWorkspaceDiag('STUDIO_REFRESH', { phase: 'init', defaultTab: loadWorkspaceTab() });

    window.__reelforgeStudioWorkspace = {
        WORKSPACE_TABS,
        loadWorkspaceTab,
        saveWorkspaceTab,
        logStudioWorkspaceDiag
    };
}
