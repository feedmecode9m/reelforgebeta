#!/usr/bin/env node
/** Non-AI recommendations from published series + history. */
import { createServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});
try {
    const store = await vite.ssrLoadModule('/src/lib/series/seriesStore.js');
    const { recommendSeries } = await vite.ssrLoadModule('/src/lib/series/seriesRecommendations.js');
    store.seriesCatalog.set([
        {
            id: 'series-stirred',
            title: 'STIRRED',
            tags: ['drama'],
            seasons: [
                {
                    seasonNumber: 1,
                    episodes: [
                        {
                            episodeId: 's1',
                            episodeNumber: 1,
                            title: 'E1',
                            status: 'published',
                            reelId: 'r1'
                        }
                    ]
                }
            ]
        },
        {
            id: 'series-a',
            title: 'Series A',
            tags: ['drama'],
            seasons: [
                {
                    seasonNumber: 1,
                    episodes: [
                        {
                            episodeId: 'a1',
                            episodeNumber: 1,
                            title: 'A1',
                            status: 'published',
                            reelId: 'ra'
                        }
                    ]
                }
            ]
        },
        {
            id: 'series-draft-only',
            title: 'Hidden',
            seasons: [
                {
                    seasonNumber: 1,
                    episodes: [
                        {
                            episodeId: 'h1',
                            episodeNumber: 1,
                            title: 'H',
                            status: 'draft',
                            reelId: 'rh'
                        }
                    ]
                }
            ]
        }
    ]);
    const recs = recommendSeries({
        seedSeriesId: 'series-stirred',
        seedSeriesLabel: 'STIRRED',
        limit: 5
    });
    assert(recs.some((r) => r.seriesId === 'series-a'), 'recommends published similar series');
    assert(!recs.some((r) => r.seriesId === 'series-draft-only'), 'skips draft-only series');
    assert(!recs.some((r) => r.seriesId === 'series-stirred'), 'excludes seed');

    if (failures.length) {
        console.error('FAIL validate-recommendations\n' + failures.map((f) => `  - ${f}`).join('\n'));
        process.exit(1);
    }
    console.log('PASS validate-recommendations');
} finally {
    await vite.close();
}
