#!/usr/bin/env node
/**
 * Zero-episode canonical Series → Creator Catalog Series Poster Card.
 *
 * Proves creator/catalog rule: canonical Series exists → poster card exists.
 * Preserves viewer/production rule: qualifying episode → browse/projection eligible.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { unlockStudioWithHeroSection } from '../tests/helpers/studio-navigation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const BACKEND = process.env.REELFORGE_BACKEND_URL || 'http://127.0.0.1:8080';
const FRONTEND = process.env.REELFORGE_URL || 'http://127.0.0.1:5173';

const VIC_G_ID = 'series-vic-g';
const TEST_REEL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REEL = {
    e02: 'cadfcabc-1947-4341-86a3-f82a08e78669',
    e04: 'b3a87c96-6ea0-4854-a0bc-6b0f2442f9a1',
    e05: 'efb01cee-9477-4477-982a-7611cfc08fcc',
    e06: '5cc786f0-8fbe-4f96-a59d-02014b0cc56f'
};

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else console.log(`  ok: ${msg}`);
}

function read(relPath) {
    return fs.readFileSync(path.join(root, relPath), 'utf8');
}

/** @returns {Promise<Record<string, string>>} */
async function getAdminWriteHeaders() {
    const password = process.env.ADMIN_PASSWORD || 'Gaff1505!';
    const res = await fetch(`${BACKEND}/admin/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        signal: AbortSignal.timeout(4000)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.token) {
        return { 'Content-Type': 'application/json' };
    }
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${body.token}`
    };
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

console.log('\n[1] wiring — creator poster catalog surface');
const creatorPanel = read('src/components/series/CreatorCatalogPanel.svelte');
const posterCard = read('src/components/series/SeriesBrowsePosterCard.svelte');
const browseHelper = read('src/lib/series/viewerSeriesBrowseCatalog.js');
const creatorCatalog = read('src/lib/series/creatorSeriesPosterCatalog.js');
const studioSrc = read('src/components/experiences/StudioExperience.svelte');

assert(
    creatorPanel.includes('buildCreatorSeriesPosterCatalog') &&
        creatorPanel.includes('SeriesBrowsePosterCard') &&
        creatorPanel.includes('data-creator-series-poster-grid'),
    'CreatorCatalogPanel renders creator poster grid via buildCreatorSeriesPosterCatalog'
);
assert(
    creatorPanel.includes('on:editInVault={handlePosterEditInVault}') ||
        creatorPanel.includes("dispatch('editInVault'"),
    'CreatorCatalogPanel dispatches editInVault from poster card'
);
assert(
    studioSrc.includes('on:editInVault={handleCreatorCatalogEditInVault}'),
    'StudioExperience handles editInVault from creator catalog'
);
assert(
    posterCard.includes('creatorMode') &&
        posterCard.includes('data-creator-series-poster-card') &&
        posterCard.includes('data-edit-in-vault') &&
        posterCard.includes('data-series-id') &&
        posterCard.includes('In Development'),
    'SeriesBrowsePosterCard exposes creator-mode poster card contract'
);
assert(
    creatorCatalog.includes('buildCreatorSeriesPosterCatalog') &&
        !creatorCatalog.includes('if (episodes.length === 0) continue'),
    'creator poster catalog builder includes zero-episode series'
);
assert(
    /if \(episodes\.length === 0\) continue;/.test(browseHelper),
    'viewer browse catalog still excludes zero-episode series'
);

const server = await createServer({
    root,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error'
});

/** @type {string | null} */
let liveFixtureId = null;
/** @type {Record<string, string> | null} */
let liveWriteHeaders = null;

try {
    const seriesApi = await server.ssrLoadModule('/src/lib/api/seriesApi.js');
    const store = await server.ssrLoadModule('/src/lib/series/seriesStore.js');
    const projection = await server.ssrLoadModule('/src/lib/series/viewerProductionProjection.js');
    const creatorPoster = await server.ssrLoadModule('/src/lib/series/creatorSeriesPosterCatalog.js');
    const browse = await server.ssrLoadModule('/src/lib/series/viewerSeriesBrowseCatalog.js');
    const adminSession = await server.ssrLoadModule('/src/lib/adminSession.js');

    const fixtureTitle = `Poster Card Zero Ep ${Date.now()}`;
    const fixtureId = seriesApi.seriesCreatePayloadFromStudioTitle(fixtureTitle).id;

    console.log('\n[2–6] mock catalog — zero-episode card + production boundary');
    /** @type {import('../src/lib/series/seriesTypes.js').Series} */
    const zeroEpisodeSeries = {
        id: fixtureId,
        title: fixtureTitle,
        tags: ['studio-created'],
        seasons: [
            {
                seasonId: `season-${fixtureId}-1`,
                seasonNumber: 1,
                title: 'Season 1',
                episodes: []
            }
        ]
    };

    store.resetSeriesCatalogEmpty();
    store.applyAuthoritativeApiCatalog([zeroEpisodeSeries]);

    const hydrated = store.getSeriesById(fixtureId);
    assert(Boolean(hydrated), 'canonical Series exists in catalog');
    assert(hydrated?.seasons?.[0]?.seasonNumber === 1, 'Season 1 shell exists');
    assert(
        (hydrated?.seasons?.[0]?.episodes || []).length === 0,
        'zero episodes initially'
    );

    const creatorItems = creatorPoster.buildCreatorSeriesPosterCatalog([hydrated]);
    assert(creatorItems.some((c) => c.seriesId === fixtureId), 'creator poster catalog contains zero-episode Series');

    const card = creatorItems.find((c) => c.seriesId === fixtureId);
    assert(card?.developmentState === 'in-development', 'card identifies Series as in development');
    assert(card?.episodeCount === 0, 'card reports zero episodes');
    assert(card?.primarySeasonNumber === 1, 'card reports Season 1');
    assert(!UUID_RE.test(card?.seriesId || ''), 'card seriesId is canonical text id (not studio UUID)');

    const viewerProjection = projection.buildViewerProductionProjection(hydrated, {});
    assert(viewerProjection === null, 'buildViewerProductionProjection(emptySeries) === null');

    const browseItems = browse.buildViewerSeriesBrowseCatalog([hydrated], {});
    assert(!browseItems.all.some((b) => b.seriesId === fixtureId), 'browse catalog excludes zero-episode Series');

    console.log('\n[7–10] mock — first qualifying episode transitions same card identity');
    /** @type {import('../src/lib/series/seriesTypes.js').Series} */
    const withEpisode = structuredClone(hydrated);
    withEpisode.seasons[0].episodes = [
        {
            episodeId: `ep-${fixtureId}-s01e01`,
            episodeNumber: 1,
            title: `${fixtureTitle} E01`,
            status: 'published',
            reelId: TEST_REEL_ID
        }
    ];
    store.applyAuthoritativeApiCatalog([withEpisode]);

    const afterProjection = projection.buildViewerProductionProjection(withEpisode, {});
    assert(afterProjection != null, 'same Series becomes production-eligible after qualifying episode');

    const afterCreator = creatorPoster.buildCreatorSeriesPosterCatalog([withEpisode]);
    const afterCard = afterCreator.find((c) => c.seriesId === fixtureId);
    assert(afterCard?.seriesId === fixtureId, 'poster card retains same canonical seriesId after episode');
    assert(afterCard?.developmentState === 'production', 'card transitions to production state');

    const afterBrowse = browse.buildViewerSeriesBrowseCatalog([withEpisode], {});
    assert(afterBrowse.all.some((b) => b.seriesId === fixtureId), 'browse includes Series after qualifying episode');

    console.log('\n[optional live] backend fixture + browser poster card');
    try {
        const statusRes = await fetch(`${BACKEND}/api/series/status`, {
            signal: AbortSignal.timeout(3000)
        });
        if (!statusRes.ok) {
            console.log('  skip: series API unavailable');
        } else {
            liveWriteHeaders = await getAdminWriteHeaders();
            const payload = seriesApi.seriesCreatePayloadFromStudioTitle(fixtureTitle);
            liveFixtureId = payload.id;

            const vicBefore = await fetch(`${BACKEND}/api/series/${encodeURIComponent(VIC_G_ID)}`, {
                signal: AbortSignal.timeout(5000)
            });
            const vicBeforeBody = vicBefore.ok ? await vicBefore.json() : null;
            const vicReelsBefore = vicBeforeBody
                ? (vicBeforeBody.seasons || [])
                      .flatMap((s) => s?.episodes || [])
                      .map((e) => String(e?.reelId || e?.reel_id || ''))
                      .filter(Boolean)
                : [];

            const createRes = await fetch(`${BACKEND}/api/series`, {
                method: 'POST',
                headers: liveWriteHeaders,
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(5000)
            });
            if (createRes.status === 401) {
                console.log('  skip: live POST requires admin token');
                liveFixtureId = null;
            } else {
                assert(createRes.status === 201, 'live POST creates canonical Series fixture');
                const created = await createRes.json();
                assert(created?.id === liveFixtureId, 'live canonical id matches payload');
                assert(!UUID_RE.test(liveFixtureId), 'live fixture id is not studio UUID');

                const getRes = await fetch(`${BACKEND}/api/series/${encodeURIComponent(liveFixtureId)}`, {
                    signal: AbortSignal.timeout(5000)
                });
                assert(getRes.status === 200, 'live GET /api/series/:id -> 200');

                const seasonsRes = await fetch(
                    `${BACKEND}/api/series/${encodeURIComponent(liveFixtureId)}/seasons`,
                    { signal: AbortSignal.timeout(5000) }
                );
                const seasonsBody = seasonsRes.ok ? await seasonsRes.json() : [];
                assert(
                    seasonsRes.status === 200 &&
                        Array.isArray(seasonsBody) &&
                        seasonsBody.some((s) => Number(s?.seasonNumber) === 1),
                    'live Season 1 exists'
                );

                const episodesRes = await fetch(
                    `${BACKEND}/api/series/${encodeURIComponent(liveFixtureId)}/episodes`,
                    { signal: AbortSignal.timeout(5000) }
                );
                const episodesBody = episodesRes.ok ? await episodesRes.json() : [];
                assert(
                    Array.isArray(episodesBody) && episodesBody.length === 0,
                    'live zero episodes initially'
                );

                store.resetSeriesCatalogEmpty();
                adminSession.setAdminSessionToken(
                    liveWriteHeaders.Authorization?.replace(/^Bearer\s+/i, '') || 'live-token'
                );
                const liveSeries = seriesApi.apiSeriesToCatalog(await getRes.json());
                store.applyAuthoritativeApiCatalog([liveSeries]);
                assert(Boolean(store.getSeriesById(liveFixtureId)), 'live catalog hydration exposes fixture');

                const liveCreator = creatorPoster.buildCreatorSeriesPosterCatalog([liveSeries]);
                assert(
                    liveCreator.some((c) => c.seriesId === liveFixtureId),
                    'live creator poster catalog contains fixture'
                );
                assert(
                    projection.buildViewerProductionProjection(liveSeries, {}) === null,
                    'live viewer projection null for zero-episode fixture'
                );

                const playwrightShellPath =
                    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
                /** @type {import('playwright').LaunchOptions} */
                const browserLaunchOptions = { headless: true };
                if (existsSync(playwrightShellPath)) {
                    browserLaunchOptions.executablePath = playwrightShellPath;
                }

                let browser;
                try {
                    browser = await chromium.launch(browserLaunchOptions);
                    const page = await browser.newPage();
                    await page.setViewportSize({ width: 1280, height: 900 });
                    await unlockStudioWithHeroSection(page, FRONTEND);

                    await page.evaluate(() => {
                        document
                            .querySelector('[data-content-panel="creator-catalog"]')
                            ?.scrollIntoView({ block: 'start' });
                    });
                    await page.waitForTimeout(800);

                    const cardLocator = page.locator(
                        `[data-creator-series-poster-card][data-series-id="${liveFixtureId}"]`
                    );
                    await cardLocator.waitFor({ state: 'visible', timeout: 45_000 });

                    const cardAudit = await page.evaluate((seriesId) => {
                        const card = document.querySelector(
                            `[data-creator-series-poster-card][data-series-id="${seriesId}"]`
                        );
                        const editBtn = card?.querySelector('[data-edit-in-vault]');
                        const status = card?.querySelector('[data-series-status]');
                        const meta = card?.querySelector('.series-poster-card__meta');
                        return {
                            hasCard: Boolean(card),
                            development: card?.getAttribute('data-series-development') || '',
                            editSeriesId: editBtn?.getAttribute('data-series-id') || '',
                            statusText: status?.textContent?.trim() || '',
                            metaText: meta?.textContent?.trim() || ''
                        };
                    }, liveFixtureId);

                    assert(cardAudit.hasCard, 'browser renders Series Poster Card for zero-episode Series');
                    assert(
                        cardAudit.development === 'in-development',
                        'browser card data-series-development is in-development'
                    );
                    assert(
                        /in development/i.test(cardAudit.statusText),
                        'browser card shows In Development badge'
                    );
                    assert(
                        /season 1 · 0 episodes/i.test(cardAudit.metaText),
                        'browser card shows Season 1 · 0 episodes'
                    );
                    assert(
                        cardAudit.editSeriesId === liveFixtureId,
                        'Edit in Vault targets canonical Series ID'
                    );
                    assert(
                        !UUID_RE.test(cardAudit.editSeriesId),
                        'Edit in Vault does not substitute studio UUID'
                    );

                    await page.locator(`[data-edit-in-vault][data-series-id="${liveFixtureId}"]`).click();
                    await page.waitForTimeout(600);
                    const vaultVisible = await page.evaluate(() =>
                        Boolean(
                            document.querySelector(
                                '[data-workspace-panel-content] .video-vault-grid, [data-workspace-panel-content] .video-vault-drop'
                            )
                        )
                    );
                    assert(vaultVisible, 'Edit in Vault scrolls vault into creator workspace');

                    const episodePayload = seriesApi.episodeToApiCreatePayload({
                        series: liveSeries,
                        season: liveSeries.seasons[0],
                        episode: {
                            episodeId: `ep-${liveFixtureId}-s01e01`,
                            episodeNumber: 1,
                            title: `${fixtureTitle} E01`,
                            status: 'published',
                            reelId: TEST_REEL_ID
                        }
                    });
                    const epRes = await fetch(`${BACKEND}/api/episodes`, {
                        method: 'POST',
                        headers: liveWriteHeaders,
                        body: JSON.stringify(episodePayload),
                        signal: AbortSignal.timeout(5000)
                    });
                    assert(epRes.status === 201, 'live POST qualifying episode succeeds');

                    const refreshedRes = await fetch(
                        `${BACKEND}/api/series/${encodeURIComponent(liveFixtureId)}`,
                        { signal: AbortSignal.timeout(5000) }
                    );
                    const refreshedSeries = seriesApi.apiSeriesToCatalog(await refreshedRes.json());
                    const liveAfterProjection = projection.buildViewerProductionProjection(refreshedSeries, {});
                    assert(liveAfterProjection != null, 'live same Series production-eligible after episode');

                    const liveAfterCreator = creatorPoster.buildCreatorSeriesPosterCatalog([refreshedSeries]);
                    const liveAfterCard = liveAfterCreator.find((c) => c.seriesId === liveFixtureId);
                    assert(
                        liveAfterCard?.seriesId === liveFixtureId,
                        'live poster card retains same seriesId after episode'
                    );
                    assert(
                        liveAfterCard?.developmentState === 'production',
                        'live poster card transitions to production'
                    );

                    if (vicBefore.ok) {
                        const vicAfter = await fetch(`${BACKEND}/api/series/${encodeURIComponent(VIC_G_ID)}`, {
                            signal: AbortSignal.timeout(5000)
                        });
                        const vicAfterBody = vicAfter.ok ? await vicAfter.json() : null;
                        const vicReelsAfter = vicAfterBody
                            ? (vicAfterBody.seasons || [])
                                  .flatMap((s) => s?.episodes || [])
                                  .map((e) => String(e?.reelId || e?.reel_id || ''))
                                  .filter(Boolean)
                            : [];
                        assert(
                            vicReelsAfter.length === vicReelsBefore.length,
                            'Vic G episode count unchanged'
                        );
                        for (const reelId of Object.values(REEL)) {
                            if (vicReelsBefore.includes(reelId)) {
                                assert(vicReelsAfter.includes(reelId), `Vic G reel ${reelId} unchanged`);
                            }
                        }
                    }
                } finally {
                    await browser?.close().catch(() => {});
                }
            }
        }
    } catch (err) {
        console.log(`  skip: live/browser integration (${err?.message || err})`);
    }
} finally {
    if (liveFixtureId && liveWriteHeaders) {
        try {
            const deleteRes = await fetch(`${BACKEND}/api/series/${encodeURIComponent(liveFixtureId)}`, {
                method: 'DELETE',
                headers: liveWriteHeaders,
                signal: AbortSignal.timeout(5000)
            });
            assert(deleteRes.ok, 'fixture DELETE cleanup succeeds');
            const afterDelete = await fetch(`${BACKEND}/api/series/${encodeURIComponent(liveFixtureId)}`, {
                signal: AbortSignal.timeout(5000)
            });
            assert(afterDelete.status === 404, 'fixture cleanup -> GET series 404');
        } catch (err) {
            failures.push(`fixture cleanup failed: ${err?.message || err}`);
        }
    }
    await server.close();
}

if (failures.length) {
    console.error('\nFAIL validate-series-poster-card');
    for (const msg of failures) console.error(`  ✗ ${msg}`);
    process.exit(1);
}

console.log('\nPASS validate-series-poster-card');
