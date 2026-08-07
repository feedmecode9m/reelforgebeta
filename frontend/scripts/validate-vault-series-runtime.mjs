#!/usr/bin/env node
/**
 * Runtime-contract validation for vault series inference persistence + resolve path.
 * STIRRED 1 UUID must resolve identically across catalog / metadata / Theater context.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const STIRRED_1_ID = '35a78285-5611-47b1-a279-9ffaaa64315b';

let failed = 0;
function assert(label, cond) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}`);
}

const bag = new Map();
const ls = {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => bag.set(String(k), String(v)),
    removeItem: (k) => bag.delete(k),
    clear: () => bag.clear()
};
const windowShim = {
    localStorage: ls,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true
};
globalThis.localStorage = ls;
globalThis.window = windowShim;

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});

try {
    const infer = await vite.ssrLoadModule('/src/lib/series/vaultSeriesInference.js');
    const seriesStore = await vite.ssrLoadModule('/src/lib/series/seriesStore.js');
    const episodeBridge = await vite.ssrLoadModule('/src/lib/series/episodeBridge.js');
    const { get } = await vite.ssrLoadModule('svelte/store');
    const { loadReelSeriesMetadataMap } = await vite.ssrLoadModule(
        '/src/lib/series/seriesMetadataStorage.js'
    );

    const vaultReels = [
        {
            id: STIRRED_1_ID,
            name: 'STIRRED 1',
            title: 'STIRRED 1',
            url: `/videos/${STIRRED_1_ID}.mp4`,
            thumbnailUrl: `/thumbs/${STIRRED_1_ID}.jpg`
        },
        {
            id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            name: 'STIRRED 2',
            title: 'STIRRED 2',
            url: '/videos/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.mp4'
        }
    ];

    console.log('\n[runtime] inferAndBindVaultSeries');
    const result = infer.inferAndBindVaultSeries(vaultReels, { source: 'runtime-validate' });
    assert('bound STIRRED reels', result.bound >= 2);

    console.log('\n[runtime] metadata map shape');
    const metaMap = loadReelSeriesMetadataMap();
    const meta = metaMap[STIRRED_1_ID] || get(seriesStore.reelSeriesMetadata)[STIRRED_1_ID];
    assert('metadata row exists', Boolean(meta));
    assert('meta.reelId', meta?.reelId === STIRRED_1_ID);
    assert('meta.seriesId series-stirred', meta?.seriesId === 'series-stirred');
    assert('meta.seriesName STIRRED', meta?.seriesName === 'STIRRED');
    assert('meta.seasonNumber 1', Number(meta?.seasonNumber) === 1);
    assert('meta.episodeNumber 1', Number(meta?.episodeNumber) === 1);
    assert('meta.episodeTitle STIRRED 1', meta?.episodeTitle === 'STIRRED 1');
    assert('meta.episodeId ep-stirred-s01e01', meta?.episodeId === 'ep-stirred-s01e01');

    console.log('\n[runtime] getEpisodeByReelId');
    const byReel = seriesStore.getEpisodeByReelId(STIRRED_1_ID);
    assert('byReel present', Boolean(byReel?.episode));
    assert('byReel series-stirred', byReel?.series?.id === 'series-stirred');
    assert('byReel ep-stirred-s01e01', byReel?.episode?.episodeId === 'ep-stirred-s01e01');
    assert('byReel.episode.reelId matches UUID', byReel?.episode?.reelId === STIRRED_1_ID);

    console.log('\n[runtime] resolveSeriesContextForReel');
    const ctx = seriesStore.resolveSeriesContextForReel({
        id: STIRRED_1_ID,
        name: 'STIRRED 1',
        url: `/videos/${STIRRED_1_ID}.mp4`
    });
    assert('context has series', Boolean(ctx?.series));
    assert('context has episode', Boolean(ctx?.episode));
    assert('context series-stirred', ctx?.series?.id === 'series-stirred');
    assert('context ep-stirred-s01e01', ctx?.episode?.episodeId === 'ep-stirred-s01e01');

    console.log('\n[runtime] resolveReelForEpisode → SERIES_MEDIA_MATCH path');
    const feed = {
        [STIRRED_1_ID]: {
            id: STIRRED_1_ID,
            name: 'STIRRED 1',
            url: `/videos/${STIRRED_1_ID}.mp4`,
            thumbnailUrl: `/thumbs/${STIRRED_1_ID}.jpg`
        }
    };
    const resolved = episodeBridge.resolveReelForEpisode(
        'ep-stirred-s01e01',
        (id) => feed[id] || null,
        () => Object.values(feed)
    );
    assert('resolved playable reel', Boolean(resolved?.id));
    assert('resolved same UUID', resolved?.id === STIRRED_1_ID);
    assert('resolved seriesId stamped', resolved?.seriesId === 'series-stirred');

    console.log('\n[runtime] Theater drawer series id contract');
    function drawerSeriesId(activeReel, seriesContext) {
        const seriesId = seriesContext?.series?.id ?? '';
        if (seriesId && seriesStore.getSeriesById(seriesId)) return seriesId;
        const reelId = activeReel?.id == null ? '' : String(activeReel.id);
        if (reelId) {
            const hit = seriesStore.getEpisodeByReelId(reelId);
            if (hit?.series?.id && seriesStore.getSeriesById(hit.series.id)) return hit.series.id;
        }
        if (reelId && infer.isRealVaultUuid(reelId)) return '';
        return 'series-neon-vengeance';
    }
    assert(
        'drawer opens series-stirred for bound STIRRED 1',
        drawerSeriesId({ id: STIRRED_1_ID }, ctx) === 'series-stirred'
    );
    assert(
        'unbound uuid not neon',
        drawerSeriesId({ id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff' }, null) === ''
    );

    console.log('\nSummary', {
        seriesId: ctx?.series?.id,
        episodeId: ctx?.episode?.episodeId,
        mediaId: STIRRED_1_ID,
        metadata: meta
    });
} finally {
    await vite.close();
}

console.log(failed === 0 ? '\nPASS validate-vault-series-runtime' : `\nFAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
