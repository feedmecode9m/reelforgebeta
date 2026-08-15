#!/usr/bin/env node
/**
 * Phase 6.6 — Viewer shelf diversity / presentation composition.
 * No production mutations. No category / title / description writes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    auditViewerShelfCompositionPlacements,
    composeViewerShelfLayouts
} from '../src/lib/feed/viewerShelfComposition.js';
import { collectRealViewerReels } from '../src/lib/feed/viewerSemanticShell.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let failed = 0;
function assert(cond, label) {
    if (cond) console.log(`  ✓ ${label}`);
    else {
        failed += 1;
        console.error(`  ✗ ${label}`);
    }
}

let fetchMutations = 0;
let categoryPatch = 0;
let titleWrites = 0;
let descriptionWrites = 0;

globalThis.fetch = async (input, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    const url = String(input || '');
    if (method !== 'GET' && method !== 'HEAD') {
        fetchMutations += 1;
        if (/category/i.test(url) || method === 'PATCH') categoryPatch += 1;
        if (/title/i.test(url)) titleWrites += 1;
        if (/description/i.test(url)) descriptionWrites += 1;
        throw new Error(`BLOCKED ${method}`);
    }
    return { ok: true, json: async () => [] };
};

const CLUB_ID = 'f727b62e-af4e-4e06-9c36-8312ddb735a8';
const ARRIVAL_ID = '03ef898a-989f-42c3-bdbb-67f37338df65';
const RESIDUAL_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const club = {
    id: CLUB_ID,
    title: '03 CLUB POOM POOM V1',
    name: '03 CLUB POOM POOM V1',
    type: 'video',
    category: 'Trending',
    url: `https://cdn.example/prod/${CLUB_ID}.mp4`,
    thumbnailUrl: `https://cdn.example/thumbs/${CLUB_ID}.jpg`
};

const arrival = {
    id: ARRIVAL_ID,
    title: '01 ARRIVAL OPEN v1',
    name: '01 ARRIVAL OPEN v1',
    type: 'video',
    category: 'Trending',
    url: `https://cdn.example/prod/${ARRIVAL_ID}.mp4`,
    thumbnailUrl: `https://cdn.example/thumbs/${ARRIVAL_ID}.jpg`
};

const residual = {
    id: RESIDUAL_ID,
    title: 'Residual Overflow Cut',
    name: 'Residual Overflow Cut',
    type: 'video',
    category: 'Trending',
    url: `https://cdn.example/prod/${RESIDUAL_ID}.mp4`,
    thumbnailUrl: `https://cdn.example/thumbs/${RESIDUAL_ID}.jpg`
};

console.log('\n[phase-6-6-viewer-shelf-diversity]');

const feedMap = {
    Trending: [club, arrival],
    Romance: [],
    'Cyber-Action': [],
    Suspense: []
};

const composition = composeViewerShelfLayouts(feedMap);
const placements = auditViewerShelfCompositionPlacements(composition);
const byId = Object.fromEntries(placements.map((p) => [p.assetId, p]));

assert(composition.featuredItem?.reel?.id === CLUB_ID, 'Featured = first priority (Club Poom)');
assert(
    (composition.shelfFeedMap.Trending || []).some((r) => r.id === CLUB_ID) &&
        (composition.shelfFeedMap.Trending || []).some((r) => r.id === ARRIVAL_ID),
    'Trending keeps Club + Arrival (discovery shelf unchanged)'
);
assert(composition.browseItems.length === 0, 'Browse empty when all identities already on shelves');
assert(byId[CLUB_ID]?.Featured === true, 'Club Featured: yes');
assert(byId[CLUB_ID]?.shelves.includes('Trending'), 'Club Trending: yes');
assert(byId[CLUB_ID]?.Browse !== true, 'Club Browse: no');
assert(byId[CLUB_ID]?.placementCount === 2, 'Club appears at most twice (Featured + Trending)');
assert(byId[ARRIVAL_ID]?.Featured !== true, 'Arrival Featured: no');
assert(byId[ARRIVAL_ID]?.shelves.includes('Trending'), 'Arrival Trending: yes');
assert(byId[ARRIVAL_ID]?.Browse !== true, 'Arrival Browse: no');
assert(byId[ARRIVAL_ID]?.placementCount === 1, 'Arrival appears once (Trending only)');
assert(composition.uniqueIdentityCount === 2, 'unique identity count = 2');
assert(
    composition.projectedDomCardCount === 3,
    `projected DOM cards = Featured remount + shelves (got ${composition.projectedDomCardCount})`
);

// Residual overflow identity (not on shelf rows) lands in Browse only.
const residualComposition = composeViewerShelfLayouts(feedMap, {
    uniqueItems: [
        ...collectRealViewerReels(feedMap),
        { reel: residual, shelf: 'Trending' }
    ],
    identityFeedMap: feedMap
});
assert(
    residualComposition.browseItems.some((i) => i.reel.id === RESIDUAL_ID),
    'Browse shows residual identity not already on shelves'
);
assert(
    !residualComposition.browseItems.some((i) => i.reel.id === CLUB_ID || i.reel.id === ARRIVAL_ID),
    'Browse still excludes shelf-consumed Club/Arrival'
);

assert(fetchMutations === 0, 'no network mutations');
assert(categoryPatch === 0, 'category PATCH = 0');
assert(titleWrites === 0, 'title writes = 0');
assert(descriptionWrites === 0, 'description writes = 0');

const report = {
    phase: 'PHASE-6-6-VIEWER-SHELF-DIVERSITY',
    status: failed === 0 ? 'PASS' : 'FAIL',
    diagnostics: composition.diagnostics,
    placements,
    residualBrowseIds: residualComposition.browseItems.map((i) => i.reel.id),
    mutations: {
        fetchMutations,
        categoryPatch,
        titleWrites,
        descriptionWrites
    }
};

const out = path.join(root, 'artifacts/phase-6-6-viewer-shelf-diversity-report.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`  · wrote ${out}`);

if (failed > 0) {
    console.error(`\nFAIL — phase-6-6-viewer-shelf-diversity (${failed})`);
    process.exit(1);
}
console.log('\nPASS — phase-6-6-viewer-shelf-diversity');
process.exit(0);
