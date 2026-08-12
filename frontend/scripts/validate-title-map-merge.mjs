#!/usr/bin/env node
/**
 * Phase 22 — title-map merge hygiene.
 *
 * Reproduces Phase 21 latent blocker:
 * title-only save replacing reel_titles_persistent[id] and wiping
 * description/tags/category → series mirror resurrection.
 *
 * Proves merge-on-write preserves creator metadata across:
 * - shared persistentTitles.saveTitle path (Master Edit / StudioExperience)
 * - HeroManagerPanel fallback writePersistentTitle path
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createMemoryStorage,
    saveCreatorCatalogMetadata,
    loadCreatorCatalogMetadata,
    hydrateCatalogItemWithCreatorMetadata
} from '../src/lib/feed/creatorCatalogMetadata.js';
import { resolveCatalogMetadata, applyCatalogMetadata } from '../src/lib/feed/catalogMetadata.js';
import { classifyContent } from '../src/lib/feed/contentClassifier.js';
import { projectCatalogCard, mergeMediaInventory } from '../src/lib/feed/catalogInventory.js';
import {
    mergePersistentTitleEntry,
    mergeTitleIntoPersistentMap
} from '../src/lib/content/persistentTitleMap.js';
import { REEL_TITLES_PERSISTENT_KEY } from '../src/lib/content/contentIdentityResolver.js';
import { SERIES_METADATA_STORAGE_KEY } from '../src/lib/series/seriesMetadataStorage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

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

function read(rel) {
    return readFileSync(join(root, rel), 'utf8');
}

/**
 * Shared title-only writer — mirrors viewerContext persistentTitles.saveTitle merge.
 * @param {ReturnType<typeof createMemoryStorage>} storage
 * @param {string} reelId
 * @param {string} title
 */
function sharedSaveTitle(storage, reelId, title) {
    const raw = storage.getItem(REEL_TITLES_PERSISTENT_KEY);
    /** @type {Record<string, Record<string, unknown>>} */
    const map = raw ? JSON.parse(raw) || {} : {};
    const next = mergeTitleIntoPersistentMap(map, reelId, {
        title,
        title_original: title,
        savedAt: new Date().toISOString()
    });
    storage.setItem(REEL_TITLES_PERSISTENT_KEY, JSON.stringify(next));
}

/**
 * Hero fallback writer — mirrors HeroManagerPanel.writePersistentTitle when store absent.
 * @param {ReturnType<typeof createMemoryStorage>} storage
 * @param {string} reelId
 * @param {string} title
 */
function heroFallbackWritePersistentTitle(storage, reelId, title) {
    sharedSaveTitle(storage, reelId, title);
}

/**
 * @param {ReturnType<typeof createMemoryStorage>} storage
 * @param {string} id
 */
function readEntry(storage, id) {
    const raw = storage.getItem(REEL_TITLES_PERSISTENT_KEY);
    const map = raw ? JSON.parse(raw) || {} : {};
    return map[id] && typeof map[id] === 'object' ? map[id] : null;
}

/**
 * @param {ReturnType<typeof createMemoryStorage>} storage
 * @param {string} id
 * @param {Record<string, unknown>} [extra]
 */
function project(storage, id, extra = {}) {
    const hydrated = hydrateCatalogItemWithCreatorMetadata(
        {
            id,
            type: 'video',
            url: 'https://cdn.example/probe.mp4',
            thumbnailUrl: 'https://cdn.example/probe.jpg',
            posterUrl: 'https://cdn.example/probe.jpg',
            playable: true,
            fileName: 'IMG_PROBE.MP4',
            ...extra
        },
        { storage }
    );
    return projectCatalogCard(hydrated, {});
}

console.log('\n[title-map-merge — Phase 22]');

// ── Source wiring ────────────────────────────────────────────
console.log('\n[source wiring]');
const helperSrc = read('src/lib/content/persistentTitleMap.js');
const viewerSrc = read('src/viewer/viewerContext.js');
const heroSrc = read('src/components/studio/HeroManagerPanel.svelte');
const studioSrc = read('src/components/experiences/StudioExperience.svelte');
const pkg = JSON.parse(read('package.json'));

