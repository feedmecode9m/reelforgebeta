<script>
    import { createEventDispatcher, onMount } from 'svelte';
    import {
        GUIDE_ME_ASSISTANT_MODES,
        buildGuideMeOperationalBrief,
        loadGuideMeAssistantMode,
        saveGuideMeAssistantMode
    } from '../../lib/studio/guideMeEngine.js';
    import { navigateToTarget } from '../../lib/navigation/deepNavigation.js';

    const dispatch = createEventDispatcher();

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    export let seriesId = 'series-neon-vengeance';

    let assistantMode = loadGuideMeAssistantMode();

    $: brief = buildGuideMeOperationalBrief(seriesId, feedReels, { mode: assistantMode });
    $: mission = brief.mission;
    $: insights = brief.insights;
    $: context = brief.context;

    /** @param {Event} event */
    function handleModeChange(event) {
        const target = /** @type {HTMLSelectElement} */ (event.currentTarget);
        assistantMode = saveGuideMeAssistantMode(/** @type {import('../../lib/studio/guideMeEngine.js').GuideMeAssistantModeId} */ (target.value));
    }

    /** @param {{ targetTab?: string; targetSection?: string }} target */
    function navigate(target) {
        navigateToTarget({
            type: 'studio_tab',
            tab: target.targetTab || 'Overview',
            section: target.targetSection || ''
        });
        dispatch('navigate', {
            tab: target.targetTab,
            section: target.targetSection
        });
        dispatch('action', target);
    }

    onMount(() => {
        assistantMode = loadGuideMeAssistantMode();
    });
</script>

<section
    class="guide-me-assistant"
    data-guide-me-assistant-panel
    data-studio-assistant
    data-guide-me-coaching
    aria-label="Guide Me assistant panel"
