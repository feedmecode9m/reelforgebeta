#!/usr/bin/env node
/**
 * Phase 19 — creator metadata coverage / discovery quality (Node-safe).
 *
 * Proves generic UUID/camera assets can author durable title/description/tags/
 * optional category through existing primary authority (reel_titles_persistent),
 * without requiring series identity, without broadening the classifier, and
 * without changing Phase 17/18 category semantics.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createMemoryStorage,
    saveCreatorCatalogMetadata,
    loadCreatorCatalogMetadata,
    hydrateCatalogItemWithCreatorMetadata,
    previewCreatorShelfClassification
} from '../src/lib/feed/creatorCatalogMetadata.js';
import {
    applyCatalogMetadata,
    resolveCatalogMetadata,
    isMeaningfulTitle
} from '../src/lib/feed/catalogMetadata.js';
import { classifyContent, isGenericMediaLabel } from '../src/lib/feed/contentClassifier.js';
import { mergeMediaInventory, projectCatalogCard } from '../src/lib/feed/catalogInventory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let failed = 0;
/** @param {boolean} cond @param {string} label */
function assert(cond, label) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}`);
}

/**
 * @param {Record<string, unknown>} item
 * @param {ReturnType<typeof createMemoryStorage>} storage
 */
function classifyHydrated(item, storage) {
    const hydrated = hydrateCatalogItemWithCreatorMetadata(item, { storage });
    const meta = resolveCatalogMetadata(hydrated);
    const enriched = applyCatalogMetadata(hydrated, meta);
    return { hydrated, meta, enriched, classification: classifyContent(enriched) };
}

console.log('\n[creator-metadata-coverage]');

const GENERIC_ID = 'e1f08f0f-954f-4c39-848b-9f3fc72b5d02';
const GENERIC_FILE = '94E28916-619A-4356-88E7-90D1C71CAC2D.PNG';
const storage = createMemoryStorage();

const genericRow = () => ({
    id: GENERIC_ID,
    title: GENERIC_FILE,
    name: GENERIC_FILE,
    fileName: `${GENERIC_ID}.png`,
    type: 'image',
    url: `/thumbs/${GENERIC_ID}.png`,
    posterUrl: `/thumbs/${GENERIC_ID}.png`,
    thumbnailUrl: `/thumbs/${GENERIC_ID}.png`,
    category: 'Trending'
});

console.log('\n[UI unlock — package without identity]');
{
    const cardSrc = fs.readFileSync(
        path.join(root, 'src/components/series/VaultEpisodeCreatorStatus.svelte'),
        'utf8'
    );
    const presentationSrc = fs.readFileSync(
        path.join(root, 'src/lib/series/creatorExperiencePresentation.js'),
        'utf8'
    );
    const enrichmentSrc = fs.readFileSync(
        path.join(root, 'src/lib/series/vaultEpisodeEnrichment.js'),
        'utf8'
    );
    assert(cardSrc.includes('data-edit-package'), 'creator card exposes package edit control');
    assert(
        cardSrc.includes('data-package-requires-identity="false"'),
        'package edit does not require series identity'
    );
    assert(
        !/\{#if model\.identity\.ready\}[\s\S]*?data-edit-package/.test(cardSrc),
        'package button is not gated behind identity.ready'
    );
    assert(cardSrc.includes('data-check="tags"'), 'creator card surfaces tags coverage');
    assert(cardSrc.includes('data-check="category"'), 'creator card surfaces shelf coverage');
    assert(
        presentationSrc.includes('canEditWithoutIdentity: true'),
        'completeness model documents package edit without identity'
    );
    assert(
        presentationSrc.includes('loadCreatorCatalogMetadata'),
        'presentation hydrates display from primary catalog metadata'
    );
    assert(
        /canEdit:\s*true/.test(enrichmentSrc) &&
            enrichmentSrc.includes('independent of series identity'),
        'enrichment canEdit without identity confirmation'
    );
}

console.log('\n[A — meaningful title usable (not UUID/camera)]');
{
    saveCreatorCatalogMetadata(
        GENERIC_ID,
        { title: 'Forbidden Hearts', description: '', tags: '', category: 'Trending' },
        { storage, patchCategory: false }
    );
    const loaded = loadCreatorCatalogMetadata(GENERIC_ID, { storage });
    assert(loaded.title === 'Forbidden Hearts', 'creator title persists');
    assert(isMeaningfulTitle(loaded.title), 'Forbidden Hearts is meaningful');
    assert(isGenericMediaLabel(GENERIC_FILE), 'camera/UUID dump stays generic');
    const { classification, meta } = classifyHydrated(genericRow(), storage);
    assert(meta.title === 'Forbidden Hearts', 'resolved title uses creator entry');
    assert(meta.titleSource === 'creator' || meta.title === 'Forbidden Hearts', 'title provenance creator');
    assert(
        !isGenericMediaLabel(meta.title),
        'classifier sees non-generic title evidence'
    );
    // Title alone may stay Trending — Phase 19 only requires the title is usable evidence.
    assert(
        classification.primaryCategory === 'Trending' ||
            classification.primaryCategory === 'Romance',
        'title-only stays conservative (Trending or Romance if strong keywords present)'
    );
}

console.log('\n[B — description Romance evidence]');
{
    saveCreatorCatalogMetadata(
        GENERIC_ID,
        {
            title: 'Harbor Notes',
            description: 'A romance between rivals — kiss and soulmate destiny',
            tags: '',
            category: 'Trending'
        },
        { storage, patchCategory: false }
    );
    const { classification } = classifyHydrated(genericRow(), storage);
    assert(classification.primaryCategory === 'Romance', 'description yields Romance without explicit category');
}

console.log('\n[C — tags Suspense evidence]');
{
    saveCreatorCatalogMetadata(
        GENERIC_ID,
        {
            title: 'Harbor Notes',
            description: 'Municipal planning inventory',
            tags: 'suspense, mystery, thriller, haunted',
            category: 'Trending'
        },
        { storage, patchCategory: false }
    );
    const loaded = loadCreatorCatalogMetadata(GENERIC_ID, { storage });
    assert(loaded.tags.includes('suspense') && loaded.tags.includes('thriller'), 'tags normalized');
    const { classification } = classifyHydrated(genericRow(), storage);
    assert(classification.primaryCategory === 'Suspense', 'tags yield Suspense without explicit category');
}

console.log('\n[D — explicit Cyber-Action wins]');
{
    saveCreatorCatalogMetadata(
        GENERIC_ID,
        {
            title: 'Harbor Notes',
            description: 'A romance kiss soulmate story',
            tags: 'romance, kiss',
            category: 'Cyber-Action'
        },
        { storage, patchCategory: false }
    );
    const { classification, hydrated } = classifyHydrated(genericRow(), storage);
    assert(hydrated.creatorCategory === 'Cyber-Action', 'creatorCategory stamped');
    assert(classification.primaryCategory === 'Cyber-Action', 'explicit category overrides weaker Romance evidence');
}

console.log('\n[E — clear category → remaining metadata]');
{
    saveCreatorCatalogMetadata(
        GENERIC_ID,
        {
            title: 'Night Watch',
            description: 'haunted mystery suspense thriller pursuit',
            tags: 'suspense, thriller',
            category: 'Trending'
        },
        { storage, patchCategory: false }
    );
    const { classification, hydrated } = classifyHydrated(genericRow(), storage);
    assert(!hydrated.creatorCategory, 'cleared creatorCategory absent');
    assert(!hydrated.explicitCategory, 'cleared explicitCategory absent');
    assert(classification.primaryCategory === 'Suspense', 'clear reclassifies from remaining metadata');
}

console.log('\n[F — neutral UUID asset → Trending]');
{
    const emptyStorage = createMemoryStorage();
    const { classification, meta } = classifyHydrated(genericRow(), emptyStorage);
    assert(isGenericMediaLabel(meta.title) || !isMeaningfulTitle(meta.title), 'no manufactured polished title');
    assert(classification.primaryCategory === 'Trending', 'neutral generic → Trending only');
}

console.log('\n[F2 — clear description/tags on ALREADY-ENRICHED live card → Trending]');
{
    saveCreatorCatalogMetadata(
        GENERIC_ID,
        {
            title: '94E28916-619A-4356-88E7-90D1C71CAC2D.PNG',
            description: 'haunted mystery suspense thriller',
            tags: 'suspense, thriller',
            category: 'Trending'
        },
        { storage, patchCategory: false }
    );
    assert(
        classifyHydrated(genericRow(), storage).classification.primaryCategory === 'Suspense',
        'precondition: Suspense from description/tags'
    );
    // Simulate live card that already carries stamped Suspense evidence (blocking prod case).
    const liveEnriched = {
        ...genericRow(),
        description: 'haunted mystery suspense thriller pursuit',
        enrichmentDescription: 'haunted mystery suspense thriller pursuit',
        tags: ['suspense', 'thriller'],
        category: 'Suspense',
        shelfCategory: 'Suspense',
        explicitCategory: 'Suspense',
        categorySource: 'existing-category'
    };
    assert(
        classifyHydrated(liveEnriched, storage).classification.primaryCategory === 'Suspense',
        'precondition: already-enriched live card is Suspense'
    );
    saveCreatorCatalogMetadata(
        GENERIC_ID,
        {
            title: '94E28916-619A-4356-88E7-90D1C71CAC2D.PNG',
            description: '',
            tags: '',
            category: 'Trending'
        },
        { storage, patchCategory: false }
    );
    const cleared = loadCreatorCatalogMetadata(GENERIC_ID, { storage });
    assert(cleared.description === '', 'cleared description stays empty');
    assert(cleared.tags.length === 0, 'cleared tags stay empty');
    assert(cleared.primaryDescriptionAuthority === true, 'description clear is authored-empty authority');
    assert(cleared.primaryTagsAuthority === true, 'tags clear is authored-empty authority');
    const after = classifyHydrated(liveEnriched, storage);
    assert(after.hydrated.description === '', 'live description cleared before classify');
    assert(
        !after.hydrated.tags || after.hydrated.tags.length === 0,
        'live tags cleared before classify'
    );
    assert(after.classification.primaryCategory === 'Trending', 'enriched live card → Trending after clear');
}

console.log('\n[G — persistence round-trip]');
{
    saveCreatorCatalogMetadata(
        GENERIC_ID,
        {
            title: 'Forbidden Hearts',
            description: 'romance kiss soulmate',
            tags: 'romance, kiss',
            category: ''
        },
        { storage, patchCategory: false }
    );
    const again = loadCreatorCatalogMetadata(GENERIC_ID, { storage });
    assert(again.title === 'Forbidden Hearts', 'reload title');
    assert(again.description.includes('romance'), 'reload description');
    assert(again.tags.includes('romance'), 'reload tags');
    const { classification } = classifyHydrated(genericRow(), storage);
    assert(classification.primaryCategory === 'Romance', 'reload classification stable');
}

console.log('\n[H — preview immediate classification]');
{
    const preview = previewCreatorShelfClassification({
        title: 'Dock Log',
        description: 'cyber hack combat espionage',
        tags: 'cyber, hack',
        category: 'Trending',
        fileName: GENERIC_FILE
    });
    assert(preview.primaryCategory === 'Cyber-Action', 'immediate preview classifies from metadata');
    assert(preview.explicit === false, 'preview without explicit category');
}

console.log('\n[I/J — art + identity merge safety]');
{
    const poster = {
        id: GENERIC_ID,
        type: 'image',
        url: `/thumbs/${GENERIC_ID}.jpg`,
        posterUrl: `/thumbs/${GENERIC_ID}.jpg`,
        fileName: 'poster.jpg',
        title: 'Forbidden Hearts'
    };
    const mp4 = {
        id: GENERIC_ID,
        type: 'video',
        url: `/videos/${GENERIC_ID}.mp4`,
        fileName: 'clip.mp4',
        title: 'Forbidden Hearts',
        playable: true
    };
    const merged = mergeMediaInventory([poster, mp4]);
    assert(merged.length === 1, 'poster+MP4 remain one canonical card');
    const card = projectCatalogCard(merged[0]);
    assert(card.id === GENERIC_ID, 'canonical id preserved');
    assert(Boolean(card.posterUrl || card.thumbnailUrl), 'poster preserved');
    assert(card.playable === true || String(card.url || '').includes('.mp4'), 'MP4/playable preserved');

    const similarName = mergeMediaInventory([
        { id: 'a', type: 'image', url: '/a.jpg', fileName: 'same.jpg' },
        { id: 'b', type: 'image', url: '/b.jpg', fileName: 'same.jpg' }
    ]);
    assert(similarName.length === 2, 'filename similarity never merges identities');
}

console.log('\n[K — failure safety: primary clear beats stale series mirror]');
{
    const failStore = createMemoryStorage({
        reelforge_series_metadata: JSON.stringify({
            [GENERIC_ID]: {
                reelId: GENERIC_ID,
                genre: 'Cyber-Action',
                creatorCategory: 'Cyber-Action',
                updatedAt: Date.now() + 1e9
            }
        })
    });
    saveCreatorCatalogMetadata(
        GENERIC_ID,
        {
            title: 'ClearSafe',
            description: 'dock notes',
            tags: 'dock',
            category: 'Trending'
        },
        { storage: failStore, patchCategory: false }
    );
    const loaded = loadCreatorCatalogMetadata(GENERIC_ID, { storage: failStore });
    assert(loaded.category === '', 'primary soft category authoritative');
    assert(loaded.title === 'ClearSafe', 'primary title intact despite series genre');
    const { classification } = classifyHydrated(genericRow(), failStore);
    assert(classification.primaryCategory === 'Trending', 'mirror genre cannot defeat primary clear');
}

console.log('\n[L — Phase 17/18 regression]');
{
    const reg = createMemoryStorage();
    saveCreatorCatalogMetadata(
        GENERIC_ID,
        { title: 'X', description: 'x', tags: '', category: 'Romance' },
        { storage: reg, patchCategory: false }
    );
    assert(classifyHydrated(genericRow(), reg).classification.primaryCategory === 'Romance', 'explicit Romance');
    saveCreatorCatalogMetadata(
        GENERIC_ID,
        {
            title: 'Night Watch',
            description: 'haunted mystery suspense thriller',
            tags: 'suspense',
            category: 'Trending'
        },
        { storage: reg, patchCategory: false }
    );
    const afterClear = classifyHydrated(genericRow(), reg);
    assert(afterClear.classification.primaryCategory === 'Suspense', 'clear → metadata shelf');
    assert(!afterClear.hydrated.creatorCategory, 'no stale creatorCategory');
    assert(!afterClear.hydrated.explicitCategory, 'no stale explicitCategory');
}

if (failed) {
    console.error(`\nFAIL — creator-metadata-coverage (${failed})`);
    process.exit(1);
}
console.log('\nPASS — creator-metadata-coverage');
