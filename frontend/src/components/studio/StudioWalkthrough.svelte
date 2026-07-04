<script>
    import { createEventDispatcher, onMount } from 'svelte';
    import { logStudioGuidanceDiag } from '../../lib/studio/studioGuidanceDiagnostics.js';
    import {
        buildGuideMeTourSteps,
        isGuideMeModeEnabled,
        logGuideMeDiag,
        markGuideMeComplete,
        setGuideMeModeEnabled
    } from '../../lib/studio/guideMeEngine.js';

    const dispatch = createEventDispatcher();

    export let active = false;

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    export let seriesId = 'series-neon-vengeance';

    const WALKTHROUGH_KEY = 'reelforge_studio_walkthrough_complete';

    /** @type {import('../../lib/studio/guideMeEngine.js').GuideMeTourStep[]} */
    let steps = [];

    let stepIndex = 0;
    let highlightStyle = '';
    let cardStyle = '';

    $: step = steps[stepIndex];
    $: guideMeMode = isGuideMeModeEnabled();

    $: if (active && step) {
        logStudioGuidanceDiag('STUDIO_WALKTHROUGH', {
            phase: 'step',
            stepIndex,
            stepId: step.id,
            title: step.title,
            what: step.whatIsThis,
            why: step.whyItMatters,
            next: step.doNext
        });
        logGuideMeDiag('GUIDE_ME_CONTEXT', {
            phase: 'coach_step',
            stepIndex,
            stepId: step.id,
            title: step.title,
            whatIsThis: step.whatIsThis,
            whenToUse: step.whenToUse,
            ifIgnored: step.ifIgnored
        });
        logGuideMeDiag('GUIDE_ME_RECOMMENDATION', {
            stepId: step.id,
            doNext: step.doNext,
            safeUsage: step.safeUsage,
            productionConsequences: step.productionConsequences
        });
        requestAnimationFrame(updateHighlight);
    }

    function updateHighlight() {
        if (!active || !step) return;
        const el = document.querySelector(step.selector);
        cardStyle = 'bottom:24px;left:50%;transform:translateX(-50%);';
        if (!el) {
            highlightStyle = 'display:none;';
            return;
        }
        el.scrollIntoView({ block: 'center', behavior: 'auto' });
        el.classList.add('guide-me-highlight-target');
        document.querySelectorAll('.guide-me-highlight-target').forEach((node) => {
            if (node !== el) node.classList.remove('guide-me-highlight-target');
        });
        const rect = el.getBoundingClientRect();
        const pad = 6;
        highlightStyle = [
            `top:${rect.top - pad}px`,
            `left:${rect.left - pad}px`,
            `width:${rect.width + pad * 2}px`,
            `height:${rect.height + pad * 2}px`
        ].join(';');
    }

    function handleNext() {
        if (stepIndex < steps.length - 1) {
            stepIndex += 1;
            return;
        }
        completeWalkthrough();
    }

    function handleSkip() {
        completeWalkthrough();
    }

    function completeWalkthrough() {
        try {
            localStorage.setItem(WALKTHROUGH_KEY, 'true');
        } catch {
            /* ignore */
        }
        markGuideMeComplete();
        logStudioGuidanceDiag('STUDIO_WALKTHROUGH', {
            phase: 'complete',
            stepsCompleted: stepIndex + 1,
            totalSteps: steps.length
        });
        logGuideMeDiag('GUIDE_ME_ACTION', {
            phase: 'tour_complete',
            stepsCompleted: stepIndex + 1,
            totalSteps: steps.length
        });
        active = false;
        stepIndex = 0;
        document.querySelectorAll('.guide-me-highlight-target').forEach((node) => {
            node.classList.remove('guide-me-highlight-target');
        });
        dispatch('complete');
    }

    export function startWalkthrough() {
        steps = buildGuideMeTourSteps(seriesId, feedReels);
        stepIndex = 0;
        active = true;
        setGuideMeModeEnabled(true);
        if (typeof window !== 'undefined') {
            window.__reelforgeGuideMeBlurFixApplied = true;
        }
        console.info('[GUIDE_ME_BLUR_FIX_APPLIED]', {
            mainBlurRemoved: true,
            overlayBackdropBlurAdjusted: true,
            headerBleedFixed: true
        });
        logStudioGuidanceDiag('STUDIO_WALKTHROUGH', {
            phase: 'start',
            totalSteps: steps.length
        });
        logGuideMeDiag('GUIDE_ME_ACTION', {
            phase: 'tour_start',
            totalSteps: steps.length,
            seriesId
        });
        requestAnimationFrame(updateHighlight);
    }

    export function isWalkthroughComplete() {
        try {
            return localStorage.getItem(WALKTHROUGH_KEY) === 'true';
        } catch {
            return false;
        }
    }

    onMount(() => {
        const onResize = () => updateHighlight();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    });
