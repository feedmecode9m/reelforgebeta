<script>
    import { onDestroy, onMount } from 'svelte';
    import { buildEnterpriseObservabilitySnapshot } from '../../lib/observability/observabilityCenter.js';

    /** @type {string} */
    export let seriesId = 'series-neon-vengeance';

    /** @type {ReturnType<typeof buildEnterpriseObservabilitySnapshot> | null} */
    let snapshot = null;
    let refreshTimer = null;

    function refresh() {
        snapshot = buildEnterpriseObservabilitySnapshot(seriesId);
    }

    onMount(() => {
        refresh();
        refreshTimer = window.setInterval(refresh, 5000);
        const onUpdate = () => refresh();
        window.addEventListener('reelforge:metrics-updated', onUpdate);
        window.addEventListener('reelforge:notifications-updated', onUpdate);
        window.addEventListener('reelforge:workflow-tasks-updated', onUpdate);
        window.addEventListener('reelforge:observability-updated', onUpdate);
        return () => {
            window.removeEventListener('reelforge:metrics-updated', onUpdate);
            window.removeEventListener('reelforge:notifications-updated', onUpdate);
            window.removeEventListener('reelforge:workflow-tasks-updated', onUpdate);
            window.removeEventListener('reelforge:observability-updated', onUpdate);
        };
    });

    onDestroy(() => {
        if (refreshTimer) window.clearInterval(refreshTimer);
    });

    $: seriesId, refresh();
</script>

{#if snapshot}
    <section class="enterprise-observability" data-enterprise-observability>
        <div class="enterprise-observability__header">
            <h4>Enterprise Observability</h4>
            <span class="enterprise-observability__score" data-health-score>
                Health {snapshot.healthScore}%
            </span>
        </div>

        <div class="enterprise-observability__grid">
            <article class="enterprise-observability__card" data-metric-api-latency>
                <span>API Latency</span>
                <strong>{snapshot.apiLatencyMs}ms</strong>
            </article>
            <article class="enterprise-observability__card" data-metric-db-latency>
                <span>Database Latency</span>
                <strong>{snapshot.databaseLatencyMs}ms</strong>
            </article>
            <article class="enterprise-observability__card" data-metric-workflow-throughput>
                <span>Workflow Throughput</span>
                <strong>{snapshot.workflowThroughput}</strong>
            </article>
            <article class="enterprise-observability__card" data-metric-notification-throughput>
                <span>Notification Throughput</span>
                <strong>{snapshot.notificationThroughput}</strong>
            </article>
            <article class="enterprise-observability__card" data-metric-publishing-throughput>
                <span>Publishing Throughput</span>
                <strong>{snapshot.publishingThroughput}</strong>
            </article>
            <article class="enterprise-observability__card" data-metric-viewer-engagement>
                <span>Viewer Engagement</span>
                <strong>{snapshot.viewerEngagement}</strong>
            </article>
        </div>

        {#if snapshot.alerts.length > 0}
            <ul class="enterprise-observability__alerts" data-system-alerts>
                {#each snapshot.alerts as alert (alert.code)}
                    <li data-system-alert data-alert-level={alert.level}>
                        <strong>{alert.code}</strong>
                        <span>{alert.message}</span>
                    </li>
                {/each}
            </ul>
        {/if}
    </section>
{/if}

<style>
    .enterprise-observability {
        margin-top: 0.85rem;
        padding: 0.85rem;
        border-radius: 8px;
        border: 1px solid rgba(157, 255, 176, 0.22);
        background: rgba(120, 220, 120, 0.05);
    }
    .enterprise-observability__header {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.35rem;
        margin-bottom: 0.55rem;
    }
    .enterprise-observability__header h4 {
        margin: 0;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #9dffb0;
    }
    .enterprise-observability__score {
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.65);
    }
    .enterprise-observability__grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.45rem;
        margin-bottom: 0.55rem;
    }
    .enterprise-observability__card {
        padding: 0.5rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(0, 0, 0, 0.2);
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
    }
    .enterprise-observability__card span {
        font-size: 0.56rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.5);
    }
    .enterprise-observability__card strong {
        font-size: 0.9rem;
        color: #9dffb0;
    }
    .enterprise-observability__alerts {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }
    .enterprise-observability__alerts li {
        padding: 0.4rem 0.5rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 193, 7, 0.22);
        background: rgba(255, 193, 7, 0.05);
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
    }
    .enterprise-observability__alerts strong {
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #ffd76a;
    }
    .enterprise-observability__alerts span {
        font-size: 0.64rem;
        color: rgba(255, 255, 255, 0.75);
    }
    @media (max-width: 900px) {
        .enterprise-observability__grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
</style>
