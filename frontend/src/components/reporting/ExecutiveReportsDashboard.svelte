<script>
    import { onDestroy, onMount } from 'svelte';
    import {
        buildExecutiveReportsDashboard,
        exportExecutiveReport,
        generateExecutiveReport,
        initReportingEngine,
        REPORT_CADENCES,
        REPORT_METRICS
    } from '../../lib/reporting/reportingEngine.js';

    /** @type {string} */
    export let seriesId = 'series-neon-vengeance';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {ReturnType<typeof buildExecutiveReportsDashboard> | null} */
    let dashboard = null;

    /** @type {import('../../lib/reporting/reportingEngine.js').ReportCadence} */
    let selectedCadence = 'Daily';

    /** @type {string} */
    let exportStatus = '';

    let refreshTimer = null;

    function refresh() {
        initReportingEngine();
        dashboard = buildExecutiveReportsDashboard(seriesId, feedReels);
    }

    function generateSelectedReport() {
        const report = generateExecutiveReport(seriesId, feedReels, { cadence: selectedCadence });
        exportStatus = `Generated ${report.cadence} report · ${report.id}`;
        refresh();
    }

    /** @param {'json' | 'csv' | 'pdf'} format */
    function exportSelected(format) {
        const report =
            dashboard?.latestByCadence?.[selectedCadence] ||
            generateExecutiveReport(seriesId, feedReels, { cadence: selectedCadence, persist: false });
        const exported = exportExecutiveReport(report, format);
        exportStatus = `Exported ${exported.format.toUpperCase()} · ${exported.filename}`;
    }

    onMount(() => {
        refresh();
        refreshTimer = window.setInterval(refresh, 8000);
        const onUpdate = () => refresh();
        window.addEventListener('reelforge:reporting-updated', onUpdate);
        return () => window.removeEventListener('reelforge:reporting-updated', onUpdate);
    });

    onDestroy(() => {
        if (refreshTimer) clearInterval(refreshTimer);
    });

    $: seriesId, feedReels, refresh();
</script>

{#if dashboard}
    <section class="executive-reports" data-executive-reports-dashboard>
        <header class="executive-reports__header">
            <div>
                <h5>Executive Reports</h5>
                <p>Automatic daily, weekly, monthly, and quarterly executive summaries.</p>
            </div>
        </header>

        <div class="executive-reports__controls" data-executive-report-controls>
            <label>
                <span>Cadence</span>
                <select bind:value={selectedCadence} data-executive-report-cadence>
                    {#each REPORT_CADENCES as cadence (cadence)}
                        <option value={cadence}>{cadence}</option>
                    {/each}
                </select>
            </label>
            <button type="button" class="executive-reports__btn" data-executive-report-generate on:click={generateSelectedReport}>
                Generate
            </button>
            <button type="button" class="executive-reports__btn" data-executive-report-export-json on:click={() => exportSelected('json')}>
                Export JSON
            </button>
            <button type="button" class="executive-reports__btn" data-executive-report-export-csv on:click={() => exportSelected('csv')}>
                Export CSV
            </button>
            <button type="button" class="executive-reports__btn" data-executive-report-export-pdf on:click={() => exportSelected('pdf')}>
                PDF Payload
            </button>
        </div>

        {#if exportStatus}
            <p class="executive-reports__status" data-executive-report-status>{exportStatus}</p>
        {/if}

        <section class="executive-reports__metrics" data-executive-report-metrics>
            <h6>Metrics</h6>
            <div class="executive-reports__metric-grid">
                {#each REPORT_METRICS as metric (metric)}
                    <article data-executive-report-metric={metric}>
                        <span>{metric}</span>
                        <ul>
                            {#each Object.entries(dashboard.latestByCadence[selectedCadence]?.metrics?.[metric] || {}) as [key, value] (key)}
                                <li><strong>{key}</strong> {value}</li>
                            {/each}
                        </ul>
                    </article>
                {/each}
            </div>
        </section>

        <section class="executive-reports__summary" data-executive-report-summary>
            <article>
                <h6>Highlights</h6>
                <ul>
                    {#each dashboard.latestByCadence[selectedCadence]?.highlights || [] as highlight, index (index)}
                        <li data-executive-report-highlight>{highlight}</li>
                    {/each}
                </ul>
            </article>
            <article>
                <h6>Risks</h6>
                <ul>
                    {#each dashboard.latestByCadence[selectedCadence]?.risks || [] as risk, index (index)}
                        <li data-executive-report-risk>{risk}</li>
                    {/each}
                </ul>
            </article>
        </section>

        <section class="executive-reports__recent" data-executive-report-recent>
            <h6>Recent Reports</h6>
            {#if dashboard.recentReports.length}
                <ul>
                    {#each dashboard.recentReports as report (report.id)}
                        <li data-executive-report-item={report.id}>
                            <strong>{report.cadence}</strong>
                            <span>{new Date(report.generatedAt).toLocaleString()}</span>
                        </li>
                    {/each}
                </ul>
            {:else}
                <p class="executive-reports__empty">No persisted reports yet. Generate one to begin.</p>
            {/if}
        </section>
    </section>
{/if}

<style>
    .executive-reports {
        margin-top: 0.75rem;
        padding: 0.85rem;
        border-radius: var(--studio-radius, 10px);
        border: 1px solid rgba(167, 139, 250, 0.28);
        background: rgba(0, 0, 0, 0.24);
        display: grid;
        gap: 0.75rem;
    }
    .executive-reports__header h5 {
        margin: 0 0 0.2rem;
        color: #c4b5fd;
        font-size: 0.82rem;
    }
    .executive-reports__header p {
        margin: 0;
        font-size: 0.64rem;
        color: rgba(255, 255, 255, 0.55);
    }
    .executive-reports__controls {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
        align-items: end;
    }
    .executive-reports__controls label {
        display: grid;
        gap: 0.2rem;
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.55);
    }
    .executive-reports__controls select {
        font-size: 0.64rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(0, 0, 0, 0.28);
        color: #fff;
        padding: 0.25rem 0.35rem;
    }
    .executive-reports__btn {
        border: 1px solid rgba(196, 181, 253, 0.35);
        background: rgba(196, 181, 253, 0.08);
        color: #ddd6fe;
        border-radius: 6px;
        padding: 0.28rem 0.55rem;
        font-size: 0.58rem;
        text-transform: uppercase;
        cursor: pointer;
    }
    .executive-reports__status,
    .executive-reports__empty {
        margin: 0;
        font-size: 0.64rem;
        color: rgba(255, 255, 255, 0.55);
    }
    .executive-reports__metrics h6,
    .executive-reports__summary h6,
    .executive-reports__recent h6 {
        margin: 0 0 0.35rem;
        font-size: 0.72rem;
        color: #ddd6fe;
    }
    .executive-reports__metric-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.45rem;
    }
    .executive-reports__metric-grid article {
        padding: 0.45rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
        font-size: 0.62rem;
    }
    .executive-reports__metric-grid span {
        display: block;
        margin-bottom: 0.25rem;
        color: #c4b5fd;
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }
    .executive-reports__metric-grid ul,
    .executive-reports__summary ul,
    .executive-reports__recent ul {
        margin: 0;
        padding-left: 1rem;
        color: rgba(255, 255, 255, 0.72);
        font-size: 0.62rem;
    }
    .executive-reports__summary {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.55rem;
    }
    @media (max-width: 1100px) {
        .executive-reports__metric-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
</style>
