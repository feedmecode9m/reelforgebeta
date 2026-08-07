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

    console.log('\n[runtime] normalizeVaultTitle + prod naming');
    const norm = infer.normalizeVaultTitle('MICROS STIRRED V1');
    assert('normalize seriesTitle STIRRED', norm?.seriesTitle === 'STIRRED');
    assert('normalize season 1', Number(norm?.seasonNumber) === 1);
    assert('normalize episode 1', Number(norm?.episodeNumber) === 1);
    assert(
        'normalize confidence',
        norm?.confidence === 'normalized-prefix-version'
    );
    assert('normalize rawTitle preserved', norm?.rawTitle === 'MICROS STIRRED V1');
    assert('normalize normalizedTitle', norm?.normalizedTitle === 'STIRRED');
    assert('accept MICROS STIRRED V2', infer.normalizeVaultTitle('MICROS STIRRED V2')?.episodeNumber === 2);
    assert('reject MICROS STIRRED (no version)', infer.normalizeVaultTitle('MICROS STIRRED') == null);
    assert(
        'reject STIRRED DOCUMENTARY',
        infer.normalizeVaultTitle('STIRRED DOCUMENTARY') == null
    );
    assert(
        'reject STIRRED V1 (no production prefix)',
        infer.normalizeVaultTitle('STIRRED V1') == null
    );
    // Explicit patterns still win before normalize
    const parenPath = infer.parseHighConfidenceEpisodeTitle('MICROS Motherland V1(1)');
    assert(
        'parens path stays version-paren-ep (not normalize)',
        parenPath?.confidence === 'version-paren-ep'
    );

    console.log('\n[runtime] MICROS STIRRED V1 vault UUID bind');
    bag.clear();
    // Fresh module path isn’t practical; clear map via save + re-infer after
    // stripping prior catalog reel binds by rebinding from empty metadata bag.
    for (const k of [...bag.keys()]) bag.delete(k);
    const prodReel = {
        id: STIRRED_1_ID,
        name: 'MICROS STIRRED V1',
        title: 'MICROS STIRRED V1',
        url: `https://pub.example/prod/${STIRRED_1_ID}.mp4`,
        thumbnailUrl: `/thumbs/${STIRRED_1_ID}.jpg`
    };
    // Prior STIRRED 1 bind already holds this reelId — detach is N/A; re-save is skipped
    // if already bound. Force re-bind only when unbound: clear catalog reelId if present.
    const prior = seriesStore.getEpisodeByReelId(STIRRED_1_ID);
    if (prior?.episode?.episodeId) {
        // Detach by overwriting episode reel via attach null path: overwrite metadata map
        // and catalog entry so isReelAlreadySeriesBound allows re-infer
        seriesStore.saveReelSeriesMetadata(STIRRED_1_ID, {
            reelId: STIRRED_1_ID,
            seriesId: '',
            seriesName: '',
            seasonNumber: 0,
            episodeNumber: 0,
            episodeTitle: '',
            episodeId: '',
            episodeStatus: ''
        });
        seriesStore.seriesCatalog.update((items) =>
            items.map((s) => ({
                ...s,
                seasons: (s.seasons || []).map((se) => ({
                    ...se,
                    episodes: (se.episodes || []).map((ep) =>
                        ep.reelId === STIRRED_1_ID ? { ...ep, reelId: null } : ep
                    )
                }))
            }))
        );
    }
    const prodResult = infer.inferAndBindVaultSeries([prodReel], {
        source: 'runtime-validate-prod-title'
    });
    assert('prod title bound ≥ 1', prodResult.bound >= 1);
    const prodMeta =
        loadReelSeriesMetadataMap()[STIRRED_1_ID] ||
        get(seriesStore.reelSeriesMetadata)[STIRRED_1_ID];
    assert('prod meta series-stirred', prodMeta?.seriesId === 'series-stirred');
    assert('prod meta ep-stirred-s01e01', prodMeta?.episodeId === 'ep-stirred-s01e01');
    assert('prod meta reelId UUID', prodMeta?.reelId === STIRRED_1_ID);
    const prodByReel = seriesStore.getEpisodeByReelId(STIRRED_1_ID);
    assert('prod byReel series-stirred', prodByReel?.series?.id === 'series-stirred');
    assert(
        'prod byReel ep-stirred-s01e01',
        prodByReel?.episode?.episodeId === 'ep-stirred-s01e01'
    );
    assert('prod byReel.reelId UUID', prodByReel?.episode?.reelId === STIRRED_1_ID);

    console.log('\nSummary', {
        seriesId: prodByReel?.series?.id || ctx?.series?.id,
        episodeId: prodByReel?.episode?.episodeId || ctx?.episode?.episodeId,
        mediaId: STIRRED_1_ID,
        metadata: prodMeta || meta
    });
} finally {
    await vite.close();
}

console.log(failed === 0 ? '\nPASS validate-vault-series-runtime' : `\nFAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
