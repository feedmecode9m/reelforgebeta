<script>
    import { onDestroy, onMount } from 'svelte';
    import {
        analyzeThreats,
        getThreatSnapshot,
        loadSecurityEvents
    } from '../../lib/security/threatDetectionEngine.js';

    let snapshot = getThreatSnapshot();
    let eventCount = 0;

    function refresh() {
        snapshot = analyzeThreats({ emitDiagnostics: false });
        eventCount = loadSecurityEvents().events.length;
    }

    function handleThreatUpdate(event) {
        snapshot = event.detail || analyzeThreats({ emitDiagnostics: false });
        eventCount = loadSecurityEvents().events.length;
    }

    onMount(() => {
        refresh();
        window.addEventListener('reelforge:threat-updated', handleThreatUpdate);
    });

    onDestroy(() => {
        if (typeof window !== 'undefined') {
            window.removeEventListener('reelforge:threat-updated', handleThreatUpdate);
        }
    });

    $: levelClass = `sentinel-security-card__level--${(snapshot?.level || 'GREEN').toLowerCase()}`;
</script>

<section class="sentinel-security-card" data-sentinel-security-card>
    <header class="sentinel-security-card__header">
        <div>
            <h4>ReelForge Sentinel</h4>
            <p>Live threat monitoring for studio operations</p>
        </div>
        <span class="sentinel-security-card__level {levelClass}" data-sentinel-threat-level>
            {snapshot?.level || 'GREEN'}
        </span>
    </header>

    <div class="sentinel-security-card__metrics">
        <article class="sentinel-security-card__metric" data-sentinel-security-score>
            <span class="sentinel-security-card__label">Security Score</span>
            <strong>{snapshot?.score ?? 100}/100</strong>
        </article>
        <article class="sentinel-security-card__metric" data-sentinel-active-threats>
            <span class="sentinel-security-card__label">Active Threats</span>
            <strong>{snapshot?.activeThreats?.length ?? 0}</strong>
        </article>
        <article class="sentinel-security-card__metric" data-sentinel-event-count>
            <span class="sentinel-security-card__label">Stored Events</span>
            <strong>{eventCount}</strong>
        </article>
    </div>

    {#if snapshot?.activeThreats?.length}
        <ul class="sentinel-security-card__threats" data-sentinel-threat-list>
            {#each snapshot.activeThreats as threat (threat.id)}
                <li class="sentinel-security-card__threat" data-sentinel-threat-item={threat.id}>
                    <span class="sentinel-security-card__threat-level">{threat.level}</span>
                    <div>
                        <strong>{threat.title}</strong>
                        <p>{threat.detail}</p>
                    </div>
                </li>
            {/each}
        </ul>
    {:else}
        <p class="sentinel-security-card__clear" data-sentinel-threat-clear>No active threats — platform behavior looks normal.</p>
    {/if}

    <footer class="sentinel-security-card__action" data-sentinel-recommended-action>
        <span class="sentinel-security-card__label">Recommended Action</span>
        <p>{snapshot?.recommendedAction || 'Continue monitoring.'}</p>
    </footer>
</section>

<style>
    .sentinel-security-card {
        margin-top: 0.85rem;
        padding: 0.85rem;
        border-radius: var(--studio-radius, 10px);
        border: 1px solid var(--studio-border-strong, rgba(16, 185, 129, 0.28));
        background: var(--studio-surface, rgba(0, 0, 0, 0.28));
    }
    .sentinel-security-card__header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 0.75rem;
        margin-bottom: 0.65rem;
    }
    .sentinel-security-card__header h4 {
        margin: 0 0 0.2rem;
        font-size: 0.82rem;
        color: var(--studio-accent, #10b981);
    }
    .sentinel-security-card__header p {
        margin: 0;
        font-size: 0.64rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .sentinel-security-card__level {
        padding: 0.25rem 0.55rem;
        border-radius: 999px;
        font-size: 0.62rem;
        font-weight: 700;
        letter-spacing: 0.06em;
    }
    .sentinel-security-card__level--green {
        background: rgba(16, 185, 129, 0.15);
        color: #10b981;
        border: 1px solid rgba(16, 185, 129, 0.35);
    }
    .sentinel-security-card__level--yellow {
        background: rgba(234, 179, 8, 0.15);
        color: #eab308;
        border: 1px solid rgba(234, 179, 8, 0.35);
    }
    .sentinel-security-card__level--orange {
        background: rgba(249, 115, 22, 0.15);
        color: #f97316;
        border: 1px solid rgba(249, 115, 22, 0.35);
    }
    .sentinel-security-card__level--red {
        background: rgba(239, 68, 68, 0.15);
        color: #ef4444;
        border: 1px solid rgba(239, 68, 68, 0.35);
    }
    .sentinel-security-card__metrics {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.55rem;
        margin-bottom: 0.65rem;
    }
    .sentinel-security-card__metric {
        padding: 0.55rem;
        border-radius: 8px;
        border: 1px solid var(--studio-border, rgba(255, 255, 255, 0.08));
        background: rgba(255, 255, 255, 0.03);
    }
    .sentinel-security-card__label {
        display: block;
        margin-bottom: 0.2rem;
        font-size: 0.58rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--studio-text-subtle, rgba(255, 255, 255, 0.45));
    }
    .sentinel-security-card__metric strong {
        font-size: 0.88rem;
        color: var(--studio-text, #fff);
    }
    .sentinel-security-card__threats {
        list-style: none;
        margin: 0 0 0.65rem;
        padding: 0;
        display: grid;
        gap: 0.45rem;
    }
    .sentinel-security-card__threat {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0.55rem;
        padding: 0.55rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.02);
    }
    .sentinel-security-card__threat-level {
        font-size: 0.58rem;
        font-weight: 700;
        letter-spacing: 0.05em;
    }
    .sentinel-security-card__threat strong {
        display: block;
        margin-bottom: 0.15rem;
        font-size: 0.68rem;
        color: var(--studio-text, rgba(255, 255, 255, 0.92));
    }
    .sentinel-security-card__threat p,
    .sentinel-security-card__clear,
    .sentinel-security-card__action p {
        margin: 0;
        font-size: 0.62rem;
        line-height: 1.4;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .sentinel-security-card__action {
        padding-top: 0.55rem;
        border-top: 1px solid var(--studio-border, rgba(255, 255, 255, 0.08));
    }
</style>
