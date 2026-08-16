<script>
  /**
   * Premium cinematic semantic production card — ReelForge-owned presentation.
   * No external platform branding. No invented editorial metadata.
   */
  import { creatorShelfChoices } from '../../lib/feed/creatorPresentationControl.js';
  import { categoryAliasStore, displayDiscoveryShelf } from '../../lib/feed/discoveryTaxonomy.js';

  export let profile = null;
  /** Optional: show creator handoff affordance */
  export let showHandoff = true;
  /** Optional: show future-ready creator control (still gated by allowPersist parent) */
  export let showCreatorControl = true;
  /** @type {(category: string) => void} */
  export let onManualCategory = () => {};
  /** @type {string[]} */
  export let shelfOptions = [...creatorShelfChoices()];

  let manualDraft = 'Trending';

  $: if (profile?.category) manualDraft = profile.category;
  $: aspectClass =
    profile?.aspectRatio === '9:16'
      ? 'sem-card--portrait'
      : profile?.aspectRatio === '1:1'
        ? 'sem-card--square'
        : 'sem-card--landscape';
  $: themeClass = profile?.presentationCssClass || 'sem-card--theme-neutral';
  $: variantClass = profile?.cardVariant
    ? `sem-card--variant-${profile.cardVariant}`
    : 'sem-card--variant-cinematic';
  $: animClass = profile?.animationBehavior
    ? `sem-card--anim-${profile.animationBehavior}`
    : 'sem-card--anim-lift';
  $: uniqueBits = [
    profile?.mood || '',
    profile?.contentType && profile.contentType !== 'unknown' ? profile.contentType : ''
  ].filter(Boolean);
</script>

