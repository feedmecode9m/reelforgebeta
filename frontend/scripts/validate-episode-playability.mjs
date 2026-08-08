#!/usr/bin/env node
/**
 * Phase 3 — Theater publish truth / episode status gating.
 * STIRRED: bind → draft blocks resolve → publish restores SERIES_MEDIA_MATCH / load path.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const STIRRED_SERIES = 'series-stirred';
const STIRRED_EP = 'ep-stirred-s01e01';
const STIRRED_REEL = '35a78285-5611-47b1-a279-9ffaaa64315b';
const STIRRED_2_EP = 'ep-stirred-s01e02';
const STIRRED_2_REEL = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

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

/** Capture console.info for diag contracts */
const logs = [];
const origInfo = console.info.bind(console);
console.info = (...args) => {
    logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    origInfo(...args);
};

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});

function hasLog(substr) {
    return logs.some((line) => line.includes(substr));
}

function clearLogs() {
    logs.length = 0;
}

try {
    const seriesStore = await vite.ssrLoadModule('/src/lib/series/seriesStore.js');
    const episodeBridge = await vite.ssrLoadModule('/src/lib/series/episodeBridge.js');
    const episodeNav = await vite.ssrLoadModule('/src/lib/series/episodeNavigation.js');
    const { episodeIsPlayable } = await vite.ssrLoadModule('/src/lib/series/seriesTypes.js');
    const { get } = await vite.ssrLoadModule('svelte/store');

    console.log('\n[playability] bind STIRRED catalog episode with media');
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
                                episodeId: STIRRED_2_EP,
                                episodeNumber: 2,
                                title: 'STIRRED 2',
                                description: '',
                                status: 'published',
                                reelId: STIRRED_2_REEL,
                                tags: ['vault-inferred']
                            }
                        ]
                    }
                ]
            }
        ];
    });

    const feed = {
        [STIRRED_REEL]: {
            id: STIRRED_REEL,
            name: 'MICROS STIRRED V1',
            url: `https://cdn.example/prod/${STIRRED_REEL}.mp4`,
            thumbnailUrl: `/thumbs/${STIRRED_REEL}.jpg`
        },
        [STIRRED_2_REEL]: {
            id: STIRRED_2_REEL,
            name: 'STIRRED 2',
            url: `https://cdn.example/prod/${STIRRED_2_REEL}.mp4`
        }
    };
    const findReel = (id) => feed[id] || null;
    const allReels = () => Object.values(feed);

    clearLogs();
    let resolved = episodeBridge.resolveReelForEpisode(STIRRED_EP, findReel, allReels);
    assert('published STIRRED resolves media', resolved?.id === STIRRED_REEL);
    assert('SERIES_MEDIA_MATCH emitted for published', hasLog('SERIES_MEDIA_MATCH'));
    assert('matchedSource catalog.reelId (published)', hasLog('catalog.reelId'));

    console.log('\n[playability] Creator Catalog → set draft');
    seriesStore.setEpisodeStatus(STIRRED_EP, 'draft');
    const draftEp = seriesStore.getEpisodeById(STIRRED_EP)?.episode;
    assert('episodeIsPlayable false when draft', episodeIsPlayable(draftEp) === false);

    clearLogs();
    resolved = episodeBridge.resolveReelForEpisode(STIRRED_EP, findReel, allReels);
    assert('draft resolve returns null (no media)', resolved == null);
    assert('no SERIES_MEDIA_MATCH on draft', !hasLog('SERIES_MEDIA_MATCH'));
    assert('EPISODE_PLAYABILITY_BLOCKED draft logged', hasLog('EPISODE_PLAYABILITY_BLOCKED'));
    assert('block reason draft', hasLog('"reason":"draft"') || hasLog('draft'));

    /** Forced drawer-style navigation must not load media */
    let openedReelId = null;
    episodeNav.configureEpisodeNavigation({
        findReelInFeed: findReel,
        getAllFeedReels: allReels,
        getCurrentEpisodeId: () => null,
        openTheaterReel: (reel) => {
            openedReelId = reel?.id || null;
        }
    });
    clearLogs();
    openedReelId = null;
    const draftNav = episodeNav.navigateFromDrawer(STIRRED_EP);
    assert('navigateFromDrawer returns false for draft', draftNav === false);
    assert('openTheaterReel not called for draft', openedReelId == null);
    assert(
        'no successful THEATER_EPISODE_LOAD with mediaId for draft',
        !logs.some((line) => line.includes('THEATER_EPISODE_LOAD') && line.includes(STIRRED_REEL))
    );

    console.log('\n[playability] archived also blocked');
    seriesStore.setEpisodeStatus(STIRRED_EP, 'archived');
    clearLogs();
    resolved = episodeBridge.resolveReelForEpisode(STIRRED_EP, findReel, allReels);
    assert('archived resolve null', resolved == null);
    assert('block reason archived', hasLog('EPISODE_PLAYABILITY_BLOCKED'));

    console.log('\n[playability] republish restores resolve + nav load');
    seriesStore.setEpisodeStatus(STIRRED_EP, 'published');
    clearLogs();
    resolved = episodeBridge.resolveReelForEpisode(STIRRED_EP, findReel, allReels);
    assert('republished resolve media', resolved?.id === STIRRED_REEL);
    assert('SERIES_MEDIA_MATCH after republish', hasLog('SERIES_MEDIA_MATCH'));
    assert('matchedSource catalog.reelId after republish', hasLog('catalog.reelId'));

    clearLogs();
    openedReelId = null;
    const pubNav = episodeNav.navigateFromDrawer(STIRRED_EP);
    assert('navigateFromDrawer true when published', pubNav === true);
    assert('openTheaterReel got STIRRED reel', openedReelId === STIRRED_REEL);
    assert('THEATER_EPISODE_LOAD with ep-stirred-s01e01', hasLog('THEATER_EPISODE_LOAD') && hasLog(STIRRED_EP));

    console.log('\n[playability] getNextEpisode skips draft neighbors');
    // Mark E2 as playable; make a synthetic gap by draft-ing E1 and navigating from before... 
    // From E1 published → E2 if E2 playable
    seriesStore.setEpisodeStatus(STIRRED_EP, 'published');
    seriesStore.setEpisodeStatus(STIRRED_2_EP, 'draft');
    const nextFrom1 = seriesStore.getNextEpisode(STIRRED_EP);
    assert('next skips draft E2 when only E2 remains non-playable', nextFrom1 == null);

    seriesStore.setEpisodeStatus(STIRRED_2_EP, 'published');
    const nextPublished = seriesStore.getNextEpisode(STIRRED_EP);
    assert('next returns playable E2', nextPublished?.episode?.episodeId === STIRRED_2_EP);

    // Middle draft: E1 published, set E2 draft temporarily isn't middle. Reorder conceptually:
    // Use Neon season which has draft ep-neon-s01e04 at end — next from e03 should skip draft if no more, or find published after
    const neonE3 = 'ep-neon-s01e03';
    const afterE3 = seriesStore.getNextEpisode(neonE3);
    // ep-neon-s01e04 is draft in mock — should skip / null
    if (afterE3) {
        assert(
            'getNextEpisode never returns non-playable',
            episodeIsPlayable(afterE3.episode)
        );
    } else {
        assert('getNextEpisode skips trailing draft (null)', true);
    }

    // catalog still holds STIRRED after mutations
    assert(
        'catalog still has series-stirred',
        get(seriesStore.seriesCatalog).some((s) => s.id === STIRRED_SERIES)
    );
} finally {
    console.info = origInfo;
    await vite.close();
}

console.log(failed === 0 ? '\nPASS validate-episode-playability' : `\nFAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
