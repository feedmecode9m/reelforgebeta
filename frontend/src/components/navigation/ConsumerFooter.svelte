<script>
  /** Shared consumer footer — LOOK@ZAKANDA PRESENTS identity chrome. */
  export let brand = 'LOOK@ZAKANDA PRESENTS';
  export let year = 2026;
</script>

<footer class="consumer-footer" data-consumer-footer>
  <p class="consumer-footer__copy">© {year} {brand}</p>
</footer>

<style>
  .consumer-footer {
    margin-top: auto;
    padding: var(--lz-space-5, 1.5rem) var(--lz-page-pad-x, 1.25rem)
      calc(var(--lz-space-5, 1.5rem) + env(safe-area-inset-bottom, 0px));
    text-align: center;
    font-family: var(--lz-font-body, inherit);
  }
  .consumer-footer__copy {
    margin: 0;
    font-size: var(--lz-size-caption, 0.78rem);
    letter-spacing: var(--lz-tracking-label, 0.04em);
    color: var(--lz-ink-dim, rgba(255, 255, 255, 0.4));
  }
</style>
