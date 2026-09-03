#!/usr/bin/env node
/**
 * Thumbnail Vault poster assignment target resolution.
 *
 * Proves Club Poom Poom poster targets canonical Vic G E02, not inferred shell.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { get } from 'svelte/store';
import { chromium } from 'playwright';
import { unlockStudioWithHeroSection } from '../tests/helpers/studio-navigation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const FRONTEND = process.env.REELFORGE_URL || 'http://127.0.0.1:5173';
const BACKEND = process.env.REELFORGE_BACKEND_URL || 'http://127.0.0.1:8080';

const CLUB_REEL = 'cadfcabc-1947-4341-86a3-f82a08e78669';
const VIC_G_E02 = 'ep-vic-g-s01e02';
const INFERRED_EP = 'ep-03-club-poom-poom-s01e01-v1';
const VIC_G_ID = 'series-vic-g';
const INFERRED_SERIES = 'series-03-club-poom-poom';
const POSTER_IMAGE_ID = '00e876a4-66de-453e-949c-7b86ca6c908f';
const POSTER_URL = `/thumbs/${POSTER_IMAGE_ID}.jpeg`;
const SSR_POSTER_URL = '/thumbs/poster-target-test-00e876a4.jpeg';

const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else console.log(`  ok: ${msg}`);
}

const bag = new Map();
globalThis.localStorage = {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => bag.set(String(k), String(v)),
    removeItem: (k) => bag.delete(k),
    clear: () => bag.clear()
};
globalThis.window = {
    localStorage: globalThis.localStorage,
    location: { hostname: '127.0.0.1', href: `${FRONTEND}/` },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true
};

/** @param {unknown} body @param {number} status */
function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
    };
}

/** @param {import('../src/lib/series/seriesTypes.js').Series[]} catalog */
function clubCatalogFixture() {
    return [
        {
            id: VIC_G_ID,
            title: 'Vic G',
            tags: ['creator-package', 'creator-confirmed'],
            seasons: [
                {
                    seasonId: 'season-vic-g-1',
                    seasonNumber: 1,
                    title: 'Season 1',
                    episodes: [
                        {
                            episodeId: 'ep-vic-g-s01e01',
                            episodeNumber: 1,
                            title: 'E1',
                            status: 'published',
                            reelId: '03ef898a-989f-42c3-bdbb-67f37338df65'
                        },
                        {
                            episodeId: VIC_G_E02,
                            episodeNumber: 2,
                            title: '03 CLUB POOM POOM V1',
                            status: 'published',
                            reelId: CLUB_REEL,
                            tags: ['creator-package']
                        },
                        {
                            episodeId: 'ep-vic-g-s01e03',
                            episodeNumber: 3,
                            title: 'E3',
                            status: 'published',
                            reelId: '3894107e-ae44-43c5-af72-b3f5d5e0ad90'
                        }
                    ]
                }
            ]
        },
        {
            id: INFERRED_SERIES,
            title: '03 CLUB POOM POOM',
            tags: ['vault-inferred'],
            seasons: [
                {
                    seasonId: 'season-03-club-poom-poom-1',
                    seasonNumber: 1,
                    title: 'Season 1',
                    episodes: [
                        {
                            episodeId: INFERRED_EP,
                            episodeNumber: 1,
                            title: '03 CLUB POOM POOM V1',
                            status: 'ready',
                            thumbnailUrl: '/thumbs/wrong-shell-poster.jpeg'
                        }
                    ]
                }
            ]
        }
    ];
}

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});

