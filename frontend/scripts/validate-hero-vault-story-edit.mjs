#!/usr/bin/env node
/**
 * Hero Vault Edit Story — focused regression.
 *
 * Proves:
 * 1. Edit Story control + modal wiring exist
 * 2. Existing description loads via creator catalog authority
 * 3. Save persists new description (primary reel_titles_persistent)
 * 4. Hero Vault projection reflects saved description
 * 5. Catalog-bound episode receives description when applicable
 * 6. Clearing description stays cleared
 * 7. Primary description authority blocks series mirror revival
 * 8. Title / hero / package fields remain untouched on description-only save
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import {
    createMemoryStorage,
    loadCreatorCatalogMetadata,
    saveCreatorCatalogMetadata
} from '../src/lib/feed/creatorCatalogMetadata.js';
import { resolveVaultCardProjection } from '../src/lib/content/vaultCardProjection.js';
import { REEL_TITLES_PERSISTENT_KEY } from '../src/lib/hero/heroTitleIntelligence.js';
import { SERIES_METADATA_STORAGE_KEY } from '../src/lib/series/seriesMetadataStorage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const STIRRED_REEL = '61d252dd-2ff8-4308-aabf-fda8abdf91b2';
const STIRRED_EP = 'ep-series-stirred-gate-s1e4';
const STIRRED_SERIES = 'series-stirred-gate';
const OTHER_REEL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';

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

/** Mirror HeroManagerPanel.resolveHeroVaultStoryDraft */
function resolveHeroVaultStoryDraft(assetId, cardDescription = '', storage, getEpisodeByMediaIdentity) {
    const id = String(assetId || '').trim();
    if (!id) return '';
    const meta = loadCreatorCatalogMetadata(id, { storage });
    if (meta.primaryDescriptionAuthority) return String(meta.description || '');
    if (meta.description) return meta.description;
    const bound = getEpisodeByMediaIdentity?.(id);
    const episodeDesc = String(bound?.episode?.description || '').trim();
    if (episodeDesc) return episodeDesc;
    return String(cardDescription || '').trim();
}

/** Mirror HeroManagerPanel.heroVaultStoryPreview */
function heroVaultStoryPreview(assetId, vaultCardDescription = '', storage) {
    const id = String(assetId || '').trim();
    if (!id) return '';
    const meta = loadCreatorCatalogMetadata(id, { storage });
    if (meta.primaryDescriptionAuthority) return String(meta.description || '');
    if (meta.description) return meta.description;
    return String(vaultCardDescription || '').trim();
}

/**
 * Mirror saveHeroVaultStory persistence (description-only).
 * @param {string} assetId
 * @param {string} description
 * @param {{
 *   storage: ReturnType<typeof createMemoryStorage>;
 *   getEpisodeByMediaIdentity?: (id: string) => { episode?: { episodeId?: string; description?: string } } | undefined;
 *   updateCatalogEpisode?: (episodeId: string, patch: Record<string, unknown>) => unknown;
 * }} deps
 */
function saveHeroVaultStorySim(assetId, description, deps) {
    const { storage, getEpisodeByMediaIdentity, updateCatalogEpisode } = deps;
    const prev = loadCreatorCatalogMetadata(assetId, { storage });
    const saved = saveCreatorCatalogMetadata(assetId, { description }, { storage, patchCategory: false });
    if (!saved) return { ok: false };

    const bound = getEpisodeByMediaIdentity?.(assetId);
    if (bound?.episode?.episodeId && updateCatalogEpisode) {
        updateCatalogEpisode(bound.episode.episodeId, { description });
    }
    return { ok: true, prev, bound };
}

console.log('\n[hero-vault-story-edit — wiring]');
const heroSrc = read('src/components/studio/HeroManagerPanel.svelte');
const intelSrc = read('src/lib/hero/heroTitleIntelligence.js');

