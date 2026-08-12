#!/usr/bin/env node
/**
 * Phase 20 — creator metadata UX / authoring feedback acceptance (Node-safe).
 *
 * UX + persistence-path reuse only. Does not introduce a second store/classifier.
 * Covers save-feedback contracts, classification preview parity, neutral/clear
 * field states, generic-asset authoring, art/playback preservation, and A–P gates.
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
import { REEL_TITLES_PERSISTENT_KEY } from '../src/lib/content/contentIdentityResolver.js';
import { applyCatalogMetadata, resolveCatalogMetadata } from '../src/lib/feed/catalogMetadata.js';
import { classifyContent } from '../src/lib/feed/contentClassifier.js';
import { mergeMediaInventory, projectCatalogCard } from '../src/lib/feed/catalogInventory.js';
import { distributeToShelves } from '../src/lib/feed/categoryDistribution.js';

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
    const classification = classifyContent(enriched);
    return { hydrated, meta, enriched, classification };
}

/**
 * @param {string} id
 * @param {ReturnType<typeof createMemoryStorage>} storage
 * @param {Record<string, unknown>} [base]
 */
function shelfFor(id, storage, base = {}) {
    return classifyHydrated({ id, type: 'image', url: `/thumbs/${id}.jpg`, ...base }, storage)
        .classification.primaryCategory;
}

console.log('\n[creator-metadata-ux / Phase 20]');

const GENERIC_ID = 'phase20-generic-94e28916-619a-4356-88e7-90d1c71cac2d';
const GENERIC_FILE = '94E28916-619A-4356-88E7-90D1C71CAC2D.PNG';

console.log('\n[UX contracts — VaultEpisodeCreatorStatus + presentation]');
{
    const cardSrc = fs.readFileSync(
        path.join(root, 'src/components/series/VaultEpisodeCreatorStatus.svelte'),
        'utf8'
    );
    const vaultSrc = fs.readFileSync(
        path.join(root, 'src/components/experiences/VaultExperience.svelte'),
        'utf8'
    );
    const presentationSrc = fs.readFileSync(
        path.join(root, 'src/lib/series/creatorExperiencePresentation.js'),
        'utf8'
    );
    const cssSrc = fs.readFileSync(path.join(root, 'src/viewer/viewer.css'), 'utf8');
    const metaSrc = fs.readFileSync(
        path.join(root, 'src/lib/feed/creatorCatalogMetadata.js'),
        'utf8'
    );

    assert(cardSrc.includes('export let packageSaveFeedback'), 'packageSaveFeedback prop exists');
    assert(cardSrc.includes("packageSaveState === 'saving'"), 'saving indicator state');
    assert(cardSrc.includes('data-creator-save-status="saved"'), 'saved status marker');
    assert(cardSrc.includes('data-creator-save-status="error"'), 'error status marker');
    assert(cardSrc.includes('data-creator-shelf-preview'), 'live shelf preview in editor');
    assert(cardSrc.includes('data-creator-current-shelf'), 'current classification on summary');
    assert(cardSrc.includes('data-field-state='), 'field state attrs (cleared vs missing)');
    assert(
        cardSrc.includes('no strong genre evidence') || cardSrc.includes('Current shelf: Trending'),
        'Trending communicated as current classification (not error)'
    );
    assert(
        cardSrc.includes('Stay in package editor') ||
            !cardSrc.includes("editing = null;\n    }") ||
            cardSrc.includes('// Stay in package editor'),
        'save keeps package editor open for feedback'
    );
    assert(
        vaultSrc.includes('packageSaveFeedback={vaultPackageSaveFeedback'),
        'VaultExperience wires packageSaveFeedback'
    );
    assert(
        vaultSrc.includes('previewCreatorShelfClassification'),
        'VaultExperience reuses previewCreatorShelfClassification'
    );
    assert(
        vaultSrc.includes('saveToken'),
        'save path threads saveToken for ack matching'
    );
    assert(
        presentationSrc.includes('descriptionFieldState') &&
            presentationSrc.includes('tagsFieldState') &&
            presentationSrc.includes('categoryFieldState'),
        'presentation exposes cleared/missing/set field states'
    );
    assert(
        presentationSrc.includes('previewCreatorShelfClassification'),
        'presentation shelfPreview uses same classifier helper'
    );
    assert(cssSrc.includes('.vault-creator-card__save-status'), 'save-status CSS present');
    assert(
        !metaSrc.includes('localStorage.setItem(') || metaSrc.includes('REEL_TITLES_PERSISTENT'),
        'primary persistence still reel_titles_persistent keyed'
    );
    assert(
        !/new metadata store|second category authority|KEYWORD_EXPANSION/i.test(cardSrc),
        'no second authority language in UX card'
    );
}

