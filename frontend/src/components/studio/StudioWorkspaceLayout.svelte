<script>
    import { createEventDispatcher, onDestroy, onMount } from 'svelte';
    import { seriesCatalog } from '../../lib/series/seriesStore.js';
    import {
        auditProductionOperations,
        buildEpisodeOperationRows,
        computeProductionReadiness,
        computeSeriesHealth,
        getMissingAssetQueue
    } from '../../lib/series/productionHealth.js';
    import { auditEpisodeAssets } from '../../lib/series/episodeAssetStatus.js';
    import {
        buildCommandCenterSnapshot,
        logCommandCenterDiag
    } from '../../lib/command/commandCenter.js';
    import { evaluateNotificationTriggers } from '../../lib/notifications/notificationCenter.js';
    import { auditStudioHelpRegistry } from '../../lib/studio/studioHelpRegistry.js';
    import {
        WORKSPACE_TABS,
        initStudioWorkspace,
        loadWorkspaceTab,
        logStudioWorkspaceDiag,
        saveWorkspaceTab,
        workspaceTabSlug
    } from '../../lib/studio/studioWorkspace.js';
    import { buildStudioActionPlan } from '../../lib/series/actionEngine.js';
    import SeriesHealthDashboard from '../series/SeriesHealthDashboard.svelte';
    import ProductionReadinessMeter from '../series/ProductionReadinessMeter.svelte';
    import CreatorEpisodeReadinessBoard from './CreatorEpisodeReadinessBoard.svelte';
    import EpisodeOperationsTable from '../series/EpisodeOperationsTable.svelte';
    import MissingAssetQueue from '../series/MissingAssetQueue.svelte';
    import StudioContextualWarnings from '../studio/StudioContextualWarnings.svelte';
    import StudioActionCoach from '../series/StudioActionCoach.svelte';
    import WorkflowTaskCenter from '../workflow/WorkflowTaskCenter.svelte';
    import TeamManager from '../teams/TeamManager.svelte';
    import PipelineBoard from '../pipeline/PipelineBoard.svelte';
    import ProductionPipelineBoard from '../workflows/ProductionPipelineBoard.svelte';
    import ReleaseCenter from '../release/ReleaseCenter.svelte';
    import CreatorCopilot from '../copilot/CreatorCopilot.svelte';
    import StudioRepairCenter from '../series/StudioRepairCenter.svelte';
    import OperationsDashboard from '../series/OperationsDashboard.svelte';
    import CreatorKnowledgeGraphPanel from '../graph/CreatorKnowledgeGraphPanel.svelte';
    import EnterpriseObservabilityPanel from '../observability/EnterpriseObservabilityPanel.svelte';
    import {
        emitGuideMePanelContext,
        initGuideMeEngine,
        isGuideMeModeEnabled
    } from '../../lib/studio/guideMeEngine.js';
    import { CREATOR_PRODUCTION_UPDATED } from '../../lib/studio/creatorActionRouter.js';
    import { emitAccessibilityAudit } from '../../lib/accessibility/accessibilityAudit.js';
    import GuideMeAssistantPanel from '../studio/GuideMeAssistantPanel.svelte';
    import GlobalSearchBar from '../discovery/GlobalSearchBar.svelte';
    import SupportReelforgeSection from './SupportReelforgeSection.svelte';
    import DailyEngagementSection from './DailyEngagementSection.svelte';
    import CreatorHomeFeed from './CreatorHomeFeed.svelte';
    import CreatorProfile from './CreatorProfile.svelte';
    import MonetizationHub from '../monetization/MonetizationHub.svelte';

    const dispatch = createEventDispatcher();

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    export let selectedSeriesId = 'series-neon-vengeance';

    /** When true, parent ProductionCommandCenter owns command-center diagnostics. */
    export let embeddedInCommandCenter = false;

    /** @type {typeof WORKSPACE_TABS[number]} */
    let activeTab = loadWorkspaceTab();

    let refreshKey = 0;
    let refreshTimer = null;
    let guideMeMode = isGuideMeModeEnabled();

    /** @type {ReturnType<typeof buildCommandCenterSnapshot> | null} */
    let snapshot = null;

    /** @type {Record<string, boolean>} */
    let expandedSections = {
        readinessDetail: false,
        coverageDetail: false,
        actionsDetail: false,
        notificationsDetail: false,
        releasesDetail: false,
        teamDetail: false
    };

    function refreshSnapshot(phase = 'refresh') {
        snapshot = buildCommandCenterSnapshot(selectedSeriesId, feedReels);
        if (!embeddedInCommandCenter) {
            logCommandCenterDiag(phase === 'load' ? 'COMMAND_CENTER_LOAD' : 'COMMAND_CENTER_REFRESH', {
            seriesId: selectedSeriesId,
            section: activeTab,
            readinessScore: snapshot.readiness.score,
            activeReleases: snapshot.releases.activeCount,
            bottleneckCount: snapshot.workflow.bottleneckCount,
            teamActivityCount: snapshot.team.activityCount,
            unreadNotifications: snapshot.notifications.unreadCount,
            repairSuggestions: snapshot.repair.suggestionCount
        });
        }
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('reelforge:command-center-updated', { detail: snapshot }));
        }
    }

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
        refreshSnapshot('load');
        refreshTimer = window.setInterval(() => {
            refreshKey += 1;
            refreshSnapshot('refresh');
        }, 5000);

        const onUpdate = () => {
            refreshKey += 1;
            refreshSnapshot('refresh');
        };
        const onProductionUpdated = () => {
            refreshKey += 1;
            refreshSnapshot('refresh');
            dispatch('changed');
        };
        window.addEventListener('reelforge:workflow-tasks-updated', onUpdate);
        window.addEventListener('reelforge:teams-updated', onUpdate);
        window.addEventListener('reelforge:notifications-updated', onUpdate);
        window.addEventListener('reelforge:pipeline-updated', onUpdate);
        window.addEventListener('reelforge:release-schedule-updated', onUpdate);
        window.addEventListener(CREATOR_PRODUCTION_UPDATED, onProductionUpdated);
        window.addEventListener('reelforge:search-navigate', handleSearchNavigate);
        return () => {
            window.removeEventListener('reelforge:workflow-tasks-updated', onUpdate);
            window.removeEventListener('reelforge:teams-updated', onUpdate);
            window.removeEventListener('reelforge:notifications-updated', onUpdate);
            window.removeEventListener('reelforge:pipeline-updated', onUpdate);
            window.removeEventListener('reelforge:release-schedule-updated', onUpdate);
            window.removeEventListener(CREATOR_PRODUCTION_UPDATED, onProductionUpdated);
            window.removeEventListener('reelforge:search-navigate', handleSearchNavigate);
        };
    });

    onDestroy(() => {
        if (refreshTimer) window.clearInterval(refreshTimer);
    });

    $: health = computeSeriesHealth(feedReels, selectedSeriesId);
    $: readiness = computeProductionReadiness(feedReels, selectedSeriesId);
    $: operationRows = buildEpisodeOperationRows(feedReels, selectedSeriesId);
    $: missingQueue = getMissingAssetQueue(feedReels, selectedSeriesId);
    $: actionPlan = buildStudioActionPlan(selectedSeriesId, feedReels);
    $: refreshKey, auditProductionOperations(feedReels, selectedSeriesId, true);
    $: refreshKey, selectedSeriesId, feedReels, evaluateNotificationTriggers(selectedSeriesId, feedReels);
    $: selectedSeriesId, feedReels, refreshSnapshot('refresh');

    /** @param {typeof WORKSPACE_TABS[number]} tab */
    function selectTab(tab) {
        activeTab = tab;
        saveWorkspaceTab(tab);
        logStudioWorkspaceDiag('WORKSPACE_TAB', { tab, seriesId: selectedSeriesId });
        emitGuideMePanelContext(selectedSeriesId, feedReels, tab);
        guideMeMode = isGuideMeModeEnabled();
        refreshSnapshot('refresh');
        emitAccessibilityAudit('StudioWorkspaceLayout', {
            action: 'tab_change',
            activeTab: tab
        });
    }

    /** @param {Event & { currentTarget: HTMLDetailsElement }} event @param {string} sectionId */
    function handleSectionToggle(event, sectionId) {
        expandedSections = { ...expandedSections, [sectionId]: event.currentTarget.open };
        logStudioWorkspaceDiag('WORKSPACE_SECTION', {
            section: sectionId,
            expanded: event.currentTarget.open,
            tab: activeTab
        });
    }

    function handleManualRefresh() {
        refreshKey += 1;
        refreshSnapshot('refresh');
        logStudioWorkspaceDiag('STUDIO_REFRESH', { phase: 'manual', tab: activeTab });
    }

    function handleQueueAttached(event) {
        auditEpisodeAssets(feedReels, true);
        refreshKey += 1;
        dispatch('changed');
    }

    function handleReleaseScheduled() {
        refreshKey += 1;
        dispatch('changed');
    }


    /** @param {CustomEvent<{ tab?: string; section?: string }>} event */
    function handleGuideMeNavigate(event) {
        const tab = event.detail?.tab;
        if (tab && WORKSPACE_TABS.includes(/** @type {typeof WORKSPACE_TABS[number]} */ (tab))) {
            selectTab(/** @type {typeof WORKSPACE_TABS[number]} */ (tab));
        }
    }

    function handleRepaired() {
        refreshKey += 1;
        dispatch('changed');
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
    class="studio-workspace-layout production-command-center"
    data-studio-workspace-layout
    data-production-command-center={embeddedInCommandCenter ? undefined : true}
    data-production-operations-dashboard={embeddedInCommandCenter ? undefined : true}
    data-active-workspace-tab={workspaceTabSlug(activeTab)}
>
    <header class="studio-workspace-layout__header">
        <div class="studio-workspace-layout__brand">
            <h3>Creator Operating System</h3>
            <span class="studio-workspace-layout__hint">Focused workspace · progressive disclosure</span>
            {#if guideMeMode}
                <span class="studio-workspace-layout__guide-mode" data-guide-me-mode-indicator>Guide Me Mode ON</span>
            {/if}
        </div>
        <div class="studio-workspace-layout__header-actions">
            <GlobalSearchBar />
            <button
                type="button"
                class="studio-workspace-layout__refresh production-command-center__refresh"
                data-command-center-refresh
                on:click={handleManualRefresh}
            >
                Refresh
            </button>
        </div>
    </header>

    <label class="studio-workspace-layout__series-select production-command-center__series-select">
        <span>Series</span>
        <select bind:value={selectedSeriesId} data-command-center-series>
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
        {#if activeTab === 'Overview'}
            <div class="studio-workspace-layout__overview" data-workspace-overview data-command-center-overview data-guide-me-section="overview">
                <GuideMeAssistantPanel
                    {feedReels}
                    seriesId={selectedSeriesId}
                    on:navigate={handleGuideMeNavigate}
                />
                <CreatorHomeFeed {feedReels} seriesId={selectedSeriesId} />
                <CreatorProfile {feedReels} seriesId={selectedSeriesId} />
                <MonetizationHub />

                <section class="studio-workspace-layout__hero-metrics">
                    <article class="studio-workspace-layout__metric-card" data-workspace-metric-readiness data-command-metric-readiness>
                        <span class="studio-workspace-layout__metric-label">Readiness Score</span>
                        <strong class="studio-workspace-layout__metric-value">{snapshot?.readiness.score ?? readiness.weightedPercent}%</strong>
                        <p class="studio-workspace-layout__metric-copy">Weighted production readiness across metadata, assets, publishing, and release schedule.</p>
                    </article>
                    <article class="studio-workspace-layout__metric-card" data-workspace-metric-coverage>
                        <span class="studio-workspace-layout__metric-label">Coverage</span>
                        <strong class="studio-workspace-layout__metric-value">{health.assetCoverage}%</strong>
                        <p class="studio-workspace-layout__metric-copy">{health.publishedEpisodes} published · {health.missingAssets} missing assets · {health.totalEpisodes} episodes tracked.</p>
                    </article>
                </section>

                <section class="studio-workspace-layout__grid">
                    <article class="studio-workspace-layout__card" data-workspace-top-actions>
                        <h4>Top Actions</h4>
                        {#if actionPlan.recommendations.length === 0}
                            <p class="studio-workspace-layout__empty">No prioritized actions — you're in great shape.</p>
                        {:else}
                            <ul class="studio-workspace-layout__action-list">
                                {#each actionPlan.recommendations.slice(0, 3) as action (action.id)}
                                    <li>
                                        <span>{action.title}</span>
                                        <em>+{action.impact}%</em>
                                    </li>
                                {/each}
                            </ul>
                        {/if}
                    </article>

                    <article class="studio-workspace-layout__card" data-workspace-notifications data-command-metric-notifications>
                        <h4>Notifications</h4>
                        <strong class="studio-workspace-layout__inline-stat">{snapshot?.notifications.unreadCount ?? 0} unread</strong>
                        {#if snapshot?.notifications.recent.length}
                            <ul class="studio-workspace-layout__compact-list">
                                {#each snapshot.notifications.recent.slice(0, 3) as note (note.id)}
                                    <li data-command-notification-item data-notification-read={note.read}>
                                        <span>{note.type}</span>
                                        <p>{note.message}</p>
                                    </li>
                                {/each}
                            </ul>
                        {:else}
                            <p class="studio-workspace-layout__empty">No recent notifications.</p>
                        {/if}
                    </article>

                    <article class="studio-workspace-layout__card" data-workspace-upcoming-releases data-command-metric-releases>
                        <h4>Upcoming Releases</h4>
                        <strong class="studio-workspace-layout__inline-stat">{snapshot?.releases.activeCount ?? 0} active</strong>
                        {#if snapshot?.releases.entries.length}
                            <ul class="studio-workspace-layout__compact-list">
                                {#each snapshot.releases.entries.slice(0, 3) as release (release.episodeId)}
                                    <li>
                                        <span>{release.title || release.episodeId}</span>
                                        <em>{release.status}{release.releaseDate ? ` · ${release.releaseDate}` : ''}</em>
                                    </li>
                                {/each}
                            </ul>
                        {:else}
                            <p class="studio-workspace-layout__empty">No scheduled releases yet.</p>
                        {/if}
                    </article>

                    <article class="studio-workspace-layout__card" data-workspace-team-activity data-command-metric-team-activity>
                        <h4>Team Activity</h4>
                        <strong class="studio-workspace-layout__inline-stat">{snapshot?.team.activityCount ?? 0} recent events</strong>
                        {#if snapshot?.team.recentActivity.length}
                            <ul class="studio-workspace-layout__compact-list">
                                {#each snapshot.team.recentActivity.slice(0, 3) as item, index (index)}
                                    <li>
                                        <span>{item.user}</span>
                                        <em>{item.type}</em>
                                    </li>
                                {/each}
                            </ul>
                        {:else}
                            <p class="studio-workspace-layout__empty">No team activity recorded.</p>
                        {/if}
                    </article>
                </section>

                <div class="studio-workspace-layout__metrics-strip">
                    <div class="production-command-center__metric" data-command-metric-bottlenecks>
                        <strong>{snapshot?.workflow.bottleneckCount ?? 0}</strong>
                        <span>Bottlenecks</span>
                    </div>
                    <div class="production-command-center__metric" data-command-metric-repairs>
                        <strong>{snapshot?.repair.suggestionCount ?? 0}</strong>
                        <span>Repair Suggestions</span>
                    </div>
                </div>

                <DailyEngagementSection seriesId={selectedSeriesId} {feedReels} />
                <SupportReelforgeSection />

                <div class="studio-workspace-layout__advanced">
                    <details
                        class="studio-workspace-layout__disclosure"
                        open={expandedSections.readinessDetail}
                        on:toggle={(e) => handleSectionToggle(e, 'readinessDetail')}
                    >
                        <summary>Detailed Readiness</summary>
                        <ProductionReadinessMeter {readiness} />
                    </details>
                    <details
                        class="studio-workspace-layout__disclosure"
                        open={expandedSections.coverageDetail}
                        on:toggle={(e) => handleSectionToggle(e, 'coverageDetail')}
                    >
                        <summary>Full Coverage Report</summary>
                        <SeriesHealthDashboard {health} />
                    </details>
                    <details
                        class="studio-workspace-layout__disclosure"
                        open={expandedSections.actionsDetail}
                        on:toggle={(e) => handleSectionToggle(e, 'actionsDetail')}
                    >
                        <summary>Complete Action Plan</summary>
                        <StudioActionCoach {feedReels} seriesId={selectedSeriesId} />
                    </details>
                </div>
            </div>
        {:else if activeTab === 'Production'}
            <div data-workspace-panel-production data-command-section-production data-guide-me-section="production">
                <CreatorEpisodeReadinessBoard rows={operationRows} {actionPlan} seriesId={selectedSeriesId} />
                <slot name="production" />
                <div class="production-command-center__health-row">
                    <SeriesHealthDashboard {health} />
                    <div class="production-command-center__readiness-col">
                        <ProductionReadinessMeter {readiness} />
                    </div>
                </div>
                <WorkflowTaskCenter {feedReels} seriesId={selectedSeriesId} />
                <ProductionPipelineBoard {feedReels} seriesId={selectedSeriesId} />
                <PipelineBoard {feedReels} seriesId={selectedSeriesId} />
            </div>
        {:else if activeTab === 'Content'}
            <div data-workspace-panel-content data-command-section-content data-guide-me-section="content">
                <slot name="content" />
                <ReleaseCenter {feedReels} seriesId={selectedSeriesId} on:scheduled={handleReleaseScheduled} />
                <MissingAssetQueue queue={missingQueue} {feedReels} on:attached={handleQueueAttached} />
                <EpisodeOperationsTable rows={operationRows} />
            </div>
        {:else if activeTab === 'Teams'}
            <div data-workspace-panel-teams data-command-section-teams data-guide-me-section="teams">
                <slot name="teams" />
                <TeamManager seriesId={selectedSeriesId} />
            </div>
        {:else if activeTab === 'Analytics'}
            <div data-workspace-panel-analytics data-command-section-analytics data-guide-me-section="analytics">
                <slot name="analytics" />
                <OperationsDashboard seriesId={selectedSeriesId} />
                <EnterpriseObservabilityPanel seriesId={selectedSeriesId} />
                <CreatorKnowledgeGraphPanel {feedReels} seriesId={selectedSeriesId} />
            </div>
        {:else if activeTab === 'Automation'}
            <div data-workspace-panel-automation data-command-section-automation data-guide-me-section="automation">
                <slot name="automation" />
                <CreatorCopilot {feedReels} seriesId={selectedSeriesId} />
                <StudioActionCoach {feedReels} seriesId={selectedSeriesId} />
            </div>
        {:else if activeTab === 'System'}
            <div data-workspace-panel-system data-command-section-system data-guide-me-section="system">
                <slot name="system" />
                <StudioContextualWarnings {health} {readiness} {operationRows} seriesId={selectedSeriesId} />
                <StudioRepairCenter {feedReels} seriesId={selectedSeriesId} on:repaired={handleRepaired} />
                {#if snapshot?.notifications.recent.length}
                    <div class="production-command-center__notifications" data-command-notifications>
                        <h5>Recent Notifications</h5>
                        <ul>
                            {#each snapshot.notifications.recent as note (note.id)}
                                <li data-command-notification-item data-notification-read={note.read}>
                                    <span>{note.type}</span>
                                    <p>{note.message}</p>
                                </li>
                            {/each}
                        </ul>
                    </div>
                {/if}
            </div>
        {/if}
    </div>
</div>

<style>
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
