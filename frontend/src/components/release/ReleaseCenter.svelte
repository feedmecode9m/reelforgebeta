<script>
    import { createEventDispatcher } from 'svelte';
    import {
        applyBulkReleaseSchedule,
        buildReleaseCenterSnapshot,
        scheduleEpisodeRelease,
        scheduleSeasonRelease
    } from '../../lib/release/releaseCenter.js';

    const dispatch = createEventDispatcher();

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    export let seriesId = '';

    let cadence = 'weekly';
    let dayOfWeek = 5;
    let intervalDays = 7;
    let releaseTime = '19:00';
    let startDate = new Date().toISOString().slice(0, 10);
    let scheduleMessage = '';
    let bulkScope = 'all';
    let bulkSeason = 1;
    let episodeScheduleMessage = '';

    $: snapshot = buildReleaseCenterSnapshot(seriesId, feedReels);
    $: calendar = snapshot.calendar;
    $: launchReadiness = snapshot.launchReadiness;
    $: releaseHealth = snapshot.releaseHealth;
    $: premiereCountdown = snapshot.premiereCountdown;
    $: seasonOptions = [...new Set(calendar.map((e) => e.seasonNumber))].sort((a, b) => a - b);

    const statusLabels = {
        draft: 'Draft',
        ready: 'Ready',
        scheduled: 'Scheduled',
        released: 'Released'
    };

    const weekdayOptions = [
        { value: 0, label: 'Sunday' },
        { value: 1, label: 'Monday' },
        { value: 2, label: 'Tuesday' },
        { value: 3, label: 'Wednesday' },
        { value: 4, label: 'Thursday' },
        { value: 5, label: 'Friday' },
        { value: 6, label: 'Saturday' }
    ];

    function handleBulkSchedule() {
        const config = {
            cadence: /** @type {'daily' | 'weekly' | 'custom'} */ (cadence),
            startDate,
            releaseTime,
            dayOfWeek: cadence === 'weekly' ? dayOfWeek : undefined,
            intervalDays: cadence === 'custom' ? intervalDays : undefined
        };

        const result =
            bulkScope === 'season'
                ? scheduleSeasonRelease(seriesId, feedReels, bulkSeason, config)
                : applyBulkReleaseSchedule(seriesId, feedReels, config);

        scheduleMessage =
            result.applied > 0
                ? `Scheduled ${result.applied} episode${result.applied === 1 ? '' : 's'}`
                : 'No schedulable episodes with assets';

        dispatch('scheduled', { applied: result.applied, launchReadiness: result.launchReadiness });
    }

    /** @param {string} episodeId */
    function handleScheduleEpisode(episodeId) {
        scheduleEpisodeRelease(seriesId, episodeId, startDate, releaseTime);
        episodeScheduleMessage = `Scheduled ${episodeId}`;
        dispatch('scheduled', { applied: 1, episodeId });
    }
</script>

