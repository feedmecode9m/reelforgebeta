<script>
    import { createEventDispatcher, onDestroy, onMount } from 'svelte';
    import {
        buildPlatformOperationsBrief,
        emitCommandCenterDiagnostics,
        initCommandCenter
    } from '../../lib/command/commandCenter.js';
    import StudioWorkspaceLayout from './StudioWorkspaceLayout.svelte';
    import RevenueDashboard from '../revenue/RevenueDashboard.svelte';
    import MarketplaceDashboard from '../marketplace/MarketplaceDashboard.svelte';
    import SecurityOperationsDashboard from '../security/SecurityOperationsDashboard.svelte';
    import EnterpriseControlCenter from '../enterprise/EnterpriseControlCenter.svelte';
    import ExecutiveReportsDashboard from '../reporting/ExecutiveReportsDashboard.svelte';
import GlobalSearchBar from '../discovery/GlobalSearchBar.svelte';

    const dispatch = createEventDispatcher();

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    export let selectedSeriesId = 'series-neon-vengeance';

    /** @type {ReturnType<typeof buildPlatformOperationsBrief> | null} */
    let brief = null;

    let activeDashboardSection = 'executive-overview';
    let refreshKey = 0;
    let refreshTimer = null;
    let initialized = false;

    function refreshBrief(phase = 'refresh') {
        brief = buildPlatformOperationsBrief(selectedSeriesId, feedReels);
        emitCommandCenterDiagnostics(phase === 'load' ? 'load' : 'refresh', selectedSeriesId, brief, {
            source: 'production-command-center',
            feedReels
        });
        if (typeof window !== 'undefined') {
            window.dispatchEvent(
                new CustomEvent('reelforge:command-center-updated', { detail: brief.snapshot })
            );
        }
    }

    function handleManualRefresh() {
        refreshKey += 1;
        refreshBrief('refresh');
    }

    function handleChanged() {
        refreshKey += 1;
        refreshBrief('refresh');
        dispatch('changed');
    }

    /** @param {CustomEvent<{ dashboardSection?: string }>} event */
    function handleSearchNavigate(event) {
        const section = String(event?.detail?.dashboardSection || '').trim();
        if (!section) return;
        const match = (brief?.dashboardSections || []).find((item) => item.id === section);
        if (match) {
            activeDashboardSection = match.id;
        }
    }

    /** @param {string} sectionId */
    function selectDashboardSection(sectionId) {
        activeDashboardSection = sectionId;
    }

    /** @param {KeyboardEvent} event @param {number} index */
    function handleSectionTabKeydown(event, index) {
        const key = event.key;
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(key)) return;
        event.preventDefault();

        const tabs = brief?.dashboardSections || [];
        if (!tabs.length) return;
        const direction = key === 'ArrowLeft' ? -1 : 1;
        const nextIndex =
            key === 'Home'
                ? 0
                : key === 'End'
                    ? tabs.length - 1
                    : (index + direction + tabs.length) % tabs.length;
        const nextSection = tabs[nextIndex];
        selectDashboardSection(nextSection.id);
        /** @type {HTMLButtonElement | null} */
        const nextButton = document.querySelector(`[data-command-dashboard-section="${nextSection.id}"]`);
        nextButton?.focus();
    }

    onMount(() => {
        initCommandCenter();
        refreshBrief('load');
        initialized = true;
        refreshTimer = window.setInterval(() => {
            refreshKey += 1;
            refreshBrief('refresh');
        }, 5000);

        const onUpdate = () => {
            refreshKey += 1;
            refreshBrief('refresh');
        };
        window.addEventListener('reelforge:workflow-tasks-updated', onUpdate);
        window.addEventListener('reelforge:teams-updated', onUpdate);
        window.addEventListener('reelforge:notifications-updated', onUpdate);
        window.addEventListener('reelforge:pipeline-updated', onUpdate);
        window.addEventListener('reelforge:release-schedule-updated', onUpdate);
        window.addEventListener('reelforge:search-navigate', handleSearchNavigate);
        return () => {
            window.removeEventListener('reelforge:workflow-tasks-updated', onUpdate);
            window.removeEventListener('reelforge:teams-updated', onUpdate);
            window.removeEventListener('reelforge:notifications-updated', onUpdate);
            window.removeEventListener('reelforge:pipeline-updated', onUpdate);
            window.removeEventListener('reelforge:release-schedule-updated', onUpdate);
            window.removeEventListener('reelforge:search-navigate', handleSearchNavigate);
        };
    });

    onDestroy(() => {
        if (refreshTimer) window.clearInterval(refreshTimer);
    });

    $: refreshKey, selectedSeriesId, feedReels, initialized && refreshBrief('refresh');
