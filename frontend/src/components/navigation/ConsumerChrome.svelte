<script>
  /**
   * Shared consumer product chrome for LOOK@ZAKANDA PRESENTS.
   * Wraps page body with consistent header (and optional footer).
   */
  import ConsumerHeader from './ConsumerHeader.svelte';
  import ConsumerFooter from './ConsumerFooter.svelte';

  export let brand = 'LOOK@ZAKANDA PRESENTS';
  /** @type {'overlay' | 'solid'} */
  export let headerVariant = 'overlay';
  export let showFooter = true;
  /** When true, chrome fills viewport and body scrolls (auth/account pages). */
  export let fillViewport = false;
</script>

<div
  class="consumer-chrome"
  class:consumer-chrome--fill={fillViewport}
  data-consumer-chrome
  data-header-variant={headerVariant}
>
  <ConsumerHeader {brand} variant={headerVariant} />
  <div class="consumer-chrome__body">
    <slot />
  </div>
  {#if showFooter}
    <ConsumerFooter {brand} />
  {/if}
</div>

<style>
  .consumer-chrome {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 0;
  }
  .consumer-chrome--fill {
    min-height: 100vh;
    min-height: 100dvh;
    background: #050508;
  }
  .consumer-chrome__body {
    flex: 1 1 auto;
    min-width: 0;
    width: 100%;
  }
</style>
