<script>
  /**
   * Unified Hero Vault creator completeness card.
   * Clarity for identity + package + media + publish — no parser/confidence language.
   * Phase 17–20: package editor authors title/description/tags/category for Smart Catalog
   * with save-state feedback and classification result (same classifier path as feed).
   */
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { presentVaultEpisodeCompleteness } from '../../lib/series/creatorExperiencePresentation.js';
  import {
    CREATOR_SHELF_OPTIONS,
    loadCreatorCatalogMetadata,
    previewCreatorShelfClassification
  } from '../../lib/feed/creatorCatalogMetadata.js';
  import { categoryAliasStore, displayDiscoveryShelf, resolveCanonicalDiscoveryShelf } from '../../lib/feed/discoveryTaxonomy.js';
  import {
    evaluateCategorySuggestionReview,
    formatSuggestionConfidence
  } from '../../lib/feed/categorySuggestionReview.js';
  import { resolveMediaAssetId } from '../../lib/vault/vaultCreatorCardTargeting.js';
  import {
    defaultTheaterFamilyLabel,
    isTheaterFamilyCandidate,
    listVaultTheaterLinkCandidates,
    markSameTheaterFamily,
    readVaultSeriesLabel,
    theaterLinkedSiblingIds
  } from '../../lib/series/vaultTheaterFamilyLink.js';
  import {
    buildEpisodeAccessPricing,
    readVaultEpisodeAccess,
    resolveEpisodeAccessPricing
  } from '../../lib/series/episodeAccessPricing.js';

  /** @type {Record<string, unknown> | null} */
  export let asset = null;
  export let active = true;
  /**
   * Parent increments this to open Edit (identity or package) without re-upload.
   * @type {number}
   */
  export let editSignal = 0;
  /**
   * Phase 20: parent ack after savePackage (matched by saveToken).
   * @type {{ saveToken?: number; ok?: boolean; shelf?: string; explicit?: boolean; error?: string; savedAt?: number } | null}
   */
  export let packageSaveFeedback = null;
  /** Other Video Vault rows for Theater episode linking (optional). */
  export let vaultVideos = [];

  const dispatch = createEventDispatcher();

  /** @type {null | 'identity' | 'package'} */
  let editing = null;
  let draftSeries = '';
  let draftSeason = '1';
  let draftEpisode = '1';
  let draftTitle = '';
  let draftDescription = '';
  let draftArtwork = '';
  let draftTags = '';
  let draftCategory = 'Trending';
  /** @type {'free' | 'paid'} */
  let draftAccessMode = 'free';
  let draftPrice = '';
  let formError = '';
  let lastEditSignal = 0;
  /** @type {'idle' | 'saving' | 'saved' | 'error'} */
  let packageSaveState = 'idle';
  let packageSaveToken = 0;
  /** @type {{ shelf: string; explicit: boolean } | null} */
  let lastSavedShelf = null;
  let lastHandledFeedbackToken = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let saveWatchdog = null;
  /** Phase 2 NLP review (suggestion-only until Accept/Override). */
  let nlpReviewSeq = 0;
  let nlpReviewBusy = false;
  /** @type {import('../../lib/feed/categorySuggestionReview.js').CategorySuggestionReview | null} */
  let nlpReview = null;
  let nlpOverrideDraft = 'Romance';
  let nlpPersistMessage = '';
  let draftFamilyLabel = '';
  let linkSeedTitle = '';
  /** @type {string[]} */
  let selectedSiblingIds = [];

  $: model = active && asset ? presentVaultEpisodeCompleteness(asset) : null;

  $: shelfPreview =
    editing === 'package'
      ? previewCreatorShelfClassification({
          title: draftTitle,
          description: draftDescription,
          tags: draftTags,
          category: draftCategory,
          fileName: String(asset?.fileName || asset?.name || '')
        })
      : null;

  $: theaterCandidates = (() => {
    const currentId = resolveMediaAssetId(asset) || model?.mediaAssetId || '';
    const seedTitle = linkSeedTitle || model?.presentation?.title || '';
    const identity = asset?.seriesIdentity && typeof asset.seriesIdentity === 'object' ? asset.seriesIdentity : null;
    const seedConfirmed =
      identity?.confirmedByCreator === true ||
      identity?.identitySource === 'creator' ||
      asset?.confirmedByCreator === true;
    const base = markSameTheaterFamily(
      listVaultTheaterLinkCandidates(vaultVideos, currentId, seedTitle),
      readVaultSeriesLabel(asset),
      { seedTitle, seedConfirmed }
    );
    const theaterSiblings = theaterLinkedSiblingIds(vaultVideos, currentId);
    return base.map((row) => ({
      ...row,
      sameFamily: row.sameFamily || isTheaterFamilyCandidate(row, theaterSiblings)
    }));
  })();

  $: linkedSiblingCount = theaterCandidates.filter((row) => row.sameFamily).length;

  $: if (editing === 'package') {
    const title = draftTitle;
    const category = draftCategory;
    const description = draftDescription;
    const tags = draftTags;
    const assetId = String(model?.mediaAssetId || '').trim();
    void refreshNlpReview({ title, category, description, tags, assetId });
  } else {
    nlpReview = null;
    nlpPersistMessage = '';
  }

  $: if (
    packageSaveFeedback &&
    Number(packageSaveFeedback.saveToken) === packageSaveToken &&
    packageSaveToken > 0 &&
    packageSaveToken !== lastHandledFeedbackToken
  ) {
    lastHandledFeedbackToken = packageSaveToken;
    if (packageSaveFeedback.ok) {
      packageSaveState = 'saved';
      formError = '';
      if (saveWatchdog) {
        clearTimeout(saveWatchdog);
        saveWatchdog = null;
      }
      lastSavedShelf = {
        shelf: String(packageSaveFeedback.shelf || 'Trending'),
        explicit: Boolean(packageSaveFeedback.explicit)
      };
    } else {
      packageSaveState = 'error';
      formError = String(packageSaveFeedback.error || 'Could not save package metadata');
      if (saveWatchdog) {
        clearTimeout(saveWatchdog);
        saveWatchdog = null;
      }
      // Keep drafts + editor open — do not report success.
    }
  }

  $: if (active && model && editSignal !== lastEditSignal) {
    lastEditSignal = editSignal;
    if (editSignal > 0) {
      openPackage();
    }
  }

  function stopDrag(event) {
    event?.stopPropagation?.();
  }

  function openIdentity() {
    if (!model) return;
    draftSeries = model.series || '';
    draftSeason = String(model.season || 1);
    draftEpisode = String(model.episode || 1);
    formError = '';
    packageSaveState = 'idle';
    lastSavedShelf = null;
    editing = 'identity';
    dispatch('editorOpen', {
      mediaAssetId: resolveMediaAssetId(asset) || model?.mediaAssetId || ''
    });
  }

  function openPackage() {
    if (!model) return;
    draftTitle = model.presentation.title || '';
    draftDescription = model.presentation.description || '';
    draftArtwork = model.presentation.artworkUrl || '';
    draftTags = '';
    draftCategory = 'Trending';
    {
      const access =
        readVaultEpisodeAccess(asset) ||
        resolveEpisodeAccessPricing({
          mediaAssetId: model.mediaAssetId,
          vaultAsset: asset
        });
      draftAccessMode = access.mode;
      draftPrice = access.price;
    }
    draftFamilyLabel = defaultTheaterFamilyLabel(asset, model.presentation.title || model.series || '');
    draftSeason = String(model.season || 1);
    draftEpisode = String(model.episode || 1);
    linkSeedTitle = String(model.presentation.title || model.series || '').trim();
    selectedSiblingIds = [];
    try {
      const id = String(model.mediaAssetId || '').trim();
      if (id) {
        const meta = loadCreatorCatalogMetadata(id);
        if (meta.title) draftTitle = meta.title;
        // Authored-empty description/tags stay empty drafts (Phase 19 clear semantics).
        if (meta.primaryDescriptionAuthority) {
          draftDescription = meta.description || '';
        } else if (meta.description) {
          draftDescription = meta.description;
        }
        if (meta.primaryTagsAuthority) {
          draftTags = meta.tags?.length ? meta.tags.join(', ') : '';
        } else if (meta.tags?.length) {
          draftTags = meta.tags.join(', ');
        }
        draftCategory = meta.category || 'Trending';
      }
    } catch {
      /* keep presentation defaults */
    }
    formError = '';
    packageSaveState = 'idle';
    lastSavedShelf = null;
    editing = 'package';
    dispatch('editorOpen', {
      mediaAssetId: resolveMediaAssetId(asset) || model?.mediaAssetId || ''
    });
    const family = readVaultSeriesLabel(asset);
    const currentId = resolveMediaAssetId(asset) || model.mediaAssetId || '';
    const seedTitle = linkSeedTitle || draftTitle || model.presentation.title || '';
    const identity = asset?.seriesIdentity && typeof asset.seriesIdentity === 'object' ? asset.seriesIdentity : null;
    const seedConfirmed =
      identity?.confirmedByCreator === true ||
      identity?.identitySource === 'creator' ||
      asset?.confirmedByCreator === true;
    const cands = markSameTheaterFamily(
      listVaultTheaterLinkCandidates(vaultVideos, currentId, seedTitle),
      family,
      { seedTitle, seedConfirmed }
    );
    const theaterSiblings = theaterLinkedSiblingIds(vaultVideos, currentId);
    selectedSiblingIds = cands
      .filter((row) => row.sameFamily || isTheaterFamilyCandidate(row, theaterSiblings))
      .map((row) => String(row.id));
  }

  function cancelEdit() {
    editing = null;
    formError = '';
    packageSaveState = 'idle';
    nlpReview = null;
    nlpPersistMessage = '';
    if (saveWatchdog) {
      clearTimeout(saveWatchdog);
      saveWatchdog = null;
    }
    dispatch('closeEditor', {
      mediaAssetId: resolveMediaAssetId(asset) || model?.mediaAssetId || ''
    });
  }

  function leaveTheaterUnlinked() {
    selectedSiblingIds = [];
    formError = '';
    dispatch('confirmIdentity', {
      mediaAssetId: resolveMediaAssetId(asset) || model?.mediaAssetId || '',
      unlinkTheaterFamily: true
    });
  }

  function linkTheaterFamily() {
    formError = '';
    const siblings = [...new Set(selectedSiblingIds.map((id) => String(id || '').trim()).filter(Boolean))];
    if (!siblings.length) {
      formError = 'Select at least one matching episode, or leave unlinked until more show up.';
      return;
    }
    const seriesLabel = String(draftFamilyLabel || '').trim();
    if (!seriesLabel) {
      formError = 'Name the family so Theater can group these episodes.';
      return;
    }
    dispatch('confirmIdentity', {
      seriesLabel,
      seasonNumber: Number(draftSeason) > 0 ? Math.floor(Number(draftSeason)) : 1,
      episodeNumber: Number(draftEpisode) > 0 ? Math.floor(Number(draftEpisode)) : 1,
      mediaAssetId: resolveMediaAssetId(asset) || model?.mediaAssetId || '',
      siblingIds: siblings
    });
  }

  /**
   * @param {{ title: string; category: string; description: string; tags: string; assetId: string }} input
   */
  async function refreshNlpReview(input) {
    const seq = ++nlpReviewSeq;
    nlpReviewBusy = true;
    try {
      const review = await evaluateCategorySuggestionReview({
        title: input.title,
        draftCategory: input.category,
        description: input.description,
        tags: input.tags,
        mediaAssetId: input.assetId,
        id: input.assetId,
        fileName: String(asset?.fileName || asset?.name || '')
      });
      if (seq !== nlpReviewSeq) return;
      nlpReview =
        review.offer ||
        review.showManualHelper ||
        review.classificationState === 'UNDERSTOOD_NO_SHELF_FIT' ||
        review.classificationState === 'CREATOR_LOCKED'
          ? review
          : null;
      if (review.offer && review.suggestedCategory) {
        nlpOverrideDraft = review.suggestedCategory;
      } else if (review.showManualHelper || review.classificationState === 'UNDERSTOOD_NO_SHELF_FIT') {
        nlpOverrideDraft = review.recommendedShelf || review.currentCategory || 'Trending';
      }
    } catch {
      if (seq !== nlpReviewSeq) return;
      nlpReview = null;
    } finally {
      if (seq === nlpReviewSeq) nlpReviewBusy = false;
    }
  }

  function acceptNlpSuggestion() {
    if (!nlpReview?.suggestedCategory || packageSaveState === 'saving') return;
    const accepted = nlpReview.suggestedCategory;
    draftCategory = resolveCanonicalDiscoveryShelf(accepted) || accepted;
    nlpPersistMessage = `Accepting · ${displayDiscoveryShelf(draftCategory)}`;
    nlpReview = null;
    submitPackage();
  }

  function overrideNlpSuggestion() {
    if (packageSaveState === 'saving') return;
    const chosen =
      resolveCanonicalDiscoveryShelf(nlpOverrideDraft || draftCategory || 'Trending') || 'Trending';
    if (!CREATOR_SHELF_OPTIONS.includes(chosen)) {
      formError = 'Choose a valid shelf category';
      return;
    }
    draftCategory = chosen;
    nlpPersistMessage = `Overriding · ${displayDiscoveryShelf(chosen)}`;
    nlpReview = null;
    submitPackage();
  }

  function applyManualCategory() {
    if (packageSaveState === 'saving') return;
    const chosen =
      resolveCanonicalDiscoveryShelf(nlpOverrideDraft || draftCategory || 'Trending') || 'Trending';
    if (!CREATOR_SHELF_OPTIONS.includes(chosen)) {
      formError = 'Choose a valid shelf category';
      return;
    }
    draftCategory = chosen;
    nlpPersistMessage = `Manual category · ${displayDiscoveryShelf(chosen)}`;
    nlpReview = null;
    submitPackage();
  }

  function submitIdentity() {
    formError = '';
    const seriesLabel = String(draftSeries || '').trim();
    const seasonNumber = Number(draftSeason);
    const episodeNumber = Number(draftEpisode);
    if (!seriesLabel) {
      formError = 'Enter a series title';
      return;
    }
    if (!Number.isFinite(seasonNumber) || seasonNumber < 1) {
      formError = 'Season must be 1 or higher';
      return;
    }
    if (!Number.isFinite(episodeNumber) || episodeNumber < 1) {
      formError = 'Episode must be 1 or higher';
      return;
    }
    dispatch('confirmIdentity', {
      seriesLabel,
      seasonNumber: Math.floor(seasonNumber),
      episodeNumber: Math.floor(episodeNumber),
      mediaAssetId: resolveMediaAssetId(asset) || model?.mediaAssetId || ''
    });
    editing = null;
    dispatch('closeEditor', {
      mediaAssetId: resolveMediaAssetId(asset) || model?.mediaAssetId || ''
    });
  }

  function submitPackage() {
    formError = '';
    const access = buildEpisodeAccessPricing(draftAccessMode, draftPrice);
    if (access.mode === 'paid' && !access.price) {
      formError = 'Enter a price for paid episodes (e.g. 4.99).';
      return;
    }
    packageSaveState = 'saving';
    lastSavedShelf = null;
    packageSaveToken += 1;
    if (saveWatchdog) clearTimeout(saveWatchdog);
    const token = packageSaveToken;
    saveWatchdog = setTimeout(() => {
      if (packageSaveState === 'saving' && packageSaveToken === token) {
        packageSaveState = 'error';
        formError = 'Save did not confirm. Your edits are still here — tap Save again.';
      }
    }, 4000);
    dispatch('savePackage', {
      mediaAssetId: resolveMediaAssetId(asset) || model?.mediaAssetId || '',
      title: String(draftTitle || '').trim(),
      description: String(draftDescription || '').trim(),
      artworkUrl: String(draftArtwork || '').trim(),
      tags: String(draftTags || '').trim(),
      category: resolveCanonicalDiscoveryShelf(draftCategory) || 'Trending',
      accessMode: access.mode,
      price: access.price,
      saveToken: packageSaveToken
    });
    const siblings = [...new Set(selectedSiblingIds.map((id) => String(id || '').trim()).filter(Boolean))];
    const seriesLabel = String(draftFamilyLabel || '').trim();
    if (siblings.length && seriesLabel) {
      dispatch('confirmIdentity', {
        seriesLabel,
        seasonNumber: Number(draftSeason) > 0 ? Math.floor(Number(draftSeason)) : 1,
        episodeNumber: Number(draftEpisode) > 0 ? Math.floor(Number(draftEpisode)) : 1,
        mediaAssetId: resolveMediaAssetId(asset) || model?.mediaAssetId || '',
        siblingIds: siblings
      });
    } else if (!siblings.length) {
      dispatch('confirmIdentity', {
        seriesLabel,
        seasonNumber: Number(draftSeason) > 0 ? Math.floor(Number(draftSeason)) : 1,
        episodeNumber: Number(draftEpisode) > 0 ? Math.floor(Number(draftEpisode)) : 1,
        mediaAssetId: resolveMediaAssetId(asset) || model?.mediaAssetId || '',
        unlinkTheaterFamily: true
      });
    }
    // Stay in package editor so save/result feedback is visible (Phase 20).
  }

  /** @param {boolean} ok */
  function mark(ok) {
    return ok ? '✓' : '○';
  }

  /**
   * @param {{ primaryCategory?: string; explicit?: boolean } | null | undefined} preview
   */
  function shelfFeedbackCopy(preview) {
    if (!preview?.primaryCategory) return '';
    if (preview.explicit) {
      return `Shelf: ${preview.primaryCategory} · creator selection`;
    }
    if (preview.primaryCategory === 'Trending') {
      return `Current shelf: Trending · no strong genre evidence`;
    }
    return `Detected shelf: ${preview.primaryCategory} · from title/description/tags`;
  }

  /**
   * @param {'set' | 'cleared' | 'missing' | string | undefined} state
   * @param {string} setLabel
   */
  function fieldStateLabel(state, setLabel) {
    if (state === 'cleared') return 'Cleared';
    if (state === 'missing') return 'Not set';
    return setLabel || 'Set';
  }

  onDestroy(() => {
    if (saveWatchdog) clearTimeout(saveWatchdog);
  });