assert(heroSrc.includes('data-hero-edit-story'), 'Edit Story control marked');
assert(heroSrc.includes('Edit Story'), 'Edit Story label present');
assert(heroSrc.includes('data-hero-story-modal'), 'Story modal shell present');
assert(heroSrc.includes('Story &amp; description'), 'Story modal heading');
assert(heroSrc.includes('saveHeroVaultStory'), 'saveHeroVaultStory handler defined');
assert(heroSrc.includes('resolveHeroVaultStoryDraft'), 'draft resolver defined');
assert(heroSrc.includes('heroVaultStoryPreview'), 'card preview resolver defined');
assert(heroSrc.includes('loadCreatorCatalogMetadata'), 'creator metadata load wired');
assert(heroSrc.includes('saveCreatorCatalogMetadata'), 'creator metadata save wired');
assert(heroSrc.includes('dispatchVaultDescriptionUpdated'), 'description update event dispatched');
assert(heroSrc.includes('vaultStoryRevision'), 'projection revision bump wired');
assert(intelSrc.includes('reelforge:vault-description-updated'), 'vault description event name exported');

console.log('\n[hero-vault-story-edit — persistence + projection]');
const storage = createMemoryStorage({
    [REEL_TITLES_PERSISTENT_KEY]: JSON.stringify({
        [STIRRED_REEL]: {
            title: 'STIRRED E1',
            title_original: 'STIRRED E1',
            description: 'Original stirred story for validators.',
            tags: ['stirred'],
            category: 'Romance',
            savedAt: Date.now()
        },
        [OTHER_REEL]: {
            title: 'Other Vault Pick',
            title_original: 'Other Vault Pick',
            description: 'Other asset baseline description.',
            savedAt: Date.now()
        }
    })
});

const ORIGINAL = 'Original stirred story for validators.';
const UNIQUE = `Hero vault story edit probe ${Date.now()}`;

/** @type {Record<string, { episodeId: string; description: string; title: string; reelId: string }>} */
const episodes = {
    [STIRRED_EP]: {
        episodeId: STIRRED_EP,
        title: 'STIRRED E1',
        description: ORIGINAL,
        reelId: STIRRED_REEL
    }
};

function getEpisodeByMediaIdentity(mediaId) {
    const want = String(mediaId || '').trim();
    for (const episode of Object.values(episodes)) {
        if (episode.reelId === want) {
            return { episode, series: { id: STIRRED_SERIES }, season: { seasonNumber: 1 } };
        }
    }
    return undefined;
}

function updateCatalogEpisode(episodeId, patch) {
    const row = episodes[episodeId];
    if (!row || !('description' in patch)) return null;
    row.description = String(patch.description ?? '');
    return { episode: row };
}

// 2 — load existing description
const draft0 = resolveHeroVaultStoryDraft(STIRRED_REEL, '', storage, getEpisodeByMediaIdentity);
assert(draft0 === ORIGINAL, 'existing description loads from creator catalog metadata');

// 3 — save new description
const save1 = saveHeroVaultStorySim(STIRRED_REEL, UNIQUE, {
    storage,
    getEpisodeByMediaIdentity,
    updateCatalogEpisode
});
assert(save1.ok === true, 'save persists new description');
assert(
    loadCreatorCatalogMetadata(STIRRED_REEL, { storage }).description === UNIQUE,
    'primary authority stores unique description'
);
assert(episodes[STIRRED_EP].description === UNIQUE, 'catalog-bound episode receives description update');

// 4 — Hero Vault projection reflects saved description
const metaAfterSave = loadCreatorCatalogMetadata(STIRRED_REEL, { storage });
const cardAfterSave = resolveVaultCardProjection(STIRRED_REEL, {
    reel: { id: STIRRED_REEL, title: 'STIRRED E1', type: 'video' },
    enrichment:
        metaAfterSave.primaryDescriptionAuthority || metaAfterSave.description
            ? { description: metaAfterSave.description }
            : undefined
});
const previewAfterSave = heroVaultStoryPreview(STIRRED_REEL, cardAfterSave.description, storage);
assert(previewAfterSave === UNIQUE, 'Hero Vault projection shows saved description');

