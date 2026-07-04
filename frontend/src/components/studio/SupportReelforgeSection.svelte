<script>
    import { onDestroy, onMount } from 'svelte';
    import {
        getDefaultSupportConfig,
        getEnabledSupportMethods,
        initSupportReelforge,
        loadSupportConfig,
        saveSupportConfig,
        trackSupportClick
    } from '../../lib/support/supportReelforge.js';

    let config = loadSupportConfig();
    let enabledMethods = getEnabledSupportMethods(config);
    let statusMessage = '';

    $: enabledMethods = getEnabledSupportMethods(config);

    function applyConfigPatch(patch) {
        config = saveSupportConfig(patch);
        enabledMethods = getEnabledSupportMethods(config);
    }

    function handleMethodConfigChange(methodId, field, value) {
        applyConfigPatch({
            methods: {
                [methodId]: {
                    ...(config.methods?.[methodId] || {}),
                    [field]: value
                }
            }
        });
    }

    function handleSupportClick(method, source = 'button') {
        if (!method?.url) return;
        trackSupportClick(method.id, method.url, { source });
        window.open(method.url, '_blank', 'noopener,noreferrer');
    }

    function handlePrimarySupport() {
        const primary = enabledMethods[0];
        if (primary) {
            handleSupportClick(primary, 'primary');
        }
    }

    function handleSaveAdminConfig() {
        config = saveSupportConfig(config);
        enabledMethods = getEnabledSupportMethods(config);
        statusMessage = 'Support settings saved.';
    }

    function handleResetConfig() {
        config = saveSupportConfig(getDefaultSupportConfig());
        enabledMethods = getEnabledSupportMethods(config);
        statusMessage = 'Support settings reset to defaults.';
    }

    let removeSupportListener = null;

    onMount(() => {
        initSupportReelforge();
        const onConfigUpdated = (event) => {
            config = event.detail || loadSupportConfig();
        };
        window.addEventListener('reelforge:support-config-updated', onConfigUpdated);
        removeSupportListener = () => window.removeEventListener('reelforge:support-config-updated', onConfigUpdated);
    });

    onDestroy(() => {
        removeSupportListener?.();
        removeSupportListener = null;
    });
</script>

