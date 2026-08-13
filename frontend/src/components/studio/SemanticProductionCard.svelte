<script>
  /**
   * Premium Studio semantic production card — ReelForge-owned presentation.
   * No external platform branding. No invented editorial metadata.
   */
  export let profile = null;
  /** Optional: show creator handoff affordance */
  export let showHandoff = true;
  /** @type {(category: string) => void} */
  export let onManualCategory = () => {};
  /** @type {string[]} */
  export let shelfOptions = ['Trending', 'Romance', 'Cyber-Action', 'Suspense'];

  let manualDraft = 'Trending';

  $: if (profile?.category) manualDraft = profile.category;
  $: aspectClass =
    profile?.aspectRatio === '9:16'
      ? 'sem-card--portrait'
      : profile?.aspectRatio === '1:1'
        ? 'sem-card--square'
        : 'sem-card--landscape';
</script>

{#if profile}
  <article
    class="sem-card {aspectClass}"
    class:sem-card--handoff={showHandoff && profile.handoffMode === 'human-category'}
    class:sem-card--locked={profile.creatorLocked}
    data-semantic-production-card
    data-asset-id={profile.identity}
    data-content-type={profile.contentType || 'unknown'}
    data-handoff-mode={profile.handoffMode || ''}
    data-classification-state={profile.classificationState || ''}
    data-real-production={profile.isRealProductionVideo ? 'true' : 'false'}
  >
    <div class="sem-card__media" data-sem-media>
      {#if profile.artworkUrl}
        <img src={profile.artworkUrl} alt="" class="sem-card__art" loading="lazy" />
      {:else}
        <div class="sem-card__art sem-card__art--empty" aria-hidden="true"></div>
      {/if}
      <div class="sem-card__media-shade"></div>
      {#if profile.durationLabel}
        <span class="sem-card__runtime" data-sem-duration>{profile.durationLabel}</span>
      {/if}
      {#if profile.identityConfidence === 'EXACT'}
        <span class="sem-card__identity-pill" data-sem-identity>Exact match</span>
      {/if}
    </div>

    <div class="sem-card__body">
      <h3 class="sem-card__title" data-sem-title>
        {profile.canonicalTitle || 'Untitled production'}
      </h3>

      <div class="sem-card__primary-meta">
        <span class="sem-card__shelf" data-sem-shelf>{profile.shelfCategory || profile.category}</span>
        {#if profile.contentType && profile.contentType !== 'unknown'}
          <span class="sem-card__type" data-sem-content-type>{profile.contentType}</span>
        {/if}
        {#if profile.series}
          <span class="sem-card__series" data-sem-series>{profile.series}</span>
        {/if}
        {#if profile.episode}
          <span class="sem-card__episode" data-sem-episode>{profile.episode}</span>
        {/if}
      </div>

      {#if profile.themes?.length}
        <ul class="sem-card__themes" data-sem-themes>
          {#each profile.themes.slice(0, 4) as theme}
            <li>{theme}</li>
          {/each}
        </ul>
      {/if}

      {#if profile.description}
        <p class="sem-card__desc" data-sem-description>
          {String(profile.description).slice(0, 140)}{String(profile.description).length > 140
            ? '…'
            : ''}
        </p>
      {/if}

      <div class="sem-card__tertiary">
        {#if profile.resolution}
          <span data-sem-resolution>{profile.resolution}</span>
        {/if}
        {#if profile.aspectRatio}
          <span data-sem-aspect>{profile.aspectRatio}</span>
        {/if}
        {#if profile.mediaStatus}
          <span data-sem-status>{profile.mediaStatus}</span>
        {/if}
      </div>

      {#if showHandoff}
        <div class="sem-card__handoff" data-sem-handoff>
          <p class="sem-card__handoff-label" data-sem-handoff-label>{profile.handoffLabel}</p>
          {#if profile.handoffMode === 'recommend-accept' || profile.handoffMode === 'recommend-review'}
            <p class="sem-card__handoff-detail" data-sem-suggestion>
              Suggested shelf: {profile.suggestedCategory || '—'}
              {#if profile.confidenceLabel}
                · {profile.confidenceLabel}
              {/if}
            </p>
          {:else if profile.shelfFitReason}
            <p class="sem-card__handoff-detail">{profile.shelfFitReason}</p>
          {/if}

          {#if !profile.creatorLocked && profile.isRealProductionVideo}
            <label class="sem-card__manual">
              <span>Set category</span>
              <select bind:value={manualDraft} data-sem-manual-select>
                {#each shelfOptions as opt}
                  <option value={opt}>{opt}</option>
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
    --sem-muted: rgba(244, 241, 234, 0.62);
    --sem-line: rgba(244, 241, 234, 0.14);
    --sem-accent: #c4a574;
    --sem-deep: #0c1018;
    display: grid;
    grid-template-rows: auto 1fr;
    border-radius: 14px;
    overflow: hidden;
    background:
      linear-gradient(165deg, rgba(28, 36, 52, 0.92), rgba(8, 10, 16, 0.98)),
      radial-gradient(120% 80% at 10% 0%, rgba(196, 165, 116, 0.12), transparent 55%);
    border: 1px solid var(--sem-line);
    color: var(--sem-ink);
    min-width: 0;
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
    transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
  }
  .sem-card:hover {
    transform: translateY(-2px);
    border-color: rgba(196, 165, 116, 0.35);
    box-shadow: 0 22px 48px rgba(0, 0, 0, 0.42);
  }
  .sem-card--handoff {
    border-color: rgba(196, 165, 116, 0.45);
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
    transform: scale(1.02);
    transition: transform 320ms ease;
  }
  .sem-card:hover .sem-card__art {
    transform: scale(1.06);
  }
  .sem-card__art--empty {
    background:
      radial-gradient(circle at 30% 20%, rgba(196, 165, 116, 0.18), transparent 45%),
      linear-gradient(135deg, #141a24, #07090e);
  }
  .sem-card__media-shade {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, transparent 40%, rgba(5, 7, 12, 0.78) 100%);
    pointer-events: none;
  }
  .sem-card__runtime,
  .sem-card__identity-pill {
    position: absolute;
    z-index: 1;
    font-size: 0.62rem;
    letter-spacing: 0.04em;
    padding: 0.22rem 0.45rem;
    border-radius: 999px;
    background: rgba(5, 7, 12, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: var(--sem-ink);
  }
  .sem-card__runtime {
    right: 0.55rem;
    bottom: 0.55rem;
  }
  .sem-card__identity-pill {
    left: 0.55rem;
    top: 0.55rem;
    color: var(--sem-accent);
  }
  .sem-card__body {
    display: grid;
    gap: 0.45rem;
    padding: 0.85rem 0.9rem 1rem;
  }
  .sem-card__title {
    margin: 0;
    font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif;
    font-size: 1.05rem;
    font-weight: 600;
    line-height: 1.25;
    letter-spacing: 0.01em;
  }
  .sem-card__primary-meta,
  .sem-card__tertiary,
  .sem-card__themes {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .sem-card__shelf,
  .sem-card__type,
  .sem-card__series,
  .sem-card__episode,
  .sem-card__themes li,
  .sem-card__tertiary span {
    font-size: 0.62rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--sem-muted);
    border: 1px solid var(--sem-line);
    border-radius: 999px;
    padding: 0.18rem 0.45rem;
  }
  .sem-card__shelf {
    color: var(--sem-accent);
    border-color: rgba(196, 165, 116, 0.35);
  }
  .sem-card__desc {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.45;
    color: var(--sem-muted);
  }
  .sem-card__handoff {
    margin-top: 0.25rem;
    padding-top: 0.55rem;
    border-top: 1px solid var(--sem-line);
    display: grid;
    gap: 0.35rem;
  }
  .sem-card__handoff-label {
    margin: 0;
    font-size: 0.72rem;
    color: var(--sem-accent);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .sem-card__handoff-detail,
  .sem-card__lock {
    margin: 0;
    font-size: 0.68rem;
    color: var(--sem-muted);
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
    border-color: rgba(196, 165, 116, 0.5);
  }
</style>
