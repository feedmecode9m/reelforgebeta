#!/usr/bin/env node
/** Publishing lifecycle discoverability. */
import { createServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else console.log(`  ok: ${msg}`);
}

const bag = new Map();
globalThis.localStorage = {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => bag.set(String(k), String(v)),
    removeItem: (k) => bag.delete(k),
    clear: () => bag.clear()
};
globalThis.window = {
    localStorage: globalThis.localStorage,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true
};

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});
try {
    const life = await vite.ssrLoadModule('/src/lib/series/publishingLifecycle.js');
    const store = await vite.ssrLoadModule('/src/lib/series/seriesStore.js');
    const {
        buildSeriesViewFromRelated,
        resolveRelatedEpisodes
    } = await vite.ssrLoadModule('/src/lib/series/resolveRelatedEpisodes.js');

    assert(life.episodeIsViewerDiscoverable({ status: 'draft' }) === false, 'draft hidden');
    assert(life.episodeIsViewerDiscoverable({ status: 'ready' }) === false, 'ready not discoverable');
    assert(life.episodeIsViewerDiscoverable({ status: 'published' }) === true, 'published visible');
    assert(life.episodeIsViewerDiscoverable({ status: 'archived' }) === false, 'archived removed');

    store.seriesCatalog.set([
        {
            id: 'series-pub',
            title: 'STIRRED',
            seasons: [
                {
                    seasonNumber: 1,
                    episodes: [
                        {
                            episodeId: 'd',
                            episodeNumber: 1,
                            title: 'Draft',
                            status: 'draft',
                            reelId: 'r-d',
                            mediaAssetId: 'r-d'
                        },
                        {
                            episodeId: 'rdy',
                            episodeNumber: 2,
                            title: 'Ready',
                            status: 'ready',
                            reelId: 'r-r',
                            mediaAssetId: 'r-r'
                        },
                        {
                            episodeId: 'p',
                            episodeNumber: 3,
                            title: 'Published',
                            status: 'published',
                            reelId: 'r-p',
                            mediaAssetId: 'r-p'
                        },
                        {
                            episodeId: 'a',
                            episodeNumber: 4,
                            title: 'Archived',
                            status: 'archived',
                            reelId: 'r-a',
                            mediaAssetId: 'r-a'
                        }
                    ]
                }
            ]
        }
    ]);

    // Force statuses + build viewer view over catalog members only
    const catalog = store.getSeriesById('series-pub');
    const related = {
        seriesId: 'series-pub',
        seriesTitle: 'STIRRED',
        members: catalog.seasons[0].episodes.map((ep) => ({
            assetId: ep.mediaAssetId,
            reelId: ep.reelId,
            title: ep.title,
            episodeNumber: ep.episodeNumber,
            seasonNumber: 1,
            mediaUrl: '',
            thumbnailUrl: '',
            episodeId: ep.episodeId,
            source: 'catalog',
            status: ep.status
        }))
    };
    // Put status onto members for filter — buildSeriesViewFromRelated uses episode.status after catalog put
    const view = buildSeriesViewFromRelated(related, catalog, { viewerMode: true });
    const titles = (view?.seasons || []).flatMap((s) => s.episodes || []).map((e) => e.title);
    assert(titles.includes('Published'), 'viewer sees published');
    assert(!titles.includes('Draft'), 'viewer does not see draft');
    assert(!titles.includes('Ready'), 'viewer does not see ready');
    assert(!titles.includes('Archived'), 'viewer does not see archived');

    store.setEpisodeStatus('p', 'archived');
    const archivedEp = store.getEpisodeById('p');
    assert(archivedEp?.episode?.status === 'archived', 'status becomes archived in catalog');
    const catalog2 = store.getSeriesById('series-pub');
    const related2 = {
        seriesId: 'series-pub',
        seriesTitle: 'STIRRED',
        members: (catalog2?.seasons || [])
            .flatMap((s) => s.episodes || [])
            .map((ep) => ({
                assetId: ep.mediaAssetId || '',
                reelId: ep.reelId || null,
                title: ep.title,
                episodeNumber: ep.episodeNumber,
                seasonNumber: 1,
                mediaUrl: '',
                thumbnailUrl: '',
                episodeId: ep.episodeId,
                source: 'catalog',
                status: ep.status
            }))
    };
    assert(
        related2.members.some((m) => m.episodeId === 'p' && m.status === 'archived'),
        'related member carries archived status'
    );
    const view2 = buildSeriesViewFromRelated(related2, catalog2, { viewerMode: true });
    const titles2 = (view2?.seasons || []).flatMap((s) => s.episodes || []).map((e) => e.title);
    assert(
        !titles2.includes('Published') && !titles2.some((t) => /archived/i.test(String(t))),
        `archived removed from viewer (shelf=${titles2.join('|') || 'empty'})`
    );

    if (failures.length) {
        console.error('FAIL validate-publishing-controls\n' + failures.map((f) => `  - ${f}`).join('\n'));
        process.exit(1);
    }
    console.log('PASS validate-publishing-controls');
} finally {
    await vite.close();
}