</script>

<div
    class="production-command-center-shell"
    data-production-command-center
    data-production-operations-dashboard
>
    <header class="production-command-center-shell__header">
        <div>
            <h3>Production Command Center</h3>
            <p>
                Single-pane operational dashboard — Sentinel, security, production, publishing, teams, hero intelligence,
                operations, and notifications.
            </p>
        </div>
        <div class="production-command-center-shell__header-actions">
            <GlobalSearchBar />
            <button
                type="button"
                class="production-command-center-shell__refresh"
                data-command-center-refresh
                on:click={handleManualRefresh}
            >
                Refresh
            </button>
        </div>
    </header>

    {#if brief}
        <section class="production-command-center-shell__kpi" data-command-kpi-strip aria-live="polite">
            <article class="production-command-center-shell__kpi-card" data-command-readiness>
                <span>Readiness</span>
                <strong>{brief.readinessScore}%</strong>
            </article>
            <article class="production-command-center-shell__kpi-card" data-command-threat-level>
                <span>Threat Level</span>
                <strong data-threat-level={brief.threatLevel}>{brief.threatLevel}</strong>
            </article>
            <article class="production-command-center-shell__kpi-card" data-command-top-risks>
                <span>Top Risks</span>
                <strong>{brief.topRisks.length}</strong>
            </article>
            <article class="production-command-center-shell__kpi-card" data-command-recommended-actions>
                <span>Recommended Actions</span>
                <strong>{brief.recommendedActions.length}</strong>
            </article>
        </section>

        <section class="production-command-center-shell__aggregates" data-command-platform-aggregates>
            <article data-command-sentinel-summary>
                <span>Sentinel Assistant</span>
                <strong>{brief.sentinel.readinessScore}% readiness</strong>
                <p>{brief.sentinel.executiveSummary}</p>
            </article>
            <article data-command-hero-intelligence>
                <span>Hero Intelligence</span>
                <strong>{brief.hero.primary.seriesTitle}</strong>
                <p>{brief.hero.primary.readinessPercent}% · {brief.hero.primary.biggestBlocker}</p>
            </article>
            <article data-command-operations-dashboard>
                <span>Operations Dashboard</span>
                <strong>{brief.operations.dailyActiveViewers} viewers</strong>
                <p>{brief.operations.publishingVelocity} publishing velocity · {brief.operations.studioProductivity} productivity</p>
            </article>
            <article data-command-notifications-summary>
                <span>Notifications</span>
                <strong>{brief.notifications.unreadCount} unread</strong>
                <p>{brief.notifications.recent[0]?.message || 'No recent alerts'}</p>
            </article>
        </section>

        <div
            class="production-command-center-shell__sections"
            data-command-dashboard-sections
            aria-label="Command center sections"
            role="tablist"
        >
            {#each brief.dashboardSections as section, index (section.id)}
                <button
                    type="button"
                    id={`command-center-section-tab-${section.id}`}
                    class="production-command-center-shell__section-tab"
                    class:production-command-center-shell__section-tab--active={activeDashboardSection === section.id}
                    role="tab"
                    aria-selected={activeDashboardSection === section.id}
                    aria-controls="command-center-section-panel"
                    aria-current={activeDashboardSection === section.id ? 'page' : undefined}
                    tabindex={activeDashboardSection === section.id ? 0 : -1}
                    data-command-dashboard-section={section.id}
                    on:click={() => selectDashboardSection(section.id)}
                    on:keydown={(event) => handleSectionTabKeydown(event, index)}
                >
                    {section.title}
                </button>
            {/each}
        </div>

        <div
            id="command-center-section-panel"
            class="production-command-center-shell__dashboard"
            data-command-dashboard-panel
            role="tabpanel"
            aria-labelledby={`command-center-section-tab-${activeDashboardSection}`}
        >
            {#each brief.dashboardSections as section (section.id)}
                {#if activeDashboardSection === section.id}
                    <article
                        class="production-command-center-shell__dashboard-card"
                        data-command-dashboard-detail={section.id}
                    >
                        <header>
                            <h4>{section.title}</h4>
                            {#if section.placeholder}
                                <em data-command-section-placeholder>Future release</em>
                            {/if}
                        </header>
                        <strong>{section.headline}</strong>
                        <p>{section.detail}</p>
                        {#if section.metric}
                            <span>{section.metric}</span>
                        {/if}

                        {#if section.id === 'revenue'}
                            <RevenueDashboard {feedReels} seriesId={selectedSeriesId} />
                        {/if}

                        {#if section.id === 'marketplace'}
                            <MarketplaceDashboard />
                        {/if}

                        {#if section.id === 'security'}
                            <SecurityOperationsDashboard {feedReels} seriesId={selectedSeriesId} />
                            <ul class="production-command-center-shell__mini-list" data-command-security-signals>
                                <li>Security score {brief.securityScore}/100</li>
                                <li>Threat level {brief.threatLevel}</li>
                                <li>{brief.snapshot.repair.suggestionCount} repair suggestions tracked</li>
                            </ul>
                        {/if}

                        {#if section.id === 'enterprise'}
                            <EnterpriseControlCenter organizationId="" {feedReels} />
                        {/if}

                        {#if section.id === 'reports'}
                            <ExecutiveReportsDashboard seriesId={selectedSeriesId} {feedReels} />
                        {/if}

                        {#if section.id === 'production'}
                            <ul class="production-command-center-shell__mini-list">
                                <li>{brief.snapshot.workflow.openTaskCount} open workflow tasks</li>
                                <li>{brief.snapshot.workflow.bottleneckCount} bottlenecks</li>
                                <li>{brief.workflowHealth}% workflow health</li>
                            </ul>
                        {/if}

                        {#if section.id === 'publishing'}
                            <ul class="production-command-center-shell__mini-list">
                                <li>{brief.publishingHealth}% publishing health</li>
                                <li>{brief.snapshot.releases.activeCount} active releases</li>
                                <li>{brief.snapshot.readiness.publishing}% publishing readiness</li>
                            </ul>
                        {/if}

                        {#if section.id === 'teams'}
                            <ul class="production-command-center-shell__mini-list" data-command-team-health>
                                <li>{brief.teamHealth}% team health</li>
                                <li>{brief.snapshot.team.activityCount} recent team events</li>
                                <li>{brief.notifications.unreadCount} unread notifications</li>
                            </ul>
                        {/if}
                    </article>
                {/if}
            {/each}
        </div>

        {#if brief.topRisks.length}
            <section class="production-command-center-shell__risks" data-command-top-risks-panel>
                <h4>Top Risks</h4>
                <ul>
                    {#each brief.topRisks as risk (risk.id)}
                        <li data-command-top-risk-item={risk.id}>
                            <span>{risk.title}</span>
                            <em>{risk.severity}</em>
                        </li>
                    {/each}
                </ul>
            </section>
        {/if}

        {#if brief.recommendedActions.length}
            <section class="production-command-center-shell__actions" data-command-recommended-actions-panel>
                <h4>Recommended Actions</h4>
                <ul>
                    {#each brief.recommendedActions as action (action.id || action.title)}
                        <li data-command-recommended-action={action.id || action.title}>
                            <strong>{action.title}</strong>
                            <p>{action.detail}</p>
                        </li>
                    {/each}
                </ul>
            </section>
        {/if}

        <section class="production-command-center-shell__focus" data-command-todays-focus>
            <div class="production-command-center-shell__focus-head">
                <span>Today&apos;s Focus</span>
                <strong>{brief.snapshot.readiness.score}% readiness</strong>
            </div>
            <ul class="production-command-center-shell__focus-list">
                {#each brief.todaysFocus as item (item.id)}
                    <li data-command-focus-item={item.id}>{item.label}</li>
                {/each}
            </ul>
        </section>

        <section class="production-command-center-shell__status-grid" data-command-status-grid>
            {#each brief.statusSections as section (section.id)}
                <article
                    class="production-command-center-shell__status-card"
                    data-command-status-section={section.id}
                    data-command-status-title={section.title}
                >
                    <span class="production-command-center-shell__status-label">{section.title}</span>
                    <strong>{section.headline}</strong>
                    <p>{section.detail}</p>
                    {#if section.metric}
                        <em>{section.metric}</em>
                    {/if}
                </article>
            {/each}
        </section>

        <section class="production-command-center-shell__signals" data-command-signals>
            <article class="production-command-center-shell__signal" data-command-metric-readiness>
                <span>Readiness</span>
                <strong>{brief.snapshot.readiness.score}%</strong>
            </article>
            <article class="production-command-center-shell__signal" data-command-metric-releases>
                <span>Active Releases</span>
                <strong>{brief.snapshot.releases.activeCount}</strong>
            </article>
            <article class="production-command-center-shell__signal" data-command-metric-bottlenecks>
                <span>Workflow Bottlenecks</span>
                <strong>{brief.snapshot.workflow.bottleneckCount}</strong>
            </article>
            <article class="production-command-center-shell__signal" data-command-metric-notifications>
                <span>Notifications</span>
                <strong>{brief.snapshot.notifications.unreadCount}</strong>
            </article>
            <article class="production-command-center-shell__signal" data-command-metric-risks>
                <span>Production Risks</span>
                <strong>{brief.productionRisks.length}</strong>
            </article>
            <article class="production-command-center-shell__signal" data-command-metric-repairs>
                <span>Repair Suggestions</span>
                <strong>{brief.snapshot.repair.suggestionCount}</strong>
            </article>
        </section>

        {#if brief.productionRisks.length}
            <section class="production-command-center-shell__risks" data-command-production-risks>
                <h4>Production Risks</h4>
                <ul>
                    {#each brief.productionRisks as risk (risk.id)}
                        <li data-command-risk-item={risk.id}>
                            <span>{risk.label}</span>
                            <em>{risk.severity}</em>
                        </li>
                    {/each}
                </ul>
            </section>
        {/if}
    {/if}

    <StudioWorkspaceLayout
        embeddedInCommandCenter={true}
        {feedReels}
        bind:selectedSeriesId
        on:changed={handleChanged}
    >
        <slot name="production" slot="production" />
        <slot name="content" slot="content" />
        <slot name="teams" slot="teams" />
        <slot name="analytics" slot="analytics" />
        <slot name="automation" slot="automation" />
        <slot name="system" slot="system" />
    </StudioWorkspaceLayout>
</div>

<style>
    .production-command-center-shell {
        margin-top: 0.5rem;
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
    }
    .production-command-center-shell__header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 0.85rem 1rem;
        border-radius: 12px;
        border: 1px solid rgba(0, 242, 255, 0.22);
        background: linear-gradient(165deg, rgba(8, 12, 20, 0.92) 0%, rgba(0, 0, 0, 0.55) 100%);
    }
    .production-command-center-shell__header h3 {
        margin: 0 0 0.25rem;
        font-size: 0.95rem;
        color: var(--neon-cyan, #00f2ff);
    }
    .production-command-center-shell__header p {
        margin: 0;
        font-size: 0.68rem;
        color: rgba(255, 255, 255, 0.55);
        max-width: 42rem;
    }
    .production-command-center-shell__refresh {
        padding: 0.4rem 0.75rem;
        border-radius: 4px;
        border: 1px solid rgba(0, 242, 255, 0.35);
        background: rgba(0, 242, 255, 0.1);
        color: var(--neon-cyan, #00f2ff);
        font-size: 0.65rem;
        font-weight: 700;
        text-transform: uppercase;
        cursor: pointer;
    }
    .production-command-center-shell__header-actions {
        display: flex;
        align-items: center;
        gap: 0.45rem;
    }
    .production-command-center-shell__kpi {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
        gap: 0.55rem;
    }
    .production-command-center-shell__kpi-card {
        padding: 0.65rem 0.75rem;
        border-radius: 10px;
        border: 1px solid rgba(0, 242, 255, 0.18);
        background: rgba(0, 242, 255, 0.05);
    }
    .production-command-center-shell__kpi-card span {
        display: block;
        margin-bottom: 0.2rem;
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.45);
    }
    .production-command-center-shell__kpi-card strong {
        font-size: 0.95rem;
        color: var(--neon-cyan, #00f2ff);
    }
    .production-command-center-shell__aggregates {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 0.55rem;
    }
    .production-command-center-shell__aggregates article {
        padding: 0.65rem 0.75rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
    }
    .production-command-center-shell__aggregates span {
        display: block;
        margin-bottom: 0.2rem;
        font-size: 0.56rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.42);
    }
    .production-command-center-shell__aggregates strong {
        display: block;
        margin-bottom: 0.2rem;
        font-size: 0.76rem;
        color: rgba(255, 255, 255, 0.92);
    }
    .production-command-center-shell__aggregates p {
        margin: 0;
        font-size: 0.62rem;
        line-height: 1.4;
        color: rgba(255, 255, 255, 0.58);
    }
    .production-command-center-shell__sections {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
    }
    .production-command-center-shell__section-tab {
        padding: 0.35rem 0.65rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.03);
        color: rgba(255, 255, 255, 0.72);
        font-size: 0.62rem;
        cursor: pointer;
    }
    .production-command-center-shell__section-tab--active {
        border-color: rgba(0, 242, 255, 0.35);
        background: rgba(0, 242, 255, 0.1);
        color: var(--neon-cyan, #00f2ff);
    }
    .production-command-center-shell__dashboard-card,
    .production-command-center-shell__focus,
    .production-command-center-shell__status-grid,
    .production-command-center-shell__signals,
    .production-command-center-shell__risks,
    .production-command-center-shell__actions {
        padding: 0.85rem 1rem;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(0, 0, 0, 0.28);
    }
    .production-command-center-shell__dashboard-card header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.45rem;
    }
    .production-command-center-shell__dashboard-card h4 {
        margin: 0;
        font-size: 0.78rem;
        color: rgba(255, 255, 255, 0.85);
    }
    .production-command-center-shell__dashboard-card header em {
        font-size: 0.56rem;
        font-style: normal;
        color: rgba(255, 193, 7, 0.85);
        text-transform: uppercase;
    }
    .production-command-center-shell__dashboard-card strong {
        display: block;
        margin-bottom: 0.25rem;
        font-size: 0.86rem;
        color: rgba(255, 255, 255, 0.95);
    }
    .production-command-center-shell__dashboard-card p,
    .production-command-center-shell__dashboard-card span {
        display: block;
        font-size: 0.64rem;
        line-height: 1.45;
        color: rgba(255, 255, 255, 0.58);
    }
    .production-command-center-shell__mini-list {
        margin: 0.55rem 0 0;
        padding-left: 1rem;
        color: rgba(255, 255, 255, 0.62);
        font-size: 0.64rem;
    }
    .production-command-center-shell__actions h4,
    .production-command-center-shell__risks h4 {
        margin: 0 0 0.45rem;
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.75);
    }
    .production-command-center-shell__actions ul,
    .production-command-center-shell__risks ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 0.45rem;
    }
    .production-command-center-shell__actions li,
    .production-command-center-shell__risks li {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        font-size: 0.66rem;
        color: rgba(255, 255, 255, 0.82);
    }
    .production-command-center-shell__actions strong {
        font-size: 0.68rem;
    }
    .production-command-center-shell__actions p {
        margin: 0;
        font-size: 0.6rem;
        color: rgba(255, 255, 255, 0.52);
    }
    .production-command-center-shell__risks em {
        font-style: normal;
        color: rgba(255, 193, 7, 0.85);
        font-size: 0.58rem;
        text-transform: uppercase;
    }
    .production-command-center-shell__focus-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.55rem;
    }
    .production-command-center-shell__focus-head span {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.55);
    }
    .production-command-center-shell__focus-head strong {
        font-size: 0.82rem;
        color: var(--neon-cyan, #00f2ff);
    }
    .production-command-center-shell__focus-list {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
        margin: 0;
        padding: 0;
        list-style: none;
    }
    .production-command-center-shell__focus-list li {
        padding: 0.35rem 0.65rem;
        border-radius: 999px;
        border: 1px solid rgba(0, 242, 255, 0.25);
        background: rgba(0, 242, 255, 0.08);
        font-size: 0.68rem;
        color: rgba(255, 255, 255, 0.9);
    }
    .production-command-center-shell__status-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 0.65rem;
    }
    .production-command-center-shell__status-card {
        padding: 0.65rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
    }
    .production-command-center-shell__status-label {
        display: block;
        margin-bottom: 0.25rem;
        font-size: 0.58rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.45);
    }
    .production-command-center-shell__status-card strong {
        display: block;
        margin-bottom: 0.25rem;
        font-size: 0.82rem;
        color: rgba(255, 255, 255, 0.95);
    }
    .production-command-center-shell__status-card p {
        margin: 0 0 0.25rem;
        font-size: 0.64rem;
        line-height: 1.4;
        color: rgba(255, 255, 255, 0.62);
    }
    .production-command-center-shell__status-card em {
        font-size: 0.58rem;
        font-style: normal;
        color: rgba(255, 255, 255, 0.42);
    }
    .production-command-center-shell__signals {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 0.55rem;
    }
    .production-command-center-shell__signal {
        padding: 0.55rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        background: rgba(255, 255, 255, 0.02);
    }
    .production-command-center-shell__signal span {
        display: block;
        margin-bottom: 0.2rem;
        font-size: 0.58rem;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.45);
    }
    .production-command-center-shell__signal strong {
        font-size: 0.9rem;
        color: var(--neon-cyan, #00f2ff);
    }
</style>
