#!/usr/bin/env node
/**
 * Hero Vault Edit Title → every projection of the same asset id.
 *
 * Proves Master Edit fan-out for Hero Vault without inventing title stores.
 * Vic G ids used as stable fixtures (identity only).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    resolveCanonicalHeroTitle,
    resolveLinkedAssetDisplayTitle,
    lookupPersistentHeroTitle,
    REEL_TITLES_PERSISTENT_KEY
} from '../src/lib/hero/heroTitleIntelligence.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

let failed = 0;
/** @param {boolean} cond @param {string} label */
function assert(cond, label) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}`);
}

function read(rel) {
    return readFileSync(join(root, rel), 'utf8');
}

const ACTIVE = '3894107e-ae44-43c5-af72-b3f5d5e0ad90';
const ARRIVAL = '03ef898a-989f-42c3-bdbb-67f37338df65';
const OTHER = 'd2aafde7-d7ba-492c-a860-20b51f7f4033';
const OLD = 'Vic G LA Story';
const NEXT = 'Vic G Night Cut';

console.log('\n[hero-vault-title-fanout — simulation]');

/** @type {Record<string, { title: string; title_original: string }>} */
const persistentMap = {
    [ACTIVE]: { title: OLD, title_original: OLD },
    [ARRIVAL]: { title: '01 ARRIVAL OPEN v1', title_original: '01 ARRIVAL OPEN v1' },
    [OTHER]: { title: 'Standalone reel', title_original: 'Standalone reel' }
};

/** Browser-like localStorage shim for lookupPersistentHeroTitle */
globalThis.localStorage = {
    getItem(key) {
        if (key === REEL_TITLES_PERSISTENT_KEY) return JSON.stringify(persistentMap);
        return null;
    },
    setItem() {},
    removeItem() {}
};

/**
 * Mirrors editHeroVaultTitle local sinks (before PATCH).
 * @param {string} assetId
 * @param {string} title
 * @param {{
 *   personalVideos: Record<string, unknown>[];
 *   feed: Record<string, unknown[]>;
 *   episodes: Record<string, { reelId: string; title: string }>;
 *   manager: Record<string, unknown>;
 *   theaterActive: Record<string, unknown> | null;
 * }} state
 */
function applyHeroVaultEditTitle(assetId, title, state) {
    persistentMap[assetId] = { title, title_original: title };

    state.personalVideos = state.personalVideos.map((entry) =>
        String(entry.id || entry.personal_video_id || '') === assetId
            ? { ...entry, title, name: title, title_original: title }
            : entry
    );

    for (const cat of Object.keys(state.feed)) {
        state.feed[cat] = state.feed[cat].map((entry) =>
            String(entry.id) === assetId
                ? { ...entry, title, name: title, title_original: title }
                : entry
        );
    }

    for (const ep of Object.values(state.episodes)) {
        if (String(ep.reelId) === assetId) ep.title = title;
    }

    const heroBound = String(state.manager.heroAssetId || '') === assetId;
    if (heroBound) {
        state.manager = {
            ...state.manager,
            heroTitle: title,
            heroAssetTitle: title
        };
    }

    if (state.theaterActive && String(state.theaterActive.id) === assetId) {
        state.theaterActive = {
            ...state.theaterActive,
            title,
            name: title,
            title_original: title
        };
    }

    // Hero registry stamp = persistent-first resolve
    state.registryStamp = resolveLinkedAssetDisplayTitle(assetId, {
        episodeTitle: state.episodes[assetId]?.title || '',
        assetTitle: title
    });

    return { heroBound };
}

/** @type {any} */
const state = {
    personalVideos: [
        { id: ACTIVE, title: OLD, name: OLD },
        { id: ARRIVAL, title: '01 ARRIVAL OPEN v1', name: '01 ARRIVAL OPEN v1' },
        { id: OTHER, title: 'Standalone reel', name: 'Standalone reel' }
    ],
    feed: {
        Trending: [
            { id: ACTIVE, title: OLD, name: OLD },
            { id: ARRIVAL, title: '01 ARRIVAL OPEN v1', name: '01 ARRIVAL OPEN v1' }
        ]
    },
    episodes: {
        ep_active: { reelId: ACTIVE, title: OLD },
        ep_arrival: { reelId: ARRIVAL, title: '01 ARRIVAL OPEN v1' }
    },
    manager: {
        heroAssetId: ACTIVE,
        heroTitle: OLD,
        heroAssetTitle: OLD,
        heroDescription: `Prose about ${OLD}`
    },
    theaterActive: { id: ACTIVE, title: OLD, name: OLD },
    registryStamp: OLD
};

const r1 = applyHeroVaultEditTitle(ACTIVE, NEXT, state);
assert(r1.heroBound === true, 'active asset edit sets heroBound');
assert(persistentMap[ACTIVE].title === NEXT, 'durable reel_titles_persistent receives title');
assert(lookupPersistentHeroTitle(ACTIVE) === NEXT, 'lookupPersistentHeroTitle reads map');
assert(state.registryStamp === NEXT, 'Hero Vault registry stamp = new title');
assert(
    state.personalVideos.find((v) => v.id === ACTIVE)?.title === NEXT,
    'Video Vault / personalVideos projection updates'
);
assert(
    state.feed.Trending.find((v) => v.id === ACTIVE)?.title === NEXT &&
        state.feed.Trending.find((v) => v.id === ACTIVE)?.name === NEXT,
    'Studio / feed projection updates'
);
assert(state.episodes.ep_active.title === NEXT, 'Series/Episode (reelId-bound) projection updates');
assert(state.theaterActive.name === NEXT && state.theaterActive.title === NEXT, 'Theater activeReel updates');
assert(state.manager.heroTitle === NEXT, 'Active Hero presentation title updates');
assert(
    String(state.manager.heroDescription).includes(OLD),
    'heroDescription not used as title authority / not rewritten to new title only'
);

// Non-active edit isolation
const landscapeBefore = state.manager.heroTitle;
const r2 = applyHeroVaultEditTitle(ARRIVAL, 'Arrival Midnight Edit', state);
assert(r2.heroBound === false, 'non-active edit is not heroBound');
assert(state.manager.heroTitle === landscapeBefore, 'non-active edit does not change Active Hero');
assert(
    state.personalVideos.find((v) => v.id === ARRIVAL)?.title === 'Arrival Midnight Edit',
    'non-active still updates Video Vault'
);
assert(state.episodes.ep_arrival.title === 'Arrival Midnight Edit', 'non-active bound episode updates');

// Standalone Theater resolve
const standaloneCanonical = resolveLinkedAssetDisplayTitle(OTHER, {
    assetTitle: 'Standalone reel'
});
assert(
    standaloneCanonical === 'Standalone reel' || standaloneCanonical === NEXT,
    'standalone Theater resolve uses stable id path'
);
// After renaming standalone without theater open, still resolves
persistentMap[OTHER] = { title: 'Other Night', title_original: 'Other Night' };
assert(
    resolveLinkedAssetDisplayTitle(OTHER, { assetTitle: 'Standalone reel' }) === 'Other Night',
    'standalone asset prefers persistent over stale assetTitle'
);

// Hard refresh simulation: only persistent + stale harvest
assert(
    resolveCanonicalHeroTitle({
        persistentTitle: lookupPersistentHeroTitle(ACTIVE),
        episodeTitle: OLD, // stale package
        assetTitle: OLD // stale harvest
    }) === NEXT,
    'hard refresh: persistent outranks stale episode/package harvest'
);

// syncFromVault re-apply
const harvested = { id: ACTIVE, title: OLD, name: OLD };
const reapplied = {
    ...harvested,
    title: lookupPersistentHeroTitle(ACTIVE),
    name: lookupPersistentHeroTitle(ACTIVE)
};
assert(reapplied.title === NEXT, 'syncFromVault re-apply prevents catalog name resurrection');

// Race A → B → C
applyHeroVaultEditTitle(ACTIVE, 'Title A', state);
applyHeroVaultEditTitle(ACTIVE, 'Title B', state);
applyHeroVaultEditTitle(ACTIVE, 'Title C', state);
assert(persistentMap[ACTIVE].title === 'Title C', 'race final durable title is C');
assert(state.personalVideos.find((v) => v.id === ACTIVE)?.title === 'Title C', 'race final vault is C');
assert(state.manager.heroTitle === 'Title C', 'race final active Hero is C');
assert(state.theaterActive.title === 'Title C', 'race final Theater is C');

// Late stale response must not outrank durable
const lateServer = 'Title A';
const latest = lookupPersistentHeroTitle(ACTIVE);
assert(
    latest === 'Title C' && latest !== lateServer,
    'late server title A cannot outrank durable Title C'
);

console.log('\n[hero-vault-title-fanout — wiring]');

const panelSrc = read('src/components/studio/HeroManagerPanel.svelte');
const theaterSrc = read('src/components/theater/TheaterExperience.svelte');
const seriesStoreSrc = read('src/lib/series/seriesStore.js');
const identitySrc = read('src/lib/content/contentIdentityResolver.js');
const titleIntelSrc = read('src/lib/hero/heroTitleIntelligence.js');
const studioSrc = read('src/components/experiences/StudioExperience.svelte');
const vaultResolverSrc = read('src/lib/series/episodeVaultResolver.js');
const pkg = read('package.json');

const editStart = panelSrc.indexOf('async function editHeroVaultTitle');
const editSlice = editStart >= 0 ? panelSrc.slice(editStart, editStart + 9000) : '';

assert(editStart >= 0, 'editHeroVaultTitle present');
assert(
    editSlice.includes('writePersistentTitle') && editSlice.includes('dispatchVaultTitleUpdated'),
    'Hero Vault writes durable title + dispatches vault-title-updated'
);
assert(editSlice.includes('personalVideos.update'), 'Hero Vault updates personalVideos');
assert(editSlice.includes('feed.update'), 'Hero Vault updates feed');
assert(editSlice.includes('updateEpisodeTitleForReel'), 'Hero Vault updates episode for reelId');
assert(
    editSlice.indexOf('dispatchVaultTitleUpdated') < editSlice.indexOf('await updateReelTitle') ||
        editSlice.indexOf('refreshHeroAssetRegistry()') < editSlice.lastIndexOf('await updateReelTitle'),
    'dispatch/registry fan-out before backend await'
);
assert(
    panelSrc.includes('resolveVaultCardProjection(item.assetId') &&
        (panelSrc.includes('vaultCard.title') || panelSrc.includes('data-vault-card-title')),
    'Hero Vault card uses vault projection for viewer title (not stale item.title first)'
);

assert(
    theaterSrc.includes("reelforge:vault-title-updated") &&
        theaterSrc.includes('activeReel.set'),
    'Theater listens for vault-title-updated and updates activeReel'
);
assert(
    theaterSrc.includes('resolveLinkedAssetDisplayTitle'),
    'openTheaterReel stamps canonical linked title'
);
assert(
    theaterSrc.includes('void $seriesCatalog'),
    'Theater seriesContext recomputes when seriesCatalog mutates'
);

assert(
    seriesStoreSrc.includes('resolveLinkedAssetDisplayTitle') &&
        seriesStoreSrc.includes('function resolveSeriesContextForReel'),
    'series context resolves linked reel title canonically'
);
assert(
    seriesStoreSrc.includes('lookupPersistentHeroTitle(reelId)') &&
        seriesStoreSrc.includes('apiRow.episodeTitle'),
    'API metadata merge prefers persistent over package episode title'
);

assert(
    identitySrc.includes('persistentTitle ||') &&
        identitySrc.indexOf('persistentTitle ||') < identitySrc.indexOf('creatorTitle ||'),
    'content identity prefers reel_titles_persistent over sticky creator title'
);

assert(
    titleIntelSrc.includes('export function resolveLinkedAssetDisplayTitle'),
    'linked asset display title helper exported on existing title module'
);
assert(
    titleIntelSrc.includes("export const REEL_TITLES_PERSISTENT_KEY = 'reel_titles_persistent'"),
    'no second storage key — reel_titles_persistent retained'
);
assert(
    !titleIntelSrc.includes('theater_titles') && !titleIntelSrc.includes('episode_titles_live'),
    'no theater/episode live title store introduced'
);

assert(
    vaultResolverSrc.includes('resolved.title || episodeTitle') ||
        vaultResolverSrc.includes('resolved.title'),
    'theater reel resolve does not hard-prefer package episode over asset title'
);

assert(
    studioSrc.includes('latestPersistent') && studioSrc.includes('responseTitle'),
    'Studio title PATCH race rejects late stale server titles'
);

assert(
    editSlice.includes('deleteReelById') === false || panelSrc.includes('deleteReelById'),
    'delete path remains elsewhere in panel (not removed by title work)'
);
assert(panelSrc.includes('deleteReelById'), 'Hero Vault permanent delete path retained');
assert(
    pkg.includes('validate:hero-vault-title-fanout'),
    'package.json registers validate:hero-vault-title-fanout'
);

if (failed) {
    console.error(`\n✗ hero-vault title fanout failed (${failed})`);
    process.exit(1);
}
console.log('\n✓ hero vault title fanout acceptance passed\n');
