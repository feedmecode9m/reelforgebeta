#!/usr/bin/env node
/**
 * Fail-closed provenance regression:
 * missing sourceType never elevates to creator;
 * unknown/system/ai/discovery/demo cannot write creator prose;
 * creator/vault/binding retain allowed authorship.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import fs from 'node:fs';

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

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

console.log('\n[0] Static fail-closed contract');
const storeSrc = read('src/lib/series/seriesStore.js');
assert(
    'saveReelSeriesMetadata does not default to CREATOR',
    !/PROVENANCE_SOURCE_TYPES\.CREATOR\s*;?\s*\n/.test(
        storeSrc.slice(storeSrc.indexOf('export function saveReelSeriesMetadata'))
    ) ||
        storeSrc.includes('Never default missing provenance to creator')
);
assert(
    'save defaults to SYSTEM on missing',
    storeSrc.includes('PROVENANCE_SOURCE_TYPES.SYSTEM') &&
        storeSrc.includes('Never default missing provenance to creator')
);
assert(
    'bindEpisode uses saveReelSeriesMetadata',
    /function bindEpisodeToFeedReel[\s\S]*saveReelSeriesMetadata/.test(storeSrc)
);
assert(
    'bindEpisode does not call upsertStored directly',
    !/export function bindEpisodeToFeedReel[\s\S]*?upsertStoredReelSeriesMetadata/.test(storeSrc)
);
assert(
    'catalog sync uses saveReelSeriesMetadata',
    storeSrc.includes('syncReelMetadataFromCatalogEpisode') &&
        /function syncReelMetadataFromCatalogEpisode[\s\S]*saveReelSeriesMetadata/.test(storeSrc)
);

const heroSync = read('src/lib/series/heroEpisodeSync.js');
assert(
    'hero episode sync uses saveReelSeriesMetadata',
    heroSync.includes('saveReelSeriesMetadata')
);
assert(
    'hero sync has no direct upsertStored',
    !heroSync.includes('upsertStoredReelSeriesMetadata')
);
assert(
    'no keywords[0] genre promotion in HeroManager',
    !read('src/components/studio/HeroManagerPanel.svelte').includes(
        'genre: Array.isArray(resolved.keywords) ? resolved.keywords[0]'
    )
);

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
    const provenance = await vite.ssrLoadModule('/src/lib/architecture/intelligenceProvenance.js');

    console.log('\n[1] missing sourceType cannot write description');
    store.resetSeriesCatalogEmpty();
    bag.clear();
    store.saveReelSeriesMetadata('reel-missing', {
        reelId: 'reel-missing',
        description: 'Should not stick',
        episodeTitle: 'No title either',
        genre: 'Hijacked'
    });
    // no options.sourceType
    let meta = store.getReelSeriesMetadata('reel-missing');
    assert('missing sourceType blocks description', !meta?.description);
    assert('missing sourceType blocks genre', !meta?.genre);
    assert('missing sourceType blocks episodeTitle', !meta?.episodeTitle);
    assert(
        'missing normalizes to system',
        provenance.normalizeProvenanceSource('') === 'system' &&
            provenance.normalizeProvenanceSource(undefined) === 'system'
    );

    console.log('\n[2] ai cannot write genre');
    store.saveReelSeriesMetadata(
        'reel-ai',
        { reelId: 'reel-ai', genre: 'Cyber-Action', description: 'AI blurb' },
        { sourceType: 'ai' }
    );
    meta = store.getReelSeriesMetadata('reel-ai');
    assert('ai blocked genre', !meta?.genre);
    assert('ai blocked description', !meta?.description);

    console.log('\n[3] discovery cannot write title');
    store.saveReelSeriesMetadata(
        'reel-disc',
        {
            reelId: 'reel-disc',
            episodeTitle: 'Discovery Invented Title',
            title: 'Discovery Series'
        },
        { sourceType: 'discovery' }
    );
    meta = store.getReelSeriesMetadata('reel-disc');
    assert('discovery blocked episodeTitle', !meta?.episodeTitle);

    console.log('\n[4] demo cannot write episode metadata');
    store.saveReelSeriesMetadata(
        'reel-demo',
        {
            reelId: 'reel-demo',
            episodeTitle: 'Ghost in the Grid',
            description: 'Fixture synopsis',
            genre: 'Cyber-Action',
            runtime: 300
        },
        { sourceType: 'demo' }
    );
    meta = store.getReelSeriesMetadata('reel-demo');
    assert('demo blocked episodeTitle', !meta?.episodeTitle);
    assert('demo blocked description', !meta?.description);
    assert('demo blocked genre', !meta?.genre);
    assert('demo blocked runtime', meta?.runtime == null);

    console.log('\n[5] creator / vault / binding can write allowed fields');
    const creator = store.saveReelSeriesMetadata(
        'reel-creator',
        {
            reelId: 'reel-creator',
            episodeTitle: 'Creator Ep',
            description: 'Creator synopsis',
            genre: 'Drama',
            runtime: 120
        },
        { sourceType: 'creator' }
    );
    assert('creator writes episodeTitle', creator?.episodeTitle === 'Creator Ep');
    assert('creator writes description', creator?.description === 'Creator synopsis');
    assert('creator writes genre', creator?.genre === 'Drama');
    assert('creator writes runtime', creator?.runtime === 120);

    const vault = store.saveReelSeriesMetadata(
        'reel-vault',
        {
            reelId: 'reel-vault',
            episodeTitle: 'STIRRED 1',
            seriesName: 'STIRRED'
        },
        { sourceType: 'vault' }
    );
    assert('vault writes episodeTitle', vault?.episodeTitle === 'STIRRED 1');
    assert('vault writes seriesName', vault?.seriesName === 'STIRRED');

    const binding = store.saveReelSeriesMetadata(
        'reel-bind',
        {
            reelId: 'reel-bind',
            episodeId: 'ep-real',
            seriesId: 'series-real',
            episodeTitle: 'Bound Episode',
            description: 'From catalog bind',
            runtime: 90
        },
        { sourceType: 'binding' }
    );
    assert('binding writes episodeTitle', binding?.episodeTitle === 'Bound Episode');
    assert('binding writes description', binding?.description === 'From catalog bind');
    assert('binding writes structural episodeId', binding?.episodeId === 'ep-real');

    // AI may still attach non-prose suggestion side-channels
    store.saveReelSeriesMetadata(
        'reel-creator',
        {
            suggestedGenre: 'Cyber-Action',
            intelligenceExplanation:
                'Suggested theme detected from your uploaded title: Cyber-Action'
        },
        { sourceType: 'ai' }
    );
    meta = store.getReelSeriesMetadata('reel-creator');
    assert(
        'ai may store suggestedGenre without overwriting official genre',
        meta?.suggestedGenre === 'Cyber-Action' && meta?.genre === 'Drama'
    );

    if (failed) {
        console.error(`\nFAIL validate-provenance-fail-closed (${failed})`);
        process.exit(1);
    }
    console.log('\nPASS validate-provenance-fail-closed');
    process.exit(0);
} catch (err) {
    console.error(err);
    process.exit(1);
} finally {
    await vite.close();
}
