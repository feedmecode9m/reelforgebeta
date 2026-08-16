#!/usr/bin/env node
/**
 * Smart Catalog Population — acceptance A–P + identity/enrichment invariants.
 * Pure Node (no Vite). Does not touch Hero/Theater/backend/series.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    resolveCanonicalMediaId,
    isDurableMediaId,
    mergeMediaInventory,
    projectCatalogCard,
    enrichCatalogCard,
    __resetCatalogTempKeySeqForTests
} from '../src/lib/feed/catalogInventory.js';
import { resolveCanonicalMediaIdentity, sameCanonicalMediaIdentity } from '../src/lib/feed/canonicalMediaIdentity.js';
import { resolveViewerMediaIdentities } from '../src/lib/feed/viewerMediaIdentity.js';
import {
    classifyContent,
    detectShelfFromTitle,
    DISCOVERY_SHELF_KEYWORDS
} from '../src/lib/feed/contentClassifier.js';
import { distributeToShelves } from '../src/lib/feed/categoryDistribution.js';
import { applyShelfRotation, resolveRotationSeed } from '../src/lib/feed/shelfRotation.js';
import { fillShelfPresentation, pickFirstListWithRealCards, collectPlayableVideosFromFeedMap, mergeMissingVaultImageCards, mergeMissingPlayableVideos } from '../src/lib/feed/fillShelfPresentation.js';
import {
    displayDiscoveryShelf,
    reconcileFeedToCanonicalShelves,
    resolveCanonicalDiscoveryShelf,
    syncCategoryAliasStore
} from '../src/lib/feed/discoveryTaxonomy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

let failed = 0;
/** @param {boolean} cond @param {string} label */
function assert(cond, label) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}`);
}

function read(rel) {
    return readFileSync(join(root, rel), 'utf8');
}

console.log('\n[catalog-smart-population]');

__resetCatalogTempKeySeqForTests();

// --- Identity: never filename ---
console.log('\n[identity]');
{
    const byFile = resolveCanonicalMediaId({
        fileName: 'love-story.mp4',
        title: 'Love Story Romance Kiss'
    });
    assert(byFile.durable === false || !byFile.id.includes('love-story'), 'filename not used as durable id');
    assert(byFile.id.startsWith('temp:') || byFile.durable, 'no-id item gets temp or durable URL key');

    const byReel = resolveCanonicalMediaId({
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        fileName: 'love-story.mp4'
    });
    assert(byReel.durable === true, 'reel UUID is durable');
    assert(byReel.id === 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'reel id preferred over filename');

    assert(isDurableMediaId('clip.mp4') === false, 'bare clip.mp4 rejected as durable');
    assert(isDurableMediaId('temp:abc') === false, 'temp: keys are not durable');
}

// --- Filename-similar, different durable ids → no merge ---
console.log('\n[no filename false-merge]');
{
    const a = {
        id: '11111111-1111-1111-1111-111111111111',
        fileName: 'vacation-day.mp4',
        title: 'Vacation A',
        type: 'video',
        url: 'https://cdn.example/media/11111111-1111-1111-1111-111111111111.mp4'
    };
    const b = {
        id: '22222222-2222-2222-2222-222222222222',
        fileName: 'vacation-day-final.mp4',
        title: 'Vacation B',
        type: 'video',
        url: 'https://cdn.example/media/22222222-2222-2222-2222-222222222222.mp4'
    };
    const merged = mergeMediaInventory([], [a, b]);
    assert(merged.length === 2, 'filename-similar different ids → two cards');
    assert(
        merged.every((c) => c.id === a.id || c.id === b.id),
        'both durable ids preserved'
    );
}

// --- Poster → MP4 enrichment ---
console.log('\n[poster→MP4 enrichment]');
{
    const poster = {
        id: 'poster-mp4-same-01',
        title: 'Night Romance Kiss Love',
        category: 'Trending',
        type: 'image',
        url: 'https://cdn.example/thumbs/poster-mp4-same-01.jpg',
        posterUrl: 'https://cdn.example/thumbs/poster-mp4-same-01.jpg',
        thumbnailUrl: 'https://cdn.example/thumbs/poster-mp4-same-01.jpg'
    };
    const mp4 = {
        id: 'poster-mp4-same-01',
        title: 'Night Romance Kiss Love',
        category: 'Trending',
        type: 'video',
        url: 'https://cdn.example/media/poster-mp4-same-01.mp4',
        video_url: 'https://cdn.example/media/poster-mp4-same-01.mp4'
    };
    const step1 = mergeMediaInventory([], [poster]);
    assert(step1.length === 1, 'poster-only → one card');
    assert(step1[0].playable === false, 'poster-only not playable');
    assert(String(step1[0].posterUrl || '').includes('poster-mp4-same-01.jpg'), 'poster art present');

    const step2 = mergeMediaInventory(step1, [mp4]);
    assert(step2.length === 1, 'poster→MP4 → still one card');
    assert(step2[0].playable === true, 'poster→MP4 playable');
    assert(String(step2[0].mediaKind || step2[0].type) === 'video', 'mediaKind video');
    assert(String(step2[0].url || step2[0].video_url).includes('.mp4'), 'MP4 preferred media');
    assert(String(step2[0].posterUrl || step2[0].thumbnailUrl).includes('.jpg'), 'poster preserved');
}

// --- MP4 → poster enrichment ---
console.log('\n[MP4→poster enrichment]');
{
    const mp4 = {
        id: 'mp4-poster-same-02',
        title: 'Cyber Hack Action Fight',
        type: 'video',
        url: 'https://cdn.example/media/mp4-poster-same-02.mp4',
        video_url: 'https://cdn.example/media/mp4-poster-same-02.mp4',
        category: 'Trending'
    };
    const poster = {
        id: 'mp4-poster-same-02',
        title: 'Cyber Hack Action Fight',
        type: 'image',
        url: 'https://cdn.example/thumbs/mp4-poster-same-02.jpg',
        posterUrl: 'https://cdn.example/thumbs/mp4-poster-same-02.jpg'
    };
    const step1 = mergeMediaInventory([], [mp4]);
    assert(step1[0].playable === true, 'MP4-first playable');
    const step2 = mergeMediaInventory(step1, [poster]);
    assert(step2.length === 1, 'MP4→poster → one card');
    assert(step2[0].playable === true, 'still playable after poster');
    assert(String(step2[0].posterUrl || '').includes('.jpg'), 'poster attached as art');
    assert(String(step2[0].url || step2[0].video_url).includes('.mp4'), 'MP4 remains preferred');
}

// --- Temp key → durable replace ---
console.log('\n[temp→durable]');
{
    __resetCatalogTempKeySeqForTests();
    const orphan = {
        title: 'Orphan Still',
        type: 'image',
        url: 'https://cdn.example/thumbs/orphan-still-99.jpg',
        posterUrl: 'https://cdn.example/thumbs/orphan-still-99.jpg'
    };
    // Force temp by stripping durable URL path? URL is durable — use blob-only to force temp.
    const orphanTemp = {
        title: 'Orphan Still',
        type: 'image',
        url: 'blob:http://localhost/orphan',
        posterUrl: 'blob:http://localhost/orphan',
        _catalogTempKey: 'temp:test-orphan-1'
    };
    const withTemp = mergeMediaInventory([], [orphanTemp]);
    assert(withTemp.length === 1, 'temp card exists');
    assert(
        String(withTemp[0]._catalogTempKey || '').startsWith('temp:'),
        'temp key recorded in-memory'
    );

    const durable = {
        id: '33333333-3333-3333-3333-333333333333',
        title: 'Orphan Still',
        type: 'image',
        url: 'https://cdn.example/thumbs/orphan-still-99.jpg',
        posterUrl: 'https://cdn.example/thumbs/orphan-still-99.jpg',
        replacesTempKey: 'temp:test-orphan-1'
    };
    const upgraded = mergeMediaInventory(withTemp, [durable]);
    assert(upgraded.length === 1, 'temp absorbed into durable → one card');
    assert(upgraded[0].id === durable.id, 'durable id replaces temp');
    assert(!String(upgraded[0]._catalogTempKey || '').startsWith('temp:'), 'temp key cleared');
}

// --- Shared poster must not collapse distinct MP4s ---
console.log('\n[shared-poster identity]');
{
    const sharedPoster = 'https://cdn.example/thumbs/shared-art.jpg';
    const v1 = {
        id: 'video-aaaa-1111-1111-111111111111',
        type: 'video',
        title: 'Clip A',
        url: 'https://cdn.example/videos/video-aaaa.mp4',
        thumbnailUrl: sharedPoster,
        posterUrl: sharedPoster
    };
    const v2 = {
        id: 'video-bbbb-2222-2222-222222222222',
        type: 'video',
        title: 'Clip B',
        url: 'https://cdn.example/videos/video-bbbb.mp4',
        thumbnailUrl: sharedPoster,
        posterUrl: sharedPoster
    };
    const merged = mergeMediaInventory([], [v1, v2]);
    assert(merged.length === 2, 'two MP4s with same poster remain two cards');

    const ownPoster = mergeMediaInventory([], [
        {
            id: 'video-cccc-3333-3333-333333333333',
            type: 'video',
            url: 'https://cdn.example/videos/video-cccc.mp4',
            thumbnailUrl: 'https://cdn.example/thumbs/video-cccc.jpg'
        }
    ]);
    assert(ownPoster.length === 1, 'one MP4 with its poster remains one card');
    assert(String(ownPoster[0].posterUrl || ownPoster[0].thumbnailUrl).includes('video-cccc.jpg'), 'own poster attached');

    const noPoster = projectCatalogCard({
        id: 'video-dddd-4444-4444-444444444444',
        type: 'video',
        url: '/videos/video-dddd.mp4',
        mediaUrl: '/videos/video-dddd.mp4'
    });
    assert(
        !String(noPoster.posterUrl || '').includes('.mp4'),
        'missing video poster does not become posterUrl=video.mp4'
    );

    const idA = resolveCanonicalMediaIdentity(v1);
    const idB = resolveCanonicalMediaIdentity(v2);
    assert(idA.canonicalId !== idB.canonicalId, 'canonical ids differ for distinct videos');
    assert(idA.identityVia === 'assetId', 'video identity via assetId');
    assert(!sameCanonicalMediaIdentity(v1, v2), 'shared poster does not sameCanonicalMediaIdentity');

    const posterAsUrl = resolveCanonicalMediaIdentity({
        id: '',
        type: 'video',
        url: sharedPoster,
        video_url: 'https://cdn.example/videos/real.mp4',
        posterUrl: sharedPoster
    });
    assert(
        posterAsUrl.normalizedMediaUrl.includes('/videos/real.mp4') ||
            posterAsUrl.canonicalId.includes('real.mp4'),
        'video identity prefers playback URL over poster'
    );

    const viewer = resolveViewerMediaIdentities([v1, v2, {
        id: 'img-shared',
        type: 'image',
        url: sharedPoster,
        thumbnailUrl: sharedPoster
    }]);
    assert(viewer.canonical.filter((c) => c.kind === 'video').length === 2, 'viewer keeps two video identities');
}

// --- Classification (discovery only) ---
console.log('\n[classification]');
{
    assert(Boolean(DISCOVERY_SHELF_KEYWORDS.Romance?.length), 'shared Romance keywords');
    assert(detectShelfFromTitle('Viral Trending Hot Clip') === 'Trending', 'trending title');
    const romance = classifyContent({
        title: 'A love romance kiss story of soulmate destiny',
        category: 'Trending'
    });
    assert(romance.primaryCategory === 'Romance', 'soft Trending reclassified to Romance');
    assert(romance.classificationSource === 'keyword', 'keyword source');

    const explicit = classifyContent({
        title: 'Random Title',
        category: 'Suspense'
    });
    assert(explicit.primaryCategory === 'Suspense', 'explicit Suspense preserved');
    assert(explicit.classificationSource === 'metadata', 'metadata source for explicit');
}

// --- Distribution + empty rails ---
console.log('\n[distribution]');
{
    const cards = [
        projectCatalogCard(
            {
                id: 'r1',
                title: 'Love Romance Kiss Heart Soulmate',
                category: 'Trending',
                type: 'image',
                posterUrl: 'https://cdn.example/a.jpg',
                url: 'https://cdn.example/a.jpg'
            },
            { classification: classifyContent({ title: 'Love Romance Kiss Heart Soulmate', category: 'Trending' }) }
        ),
        projectCatalogCard(
            {
                id: 'c1',
                title: 'Cyber Hack Action Fight Mission Combat',
                category: 'Trending',
                type: 'video',
                url: 'https://cdn.example/c1.mp4',
                playable: true
            },
            {
                classification: classifyContent({
                    title: 'Cyber Hack Action Fight Mission Combat',
                    category: 'Trending'
                })
            }
        ),
        projectCatalogCard(
            {
                id: 't1',
                title: 'Morning Walk',
                category: 'Trending',
                type: 'video',
                url: 'https://cdn.example/t1.mp4',
                playable: true
            },
            { classification: classifyContent({ title: 'Morning Walk', category: 'Trending' }) }
        )
    ];

    const dist = distributeToShelves(cards, { allowSoftFallback: false });
    assert(dist.globalRealCount === 3, 'global real count 3');
    assert(dist.shelves.Romance.length >= 1, 'Romance gets genuine romance candidate');
    assert(dist.shelves['Cyber-Action'].length >= 1, 'Cyber-Action gets genuine candidate');
    assert(dist.shelves.Suspense.length === 0, 'Suspense empty — no artificial fill');
    assert(dist.omittedEmptyShelves.includes('Suspense'), 'Suspense listed as omitted empty');
    assert(dist.shelves.Trending.length >= 1, 'Trending remains populated');

    // No soft-fill of Suspense from unrelated inventory
    const softOff = distributeToShelves(
        [
            projectCatalogCard({
                id: 'only',
                title: 'Plain Clip',
                category: 'Trending',
                type: 'video',
                url: 'https://cdn.example/only.mp4',
                playable: true
            })
        ],
        { allowSoftFallback: false }
    );
    assert(softOff.shelves.Romance.length === 0, 'no fake Romance from unrelated');
    assert(softOff.shelves.Suspense.length === 0, 'no fake Suspense from unrelated');
    assert(softOff.shelves['Cyber-Action'].length === 0, 'no fake Cyber-Action from unrelated');
}

// --- Empty shelf presentation ---
console.log('\n[placeholders]');
{
    const withGlobal = fillShelfPresentation([], 'Romance', 5, { globalRealCount: 4 });
    assert(withGlobal.length === 0, 'empty Romance omitted when global inventory exists');

    const legacyEmpty = fillShelfPresentation([], 'Trending', 5);
    assert(legacyEmpty.length === 5, 'legacy empty-state still pads when no globalRealCount');
    assert(legacyEmpty.every((c) => c.isPresentationOnly), 'legacy pads are presentation-only');

    const withReal = fillShelfPresentation(
        [{ id: 'x', title: 'Real', url: '/v.mp4' }],
        'Trending',
        5,
        { globalRealCount: 1 }
    );
    assert(withReal.length === 1, 'real shelf not padded');
}

console.log('\n[trending-source-fallback]');
{
    const emptyIdentity = [];
    const feedVideos = [
        { id: 'v1', type: 'video', url: '/videos/v1.mp4', isPersonalVideo: true, category: 'Romance' }
    ];
    const picked = pickFirstListWithRealCards([emptyIdentity, feedVideos]);
    assert(picked.length === 1, 'empty identity array does not hide feed videos');

    const recovered = collectPlayableVideosFromFeedMap({
        Trending: [],
        Romance: feedVideos
    });
    assert(recovered.length === 1 && recovered[0].id === 'v1', 'Trending fallback collects playable videos from other shelves');

    const identityVideos = [
        { id: 'v1', type: 'video', url: '/videos/v1.mp4', thumbnailUrl: '/thumbs/v1.jpg' }
    ];
    const feedWithVaultStill = [
        ...identityVideos,
        {
            id: 'personal-thumb-vault-still-1',
            type: 'image',
            url: '/thumbs/still-1.jpg',
            isPersonalThumbnail: true,
            publishableImage: true
        }
    ];
    const merged = mergeMissingVaultImageCards(identityVideos, [feedWithVaultStill]);
    assert(
        merged.length === 2 && merged.some((r) => r.id === 'personal-thumb-vault-still-1'),
        'identity videos do not hide thumbnail vault stills'
    );

    const stillsOnly = [
        {
            id: 'personal-thumb-vault-still-1',
            type: 'image',
            url: '/thumbs/still-1.jpg',
            isPersonalThumbnail: true,
            publishableImage: true
        }
    ];
    const vaultMp4 = [
        { id: 'vault-mp4-1', type: 'video', url: '/videos/vault-mp4-1.mp4', isPersonalVideo: true }
    ];
    const withVaultVideo = mergeMissingPlayableVideos(stillsOnly, [vaultMp4]);
    assert(
        withVaultVideo.some((r) => r.id === 'vault-mp4-1') &&
            withVaultVideo.some((r) => r.id === 'personal-thumb-vault-still-1'),
        'Trending stills do not hide a vault MP4'
    );
}

// --- Rotation stability ---
console.log('\n[rotation]');
{
    const shelves = {
        Trending: [
            { id: 'a', playable: true, title: 'A' },
            { id: 'b', playable: false, title: 'B' },
            { id: 'c', playable: true, title: 'C' }
        ],
        Romance: [{ id: 'a', playable: true, title: 'A' }]
    };
    const seed = 'session-stable-seed-42';
    const r1 = applyShelfRotation(shelves, { sessionSeed: seed, shelfOrder: ['Trending', 'Romance'] });
    const r2 = applyShelfRotation(shelves, { sessionSeed: seed, shelfOrder: ['Trending', 'Romance'] });
    assert(
        JSON.stringify(r1.Trending.map((c) => c.id)) === JSON.stringify(r2.Trending.map((c) => c.id)),
        'same seed → same order'
    );
    assert(r1.Trending[0].playable === true, 'playable sorts ahead');
    assert(resolveRotationSeed(seed) === seed, 'explicit seed preserved');
}

// --- Project fields ---
console.log('\n[projection]');
{
    const card = projectCatalogCard({
        id: 'proj-1',
        title: 'Mystery Suspense Horror Fear Dark Twist',
        type: 'image',
        posterUrl: 'https://cdn.example/p.jpg',
        url: 'https://cdn.example/p.jpg',
        category: 'Trending'
    });
    assert(card.mediaKind === 'image', 'image mediaKind');
    assert(card.playable === false, 'image not playable');
    assert(card.posterUrl.includes('p.jpg'), 'posterUrl set');
    assert(typeof card.categoryConfidence === 'number', 'confidence present');
    assert(Array.isArray(card.categories), 'categories array');
}

// --- enrich helper ---
console.log('\n[enrich helper]');
{
    const e = enrichCatalogCard(
        {
            id: 'e1',
            type: 'image',
            url: 'https://cdn.example/e1.jpg',
            posterUrl: 'https://cdn.example/e1.jpg',
            category: 'Romance'
        },
        {
            id: 'e1',
            type: 'video',
            url: 'https://cdn.example/e1.mp4',
            category: 'Trending'
        }
    );
    assert(e.playable === true, 'enrich playable');
    assert(e.category === 'Romance', 'category preserved on soft reclassify incoming');
    assert(String(e.posterUrl).includes('.jpg'), 'poster kept');
}

// --- LIVE CONTENT display aliases never become feed keys ---
console.log('\n[shelf display aliases]');
{
    const aliases = { Romance: 'Love Stories' };
    syncCategoryAliasStore(aliases);
    assert(
        displayDiscoveryShelf('Romance', aliases) === 'Love Stories',
        'display alias for Romance'
    );
    assert(
        resolveCanonicalDiscoveryShelf('Love Stories', aliases) === 'Romance',
        'display label resolves to canonical Romance'
    );
    const reconciled = reconcileFeedToCanonicalShelves(
        {
            'Love Stories': [{ id: '1', title: 'A' }],
            Trending: [{ id: '2', title: 'B' }]
        },
        aliases
    );
    assert(Array.isArray(reconciled.Romance) && reconciled.Romance.length === 1, 'alias shelf folded into Romance');
    assert(reconciled.Romance[0].category === 'Romance', 'row.category stays canonical');
    assert(Array.isArray(reconciled.Trending) && reconciled.Trending.length === 1, 'Trending kept');
    assert(reconciled['Love Stories'] == null, 'display name is not a feed key');
    syncCategoryAliasStore({});
}

// --- Wiring source checks (no Hero/Theater/backend edits) ---
console.log('\n[wiring]');
{
    const buildSrc = read('src/lib/feed/buildHomeFeed.js');
    assert(buildSrc.includes('mergeMediaInventory'), 'buildHomeFeed merges inventory');
    assert(buildSrc.includes('projectCatalogCard'), 'buildHomeFeed projects cards');
    assert(buildSrc.includes('classifyContent'), 'buildHomeFeed classifies');
    assert(buildSrc.includes('distributeToShelves'), 'buildHomeFeed distributes');
    assert(buildSrc.includes('applyShelfRotation'), 'buildHomeFeed rotates');

    const agents = read('src/lib/viewer/contentAgents.js');
    assert(agents.includes('detectShelfFromTitle'), 'contentAgents uses shared classifier');
    assert(agents.includes('DISCOVERY_SHELF_KEYWORDS'), 'contentAgents shares keywords');

    const ui = read('src/components/vertical/ReelshortExperience.svelte');
    assert(ui.includes('shouldRenderShelf'), 'UI omits empty shelves');
    assert(ui.includes('globalRealCount'), 'UI passes globalRealCount');

    const heroIntel = read('src/lib/hero/heroIntelligence.js');
    assert(heroIntel.length > 100, 'Hero intelligence file untouched presence');
}

if (failed > 0) {
    console.error(`\nFAIL — ${failed} assertion(s)`);
    process.exit(1);
}
console.log('\nPASS — catalog-smart-population');
process.exit(0);
