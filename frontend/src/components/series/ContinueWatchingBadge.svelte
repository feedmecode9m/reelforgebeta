<script>
    /** @type {number | null} */
    export let percent = null;

    $: show = percent != null && percent > 0 && percent < 100;
    $: clamped = show ? Math.max(1, Math.min(99, Math.round(percent))) : 0;
</script>

{#if show}
    <div class="continue-watching" role="status" aria-label="Continue watching {clamped} percent" data-continue-watching>
        <span class="continue-watching__label">Continue Watching</span>
        <div class="continue-watching__track">
            <div class="continue-watching__fill" style="width: {clamped}%"></div>
        </div>
        <span class="continue-watching__value">{clamped}%</span>
    </div>
{/if}

<style>
    .continue-watching {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.45rem 0.55rem;
        border-radius: 8px;
        background: rgba(0, 242, 255, 0.08);
        border: 1px solid rgba(0, 242, 255, 0.22);
    }

    .continue-watching__label {
        font-size: 0.62rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--neon-cyan, #00f2ff);
        white-space: nowrap;
    }

    .continue-watching__track {
        flex: 1;
        height: 5px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.12);
        overflow: hidden;
        min-width: 3rem;
    }

    .continue-watching__fill {
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #00f2ff, #7af7ff);
        box-shadow: 0 0 10px rgba(0, 242, 255, 0.45);
    }

    .continue-watching__value {
        font-size: 0.72rem;
        font-weight: 700;
        color: #fff;
        min-width: 2rem;
        text-align: right;
    }
</style>