</script>

{#if active && step}
    <div class="studio-walkthrough" data-studio-walkthrough-overlay data-guide-me-overlay>
        <div class="studio-walkthrough__backdrop" role="presentation"></div>
        <div class="studio-walkthrough__highlight" style={highlightStyle} data-studio-walkthrough-highlight></div>
        <div class="studio-walkthrough__card" style={cardStyle} data-studio-walkthrough-card data-guide-me-coach-card>
            <p class="studio-walkthrough__step">Coach step {stepIndex + 1} of {steps.length}</p>
            <h4>{step.title}</h4>
            <p><strong>What is this?</strong> {step.whatIsThis}</p>
            <p><strong>Why does it matter?</strong> {step.whyItMatters}</p>
            <p><strong>When should I use it?</strong> {step.whenToUse}</p>
            <p><strong>What happens if I ignore it?</strong> {step.ifIgnored}</p>
            <p><strong>What should I do next?</strong> {step.doNext}</p>
            {#if guideMeMode}
                <p class="studio-walkthrough__mode"><strong>Safe usage:</strong> {step.safeUsage}</p>
                <p class="studio-walkthrough__mode"><strong>Production impact:</strong> {step.productionConsequences}</p>
            {/if}
            <div class="studio-walkthrough__actions">
                <button type="button" class="studio-walkthrough__skip" on:click={handleSkip}>Skip</button>
                <button type="button" class="studio-walkthrough__next" on:click={handleNext}>
                    {stepIndex < steps.length - 1 ? 'Next' : 'Finish'}
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    .studio-walkthrough {
        position: fixed;
        inset: 0;
        z-index: 10040;
        pointer-events: none;
    }
    .studio-walkthrough__backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        pointer-events: auto;
    }
    .studio-walkthrough__highlight {
        position: fixed;
        border: 2px solid var(--neon-cyan, #00f2ff);
        border-radius: 8px;
        box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
        pointer-events: none;
        transition: all 0.25s ease;
    }
    .studio-walkthrough__card {
        position: fixed;
        top: auto;
        width: min(340px, calc(100vw - 1.5rem));
        max-height: min(70vh, 520px);
        overflow: auto;
        padding: 0.85rem;
        border-radius: 8px;
        border: 1px solid rgba(0, 242, 255, 0.35);
        background: rgba(8, 12, 22, 0.98);
        pointer-events: auto;
        z-index: 1;
    }
    .studio-walkthrough__step {
        margin: 0 0 0.35rem;
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.45);
    }
    .studio-walkthrough__card h4 {
        margin: 0 0 0.45rem;
        font-size: 0.9rem;
        color: var(--neon-cyan, #00f2ff);
    }
    .studio-walkthrough__card p {
        margin: 0.25rem 0;
        font-size: 0.72rem;
        line-height: 1.45;
        color: rgba(255, 255, 255, 0.85);
    }
    .studio-walkthrough__mode {
        padding-top: 0.15rem;
        border-top: 1px dashed rgba(255, 255, 255, 0.08);
    }
    .studio-walkthrough__card strong {
        color: rgba(255, 255, 255, 0.55);
        font-weight: 600;
    }
    .studio-walkthrough__actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.45rem;
        margin-top: 0.65rem;
    }
    .studio-walkthrough__skip,
    .studio-walkthrough__next {
        padding: 0.35rem 0.7rem;
        border-radius: 4px;
        font-size: 0.68rem;
        font-weight: 700;
        text-transform: uppercase;
        cursor: pointer;
    }
    .studio-walkthrough__skip {
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: transparent;
        color: rgba(255, 255, 255, 0.65);
    }
    .studio-walkthrough__next {
        border: 1px solid var(--neon-cyan, #00f2ff);
        background: rgba(0, 242, 255, 0.15);
        color: var(--neon-cyan, #00f2ff);
    }
    :global(.guide-me-highlight-target) {
        outline: 2px solid rgba(0, 242, 255, 0.65);
        outline-offset: 3px;
    }
    :global([data-guide-me-mode] [data-guide-me-section]) {
        outline: 1px dashed rgba(0, 242, 255, 0.25);
        outline-offset: 4px;
    }
</style>
