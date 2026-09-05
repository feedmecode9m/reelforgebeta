<script>
    import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
    import { seriesCatalog } from '../../lib/series/seriesStore.js';
    import { auditEpisodeAssets } from '../../lib/series/episodeAssetStatus.js';
    import {
        registerCommandCenterRefreshListener,
        scheduleCommandCenterRefresh
    } from '../../lib/command/commandCenterRefresh.js';
    import { evaluateNotificationTriggers } from '../../lib/notifications/notificationCenter.js';
    import { auditStudioHelpRegistry } from '../../lib/studio/studioHelpRegistry.js';
    import {
        WORKSPACE_TABS,
        initStudioWorkspace,
        loadWorkspaceTab,
        logStudioWorkspaceDiag,
        saveWorkspaceTab,
        scrollStudioWorkspaceNavIntoView,
        workspaceTabSlug
    } from '../../lib/studio/studioWorkspace.js';
    import { STUDIO_SELECT_CONTENT_TAB_EVENT } from '../../lib/dropAffordance.js';
    import { getMissingAssetQueue } from '../../lib/series/productionHealth.js';
    import MissingAssetQueue from '../series/MissingAssetQueue.svelte';
    import {
        emitGuideMePanelContext,
        initGuideMeEngine,
        isGuideMeModeEnabled
    } from '../../lib/studio/guideMeEngine.js';
    import { CREATOR_PRODUCTION_UPDATED } from '../../lib/studio/creatorActionRouter.js';
    import { emitAccessibilityAudit } from '../../lib/accessibility/accessibilityAudit.js';
    import GlobalSearchBar from '../discovery/GlobalSearchBar.svelte';

    const dispatch = createEventDispatcher();

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    export let selectedSeriesId = null;

    /** @type {(preserveLocal?: boolean) => Promise<void>} */
    export let syncFromVault = async () => {};

    /** @type {typeof WORKSPACE_TABS[number]} */
    let activeTab = loadWorkspaceTab();

    let refreshKey = 0;
    let unregisterSharedRefresh = () => {};
    let guideMeMode = isGuideMeModeEnabled();
    /** PHASE-STUDIO-1 — gate notification eval to refresh-bus ticks only. */
    let lastNotificationRefreshKey = -1;
    let prevSelectedSeriesId = selectedSeriesId;

    onMount(() => {
        initStudioWorkspace();
        initGuideMeEngine();
        guideMeMode = isGuideMeModeEnabled();
        auditStudioHelpRegistry();
        logStudioWorkspaceDiag('STUDIO_REFRESH', {
            phase: 'mount',
            activeTab,
            seriesId: selectedSeriesId
        });
        emitAccessibilityAudit('StudioWorkspaceLayout', {
            action: 'mount',
            activeTab
        });
        unregisterSharedRefresh = registerCommandCenterRefreshListener(() => {
            refreshKey += 1;
        });
        refreshKey += 1;

        const onUpdate = () => {
            scheduleCommandCenterRefresh('workspace-domain-event');
        };
        const onProductionUpdated = () => {
            scheduleCommandCenterRefresh('creator-production-updated');
            dispatch('changed');
        };
        window.addEventListener('reelforge:workflow-tasks-updated', onUpdate);
        window.addEventListener('reelforge:teams-updated', onUpdate);
        window.addEventListener('reelforge:notifications-updated', onUpdate);
        window.addEventListener('reelforge:pipeline-updated', onUpdate);
        window.addEventListener('reelforge:release-schedule-updated', onUpdate);
        window.addEventListener(CREATOR_PRODUCTION_UPDATED, onProductionUpdated);
        window.addEventListener('reelforge:search-navigate', handleSearchNavigate);
        window.addEventListener(STUDIO_SELECT_CONTENT_TAB_EVENT, handleSelectContentTab);
        return () => {
            window.removeEventListener('reelforge:workflow-tasks-updated', onUpdate);
            window.removeEventListener('reelforge:teams-updated', onUpdate);
            window.removeEventListener('reelforge:notifications-updated', onUpdate);
            window.removeEventListener('reelforge:pipeline-updated', onUpdate);
            window.removeEventListener('reelforge:release-schedule-updated', onUpdate);
            window.removeEventListener(CREATOR_PRODUCTION_UPDATED, onProductionUpdated);
            window.removeEventListener('reelforge:search-navigate', handleSearchNavigate);
            window.removeEventListener(STUDIO_SELECT_CONTENT_TAB_EVENT, handleSelectContentTab);
            unregisterSharedRefresh();
        };
    });

    onDestroy(() => {
        unregisterSharedRefresh();
    });

    $: missingQueue = getMissingAssetQueue(feedReels, selectedSeriesId);

    // PHASE-STUDIO-1 — notification triggers only when shared refresh bus advances
    // (mount / interval / domain event / tab / series change). Never schedule on feedReels ticks.
    $: if (refreshKey !== lastNotificationRefreshKey) {
        lastNotificationRefreshKey = refreshKey;
        void evaluateNotificationTriggers(selectedSeriesId, feedReels);
    }

    // Series switch is an explicit studio action — allow one refresh, not feedReels ticks.
    $: if (selectedSeriesId !== prevSelectedSeriesId) {
        prevSelectedSeriesId = selectedSeriesId;
        scheduleCommandCenterRefresh('workspace-series-change');
    }

    /** @param {typeof WORKSPACE_TABS[number]} tab */
    function selectTab(tab) {
        if (typeof window !== 'undefined' && tab !== activeTab) {
            window.dispatchEvent(
                new CustomEvent('reelforge:studio-workspace-tab-change', { detail: { tab } })
            );
        }
        activeTab = tab;
        saveWorkspaceTab(tab);
        logStudioWorkspaceDiag('WORKSPACE_TAB', { tab, seriesId: selectedSeriesId });
        emitGuideMePanelContext(selectedSeriesId, feedReels, tab);
        guideMeMode = isGuideMeModeEnabled();
        scheduleCommandCenterRefresh('workspace-tab');
        emitAccessibilityAudit('StudioWorkspaceLayout', {
            action: 'tab_change',
            activeTab: tab
        });
        void tick().then(() => scrollActiveWorkspacePanelIntoView(tab));
    }

    /** @param {typeof WORKSPACE_TABS[number]} tab */
    function scrollActiveWorkspacePanelIntoView(tab) {
        scrollStudioWorkspaceNavIntoView(12);
    }

    function scrollUploadZonesIntoView() {
        if (typeof document === 'undefined') return;
        const scrollBody = document.querySelector('[data-control-center-scroll-body]');
        const panel = document.querySelector('[data-workspace-panel-content]');
        if (scrollBody && panel) {
            const bodyRect = scrollBody.getBoundingClientRect();
            const panelRect = panel.getBoundingClientRect();
            if (panelRect.bottom > bodyRect.bottom || panelRect.top < bodyRect.top) {
                scrollBody.scrollTop += panelRect.top - bodyRect.top - 24;
            }
        } else {
            panel?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
        const vaultDrop = document.querySelector('[data-workspace-panel-content] .video-vault-drop');
        vaultDrop?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    /** @param {CustomEvent<{ scrollUploadZones?: boolean }>} event */
    function handleSelectContentTab(event) {
        selectTab('Content');
        if (event.detail?.scrollUploadZones) {
            void tick().then(() => scrollUploadZonesIntoView());
        }
    }

    function handleManualRefresh() {
        void syncFromVault(true);
        logStudioWorkspaceDiag('STUDIO_REFRESH', { phase: 'manual', tab: activeTab });
    }

    function handleQueueAttached(event) {
        auditEpisodeAssets(feedReels, true);
        scheduleCommandCenterRefresh('workspace-queue-attached');
        dispatch('changed');
    }

    /** @param {Event} event */
    function handleSeriesSelect(event) {
        const target = /** @type {HTMLSelectElement} */ (event.currentTarget);
        dispatch('seriesChange', target.value || null);
    }

    /** @param {CustomEvent<{ workspaceTab?: string }>} event */
    function handleSearchNavigate(event) {
        const rawTab = String(event?.detail?.workspaceTab || '').trim();
        if (!rawTab) return;
        const tabMatch = WORKSPACE_TABS.find((tab) => tab.toLowerCase() === rawTab.toLowerCase());
        if (tabMatch) {
            selectTab(tabMatch);
        }
    }

    /** @param {KeyboardEvent} event @param {number} index */
    function handleTabKeydown(event, index) {
        const key = event.key;
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(key)) return;
        event.preventDefault();

        const direction = key === 'ArrowLeft' ? -1 : 1;
        const targetIndex =
            key === 'Home'
                ? 0
                : key === 'End'
                    ? WORKSPACE_TABS.length - 1
                    : (index + direction + WORKSPACE_TABS.length) % WORKSPACE_TABS.length;
        const targetTab = WORKSPACE_TABS[targetIndex];
        selectTab(targetTab);
        /** @type {HTMLButtonElement | null} */
        const targetButton = document.querySelector(`[data-workspace-tab-button="${workspaceTabSlug(targetTab)}"]`);
        targetButton?.focus();
    }
</script>

<div
    class="studio-workspace-layout"
    data-studio-workspace-layout
    data-active-workspace-tab={workspaceTabSlug(activeTab)}
>
    <header class="studio-workspace-layout__header">
        <div class="studio-workspace-layout__brand">
            <h3>Creator Workspace</h3>
            <span class="studio-workspace-layout__hint">Content · Production · System</span>
            {#if guideMeMode}
                <span class="studio-workspace-layout__guide-mode" data-guide-me-mode-indicator>Guide Me Mode ON</span>
            {/if}
        </div>
        <div class="studio-workspace-layout__header-actions">
            <GlobalSearchBar />
        </div>
    </header>

    <label class="studio-workspace-layout__series-select production-command-center__series-select">
        <span>Series</span>
        <select value={selectedSeriesId} on:change={handleSeriesSelect} data-command-center-series>
            {#each $seriesCatalog as series (series.id)}
                <option value={series.id}>{series.title}</option>
            {/each}
        </select>
    </label>

    <div class="studio-workspace-layout__tabs" data-studio-workspace-tabs role="tablist" aria-label="Studio workspace">
        {#each WORKSPACE_TABS as tab (tab)}
            <button
                type="button"
                id={`workspace-tab-${workspaceTabSlug(tab)}`}
                role="tab"
                aria-selected={activeTab === tab}
                aria-controls="studio-workspace-panel"
                aria-current={activeTab === tab ? 'page' : undefined}
                tabindex={activeTab === tab ? 0 : -1}
                class="studio-workspace-layout__tab production-command-center__nav-btn"
                class:studio-workspace-layout__tab--active={activeTab === tab}
                class:production-command-center__nav-btn--active={activeTab === tab}
                data-workspace-tab={workspaceTabSlug(tab)}
                data-workspace-tab-button={workspaceTabSlug(tab)}
                data-command-section={workspaceTabSlug(tab)}
                on:click={() => selectTab(tab)}
                on:keydown={(event) => handleTabKeydown(event, WORKSPACE_TABS.indexOf(tab))}
            >
                {tab}
            </button>
        {/each}
    </div>

    <div
        id="studio-workspace-panel"
        role="tabpanel"
        aria-labelledby={`workspace-tab-${workspaceTabSlug(activeTab)}`}
        class="studio-workspace-layout__panel production-command-center__panel"
        data-studio-workspace-panel
        data-command-center-panel
        data-active-section={activeTab}
    >
        <div
            class="studio-workspace-layout__tab-panel"
            data-workspace-panel-content
            data-upload-zones-emphasis="true"
            hidden={activeTab !== 'Content'}
        >
            <slot name="content" />
        </div>
        <div
            class="studio-workspace-layout__tab-panel"
            data-workspace-panel-production
            hidden={activeTab !== 'Production'}
        >
            <slot name="production" />
            <MissingAssetQueue queue={missingQueue} {feedReels} on:attached={handleQueueAttached} />
        </div>
        <div
            class="studio-workspace-layout__tab-panel"
            data-workspace-panel-system
            hidden={activeTab !== 'System'}
        >
            <slot name="system" />
        </div>
    </div>
</div>

<style>
    .studio-workspace-layout__tab-panel[hidden] {
        display: none !important;
    }
    .studio-workspace-layout {
        margin-top: 0.5rem;
        padding: 1rem;
        border-radius: 12px;
        border: 1px solid rgba(0, 242, 255, 0.22);
        background: linear-gradient(165deg, rgba(8, 12, 20, 0.92) 0%, rgba(0, 0, 0, 0.55) 100%);
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
    }
    .studio-workspace-layout__guide-mode {
        display: inline-block;
        margin-left: 0.5rem;
        padding: 0.15rem 0.45rem;
        border-radius: 999px;
        border: 1px solid rgba(0, 242, 255, 0.35);
        font-size: 0.58rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--neon-cyan, #00f2ff);
    }
    .studio-workspace-layout__header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.75rem;
        margin-bottom: 0.85rem;
    }
    .studio-workspace-layout__brand h3 {
        margin: 0;
        font-size: 1.05rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: #fff;
        font-weight: 600;
    }
    .studio-workspace-layout__hint {
        display: block;
        margin-top: 0.2rem;
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.45);
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }
    .studio-workspace-layout__refresh {
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.88);
        border-radius: 999px;
        padding: 0.4rem 0.85rem;
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        cursor: pointer;
    }
    .studio-workspace-layout__header-actions {
        display: flex;
        align-items: center;
        gap: 0.45rem;
    }
    .studio-workspace-layout__series-select {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        margin-bottom: 0.85rem;
        max-width: 320px;
    }
    .studio-workspace-layout__series-select span {
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.5);
    }
    .studio-workspace-layout__series-select select {
        padding: 0.45rem 0.6rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(0, 0, 0, 0.35);
        color: #fff;
        font: inherit;
    }
    .studio-workspace-layout__tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin-bottom: 1rem;
        padding-bottom: 0.75rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .studio-workspace-layout__tab {
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.03);
        color: rgba(255, 255, 255, 0.72);
        border-radius: 999px;
        padding: 0.42rem 0.85rem;
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        cursor: pointer;
        transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease;
    }
    .studio-workspace-layout__tab--active {
        border-color: var(--neon-cyan, #00f2ff);
        color: var(--neon-cyan, #00f2ff);
        background: rgba(0, 242, 255, 0.1);
    }
    .studio-workspace-layout__panel :global(> div > *) {
        margin-bottom: 0.85rem;
    }
    .studio-workspace-layout__panel :global(> div > *:last-child) {
        margin-bottom: 0;
    }
    .studio-workspace-layout__hero-metrics {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.75rem;
        margin-bottom: 0.85rem;
    }
    .studio-workspace-layout__metric-card {
        padding: 0.85rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.28);
    }
    .studio-workspace-layout__metric-label {
        display: block;
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(255, 255, 255, 0.48);
        margin-bottom: 0.35rem;
    }
    .studio-workspace-layout__metric-value {
        display: block;
        font-size: 1.65rem;
        line-height: 1;
        color: var(--neon-cyan, #00f2ff);
        margin-bottom: 0.35rem;
    }
    .studio-workspace-layout__metric-copy {
        margin: 0;
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.62);
        line-height: 1.45;
    }
    .studio-workspace-layout__grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.75rem;
        margin-bottom: 0.85rem;
    }
    .studio-workspace-layout__card {
        padding: 0.75rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.02);
        min-height: 8rem;
    }
    .studio-workspace-layout__card h4 {
        margin: 0 0 0.5rem;
        font-size: 0.68rem;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: rgba(255, 255, 255, 0.82);
    }
    .studio-workspace-layout__inline-stat {
        display: inline-block;
        margin-bottom: 0.45rem;
        font-size: 0.95rem;
        color: #ffd36e;
    }
    .studio-workspace-layout__empty {
        margin: 0;
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.45);
    }
    .studio-workspace-layout__action-list,
    .studio-workspace-layout__compact-list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }
    .studio-workspace-layout__action-list li,
    .studio-workspace-layout__compact-list li {
        display: flex;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.4rem 0.45rem;
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.22);
        border: 1px solid rgba(255, 255, 255, 0.06);
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.85);
    }
    .studio-workspace-layout__action-list em,
    .studio-workspace-layout__compact-list em {
        font-style: normal;
        color: #7dffb3;
        white-space: nowrap;
    }
    .studio-workspace-layout__compact-list p {
        margin: 0.15rem 0 0;
        font-size: 0.68rem;
        color: rgba(255, 255, 255, 0.62);
    }
    .studio-workspace-layout__compact-list span {
        display: block;
        font-size: 0.58rem;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.45);
    }
    .studio-workspace-layout__metrics-strip {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.45rem;
        margin-bottom: 0.85rem;
    }
    .studio-workspace-layout__metrics-strip :global(.production-command-center__metric) {
        padding: 0.55rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.22);
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
    }
    .studio-workspace-layout__metrics-strip :global(.production-command-center__metric strong) {
        font-size: 0.95rem;
        color: var(--neon-cyan, #00f2ff);
    }
    .studio-workspace-layout__metrics-strip :global(.production-command-center__metric span) {
        font-size: 0.56rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.5);
    }
    .studio-workspace-layout__advanced {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }
    .studio-workspace-layout__disclosure {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.18);
        padding: 0.35rem 0.65rem 0.65rem;
    }
    .studio-workspace-layout__disclosure summary {
        cursor: pointer;
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: rgba(255, 255, 255, 0.65);
        padding: 0.35rem 0;
        list-style-position: inside;
    }
    .studio-workspace-layout :global(.production-command-center__health-row) {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.75rem;
        margin-bottom: 0.75rem;
    }
    .studio-workspace-layout :global(.production-command-center__readiness-col) {
        display: flex;
        flex-direction: column;
    }
    .studio-workspace-layout :global(.production-command-center__notifications) {
        margin-top: 0.75rem;
        padding: 0.65rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 211, 110, 0.22);
        background: rgba(255, 211, 110, 0.04);
    }
    .studio-workspace-layout :global(.production-command-center__notifications h5) {
        margin: 0 0 0.45rem;
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: #ffd36e;
    }
    .studio-workspace-layout :global(.production-command-center__notifications ul) {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }
    .studio-workspace-layout :global(.production-command-center__notifications li) {
        padding: 0.4rem 0.5rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(0, 0, 0, 0.2);
    }
    .studio-workspace-layout :global(.production-command-center__notifications li span) {
        display: block;
        font-size: 0.56rem;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.5);
    }
    .studio-workspace-layout :global(.production-command-center__notifications li p) {
        margin: 0.15rem 0 0;
        font-size: 0.68rem;
        color: rgba(255, 255, 255, 0.85);
    }
    @media (max-width: 900px) {
        .studio-workspace-layout__header {
            flex-direction: column;
            align-items: stretch;
        }
        .studio-workspace-layout__header-actions {
            justify-content: flex-start;
        }
        .studio-workspace-layout__hero-metrics,
        .studio-workspace-layout__grid,
        .studio-workspace-layout__metrics-strip,
        .studio-workspace-layout :global(.production-command-center__health-row) {
            grid-template-columns: 1fr;
        }
        .studio-workspace-layout__tabs {
            overflow-x: auto;
            flex-wrap: nowrap;
            padding-bottom: 0.5rem;
            scrollbar-width: thin;
        }
        .studio-workspace-layout__tab {
            flex: 0 0 auto;
        }
    }
</style>
