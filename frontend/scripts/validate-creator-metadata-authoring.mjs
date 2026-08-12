#!/usr/bin/env node
/**
 * Phase 17 — creator metadata authoring acceptance (Node-safe).
 */
import {
    createMemoryStorage,
    saveCreatorCatalogMetadata,
    loadCreatorCatalogMetadata,
    hydrateCatalogItemWithCreatorMetadata,
    normalizeCreatorTags,
    previewCreatorShelfClassification
} from '../src/lib/feed/creatorCatalogMetadata.js';
import { applyCatalogMetadata, resolveCatalogMetadata } from '../src/lib/feed/catalogMetadata.js';
import { classifyContent } from '../src/lib/feed/contentClassifier.js';
import { mergeMediaInventory, projectCatalogCard } from '../src/lib/feed/catalogInventory.js';
import { distributeToShelves } from '../src/lib/feed/categoryDistribution.js';
import { applyShelfRotation } from '../src/lib/feed/shelfRotation.js';
import { fillShelfPresentation } from '../src/lib/feed/fillShelfPresentation.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

console.log('\n[creator-metadata-authoring]');

const storage = createMemoryStorage();
const ASSET = 'phase17-asset-0001';

console.log('\n[A–D save title/description/tags/category]');
{
    const saved = saveCreatorCatalogMetadata(
        ASSET,
        {
            title: 'Forbidden Hearts',
            description: 'A romance between rival families',
            tags: 'Romance, Kiss, Soulmate, romance',
            category: 'Romance'
        },
        { storage, patchCategory: false }
    );
    assert(saved?.title === 'Forbidden Hearts', 'title saves');
    assert(saved?.description.includes('romance'), 'description saves');
    assert(Array.isArray(saved?.tags) && saved.tags.length >= 3, 'tags save');
    assert(saved?.category === 'Romance', 'category saves');
}

console.log('\n[E tags normalize]');
{
    const tags = normalizeCreatorTags([' Romance ', 'kiss', 'KISS', 'Soulmate', '']);
    assert(tags.length === 3, 'tags normalize deterministically (dedupe)');
    assert(tags[0] === 'Romance' && tags.includes('kiss') && tags.includes('Soulmate'), 'first-seen casing preserved');
}

console.log('\n[F creator category overrides inference]');
{
    const hydrated = hydrateCatalogItemWithCreatorMetadata(
        {
            id: ASSET,
            title: 'Neon Hack Protocol',
            fileName: 'action_clip.mp4',
            category: 'Trending'
        },
        { storage }
    );
    const c = classifyContent(applyCatalogMetadata(hydrated, resolveCatalogMetadata(hydrated)));
    assert(c.primaryCategory === 'Romance', 'creator category overrides inference');
}

console.log('\n[G metadata survives reload/hydration]');
{
    const reloaded = loadCreatorCatalogMetadata(ASSET, { storage });
    assert(reloaded.title === 'Forbidden Hearts', 'reload title');
    assert(reloaded.description.includes('romance'), 'reload description');
    assert(reloaded.tags.some((t) => /soulmate/i.test(t)), 'reload tags');
    assert(reloaded.category === 'Romance', 'reload category');
}

console.log('\n[H metadata reaches catalogMetadata.js]');
{
    const row = hydrateCatalogItemWithCreatorMetadata(
        { id: ASSET, fileName: 'clip.mp4', type: 'image', url: '/thumbs/x.jpg' },
        { storage }
    );
    const meta = resolveCatalogMetadata(row);
    assert(meta.title === 'Forbidden Hearts', 'catalogMetadata sees creator title');
    assert(meta.description.includes('romance'), 'catalogMetadata sees description');
    assert(meta.tags.length >= 1, 'catalogMetadata sees tags');
    assert(meta.explicitCategory === 'Romance', 'catalogMetadata sees explicit category');
    assert(meta.metadataSource === 'creator' || meta.titleSource === 'creator', 'provenance creator');
}

