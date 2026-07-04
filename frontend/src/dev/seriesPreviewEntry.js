import '../styles.css';
import SeriesComponentsPreview from './SeriesComponentsPreview.svelte';

const target = document.getElementById('app');
if (target) {
    new SeriesComponentsPreview({ target });
}
