<script>
  import { clientNavigate } from '../../lib/auth/clientNavigate.js';

  export let title = 'This area is unavailable.';
  export let detail = 'Return home to keep watching LOOK@ZAKANDA PRESENTS.';
</script>

<section class="unavailable" aria-labelledby="unavailable-title">
  <div class="unavailable__card">
    <p class="unavailable__brand">LOOK@ZAKANDA PRESENTS</p>
    <h1 id="unavailable-title">{title}</h1>
    <p class="unavailable__detail">{detail}</p>
    <button type="button" class="unavailable__home" on:click={() => clientNavigate('/')}>
      Back to home
    </button>
  </div>
</section>

<style>
  .unavailable {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 2rem 1rem;
    background: #050508;
    color: #f4f4f5;
  }
  .unavailable__card {
    width: min(420px, 100%);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    padding: 1.75rem 1.5rem;
    background: rgba(16, 18, 28, 0.92);
    text-align: center;
  }
  .unavailable__brand {
    margin: 0 0 0.75rem;
    font-size: 0.72rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(0, 242, 255, 0.9);
  }
  h1 {
    margin: 0 0 0.5rem;
    font-size: 1.35rem;
    font-weight: 600;
  }
  .unavailable__detail {
    margin: 0 0 1.25rem;
    color: rgba(255, 255, 255, 0.58);
    font-size: 0.92rem;
    line-height: 1.45;
  }
  .unavailable__home {
    border: 1px solid rgba(0, 242, 255, 0.4);
    background: rgba(0, 242, 255, 0.12);
    color: #fff;
    border-radius: 8px;
    padding: 0.65rem 1rem;
    cursor: pointer;
    font-size: 0.9rem;
  }
</style>
