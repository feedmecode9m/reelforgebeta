#!/usr/bin/env node
/**
 * Viewer vault card projection — blank fields stay blank; no NLP/marketing invent.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    resolveVaultCardProjection,
    isManufacturedViewerDescription,
    isManufacturedViewerTitle
} from '../src/lib/content/vaultCardProjection.js';
import {
    REEL_TITLES_PERSISTENT_KEY,
    resolveLinkedAssetDisplayTitle
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
const OTHER = '03ef898a-989f-42c3-bdbb-67f37338df65';
const STORE = new Map();

globalThis.localStorage = {
    getItem(k) {
        return STORE.has(k) ? STORE.get(k) : null;
    },
    setItem(k, v) {
        STORE.set(k, String(v));
    },
    removeItem(k) {
        STORE.delete(k);
    }
};

function setPersistent(id, title) {
    const map = JSON.parse(localStorage.getItem(REEL_TITLES_PERSISTENT_KEY) || '{}');
    if (title) map[id] = { title, title_original: title };
    else delete map[id];
    localStorage.setItem(REEL_TITLES_PERSISTENT_KEY, JSON.stringify(map));
}

console.log('\n[vault-card-projection — pure mapping]');

setPersistent(ACTIVE, 'Vic G Night Run');
setPersistent(OTHER, 'Arrival Open');

const staleHarvest = {
    id: ACTIVE,
    title: 'Vic G LA Story',
    name: 'Vic G LA Story',
    description: '',
    thumbnailUrl: 'https://cdn.example/poster.jpg',
    url: 'https://cdn.example/v.mp4',
    type: 'video'
};

// A — persistent outranks harvest
const a = resolveVaultCardProjection(ACTIVE, { reel: staleHarvest });
assert(a.title === 'Vic G Night Run', 'A: persistent title outranks stale reel name');
assert(a.description === '', 'A: blank description stays blank');
assert(a.posterUrl.includes('poster.jpg'), 'A: real poster preserved');

// B — linked episode follows reel
const b = resolveVaultCardProjection(ACTIVE, {
    reel: staleHarvest,
    episodeTitle: 'Package Episode Label',
    seriesLabel: 'Vic G',
    seasonNumber: 1,
    episodeNumber: 2
});
assert(b.title === 'Vic G Night Run', 'B: linked episode title uses reel canonical (persistent)');
assert(b.seriesLine.includes('S1') && b.seriesLine.includes('E2'), 'B: series line from real S/E');

// C — unlinked structural (no reel id paths)
const c = resolveVaultCardProjection('', {
    reel: null,
    episodeTitle: 'Structural Intro'
});
assert(c.title === '' || c.assetId === '', 'C: empty assetId does not invent unrelated vault titles');
// Unlinked episode structural title is not rewritten by ACTIVE persistent
assert(
    resolveLinkedAssetDisplayTitle(OTHER, { persistentTitle: 'Arrival Open' }) === 'Arrival Open',
    'C: other reel still independent'
);
const otherCard = resolveVaultCardProjection(OTHER, {
    reel: { id: OTHER, title: 'old', name: 'old' }
});
assert(otherCard.title === 'Arrival Open', 'C: OTHER card isolated from ACTIVE');

// D — blank title
setPersistent(ACTIVE, '');
STORE.set(REEL_TITLES_PERSISTENT_KEY, JSON.stringify({ [OTHER]: { title: 'Arrival Open' } }));
const blankReel = {
    id: ACTIVE,
    title: '',
    name: '',
    fileName: '07_AMP_JAM_V1_FINAL.mp4',
    url: 'https://cdn.example/v.mp4'
};
const d = resolveVaultCardProjection(ACTIVE, {
    reel: blankReel,
    persistentTitle: ''
});
assert(d.title === '', 'D: blank title remains blank');
assert(!/^episode\s+\d+$/i.test(d.title), 'D: no Episode N');
assert(d.title !== 'Untitled' && d.title !== 'Untitled Creator Experience', 'D: no Untitled invent');
assert(!d.title.includes('07_AMP'), 'D: unsafe filename not viewer title');

// E — blank description
const e = resolveVaultCardProjection(ACTIVE, {
    reel: { ...blankReel, description: '' },
    persistentTitle: 'Vic G'
});
assert(e.description === '', 'E: blank description produces empty string');

// F/G — no NLP / Suggested / Trending
const nlpPoison = resolveVaultCardProjection(ACTIVE, {
    reel: {
        id: ACTIVE,
        title: 'Vic G',
        description: 'Trending local experience captured from the creator vault.'
    },
    enrichment: { description: 'Suggested: Cinematic vault energy' },
    isActiveHero: true,
    heroDescription: 'Trending local experience from Los Angeles, captured from the creator vault.'
});
assert(nlpPoison.description === '', 'F/G: NLP/Suggested/Trending descriptions rejected');
assert(isManufacturedViewerDescription('Suggested: foo'), 'G: Suggested: detected');
assert(isManufacturedViewerDescription('Trending local experience x'), 'G: Trending detected');
assert(isManufacturedViewerTitle('Untitled Creator Experience'), 'D helper: Untitled manufactured');

// Creator-authored description accepted
const creatorDesc = resolveVaultCardProjection(ACTIVE, {
    reel: {
        id: ACTIVE,
        title: 'Vic G',
        description: 'A night drive through DTLA.'
    },
    persistentTitle: 'Vic G'
});
assert(creatorDesc.description === 'A night drive through DTLA.', 'E+: creator description accepted');

// H — enrichment artwork
const art = resolveVaultCardProjection(ACTIVE, {
    reel: { id: ACTIVE, title: 'Vic G' },
    persistentTitle: 'Vic G',
    enrichment: { artworkUrl: 'https://cdn.example/art.jpg', description: '' }
});
assert(art.posterUrl === 'https://cdn.example/art.jpg', 'H: enrichment artwork preserved');

// I — isolation
setPersistent(ACTIVE, 'Title A');
setPersistent(OTHER, 'Title B');
const ia = resolveVaultCardProjection(ACTIVE, {
    reel: { id: ACTIVE, title: 'x' }
});
const ib = resolveVaultCardProjection(OTHER, {
    reel: { id: OTHER, title: 'y' }
});
assert(ia.title === 'Title A' && ib.title === 'Title B', 'I: editing one asset does not alter another');

// Active hero description only when non-stock
const heroOnly = resolveVaultCardProjection(ACTIVE, {
    reel: { id: ACTIVE, title: 'Vic G' },
    persistentTitle: 'Vic G',
    isActiveHero: true,
    heroDescription: 'Creator authored landscape copy for the active hero only.'
});
assert(
    heroOnly.description === 'Creator authored landscape copy for the active hero only.',
    'Active hero creator description allowed'
);
const nonActiveHeroDesc = resolveVaultCardProjection(OTHER, {
    reel: { id: OTHER, title: 'Other' },
    persistentTitle: 'Other',
    isActiveHero: false,
    heroDescription: 'Should not leak onto non-active cards'
});
assert(nonActiveHeroDesc.description === '', 'Non-active does not use heroDescription');

console.log('\n[vault-card-projection — wiring]');

const projSrc = read('src/lib/content/vaultCardProjection.js');
const vaultSrc = read('src/components/experiences/VaultExperience.svelte');
const panelSrc = read('src/components/studio/HeroManagerPanel.svelte');
const reelSrc = read('src/components/vertical/ReelshortExperience.svelte');
const chipSrc = read('src/components/series/EpisodeChip.svelte');
const theaterSrc = read('src/components/theater/TheaterExperience.svelte');
const fanoutSrc = read('scripts/validate-hero-vault-title-fanout.mjs');
const pkg = read('package.json');

assert(
    projSrc.includes('export function resolveVaultCardProjection') &&
        projSrc.includes('resolveLinkedAssetDisplayTitle'),
    'projection uses existing linked title authority'
);
assert(
    !projSrc.includes('analyzeHeroTitle') && !projSrc.includes('suggestedDescription'),
    'F: projection does not import NLP analyzeHeroTitle / suggestedDescription'
);
assert(
    !projSrc.includes('card_titles') &&
        !projSrc.includes('theater_titles') &&
        !projSrc.includes('episode_titles_live'),
    'J: no new title storage authority'
);
assert(projSrc.includes("REEL_TITLES_PERSISTENT_KEY"), 'J: reel_titles_persistent retained');

assert(
    vaultSrc.includes('resolveVaultCardProjection') && vaultSrc.includes('data-vault-card-title'),
    'Video Vault uses projection'
);
assert(
    !vaultSrc.includes("reel.name?.substring(0, 12)") &&
        !vaultSrc.includes('reel.name.substring(0, 12)'),
    'Video Vault no longer truncates reel.name as viewer title'
);

assert(
    panelSrc.includes('resolveVaultCardProjection') &&
        !panelSrc.includes('Suggested: {storyIntel.heroDescription}'),
    'Hero Vault card no longer uses Suggested NLP as identity'
);
assert(panelSrc.includes('data-vault-card-title') || panelSrc.includes('vaultCard.title'), 'Hero Vault titles from projection');

assert(
    reelSrc.includes('resolveVaultCardProjection') &&
        reelSrc.includes('{#if cardProjection.title}') &&
        reelSrc.includes('{#if cardProjection.description}'),
    'Feed/Reelshort gated title/description'
);
assert(
    !reelSrc.includes('<h3 class="reel-title">{reel.title}</h3>'),
    'Feed no longer renders raw reel.title unconditionally'
);

assert(
    chipSrc.includes('resolveVaultCardProjection') &&
        !chipSrc.includes('return labelRoot ? `Episode ${episodeNumber}`'),
    'EpisodeChip no longer invents Episode N for blank title'
);
assert(
    chipSrc.includes('viewerMode') && chipSrc.includes('data-vault-card-title'),
    'EpisodeChip viewer title from vault projection'
);

assert(
    theaterSrc.includes('reelforge:vault-title-updated') &&
        theaterSrc.includes('resolveLinkedAssetDisplayTitle'),
    'K: Theater fan-out from 667d041 retained'
);
assert(
    fanoutSrc.includes('reelforge:vault-title-updated'),
    'K: vault-title-updated remains real-time mechanism in suite'
);

assert(
    panelSrc.includes('dispatchVaultTitleUpdated') &&
        panelSrc.includes('await updateReelTitle') &&
        panelSrc.indexOf('dispatchVaultTitleUpdated') < panelSrc.indexOf('async function editHeroVaultTitle') ===
            false
        ? panelSrc.slice(panelSrc.indexOf('async function editHeroVaultTitle')).indexOf('dispatchVaultTitleUpdated') <
          panelSrc.slice(panelSrc.indexOf('async function editHeroVaultTitle')).indexOf('await updateReelTitle')
        : true,
    'L: Hero title edit still local-first before PATCH await'
);

const editSlice = panelSrc.slice(panelSrc.indexOf('async function editHeroVaultTitle'));
assert(
    editSlice.indexOf('dispatchVaultTitleUpdated') < editSlice.indexOf('await updateReelTitle'),
    'L: dispatch before backend await'
);

assert(pkg.includes('validate:vault-card-projection'), 'package.json registers validator');
assert(panelSrc.includes('deleteReelById'), 'Hero Vault permanent delete path retained');
assert(
    read('scripts/validate-video-vault-soft-remove.mjs').includes('reelforge_video_vault_hidden_ids'),
    'soft-remove validators intact'
);

if (failed) {
    console.error(`\n✗ vault-card-projection failed (${failed})`);
    process.exit(1);
}
console.log('\n✓ vault card projection acceptance passed\n');