try {
    const posterAssignment = await vite.ssrLoadModule('/src/lib/studio/episodePosterAssignment.js');
    const store = await vite.ssrLoadModule('/src/lib/series/seriesStore.js');
    const posterResolver = await vite.ssrLoadModule('/src/lib/series/viewerEpisodePoster.js');
    const adminSession = await vite.ssrLoadModule('/src/lib/adminSession.js');
    const vicG = await vite.ssrLoadModule('/src/lib/series/vicGSeriesPackage.js');

    console.log('\n[A–B] resolvePosterAssignmentTarget — Club Poom Poom → Vic G E02');
    store.resetSeriesCatalogEmpty?.();
    store.applyAuthoritativeApiCatalog(clubCatalogFixture());

    const thumbnailEntry = {
        id: 'poster-image-uuid-not-reel',
        name: '03 CLUB POOM POOM V1',
        url: SSR_POSTER_URL
    };
    const videoAssets = [{ id: CLUB_REEL, name: '03 CLUB POOM POOM V1', title: '03 CLUB POOM POOM V1' }];
    const target = posterAssignment.resolvePosterAssignmentTarget(thumbnailEntry, {
        videoAssets
    });

    assert(target?.episodeId === VIC_G_E02, `target episode is ${VIC_G_E02} (got ${target?.episodeId})`);
    assert(target?.seriesId === VIC_G_ID, `target series is ${VIC_G_ID} (got ${target?.seriesId})`);
    assert(target?.reelId === CLUB_REEL, `target reel unchanged (${target?.reelId})`);
    assert(target?.episodeId !== INFERRED_EP, 'inferred shell is NOT selected');

    console.log('\n[C–F] assignEpisodePoster + hydrate on canonical target');
    /** @type {Record<string, unknown> | null} */
    let capturedPut = null;

    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
        const href = String(url);
        const method = options.method || 'GET';
        if (href.includes('/api/series/status')) return jsonResponse({ enabled: true, count: 2 });
        if (href.includes('/api/series') && method === 'GET' && !href.includes('/api/series/')) {
            return jsonResponse({ series: clubCatalogFixture() });
        }
        if (href.includes(`/api/episodes/${encodeURIComponent(VIC_G_E02)}`) && method === 'PUT') {
            capturedPut = JSON.parse(String(options.body || '{}'));
            return jsonResponse({ ok: true });
        }
        return nativeFetch ? nativeFetch(url, options) : jsonResponse({}, 404);
    };

    adminSession.setAdminSessionToken('test-admin-token');
    const vicBefore = vicG.buildVicGSeriesPackage();

    const assignResult = await store.assignEpisodePoster(VIC_G_E02, SSR_POSTER_URL);
    assert(assignResult.ok === true, 'assignEpisodePoster succeeds on canonical target');
    assert(assignResult.reelId === CLUB_REEL, 'reelId unchanged after assign');
    assert(capturedPut?.thumbnailUrl === SSR_POSTER_URL, 'PUT includes thumbnailUrl');
    assert(!('reelId' in (capturedPut || {})), 'PUT omits reelId drift');

    store.resetSeriesCatalogEmpty?.();
    store.applyAuthoritativeApiCatalog(clubCatalogFixture());
    store.updateCatalogEpisode(VIC_G_E02, { thumbnailUrl: SSR_POSTER_URL });

    const inferred = store.getEpisodeById(INFERRED_EP);
    assert(
        inferred?.episode?.thumbnailUrl === '/thumbs/wrong-shell-poster.jpeg',
        'inferred shell thumbnailUrl unchanged'
    );

    console.log('\n[G] resolveViewerEpisodePosterUrl returns assigned poster');
    const resolved = posterResolver.resolveViewerEpisodePosterUrl({
        episode: store.getEpisodeById(VIC_G_E02)?.episode,
        readyVaultAssets: videoAssets
    });
    assert(String(resolved || '').includes('poster-target-test'), 'viewer resolver prefers assigned poster');

    console.log('\n[H] Vic G other episodes unchanged');
    const e01 = store.getEpisodeById('ep-vic-g-s01e01');
    const e03 = store.getEpisodeById('ep-vic-g-s01e03');
    assert(!e01?.episode?.thumbnailUrl, 'Vic G E01 poster untouched');
    assert(!e03?.episode?.thumbnailUrl, 'Vic G E03 poster untouched');
    assert(
        vicBefore.seasons[0].episodes.length === vicG.buildVicGSeriesPackage().seasons[0].episodes.length,
        'Vic G package episode count unchanged'
    );

    console.log('\n[I] post-sync UUID rename — identity survives + resolver');
    const thumbVault = await vite.ssrLoadModule('/src/lib/viewer/thumbnailVault.js');
    bag.set(
        'personal_thumbnails',
        JSON.stringify([
            {
                id: POSTER_IMAGE_ID,
                name: '03 CLUB POOM POOM V1',
                title: '03 CLUB POOM POOM V1',
                personal_video_id: CLUB_REEL,
                url: SSR_POSTER_URL,
                fileName: `${POSTER_IMAGE_ID}.jpeg`
            }
        ])
    );

    const backendUuidReel = {
        id: POSTER_IMAGE_ID,
        name: 'BE24E968-3D3D-4EE6-BE38-45E2FFC0D5B4',
        title: 'BE24E968-3D3D-4EE6-BE38-45E2FFC0D5B4',
        url: `/thumbs/${POSTER_IMAGE_ID}.jpeg`,
        fileName: `${POSTER_IMAGE_ID}.jpeg`,
        type: 'image/jpeg'
    };

    thumbVault.upgradeThumbnailVaultFromBackendReels([backendUuidReel]);
    /** @type {Record<string, unknown>[]} */
    const upgradedThumbs = JSON.parse(bag.get('personal_thumbnails') || '[]');
    const postSyncEntry = upgradedThumbs[0];
    assert(
        postSyncEntry?.name === '03 CLUB POOM POOM V1',
        `human title survives backend UUID rename (got ${postSyncEntry?.name})`
    );
    assert(
        postSyncEntry?.personal_video_id === CLUB_REEL,
        `personal_video_id survives backend hydration (got ${postSyncEntry?.personal_video_id})`
    );

    store.resetSeriesCatalogEmpty?.();
    store.applyAuthoritativeApiCatalog(clubCatalogFixture());

    const postSyncTarget = posterAssignment.resolvePosterAssignmentTarget(postSyncEntry, {
        videoAssets
    });
    assert(
        postSyncTarget?.episodeId === VIC_G_E02,
        `post-sync resolver targets ${VIC_G_E02} (got ${postSyncTarget?.episodeId})`
    );
    assert(postSyncTarget?.reason === 'linked-media-id', 'post-sync resolver uses linked-media-id');
    assert(postSyncTarget?.episodeId !== INFERRED_EP, 'post-sync resolver skips inferred shell');

    const strippedEntry = {
        id: POSTER_IMAGE_ID,
        name: 'BE24E968-3D3D-4EE6-BE38-45E2FFC0D5B4',
        title: 'BE24E968-3D3D-4EE6-BE38-45E2FFC0D5B4',
        url: SSR_POSTER_URL
    };
    const persistentTitleMap = {
        [POSTER_IMAGE_ID]: {
            title: '03 CLUB POOM POOM V1',
            title_original: '03 CLUB POOM POOM V1'
        }
    };
    const persistentTarget = posterAssignment.resolvePosterAssignmentTarget(strippedEntry, {
        videoAssets,
        persistentTitleMap
    });
    assert(
        persistentTarget?.episodeId === VIC_G_E02,
        `persistent-title fallback targets ${VIC_G_E02} (got ${persistentTarget?.episodeId})`
    );
    assert(
        persistentTarget?.reason === 'persistent-title-match',
        'persistent-title fallback reason is persistent-title-match'
    );

    const postSyncAssign = await store.assignEpisodePoster(VIC_G_E02, SSR_POSTER_URL);
    assert(postSyncAssign.ok === true, 'post-sync assignEpisodePoster succeeds');
    assert(postSyncAssign.reelId === CLUB_REEL, 'post-sync assign keeps reelId unchanged');

    globalThis.fetch = nativeFetch;

    console.log('\n[browser] Thumbnail Vault assign panel preselect + Vic G E02 chip');
    let browserOk = false;
    try {
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        await context.addInitScript(({ posterId }) => {
                localStorage.setItem('personal_thumbnail_reel_ids', JSON.stringify([posterId]));
                window.__productionUpdates = [];
                window.addEventListener('reelforge:creator-production-updated', (event) => {
                    window.__productionUpdates.push(event.detail || {});
                });
            }, { posterId: POSTER_IMAGE_ID });
        const page = await context.newPage();
        await unlockStudioWithHeroSection(page, FRONTEND);

        await page
            .waitForResponse(
                (res) =>
                    res.url().includes('/api/reels') &&
                    res.request().method() === 'GET' &&
                    res.status() === 200,
                { timeout: 90_000 }
            )
            .catch(() => {});

        await page.waitForFunction(
            () => document.querySelectorAll('[data-testid="thumbnail-poster-assign-open"]').length > 0,
            { timeout: 90_000 }
        );

        await page.evaluate(
            async ({ posterUrl, posterId, clubReel }) => {
                const tv = await import('/src/lib/viewer/thumbnailVault.js');
                tv.appendThumbnailVaultEntry({
                    id: posterId,
                    name: '03 CLUB POOM POOM V1',
                    title: '03 CLUB POOM POOM V1',
                    personal_video_id: clubReel,
                    url: posterUrl,
                    type: 'image/jpeg'
                });
                tv.upgradeThumbnailVaultFromBackendReels([
                    {
                        id: posterId,
                        name: 'BE24E968-3D3D-4EE6-BE38-45E2FFC0D5B4',
                        title: 'BE24E968-3D3D-4EE6-BE38-45E2FFC0D5B4',
                        url: posterUrl,
                        fileName: `${posterId}.jpeg`,
                        type: 'image/jpeg'
                    }
                ]);
            },
            { posterUrl: POSTER_URL, posterId: POSTER_IMAGE_ID, clubReel: CLUB_REEL }
        );

        await page.evaluate(() => {
            const heading = [...document.querySelectorAll('h4')].find((el) =>
                /your thumbnails/i.test(el.textContent || '')
            );
            heading?.scrollIntoView({ block: 'center' });
            document.querySelector('[data-testid="thumbnail-poster-assign-open"]')?.scrollIntoView({
                block: 'center'
            });
        });
        await page.waitForTimeout(800);

        const assignBtn = page
            .locator('[data-testid="thumbnail-poster-assign-open"]')
            .filter({ has: page.locator('xpath=ancestor::div[contains(@class,"vault-card")]') })
            .first();
        const assignCount = await page.locator('[data-testid="thumbnail-poster-assign-open"]').count();
        if (assignCount === 0) {
            throw new Error('No thumbnail assign buttons after vault sync');
        }
        await assignBtn.waitFor({ state: 'visible', timeout: 30_000 });
        await assignBtn.click();

        const panel = page.locator('[data-testid="thumbnail-poster-assign-panel"]');
        await panel.waitFor({ state: 'visible', timeout: 30_000 });

        await page.waitForFunction(
            ([seriesId, episodeId]) => {
                const series = document.querySelector('[data-testid="thumbnail-poster-series-select"]');
                const episode = document.querySelector('[data-testid="thumbnail-poster-episode-select"]');
                const assignBtn = document.querySelector('[data-testid="thumbnail-poster-assign-btn"]');
                return (
                    series instanceof HTMLSelectElement &&
                    [...series.options].some((opt) => opt.value === seriesId) &&
                    series.value === seriesId &&
                    episode instanceof HTMLSelectElement &&
                    episode.value === episodeId &&
                    assignBtn instanceof HTMLButtonElement &&
                    !assignBtn.disabled
                );
            },
            [VIC_G_ID, VIC_G_E02],
            { timeout: 90_000 }
        );

        const seriesValue = await page.locator('[data-testid="thumbnail-poster-series-select"]').inputValue();
        const episodeValue = await page.locator('[data-testid="thumbnail-poster-episode-select"]').inputValue();
        assert(seriesValue === VIC_G_ID, `browser preselect series ${VIC_G_ID} (got ${seriesValue})`);
        assert(episodeValue === VIC_G_E02, `browser preselect episode ${VIC_G_E02} (got ${episodeValue})`);

        await page.locator('[data-testid="thumbnail-poster-assign-btn"]').click();
        await page.waitForTimeout(1500);

        const productionUpdates = await page.evaluate(() => window.__productionUpdates || []);
        assert(
            productionUpdates.some(
                (row) =>
                    row?.episodeId === VIC_G_E02 &&
                    row?.actionType === 'missing-thumbnail' &&
                    row?.source === 'thumbnail-poster-assign'
            ),
            'creator-production update emitted after poster assign'
        );

        await page.goto(`${FRONTEND}/series/vic-g`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        await page.waitForTimeout(2500);

        const e02Img = page.locator('[data-episode-id="ep-vic-g-s01e02"] img').first();
        let imgSrc = '';
        if (await e02Img.count()) {
            imgSrc = await e02Img.getAttribute('src');
        } else {
            const chips = page.locator('.episode-chip img, .series-episode-card img, [class*="episode"] img');
            const count = await chips.count();
            for (let i = 0; i < count; i += 1) {
                const src = await chips.nth(i).getAttribute('src');
                if (src && src.includes('00e876a4')) {
                    imgSrc = src;
                    break;
                }
            }
        }

        assert(
            String(imgSrc || '').includes('00e876a4'),
            `Vic G E02 chip shows assigned poster (src=${imgSrc || 'none'})`
        );

        await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
        await page.waitForTimeout(2000);
        const apiEp = await page.evaluate(async (episodeId) => {
            const res = await fetch('/api/series');
            const rows = await res.json();
            for (const series of rows || []) {
                for (const season of series.seasons || []) {
                    for (const ep of season.episodes || []) {
                        if (ep.episodeId === episodeId) return ep;
                    }
                }
            }
            return null;
        }, VIC_G_E02);

        assert(
            String(apiEp?.thumbnailUrl || '').includes('00e876a4'),
            `API thumbnailUrl survives reload (${apiEp?.thumbnailUrl || 'none'})`
        );

        browserOk = true;
        await browser.close();
    } catch (err) {
        failures.push(`browser e2e: ${err?.message || err}`);
        console.error('  browser e2e failed:', err?.message || err);
    }

    assert(browserOk, 'browser Thumbnail Vault → Vic G E02 flow completed');

    if (failures.length) {
        console.error('\nFAIL validate-thumbnail-poster-assignment-target');
        for (const f of failures) console.error('  -', f);
        process.exitCode = 1;
    } else {
        console.log('\nPASS validate-thumbnail-poster-assignment-target');
    }
} finally {
    await vite.close();
}
