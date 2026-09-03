#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function assert(condition, message) {
    if (!condition) failures.push(message);
    else console.log(`  ok: ${message}`);
}

function read(relPath) {
    return fs.readFileSync(path.join(root, relPath), 'utf8');
}

const browseHelper = read('src/lib/series/viewerSeriesBrowseCatalog.js');
const reelshort = read('src/components/vertical/ReelshortExperience.svelte');
const posterCard = read('src/components/series/SeriesBrowsePosterCard.svelte');

assert(
    /buildViewerSeriesBrowseCatalog\(\$seriesCatalog/.test(reelshort),
    'browse composition reads canonical seriesCatalog'
);
assert(
    !/Object\.keys\(\$feed\)\.filter\(\(cat\) => cat !== 'Auto-Detect'\)/.test(reelshort),
    'primary browse surface no longer iterates feed shelves into episode cards'
);
assert(
    /const bySeriesId = new Map\(\)/.test(browseHelper) &&
        /if \(!seriesId \|\| bySeriesId\.has\(seriesId\)\) continue;/.test(browseHelper),
    'production dedupe map keyed by canonical series identity exists'
);
assert(
    /collapseRelatedBrowseProductions\(/.test(browseHelper) &&
        /buildReelCanonicalBrowseOwnerMap\(/.test(browseHelper),
    'related vault productions collapse into canonical browse representative'
);
assert(
    /stackLayers/.test(browseHelper) && /relatedMaterialCount/.test(browseHelper),
    'collapsed browse cards expose stack metadata for presentation'
);
assert(
    /series-poster-card__layer/.test(posterCard) &&
        /series-poster-card--stacked/.test(posterCard),
    'browse poster card renders subtle stacked-layer affordance'
);
assert(
    /const episodes = collectViewerEpisodes\(series\);/.test(browseHelper) &&
        /if \(episodes\.length === 0\) continue;/.test(browseHelper),
    'browse cards are filtered to viewer-discoverable series with episodes'
);
assert(
    /buildViewerProductionProjection\(/.test(browseHelper) &&
        /if \(!projection\) continue;/.test(browseHelper),
    'production cards consume canonical viewer production projection'
);
assert(
    /<section class="viewer-production-library"/.test(reelshort) &&
        /<SeriesBrowsePosterCard \{item\} sectionLabel=\{sectionData\.key\}/.test(reelshort) &&
        /data-viewer-browse-grid/.test(reelshort),
    'primary browse surface is rendered as production poster sections'
);
assert(
    /data-viewer-continue-watching/.test(reelshort) &&
        /listContinueWatching\(\{ limit: 8 \}\)/.test(reelshort),
    'secondary continue-watching lane is present and progress-backed'
);

const server = await createServer({
    root,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error'
});

try {
    const mod = await server.ssrLoadModule('/src/lib/series/viewerSeriesBrowseCatalog.js');
    /** @type {import('../src/lib/series/seriesTypes.js').Series[]} */
    const mockCatalog = [
        {
            id: 'series-vic-g',
            title: 'Vic G',
            tags: ['creator-package', 'vault-inferred'],
            seasons: [
                {
                    seasonNumber: 1,
                    episodes: [
                        {
                            episodeId: 'ep-vic-g-s01e04',
                            episodeNumber: 4,
                            status: 'published',
                            reelId: 'b3a87c96-6ea0-4854-a0bc-6b0f2442f9a1'
                        },
                        {
                            episodeId: 'ep-vic-g-s01e05',
                            episodeNumber: 5,
                            status: 'published',
                            reelId: 'efb01cee-9477-4477-982a-7611cfc08fcc'
                        },
                        {
                            episodeId: 'ep-vic-g-s01e06',
                            episodeNumber: 6,
                            status: 'published',
                            reelId: '5cc786f0-8fbe-4f96-a59d-02014b0cc56f'
                        }
                    ]
                }
            ]
        },
        {
            id: 'series-04-set-shooting-pt-1',
            title: '04 SET SHOOTING PT 1',
            tags: ['vault-inferred'],
            seasons: [
                {
                    seasonNumber: 1,
                    episodes: [
                        {
                            episodeId: 'ep-04-set-shooting-pt-1-s01e01-v1',
                            episodeNumber: 1,
                            status: 'published',
                            reelId: 'b3a87c96-6ea0-4854-a0bc-6b0f2442f9a1'
                        }
                    ]
                }
            ]
        },
        {
            id: 'series-05-set-shooting-pt-2',
            title: '05 SET SHOOTING PT 2',
            tags: ['vault-inferred'],
            seasons: [
                {
                    seasonNumber: 1,
                    episodes: [
                        {
                            episodeId: 'ep-05-set-shooting-pt-2-s01e01-v1',
                            episodeNumber: 1,
                            status: 'published',
                            reelId: 'efb01cee-9477-4477-982a-7611cfc08fcc'
                        }
                    ]
                }
            ]
        },
        {
            id: 'series-06-condo-high-rise',
            title: '06 CONDO HIGH RISE',
            tags: ['vault-inferred'],
            seasons: [
                {
                    seasonNumber: 1,
                    episodes: [
                        {
                            episodeId: 'ep-06-condo-high-rise-s01e01-v1',
                            episodeNumber: 1,
                            status: 'published',
                            reelId: '5cc786f0-8fbe-4f96-a59d-02014b0cc56f'
                        }
                    ]
                }
            ]
        },
        {
            id: 'series-validation-1781016646994',
            title: 'Validation Series Updated',
            tags: ['vault-inferred'],
            seasons: [
                {
                    seasonNumber: 1,
                    episodes: [
                        {
                            episodeId: 'ep-validation-1',
                            episodeNumber: 1,
                            status: 'published',
                            reelId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
                        }
                    ]
                }
            ]
        }
    ];
    const readyVaultAssets = [
        { id: 'b3a87c96-6ea0-4854-a0bc-6b0f2442f9a1', status: 'ready', type: 'video', url: 'https://example/a.mp4' },
        { id: 'efb01cee-9477-4477-982a-7611cfc08fcc', status: 'ready', type: 'video', url: 'https://example/b.mp4' },
        { id: '5cc786f0-8fbe-4f96-a59d-02014b0cc56f', status: 'ready', type: 'video', url: 'https://example/c.mp4' },
        { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', status: 'ready', type: 'video', url: 'https://example/d.mp4' }
    ];
    const built = mod.buildViewerSeriesBrowseCatalog(mockCatalog, {
        readyVaultAssets,
        sectionLimit: 12
    });
    const originalIds = built.sections.original.map((item) => item.seriesId);
    assert(!originalIds.includes('series-04-set-shooting-pt-1'), 'E04 singleton is not promoted as peer production');
    assert(!originalIds.includes('series-05-set-shooting-pt-2'), 'E05 singleton is not promoted as peer production');
    assert(!originalIds.includes('series-06-condo-high-rise'), 'E06 singleton is not promoted as peer production');
    assert(originalIds.includes('series-vic-g'), 'Vic G remains the browse representative');
    assert(originalIds.includes('series-validation-1781016646994'), 'unrelated productions remain visible');
    const vic = built.sections.original.find((item) => item.seriesId === 'series-vic-g');
    assert(vic?.stackLayers === 2, 'Vic G card receives subtle two-layer stack affordance');
    assert((vic?.relatedMaterialCount || 0) >= 3, 'Vic G records collapsed related material count');
} finally {
    await server.close();
}

if (failures.length) {
    console.error('FAIL validate-viewer-series-browse-catalog\n' + failures.map((f) => `  - ${f}`).join('\n'));
    process.exit(1);
}

console.log('PASS validate-viewer-series-browse-catalog');
