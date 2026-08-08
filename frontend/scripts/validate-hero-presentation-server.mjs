#!/usr/bin/env node
/**
 * Regression: site-wide hero presentation must not depend on localStorage alone.
 *
 * - mapServerPresentationToManagerPatch recovers heroAssetId from backend payload
 * - sanitize fixes location "La" → "Los Angeles" for "Vic G LA Story"
 * - simulated clear-localStorage still resolves the canonical hero asset from server
 */
import {
    buildServerPresentationPayload,
    mapServerPresentationToManagerPatch,
    sanitizeHeroConfigLocationIntelligence,
    logHeroSource
} from '../src/lib/hero/heroPresentationCore.js';

const EXPECTED_HERO_ASSET_ID = '3894107e-ae44-43c5-af72-b3f5d5e0ad90';

let failed = 0;

/** @param {string} label @param {unknown} actual @param {unknown} expected */
function assertEq(label, actual, expected) {
    if (actual === expected) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(
        `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`
    );
}

/** @param {string} label @param {boolean} cond */
function assert(label, cond) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}`);
}

console.log('\n[sanitize location “La” → Los Angeles]');
const badStore = {
    heroAssetId: EXPECTED_HERO_ASSET_ID,
    heroTitle: 'Vic G LA Story',
    heroTitleIntelligence: {
        normalizedTitle: 'Vic G LA Story',
        location: 'La',
        discoveryTags: ['creator']
    },
    heroStoryContext: {
        location: 'La',
        discoveryTags: ['creator'],
        headline: 'Vic G LA Story'
    }
};
const fixed = sanitizeHeroConfigLocationIntelligence(badStore);
assertEq('location Los Angeles', fixed.heroTitleIntelligence.location, 'Los Angeles');
assertEq('story location Los Angeles', fixed.heroStoryContext.location, 'Los Angeles');
assertEq('title preserved', fixed.heroTitleIntelligence.normalizedTitle, 'Vic G LA Story');
assert(
    'discoveryTags has los-angeles',
    fixed.heroTitleIntelligence.discoveryTags.includes('los-angeles')
);
assert(
    'discoveryTags has la',
    fixed.heroTitleIntelligence.discoveryTags.includes('la')
);

console.log('\n[server payload build includes asset + NLP]');
const mediaFixture = 'https://cdn.example/prod/3894107e-ae44-43c5-af72-b3f5d5e0ad90.mp4';
const payload = buildServerPresentationPayload({
    ...fixed,
    backgroundSource: 'custom_video',
    heroLabel: 'LOOK@ZAKANDA PRESENTS',
    heroSubtitle: 'An intimate documentary spotlight.',
    mediaUrl: mediaFixture,
    posterUrl: 'https://cdn.example/poster.jpg'
});
assertEq('payload heroAssetId', payload.heroAssetId, EXPECTED_HERO_ASSET_ID);
assertEq('payload mediaUrl', payload.mediaUrl, mediaFixture);
assertEq('payload posterUrl', payload.posterUrl, 'https://cdn.example/poster.jpg');
assertEq('payload backgroundSource', payload.backgroundSource, 'custom_video');
assertEq(
    'payload presentation location',
    payload.presentation?.heroTitleIntelligence?.location,
    'Los Angeles'
);

console.log('\n[backend → manager patch after clearing localStorage]');
// Simulate empty local — only server body.
const serverBody = {
    heroAssetId: EXPECTED_HERO_ASSET_ID,
    backgroundSource: 'custom_video',
    backgroundStyle: 'video',
    mediaUrl: mediaFixture,
    posterUrl: 'https://cdn.example/poster.jpg',
    heroLabel: 'LOOK@ZAKANDA PRESENTS',
    heroTitle: 'Vic G LA Story',
    heroSubtitle: 'An intimate documentary spotlight.',
    presentation: {
        heroStoryContext: payload.presentation.heroStoryContext,
        heroTitleIntelligence: payload.presentation.heroTitleIntelligence
    }
};
const patch = mapServerPresentationToManagerPatch(serverBody);
assert(Boolean(patch), 'map returns patch');
assertEq('resolved heroAssetId', String(patch.heroAssetId), EXPECTED_HERO_ASSET_ID);
assertEq('resolved title', String(patch.heroTitle), 'Vic G LA Story');
assertEq('resolved location', patch.heroTitleIntelligence?.location, 'Los Angeles');
assertEq('resolved mediaUrl from server', String(patch.mediaUrl || ''), mediaFixture);

// Fresh browser simulation: empty cache, backend hydrates
/** @type {Record<string, unknown> | null} */
let cache = null;
function loadFn() {
    return cache || { heroAssetId: '', backgroundSource: 'none', heroTitle: '' };
}
function saveFn(p, opts = {}) {
    cache = { ...loadFn(), ...p };
    console.log('  [sim] write cache source=', opts.source || 'localStorage', 'id=', cache.heroAssetId);
    return cache;
}

// Clear
cache = null;
const hydrated = saveFn(patch, { skipServer: true, source: 'backend' });
const log = logHeroSource({
    source: 'backend',
    heroAssetId: hydrated.heroAssetId,
    title: hydrated.heroTitle,
    backgroundUrl: serverBody.mediaUrl
});
assertEq('fresh context still has hero id', String(hydrated.heroAssetId), EXPECTED_HERO_ASSET_ID);
assertEq('HERO_SOURCE backend', log.source, 'backend');
assertEq('HERO_SOURCE asset', log.heroAssetId, EXPECTED_HERO_ASSET_ID);

console.log('\n[fresh device: no vault — server mediaUrl is enough to resolve]');
const R2 = 'https://pub-cb178488b1d4413988778e56a7d51439.r2.dev/prod/3894107e-ae44-43c5-af72-b3f5d5e0ad90.mp4';
const STALE = 'https://reelforge-deploy-production.up.railway.app/videos/3894107e-ae44-43c5-af72-b3f5d5e0ad90.mp4';

/** inline pure pick (mirrors heroIntelligence.pickHeroBackgroundMediaUrl contract) */
function isStaleLocalVideosMediaUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return false;
    if (raw.startsWith('/videos/')) return true;
    try {
        const u = new URL(raw);
        if (!u.pathname.startsWith('/videos/')) return false;
        const host = u.hostname.toLowerCase();
        return (
            host.includes('railway.app') ||
            host.includes('localhost') ||
            host.includes('127.0.0.1') ||
            host.endsWith('.netlify.app')
        );
    } catch {
        return false;
    }
}
function pickHeroBackgroundMediaUrl(parts = {}) {
    const server = String(parts.serverMediaUrl || '').trim();
    const record = String(parts.recordMediaUrl || '').trim();
    const catalog = String(parts.catalogMediaUrl || '').trim();
    if (server && !isStaleLocalVideosMediaUrl(server)) {
        return { mediaUrl: server, source: 'server_presentation' };
    }
    if (record && !isStaleLocalVideosMediaUrl(record)) {
        return { mediaUrl: record, source: 'hero_record' };
    }
    if (catalog) {
        return {
            mediaUrl: catalog,
            source: server || record ? 'catalog_heal' : 'vault_catalog'
        };
    }
    if (server) return { mediaUrl: server, source: 'server_presentation_stale' };
    if (record) return { mediaUrl: record, source: 'hero_record_stale' };
    return { mediaUrl: '', source: 'unavailable' };
}

const pureServer = pickHeroBackgroundMediaUrl({ serverMediaUrl: R2 });
assertEq('R2 server media wins without vault', pureServer.mediaUrl, R2);
assertEq('source server_presentation', pureServer.source, 'server_presentation');

const heal = pickHeroBackgroundMediaUrl({
    serverMediaUrl: STALE,
    catalogMediaUrl: R2
});
assertEq('stale railway /videos healed from catalog', heal.mediaUrl, R2);
assertEq('source catalog_heal', heal.source, 'catalog_heal');

const emptyDevice = pickHeroBackgroundMediaUrl({
    serverMediaUrl: STALE,
    recordMediaUrl: '',
    catalogMediaUrl: ''
});
assertEq('stale still returned if no catalog', emptyDevice.mediaUrl, STALE);

// mapServer patch still exposes media for empty cache devices
const noVaultPatch = mapServerPresentationToManagerPatch({
    heroAssetId: EXPECTED_HERO_ASSET_ID,
    backgroundSource: 'custom_video',
    backgroundStyle: 'video',
    mediaUrl: R2,
    heroLabel: 'LOOK@ZAKANDA PRESENTS',
    heroTitle: 'Vic G LA Story',
    heroDescription: 'An intimate documentary spotlight.'
});
assert(Boolean(noVaultPatch?.mediaUrl), 'patch preserves server mediaUrl without vault');
assertEq('patch mediaUrl is R2', String(noVaultPatch.mediaUrl), R2);

console.log(
    failed === 0
        ? '\n✓ hero presentation server regression passed\n'
        : `\n✗ ${failed} assertion(s) failed\n`
);
process.exit(failed === 0 ? 0 : 1);
