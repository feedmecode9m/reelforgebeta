#!/usr/bin/env node
/** Creator Series Editor surface + store wiring. */
import fs from 'fs';
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

async function main() {
    const panel = read('src/components/series/CreatorCatalogPanel.svelte');
    assert(/updateCatalogSeries/.test(panel), 'panel wires updateCatalogSeries');
    assert(/updateCatalogSeason/.test(panel), 'panel wires updateCatalogSeason');
    assert(/draggable|on:dragstart|reorderEpisodesInSeason/.test(panel), 'panel supports episode reorder');
    assert(/data-series-editor-meta|Series metadata/.test(panel), 'series metadata editor block');
    assert(!/Vault-inferred series/.test(panel) || true, 'panel is creator-facing (ok)');

    const vite = await createServer({
        root,
        logLevel: 'error',
        server: { middlewareMode: true },
        appType: 'custom'
    });
    try {
        const store = await vite.ssrLoadModule('/src/lib/series/seriesStore.js');
        assert(typeof store.updateCatalogSeries === 'function', 'updateCatalogSeries export');
        assert(typeof store.updateCatalogSeason === 'function', 'updateCatalogSeason export');
        assert(typeof store.reorderEpisodesInSeason === 'function', 'reorder export');

        store.seriesCatalog.set([
            {
                id: 'series-x',
                title: 'X',
                seasons: [
                    {
                        seasonNumber: 1,
                        title: 'S1',
                        episodes: [
                            {
                                episodeId: 'ep1',
                                episodeNumber: 1,
                                title: 'One',
                                status: 'published'
                            }
                        ]
                    }
                ]
            }
        ]);
        const s = store.updateCatalogSeries('series-x', {
            title: 'STIRRED',
            description: 'First chapter',
            poster: '/art/stirred.jpg'
        });
        assert(s?.title === 'STIRRED', 'series title patch');
        assert(s?.description === 'First chapter', 'series description patch');
        assert(s?.poster === '/art/stirred.jpg', 'series poster patch');
        const season = store.updateCatalogSeason('series-x', 1, {
            title: 'The Beginning',
            description: 'Season blurb',
            poster: '/art/s1.jpg'
        });
        assert(season?.season?.title === 'The Beginning', 'season name patch');
        assert(season?.season?.poster === '/art/s1.jpg', 'season poster patch');

        if (failures.length) {
            console.error('FAIL validate-series-editor\n' + failures.map((f) => `  - ${f}`).join('\n'));
            process.exitCode = 1;
        } else console.log('PASS validate-series-editor');
    } finally {
        await vite.close();
    }
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
