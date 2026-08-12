#!/usr/bin/env node
/**
 * Phase 19 patch — authored-empty description/tags clear on already-enriched live cards.
 *
 * Blocking production sequence:
 *   Suspense evidence → confirm Suspense → save description="" tags=[] →
 *   immediate live reshelf → stale evidence gone → Trending → reload Trending.
 */
import {
    createMemoryStorage,
    saveCreatorCatalogMetadata,
    loadCreatorCatalogMetadata,
    hydrateCatalogItemWithCreatorMetadata
} from '../src/lib/feed/creatorCatalogMetadata.js';
import { applyCatalogMetadata, resolveCatalogMetadata } from '../src/lib/feed/catalogMetadata.js';
import { classifyContent } from '../src/lib/feed/contentClassifier.js';
import { mergeMediaInventory } from '../src/lib/feed/catalogInventory.js';
import { REEL_TITLES_PERSISTENT_KEY } from '../src/lib/content/contentIdentityResolver.js';
import { SERIES_METADATA_STORAGE_KEY } from '../src/lib/series/seriesMetadataStorage.js';

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
function classifyLive(item, storage) {
    const hydrated = hydrateCatalogItemWithCreatorMetadata(item, { storage });
    const enriched = applyCatalogMetadata(hydrated, resolveCatalogMetadata(hydrated));
    return { hydrated, enriched, classification: classifyContent(enriched) };
}

console.log('\n[creator-metadata-clear]');

const ASSET = 'phase19-clear-live-0001';
const storage = createMemoryStorage();

/** @type {Record<string, unknown>} */
let liveCard = {
    id: ASSET,
    title: '01 ARRIVAL OPEN v1',
    name: '01 ARRIVAL OPEN v1',
    fileName: `${ASSET}.mp4`,
    type: 'video',
    url: `/videos/${ASSET}.mp4`,
    posterUrl: `/thumbs/${ASSET}.jpg`,
    thumbnailUrl: `/thumbs/${ASSET}.jpg`,
    playable: true,
    category: 'Trending'
};

console.log('\n[1] populate strong Suspense evidence');
{
    saveCreatorCatalogMetadata(
        ASSET,
        {
            title: 'Night Watch',
            description: 'haunted mystery suspense thriller pursuit',
            tags: 'suspense, thriller, haunted',
            category: 'Trending'
        },
        { storage, patchCategory: false }
    );
    const step = classifyLive(liveCard, storage);
    liveCard = {
        ...step.enriched,
        category: step.classification.primaryCategory,
        description: step.enriched.description,
        tags: step.enriched.tags,
        enrichmentDescription: step.enriched.description
    };
    assert(step.classification.primaryCategory === 'Suspense', 'live card classifies Suspense');
    assert(String(liveCard.description || '').includes('suspense'), 'live card stamped description');
    assert(Array.isArray(liveCard.tags) && liveCard.tags.includes('suspense'), 'live card stamped tags');
}

console.log('\n[2] authored-empty description + tags via primary path');
{
    saveCreatorCatalogMetadata(
        ASSET,
        {
            title: '01 ARRIVAL OPEN v1',
            description: '',
            tags: '',
            category: 'Trending'
        },
        { storage, patchCategory: false }
    );
    const primary = loadCreatorCatalogMetadata(ASSET, { storage });
    assert(primary.description === '', 'primary description authored empty');
    assert(primary.tags.length === 0, 'primary tags authored empty');
    assert(primary.primaryDescriptionAuthority === true, 'description authority present');
    assert(primary.primaryTagsAuthority === true, 'tags authority present');

    // Stale series mirror must not revive
    storage.setItem(
        SERIES_METADATA_STORAGE_KEY,
        JSON.stringify({
            [ASSET]: {
                reelId: ASSET,
                description: 'haunted mystery suspense thriller',
                tags: ['suspense', 'thriller'],
                genre: 'Suspense',
                creatorCategory: 'Suspense',
                updatedAt: Date.now() + 1e9
            }
        })
    );
    const afterMirror = loadCreatorCatalogMetadata(ASSET, { storage });
    assert(afterMirror.description === '', 'series mirror cannot revive description');
    assert(afterMirror.tags.length === 0, 'series mirror cannot revive tags');
}