{#if profile}
  <article
    class="sem-card {aspectClass} {themeClass} {variantClass} {animClass}"
    class:sem-card--handoff={showHandoff && profile.handoffMode === 'human-category'}
    class:sem-card--locked={profile.creatorLocked}
    style="--sem-accent:{profile.presentation?.accent || '#c4a574'}; --sem-glow:{profile.presentation?.glow || 'rgba(196,165,116,0.2)'}; --sem-depth:{profile.presentation?.depth || 'rgba(12,16,24,0.96)'};"
    data-semantic-production-card
    data-premium-semantic-card
    data-asset-id={profile.identity || profile.assetId}
    data-content-type={profile.contentType || 'unknown'}
    data-presentation-family={profile.presentationFamily || 'neutral'}
    data-card-variant={profile.cardVariant || 'cinematic'}
    data-handoff-mode={profile.handoffMode || ''}
    data-classification-state={profile.classificationState || ''}
    data-real-production={profile.isRealProductionVideo ? 'true' : 'false'}
  >
    <div class="sem-card__media" data-sem-media>
      {#if profile.artworkUrl || profile.thumbnail}
        <img
          src={profile.artworkUrl || profile.thumbnail}
          alt=""
          class="sem-card__art"
          loading="lazy"
        />
      {:else}
        <div class="sem-card__art sem-card__art--empty" aria-hidden="true"></div>
      {/if}
      <div class="sem-card__media-shade"></div>
      <div class="sem-card__media-vignette" aria-hidden="true"></div>

      {#if profile.badges?.length}
        <div class="sem-card__badges" data-sem-badges>
          {#each profile.badges.slice(0, 3) as badge}
            <span class="sem-card__badge">{badge}</span>
          {/each}
        </div>
      {:else if profile.identityConfidence === 'EXACT'}
        <span class="sem-card__identity-pill" data-sem-identity>Exact match</span>
      {/if}

      {#if profile.durationLabel}
        <span class="sem-card__runtime" data-sem-duration>{profile.durationLabel}</span>
      {/if}
    </div>

    <div class="sem-card__body">
      <div class="sem-card__identity-row">
        <p class="sem-card__eyebrow" data-sem-what>
          {#if profile.series}
            {profile.series}{#if profile.episode}<span aria-hidden="true"> · </span>{profile.episode}{/if}
          {:else if profile.contentType && profile.contentType !== 'unknown'}
            {profile.contentType}
          {:else}
            Production
          {/if}
        </p>
        {#if profile.creator}
          <span class="sem-card__creator" data-sem-creator>{profile.creator}</span>
        {/if}
      </div>

      <h3 class="sem-card__title" data-sem-title>
        {profile.canonicalTitle || profile.title || 'Untitled production'}
      </h3>

      {#if profile.tagline}
        <p class="sem-card__why" data-sem-why data-sem-tagline>{profile.tagline}</p>
      {/if}

      {#if profile.description}
        <p class="sem-card__desc" data-sem-description>
          {String(profile.description).slice(0, 140)}{String(profile.description).length > 140
            ? '…'
            : ''}
        </p>
      {:else if profile.productionContext}
        <p class="sem-card__why" data-sem-why data-sem-production-context>
          {profile.productionContext}
        </p>
      {/if}

      <div class="sem-card__primary-meta">
        <span class="sem-card__shelf" data-sem-shelf={profile.shelfCategory || profile.category}>{displayDiscoveryShelf(profile.shelfCategory || profile.category, $categoryAliasStore)}</span>
        {#if profile.mood}
          <span class="sem-card__mood" data-sem-mood>{profile.mood}</span>
        {/if}
        {#each uniqueBits as bit}
          <span class="sem-card__chip" data-sem-themes-item>{bit}</span>
        {/each}
      </div>

      {#if profile.themes?.length}
        <ul class="sem-card__themes" data-sem-themes>
          {#each profile.themes.slice(0, 4) as theme}
            <li>{theme}</li>
          {/each}
        </ul>
      {/if}

      <div class="sem-card__tertiary">
        {#if profile.resolution}
          <span data-sem-resolution>{profile.resolution}</span>
        {/if}
        {#if profile.aspectRatio}
          <span data-sem-aspect>{profile.aspectRatio}</span>
        {/if}
        {#if profile.playbackState || profile.mediaStatus}
          <span data-sem-status>{profile.playbackState || profile.mediaStatus}</span>
        {/if}
        {#if profile.audience}
          <span data-sem-audience>{profile.audience}</span>
        {/if}
      </div>

      {#if showHandoff}
        <div class="sem-card__handoff" data-sem-handoff>
          <p class="sem-card__handoff-label" data-sem-handoff-label>{profile.handoffLabel}</p>
          {#if profile.handoffMode === 'recommend-accept' || profile.handoffMode === 'recommend-review'}
            <p class="sem-card__handoff-detail" data-sem-suggestion>
              Suggested shelf: {profile.suggestedCategory ? displayDiscoveryShelf(profile.suggestedCategory, $categoryAliasStore) : '—'}
              {#if profile.confidenceLabel}
                · {profile.confidenceLabel}
              {/if}
            </p>
          {:else if profile.shelfFitReason}
            <p class="sem-card__handoff-detail">{profile.shelfFitReason}</p>
          {/if}

          {#if showCreatorControl && profile.creatorControl}
            <div class="sem-card__control" data-sem-creator-control>
              <p class="sem-card__control-label">Creator control</p>
              <p class="sem-card__control-flow">{profile.creatorControl.workflow}</p>
              <p class="sem-card__control-state">
                AI assists · Creator decides · Persist {profile.creatorControl.canPersist
                  ? 'enabled'
                  : 'gated'}
              </p>
            </div>
          {/if}

          {#if !profile.creatorLocked && profile.isRealProductionVideo}
            <label class="sem-card__manual">
              <span>Set category</span>
              <select bind:value={manualDraft} data-sem-manual-select>
                {#each shelfOptions as opt}
                  <option value={opt}>{displayDiscoveryShelf(opt, $categoryAliasStore)}</option>
                {/each}
              </select>
            </label>
            <button
              type="button"
              class="sem-card__manual-btn"
              data-sem-manual-apply
              on:click|stopPropagation={() => onManualCategory(manualDraft)}
            >
              Apply category
            </button>
          {:else if profile.creatorLocked}
            <p class="sem-card__lock" data-sem-creator-lock>Creator locked</p>
          {/if}
        </div>
      {/if}
    </div>
  </article>
{/if}

<style>
  .sem-card {
    --sem-ink: #f4f1ea;
    --sem-muted: rgba(244, 241, 234, 0.64);
    --sem-line: rgba(244, 241, 234, 0.12);
    --sem-accent: #c4a574;
    --sem-glow: rgba(196, 165, 116, 0.2);
    --sem-depth: rgba(12, 16, 24, 0.96);
    display: grid;
    grid-template-rows: auto 1fr;
    border-radius: 16px;
    overflow: hidden;
    background:
      linear-gradient(165deg, var(--sem-depth), rgba(6, 8, 12, 0.98)),
      radial-gradient(120% 80% at 12% 0%, var(--sem-glow), transparent 55%);
    border: 1px solid var(--sem-line);
    color: var(--sem-ink);
    min-width: 0;
    box-shadow:
      0 18px 40px rgba(0, 0, 0, 0.38),
      inset 0 1px 0 rgba(255, 255, 255, 0.04);
    transition:
      transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
      box-shadow 220ms ease,
      border-color 220ms ease;
  }
  .sem-card--anim-lift:hover,
  .sem-card--anim-parallax:hover {
    transform: translateY(-4px) scale(1.01);
    border-color: color-mix(in srgb, var(--sem-accent) 45%, transparent);
    box-shadow:
      0 28px 56px rgba(0, 0, 0, 0.48),
      0 0 0 1px color-mix(in srgb, var(--sem-accent) 22%, transparent);
  }
  .sem-card--anim-pulse:hover {
    transform: translateY(-3px);
    box-shadow:
      0 24px 52px rgba(0, 0, 0, 0.46),
      0 0 28px var(--sem-glow);
  }
  .sem-card--handoff {
    border-color: color-mix(in srgb, var(--sem-accent) 50%, transparent);
  }
  .sem-card__media {
    position: relative;
    aspect-ratio: 16 / 9;
    background: #05070c;
    overflow: hidden;
  }
  .sem-card--portrait .sem-card__media {
    aspect-ratio: 9 / 14;
  }
  .sem-card--square .sem-card__media {
    aspect-ratio: 1 / 1;
  }
  .sem-card__art {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transform: scale(1.03);
    transition: transform 480ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .sem-card--anim-parallax:hover .sem-card__art {
    transform: scale(1.09) translate3d(0, -1.5%, 0);
  }
  .sem-card:hover .sem-card__art {
    transform: scale(1.07);
  }
  .sem-card__art--empty {
    background:
      radial-gradient(circle at 30% 20%, var(--sem-glow), transparent 45%),
      linear-gradient(135deg, #141a24, #07090e);
  }
  .sem-card__media-shade {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, transparent 35%, rgba(5, 7, 12, 0.82) 100%);
    pointer-events: none;
  }
  .sem-card__media-vignette {
    position: absolute;
    inset: 0;
    background: radial-gradient(120% 90% at 50% 20%, transparent 40%, rgba(0, 0, 0, 0.35) 100%);
    pointer-events: none;
  }
  .sem-card__badges {
    position: absolute;
    z-index: 1;
    left: 0.55rem;
    top: 0.55rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.28rem;
    max-width: 75%;
  }
  .sem-card__badge,
  .sem-card__runtime,
  .sem-card__identity-pill {
    font-size: 0.58rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.22rem 0.45rem;
    border-radius: 999px;
    background: rgba(5, 7, 12, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: var(--sem-ink);
    backdrop-filter: blur(8px);
  }
  .sem-card__badge,
  .sem-card__identity-pill {
    color: var(--sem-accent);
    border-color: color-mix(in srgb, var(--sem-accent) 40%, transparent);
  }
  .sem-card__identity-pill {
    position: absolute;
    z-index: 1;
    left: 0.55rem;
    top: 0.55rem;
  }
  .sem-card__runtime {
    position: absolute;
    z-index: 1;
    right: 0.55rem;
    bottom: 0.55rem;
  }
  .sem-card__body {
    display: grid;
    gap: 0.42rem;
    padding: 0.9rem 0.95rem 1.05rem;
  }
  .sem-card__identity-row {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    align-items: baseline;
  }
  .sem-card__eyebrow,
  .sem-card__creator {
    margin: 0;
    font-size: 0.58rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--sem-accent);
  }
  .sem-card__creator {
    color: var(--sem-muted);
  }
  .sem-card__title {
    margin: 0;
    font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif;
    font-size: clamp(1.05rem, 1.8vw, 1.22rem);
    font-weight: 600;
    line-height: 1.22;
    letter-spacing: 0.01em;
  }
  .sem-card__why {
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.45;
    color: rgba(244, 241, 234, 0.78);
  }
  .sem-card__desc {
    margin: 0;
    font-size: 0.74rem;
    line-height: 1.45;
    color: var(--sem-muted);
  }
  .sem-card__primary-meta,
  .sem-card__tertiary,
  .sem-card__themes {
    display: flex;
    flex-wrap: wrap;
    gap: 0.32rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .sem-card__shelf,
  .sem-card__mood,
  .sem-card__chip,
  .sem-card__themes li,
  .sem-card__tertiary span {
    font-size: 0.58rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--sem-muted);
    border: 1px solid var(--sem-line);
    border-radius: 999px;
    padding: 0.16rem 0.42rem;
  }
  .sem-card__shelf {
    color: var(--sem-accent);
    border-color: color-mix(in srgb, var(--sem-accent) 40%, transparent);
  }
  .sem-card__handoff {
    margin-top: 0.3rem;
    padding-top: 0.55rem;
    border-top: 1px solid var(--sem-line);
    display: grid;
    gap: 0.35rem;
  }
  .sem-card__handoff-label {
    margin: 0;
    font-size: 0.68rem;
    color: var(--sem-accent);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .sem-card__handoff-detail,
  .sem-card__lock,
  .sem-card__control-flow,
  .sem-card__control-state {
    margin: 0;
    font-size: 0.66rem;
    color: var(--sem-muted);
    line-height: 1.4;
  }
  .sem-card__control {
    padding: 0.45rem 0.5rem;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--sem-line);
  }
  .sem-card__control-label {
    margin: 0 0 0.2rem;
    font-size: 0.58rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--sem-accent);
  }
  .sem-card__manual {
    display: grid;
    gap: 0.2rem;
    font-size: 0.58rem;
    color: var(--sem-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .sem-card__manual select,
  .sem-card__manual-btn {
    font-size: 0.72rem;
    border-radius: 8px;
    border: 1px solid var(--sem-line);
    background: rgba(255, 255, 255, 0.04);
    color: var(--sem-ink);
    padding: 0.35rem 0.5rem;
  }
  .sem-card__manual-btn {
    cursor: pointer;
    width: fit-content;
  }
  .sem-card__manual-btn:hover {
    border-color: color-mix(in srgb, var(--sem-accent) 55%, transparent);
  }

  @media (max-width: 640px) {
    .sem-card__title {
      font-size: 1.02rem;
    }
    .sem-card__body {
      padding: 0.8rem 0.8rem 0.95rem;
    }
  }
</style>
