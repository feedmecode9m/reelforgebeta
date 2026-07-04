<script>
    import { createEventDispatcher } from 'svelte';
    import {
        askSentinel,
        masterAnalysis,
        buildSentinelReports
    } from '../../lib/sentinel/sentinelAssistant.js';
    import { masterMonetizationAnalysis } from '../../lib/revenue/monetizationAI.js';
    import { buildSecurityOperationsBrief } from '../../lib/security/securityOperationsCenter.js';

    const dispatch = createEventDispatcher();

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    export let seriesId = 'series-neon-vengeance';

    /** @type {string} */
    let nextAnswer = '';

    $: master = masterAnalysis(seriesId, feedReels, { emitDiagnostics: false });
    $: monetization = masterMonetizationAnalysis(seriesId, feedReels, { emitDiagnostics: false });
    $: soc = buildSecurityOperationsBrief(seriesId, feedReels, { emitDiagnostics: false });

    function handleAskNext() {
        const result = askSentinel('fix-next', seriesId, feedReels);
        nextAnswer = result.answer;
        void buildSentinelReports(seriesId, feedReels);
    }

    /** @param {{ targetTab?: string; targetSection?: string }} target */
    function navigate(target) {
        dispatch('navigate', {
            tab: target.targetTab,
            section: target.targetSection
        });
    }
</script>

