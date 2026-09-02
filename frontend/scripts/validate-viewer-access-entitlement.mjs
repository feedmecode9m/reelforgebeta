#!/usr/bin/env node
/** Viewer paid entitlement contract parity across desktop/mobile episode surfaces. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else console.log(`  ok: ${msg}`);
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

const entitlement = read('src/lib/series/viewerAccessEntitlement.js');
const theater = read('src/components/theater/TheaterExperience.svelte');
const seriesPage = read('src/components/series/SeriesPublicPage.svelte');
const drawer = read('src/components/series/SeriesDrawer.svelte');
const season = read('src/components/series/SeasonAccordion.svelte');
const chip = read('src/components/series/EpisodeChip.svelte');

assert(
    entitlement.includes('VIEWER_ENTITLEMENT_STORAGE_KEYS'),
    'entitlement module defines canonical storage keys'
);
assert(
    entitlement.includes('VIEWER_ENTITLEMENT_PROFILE_PATHS'),
    'entitlement module defines canonical profile paths'
);
assert(
    entitlement.includes('subscribeViewerPaidAccessEntitlement'),
    'entitlement module exports subscription hook'
);
assert(
    entitlement.includes('VIEWER_CHECKOUT_FAILURE_REASONS') &&
        entitlement.includes('consumeViewerCheckoutFailureReason'),
    'entitlement module exposes checkout failure reasons for UX-safe messaging'
);
assert(
    entitlement.includes("if (!episodeId) {") &&
        entitlement.includes('MISSING_EPISODE'),
    'checkout flow fails safely when episode context is missing'
);
assert(
    entitlement.includes('dispatchViewerEntitlementUpdated'),
    'entitlement module exports update dispatch helper'
);

assert(
    theater.includes('subscribeViewerPaidAccessEntitlement'),
    'Theater subscribes to shared entitlement source'
);
assert(
    seriesPage.includes('subscribeViewerPaidAccessEntitlement'),
    'Series public page subscribes to shared entitlement source'
);
assert(
    drawer.includes('export let hasAccessEntitlement = false;') &&
        season.includes('export let hasAccessEntitlement = false;') &&
        chip.includes('export let hasAccessEntitlement = false;'),
    'episode drawer/season/chip accept propagated entitlement state'
);
assert(
    season.includes('stableEpisodeIdFor(episode)') &&
        season.includes('episodeId={stableEpisodeIdFor(row.episode)}') &&
        drawer.includes('episodeId: lockedEpisodeId'),
    'episode id is stabilized and propagated through season → drawer lock events'
);
assert(
    seriesPage.includes('lockedEpisodeId') &&
        seriesPage.includes('resolveCheckoutFailureMessage') &&
        theater.includes('lockedEpisodeId') &&
        theater.includes('resolveCheckoutFailureMessage'),
    'series/theater lock handlers preserve episode id and map checkout failures by cause'
);
assert(
    chip.includes("dispatch('locked'"),
    'episode chip emits locked event for paid episodes without entitlement'
);

if (failures.length) {
    console.error(
        'FAIL validate-viewer-access-entitlement\n' + failures.map((f) => `  - ${f}`).join('\n')
    );
    process.exit(1);
}

console.log('PASS validate-viewer-access-entitlement');
