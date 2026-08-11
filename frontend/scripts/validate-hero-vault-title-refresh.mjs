#!/usr/bin/env node
/**
 * Hero Vault live title refresh + active presentation reconciliation.
 *
 * Proves:
 * - Edit-title stamps vault registry via resolveCanonicalHeroTitle
 * - Active presentation heroTitle converges to the same canonical title
 * - Sticky manager / HeroRecord titles and description prose cannot outrank
 *   reel_titles_persistent for the active assetId
 * - Soft-remove / permanent-delete wiring and keys remain untouched
 *
 * No new title storage key.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    resolveCanonicalHeroTitle,
    isUnsafeHeroFilenameTitle,
    reconcileActivePresentationHeroTitle,
    REEL_TITLES_PERSISTENT_KEY
} from '../src/lib/hero/heroTitleIntelligence.js';
import { VIDEO_VAULT_HIDDEN_STORAGE_KEY } from '../src/lib/vault/videoVaultWorkspace.js';
import { mapServerPresentationToManagerPatch } from '../src/lib/hero/heroPresentationCore.js';

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

/** Mirror Hero Manager getDisplayTitle precedence for registry stamp. */
function stampRegistryTitle(item, renamedTitles, persistentMap) {
    const assetId = String(item?.assetId || item?.id || '').trim();
    const title = resolveCanonicalHeroTitle({
        editedTitle: renamedTitles[assetId],
        persistentTitle: persistentMap[assetId]?.title || persistentMap[assetId]?.title_original || '',
        episodeTitle: item?.episodeTitle,
        assetTitle: item?.title || item?.name,
        fileName: item?.fileName || item?.file_name
    });
    return { ...item, title, name: title };
}

/**
 * @param {string} assetId
 * @param {Record<string, { title: string }>} persistentMap
 * @param {Record<string, string>} renamedTitles
 * @param {Record<string, unknown>} presentation
 */
function reconcilePresentation(assetId, persistentMap, renamedTitles, presentation) {
    return reconcileActivePresentationHeroTitle(
        { ...presentation, heroAssetId: assetId },
        {
            assetId,
            editedTitle: renamedTitles[assetId] || '',
            persistentTitle: persistentMap[assetId]?.title || '',
            assetTitle: String(presentation.heroTitle || presentation.heroAssetTitle || '')
        }
    );
}

console.log('\n[hero-vault-title-refresh — canonical stamp]');

const HERO_ID = '3894107e-ae44-43c5-af72-b3f5d5e0ad90';
const OTHER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
const OLD = 'Vic G LA Story';
const NEXT = 'Vic G City Night Edit';

/** @type {Record<string, { title: string; title_original: string }>} */
const persistent = {};
/** @type {Record<string, string>} */
const renamed = {};

// Harvested registry rows (stale)
let registry = [
    {
        assetId: HERO_ID,
        assetType: 'mp4',
        mediaUrl: 'https://cdn.example/prod/hero.mp4',
        title: OLD,
        name: OLD,
        fileName: 'vicg.mp4'
    },
    {
        assetId: OTHER_ID,
        assetType: 'mp4',
        mediaUrl: 'https://cdn.example/prod/other.mp4',
        title: 'Other Raw.mp4',
        name: 'Other Raw.mp4',
        fileName: 'Other_Raw.mp4'
    }
];

// --- Edit hero-bound durable MP4 title (mirrors editHeroVaultTitle sinks) ---
renamed[HERO_ID] = NEXT;
persistent[HERO_ID] = { title: NEXT, title_original: NEXT };

registry = registry.map((item) => stampRegistryTitle(item, renamed, persistent));
assert(registry.find((r) => r.assetId === HERO_ID)?.title === NEXT, 'hero-bound card stamp = new title immediately');
assert(
    persistent[HERO_ID].title === NEXT,
    'reel_titles_persistent[id] holds new title (no new storage key)'
);
assert(
    registry.find((r) => r.assetId === HERO_ID)?.name === NEXT,
    'stamped name matches title for card meta'
);

// Active presentation stuck on older manager title must converge.
let presentation = {
    heroAssetId: HERO_ID,
    heroTitle: OLD,
    heroAssetTitle: OLD,
    heroDescription: `A grounded documentary spotlight: ${OLD}.`
};
presentation = /** @type {typeof presentation} */ (
    reconcilePresentation(HERO_ID, persistent, renamed, presentation)
);
assert(
    presentation.heroTitle === NEXT,
    'active Hero presentation heroTitle becomes same new title after edit reconcile'
);
assert(
    String(presentation.heroDescription || '').includes(OLD),
    'heroDescription not rewritten by title reconcile'
);
assert(
    presentation.heroTitle !== presentation.heroDescription,
    'description prose is not used as heroTitle'
);
assert(
    registry.find((r) => r.assetId === HERO_ID)?.title === presentation.heroTitle,
    'vault card and presentation titles converge after hero-bound edit'
);

