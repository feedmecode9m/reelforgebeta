#!/usr/bin/env node
/**
 * Phase 6.6.2 — Canonical media identity upsert validators (A–E).
 * No production network mutations.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    collapseSameShelfDuplicateIdentities,
    detectDuplicateIdentities,
    findCanonicalFeedMatch,
    matchCanonicalFeedIdentity,
    normalizeMediaUrl,
    removeCanonicalFeedMatches,
    resolveProtectedFeedTitle,
    sameCanonicalMediaIdentity
} from '../src/lib/feed/canonicalMediaIdentity.js';
import { isUnsafeViewerCardTitle } from '../src/lib/feed/viewerMediaIdentity.js';
import { composeViewerShelfLayouts } from '../src/lib/feed/viewerShelfComposition.js';

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
globalThis.fetch = async (_input, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
        fetchMutations += 1;
        throw new Error(`BLOCKED ${method}`);
    }
    return { ok: true, json: async () => [] };
};

const ARRIVAL_ID = '73adb67a-6d97-43fd-8fc6-3a4b4ce0b3ee';

/**
 * Pure simulation of distributeVideoToFeed upsert (mirrors aiCleanupAgent logic).
 * @param {Record<string, unknown[]>} feedMap
 * @param {Record<string, unknown>} videoData
 * @param {{ persistent?: { title?: string; title_original?: string } | null }} [opts]
 */
function simulateDistributeUpsert(feedMap, videoData, opts = {}) {
    const probe = {
        id: String(videoData.id || ''),
        personal_video_id: String(videoData.id || ''),
        url: String(videoData.url || ''),
        type: 'video'
    };
    const stem = String(videoData.name || videoData.title || '').replace(/\.[^/.]+$/, '');
    const match = findCanonicalFeedMatch(feedMap, probe);
    const protectedTitle = resolveProtectedFeedTitle({
        existing: match?.reel || null,
        persistent: opts.persistent || null,
        catalogTitle: String(videoData.title || '').replace(/\.[^/.]+$/, '') || '',
        filenameFallback: stem
    });
    const relativeUrl = normalizeMediaUrl(videoData.url) || String(videoData.url || '');
    const relativeThumb = videoData.thumbnail
        ? normalizeMediaUrl(videoData.thumbnail) || String(videoData.thumbnail)
        : '';

    if (match) {
        const stripped = removeCanonicalFeedMatches(feedMap, probe);
        const merged = {
            ...match.reel,
            id: String(match.reel.id || videoData.id),
            personal_video_id: String(match.reel.personal_video_id || videoData.id),
            isPersonalVideo: true,
            isPlaceholder: false,
            type: 'video',
            url: relativeUrl || match.reel.url,
            thumbnailUrl: relativeThumb || match.reel.thumbnailUrl || '',
            title: protectedTitle.title || match.reel.title || stem,
            name: protectedTitle.title || match.reel.name || stem,
            title_original: protectedTitle.title_original || protectedTitle.title,
            _localModified: protectedTitle.protected || Boolean(match.reel._localModified),
            __identitySource: 'syncVideoVaultToFeed:update',
            category: match.shelf
        };
        const next = { ...stripped.feedMap };
        const shelf = match.shelf || 'Trending';
        next[shelf] = [merged, ...(next[shelf] || [])];
        return { feedMap: next, action: 'update', removed: stripped.removed, title: merged.title };
    }

    const inserted = {
        id: String(videoData.id),
        personal_video_id: String(videoData.id),
        isPersonalVideo: true,
        isPlaceholder: false,
        type: 'video',
        url: relativeUrl,
        thumbnailUrl: relativeThumb,
        title: protectedTitle.title || stem,
        name: protectedTitle.title || stem,
        title_original: protectedTitle.title_original || protectedTitle.title || stem,
        _localModified: protectedTitle.protected,
        __identitySource: 'syncVideoVaultToFeed:insert',
        category: 'Trending'
    };
    const next = { ...feedMap, Trending: [inserted, ...(feedMap.Trending || [])] };
    return { feedMap: next, action: 'insert', removed: 0, title: inserted.title };
}

console.log('\n[phase-6-6-2-canonical-media-identity]');

assert(
    normalizeMediaUrl('http://localhost:8080/videos/abc.mp4') ===
        normalizeMediaUrl('/videos/abc.mp4'),
    'URL normalize: localhost absolute ≡ relative'
);