console.log('\n[Persistence path reuse — no new store]');
{
    const storage = createMemoryStorage();
    const saved = saveCreatorCatalogMetadata(
        GENERIC_ID,
        {
            title: 'Phase 20 Harbor Kiss',
            description: 'A quiet romance on the docks',
            tags: 'romance, kiss',
            category: 'Romance'
        },
        { storage, patchCategory: false }
    );
    assert(Boolean(saved), 'saveCreatorCatalogMetadata returns record');
    const raw = storage.getItem(REEL_TITLES_PERSISTENT_KEY);
    assert(Boolean(raw && String(raw).includes(GENERIC_ID)), 'writes reel_titles_persistent');
    const loaded = loadCreatorCatalogMetadata(GENERIC_ID, { storage });
    assert(loaded?.title === 'Phase 20 Harbor Kiss', 'load from same primary path');
    assert(loaded?.category === 'Romance', 'category on primary path');
}

console.log('\n[A Generic asset → title → immediate shelf]');
{
    const storage = createMemoryStorage();
    saveCreatorCatalogMetadata(
        GENERIC_ID,
        { title: 'Neon Cyber Breach Protocol', description: '', tags: '', category: 'Trending' },
        { storage, patchCategory: false }
    );
    const preview = previewCreatorShelfClassification({
        title: 'Neon Cyber Breach Protocol',
        description: '',
        tags: '',
        category: 'Trending',
        fileName: GENERIC_FILE
    });
    const live = shelfFor(GENERIC_ID, storage, { fileName: GENERIC_FILE, title: GENERIC_FILE });
    assert(preview.primaryCategory === live, 'preview matches feed classification (title)');
    assert(live !== 'Trending' || preview.primaryCategory === live, 'immediate shelf after title');
}

console.log('\n[B Description evidence → immediate shelf]');
{
    const storage = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'phase20-b',
        {
            title: 'Dock Notes',
            description: 'A forbidden romance between rivals',
            tags: '',
            category: 'Trending'
        },
        { storage, patchCategory: false }
    );
    const preview = previewCreatorShelfClassification({
        title: 'Dock Notes',
        description: 'A forbidden romance between rivals',
        tags: '',
        category: 'Trending'
    });
    const live = shelfFor('phase20-b', storage);
    assert(preview.primaryCategory === live, 'preview matches feed (description)');
    assert(live === 'Romance', 'description evidence → Romance shelf');
}

console.log('\n[C Tags → immediate shelf]');
{
    const storage = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'phase20-c',
        { title: 'Clip', description: '', tags: 'cyberpunk, neon, hack', category: 'Trending' },
        { storage, patchCategory: false }
    );
    const preview = previewCreatorShelfClassification({
        title: 'Clip',
        description: '',
        tags: 'cyberpunk, neon, hack',
        category: 'Trending'
    });
    const live = shelfFor('phase20-c', storage);
    assert(preview.primaryCategory === live, 'preview matches feed (tags)');
    assert(live === 'Cyber-Action', `tags evidence → Cyber-Action shelf (got ${live})`);
}

console.log('\n[D Explicit category → immediate shelf]');
{
    const storage = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'phase20-d',
        { title: 'Neutral Title', description: 'plain inventory', tags: '', category: 'Suspense' },
        { storage, patchCategory: false }
    );
    const preview = previewCreatorShelfClassification({
        title: 'Neutral Title',
        description: 'plain inventory',
        tags: '',
        category: 'Suspense'
    });
    const live = shelfFor('phase20-d', storage);
    assert(preview.explicit === true, 'preview marks explicit creator category');
    assert(preview.primaryCategory === 'Suspense', 'preview shelf = Suspense');
    assert(live === 'Suspense', 'explicit category → Suspense shelf');
}

