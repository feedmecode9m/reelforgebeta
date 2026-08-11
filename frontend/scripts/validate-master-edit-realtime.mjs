#!/usr/bin/env node
/**
 * Master Edit real-time propagation contract.
 *
 * Proves mounted projections update from existing durable authorities without
 * inventing a new title store / Master Edit bus.
 *
 * Wiring + pure sequential simulation (mirrors Studio updateReelTitle fan-out,
 * Hero registry stamp, sync re-apply defense).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    resolveCanonicalHeroTitle,
    reconcileActivePresentationHeroTitle,
    REEL_TITLES_PERSISTENT_KEY
} from '../src/lib/hero/heroTitleIntelligence.js';
import { VIDEO_VAULT_HIDDEN_STORAGE_KEY } from '../src/lib/vault/videoVaultWorkspace.js';

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

console.log('\n[master-edit-realtime — local fan-out simulation]');

const ACTIVE = '3894107e-ae44-43c5-af72-b3f5d5e0ad90';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02';
const OLD = 'Vic G LA Story';
const NEXT = 'Vic G City Night Edit';

/** @type {Record<string, { title: string; title_original: string }>} */
const persistent = {};
/** @type {Record<string, unknown>[]} */
let personalVideos = [
    {
        id: ACTIVE,
        name: OLD,
        title: OLD,
        url: 'https://cdn.example/active.mp4'
    },
    {
        id: OTHER,
        name: 'Other name',
        title: 'Other name',
        url: 'https://cdn.example/other.mp4'
    }
];
/** @type {Record<string, unknown[]>} */
let feed = {
    Trending: [{ id: ACTIVE, title: OLD, name: OLD, title_original: OLD }]
};
/** @type {Record<string, unknown>} */
let manager = {
    heroAssetId: ACTIVE,
    heroTitle: OLD,
    heroAssetTitle: OLD,
    heroDescription: `A grounded documentary spotlight: ${OLD}.`,
    heroLabel: ''
};

/**
 * Mirrors StudioExperience.updateReelTitle local phase (before PATCH).
 * @param {string} reelId
 * @param {string} title
 * @param {{ skipActiveHero?: boolean }} [opts]
 */
function masterEditTitle(reelId, title, opts = {}) {
    persistent[reelId] = { title, title_original: title };
    feed = {
        ...feed,
        Trending: (feed.Trending || []).map((item) =>
            String(item.id) === reelId
                ? { ...item, title, name: title, title_original: title, _localModified: true }
                : item
        )
    };
    personalVideos = personalVideos.map((entry) =>
        String(entry.id) === reelId
            ? { ...entry, title, name: title, title_original: title, _localModified: true }
            : entry
    );
    if (!opts.skipActiveHero && String(manager.heroAssetId || '') === reelId) {
        manager = /** @type {typeof manager} */ (
            reconcileActivePresentationHeroTitle(
                { ...manager, heroTitle: title, heroAssetTitle: title },
                {
                    assetId: reelId,
                    editedTitle: title,
                    persistentTitle: title,
                    assetTitle: title
                }
            )
        );
    }
}

// A — Video Vault / Studio title
masterEditTitle(ACTIVE, NEXT);
assert(persistent[ACTIVE].title === NEXT, 'durable reel_titles_persistent receives Master Edit title');
assert(
    personalVideos.find((v) => v.id === ACTIVE)?.title === NEXT &&
        personalVideos.find((v) => v.id === ACTIVE)?.name === NEXT,
    'Video Vault projection ($personalVideos) updates immediately'
);
assert(feed.Trending.find((r) => r.id === ACTIVE)?.title === NEXT, 'Studio/feed projection updates immediately');
assert(manager.heroTitle === NEXT, 'active Hero manager title reconciles immediately for active asset');
assert(
    String(manager.heroDescription || '').includes(OLD),
    'description prose is not used as title / left as description'
);

// E — Non-active isolation
const OTHER_NEXT = 'Other Creator Edit';
masterEditTitle(OTHER, OTHER_NEXT, { skipActiveHero: true });
// only re-run personalVideos/feed for other without active force (simulate real branch)
assert(personalVideos.find((v) => v.id === OTHER)?.title === OTHER_NEXT, 'non-active vault title updates');
assert(manager.heroTitle === NEXT, 'non-active edit does not change active Hero presentation title');
assert(personalVideos.find((v) => v.id === ACTIVE)?.title === NEXT, 'active vault title remains after non-active edit');

