#!/usr/bin/env node
/**
 * Viewer Production Projection boundary:
 * - Studio editorial metadata survives API fixture prose
 * - NLP diagnostics / internal tags never become viewer copy
 * - Browse + detail consume projection (not raw catalog tags)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let failed = 0;
function assert(label, cond) {
    if (cond) console.log(`  ✓ ${label}`);
    else {
        failed += 1;
        console.error(`  ✗ ${label}`);
    }
}

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});

try {
    const truth = await vite.ssrLoadModule('/src/lib/series/seriesCatalogTruth.js');
    const projection = await vite.ssrLoadModule('/src/lib/series/viewerProductionProjection.js');
    const browse = await vite.ssrLoadModule('/src/lib/series/viewerSeriesBrowseCatalog.js');

    console.log('\n[1] Editorial precedence over API fixtures');
    assert(
        'fixture description detected',
        truth.isTestFixtureDescription('CRUD validation fixture')
    );
    assert(
        'creatorFacingDescription hides fixture',
        truth.creatorFacingDescription('CRUD validation fixture') === ''
    );
    assert(
        'Studio editorial wins over API fixture',
        truth.resolveEditorialProsePrecedence(
            'CRUD validation fixture',
            'A documentary exploration of validation workflows.'
        ) === 'A documentary exploration of validation workflows.'
    );
    assert(
        'real API editorial still wins when both are editorial',
        truth.resolveEditorialProsePrecedence(
            'Official synced synopsis from API.',
            'Local studio draft synopsis.'
        ) === 'Official synced synopsis from API.'
    );

    console.log('\n[2] Projection carries Studio editorial + blocks diagnostics');
    /** @type {import('../src/lib/series/seriesTypes.js').Series} */
    const validationSeries = {
        id: 'series-validation-1781016646994',
        title: 'Validation Series Updated',
        description: 'CRUD validation fixture',
        genre: 'Test',
        tags: ['validation', 'vault-inferred', 'nlp-metadata'],
        seasons: [
            {
                seasonNumber: 1,
                episodes: [
                    {
                        episodeId: 'ep-validation-1',
                        episodeNumber: 1,
                        title: 'Validation Series Updated',
                        status: 'published',
                        reelId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
                    }
                ]
            }
        ]
    };
    /** @type {Record<string, import('../src/lib/series/seriesMetadataStorage.js').ReelSeriesMetadata>} */
    const reelMetadataMap = {
        'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee': {
            reelId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            seriesName: 'Validation Series Updated',
            seasonNumber: 1,
            episodeNumber: 1,
            episodeTitle: 'Validation Series Updated',
            description: 'A documentary exploration of creative validation in production.',
            suggestedGenre: 'Documentary',
            intelligenceExplanation: 'Suggested context: behind-the-scenes production culture',
            seriesId: 'series-validation-1781016646994',
            episodeId: 'ep-validation-1'
        }
    };

    const built = projection.buildViewerProductionProjection(validationSeries, {
        reelMetadataMap,
        readyVaultAssets: [
            {
                id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                status: 'ready',
                type: 'video',
                url: 'https://example/d.mp4'
            }
        ]
    });
    assert('projection built', Boolean(built));
    assert(
        'fixture description excluded from projection',
        built?.description === 'A documentary exploration of creative validation in production.'
    );
    assert(
        'internal validation tag not used as NLP theme',
        !(built?.viewerEnrichment?.themes || []).some((t) => /validation/i.test(String(t)))
    );
    assert(
        'no Themes detected: validation intelligence line',
        !(built?.viewerEnrichment?.intelligenceLines || []).some((line) =>
            /themes detected:\s*validation/i.test(String(line))
        )
    );
    assert(
        'title-echo Exploring line suppressed without substantive NLP',
        !(built?.viewerEnrichment?.intelligenceLines || []).some((line) =>
            /^Exploring Validation Series Updated$/i.test(String(line))
        )
    );
    assert('fixture TEST genre hidden from projection', built?.genre !== 'Test' && built?.genre !== 'TEST');
    assert('title preserved from catalog editorial identity', built?.title === 'Validation Series Updated');

    console.log('\n[3b] Editorial episode poster wins on browse series card');
    /** @type {import('../src/lib/series/seriesTypes.js').Series} */
    const posterPrioritySeries = {
        id: 'series-poster-priority-test',
        title: 'Poster Priority Test',
        seasons: [
            {
                seasonNumber: 1,
                episodes: [
                    {
                        episodeId: 'ep-poster-priority-e01',
                        episodeNumber: 1,
                        title: 'E01',
                        status: 'published',
                        reelId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
                    },
                    {
                        episodeId: 'ep-poster-priority-e02',
                        episodeNumber: 2,
                        title: 'E02',
                        status: 'published',
                        reelId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                        thumbnailUrl: '/thumbs/editorial-assigned-poster.jpg'
                    }
                ]
            }
        ]
    };
    const posterPriorityBuilt = projection.buildViewerProductionProjection(posterPrioritySeries, {
        readyVaultAssets: [
            {
                id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                status: 'ready',
                type: 'video',
                url: '/videos/aaaa.mp4',
                thumbnailUrl: '/thumbs/aaaa-auto-still.jpg'
            },
            {
                id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                status: 'ready',
                type: 'video',
                url: '/videos/bbbb.mp4',
                thumbnailUrl: '/thumbs/bbbb-auto-still.jpg'
            }
        ]
    });
    assert(
        'assigned episode poster used for series browse card',
        String(posterPriorityBuilt?.posterSrc || '').includes('editorial-assigned-poster')
    );
    assert(
        'E01 auto-still not chosen when E02 has editorial poster',
        !String(posterPriorityBuilt?.posterSrc || '').includes('aaaa-auto-still')
    );

    console.log('\n[3] Browse consumes projection (not raw catalog description)');
    const browseBuilt = browse.buildViewerSeriesBrowseCatalog([validationSeries], {
        reelMetadataMap,
        readyVaultAssets: [
            {
                id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                status: 'ready',
                type: 'video',
                url: 'https://example/d.mp4'
            }
        ],
        sectionLimit: 12
    });
    const browseItem = browseBuilt.all.find(
        (item) => item.seriesId === 'series-validation-1781016646994'
    );
    assert('browse item exists', Boolean(browseItem));
    assert(
        'browse item carries projected description',
        browseItem?.description === 'A documentary exploration of creative validation in production.'
    );
    assert(
        'browse item excludes fixture prose',
        browseItem?.description !== 'CRUD validation fixture'
    );

    console.log('\n[4] Internal catalog tags filtered');
    assert('validation tag is internal', truth.isInternalCatalogTag('validation'));
    assert('nlp-metadata tag is internal', truth.isInternalCatalogTag('nlp-metadata'));
    assert('documentary tag is viewer-safe', !truth.isInternalCatalogTag('documentary'));
} finally {
    await vite.close();
}

if (failed) {
    console.error(`\nFAIL validate-viewer-production-projection (${failed} failed)`);
    process.exit(1);
}

console.log('\nPASS validate-viewer-production-projection');
