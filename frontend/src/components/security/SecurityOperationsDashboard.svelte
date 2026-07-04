<script>
    import { onDestroy, onMount } from 'svelte';
    import {
        buildSecurityOperationsBrief,
        initSecurityOperationsCenter,
        SOC_DASHBOARD_SECTIONS
    } from '../../lib/security/securityOperationsCenter.js';
    import { emitAccessibilityAudit } from '../../lib/accessibility/accessibilityAudit.js';

    /** @type {string} */
    export let seriesId = 'series-neon-vengeance';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {ReturnType<typeof buildSecurityOperationsBrief> | null} */
    let brief = null;

    let refreshTimer = null;

    function refresh() {
        initSecurityOperationsCenter();
        brief = buildSecurityOperationsBrief(seriesId, feedReels);
        emitAccessibilityAudit('SecurityOperationsDashboard', {
            action: 'refresh',
            threatLevel: brief?.threatLevel || 'unknown'
        });
    }

    onMount(() => {
        refresh();
        refreshTimer = window.setInterval(refresh, 5000);
        const onThreat = () => refresh();
        window.addEventListener('reelforge:threat-updated', onThreat);
        return () => window.removeEventListener('reelforge:threat-updated', onThreat);
    });

    onDestroy(() => {
        if (refreshTimer) clearInterval(refreshTimer);
    });

    $: seriesId, feedReels, refresh();
</script>

