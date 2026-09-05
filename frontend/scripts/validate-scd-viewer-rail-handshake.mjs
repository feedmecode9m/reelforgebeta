#!/usr/bin/env node
/**
 * Validates Smart Category Distribution (SCD) counts handshake with Viewer primary rails.
 * Effective shelf (creator lock + persisted metadata) must drive both Studio chips and
 * New Releases / Trending / Suspense tab filtering — not raw feed[Romance].length alone.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    computeEffectiveShelfCounts,
    collectViewerRailFeedItems,
    buildReelEffectiveShelvesMap,
    describeShelfDistributionHandshake,
    resolveEffectiveShelfForReel
} from '../src/lib/feed/effectiveShelfDistribution.js';
import { REEL_TITLES_PERSISTENT_KEY } from '../src/lib/content/contentIdentityResolver.js';

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

/** @type {import('../src/lib/feed/creatorCatalogMetadata.js').defaultStorage} */
function memoryStorage(initial = {}) {
    /** @type {Record<string, string>} */
    const map = { ...initial };
    return {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null),
        setItem: (k, v) => {
            map[k] = v;
        }
    };
}

const CLUB_ID = 'd2aafde7-d7ba-492c-a860-20b51f7f4033';
const storage = memoryStorage({
    [REEL_TITLES_PERSISTENT_KEY]: JSON.stringify({
        [CLUB_ID]: {
            title: '03 CLUB POOM POOM V1',
            category: 'Romance',
            savedAt: Date.now()
        }
    })
});

/** Creator-locked Romance item still duplicated on Trending bucket only. */
const feedMap = {
    Trending: [
        {
            id: CLUB_ID,
            title: '03 CLUB POOM POOM V1',
            type: 'video',
            url: '/videos/club.mp4',
            category: 'Trending'
        },
        {
            id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            title: 'Other Trending',
            type: 'video',
            url: '/videos/other.mp4',
            category: 'Trending'
        }
    ],
    Romance: [],
    'Cyber-Action': [],
    Suspense: []
};

const bucketRomance = feedMap.Romance.length;
const effective = computeEffectiveShelfCounts(feedMap, { storage });
assert(bucketRomance === 0, 'fixture: Romance bucket empty (stale placement)');
assert(effective.Romance === 1, 'effective Romance count includes creator-locked Trending-only item');
assert(effective.Trending === 1, 'effective Trending count excludes creator-locked Romance item');

const newReleaseItems = collectViewerRailFeedItems('new-releases', feedMap, { storage }, new Map());
assert(newReleaseItems.length === 1, 'New Releases tab surfaces creator-locked Romance item');
assert(
    String(newReleaseItems[0]?.reel?.id || '') === CLUB_ID,
    'New Releases tab item is CLUB POOM POOM reel'
);

const handshake = describeShelfDistributionHandshake(feedMap, { storage });
assert(
    handshake.viewerRailMap['new-releases'].effectiveCount === handshake.effectiveCounts.Romance,
    'SCD Romance effective count matches New Releases rail effective count'
);
assert(
    handshake.viewerRailMap['new-releases'].posterCount === handshake.effectiveCounts.Romance,
    'New Releases poster count matches SCD Romance effective count'
);
assert(
    handshake.viewerRailMap['new-releases'].bucketCount === 0,
    'handshake reports stale Romance bucket count separately from effective count'
);

assert(
    resolveEffectiveShelfForReel(feedMap.Trending[0], { storage }) === 'Romance',
    'resolveEffectiveShelfForReel honors persisted creator Romance'
);

const viewerContext = read('src/viewer/viewerContext.js');
const reelshort = read('src/components/vertical/ReelshortExperience.svelte');
const studio = read('src/components/experiences/StudioExperience.svelte');

assert(/computeEffectiveShelfCounts/.test(viewerContext), 'categoryCounts uses computeEffectiveShelfCounts');
assert(/collectViewerRailFeedItems/.test(reelshort), 'viewer rails use collectViewerRailFeedItems');
assert(/viewerRailFeedMap = \$feed/.test(reelshort), 'viewer rails read the same feed store as SCD counts');
assert(/effective creator shelf/.test(studio), 'Studio SCD hint documents effective shelf counts');

if (failures.length) {
    console.error('VALIDATE_SCD_VIEWER_RAIL_HANDSHAKE=FAIL');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}

console.log('VALIDATE_SCD_VIEWER_RAIL_HANDSHAKE=PASS');
for (const n of notes) console.log(`  ${n}`);
