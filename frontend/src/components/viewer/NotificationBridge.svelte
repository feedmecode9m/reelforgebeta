<script>
  import { onMount } from 'svelte';
  import NotificationCenter from '../notifications/NotificationCenter.svelte';
  import { initNotificationCenter } from '../../lib/notifications/notificationCenter.js';

  onMount(() => {
    initNotificationCenter();
  });
</script>

{#if false}
<div class="header-actions">
  <NotificationCenter />
</div>
{/if}
