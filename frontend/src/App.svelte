<script>
  import Viewer from './Viewer.svelte';
  import SeriesPublicPage from './components/series/SeriesPublicPage.svelte';
  import './styles.css';

  function readSeriesSlug() {
    if (typeof window === 'undefined') return null;

    const match = window.location.pathname.match(/^\/series\/([^/]+)\/?$/i);

    if (!match?.[1]) return null;

    try {
      return decodeURIComponent(match[1]).trim() || null;
    } catch {
      return match[1].trim() || null;
    }
  }

  const seriesSlug = readSeriesSlug();
</script>

{#if seriesSlug}
  <SeriesPublicPage slug={seriesSlug} />
{:else}
  <main>
    <Viewer />
  </main>
{/if}

<style>
  main {
    margin: 0;
    padding: 0;
    width: 100%;
    min-height: 100vh;
    background: #000;
  }
</style>