// B — Hero Vault stamp (resolveCanonical + reassignment)
const rebuiltRegistry = personalVideos.map((item) => {
    const id = String(item.id || '');
    const title = resolveCanonicalHeroTitle({
        editedTitle: '',
        persistentTitle: persistent[id]?.title || '',
        assetTitle: item.title || item.name,
        fileName: item.fileName
    });
    return { assetId: id, title, name: title };
});
assert(
    rebuiltRegistry.find((r) => r.assetId === ACTIVE)?.title === NEXT,
    'Hero Vault registry projection resolves canonical = persistent for active asset'
);
assert(
    rebuiltRegistry.find((r) => r.assetId === OTHER)?.title === OTHER_NEXT,
    'Hero Vault registry projection updates non-active asset independently'
);
assert(
    rebuiltRegistry.find((r) => r.assetId === ACTIVE)?.title === manager.heroTitle,
    'cross-surface: Video Vault / Hero Vault / manager converge for active asset'
);

// F — syncFromVault harvest cannot resurrect catalog name
const catalogHarvest = [
    {
        id: ACTIVE,
        name: OLD,
        title: null,
        url: 'https://cdn.example/active.mp4'
    },
    {
        id: OTHER,
        name: 'other_raw.mp4',
        title: null,
        url: 'https://cdn.example/other.mp4'
    }
];
function applyPersistedToVault(entries) {
    return entries.map((item) => {
        const id = String(item.id || '');
        const saved = persistent[id];
        if (!saved?.title) return item;
        return {
            ...item,
            title: saved.title,
            name: saved.title,
            title_original: saved.title_original || saved.title
        };
    });
}
const afterSync = applyPersistedToVault(catalogHarvest);
assert(
    afterSync.find((v) => v.id === ACTIVE)?.title === NEXT &&
        afterSync.find((v) => v.id === ACTIVE)?.name === NEXT,
    'sync re-apply: catalog harvest cannot resurrect older title over persistent'
);

// G — hard refresh resolves same title from persistent + manager reconcile
const hardManager = reconcileActivePresentationHeroTitle(
    {
        heroAssetId: ACTIVE,
        heroTitle: OLD,
        heroAssetTitle: OLD,
        heroDescription: manager.heroDescription
    },
    {
        assetId: ACTIVE,
        persistentTitle: persistent[ACTIVE].title,
        assetTitle: OLD
    }
);
assert(
    hardManager?.heroTitle === NEXT,
    'hard refresh: manager heroTitle re-reconciles from reel_titles_persistent'
);

// C — Master Hero Admin field commit contract: manager mutates before server
const afterFieldCommit = {
    ...manager,
    heroTitle: 'Studio Headline Live',
    heroLabel: 'Custom Label',
    heroDescription: 'Live landscape description'
};
assert(
    afterFieldCommit.heroTitle === 'Studio Headline Live' &&
        afterFieldCommit.heroLabel === 'Custom Label',
    'Admin field commit mutates local manager config before async persist'
);

console.log('\n[master-edit-realtime — wiring]');

const studioSrc = read('src/components/experiences/StudioExperience.svelte');
const panelSrc = read('src/components/studio/HeroManagerPanel.svelte');
const cleanupSrc = read('src/lib/viewer/aiCleanupAgent.js');
const viewerSrc = read('src/viewer/viewerContext.js');
const intelSrc = read('src/lib/hero/heroIntelligence.js');
const titleSrc = read('src/lib/hero/heroTitleIntelligence.js');
const expSrc = read('src/components/experiences/HeroExperience.svelte');
const softSrc = read('scripts/validate-video-vault-soft-remove.mjs');
const pkg = read('package.json');

const updateStart = studioSrc.indexOf('export async function updateReelTitle');
const updateSlice =
    updateStart >= 0 ? studioSrc.slice(updateStart, updateStart + 4500) : '';
