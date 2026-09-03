<script>
    import { createEventDispatcher } from 'svelte';

    /** @type {{
     *   seriesId: string;
     *   title: string;
     *   path: string;
     *   posterSrc: string;
     *   seasonCount: number;
     *   episodeCount: number;
     *   playableCount?: number;
     *   relatedMaterialCount?: number;
     *   stackLayers?: number;
     *   primarySeasonNumber?: number;
     *   developmentState?: 'in-development' | 'production';
     * }} */
    export let item;
    /** @type {string} */
    export let sectionLabel = '';
    /** Creator/catalog surface — card is selectable, not a viewer nav link. */
    export let creatorMode = false;
    /** Highlight when creator catalog has this series selected. */
    export let selected = false;

    const dispatch = createEventDispatcher();

    $: seriesTitle = String(item?.title || '').trim();
    $: metadataLine = creatorMode
        ? `Season ${item?.primarySeasonNumber || 1} · ${item?.episodeCount || 0} episode${item?.episodeCount === 1 ? '' : 's'}`
        : `${item?.seasonCount || 0} season${item?.seasonCount === 1 ? '' : 's'} · ${item?.episodeCount || 0} episode${item?.episodeCount === 1 ? '' : 's'}`;
    $: stackLayers = Math.min(2, Math.max(0, Number(item?.stackLayers) || 0));
    $: developmentLabel =
        item?.developmentState === 'production' ? 'Production' : 'In Development';

    /** @param {MouseEvent | KeyboardEvent} event */
    function handleSelect(event) {
        if (!creatorMode) return;
        event.preventDefault();
        event.stopPropagation();
        dispatch('select', { seriesId: item?.seriesId || '' });
    }

    /** @param {MouseEvent} event */
    function handleEditInVault(event) {
        event.preventDefault();
        event.stopPropagation();
        dispatch('editInVault', { seriesId: item?.seriesId || '' });
    }
</script>

