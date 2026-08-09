#!/usr/bin/env node
/**
 * Episode → Hero Vault keyword family resolver validation.
 *
 * ✓ STIRRED 1 → STIRRED
 * ✓ STIRRED 2 → STIRRED
 * ✓ STIRRED 99 → STIRRED
 * ✓ STIRRED MALL WALK IN → MALL WALK asset
 * ✓ UNKNOWN TITLE → unmatched
 */
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const mod = await import(
    pathToFileURL(path.join(root, 'src/lib/series/episodeVaultResolver.js')).href
);

const {
    resolveEpisodeVaultAsset,
    extractKeywords,
    normalizeTitle,
    primaryKeyword,
    isReadyVaultAsset,
    extractEpisodeNumberMetadata
} = mod;

let failed = 0;
function assert(label, cond) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}`);
}

const STIRRED_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111';
const MALL_ID = 'bbbbbbbb-cccc-4ddd-8eee-222222222222';
const STIRRED_NUM_ID = 'cccccccc-dddd-4eee-8fff-333333333333';

/** @type {Record<string, unknown>[]} */
const readyVault = [
    {
        id: STIRRED_ID,
        title: 'STIRRED',
        name: 'STIRRED',
        url: `/videos/${STIRRED_ID}.mp4`,
        thumbnailUrl: `/thumbs/${STIRRED_ID}.jpg`,
        status: 'ready',
        type: 'video/mp4',
        createdAt: 100
    },
    {
        id: MALL_ID,
        title: 'STIRRED MALL WALK',
        name: 'STIRRED MALL WALK',
        url: `/videos/${MALL_ID}.mp4`,
        thumbnailUrl: `/thumbs/${MALL_ID}.jpg`,
        status: 'ready',
        type: 'video/mp4',
        createdAt: 9999
    },
    {
        id: STIRRED_NUM_ID,
        title: 'STIRRED 3',
        name: 'STIRRED 3',
        url: `/videos/${STIRRED_NUM_ID}.mp4`,
        thumbnailUrl: `/thumbs/${STIRRED_NUM_ID}.jpg`,
        status: 'ready',
        type: 'video/mp4',
        createdAt: 50_000
    },
    {
        id: 'pending-skip',
        title: 'STIRRED',
        url: '/videos/pending.mp4',
        status: 'pending'
    }
];

console.log('\n[episodeVaultResolver — keyword family]');

assert('normalize', normalizeTitle('STIRRED MALL WALK!') === 'stirred mall walk');
assert(
    'keywords STIRRED MALL WALK',
    JSON.stringify(extractKeywords('STIRRED MALL WALK')) ===
        JSON.stringify(['stirred', 'mall', 'walk'])
);
assert(
    'STIRRED 1 keywords drop episode number',
    JSON.stringify(extractKeywords('STIRRED 1')) === JSON.stringify(['stirred'])
);
assert(
    'STIRRED 99 keywords drop episode number',
    JSON.stringify(extractKeywords('STIRRED 99')) === JSON.stringify(['stirred'])
);
assert('primary STIRRED 2', primaryKeyword('STIRRED 2') === 'stirred');
assert('episode number metadata only', extractEpisodeNumberMetadata('STIRRED 99') === 99);

assert('pending not ready', isReadyVaultAsset(readyVault[3]) === false);
assert('ready asset gate', isReadyVaultAsset(readyVault[0]) === true);

const r1 = resolveEpisodeVaultAsset('STIRRED 1', readyVault);
assert('STIRRED 1 → STIRRED asset', r1.matched && r1.assetId === STIRRED_ID);
assert('STIRRED 1 tier primary', r1.matched && r1.matchTier === 'primary');

const r2 = resolveEpisodeVaultAsset('STIRRED 2', readyVault);
assert('STIRRED 2 → STIRRED asset', r2.matched && r2.assetId === STIRRED_ID);

const r99 = resolveEpisodeVaultAsset('STIRRED 99', readyVault);
assert('STIRRED 99 → STIRRED asset', r99.matched && r99.assetId === STIRRED_ID);

const rMall = resolveEpisodeVaultAsset('STIRRED MALL WALK IN', readyVault);
assert('STIRRED MALL WALK IN → MALL WALK asset', rMall.matched && rMall.assetId === MALL_ID);
assert('STIRRED MALL WALK IN tier multiword', rMall.matched && rMall.matchTier === 'multiword');

// Newer/larger createdAt on MALL must not steal plain STIRRED episodes
assert(
    'no random latest fallback for STIRRED 1',
    resolveEpisodeVaultAsset('STIRRED 1', readyVault).assetId === STIRRED_ID
);

const rUnknown = resolveEpisodeVaultAsset('UNKNOWN TITLE', readyVault);
assert('UNKNOWN TITLE unmatched', rUnknown.matched === false);

const onlyPending = resolveEpisodeVaultAsset('STIRRED 1', [
    { id: 'x', title: 'STIRRED', url: '/videos/x.mp4', status: 'failed' }
]);
assert('failed vault ignored', onlyPending.matched === false);

console.log(failed === 0 ? '\nPASS validate-episode-vault-resolver' : `\nFAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
