#!/usr/bin/env node
/**
 * Phase 6.5 — Release Candidate browser validation (local, production-shaped catalog).
 * No deploy. No production mutations.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import {
    classifyViewerImageArtifact,
    evaluateViewerImageDiscoveryEligibility,
    isUnsafeViewerCardTitle,
    resolveSafeViewerCardTitle,
    resolveViewerMediaIdentities
} from '../src/lib/feed/viewerMediaIdentity.js';
import { collectRealViewerReels } from '../src/lib/feed/viewerSemanticShell.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const ARTIFACTS = path.join(root, 'artifacts');

const ARRIVAL_ID = '03ef898a-989f-42c3-bdbb-67f37338df65';
const IMG_0121_ID = 'caa1a16f-be03-4c2b-9840-9fce9a809c00';
const ARRIVAL_2_ID = '23ff2e1d-be6f-4490-aba8-1ebedd0ffb29';
const UUID_PNG_ID = 'e1f08f0f-954f-4c39-848b-9f3fc72b5d02';

/** Production-shaped catalog (Railway /api/reels shapes). */
const PRODUCTION_SHAPED_CATALOG = [
    {
        id: ARRIVAL_2_ID,
        title: null,
        name: '02 ARRIVAL THE PROJECT INTRO v1',
        fileName: `${ARRIVAL_2_ID}.mp4`,
        type: 'video',
        category: 'Trending',
        url: `https://pub-cb178488b1d4413988778e56a7d51439.r2.dev/prod/${ARRIVAL_2_ID}.mp4`,
        thumbnailUrl: `https://strong-lolly-a9fcb4.netlify.app/thumbs/${ARRIVAL_2_ID}.jpg`,
        status: 'ready'
    },
    {
        id: ARRIVAL_ID,
        title: null,
        name: '01 ARRIVAL OPEN v1',
        fileName: `${ARRIVAL_ID}.mp4`,
        type: 'video',
        category: 'Trending',
        url: `https://pub-cb178488b1d4413988778e56a7d51439.r2.dev/prod/${ARRIVAL_ID}.mp4`,
        thumbnailUrl: `https://strong-lolly-a9fcb4.netlify.app/thumbs/${ARRIVAL_ID}.jpg`,
        status: 'ready'
    },
    {
        id: IMG_0121_ID,
        title: null,
        name: 'IMG_0121.JPEG',
        fileName: `${IMG_0121_ID}.jpeg`,
        type: 'image',
        category: 'Trending',
        url: `https://strong-lolly-a9fcb4.netlify.app/thumbs/${IMG_0121_ID}.jpeg`,
        thumbnailUrl: `https://strong-lolly-a9fcb4.netlify.app/thumbs/${IMG_0121_ID}.jpeg`,
        status: 'ready'
    },
    {
        id: UUID_PNG_ID,
        title: null,
        name: '94E28916-619A-4356-88E7-90D1C71CAC2D.PNG',
        fileName: `${UUID_PNG_ID}.png`,
        type: 'image',
        category: 'Trending',
        url: `https://strong-lolly-a9fcb4.netlify.app/thumbs/${UUID_PNG_ID}.png`,
        thumbnailUrl: `https://strong-lolly-a9fcb4.netlify.app/thumbs/${UUID_PNG_ID}.png`,
        status: 'ready'
    }
];

let failed = 0;
function assert(cond, label) {
    if (cond) console.log(`  ✓ ${label}`);
    else {
        failed += 1;
        console.error(`  ✗ ${label}`);
    }
}

console.log('\n[phase-6-5-release-candidate]');

