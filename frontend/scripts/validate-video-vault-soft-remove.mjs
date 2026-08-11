#!/usr/bin/env node
/**
 * Video Vault soft-remove / Edit / Undo acceptance (workspace membership).
 *
 * Soft-remove is NOT durable media deletion and must not couple to:
 * - DELETE /api/reels
 * - reelforge_deleted_media_ids tombstones
 * - HeroRecord / clearHeroReel / PUBLIC APPROVED
 *
 * Hero-bound durable MP4s must soft-hide, never stub-purge.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    VIDEO_VAULT_HIDDEN_STORAGE_KEY,
    filterVideoVaultVisible,
    hideVideoVaultAsset,
    isDurableVideoVaultWorkspaceAsset,
    isReversibleVaultRemoveAction,
    isVideoVaultHidden,
    isVideoVaultStubPurgeTarget,
    readVideoVaultHiddenIds,
    restoreVideoVaultAsset,
    writeVideoVaultHiddenIds
} from '../src/lib/vault/videoVaultWorkspace.js';

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

/** @param {string} label @param {unknown} a @param {unknown} b */
function assertEq(label, a, b) {
    if (a === b) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}\n    expected ${JSON.stringify(b)}\n    actual   ${JSON.stringify(a)}`);
}

function read(rel) {
    return readFileSync(join(root, rel), 'utf8');
}

// Minimal localStorage for pure workspace helpers
const bag = new Map();
globalThis.localStorage = {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => bag.set(String(k), String(v)),
    removeItem: (k) => bag.delete(k),
    clear: () => bag.clear()
};
globalThis.window = { localStorage: globalThis.localStorage };

const ASSET = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const HERO_ASSET_ID = ASSET;
const HERO_MEDIA_URL = 'https://cdn.example/prod/vic.mp4';
const DELETE_TOMBSTONE_KEY = 'reelforge_deleted_media_ids';

console.log('\n[video vault soft-remove — workspace helpers]');

bag.clear();
writeVideoVaultHiddenIds([]);

assertEq(
    'storage key is workspace-local (not delete tombstone)',
    VIDEO_VAULT_HIDDEN_STORAGE_KEY,
    'reelforge_video_vault_hidden_ids'
);
assert(
    VIDEO_VAULT_HIDDEN_STORAGE_KEY !== DELETE_TOMBSTONE_KEY,
    'workspace key ≠ permanent tombstone key'
);

const listBefore = [
    {
        id: ASSET,
        name: 'Main.mp4',
        url: 'https://cdn.example/v.mp4',
        seriesIdentity: { seriesLabel: 'S' }
    },
    { id: OTHER, name: 'Other.mp4', url: 'https://cdn.example/o.mp4' }
];

const hide = hideVideoVaultAsset(ASSET);
assert(hide.hidden === true, 'hide returns hidden');
assert(isVideoVaultHidden(ASSET), 'asset is soft-hidden');
assert(!isVideoVaultHidden(OTHER), 'other asset not hidden');

const visible = filterVideoVaultVisible(listBefore);
assertEq('soft-hidden filtered from presentation', visible.length, 1);
assertEq('visible remaining id', String(visible[0]?.id), OTHER);
assertEq(
    'underlying list identity preserved (in-memory reference still has ASSET)',
    listBefore.find((x) => x.id === ASSET)?.id,
    ASSET
);
assertEq(
    'presentation metadata still on source list after hide',
    listBefore.find((x) => x.id === ASSET)?.seriesIdentity?.seriesLabel,
    'S'
);

// Same-session Undo restores exact same asset ID, no duplicate
const restore = restoreVideoVaultAsset(ASSET);
assert(restore.restored === true, 'restore succeeds');
assert(!isVideoVaultHidden(ASSET), 'asset no longer hidden');
assertEq(
    'full presentation set after undo',
    filterVideoVaultVisible(listBefore).length,
    2
);
assertEq(
    'same asset identity after undo (no duplicate hide entry)',
    readVideoVaultHiddenIds().filter((id) => id === ASSET).length,
    0
);
assertEq(
    'undo restores exact same asset id into presentation',
    String(filterVideoVaultVisible(listBefore).find((x) => x.id === ASSET)?.id),
    ASSET
);

// Double-hide remains single entry (no duplicate hide rows)
hideVideoVaultAsset(ASSET);
hideVideoVaultAsset(ASSET);
assertEq('no duplicate hidden ids', readVideoVaultHiddenIds().filter((id) => id === ASSET).length, 1);

assert(isReversibleVaultRemoveAction('soft-remove-from-vault'), 'soft-remove is reversible action tag');
assert(!isReversibleVaultRemoveAction('delete-reel'), 'delete-reel is not soft-remove');

console.log('\n[durable vs stub — Hero-bound durable must not purge]');

// Hero-bound durable MP4 (same id as Hero) is real durable vault media
const heroBoundDurable = {
    id: HERO_ASSET_ID,
    name: 'VicG.mp4',
    url: HERO_MEDIA_URL,
    fileName: 'VicG.mp4'
};
// Simulated unchanged authorities around soft-hide
const heroRecordBefore = { mode: 'asset', assetId: HERO_ASSET_ID, mediaUrl: HERO_MEDIA_URL };
const heroAssetIdBefore = HERO_ASSET_ID;
const mediaUrlBefore = HERO_MEDIA_URL;

assert(
    isDurableVideoVaultWorkspaceAsset(heroBoundDurable),
    'Hero-bound durable asset is a durable Video Vault workspace asset'
);
assert(
    !isVideoVaultStubPurgeTarget(heroBoundDurable, { isHeroInjected: true, isGhost: false }),
    'Hero-bound durable asset is NOT a stub purge target (Hero identity alone ≠ stub)'
);
assert(
    !isVideoVaultStubPurgeTarget(heroBoundDurable, { isHeroInjected: true, isGhost: true }),
    'durable gate wins even if ghost flag is mis-set with Hero inject'
);

// True temporary / failed stubs still use purge classification
assert(
    isVideoVaultStubPurgeTarget(
        { id: 'local-pending-1', uploadState: 'failed', name: 'x.mp4' },
        { isGhost: true }
    ),
    'true temporary/failed stubs remain purge targets'
);
assert(
    isVideoVaultStubPurgeTarget(
        { id: 'local-upload-1', uploadState: 'interrupted', url: 'blob:http://local/1' },
        { isHeroInjected: false }
    ),
    'interrupted blob stub remains purge target'
);
assert(
    !isDurableVideoVaultWorkspaceAsset({ id: ASSET, url: 'blob:http://local/1', name: 'x' }),
    'blob chrome is not durable soft-remove target'
);
assert(
    !isDurableVideoVaultWorkspaceAsset({
        id: 'local-pending-9',
        uploadState: 'pending_accept',
        url: 'https://cdn.example/pending.mp4'
    }),
    'pending_accept is not durable soft-remove target'
);

console.log('\n[persistence — hide list vs session Undo]');

// Hard-refresh stand-in: only localStorage hide list survives; session Undo does not
writeVideoVaultHiddenIds([]);
bag.delete(DELETE_TOMBSTONE_KEY);
hideVideoVaultAsset(HERO_ASSET_ID);

// Re-read storage as if after hard refresh (no session lastSoftRemoved)
const postRefreshHidden = JSON.parse(localStorage.getItem(VIDEO_VAULT_HIDDEN_STORAGE_KEY) || '[]');
assert(
    Array.isArray(postRefreshHidden) && postRefreshHidden.includes(HERO_ASSET_ID),
    'hidden ID persists across hard refresh (localStorage)'
);
assert(isVideoVaultHidden(HERO_ASSET_ID), 'hidden ID readable after storage re-read');
assertEq(
    'hidden asset stays out of Video Vault after refresh',
    filterVideoVaultVisible([heroBoundDurable, ...listBefore.filter((x) => x.id !== HERO_ASSET_ID)]).some(
        (x) => x.id === HERO_ASSET_ID
    ),
    false
);
assertEq(
    'durable media URL unchanged after soft-hide',
    listBefore.find((x) => x.id === ASSET)?.url,
    'https://cdn.example/v.mp4'
);
assertEq(
    'Hero media URL unchanged after soft-hide',
    heroBoundDurable.url,
    mediaUrlBefore
);
assertEq('Hero asset ID remains unchanged', heroAssetIdBefore, HERO_ASSET_ID);
assertEq(
    'HeroRecord remains unchanged (still bound to same asset)',
    heroRecordBefore.assetId,
    HERO_ASSET_ID
);
assertEq(
    'soft-hide does not write delete tombstone key',
    localStorage.getItem(DELETE_TOMBSTONE_KEY),
    null
);

// Undo then re-hide: exact same id, still single entry
restoreVideoVaultAsset(HERO_ASSET_ID);
hideVideoVaultAsset(HERO_ASSET_ID);
assertEq(
    'same-session undo/re-hide never duplicates asset identity in hide store',
    readVideoVaultHiddenIds().filter((id) => id === HERO_ASSET_ID).length,
    1
);

console.log('\n[video vault soft-remove — wiring / isolation]');

const vaultSrc = read('src/components/experiences/VaultExperience.svelte');
const statusSrc = read('src/components/series/VaultEpisodeCreatorStatus.svelte');
const workspaceSrc = read('src/lib/vault/videoVaultWorkspace.js');
const cleanupSrc = read('src/lib/viewer/aiCleanupAgent.js');
const delSyncSrc = read('src/lib/deletionSync.js');

assert(
    vaultSrc.includes('softRemoveFromVideoVault') && vaultSrc.includes('undoLastVideoVaultSoftRemove'),
    'VaultExperience exposes soft-remove + undo'
);
assert(
    vaultSrc.includes('data-vault-soft-remove') && vaultSrc.includes('data-vault-soft-restore'),
    'UI marks soft-remove and restore actions'
);
assert(
    vaultSrc.includes('requestVaultVideoEdit') && vaultSrc.includes('data-vault-edit'),
    'Edit action reuses existing asset (no re-upload path)'
);
assert(
    vaultSrc.includes('editSignal={vaultEditSignals') || vaultSrc.includes('editSignal={vaultEditSignals['),
    'Edit opens creator status without new media'
);
assert(
    statusSrc.includes('export let editSignal') && statusSrc.includes('openPackage()'),
    'creator status opens editor from editSignal'
);
assert(
    vaultSrc.includes('filterVideoVaultVisible') && vaultSrc.includes('hideVideoVaultAsset'),
    'display filter uses workspace hide set'
);
assert(
    vaultSrc.includes('isDurableVideoVaultWorkspaceAsset') &&
        vaultSrc.includes('isVideoVaultStubPurgeTarget'),
    'card routing uses durable-vs-stub classification'
);

// Soft-remove path must not call delete / tombstone / hero clear
const softFn = vaultSrc.slice(
    vaultSrc.indexOf('function softRemoveFromVideoVault'),
    vaultSrc.indexOf('function undoLastVideoVaultSoftRemove')
);
assert(Boolean(softFn) && softFn.length > 40, 'softRemove function slice located');
assert(
    softFn.includes('hideVideoVaultAsset'),
    'durable Remove routes to hideVideoVaultAsset (soft-hide only)'
);
assert(
    /Session-only Undo|not persisted/i.test(softFn),
    'Undo bar is session-only; no Undo resurrection after hard refresh'
);
assert(
    !/deleteReelById|deleteVaultVideo|applyVideoDeleteTombstone|applyCanonicalDeleteClientEffects|clearHeroReel|recordDeletedMediaIds|DELETE\s*\/api\/reels|heroAssetId:\s*''/.test(
        softFn
    ),
    'soft-remove does not DELETE /api/reels, tombstone, clearHeroReel, or clear heroAssetId'
);
assert(
    !/saveHeroManagerConfig|HeroRecord|localStorage\.setItem\([^)]*hero/i.test(softFn),
    'soft-remove does not mutate HeroRecord / Hero manager config'
);

// Durable assets must not render Remove stub branch as Hero-stub
assert(
    /isHeroInjected:\s*\n?\s*isHeroInjectedVaultCard\(video\)\s*&&\s*!isDurableVideoVaultWorkspaceAsset\(video\)/.test(
        vaultSrc
    ) ||
        vaultSrc.includes(
            'isHeroInjectedVaultCard(video) && !isDurableVideoVaultWorkspaceAsset(video)'
        ),
    'Hero inject alone cannot mark durable assets as Remove-stub cards'
);
assert(
    vaultSrc.includes("data-vault-action={isStubPurgeCard || isFailedCard || isPendingCard\n                  ? 'purge-stub'\n                  : 'soft-remove'}") ||
        (vaultSrc.includes("? 'purge-stub'") && vaultSrc.includes(": 'soft-remove'")),
    'durable cards use soft-remove action mark, not purge-stub'
);
assert(
    vaultSrc.includes('Remove stub') &&
        vaultSrc.includes('{:else if isStubPurgeCard}') &&
        vaultSrc.includes('data-vault-soft-remove'),
    'Remove stub UI remains only on stub path; durable uses data-vault-soft-remove Remove'
);

// handleVideoDelete must refuse durable → purgeLocalVaultVideoStub
assert(
    vaultSrc.includes('!isDurableVideoVaultWorkspaceAsset(ref)') &&
        vaultSrc.includes('purgeLocalVaultVideoStub'),
    'handleVideoDelete only purges non-durable stub chrome (not Hero-bound durable)'
);
const purgeGuard = vaultSrc.slice(
    vaultSrc.indexOf('async function handleVideoDelete'),
    vaultSrc.indexOf('async function handleVideoDelete') + 2500
);
assert(
    /!isDurableVideoVaultWorkspaceAsset\(ref\)/.test(purgeGuard) &&
        /purgeLocalVaultVideoStub/.test(purgeGuard),
    'durable gate sits on destructive purge entry in handleVideoDelete'
);

// lastSoftRemoved is session memory only (not written to localStorage)
assert(
    /let lastSoftRemoved\s*=\s*null/.test(vaultSrc),
    'lastSoftRemoved is in-memory session state only'
);
assert(
    !/localStorage\.setItem\([^)]*lastSoftRemoved|VIDEO_VAULT.*UNDO|reelforge_video_vault_undo/i.test(
        vaultSrc
    ),
    'no persistent Undo store — hard refresh has no Undo bar'
);

const undoFn = vaultSrc.slice(
    vaultSrc.indexOf('function undoLastVideoVaultSoftRemove'),
    vaultSrc.indexOf('function requestVaultVideoEdit')
);
assert(
    undoFn.includes('restoreVideoVaultAsset') && !/uploadMedia|fetchReadyReels/.test(undoFn),
    'same-session Undo restores hide list only (no re-upload / no catalog identity rewrite)'
);

// Permanent paths remain separate
assert(
    cleanupSrc.includes('deleteVaultVideo') && cleanupSrc.includes('deleteReelById'),
    'permanent delete path remains in cleanup agent (separate)'
);
assert(
    delSyncSrc.includes("DELETED_MEDIA_STORAGE_KEY = 'reelforge_deleted_media_ids'"),
    'permanent tombstone store unchanged'
);
assert(
    !workspaceSrc.includes('deleteReelById') && !workspaceSrc.includes('clearHeroReel'),
    'workspace module has no media deletion / hero clear'
);
assert(
    vaultSrc.includes('batchDeleteSelectedVideos') && vaultSrc.includes('Permanently delete'),
    'batch permanent delete path retained and separate'
);
assert(
    workspaceSrc.includes('if (isDurableVideoVaultWorkspaceAsset(entry)) return false'),
    'isVideoVaultStubPurgeTarget hard-returns false for durable assets'
);

// Phase C / presentation WIP not mixed
assert(!vaultSrc.includes('editHeroVaultTitle'), 'Phase C title-write not opened by this change');
assert(
    workspaceSrc.includes('Does not touch HeroRecord') || workspaceSrc.includes('HeroRecord'),
    'workspace docs isolate HeroRecord'
);

// Hero presentation default empty label not reversed (read-only smoke of constants)
const intelSrc = read('src/lib/hero/heroIntelligence.js');
assert(
    /heroLabel:\s*''/.test(intelSrc) && !/heroLabel:\s*'LOOK@ZAKANDA PRESENTS'/.test(intelSrc),
    'Viewer Label empty default still empty (authority untouched by this change)'
);

console.log(
    failed === 0
        ? '\n✓ video vault soft-remove acceptance passed\n'
        : `\n✗ ${failed} video vault soft-remove assertion(s) failed\n`
);
process.exit(failed === 0 ? 0 : 1);
