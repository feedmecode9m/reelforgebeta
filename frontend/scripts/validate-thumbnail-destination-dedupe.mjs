#!/usr/bin/env node
/**
 * Invariant: one canonical thumbnail asset renders at most once per destination
 * (TRENDING/feed shelf, Hero Vault picks). Distinguished cases:
 * - different thumbnails (allowed)
 * - same thumbnail via dual representations (blocked)
 * - synthetic personal-thumb vs catalog image (blocked when both present)
 * - layout/demo placeholders without asset id (ignored)
 * - same asset legitimately in different destinations (allowed)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    assertAtMostOneCardPerThumbnailAsset,
    canonicalThumbnailAssetId,
    feedHasCatalogOwnedThumbnailCard,
    isSyntheticPersonalThumbnailFeedCard,
    shouldSynthesizePersonalThumbnailFeedCard
} from '../src/lib/viewer/thumbnailDestinationIdentity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function fail(msg) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

function ok(msg) {
    console.log(`  ok: ${msg}`);
}

// --- unit: identity helpers ---
const ASSET = 'd1539feb-54c9-47e8-b40d-9318b9f87fb2';
const OTHER = '6060c258-a3f6-40ba-b642-c758562c7cb7';

if (canonicalThumbnailAssetId({ id: ASSET }) !== ASSET) fail('canonical id from reel');
if (canonicalThumbnailAssetId({ id: `personal-thumb-${ASSET}` }) !== ASSET) {
    fail('canonical strips personal-thumb- prefix');
}
if (canonicalThumbnailAssetId({ id: OTHER }) === ASSET) fail('different assets stay distinct');
ok('canonicalThumbnailAssetId distinguishes real vs synthetic ids');

if (!isSyntheticPersonalThumbnailFeedCard({ id: `personal-thumb-${ASSET}`, isPersonalThumbnail: true })) {
    fail('synthetic flag');
}
if (isSyntheticPersonalThumbnailFeedCard({ id: ASSET, isCatalogImage: true })) {
    fail('catalog image is not synthetic personal');
}
ok('isSyntheticPersonalThumbnailFeedCard separates placeholder path from catalog');

const feedWithCatalog = {
    Trending: [
        {
            id: ASSET,
            type: 'image',
            isCatalogImage: true,
            isPersonalThumbnail: false,
            url: `/thumbs/${ASSET}.jpg`
        }
    ]
};
if (!feedHasCatalogOwnedThumbnailCard(feedWithCatalog, ASSET)) fail('catalog detection');
if (shouldSynthesizePersonalThumbnailFeedCard({ id: ASSET, url: `/thumbs/${ASSET}.jpg` }, feedWithCatalog)) {
    fail('must not synthesize when catalog owns asset');
}
if (!shouldSynthesizePersonalThumbnailFeedCard({ id: ASSET, url: `/thumbs/${ASSET}.jpg` }, { Trending: [] })) {
    fail('offline synthesize allowed when no catalog card');
}
ok('shouldSynthesize skips dual catalog+synthetic representation');

// Same asset, dual representations → violation
const dualTrending = [
    {
        id: ASSET,
        isCatalogImage: true,
        url: `/thumbs/${ASSET}.jpg`
    },
    {
        id: `personal-thumb-${ASSET}`,
        isPersonalThumbnail: true,
        personal_thumbnail: `${ASSET}.jpg`,
        url: `/thumbs/${ASSET}.jpg`
    }
];
const dualCheck = assertAtMostOneCardPerThumbnailAsset(dualTrending, 'Trending');
if (dualCheck.ok) fail('dual representation must violate');
if (dualCheck.violations[0]?.assetId !== ASSET) fail('violation key is canonical id');
ok('detects catalog + personal-thumb duplicate in one destination');

// Different thumbnails allowed
const multi = [
    { id: ASSET, isCatalogImage: true, url: `/thumbs/${ASSET}.jpg` },
    { id: OTHER, isCatalogImage: true, url: `/thumbs/${OTHER}.jpg` }
];
if (!assertAtMostOneCardPerThumbnailAsset(multi, 'Trending').ok) {
    fail('distinct thumbnails must be allowed');
}
ok('allows different thumbnails in same destination');

// Layout placeholders ignored
const withPad = [
    { id: ASSET, isCatalogImage: true, url: `/thumbs/${ASSET}.jpg` },
    {
        id: 'presentation-placeholder-Trending-0',
        isPresentationOnly: true,
        layoutOnly: true,
        isPlaceholder: true,
        title: 'Coming Soon'
    }
];
if (!assertAtMostOneCardPerThumbnailAsset(withPad, 'Trending').ok) {
    fail('presentation pads must not false-positive');
}
ok('ignores layout-only presentation placeholders');

// Legitimate: same asset in different destinations
const trendingOnly = assertAtMostOneCardPerThumbnailAsset(
    [{ id: ASSET, isCatalogImage: true }],
    'Trending'
);
const heroOnly = assertAtMostOneCardPerThumbnailAsset([{ id: ASSET, url: `/thumbs/${ASSET}.jpg` }], 'Hero Vault');
if (!trendingOnly.ok || !heroOnly.ok) fail('same asset in different destinations is fine');
ok('allows same thumbnail in different destinations');

// URL-only different spellings still same reel id → same identity
const dualUrl = [
    { id: ASSET, url: `https://cdn.example/thumbs/${ASSET}.jpg` },
    { id: `personal-thumb-${ASSET}`, isPersonalThumbnail: true, url: `/thumbs/${ASSET}.jpg` }
];
if (assertAtMostOneCardPerThumbnailAsset(dualUrl, 'Hero Vault').ok) {
    fail('must not use URL equality alone — id collision still counts');
}
ok('identity is reel id, not image URL equality');

// --- source contracts ---
const agentSrc = fs.readFileSync(path.join(root, 'src/lib/viewer/aiCleanupAgent.js'), 'utf8');
const heroSrc = fs.readFileSync(path.join(root, 'src/lib/hero/heroIntelligence.js'), 'utf8');
const identitySrc = fs.readFileSync(
    path.join(root, 'src/lib/viewer/thumbnailDestinationIdentity.js'),
    'utf8'
);

if (!agentSrc.includes('shouldSynthesizePersonalThumbnailFeedCard')) {
    fail('aiCleanupAgent must gate synthetic inserts on catalog ownership');
}
if (!agentSrc.includes('PERSONAL_THUMBNAIL_SKIP_DUAL')) {
    fail('syncThumbnailsToFeed must log skip for dual path');
}
ok('aiCleanupAgent wires dual-representation gate');

if (!heroSrc.includes('isSyntheticPersonalThumbnailFeedCard')) {
    fail('loadHeroVaultItems must drop synthetic personal feed cards');
}
if (!heroSrc.includes('canonicalThumbnailAssetId')) {
    fail('loadHeroVaultItems must dedupe by canonical thumbnail id');
}
ok('loadHeroVaultItems refuses synthetic dual Hero Vault picks');

if (!identitySrc.includes('assertAtMostOneCardPerThumbnailAsset')) {
    fail('identity module must export destination invariant');
}
ok('thumbnailDestinationIdentity exports invariant helpers');

console.log('PASS validate-thumbnail-destination-dedupe');
