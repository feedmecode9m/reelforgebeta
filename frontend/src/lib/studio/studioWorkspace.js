/**
 * Phase 26.5 — Smart Production Studio workspace shell.
 */

/** Active Creator Workspace tabs (de-bloated Studio shell). */
export const WORKSPACE_TABS = /** @type {const} */ ([
    'Content',
    'Production',
    'System'
]);

/** Legacy tab values — map to Content on restore. */
const LEGACY_WORKSPACE_TABS = new Set([
    'Overview',
    'Teams',
    'Analytics',
    'Automation'
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
    if (typeof window === 'undefined') return 'Content';
    try {
        const saved = localStorage.getItem(WORKSPACE_TAB_STORAGE_KEY);
        if (saved && WORKSPACE_TABS.includes(/** @type {WorkspaceTab} */ (saved))) {
            return /** @type {WorkspaceTab} */ (saved);
        }
        if (saved && LEGACY_WORKSPACE_TABS.has(saved)) {
            saveWorkspaceTab('Content');
            return 'Content';
        }
    } catch {
        /* ignore */
    }
    return 'Content';
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

/**
 * Keep Creator OS tab bar visible inside the studio scroll body after tab changes or editor dismiss.
 * @param {number} [paddingTop]
 */
export function scrollStudioWorkspaceNavIntoView(paddingTop = 12) {
    if (typeof document === 'undefined') return;
    const scrollBody = document.querySelector('[data-control-center-scroll-body]');
    const anchor =
        document.querySelector('[data-studio-workspace-tabs]') ||
        document.querySelector('[data-studio-workspace-layout]');
    if (!scrollBody || !anchor) return;

    const bodyRect = scrollBody.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    scrollBody.scrollTop += anchorRect.top - bodyRect.top - paddingTop;
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