assert(helperSrc.includes('mergePersistentTitleEntry'), 'helper exports mergePersistentTitleEntry');
assert(helperSrc.includes('...base'), 'helper spreads prior entry');
assert(viewerSrc.includes('mergeTitleIntoPersistentMap'), 'viewerContext imports merge helper');
assert(viewerSrc.includes('mergeTitleIntoPersistentMap(current, reelId'), 'saveTitle uses merge helper');
assert(!/\[reelId\]:\s*\{\s*\.\.\.titleData/.test(viewerSrc), 'saveTitle no longer replaces with titleData alone');
assert(heroSrc.includes('mergeTitleIntoPersistentMap'), 'HeroManagerPanel imports merge helper');
assert(heroSrc.includes('mergeTitleIntoPersistentMap(map, reelId'), 'Hero fallback merges');
assert(studioSrc.includes('persistentTitles?.saveTitle'), 'StudioExperience uses shared saveTitle');
assert(pkg.scripts?.['validate:title-map-merge'], 'package.json registers validate:title-map-merge');

// ── Pure merge unit ──────────────────────────────────────────
console.log('\n[pure merge]');
{
    const prior = {
        title: 'Original',
        description: 'forbidden romance',
        tags: ['romance'],
        category: 'Romance',
        creatorCategory: 'Romance',
        primaryDescriptionAuthority: true,
        savedAt: 1
    };
    const merged = mergePersistentTitleEntry(prior, {
        title: 'Edited',
        title_original: 'Edited',
        savedAt: 2
    });
    assert(merged.title === 'Edited', 'merge updates title');
    assert(merged.description === 'forbidden romance', 'merge keeps description');
    assert(JSON.stringify(merged.tags) === JSON.stringify(['romance']), 'merge keeps tags');
    assert(merged.category === 'Romance', 'merge keeps category');
    assert(merged.creatorCategory === 'Romance', 'merge keeps creatorCategory');
    assert(merged.primaryDescriptionAuthority === true, 'merge keeps authority marker');
    assert(Object.keys(prior).every((k) => k === 'title' || k === 'savedAt' || k in merged), 'no keys lost');
}

// ── A–H: seed → title-only → hydrate → reload ────────────────
console.log('\n[A–H shared saveTitle path — Romance survive]');
{
    const storage = createMemoryStorage();
    const id = 'p22-romance';
    saveCreatorCatalogMetadata(
        id,
        {
            title: 'Original Title',
            description: 'A forbidden romance blooms under neon rain',
            tags: 'romance, love',
            category: 'Romance'
        },
        { storage, patchCategory: false }
    );
    const before = readEntry(storage, id);
    assert(Boolean(before), 'seeded primary entry');
    assert(before.description, 'seed description present');
    assert(before.category === 'Romance', 'seed category Romance');
    assert(Object.prototype.hasOwnProperty.call(before, 'creatorCategory'), 'seed creatorCategory key');

    sharedSaveTitle(storage, id, 'Edited Title');

    const after = readEntry(storage, id);
    assert(after.title === 'Edited Title', 'C: title == Edited Title');
    assert(after.description === before.description, 'C: description unchanged');
    assert(JSON.stringify(after.tags) === JSON.stringify(before.tags), 'C: tags unchanged');
    assert(after.category === 'Romance', 'C: category remains Romance');
    assert(after.creatorCategory === 'Romance', 'C: creatorCategory remains Romance');
    assert(
        Object.keys(before).every((k) => k === 'title' || k === 'title_original' || k === 'savedAt' || k in after),
        'D: no existing keys lost'
    );

    const card1 = project(storage, id);
    assert(card1.category === 'Romance', 'F: classification remains Romance');
    assert(/romance/i.test(String(card1.description || '')), 'F: description still Romance evidence');

    const card2 = project(storage, id);
    assert(card2.category === card1.category, 'H: reload shelf identical');
    assert(card2.description === card1.description, 'H: reload description identical');
    assert(loadCreatorCatalogMetadata(id, { storage }).title === 'Edited Title', 'H: reload title identical');
}

// ── Clear-state regression ───────────────────────────────────
console.log('\n[clear-state + title-only]');
{
    const storage = createMemoryStorage();
    const id = 'p22-cleared';
    saveCreatorCatalogMetadata(
        id,
        { title: 'Keep', description: 'forbidden romance', tags: 'romance', category: 'Romance' },
        { storage, patchCategory: false }
    );
    saveCreatorCatalogMetadata(
        id,
        { title: 'Keep', description: '', tags: '', category: '' },
        { storage, patchCategory: false }
    );
    const cleared = readEntry(storage, id);
    assert(Object.prototype.hasOwnProperty.call(cleared, 'description'), 'cleared description key exists');
    assert(cleared.description === '', 'cleared description value ""');
    assert(Object.prototype.hasOwnProperty.call(cleared, 'tags'), 'cleared tags key exists');
    assert(Array.isArray(cleared.tags) && cleared.tags.length === 0, 'cleared tags []');
    assert(Object.prototype.hasOwnProperty.call(cleared, 'category'), 'cleared category key exists');
    assert(cleared.category === '', 'cleared category ""');

    sharedSaveTitle(storage, id, 'Keep Edited');
    const after = readEntry(storage, id);
    assert(after.title === 'Keep Edited', 'title updated after clear');
    assert(Object.prototype.hasOwnProperty.call(after, 'description') && after.description === '', 'description key still ""');
    assert(Object.prototype.hasOwnProperty.call(after, 'tags') && Array.isArray(after.tags) && after.tags.length === 0, 'tags key still []');
    assert(Object.prototype.hasOwnProperty.call(after, 'category') && after.category === '', 'category key still ""');
    assert(Object.prototype.hasOwnProperty.call(after, 'creatorCategory'), 'creatorCategory key retained');

    // Poison mirror — must not resurrect
    storage.setItem(
        SERIES_METADATA_STORAGE_KEY,
        JSON.stringify({
            [id]: {
                reelId: id,
                episodeTitle: 'Vic Poison',
                description: 'suspense thriller mystery chase',
                tags: ['suspense', 'thriller'],
                genre: 'Suspense',
                creatorCategory: 'Suspense',
                seasonNumber: 1,
                episodeNumber: 1
            }
        })
    );
    const loaded = loadCreatorCatalogMetadata(id, { storage });
    assert(loaded.description === '', 'mirror cannot resurrect description');
    assert(loaded.tags.length === 0, 'mirror cannot resurrect tags');
    assert(loaded.category === '', 'mirror cannot resurrect category');
    assert(loaded.primaryDescriptionAuthority === true, 'primary description authority retained');
    assert(loaded.primaryTagsAuthority === true, 'primary tags authority retained');
    assert(loaded.primaryCategoryAuthority === true, 'primary category authority retained');

    const card = project(storage, id, {
        description: 'stale live suspense',
        tags: ['stale'],
        creatorCategory: 'Suspense',
        category: 'Suspense'
    });
    assert(card.category === 'Trending', 'after clear + title edit → Trending');
}

// ── Series-mirror resurrection (exact Phase 21 blocker) ──────
console.log('\n[series-mirror resurrection closed]');
{
    const storage = createMemoryStorage();
    const id = 'p22-mirror';
    saveCreatorCatalogMetadata(
        id,
        { title: 'Base', description: 'forbidden romance', tags: 'love', category: 'Romance' },
        { storage, patchCategory: false }
    );
    // Pre-fix replace-style wipe (simulates old bug), then prove new path does NOT wipe
    const wiped = {
        title: 'Should Not Happen',
        title_original: 'Should Not Happen',
        savedAt: Date.now()
    };
    // Demonstrate old behavior would lose keys:
    assert(!('description' in wiped), 'legacy replace object lacks description');

    // Real path after fix:
    saveCreatorCatalogMetadata(
        id,
        { title: 'Base', description: '', tags: '', category: '' },
        { storage, patchCategory: false }
    );
    sharedSaveTitle(storage, id, 'Title After Clear');
    storage.setItem(
        SERIES_METADATA_STORAGE_KEY,
        JSON.stringify({
            [id]: {
                reelId: id,
                description: 'suspense thriller mystery',
                tags: ['suspense', 'thriller'],
                genre: 'Suspense',
                creatorCategory: 'Suspense',
                seasonNumber: 1,
                episodeNumber: 1
            }
        })
    );
    const loaded = loadCreatorCatalogMetadata(id, { storage });
    const card = project(storage, id, {
        description: 'suspense thriller mystery',
        tags: ['suspense'],
        creatorCategory: 'Suspense',
        category: 'Suspense'
    });
    assert(loaded.title === 'Title After Clear', 'title from title-only save');
    assert(loaded.description === '' && loaded.tags.length === 0 && loaded.category === '', 'primary empties authoritative');
    assert(card.category === 'Trending', 'classification not resurrected to Suspense');
}

// ── Master Edit / Hero paths ─────────────────────────────────
console.log('\n[Master Edit + Hero title paths]');
{
    const storage = createMemoryStorage();
    const id = 'p22-master';
    saveCreatorCatalogMetadata(
        id,
        {
            title: 'Original',
            description: 'tense thriller suspense mystery',
            tags: 'thriller',
            category: 'Suspense'
        },
        { storage, patchCategory: false }
    );
    // Master Edit / StudioExperience → sharedSaveTitle
    sharedSaveTitle(storage, id, 'Master Edited');
    let entry = readEntry(storage, id);
    assert(entry.title === 'Master Edited', 'Master Edit title');
    assert(entry.category === 'Suspense', 'Master Edit preserves Suspense category');
    assert(project(storage, id).category === 'Suspense', 'Master Edit shelf Suspense');

    // Hero fallback path
    const storage2 = createMemoryStorage();
    const id2 = 'p22-hero';
    saveCreatorCatalogMetadata(
        id2,
        {
            title: 'Hero Original',
            description: '',
            tags: 'cyber, neon, heist, action',
            category: 'Trending'
        },
        { storage: storage2, patchCategory: false }
    );
    heroFallbackWritePersistentTitle(storage2, id2, 'Hero Edited');
    entry = readEntry(storage2, id2);
    assert(entry.title === 'Hero Edited', 'Hero fallback title');
    assert(JSON.stringify(entry.tags) === JSON.stringify(['cyber', 'neon', 'heist', 'action']), 'Hero fallback keeps tags');
    assert(project(storage2, id2).category === 'Cyber-Action', 'Hero fallback shelf Cyber-Action');
}

// ── Classification matrix ────────────────────────────────────
console.log('\n[classification after title-only]');
const classCases = [
    {
        name: 'Romance',
        fields: { title: 'T', description: 'forbidden romance love', tags: '', category: 'Trending' },
        edit: 'T2',
        expect: 'Romance'
    },
    {
        name: 'Suspense',
        fields: { title: 'T', description: 'tense thriller mystery chase', tags: 'suspense', category: 'Trending' },
        edit: 'T2',
        expect: 'Suspense'
    },
    {
        name: 'Cyber-Action',
        fields: { title: 'T', description: '', tags: 'cyber, neon, heist, action', category: 'Trending' },
        edit: 'T2',
        expect: 'Cyber-Action'
    },
    {
        name: 'neutral Trending',
        fields: { title: 'Camera Dump', description: '', tags: '', category: 'Trending' },
        edit: 'Camera Dump 2',
        expect: 'Trending'
    },
    {
        name: 'explicit Cyber',
        fields: { title: 'T', description: 'forbidden romance', tags: 'romance', category: 'Cyber-Action' },
        edit: 'T2',
        expect: 'Cyber-Action'
    },
    {
        name: 'clear explicit → Romance evidence',
        setup: { title: 'T', description: 'forbidden romance', tags: '', category: 'Suspense' },
        clear: { title: 'T', description: 'forbidden romance', tags: '', category: '' },
        edit: 'T2',
        expect: 'Romance'
    },
    {
        name: 'all optional cleared → Trending',
        setup: { title: 'T', description: 'forbidden romance', tags: 'cyber', category: 'Romance' },
        clear: { title: 'T', description: '', tags: '', category: '' },
        edit: 'T2',
        expect: 'Trending'
    }
];

for (const c of classCases) {
    const storage = createMemoryStorage();
    const id = 'p22-class-' + c.name.replace(/\W+/g, '_');
    if (c.setup) saveCreatorCatalogMetadata(id, c.setup, { storage, patchCategory: false });
    if (c.clear) saveCreatorCatalogMetadata(id, c.clear, { storage, patchCategory: false });
    if (c.fields) saveCreatorCatalogMetadata(id, c.fields, { storage, patchCategory: false });
    sharedSaveTitle(storage, id, c.edit);
    const card = project(storage, id);
    assert(card.category === c.expect, `${c.name} → ${c.expect} (got ${card.category})`);
}

// ── Vic G / series safety after title edit ───────────────────
console.log('\n[Vic G safety after title-only]');
{
    const storage = createMemoryStorage();
    const id = 'p22-vic';
    saveCreatorCatalogMetadata(
        id,
        {
            title: 'Creator',
            description: 'forbidden romance',
            tags: 'romance',
            category: 'Romance'
        },
        { storage, patchCategory: false }
    );
    sharedSaveTitle(storage, id, 'Creator Edited');
    storage.setItem(
        SERIES_METADATA_STORAGE_KEY,
        JSON.stringify({
            [id]: {
                reelId: id,
                episodeTitle: 'Vic Overwrite',
                description: 'cyber neon heist action',
                tags: ['cyber', 'action'],
                genre: 'Cyber-Action',
                creatorCategory: 'Cyber-Action',
                seasonNumber: 1,
                episodeNumber: 1
            }
        })
    );
    const loaded = loadCreatorCatalogMetadata(id, { storage });
    assert(loaded.title === 'Creator Edited', 'primary title wins');
    assert(loaded.description === 'forbidden romance', 'primary description wins over Vic G');
    assert(loaded.category === 'Romance', 'primary category wins over Vic G');
    assert(project(storage, id).category === 'Romance', 'shelf remains Romance');
}

// ── Media / identity ─────────────────────────────────────────
console.log('\n[identity / media]');
{
    const storage = createMemoryStorage();
    const id = 'p22-media';
    const base = {
        id,
        url: 'https://cdn.example/unique.mp4',
        thumbnailUrl: 'https://cdn.example/unique.jpg',
        posterUrl: 'https://cdn.example/unique.jpg',
        type: 'video',
        playable: true,
        fileName: 'IMG_9999.MP4'
    };
    saveCreatorCatalogMetadata(
        id,
        { title: 'Meta', description: 'forbidden romance', tags: 'love', category: 'Romance' },
        { storage, patchCategory: false }
    );
    sharedSaveTitle(storage, id, 'Meta Edited');
    const card = project(storage, id, base);
    assert(card.id === id, 'canonical ID unchanged');
    assert(String(card.thumbnailUrl) === base.thumbnailUrl, 'thumbnail unchanged');
    assert(String(card.posterUrl) === base.posterUrl, 'poster unchanged');
    assert(String(card.mediaUrl || card.url) === base.url, 'MP4 URL unchanged');
    const merged = mergeMediaInventory([
        { id, type: 'image', url: base.thumbnailUrl, thumbnailUrl: base.thumbnailUrl, fileName: 'IMG_9999.JPG' },
        { id, type: 'video', url: base.url, thumbnailUrl: base.thumbnailUrl, fileName: 'IMG_9999.MP4', playable: true }
    ]);
    assert(merged.filter((x) => x.id === id).length === 1, 'poster+MP4 one identity');
}

// ── Failure safety ───────────────────────────────────────────
console.log('\n[failure safety]');
{
    const base = createMemoryStorage();
    const id = 'p22-fail';
    saveCreatorCatalogMetadata(
        id,
        {
            title: 'Prior',
            description: 'forbidden romance',
            tags: 'romance',
            category: 'Romance'
        },
        { storage: base, patchCategory: false }
    );
    const priorEntry = readEntry(base, id);
    const storage = {
        getItem: (k) => base.getItem(k),
        setItem: (k, v) => {
            if (k === REEL_TITLES_PERSISTENT_KEY) throw new Error('title persist boom');
            return base.setItem(k, v);
        },
        removeItem: (k) => base.removeItem(k)
    };
    let threw = false;
    try {
        sharedSaveTitle(storage, id, 'Should Not Persist');
    } catch {
        threw = true;
    }
    assert(threw, 'title persist failure throws');
    const durable = readEntry(base, id);
    assert(durable.title === 'Prior', 'prior durable title unchanged');
    assert(durable.description === priorEntry.description, 'prior description not lost');
    assert(durable.category === 'Romance', 'prior category not lost');
}

console.log('');
if (failed) {
    console.error(`FAIL — title-map-merge (${failed} assertion(s))`);
    process.exit(1);
}
console.log('PASS — title-map-merge');
process.exit(0);
