#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function assert(condition, message) {
    if (!condition) failures.push(message);
    else console.log(`  ok: ${message}`);
}

function read(relPath) {
    return fs.readFileSync(path.join(root, relPath), 'utf8');
}

const browseHelper = read('src/lib/series/viewerSeriesBrowseCatalog.js');
const reelshort = read('src/components/vertical/ReelshortExperience.svelte');

assert(
    /buildViewerSeriesBrowseCatalog\(\$seriesCatalog/.test(reelshort),
    'browse composition reads canonical seriesCatalog'
);
assert(
    !/Object\.keys\(\$feed\)\.filter\(\(cat\) => cat !== 'Auto-Detect'\)/.test(reelshort),
    'primary browse surface no longer iterates feed shelves into episode cards'
);
assert(
    /const bySeriesId = new Map\(\)/.test(browseHelper) &&
        /if \(!seriesId \|\| bySeriesId\.has\(seriesId\)\) continue;/.test(browseHelper),
    'production dedupe map keyed by canonical series identity exists'
);
assert(
    /const episodes = collectViewerEpisodes\(series\);/.test(browseHelper) &&
        /if \(episodes\.length === 0\) continue;/.test(browseHelper),
    'browse cards are filtered to viewer-discoverable series with episodes'
);
assert(
    /const path = publicSeriesPath\(series\) \|\| ''/.test(browseHelper) &&
        /if \(!path\) continue;/.test(browseHelper),
    'production cards only use canonical /series path mapping'
);
assert(
    /<section class="viewer-production-library"/.test(reelshort) &&
        /<SeriesBrowsePosterCard \{item\} sectionLabel=\{sectionData\.key\}/.test(reelshort) &&
        /data-viewer-browse-grid/.test(reelshort),
    'primary browse surface is rendered as production poster sections'
);
assert(
    /data-viewer-continue-watching/.test(reelshort) &&
        /listContinueWatching\(\{ limit: 8 \}\)/.test(reelshort),
    'secondary continue-watching lane is present and progress-backed'
);

if (failures.length) {
    console.error('FAIL validate-viewer-series-browse-catalog\n' + failures.map((f) => `  - ${f}`).join('\n'));
    process.exit(1);
}

console.log('PASS validate-viewer-series-browse-catalog');
