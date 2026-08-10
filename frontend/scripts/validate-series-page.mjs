#!/usr/bin/env node
/** Series public page contract — seriesIdentity + seasonMetadata, no filename guessing. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else console.log(`  ok: ${msg}`);
}
function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

const page = read('src/components/series/SeriesPublicPage.svelte');
const app = read('src/App.svelte');
assert(/series|SeriesPublicPage/.test(app), 'App routes series pages');
assert(/\/series\//.test(app) || /series\//.test(app), 'series slug route present');
assert(/poster|thumbnail|MediaPoster|artwork/i.test(page), 'series page has poster plane');
assert(!/<video[\s>]/.test(page) || /Theater/.test(page), 'page poster-first (video only via Theater if any)');
assert(/getSeriesById|publicSeriesHydration|resolveSeries/.test(page), 'page uses series identity hydration');
assert(/episodeIsViewerDiscoverable|episodeIsPubliclyPlayable/.test(page), 'page gates viewer discovery/play');
assert(/sortEpisodesForDisplay/.test(page), 'page orders with displayOrder');
assert(/listContinueWatching|recommendSeries/.test(page), 'page wires discovery rails');
assert(!/watchSessionStart:\s*\(\)\s*=>\s*\{\s*\}/.test(page), 'page does not stub watchSessionStart');

if (failures.length) {
    console.error('FAIL validate-series-page\n' + failures.map((f) => `  - ${f}`).join('\n'));
    process.exit(1);
}
console.log('PASS validate-series-page');
