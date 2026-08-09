#!/usr/bin/env node
/**
 * Episode Hero Vault binding persistence + shared ready source validation.
 *
 * PASS: save manual binding → rehydrate store → binding remains
 * PASS: public/picker share getReadyHeroVaultAssets
 * PASS: manual asset removed → auto fallback (no orphan media id)
 * PASS: unknown episode → unavailable
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
const EP_ID = 'ep-neon-s01e01';

const readyVault = [
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
    },
    {
        id: 'local-pending-xx',
        title: 'PENDING',
        url: 'blob:http://x/y',
        status: 'pending',
        type: 'video/mp4'
    }
];

// Seed personal vault for getReadyHeroVaultAssets (reads localStorage)
ls.setItem('personal_video_vault', JSON.stringify(readyVault));

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});

try {
    console.log('\n[validate-episode-vault-persistence]\n');

    const seriesStore = await vite.ssrLoadModule('/src/lib/series/seriesStore.js');
    const storage = await vite.ssrLoadModule('/src/lib/series/episodeVaultBindingStorage.js');
    const binding = await vite.ssrLoadModule('/src/lib/series/episodeVaultBindingResolver.js');
    const source = await vite.ssrLoadModule('/src/lib/series/heroVaultAssetSource.js');
    const { get } = await vite.ssrLoadModule('svelte/store');

    seriesStore.resetSeriesCatalogToMock();
    bag.delete(storage.EPISODE_VAULT_BINDING_STORAGE_KEY);
    // re-seed vault after clear of all? bag still has vault key

    // --- save + reload store ---
    const setRes = seriesStore.setEpisodeVaultBinding({ episodeId: EP_ID, assetId: CUT_ID });
    assert('setEpisodeVaultBinding returns', Boolean(setRes?.episode));
    assert('in-memory heroVaultAssetId', setRes.episode.heroVaultAssetId === CUT_ID);
    assert('in-memory mediaAssetId', setRes.episode.mediaAssetId === CUT_ID);
    assert('in-memory bindingMode manual', setRes.episode.heroVaultBindingMode === 'manual');

    const rawMap = ls.getItem(storage.EPISODE_VAULT_BINDING_STORAGE_KEY);
    assert('localStorage binding key written', Boolean(rawMap));
    const parsed = JSON.parse(rawMap || '{}');
    assert(
        'persisted record present',
        parsed[EP_ID]?.heroVaultAssetId === CUT_ID &&
            parsed[EP_ID]?.mediaAssetId === CUT_ID &&
            parsed[EP_ID]?.heroVaultBindingMode === 'manual'
    );

    // Simulate reload: reset catalog to mock (clears in-memory), rehydrate from storage
    seriesStore.resetSeriesCatalogToMock();
    const afterReset = seriesStore.getEpisodeById(EP_ID)?.episode;
    assert(
        'after resetSeriesCatalogToMock binding rehydrated',
        afterReset?.heroVaultAssetId === CUT_ID &&
            afterReset?.mediaAssetId === CUT_ID &&
            afterReset?.heroVaultBindingMode === 'manual'
    );

    // Fresh rehydrate call path
    seriesStore.seriesCatalog.set(
        get(seriesStore.seriesCatalog).map((s) => ({
            ...s,
            seasons: s.seasons.map((se) => ({
                ...se,
                episodes: se.episodes.map((ep) =>
                    ep.episodeId === EP_ID
                        ? {
                              ...ep,
                              heroVaultAssetId: undefined,
                              mediaAssetId: undefined,
                              heroVaultBindingMode: undefined
                          }
                        : ep
                )
            }))
        }))
    );
    seriesStore.rehydrateEpisodeVaultBindings();
    const afterHydrate = seriesStore.getEpisodeById(EP_ID)?.episode;
    assert(
        'rehydrateEpisodeVaultBindings restores fields',
        afterHydrate?.heroVaultAssetId === CUT_ID && afterHydrate?.mediaAssetId === CUT_ID
    );

    // --- shared ready source ---
    const pickerReady = source.getReadyHeroVaultAssets({ items: readyVault });
    const publicReady = source.getReadyHeroVaultAssets({ items: readyVault });
    assert('picker ready count excludes pending', pickerReady.length === 2);
    assert(
        'picker and public same ids',
        pickerReady.map((a) => a.id).join() === publicReady.map((a) => a.id).join()
    );
    assert(
        'no blob in ready source',
        pickerReady.every((a) => !String(a.url || '').startsWith('blob:'))
    );

    // With storage vault via load path
    const fromVault = source.getReadyHeroVaultAssets();
    assert('canonical load sees ready vault ids', fromVault.some((a) => a.id === CUT_ID));
    assert(
        'public resolver same cut id as picker',
        fromVault.some((a) => a.id === CUT_ID) && pickerReady.some((a) => a.id === CUT_ID)
    );

    // --- resolve manual after reload shape ---
    const epBound = seriesStore.getEpisodeById(EP_ID)?.episode;
    const rManual = binding.resolveEpisodeMedia({
        episode: { ...epBound, title: 'STIRRED 1' },
        readyVaultAssets: pickerReady
    });
    assert('manual resolve uses CUT', rManual.matched && rManual.assetId === CUT_ID);
    assert('manual label', rManual.bindingLabel === 'Manual Vault Asset');
    const chipManual = binding.episodeChipPresentation(epBound, rManual);
    assert('chip manual playable', chipManual.playable && chipManual.mediaAssetId === CUT_ID);

    // --- stale manual → auto, no orphan media ---
    const rStale = binding.resolveEpisodeMedia({
        episode: {
            ...epBound,
            title: 'STIRRED 1',
            heroVaultAssetId: 'gone-missing-id',
            mediaAssetId: 'gone-missing-id',
            heroVaultBindingMode: 'manual'
        },
        readyVaultAssets: pickerReady
    });
    assert('stale falls back auto matched', rStale.matched && rStale.bindingMode === 'auto');
    assert('stale picks STIRRED family', rStale.assetId === STIRRED_ID);
    assert('staleManualCleared flag', rStale.staleManualCleared === true);
    const chipStale = binding.episodeChipPresentation(epBound, rStale);
    assert(
        'chip not orphaning gone id',
        chipStale.mediaAssetId === STIRRED_ID && chipStale.bindingLabel === 'Auto matched'
    );

    // Fully unmatched (no stale id presentation)
    const rNone = binding.resolveEpisodeMedia({
        episode: {
            episodeId: 'x',
            title: 'UNKNOWN EPISODE TITLE',
            status: 'published',
            mediaAssetId: 'orphan-should-ignore',
            heroVaultAssetId: null
        },
        readyVaultAssets: pickerReady
    });
    assert('unknown unmatched', rNone.matched === false);
    assert('unknown unavailable label', rNone.bindingLabel === 'Asset unavailable');
    const chipNone = binding.episodeChipPresentation(null, rNone);
    assert('unknown chip no mediaAssetId', chipNone.mediaAssetId == null && !chipNone.playable);

    // clear binding persists
    seriesStore.clearEpisodeVaultBinding({ episodeId: EP_ID });
    const afterClear = seriesStore.getEpisodeById(EP_ID)?.episode;
    assert('clear nulls heroVaultAssetId', afterClear?.heroVaultAssetId == null);
    assert('clear nulls mediaAssetId', afterClear?.mediaAssetId == null);
    seriesStore.resetSeriesCatalogToMock();
    const afterClearReload = seriesStore.getEpisodeById(EP_ID)?.episode;
    assert(
        'after clear reload no manual id',
        !afterClearReload?.heroVaultAssetId && afterClearReload?.heroVaultBindingMode !== 'manual'
    );

    console.log(failed === 0 ? '\nPASS validate-episode-vault-persistence' : `\nFAIL (${failed})`);
    process.exit(failed === 0 ? 0 : 1);
} finally {
    await vite.close();
}
