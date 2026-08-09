#!/usr/bin/env node
/**
 * Viewer Intelligence Presentation Layer:
 * - creatorTruth vs intelligenceExplanation vs discoveryContext provenance
 * - NLP cannot overwrite identity / title / genre
 * - Featured Collection never presents AI lines as creator metadata
 * - Discovery labels remain non-authoritative
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

console.log('\n[0] Module + UI contracts');
const modSrc = read('src/lib/viewer/viewerIntelligencePresentation.js');
assert('presentation module exists', modSrc.includes('buildViewerIntelligencePresentation'));
assert('three provenance blocks documented', modSrc.includes('creatorTruth') && modSrc.includes('intelligenceExplanation') && modSrc.includes('discoveryContext'));
assert('identity protection present', modSrc.includes('PROTECTED_IDENTITY_PHRASES'));

const featuredSrc = read('src/components/discovery/FeaturedCollectionPanel.svelte');
assert('Featured Collection uses presentation layer', featuredSrc.includes('presentFeaturedCollection'));
assert('Featured uses data-creator-title', featuredSrc.includes('data-creator-title'));
assert('Featured separates data-intelligence-explanation', featuredSrc.includes('data-intelligence-explanation'));
assert('Featured separates data-discovery-context', featuredSrc.includes('data-discovery-context'));
assert(
    'Featured does not map searchKeywords as Genre',
    !/Genre:\s*\{featured/.test(featuredSrc) && !featuredSrc.includes('Genre: {')
);

const seedSrc = read('src/lib/hero/heroViewerTruth.js');
assert(
    'seed does not fill series genre from NLP category',
    !/fill\(series,\s*['"]genre['"],\s*intelligence\.category\)/.test(seedSrc)
);
assert('NLP category goes to discovery topics', seedSrc.includes('discovery.topics = pushUnique'));

const guardSrc = read('src/lib/intelligence/contentIdentityGuard.js');
assert('genre is locked identity field', /LOCKED_FIELDS[\s\S]*'genre'/.test(guardSrc));
assert(
    'community identity fields locked',
    guardSrc.includes("'communityRepresented'") && guardSrc.includes("'culturalRegion'")
);

const bag = new Map();
globalThis.localStorage = {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => bag.set(String(k), String(v)),
    removeItem: (k) => bag.delete(k),
    clear: () => bag.clear()
};
globalThis.window = {
    localStorage: globalThis.localStorage,
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
    const presentation = await vite.ssrLoadModule(
        '/src/lib/viewer/viewerIntelligencePresentation.js'
    );
    const heroTruth = await vite.ssrLoadModule('/src/lib/hero/heroViewerTruth.js');

    console.log('\n[1] Creator title first; NLP cannot overwrite');
    const built = presentation.buildViewerIntelligencePresentation({
        title: 'Black Agriculture Legacies',
        description: 'Community-owned story about land and harvest.',
        genre: 'Documentary',
        nlpTitle: 'Trending Farming Content',
        nlpGenre: 'Cyber-Action',
        nlpDescription: 'AI-rewritten marketing blurb that drops identity terms.',
        themes: ['land', 'stewardship'],
        mood: 'reflective',
        discoveryShelfLabels: ['Cyber-Action'],
        discoveryKeywords: ['viral', 'trending']
    });

    assert('creatorTruth.title preserved', built.creatorTruth.title === 'Black Agriculture Legacies');
    assert('primaryTitle is creator title', built.display.primaryTitle === 'Black Agriculture Legacies');
    assert('creatorTruth.genre preserved', built.creatorTruth.genre === 'Documentary');
    assert(
        'nlp genre not official',
        built.display.officialGenre === 'Documentary' &&
            !built.display.officialGenre.includes('Cyber-Action')
    );
    assert(
        'identity terms protected',
        built.creatorTruth.identityTerms.some((t) => /black agriculture|land/i.test(t))
    );
    assert(
        'intelligence is non-authoritative',
        built.intelligenceExplanation.authoritative === false
    );
    assert(
        'discovery is non-authoritative',
        built.discoveryContext.authoritative === false
    );
    assert(
        'explanation language uses approved prefixes',
        built.intelligenceExplanation.lines.some((l) => l.startsWith('Exploring ')) &&
            built.intelligenceExplanation.lines.some((l) => l.startsWith('Themes detected:'))
    );

    console.log('\n[2] applyNlpProposalToCreatorTruth blocks locked fields');
    const applied = presentation.applyNlpProposalToCreatorTruth(
        {
            title: 'Diaspora Stories',
            genre: 'Oral History',
            communityRepresented: 'Caribbean diaspora'
        },
        {
            title: 'Generic Travel Vlog',
            genre: 'Cyber-Action',
            communityRepresented: 'World travelers',
            mood: 'upbeat'
        }
    );
    assert('title write blocked', applied.blocked.includes('title'));
    assert('genre write blocked', applied.blocked.includes('genre'));
    assert('community write blocked', applied.blocked.includes('communityRepresented'));
    assert('title unchanged', applied.next.title === 'Diaspora Stories');
    assert('genre unchanged', applied.next.genre === 'Oral History');
    assert('community unchanged', applied.next.communityRepresented === 'Caribbean diaspora');

    console.log('\n[3] Featured Collection presentation audit');
    const featured = presentation.presentFeaturedCollection(
        {
            collectionId: 'collection-black-agriculture',
            collectionTitle: 'Black Agriculture',
            collectionDescription: 'Black Agriculture stories curated for documentary discovery.',
            communityRepresented: ['Black farmers'],
            educationalThemes: ['Land ownership', 'Food justice'],
            searchKeywords: ['trending', 'Cyber-Action']
        },
        { discoveryConnections: ['Series Metadata', 'Discovery Metadata'] }
    );
    assert('featured primary title is creator title', featured.display.primaryTitle === 'Black Agriculture');
    assert(
        'featured intelligence not mixed into title',
        featured.creatorTruth.title === 'Black Agriculture' &&
            featured.intelligenceExplanation.lines.every((l) => l !== 'Black Agriculture')
    );
    assert(
        'featured keywords are discovery chips',
        featured.display.discoveryChips.some((c) => /trending|Cyber-Action|Discovery/i.test(c))
    );
    assert(
        'featured has Exploring line',
        featured.intelligenceExplanation.lines.some((l) => /^Exploring /.test(l))
    );

    console.log('\n[4] seedContentIntelligenceFromHeroTruth does not invent genre truth');
    const seeded = heroTruth.seedContentIntelligenceFromHeroTruth(
        {
            series: { seriesTitle: '', genre: '', tags: [] },
            episode: {},
            discovery: {
                mood: [],
                topics: [],
                audienceInterests: [],
                searchKeywords: [],
                sponsorshipCategories: [],
                collectionCategories: []
            },
            rights: {}
        },
        {
            assetId: 'asset-1',
            title: 'Civil Rights Archive Reel',
            mediaUrl: 'https://example.com/v.mp4',
            thumbnailUrl: '',
            assetType: 'video',
            isVideo: true
        },
        { heroTitle: 'Civil Rights Archive Reel', force: true }
    );
    assert(
        'series.genre not filled from NLP category',
        !String(seeded.series.genre || '').trim()
    );
    assert(
        'discovery may hold category classification',
        Array.isArray(seeded.discovery.topics) || Array.isArray(seeded.discovery.collectionCategories)
    );

    console.log('\n[5] Identity mutation guard');
    assert(
        'wouldMutateIdentityTerms detects drops',
        presentation.wouldMutateIdentityTerms(
            'Black Legacy Stories of Civil Rights',
            'Epic action saga of power'
        ) === true
    );
    assert(
        'identity-preserving rewrite allowed check',
        presentation.wouldMutateIdentityTerms(
            'Black Legacy Stories of Civil Rights',
            'Black Legacy Stories of Civil Rights — archival cut'
        ) === false
    );

    if (failed) {
        console.error(`\nFAIL validate-viewer-intelligence-presentation (${failed})`);
        process.exit(1);
    }
    console.log('\nPASS validate-viewer-intelligence-presentation');
    process.exit(0);
} catch (err) {
    console.error(err);
    process.exit(1);
} finally {
    await vite.close();
}
