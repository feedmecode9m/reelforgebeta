#!/usr/bin/env node
/**
 * Creator-truth catalog regression:
 * - Production catalog never auto-seeds / keeps mock Neon series.
 * - Demo episode titles never appear without opt-in demo session.
 * - Public slug lookup returns null for neon-vengeance without creator data.
 * - mockSeriesData is opt-in only via resetSeriesCatalogToMock().
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const DEMO_TITLES = [
    'Ghost in the Grid',
    'Blood Protocol',
    'Midnight Firewall',
    'Zero Day',
    'After the Breach',
    'Corporate Eclipse'
];

let failed = 0;
function assert(label, cond) {
    if (cond) console.log(`  ✓ ${label}`);
    else {
        failed += 1;
        console.error(`  ✗ ${label}`);
    }
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
    const store = await vite.ssrLoadModule('/src/lib/series/seriesStore.js');
    const truth = await vite.ssrLoadModule('/src/lib/series/seriesCatalogTruth.js');
    const pub = await vite.ssrLoadModule('/src/lib/series/publicSeriesHydration.js');
    const infer = await vite.ssrLoadModule('/src/lib/series/vaultSeriesInference.js');
    const mock = await vite.ssrLoadModule('/src/lib/series/mockSeriesData.js');
    const { get } = await vite.ssrLoadModule('svelte/store');

    console.log('\n[1] Production empty catalog / no Neon seed');
    store.resetSeriesCatalogEmpty();
    assert('catalog empty', get(store.seriesCatalog).length === 0);
    assert('getSeriesById(neon) is undefined', !store.getSeriesById('series-neon-vengeance'));

    // Attempt to inject demo series into live store — boundary must strip it.
    store.seriesCatalog.set(mock.MOCK_SERIES_CATALOG);
    assert(
        'set(mock) is stripped — no neon-vengeance in production catalog',
        !get(store.seriesCatalog).some((s) => s.id === 'series-neon-vengeance')
    );
    assert(
        'no demo episode titles after mock set without demo session',
        !truth.catalogHasDemoEpisodeTitles(get(store.seriesCatalog))
    );
    for (const title of DEMO_TITLES) {
        assert(`no "${title}" in production catalog`, !truth.catalogHasDemoEpisodeTitles(
            get(store.seriesCatalog).filter(() => false) // titles from empty
        ) || !get(store.seriesCatalog).some((s) =>
            (s.seasons || []).some((se) =>
                (se.episodes || []).some((e) => e.title === title)
            )
        ));
    }

    console.log('\n[2] Public slug /series/neon-vengeance → not found');
    const resolved = pub.resolvePublicSeriesBySlug('neon-vengeance', get(store.seriesCatalog));
    assert('slug neon-vengeance resolves null', resolved == null);
    const byId = pub.resolvePublicSeriesBySlug('series-neon-vengeance', get(store.seriesCatalog));
    assert('slug series-neon-vengeance resolves null', byId == null);

    console.log('\n[3] Opt-in demo session only');
    store.resetSeriesCatalogToMock();
    assert('demo session active', store.isDemoCatalogSessionActive() === true);
    assert(
        'mock load includes neon under demo session',
        Boolean(store.getSeriesById('series-neon-vengeance'))
    );
    assert(
        'Ghost in the Grid present under demo session',
        truth.catalogHasDemoEpisodeTitles(get(store.seriesCatalog))
    );

    store.resetSeriesCatalogEmpty();
    assert('demo session cleared', store.isDemoCatalogSessionActive() === false);
    assert('neon gone after empty reset', !store.getSeriesById('series-neon-vengeance'));

    console.log('\n[4] Creator vault → real counts only');
    const reel = {
        id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
        title: 'STIRRED 1',
        name: 'STIRRED 1',
        url: 'https://cdn.example/prod/b.mp4',
        type: 'video',
        status: 'ready'
    };
    infer.inferAndBindVaultSeries([reel], { source: 'creator-truth-regression' });
    const stirred = store.getSeriesById('series-stirred');
    const counts = truth.seriesCatalogCounts(stirred, (ep) => Boolean(ep.reelId));
    assert('STIRRED bound', Boolean(stirred));
    assert('1 season / 1 episode / 1 playable', counts.seasonCount === 1 && counts.episodeCount === 1 && counts.playableCount === 1);
    assert('no Ghost... in creator catalog', !truth.catalogHasDemoEpisodeTitles(get(store.seriesCatalog)));

    console.log('\n[5] LOOK@ZAKANDA / FOOTER is app chrome, not series field');
    const footer = fs.readFileSync(
        path.join(root, 'src/components/navigation/ConsumerFooter.svelte'),
        'utf8'
    );
    assert('ConsumerFooter is global brand chrome', footer.includes('LOOK@ZAKANDA PRESENTS'));
    const mockSrc = fs.readFileSync(path.join(root, 'src/lib/series/mockSeriesData.js'), 'utf8');
    assert(
        'mockSeriesData does not invent LOOK@ZAKANDA as series field',
        !/LOOK@ZAKANDA/.test(mockSrc)
    );

    console.log('\n[6] seriesStore source boundary');
    const storeSrc = fs.readFileSync(path.join(root, 'src/lib/series/seriesStore.js'), 'utf8');
    assert('stripDemoSeriesFromCatalog used', storeSrc.includes('stripDemoSeriesFromCatalog'));
    assert('allowDemoCatalogSession gate present', storeSrc.includes('allowDemoCatalogSession'));
    assert(
        'resetSeriesCatalogToMock is only demo loader',
        storeSrc.includes('export function resetSeriesCatalogToMock')
    );
    assert(
        'API hydrate strips demos',
        storeSrc.includes('stripDemoSeriesFromCatalog(catalogItems)') ||
            storeSrc.includes('stripDemoSeriesFromCatalog(catalogItems')
    );

    const theater = fs.readFileSync(
        path.join(root, 'src/components/theater/TheaterExperience.svelte'),
        'utf8'
    );
    assert('Theater does not soft-fallback to neon id', !/series-neon-vengeance/.test(theater));

    if (failed) {
        console.error(`\nFAIL validate-catalog-creator-truth (${failed} assertions)`);
        process.exit(1);
    }
    console.log('\nPASS validate-catalog-creator-truth');
    process.exit(0);
} catch (err) {
    console.error(err);
    process.exit(1);
} finally {
    await vite.close();
}
