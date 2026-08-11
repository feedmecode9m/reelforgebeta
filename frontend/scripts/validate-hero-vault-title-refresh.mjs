#!/usr/bin/env node
/**
 * Hero Vault live title refresh (canonical registry stamp).
 *
 * Proves edit-title does not leave stale harvested names on registry rows,
 * and a later rebuild with stale feed title still cannot win over
 * reel_titles_persistent / session rename via resolveCanonicalHeroTitle.
 *
 * No new title storage key. Soft-remove and PUBLIC APPROVED surfaces untouched.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    resolveCanonicalHeroTitle,
    isUnsafeHeroFilenameTitle
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

// --- Non-hero vault pick behaves identically ---
const OTHER_NEXT = 'Other Creator Cut';
renamed[OTHER_ID] = OTHER_NEXT;
persistent[OTHER_ID] = { title: OTHER_NEXT, title_original: OTHER_NEXT };
registry = registry.map((item) => stampRegistryTitle(item, renamed, persistent));
assert(
    registry.find((r) => r.assetId === OTHER_ID)?.title === OTHER_NEXT,
    'non-hero Hero Vault asset stamp = new title'
);

// --- Later registry rebuild re-introduces stale harvested title → stamp wins ---
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
// Session renames cleared (hard refresh of in-memory map) — persistent still wins
const afterRefreshRenamed = {};
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

console.log('\n[hero-vault-title-refresh — wiring]');

const panelSrc = read('src/components/studio/HeroManagerPanel.svelte');
const softRemoveSrc = read('scripts/validate-video-vault-soft-remove.mjs');
const intelSrc = read('src/lib/hero/heroIntelligence.js');

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
    softRemoveSrc.includes('validate:video-vault-soft-remove') ||
        softRemoveSrc.includes('reelforge_video_vault_hidden_ids'),
    'soft-remove validator still owns hide-key coverage'
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
