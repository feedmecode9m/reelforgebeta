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
    padding: 1.5rem 1.25rem calc(1.5rem + env(safe-area-inset-bottom, 0px));
    text-align: center;
  }
  .consumer-footer__copy {
    margin: 0;
    font-size: 0.78rem;
    letter-spacing: 0.04em;
    color: rgba(255, 255, 255, 0.4);
  }
</style>
