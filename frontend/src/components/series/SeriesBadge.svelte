<script>
    import { getEpisodeById } from '../../lib/series/seriesStore.js';

    /** @type {string} */
    export let seriesTitle = '';

    /** @type {number} */
    export let seasonNumber = 1;

    /** @type {number} */
    export let episodeNumber = 1;

    /** When set, overrides individual title/season/episode props from mock catalog. */
    /** @type {string} */
    export let episodeId = '';

    $: episodeContext = episodeId ? getEpisodeById(episodeId) : null;
    $: displayTitle = episodeContext?.series.title || seriesTitle || 'Series';
    $: displaySeason = episodeContext?.season.seasonNumber ?? seasonNumber;
    $: displayEpisode = episodeContext?.episode.episodeNumber ?? episodeNumber;
</script>

<div class="series-badge" role="status" aria-label="{displayTitle}, Season {displaySeason}, Episode {displayEpisode}">
    <span class="series-badge__name">{displayTitle}</span>
    <span class="series-badge__divider" aria-hidden="true">•</span>
    <span class="series-badge__meta">S{displaySeason}</span>
    <span class="series-badge__divider" aria-hidden="true">•</span>
    <span class="series-badge__meta">E{displayEpisode}</span>
</div>

<style>
    .series-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.3rem 0.65rem;
        border-radius: 999px;
        background: rgba(0, 242, 255, 0.12);
        border: 1px solid rgba(0, 242, 255, 0.35);
        color: #fff;
        font-size: 0.72rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        max-width: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        box-shadow: 0 0 12px rgba(0, 242, 255, 0.15);
    }
    .series-badge__name {
        color: var(--neon-cyan, #00f2ff);
        font-weight: 700;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .series-badge__meta {
        color: rgba(255, 255, 255, 0.85);
        font-weight: 600;
        flex-shrink: 0;
    }
    .series-badge__divider {
        color: rgba(255, 255, 255, 0.35);
        flex-shrink: 0;
    }
</style>
