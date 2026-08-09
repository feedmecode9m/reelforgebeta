#!/usr/bin/env node
/**
 * Intelligence provenance boundary:
 * - AI / discovery cannot author public series prose (title, genre, description, …)
 * - AI cannot create public series or episodes via the series metadata write path
 * - AI cannot overwrite creator titles
 * - Discovery buckets are not official genre
 * - Demo fixtures stay isolated
 * - Studio repair recommends, does not auto-author creative copy
 */
import fs from 'node:fs';
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

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

console.log('\n[0] Static provenance modules');
const provenanceSrc = read('src/lib/architecture/intelligenceProvenance.js');
assert('intelligenceProvenance module exists', provenanceSrc.includes('sanitizeCreatorTruthMetadataWrite'));
assert('sourceType taxonomy present', /sourceType/.test(provenanceSrc) && provenanceSrc.includes("'ai'"));
assert('truth + interpretation sources', provenanceSrc.includes('TRUTH_PROVENANCE') || provenanceSrc.includes('TRUTH_PROVENANCE_SOURCES'));

const arch = read('src/lib/architecture/creatorTruthLayers.js');
assert('architecture re-exports provenance', arch.includes('intelligenceProvenance.js'));

const storeSrc = read('src/lib/series/seriesStore.js');
assert(
    'saveReelSeriesMetadata uses guard',
    storeSrc.includes('guardIntelligenceMetadataWrite') && storeSrc.includes('sourceType')
);

const repairSrc = read('src/lib/series/studioRepairEngine.js');
assert(
    'repair blocks generate-default-description',
    repairSrc.includes('blocked-synthetic-description') || repairSrc.includes('synthetic-description-blocked')
);
assert(
    'repair does not write description via saveReelSeriesMetadata',
    !/saveReelSeriesMetadata\([^)]*description\s*:/.test(repairSrc)
);

const agents = read('src/lib/viewer/contentAgents.js');
assert('category detector is discovery-only', /DISCOVERY LAYER ONLY/.test(agents));
assert(
    'category detector labels non-official genre',
    agents.includes('officialGenre: false') && agents.includes('sourceType: \'discovery\'')
);
assert(
    'discovery shelf not seriesCatalog writer',
    !/seriesCatalog\.(set|update)/.test(agents)
);

