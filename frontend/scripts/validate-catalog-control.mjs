#!/usr/bin/env node
/**
 * Creator Catalog Control — Phase 1 store mutations.
 * Proves updateCatalogEpisode / setEpisodeStatus / reorderEpisodesInSeason
 * without UI, Theater resolve, or vault inference changes.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const SYNTH_REEL = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0001';
const EP_A = 'ep-neon-s01e01';
const EP_B = 'ep-neon-s01e02';
const EP_C = 'ep-neon-s01e03';
const SERIES = 'series-neon-vengeance';

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
globalThis.localStorage = ls;
globalThis.window = {
    localStorage: ls,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true
};

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});

try {
    const seriesStore = await vite.ssrLoadModule('/src/lib/series/seriesStore.js');
    const { get } = await vite.ssrLoadModule('svelte/store');
    const {
        loadReelSeriesMetadataMap
    } = await vite.ssrLoadModule('/src/lib/series/seriesMetadataStorage.js');

    console.log('\n[catalog-control] reset + bind synthetic reel');
    seriesStore.resetSeriesCatalogToMock();
    bag.clear();

    const bound = seriesStore.attachEpisodeReel(EP_A, SYNTH_REEL);
    assert('attachEpisodeReel binds synthetic UUID', bound === true);
    const afterAttach = seriesStore.getEpisodeById(EP_A);
    assert('bound reelId preserved', afterAttach?.episode?.reelId === SYNTH_REEL);
    assert('episodeId unchanged after attach', afterAttach?.episode?.episodeId === EP_A);

    console.log('\n[catalog-control] updateCatalogEpisode title + description');
    const titled = seriesStore.updateCatalogEpisode(EP_A, {
        title: 'Synthetic Bound Title',
        description: 'Phase-1 description payload'
    });
    assert('updateCatalogEpisode returns context', Boolean(titled?.episode));
    assert('title updated', titled?.episode?.title === 'Synthetic Bound Title');
    assert('description updated', titled?.episode?.description === 'Phase-1 description payload');
    assert('reelId preserved after title edit', titled?.episode?.reelId === SYNTH_REEL);
    assert('episodeId preserved after title edit', titled?.episode?.episodeId === EP_A);
    assert('seriesId preserved', titled?.series?.id === SERIES);

    const reloaded = seriesStore.getEpisodeById(EP_A);
    assert('title persists in catalog', reloaded?.episode?.title === 'Synthetic Bound Title');
    assert('description persists in catalog', reloaded?.episode?.description === 'Phase-1 description payload');

    const metaMap = loadReelSeriesMetadataMap();
    const meta = metaMap[SYNTH_REEL] || get(seriesStore.reelSeriesMetadata)[SYNTH_REEL];
    assert('metadata row for reel exists', Boolean(meta));
    assert('metadata episodeTitle synced', meta?.episodeTitle === 'Synthetic Bound Title');
    assert('metadata description synced', meta?.description === 'Phase-1 description payload');
    assert('metadata episodeId stable', meta?.episodeId === EP_A);
    assert('metadata reelId stable', meta?.reelId === SYNTH_REEL);

    console.log('\n[catalog-control] setEpisodeStatus published → draft → published');
    const toDraft = seriesStore.setEpisodeStatus(EP_A, 'draft');
    assert('setEpisodeStatus → draft', toDraft?.episode?.status === 'draft');
    assert('reelId preserved on draft', toDraft?.episode?.reelId === SYNTH_REEL);
    const metaDraft =
        loadReelSeriesMetadataMap()[SYNTH_REEL] || get(seriesStore.reelSeriesMetadata)[SYNTH_REEL];
    assert('metadata status draft', metaDraft?.episodeStatus === 'draft');

    const toPublished = seriesStore.setEpisodeStatus(EP_A, 'published');
    assert('setEpisodeStatus → published', toPublished?.episode?.status === 'published');
    assert('reelId preserved on re-publish', toPublished?.episode?.reelId === SYNTH_REEL);

    console.log('\n[catalog-control] invalid patches rejected');
    assert(
        'empty title rejected',
        seriesStore.updateCatalogEpisode(EP_A, { title: '   ' }) === null
    );
    assert(
        'bogus status rejected',
        seriesStore.updateCatalogEpisode(EP_A, { status: 'live' }) === null
    );
    assert(
        'unknown episode null',
        seriesStore.updateCatalogEpisode('ep-does-not-exist', { title: 'X' }) === null
    );
    // Title should still be synthetic after rejected empty title
    assert(
        'catalog title still Synthetic after reject',
        seriesStore.getEpisodeById(EP_A)?.episode?.title === 'Synthetic Bound Title'
    );

    console.log('\n[catalog-control] reorderEpisodesInSeason');
    // Season 1 currently: e01, e02, e03, e04 (e04 reel null)
    const seasonBefore = seriesStore.getSeasonByNumber(SERIES, 1)?.season;
    const idsBefore = (seasonBefore?.episodes || [])
        .slice()
        .sort((a, b) => a.episodeNumber - b.episodeNumber)
        .map((e) => e.episodeId);
    assert('season has 4 episodes', idsBefore.length === 4);

    const reverseOrder = [...idsBefore].reverse();
    const reordered = seriesStore.reorderEpisodesInSeason(SERIES, 1, reverseOrder);
    assert('reorder returns true', reordered === true);

    const seasonAfter = seriesStore.getSeasonByNumber(SERIES, 1)?.season;
    const sorted = [...(seasonAfter?.episodes || [])].sort(
        (a, b) => a.episodeNumber - b.episodeNumber
    );
    assert('episode count unchanged', sorted.length === 4);
    assert('episodeNumbers contiguous 1..n', sorted.every((e, i) => e.episodeNumber === i + 1));
    assert(
        'order matches requested',
        sorted.map((e) => e.episodeId).join(',') === reverseOrder.join(',')
    );

    const epAAfter = seriesStore.getEpisodeById(EP_A);
    assert('EP_A still has same reelId after reorder', epAAfter?.episode?.reelId === SYNTH_REEL);
    assert('EP_A episodeId unchanged after reorder', epAAfter?.episode?.episodeId === EP_A);
    const expectedNum = reverseOrder.indexOf(EP_A) + 1;
    assert(`EP_A episodeNumber is ${expectedNum}`, epAAfter?.episode?.episodeNumber === expectedNum);

    const metaAfterReorder =
        loadReelSeriesMetadataMap()[SYNTH_REEL] || get(seriesStore.reelSeriesMetadata)[SYNTH_REEL];
    assert(
        'metadata episodeNumber synced after reorder',
        Number(metaAfterReorder?.episodeNumber) === expectedNum
    );

    // Cross-season / incomplete lists fail closed
    assert(
        'reorder rejects incomplete list',
        seriesStore.reorderEpisodesInSeason(SERIES, 1, [EP_A, EP_B]) === false
    );
    assert(
        'reorder rejects foreign episode id',
        seriesStore.reorderEpisodesInSeason(SERIES, 1, [
            EP_A,
            EP_B,
            EP_C,
            'ep-neon-s02e01'
        ]) === false
    );

    console.log('\n[catalog-control] attach helpers still work');
    const det = seriesStore.detachEpisodeReel(EP_B);
    assert('detachEpisodeReel still callable', typeof det === 'boolean');
    const att = seriesStore.attachEpisodeReel(EP_B, 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff');
    assert('attachEpisodeReel still works post-mutations', att === true);
    assert(
        'EP_B reelId after re-attach',
        seriesStore.getEpisodeById(EP_B)?.episode?.reelId ===
            'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
    );

    // Ensure binding path did not wipe EP_A title
    assert(
        'EP_A title remains after unrelated attach',
        seriesStore.getEpisodeById(EP_A)?.episode?.title === 'Synthetic Bound Title'
    );
} finally {
    await vite.close();
}

console.log(failed === 0 ? '\nPASS validate-catalog-control' : `\nFAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
