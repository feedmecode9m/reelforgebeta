<script>
  /**
   * Audience-facing cinematic landscape card shell.
   * Phase 6.2 — badges, title overlay, hierarchy, elegant empty states.
   * Media stays 16:9 centerpiece. No invented metadata.
   */
  import '../../viewer/cinematicCardTokens.css';
  import { buildViewerSemanticShell } from '../../lib/feed/viewerSemanticShell.js';

  /** @type {Record<string, unknown> | null} */
  export let reel = null;
  /** Optional vault/title projection — pass-through only */
  export let projection = null;
  /** Prebuilt shell; if omitted, derived from reel */
  export let shell = null;
  /** @type {'featured' | 'row' | 'grid'} */
  export let variant = 'row';
  export let interactive = true;
  export let previewActive = false;
  /** @type {(reel: Record<string, unknown>) => void} */
  export let onActivate = () => {};
  /** @type {() => void} */
  export let onMediaPointerEnter = () => {};
  /** @type {() => void} */
  export let onMediaPointerLeave = () => {};

  $: resolvedShell =
    shell ||
    (reel
      ? buildViewerSemanticShell(
          /** @type {Record<string, unknown>} */ (reel),
          projection || {}
        )
      : null);
  $: themeClass = resolvedShell?.presentationCssClass || 'sem-card--theme-neutral';
  $: animClass = resolvedShell?.animationBehavior
    ? `viewer-sem-card--anim-${resolvedShell.animationBehavior}`
    : 'viewer-sem-card--anim-parallax';
  $: hasTitle = Boolean(String(resolvedShell?.title || '').trim());
  $: badgeList = Array.isArray(resolvedShell?.badges)
    ? resolvedShell.badges.map(String).filter(Boolean).slice(0, 3)
    : [];
  $: themeList = Array.isArray(resolvedShell?.themes)
    ? resolvedShell.themes.map(String).filter(Boolean).slice(0, 3)
    : [];
</script>

