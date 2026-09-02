<script>
    /** @type {{
     *   seriesId: string;
     *   title: string;
     *   path: string;
     *   posterSrc: string;
     *   seasonCount: number;
     *   episodeCount: number;
     *   playableCount: number;
     * }} */
    export let item;
    /** @type {string} */
    export let sectionLabel = '';

    $: seriesTitle = String(item?.title || '').trim();
    $: metadataLine = `${item?.seasonCount || 0} season${item?.seasonCount === 1 ? '' : 's'} · ${item?.episodeCount || 0} episode${item?.episodeCount === 1 ? '' : 's'}`;
</script>

<a
    class="series-poster-card"
    href={item?.path || '/'}
    data-series-id={item?.seriesId || undefined}
    data-series-section={sectionLabel || undefined}
    aria-label={`Open ${seriesTitle || 'series'}`}
>
    <div class="series-poster-card__media">
        {#if item?.posterSrc}
            <img class="series-poster-card__img" src={item.posterSrc} alt="" loading="lazy" />
        {:else}
            <div class="series-poster-card__fallback" aria-hidden="true">Series</div>
        {/if}
    </div>
    <div class="series-poster-card__copy">
        <h3 class="series-poster-card__title">{seriesTitle || 'Untitled Series'}</h3>
        <p class="series-poster-card__meta">{metadataLine}</p>
    </div>
</a>

<style>
    .series-poster-card {
        display: grid;
        gap: 0.45rem;
        text-decoration: none;
        color: inherit;
        min-width: 0;
    }
    .series-poster-card__media {
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
    .series-poster-card:hover .series-poster-card__media {
        transform: translateY(-3px);
        border-color: rgba(0, 242, 255, 0.45);
        box-shadow: 0 16px 32px rgba(0, 0, 0, 0.42);
    }
    .series-poster-card:focus-visible {
        outline: 2px solid rgba(0, 242, 255, 0.65);
        outline-offset: 2px;
        border-radius: 12px;
    }
</style>