console.log('\n[unit — production-shaped identity]');
{
    const identities = resolveViewerMediaIdentities(PRODUCTION_SHAPED_CATALOG);
    assert(identities.diagnostics.canonicalVideos === 2, `canonical videos=2 (got ${identities.diagnostics.canonicalVideos})`);
    assert(
        identities.suppressed.some((s) => s.assetId === IMG_0121_ID),
        'IMG_0121 suppressed'
    );
    assert(
        identities.suppressed.some((s) => s.assetId === UUID_PNG_ID),
        'UUID PNG suppressed'
    );
    assert(
        !identities.canonical.some((c) => String(c.reel.id) === IMG_0121_ID),
        'IMG_0121 not canonical card'
    );

    const imgArt = classifyViewerImageArtifact(
        PRODUCTION_SHAPED_CATALOG.find((r) => r.id === IMG_0121_ID)
    );
    assert(imgArt.artifact, `IMG artifact reason=${imgArt.reason}`);
    assert(
        !evaluateViewerImageDiscoveryEligibility(
            PRODUCTION_SHAPED_CATALOG.find((r) => r.id === IMG_0121_ID)
        ).allow,
        'IMG not discovery-eligible'
    );

    const arrival = PRODUCTION_SHAPED_CATALOG.find((r) => r.id === ARRIVAL_ID);
    assert(
        resolveSafeViewerCardTitle(arrival) === '01 ARRIVAL OPEN v1',
        'Arrival name is safe title'
    );
    assert(isUnsafeViewerCardTitle('IMG_0121.JPEG'), 'IMG_0121.JPEG blocked');
    assert(isUnsafeViewerCardTitle(UUID_PNG_ID), 'UUID blocked');
    assert(resolveSafeViewerCardTitle({ name: 'IMG_0121.JPEG' }) === '', 'unsafe → empty');

    const feedMap = {
        Trending: PRODUCTION_SHAPED_CATALOG,
        Romance: [],
        'Cyber-Action': [],
        Suspense: []
    };
    const collected = collectRealViewerReels(feedMap);
    assert(collected.length === 2, `viewer collect cards=2 videos only (got ${collected.length})`);
    assert(
        collected.every((c) => c.resolvedMedia?.mediaSource === 'video'),
        'all collected cards are video mediaSource'
    );
    assert(
        !collected.some((c) => /img.?0121/i.test(String(c.reel.name || c.reel.title || ''))),
        'no IMG_0121 in collected cards'
    );
}

const port = Number(process.env.PHASE65_RC_PORT || 5199);
const server = await createServer({
    root,
    logLevel: 'error',
    server: { host: '127.0.0.1', port, strictPort: true }
});
await server.listen();
const frontendUrl =
    server.resolvedUrls?.local?.[0]?.replace(/\/$/, '') || `http://127.0.0.1:${port}`;
