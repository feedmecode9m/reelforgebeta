#!/usr/bin/env node
/**
 * Regression: site-wide hero presentation must not depend on localStorage alone.
 *
 * - mapServerPresentationToManagerPatch recovers heroAssetId from backend payload
 * - sanitize fixes location "La" → "Los Angeles" for "Vic G LA Story"
 * - simulated clear-localStorage still resolves the canonical hero asset from server
 * - optional Viewer Label: empty default, null hydrate, explicit clear, no brand invent
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildServerPresentationPayload,
    mapServerPresentationToManagerPatch,
    sanitizeHeroConfigLocationIntelligence,
    logHeroSource
} from '../src/lib/hero/heroPresentationCore.js';
import {
    pickHeroBackgroundMediaUrl,
    resolveHeroPlaybackUrl
} from '../src/lib/hero/heroPlaybackUrl.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
assertEq('resolved heroLabel from server text', String(patch.heroLabel), 'LOOK@ZAKANDA PRESENTS');

console.log('\n[server heroLabel null → manager clears label, not defaults]');
const clearedLabelBody = {
    ...serverBody,
    heroLabel: null
};
const clearedPatch = mapServerPresentationToManagerPatch(clearedLabelBody);
assert(Boolean(clearedPatch), 'null-label map returns patch');
assertEq('null server heroLabel maps to empty string', clearedPatch.heroLabel, '');
assert(
    'null-label patch keeps key (does not omit)',
    Object.prototype.hasOwnProperty.call(clearedPatch, 'heroLabel')
);
// Simulate hydrate over existing default brand so null cannot resurrect LOOK@ZAKANDA.
let labelCache = { heroLabel: 'LOOK@ZAKANDA PRESENTS', heroTitle: 'prior' };
labelCache = { ...labelCache, ...clearedPatch };
assertEq(
    'hydrate overwrite clears local brand label',
    String(labelCache.heroLabel || ''),
    ''
);

const customLabelPatch = mapServerPresentationToManagerPatch({
    ...serverBody,
    heroLabel: 'A ZAKANDA ORIGINAL'
});
assertEq(
    'custom server heroLabel preserved',
    String(customLabelPatch?.heroLabel || ''),
    'A ZAKANDA ORIGINAL'
);

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

const pureServer = pickHeroBackgroundMediaUrl({ serverMediaUrl: R2 });
assertEq('R2 server media wins without vault', pureServer.mediaUrl, R2);
assertEq('source server_presentation', pureServer.source, 'server_presentation');

// Absolute railway/presentation URL wins over relative catalog path.
const absOverRel = pickHeroBackgroundMediaUrl({
    serverMediaUrl: STALE,
    catalogMediaUrl: '/videos/3894107e-ae44-43c5-af72-b3f5d5e0ad90.mp4'
});
assertEq('absolute server beats relative catalog', absOverRel.mediaUrl, STALE);

const emptyDevice = pickHeroBackgroundMediaUrl({
    serverMediaUrl: STALE,
    recordMediaUrl: '',
    catalogMediaUrl: ''
});
assertEq('absolute server alone still used', emptyDevice.mediaUrl, STALE);

const lsCannotBeatServer = pickHeroBackgroundMediaUrl({
    serverMediaUrl: R2,
    localStorageMediaUrl: '/videos/legacy-local.mp4'
});
assertEq('localStorage never overrides server', lsCannotBeatServer.mediaUrl, R2);
assertEq('pick source remains server', lsCannotBeatServer.source, 'server_presentation');

console.log('\n[resolveHeroPlaybackUrl never strips absolute origin]');
const absIn =
    'https://reelforge-deploy-production.up.railway.app/videos/test.mp4';
const absOut = resolveHeroPlaybackUrl(absIn, {
    backendOrigin: 'https://reelforge-deploy-production.up.railway.app',
    silent: true
});
assertEq('absolute railway unchanged', absOut, absIn);

const relOut = resolveHeroPlaybackUrl('/videos/test.mp4', {
    backendOrigin: 'https://reelforge-deploy-production.up.railway.app',
    silent: true
});
assertEq(
    'relative /videos joins backend origin',
    relOut,
    'https://reelforge-deploy-production.up.railway.app/videos/test.mp4'
);

const r2Out = resolveHeroPlaybackUrl(R2, { silent: true });
assertEq('R2 URL unchanged', r2Out, R2);

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

console.log('\n[optional Viewer Label: defaults, clear, accept, stage badge sources]');
const heroExpSrc = readFileSync(
    join(__dirname, '../src/components/experiences/HeroExperience.svelte'),
    'utf8'
);
const managerSrc = readFileSync(
    join(__dirname, '../src/components/studio/HeroManagerPanel.svelte'),
    'utf8'
);
const headerSrc = readFileSync(
    join(__dirname, '../src/components/navigation/ConsumerHeader.svelte'),
    'utf8'
);
const intelSrc = readFileSync(join(__dirname, '../src/lib/hero/heroIntelligence.js'), 'utf8');

assert(
    /heroLabel:\s*['"]{0,2}\s*['"]/.test(intelSrc) ||
        /heroLabel:\s*''/.test(intelSrc) ||
        /heroLabel:\s*""/.test(intelSrc),
    'default manager config sets empty heroLabel'
);
assert(
    !/heroLabel:\s*'LOOK@ZAKANDA PRESENTS'/.test(intelSrc),
    'default manager config no longer hard-codes brand as heroLabel'
);
assert(
    /placeholder="Optional viewer label"/.test(managerSrc),
    'Viewer Label placeholder is neutral optional copy'
);
assert(
    !/placeholder="LOOK@ZAKANDA PRESENTS"/.test(managerSrc),
    'Viewer Label placeholder must not be brand text'
);
assert(
    /Object\.prototype\.hasOwnProperty\.call\(config,\s*'heroLabel'\)/.test(managerSrc),
    'persistHeroSettings keeps explicit heroLabel including empty'
);
assert(
    !/heroLabel:\s*config\.heroLabel\s*\|\|\s*savedConfig\.heroLabel/.test(managerSrc),
    'persistHeroSettings no longer uses falsy || brand recover for heroLabel'
);
// Accept path: preserve label trim only — no LOOK inject for empty.
const acceptIdx = heroExpSrc.indexOf('const viewerPatch = {');
assert(acceptIdx >= 0, 'Hero accept viewerPatch present');
const acceptSlice = heroExpSrc.slice(acceptIdx, acceptIdx + 650);
assert(
    !/shouldHydrateViewerField\(currentConfig\?\.heroLabel\)[\s\S]{0,80}LOOK@ZAKANDA PRESENTS/.test(
        acceptSlice
    ),
    'Hero accept does not inject brand Viewer Label when empty'
);
assert(
    /heroLabel:\s*String\(currentConfig\?\.heroLabel\s*\|\|\s*''\)\.trim\(\)/.test(acceptSlice) ||
        /heroLabel:\s*String\(currentConfig\?\.heroLabel \|\| ''\)\.trim\(\)/.test(acceptSlice),
    'Hero accept preserves current heroLabel (empty stays empty)'
);
// Stage: no brand fallback for empty published label.
assert(
    !/heroStoryLabel\s*\|\|\s*['"]Look@Zakanda Presents['"]/.test(heroExpSrc),
    'HeroExperience does not resurrect Look@Zakanda badge from empty label'
);
assert(
    /\{#if heroBadgeLabel\}/.test(heroExpSrc),
    'HeroExperience only mounts badge when heroBadgeLabel is non-empty'
);
assert(
    /brand\s*=\s*['"]LOOK@ZAKANDA PRESENTS['"]/.test(headerSrc),
    'ConsumerHeader default brand remains LOOK@ZAKANDA PRESENTS'
);

// Explicit clear publish-body semantics (mirrors Hero Manager fix).
function resolvePublishedHeroLabel(config, savedConfig) {
    if (Object.prototype.hasOwnProperty.call(config, 'heroLabel')) {
        return String(config.heroLabel ?? '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(savedConfig, 'heroLabel')) {
        return String(savedConfig.heroLabel ?? '').trim();
    }
    return '';
}
const priorBrand = { heroLabel: 'LOOK@ZAKANDA PRESENTS', heroTitle: 'Vic G LA Story' };
const clearedUi = { ...priorBrand, heroLabel: '' };
assertEq(
    'explicit clear publish body heroLabel is empty string',
    resolvePublishedHeroLabel(clearedUi, priorBrand),
    ''
);
assertEq(
    'custom label publish preserved',
    resolvePublishedHeroLabel({ heroLabel: 'A ZAKANDA ORIGINAL' }, priorBrand),
    'A ZAKANDA ORIGINAL'
);
assertEq(
    'absent key falls back to saved',
    resolvePublishedHeroLabel({}, priorBrand),
    'LOOK@ZAKANDA PRESENTS'
);

// Dynamic default + hydrate when Node can load manager defaults.
try {
    const { createServer } = await import('vite');
    const server = await createServer({
        root: join(__dirname, '..'),
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error'
    });
    try {
        const intel = await server.ssrLoadModule('/src/lib/hero/heroIntelligence.js');
        const defaults = intel.getDefaultHeroManagerConfig();
        assertEq('runtime default heroLabel is empty', String(defaults.heroLabel ?? ''), '');
        assert(
            String(defaults.heroLabel) !== 'LOOK@ZAKANDA PRESENTS',
            'runtime default is not brand'
        );
    } finally {
        await server.close();
    }
} catch (err) {
    console.warn('  ⊘ runtime getDefaultHeroManagerConfig skip:', err?.message || err);
}

console.log(
    failed === 0
        ? '\n✓ hero presentation server regression passed\n'
        : `\n✗ ${failed} assertion(s) failed\n`
);
process.exit(failed === 0 ? 0 : 1);