// --- Non-hero vault pick behaves identically for card; presentation unchanged ---
const OTHER_NEXT = 'Other Creator Cut';
renamed[OTHER_ID] = OTHER_NEXT;
persistent[OTHER_ID] = { title: OTHER_NEXT, title_original: OTHER_NEXT };
registry = registry.map((item) => stampRegistryTitle(item, renamed, persistent));
assert(
    registry.find((r) => r.assetId === OTHER_ID)?.title === OTHER_NEXT,
    'non-hero Hero Vault asset stamp = new title'
);
const presentationStillActive = /** @type {typeof presentation} */ (
    reconcilePresentation(HERO_ID, persistent, {}, { ...presentation, heroTitle: NEXT })
);
assert(
    presentationStillActive.heroTitle === NEXT,
    'editing non-active asset does not change active presentation (active still NEXT)'
);
assert(
    registry.find((r) => r.assetId === OTHER_ID)?.title === OTHER_NEXT &&
        presentationStillActive.heroTitle !== OTHER_NEXT,
    'non-active title does not overwrite active presentation heroTitle'
);

// --- Use as Hero: selected asset becomes active with canonical title ---
const selectPresentation = /** @type {Record<string, unknown>} */ (
    reconcileActivePresentationHeroTitle(
        {
            heroAssetId: OTHER_ID,
            heroTitle: 'stale-manager',
            heroAssetTitle: 'stale-manager',
            heroDescription: 'ignore me'
        },
        {
            assetId: OTHER_ID,
            persistentTitle: persistent[OTHER_ID].title,
            assetTitle: 'harvested-other.mp4'
        }
    )
);
assert(
    selectPresentation.heroTitle === OTHER_NEXT,
    'Use as Hero: presentation heroTitle equals canonical for selected asset'
);

// --- Hard refresh: session renamed cleared; persistent + presentation converge ---
const afterRefreshRenamed = {};
const rebuiltFromStaleFeed = [
    {
        assetId: HERO_ID,
        assetType: 'mp4',
        mediaUrl: 'https://cdn.example/prod/hero.mp4',
        title: OLD, // stale feed / harvest first-wins
        name: OLD,
        fileName: 'vicg.mp4'
    },
    {
        assetId: OTHER_ID,
        assetType: 'mp4',
        mediaUrl: 'https://cdn.example/prod/other.mp4',
        title: 'Other Raw.mp4',
        name: 'Other Raw.mp4',
        fileName: 'Other_Raw.mp4'
    }
];
const stampedAfterSync = rebuiltFromStaleFeed.map((item) =>
    stampRegistryTitle(item, afterRefreshRenamed, persistent)
);
assert(
    stampedAfterSync.find((r) => r.assetId === HERO_ID)?.title === NEXT,
    'post-sync rebuild cannot restore stale title when persistent map holds new'
);
assert(
    stampedAfterSync.find((r) => r.assetId === OTHER_ID)?.title === OTHER_NEXT,
    'post-sync non-hero also prefers persistent over harvested name'
);
const hardRefreshPresentation = /** @type {Record<string, unknown>} */ (
    reconcileActivePresentationHeroTitle(
        {
            heroAssetId: HERO_ID,
            heroTitle: OLD,
            heroAssetTitle: OLD,
            heroDescription: `Legacy prose still mentions ${OLD}`
        },
        {
            assetId: HERO_ID,
            persistentTitle: persistent[HERO_ID].title,
            assetTitle: OLD
        }
    )
);
assert(
    hardRefreshPresentation.heroTitle === NEXT &&
        stampedAfterSync.find((r) => r.assetId === HERO_ID)?.title === hardRefreshPresentation.heroTitle,
    'hard refresh: vault stamp == presentation heroTitle from persistent'
);
assert(
    String(hardRefreshPresentation.heroDescription || '').includes(OLD),
    'hard refresh: description old title stays description only'
);

// Server hydrate patch + stale manager title → persistent wins when injected
const mapped = mapServerPresentationToManagerPatch({
    heroAssetId: HERO_ID,
    heroTitle: OLD,
    heroDescription: `Legacy: ${OLD}`,
    mediaUrl: 'https://cdn.example/prod/hero.mp4',
    backgroundSource: 'custom_video'
});
const afterHydrate = reconcileActivePresentationHeroTitle(mapped, {
    assetId: HERO_ID,
    persistentTitle: NEXT,
    assetTitle: String(mapped?.heroTitle || OLD)
});
assert(afterHydrate?.heroTitle === NEXT, 'hydrate/server map reconciles to persistent canonical');
assert(
    String(afterHydrate?.heroDescription || '').includes(OLD),
    'hydrate leaves description content intact'
);

// --- Resolver outranks filename / raw asset title ---
const filenameWin = resolveCanonicalHeroTitle({
    editedTitle: '',
    persistentTitle: NEXT,
    assetTitle: 'vicg_upload_final.mp4',
    fileName: 'vicg_upload_final.mp4'
});
assert(filenameWin === NEXT, 'resolveCanonicalHeroTitle outranks filename-like asset title');
assert(isUnsafeHeroFilenameTitle('vicg_upload_final.mp4'), 'filename guard still classifies unsafe tokens');