<div class="release-center" data-release-center>
    <div class="release-center__header">
        <h4 class="release-center__title">Release Center</h4>
        <span class="release-center__hint">Production scheduling & launch readiness</span>
    </div>

    {#if premiereCountdown.days != null}
        <div class="release-center__premiere" data-premiere-countdown>
            <span class="release-center__premiere-label">Premiere Countdown</span>
            <span class="release-center__premiere-value" data-premiere-days>
                {premiereCountdown.days}d {premiereCountdown.hours}h
            </span>
            <span class="release-center__premiere-date">
                {premiereCountdown.launchDate} at {premiereCountdown.launchTime || releaseTime}
            </span>
        </div>
    {:else}
        <div class="release-center__premiere release-center__premiere--empty" data-premiere-countdown>
            <span class="release-center__premiere-label">Premiere Countdown</span>
            <span class="release-center__premiere-value" data-premiere-days>—</span>
            <span class="release-center__premiere-date">{premiereCountdown.label}</span>
        </div>
    {/if}

    <div class="release-center__health" data-release-health-panel>
        <div class="release-center__health-score">
            <span class="release-center__health-value" data-launch-readiness-score>
                {launchReadiness.launchReadinessScore}%
            </span>
            <span class="release-center__health-label">Launch Readiness</span>
        </div>
        <div class="release-center__health-grid">
            <div class="release-center__health-stat" data-release-stat-ready>
                <span class="release-center__stat-value">{releaseHealth.episodesReady}</span>
                <span class="release-center__stat-label">Episodes Ready</span>
            </div>
            <div class="release-center__health-stat release-center__health-stat--scheduled" data-release-stat-scheduled>
                <span class="release-center__stat-value">{releaseHealth.episodesScheduled}</span>
                <span class="release-center__stat-label">Episodes Scheduled</span>
            </div>
            <div class="release-center__health-stat release-center__health-stat--warn" data-release-stat-missing>
                <span class="release-center__stat-value">{releaseHealth.episodesMissingAssets}</span>
                <span class="release-center__stat-label">Missing Assets</span>
            </div>
            <div class="release-center__health-stat release-center__health-stat--launch" data-release-stat-days>
                <span class="release-center__stat-value">
                    {releaseHealth.daysUntilLaunch != null ? releaseHealth.daysUntilLaunch : '—'}
                </span>
                <span class="release-center__stat-label">Days Until Launch</span>
            </div>
        </div>
        {#if releaseHealth.launchDate}
            <p class="release-center__launch-date" data-release-launch-date>
                Next launch: <strong>{releaseHealth.launchDate}</strong> at {releaseTime}
            </p>
        {/if}
    </div>

    <div class="release-center__bulk" data-release-bulk-scheduler>
        <h5 class="release-center__section-title">Bulk Scheduling</h5>
        <div class="release-center__bulk-grid">
            <label class="release-center__field">
                <span>Scope</span>
                <select bind:value={bulkScope} data-release-bulk-scope>
                    <option value="all">All Episodes</option>
                    <option value="season">Season</option>
                </select>
            </label>

            {#if bulkScope === 'season'}
                <label class="release-center__field">
                    <span>Season</span>
                    <select bind:value={bulkSeason} data-release-bulk-season>
                        {#each seasonOptions as season (season)}
                            <option value={season}>Season {season}</option>
                        {/each}
                    </select>
                </label>
            {/if}

            <label class="release-center__field">
                <span>Cadence</span>
                <select bind:value={cadence} data-release-cadence>
                    <option value="weekly">Weekly</option>
                    <option value="daily">Daily</option>
                    <option value="custom">Custom</option>
                </select>
            </label>

            {#if cadence === 'weekly'}
                <label class="release-center__field">
                    <span>Release Day</span>
                    <select bind:value={dayOfWeek} data-release-day>
                        {#each weekdayOptions as option (option.value)}
                            <option value={option.value}>{option.label}</option>
                        {/each}
                    </select>
                </label>
            {/if}

            {#if cadence === 'custom'}
                <label class="release-center__field">
                    <span>Every N Days</span>
                    <input type="number" min="1" max="90" bind:value={intervalDays} data-release-interval />
                </label>
            {/if}

            <label class="release-center__field">
                <span>Start Date</span>
                <input type="date" bind:value={startDate} data-release-start-date />
            </label>

            <label class="release-center__field">
                <span>Release Time</span>
                <input type="time" bind:value={releaseTime} data-release-time />
            </label>
        </div>

        <div class="release-center__bulk-actions">
            <button type="button" class="release-center__schedule-btn" data-release-apply-schedule on:click={handleBulkSchedule}>
                Apply Schedule
            </button>
            {#if scheduleMessage}
                <span class="release-center__schedule-msg" role="status">{scheduleMessage}</span>
            {/if}
        </div>

        {#if cadence === 'weekly' && dayOfWeek === 5}
            <p class="release-center__example" data-release-schedule-example>
                Example: Release every Friday at {releaseTime}
            </p>
        {/if}
        {#if cadence === 'daily'}
            <p class="release-center__example" data-release-schedule-example>
                Example: Release daily at {releaseTime} starting {startDate}
            </p>
        {/if}
    </div>

    <div class="release-center__calendar" data-release-calendar>
        <h5 class="release-center__section-title">Release Calendar</h5>
        <div class="release-center__table-scroll">
            <table>
                <thead>
                    <tr>
                        <th>Episode</th>
                        <th>Title</th>
                        <th>Release Date</th>
                        <th>Status</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    {#each calendar as entry (entry.episodeId)}
                        <tr
                            class="release-center__row"
                            data-release-calendar-row
                            data-episode-id={entry.episodeId}
                            data-release-status={entry.status}
                        >
                            <td>{entry.episodeLabel}</td>
                            <td>{entry.episodeTitle}</td>
                            <td>
                                {#if entry.releaseDate}
                                    {entry.releaseDate}
                                    {#if entry.releaseTime}
                                        <span class="release-center__time">{entry.releaseTime}</span>
                                    {/if}
                                {:else}
                                    —
                                {/if}
                            </td>
                            <td>
                                <span
                                    class="release-center__status release-center__status--{entry.status}"
                                    data-release-status-badge
                                >{statusLabels[entry.status]}</span>
                            </td>
                            <td>
                                {#if entry.hasAsset && entry.status !== 'released'}
                                    <button
                                        type="button"
                                        class="release-center__episode-btn"
                                        data-schedule-episode
                                        data-episode-id={entry.episodeId}
                                        on:click={() => handleScheduleEpisode(entry.episodeId)}
                                    >
                                        Schedule
                                    </button>
                                {:else}
                                    <span class="release-center__episode-muted">—</span>
                                {/if}
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
        {#if episodeScheduleMessage}
            <p class="release-center__episode-msg" role="status">{episodeScheduleMessage}</p>
        {/if}
        <p class="release-center__calendar-meta" data-release-calendar-count>
            {calendar.length} episode{calendar.length === 1 ? '' : 's'} ·
            {launchReadiness.readyEpisodes} ready ·
            {launchReadiness.scheduledEpisodes} scheduled ·
            {launchReadiness.missingEpisodes} missing assets
        </p>
    </div>
</div>

<style>
    .release-center {
        margin-top: 0.85rem;
        padding: 0.85rem;
        border-radius: 8px;
        border: 1px solid rgba(180, 120, 255, 0.28);
        background: rgba(180, 120, 255, 0.05);
    }
    .release-center__header {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.35rem;
        margin-bottom: 0.65rem;
    }
    .release-center__title {
        margin: 0;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #c9a0ff;
    }
    .release-center__hint {
        font-size: 0.6rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.45);
    }
    .release-center__premiere {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0.5rem;
        padding: 0.55rem 0.65rem;
        margin-bottom: 0.65rem;
        border-radius: 6px;
        border: 1px solid rgba(157, 255, 176, 0.35);
        background: rgba(120, 220, 120, 0.08);
    }
    .release-center__premiere--empty {
        border-color: rgba(255, 255, 255, 0.12);
        background: rgba(0, 0, 0, 0.15);
    }
    .release-center__premiere-label {
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.5);
    }
    .release-center__premiere-value {
        font-size: 1.1rem;
        font-weight: 800;
        color: #9dffb0;
    }
    .release-center__premiere--empty .release-center__premiere-value {
        color: rgba(255, 255, 255, 0.45);
    }
    .release-center__premiere-date {
        font-size: 0.65rem;
        color: rgba(255, 255, 255, 0.55);
    }
    .release-center__health {
        padding: 0.65rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.22);
        margin-bottom: 0.65rem;
    }
    .release-center__health-score {
        display: flex;
        align-items: baseline;
        gap: 0.45rem;
        margin-bottom: 0.55rem;
    }
    .release-center__health-value {
        font-size: 1.25rem;
        font-weight: 800;
        color: #fff;
    }
    .release-center__health-label {
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.5);
    }
    .release-center__health-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 0.45rem;
    }
    .release-center__health-stat {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
    }
    .release-center__stat-value {
        font-size: 0.95rem;
        font-weight: 700;
        color: #fff;
    }
    .release-center__stat-label {
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.45);
    }
    .release-center__health-stat--scheduled .release-center__stat-value { color: #c9a0ff; }
    .release-center__health-stat--warn .release-center__stat-value { color: #ffd76a; }
    .release-center__health-stat--launch .release-center__stat-value { color: #9dffb0; }
    .release-center__launch-date {
        margin: 0.5rem 0 0;
        font-size: 0.68rem;
        color: rgba(255, 255, 255, 0.55);
    }
    .release-center__section-title {
        margin: 0 0 0.45rem;
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: rgba(255, 255, 255, 0.55);
    }
    .release-center__bulk {
        margin-bottom: 0.65rem;
        padding: 0.65rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(0, 0, 0, 0.18);
    }
    .release-center__bulk-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 0.5rem;
    }
    .release-center__field {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }
    .release-center__field span {
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.45);
    }
    .release-center__field input,
    .release-center__field select {
        padding: 0.4rem 0.55rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(0, 0, 0, 0.35);
        color: #fff;
        font: inherit;
    }
    .release-center__bulk-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
        margin-top: 0.55rem;
    }
    .release-center__schedule-btn {
        padding: 0.45rem 0.75rem;
        border-radius: 6px;
        border: 1px solid #c9a0ff;
        background: rgba(180, 120, 255, 0.15);
        color: #e8d4ff;
        font-size: 0.65rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        cursor: pointer;
    }
    .release-center__schedule-btn:hover {
        background: rgba(180, 120, 255, 0.28);
    }
    .release-center__schedule-msg {
        font-size: 0.68rem;
        color: #9dffb0;
    }
    .release-center__example {
        margin: 0.45rem 0 0;
        font-size: 0.65rem;
        color: rgba(255, 255, 255, 0.45);
        font-style: italic;
    }
    .release-center__table-scroll {
        overflow-x: auto;
    }
    .release-center table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.72rem;
    }
    .release-center th {
        text-align: left;
        padding: 0.4rem 0.5rem;
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.45);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    .release-center td {
        padding: 0.45rem 0.5rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        color: rgba(255, 255, 255, 0.85);
    }
    .release-center__time {
        margin-left: 0.25rem;
        color: rgba(255, 255, 255, 0.45);
        font-size: 0.65rem;
    }
    .release-center__status {
        font-size: 0.58rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        padding: 0.12rem 0.4rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.16);
    }
    .release-center__status--draft { color: rgba(255, 255, 255, 0.55); }
    .release-center__status--ready { color: #00f2ff; border-color: rgba(0, 242, 255, 0.35); }
    .release-center__status--scheduled { color: #c9a0ff; border-color: rgba(180, 120, 255, 0.4); }
    .release-center__status--released { color: #9dffb0; border-color: rgba(120, 220, 120, 0.4); }
    .release-center__episode-btn {
        padding: 0.2rem 0.45rem;
        border-radius: 4px;
        border: 1px solid rgba(180, 120, 255, 0.4);
        background: rgba(180, 120, 255, 0.1);
        color: #e8d4ff;
        font-size: 0.58rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        cursor: pointer;
    }
    .release-center__episode-btn:hover {
        background: rgba(180, 120, 255, 0.22);
    }
    .release-center__episode-muted {
        color: rgba(255, 255, 255, 0.3);
    }
    .release-center__episode-msg {
        margin: 0.35rem 0 0;
        font-size: 0.65rem;
        color: #9dffb0;
    }
    .release-center__calendar-meta {
        margin: 0.45rem 0 0;
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.4);
    }
    @media (max-width: 720px) {
        .release-center__health-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
</style>