console.log('\n[3] immediate live reshelf on SAME projected card');
{
    // Card still carries stale Suspense stamps (production blocking state).
    assert(String(liveCard.description || '').includes('suspense'), 'precondition: stale description present');
    assert(Array.isArray(liveCard.tags) && liveCard.tags.length > 0, 'precondition: stale tags present');

    const step = classifyLive(liveCard, storage);
    assert(step.hydrated.description === '', 'stale description removed before classify');
    assert(!step.hydrated.tags || step.hydrated.tags.length === 0, 'stale tags removed before classify');
    assert(step.classification.primaryCategory === 'Trending', 'immediate classification → Trending');
    liveCard = {
        ...step.enriched,
        category: step.classification.primaryCategory,
        description: step.hydrated.description,
        tags: step.hydrated.tags || [],
        posterUrl: liveCard.posterUrl,
        thumbnailUrl: liveCard.thumbnailUrl,
        url: liveCard.url,
        playable: liveCard.playable,
        id: ASSET
    };
}

console.log('\n[4] remaining evidence / explicit authority still work');
{
    saveCreatorCatalogMetadata(
        ASSET,
        {
            title: 'Night Watch',
            description: 'haunted mystery suspense thriller',
            tags: 'suspense',
            category: 'Trending'
        },
        { storage, patchCategory: false }
    );
    assert(classifyLive(liveCard, storage).classification.primaryCategory === 'Suspense', 'Suspense evidence returns');

    saveCreatorCatalogMetadata(
        ASSET,
        {
            title: 'Harbor Notes',
            description: 'municipal dock notes',
            tags: 'dock',
            category: 'Romance'
        },
        { storage, patchCategory: false }
    );
    assert(classifyLive(liveCard, storage).classification.primaryCategory === 'Romance', 'explicit Romance wins');

    saveCreatorCatalogMetadata(
        ASSET,
        {
            title: 'Night Watch',
            description: 'haunted mystery suspense thriller',
            tags: 'suspense',
            category: 'Trending'
        },
        { storage, patchCategory: false }
    );
    assert(
        classifyLive(liveCard, storage).classification.primaryCategory === 'Suspense',
        'clear category → Suspense from remaining metadata'
    );
}

console.log('\n[5] neutralize again + reload equivalence');
{
    saveCreatorCatalogMetadata(
        ASSET,
        {
            title: '01 ARRIVAL OPEN v1',
            description: '',
            tags: '',
            category: 'Trending'
        },
        { storage, patchCategory: false }
    );
    // Re-stamp stale fields to force clear path on enriched card again
    liveCard = {
        ...liveCard,
        description: 'haunted mystery suspense thriller pursuit',
        tags: ['suspense', 'thriller'],
        category: 'Suspense'
    };
    const immediate = classifyLive(liveCard, storage);
    assert(immediate.classification.primaryCategory === 'Trending', 'second clear → Trending');
    liveCard = {
        ...immediate.enriched,
        category: 'Trending',
        description: immediate.hydrated.description,
        tags: immediate.hydrated.tags || []
    };

    // Reload: re-read primary + hydrate fresh projection of same id
    const reloadedStorage = createMemoryStorage({
        [REEL_TITLES_PERSISTENT_KEY]: storage.getItem(REEL_TITLES_PERSISTENT_KEY) || '{}',
        [SERIES_METADATA_STORAGE_KEY]: storage.getItem(SERIES_METADATA_STORAGE_KEY) || '{}'
    });
    const reloaded = classifyLive(
        {
            id: ASSET,
            title: '01 ARRIVAL OPEN v1',
            fileName: `${ASSET}.mp4`,
            type: 'video',
            url: `/videos/${ASSET}.mp4`,
            posterUrl: `/thumbs/${ASSET}.jpg`,
            category: 'Trending'
        },
        reloadedStorage
    );
    assert(reloaded.classification.primaryCategory === 'Trending', 'reload classification ≡ Trending');
    assert(reloaded.hydrated.description === '', 'reload description empty');
    assert(!reloaded.hydrated.tags || reloaded.hydrated.tags.length === 0, 'reload tags empty');
}

console.log('\n[6] art + identity preservation');
{
    assert(String(liveCard.posterUrl || '').includes(ASSET), 'poster preserved');
    assert(String(liveCard.url || '').includes(ASSET), 'MP4 url preserved');
    assert(liveCard.playable === true, 'playable preserved');
    const merged = mergeMediaInventory([
        { id: ASSET, type: 'image', url: `/thumbs/${ASSET}.jpg` },
        { id: ASSET, type: 'video', url: `/videos/${ASSET}.mp4`, playable: true }
    ]);
    assert(merged.length === 1, 'canonical identity remains one card');
}

if (failed) {
    console.error(`\nFAIL — creator-metadata-clear (${failed})`);
    process.exit(1);
}
console.log('\nPASS — creator-metadata-clear');
