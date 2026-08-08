#!/usr/bin/env node
/**
 * Phase 2 Creator Catalog panel — series-first selection + mutation integration.
 * Exercises the same store APIs the UI calls (no Playwright).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const STIRRED_SERIES = 'series-stirred';
const STIRRED_EP = 'ep-stirred-s01e01';
const STIRRED_REEL = '35a78285-5611-47b1-a279-9ffaaa64315b';
const EP_2 = 'ep-stirred-s01e02';
const REEL_2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

let failed = 0;
function assert(label, cond) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}`);
}

/**
 * Mirrors CreatorCatalogPanel resolveDefaultSeriesId preference order.
 * @param {Array<{ id: string; tags?: string[]; description?: string }>} catalog
 * @param {string} preferred
 */
function resolveDefaultSeriesId(catalog, preferred) {
    const list = Array.isArray(catalog) ? catalog : [];
    if (!list.length) return '';
    const pref = String(preferred || '').trim();
    if (pref && list.some((s) => s.id === pref)) return pref;
    const tagged = list.find(
        (s) => Array.isArray(s.tags) && s.tags.includes('vault-inferred')
    );
    if (tagged) return tagged.id;
    const stirred = list.find((s) => String(s.id || '').startsWith('series-stirred'));
    if (stirred) return stirred.id;
    const nonDemo = list.find((s) => !String(s.id || '').includes('neon-vengeance'));
    return (nonDemo || list[0]).id;
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

    console.log('\n[creator-catalog-panel] seed STIRRED + mock catalog');
    seriesStore.resetSeriesCatalogToMock();
    bag.clear();

    seriesStore.seriesCatalog.update((items) => {
        if (items.some((s) => s.id === STIRRED_SERIES)) return items;
        return [
            ...items,
            {
                id: STIRRED_SERIES,
                title: 'STIRRED',
                description: 'Vault-inferred series: STIRRED',
                tags: ['vault-inferred'],
                seasons: [
                    {
                        seasonId: 'season-stirred-1',
                        seasonNumber: 1,
                        title: 'Season 1',
                        episodes: [
                            {
                                episodeId: STIRRED_EP,
                                episodeNumber: 1,
                                title: 'MICROS STIRRED V1',
                                description: '',
                                status: 'published',
                                reelId: STIRRED_REEL,
                                tags: ['vault-inferred']
                            },
                            {
                                episodeId: EP_2,
                                episodeNumber: 2,
                                title: 'STIRRED 2',
                                description: '',
                                status: 'published',
                                reelId: REEL_2,
                                tags: ['vault-inferred']
                            }
                        ]
                    }
                ]
            }
        ];
    });

    const catalog = get(seriesStore.seriesCatalog);
    assert('catalog includes STIRRED', catalog.some((s) => s.id === STIRRED_SERIES));
    assert('catalog still includes Neon (not removed)', catalog.some((s) => s.id === 'series-neon-vengeance'));

    const defaultId = resolveDefaultSeriesId(catalog, '');
    assert(
        'default series resolves to STIRRED without preferred Neon',
        defaultId === STIRRED_SERIES
    );
    assert(
        'default is not Neon-only',
        defaultId !== 'series-neon-vengeance'
    );

    const preferredNeon = resolveDefaultSeriesId(catalog, 'series-neon-vengeance');
    assert(
        'preferredSeriesId can still select Neon when host asks',
        preferredNeon === 'series-neon-vengeance'
    );

    const ep = seriesStore.getEpisodeById(STIRRED_EP);
    assert('ep-stirred-s01e01 selectable via catalog', Boolean(ep?.episode));
    assert('ep-stirred-s01e01 reel bound', ep?.episode?.reelId === STIRRED_REEL);
    assert('ep series is series-stirred', ep?.series?.id === STIRRED_SERIES);

    console.log('\n[creator-catalog-panel] mutations as panel Save/reorder would call');
    const saved = seriesStore.updateCatalogEpisode(STIRRED_EP, {
        title: 'STIRRED 1',
        description: 'Panel save path',
        status: 'draft'
    });
    assert('title edit via updateCatalogEpisode', saved?.episode?.title === 'STIRRED 1');
    assert('status draft via updateCatalogEpisode', saved?.episode?.status === 'draft');
    assert('reelId preserved after panel-style save', saved?.episode?.reelId === STIRRED_REEL);

    const republished = seriesStore.setEpisodeStatus(STIRRED_EP, 'published');
    assert('status published via setEpisodeStatus', republished?.episode?.status === 'published');

    const season = seriesStore.getSeasonByNumber(STIRRED_SERIES, 1)?.season;
    const ordered = [...(season?.episodes || [])]
        .sort((a, b) => a.episodeNumber - b.episodeNumber)
        .map((e) => e.episodeId);
    assert('two-episode season for reorder', ordered.length === 2);
    const swapped = [ordered[1], ordered[0]];
    assert(
        'reorderEpisodesInSeason succeeds',
        seriesStore.reorderEpisodesInSeason(STIRRED_SERIES, 1, swapped) === true
    );
    const ep1After = seriesStore.getEpisodeById(STIRRED_EP);
    assert('STIRRED ep episodeId preserved', ep1After?.episode?.episodeId === STIRRED_EP);
    assert('STIRRED ep reelId preserved', ep1After?.episode?.reelId === STIRRED_REEL);
    assert(
        'STIRRED ep episodeNumber flipped to 2',
        ep1After?.episode?.episodeNumber === 2
    );

    const neonStill = seriesStore.getEpisodeById('ep-neon-s01e01');
    assert('mock Neon episode identity untouched', Boolean(neonStill?.episode));
} finally {
    await vite.close();
}

console.log(failed === 0 ? '\nPASS validate-creator-catalog-panel' : `\nFAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
