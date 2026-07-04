<script>
  import FeedExperience from '../experiences/FeedExperience.svelte';

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
  export let handleCardClick;
  export let handleCardVideoError;
  export let logVaultImageError;
</script>

<FeedExperience
  {loading}
  {feed}
  {normalizedFeed}
  {totalReelsCount}
  {personalThumbnailCollection}
  {personalVideos}
  {adminMode}
  {feedCardVideoFallbacks}
  {feedCardImageFallbacks}
  {UIAgent}
  {categoryNames}
  {hasPlayableVideo}
  {getImg}
  {AI_CLEANUP_AGENT}
  {handleCardClick}
  {handleCardVideoError}
  {logVaultImageError}
/>
