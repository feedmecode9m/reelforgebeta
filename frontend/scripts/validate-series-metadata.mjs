#!/usr/bin/env node
/** Series / season metadata fields (not filename-derived). */
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
    const edits = await vite.ssrLoadModule('/src/lib/series/seriesCatalogEdits.js');
    store.seriesCatalog.set([
        {
            id: 'series-meta',
            title: 'Temp',
            seasons: [{ seasonNumber: 1, episodes: [] }]
        }
    ]);
    store.updateCatalogSeries('series-meta', {
        title: 'STIRRED',
        description: 'The first chapter...',
        genre: 'Drama',
        tags: ['vault'],
        poster: 'stirred-poster.jpg'
    });
    store.updateCatalogSeason('series-meta', 1, {
        title: 'The Beginning',
        description: 'Season one...',
        poster: 'stirred-season1.jpg'
    });
    const s = store.getSeriesById('series-meta');
    assert(s?.title === 'STIRRED', 'series title');
    assert(s?.description === 'The first chapter...', 'series description');
    assert(s?.poster === 'stirred-poster.jpg', 'series poster');
    assert(s?.seasons?.[0]?.title === 'The Beginning', 'season title');
    assert(s?.seasons?.[0]?.poster === 'stirred-season1.jpg', 'season artwork');
    const durable = edits.getSeriesCatalogEdit('series-meta');
    assert(durable?.title === 'STIRRED', 'metadata durable title');
    assert(durable?.seasons?.['1']?.poster === 'stirred-season1.jpg', 'season artwork durable');

    if (failures.length) {
        console.error('FAIL validate-series-metadata\n' + failures.map((f) => `  - ${f}`).join('\n'));
        process.exit(1);
    }
    console.log('PASS validate-series-metadata');
} finally {
    await vite.close();
}
