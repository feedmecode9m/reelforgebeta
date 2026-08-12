#!/usr/bin/env node
/**
 * Phase 25 — creator metadata readiness: Missing vs Cleared vs Set.
 *
 * Presentation/readiness only. Does not change persistence, classifier,
 * distribution, or series authority.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import {
    createMemoryStorage,
    saveCreatorCatalogMetadata,
    loadCreatorCatalogMetadata
} from '../src/lib/feed/creatorCatalogMetadata.js';
import { REEL_TITLES_PERSISTENT_KEY } from '../src/lib/content/contentIdentityResolver.js';
import { mergeTitleIntoPersistentMap } from '../src/lib/content/persistentTitleMap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const notes = [];

/** @param {boolean} cond @param {string} msg */
function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else notes.push(`ok: ${msg}`);
}

const bag = new Map();
globalThis.localStorage = {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => bag.set(String(k), String(v)),
    removeItem: (k) => bag.delete(k),
    clear: () => bag.clear()
};
globalThis.window = {
    localStorage: globalThis.localStorage,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true
};

/**
 * @param {string} id
 * @param {Record<string, unknown>} [extra]
 */
function asset(id, extra = {}) {
    return {
        id,
        mediaAssetId: id,
        url: `https://cdn.example/${id}.mp4`,
        thumbnailUrl: `https://cdn.example/${id}.jpg`,
        type: 'video',
        fileName: 'IMG_PROBE.MP4',
        playable: true,
        ...extra
    };
}

/**
 * Sync createMemoryStorage into global localStorage for presentation reads.
 * @param {ReturnType<typeof createMemoryStorage>} storage
 */
function syncToGlobal(storage) {
    const raw = storage.getItem(REEL_TITLES_PERSISTENT_KEY);
    if (raw) globalThis.localStorage.setItem(REEL_TITLES_PERSISTENT_KEY, raw);
    else globalThis.localStorage.removeItem(REEL_TITLES_PERSISTENT_KEY);
}

