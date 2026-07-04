<script>
  import { onMount } from 'svelte';
  import { initPlatformMetrics } from '../../lib/observability/platformMetrics.js';
  import { initObservabilityCenter } from '../../lib/observability/observabilityCenter.js';

  onMount(() => {
    initPlatformMetrics();
    initObservabilityCenter();
  });
</script>