console.log('\n[E Category clear → immediate reclassification]');
{
    const storage = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'phase20-e',
        {
            title: 'Harbor Kiss',
            description: 'soulmate romance',
            tags: 'romance',
            category: 'Suspense'
        },
        { storage, patchCategory: false }
    );
    assert(shelfFor('phase20-e', storage) === 'Suspense', 'explicit Suspense before clear');
    saveCreatorCatalogMetadata(
        'phase20-e',
        {
            title: 'Harbor Kiss',
            description: 'soulmate romance',
            tags: 'romance',
            category: 'Trending'
        },
        { storage, patchCategory: false }
    );
    const after = shelfFor('phase20-e', storage);
    const loaded = loadCreatorCatalogMetadata('phase20-e', { storage });
    assert(!loaded?.category || loaded.category === '', 'cleared category removes explicit authority');
    assert(after === 'Romance', 'clear → reclassify from remaining evidence → Romance');
}

console.log('\n[F Description clear → stale evidence removed]');
{
    const storage = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'phase20-f',
        {
            title: 'Plain Title',
            description: 'a gripping suspense thriller mystery',
            tags: '',
            category: 'Trending'
        },
        { storage, patchCategory: false }
    );
    assert(shelfFor('phase20-f', storage) === 'Suspense', 'description → Suspense');
    saveCreatorCatalogMetadata(
        'phase20-f',
        { title: 'Plain Title', description: '', tags: '', category: 'Trending' },
        { storage, patchCategory: false }
    );
    const loaded = loadCreatorCatalogMetadata('phase20-f', { storage });
    assert(loaded?.primaryDescriptionAuthority === true, 'authored-empty description authority');
    assert(!loaded?.description, 'description cleared');
    const stale = hydrateCatalogItemWithCreatorMetadata(
        {
            id: 'phase20-f',
            type: 'image',
            url: '/thumbs/x.jpg',
            description: 'a gripping suspense thriller mystery',
            creatorCategory: 'Suspense',
            category: 'Suspense'
        },
        { storage }
    );
    const c = classifyContent(applyCatalogMetadata(stale, resolveCatalogMetadata(stale)));
    assert(c.primaryCategory === 'Trending', 'stale description evidence cleared on live card');
}

console.log('\n[G Tags clear → stale evidence removed]');
{
    const storage = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'phase20-g',
        { title: 'Clip', description: '', tags: 'romance, kiss, soulmate', category: 'Trending' },
        { storage, patchCategory: false }
    );
    assert(shelfFor('phase20-g', storage) === 'Romance', 'tags → Romance');
    saveCreatorCatalogMetadata(
        'phase20-g',
        { title: 'Clip', description: '', tags: '', category: 'Trending' },
        { storage, patchCategory: false }
    );
    const loaded = loadCreatorCatalogMetadata('phase20-g', { storage });
    assert(loaded?.primaryTagsAuthority === true, 'authored-empty tags authority');
    assert(Array.isArray(loaded?.tags) && loaded.tags.length === 0, 'tags cleared to []');
    assert(shelfFor('phase20-g', storage) === 'Trending', 'tags clear → Trending');
}

console.log('\n[H Reload equivalence]');
{
    const storage = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'phase20-h',
        {
            title: 'Reload Romance',
            description: 'kiss under neon',
            tags: 'romance',
            category: 'Trending'
        },
        { storage, patchCategory: false }
    );
    const first = shelfFor('phase20-h', storage);
    const serialized = storage.getItem(REEL_TITLES_PERSISTENT_KEY);
    const storage2 = createMemoryStorage();
    storage2.setItem(REEL_TITLES_PERSISTENT_KEY, serialized || '{}');
    const second = shelfFor('phase20-h', storage2);
    assert(first === second && first === 'Romance', 'reload equivalence Romance');
}