{#if resolvedShell}
  <svelte:element
    this={interactive ? 'button' : 'div'}
    type={interactive ? 'button' : undefined}
    class="viewer-sem-card viewer-sem-card--{variant} {themeClass} {animClass}"
    class:viewer-sem-card--preview={previewActive}
    class:viewer-sem-card--untitled={!hasTitle}
    style="--sem-accent:{resolvedShell.presentation?.accent || 'var(--rf-cine-accent)'}; --sem-glow:{resolvedShell.presentation?.glow || 'var(--rf-cine-glow)'}; --sem-depth:{resolvedShell.presentation?.depth || 'var(--rf-cine-panel)'};"
    data-viewer-semantic-card
    data-viewer-card-variant={variant}
    data-presentation-family={resolvedShell.presentationFamily || 'neutral'}
    data-asset-id={resolvedShell.assetId || ''}
    data-reel-id={resolvedShell.assetId || ''}
    data-media-type={resolvedShell.mediaType || ''}
    aria-label={hasTitle ? `Play ${resolvedShell.title}` : 'Play media'}
    on:click={() => {
      if (interactive && reel) onActivate(/** @type {Record<string, unknown>} */ (reel));
    }}
    on:keydown={(e) => {
      if (!interactive || !reel) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate(/** @type {Record<string, unknown>} */ (reel));
      }
    }}
  >
    <div class="viewer-sem-card__frame">
      <div
        class="viewer-sem-card__media rf-cine-media-fill"
        data-viewer-sem-media
        on:pointerenter={() => onMediaPointerEnter()}
        on:pointerleave={() => onMediaPointerLeave()}
      >
        <slot name="media">
          {#if resolvedShell.artworkUrl}
            <img src={resolvedShell.artworkUrl} alt="" class="viewer-sem-card__art" loading="lazy" />
          {:else}
            <div
              class="viewer-sem-card__art viewer-sem-card__art--empty"
              data-viewer-sem-empty-media
              aria-hidden="true"
            ></div>
          {/if}
        </slot>
        <div class="viewer-sem-card__shade" aria-hidden="true"></div>

        {#if badgeList.length}
          <div class="viewer-sem-card__badges" data-viewer-sem-badges>
            {#each badgeList as badge}
              <span class="viewer-sem-card__badge">{badge}</span>
            {/each}
          </div>
        {/if}

        {#if hasTitle}
          <h3 class="viewer-sem-card__title-overlay" data-viewer-sem-title-overlay>
            {resolvedShell.title}
          </h3>
        {/if}

        <div class="viewer-sem-card__play" aria-hidden="true">▶</div>
        {#if resolvedShell.durationLabel}
          <span class="viewer-sem-card__runtime" data-viewer-sem-duration>
            {resolvedShell.durationLabel}
          </span>
        {/if}
      </div>

      <div class="viewer-sem-card__info" data-viewer-sem-hierarchy>
        {#if hasTitle}
          <h3 class="viewer-sem-card__title" data-viewer-sem-title data-vault-card-title>
            {resolvedShell.title}
          </h3>
        {:else}
          <p class="viewer-sem-card__title-empty" data-viewer-sem-title-empty aria-hidden="true">
            Untitled
          </p>
        {/if}
        <div class="viewer-sem-card__meta">
          {#if resolvedShell.shelf}
            <span class="viewer-sem-card__shelf" data-viewer-sem-shelf>{resolvedShell.shelf}</span>
          {/if}
          {#if resolvedShell.mood}
            <span class="viewer-sem-card__mood" data-viewer-sem-mood>{resolvedShell.mood}</span>
          {/if}
          {#if resolvedShell.audience}
            <span data-viewer-sem-audience>{resolvedShell.audience}</span>
          {/if}
          {#if resolvedShell.resolution}
            <span data-viewer-sem-resolution>{resolvedShell.resolution}</span>
          {/if}
          {#each themeList as theme}
            <span class="viewer-sem-card__theme" data-viewer-sem-theme>{theme}</span>
          {/each}
        </div>
      </div>
    </div>
  </svelte:element>
{/if}

<style>
  .viewer-sem-card {
    --sem-accent: var(--rf-cine-accent);
    --sem-glow: var(--rf-cine-glow);
    --sem-depth: var(--rf-cine-panel);
    display: block;
    width: 100%;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--rf-cine-ink);
    text-align: left;
    cursor: pointer;
    scroll-snap-align: start;
    transform-origin: center center;
  }
  div.viewer-sem-card {
    cursor: default;
  }
  .viewer-sem-card__frame {
    border-radius: var(--rf-cine-radius);
    overflow: hidden;
    background:
      linear-gradient(165deg, var(--sem-depth), rgba(6, 8, 12, 0.98)),
      radial-gradient(120% 80% at 10% 0%, var(--sem-glow), transparent 55%);
    border: 1px solid var(--rf-cine-line);
    box-shadow: var(--rf-cine-shadow);
    transition:
      transform 240ms var(--rf-cine-ease),
      box-shadow 240ms ease,
      border-color 240ms ease;
  }
  .viewer-sem-card--row {
    flex: 0 0 clamp(280px, 30vw, 400px);
  }
  .viewer-sem-card--featured {
    width: min(100%, 920px);
  }
  .viewer-sem-card--grid {
    width: 100%;
  }
  .viewer-sem-card--anim-parallax:hover .viewer-sem-card__frame,
  .viewer-sem-card--anim-lift:hover .viewer-sem-card__frame {
    transform: translateY(-5px) scale(1.015);
    border-color: color-mix(in srgb, var(--sem-accent) 42%, transparent);
    box-shadow: var(--rf-cine-shadow-hover);
  }
  .viewer-sem-card--anim-pulse:hover .viewer-sem-card__frame {
    transform: translateY(-4px);
    box-shadow:
      var(--rf-cine-shadow-hover),
      0 0 28px var(--sem-glow);
  }
  .viewer-sem-card__media {
    position: relative;
    aspect-ratio: 16 / 9;
    background: var(--rf-cine-deep);
    overflow: hidden;
  }
  .viewer-sem-card__art,
  .viewer-sem-card__media :global(.card-visual),
  .viewer-sem-card__media :global(img),
  .viewer-sem-card__media :global(video) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transform: scale(1.02);
    transition: transform 520ms var(--rf-cine-ease);
  }
  .viewer-sem-card:hover .viewer-sem-card__art,
  .viewer-sem-card:hover .viewer-sem-card__media :global(.card-visual),
  .viewer-sem-card:hover .viewer-sem-card__media :global(img),
  .viewer-sem-card:hover .viewer-sem-card__media :global(video),
  .viewer-sem-card--preview .viewer-sem-card__media :global(video) {
    transform: scale(1.07) translate3d(0, -1%, 0);
  }
  .viewer-sem-card__art--empty {
    background:
      radial-gradient(circle at 30% 20%, var(--sem-glow), transparent 45%),
      linear-gradient(135deg, #141a24, #07090e);
    min-height: 100%;
  }
  .viewer-sem-card__shade {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(180deg, transparent 36%, rgba(5, 7, 12, 0.82) 100%),
      radial-gradient(120% 90% at 50% 10%, transparent 45%, rgba(0, 0, 0, 0.28) 100%);
    pointer-events: none;
  }
  .viewer-sem-card__badges {
    position: absolute;
    top: 0.7rem;
    left: 0.7rem;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    gap: 0.28rem;
    max-width: calc(100% - 5rem);
    pointer-events: none;
  }
  .viewer-sem-card__badge {
    font-size: 0.55rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 0.18rem 0.45rem;
    border-radius: 999px;
    color: var(--rf-cine-ink);
    background: rgba(8, 10, 16, 0.62);
    border: 1px solid color-mix(in srgb, var(--sem-accent) 45%, transparent);
    backdrop-filter: blur(8px);
  }
  .viewer-sem-card__title-overlay {
    position: absolute;
    left: 0.85rem;
    right: 0.85rem;
    bottom: 2.4rem;
    z-index: 2;
    margin: 0;
    font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif;
    font-size: clamp(0.95rem, 1.5vw, 1.15rem);
    font-weight: 600;
    line-height: 1.2;
    text-shadow: 0 2px 16px rgba(0, 0, 0, 0.55);
    pointer-events: none;
  }
  .viewer-sem-card--featured .viewer-sem-card__title-overlay {
    font-size: clamp(1.2rem, 2vw, 1.55rem);
    bottom: 2.6rem;
  }
  .viewer-sem-card__play {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%) scale(0.92);
    width: 3rem;
    height: 3rem;
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: rgba(8, 10, 16, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: var(--rf-cine-ink);
    opacity: 0;
    transition: opacity 180ms ease, transform 180ms var(--rf-cine-ease);
    pointer-events: none;
    backdrop-filter: blur(8px);
  }
  .viewer-sem-card:hover .viewer-sem-card__play {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
  .viewer-sem-card__runtime {
    position: absolute;
    right: 0.75rem;
    bottom: 0.75rem;
    z-index: 2;
    font-size: 0.62rem;
    letter-spacing: 0.05em;
    padding: 0.22rem 0.5rem;
    border-radius: 999px;
    background: rgba(5, 7, 12, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.12);
  }
  .viewer-sem-card__info {
    display: grid;
    gap: 0.4rem;
    padding: 0.85rem 0.95rem 1rem;
  }
  .viewer-sem-card--featured .viewer-sem-card__info {
    padding: 1rem 1.15rem 1.15rem;
  }
  .viewer-sem-card__title {
    margin: 0;
    font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif;
    font-size: clamp(1rem, 1.6vw, 1.2rem);
    font-weight: 600;
    line-height: 1.25;
  }
  .viewer-sem-card--featured .viewer-sem-card__title {
    font-size: clamp(1.25rem, 2.2vw, 1.7rem);
  }
  .viewer-sem-card__title-empty {
    margin: 0;
    font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif;
    font-size: 0.95rem;
    font-style: italic;
    font-weight: 500;
    color: var(--rf-cine-muted);
    letter-spacing: 0.02em;
  }
  .viewer-sem-card__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.32rem;
  }
  .viewer-sem-card__shelf,
  .viewer-sem-card__theme,
  .viewer-sem-card__mood,
  .viewer-sem-card__meta span {
    font-size: 0.58rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--rf-cine-muted);
    border: 1px solid var(--rf-cine-line);
    border-radius: 999px;
    padding: 0.16rem 0.42rem;
  }
  .viewer-sem-card__shelf {
    color: var(--sem-accent);
    border-color: color-mix(in srgb, var(--sem-accent) 40%, transparent);
  }
  .viewer-sem-card__mood {
    color: color-mix(in srgb, var(--sem-accent) 70%, var(--rf-cine-ink));
  }

  @media (max-width: 640px) {
    .viewer-sem-card--row {
      flex-basis: clamp(240px, 78vw, 320px);
    }
    .viewer-sem-card__frame {
      border-radius: var(--rf-cine-radius-sm);
    }
  }
</style>