<section class="sentinel-assistant" data-sentinel-assistant-panel>
    <header class="sentinel-assistant__header">
        <div>
            <h4>Sentinel AI Assistant</h4>
            <p>What is happening · why it matters · what should happen next</p>
        </div>
        <span class="sentinel-assistant__risk" data-sentinel-threat-level>{master.threatLevel}</span>
    </header>

    <div class="sentinel-assistant__summary" data-sentinel-executive-summary>
        <span class="sentinel-assistant__label">Executive Summary</span>
        <p>{master.executiveSummary}</p>
    </div>

    <div class="sentinel-assistant__ask" data-sentinel-what-next>
        <span class="sentinel-assistant__label">What should I do next?</span>
        <button type="button" class="sentinel-assistant__ask-btn" data-sentinel-ask="fix-next" on:click={handleAskNext}>
            Ask Sentinel
        </button>
        {#if nextAnswer}
            <p class="sentinel-assistant__answer" data-sentinel-answer>{nextAnswer}</p>
        {:else if master.nextActions[0]}
            <p class="sentinel-assistant__answer">{master.nextActions[0].title} — {master.nextActions[0].detail}</p>
        {/if}
    </div>

    <div class="sentinel-assistant__metrics">
        <article class="sentinel-assistant__metric" data-sentinel-projected-readiness>
            <span class="sentinel-assistant__label">Projected Readiness</span>
            <strong>{master.projectedReadiness.current}% → {master.projectedReadiness.projected}%</strong>
            <p>Target {master.projectedReadiness.targetReadiness}% · +{master.projectedReadiness.delta}%</p>
        </article>
        <article class="sentinel-assistant__metric" data-sentinel-platform-health>
            <span class="sentinel-assistant__label">Platform Health</span>
            <strong>{master.platformHealth}%</strong>
            <p>Workflow {master.workflowHealth}% · Team {master.teamHealth}%</p>
        </article>
        <article class="sentinel-assistant__metric" data-sentinel-security-risk>
            <span class="sentinel-assistant__label">Security Score</span>
            <strong>{master.securityScore}/100</strong>
            <p>Threat {master.threatLevel} · Publishing {master.publishingScore}%</p>
        </article>
    </div>

    <div class="sentinel-assistant__monetization" data-sentinel-monetization>
        <span class="sentinel-assistant__label">Monetization Intelligence</span>
        <div class="sentinel-assistant__metrics">
            <article data-sentinel-monetization-score>
                <span class="sentinel-assistant__label">Revenue Score</span>
                <strong>{monetization.revenueScore}%</strong>
                <p>Readiness {monetization.monetizationReadiness}% · Sponsor {monetization.sponsorReadiness}%</p>
            </article>
            <article data-sentinel-monetization-forecast>
                <span class="sentinel-assistant__label">Projected Monthly</span>
                <strong>{monetization.projectedMonthlyFormatted}</strong>
                <p>{monetization.projectedAnnualFormatted} annual</p>
            </article>
        </div>
        {#if monetization.topOpportunities[0]}
            <p class="sentinel-assistant__answer" data-sentinel-monetization-opportunity>
                {monetization.topOpportunities[0].detail}
            </p>
        {/if}
        {#if monetization.recommendations[0]}
            <p class="sentinel-assistant__answer" data-sentinel-monetization-recommendation>
                {monetization.recommendations[0].title}: {monetization.recommendations[0].detail}
            </p>
        {/if}
    </div>

    <div class="sentinel-assistant__monetization" data-sentinel-soc>
        <span class="sentinel-assistant__label">Security Operations Center</span>
        <div class="sentinel-assistant__metrics">
            <article data-sentinel-soc-score>
                <span class="sentinel-assistant__label">Platform Security Score</span>
                <strong>{soc.platformSecurityScore.combinedScore}/100</strong>
                <p>Threat {soc.threatLevel} · Audit {soc.platformSecurityScore.auditScore}</p>
            </article>
            <article data-sentinel-soc-incidents>
                <span class="sentinel-assistant__label">Active Incidents</span>
                <strong>{soc.sections.activeIncidents.length}</strong>
                <p>{soc.sections.recentSecurityEvents.length} recent events</p>
            </article>
        </div>
        {#if soc.sections.recommendedActions[0]}
            <p class="sentinel-assistant__answer" data-sentinel-soc-action>
                {soc.sections.recommendedActions[0].detail}
            </p>
        {/if}
    </div>

    <div class="sentinel-assistant__grid">
        <section data-sentinel-top-priorities>
            <span class="sentinel-assistant__label">Top Priorities</span>
            <ul>
                {#each master.nextActions.slice(0, 3) as action, index (index)}
                    <li data-sentinel-priority={index}>{action.title}</li>
                {/each}
            </ul>
        </section>

        <section data-sentinel-critical-risks>
            <span class="sentinel-assistant__label">Critical Risks</span>
            <ul>
                {#each master.blockers.slice(0, 3) as blocker (blocker.id)}
                    <li data-sentinel-risk={blocker.id}>{blocker.title}</li>
                {/each}
            </ul>
        </section>

        <section data-sentinel-quick-wins>
            <span class="sentinel-assistant__label">Quick Wins</span>
            <ul>
                {#each master.quickWins.slice(0, 3) as quickWin, index (index)}
                    <li data-sentinel-quick-win={index}>{quickWin}</li>
                {/each}
            </ul>
        </section>
    </div>

    <div class="sentinel-assistant__issues" data-sentinel-top-issues>
        <span class="sentinel-assistant__label">Top Issues</span>
        {#if master.topIssues.length}
            <ul>
                {#each master.topIssues as issue (issue.id)}
                    <li class="sentinel-assistant__issue sentinel-assistant__issue--{issue.severity}" data-sentinel-issue={issue.id}>
                        <strong>{issue.title}</strong>
                        <p>{issue.detail}</p>
                    </li>
                {/each}
            </ul>
        {:else}
            <p class="sentinel-assistant__empty">No issues ranked — platform signals look stable.</p>
        {/if}
    </div>

    <div class="sentinel-assistant__actions" data-sentinel-recommended-actions>
        <span class="sentinel-assistant__label">Recommended Actions</span>
        {#if master.recommendations.length}
            <ul>
                {#each master.recommendations.slice(0, 5) as recommendation, index (index)}
                    <li data-sentinel-recommendation={index}>{recommendation}</li>
                {/each}
            </ul>
        {:else}
            <p class="sentinel-assistant__empty">Continue monitoring studio operations.</p>
        {/if}
    </div>

    {#if master.nextActions.length}
        <footer class="sentinel-assistant__next">
            {#each master.nextActions.slice(0, 3) as action, index (index)}
                <button
                    type="button"
                    class="sentinel-assistant__next-btn"
                    data-sentinel-next-action={index}
                    on:click={() => navigate(action)}
                >
                    <strong>{action.title}</strong>
                    <span>{action.detail}</span>
                </button>
            {/each}
        </footer>
    {/if}
</section>

<style>
    .sentinel-assistant {
        margin-top: 0.85rem;
        padding: 0.85rem;
        border-radius: var(--studio-radius, 10px);
        border: 1px solid var(--studio-border-strong, rgba(59, 130, 246, 0.28));
        background: var(--studio-surface, rgba(0, 0, 0, 0.28));
    }
    .sentinel-assistant__header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 0.75rem;
        margin-bottom: 0.65rem;
    }
    .sentinel-assistant__header h4 {
        margin: 0 0 0.2rem;
        font-size: 0.82rem;
        color: var(--studio-accent, #3b82f6);
    }
    .sentinel-assistant__header p {
        margin: 0;
        font-size: 0.64rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .sentinel-assistant__risk {
        padding: 0.25rem 0.55rem;
        border-radius: 999px;
        font-size: 0.62rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        background: rgba(59, 130, 246, 0.15);
        color: #60a5fa;
        border: 1px solid rgba(59, 130, 246, 0.35);
    }
    .sentinel-assistant__label {
        display: block;
        margin-bottom: 0.25rem;
        font-size: 0.58rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--studio-text-subtle, rgba(255, 255, 255, 0.45));
    }
    .sentinel-assistant__summary,
    .sentinel-assistant__ask,
    .sentinel-assistant__issues,
    .sentinel-assistant__actions,
    .sentinel-assistant__next {
        margin-bottom: 0.65rem;
    }
    .sentinel-assistant__summary p,
    .sentinel-assistant__answer,
    .sentinel-assistant__empty {
        margin: 0;
        font-size: 0.64rem;
        line-height: 1.45;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .sentinel-assistant__ask-btn {
        padding: 0.35rem 0.65rem;
        border-radius: 999px;
        border: 1px solid rgba(59, 130, 246, 0.35);
        background: rgba(59, 130, 246, 0.12);
        color: #fff;
        font-size: 0.6rem;
        cursor: pointer;
        margin-bottom: 0.35rem;
    }
    .sentinel-assistant__metrics {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.55rem;
        margin-bottom: 0.65rem;
    }
    .sentinel-assistant__metric {
        padding: 0.55rem;
        border-radius: 8px;
        border: 1px solid var(--studio-border, rgba(255, 255, 255, 0.08));
        background: rgba(255, 255, 255, 0.03);
    }
    .sentinel-assistant__metric strong {
        display: block;
        font-size: 0.78rem;
        color: var(--studio-text, #fff);
    }
    .sentinel-assistant__metric p {
        margin: 0.2rem 0 0;
        font-size: 0.58rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .sentinel-assistant__grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.55rem;
        margin-bottom: 0.65rem;
    }
    .sentinel-assistant__grid ul,
    .sentinel-assistant__issues ul,
    .sentinel-assistant__actions ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.35rem;
    }
    .sentinel-assistant__grid li,
    .sentinel-assistant__actions li {
        font-size: 0.6rem;
        line-height: 1.4;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .sentinel-assistant__issue {
        padding: 0.5rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.02);
    }
    .sentinel-assistant__issue strong {
        display: block;
        font-size: 0.66rem;
        color: var(--studio-text, rgba(255, 255, 255, 0.92));
    }
    .sentinel-assistant__issue p {
        margin: 0.15rem 0 0;
        font-size: 0.6rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .sentinel-assistant__issue--critical {
        border-color: rgba(239, 68, 68, 0.35);
    }
    .sentinel-assistant__next-btn {
        display: block;
        width: 100%;
        margin-top: 0.35rem;
        padding: 0.5rem;
        text-align: left;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.03);
        color: inherit;
        cursor: pointer;
    }
    .sentinel-assistant__next-btn strong {
        display: block;
        font-size: 0.64rem;
        color: var(--studio-text, #fff);
    }
    .sentinel-assistant__next-btn span {
        display: block;
        margin-top: 0.15rem;
        font-size: 0.58rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
</style>
