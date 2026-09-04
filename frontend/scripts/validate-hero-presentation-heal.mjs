#!/usr/bin/env node
/**
 * Legacy Hero presentation — detection vs explicit restoration (fail-closed).
 *
 * A. EPISODE 1 - ARRIVAL restores ONLY to 01 ARRIVAL OPEN v1
 * B. MICROS Motherland EP 01 v2 can never win
 * C. Empty catalog fails closed
 * D. Missing canonical reel fails closed
 * E. Hydration diagnostic does not mutate invalid server identity
 * F. Explicit admin restoration produces expected PUT payload
 */
import {
    buildLegacyHeroRestorationPatch,
    detectInvalidHeroPresentation,
    diagnoseInvalidHeroPresentation,
    extractMediaBasenameId,
    isSpacedUuidLikeTitle,
    LEGACY_HERO_RESTORATION_TARGETS,
    resolveLegacyHeroRestorationTarget
} from '../src/lib/hero/legacyHeroPresentationRestore.js';
import {
    buildServerPresentationPayload,
    mapServerPresentationToManagerPatch
} from '../src/lib/hero/heroPresentationCore.js';
import { isUnsafeHeroFilenameTitle } from '../src/lib/hero/heroTitleIntelligence.js';

const ARRIVAL_CANONICAL_ID = '03ef898a-989f-42c3-bdbb-67f37338df65';
const ARRIVAL_CANONICAL_TITLE = '01 ARRIVAL OPEN v1';
const ARRIVAL_MEDIA =
    'https://pub-cb178488b1d4413988778e56a7d51439.r2.dev/prod/03ef898a-989f-42c3-bdbb-67f37338df65.mp4';

const BROKEN_REMOTE = {
    heroAssetId: '07cf4278-a886-4e92-83c9-7b9cf3ab899d',
    mediaUrl:
        'https://strong-lolly-a9fcb4.netlify.app/videos/f33e55ff-7fe4-4b01-a0e2-de4be8a8dd4c.mp4',
    heroTitle: 'F33e55ff 7fe4 4b01 A0e2 De4be8a8dd4c',
    heroSubtitle: 'Trending local experience captured from the creator vault.',
    backgroundSource: 'custom_video',
    presentation: {
        featuredSeries: 'EPISODE 1 - ARRIVAL'
    }
};

const BROKEN_PATCH = {
    heroAssetId: '07cf4278-a886-4e92-83c9-7b9cf3ab899d',
    mediaUrl:
        'https://strong-lolly-a9fcb4.netlify.app/videos/f33e55ff-7fe4-4b01-a0e2-de4be8a8dd4c.mp4',
    heroTitle: 'F33e55ff 7fe4 4b01 A0e2 De4be8a8dd4c',
    featuredSeries: 'EPISODE 1 - ARRIVAL'
};

const CATALOG_WITH_ARRIVAL = [
    {
        id: '07cf4278-a886-4e92-83c9-7b9cf3ab899d',
        name: 'f33e55ff-7fe4-4b01-a0e2-de4be8a8dd4c',
        url: 'https://strong-lolly-a9fcb4.netlify.app/videos/f33e55ff-7fe4-4b01-a0e2-de4be8a8dd4c.mp4'
    },
    {
        id: ARRIVAL_CANONICAL_ID,
        name: ARRIVAL_CANONICAL_TITLE,
        url: ARRIVAL_MEDIA
    },
    {
        id: '22716e1a-5288-4830-b438-4f3e14cc01c2',
        name: '02 ARRIVAL THE PROJECT INTRO v1',
        url: 'https://pub-cb178488b1d4413988778e56a7d51439.r2.dev/prod/22716e1a-5288-4830-b438-4f3e14cc01c2.mp4'
    },
    {
        id: 'd7f82b72-51ca-4282-8f2d-197e42240839',
        name: 'MICROS Motherland EP 01 v2',
        url: 'https://pub-cb178488b1d4413988778e56a7d51439.r2.dev/prod/d7f82b72-51ca-4282-8f2d-197e42240839.mp4'
    }
];

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

console.log('\n[A] EPISODE 1 - ARRIVAL → declared canonical only]');
const arrivalTarget = resolveLegacyHeroRestorationTarget('EPISODE 1 - ARRIVAL');
assert('declared target exists', Boolean(arrivalTarget));
assert('canonical reel id', arrivalTarget?.canonicalReelId === ARRIVAL_CANONICAL_ID);
assert('canonical title', arrivalTarget?.canonicalTitle === ARRIVAL_CANONICAL_TITLE);

const restored = buildLegacyHeroRestorationPatch({
    remote: BROKEN_REMOTE,
    patch: BROKEN_PATCH,
    reels: CATALOG_WITH_ARRIVAL,
    featuredSeries: 'EPISODE 1 - ARRIVAL'
});
assert('restoration ok', restored.ok === true);
assert('heroAssetId is canonical', restored.patch?.heroAssetId === ARRIVAL_CANONICAL_ID);
assert('title is canonical', restored.patch?.heroTitle === ARRIVAL_CANONICAL_TITLE);
assert(
    'media is canonical reel url',
    String(restored.patch?.mediaUrl || '').includes(ARRIVAL_CANONICAL_ID)
);