const discovery = read('src/lib/discovery/discoveryEngine.js');
assert('discovery does not mutate seriesCatalog', !/seriesCatalog\.(set|update)/.test(discovery));

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
    const provenance = await vite.ssrLoadModule('/src/lib/architecture/intelligenceProvenance.js');
    const store = await vite.ssrLoadModule('/src/lib/series/seriesStore.js');
    const truth = await vite.ssrLoadModule('/src/lib/series/seriesCatalogTruth.js');
    const mock = await vite.ssrLoadModule('/src/lib/series/mockSeriesData.js');
    const repair = await vite.ssrLoadModule('/src/lib/series/studioRepairEngine.js');
    const { get } = await vite.ssrLoadModule('svelte/store');

    console.log('\n[1] sanitizeCreatorTruthMetadataWrite');
    const aiBlocked = provenance.sanitizeCreatorTruthMetadataWrite(
        {
            title: 'AI Invented',
            episodeTitle: 'Ep AI',
            description: 'Marketing ghost',
            genre: 'Cyber-Action',
            runtime: 300,
            seriesId: 'should-pass-structural',
            episodeId: 'ep-pass'
        },
        { sourceType: 'ai' }
    );
    assert('AI blocks description', !('description' in aiBlocked.patch));
    assert('AI blocks genre', !('genre' in aiBlocked.patch));
    assert('AI blocks title / episodeTitle', !('title' in aiBlocked.patch) && !('episodeTitle' in aiBlocked.patch));
    assert('AI blocks runtime', !('runtime' in aiBlocked.patch));
    assert('AI keeps structural seriesId', aiBlocked.patch.seriesId === 'should-pass-structural');
    assert('AI blockedFields include prose', aiBlocked.blockedFields.includes('description'));

    const discBlocked = provenance.sanitizeCreatorTruthMetadataWrite(
        { genre: 'Romance', description: 'Shelf text' },
        { sourceType: 'discovery' }
    );
    assert('discovery blocks genre+description', discBlocked.blockedFields.includes('genre'));

    const creatorOk = provenance.sanitizeCreatorTruthMetadataWrite(
        { episodeTitle: 'Real Ep', description: 'Creator synopsis', genre: 'Drama' },
        { sourceType: 'creator' }
    );
    assert('creator writes prose through', creatorOk.patch.description === 'Creator synopsis');

    const vaultTitles = provenance.sanitizeCreatorTruthMetadataWrite(
        { episodeTitle: 'From Vault Title', seriesName: 'STIRRED', description: 'nope' },
        { sourceType: 'vault' }
    );
    assert('vault episodeTitle allowed', vaultTitles.patch.episodeTitle === 'From Vault Title');

    console.log('\n[2] resolvePublicGenreDisplay / explanations');
    const offGenre = provenance.resolvePublicGenreDisplay('Cyber-Action', 'discovery');
    assert('discovery genre not official display', offGenre.official === false && offGenre.display === '');
    assert(
        'discovery explanation labeled',
        /[Ss]uggested/.test(offGenre.explanation) && offGenre.explanation.includes('Cyber-Action')
    );
    const creatorGenre = provenance.resolvePublicGenreDisplay('Drama', 'creator');
    assert('creator genre is official', creatorGenre.official === true && creatorGenre.display === 'Drama');

    const expl = provenance.formatIntelligenceExplanation('Cyber-Action', { fromTitle: true });
    assert(
        'title theme explanation wording',
        expl.includes('Suggested theme detected from your uploaded title')
    );

    console.log('\n[3] saveReelSeriesMetadata write guards');
    store.resetSeriesCatalogEmpty();
    bag.clear();

    const creatorTitle = store.saveReelSeriesMetadata(
        'reel-truth-1',
        {
            reelId: 'reel-truth-1',
            episodeTitle: 'Creator Episode',
            description: 'Owned synopsis',
            genre: 'Drama'
        },
        { sourceType: 'creator', context: 'validate-provenance' }
    );
    assert('creator can set title', creatorTitle?.episodeTitle === 'Creator Episode');
    assert('creator can set description', creatorTitle?.description === 'Owned synopsis');

    const aiOverwrite = store.saveReelSeriesMetadata(
        'reel-truth-1',
        {
            episodeTitle: 'AI Hijack Title',
            description: 'AI ghost synopsis',
            genre: 'Cyber-Action'
        },
        { sourceType: 'ai', context: 'validate-ai-overwrite' }
    );
    const afterAi = store.getReelSeriesMetadata('reel-truth-1');
    assert('AI cannot overwrite creator title', afterAi?.episodeTitle === 'Creator Episode');
    assert('AI cannot overwrite description', afterAi?.description === 'Owned synopsis');
    assert('AI cannot overwrite genre', afterAi?.genre === 'Drama');
    // When fully blocked, may return existing without mutation
    assert('AI write leaves truth intact', afterAi?.episodeTitle !== 'AI Hijack Title');

    const discWrite = store.saveReelSeriesMetadata(
        'reel-truth-1',
        { genre: 'Cyber-Action', description: 'Shelf copy' },
        { sourceType: 'discovery' }
    );
    const afterDisc = store.getReelSeriesMetadata('reel-truth-1');
    assert('discovery cannot set genre as official metadata', afterDisc?.genre === 'Drama');

    console.log('\n[4] AI cannot create public series / episodes');
    store.resetSeriesCatalogEmpty();
    bag.clear();
    // AI-only metadata with series/episode ids must not invent catalog rows.
    store.saveReelSeriesMetadata(
        'reel-ai-orphan',
        {
            reelId: 'reel-ai-orphan',
            seriesId: 'series-ai-invented',
            seriesName: 'Fake AI Series',
            episodeId: 'ep-ai-1',
            episodeTitle: 'AI Episode One',
            description: 'Invented',
            genre: 'Cyber-Action'
        },
        { sourceType: 'ai' }
    );
    const catalogAfterAi = get(store.seriesCatalog);
    assert(
        'AI write did not create catalog series',
        !catalogAfterAi.some((s) => s.id === 'series-ai-invented' || s.title === 'Fake AI Series')
    );
    assert(
        'no AI-authored episode titles in production catalog',
        !truth.catalogHasDemoEpisodeTitles(catalogAfterAi) &&
            !catalogAfterAi.some((s) =>
                (s.seasons || []).some((se) =>
                    (se.episodes || []).some((e) => String(e.title || '').includes('AI Episode'))
                )
            )
    );

    // Demo cannot leak into live catalog via set
    store.seriesCatalog.set(mock.MOCK_SERIES_CATALOG);
    assert(
        'demo neon stripped without demo session',
        !get(store.seriesCatalog).some((s) => s.id === 'series-neon-vengeance')
    );

    console.log('\n[5] Studio repair creative boundary');
    const synth = repair.executeRepair({
        id: 'prov-synth',
        repairable: true,
        action: 'generate-default-description',
        episodeId: 'ep-x',
        reelId: 'reel-x',
        issue: 'missing-description',
        severity: 'HIGH',
        label: 'x',
        detail: 'x'
    });
    assert('repair refuses synthetic description', synth && synth.ok === false);

    console.log('\n[6] Demo isolation + confidence not truth');
    assert(
        'isDemoSeriesId true for neon fixture',
        typeof truth.isDemoSeriesId === 'function' && truth.isDemoSeriesId('series-neon-vengeance')
    );
    assert(
        'demo provenance is non-truth',
        provenance.isInterpretationProvenanceSource('demo') === true &&
            provenance.isTruthProvenanceSource('demo') === false
    );
    assert(
        'high confidence labels stay interpretation',
        provenance.normalizeProvenanceSource('ai') === 'ai' &&
            provenance.isTruthProvenanceSource('ai') === false
    );

    if (failed) {
        console.error(`\nFAIL validate-intelligence-provenance (${failed})`);
        process.exit(1);
    }
    console.log('\nPASS validate-intelligence-provenance');
    process.exit(0);
} catch (err) {
    console.error(err);
    process.exit(1);
} finally {
    await vite.close();
}