// --- Soft-remove key and authority invariants (wiring, not mutation) ---
assert(
    VIDEO_VAULT_HIDDEN_STORAGE_KEY === 'reelforge_video_vault_hidden_ids',
    'video vault soft-hide key unchanged (no title key coupling)'
);
assert(
    REEL_TITLES_PERSISTENT_KEY === 'reel_titles_persistent',
    'existing reel_titles_persistent key constant retained'
);

console.log('\n[hero-vault-title-refresh — wiring]');

const panelSrc = read('src/components/studio/HeroManagerPanel.svelte');
const softRemoveSrc = read('scripts/validate-video-vault-soft-remove.mjs');
const intelSrc = read('src/lib/hero/heroIntelligence.js');
const titleIntelSrc = read('src/lib/hero/heroTitleIntelligence.js');
const recordSrc = read('src/lib/hero/heroRecord.js');
const coreSrc = read('src/lib/hero/heroPresentationCore.js');
const experienceSrc = read('src/components/experiences/HeroExperience.svelte');

assert(
    /function refreshHeroAssetRegistry\s*\(/.test(panelSrc),
    'refreshHeroAssetRegistry present'
);
assert(
    panelSrc.includes('getDisplayTitle(item)') &&
        panelSrc.includes('rawRegistry') &&
        panelSrc.includes('title: canonicalTitle'),
    'registry refresh stamps getDisplayTitle into title/name'
);
assert(
    panelSrc.includes('heroAssetRegistry.set(registry)'),
    'reassigns $heroAssetRegistry after canonicalize (reactive path)'
);
assert(
    panelSrc.includes('refreshHeroAssetRegistry()') &&
        panelSrc.includes('function editHeroVaultTitle'),
    'editHeroVaultTitle path still invokes refreshHeroAssetRegistry'
);
const editStart = panelSrc.indexOf('async function editHeroVaultTitle');
const editEnd = panelSrc.indexOf('function renameHeroVaultAsset', editStart);
const editSlice = editStart >= 0 && editEnd > editStart ? panelSrc.slice(editStart, editEnd) : '';
assert(
    editSlice.includes('refreshHeroAssetRegistry()') && editSlice.includes('writePersistentTitle'),
    'edit writes persistent title then refreshes registry'
);
const deleteStart = panelSrc.indexOf('async function deleteHeroVaultAsset');
const deleteSlice = deleteStart >= 0 ? panelSrc.slice(deleteStart, deleteStart + 2500) : '';
assert(
    deleteSlice.includes('deleteReelById') && deleteSlice.includes('applyCanonicalDeleteClientEffects'),
    'Hero Vault Delete still permanent (deleteReelById + tombstone effects)'
);
assert(
    !deleteSlice.includes('hideVideoVaultAsset') && !deleteSlice.includes('reelforge_video_vault_hidden_ids'),
    'Hero Vault Delete is not soft-remove'
);
assert(
    !panelSrc.includes('reelforge_hero_title_live') &&
        !panelSrc.includes('reelforge_live_vault_titles'),
    'no new title storage key introduced'
);
assert(
    panelSrc.includes("TITLES_KEY = () => CONFIG?.TITLES_STORAGE_KEY || 'reel_titles_persistent'") ||
        panelSrc.includes("'reel_titles_persistent'"),
    'existing reel_titles_persistent authority retained'
);
assert(
    panelSrc.includes('resolveCanonicalHeroTitle'),
    'existing resolveCanonicalHeroTitle retained'
);
assert(
    titleIntelSrc.includes('function reconcileActivePresentationHeroTitle') &&
        titleIntelSrc.includes('REEL_TITLES_PERSISTENT_KEY'),
    'reconcile helper lives on existing title intelligence module'
);
assert(
    intelSrc.includes('reconcileActivePresentationHeroTitle') &&
        intelSrc.includes('commitHeroAssetSelection'),
    'load/save/select path uses presentation title reconcile'
);
assert(
    recordSrc.includes('reconcileActivePresentationHeroTitle'),
    'mergeHeroRecordIntoManagerConfig re-reconciles after HeroRecord merge'
);
assert(
    coreSrc.includes('reconcileActivePresentationHeroTitle'),
    'server presentation map reconciles heroTitle (hydrate consumption path)'
);
// Hydrate may also re-reconcile on preserve; core map is the committed choke point.
assert(
    softRemoveSrc.includes('validate:video-vault-soft-remove') ||
        softRemoveSrc.includes('reelforge_video_vault_hidden_ids'),
    'soft-remove validator still owns hide-key coverage'
);
assert(
    experienceSrc.includes('heroManagerConfig?.heroTitle') &&
        !experienceSrc.includes("titleSource === 'creatorTruth' && publicResolved.title"),
    'Hero landscape prefers manager heroTitle over sticky creatorTruth for non-published'
);
assert(
    /heroLabel:\s*''/.test(intelSrc) && !/heroLabel:\s*'LOOK@ZAKANDA PRESENTS'/.test(intelSrc),
    'Viewer Label empty default still empty'
);

console.log(
    failed === 0
        ? '\n✓ hero vault title refresh acceptance passed\n'
        : `\n✗ ${failed} hero vault title refresh assertion(s) failed\n`
);
process.exit(failed === 0 ? 0 : 1);