<section class="support-reelforge" data-support-reelforge>
    <header>
        <h4>Support ReelForge</h4>
        <p data-support-reelforge-message>{config.message || 'We built ReelForge with love and creators in mind.'}</p>
    </header>

    <div class="support-reelforge__actions">
        <button
            type="button"
            class="support-reelforge__primary"
            data-support-reelforge-button
            on:click={handlePrimarySupport}
        >
            {config.ctaLabel || 'Support ReelForge'}
        </button>
        <div class="support-reelforge__methods" data-support-reelforge-methods>
            {#each enabledMethods as method (method.id)}
                <button
                    type="button"
                    class="support-reelforge__method"
                    data-support-method={method.id}
                    on:click={() => handleSupportClick(method, 'method')}
                >
                    {method.label}
                </button>
            {/each}
        </div>
    </div>

    <details class="support-reelforge__admin" data-support-reelforge-admin>
        <summary>Admin Configuration</summary>
        <div class="support-reelforge__grid">
            <label>
                <span>Message</span>
                <input
                    type="text"
                    bind:value={config.message}
                    on:change={() => applyConfigPatch({ message: config.message })}
                />
            </label>
            <label>
                <span>Button Label</span>
                <input
                    type="text"
                    bind:value={config.ctaLabel}
                    on:change={() => applyConfigPatch({ ctaLabel: config.ctaLabel })}
                />
            </label>
        </div>
        <div class="support-reelforge__method-config">
            {#each Object.entries(config.methods || {}) as [methodId, method]}
                <div class="support-reelforge__method-row" data-support-method-config={methodId}>
                    <label class="support-reelforge__toggle">
                        <input
                            type="checkbox"
                            checked={method.enabled}
                            on:change={(event) =>
                                handleMethodConfigChange(methodId, 'enabled', event.currentTarget.checked)}
                        />
                        <span>{methodId.replace(/_/g, ' ')}</span>
                    </label>
                    <input
                        type="text"
                        value={method.label}
                        placeholder="Label"
                        on:change={(event) => handleMethodConfigChange(methodId, 'label', event.currentTarget.value)}
                    />
                    <input
                        type="url"
                        value={method.url}
                        placeholder="https://..."
                        on:change={(event) => handleMethodConfigChange(methodId, 'url', event.currentTarget.value)}
                    />
                </div>
            {/each}
        </div>
        <div class="support-reelforge__admin-actions">
            <button type="button" on:click={handleSaveAdminConfig}>Save support config</button>
            <button type="button" class="ghost" on:click={handleResetConfig}>Reset defaults</button>
        </div>
        {#if statusMessage}
            <p class="support-reelforge__status">{statusMessage}</p>
        {/if}
    </details>
</section>

<style>
    .support-reelforge {
        padding: 0.8rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.03);
    }
    .support-reelforge h4 {
        margin: 0 0 0.3rem;
        font-size: 0.72rem;
        color: #ffd36e;
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }
    .support-reelforge p {
        margin: 0;
        font-size: 0.68rem;
        color: rgba(255, 255, 255, 0.75);
    }
    .support-reelforge__actions {
        margin-top: 0.55rem;
        display: grid;
        gap: 0.4rem;
    }
    .support-reelforge__primary {
        border: 1px solid rgba(125, 255, 179, 0.4);
        background: rgba(125, 255, 179, 0.12);
        color: #d9ffe9;
        border-radius: 8px;
        font-size: 0.64rem;
        font-weight: 700;
        padding: 0.45rem 0.7rem;
        cursor: pointer;
    }
    .support-reelforge__methods {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
    }
    .support-reelforge__method {
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(0, 0, 0, 0.2);
        color: rgba(255, 255, 255, 0.9);
        border-radius: 999px;
        font-size: 0.58rem;
        padding: 0.25rem 0.55rem;
        cursor: pointer;
    }
    .support-reelforge__admin {
        margin-top: 0.65rem;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 0.55rem;
    }
    .support-reelforge__admin summary {
        cursor: pointer;
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.56);
    }
    .support-reelforge__grid {
        margin-top: 0.45rem;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.45rem;
    }
    .support-reelforge__grid label,
    .support-reelforge__method-row {
        display: grid;
        gap: 0.2rem;
    }
    .support-reelforge__grid span {
        font-size: 0.54rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.45);
    }
    .support-reelforge input[type='text'],
    .support-reelforge input[type='url'] {
        padding: 0.38rem 0.45rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(0, 0, 0, 0.25);
        color: #fff;
        font-size: 0.6rem;
    }
    .support-reelforge__method-config {
        margin-top: 0.45rem;
        display: grid;
        gap: 0.45rem;
    }
    .support-reelforge__method-row {
        grid-template-columns: minmax(110px, 130px) 1fr 1fr;
        align-items: center;
        gap: 0.35rem;
    }
    .support-reelforge__toggle {
        display: flex;
        gap: 0.35rem;
        align-items: center;
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.75);
        text-transform: capitalize;
    }
    .support-reelforge__admin-actions {
        margin-top: 0.5rem;
        display: flex;
        gap: 0.35rem;
    }
    .support-reelforge__admin-actions button {
        padding: 0.35rem 0.55rem;
        border-radius: 6px;
        border: 1px solid rgba(125, 255, 179, 0.35);
        background: rgba(125, 255, 179, 0.1);
        color: #e6fff1;
        font-size: 0.58rem;
        cursor: pointer;
    }
    .support-reelforge__admin-actions .ghost {
        border-color: rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.78);
    }
    .support-reelforge__status {
        margin-top: 0.35rem;
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.62);
    }
    @media (max-width: 900px) {
        .support-reelforge__grid {
            grid-template-columns: 1fr;
        }
        .support-reelforge__method-row {
            grid-template-columns: 1fr;
        }
    }
</style>
