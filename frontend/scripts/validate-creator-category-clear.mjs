#!/usr/bin/env node
/**
 * Phase 18 — creator category clear / live reconciliation acceptance.
 *
 * Proves: explicit shelf → clear → immediate reclassify from remaining metadata;
 * stale creatorCategory must not survive; neutral → Trending; no duplicate identity.
 */
import {
    createMemoryStorage,
    saveCreatorCatalogMetadata,
    loadCreatorCatalogMetadata,
    hydrateCatalogItemWithCreatorMetadata
} from '../src/lib/feed/creatorCatalogMetadata.js';
import { applyCatalogMetadata, resolveCatalogMetadata } from '../src/lib/feed/catalogMetadata.js';
import { classifyContent } from '../src/lib/feed/contentClassifier.js';
import { mergeMediaInventory, projectCatalogCard } from '../src/lib/feed/catalogInventory.js';
import { SERIES_METADATA_STORAGE_KEY } from '../src/lib/series/seriesMetadataStorage.js';
import { REEL_TITLES_PERSISTENT_KEY } from '../src/lib/content/contentIdentityResolver.js';

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
 * @param {string} id
 * @param {ReturnType<typeof createMemoryStorage>} storage
 * @param {Record<string, unknown>} [base]
 */
function classifyId(id, storage, base = {}) {
    const row = hydrateCatalogItemWithCreatorMetadata(
        { id, type: 'image', url: '/thumbs/x.jpg', ...base },
        { storage }
    );
    return {
        row,
        classification: classifyContent(applyCatalogMetadata(row, resolveCatalogMetadata(row)))
    };
}

/**
 * Simulate live feed card that already carries a projected creatorCategory (Phase 17 bug surface).
 * @param {string} id
 * @param {string} staleCat
 * @param {ReturnType<typeof createMemoryStorage>} storage
 */
function classifyStaleProjectedCard(id, staleCat, storage) {
    const staleCard = {
        id,
        type: 'image',
        url: '/thumbs/x.jpg',
        title: 'stale-title',
        creatorCategory: staleCat,
        explicitCategory: staleCat,
        categorySource: 'creator',
        category: staleCat
    };
    const row = hydrateCatalogItemWithCreatorMetadata(staleCard, { storage });
    return {
        row,
        classification: classifyContent(applyCatalogMetadata(row, resolveCatalogMetadata(row)))
    };
}

console.log('\n[creator-category-clear]');

console.log('\n[A Romance → clear → Trending]');
{
    const storage = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'a1',
        {
            title: 'Harbor Dock Notes',
            description: 'Municipal planning inventory',
            tags: 'dock, notes',
            category: 'Romance'
        },
        { storage, patchCategory: false }
    );
    let r = classifyId('a1', storage);
    assert(r.classification.primaryCategory === 'Romance', 'explicit Romance applies');
    assert(r.row.creatorCategory === 'Romance', 'creatorCategory stamped');

    saveCreatorCatalogMetadata(
        'a1',
        {
            title: 'Harbor Dock Notes',
            description: 'Municipal planning inventory',
            tags: 'dock, notes',
            category: 'Trending'
        },
        { storage, patchCategory: false }
    );
    const loaded = loadCreatorCatalogMetadata('a1', { storage });
    assert(loaded.category === '', 'cleared category is absent on primary load');
    r = classifyStaleProjectedCard('a1', 'Romance', storage);
    assert(!r.row.creatorCategory, 'stale creatorCategory cleared from live projection');
    assert(!r.row.explicitCategory, 'stale explicitCategory cleared from live projection');
    assert(r.classification.primaryCategory === 'Trending', 'neutral after clear → Trending');
}

console.log('\n[B Suspense → clear]');
{
    const storage = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'b1',
        { title: 'Dock Notes', description: 'planning', tags: 'dock', category: 'Suspense' },
        { storage, patchCategory: false }
    );
    assert(classifyId('b1', storage).classification.primaryCategory === 'Suspense', 'explicit Suspense');
    saveCreatorCatalogMetadata(
        'b1',
        { title: 'Dock Notes', description: 'planning', tags: 'dock', category: 'Trending' },
        { storage, patchCategory: false }
    );
    const r = classifyStaleProjectedCard('b1', 'Suspense', storage);
    assert(!r.row.creatorCategory, 'Suspense creatorCategory cleared');
    assert(r.classification.primaryCategory === 'Trending', 'Suspense clear → Trending');
}

console.log('\n[C Cyber-Action → clear]');
{
    const storage = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'c1',
        { title: 'Dock Notes', description: 'planning', tags: 'dock', category: 'Cyber-Action' },
        { storage, patchCategory: false }
    );
    assert(classifyId('c1', storage).classification.primaryCategory === 'Cyber-Action', 'explicit Cyber-Action');
    saveCreatorCatalogMetadata(
        'c1',
        { title: 'Dock Notes', description: 'planning', tags: 'dock', category: 'Trending' },
        { storage, patchCategory: false }
    );
    const r = classifyStaleProjectedCard('c1', 'Cyber-Action', storage);
    assert(!r.row.creatorCategory, 'Cyber-Action creatorCategory cleared');
    assert(r.classification.primaryCategory === 'Trending', 'Cyber-Action clear → Trending');
}

