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

    // Franchise grouping requirements
    const motherland = infer.parseHighConfidenceEpisodeTitle('STIRRED 2 Motherland');
    assert('STIRRED 2 Motherland → series STIRRED', motherland?.seriesTitle === 'STIRRED');
    assert('STIRRED 2 Motherland → episode 2', motherland?.episodeNumber === 2);
    assert(
        'STIRRED 2 Motherland preserves episode title',
        motherland?.episodeTitle === 'STIRRED 2 Motherland'
    );

    const v1 = infer.parseHighConfidenceEpisodeTitle('STIRRED V1');
    assert('STIRRED V1 → series STIRRED', v1?.seriesTitle === 'STIRRED');
    assert('STIRRED V1 → episode 1', v1?.episodeNumber === 1);
    assert('STIRRED V1 preserves episode title', v1?.episodeTitle === 'STIRRED V1');

    const v3 = infer.parseHighConfidenceEpisodeTitle('STIRRED V3');
    assert('STIRRED V3 → series STIRRED', v3?.seriesTitle === 'STIRRED');
    assert('STIRRED V3 → episode 3', v3?.episodeNumber === 3);

    const microsV3 = infer.parseHighConfidenceEpisodeTitle('MICROS STIRRED V3');
    assert('MICROS STIRRED V3 → series STIRRED', microsV3?.seriesTitle === 'STIRRED');
    assert('MICROS STIRRED V3 → episode 3', microsV3?.episodeNumber === 3);

    // Episode décor must not become a series
    assert(
        'MICROS Motherland V1 does not create Motherland series',
        infer.parseHighConfidenceEpisodeTitle('MICROS Motherland V1') == null
    );

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
        },
        {
            id: '11111111-2222-4333-8444-555555555555',
            name: 'STIRRED 2 Motherland',
            title: 'STIRRED 2 Motherland',
            url: '/videos/11111111-2222-4333-8444-555555555555.mp4'
        },
        {
            id: '22222222-3333-4444-8555-666666666666',
            name: 'STIRRED V1',
            title: 'STIRRED V1',
            url: '/videos/22222222-3333-4444-8555-666666666666.mp4'
        },
        {
            id: '33333333-4444-4555-8666-777777777777',
            name: 'STIRRED V3',
            title: 'STIRRED V3',
            url: '/videos/33333333-4444-4555-8666-777777777777.mp4'
        }
    ];

    const result = infer.inferAndBindVaultSeries(vaultReels, { source: 'validate-script' });
    assert('bound ≥ 3 (STIRRED group)', result.bound >= 3);
    assert('series-stirred registered', result.seriesIds.includes('series-stirred'));
    assert(
        'does not invent motherland series id',
        !result.seriesIds.some((id) => /motherland/i.test(id))
    );

    const stirredSeriesAfter = seriesStore.getSeriesById('series-stirred');
    const stirredTitles = (stirredSeriesAfter?.seasons || [])
        .flatMap((s) => s.episodes || [])
        .map((e) => e.title);
    assert(
        'catalog has STIRRED 2 Motherland',
        stirredTitles.some((t) => /STIRRED 2 Motherland/i.test(String(t)))
    );
    assert(
        'catalog has STIRRED V1 human title',
        stirredTitles.some((t) => String(t).trim() === 'STIRRED V1')
    );
    assert(
        'catalog has STIRRED V3 human title',
        stirredTitles.some((t) => String(t).trim() === 'STIRRED V3')
    );
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

    // Catalog no longer auto-seeds demo Neon Vengeance
    const neon = seriesStore.getSeriesById('series-neon-vengeance');
    assert('mock Neon Vengeance not auto-seeded', !neon);
    const stirredSeries = seriesStore.getSeriesById('series-stirred');
    assert('STIRRED series in catalog', Boolean(stirredSeries));
    assert(
        'inferred series description is empty (no marketing blurbs)',
        !String(stirredSeries?.description || '').trim() ||
            !/^Vault-inferred/i.test(String(stirredSeries?.description || ''))
    );
    assert('inferred series has no genre preset', !String(stirredSeries?.genre || '').trim());

    console.log('\n[3] Theater fallback contract (logic unit)');
    // Mirror TheaterExperience drawer guard (creator-bound only — no demo fallback)
    function resolveDrawerSeriesId(activeReel, seriesContext) {
        const seriesId = seriesContext?.series?.id ?? '';
        if (seriesId && seriesStore.getSeriesById(seriesId)) return seriesId;
        const reelId = activeReel?.id == null ? '' : String(activeReel.id);
        if (reelId) {
            const hit = seriesStore.getEpisodeByReelId(reelId);
            if (hit?.series?.id && seriesStore.getSeriesById(hit.series.id)) return hit.series.id;
        }
        return '';
    }

    const boundDrawer = resolveDrawerSeriesId({ id: STIRRED_1_ID }, ctx);
    assert('Theater drawer uses series-stirred when bound', boundDrawer === 'series-stirred');

    // Unbound vault UUID never falls back to Neon
    const phantomId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
    const unboundDrawer = resolveDrawerSeriesId({ id: phantomId, isPersonalVideo: true }, null);
    assert('Unbound vault UUID never Neon', unboundDrawer === '');

    console.log('\n[4] Image vault → Theater media contract');
    const epVault = await vite.ssrLoadModule('/src/lib/series/episodeVaultResolver.js');
    const imageResolved = {
        matched: true,
        assetId: '9cb18bee-c035-42e8-88ff-f3ab5bdc0e24',
        thumbnail: 'https://cdn.example/thumbs/x.png',
        mediaUrl: 'https://cdn.example/thumbs/x.png',
        type: /** @type {'image'} */ ('image'),
        title: 'Vault Poster',
        keywords: ['vault', 'poster'],
        matchTier: 'primary',
        score: 1000
    };
    const imageReel = epVault.theaterReelFromVaultResolve('Vault Poster', imageResolved, {
        episodeId: 'ep-stirred-s01e01',
        seriesId: 'series-stirred',
        seasonNumber: 1,
        episodeNumber: 1
    });
    assert('image reel has mediaAssetId', imageReel?.mediaAssetId === imageResolved.assetId);
    assert('image reel has mediaType image', imageReel?.mediaType === 'image');
    assert('image reel has src', imageReel?.src === imageResolved.mediaUrl);
    assert(
        'image reel has thumbnailUrl',
        imageReel?.thumbnailUrl === imageResolved.thumbnail ||
            imageReel?.thumbnailUrl === imageResolved.mediaUrl
    );
    assert('image reel url equals src', imageReel?.url === imageReel?.src);

    const catalog = get(seriesStore.seriesCatalog);
    const stirredEpisodes = (stirredSeries?.seasons || []).flatMap((s) => s.episodes || []);
    console.log('\nResult summary:', {
        inferredBound: result.bound,
        stirredEpisodeCount: stirredEpisodes.length,
        catalogSeriesCount: catalog.length,
        STIRRED_1: {
            episodeId: byReel?.episode?.episodeId,
            reelId: byReel?.episode?.reelId
        },
        stirredTitles
    });
} finally {
    await vite.close();
}

console.log(failed === 0 ? '\nPASS validate-vault-series-inference' : `\nFAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