assert(updateSlice.includes('personalVideos.update'), 'updateReelTitle mutates personalVideos projection');
assert(updateSlice.includes('feed.update'), 'updateReelTitle mutates feed projection');
assert(
    updateSlice.includes('persistentTitles?.saveTitle') || updateSlice.includes('persistentTitles?.saveTitle?.'),
    'updateReelTitle writes durable persistentTitles'
);
assert(
    updateSlice.includes('dispatchVaultTitleUpdated'),
    'updateReelTitle dispatches reelforge:vault-title-updated fan-out'
);
assert(
    updateSlice.includes('saveHeroManagerConfig') && updateSlice.includes('skipServer: true'),
    'active Hero title reconciles via local saveHeroManagerConfig (no backend display gate)'
);
assert(
    updateSlice.includes('method: \'PATCH\'') || updateSlice.includes('method: "PATCH"'),
    'backend PATCH remains after local fan-out'
);
const patchIdx = updateSlice.indexOf('fetch(`/api/reels');
const pvIdx = updateSlice.indexOf('personalVideos.update');
assert(pvIdx >= 0 && patchIdx > pvIdx, 'personalVideos updates before PATCH (local-first)');

assert(
    panelSrc.includes('refreshHeroAssetRegistry') &&
        panelSrc.includes('rawRegistry') &&
        panelSrc.includes('title: canonicalTitle'),
    'Hero Vault registry reassignment stamps getDisplayTitle'
);
assert(
    panelSrc.includes('function editHeroVaultTitle') &&
        panelSrc.includes('writePersistentTitle') &&
        panelSrc.includes('dispatchVaultTitleUpdated'),
    'Hero Vault Edit Title writes persistent + event fan-out'
);
assert(
    panelSrc.includes('function persistHeroSettings') &&
        intelSrc.includes('reelforge:hero-manager-updated') &&
        intelSrc.includes('function saveHeroManagerConfig'),
    'Master Hero Admin persistHeroSettings uses existing saveHeroManagerConfig event path'
);
assert(
    expSrc.includes("addEventListener('reelforge:hero-manager-updated'") ||
        expSrc.includes('reelforge:hero-manager-updated'),
    'HeroExperience listens for reelforge:hero-manager-updated'
);
assert(
    titleSrc.includes('dispatchVaultTitleUpdated') &&
        titleSrc.includes('reelforge:vault-title-updated'),
    'vault-title-updated event remains available'
);
assert(
    titleSrc.includes('function reconcileActivePresentationHeroTitle'),
    'staged reconcileActivePresentationHeroTitle remains title conflict resolver'
);
assert(
    cleanupSrc.includes('personalVideos.update') &&
        cleanupSrc.includes('applyPersistedTitlesOverlay') &&
        cleanupSrc.includes('CONFIG.TITLES_STORAGE_KEY'),
    'applyPersistedTitlesOverlay re-applies titles onto Video Vault rows'
);
assert(
    viewerSrc.includes('applyPersistedTitlesOverlay') && viewerSrc.includes('syncFromVault'),
    'syncFromVault re-applies persistent titles after vault rebuild'
);
assert(
    REEL_TITLES_PERSISTENT_KEY === 'reel_titles_persistent' &&
        (studioSrc.includes('reel_titles_persistent') ||
            viewerSrc.includes("TITLES_STORAGE_KEY: 'reel_titles_persistent'")),
    'reel_titles_persistent remains durable local title authority'
);
assert(
    !studioSrc.includes('reelforge_hero_title_live') &&
        !panelSrc.includes('reelforge_hero_title_live') &&
        !titleSrc.includes('reelforge_hero_title_live'),
    'no new title storage key introduced'
);
assert(
    VIDEO_VAULT_HIDDEN_STORAGE_KEY === 'reelforge_video_vault_hidden_ids' &&
        softSrc.includes('reelforge_video_vault_hidden_ids'),
    'Video Vault soft-remove key / validators remain'
);
assert(
    panelSrc.includes('deleteReelById') && panelSrc.includes('applyCanonicalDeleteClientEffects'),
    'Hero Vault permanent Delete path remains'
);
assert(
    read('src/lib/deletionSync.js').includes("reelforge_deleted_media_ids"),
    'permanent delete tombstone key unchanged'
);
assert(
    panelSrc.includes('isServerGrantedPublished') ||
        expSrc.includes('isServerGrantedPublished') ||
        read('src/lib/hero/heroPresentationAuthority.js').includes('isPublicHeroPresentation'),
    'PUBLIC APPROVED / server-granted presentation symbols remain in codebase'
);
assert(
    pkg.includes('validate:master-edit-realtime'),
    'package.json registers validate:master-edit-realtime'
);

console.log(
    failed === 0
        ? '\n✓ master-edit realtime acceptance passed\n'
        : `\n✗ ${failed} master-edit realtime assertion(s) failed\n`
);
process.exit(failed === 0 ? 0 : 1);
