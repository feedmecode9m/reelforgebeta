#!/usr/bin/env node
/**
 * Phase 6.5 — Viewer media identity + premium card intelligence repair.
 * No production mutations. No category / title / description writes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    classifyViewerImageArtifact,
    evaluateViewerImageDiscoveryEligibility,
    isUnsafeViewerCardTitle,
    logViewerMediaIdentityDiagnostics,
    resolveSafeViewerCardTitle,
    resolveViewerMediaIdentities
} from '../src/lib/feed/viewerMediaIdentity.js';
import { enrichSemanticCard } from '../src/lib/feed/semanticCardIntelligence.js';
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
        if (/category/i.test(url) || method === 'PATCH') categoryPatch += 1;
        if (/title/i.test(url)) titleWrites += 1;
        if (/description/i.test(url)) descriptionWrites += 1;
        throw new Error(`BLOCKED ${method}`);
    }
    return { ok: true, json: async () => [] };
};

const ARRIVAL_ID = '03ef898a-989f-42c3-bdbb-67f37338df65';
const IMG_0121_ID = 'caa1a16f-be03-4c2b-9840-9fce9a809c00';

const arrivalVideo = {
    id: ARRIVAL_ID,
    title: '01 ARRIVAL OPEN v1',
    name: '01 ARRIVAL OPEN v1',
    fileName: `${ARRIVAL_ID}.mp4`,
    type: 'video',
    category: 'Trending',
    url: `https://cdn.example/prod/${ARRIVAL_ID}.mp4`,
    thumbnailUrl: `https://cdn.example/thumbs/${ARRIVAL_ID}.jpg`
};

const img0121 = {
    id: IMG_0121_ID,
    title: 'IMG_0121.JPEG',
    name: 'IMG_0121.JPEG',
    fileName: `${IMG_0121_ID}.jpeg`,
    type: 'image',
    category: 'Trending',
    url: `https://cdn.example/thumbs/${IMG_0121_ID}.jpeg`,
    thumbnailUrl: `https://cdn.example/thumbs/${IMG_0121_ID}.jpeg`,
    isCatalogImage: true
};

const publishableStill = {
    id: 'pub-still-1',
    title: 'Downtown Night Market',
    type: 'image',
    category: 'Trending',
    url: 'https://cdn.example/thumbs/market.jpg',
    publishableImage: true,
    isCatalogImage: true
};

const placeholder = {
    id: 'presentation-placeholder-Trending-0',
    isPresentationOnly: true,
    layoutOnly: true,
    isPlaceholder: true,
    title: 'Coming Soon',
    category: 'Trending'
};

console.log('\n[phase-6-5-viewer-media-identity]');

console.log('\n[title safety]');
{
    assert(isUnsafeViewerCardTitle('IMG_0121.JPEG'), 'IMG_0121.JPEG unsafe');
    assert(isUnsafeViewerCardTitle(IMG_0121_ID), 'UUID title unsafe');
    assert(isUnsafeViewerCardTitle(`${IMG_0121_ID}.jpeg`), 'UUID filename unsafe');
    assert(isUnsafeViewerCardTitle('00192384'), 'numeric id unsafe');
    assert(!isUnsafeViewerCardTitle('01 ARRIVAL OPEN v1'), 'Arrival title safe');
    assert(resolveSafeViewerCardTitle(img0121) === '', 'unsafe image title → blank');
    assert(
        resolveSafeViewerCardTitle(arrivalVideo) === '01 ARRIVAL OPEN v1',
        'meaningful title preserved'
    );
    const enriched = enrichSemanticCard(img0121);
    assert(enriched.title === '', 'enrichSemanticCard blanks IMG title');
    const shell = buildViewerSemanticShell(img0121, {});
    assert(shell.title === '', 'viewer shell blanks IMG title');
}

console.log('\n[image discovery eligibility]');
{
    const art = classifyViewerImageArtifact(img0121);
    assert(art.artifact, `IMG_0121 classified artifact (${art.reason})`);
    const elig = evaluateViewerImageDiscoveryEligibility(img0121);
    assert(!elig.allow, `IMG_0121 not discovery-eligible (${elig.reason})`);

    const feedSrc = fs.readFileSync(path.join(root, 'src/lib/feed/buildHomeFeed.js'), 'utf8');
    assert(
        feedSrc.includes('evaluateViewerImageDiscoveryEligibility'),
        'buildHomeFeed wires Phase 6.5 image discovery gate'
    );
    assert(
        feedSrc.includes('image_not_publishable') || feedSrc.includes('publishable_image_card'),
        'buildHomeFeed publishable image card path present'
    );

    const pub = evaluateViewerImageDiscoveryEligibility(publishableStill);
    assert(pub.allow, 'explicit publishable image allowed');

    const vaultStill = {
        id: 'personal-thumb-vault-9d043773-3f19-4ee4-adbd-df3c2979dd64',
        title: 'IMG_0121.JPEG',
        fileName: 'IMG_0121.JPEG',
        type: 'image',
        url: '/thumbs/9d043773-3f19-4ee4-adbd-df3c2979dd64.jpg',
        isPersonalThumbnail: true,
        publishableImage: true
    };
    const vaultElig = evaluateViewerImageDiscoveryEligibility(vaultStill);
    assert(vaultElig.allow, `thumbnail vault still is discovery-eligible (${vaultElig.reason})`);
    assert(
        !classifyViewerImageArtifact(vaultStill).artifact,
        'published vault still is not a catalog artifact'
    );
}

console.log('\n[canonical identity resolution]');
{
    const resolved = resolveViewerMediaIdentities([arrivalVideo, img0121, publishableStill]);
    assert(resolved.diagnostics.canonicalVideos === 1, 'one canonical video');
    assert(
        resolved.suppressed.some((s) => s.assetId === IMG_0121_ID),
        'IMG_0121 suppressed as artifact'
    );
    assert(
        resolved.canonical.some((c) => c.kind === 'video' && String(c.reel.id) === ARRIVAL_ID),
        'Arrival is canonical video card'
    );
    assert(
        !resolved.canonical.some((c) => String(c.reel.id) === IMG_0121_ID),
        'IMG_0121 not a canonical card'
    );
    assert(
        resolved.canonical.some((c) => c.kind === 'image' && String(c.reel.id) === 'pub-still-1'),
        'publishable still remains'
    );

    const diag = logViewerMediaIdentityDiagnostics(
        [arrivalVideo, img0121],
        'phase-6-5-validator'
    );
    assert(diag.diagnostics.suppressedImageArtifacts >= 1, 'diagnostics report suppressed artifacts');
    assert(diag.diagnostics.canonicalVideos === 1, 'diagnostics report canonical video');
}

console.log('\n[viewer collect — one premium card]');
{
    const feed = {
        Trending: [arrivalVideo, img0121, placeholder],
        Romance: []
    };
    // Membership would previously admit IMG; identity layer must still suppress.
    const items = collectRealViewerReels(feed);
    assert(items.length === 1, `exactly one real viewer card (got ${items.length})`);
    assert(String(items[0].reel.id) === ARRIVAL_ID, 'canonical card is Arrival MP4');
    assert(items[0].resolvedMedia?.mediaSource === 'video', 'mediaSource=video');
    assert(
        Boolean(items[0].resolvedMedia?.poster || items[0].reel.thumbnailUrl),
        'poster/artwork present on video card'
    );
    assert(
        !items.some((i) => /img.?0121/i.test(String(i.reel.title || i.resolvedMedia?.title || ''))),
        'no IMG_0121 card title in viewer collect'
    );

    const vaultStill = {
        id: 'personal-thumb-vault-caa1a16f-be03-4c2b-9840-9fce9a809c00',
        title: 'IMG_0121.JPEG',
        fileName: 'IMG_0121.JPEG',
        type: 'image',
        url: '/thumbs/caa1a16f-be03-4c2b-9840-9fce9a809c00.jpg',
        thumbnailUrl: '/thumbs/caa1a16f-be03-4c2b-9840-9fce9a809c00.jpg',
        isPersonalThumbnail: true,
        publishableImage: true,
        category: 'Trending'
    };
    const withVault = collectRealViewerReels({
        Trending: [arrivalVideo, img0121, vaultStill, placeholder],
        Romance: []
    });
    assert(
        withVault.some((i) => String(i.reel.id) === vaultStill.id),
        'thumbnail vault still remains a viewer card beside Arrival'
    );
    assert(
        withVault.some((i) => String(i.reel.id) === ARRIVAL_ID),
        'Arrival video remains beside vault still'
    );
}

console.log('\n[cinematic shell preserved]');
{
    const shell = buildViewerSemanticShell(arrivalVideo, { category: 'Trending' });
    assert(shell.aspectRatio === '16:9', '16:9 landscape');
    assert(shell.presentationCssClass, 'presentation theme class');
    assert(shell.mediaType === 'video' || shell.resolvedMedia?.mediaSource === 'video', 'video media');
    assert(shell.inventedDescription === false, 'no invented description');
    assert(shell.categoryWritten === false, 'no category write');
}

assert(fetchMutations === 0, 'mutation attempts = 0');
assert(categoryPatch === 0, 'category PATCH = 0');
assert(titleWrites === 0, 'title writes = 0');
assert(descriptionWrites === 0, 'description writes = 0');

const reportPath = path.join(root, 'artifacts', 'phase-6-5-viewer-media-identity-report.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(
    reportPath,
    JSON.stringify(
        {
            phase: 'PHASE-6-5-VIEWER-MEDIA-IDENTITY',
            status: failed === 0 ? 'IMPLEMENTATION_COMPLETE_NO_DEPLOY' : 'FAIL',
            expected: 'one premium card; thumbnail as artwork only',
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
console.log('\nPASS — phase-6-5-viewer-media-identity');
process.exit(0);
