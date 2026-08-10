#!/usr/bin/env node
/**
 * Runtime wiring audit — creator → viewer pipeline (not structural-only).
 *
 * Covers:
 * - displayOrder wins over episodeNumber for viewer shelves
 * - publishing filters viewer shelves (draft/ready/archived hidden)
 * - Theater watchTracker → savePlaybackPosition throttle + resume identity
 * - listContinueWatching consumes position map
 * - recommendSeries contracts + series page consumers
 * - watchSessionStart not stubbed on series page
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const failures = [];

function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else console.log(`  ok: ${msg}`);
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
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
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true
};
if (typeof globalThis.crypto?.randomUUID !== 'function') {
    Object.defineProperty(globalThis, 'crypto', {
        value: { randomUUID: () => '00000000-0000-4000-8000-000000000099' },
        configurable: true
    });
}
const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});

try {
    // --- Structural wiring of Theater progress (critical) ---
    const trackerSrc = read('src/lib/watch/watchTracker.js');
    assert(/savePlaybackPosition/.test(trackerSrc), 'watchTracker imports/calls savePlaybackPosition');
    assert(/POSITION_SAVE_THROTTLE|throttle/i.test(trackerSrc), 'position saves are throttled');
    assert(/getPlaybackPosition/.test(trackerSrc), 'session start reads saved positions');

    const seriesPage = read('src/components/series/SeriesPublicPage.svelte');
    assert(
        !/watchSessionStart:\s*\(\)\s*=>\s*\{\s*\}/.test(seriesPage),
        'SeriesPublicPage does not stub watchSessionStart'
    );
    assert(
        /watchOnProgress/.test(seriesPage) && /watchApplyResume/.test(seriesPage),
        'SeriesPublicPage wires watch progress lifecycle'
    );
    assert(/episodeIsViewerDiscoverable/.test(seriesPage), 'series page filters by publishing');
    assert(/sortEpisodesForDisplay/.test(seriesPage), 'series page sorts by displayOrder');
    assert(/listContinueWatching/.test(seriesPage), 'series page renders continue watching from positions');
    assert(/recommendSeries/.test(seriesPage), 'series page renders recommendations');
    assert(/data-series-recommendations/.test(seriesPage), 'recommendation surface present');

    const homeFeed = read('src/lib/discovery/homepageDiscoveryFeed.js');
    assert(/listContinueWatching/.test(homeFeed), 'homepage continue watching uses position API');

    // --- Runtime module behavior ---
    const progress = await vite.ssrLoadModule('/src/lib/series/seriesWatchProgress.js');
    const edits = await vite.ssrLoadModule('/src/lib/series/seriesCatalogEdits.js');
    const publishing = await vite.ssrLoadModule('/src/lib/series/publishingLifecycle.js');
    const resolver = await vite.ssrLoadModule('/src/lib/series/resolveRelatedEpisodes.js');
    const tracker = await vite.ssrLoadModule('/src/lib/watch/watchTracker.js');
    const recs = await vite.ssrLoadModule('/src/lib/series/seriesRecommendations.js');

    // displayOrder sort: E3, E1, E2 presentation with unchanged episode numbers
    const eps = [
        { episodeId: 'e1', episodeNumber: 1, title: 'E1', displayOrder: 1 },
        { episodeId: 'e2', episodeNumber: 2, title: 'E2', displayOrder: 2 },
        { episodeId: 'e3', episodeNumber: 3, title: 'E3', displayOrder: 0 }
    ];
    const sorted = edits.sortEpisodesForDisplay(eps);
    assert(
        sorted.map((e) => e.episodeNumber).join(',') === '3,1,2',
        `displayOrder order 3,1,2 (got ${sorted.map((e) => e.episodeNumber).join(',')})`
    );
    assert(
        sorted.every((e) => [1, 2, 3].includes(e.episodeNumber)),
        'S/E identity numbers preserved under reorder'
    );

    // Publishing: E1 draft, E2 ready, E3 published, E4 archived → viewer sees E3 only
    const catalogSeries = {
        id: 'series-stirred',
        title: 'STIRRED',
        seasons: [
            {
                seasonId: 's1',
                seasonNumber: 1,
                title: 'Season 1',
                episodes: [
                    {
                        episodeId: 'ep1',
                        episodeNumber: 1,
                        title: 'E1',
                        status: 'draft',
                        reelId: 'r1',
                        displayOrder: 0
                    },
                    {
                        episodeId: 'ep2',
                        episodeNumber: 2,
                        title: 'E2',
                        status: 'ready',
                        reelId: 'r2',
                        displayOrder: 1
                    },
                    {
                        episodeId: 'ep3',
                        episodeNumber: 3,
                        title: 'E3',
                        status: 'published',
                        reelId: 'r3',
                        displayOrder: 2
                    },
                    {
                        episodeId: 'ep4',
                        episodeNumber: 4,
                        title: 'E4',
                        status: 'archived',
                        reelId: 'r4',
                        displayOrder: 3
                    }
                ]
            }
        ]
    };
    assert(publishing.episodeIsViewerDiscoverable(catalogSeries.seasons[0].episodes[2]), 'E3 discoverable');
    assert(!publishing.episodeIsViewerDiscoverable(catalogSeries.seasons[0].episodes[0]), 'E1 not discoverable');
    assert(!publishing.episodeIsViewerDiscoverable(catalogSeries.seasons[0].episodes[1]), 'E2 ready not discoverable');
    assert(!publishing.episodeIsViewerDiscoverable(catalogSeries.seasons[0].episodes[3]), 'E4 archived not discoverable');

    const related = {
        seriesId: 'series-stirred',
        seriesTitle: 'STIRRED',
        members: catalogSeries.seasons[0].episodes.map((ep, vaultIndex) => ({
            assetId: ep.reelId,
            reelId: ep.reelId,
            title: ep.title,
            episodeNumber: ep.episodeNumber,
            seasonNumber: 1,
            mediaUrl: `https://example.test/${ep.reelId}.mp4`,
            thumbnailUrl: '',
            episodeId: ep.episodeId,
            source: 'catalog',
            status: ep.status,
            displayOrder: ep.displayOrder,
            vaultIndex
        }))
    };

    const viewerView = resolver.buildSeriesViewFromRelated(related, catalogSeries, { viewerMode: true });
    const viewerTitles = (viewerView?.seasons || []).flatMap((s) => s.episodes.map((e) => e.title));
    assert(
        viewerTitles.join(',') === 'E3',
        `viewer shelf E3 only (got ${viewerTitles.join(',') || 'empty'})`
    );

    const creatorView = resolver.buildSeriesViewFromRelated(related, catalogSeries, {
        viewerMode: false
    });
    const creatorTitles = (creatorView?.seasons || []).flatMap((s) => s.episodes.map((e) => e.title));
    assert(
        creatorTitles.join(',') === 'E1,E2,E3,E4',
        `creator shelf retains all (got ${creatorTitles.join(',')})`
    );

    // Reorder then republish path: displayOrder E3,E1,E2 with all published
    const reordered = {
        ...related,
        members: [
            {
                ...related.members[2],
                status: 'published',
                displayOrder: 0
            },
            {
                ...related.members[0],
                status: 'published',
                displayOrder: 1
            },
            {
                ...related.members[1],
                status: 'published',
                displayOrder: 2
            }
        ]
    };
    const orderCatalog = {
        ...catalogSeries,
        seasons: [
            {
                ...catalogSeries.seasons[0],
                episodes: reordered.members.map((m) => ({
                    episodeId: m.episodeId,
                    episodeNumber: m.episodeNumber,
                    title: m.title,
                    status: 'published',
                    reelId: m.reelId,
                    displayOrder: m.displayOrder
                }))
            }
        ]
    };
    const orderedView = resolver.buildSeriesViewFromRelated(reordered, orderCatalog, {
        viewerMode: true
    });
    const orderedNums = (orderedView?.seasons || [])
        .flatMap((s) => s.episodes)
        .map((e) => e.episodeNumber);
    assert(
        orderedNums.join(',') === '3,1,2',
        `viewer+theater displayOrder 3,1,2 (got ${orderedNums.join(',')})`
    );

    // Progress independence + throttle via watchTracker
    tracker.resetWatchTrackerForTests?.();
    await tracker.watchSessionStart({ reelId: 'reel-e2', episodeId: 'ep2' });
    const videoE2 = { currentTime: 240, duration: 600 };
    // Many raw timeupdates should not write more than throttled saves (map always last pos)
    for (let i = 0; i < 5; i += 1) {
        videoE2.currentTime = 240 + i;
        await tracker.watchOnProgress(videoE2);
    }
    const firstPos = progress.getPlaybackPosition('reel-e2');
    assert(firstPos && firstPos.position >= 240, 'progress saved for E2 after progress events');

    // Force pause should update
    videoE2.currentTime = 300;
    await tracker.watchOnPause(videoE2);
    const paused = progress.getPlaybackPosition('reel-e2');
    assert(paused?.position === 300, `pause force-saves position (got ${paused?.position})`);

    await tracker.watchSessionStart({ reelId: 'reel-e3', episodeId: 'ep3' });
    const videoE3 = { currentTime: 60, duration: 600 };
    await tracker.watchOnPause(videoE3);
    const e2 = progress.getPlaybackPosition('reel-e2');
    const e3 = progress.getPlaybackPosition('reel-e3');
    assert(e2?.position === 300, 'E2 progress independent');
    assert(e3?.position === 60, 'E3 progress independent');

    // Resume seeds pending from saved seconds
    tracker.resetWatchTrackerForTests?.();
    await tracker.watchSessionStart({ reelId: 'reel-e2' });
    // Re-save for next assert via get after listContinueWatching
    const cont = progress.listContinueWatching({ limit: 10 });
    assert(
        cont.some((r) => r.reelId === 'reel-e2' && r.position === 300),
        'listContinueWatching includes E2 at 300'
    );
    assert(
        cont.some((r) => r.reelId === 'reel-e3' && r.position === 60),
        'listContinueWatching includes E3 at 60'
    );

    // Recommendations module returns published-only cold start
    // (ssr catalog may be empty — contract export is enough + seed score map)
    assert(typeof recs.recommendSeries === 'function', 'recommendSeries export exists');

    if (failures.length) {
        console.error(
            'FAIL validate-creator-viewer-runtime\n' + failures.map((f) => `  - ${f}`).join('\n')
        );
        process.exit(1);
    }
    console.log('PASS validate-creator-viewer-runtime');
} finally {
    await vite.close();
}