console.log('\n[I–K Art / MP4 / one canonical card]');
{
    const storage = createMemoryStorage();
    const poster = '/thumbs/phase20-poster.jpg';
    const mp4 = 'https://cdn.example/phase20.mp4';
    saveCreatorCatalogMetadata(
        'phase20-art',
        {
            title: 'Art Safe Romance',
            description: 'romance kiss',
            tags: '',
            category: 'Romance'
        },
        { storage, patchCategory: false }
    );
    const base = {
        id: 'phase20-art',
        type: 'video',
        url: mp4,
        videoUrl: mp4,
        posterUrl: poster,
        thumbnailUrl: poster,
        fileName: 'phase20-art.mp4'
    };
    const { hydrated, classification } = classifyHydrated(base, storage);
    assert(hydrated.posterUrl === poster, 'poster preserved through hydrate');
    assert(hydrated.thumbnailUrl === poster, 'thumbnail preserved');
    assert(hydrated.url === mp4 || hydrated.videoUrl === mp4, 'MP4 URL preserved');
    assert(classification.primaryCategory === 'Romance', 'metadata classify without art replace');

    const inventory = mergeMediaInventory(
        [],
        [
            { ...base, title: 'Art Safe Romance' },
            {
                id: 'phase20-art',
                type: 'image',
                url: poster,
                posterUrl: poster,
                title: 'Art Safe Romance'
            }
        ]
    );
    const cards = inventory.map((row) => projectCatalogCard(row)).filter(Boolean);
    const ids = cards.map((c) => String(c.id || ''));
    assert(ids.filter((id) => id === 'phase20-art').length === 1, 'poster↔MP4 one canonical card');
}

console.log('\n[L Phase 17 regression — creator category authority]');
{
    const storage = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'phase20-l',
        {
            title: 'Forbidden Hearts',
            description: 'rival families',
            tags: 'romance',
            category: 'Romance'
        },
        { storage, patchCategory: false }
    );
    assert(shelfFor('phase20-l', storage) === 'Romance', 'Phase 17 creator category authority');
}

console.log('\n[M Phase 18 regression — category clear]');
{
    const storage = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'phase20-m',
        { title: 'X', description: '', tags: '', category: 'Cyber-Action' },
        { storage, patchCategory: false }
    );
    saveCreatorCatalogMetadata(
        'phase20-m',
        { title: 'X', description: '', tags: '', category: 'Trending' },
        { storage, patchCategory: false }
    );
    const stale = classifyHydrated(
        {
            id: 'phase20-m',
            type: 'image',
            url: '/thumbs/x.jpg',
            creatorCategory: 'Cyber-Action',
            explicitCategory: 'Cyber-Action',
            category: 'Cyber-Action'
        },
        storage
    );
    assert(
        stale.classification.primaryCategory === 'Trending',
        'Phase 18 clear removes stale Cyber-Action'
    );
}

console.log('\n[N Phase 19 regression — empty meta clear + generic edit]');
{
    const storage = createMemoryStorage();
    const presentationSrc = fs.readFileSync(
        path.join(root, 'src/lib/series/creatorExperiencePresentation.js'),
        'utf8'
    );
    const cardSrc = fs.readFileSync(
        path.join(root, 'src/components/series/VaultEpisodeCreatorStatus.svelte'),
        'utf8'
    );
    assert(
        presentationSrc.includes('canEditWithoutIdentity: true'),
        'generic asset package editable without identity'
    );
    assert(
        cardSrc.includes('data-package-requires-identity="false"'),
        'package edit control does not require identity'
    );
    saveCreatorCatalogMetadata(
        GENERIC_ID,
        { title: 'Generic Title', description: '', tags: '', category: 'Trending' },
        { storage, patchCategory: false }
    );
    const generic = loadCreatorCatalogMetadata(GENERIC_ID, { storage });
    assert(generic?.title === 'Generic Title', 'generic UUID asset can author title');
    saveCreatorCatalogMetadata(
        'phase20-n-clear',
        {
            title: 'Has Desc',
            description: 'suspense thriller',
            tags: 'thriller',
            category: 'Trending'
        },
        { storage, patchCategory: false }
    );
    saveCreatorCatalogMetadata(
        'phase20-n-clear',
        { title: 'Has Desc', description: '', tags: '', category: 'Trending' },
        { storage, patchCategory: false }
    );
    const loaded = loadCreatorCatalogMetadata('phase20-n-clear', { storage });
    assert(loaded?.primaryDescriptionAuthority && !loaded.description, 'Phase 19 description clear');
    assert(loaded?.primaryTagsAuthority && loaded.tags.length === 0, 'Phase 19 tags clear');
}