// 6–7 — clear description stays cleared (series mirror must not revive)
saveHeroVaultStorySim(STIRRED_REEL, '', { storage, getEpisodeByMediaIdentity, updateCatalogEpisode });
storage.setItem(
    SERIES_METADATA_STORAGE_KEY,
    JSON.stringify({
        [STIRRED_REEL]: {
            reelId: STIRRED_REEL,
            episodeTitle: 'STIRRED E1',
            description: 'Poison series mirror description must not revive.',
            tags: ['poison']
        }
    })
);
const clearedMeta = loadCreatorCatalogMetadata(STIRRED_REEL, { storage });
assert(clearedMeta.primaryDescriptionAuthority === true, 'cleared save sets primary description authority');
assert(clearedMeta.description === '', 'cleared description remains empty string');
const clearedPreview = heroVaultStoryPreview(
    STIRRED_REEL,
    resolveVaultCardProjection(STIRRED_REEL, {
        reel: { id: STIRRED_REEL, title: 'STIRRED E1' },
        seriesMeta: { description: 'Poison series mirror description must not revive.' },
        enrichment: { description: '' }
    }).description,
    storage
);
assert(clearedPreview === '', 'primary authority prevents series mirror revival on card preview');
assert(episodes[STIRRED_EP].description === '', 'catalog-bound episode description cleared');

// 8 — description-only save does not mutate title/tags/category
const otherBefore = loadCreatorCatalogMetadata(OTHER_REEL, { storage });
saveHeroVaultStorySim(OTHER_REEL, 'Updated other description only.', {
    storage,
    getEpisodeByMediaIdentity: () => undefined,
    updateCatalogEpisode
});
const otherAfter = loadCreatorCatalogMetadata(OTHER_REEL, { storage });
assert(otherAfter.title === otherBefore.title, 'title unchanged on description-only save');
assert(otherAfter.tags.join(',') === otherBefore.tags.join(','), 'tags unchanged on description-only save');
assert(otherAfter.category === otherBefore.category, 'category unchanged on description-only save');
assert(otherAfter.description === 'Updated other description only.', 'other asset description updated independently');

// Restore STIRRED original for practical hygiene
saveHeroVaultStorySim(STIRRED_REEL, ORIGINAL, {
    storage,
    getEpisodeByMediaIdentity,
    updateCatalogEpisode
});
assert(
    loadCreatorCatalogMetadata(STIRRED_REEL, { storage }).description === ORIGINAL,
    'restored original STIRRED description after probe'
);

console.log('\n[hero-vault-story-edit — catalog store integration]');
const server = await createServer({
    root,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error'
});
try {
    const storeMod = await server.ssrLoadModule('/src/lib/series/seriesStore.js');
    /** @type {Record<string, unknown>} */
    const dbEpisodes = {
        [STIRRED_EP]: {
            episodeId: STIRRED_EP,
            episodeNumber: 4,
            title: 'STIRRED E1',
            description: ORIGINAL,
            reelId: STIRRED_REEL,
            mediaAssetId: STIRRED_REEL,
            status: 'published'
        }
    };
    storeMod.applyAuthoritativeApiCatalog([
        {
            id: STIRRED_SERIES,
            slug: 'stirred',
            title: 'STIRRED',
            seasons: [
                {
                    seasonId: 'season-stirred-1',
                    seasonNumber: 1,
                    title: 'Season 1',
                    episodes: [{ ...dbEpisodes[STIRRED_EP] }]
                }
            ]
        }
    ]);
    const ctx = storeMod.getEpisodeByMediaIdentity(STIRRED_REEL);
    assert(ctx?.episode?.episodeId === STIRRED_EP, 'STIRRED E1 resolves by media identity');
    const updated = storeMod.updateCatalogEpisode(STIRRED_EP, { description: UNIQUE });
    assert(updated?.episode?.description === UNIQUE, 'seriesStore updateCatalogEpisode accepts description');
} finally {
    await server.close();
}

if (failed) {
    console.error(`\nFAIL validate-hero-vault-story-edit (${failed} assertion(s))`);
    process.exitCode = 1;
} else {
    console.log('\nPASS validate-hero-vault-story-edit');
}