console.log('\n[B] MICROS Motherland EP 01 v2 never selected]');
const microsOnly = buildLegacyHeroRestorationPatch({
    remote: BROKEN_REMOTE,
    patch: BROKEN_PATCH,
    reels: [
        {
            id: 'd7f82b72-51ca-4282-8f2d-197e42240839',
            name: 'MICROS Motherland EP 01 v2',
            url: 'https://example/micros.mp4'
        }
    ],
    featuredSeries: 'EPISODE 1 - ARRIVAL'
});
assert('micros-only catalog fails closed', microsOnly.ok === false);
assert(
    'error is canonical unavailable',
    microsOnly.error === 'CANONICAL_LEGACY_HERO_ASSET_UNAVAILABLE'
);
assert(
    'restored id is never micros when canonical present',
    restored.patch?.heroAssetId !== 'd7f82b72-51ca-4282-8f2d-197e42240839'
);

console.log('\n[C] empty catalog fails closed]');
const emptyCatalog = buildLegacyHeroRestorationPatch({
    remote: BROKEN_REMOTE,
    patch: BROKEN_PATCH,
    reels: [],
    featuredSeries: 'EPISODE 1 - ARRIVAL'
});
assert('empty catalog not ok', emptyCatalog.ok === false);
assert('error CATALOG_EMPTY', emptyCatalog.error === 'CATALOG_EMPTY');

console.log('\n[D] missing canonical reel fails closed]');
const missingCanonical = buildLegacyHeroRestorationPatch({
    remote: BROKEN_REMOTE,
    patch: BROKEN_PATCH,
    reels: CATALOG_WITH_ARRIVAL.filter((r) => r.id !== ARRIVAL_CANONICAL_ID),
    featuredSeries: 'EPISODE 1 - ARRIVAL'
});
assert('missing canonical not ok', missingCanonical.ok === false);
assert(
    'error CANONICAL_LEGACY_HERO_ASSET_UNAVAILABLE',
    missingCanonical.error === 'CANONICAL_LEGACY_HERO_ASSET_UNAVAILABLE'
);

console.log('\n[E] hydration diagnostic does not mutate identity]');
const patchFromServer = mapServerPresentationToManagerPatch(BROKEN_REMOTE);
const patchSnapshot = JSON.stringify(patchFromServer);
const detection = detectInvalidHeroPresentation(
    patchFromServer,
    BROKEN_REMOTE,
    isUnsafeHeroFilenameTitle
);
diagnoseInvalidHeroPresentation(BROKEN_REMOTE, patchFromServer, isUnsafeHeroFilenameTitle);
assert('invalid detected', detection.invalid === true);
assert('patch unchanged after diagnostic', JSON.stringify(patchFromServer) === patchSnapshot);
assert(
    'patch still has corrupt heroAssetId',
    patchFromServer?.heroAssetId === BROKEN_PATCH.heroAssetId
);
assert(
    'patch still has corrupt title',
    patchFromServer?.heroTitle === BROKEN_PATCH.heroTitle
);

console.log('\n[F] explicit admin restoration PUT payload]');
const payload = buildServerPresentationPayload(restored.patch);
assert('payload heroAssetId canonical', payload.heroAssetId === ARRIVAL_CANONICAL_ID);
assert('payload heroTitle canonical', payload.heroTitle === ARRIVAL_CANONICAL_TITLE);
assert('payload mediaUrl present', Boolean(payload.mediaUrl));
assert('payload backgroundSource custom_video', payload.backgroundSource === 'custom_video');

console.log('\n[detection helpers]');
assert('spaced uuid detected', isSpacedUuidLikeTitle(BROKEN_PATCH.heroTitle));
assert('unsafe filename title', isUnsafeHeroFilenameTitle(BROKEN_PATCH.heroTitle));
assert(
    'media basename mismatch',
    extractMediaBasenameId(BROKEN_PATCH.mediaUrl) === 'f33e55ff-7fe4-4b01-a0e2-de4be8a8dd4c'
);
assert(
    'declared restoration table non-empty',
    LEGACY_HERO_RESTORATION_TARGETS.length >= 1
);

console.log('\n[unknown featuredSeries fails closed]');
const unknownSeries = buildLegacyHeroRestorationPatch({
    remote: BROKEN_REMOTE,
    patch: BROKEN_PATCH,
    reels: CATALOG_WITH_ARRIVAL,
    featuredSeries: 'UNKNOWN SERIES'
});
assert('no target for unknown series', unknownSeries.ok === false);
assert('error NO_LEGACY_RESTORATION_TARGET', unknownSeries.error === 'NO_LEGACY_RESTORATION_TARGET');

if (failed > 0) {
    console.error(`\nvalidate-hero-presentation-heal: ${failed} failure(s)\n`);
    process.exit(1);
}

console.log('\nvalidate-hero-presentation-heal: PASS\n');
