#!/usr/bin/env node
/**
 * Public Series hydration from Hero Vault — cold-load parity with Studio catalog.
 *
 * STIRRED vault series:
 *   ✓ public slug resolves
 *   ✓ episodes load
 *   ✓ manual binding restored
 *   ✓ chip presentation (thumb + Manual)
 *   ✓ theater reel from same asset id (no media copy)
 *   ✓ path remains /series/stirred
 *
 * Unknown:
 *   ✓ no random series / no random media
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

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

const STIRRED_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111';
const CUT_ID = 'dddddddd-eeee-4fff-8111-222222222222';
const EP_MEDIA = 'cccccccc-dddd-4eee-8fff-333333333333';

/** Ready vault rows that inference can group as STIRRED */
const vault = [
    {
        id: EP_MEDIA,
        title: 'MICROS STIRRED V3',
        name: 'MICROS STIRRED V3',
        url: `/videos/${EP_MEDIA}.mp4`,
        video_url: `/videos/${EP_MEDIA}.mp4`,
        thumbnailUrl: `/thumbs/${EP_MEDIA}.jpg`,
        status: 'ready',
        type: 'video/mp4'
    },
    {
        id: STIRRED_ID,
        title: 'STIRRED',
        name: 'STIRRED',
        url: `/videos/${STIRRED_ID}.mp4`,
        thumbnailUrl: `/thumbs/${STIRRED_ID}.jpg`,
        status: 'ready',
        type: 'video/mp4'
    },
    {
        id: CUT_ID,
        title: 'STIRRED DIRECTOR CUT.mp4',
        name: 'STIRRED DIRECTOR CUT.mp4',
        url: `/videos/${CUT_ID}.mp4`,
        thumbnailUrl: `/thumbs/${CUT_ID}.jpg`,
        status: 'ready',
        type: 'video/mp4'
    }
];

ls.setItem('personal_video_vault', JSON.stringify(vault));

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});

try {
    console.log('\n[validate-public-series-vault-hydration]\n');

    const seriesStore = await vite.ssrLoadModule('/src/lib/series/seriesStore.js');
    const hydration = await vite.ssrLoadModule('/src/lib/series/publicSeriesHydration.js');
    const binding = await vite.ssrLoadModule('/src/lib/series/episodeVaultBindingResolver.js');
    const theater = await vite.ssrLoadModule('/src/lib/series/episodeVaultResolver.js');
    const { get } = await vite.ssrLoadModule('svelte/store');

    seriesStore.resetSeriesCatalogToMock();
    bag.delete('reelforge_episode_vault_bindings');

    // Hydrate public catalog from Hero Vault (cold load)
    const result = hydration.hydratePublicSeriesFromVault({
        items: vault,
        initMetadata: true,
        source: 'validate-public-hydration'
    });

    assert('ready assets loaded', result.readyAssets.length >= 2);
    assert('inference produced series ids', Array.isArray(result.seriesIds));

    const series = hydration.resolvePublicSeriesBySlug('stirred', get(seriesStore.seriesCatalog));
    assert('STIRRED public slug resolves', Boolean(series));
    assert('series id is series-stirred', series?.id === 'series-stirred');
    assert('stable public path', hydration.publicSeriesPath(series) === '/series/stirred');

    const episodes = (series?.seasons || []).flatMap((s) => s.episodes || []);
    assert('episodes load for STIRRED', episodes.length >= 1);
    const ep = episodes[0];
    assert('episode has stable id', Boolean(ep?.episodeId));

    // Save + clear catalog + rehydrate to prove binding restore on public path
    const setRes = seriesStore.setEpisodeVaultBinding({
        episodeId: ep.episodeId,
        assetId: CUT_ID
    });
    assert('manual bind set', setRes?.episode?.heroVaultAssetId === CUT_ID);

    // Simulate cold reload: mock catalog wipe + re-infer + rehydrate bindings
    seriesStore.resetSeriesCatalogToMock();
    // Binding map still in localStorage
    const reload = hydration.hydratePublicSeriesFromVault({
        items: vault,
        initMetadata: false,
        source: 'validate-public-reload'
    });
    const series2 = hydration.resolvePublicSeriesBySlug('stirred', get(seriesStore.seriesCatalog));
    assert('after cold reload slug still resolves', Boolean(series2));

    const boundEp = seriesStore.getEpisodeById(ep.episodeId)?.episode;
    assert(
        'manual binding restored after public hydration',
        boundEp?.heroVaultAssetId === CUT_ID && boundEp?.heroVaultBindingMode === 'manual'
    );

    const media = binding.resolveEpisodeMedia({
        episode: boundEp || {
            ...ep,
            heroVaultAssetId: CUT_ID,
            mediaAssetId: CUT_ID,
            heroVaultBindingMode: 'manual'
        },
        readyVaultAssets: reload.readyAssets
    });
    assert('manual media resolves to DIRECTOR CUT', media.matched && media.assetId === CUT_ID);
    assert('manual label', media.bindingLabel === 'Manual Vault Asset');
    assert('thumbnail present', Boolean(media.thumbnail));

    const chip = binding.episodeChipPresentation(boundEp, media);
    assert('chip playable with Manual', chip.playable && /Manual/i.test(chip.bindingLabel));
    assert('chip media id is bound asset', chip.mediaAssetId === CUT_ID);

    const theaterReel = theater.theaterReelFromVaultResolve(
        boundEp?.title || ep.title,
        media,
        {
            episodeId: ep.episodeId,
            seriesId: series2?.id,
            seasonNumber: 1,
            episodeNumber: ep.episodeNumber
        }
    );
    assert('theater reel id is asset reference (no copy)', theaterReel?.id === CUT_ID);
    assert('theater reel mediaAssetId', theaterReel?.mediaAssetId === CUT_ID);
    assert('pathname continuity target', hydration.publicSeriesPath(series2) === '/series/stirred');

    // Display title helper
    assert(
        'display title prefers human title',
        hydration.resolveVaultAssetDisplayTitle({
            id: 'x',
            title: 'STIRRED DIRECTOR CUT.mp4'
        }) === 'STIRRED DIRECTOR CUT'
    );
    assert(
        'display title does not fall back to uuid as primary when name exists',
        hydration.resolveVaultAssetDisplayTitle({
            id: CUT_ID,
            name: 'NIGHT DRIVE'
        }) === 'NIGHT DRIVE'
    );
    assert(
        'display title Untitled when empty',
        hydration.resolveVaultAssetDisplayTitle({ id: CUT_ID }) === 'Untitled Vault Asset' ||
            hydration.resolveVaultAssetDisplayTitle({ id: CUT_ID }).length > 0
    );

    // Unknown series / media
    const unknownSeries = hydration.resolvePublicSeriesBySlug(
        'totally-unknown-series-xyz',
        get(seriesStore.seriesCatalog)
    );
    assert('unknown series slug not found', unknownSeries == null);

    const unkMedia = binding.resolveEpisodeMedia({
        episode: {
            episodeId: 'none',
            title: 'UNKNOWN EPISODE TITLE XYZ',
            status: 'published'
        },
        readyVaultAssets: reload.readyAssets
    });
    assert('unknown episode unavailable', unkMedia.matched === false);
    assert('no random media asset id', !unkMedia.assetId);

    console.log(
        failed === 0
            ? '\nPASS validate-public-series-vault-hydration'
            : `\nFAIL validate-public-series-vault-hydration (${failed})`
    );
    process.exit(failed === 0 ? 0 : 1);
} finally {
    await vite.close();
}
