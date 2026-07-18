<script>
  import HeroExperience from '../experiences/HeroExperience.svelte';

  export let HERO_BACKGROUND_VIDEO;
  export let HERO_POSTER_IMAGE;
  export let heroSelection;
  export let feedReels = [];
  export let heroVideoLoaded;
  export let heroVideoFailed;
  export let heroRestoring;
  export let heroResumeToast;
  export let heroPendingFile;
  export let heroIsDragOver;
  export let heroPreviewUrl;
  export let personalVideos;
  export let uploadStatus;
  export let resourceManager;
  export let CONFIG;
  export let syncFromVault;
  export let persistPersonalVault;
  export let viewerHydrationReady;
  export let sanitizeViewer = true;
</script>

<HeroExperience
  section="stage"
  {HERO_BACKGROUND_VIDEO}
  {HERO_POSTER_IMAGE}
  {heroSelection}
  {feedReels}
  {heroVideoLoaded}
  {heroVideoFailed}
  {heroRestoring}
  {heroResumeToast}
  {heroPendingFile}
  {heroIsDragOver}
  {heroPreviewUrl}
  {personalVideos}
  {uploadStatus}
  {resourceManager}
  {CONFIG}
  {syncFromVault}
  {persistPersonalVault}
  {viewerHydrationReady}
  {sanitizeViewer}
/>