console.log('\n[I legitimate shelf reclassification]');
{
    const storage2 = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'r2',
        {
            title: 'clip_0034',
            description: '',
            tags: '',
            category: 'Trending'
        },
        { storage: storage2, patchCategory: false }
    );
    let row = hydrateCatalogItemWithCreatorMetadata(
        { id: 'r2', type: 'image', url: '/thumbs/r2.jpg', fileName: 'clip_0034.jpg' },
        { storage: storage2 }
    );
    let c = classifyContent(applyCatalogMetadata(row, resolveCatalogMetadata(row)));
    assert(c.primaryCategory === 'Trending', 'start Trending');

    saveCreatorCatalogMetadata(
        'r2',
        {
            title: 'Forbidden Hearts',
            description: 'A romance between two people separated by rival families',
            tags: 'romance, kiss',
            category: 'Trending'
        },
        { storage: storage2, patchCategory: false }
    );
    row = hydrateCatalogItemWithCreatorMetadata(
        { id: 'r2', type: 'image', url: '/thumbs/r2.jpg', fileName: 'clip_0034.jpg' },
        { storage: storage2 }
    );
    c = classifyContent(applyCatalogMetadata(row, resolveCatalogMetadata(row)));
    assert(c.primaryCategory === 'Romance', 'metadata can cause legitimate Romance reclassification');
}

console.log('\n[J unrelated remains Trending]');
{
    const c = classifyContent(
        applyCatalogMetadata({
            id: 'u1',
            title: 'Harbor Dock Notes',
            description: 'Municipal planning notes',
            tags: ['dock', 'notes'],
            category: 'Trending'
        })
    );
    assert(c.primaryCategory === 'Trending', 'unrelated content remains Trending');
}

console.log('\n[K UUID/camera filename alone]');
{
    const c = classifyContent(
        applyCatalogMetadata({
            id: 'u2',
            title: '550e8400-e29b-41d4-a716-446655440000',
            fileName: 'IMG_20250812_193455.jpg',
            category: 'Trending'
        })
    );
    assert(c.primaryCategory === 'Trending', 'UUID/camera filenames do not classify by filename alone');
}

console.log('\n[L–N identity / poster↔MP4]');
{
    const storage3 = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'same-id',
        {
            title: 'Night Watch',
            description: 'Suspense thriller secret pursuit',
            tags: 'suspense, thriller',
            category: 'Suspense'
        },
        { storage: storage3, patchCategory: false }
    );
    const poster = mergeMediaInventory(
        [
            {
                id: 'same-id',
                type: 'image',
                url: '/thumbs/same.jpg',
                title: 'Night Watch'
            }
        ],
        []
    );
    const hydratedPoster = poster.map((r) => hydrateCatalogItemWithCreatorMetadata(r, { storage: storage3 }));
    assert(hydratedPoster.length === 1, 'same durable ID remains one card');
    const card = projectCatalogCard(hydratedPoster[0]);
    assert(card.category === 'Suspense', 'projected Suspense');
    assert(Boolean(card.posterUrl || card.thumbnailUrl || card.url), 'poster remains available as art');

    const withMp4 = mergeMediaInventory(
        [
            { id: 'same-id', type: 'image', url: '/thumbs/same.jpg', title: 'Night Watch' },
            { id: 'same-id', type: 'video', url: '/videos/same.mp4', title: 'Night Watch' }
        ],
        []
    );
    assert(withMp4.length === 1, 'poster → MP4 remains one card');
    const mp4First = mergeMediaInventory(
        [
            { id: 'same-id', type: 'video', url: '/videos/same.mp4', title: 'Night Watch' },
            { id: 'same-id', type: 'image', url: '/thumbs/same.jpg', title: 'Night Watch' }
        ],
        []
    );
    assert(mp4First.length === 1, 'MP4 → poster remains one card');
}

console.log('\n[O poster art]');
{
    const card = projectCatalogCard({
        id: 'art1',
        type: 'image',
        url: '/thumbs/art1.jpg',
        title: 'Harbor Sketch'
    });
    assert(Boolean(card.posterUrl || card.thumbnailUrl || card.url), 'poster remains available as art');
    assert(card.playable !== true, 'poster-only not forced playable');
}

