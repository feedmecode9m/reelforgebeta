<script>
    /**
     * Creator picker: bind episode → ready Hero Vault asset (id reference only).
     * Metadata: display title, media badge, ready badge, match confidence (resolver score only).
     */
    import { createEventDispatcher } from 'svelte';
    import {
        setEpisodeVaultBinding,
        clearEpisodeVaultBinding
    } from '../../lib/series/seriesStore.js';
    import {
        assetIdOf,
        scoreEpisodeAgainstAsset
    } from '../../lib/series/episodeVaultResolver.js';
    import { normalizeVaultAsset } from '../../lib/vault/normalizeVaultAsset.js';
    import { resolveVaultAssetTitle, resolveVaultKeywords } from '../../lib/vault/resolveVaultAssetTitle.js';

    const dispatch = createEventDispatcher();

    /** @type {string} */
    export let episodeId = '';

    /** Episode title for match-confidence scoring (resolver only — no algo change) */
    /** @type {string} */
    export let episodeTitle = '';

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
    function cardModel(asset) {
        const normalized = normalizeVaultAsset(asset, { requireReady: false });
        const id = normalized?.assetId || assetIdOf(asset);
        const displayTitle = normalized?.displayTitle || resolveVaultAssetTitle(asset);
        const type = normalized?.type || (String(asset?.type || '').startsWith('video') ? 'video' : 'image');
        const status = normalized?.status || String(asset?.status || 'ready').toLowerCase() || 'ready';
        const thumb = String(
            normalized?.thumbnailUrl ||
                asset?.thumbnailUrl ||
                asset?.thumbnail_url ||
                asset?.thumbnail ||
                asset?.posterUrl ||
                (type === 'image' ? asset?.url : '') ||
                ''
        ).trim();
        const keywords = normalized?.keywords?.length
            ? normalized.keywords
            : resolveVaultKeywords(asset);

        let confidence = /** @type {{ score: number; tier: string | null; label: string }} */ ({
            score: 0,
            tier: null,
            label: 'No match'
        });
        if (episodeTitle && id) {
            // Use existing resolver scoring only — do not change match algorithm.
            const scored = scoreEpisodeAgainstAsset(episodeTitle, asset);
            const tier = scored.tier;
            let label = 'No match';
            if (tier === 'multiword') label = 'High match';
            else if (tier === 'primary') label = 'Good match';
            else if (tier === 'fuzzy') label = 'Weak match';
            confidence = { score: scored.score || 0, tier, label };
        }

        const ready = status === 'ready' || status === 'complete' || status === 'completed' || !status;
        return {
            id,
            displayTitle,
            type,
            thumb,
            keywords,
            ready,
            confidence
        };
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
                {@const card = cardModel(asset)}
                <li>
                    <button
                        type="button"
                        class="vault-bind-picker__item"
                        class:selected={selectedAssetId === card.id}
                        role="option"
                        aria-selected={selectedAssetId === card.id}
                        disabled={busy || !episodeId}
                        on:click={() => selectAsset(card.id)}
                    >
                        {#if card.thumb}
                            <img class="vault-bind-picker__thumb" src={card.thumb} alt="" loading="lazy" />
                        {:else}
                            <span class="vault-bind-picker__thumb vault-bind-picker__thumb--empty" aria-hidden="true"
                                >No thumb</span
                            >
                        {/if}
                        <span class="vault-bind-picker__meta">
                            <span class="vault-bind-picker__name">{card.displayTitle}</span>
                            <span class="vault-bind-picker__badges">
                                <span class="vault-bind-picker__pill vault-bind-picker__pill--type">
                                    {card.type === 'video' ? '🎬 Video' : '🖼 Image'}
                                </span>
                                {#if card.ready}
                                    <span class="vault-bind-picker__pill vault-bind-picker__pill--ready">✓ Ready</span>
                                {/if}
                                {#if card.confidence.tier}
                                    <span
                                        class="vault-bind-picker__pill vault-bind-picker__pill--match"
                                        class:match-high={card.confidence.tier === 'multiword'}
                                        class:match-good={card.confidence.tier === 'primary'}
                                        class:match-weak={card.confidence.tier === 'fuzzy'}
                                        title={`score ${card.confidence.score}`}
                                    >
                                        {card.confidence.label}
                                    </span>
                                {/if}
                            </span>
                            {#if card.keywords.length}
                                <span class="vault-bind-picker__keywords">{card.keywords.join(' · ')}</span>
                            {/if}
                        </span>
                        {#if selectedAssetId === card.id}
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
        max-height: 16rem;
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
        gap: 0.2rem;
    }
    .vault-bind-picker__name {
        font-size: 0.8rem;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .vault-bind-picker__badges {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
    }
    .vault-bind-picker__pill {
        font-size: 0.58rem;
        letter-spacing: 0.02em;
        padding: 0.1rem 0.35rem;
        border-radius: 4px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: rgba(255, 255, 255, 0.78);
        background: rgba(0, 0, 0, 0.25);
        white-space: nowrap;
    }
    .vault-bind-picker__pill--ready {
        color: #6ee7b7;
        border-color: rgba(110, 231, 183, 0.35);
    }
    .vault-bind-picker__pill--type {
        color: rgba(186, 230, 253, 0.95);
    }
    .vault-bind-picker__pill--match.match-high {
        color: #6ee7b7;
        border-color: rgba(110, 231, 183, 0.4);
    }
    .vault-bind-picker__pill--match.match-good {
        color: #93c5fd;
        border-color: rgba(147, 197, 253, 0.4);
    }
    .vault-bind-picker__pill--match.match-weak {
        color: #fcd34d;
        border-color: rgba(252, 211, 77, 0.35);
    }
    .vault-bind-picker__keywords {
        font-size: 0.6rem;
        color: rgba(255, 255, 255, 0.38);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
