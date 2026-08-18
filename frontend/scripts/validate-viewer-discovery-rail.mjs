#!/usr/bin/env node
/**
 * LOCAL-VIEWER-DISCOVERY-RAIL-2 — Home / New Releases / Trending / Suspense
 * chrome maps to Smart Category Distribution shelves. Labels follow LIVE CONTENT
 * renames. Cards/posters stay unchanged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    VIEWER_PRIMARY_RAIL,
    labelViewerPrimaryRailTab,
    listViewerPrimaryRailTabs,
    shelfVisibleForViewerRail
} from '../src/lib/feed/discoveryTaxonomy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const notes = [];

function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else notes.push(`ok: ${msg}`);
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

const keys = VIEWER_PRIMARY_RAIL.map((slot) => slot.key);
assert(keys.join(',') === 'home,new-releases,trending,suspense', 'rail keys are home/new-releases/trending/suspense');
assert(VIEWER_PRIMARY_RAIL[0].shelfId === null, 'Home has no shelf filter');
assert(VIEWER_PRIMARY_RAIL[1].shelfId === 'Romance', 'New Releases maps to Romance');
assert(VIEWER_PRIMARY_RAIL[2].shelfId === 'Trending', 'Trending maps to Trending');
assert(VIEWER_PRIMARY_RAIL[3].shelfId === 'Suspense', 'Suspense maps to Suspense');

const defaultTabs = listViewerPrimaryRailTabs({});
assert(
    defaultTabs.map((t) => t.label).join('|') === 'Home|New Releases|Trending|Suspense',
    'default labels Home / New Releases / Trending / Suspense'
);

const renamed = listViewerPrimaryRailTabs({
    Romance: 'Late Night',
    Trending: 'Hot Now',
    Suspense: 'Edge'
});
assert(renamed.find((t) => t.key === 'new-releases')?.label === 'Late Night', 'Romance SCD rename drives New Releases tab');
assert(renamed.find((t) => t.key === 'trending')?.label === 'Hot Now', 'Trending SCD rename drives Trending tab');
assert(renamed.find((t) => t.key === 'suspense')?.label === 'Edge', 'Suspense SCD rename drives Suspense tab');
assert(renamed.find((t) => t.key === 'home')?.label === 'Home', 'Home label stays fixed');

assert(
    labelViewerPrimaryRailTab(VIEWER_PRIMARY_RAIL[3], { Suspense: 'Suspense' }) === 'Suspense',
    'canonical SCD name keeps screenshot default for Suspense'
);

assert(shelfVisibleForViewerRail('Suspense', 'suspense') === true, 'Suspense tab shows Suspense shelf');
assert(shelfVisibleForViewerRail('Trending', 'suspense') === false, 'Suspense tab hides Trending shelf');
assert(shelfVisibleForViewerRail('Romance', 'new-releases') === true, 'New Releases tab shows Romance shelf');
assert(shelfVisibleForViewerRail('Suspense', 'home') === true, 'Home tab still shows Suspense');

const taxonomy = read('src/lib/feed/discoveryTaxonomy.js');
const reelshort = read('src/components/vertical/ReelshortExperience.svelte');
const studio = read('src/components/experiences/StudioExperience.svelte');

assert(/key: 'suspense', shelfId: 'Suspense'/.test(taxonomy), 'taxonomy source includes suspense slot');
assert(/listViewerPrimaryRailTabs/.test(reelshort), 'viewer rail uses listViewerPrimaryRailTabs');
assert(/shelfVisibleForViewerRail/.test(reelshort), 'viewer shelves filter via shelfVisibleForViewerRail');
assert(
    /Trending \/ Suspense labels sync from these LIVE CONTENT renames/.test(studio) &&
        /Suspense → Suspense tab/.test(studio),
    'Studio SCD hint documents Suspense tab alias sync'
);
assert(!/ViewerSemanticCard/.test(taxonomy), 'rail contract does not rewrite card/poster components');

if (failures.length) {
    console.error('VALIDATE_VIEWER_DISCOVERY_RAIL=FAIL');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}

console.log('VALIDATE_VIEWER_DISCOVERY_RAIL=PASS');
for (const n of notes) console.log(`  ${n}`);
