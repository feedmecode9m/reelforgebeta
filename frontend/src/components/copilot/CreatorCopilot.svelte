<script>
    import {
        buildCreatorCopilotBrief,
        projectCopilotReadiness
    } from '../../lib/copilot/creatorCopilot.js';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    export let seriesId = '';

    $: brief = buildCreatorCopilotBrief(seriesId, feedReels);
    $: projection = projectCopilotReadiness(brief);
</script>

{#if brief.recommendedActions.length > 0 || brief.currentReadiness < 100}
    <div class="creator-copilot" data-creator-copilot>
        <div class="creator-copilot__header">
            <h4 class="creator-copilot__title">Creator Copilot</h4>
            <span class="creator-copilot__hint">AI-style production advisor</span>
        </div>

        <p class="creator-copilot__readiness" data-copilot-current-readiness>
            Your series is <strong>{brief.currentReadiness}%</strong> ready.
        </p>

        <div class="creator-copilot__analysis" data-copilot-analysis>
            <span class="creator-copilot__label">Production analysis</span>
            <div class="creator-copilot__analysis-grid">
                <div class="creator-copilot__analysis-stat" data-copilot-readiness-score>
                    <span class="creator-copilot__stat-value">{brief.analysis.readiness.score}%</span>
                    <span class="creator-copilot__stat-label">Readiness</span>
                </div>
                <div class="creator-copilot__analysis-stat" data-copilot-workflow-tasks>
                    <span class="creator-copilot__stat-value">{brief.analysis.workflow.openTasks}</span>
                    <span class="creator-copilot__stat-label">Open Tasks</span>
                </div>
                <div class="creator-copilot__analysis-stat" data-copilot-release-scheduled>
                    <span class="creator-copilot__stat-value">{brief.analysis.release.episodesScheduled}</span>
                    <span class="creator-copilot__stat-label">Scheduled</span>
                </div>
                <div class="creator-copilot__analysis-stat" data-copilot-asset-coverage>
                    <span class="creator-copilot__stat-value">{brief.analysis.assets.coveragePercent}%</span>
                    <span class="creator-copilot__stat-label">Asset Coverage</span>
                </div>
            </div>
        </div>

        <div class="creator-copilot__blocker" data-copilot-blocker>
            <span class="creator-copilot__label">Biggest blocker</span>
            <p class="creator-copilot__blocker-text">{brief.biggestBlocker}</p>
        </div>

        {#if brief.criticalRisks.length > 0}
            <div class="creator-copilot__section" data-copilot-critical-risks>
                <span class="creator-copilot__label">Critical Risks</span>
                <ul class="creator-copilot__rec-list">
                    {#each brief.criticalRisks as risk (risk.id)}
                        <li class="creator-copilot__rec-item" data-copilot-risk data-rec-priority={risk.priority}>
                            <span class="creator-copilot__priority creator-copilot__priority--critical" data-copilot-priority-badge>
                                {risk.priority}
                            </span>
                            <span class="creator-copilot__rec-title">{risk.title}</span>
                            <span class="creator-copilot__rec-meta">+{risk.impact}% · {risk.estimatedMinutes}m</span>
                        </li>
                    {/each}
                </ul>
            </div>
        {/if}

        {#if brief.topPriorities.length > 0}
            <div class="creator-copilot__section" data-copilot-top-priorities>
                <span class="creator-copilot__label">Top Priorities</span>
                <ol class="creator-copilot__path-list">
                    {#each brief.topPriorities as step, index (step.id)}
                        <li class="creator-copilot__path-item" data-copilot-path-step data-copilot-priority-item>
                            <span class="creator-copilot__path-label">{step.title}</span>
                            <span class="creator-copilot__path-meta">
                                <span class="creator-copilot__priority creator-copilot__priority--{step.priority.toLowerCase()}" data-copilot-priority>
                                    {step.priority}
                                </span>
                                <span class="creator-copilot__gain">+{step.impact}%</span>
                            </span>
                        </li>
                    {/each}
                </ol>
            </div>
        {/if}

        {#if brief.quickWins.length > 0}
            <div class="creator-copilot__section" data-copilot-quick-wins>
                <span class="creator-copilot__label">Quick Wins</span>
                <ul class="creator-copilot__rec-list">
                    {#each brief.quickWins as win (win.id)}
                        <li class="creator-copilot__rec-item" data-copilot-quick-win>
                            <span class="creator-copilot__priority creator-copilot__priority--{win.priority.toLowerCase()}">
                                {win.priority}
                            </span>
                            <span class="creator-copilot__rec-title">{win.title}</span>
                            <span class="creator-copilot__rec-meta">+{win.impact}% · {win.estimatedMinutes}m</span>
                        </li>
                    {/each}
                </ul>
            </div>
        {/if}

        <div class="creator-copilot__time" data-copilot-estimated-time>
            <span class="creator-copilot__label">Estimated time</span>
            <span class="creator-copilot__time-value">{brief.estimatedTime} minute{brief.estimatedTime === 1 ? '' : 's'}</span>
        </div>

        <div class="creator-copilot__projected" data-copilot-projected-readiness>
            <span class="creator-copilot__label">Projected Readiness</span>
            <span class="creator-copilot__projected-value">
                {projection.readinessAfter}%
                {#if projection.readinessAfter > projection.readinessBefore}
                    <span class="creator-copilot__gain">(+{projection.readinessAfter - projection.readinessBefore}%)</span>
                {/if}
            </span>
        </div>

        {#if brief.recommendedActions.length > 0}
            <div class="creator-copilot__recs" data-copilot-recommended-actions>
                <span class="creator-copilot__label">Recommended Actions</span>
                <ul class="creator-copilot__rec-list">
                    {#each brief.recommendedActions as rec (rec.id)}
                        <li class="creator-copilot__rec-item" data-copilot-recommendation data-rec-priority={rec.priority}>
                            <span
                                class="creator-copilot__priority creator-copilot__priority--{rec.priority.toLowerCase()}"
                                data-copilot-priority-badge
                            >{rec.priority}</span>
                            <span class="creator-copilot__rec-title">{rec.title}</span>
                            <span class="creator-copilot__rec-meta">+{rec.impact}% · {rec.estimatedMinutes}m</span>
                        </li>
                    {/each}
                </ul>
            </div>
        {/if}
    </div>
{/if}

<style>
    .creator-copilot {
        margin-bottom: 0.75rem;
        padding: 0.85rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 215, 0, 0.28);
        background: linear-gradient(135deg, rgba(255, 215, 0, 0.06) 0%, rgba(0, 0, 0, 0.22) 100%);
        display: flex;
        flex-direction: column;
        gap: 0.55rem;
    }
    .creator-copilot__header {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.35rem;
    }
    .creator-copilot__title {
        margin: 0;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #ffd76a;
    }
    .creator-copilot__hint {
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.4);
    }
    .creator-copilot__readiness {
        margin: 0;
        font-size: 0.82rem;
        color: rgba(255, 255, 255, 0.9);
    }
    .creator-copilot__readiness strong {
        color: #fff;
        font-size: 0.95rem;
    }
    .creator-copilot__analysis {
        padding: 0.5rem 0.55rem;
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .creator-copilot__analysis-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 0.4rem;
    }
    .creator-copilot__analysis-stat {
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
    }
    .creator-copilot__stat-value {
        font-size: 0.85rem;
        font-weight: 700;
        color: #fff;
    }
    .creator-copilot__stat-label {
        font-size: 0.55rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.45);
    }
    .creator-copilot__label {
        display: block;
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.45);
        margin-bottom: 0.2rem;
    }
    .creator-copilot__blocker-text {
        margin: 0;
        font-size: 0.76rem;
        color: rgba(255, 255, 255, 0.85);
        line-height: 1.4;
    }
    .creator-copilot__section {
        padding: 0.45rem 0.5rem;
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.15);
    }
    .creator-copilot__path-list,
    .creator-copilot__rec-list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }
    .creator-copilot__path-list {
        counter-reset: copilot-step;
    }
    .creator-copilot__path-item {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.35rem;
        padding: 0.35rem 0.45rem;
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.2);
        counter-increment: copilot-step;
    }
    .creator-copilot__path-item::before {
        content: counter(copilot-step) '.';
        font-size: 0.68rem;
        font-weight: 700;
        color: #ffd76a;
        min-width: 1.2rem;
    }
    .creator-copilot__path-label {
        flex: 1;
        font-size: 0.74rem;
        color: rgba(255, 255, 255, 0.9);
        min-width: 10rem;
    }
    .creator-copilot__path-meta {
        display: flex;
        align-items: center;
        gap: 0.35rem;
    }
    .creator-copilot__time-value,
    .creator-copilot__projected-value {
        font-size: 0.82rem;
        font-weight: 700;
        color: #fff;
    }
    .creator-copilot__projected-value {
        color: #9dffb0;
    }
    .creator-copilot__gain {
        color: #9dffb0;
        font-size: 0.68rem;
        font-weight: 700;
    }
    .creator-copilot__priority {
        font-size: 0.52rem;
        font-weight: 800;
        letter-spacing: 0.06em;
        padding: 0.1rem 0.35rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        white-space: nowrap;
    }
    .creator-copilot__priority--critical {
        color: #ff8a8a;
        border-color: rgba(255, 100, 100, 0.45);
        background: rgba(255, 80, 80, 0.12);
    }
    .creator-copilot__priority--high {
        color: #ffd76a;
        border-color: rgba(255, 193, 7, 0.4);
        background: rgba(255, 193, 7, 0.08);
    }
    .creator-copilot__priority--medium {
        color: #00f2ff;
        border-color: rgba(0, 242, 255, 0.35);
        background: rgba(0, 242, 255, 0.06);
    }
    .creator-copilot__priority--low {
        color: rgba(255, 255, 255, 0.55);
    }
    .creator-copilot__rec-item {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.72rem;
    }
    .creator-copilot__rec-title {
        flex: 1;
        color: rgba(255, 255, 255, 0.88);
        min-width: 8rem;
    }
    .creator-copilot__rec-meta {
        color: rgba(255, 255, 255, 0.45);
        font-size: 0.65rem;
        white-space: nowrap;
    }
    @media (max-width: 720px) {
        .creator-copilot__analysis-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
</style>
