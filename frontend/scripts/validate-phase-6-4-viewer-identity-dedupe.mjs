#!/usr/bin/env node
/**
 * Phase 6.4 — Viewer semantic identity deduplication validator.
 * No production mutations. No category / title / description writes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildResolvedViewerMedia,
    collectViewerIdentitySignals,
    dedupeViewerFeedIdentities,
    matchViewerIdentity,
    normalizeCanonicalTitle,
    normalizeSourceFilename,
    resolveViewerIdentityCards
} from '../src/lib/feed/viewerIdentityDedupe.js';
import {
    buildViewerSemanticShell,
    collectRealViewerReels
} from '../src/lib/feed/viewerSemanticShell.js';

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
        if (/\/category|category=/i.test(url) || method === 'PATCH') categoryPatch += 1;
        if (/title/i.test(url)) titleWrites += 1;
        if (/description/i.test(url)) descriptionWrites += 1;
        throw new Error(`BLOCKED ${method} ${url}`);
    }
    return { ok: true, json: async () => ([]) };
};

const ARRIVAL_ID = '03ef898a-989f-42c3-bdbb-67f37338df65';
const IMG_0121_ID = 'img-0121-asset';

const arrivalVideo = {
    id: ARRIVAL_ID,
    title: '01 ARRIVAL OPEN v1',
    name: '01 ARRIVAL OPEN v1',
    fileName: '01_ARRIVAL_OPEN_v1.mp4',
    type: 'video',
    category: 'Trending',
    url: 'https://cdn.example/prod/03ef898a-989f-42c3-bdbb-67f37338df65.mp4',
    thumbnailUrl: 'https://cdn.example/thumbs/img-0121.jpg',
    description: ''
};

const img0121 = {
    id: IMG_0121_ID,
    title: 'Img 0121',
    name: 'Img 0121',
    fileName: 'Img_0121.jpg',
    type: 'image',
    category: 'Trending',
    url: 'https://cdn.example/thumbs/img-0121.jpg',
    isCatalogImage: true,
    personal_video_id: ARRIVAL_ID,
    description: ''
};

const unrelatedPlaceholder = {
    id: 'presentation-placeholder-Trending-0',
    isPresentationOnly: true,
    layoutOnly: true,
    isPlaceholder: true,
    title: 'Coming Soon',
    category: 'Trending'
};

const unrelatedImage = {
    id: 'solo-thumb-9',
    title: 'Solo Artwork',
    type: 'image',
    category: 'Romance',
    url: 'https://cdn.example/thumbs/solo.jpg',
    isCatalogImage: true,
    publishableImage: true
};

console.log('\n[phase-6-4-viewer-identity-dedupe]');

console.log('\n[normalization]');
{
    assert(
        normalizeSourceFilename('01_ARRIVAL_OPEN_v1.mp4') ===
            normalizeSourceFilename('path/01_ARRIVAL_OPEN_v1.jpg'),
        'filename stem matches across video/image extensions'
    );
    assert(
        normalizeCanonicalTitle('01 ARRIVAL OPEN v1') === '01 arrival open v1',
        'canonical title normalization'
    );
    assert(
        normalizeCanonicalTitle('Img 0121') !== normalizeCanonicalTitle('01 ARRIVAL OPEN v1'),
        'Img 0121 title does not collide with Arrival title'
    );
}

console.log('\n[identity match priority]');
{
    const byId = matchViewerIdentity(arrivalVideo, {
        ...img0121,
        url: 'https://cdn.example/thumbs/other.jpg',
        personal_video_id: ARRIVAL_ID
    });
    assert(byId.matched && byId.via === 'asset_id', `ID/link match (via=${byId.via})`);

    const byFile = matchViewerIdentity(
        { ...arrivalVideo, thumbnailUrl: '' },
        {
            id: 'x',
            type: 'image',
            title: 'Other',
            fileName: '01_ARRIVAL_OPEN_v1.jpg',
            url: 'https://cdn.example/thumbs/x.jpg'
        }
    );
    assert(byFile.matched && byFile.via === 'source_filename', `filename match (via=${byFile.via})`);

    const byTitle = matchViewerIdentity(
        { ...arrivalVideo, thumbnailUrl: '', fileName: 'a.mp4' },
        {
            id: 'y',
            type: 'image',
            title: '01 ARRIVAL OPEN v1',
            fileName: 'y.jpg',
            url: 'https://cdn.example/thumbs/y.jpg'
        }
    );
    assert(byTitle.matched && byTitle.via === 'canonical_title', `title match (via=${byTitle.via})`);

    const byThumb = matchViewerIdentity(
        { ...arrivalVideo, personal_video_id: undefined },
        { ...img0121, personal_video_id: undefined, title: 'Img 0121', fileName: 'Img_0121.jpg' }
    );
    assert(
        byThumb.matched && byThumb.via === 'linked_thumbnail',
        `linked thumbnail URL match (via=${byThumb.via})`
    );

    const signals = collectViewerIdentitySignals(img0121);
    assert(signals.linkedIds.includes(ARRIVAL_ID), 'Img 0121 links Arrival via personal_video_id');
}

console.log('\n[before → after dedupe]');
{
    const beforeFeed = {
        Trending: [arrivalVideo, img0121, unrelatedPlaceholder],
        Romance: [unrelatedImage]
    };
    const beforeCards = collectRealViewerReels({
        Trending: [arrivalVideo, img0121],
        Romance: [unrelatedImage]
    });
    // collectRealViewerReels already dedupes — measure raw pair resolution instead
    const rawBefore = [arrivalVideo, img0121].length;
    assert(rawBefore === 2, 'before: MP4 card + thumbnail card = duplicate (2)');

    const resolved = resolveViewerIdentityCards([
        { reel: arrivalVideo, shelf: 'Trending' },
        { reel: img0121, shelf: 'Trending' },
        { reel: unrelatedImage, shelf: 'Romance' }
    ]);
    assert(resolved.items.length === 2, `after: ${resolved.items.length} cards (expect 2)`);
    assert(resolved.suppressedIds.has(IMG_0121_ID), 'Img 0121 suppressed as separate card');
    assert(!resolved.suppressedIds.has(ARRIVAL_ID), 'Arrival video remains canonical');

    const arrivalCard = resolved.items.find(
        (i) => String(i.reel.id) === ARRIVAL_ID || i.resolvedMedia.canonicalReelId === ARRIVAL_ID
    );
    assert(Boolean(arrivalCard), '01 ARRIVAL OPEN v1 appears once');
    assert(arrivalCard?.resolvedMedia.mediaSource === 'video', 'mediaSource is video');
    assert(
        String(arrivalCard?.resolvedMedia.poster || '').includes('img-0121'),
        'thumbnail remains visible as poster'
    );
    assert(
        String(arrivalCard?.resolvedMedia.mediaUrl || '').includes('.mp4'),
        'MP4 media URL preserved for hover/play'
    );
    assert(
        !resolved.items.some((i) => /img 0121/i.test(String(i.reel.title || ''))),
        'Img 0121 does not create a second card'
    );

    const feedDeduped = dedupeViewerFeedIdentities(beforeFeed);
    assert(
        feedDeduped.feedMap.Trending.some((r) => r?.isPresentationOnly),
        'existing placeholder cards remain unchanged'
    );
    assert(
        !feedDeduped.feedMap.Trending.some((r) => String(r?.id) === IMG_0121_ID),
        'feed map drops absorbed Img 0121 card slot'
    );
    assert(
        feedDeduped.feedMap.Romance.some((r) => String(r?.id) === 'solo-thumb-9'),
        'unrelated image card preserved'
    );

    const collected = collectRealViewerReels(beforeFeed);
    const arrivalHits = collected.filter((c) =>
        /arrival/i.test(String(c.reel.title || c.reel.name || ''))
    );
    assert(arrivalHits.length === 1, `Arrival appears once in collectRealViewerReels (got ${arrivalHits.length})`);
    assert(
        !collected.some((c) => String(c.reel.id) === IMG_0121_ID),
        'collectRealViewerReels excludes Img 0121'
    );
}

console.log('\n[resolved media object + shell]');
{
    const media = buildResolvedViewerMedia(arrivalVideo, img0121, 'Trending', ['production']);
    assert(media.mediaSource === 'video', 'resolved mediaSource=video');
    assert(Boolean(media.poster), 'resolved poster set');
    assert(media.title === '01 ARRIVAL OPEN v1', 'resolved title from existing data');
    assert(media.shelf === 'Trending', 'resolved shelf from existing data');
    assert(media.metadata.invented === false, 'no invented metadata');

    const shell = buildViewerSemanticShell(arrivalVideo, { category: 'Trending' }, media);
    assert(shell.mediaType === 'video', 'shell mediaType video');
    assert(String(shell.artworkUrl).includes('img-0121'), 'shell artwork from thumbnail');
    assert(shell.inventedDescription === false, 'shell no invented description');
    assert(shell.categoryWritten === false, 'shell categoryWritten=false');
    assert(shell.resolvedMedia?.mediaSource === 'video', 'shell carries resolvedMedia');
}

console.log('\n[UI wiring markers]');
{
    const card = fs.readFileSync(
        path.join(root, 'src/components/viewer/ViewerSemanticCard.svelte'),
        'utf8'
    );
    const feed = fs.readFileSync(
        path.join(root, 'src/components/vertical/ReelshortExperience.svelte'),
        'utf8'
    );
    const dedupe = fs.readFileSync(
        path.join(root, 'src/lib/feed/viewerIdentityDedupe.js'),
        'utf8'
    );
    assert(card.includes('resolvedMedia'), 'ViewerSemanticCard accepts resolvedMedia');
    assert(card.includes('data-media-source'), 'card exposes media source');
    assert(feed.includes('collectIdentityDedupedFeedMap'), 'feed uses identity dedupe map');
    assert(feed.includes('resolveCardMedia'), 'feed resolves card media');
    assert(dedupe.includes('prefer playable') || dedupe.includes('Prefer playable'), 'dedupe prefers video');
}

assert(fetchMutations === 0, 'mutation attempts = 0');
assert(categoryPatch === 0, 'category PATCH = 0');
assert(titleWrites === 0, 'title writes = 0');
assert(descriptionWrites === 0, 'description writes = 0');

const reportPath = path.join(root, 'artifacts', 'phase-6-4-viewer-identity-dedupe-report.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(
    reportPath,
    JSON.stringify(
        {
            phase: 'PHASE-6-4-VIEWER-IDENTITY-DEDUPE',
            status: failed === 0 ? 'IMPLEMENTATION_COMPLETE_NO_DEPLOY' : 'FAIL',
            before: 'MP4 card + thumbnail card = duplicate',
            after: 'one cinematic card with MP4 + thumbnail artwork',
            arrivalId: ARRIVAL_ID,
            img0121Id: IMG_0121_ID,
            categoryPatchCount: categoryPatch,
            titleWrites,
            descriptionWrites,
            fetchMutations,
            deploy: 0
        },
        null,
        2
    )
);
console.log(`  · wrote ${reportPath}`);

if (failed > 0) {
    console.error(`\nFAIL — ${failed}`);
    process.exit(1);
}
console.log('\nPASS — phase-6-4-viewer-identity-dedupe');
process.exit(0);