{#if brief}
    <section class="security-operations-dashboard" data-security-operations-dashboard data-soc-dashboard aria-label="Security operations dashboard">
        <header class="security-operations-dashboard__header">
            <div>
                <h5>Security Operations Center</h5>
                <p>Unified threat, audit, Sentinel, and platform security telemetry.</p>
            </div>
            <span class="security-operations-dashboard__level" data-soc-threat-level role="status" aria-live="polite">{brief.threatLevel}</span>
        </header>

        <article class="security-operations-dashboard__score" data-soc-platform-score aria-live="polite">
            <span class="security-operations-dashboard__label">Platform Security Score</span>
            <strong>{brief.platformSecurityScore.combinedScore}/100</strong>
            <p>
                Audit {brief.platformSecurityScore.auditScore} · Threat {brief.platformSecurityScore.threatScore} ·
                Sentinel {brief.platformSecurityScore.sentinelScore} · {brief.platformSecurityScore.grade}
            </p>
        </article>

        <div class="security-operations-dashboard__sections">
            <section class="security-operations-dashboard__panel" data-soc-threat-timeline>
                <h6>{SOC_DASHBOARD_SECTIONS[0].title}</h6>
                {#if brief.sections.threatTimeline.length}
                    <ul>
                        {#each brief.sections.threatTimeline as entry (entry.id)}
                            <li data-soc-timeline-entry={entry.id}>
                                <strong>{entry.label}</strong>
                                <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                            </li>
                        {/each}
                    </ul>
                {:else}
                    <p class="security-operations-dashboard__empty">No timeline events recorded yet.</p>
                {/if}
            </section>

            <section class="security-operations-dashboard__panel" data-soc-active-incidents>
                <h6>{SOC_DASHBOARD_SECTIONS[1].title}</h6>
                {#if brief.sections.activeIncidents.length}
                    <ul>
                        {#each brief.sections.activeIncidents as incident (incident.id)}
                            <li data-soc-incident={incident.id}>
                                <strong>{incident.title}</strong>
                                <span>{incident.level}</span>
                                <p>{incident.detail}</p>
                            </li>
                        {/each}
                    </ul>
                {:else}
                    <p class="security-operations-dashboard__empty">No active incidents — threat posture is clear.</p>
                {/if}
            </section>

            <section class="security-operations-dashboard__panel" data-soc-threat-map>
                <h6>{SOC_DASHBOARD_SECTIONS[2].title}</h6>
                <div class="security-operations-dashboard__map">
                    {#each brief.sections.threatMap as zone (zone.category)}
                        <article data-soc-threat-zone={zone.category}>
                            <span>{zone.label}</span>
                            <strong>{zone.count}</strong>
                            <em>{zone.level}</em>
                        </article>
                    {/each}
                </div>
            </section>

            <section class="security-operations-dashboard__panel" data-soc-recent-events>
                <h6>{SOC_DASHBOARD_SECTIONS[3].title}</h6>
                {#if brief.sections.recentSecurityEvents.length}
                    <ul>
                        {#each brief.sections.recentSecurityEvents as event (event.id)}
                            <li data-soc-event={event.id}>
                                <strong>{event.category} · {event.type}</strong>
                                <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                            </li>
                        {/each}
                    </ul>
                {:else}
                    <p class="security-operations-dashboard__empty">No recent security events stored.</p>
                {/if}
            </section>

            <section class="security-operations-dashboard__panel" data-soc-attack-surface>
                <h6>{SOC_DASHBOARD_SECTIONS[4].title}</h6>
                <ul>
                    <li>{brief.sections.attackSurfaceOverview.domainCount} audited domains</li>
                    <li>{brief.sections.attackSurfaceOverview.routeCount} tracked routes</li>
                    <li>{brief.sections.attackSurfaceOverview.studioActivity} studio actions today</li>
                    <li>{brief.sections.attackSurfaceOverview.publishingVelocity} publish events / 7d</li>
                </ul>
            </section>

            <section class="security-operations-dashboard__panel" data-soc-audit-results>
                <h6>{SOC_DASHBOARD_SECTIONS[5].title}</h6>
                <strong>{brief.sections.securityAuditResults.score}/100 · {brief.sections.securityAuditResults.grade}</strong>
                <p>{brief.sections.securityAuditResults.findingCount} findings tracked</p>
                <ul>
                    {#each brief.sections.securityAuditResults.topFindings as finding (finding.id)}
                        <li data-soc-audit-finding={finding.id}>
                            <strong>{finding.title}</strong>
                            <span>{finding.severity}</span>
                        </li>
                    {/each}
                </ul>
            </section>

            <section class="security-operations-dashboard__panel" data-soc-recommended-actions>
                <h6>{SOC_DASHBOARD_SECTIONS[7].title}</h6>
                <ul>
                    {#each brief.sections.recommendedActions as action (action.id)}
                        <li data-soc-action={action.id}>{action.detail}</li>
                    {/each}
                </ul>
            </section>
        </div>
    </section>
{/if}

<style>
    .security-operations-dashboard {
        margin-top: 0.75rem;
        padding: 0.75rem;
        border-radius: 10px;
        border: 1px solid rgba(59, 130, 246, 0.24);
        background: rgba(59, 130, 246, 0.05);
    }
    .security-operations-dashboard__header {
        display: flex;
        justify-content: space-between;
        gap: 0.75rem;
        align-items: flex-start;
        margin-bottom: 0.65rem;
    }
    .security-operations-dashboard__header h5 {
        margin: 0 0 0.2rem;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(147, 197, 253, 0.95);
    }
    .security-operations-dashboard__header p {
        margin: 0;
        font-size: 0.62rem;
        line-height: 1.45;
        color: rgba(255, 255, 255, 0.55);
    }
    .security-operations-dashboard__level {
        padding: 0.25rem 0.55rem;
        border-radius: 999px;
        font-size: 0.62rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: #93c5fd;
        border: 1px solid rgba(59, 130, 246, 0.35);
        background: rgba(59, 130, 246, 0.12);
    }
    .security-operations-dashboard__score {
        margin-bottom: 0.65rem;
        padding: 0.65rem 0.75rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
    }
    .security-operations-dashboard__label {
        display: block;
        margin-bottom: 0.2rem;
        font-size: 0.56rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.45);
    }
    .security-operations-dashboard__score strong {
        display: block;
        font-size: 1rem;
        color: #93c5fd;
    }
    .security-operations-dashboard__score p {
        margin: 0.2rem 0 0;
        font-size: 0.6rem;
        color: rgba(255, 255, 255, 0.55);
    }
    .security-operations-dashboard__sections {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 0.55rem;
    }
    .security-operations-dashboard__panel {
        padding: 0.6rem 0.65rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(0, 0, 0, 0.18);
    }
    .security-operations-dashboard__panel h6 {
        margin: 0 0 0.4rem;
        font-size: 0.6rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.62);
    }
    .security-operations-dashboard__panel ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.35rem;
    }
    .security-operations-dashboard__panel li {
        font-size: 0.6rem;
        line-height: 1.4;
        color: rgba(255, 255, 255, 0.72);
    }
    .security-operations-dashboard__panel strong {
        display: block;
        color: rgba(255, 255, 255, 0.92);
    }
    .security-operations-dashboard__panel span,
    .security-operations-dashboard__panel em {
        font-size: 0.54rem;
        font-style: normal;
        color: rgba(255, 255, 255, 0.45);
    }
    .security-operations-dashboard__panel p {
        margin: 0.15rem 0 0;
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.5);
    }
    .security-operations-dashboard__map {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.35rem;
    }
    .security-operations-dashboard__map article {
        padding: 0.45rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        background: rgba(255, 255, 255, 0.02);
    }
    .security-operations-dashboard__empty {
        margin: 0;
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.45);
    }
</style>
