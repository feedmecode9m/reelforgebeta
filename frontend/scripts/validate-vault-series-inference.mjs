#!/usr/bin/env node
/**
 * Regression: STIRRED 1 vault UUID → series catalog resolution.
 * Pure title parse + Vite SSR bind path against seriesStore (no mockSeriesData edits).
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

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});

try {
    const infer = await vite.ssrLoadModule('/src/lib/series/vaultSeriesInference.js');
    const seriesStore = await vite.ssrLoadModule('/src/lib/series/seriesStore.js');
    const { get } = await vite.ssrLoadModule('svelte/store');

    console.log('\n[1] High-confidence title parse');
    const stirred = infer.parseHighConfidenceEpisodeTitle('STIRRED 1');
    assert('STIRRED 1 → series STIRRED', stirred?.seriesTitle === 'STIRRED');
    assert('STIRRED 1 → episode 1', stirred?.episodeNumber === 1);
    assert('STIRRED 2 parses', infer.parseHighConfidenceEpisodeTitle('STIRRED 2')?.episodeNumber === 2);
    assert('reject bare STIRRED', infer.parseHighConfidenceEpisodeTitle('STIRRED') == null);
    assert(
        'S1E2 form',
        infer.parseHighConfidenceEpisodeTitle('Neon S01E02')?.episodeNumber === 2
    );
    assert('UUID title rejected', infer.parseHighConfidenceEpisodeTitle(STIRRED_1_ID) == null);
    assert('isRealVaultUuid', infer.isRealVaultUuid(STIRRED_1_ID));

    console.log('\n[2] Infer + bind STIRRED vault reels');
    // Avoid polluting real localStorage — isolate SSR storage bag.
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
    globalThis.addEventListener = windowShim.addEventListener;

    // Catalog is module-seeded; skip initSeriesMetadata (attaches browser listeners).
    // Infer writes via seriesStore APIs only.
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
        },
        {
            id: '9a1251a2-d6a6-42e5-9fcd-4eca17dcd6ef',
            name: 'STIRRED Motherland V1(1)',
            title: 'STIRRED Motherland V1(1)',
            url: '/videos/9a1251a2-d6a6-42e5-9fcd-4eca17dcd6ef.mp4'
        }
    ];

    const result = infer.inferAndBindVaultSeries(vaultReels, { source: 'validate-script' });
    assert('bound ≥ 2 (STIRRED 1 + STIRRED 2)', result.bound >= 2);
    assert('series-stirred registered', result.seriesIds.includes('series-stirred'));

    const byReel = seriesStore.getEpisodeByReelId(STIRRED_1_ID);
    assert('getEpisodeByReelId(STIRRED_1) hits', Boolean(byReel));
    assert('bound series title STIRRED', byReel?.series?.title === 'STIRRED');
    assert('bound episode number 1', byReel?.episode?.episodeNumber === 1);
    assert('episode.reelId is STIRRED UUID', byReel?.episode?.reelId === STIRRED_1_ID);

    const ctx = seriesStore.resolveSeriesContextForReel({
        id: STIRRED_1_ID,
        name: 'STIRRED 1',
        url: `/videos/${STIRRED_1_ID}.mp4`
    });
    assert('resolveSeriesContextForReel(STIRRED_1)', Boolean(ctx));
    assert('context series is STIRRED not Neon', ctx?.series?.title === 'STIRRED');
    assert(
        'context is not neon-vengeance',
        ctx?.series?.id !== 'series-neon-vengeance'
    );

    // Catalog still includes mock seed unchanged
    const neon = seriesStore.getSeriesById('series-neon-vengeance');
    assert('mock Neon Vengeance preserved', Boolean(neon));
    const stirredSeries = seriesStore.getSeriesById('series-stirred');
    assert('STIRRED series in catalog', Boolean(stirredSeries));

    console.log('\n[3] Theater fallback contract (logic unit)');
    // Mirror TheaterExperience drawer guard
    function resolveDrawerSeriesId(activeReel, seriesContext) {
        const seriesId = seriesContext?.series?.id ?? '';
        if (seriesId && seriesStore.getSeriesById(seriesId)) return seriesId;
        const reelId = activeReel?.id == null ? '' : String(activeReel.id);
        if (reelId) {
            const hit = seriesStore.getEpisodeByReelId(reelId);
            if (hit?.series?.id && seriesStore.getSeriesById(hit.series.id)) return hit.series.id;
        }
        if (reelId && infer.isRealVaultUuid(reelId)) return '';
        if (activeReel?.isPersonalVideo) return '';
        if (seriesStore.getSeriesById('series-neon-vengeance')) return 'series-neon-vengeance';
        return '';
    }

    const boundDrawer = resolveDrawerSeriesId({ id: STIRRED_1_ID }, ctx);
    assert('Theater drawer uses series-stirred when bound', boundDrawer === 'series-stirred');

    // Unbound vault UUID never falls back to Neon
    const phantomId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
    const unboundDrawer = resolveDrawerSeriesId({ id: phantomId, isPersonalVideo: true }, null);
    assert('Unbound vault UUID never Neon', unboundDrawer === '');

    const catalog = get(seriesStore.seriesCatalog);
    const stirredEpisodes = (stirredSeries?.seasons || []).flatMap((s) => s.episodes || []);
    console.log('\nResult summary:', {
        inferredBound: result.bound,
        stirredEpisodeCount: stirredEpisodes.length,
        catalogSeriesCount: catalog.length,
        STIRRED_1: {
            episodeId: byReel?.episode?.episodeId,
            reelId: byReel?.episode?.reelId
        }
    });
} finally {
    await vite.close();
}

console.log(failed === 0 ? '\nPASS validate-vault-series-inference' : `\nFAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
