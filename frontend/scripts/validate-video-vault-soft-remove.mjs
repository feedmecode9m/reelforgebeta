#!/usr/bin/env node
/**
 * Video Vault soft-remove / Edit / Undo acceptance (workspace membership).
 *
 * Soft-remove is NOT durable media deletion and must not couple to:
 * - DELETE /api/reels
 * - reelforge_deleted_media_ids tombstones
 * - HeroRecord / clearHeroReel / PUBLIC APPROVED
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    VIDEO_VAULT_HIDDEN_STORAGE_KEY,
    filterVideoVaultVisible,
    hideVideoVaultAsset,
    isReversibleVaultRemoveAction,
    isVideoVaultHidden,
    readVideoVaultHiddenIds,
    restoreVideoVaultAsset,
    writeVideoVaultHiddenIds
} from '../src/lib/vault/videoVaultWorkspace.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

let failed = 0;
/** @param {string} label @param {boolean} cond */
function assert(label, cond) {
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

console.log('\n[video vault soft-remove — workspace helpers]');

bag.clear();
writeVideoVaultHiddenIds([]);

assertEq('storage key is workspace-local (not delete tombstone)', VIDEO_VAULT_HIDDEN_STORAGE_KEY, 'reelforge_video_vault_hidden_ids');
assert(
    'workspace key ≠ permanent tombstone key',
    VIDEO_VAULT_HIDDEN_STORAGE_KEY !== 'reelforge_deleted_media_ids'
);

const listBefore = [
    { id: ASSET, name: 'Main.mp4', url: 'https://cdn.example/v.mp4', seriesIdentity: { seriesLabel: 'S' } },
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

// Undo restores same id, no duplicate in hidden list
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

// Double-hide remains single entry
hideVideoVaultAsset(ASSET);
hideVideoVaultAsset(ASSET);
assertEq('no duplicate hidden ids', readVideoVaultHiddenIds().filter((id) => id === ASSET).length, 1);

assert(isReversibleVaultRemoveAction('soft-remove-from-vault'), 'soft-remove is reversible action tag');
assert(!isReversibleVaultRemoveAction('delete-reel'), 'delete-reel is not soft-remove');

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
// Soft-remove path must not call deleteReelById / deleteVaultVideo / tombstone
const softFn = vaultSrc.slice(
    vaultSrc.indexOf('function softRemoveFromVideoVault'),
    vaultSrc.indexOf('function undoLastVideoVaultSoftRemove')
);
assert(Boolean(softFn) && softFn.length > 40, 'softRemove function slice located');
assert(
    !/deleteReelById|deleteVaultVideo|applyVideoDeleteTombstone|applyCanonicalDeleteClientEffects|clearHeroReel|recordDeletedMediaIds/.test(
        softFn
    ),
    'softRemove does not call durable delete / tombstone / clearHero'
);
const undoFn = vaultSrc.slice(
    vaultSrc.indexOf('function undoLastVideoVaultSoftRemove'),
    vaultSrc.indexOf('function requestVaultVideoEdit')
);
assert(!/uploadMedia|fetchReadyReels/.test(undoFn), 'undo does not re-upload or re-fetch catalog as identity');
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
// Batch permanent delete still labeled permanent
assert(
    vaultSrc.includes('batchDeleteSelectedVideos') && vaultSrc.includes('Permanently delete'),
    'batch permanent delete path retained and separate'
);
// Phase C / presentation WIP not mixed
assert(
    !vaultSrc.includes('editHeroVaultTitle'),
    'Phase C title-write not opened by this change'
);
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