console.log(`\n[browser] ${frontendUrl}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
const identityLogs = [];
page.on('pageerror', (err) => pageErrors.push(String(err?.message || err).slice(0, 300)));
page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[VIEWER_MEDIA_IDENTITY]') || text.includes('VIEWER_MEDIA_IDENTITY')) {
        identityLogs.push(text.slice(0, 2000));
    }
});

let categoryPatch = 0;
let titleWrites = 0;
let descriptionWrites = 0;
let catalogWrites = 0;

await page.route(
    (url) => {
        try {
            return new URL(url).pathname.startsWith('/api/');
        } catch {
            return false;
        }
    },
    async (route) => {
        const req = route.request();
        const method = req.method().toUpperCase();
        const pathname = new URL(req.url()).pathname;
        if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
            if (/\/reels/i.test(pathname) && method !== 'GET') catalogWrites += 1;
            if (method === 'PATCH' && /categor/i.test(pathname)) categoryPatch += 1;
            if (/title/i.test(pathname)) titleWrites += 1;
            if (/description/i.test(pathname)) descriptionWrites += 1;
            await route.fulfill({
                status: 403,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'blocked_in_rc' })
            });
            return;
        }
        if (pathname === '/api/reels') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(PRODUCTION_SHAPED_CATALOG)
            });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, items: [], events: [] })
        });
    }
);

await page.addInitScript(
    ({ imgId, uuidId, catalog }) => {
        try {
            localStorage.clear();
            // Realistic hard-reset path: vault membership would previously admit images.
            localStorage.setItem(
                'personal_thumbnail_reel_ids',
                JSON.stringify([imgId, uuidId])
            );
            localStorage.setItem('personal_thumbnails', JSON.stringify([]));
            localStorage.setItem('personal_video_vault', JSON.stringify([]));
            localStorage.setItem('reelforge_feed', JSON.stringify({}));
            window.__PHASE65_RC_CATALOG__ = catalog;
        } catch {
            /* ignore */
        }
    },
    {
        imgId: IMG_0121_ID,
        uuidId: UUID_PNG_ID,
        catalog: PRODUCTION_SHAPED_CATALOG
    }
);

await page.goto(frontendUrl, { waitUntil: 'networkidle', timeout: 90000 });
await page.waitForTimeout(3500);

// Prefer audience viewer surface
const viewerNav = page.locator(
    '[data-nav="viewer"], [data-view="viewer"], button:has-text("Viewer"), a:has-text("Viewer")'
);
if ((await viewerNav.count()) > 0) {
    await viewerNav.first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(2000);
}

const cards = page.locator('[data-viewer-semantic-card]');
await cards.first().waitFor({ timeout: 20000 }).catch(() => {});
const cardCount = await cards.count();

const cardProbe = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-viewer-semantic-card]')];
    return nodes.map((el) => ({
        assetId: el.getAttribute('data-asset-id') || el.getAttribute('data-reel-id') || '',
        mediaType: el.getAttribute('data-media-type') || '',
        mediaSource: el.getAttribute('data-media-source') || '',
        posterUrl: el.getAttribute('data-poster-url') || '',
        title:
            el.querySelector('[data-viewer-sem-title-overlay], [data-viewer-sem-title]')
                ?.textContent?.trim() || '',
        aria: el.getAttribute('aria-label') || ''
    }));
});

const arrivalOpenCards = cardProbe.filter((c) => c.assetId === ARRIVAL_ID);
const arrivalOpenUnique = new Set(arrivalOpenCards.map((c) => c.assetId));
const uniqueAssetIds = [...new Set(cardProbe.map((c) => c.assetId).filter(Boolean))];
const imgCards = cardProbe.filter(
    (c) =>
        c.assetId === IMG_0121_ID ||
        /img.?0121/i.test(c.title) ||
        /img.?0121/i.test(c.aria)
);
const uuidTitleLeak = cardProbe.filter(
    (c) =>
        /[0-9a-f]{8}-[0-9a-f]{4}-/i.test(c.title) ||
        /^img[_\s-]?\d+/i.test(c.title) ||
        /\.(jpe?g|png|mp4)$/i.test(c.title)
);

console.log('\n[browser — cards]');
assert(cardCount >= 1, `semantic cards rendered (got ${cardCount})`);
assert(
    uniqueAssetIds.length === 2,
    `unique discovery identities=2 videos (got ${uniqueAssetIds.length}: ${uniqueAssetIds.join(',')})`
);
assert(
    arrivalOpenUnique.size === 1 && arrivalOpenCards.length >= 1,
    `Arrival OPEN identity once (domInstances=${arrivalOpenCards.length}, unique=${arrivalOpenUnique.size})`
);
assert(imgCards.length === 0, `IMG_0121 not a discovery card (got ${imgCards.length})`);
assert(
    arrivalOpenCards[0]?.mediaSource === 'video' || arrivalOpenCards[0]?.mediaType === 'video',
    `Arrival mediaSource/type video (got ${arrivalOpenCards[0]?.mediaSource || arrivalOpenCards[0]?.mediaType})`
);
assert(
    Boolean(arrivalOpenCards[0]?.posterUrl) &&
        /03ef898a|thumbs/i.test(arrivalOpenCards[0].posterUrl),
    'Arrival has poster artwork URL'
);
assert(
    /01 ARRIVAL OPEN/i.test(arrivalOpenCards[0]?.title || arrivalOpenCards[0]?.aria || ''),
    'Arrival shows meaningful title'
);
assert(uuidTitleLeak.length === 0, `no UUID/IMG/filename title leakage (got ${uuidTitleLeak.length})`);

const screenshotPath = path.join(ARTIFACTS, 'phase-6-5-rc-viewer.png');
fs.mkdirSync(ARTIFACTS, { recursive: true });
await page.screenshot({ path: screenshotPath, fullPage: true });
console.log(`  · screenshot ${screenshotPath}`);

assert(categoryPatch === 0, 'category PATCH = 0');
assert(titleWrites === 0, 'title writes = 0');
assert(descriptionWrites === 0, 'description writes = 0');
assert(catalogWrites === 0, 'production catalog writes = 0');
assert(pageErrors.length === 0, `uncaught exceptions = 0 (got ${pageErrors.length})`);

const identities = resolveViewerMediaIdentities(PRODUCTION_SHAPED_CATALOG);
const report = {
    phase: 'PHASE-6-5-RELEASE-CANDIDATE',
    status: failed === 0 ? 'PASS' : 'FAIL',
    frontendUrl,
    cardCount,
    uniqueAssetIds,
    cards: cardProbe,
    arrivalOpenDomInstances: arrivalOpenCards.length,
    arrivalOpenUniqueIdentities: arrivalOpenUnique.size,
    img0121Cards: imgCards.length,
    suppressedArtifacts: identities.suppressed,
    diagnostics: identities.diagnostics,
    identityLogs: identityLogs.slice(0, 5),
    mutations: {
        categoryPatch,
        titleWrites,
        descriptionWrites,
        catalogWrites
    },
    screenshot: 'frontend/artifacts/phase-6-5-rc-viewer.png',
    uploadLifecycle: 'DEFERRED_TO_PHASE63_BROWSER',
    deploy: 0
};

fs.writeFileSync(
    path.join(ARTIFACTS, 'phase-6-5-release-candidate.json'),
    JSON.stringify(report, null, 2)
);
console.log(`  · wrote ${path.join(ARTIFACTS, 'phase-6-5-release-candidate.json')}`);

await browser.close();
await server.close();

if (failed > 0) {
    console.error(`\nFAIL — phase-6-5-release-candidate (${failed})`);
    process.exit(1);
}
console.log('\nPASS — phase-6-5-release-candidate');
process.exit(0);
