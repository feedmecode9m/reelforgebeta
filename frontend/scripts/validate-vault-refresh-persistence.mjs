#!/usr/bin/env node
/**
 * Hero Vault refresh persistence — source locks.
 * Selected Hero MP4s and thumbnail vault stills must survive sync/reload.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

let failed = 0;
function assert(cond, label) {
    if (cond) console.log(`  ✓ ${label}`);
    else {
        failed += 1;
        console.error(`  ✗ ${label}`);
    }
}

const ctx = fs.readFileSync(path.join(root, 'src/viewer/viewerContext.js'), 'utf8');
const reelshort = fs.readFileSync(
    path.join(root, 'src/components/vertical/ReelshortExperience.svelte'),
    'utf8'
);

console.log('\n[vault-refresh-persistence]');

assert(
    ctx.includes('retainHeroVaultRows') || ctx.includes('Hero MP4s belong in personal_video_vault'),
    'persistPersonalVault retains Hero Vault MP4 rows'
);
assert(
    /persistPersonalVault\(mergedVaultVideos\)/.test(ctx),
    'syncFromVault persists merged vault including Hero rows'
);
assert(
    !/reloadVaultStoresFromStorage[\s\S]{0,350}writeThumbnailVault\(nonHeroThumbs/.test(ctx),
    'reload does not rewrite personal_thumbnails without Hero stills'
);
assert(
    ctx.includes('Empty catalog is not a vault delete'),
    'empty backend catalog does not wipe personal_thumbnails'
);
assert(
    ctx.includes('backend-projection-local-durable'),
    'online merge keeps local durable vault MP4s not in catalog'
);
assert(
    reelshort.includes("localStorage.getItem('personal_video_vault')") &&
        reelshort.includes('LEGACY_HERO_REEL_KEY'),
    'Trending recovers vault MP4s and the persisted Hero reel'
);
assert(
    reelshort.includes('mergeMissingPlayableVideos'),
    'Trending stills do not skip vault video recovery'
);

if (failed) {
    console.error('\nFAIL — vault-refresh-persistence');
    process.exit(1);
}
console.log('\nPASS — vault-refresh-persistence');
