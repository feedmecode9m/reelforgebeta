<script>
    import SmartHelpTooltip from '../studio/SmartHelpTooltip.svelte';

    /** @type {import('../../lib/series/productionHealth.js').EpisodeOperationRow[]} */
    export let rows = [];

    let sortKey = 'seasonNumber';
    let sortDir = 1;
    let filterAsset = 'all';
    let filterPublishing = 'all';

    /** @param {string} key */
    function toggleSort(key) {
        if (sortKey === key) sortDir *= -1;
        else {
            sortKey = key;
            sortDir = 1;
        }
    }

    $: filtered = rows.filter((r) => {
        if (filterAsset !== 'all' && r.status !== filterAsset) return false;
        if (filterPublishing !== 'all' && r.publishingStatus !== filterPublishing) return false;
        return true;
    });

    $: sorted = [...filtered].sort((a, b) => {
        const av = a[/** @type {keyof typeof a} */ (sortKey)];
        const bv = b[/** @type {keyof typeof b} */ (sortKey)];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'string' && typeof bv === 'string') {
            return av.localeCompare(bv) * sortDir;
        }
        return (Number(av) - Number(bv)) * sortDir;
    });

    /** @param {number} seconds */
    function formatRuntime(seconds) {
        if (!seconds || seconds <= 0) return '—';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs ? `${mins}m ${secs}s` : `${mins}m`;
    }
</script>

<div class="ops-table" data-episode-operations-table data-studio-walkthrough="episodeOperations">
    <div class="ops-table__toolbar">
        <div class="ops-table__title-row">
            <h4>Episode Operations</h4>
            <SmartHelpTooltip helpKey="episodeOperations" />
        </div>
        <div class="ops-table__filters">
            <label>
                <span>Asset</span>
                <select bind:value={filterAsset}>
                    <option value="all">All</option>
                    <option value="Missing Asset">Missing Asset</option>
                    <option value="Published">Published</option>
                    <option value="Scheduled">Scheduled</option>
                    <option value="Ready">Ready</option>
                    <option value="Draft">Draft</option>
                </select>
            </label>
            <label>
                <span>Publishing</span>
                <select bind:value={filterPublishing}>
                    <option value="all">All</option>
                    <option value="Published">Published</option>
                    <option value="Ready">Ready</option>
                    <option value="Draft">Draft</option>
                </select>
            </label>
        </div>
    </div>
    <div class="ops-table__scroll">
        <table>
            <thead>
                <tr>
                    <th><button type="button" on:click={() => toggleSort('seasonNumber')}>Season</button></th>
                    <th><button type="button" on:click={() => toggleSort('episodeNumber')}>Episode</button></th>
                    <th><button type="button" on:click={() => toggleSort('episodeTitle')}>Title</button></th>
                    <th><button type="button" on:click={() => toggleSort('status')}>Asset Status</button></th>
                    <th><button type="button" on:click={() => toggleSort('publishingStatus')}>Publishing</button></th>
                    <th><button type="button" on:click={() => toggleSort('releaseStatus')}>Release</button></th>
                    <th><button type="button" on:click={() => toggleSort('runtime')}>Runtime</button></th>
                </tr>
            </thead>
            <tbody>
                {#each sorted as row (row.episodeId)}
                    <tr data-episode-op-row data-episode-id={row.episodeId}>
                        <td>S{row.seasonNumber}</td>
                        <td>E{row.episodeNumber}</td>
                        <td>{row.episodeTitle}</td>
                        <td><span class="ops-badge ops-badge--{row.status.replace(/\s+/g, '-').toLowerCase()}">{row.status}</span></td>
                        <td>{row.publishingStatus}</td>
                        <td>{row.releaseStatus}</td>
                        <td>{formatRuntime(row.runtime)}</td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>
    <p class="ops-table__count">{sorted.length} episode{sorted.length === 1 ? '' : 's'} shown</p>
</div>

<style>
    .ops-table {
        margin-top: 0.85rem;
        padding: 0.85rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(0, 0, 0, 0.22);
    }
    .ops-table__toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        margin-bottom: 0.55rem;
    }
    .ops-table__title-row {
        display: flex;
        align-items: center;
        gap: 0.35rem;
    }
    .ops-table__toolbar h4 {
        margin: 0;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.75);
    }
    .ops-table__filters {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
    }
    .ops-table__filters label {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        font-size: 0.58rem;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.45);
    }
    .ops-table__filters select {
        padding: 0.3rem 0.45rem;
        border-radius: 4px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(0, 0, 0, 0.35);
        color: #fff;
        font-size: 0.72rem;
    }
    .ops-table__scroll {
        overflow-x: auto;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.76rem;
    }
    th button {
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.65);
        font: inherit;
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        cursor: pointer;
        padding: 0;
    }
    th, td {
        padding: 0.4rem 0.45rem;
        text-align: left;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    tbody tr:hover {
        background: rgba(0, 242, 255, 0.05);
    }
    .ops-badge {
        font-size: 0.58rem;
        font-weight: 700;
        text-transform: uppercase;
        padding: 0.1rem 0.35rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.16);
    }
    .ops-badge--missing-asset { color: #ffd76a; border-color: rgba(255, 193, 7, 0.4); }
    .ops-badge--published { color: #9dffb0; }
    .ops-badge--scheduled { color: #c9a0ff; }
    .ops-badge--ready { color: #00f2ff; }
    .ops-table__count {
        margin: 0.45rem 0 0;
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.4);
    }
</style>