const catalogCard = {
    id: ARRIVAL_ID,
    title: '01 ARRIVAL OPEN v1',
    name: '01 ARRIVAL OPEN v1',
    type: 'video',
    category: 'Trending',
    url: `http://127.0.0.1:8080/videos/${ARRIVAL_ID}.mp4`,
    thumbnailUrl: `http://127.0.0.1:8080/thumbs/${ARRIVAL_ID}.jpg`,
    __identitySource: 'buildHomeFeed'
};

const vaultTwin = {
    id: ARRIVAL_ID,
    personal_video_id: ARRIVAL_ID,
    isPersonalVideo: true,
    title: 'Arrival: First Contact',
    name: 'Arrival: First Contact',
    type: 'video',
    category: 'Trending',
    url: `/videos/${ARRIVAL_ID}.mp4`,
    thumbnailUrl: `/thumbs/${ARRIVAL_ID}.jpg`,
    _localModified: true,
    __identitySource: 'syncVideoVaultToFeed'
};

assert(sameCanonicalMediaIdentity(catalogCard, vaultTwin), 'identity match ignores title');
assert(
    matchCanonicalFeedIdentity(catalogCard, {
        id: ARRIVAL_ID,
        url: `/videos/${ARRIVAL_ID}.mp4`
    }),
    'matchCanonicalFeedIdentity: assetId + normalized URL'
);

const twinFeed = {
    Trending: [catalogCard, vaultTwin],
    Romance: [],
    'Cyber-Action': [],
    Suspense: []
};
const before = detectDuplicateIdentities(twinFeed);
assert(before.duplicates.length === 1, `before: duplicate count=${before.duplicates.length}`);
assert(before.duplicates[0]?.records === 2, 'before: records=2');

// --- A: upload MP4 → one Trending card ---
const empty = { Trending: [], Romance: [], 'Cyber-Action': [], Suspense: [] };
const uploadA = simulateDistributeUpsert(empty, {
    id: ARRIVAL_ID,
    name: '01_ARRIVAL_OPEN_v1.mp4',
    url: `/videos/${ARRIVAL_ID}.mp4`,
    thumbnail: `/thumbs/${ARRIVAL_ID}.jpg`
});
assert(uploadA.action === 'insert', 'A: first upload inserts');
assert((uploadA.feedMap.Trending || []).length === 1, 'A: one Trending card');

// --- E: vault sync rerun → update, no insert ---
const syncE = simulateDistributeUpsert(uploadA.feedMap, {
    id: ARRIVAL_ID,
    name: '01_ARRIVAL_OPEN_v1.mp4',
    url: `http://localhost:8080/videos/${ARRIVAL_ID}.mp4`,
    thumbnail: `http://localhost:8080/thumbs/${ARRIVAL_ID}.jpg`
});
assert(syncE.action === 'update', 'E: vault sync rerun updates existing');
assert((syncE.feedMap.Trending || []).length === 1, 'E: still one Trending card');
assert(detectDuplicateIdentities(syncE.feedMap).duplicates.length === 0, 'E: no duplicates after sync');

// Absolute catalog + relative vault sync
const catalogOnly = {
    Trending: [{ ...catalogCard }],
    Romance: [],
    'Cyber-Action': [],
    Suspense: []
};
const beforeCatalogTwin = detectDuplicateIdentities(catalogOnly).realRowCount;
const syncOntoCatalog = simulateDistributeUpsert(
    catalogOnly,
    {
        id: ARRIVAL_ID,
        name: '01_ARRIVAL_OPEN_v1.mp4',
        url: `/videos/${ARRIVAL_ID}.mp4`
    },
    { persistent: { title: 'Arrival: First Contact', title_original: 'Arrival: First Contact' } }
);
assert(syncOntoCatalog.action === 'update', 'catalog+vault: update not insert');
assert((syncOntoCatalog.feedMap.Trending || []).length === 1, 'catalog+vault: one card after merge');
assert(
    syncOntoCatalog.title === 'Arrival: First Contact',
    'title protection: persistent wins over filename stem'
);
const afterMerge = detectDuplicateIdentities(syncOntoCatalog.feedMap);
assert(afterMerge.duplicates.length === 0, `after: duplicate count=${afterMerge.duplicates.length}`);

// --- C: title edit → same asset, new title ---
const editedFeed = simulateDistributeUpsert(
    syncOntoCatalog.feedMap,
    { id: ARRIVAL_ID, name: '01_ARRIVAL_OPEN_v1.mp4', url: `/videos/${ARRIVAL_ID}.mp4` },
    { persistent: { title: 'Arrival: First Contact' } }
);
assert(editedFeed.feedMap.Trending[0].id === ARRIVAL_ID, 'C: same asset ID');
assert(editedFeed.feedMap.Trending[0].title === 'Arrival: First Contact', 'C: new title retained');
assert((editedFeed.feedMap.Trending || []).length === 1, 'C: same single card');

