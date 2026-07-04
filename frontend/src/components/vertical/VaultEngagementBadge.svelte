<script>
    import { mockEngagementMetrics } from '../../lib/vertical/reelshortProfile.js';

    /** @type {string} */
    export let itemId = '';

    $: metrics = mockEngagementMetrics(itemId);
</script>

<div class="vault-engagement-badges" aria-hidden="true">
    <svg class="engagement-sparkline" viewBox="0 0 84 20" preserveAspectRatio="none">
        <path d={metrics.sparkline} fill="none" stroke="var(--neon-cyan, #00f2ff)" stroke-width="1.5" />
    </svg>
    <span class="hook-retention-pill {metrics.hookClass}">5s hook: {metrics.hookPct}%</span>
</div>

<style>
    .vault-engagement-badges {
        position: absolute;
        top: 36px;
        left: 8px;
        right: 8px;
        z-index: 12;
        pointer-events: none;
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
    }
    .engagement-sparkline {
        width: 100%;
        height: 18px;
        opacity: 0.85;
    }
    .hook-retention-pill {
        align-self: flex-start;
        font-size: 0.55rem;
        padding: 0.1rem 0.35rem;
        border-radius: 4px;
        font-weight: 600;
        letter-spacing: 0.03em;
    }
    .hook-retention-pill.hook-good {
        background: rgba(34, 197, 94, 0.25);
        color: #86efac;
        border: 1px solid rgba(34, 197, 94, 0.5);
    }
    .hook-retention-pill.hook-mid {
        background: rgba(234, 179, 8, 0.25);
        color: #fde047;
        border: 1px solid rgba(234, 179, 8, 0.5);
    }
    .hook-retention-pill.hook-low {
        background: rgba(239, 68, 68, 0.25);
        color: #fca5a5;
        border: 1px solid rgba(239, 68, 68, 0.5);
    }
</style>