{#if creatorMode}
    <article
        class="series-poster-card series-poster-card--creator"
        class:series-poster-card--selected={selected}
        class:series-poster-card--stacked={stackLayers > 0}
        data-creator-series-poster-card
        data-series-id={item?.seriesId || undefined}
        data-series-development={item?.developmentState || 'in-development'}
        aria-label={`${seriesTitle || 'Series'} — ${developmentLabel}`}
    >
        <button
            type="button"
            class="series-poster-card__select"
            on:click={handleSelect}
            aria-pressed={selected}
        >
            <div class="series-poster-card__stack" aria-hidden="true">
                {#if stackLayers >= 2}
                    <span class="series-poster-card__layer series-poster-card__layer--2"></span>
                {/if}
                {#if stackLayers >= 1}
                    <span class="series-poster-card__layer series-poster-card__layer--1"></span>
                {/if}
                <div class="series-poster-card__media">
                    {#if item?.posterSrc}
                        <img class="series-poster-card__img" src={item.posterSrc} alt="" loading="lazy" />
                    {:else}
                        <div class="series-poster-card__fallback" aria-hidden="true">Series</div>
                    {/if}
                </div>
            </div>
            <div class="series-poster-card__copy">
                <h3 class="series-poster-card__title">{seriesTitle || 'Untitled Series'}</h3>
                <p class="series-poster-card__meta">{metadataLine}</p>
                <span
                    class="series-poster-card__status"
                    class:series-poster-card__status--production={item?.developmentState === 'production'}
                    data-series-status
                >
                    {developmentLabel}
                </span>
            </div>
        </button>
        <button
            type="button"
            class="series-poster-card__vault-btn"
            data-edit-in-vault
            data-series-id={item?.seriesId || undefined}
            on:click={handleEditInVault}
        >
            Edit in Vault
        </button>
    </article>
{:else}
    <a
        class="series-poster-card"
        class:series-poster-card--stacked={stackLayers > 0}
        href={item?.path || '/'}
        data-series-id={item?.seriesId || undefined}
        data-series-section={sectionLabel || undefined}
        data-related-material-count={item?.relatedMaterialCount || undefined}
        aria-label={`Open ${seriesTitle || 'series'}`}
    >
        <div class="series-poster-card__stack" aria-hidden="true">
            {#if stackLayers >= 2}
                <span class="series-poster-card__layer series-poster-card__layer--2"></span>
            {/if}
            {#if stackLayers >= 1}
                <span class="series-poster-card__layer series-poster-card__layer--1"></span>
            {/if}
            <div class="series-poster-card__media">
                {#if item?.posterSrc}
                    <img class="series-poster-card__img" src={item.posterSrc} alt="" loading="lazy" />
                {:else}
                    <div class="series-poster-card__fallback" aria-hidden="true">Series</div>
                {/if}
            </div>
        </div>
        <div class="series-poster-card__copy">
            <h3 class="series-poster-card__title">{seriesTitle || 'Untitled Series'}</h3>
            <p class="series-poster-card__meta">{metadataLine}</p>
        </div>
    </a>
{/if}

<style>
    .series-poster-card {
        display: grid;
        gap: 0.45rem;
        text-decoration: none;
        color: inherit;
        min-width: 0;
    }
    .series-poster-card--creator {
        gap: 0.55rem;
    }
    .series-poster-card__select {
        display: grid;
        gap: 0.45rem;
        padding: 0;
        border: none;
        background: transparent;
        color: inherit;
        text-align: left;
        cursor: pointer;
        min-width: 0;
        width: 100%;
        font: inherit;
    }
    .series-poster-card__stack {
        position: relative;
        width: 100%;
    }
    .series-poster-card__layer {
        position: absolute;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: linear-gradient(165deg, rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0.02) 100%);
        box-shadow: 0 8px 18px rgba(0, 0, 0, 0.28);
        pointer-events: none;
    }
    .series-poster-card__layer--1 {
        top: -3px;
        left: 5px;
        right: -5px;
        bottom: 3px;
        z-index: 0;
        opacity: 0.72;
    }
    .series-poster-card__layer--2 {
        top: -6px;
        left: 10px;
        right: -10px;
        bottom: 6px;
        z-index: -1;
        opacity: 0.45;
    }
    .series-poster-card--stacked .series-poster-card__stack {
        margin-top: 6px;
    }
    .series-poster-card__media {
        position: relative;
        z-index: 1;
        width: 100%;
        aspect-ratio: 9 / 16;
        border-radius: 10px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.05);
        box-shadow: 0 10px 26px rgba(0, 0, 0, 0.35);
        transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
    }
    .series-poster-card__img {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: cover;
    }
    .series-poster-card__fallback {
        width: 100%;
        height: 100%;
        display: grid;
        place-items: center;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: rgba(255, 255, 255, 0.62);
    }
    .series-poster-card__copy {
        min-width: 0;
    }
    .series-poster-card__title {
        margin: 0;
        font-size: 0.9rem;
        line-height: 1.25;
        font-weight: 650;
        color: rgba(244, 241, 234, 0.96);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .series-poster-card__meta {
        margin: 0.22rem 0 0;
        font-size: 0.68rem;
        line-height: 1.25;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: rgba(244, 241, 234, 0.55);
    }
    .series-poster-card__status {
        display: inline-block;
        margin-top: 0.35rem;
        padding: 0.12rem 0.45rem;
        border-radius: 999px;
        font-size: 0.58rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(251, 191, 36, 0.95);
        border: 1px solid rgba(251, 191, 36, 0.35);
        background: rgba(251, 191, 36, 0.08);
    }
    .series-poster-card__status--production {
        color: rgba(110, 231, 183, 0.95);
        border-color: rgba(110, 231, 183, 0.35);
        background: rgba(16, 120, 80, 0.12);
    }
    .series-poster-card__vault-btn {
        width: 100%;
        border: 1px solid rgba(125, 211, 252, 0.4);
        border-radius: 6px;
        background: rgba(15, 23, 42, 0.75);
        color: #bae6fd;
        font-size: 0.68rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        padding: 0.45rem 0.55rem;
        cursor: pointer;
        touch-action: manipulation;
    }
    .series-poster-card__vault-btn:hover {
        border-color: rgba(0, 242, 255, 0.55);
        background: rgba(0, 242, 255, 0.12);
    }
    .series-poster-card:hover .series-poster-card__media,
    .series-poster-card--creator:hover .series-poster-card__media,
    .series-poster-card--creator:focus-within .series-poster-card__media {
        transform: translateY(-3px);
        border-color: rgba(0, 242, 255, 0.45);
        box-shadow: 0 16px 32px rgba(0, 0, 0, 0.42);
    }
    .series-poster-card--stacked:hover .series-poster-card__layer--1 {
        transform: translateY(-1px);
    }
    .series-poster-card--stacked:hover .series-poster-card__layer--2 {
        transform: translateY(-2px);
    }
    .series-poster-card:focus-visible,
    .series-poster-card__select:focus-visible,
    .series-poster-card__vault-btn:focus-visible {
        outline: 2px solid rgba(0, 242, 255, 0.65);
        outline-offset: 2px;
        border-radius: 12px;
    }
    .series-poster-card--selected .series-poster-card__media {
        border-color: rgba(0, 242, 255, 0.65);
        box-shadow: 0 0 0 1px rgba(0, 242, 255, 0.35), 0 16px 32px rgba(0, 0, 0, 0.42);
    }
</style>