</script>

{#if active && model}
  <div
    class="vault-creator-card"
    class:vault-creator-card--incomplete={!model.complete}
    class:vault-creator-card--editing={Boolean(editing)}
    role="region"
    aria-label="Episode package status"
    data-vault-creator-completeness
    data-media-asset-id={model.mediaAssetId || undefined}
    data-identity-ready={model.identity.ready ? 'true' : 'false'}
    data-presentation-ready={model.presentation.ready ? 'true' : 'false'}
    data-package-save-state={packageSaveState}
    data-media={model.media.state}
    data-publishing={model.publishing.status}
    on:pointerdown={stopDrag}
    on:mousedown={stopDrag}
    on:touchstart={stopDrag}
    on:dragstart|stopPropagation|preventDefault
  >
    {#if editing === 'identity'}
      <p class="vault-creator-card__lead">This file belongs to:</p>
      <label class="vault-creator-card__field">
        <span>Series</span>
        <input type="text" bind:value={draftSeries} autocomplete="off" spellcheck="false" />
      </label>
      <div class="vault-creator-card__pair">
        <label class="vault-creator-card__field">
          <span>Season</span>
          <input type="number" min="1" step="1" bind:value={draftSeason} />
        </label>
        <label class="vault-creator-card__field">
          <span>Episode</span>
          <input type="number" min="1" step="1" bind:value={draftEpisode} />
        </label>
      </div>
      {#if formError}<p class="vault-creator-card__error">{formError}</p>{/if}
      <div class="vault-creator-card__actions">
        <button type="button" class="vault-creator-card__btn vault-creator-card__btn--primary" on:click|stopPropagation|preventDefault={submitIdentity}
          >Save confirmation</button
        >
        <button type="button" class="vault-creator-card__btn vault-creator-card__btn--ghost" on:click|stopPropagation|preventDefault={cancelEdit}
          >Cancel</button
        >
      </div>
    {:else if editing === 'package'}
      {#if model.identityLine}
        <p class="vault-creator-card__identity-line" data-creator-identity-line>{model.identityLine}</p>
      {/if}
      <div class="vault-creator-card__theater-link" data-theater-family-link>
        <p class="vault-creator-card__nlp-review-title">Theater episode links</p>
        <p class="vault-creator-card__axis-hint">
          Tag matching Video Vault files so Theater shows them as related episodes. Leave unlinked until more show up.
        </p>
        {#if theaterCandidates.length === 0}
          <p class="vault-creator-card__axis-hint" data-theater-family-wait>
            No other vault episodes yet. Leave this file alone until more arrive to select together.
          </p>
        {:else}
          <label class="vault-creator-card__field">
            <span>Family / series name</span>
            <input
              type="text"
              bind:value={draftFamilyLabel}
              maxlength="120"
              placeholder="Shared name Theater will group"
              data-theater-family-label
              disabled={packageSaveState === 'saving'}
            />
          </label>
          <ul class="vault-creator-card__theater-list" data-theater-family-candidates>
            {#each theaterCandidates as row (row.id)}
              <li class:is-suggested={row.suggested} class:is-linked={row.sameFamily}>
                <label>
                  <input
                    type="checkbox"
                    value={row.id}
                    bind:group={selectedSiblingIds}
                    disabled={packageSaveState === 'saving'}
                  />
                  <span>{row.title}</span>
                  {#if row.sameFamily}
                    <em>linked · E{row.episodeNumber || '?'}</em>
                  {:else if row.suggested}
                    <em>suggested match</em>
                  {:else if row.seriesLabel}
                    <em>{row.seriesLabel}</em>
                  {/if}
                </label>
              </li>
            {/each}
          </ul>
          <div class="vault-creator-card__actions vault-creator-card__theater-actions">
            <button
              type="button"
              class="vault-creator-card__btn vault-creator-card__btn--primary"
              data-theater-family-link-apply
              disabled={packageSaveState === 'saving' || selectedSiblingIds.length === 0}
              on:click|stopPropagation|preventDefault={linkTheaterFamily}
            >
              Link selected for Theater
            </button>
            <button
              type="button"
              class="vault-creator-card__btn vault-creator-card__btn--ghost"
              data-theater-family-leave
              disabled={packageSaveState === 'saving'}
              on:click|stopPropagation|preventDefault={leaveTheaterUnlinked}
            >
              Leave unlinked
            </button>
          </div>
        {/if}
        {#if linkedSiblingCount > 0 && model.identityLine}
          <p class="vault-creator-card__axis-hint" data-theater-family-status>
            Theater will show {linkedSiblingCount + 1} linked episodes under {model.seriesDisplay}.
          </p>
        {/if}
      </div>
      <p class="vault-creator-card__lead">
        {model.identity.ready
          ? 'Complete this episode package:'
          : 'Add discovery metadata (series identity optional):'}
      </p>
      <label class="vault-creator-card__field">
        <span>Title</span>
        <input
          type="text"
          bind:value={draftTitle}
          maxlength="200"
          placeholder="Episode title"
          data-creator-meta-title
          disabled={packageSaveState === 'saving'}
        />
      </label>
      <label class="vault-creator-card__field">
        <span>Description</span>
        <textarea
          rows="2"
          bind:value={draftDescription}
          maxlength="4000"
          placeholder="Short description (leave empty to clear)"
          data-creator-meta-description
          disabled={packageSaveState === 'saving'}
        ></textarea>
      </label>
      <label class="vault-creator-card__field">
        <span>Tags</span>
        <input
          type="text"
          bind:value={draftTags}
          maxlength="500"
          placeholder="comma-separated, e.g. romance, kiss (leave empty to clear)"
          data-creator-meta-tags
          disabled={packageSaveState === 'saving'}
        />
      </label>
      <label class="vault-creator-card__field">
        <span>Shelf category</span>
        <select
          bind:value={draftCategory}
          aria-label="Creator shelf category"
          data-creator-meta-category
          disabled={packageSaveState === 'saving'}
        >
          {#each CREATOR_SHELF_OPTIONS as option}
            <option value={option}>{displayDiscoveryShelf(option, $categoryAliasStore)}</option>
          {/each}
        </select>
      </label>
      <div class="vault-creator-card__pair" data-episode-access-pricing>
        <label class="vault-creator-card__field">
          <span>Viewer access</span>
          <select
            bind:value={draftAccessMode}
            aria-label="Episode free or paid"
            data-episode-access-mode
            disabled={packageSaveState === 'saving'}
          >
            <option value="free">Free</option>
            <option value="paid">Paid</option>
          </select>
        </label>
        <label class="vault-creator-card__field">
          <span>Price (USD)</span>
          <input
            type="text"
            inputmode="decimal"
            bind:value={draftPrice}
            placeholder="4.99"
            data-episode-price
            disabled={packageSaveState === 'saving' || draftAccessMode !== 'paid'}
          />
        </label>
      </div>
      <p class="vault-creator-card__axis-hint">
        Free shows a FREE badge in Theater All Episodes. Paid shows the price badge (playback unchanged).
      </p>
      {#if shelfPreview}
        <p class="vault-creator-card__axis-hint" data-creator-shelf-preview>
          {shelfFeedbackCopy(shelfPreview)}
        </p>
      {/if}
      {#if nlpReviewBusy}
        <p class="vault-creator-card__axis-hint" data-nlp-category-review-loading aria-live="polite">
          Checking title suggestion…
        </p>
      {:else if nlpReview}
        <div
          class="vault-creator-card__nlp-review"
          data-nlp-category-review
          data-suggested-category={nlpReview.suggestedCategory || ''}
          data-current-category={nlpReview.currentCategory}
          data-suggestion-confidence={nlpReview.confidence}
          data-confidence-band={nlpReview.confidenceBand}
          data-ambiguous={nlpReview.ambiguous ? 'true' : 'false'}
          data-manual-helper={nlpReview.showManualHelper ? 'true' : 'false'}
          data-offer={nlpReview.offer ? 'true' : 'false'}
          data-classification-state={nlpReview.classificationState || ''}
          data-taxonomy-fit={nlpReview.taxonomyFit || ''}
          data-creator-locked={nlpReview.creatorLocked ? 'true' : 'false'}
        >
          {#if nlpReview.creatorLocked}
            <p class="vault-creator-card__nlp-review-title" data-nlp-creator-lock>CREATOR LOCKED</p>
            <ul class="vault-creator-card__nlp-review-facts">
              <li data-nlp-current-category>Creator decision: {displayDiscoveryShelf(nlpReview.currentCategory, $categoryAliasStore)}</li>
              {#if nlpReview.suggestedCategory}
                <li data-nlp-suggested-category>
                  NLP suggestion (non-binding): {displayDiscoveryShelf(nlpReview.suggestedCategory, $categoryAliasStore)}
                </li>
              {/if}
              <li data-nlp-shelf-fit-reason>{nlpReview.shelfFitReason}</li>
            </ul>
          {:else if nlpReview.classificationState === 'UNDERSTOOD_NO_SHELF_FIT'}
            <p class="vault-creator-card__nlp-review-title" data-nlp-case-f>
              UNDERSTOOD / NO SHELF FIT
            </p>
            <ul class="vault-creator-card__nlp-review-facts">
              <li data-nlp-current-category>Current: {displayDiscoveryShelf(nlpReview.currentCategory, $categoryAliasStore)}</li>
              <li data-nlp-recommended-shelf>
                Recommended shelf: {displayDiscoveryShelf(nlpReview.recommendedShelf || 'Trending', $categoryAliasStore)}
              </li>
              <li data-nlp-shelf-fit-reason>
                Reason: {nlpReview.shelfFitReason ||
                  'No valid Romance/Cyber-Action/Suspense semantic fit'}
              </li>
              <li data-nlp-suggestion-confidence>
                Confidence: {formatSuggestionConfidence(nlpReview.confidence, nlpReview.confidenceBand)}
              </li>
            </ul>
          {:else if nlpReview.offer}
            <p class="vault-creator-card__nlp-review-title">Category suggestion</p>
            <ul class="vault-creator-card__nlp-review-facts">
              <li data-nlp-current-category>Current: {displayDiscoveryShelf(nlpReview.currentCategory, $categoryAliasStore)}</li>
              <li data-nlp-suggested-category>Suggested: {displayDiscoveryShelf(nlpReview.suggestedCategory, $categoryAliasStore)}</li>
              {#if nlpReview.alternativeCategory}
                <li data-nlp-alternative-category>
                  Alternative: {displayDiscoveryShelf(nlpReview.alternativeCategory, $categoryAliasStore)}
                </li>
              {/if}
              <li data-nlp-suggestion-confidence>
                Confidence: {formatSuggestionConfidence(nlpReview.confidence, nlpReview.confidenceBand)}
              </li>
              {#if nlpReview.ambiguous}
                <li data-nlp-ambiguous>Signals conflict — review before accepting.</li>
              {/if}
            </ul>
            <div class="vault-creator-card__nlp-review-actions">
              <button
                type="button"
                class="vault-creator-card__btn vault-creator-card__btn--primary"
                data-nlp-accept-suggestion
                disabled={packageSaveState === 'saving'}
                on:click|stopPropagation|preventDefault={acceptNlpSuggestion}
              >
                Accept suggestion
              </button>
              <label class="vault-creator-card__field vault-creator-card__nlp-override">
                <span>Override</span>
                <select
                  bind:value={nlpOverrideDraft}
                  aria-label="Override shelf category"
                  data-nlp-override-category
                  disabled={packageSaveState === 'saving'}
                >
                  {#each CREATOR_SHELF_OPTIONS as option}
                    <option value={option}>{displayDiscoveryShelf(option, $categoryAliasStore)}</option>
                  {/each}
                </select>
              </label>
              <button
                type="button"
                class="vault-creator-card__btn"
                data-nlp-apply-override
                disabled={packageSaveState === 'saving'}
                on:click|stopPropagation|preventDefault={overrideNlpSuggestion}
              >
                Apply override
              </button>
            </div>
            <p class="vault-creator-card__axis-hint">
              Suggestions are not saved until you Accept or Apply override.
            </p>
          {/if}
          {#if nlpReview.showManualHelper && !nlpReview.creatorLocked}
            <div class="vault-creator-card__manual-category" data-manual-category-helper>
              <p class="vault-creator-card__nlp-review-title">
                {nlpReview.offer ? 'Or choose category manually' : 'Choose category'}
              </p>
              {#if !nlpReview.offer}
                <p class="vault-creator-card__axis-hint" data-manual-category-reason>
                  {nlpReview.classificationState === 'UNDERSTOOD_NO_SHELF_FIT'
                    ? 'Understood — no Romance/Cyber-Action/Suspense fit. Pick a shelf to lock, or leave Trending.'
                    : nlpReview.confidenceBand === 'manual' || nlpReview.confidence < 0.5
                      ? 'No strong genre signal — pick a shelf to lock classification.'
                      : 'Review and lock a shelf category.'}
                </p>
              {/if}
              <div class="vault-creator-card__nlp-review-actions">
                <label class="vault-creator-card__field vault-creator-card__nlp-override">
                  <span>Choose Category</span>
                  <select
                    bind:value={nlpOverrideDraft}
                    aria-label="Manual shelf category"
                    data-manual-category-select
                    disabled={packageSaveState === 'saving'}
                  >
                    {#each CREATOR_SHELF_OPTIONS as option}
                      <option value={option}>{displayDiscoveryShelf(option, $categoryAliasStore)}</option>
                    {/each}
                  </select>
                </label>
                <button
                  type="button"
                  class="vault-creator-card__btn vault-creator-card__btn--primary"
                  data-manual-category-apply
                  disabled={packageSaveState === 'saving'}
                  on:click|stopPropagation|preventDefault={applyManualCategory}
                >
                  Apply category
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/if}
      {#if nlpPersistMessage && packageSaveState === 'saving'}
        <p class="vault-creator-card__axis-hint" data-nlp-persist-pending>{nlpPersistMessage}</p>
      {/if}
      <label class="vault-creator-card__field">
        <span>Artwork</span>
        <input
          type="url"
          bind:value={draftArtwork}
          placeholder="Image URL or /thumbs/…"
          disabled={packageSaveState === 'saving'}
        />
      </label>
      {#if packageSaveState === 'saving'}
        <p class="vault-creator-card__save-status" data-creator-save-status="saving" aria-live="polite">
          Saving metadata…
        </p>
      {:else if packageSaveState === 'saved' && lastSavedShelf}
        <p class="vault-creator-card__save-status vault-creator-card__save-status--ok" data-creator-save-status="saved" aria-live="polite">
          Saved · shelf {displayDiscoveryShelf(lastSavedShelf.shelf, $categoryAliasStore)}{lastSavedShelf.explicit ? ' · creator selection' : ''}
        </p>
      {:else if packageSaveState === 'error'}
        <p class="vault-creator-card__save-status vault-creator-card__save-status--err" data-creator-save-status="error" aria-live="assertive">
          Save failed — your edits are still here. Try again.
        </p>
      {/if}
      {#if formError}<p class="vault-creator-card__error" data-creator-save-error>{formError}</p>{/if}
      <div class="vault-creator-card__actions">
        <button
          type="button"
          class="vault-creator-card__btn vault-creator-card__btn--primary"
          data-creator-save-package
          disabled={packageSaveState === 'saving'}
          on:pointerdown|stopPropagation
          on:mousedown|stopPropagation
          on:click|stopPropagation|preventDefault={submitPackage}
        >
          {packageSaveState === 'saving' ? 'Saving…' : packageSaveState === 'saved' ? 'Save again' : 'Save package'}
        </button>
        <button
          type="button"
          class="vault-creator-card__btn vault-creator-card__btn--ghost"
          disabled={packageSaveState === 'saving'}
          on:pointerdown|stopPropagation
          on:mousedown|stopPropagation
          on:click|stopPropagation|preventDefault={cancelEdit}
        >
          {packageSaveState === 'saved' ? 'Done' : 'Cancel'}
        </button>
      </div>
    {:else}
      <!-- Identity: what this video is (Series / Season / Episode). -->
      <div class="vault-creator-card__section" data-section="identity">
        <div class="vault-creator-card__section-head">
          <span class="vault-creator-card__section-title">{model.identity.axisLabel || 'Identity'}</span>
          <span
            class="vault-creator-card__pill"
            class:ok={model.identity.ready}
            class:warn={!model.identity.ready}
            data-identity-status
          >
            {model.identity.statusLabel}
          </span>
        </div>
        <p class="vault-creator-card__axis-hint" data-identity-hint>
          {model.identity.ready
            ? 'Theater groups files that share this series name.'
            : 'Optional. Leave unlinked until matching episodes show up, then tag them together for Theater.'}
        </p>
        <ul class="vault-creator-card__checks">
          <li class:missing={!model.identity.marks.series} data-check="series">
            <span class="vault-creator-card__mark">{mark(model.identity.marks.series)}</span>
            <span class="vault-creator-card__k">Series</span>
            <span class="vault-creator-card__v" data-series-value>{model.seriesDisplay}</span>
          </li>
          <li class:missing={!model.identity.marks.season} data-check="season">
            <span class="vault-creator-card__mark">{mark(model.identity.marks.season)}</span>
            <span class="vault-creator-card__k">Season</span>
            <span class="vault-creator-card__v" data-season-value>{model.seasonDisplay}</span>
          </li>
          <li class:missing={!model.identity.marks.episode} data-check="episode">
            <span class="vault-creator-card__mark">{mark(model.identity.marks.episode)}</span>
            <span class="vault-creator-card__k">Episode</span>
            <span class="vault-creator-card__v" data-episode-value>{model.episodeDisplay}</span>
          </li>
        </ul>
        <button
          type="button"
          class="vault-creator-card__btn"
          data-edit-identity
          on:click|stopPropagation|preventDefault={model.identity.ready ? openIdentity : openPackage}
        >
          {model.identity.ready ? 'Edit identity' : 'Link episodes'}
        </button>
      </div>

      <!-- Media: playable file availability — separate from package / catalog status. -->
      <div class="vault-creator-card__section" data-section="media" data-media={model.media.state}>
        <div class="vault-creator-card__section-head">
          <span class="vault-creator-card__section-title">{model.media.axisLabel || 'Media'}</span>
          <span
            class="vault-creator-card__pill"
            class:ok={model.media.state === 'available'}
            class:warn={model.media.state !== 'available'}
            data-media-status
          >
            {model.media.state === 'available' ? '✓ Available' : '○ Missing'}
          </span>
        </div>
        <p class="vault-creator-card__axis-hint" data-media-hint>
          {model.media.hint || 'Playable file availability (not package or publication).'}
        </p>
      </div>

      <!-- Presentation: episode package fields only. Independent of published catalog status. -->
      <div class="vault-creator-card__section" data-section="presentation">
        <div class="vault-creator-card__section-head">
          <span class="vault-creator-card__section-title"
            >{model.presentation.axisLabel || 'Presentation'}</span
          >
          <span
            class="vault-creator-card__pill"
            class:ok={model.presentation.ready}
            class:warn={!model.presentation.ready}
            data-presentation-status
          >
            {model.presentation.statusLabel ||
              (model.presentation.ready ? 'Ready' : 'Incomplete')}
          </span>
        </div>
        <p class="vault-creator-card__axis-hint" data-presentation-hint>
          {model.presentation.hint ||
            'Package readiness for Title, Description, and Artwork. Tags and shelf improve discovery.'}
        </p>
        {#if model.presentation.shelfPreview}
          <p class="vault-creator-card__axis-hint" data-creator-current-shelf>
            {shelfFeedbackCopy(model.presentation.shelfPreview)}
          </p>
        {/if}
        <ul class="vault-creator-card__checks">
          <li class:missing={!model.presentation.marks.title} data-check="title">
            <span class="vault-creator-card__mark">{mark(model.presentation.marks.title)}</span>
            <span class="vault-creator-card__k">Title</span>
            <span class="vault-creator-card__v"
              >{model.presentation.title || 'Missing'}</span
            >
          </li>
          <li
            class:missing={model.presentation.descriptionFieldState === 'missing'}
            data-check="description"
            data-field-state={model.presentation.descriptionFieldState || 'missing'}
          >
            <span class="vault-creator-card__mark">{mark(model.presentation.marks.description)}</span>
            <span class="vault-creator-card__k">Description</span>
            <span class="vault-creator-card__v"
              >{model.presentation.description
                ? model.presentation.description.length > 48
                  ? `${model.presentation.description.slice(0, 48)}…`
                  : model.presentation.description
                : fieldStateLabel(model.presentation.descriptionFieldState, 'Not set')}</span
            >
          </li>
          <li
            class:missing={model.presentation.tagsFieldState === 'missing'}
            data-check="tags"
            data-field-state={model.presentation.tagsFieldState || 'missing'}
          >
            <span class="vault-creator-card__mark">{mark(model.presentation.marks.tags)}</span>
            <span class="vault-creator-card__k">Tags</span>
            <span class="vault-creator-card__v" data-tags-value
              >{model.presentation.tags?.length
                ? model.presentation.tags.join(', ')
                : fieldStateLabel(model.presentation.tagsFieldState, 'Not set')}</span
            >
          </li>
          <li
            class:missing={model.presentation.categoryFieldState === 'missing'}
            data-check="category"
            data-field-state={model.presentation.categoryFieldState || 'missing'}
          >
            <span class="vault-creator-card__mark">{mark(model.presentation.marks.category)}</span>
            <span class="vault-creator-card__k">Shelf</span>
            <span class="vault-creator-card__v" data-category-value
              >{model.presentation.category ||
                (model.presentation.categoryFieldState === 'cleared'
                  ? 'Cleared · auto'
                  : 'Auto / Trending')}</span
            >
          </li>
          <li class:missing={!model.presentation.marks.artwork} data-check="artwork">
            <span class="vault-creator-card__mark">{mark(model.presentation.marks.artwork)}</span>
            <span class="vault-creator-card__k">Artwork</span>
            <span class="vault-creator-card__v"
              >{model.presentation.marks.artwork ? 'Set' : 'Missing'}</span
            >
          </li>
        </ul>
        {#if !model.presentation.ready && model.presentation.missing?.length}
          <p class="vault-creator-card__missing" data-presentation-missing>
            Missing: {model.presentation.missing.join(', ')}
          </p>
        {/if}
        {#if model.presentation.artworkUrl}
          <div class="vault-creator-card__art" aria-hidden="true">
            <img src={model.presentation.artworkUrl} alt="" loading="lazy" />
          </div>
        {/if}
        <!-- Phase 19: package/catalog metadata editable without series identity confirmation -->
        <button
          type="button"
          class="vault-creator-card__btn"
          data-edit-package
          data-package-requires-identity="false"
          on:click|stopPropagation|preventDefault={openPackage}
        >
          {model.presentation.ready ? 'Edit package' : 'Add package'}
        </button>
      </div>

      <!-- Episode publication: catalog enum — not Hero PUBLIC APPROVED. -->
      <div
        class="vault-creator-card__section"
        data-section="publishing"
        data-section-axis="episode-publication"
        data-publishing={model.publishing.status}
      >
        <div class="vault-creator-card__section-head">
          <span class="vault-creator-card__section-title"
            >{model.publishing.axisLabel || 'Episode publication'}</span
          >
          <span
            class="vault-creator-card__pub"
            data-publishing-status
            data-episode-status={model.publishing.status}
          >
            {model.publishing.displayLabel || model.publishing.label}
          </span>
        </div>
        <p class="vault-creator-card__axis-hint" data-publishing-hint>
          {model.publishing.hint ||
            'Catalog Draft / Ready / Published / Archived. Not Hero approval.'}
        </p>
      </div>

      <!-- Hero: separate authority surface (not derived from episode status). -->
      <div class="vault-creator-card__section" data-section="hero" data-section-axis="hero-approval">
        <div class="vault-creator-card__section-head">
          <span class="vault-creator-card__section-title">{model.hero?.axisLabel || 'Hero'}</span>
          <span class="vault-creator-card__pill vault-creator-card__pill--neutral" data-hero-axis-status>
            {model.hero?.statusLabel || 'Managed in Hero Manager'}
          </span>
        </div>
        <p class="vault-creator-card__axis-hint" data-hero-hint>
          {model.hero?.hint ||
            'PUBLIC APPROVED is server-authoritative Hero presentation grant — independent of episode publication.'}
        </p>
      </div>
    {/if}
  </div>
{/if}
