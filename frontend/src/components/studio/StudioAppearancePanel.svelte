<script>
    import { onDestroy, onMount } from 'svelte';
    import {
        APPEARANCE_PROFILES,
        applyStudioAppearance,
        getStudioAppearanceStatus,
        loadStudioAppearanceConfig
    } from '../../lib/studio/studioAppearanceEngine.js';

    let config = loadStudioAppearanceConfig();
    let statusMessage = '';

    function refresh() {
        config = loadStudioAppearanceConfig();
    }

    function apply(patch) {
        applyStudioAppearance(patch, { source: 'appearance-panel' });
        config = loadStudioAppearanceConfig();
        statusMessage = 'Appearance updated';
    }

    function handleAppearanceEvent(event) {
        config = event.detail?.config || loadStudioAppearanceConfig();
    }

    onMount(() => {
        refresh();
        window.addEventListener('reelforge:studio-appearance-changed', handleAppearanceEvent);
    });

    onDestroy(() => {
        if (typeof window !== 'undefined') {
            window.removeEventListener('reelforge:studio-appearance-changed', handleAppearanceEvent);
        }
    });

    $: status = getStudioAppearanceStatus();
    $: activeProfile = APPEARANCE_PROFILES.find((profile) => profile.id === config.theme) || APPEARANCE_PROFILES[0];
</script>