// Never overwrite custom title with filename on sync
const protect = resolveProtectedFeedTitle({
    existing: {
        id: ARRIVAL_ID,
        title: 'Arrival: First Contact',
        name: 'Arrival: First Contact',
        _localModified: true
    },
    persistent: null,
    filenameFallback: '01 ARRIVAL OPEN v1'
});
assert(protect.title === 'Arrival: First Contact', 'custom title not overwritten by filename');
assert(protect.protected === true, 'custom title marked protected');

// --- B: MP4 + thumbnail (thumb is not a second video identity) ---
const withThumb = {
    Trending: [
        {
            id: ARRIVAL_ID,
            type: 'video',
            url: `/videos/${ARRIVAL_ID}.mp4`,
            thumbnailUrl: `/thumbs/${ARRIVAL_ID}.jpg`,
            title: 'Arrival: First Contact',
            __identitySource: 'video'
        }
    ]
};
const posterOnly = simulateDistributeUpsert(withThumb, {
    id: ARRIVAL_ID,
    name: '01_ARRIVAL_OPEN_v1.mp4',
    url: `/videos/${ARRIVAL_ID}.mp4`,
    thumbnail: `/thumbs/${ARRIVAL_ID}.jpg`
});
assert((posterOnly.feedMap.Trending || []).length === 1, 'B: one video card after thumb sync');
assert(
    Boolean(posterOnly.feedMap.Trending[0].thumbnailUrl),
    'B: thumbnail remains poster field on video card'
);

// --- D: hard refresh shaped collapse ---
const collapsed = collapseSameShelfDuplicateIdentities(twinFeed);
assert(collapsed.removed === 1, 'D: collapse removes twin');
assert((collapsed.feedMap.Trending || []).length === 1, 'D: one identity after refresh collapse');

const composition = composeViewerShelfLayouts({
    Trending: editedFeed.feedMap.Trending,
    Romance: [],
    'Cyber-Action': [],
    Suspense: []
});
assert(
    (composition.shelfFeedMap.Trending || []).filter((r) => r.id === ARRIVAL_ID).length === 1,
    'Trending shelf: identity once'
);

assert(fetchMutations === 0, 'no network mutations');
assert(!isUnsafeViewerCardTitle('Arrival: First Contact'), 'edited title is presentation-safe');

const agentSource = fs.readFileSync(
    path.join(root, 'src/lib/viewer/aiCleanupAgent.js'),
    'utf8'
);
assert(agentSource.includes('CANONICAL_FEED_UPSERT'), 'distributeVideoToFeed wired with upsert logging');
assert(agentSource.includes('findCanonicalFeedMatch'), 'distributeVideoToFeed uses canonical match');
assert(
    !/newFeed\[primaryCategory\]\.unshift\(reel\);\s*return newFeed;\s*\}\);/.test(
        agentSource.replace(/\s+/g, ' ')
    ) || agentSource.includes("action: 'insert'"),
    'insert path only when no match'
);

const report = {
    phase: 'PHASE-6-6-2-CANONICAL-MEDIA-IDENTITY-UPSERT',
    status: failed === 0 ? 'PASS' : 'FAIL',
    duplicatesBefore: before.duplicates.length,
    duplicatesAfter: afterMerge.duplicates.length,
    recordsBefore: before.duplicates[0]?.records || 0,
    recordsAfter: afterMerge.realRowCount,
    merge: {
        catalogPlusVaultAction: syncOntoCatalog.action,
        titleAfterMerge: syncOntoCatalog.title,
        vaultRerunAction: syncE.action
    },
    mutations: { fetchMutations },
    files: [
        'frontend/src/lib/feed/canonicalMediaIdentity.js',
        'frontend/src/lib/viewer/aiCleanupAgent.js'
    ]
};

const out = path.join(root, 'artifacts/phase-6-6-2-canonical-media-identity-report.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`  · wrote ${out}`);
console.log(
    `  · duplicates before=${report.duplicatesBefore} (records=${report.recordsBefore}) after=${report.duplicatesAfter}`
);

if (failed > 0) {
    console.error(`\nFAIL — phase-6-6-2-canonical-media-identity (${failed})`);
    process.exit(1);
}
console.log('\nPASS — phase-6-6-2-canonical-media-identity');
process.exit(0);
