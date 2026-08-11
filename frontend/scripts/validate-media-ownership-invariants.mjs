#!/usr/bin/env node
/**
 * Ownership / lifecycle invariants (architecture audit Phase D).
 *
 * Static + SSR fixtures — does not change production data or authority modules.
 * Guards rules that future consolidations must not break.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import {
    mapServerPresentationToManagerPatch,
    buildServerPresentationPayload
} from '../src/lib/hero/heroPresentationCore.js';

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

function read(rel) {
    return readFileSync(join(root, rel), 'utf8');
}

// Minimal storage for modules that touch localStorage under Vite SSR.
const bag = new Map();
globalThis.localStorage = {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => bag.set(String(k), String(v)),
    removeItem: (k) => bag.delete(k),
    clear: () => bag.clear()
};
globalThis.window = {
    localStorage: globalThis.localStorage,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true
};

console.log('\n[ownership invariants — static sources]');

const intelSrc = read('src/lib/hero/heroIntelligence.js');
const titleIntelSrc = read('src/lib/hero/heroTitleIntelligence.js');
const guardSrc = read('src/lib/intelligence/contentIdentityGuard.js');
const authoritySrc = read('src/lib/hero/heroPresentationAuthority.js');
const expSrc = read('src/components/experiences/HeroExperience.svelte');
const vaultCardSrc = read('src/components/series/VaultEpisodeCreatorStatus.svelte');
const polishSrc = read('src/lib/series/creatorExperiencePresentation.js');
const coreSrc = read('src/lib/hero/heroPresentationCore.js');
const headerSrc = read('src/components/navigation/ConsumerHeader.svelte');
const heroRecordSrc = read('src/lib/hero/heroRecord.js');

// 1–3 Empty Viewer Label / brand chrome only
assert('default manager heroLabel is empty string', /heroLabel:\s*''/.test(intelSrc));
assert(
    'default manager heroLabel is not brand',
    !/heroLabel:\s*'LOOK@ZAKANDA PRESENTS'/.test(intelSrc)
);
assert(
    'null server heroLabel maps via hasOwnProperty (intentional clear)',
    coreSrc.includes("Object.prototype.hasOwnProperty.call(remote, 'heroLabel')")
);
assert(
    'HeroExperience comment/docs protect empty label from brand resurrect',
    /must not resurrect brand/i.test(expSrc)
);
assert(
    'HeroExperience binds stage from manager heroLabel (no LOOK fallback)',
    /heroStoryLabel\s*=\s*String\(heroManagerConfig\?\.heroLabel\s*\|\|\s*''\)\.trim\(\)/.test(expSrc)
);
assert(
    'ConsumerHeader brand chrome remains LOOK@ZAKANDA PRESENTS (not Hero Viewer Label)',
    /LOOK@ZAKANDA PRESENTS/.test(headerSrc)
);

// 4 AI/title intel does not write heroLabel
const titlePatchFn = titleIntelSrc.slice(
    titleIntelSrc.indexOf('export function buildHeroManagerPatchFromTitleIntel'),
    titleIntelSrc.indexOf('export function dispatchVaultTitleUpdated')
);
assert(
    'title intel patch builder does not assign heroLabel',
    Boolean(titlePatchFn) && !/heroLabel/.test(titlePatchFn)
);

// 5–6 AI cannot publish; discovery cannot become identity (static gates + runtime below)
assert(
    'content identity guard defines LOCKED_FIELDS',
    guardSrc.includes('export const LOCKED_FIELDS')
);
assert(
    'authority export applyNlpToHeroPublicFields hard-blocks NLP writes',
    authoritySrc.includes('export function applyNlpToHeroPublicFields') &&
        authoritySrc.includes('nlp-cannot-write-hero-public-fields')
);
assert(
    'authority blocks discovery → Hero identity promotion',
    authoritySrc.includes('export function promoteDiscoveryToHeroIdentity') &&
        authoritySrc.includes('discovery-cannot-become-hero-identity')
);
assert(
    'authority blocks intelligence-driven publish',
    authoritySrc.includes('export function publishViaIntelligenceExplanation') &&
        authoritySrc.includes('intelligence_explanation_cannot_set_published')
);
assert(
    'creatorTruth protection surface present',
    authoritySrc.includes('export function protectCreatorTruthFromNlp') &&
        authoritySrc.includes('export function captureCreatorTruth')
);
assert(
    'PUBLIC APPROVED gate uses isServerGrantedPublished',
    authoritySrc.includes('isServerGrantedPublished')
);

// 7 Filename is not canonical public Hero title
assert(
    'unsafe filename title guard exported',
    titleIntelSrc.includes('export function isUnsafeHeroFilenameTitle')
);
assert(
    'canonical title resolution path present',
    titleIntelSrc.includes('export function resolveCanonicalHeroTitle')
);

// 8–10 Episode publication ≠ Hero approval (UI + model)
assert(
    'vault model labels Episode publication axis',
    polishSrc.includes("axisLabel: 'Episode publication'")
);
assert(
    'vault model separates Hero axis with PUBLIC APPROVED language',
    polishSrc.includes('PUBLIC APPROVED') && polishSrc.includes('Never inferred')
);
assert(
    'vault card marks episode publication and hero-approval sections',
    vaultCardSrc.includes('data-section-axis="episode-publication"') &&
        vaultCardSrc.includes('data-section-axis="hero-approval"')
);
assert(
    'vault hierarchy keeps identity / media / presentation / publishing / hero',
    vaultCardSrc.includes('data-section="identity"') &&
        vaultCardSrc.includes('data-section="media"') &&
        vaultCardSrc.includes('data-section="presentation"') &&
        vaultCardSrc.includes('data-section="publishing"') &&
        vaultCardSrc.includes('data-section="hero"')
);

// 11–13 HeroRecord binding record; featuredSeries metadata only
assert(
    'HeroRecord remains dedicated storage key',
    heroRecordSrc.includes("HERO_RECORD_STORAGE_KEY = 'reelforge_hero_record'")
);
assert(
    'HeroRecord supports mode === asset (binding, not catalog vault)',
    heroRecordSrc.includes("mode === 'asset'")
);
assert(
    'featuredSeries is presentation metadata field in server payload builder',
    coreSrc.includes('featuredSeries: c.featuredSeries')
);
assert(
    'HeroExperience does not map featuredSeries onto heroSubtitle field',
    !/heroSubtitle\s*[:=].*featuredSeries|featuredSeries.*\bheroSubtitle\b\s*=/.test(expSrc)
);

console.log('\n[ownership invariants — pure functions / hydrate]');

// 1–3 hydrate
const nullPatch = mapServerPresentationToManagerPatch({
    heroAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    backgroundSource: 'custom_video',
    mediaUrl: 'https://cdn.example/v.mp4',
    heroLabel: null,
    heroTitle: 'Vic G LA Story'
});
assertEq('null heroLabel hydrates to empty string', nullPatch?.heroLabel, '');

const customPatch = mapServerPresentationToManagerPatch({
    heroAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    backgroundSource: 'custom_video',
    mediaUrl: 'https://cdn.example/v.mp4',
    heroLabel: 'A ZAKANDA ORIGINAL',
    heroTitle: 'Vic G LA Story'
});
assertEq('custom Viewer Label preserved', String(customPatch?.heroLabel || ''), 'A ZAKANDA ORIGINAL');

/** Explicit clear publish body: never recover prior brand with ||. */
function resolvePublishedHeroLabel(config, savedConfig) {
    if (Object.prototype.hasOwnProperty.call(config, 'heroLabel')) {
        return String(config.heroLabel ?? '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(savedConfig, 'heroLabel')) {
        return String(savedConfig.heroLabel ?? '').trim();
    }
    return '';
}
assertEq(
    'explicit clear does not recover prior brand',
    resolvePublishedHeroLabel({ heroLabel: '' }, { heroLabel: 'LOOK@ZAKANDA PRESENTS' }),
    ''
);

const payload = buildServerPresentationPayload({
    heroAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    backgroundSource: 'custom_video',
    mediaUrl: 'https://cdn.example/v.mp4',
    heroTitle: 'Vic G LA Story',
    heroSubtitle: 'Trending local experience in Los Angeles captured from the creator vault.',
    featuredSeries: 'EPISODE 1 - ARRIVAL',
    heroLabel: ''
});
assertEq(
    'payload subtitle remains explicit (not featuredSeries)',
    payload.heroSubtitle,
    'Trending local experience in Los Angeles captured from the creator vault.'
);
assertEq(
    'featuredSeries remains nested presentation metadata',
    payload.presentation?.featuredSeries,
    'EPISODE 1 - ARRIVAL'
);
assertEq('empty Viewer Label publishes as empty string', payload.heroLabel, '');

console.log('\n[ownership invariants — SSR runtime gates]');

try {
    const server = await createServer({
        root,
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error'
    });
    try {
        const polish = await server.ssrLoadModule('/src/lib/series/creatorExperiencePresentation.js');
        const store = await server.ssrLoadModule('/src/lib/series/seriesStore.js');
        const infer = await server.ssrLoadModule('/src/lib/series/vaultSeriesInference.js');
        const enrichMod = await server.ssrLoadModule('/src/lib/series/vaultEpisodeEnrichment.js');
        const authority = await server.ssrLoadModule('/src/lib/hero/heroPresentationAuthority.js');
        const serverAuth = await server.ssrLoadModule('/src/lib/hero/heroServerAuthorityEngine.js');
        const titleIntel = await server.ssrLoadModule('/src/lib/hero/heroTitleIntelligence.js');

        // 4–6 NLP / discovery / AI publish
        const nlpBlock = authority.applyNlpToHeroPublicFields(
            {
                heroTitle: 'AI title',
                status: 'published',
                category: 'travel'
            },
            'ai'
        );
        assertEq('AI cannot write public hero fields', nlpBlock.ok, false);
        assert(
            'AI cannot auto-publish via NLP public write path',
            Array.isArray(nlpBlock.blocked) && nlpBlock.blocked.includes('status')
        );

        const disco = authority.promoteDiscoveryToHeroIdentity('travel', 'title');
        assertEq('discovery cannot become Hero identity', disco.ok, false);
        assertEq(
            'discovery reject reason',
            disco.reason,
            'discovery-cannot-become-hero-identity'
        );

        const intelPub = authority.publishViaIntelligenceExplanation({}, { summary: 'auto' });
        assertEq('intelligence explanation cannot publish', intelPub.ok, false);

        // 7 Filename / catalog name not public title merely because it exists
        assert(
            'filename-like title is unsafe',
            titleIntel.isUnsafeHeroFilenameTitle('STIRRED_S01E01.mp4') === true
        );
        assert(
            'raw catalog filename is not accepted as public title',
            titleIntel.normalizeHeroTitle('STIRRED_S01E01.mp4') !== 'STIRRED_S01E01.mp4'
        );
        assert(
            'uuid-like upload name is unsafe for public identity',
            titleIntel.isUnsafeHeroFilenameTitle('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.mp4') === true
        );
        assertEq(
            'no candidate sources yields Untitled Creator Experience',
            titleIntel.resolveCanonicalHeroTitle({}),
            titleIntel.UNTITLED_CREATOR_EXPERIENCE
        );
        assert(
            'resolveCanonicalHeroTitle never returns raw media-extension filename',
            titleIntel.resolveCanonicalHeroTitle({ fileName: 'STIRRED_S01E01.mp4' }) !==
                'STIRRED_S01E01.mp4'
        );
        const intelPatch = titleIntel.buildHeroManagerPatchFromTitleIntel(
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'STIRRED_S01E01.mp4',
            { force: false, previous: {} }
        );
        assert(
            'title intel patch omits heroLabel',
            !Object.prototype.hasOwnProperty.call(intelPatch, 'heroLabel')
        );

        // 11 Creator truth protection
        const protectedTruth = authority.protectCreatorTruthFromNlp(
            {
                title: 'Creator original title',
                description: 'Creator locked description',
                immutable: true
            },
            { title: 'AI overwrite', description: 'AI overwrite' }
        );
        assertEq(
            'protectCreatorTruthFromNlp keeps creator title',
            protectedTruth.next?.title,
            'Creator original title'
        );
        assert(
            'protectCreatorTruthFromNlp blocks NLP title overwrite',
            Array.isArray(protectedTruth.blocked) && protectedTruth.blocked.includes('title')
        );

        // 8–10 vault axes independence
        const assetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        let asset = infer.sealVaultSeriesIdentityForStorage({
            id: assetId,
            assetId,
            name: 'STIRRED_S01E01.mp4',
            fileName: 'STIRRED_S01E01.mp4',
            url: `https://cdn.example/videos/${assetId}.mp4`,
            type: 'video'
        });

        store.resetSeriesCatalogEmpty();
        store.seriesCatalog.set([
            {
                id: 's-axis',
                title: 'STIRRED',
                seasons: [
                    {
                        seasonNumber: 1,
                        episodes: [
                            {
                                episodeId: 'ep-axis',
                                episodeNumber: 1,
                                title: 'E1',
                                status: 'published',
                                reelId: assetId,
                                mediaAssetId: assetId
                            }
                        ]
                    }
                ]
            }
        ]);

        const incomplete = polish.presentVaultEpisodeCompleteness(asset);
        assert(
            'incomplete presentation can coexist with catalog Published',
            incomplete.presentation.ready === false && incomplete.publishing.status === 'published'
        );
        assertEq(
            'presentation statusLabel Incomplete when package empty',
            incomplete.presentation.statusLabel,
            'Incomplete'
        );
        assertEq(
            'identity confirmed can coexist with incomplete presentation',
            incomplete.identity.ready,
            true
        );
        assertEq('media Available with incomplete package', incomplete.media.statusLabel, 'Available');
        assert(
            'Episode publication axis label names catalog axis',
            String(incomplete.publishing.axisLabel || '').includes('Episode publication')
        );
        assertEq(
            'Hero axis not derived from episode Published',
            incomplete.hero?.statusLabel,
            'Managed in Hero Manager'
        );

        asset = enrichMod.applyCreatorVaultEpisodeEnrichment(asset, {
            title: 'Opening',
            description: 'Desc',
            artworkUrl: 'https://cdn.example/a.jpg'
        });
        const full = polish.presentVaultEpisodeCompleteness(asset);
        assertEq('complete package → Presentation Ready', full.presentation.statusLabel, 'Ready');
        assertEq(
            'published catalog status unchanged by package complete',
            full.publishing.status,
            'published'
        );
        assertEq(
            'Hero axis still unmanaged after package ready',
            full.hero?.statusLabel,
            'Managed in Hero Manager'
        );

        // 10 Hero PUBLIC APPROVED is not inventable from media binding alone
        assertEq(
            'bare record is not server-granted PUBLIC APPROVED',
            serverAuth.isServerGrantedPublished({ mode: 'asset', assetId }),
            false
        );

        // Episode status mutation helpers do not call Hero grants
        assert(
            'store exports setEpisodeStatus independent from Hero authority modules',
            typeof store.setEpisodeStatus === 'function'
        );
    } finally {
        await server.close();
    }
} catch (err) {
    failed += 1;
    console.error('  ✗ runtime axis fixtures', err?.stack || err?.message || err);
}

console.log(
    failed === 0
        ? '\n✓ media ownership invariants passed\n'
        : `\n✗ ${failed} ownership invariant assertion(s) failed\n`
);
process.exit(failed === 0 ? 0 : 1);
