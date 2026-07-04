<script>
    import { onDestroy } from 'svelte';
    import { getStudioHelp } from '../../lib/studio/studioHelpRegistry.js';
    import { logStudioGuidanceDiag } from '../../lib/studio/studioGuidanceDiagnostics.js';

    /** @type {string} */
    export let helpKey = '';

    /** @type {import('../../lib/studio/studioHelpRegistry.js').StudioHelpEntry | null} */
    export let content = null;

    let open = false;
    let hoverTimer = null;
    let panelEl;
    let triggerEl;
    let panelStyle = '';

    $: help = content || getStudioHelp(helpKey);

    function clearHoverTimer() {
        if (hoverTimer) {
            clearTimeout(hoverTimer);
            hoverTimer = null;
        }
    }

    function positionPanel() {
        if (!triggerEl || !panelEl) return;
        const rect = triggerEl.getBoundingClientRect();
        const panelRect = panelEl.getBoundingClientRect();
        const margin = 8;
        let top = rect.bottom + margin;
        let left = rect.left;

        if (left + panelRect.width > window.innerWidth - margin) {
            left = window.innerWidth - panelRect.width - margin;
        }
        if (left < margin) left = margin;

        if (top + panelRect.height > window.innerHeight - margin) {
            top = rect.top - panelRect.height - margin;
        }
        if (top < margin) top = margin;

        panelStyle = `top:${top}px;left:${left}px;`;
    }

    function openPanel(source) {
        if (!help) return;
        open = true;
        logStudioGuidanceDiag('STUDIO_HELP', {
            panel: helpKey || help.title,
            title: help.title,
            source
        });
        requestAnimationFrame(positionPanel);
    }

    function closePanel() {
        open = false;
    }

    function handleMouseEnter() {
        clearHoverTimer();
        hoverTimer = setTimeout(() => openPanel('hover'), 500);
    }

    function handleMouseLeave() {
        clearHoverTimer();
        closePanel();
    }

    function handleTriggerClick(event) {
        event.stopPropagation();
        clearHoverTimer();
        if (open) closePanel();
        else openPanel('tap');
    }

    function handleDocumentClick(event) {
        if (!open) return;
        const target = /** @type {Node} */ (event.target);
        if (triggerEl?.contains(target) || panelEl?.contains(target)) return;
        closePanel();
    }

    function handleKeydown(event) {
        if (event.key === 'Escape') closePanel();
    }

    $: if (open && panelEl) {
        requestAnimationFrame(positionPanel);
    }

    onDestroy(clearHoverTimer);
</script>

<svelte:window on:click={handleDocumentClick} on:keydown={handleKeydown} on:resize={positionPanel} />

{#if help}
    <span class="smart-help" data-smart-help data-help-key={helpKey}>
        <button
            type="button"
            class="smart-help__trigger"
            bind:this={triggerEl}
            aria-label="Help for {help.title}"
            aria-expanded={open}
            on:mouseenter={handleMouseEnter}
            on:mouseleave={handleMouseLeave}
            on:click={handleTriggerClick}
        >?</button>

        {#if open}
            <div
                class="smart-help__panel"
                bind:this={panelEl}
                style={panelStyle}
                role="tooltip"
                data-smart-help-panel
            >
                <h5 class="smart-help__title">{help.title}</h5>
                <dl class="smart-help__body">
                    <div><dt>Purpose</dt><dd>{help.purpose}</dd></div>
                    <div><dt>How To Use</dt><dd>{help.howToUse}</dd></div>
                    <div><dt>Common Mistakes</dt><dd>{help.commonMistakes}</dd></div>
                    <div><dt>Safe Usage</dt><dd>{help.safeUsage}</dd></div>
                </dl>
            </div>
        {/if}
    </span>
{/if}

<style>
    .smart-help {
        position: relative;
        display: inline-flex;
        vertical-align: middle;
    }
    .smart-help__trigger {
        width: 1.1rem;
        height: 1.1rem;
        padding: 0;
        border-radius: 50%;
        border: 1px solid rgba(0, 242, 255, 0.45);
        background: rgba(0, 242, 255, 0.1);
        color: var(--neon-cyan, #00f2ff);
        font-size: 0.62rem;
        font-weight: 800;
        line-height: 1;
        cursor: help;
        flex-shrink: 0;
    }
    .smart-help__trigger:hover,
    .smart-help__trigger:focus-visible {
        background: rgba(0, 242, 255, 0.22);
        outline: none;
    }
    .smart-help__panel {
        position: fixed;
        z-index: 10050;
        width: min(280px, calc(100vw - 1.5rem));
        padding: 0.75rem 0.85rem;
        border-radius: 8px;
        border: 1px solid rgba(0, 242, 255, 0.35);
        background: rgba(8, 12, 22, 0.97);
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
        pointer-events: auto;
    }
    .smart-help__title {
        margin: 0 0 0.5rem;
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--neon-cyan, #00f2ff);
    }
    .smart-help__body {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
    }
    .smart-help__body dt {
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.45);
        margin-bottom: 0.1rem;
    }
    .smart-help__body dd {
        margin: 0;
        font-size: 0.72rem;
        line-height: 1.45;
        color: rgba(255, 255, 255, 0.88);
    }
</style>
