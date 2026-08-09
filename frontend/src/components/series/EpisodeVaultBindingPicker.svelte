<script>
    /**
     * Creator picker: bind episode → ready Hero Vault asset (id reference only).
     */
    import { createEventDispatcher } from 'svelte';
    import {
        setEpisodeVaultBinding,
        clearEpisodeVaultBinding
    } from '../../lib/series/seriesStore.js';
    import { assetIdOf } from '../../lib/series/episodeVaultResolver.js';
    import { resolveVaultAssetDisplayTitle } from '../../lib/series/publicSeriesHydration.js';

    const dispatch = createEventDispatcher();

    /** @type {string} */
    export let episodeId = '';

    /** Currently saved manual asset id (if any) */
    /** @type {string | null} */
    export let selectedAssetId = null;

    /**
     * Ready Hero Vault assets only (already filtered by parent).
     * @type {Record<string, unknown>[]}
     */
    export let readyVaultAssets = [];

    let busy = false;
    let notice = '';

    /**
     * @param {Record<string, unknown>} asset
     */
    function titleOf(asset) {
        return resolveVaultAssetDisplayTitle(asset);
    }

    /**
     * @param {Record<string, unknown>} asset
     */
    function thumbOf(asset) {
        return String(
            asset?.thumbnailUrl ||
                asset?.thumbnail_url ||
                asset?.thumbnail ||
                asset?.posterUrl ||
                (String(asset?.type || '').startsWith('image/') ? asset?.url : '') ||
                ''
        ).trim();
    }

    /**
     * @param {string} assetId
     */
    function selectAsset(assetId) {
        if (!episodeId || busy) return;
        busy = true;
        notice = '';
        try {
            const updated = setEpisodeVaultBinding({ episodeId, assetId });
            if (!updated) {
                notice = 'Could not save binding.';
                return;
            }
            selectedAssetId = assetId;
            notice = 'Manual vault asset saved';
            dispatch('bound', { episodeId, assetId });
        } finally {
            busy = false;
        }
    }

    function clearBinding() {
        if (!episodeId || busy) return;
        busy = true;
        notice = '';
        try {
            const updated = clearEpisodeVaultBinding({ episodeId });
            if (!updated) {
                notice = 'Could not clear binding.';
                return;
            }
            selectedAssetId = null;
            notice = 'Returned to auto-match';
            dispatch('cleared', { episodeId });
        } finally {
            busy = false;
        }
    }
</script>

<section
    class="vault-bind-picker"
    data-testid="episode-vault-binding-picker"
    aria-label="Hero Vault episode binding"
>
    <header class="vault-bind-picker__header">
        <h5 class="vault-bind-picker__title">Hero Vault binding</h5>
        <p class="vault-bind-picker__hint">
            Optional override — pick a ready vault asset. No upload; id reference only.
        </p>
    </header>

    {#if !readyVaultAssets.length}
        <p class="vault-bind-picker__empty" role="status">No ready Hero Vault assets.</p>
    {:else}
        <ul class="vault-bind-picker__list" role="listbox" aria-label="Ready vault assets">
            {#each readyVaultAssets as asset (assetIdOf(asset))}
                {@const id = assetIdOf(asset)}
                {@const thumb = thumbOf(asset)}
                <li>
                    <button
                        type="button"
                        class="vault-bind-picker__item"
                        class:selected={selectedAssetId === id}
                        role="option"
                        aria-selected={selectedAssetId === id}
                        disabled={busy || !episodeId}
                        on:click={() => selectAsset(id)}
                    >
                        {#if thumb}
                            <img class="vault-bind-picker__thumb" src={thumb} alt="" loading="lazy" />
                        {:else}
                            <span class="vault-bind-picker__thumb vault-bind-picker__thumb--empty" aria-hidden="true"
                                >No thumb</span
                            >
                        {/if}
                        <span class="vault-bind-picker__meta">
                            <span class="vault-bind-picker__name">{titleOf(asset)}</span>
                            <span class="vault-bind-picker__id">{id.slice(0, 10)}…</span>
                        </span>
                        {#if selectedAssetId === id}
                            <span class="vault-bind-picker__badge">Selected</span>
                        {/if}
                    </button>
                </li>
            {/each}
        </ul>
    {/if}

    <div class="vault-bind-picker__actions">
        <button
            type="button"
            class="vault-bind-picker__clear"
            disabled={busy || !episodeId || !selectedAssetId}
            on:click={clearBinding}
        >
            Use auto-match
        </button>
        {#if notice}
            <p class="vault-bind-picker__notice" role="status">{notice}</p>
        {/if}
    </div>
</section>

<style>
    .vault-bind-picker {
        margin-top: 0.85rem;
        padding: 0.75rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 10px;
        background: rgba(0, 0, 0, 0.28);
    }
    .vault-bind-picker__header {
        margin-bottom: 0.55rem;
    }
    .vault-bind-picker__title {
        margin: 0;
        font-size: 0.82rem;
        font-weight: 650;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.9);
    }
    .vault-bind-picker__hint {
        margin: 0.25rem 0 0;
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.5);
        line-height: 1.35;
    }
    .vault-bind-picker__empty {
        margin: 0;
        font-size: 0.8rem;
        color: rgba(255, 255, 255, 0.45);
    }
    .vault-bind-picker__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        max-height: 14rem;
        overflow: auto;
    }
    .vault-bind-picker__item {
        width: 100%;
        display: grid;
        grid-template-columns: 3.5rem 1fr auto;
        gap: 0.55rem;
        align-items: center;
        padding: 0.4rem 0.5rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.04);
        color: #fff;
        cursor: pointer;
        text-align: left;
        font-family: inherit;
    }
    .vault-bind-picker__item:hover:not(:disabled) {
        border-color: rgba(0, 242, 255, 0.4);
    }
    .vault-bind-picker__item.selected {
        border-color: rgba(52, 211, 153, 0.55);
        background: rgba(52, 211, 153, 0.1);
    }
    .vault-bind-picker__item:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }
    .vault-bind-picker__thumb {
        width: 3.5rem;
        height: 2rem;
        object-fit: cover;
        border-radius: 4px;
        background: rgba(0, 0, 0, 0.4);
    }
    .vault-bind-picker__thumb--empty {
        display: grid;
        place-items: center;
        font-size: 0.55rem;
        color: rgba(255, 255, 255, 0.35);
        text-transform: uppercase;
    }
    .vault-bind-picker__meta {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
    }
    .vault-bind-picker__name {
        font-size: 0.8rem;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .vault-bind-picker__id {
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.4);
    }
    .vault-bind-picker__badge {
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #6ee7b7;
    }
    .vault-bind-picker__actions {
        margin-top: 0.55rem;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.55rem;
    }
    .vault-bind-picker__clear {
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(255, 255, 255, 0.06);
        color: rgba(255, 255, 255, 0.85);
        border-radius: 6px;
        padding: 0.35rem 0.65rem;
        font-size: 0.72rem;
        cursor: pointer;
        font-family: inherit;
    }
    .vault-bind-picker__clear:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
    .vault-bind-picker__notice {
        margin: 0;
        font-size: 0.72rem;
        color: rgba(103, 232, 249, 0.9);
    }
</style>
