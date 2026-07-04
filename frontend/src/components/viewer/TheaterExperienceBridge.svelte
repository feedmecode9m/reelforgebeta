<script>
  import TheaterExperience from '../theater/TheaterExperience.svelte';

  export let personalVideos;
  export let UIAgent;
  export let AI_IMAGE_GENERATOR;
  export let logVaultImageError;
</script>

<TheaterExperience
  {personalVideos}
  {UIAgent}
  {AI_IMAGE_GENERATOR}
  {logVaultImageError}
/>