>
    <header class="guide-me-assistant__header">
        <div>
            <h4>Guide Me</h4>
            <p>Contextual operational assistant — Sentinel, Copilot, workflow, release, and team signals.</p>
        </div>
        <label class="guide-me-assistant__mode" data-guide-me-mode-select>
            <span>Mode</span>
            <select value={assistantMode} on:change={handleModeChange} aria-label="Guide Me assistant mode">
                {#each GUIDE_ME_ASSISTANT_MODES as mode (mode.id)}
                    <option value={mode.id}>{mode.name}</option>
                {/each}
            </select>
        </label>
    </header>

    <div class="guide-me-assistant__context" data-guide-me-context aria-live="polite">
        <article data-guide-me-series>
            <span>Series</span>
            <strong>{context.seriesName}</strong>
        </article>
        <article data-guide-me-readiness>
            <span>Readiness</span>
            <strong>{context.readinessScore}%</strong>
        </article>
        <article data-guide-me-blockers>
            <span>Blockers</span>
            <strong>{context.blockers.length}</strong>
        </article>
        <article data-guide-me-workflow>
            <span>Workflow</span>
            <strong>{context.workflowState.openTasks} open</strong>
        </article>
        <article data-guide-me-publishing>
            <span>Publishing</span>
            <strong>{context.publishingState.launchReadinessScore}% launch</strong>
        </article>
    </div>

    <div class="guide-me-assistant__mission" data-studio-assistant-mission data-guideme-mission>
        <article class="guide-me-assistant__card guide-me-assistant__card--mission" data-mission-today data-guideme-mission-of-day>
            <span class="guide-me-assistant__label">Mission of the Day</span>
            <p class="guide-me-assistant__value">{brief.missionOfTheDay}</p>
        </article>

        <div class="guide-me-assistant__grid">
            <article class="guide-me-assistant__card" data-mission-top-priority data-guideme-biggest-blocker>
                <span class="guide-me-assistant__label">Biggest Blocker</span>
                <strong>{brief.biggestBlocker.title}</strong>
                <p>{brief.biggestBlocker.detail}</p>
                <button
                    type="button"
                    class="guide-me-assistant__action"
                    data-studio-assistant-action="biggest-blocker"
                    on:click={() => navigate(brief.biggestBlocker)}
                >
                    Resolve
                </button>
            </article>

            <article class="guide-me-assistant__card" data-mission-quick-win data-guideme-fastest-win>
                <span class="guide-me-assistant__label">Fastest Win</span>
                <strong>{brief.fastestWin.title}</strong>
                <p>{brief.fastestWin.detail}</p>
                <em>{brief.fastestWin.estimatedMinutes} min · +{brief.fastestWin.impact}%</em>
                <button
                    type="button"
                    class="guide-me-assistant__action"
                    data-studio-assistant-action="fastest-win"
                    on:click={() => navigate(brief.fastestWin)}
                >
                    Do it
                </button>
            </article>

            <article class="guide-me-assistant__card" data-guideme-next-action>
                <span class="guide-me-assistant__label">Recommended Next Action</span>
                <strong>{brief.recommendedNextAction.title}</strong>
                <p>{brief.recommendedNextAction.detail}</p>
                {#if brief.recommendedNextAction.impact}
                    <em>+{brief.recommendedNextAction.impact}% readiness</em>
                {/if}
                <button
                    type="button"
                    class="guide-me-assistant__action"
                    data-studio-assistant-action="next-action"
                    on:click={() => navigate(brief.recommendedNextAction)}
                >
                    Go
                </button>
            </article>

            <article
                class="guide-me-assistant__card guide-me-assistant__card--release"
                data-guideme-release-advice
            >
                <span class="guide-me-assistant__label">Release Readiness Advice</span>
                <strong>{brief.releaseReadinessAdvice.title}</strong>
                <p>{brief.releaseReadinessAdvice.summary}</p>
                <em>Launch score {brief.releaseReadinessAdvice.launchReadinessScore}%</em>
                <button
                    type="button"
                    class="guide-me-assistant__action"
                    data-studio-assistant-action="release-advice"
                    on:click={() => navigate(brief.releaseReadinessAdvice)}
                >
                    Review
                </button>
            </article>

            <article
                class="guide-me-assistant__card guide-me-assistant__card--risk"
                data-mission-critical-risk
            >
                <span class="guide-me-assistant__label">Critical Risk</span>
                <strong>{mission.criticalRisk.title}</strong>
                <p>{mission.criticalRisk.detail}</p>
                <em>{mission.criticalRisk.severity}</em>
                <button
                    type="button"
                    class="guide-me-assistant__action"
                    data-studio-assistant-action="critical-risk"
                    on:click={() => navigate(mission.criticalRisk)}
                >
                    Review
                </button>
            </article>

            <article class="guide-me-assistant__card guide-me-assistant__card--readiness" data-mission-projected-readiness>
                <span class="guide-me-assistant__label">Projected Readiness</span>
                <div class="guide-me-assistant__readiness-row">
                    <strong>{mission.projectedReadiness.current}%</strong>
                    <span aria-hidden="true">→</span>
                    <strong>{mission.projectedReadiness.projected}%</strong>
                </div>
                <p>
                    +{mission.projectedReadiness.delta}% in ~{mission.projectedReadiness.estimatedMinutes} min
                    · target {mission.projectedReadiness.targetReadiness}%
                </p>
            </article>
        </div>
    </div>

    <div class="guide-me-assistant__insights" data-studio-assistant-insights>
        <h5>Production signals</h5>
        <div class="guide-me-assistant__insight-grid">
            {#each insights as insight (insight.id)}
                <article
                    class="guide-me-assistant__insight guide-me-assistant__insight--{insight.tone}"
                    data-studio-assistant-insight={insight.id}
                    data-guide-me-coaching-card={insight.id}
                >
                    <span class="guide-me-assistant__label">{insight.label}</span>
                    <p class="guide-me-assistant__value">{insight.summary}</p>
                    <p class="guide-me-assistant__detail">{insight.detail}</p>
                    {#if insight.actionLabel}
                        <button
                            type="button"
                            class="guide-me-assistant__action"
                            data-guide-me-coaching-action={insight.id}
                            on:click={() => navigate(insight)}
                        >
                            {insight.actionLabel}
                        </button>
                    {/if}
                </article>
            {/each}
        </div>
    </div>
</section>

<style>
    .guide-me-assistant {
        margin-bottom: 1rem;
        padding: 0.85rem;
        border-radius: 10px;
        border: 1px solid var(--studio-border-strong, rgba(0, 242, 255, 0.18));
        background: var(--studio-surface, rgba(0, 0, 0, 0.28));
    }
    .guide-me-assistant__header {
        display: flex;
        justify-content: space-between;
        gap: 0.75rem;
        align-items: flex-start;
    }
    .guide-me-assistant__header h4 {
        margin: 0 0 0.2rem;
        font-size: 0.82rem;
        color: var(--studio-accent, var(--neon-cyan, #00f2ff));
    }
    .guide-me-assistant__header p {
        margin: 0;
        font-size: 0.68rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .guide-me-assistant__mode {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        min-width: 140px;
    }
    .guide-me-assistant__mode span {
        font-size: 0.56rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--studio-text-subtle, rgba(255, 255, 255, 0.45));
    }
    .guide-me-assistant__mode select {
        padding: 0.35rem 0.45rem;
        border-radius: 6px;
        border: 1px solid var(--studio-border, rgba(255, 255, 255, 0.12));
        background: rgba(255, 255, 255, 0.04);
        color: var(--studio-text, #fff);
        font-size: 0.62rem;
    }
    .guide-me-assistant__context {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
        gap: 0.45rem;
        margin-top: 0.75rem;
    }
    .guide-me-assistant__context article {
        padding: 0.45rem 0.5rem;
        border-radius: 6px;
        border: 1px solid var(--studio-border, rgba(255, 255, 255, 0.08));
        background: rgba(255, 255, 255, 0.03);
    }
    .guide-me-assistant__context span {
        display: block;
        font-size: 0.54rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--studio-text-subtle, rgba(255, 255, 255, 0.45));
    }
    .guide-me-assistant__context strong {
        font-size: 0.72rem;
        color: var(--studio-text, rgba(255, 255, 255, 0.92));
    }
    .guide-me-assistant__mission {
        margin-top: 0.75rem;
    }
    .guide-me-assistant__card {
        padding: 0.65rem;
        border-radius: 8px;
        border: 1px solid var(--studio-border, rgba(255, 255, 255, 0.08));
        background: rgba(255, 255, 255, 0.03);
    }
    .guide-me-assistant__card--mission {
        margin-bottom: 0.65rem;
        border-color: var(--studio-border-strong, rgba(0, 242, 255, 0.25));
        background: var(--studio-accent-muted, rgba(0, 242, 255, 0.06));
    }
    .guide-me-assistant__card--risk {
        border-color: rgba(255, 82, 82, 0.35);
    }
    .guide-me-assistant__card--readiness {
        border-color: rgba(16, 185, 129, 0.28);
    }
    .guide-me-assistant__card--release {
        border-color: rgba(255, 193, 7, 0.28);
    }
    .guide-me-assistant__grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 0.55rem;
    }
    .guide-me-assistant__label {
        display: block;
        margin-bottom: 0.3rem;
        font-size: 0.58rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--studio-text-subtle, rgba(255, 255, 255, 0.45));
    }
    .guide-me-assistant__value,
    .guide-me-assistant__card strong {
        display: block;
        margin: 0 0 0.3rem;
        font-size: 0.74rem;
        line-height: 1.45;
        color: var(--studio-text, rgba(255, 255, 255, 0.92));
    }
    .guide-me-assistant__card p,
    .guide-me-assistant__detail {
        margin: 0 0 0.35rem;
        font-size: 0.64rem;
        line-height: 1.4;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .guide-me-assistant__card em {
        display: block;
        margin-bottom: 0.4rem;
        font-size: 0.58rem;
        font-style: normal;
        color: var(--studio-accent, var(--neon-cyan, #00f2ff));
    }
    .guide-me-assistant__readiness-row {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        margin-bottom: 0.25rem;
    }
    .guide-me-assistant__readiness-row strong {
        font-size: 0.9rem;
        margin: 0;
    }
    .guide-me-assistant__insights {
        margin-top: 0.85rem;
        padding-top: 0.75rem;
        border-top: 1px solid var(--studio-border, rgba(255, 255, 255, 0.08));
    }
    .guide-me-assistant__insights h5 {
        margin: 0 0 0.55rem;
        font-size: 0.68rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .guide-me-assistant__insight-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 0.55rem;
    }
    .guide-me-assistant__insight--warning {
        border-color: rgba(255, 193, 7, 0.35);
    }
    .guide-me-assistant__insight--critical {
        border-color: rgba(255, 82, 82, 0.45);
    }
    .guide-me-assistant__insight {
        padding: 0.6rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.02);
    }
    .guide-me-assistant__action {
        padding: 0.3rem 0.55rem;
        border-radius: 4px;
        border: 1px solid var(--studio-border-strong, rgba(0, 242, 255, 0.35));
        background: var(--studio-accent-muted, rgba(0, 242, 255, 0.08));
        color: var(--studio-accent, var(--neon-cyan, #00f2ff));
        font-size: 0.6rem;
        font-weight: 700;
        text-transform: uppercase;
        cursor: pointer;
    }
    :global([data-guide-me-mode='true']) [data-studio-assistant-mission] {
        box-shadow: 0 0 0 1px rgba(0, 242, 255, 0.25);
    }
</style>
