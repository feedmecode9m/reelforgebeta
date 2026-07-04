<script>
    import { onDestroy, onMount } from 'svelte';
    import {
        buildEnterpriseControlBrief,
        ENTERPRISE_HIERARCHY,
        ENTERPRISE_ROLES,
        initEnterpriseManager
    } from '../../lib/enterprise/enterpriseManager.js';

    /** @type {string} */
    export let organizationId = '';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {ReturnType<typeof buildEnterpriseControlBrief> | null} */
    let brief = null;

    let refreshTimer = null;

    function refresh() {
        initEnterpriseManager();
        brief = buildEnterpriseControlBrief(organizationId, feedReels);
    }

    onMount(() => {
        refresh();
        refreshTimer = window.setInterval(refresh, 5000);
        const onUpdate = () => refresh();
        window.addEventListener('reelforge:enterprise-updated', onUpdate);
        return () => window.removeEventListener('reelforge:enterprise-updated', onUpdate);
    });

    onDestroy(() => {
        if (refreshTimer) clearInterval(refreshTimer);
    });

    $: organizationId, feedReels, refresh();
</script>

{#if brief}
    <section class="enterprise-control-center" data-enterprise-control-center data-enterprise-dashboard>
        <header class="enterprise-control-center__header">
            <div>
                <h5>Enterprise Control Center</h5>
                <p>Organization hierarchy for large studios — studios, departments, teams, series, and creators.</p>
            </div>
            <span class="enterprise-control-center__grade" data-enterprise-health-grade>{brief.health.grade}</span>
        </header>

        <article class="enterprise-control-center__score" data-enterprise-health-score>
            <span class="enterprise-control-center__label">Organization Health</span>
            <strong>{brief.health.healthScore}/100</strong>
            <p>{brief.health.organizationName} · {brief.health.gaps.length} structural gaps tracked</p>
        </article>

        <section class="enterprise-control-center__counts" data-enterprise-entity-counts>
            <article data-enterprise-count="studios">
                <span>Studios</span>
                <strong>{brief.health.counts.studios}</strong>
            </article>
            <article data-enterprise-count="departments">
                <span>Departments</span>
                <strong>{brief.health.counts.departments}</strong>
            </article>
            <article data-enterprise-count="teams">
                <span>Teams</span>
                <strong>{brief.health.counts.teams}</strong>
            </article>
            <article data-enterprise-count="series">
                <span>Series</span>
                <strong>{brief.health.counts.series}</strong>
            </article>
            <article data-enterprise-count="creators">
                <span>Creators</span>
                <strong>{brief.health.counts.creators}</strong>
            </article>
            <article data-enterprise-count="roles">
                <span>Roles</span>
                <strong>{brief.health.counts.roles}</strong>
            </article>
        </section>

        <section class="enterprise-control-center__panel" data-enterprise-hierarchy>
            <h6>Hierarchy</h6>
            <p class="enterprise-control-center__path">
                {ENTERPRISE_HIERARCHY.join(' → ')}
            </p>
            {#if brief.hierarchy.length}
                <ul class="enterprise-control-center__tree">
                    {#each brief.hierarchy as studio (studio.id)}
                        <li data-enterprise-studio={studio.id}>
                            <strong>{studio.name}</strong>
                            <ul>
                                {#each studio.departments as department (department.id)}
                                    <li data-enterprise-department={department.id}>
                                        {department.name}
                                        <ul>
                                            {#each department.teams as team (team.id)}
                                                <li data-enterprise-team={team.id}>
                                                    {team.name}
                                                    <span>{team.series.length} series · {team.creators.length} creators</span>
                                                </li>
                                            {/each}
                                        </ul>
                                    </li>
                                {/each}
                            </ul>
                        </li>
                    {/each}
                </ul>
            {:else}
                <p class="enterprise-control-center__empty">No studios provisioned yet. Create an organization to begin.</p>
            {/if}
        </section>

        <section class="enterprise-control-center__panel" data-enterprise-roles>
            <h6>Roles</h6>
            <p class="enterprise-control-center__path">{ENTERPRISE_ROLES.join(' · ')}</p>
            {#if brief.roles.length}
                <ul>
                    {#each brief.roles as assignment (assignment.id)}
                        <li data-enterprise-role={assignment.role} data-enterprise-role-user={assignment.userId}>
                            <strong>{assignment.displayName}</strong>
                            <span>{assignment.role}</span>
                            <em>{assignment.scopeType}:{assignment.scopeId}</em>
                        </li>
                    {/each}
                </ul>
            {:else}
                <p class="enterprise-control-center__empty">No role assignments recorded.</p>
            {/if}
        </section>

        {#if brief.health.gaps.length}
            <section class="enterprise-control-center__panel" data-enterprise-gaps>
                <h6>Structural Gaps</h6>
                <ul>
                    {#each brief.health.gaps as gap, index (index)}
                        <li data-enterprise-gap={index}>{gap}</li>
                    {/each}
                </ul>
            </section>
        {/if}
    </section>
{/if}

<style>
    .enterprise-control-center {
        margin-top: 0.75rem;
        padding: 0.85rem;
        border-radius: var(--studio-radius, 10px);
        border: 1px solid rgba(56, 189, 248, 0.28);
        background: rgba(0, 0, 0, 0.24);
        display: grid;
        gap: 0.75rem;
    }
    .enterprise-control-center__header {
        display: flex;
        justify-content: space-between;
        gap: 0.75rem;
        align-items: flex-start;
    }
    .enterprise-control-center__header h5 {
        margin: 0 0 0.2rem;
        color: #38bdf8;
        font-size: 0.82rem;
    }
    .enterprise-control-center__header p {
        margin: 0;
        font-size: 0.64rem;
        color: rgba(255, 255, 255, 0.55);
    }
    .enterprise-control-center__grade {
        font-size: 0.68rem;
        font-weight: 700;
        color: #7dd3fc;
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }
    .enterprise-control-center__score strong {
        display: block;
        font-size: 1.35rem;
        color: #e0f2fe;
    }
    .enterprise-control-center__label {
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.55);
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }
    .enterprise-control-center__score p,
    .enterprise-control-center__empty,
    .enterprise-control-center__path {
        margin: 0.25rem 0 0;
        font-size: 0.64rem;
        color: rgba(255, 255, 255, 0.55);
    }
    .enterprise-control-center__counts {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.45rem;
    }
    .enterprise-control-center__counts article {
        padding: 0.45rem;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .enterprise-control-center__counts span {
        display: block;
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.5);
        text-transform: uppercase;
    }
    .enterprise-control-center__counts strong {
        font-size: 0.95rem;
        color: #f0f9ff;
    }
    .enterprise-control-center__panel h6 {
        margin: 0 0 0.35rem;
        font-size: 0.72rem;
        color: #bae6fd;
    }
    .enterprise-control-center__panel ul,
    .enterprise-control-center__tree {
        margin: 0;
        padding-left: 1rem;
        font-size: 0.64rem;
        color: rgba(255, 255, 255, 0.72);
    }
    .enterprise-control-center__panel li {
        margin-bottom: 0.25rem;
    }
    .enterprise-control-center__panel li span,
    .enterprise-control-center__panel li em {
        display: block;
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.45);
    }
</style>