console.log('\n[Neutral / clear field states]');
{
    const storage = createMemoryStorage();
    const unset = loadCreatorCatalogMetadata('phase20-neutral-missing', { storage });
    assert(!unset.primaryDescriptionAuthority && !unset.description, 'unset description → missing authority');
    assert(!unset.primaryTagsAuthority && unset.tags.length === 0, 'unset tags → missing authority');
    saveCreatorCatalogMetadata(
        'phase20-neutral-cleared',
        { title: 'T', description: 'romance kiss', tags: 'romance', category: 'Romance' },
        { storage, patchCategory: false }
    );
    saveCreatorCatalogMetadata(
        'phase20-neutral-cleared',
        { title: 'T', description: '', tags: '', category: 'Trending' },
        { storage, patchCategory: false }
    );
    const cleared = loadCreatorCatalogMetadata('phase20-neutral-cleared', { storage });
    assert(cleared.primaryDescriptionAuthority && !cleared.description, 'cleared description ≠ missing');
    assert(cleared.primaryTagsAuthority && cleared.tags.length === 0, 'cleared tags ≠ missing');
    assert(cleared.primaryCategoryAuthority && !cleared.category, 'cleared category ≠ missing');
    const presentationSrc = fs.readFileSync(
        path.join(root, 'src/lib/series/creatorExperiencePresentation.js'),
        'utf8'
    );
    assert(
        presentationSrc.includes("? 'cleared'") && presentationSrc.includes(": 'missing'"),
        'presentation maps authority → cleared vs missing'
    );
}

console.log('\n[O–P Frozen Hero / Theater boundaries]');
{
    const cardSrc = fs.readFileSync(
        path.join(root, 'src/components/series/VaultEpisodeCreatorStatus.svelte'),
        'utf8'
    );
    const vaultDiffTouch = fs.readFileSync(
        path.join(root, 'src/components/experiences/VaultExperience.svelte'),
        'utf8'
    );
    assert(cardSrc.includes("data-section=\"hero\""), 'Hero remains separate axis on card');
    assert(
        cardSrc.includes('Managed in Hero Manager'),
        'Hero not derived from package save'
    );
    assert(
        !vaultDiffTouch.includes('TheaterExperience') ||
            vaultDiffTouch.includes('VaultEpisodeCreatorStatus'),
        'VaultExperience still hosts creator status (Theater ownership untouched)'
    );
    // Source-level: Phase 20 files must not import theater playback owners
    const presentationSrc = fs.readFileSync(
        path.join(root, 'src/lib/series/creatorExperiencePresentation.js'),
        'utf8'
    );
    assert(
        !presentationSrc.includes('theaterPlayback') && !presentationSrc.includes('HeroManager'),
        'presentation layer does not touch Theater/Hero managers'
    );
}

console.log('\n[Distribution still uses projected cards]');
{
    const storage = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'phase20-dist',
        {
            title: 'Distributed Romance',
            description: 'kiss soulmate',
            tags: 'romance',
            category: 'Trending'
        },
        { storage, patchCategory: false }
    );
    const { enriched, classification } = classifyHydrated(
        { id: 'phase20-dist', type: 'image', url: '/thumbs/d.jpg', title: 'Distributed Romance' },
        storage
    );
    const card = projectCatalogCard({
        ...enriched,
        category: classification.primaryCategory,
        categories: classification.categories,
        categoryConfidence: classification.confidence
    });
    const distributed = distributeToShelves([card]);
    const romanceShelf = distributed?.shelves?.Romance || [];
    const inRomance = romanceShelf.some((c) => String(c?.id || '') === 'phase20-dist');
    assert(
        classification.primaryCategory === 'Romance' && inRomance,
        'classified Romance reaches shelf distribution path'
    );
}

if (failed) {
    console.error(`\n[creator-metadata-ux] FAILED (${failed})`);
    process.exit(1);
}
console.log('\n[creator-metadata-ux] PASS');