async function main() {
    console.log('\n[creator-metadata-readiness / Phase 25]');

    const presentationSrc = fs.readFileSync(
        path.join(root, 'src/lib/series/creatorExperiencePresentation.js'),
        'utf8'
    );
    const cardSrc = fs.readFileSync(
        path.join(root, 'src/components/series/VaultEpisodeCreatorStatus.svelte'),
        'utf8'
    );

    assert(
        presentationSrc.includes("descriptionFieldState === 'cleared'") &&
            presentationSrc.includes('descriptionAddressed'),
        'presentation readiness treats cleared description as addressed'
    );
    assert(
        presentationSrc.includes('tagsAddressed') &&
            presentationSrc.includes("tagsFieldState === 'cleared'"),
        'presentation readiness treats cleared tags as addressed'
    );
    assert(
        cardSrc.includes("fieldStateLabel(model.presentation.descriptionFieldState") &&
            cardSrc.includes("fieldStateLabel(model.presentation.tagsFieldState"),
        'UI surfaces Cleared vs Not set for description/tags'
    );
    assert(
        !presentationSrc.includes('saveCreatorCatalogMetadata') &&
            !cardSrc.includes('reel_titles_persistent'),
        'readiness fix does not rewrite persistence writers in UI/presentation'
    );

    const server = await createServer({
        root,
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error'
    });

    try {
        const { presentVaultEpisodeCompleteness } = await server.ssrLoadModule(
            '/src/lib/series/creatorExperiencePresentation.js'
        );

        // A. Missing description
        {
            bag.clear();
            const id = 'p25-a-missing-desc';
            const model = presentVaultEpisodeCompleteness(
                asset(id, { episodeEnrichment: { title: 'T', artworkUrl: '/thumbs/t.jpg' } })
            );
            assert(
                model.presentation.descriptionFieldState === 'missing',
                'A: descriptionFieldState missing'
            );
            assert(
                model.presentation.missing.includes('Description'),
                'A: readiness reports Missing Description'
            );
            assert(model.presentation.ready === false, 'A: package incomplete');
        }

        // B. Populated description
        {
            bag.clear();
            const storage = createMemoryStorage();
            const id = 'p25-b-set-desc';
            saveCreatorCatalogMetadata(
                id,
                {
                    title: 'T',
                    description: 'A forbidden romance blooms',
                    tags: '',
                    category: 'Trending'
                },
                { storage, patchCategory: false }
            );
            syncToGlobal(storage);
            const model = presentVaultEpisodeCompleteness(
                asset(id, {
                    episodeEnrichment: {
                        title: 'T',
                        description: 'A forbidden romance blooms',
                        artworkUrl: '/thumbs/t.jpg'
                    }
                })
            );
            assert(model.presentation.descriptionFieldState === 'set', 'B: descriptionFieldState set');
            assert(
                !model.presentation.missing.includes('Description'),
                'B: Description not in missing'
            );
            assert(model.presentation.ready === true, 'B: package ready when description set');
        }

        // C. Cleared description
        {
            bag.clear();
            const storage = createMemoryStorage();
            const id = 'p25-c-cleared-desc';
            saveCreatorCatalogMetadata(
                id,
                {
                    title: 'T',
                    description: 'romance',
                    tags: 'romance',
                    category: 'Romance'
                },
                { storage, patchCategory: false }
            );
            saveCreatorCatalogMetadata(
                id,
                { title: 'T', description: '', tags: 'romance', category: 'Romance' },
                { storage, patchCategory: false }
            );
            syncToGlobal(storage);
            const meta = loadCreatorCatalogMetadata(id, { storage });
            assert(
                meta.primaryDescriptionAuthority && meta.description === '',
                'C: primary authored-empty description'
            );
            const model = presentVaultEpisodeCompleteness(
                asset(id, { episodeEnrichment: { title: 'T', artworkUrl: '/thumbs/t.jpg' } })
            );
            assert(
                model.presentation.descriptionFieldState === 'cleared',
                'C: descriptionFieldState cleared'
            );
            assert(
                !model.presentation.missing.includes('Description'),
                'C: Cleared description NOT reported as Missing'
            );
            assert(
                !String(model.presentation.missing.join(',')).includes('Description'),
                'C: Missing banner would not list Description'
            );
            assert(model.presentation.ready === true, 'C: package ready with cleared description');
            assert(
                model.presentation.marks.description === true,
                'C: description addressed (cleared) without calling it Set in field-state'
            );
        }

        // D. Missing tags
        {
            bag.clear();
            const id = 'p25-d-missing-tags';
            const model = presentVaultEpisodeCompleteness(
                asset(id, {
                    episodeEnrichment: {
                        title: 'T',
                        description: 'has desc',
                        artworkUrl: '/thumbs/t.jpg'
                    }
                })
            );
            assert(model.presentation.tagsFieldState === 'missing', 'D: tagsFieldState missing');
            assert(
                !model.presentation.missing.includes('Tags'),
                'D: tags remain optional for package Missing list'
            );
            assert(model.presentation.marks.tags === false, 'D: tags mark not addressed when missing');
        }

        // E. Populated tags
        {
            bag.clear();
            const storage = createMemoryStorage();
            const id = 'p25-e-set-tags';
            saveCreatorCatalogMetadata(
                id,
                { title: 'T', description: 'x', tags: 'romance, love', category: 'Trending' },
                { storage, patchCategory: false }
            );
            syncToGlobal(storage);
            const model = presentVaultEpisodeCompleteness(
                asset(id, {
                    episodeEnrichment: {
                        title: 'T',
                        description: 'x',
                        artworkUrl: '/thumbs/t.jpg'
                    }
                })
            );
            assert(model.presentation.tagsFieldState === 'set', 'E: tagsFieldState set');
            assert(model.presentation.marks.tags === true, 'E: tags mark addressed when set');
            assert(!model.presentation.missing.includes('Tags'), 'E: Tags not in Missing');
        }

        // F. Cleared tags
        {
            bag.clear();
            const storage = createMemoryStorage();
            const id = 'p25-f-cleared-tags';
            saveCreatorCatalogMetadata(
                id,
                { title: 'T', description: 'x', tags: 'romance', category: 'Trending' },
                { storage, patchCategory: false }
            );
            saveCreatorCatalogMetadata(
                id,
                { title: 'T', description: 'x', tags: '', category: 'Trending' },
                { storage, patchCategory: false }
            );
            syncToGlobal(storage);
            const meta = loadCreatorCatalogMetadata(id, { storage });
            assert(meta.primaryTagsAuthority && meta.tags.length === 0, 'F: primary tags []');
            const model = presentVaultEpisodeCompleteness(
                asset(id, {
                    episodeEnrichment: {
                        title: 'T',
                        description: 'x',
                        artworkUrl: '/thumbs/t.jpg'
                    }
                })
            );
            assert(model.presentation.tagsFieldState === 'cleared', 'F: tagsFieldState cleared');
            assert(!model.presentation.missing.includes('Tags'), 'F: Cleared tags NOT Missing');
            assert(model.presentation.marks.tags === true, 'F: cleared tags addressed');
        }

        // G. Category Phase 18/19 semantics unchanged
        {
            bag.clear();
            const storage = createMemoryStorage();
            const id = 'p25-g-category';
            saveCreatorCatalogMetadata(
                id,
                {
                    title: 'T',
                    description: 'forbidden romance',
                    tags: 'romance',
                    category: 'Romance'
                },
                { storage, patchCategory: false }
            );
            syncToGlobal(storage);
            let model = presentVaultEpisodeCompleteness(
                asset(id, {
                    episodeEnrichment: {
                        title: 'T',
                        description: 'forbidden romance',
                        artworkUrl: '/thumbs/t.jpg'
                    }
                })
            );
            assert(model.presentation.categoryFieldState === 'set', 'G: category set');
            assert(model.presentation.category === 'Romance', 'G: category value Romance');
            saveCreatorCatalogMetadata(
                id,
                {
                    title: 'T',
                    description: 'forbidden romance',
                    tags: 'romance',
                    category: ''
                },
                { storage, patchCategory: false }
            );
            syncToGlobal(storage);
            model = presentVaultEpisodeCompleteness(
                asset(id, {
                    episodeEnrichment: {
                        title: 'T',
                        description: 'forbidden romance',
                        artworkUrl: '/thumbs/t.jpg'
                    }
                })
            );
            assert(model.presentation.categoryFieldState === 'cleared', 'G: category cleared');
            assert(!model.presentation.category, 'G: category value empty after clear');
            assert(
                model.presentation.shelfPreview.primaryCategory === 'Romance',
                'G: shelf still from remaining Romance evidence after category clear'
            );
        }

        // H. Save → clear → readiness Cleared
        {
            bag.clear();
            const storage = createMemoryStorage();
            const id = 'p25-h-save-clear';
            saveCreatorCatalogMetadata(
                id,
                {
                    title: 'Keep',
                    description: 'romance',
                    tags: 'romance',
                    category: 'Romance',
                    artworkUrl: undefined
                },
                { storage, patchCategory: false }
            );
            saveCreatorCatalogMetadata(
                id,
                { title: 'Keep', description: '', tags: '', category: '' },
                { storage, patchCategory: false }
            );
            syncToGlobal(storage);
            const model = presentVaultEpisodeCompleteness(
                asset(id, { episodeEnrichment: { title: 'Keep', artworkUrl: '/thumbs/k.jpg' } })
            );
            assert(model.presentation.descriptionFieldState === 'cleared', 'H: description Cleared');
            assert(model.presentation.tagsFieldState === 'cleared', 'H: tags Cleared');
            assert(model.presentation.categoryFieldState === 'cleared', 'H: category Cleared');
            assert(!model.presentation.missing.includes('Description'), 'H: no Missing Description');
            assert(!model.presentation.missing.includes('Tags'), 'H: no Missing Tags');
        }

        // I. Clear → reload → Cleared
        {
            bag.clear();
            const storage = createMemoryStorage();
            const id = 'p25-i-reload';
            saveCreatorCatalogMetadata(
                id,
                { title: 'R', description: 'romance', tags: 'love', category: 'Romance' },
                { storage, patchCategory: false }
            );
            saveCreatorCatalogMetadata(
                id,
                { title: 'R', description: '', tags: '', category: '' },
                { storage, patchCategory: false }
            );
            const serialized = storage.getItem(REEL_TITLES_PERSISTENT_KEY) || '{}';
            bag.clear();
            globalThis.localStorage.setItem(REEL_TITLES_PERSISTENT_KEY, serialized);
            const model = presentVaultEpisodeCompleteness(
                asset(id, { episodeEnrichment: { title: 'R', artworkUrl: '/thumbs/r.jpg' } })
            );
            assert(model.presentation.descriptionFieldState === 'cleared', 'I: reload Cleared desc');
            assert(model.presentation.tagsFieldState === 'cleared', 'I: reload Cleared tags');
            assert(!model.presentation.missing.includes('Description'), 'I: reload not Missing');
        }

        // J. Title-only after clear — Cleared remains; Phase 22 merge
        {
            bag.clear();
            const storage = createMemoryStorage();
            const id = 'p25-j-title-only';
            saveCreatorCatalogMetadata(
                id,
                { title: 'Orig', description: 'romance', tags: 'romance', category: 'Romance' },
                { storage, patchCategory: false }
            );
            saveCreatorCatalogMetadata(
                id,
                { title: 'Orig', description: '', tags: '', category: '' },
                { storage, patchCategory: false }
            );
            const map = JSON.parse(storage.getItem(REEL_TITLES_PERSISTENT_KEY) || '{}');
            const next = mergeTitleIntoPersistentMap(map, id, {
                title: 'Edited',
                title_original: 'Edited',
                savedAt: Date.now()
            });
            storage.setItem(REEL_TITLES_PERSISTENT_KEY, JSON.stringify(next));
            syncToGlobal(storage);
            const meta = loadCreatorCatalogMetadata(id, { storage });
            assert(meta.title === 'Edited', 'J: title updated');
            assert(meta.primaryDescriptionAuthority && meta.description === '', 'J: clear preserved');
            assert(Array.isArray(meta.tags) && meta.tags.length === 0, 'J: tags clear preserved');
            const model = presentVaultEpisodeCompleteness(
                asset(id, { episodeEnrichment: { title: 'Edited', artworkUrl: '/thumbs/e.jpg' } })
            );
            assert(model.presentation.descriptionFieldState === 'cleared', 'J: readiness still Cleared');
            assert(!model.presentation.missing.includes('Description'), 'J: not Missing after title-only');
            assert(
                model.presentation.shelfPreview.primaryCategory === 'Trending',
                'J: shelf stays Trending after clear+title-only'
            );
        }

        // K. Generic UUID/camera asset — same readiness; no identity requirement
        {
            bag.clear();
            const storage = createMemoryStorage();
            const id = 'e1f08f0f-954f-4c39-848b-9f3fc72b5d02';
            saveCreatorCatalogMetadata(
                id,
                { title: 'Generic', description: '', tags: '', category: '' },
                { storage, patchCategory: false }
            );
            syncToGlobal(storage);
            const model = presentVaultEpisodeCompleteness(
                asset(id, {
                    fileName: `${id}.png`,
                    name: `${id}.png`,
                    episodeEnrichment: { title: 'Generic', artworkUrl: `/thumbs/${id}.png` }
                })
            );
            assert(model.presentation.canEditWithoutIdentity === true, 'K: no identity requirement');
            assert(
                model.presentation.descriptionFieldState === 'cleared',
                'K: generic cleared description state'
            );
            assert(!model.presentation.missing.includes('Description'), 'K: generic not Missing');
            assert(model.identity.ready === false || model.presentation.canEditWithoutIdentity, 'K: edit without identity');
        }

        // Frozen presentation contracts
        assert(
            presentationSrc.includes('loadCreatorCatalogMetadata') &&
                !presentationSrc.includes('classifyContent('),
            'presentation still uses preview path only (no classifier rewrite)'
        );
    } finally {
        await server.close();
    }

    for (const n of notes) console.log(`  ✓ ${n.replace(/^ok: /, '')}`);
    if (failures.length) {
        for (const f of failures) console.error(`  ✗ ${f}`);
        console.error('\nFAIL — creator-metadata-readiness');
        process.exit(1);
    }
    console.log('\nPASS — creator-metadata-readiness');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
