<script>
    import { createEventDispatcher, onDestroy, onMount } from 'svelte';
    import { buildGuideMeOperationalBrief, loadGuideMeAssistantMode } from '../../lib/studio/guideMeEngine.js';
    import { navigateToTarget } from '../../lib/navigation/deepNavigation.js';

    const dispatch = createEventDispatcher();

    export let seriesId = 'series-neon-vengeance';
    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    const STORAGE_KEY = 'reelforge_creator_onboarding';
    const STEP_IDS = ['welcome', 'create-series', 'upload-reel', 'publish-episode', 'open-analytics'];

    const steps = [
        {
            id: 'welcome',
            title: 'Welcome',
            body: 'You are five guided steps away from launching your first creator workflow.',
            actionLabel: 'Start Tour',
            target: { type: 'studio_tab', tab: 'Overview' },
            tips: [
                'Goal: finish setup in under 5 minutes.',
                'You can skip ahead and come back anytime.',
                'Use Guide Me when a step feels unclear.'
            ]
        },
        {
            id: 'create-series',
            title: 'Create Series',
            body: 'Set up your series shell so episodes, metadata, and releases have a home.',
            actionLabel: 'Open Production Setup',
            target: { type: 'studio_tab', tab: 'Production', section: 'series-setup' },
            tips: [
                'Start with a clear series title.',
                'Keep season and episode numbering consistent.',
                'Create the series before attaching reels.'
            ]
        },
        {
            id: 'upload-reel',
            title: 'Upload Reel',
            body: 'Upload your first reel to populate the vault and unlock attachment workflows.',
            actionLabel: 'Open Upload Tools',
            target: { type: 'studio_tab', tab: 'Production', section: 'upload' },
            tips: [
                'Use Auto-Detect for fast placement.',
                'Confirm file quality before upload.',
                'Check status after upload completes.'
            ]
        },
        {
            id: 'publish-episode',
            title: 'Publish Episode',
            body: 'Attach the reel, push through review, and publish with release safety gates.',
            actionLabel: 'Open Workflow',
            target: { type: 'workflow', tab: 'Production', dashboardSection: 'production', section: 'workflow' },
            tips: [
                'Approve review before publishing.',
                'Fix blockers shown in workflow cards.',
                'Publish only when the episode is READY.'
            ]
        },
        {
            id: 'open-analytics',
            title: 'Open Analytics',
            body: 'Track completion and engagement to improve your next release.',
            actionLabel: 'Open Analytics',
            target: { type: 'studio_tab', tab: 'Analytics', dashboardSection: 'revenue' },
            tips: [
                'Look at trends, not just one datapoint.',
                'Use completion to guide creative edits.',
                'Turn insights into your next mission.'
            ]
        }
    ];

    let stepIndex = 0;
    let tipIndex = 0;
    let completed = false;
    let startedAt = null;
    let guideMeMode = 'creator';
    let guideMeHint = '';
    let tipTimer = null;

    $: step = steps[stepIndex] || steps[0];
    $: progressPct = Math.round(((stepIndex + (completed ? 1 : 0)) / steps.length) * 100);
    $: currentTip = step?.tips?.[tipIndex % Math.max(step?.tips?.length || 1, 1)] || '';

    function emit(event, detail = {}) {
        console.log(`[CREATOR_ONBOARDING] ${JSON.stringify({ event, step: step?.id || null, ...detail, timestamp: Date.now() })}`);
    }

    function loadState() {
        if (typeof window === 'undefined') return;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            completed = Boolean(parsed.completed);
            stepIndex = Math.min(Math.max(Number(parsed.stepIndex) || 0, 0), steps.length - 1);
            startedAt = parsed.startedAt || null;
        } catch {
            /* ignore */
        }
    }

    function persistState() {
        if (typeof window === 'undefined') return;
        const payload = {
            version: 1,
            completed,
            stepIndex,
            stepId: step?.id || null,
            startedAt,
            updatedAt: Date.now()
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    }

    function startTips() {
        if (tipTimer || typeof window === 'undefined') return;
        tipTimer = window.setInterval(() => {
            tipIndex = (tipIndex + 1) % Math.max(step?.tips?.length || 1, 1);
        }, 2400);
    }

    function stopTips() {
        if (!tipTimer || typeof window === 'undefined') return;
        clearInterval(tipTimer);
        tipTimer = null;
    }

    function runGuideMeHint() {
        const brief = buildGuideMeOperationalBrief(seriesId, feedReels, {
            mode: guideMeMode,
            silent: true
        });
        guideMeHint = brief?.recommendedNextAction?.summary || brief?.missionOfTheDay || 'Guide Me is ready.';
        emit('guide_me_hint', { mode: guideMeMode });
    }

    function triggerStepAction() {
        const target = step?.target;
        if (target) navigateToTarget(target);
        dispatch('action', {
            stepId: step.id,
            index: stepIndex
        });
        emit('step_action', { stepId: step.id, index: stepIndex });
    }

    function nextStep() {
        if (!startedAt) startedAt = Date.now();
        if (stepIndex >= steps.length - 1) {
            completed = true;
            persistState();
            emit('complete', { elapsedMs: Date.now() - Number(startedAt || Date.now()) });
            console.log('CREATOR_ONBOARDING_COMPLETE=true');
            dispatch('complete', {
                elapsedMs: Date.now() - Number(startedAt || Date.now())
            });
            return;
        }
        stepIndex += 1;
        tipIndex = 0;
        persistState();
        emit('step_next', { stepId: step.id, index: stepIndex });
    }

    function previousStep() {
        stepIndex = Math.max(0, stepIndex - 1);
        tipIndex = 0;
        persistState();
        emit('step_back', { stepId: step.id, index: stepIndex });
    }

    function restart() {
        completed = false;
        stepIndex = 0;
        tipIndex = 0;
        startedAt = Date.now();
        persistState();
        emit('restart');
    }

    onMount(() => {
        loadState();
        guideMeMode = loadGuideMeAssistantMode();
        if (!startedAt) startedAt = Date.now();
        runGuideMeHint();
        startTips();
        emit('mounted', { completed, stepId: step?.id || null });
    });

    onDestroy(() => {
        stopTips();
    });
</script>

<section class="creator-onboarding" data-creator-onboarding data-guide-me-section="creator-onboarding">
    <header class="creator-onboarding__header">
        <div>
            <p class="creator-onboarding__kicker">Creator Onboarding</p>
            <h4>Launch in under 5 minutes</h4>
        </div>
        {#if completed}
            <button type="button" class="creator-onboarding__restart" on:click={restart}>Restart</button>
        {/if}
    </header>

    <div class="creator-onboarding__progress">
        <div class="creator-onboarding__progress-track">
            <span class="creator-onboarding__progress-fill" style={`width:${progressPct}%`}></span>
        </div>
        <span class="creator-onboarding__progress-text">Step {stepIndex + 1} of {steps.length}</span>
    </div>

    <ol class="creator-onboarding__steps" aria-label="Creator onboarding steps">
        {#each steps as item, idx (item.id)}
            <li
                class="creator-onboarding__step"
                class:creator-onboarding__step--active={idx === stepIndex}
                class:creator-onboarding__step--done={completed || idx < stepIndex}
            >
                <span>{idx + 1}</span>
                <small>{item.title}</small>
            </li>
        {/each}
    </ol>

    <article class="creator-onboarding__card">
        <h5>{step.title}</h5>
        <p>{step.body}</p>

        <div class="creator-onboarding__tip" data-creator-onboarding-tip>
            <strong>Animated tip</strong>
            <p class="creator-onboarding__tip-text">{currentTip}</p>
        </div>

        <div class="creator-onboarding__guide" data-creator-onboarding-guideme>
            <strong>Guide Me</strong>
            <p>{guideMeHint}</p>
            <button type="button" on:click={runGuideMeHint}>Refresh Guide Me Hint</button>
        </div>
    </article>

    <footer class="creator-onboarding__actions">
        <button type="button" class="ghost" on:click={previousStep} disabled={stepIndex === 0}>Back</button>
        <button type="button" class="ghost" on:click={triggerStepAction}>{step.actionLabel}</button>
        <button type="button" class="primary" on:click={nextStep}>{stepIndex === steps.length - 1 ? 'Finish' : 'Next'}</button>
    </footer>
</section>

<style>
    .creator-onboarding {
        margin-bottom: 0.85rem;
        padding: 0.85rem;
        border-radius: 10px;
        border: 1px solid rgba(0, 242, 255, 0.25);
        background: rgba(0, 242, 255, 0.06);
    }
    .creator-onboarding__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
    }
    .creator-onboarding__kicker {
        margin: 0;
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.55);
    }
    .creator-onboarding h4 {
        margin: 0.1rem 0 0;
        font-size: 0.9rem;
        color: #00f2ff;
    }
    .creator-onboarding__restart {
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: transparent;
        color: rgba(255, 255, 255, 0.75);
        border-radius: 6px;
        padding: 0.3rem 0.5rem;
        cursor: pointer;
        font-size: 0.62rem;
    }
    .creator-onboarding__progress {
        margin-top: 0.55rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    .creator-onboarding__progress-track {
        flex: 1;
        height: 0.3rem;
        background: rgba(255, 255, 255, 0.18);
        border-radius: 999px;
        overflow: hidden;
    }
    .creator-onboarding__progress-fill {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, #00f2ff, #78ffcc);
        transition: width 0.25s ease;
    }
    .creator-onboarding__progress-text {
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.7);
    }
    .creator-onboarding__steps {
        margin: 0.6rem 0 0;
        padding: 0;
        list-style: none;
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 0.3rem;
    }
    .creator-onboarding__step {
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        border-radius: 6px;
        padding: 0.3rem 0.35rem;
        display: grid;
        justify-items: center;
        gap: 0.2rem;
    }
    .creator-onboarding__step span {
        width: 1rem;
        height: 1rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.16);
        display: grid;
        place-items: center;
        font-size: 0.58rem;
    }
    .creator-onboarding__step small {
        font-size: 0.56rem;
        color: rgba(255, 255, 255, 0.62);
        text-align: center;
        line-height: 1.2;
    }
    .creator-onboarding__step--active {
        border-color: rgba(0, 242, 255, 0.45);
    }
    .creator-onboarding__step--active span {
        background: rgba(0, 242, 255, 0.22);
        color: #00f2ff;
    }
    .creator-onboarding__step--done span {
        background: rgba(120, 255, 204, 0.24);
        color: #78ffcc;
    }
    .creator-onboarding__card {
        margin-top: 0.65rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.28);
        padding: 0.7rem;
    }
    .creator-onboarding__card h5 {
        margin: 0;
        font-size: 0.8rem;
        color: #fff;
    }
    .creator-onboarding__card > p {
        margin: 0.35rem 0 0;
        font-size: 0.66rem;
        color: rgba(255, 255, 255, 0.72);
    }
    .creator-onboarding__tip,
    .creator-onboarding__guide {
        margin-top: 0.55rem;
        padding: 0.45rem 0.5rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.09);
        background: rgba(255, 255, 255, 0.02);
    }
    .creator-onboarding__tip strong,
    .creator-onboarding__guide strong {
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.58);
    }
    .creator-onboarding__tip-text {
        margin: 0.25rem 0 0;
        font-size: 0.64rem;
        color: rgba(255, 255, 255, 0.8);
        animation: tipPulse 2.2s ease-in-out infinite;
    }
    .creator-onboarding__guide p {
        margin: 0.25rem 0;
        font-size: 0.64rem;
        color: rgba(255, 255, 255, 0.74);
    }
    .creator-onboarding__guide button {
        border: 1px solid rgba(0, 242, 255, 0.35);
        background: rgba(0, 242, 255, 0.12);
        color: #00f2ff;
        border-radius: 5px;
        padding: 0.25rem 0.45rem;
        font-size: 0.58rem;
        cursor: pointer;
    }
    .creator-onboarding__actions {
        margin-top: 0.65rem;
        display: flex;
        gap: 0.45rem;
        justify-content: flex-end;
    }
    .creator-onboarding__actions button {
        border-radius: 6px;
        padding: 0.35rem 0.6rem;
        font-size: 0.62rem;
        font-weight: 700;
        text-transform: uppercase;
        cursor: pointer;
    }
    .creator-onboarding__actions .ghost {
        border: 1px solid rgba(255, 255, 255, 0.22);
        background: transparent;
        color: rgba(255, 255, 255, 0.8);
    }
    .creator-onboarding__actions .primary {
        border: 1px solid rgba(0, 242, 255, 0.35);
        background: rgba(0, 242, 255, 0.14);
        color: #00f2ff;
    }
    @keyframes tipPulse {
        0% { opacity: 0.7; transform: translateY(0); }
        50% { opacity: 1; transform: translateY(-1px); }
        100% { opacity: 0.7; transform: translateY(0); }
    }
</style>
