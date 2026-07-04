<script>
  import ReelshortExperience from '../vertical/ReelshortExperience.svelte';

  export let loading;
  export let feed;
  export let normalizedFeed;
  export let totalReelsCount;
  export let personalThumbnailCollection;
  export let personalVideos;
  export let adminMode;
  export let feedCardVideoFallbacks;
  export let feedCardImageFallbacks;
  export let UIAgent;
  export let categoryNames;
  export let hasPlayableVideo;
  export let getImg;
  export let AI_CLEANUP_AGENT;
  /** @type {(reel: Record<string, unknown>) => void} */
  export let handleCardClick;
  /** @type {(event: Event, reel: Record<string, unknown>) => void} */
  export let handleCardVideoError;
  /** @type {(img: HTMLImageElement, src?: string) => void} */
  export let logVaultImageError;
</script>

{#if $loading}
  <div class="forge-loader">SYNCHRONIZING...</div>
{:else}
  <ReelshortExperience
    section="feed"
    {feed}
    {normalizedFeed}
    {adminMode}
    {feedCardVideoFallbacks}
    {feedCardImageFallbacks}
    {UIAgent}
    {categoryNames}
    {hasPlayableVideo}
    {getImg}
    onOpenTheater={handleCardClick}
    onRecordAccess={(reelId) => AI_CLEANUP_AGENT.recordAccess(reelId)}
    onCardVideoError={handleCardVideoError}
    onImageError={(img, reel, category, i) => UIAgent.handleImageError(img, reel, category, i)}
    {logVaultImageError}
  />
{/if}