console.log('\n[D clear with strong remaining Suspense metadata]');
{
    const storage = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'd1',
        {
            title: 'Night Watch',
            description: 'haunted mystery suspense thriller pursuit',
            tags: 'suspense, thriller',
            category: 'Romance'
        },
        { storage, patchCategory: false }
    );
    assert(classifyId('d1', storage).classification.primaryCategory === 'Romance', 'explicit Romance overrides');
    saveCreatorCatalogMetadata(
        'd1',
        {
            title: 'Night Watch',
            description: 'haunted mystery suspense thriller pursuit',
            tags: 'suspense, thriller',
            category: 'Trending'
        },
        { storage, patchCategory: false }
    );
    const r = classifyStaleProjectedCard('d1', 'Romance', storage);
    assert(!r.row.creatorCategory, 'explicit Romance cleared');
    assert(
        r.classification.primaryCategory === 'Suspense',
        `remaining metadata → Suspense (got ${r.classification.primaryCategory})`
    );
}

console.log('\n[E series mirror must not revive cleared category]');
{
    const storage = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'e1',
        { title: 'Dock', description: 'notes', tags: 'dock', category: 'Romance' },
        { storage, patchCategory: false }
    );
    saveCreatorCatalogMetadata(
        'e1',
        { title: 'Dock', description: 'notes', tags: 'dock', category: 'Trending' },
        { storage, patchCategory: false }
    );
    const series = JSON.parse(storage.getItem(SERIES_METADATA_STORAGE_KEY) || '{}');
    assert(series.e1?.genre === '' || !series.e1?.genre, 'mirror genre cleared on save');
    assert(
        series.e1?.creatorCategory === '' || !series.e1?.creatorCategory,
        'mirror creatorCategory cleared on save'
    );
    // Poison series after clear — primary authority must still win
    series.e1 = {
        ...series.e1,
        genre: 'Cyber-Action',
        creatorCategory: 'Cyber-Action',
        updatedAt: Date.now() + 1e9
    };
    storage.setItem(SERIES_METADATA_STORAGE_KEY, JSON.stringify(series));
    const loaded = loadCreatorCatalogMetadata('e1', { storage });
    assert(loaded.category === '', 'series poison cannot revive cleared primary category');
    const r = classifyStaleProjectedCard('e1', 'Romance', storage);
    assert(r.classification.primaryCategory === 'Trending', 'poisoned series does not force Cyber-Action');
}

console.log('\n[F Phase 17 regression — explicit still immediate]');
{
    const storage = createMemoryStorage();
    for (const cat of ['Romance', 'Suspense', 'Cyber-Action']) {
        saveCreatorCatalogMetadata(
            'f1',
            {
                title: 'Neon Hack Protocol',
                description: 'cyber romance suspense thriller hack',
                tags: 'cyber, romance, suspense',
                category: cat
            },
            { storage, patchCategory: false }
        );
        const r = classifyId('f1', storage);
        assert(r.classification.primaryCategory === cat, `explicit ${cat} still wins`);
    }
}

console.log('\n[G identity + poster/MP4 enrichment]');
{
    const storage = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'same',
        {
            title: 'Night Watch',
            description: 'suspense thriller',
            tags: 'suspense',
            category: 'Suspense'
        },
        { storage, patchCategory: false }
    );
    saveCreatorCatalogMetadata(
        'same',
        {
            title: 'Night Watch',
            description: 'suspense thriller',
            tags: 'suspense',
            category: 'Trending'
        },
        { storage, patchCategory: false }
    );
    const merged = mergeMediaInventory(
        [
            { id: 'same', type: 'image', url: '/thumbs/same.jpg' },
            { id: 'same', type: 'video', url: '/videos/same.mp4' }
        ],
        []
    ).map((r) => hydrateCatalogItemWithCreatorMetadata(r, { storage }));
    assert(merged.length === 1, 'no duplicate after clear + poster/MP4 merge');
    const card = projectCatalogCard(merged[0]);
    assert(Boolean(card.posterUrl || card.thumbnailUrl || card.url), 'poster art preserved');
    assert(card.category === 'Suspense', 'remaining Suspense metadata classifies after clear');
}

console.log('\n[H primary titles map writes empty category keys]');
{
    const storage = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'h1',
        { title: 'X', description: '', tags: '', category: 'Romance' },
        { storage, patchCategory: false }
    );
    saveCreatorCatalogMetadata(
        'h1',
        { title: 'X', description: '', tags: '', category: 'Trending' },
        { storage, patchCategory: false }
    );
    const titles = JSON.parse(storage.getItem(REEL_TITLES_PERSISTENT_KEY) || '{}');
    assert(Object.prototype.hasOwnProperty.call(titles.h1, 'category'), 'category key present after clear');
    assert(titles.h1.category === '', 'category value empty after clear');
    assert(titles.h1.creatorCategory === '', 'creatorCategory value empty after clear');
}

if (failed) {
    console.error(`\nFAIL — creator-category-clear (${failed} assertion(s))`);
    process.exit(1);
}
console.log('\nPASS — creator-category-clear');