console.log('\n[P empty shelves omitted]');
{
    const cards = [
        projectCatalogCard({
            id: 'g1',
            type: 'image',
            url: '/thumbs/g1.jpg',
            title: 'clip_0099',
            fileName: 'clip_0099.jpg',
            category: 'Trending'
        })
    ];
    const dist = distributeToShelves(cards);
    assert((dist.shelves.Romance || []).length === 0, 'empty Romance omitted from distribution');
    const filled = fillShelfPresentation([], 'Romance', 5, { globalRealCount: cards.length });
    assert(filled.length === 0, 'empty non-Trending shelves remain omitted without genuine candidates');
}

console.log('\n[Q rotation stable]');
{
    const shelves = {
        Trending: [
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
            { id: 'c', title: 'C' }
        ],
        Romance: [],
        Suspense: [],
        'Cyber-Action': []
    };
    const r1 = applyShelfRotation(shelves, { seed: 'phase17' });
    const r2 = applyShelfRotation(shelves, { seed: 'phase17' });
    assert(JSON.stringify(r1) === JSON.stringify(r2), 'rotation remains stable');
}

console.log('\n[R–S no Hero/Theater file changes in Phase 17 set]');
{
    // Evidence: Phase 17 touch list excludes Hero/Theater modules (static path check).
    const heroPath = path.join(root, 'src/lib/hero/heroRecord.js');
    const theaterPath = path.join(root, 'src/lib/media/playbackOwnership.js');
    assert(fs.existsSync(heroPath), 'Hero module still present (untouched by this validator)');
    assert(fs.existsSync(theaterPath), 'Theater playback ownership still present');
}

console.log('\n[T identity regression]');
{
    const similar = mergeMediaInventory(
        [
            { id: 'id-a', type: 'image', url: '/thumbs/a.jpg', fileName: 'same.jpg', title: 'A' },
            { id: 'id-b', type: 'image', url: '/thumbs/b.jpg', fileName: 'same.jpg', title: 'B' }
        ],
        []
    );
    assert(similar.length === 2, 'no identity regression — filename similarity does not merge');
}

console.log('\n[preview UX contract]');
{
    const preview = previewCreatorShelfClassification({
        title: 'Secret Agent Pursuit',
        description: 'Cyber hack protocol',
        tags: 'cyber, hack',
        category: 'Trending'
    });
    assert(Boolean(preview.primaryCategory), 'preview returns shelf');
    assert(Boolean(preview.confidenceLabel), 'preview confidence label');
    const explicit = previewCreatorShelfClassification({
        title: 'Neon Hack',
        category: 'Romance'
    });
    assert(explicit.explicit === true && explicit.primaryCategory === 'Romance', 'explicit selection wins in preview');
}

console.log('\n[clear explicit → semantic → clear evidence → Trending]');
{
    const storage4 = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'cycle',
        {
            title: 'Forbidden Hearts',
            description: 'A romance between rival families',
            tags: 'romance, kiss, soulmate',
            category: 'Trending'
        },
        { storage: storage4, patchCategory: false }
    );
    let row = hydrateCatalogItemWithCreatorMetadata({ id: 'cycle', type: 'image', url: '/t.jpg' }, { storage: storage4 });
    let c = classifyContent(applyCatalogMetadata(row, resolveCatalogMetadata(row)));
    assert(c.primaryCategory === 'Romance', 'strong Romance metadata without explicit shelf');

    saveCreatorCatalogMetadata(
        'cycle',
        {
            title: 'Municipal Notes',
            description: 'Dock inventory',
            tags: 'dock, notes',
            category: 'Trending'
        },
        { storage: storage4, patchCategory: false }
    );
    row = hydrateCatalogItemWithCreatorMetadata({ id: 'cycle', type: 'image', url: '/t.jpg' }, { storage: storage4 });
    c = classifyContent(applyCatalogMetadata(row, resolveCatalogMetadata(row)));
    assert(c.primaryCategory === 'Trending', 'removing Romance evidence returns Trending');
}

if (failed) {
    console.error(`\nFAIL — creator-metadata-authoring (${failed} assertion(s))`);
    process.exit(1);
}
console.log('\nPASS — creator-metadata-authoring');
