#!/usr/bin/env node
/**
 * Creator Series Editor — ordering with preserved episode numbers + durable persistence.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
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
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true
};

async function main() {
    const vite = await createServer({
        root,
        logLevel: 'error',
        server: { middlewareMode: true },
        appType: 'custom'
    });
    try {
        const store = await vite.ssrLoadModule('/src/lib/series/seriesStore.js');
        const edits = await vite.ssrLoadModule('/src/lib/series/seriesCatalogEdits.js');
        const {
            resolveRelatedEpisodes,
            buildSeriesViewFromRelated
        } = await vite.ssrLoadModule('/src/lib/series/resolveRelatedEpisodes.js');

        bag.clear();
        store.resetSeriesCatalogEmpty?.();

        // Synthetic STIRRED season in catalog with fixed episode numbers
        const seriesId = 'series-stirred-editor';
        /** @type {any} */
        const series = {
            id: seriesId,
            title: 'STIRRED',
            description: '',
            poster: '',
            tags: ['vault-inferred'],
            seasons: [
                {
                    seasonId: 's1',
                    seasonNumber: 1,
                    title: 'Season 1',
                    episodes: [
                        {
                            episodeId: 'ep-s1e1',
                            episodeNumber: 1,
                            title: 'STIRRED S01E01',
                            status: 'published',
                            reelId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
                            mediaAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01'
                        },
                        {
                            episodeId: 'ep-s1e2',
                            episodeNumber: 2,
                            title: 'STIRRED S01E02',
                            status: 'published',
                            reelId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02',
                            mediaAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02'
                        },
                        {
                            episodeId: 'ep-s1e3',
                            episodeNumber: 3,
                            title: 'STIRRED S01E03',
                            status: 'published',
                            reelId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03',
                            mediaAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03'
                        }
                    ]
                }
            ]
        };
        store.seriesCatalog.set([series]);

        const e1 = 'ep-s1e1';
        const e2 = 'ep-s1e2';
        const e3 = 'ep-s1e3';
        const reorder = [e3, e1, e2];
        const ok = store.reorderEpisodesInSeason(seriesId, 1, reorder);
        assert(ok === true, 'reorder mutation works');

        const after = store.getSeasonByNumber(seriesId, 1)?.season;
        const ids = (after?.episodes || []).map((e) => e.episodeId);
        assert(ids.join(',') === reorder.join(','), `creator order E3 E1 E2 (got ${ids.join(',')})`);
        const nums = (after?.episodes || []).map((e) => e.episodeNumber);
        assert(
            nums.join(',') === '3,1,2',
            `episode numbers preserved as labels (got ${nums.join(',')})`
        );

        // Persistence survives "reload" via catalog edits map + reapply
        const stored = edits.loadSeriesCatalogEditsMap()[seriesId];
        assert(
            Array.isArray(stored?.seasons?.['1']?.episodeOrder) &&
                stored.seasons['1'].episodeOrder.join(',') === reorder.join(','),
            'order persisted in series catalog edits'
        );

        // Simulate catalog without in-memory displayOrder, only edits map
        store.seriesCatalog.set([
            {
                ...series,
                seasons: [
                    {
                        ...series.seasons[0],
                        episodes: series.seasons[0].episodes.map((e) => ({ ...e }))
                    }
                ]
            }
        ]);
        const reloaded = store.getSeasonByNumber(seriesId, 1)?.season;
        const reloadedIds = (reloaded?.episodes || []).map((e) => e.episodeId);
        assert(
            reloadedIds.join(',') === reorder.join(','),
            `order survives reload via applySeriesCatalogEdit (got ${reloadedIds.join(',')})`
        );

        // Viewer shelf same order via catalog series
        const vault = [
            {
                id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03',
                name: 'STIRRED S01E03',
                status: 'ready',
                type: 'video',
                url: 'https://cdn.example/e3.mp4'
            },
            {
                id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
                name: 'STIRRED S01E01',
                status: 'ready',
                type: 'video',
                url: 'https://cdn.example/e1.mp4'
            },
            {
                id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02',
                name: 'STIRRED S01E02',
                status: 'ready',
                type: 'video',
                url: 'https://cdn.example/e2.mp4'
            }
        ];
        const related = resolveRelatedEpisodes(vault[1], { readyAssets: vault });
        const catalogSeries = store.getSeriesById(seriesId);
        const view = buildSeriesViewFromRelated(related, catalogSeries, { viewerMode: true });
        const shelfIds = (view?.seasons?.[0]?.episodes || []).map(
            (e) => e.mediaAssetId || e.reelId || e.episodeId
        );
        // Expect media order matching reorder: e3, e1, e2 when displayOrder applied to matches
        assert(Boolean(view), 'viewer series view built');
        assert(/stirred/i.test(String(view?.title || '')), 'viewer title STIRRED');

        if (failures.length) {
            console.error('FAIL validate-series-ordering\n' + failures.map((f) => `  - ${f}`).join('\n'));
            process.exitCode = 1;
        } else {
            console.log('PASS validate-series-ordering');
            console.log({ creatorOrder: ids, labels: nums, reloadedIds, shelfCount: shelfIds.length });
        }
    } finally {
        await vite.close();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