<section class="studio-appearance-panel" data-studio-appearance-panel>
    <header class="studio-appearance-panel__header">
        <div>
            <h4>Appearance</h4>
            <p>Professional creator workspace themes, density, and accessibility controls.</p>
        </div>
    </header>

    <div class="studio-appearance-panel__section" data-studio-appearance-theme>
        <span class="studio-appearance-panel__label">Theme</span>
        <div class="studio-appearance-panel__themes" role="listbox" aria-label="Appearance profiles">
            {#each APPEARANCE_PROFILES as profile (profile.id)}
                <button
                    type="button"
                    role="option"
                    aria-selected={config.theme === profile.id}
                    class="studio-appearance-panel__theme-card"
                    class:studio-appearance-panel__theme-card--active={config.theme === profile.id}
                    data-studio-appearance-profile={profile.id}
                    data-studio-theme-card={profile.id}
                    on:click={() => apply({ theme: profile.id })}
                >
                    <span
                        class="studio-appearance-panel__preview"
                        style={`background: linear-gradient(135deg, ${profile.swatches[0]} 0%, ${profile.swatches[1]} 48%, ${profile.swatches[2]} 100%);`}
                    ></span>
                    <strong>{profile.name}</strong>
                    <em>{profile.mood}</em>
                </button>
            {/each}
        </div>
    </div>

    <div class="studio-appearance-panel__grid">
        <label class="studio-appearance-panel__field" data-studio-appearance-font-scale>
            <span class="studio-appearance-panel__label">Font Scale</span>
            <select bind:value={config.fontScale} on:change={() => apply({ fontScale: config.fontScale })}>
                <option value="small">Small</option>
                <option value="normal">Normal</option>
                <option value="large">Large</option>
            </select>
        </label>

        <label class="studio-appearance-panel__field" data-studio-appearance-density>
            <span class="studio-appearance-panel__label">UI Density</span>
            <select bind:value={config.density} on:change={() => apply({ density: config.density })}>
                <option value="compact">Compact</option>
                <option value="comfortable">Comfortable</option>
                <option value="spacious">Spacious</option>
            </select>
        </label>
    </div>

    <div class="studio-appearance-panel__section" data-studio-appearance-accessibility>
        <span class="studio-appearance-panel__label">Accessibility</span>
        <div class="studio-appearance-panel__accessibility">
            <article class="studio-appearance-panel__metric" data-studio-contrast-score>
                <span>Contrast Score</span>
                <strong>{status.contrastScore ?? config.contrastScore}/100</strong>
            </article>

            <label class="studio-appearance-panel__checkbox" data-studio-color-blind-safe>
                <input
                    type="checkbox"
                    bind:checked={config.colorBlindSafe}
                    on:change={() => apply({ colorBlindSafe: config.colorBlindSafe })}
                />
                <span>Color Blind Safe Mode</span>
            </label>

            <label class="studio-appearance-panel__checkbox" data-studio-reduced-motion>
                <input
                    type="checkbox"
                    bind:checked={config.reducedMotion}
                    on:change={() => apply({ reducedMotion: config.reducedMotion })}
                />
                <span>Reduced Motion</span>
            </label>

            <label class="studio-appearance-panel__checkbox" data-studio-focus-mode>
                <input
                    type="checkbox"
                    bind:checked={config.focusMode}
                    on:change={() => apply({ focusMode: config.focusMode })}
                />
                <span>Focus Mode</span>
            </label>
        </div>
    </div>

    <p class="studio-appearance-panel__active" data-studio-appearance-active>
        Active profile: <strong>{activeProfile.name}</strong> · density {config.density} · font {config.fontScale}
    </p>

    {#if statusMessage}
        <p class="studio-appearance-panel__status" role="status" data-studio-appearance-status>{statusMessage}</p>
    {/if}
</section>

<style>
    .studio-appearance-panel {
        margin-top: 0.85rem;
        padding: var(--studio-panel-padding, 0.85rem);
        border-radius: var(--studio-radius, 10px);
        border: 1px solid var(--studio-border-strong, rgba(0, 242, 255, 0.22));
        background: var(--studio-surface, rgba(0, 0, 0, 0.28));
    }
    .studio-appearance-panel__header h4 {
        margin: 0 0 0.2rem;
        font-size: calc(var(--studio-font-base, 0.72rem) + 0.08rem);
        color: var(--studio-accent, #00f2ff);
    }
    .studio-appearance-panel__header p {
        margin: 0 0 0.65rem;
        font-size: var(--studio-font-base, 0.64rem);
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .studio-appearance-panel__label {
        display: block;
        margin-bottom: 0.3rem;
        font-size: 0.58rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--studio-text-subtle, rgba(255, 255, 255, 0.45));
    }
    .studio-appearance-panel__section {
        margin-bottom: 0.65rem;
    }
    .studio-appearance-panel__themes {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
        gap: var(--studio-gap, 0.55rem);
    }
    .studio-appearance-panel__theme-card {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding: 0.5rem;
        border-radius: 8px;
        border: 1px solid var(--studio-border, rgba(255, 255, 255, 0.12));
        background: rgba(255, 255, 255, 0.03);
        color: inherit;
        text-align: left;
        cursor: pointer;
    }
    .studio-appearance-panel__theme-card--active {
        border-color: var(--studio-accent, #00f2ff);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--studio-accent) 35%, transparent);
    }
    .studio-appearance-panel__preview {
        display: block;
        height: 42px;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .studio-appearance-panel__theme-card strong {
        font-size: 0.66rem;
        color: var(--studio-text, #fff);
    }
    .studio-appearance-panel__theme-card em {
        font-size: 0.54rem;
        font-style: normal;
        color: var(--studio-accent, #00f2ff);
    }
    .studio-appearance-panel__grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--studio-gap, 0.55rem);
        margin-bottom: 0.65rem;
    }
    .studio-appearance-panel__field select {
        width: 100%;
        padding: 0.45rem 0.5rem;
        border-radius: 8px;
        border: 1px solid var(--studio-border, rgba(255, 255, 255, 0.12));
        background: rgba(255, 255, 255, 0.04);
        color: var(--studio-text, #fff);
        font-size: var(--studio-font-base, 0.62rem);
    }
    .studio-appearance-panel__accessibility {
        display: grid;
        gap: 0.45rem;
    }
    .studio-appearance-panel__metric {
        padding: 0.5rem;
        border-radius: 8px;
        border: 1px solid var(--studio-border, rgba(255, 255, 255, 0.08));
        background: rgba(255, 255, 255, 0.03);
    }
    .studio-appearance-panel__metric span {
        display: block;
        font-size: 0.56rem;
        color: var(--studio-text-subtle, rgba(255, 255, 255, 0.45));
    }
    .studio-appearance-panel__metric strong {
        font-size: 0.82rem;
        color: var(--studio-text, #fff);
    }
    .studio-appearance-panel__checkbox {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        font-size: var(--studio-font-base, 0.62rem);
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .studio-appearance-panel__active,
    .studio-appearance-panel__status {
        margin: 0.45rem 0 0;
        font-size: 0.58rem;
        color: var(--studio-text-subtle, rgba(255, 255, 255, 0.45));
    }
    .studio-appearance-panel__active strong {
        color: var(--studio-text, #fff);
    }
</style>
