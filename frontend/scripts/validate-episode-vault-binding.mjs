#!/usr/bin/env node
/**
 * Manual Hero Vault episode binding override validation.
 *
 * 1. Manual STIRRED CUT → that asset
 * 2. No manual → STIRRED family via keyword resolver
 * 3. Manual id removed from ready vault → falls back to auto
 * 4. Unknown episode title → unavailable
 */
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const bindingMod = await import(
    pathToFileURL(path.join(root, 'src/lib/series/episodeVaultBindingResolver.js')).href
);
const { resolveEpisodeMedia } = bindingMod;

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
const CUT_ID = 'dddddddd-eeee-4fff-8111-222222222222';
const MALL_ID = 'bbbbbbbb-cccc-4ddd-8eee-222222222222';

/** @type {Record<string, unknown>[]} */
const readyVault = [
    {
        id: STIRRED_ID,
        title: 'STIRRED',
        name: 'STIRRED',
        url: `/videos/${STIRRED_ID}.mp4`,
        thumbnailUrl: `/thumbs/${STIRRED_ID}.jpg`,
        status: 'ready',
        type: 'video/mp4'
    },
    {
        id: CUT_ID,
        title: 'STIRRED DIRECTOR CUT.mp4',
        name: 'STIRRED DIRECTOR CUT.mp4',
        url: `/videos/${CUT_ID}.mp4`,
        thumbnailUrl: `/thumbs/${CUT_ID}.jpg`,
        status: 'ready',
        type: 'video/mp4'
    },
    {
        id: MALL_ID,
        title: 'STIRRED MALL WALK',
        url: `/videos/${MALL_ID}.mp4`,
        thumbnailUrl: `/thumbs/${MALL_ID}.jpg`,
        status: 'ready',
        type: 'video/mp4'
    }
];

console.log('\n[episodeVaultBindingResolver — manual override]\n');

const epManual = {
    episodeId: 'ep-stirred-1',
    episodeNumber: 1,
    title: 'STIRRED 1',
    status: 'published',
    heroVaultAssetId: CUT_ID,
    heroVaultBindingMode: 'manual'
};

const rManual = resolveEpisodeMedia({ episode: epManual, readyVaultAssets: readyVault });
assert('manual: matched', rManual.matched === true);
assert('manual: uses DIRECTOR CUT asset', rManual.matched && rManual.assetId === CUT_ID);
assert('manual: bindingMode manual', rManual.matched && rManual.bindingMode === 'manual');
assert(
    'manual: label Manual Vault Asset',
    rManual.matched && rManual.bindingLabel === 'Manual Vault Asset'
);

const epAuto = {
    episodeId: 'ep-stirred-1b',
    episodeNumber: 1,
    title: 'STIRRED 1',
    status: 'published',
    heroVaultAssetId: null,
    heroVaultBindingMode: 'auto'
};

const rAuto = resolveEpisodeMedia({ episode: epAuto, readyVaultAssets: readyVault });
assert('auto: matched', rAuto.matched === true);
assert('auto: STIRRED family asset', rAuto.matched && rAuto.assetId === STIRRED_ID);
assert('auto: bindingMode auto', rAuto.matched && rAuto.bindingMode === 'auto');
assert('auto: label Auto matched', rAuto.matched && rAuto.bindingLabel === 'Auto matched');

// Manual asset gone from ready vault → safe auto fallback
const epStale = {
    episodeId: 'ep-stirred-stale',
    episodeNumber: 1,
    title: 'STIRRED 1',
    status: 'published',
    heroVaultAssetId: 'zzzzzzzz-gone-4aaa-8bbb-ffffffffffff',
    heroVaultBindingMode: 'manual'
};
const rStale = resolveEpisodeMedia({ episode: epStale, readyVaultAssets: readyVault });
assert('stale manual: still matched via auto', rStale.matched === true);
assert('stale manual: falls back to STIRRED family', rStale.matched && rStale.assetId === STIRRED_ID);
assert('stale manual: auto bindingMode', rStale.matched && rStale.bindingMode === 'auto');

const epUnknown = {
    episodeId: 'ep-unknown',
    episodeNumber: 9,
    title: 'UNKNOWN EPISODE TITLE',
    status: 'published'
};
const rUnknown = resolveEpisodeMedia({ episode: epUnknown, readyVaultAssets: readyVault });
assert('unknown: unmatched', rUnknown.matched === false);
assert('unknown: unavailable label', rUnknown.bindingLabel === 'Asset unavailable');
assert('unknown: null bindingMode', rUnknown.bindingMode == null);

console.log(failed === 0 ? '\nPASS validate-episode-vault-binding' : `\nFAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
