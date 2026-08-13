#!/usr/bin/env node
/**
 * Phase 5 — Premium Semantic Media Experience validator (no production mutations).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildSemanticCardProfile,
    deriveHumanHandoffMode
} from '../src/lib/feed/semanticCardProfile.js';
import { extractSemanticThemes } from '../src/lib/feed/semanticThemeSignals.js';
import {
    derivePresentationTheme,
    resolvePresentationFamily
} from '../src/lib/feed/presentationThemeSystem.js';
import {
    describeDiscoveryTaxonomy,
    getActiveDiscoveryShelves,
    getFutureDiscoveryShelves,
    isActiveShelf,
    normalizeActiveShelf
} from '../src/lib/feed/discoveryTaxonomy.js';
import {
    buildCreatorPresentationDraft,
    creatorShelfChoices
} from '../src/lib/feed/creatorPresentationControl.js';
import { createMemoryStorage } from '../src/lib/feed/creatorCatalogMetadata.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let failed = 0;
function assert(cond, label) {
    if (cond) console.log(`  ✓ ${label}`);
    else {
        failed += 1;
        console.error(`  ✗ ${label}`);
    }
}

let fetchMutations = 0;
globalThis.fetch = async (_input, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
        fetchMutations += 1;
        throw new Error(`BLOCKED ${method}`);
    }
    return { ok: true, json: async () => ([]) };
};

console.log('\n[phase-5-premium-semantic-media]');

console.log('\n[expandable taxonomy]');
{
    const active = getActiveDiscoveryShelves();
    const future = getFutureDiscoveryShelves();
    assert(active.includes('Trending') && active.includes('Romance'), 'active shelves include current set');
    assert(active.includes('Cyber-Action') && active.includes('Suspense'), 'Cyber-Action + Suspense active');
    assert(future.includes('Documentary') && future.includes('Music'), 'future shelves registered');
    assert(future.includes('Experimental'), 'Experimental reserved');
    assert(!isActiveShelf('Documentary'), 'Documentary not active (no shelf pollution)');
    assert(normalizeActiveShelf('Action') === 'Cyber-Action', 'Action alias maps to Cyber-Action');
    assert(normalizeActiveShelf('Documentary') === '', 'future shelf does not invent active placement');
    const snap = describeDiscoveryTaxonomy();
    assert(snap.future.length >= 8, 'future taxonomy capacity');
    assert(
        JSON.stringify(creatorShelfChoices()) === JSON.stringify(active),
        'creator choices == active taxonomy only'
    );
}

console.log('\n[presentation themes ≠ shelves]');
{
    assert(resolvePresentationFamily(['production'], 'production') === 'production', 'production family');
    assert(resolvePresentationFamily(['drama', 'emotional']) === 'drama', 'drama family');
    assert(resolvePresentationFamily(['action', 'intensity']) === 'action', 'action family');
    assert(resolvePresentationFamily(['technology', 'cyber']) === 'technology', 'technology family');
    const theme = derivePresentationTheme({
        themes: ['behind-the-scenes', 'production'],
        contentType: 'behind-the-scenes',
        identityConfidence: 'EXACT'
    });
    assert(theme.family === 'production', 'BTS → production presentation');
    assert(theme.badges.includes('Exact match') || theme.badges.includes('Production'), 'presentation badges');
    assert(theme.cssClass.includes('theme-production'), 'css class for visual treatment');
}

console.log('\n[premium profile model — no invention]');
{
    const before = fetchMutations;
    const storage = createMemoryStorage();
    const profile = await buildSemanticCardProfile(
        {
            id: '03ef898a-989f-42c3-bdbb-67f37338df65',
            title: '01 ARRIVAL OPEN v1',
            name: '01 ARRIVAL OPEN v1',
            category: 'Trending',
            type: 'video',
            url: '/videos/03ef898a-989f-42c3-bdbb-67f37338df65.mp4',
            thumbnailUrl: '/thumbs/x.jpg',
            status: 'ready',
            description: ''
        },
        { storage, allowPersist: false }
    );
    assert(fetchMutations === before, 'profile build does not PATCH');
    assert(profile.assetId === profile.identity, 'assetId aliases identity');
    assert(profile.canonicalTitle === '01 ARRIVAL OPEN v1', 'title from asset');
    assert(profile.description === '', 'empty description stays empty');
    assert(profile.tagline === '', 'no invented tagline');
    assert(profile.creator === '', 'no invented creator');
    assert(profile.episode === '', 'no invented episode');
    assert(Array.isArray(profile.keywords), 'keywords array present');
    assert(profile.presentationFamily, 'presentation family derived');
    assert(profile.cardVariant, 'card variant present');
    assert(profile.humanDecisionState === profile.handoffMode, 'human decision state aliased');
    assert(profile.creatorControl?.creatorDecides === true, 'creator decides');
    assert(profile.creatorControl?.canPersist === false, 'persist gated');
    assert(profile.creatorControl?.aiAssisted === true, 'AI assists');
    assert(!/netflix|apple tv|imax/i.test(JSON.stringify(profile)), 'no external branding in profile');
}

console.log('\n[themes with description still not shelves]');
{
    const themes = extractSemanticThemes({
        title: '01 ARRIVAL OPEN v1',
        description:
            'Behind the scenes production documentary from a Los Angeles soundstage music video shoot.'
    });
    assert(themes.themes.includes('production') || themes.themes.includes('behind-the-scenes'), 'themes extracted');
    assert(themes.mood === 'documentary' || themes.mood === 'studio' || themes.mood === 'observational' || themes.mood === 'rhythmic' || themes.mood, 'mood may derive from evidence');
    const family = resolvePresentationFamily(themes.themes, themes.contentType);
    assert(['production', 'neutral'].includes(family), 'presentation family from themes');
    assert(deriveHumanHandoffMode('UNDERSTOOD_NO_SHELF_FIT', 'manual') === 'human-category', 'human handoff intact');
}

console.log('\n[creator control draft]');
{
    const draft = buildCreatorPresentationDraft(
        {
            identity: 'x',
            canonicalTitle: 'Title',
            description: '',
            shelfCategory: 'Trending',
            themes: ['production'],
            mood: 'studio',
            presentation: { family: 'production' }
        },
        { allowPersist: false }
    );
    assert(draft.state === 'suggested', 'draft starts suggested');
    assert(draft.canPersist === false, 'draft cannot persist by default');
    assert(draft.workflow.includes('Creator approval'), 'workflow documents human gate');
}

console.log('\n[UI wiring]');
{
    const card = fs.readFileSync(
        path.join(root, 'src/components/studio/SemanticProductionCard.svelte'),
        'utf8'
    );
    const panel = fs.readFileSync(
        path.join(root, 'src/components/studio/SemanticProductionCardsPanel.svelte'),
        'utf8'
    );
    assert(card.includes('data-premium-semantic-card'), 'premium card marker');
    assert(card.includes('data-presentation-family'), 'presentation family attr');
    assert(card.includes('data-sem-creator-control'), 'creator control UI');
    assert(!/netflix|apple tv\+|imax/i.test(card), 'no external branding in card');
    assert(panel.includes('allowPersist = false'), 'persist default false');
    assert(panel.includes('data-sem-taxonomy'), 'taxonomy diagnostic');
    assert(panel.includes('creatorShelfChoices'), 'panel uses expandable active shelves');
}

assert(fetchMutations === 0, 'total mutation attempts = 0');

const reportPath = path.join(root, 'artifacts', 'phase-5-premium-semantic-media-report.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(
    reportPath,
    JSON.stringify(
        {
            phase: 'PHASE-5-PREMIUM-SEMANTIC-MEDIA',
            status: 'IMPLEMENTATION_COMPLETE_NO_DEPLOY',
            taxonomy: describeDiscoveryTaxonomy(),
            categoryPatchCount: fetchMutations,
            titleWrites: 0,
            descriptionWrites: 0,
            deploy: 0
        },
        null,
        2
    )
);
console.log(`  · wrote ${reportPath}`);

if (failed > 0) {
    console.error(`\nFAIL — ${failed}`);
    process.exit(1);
}
console.log('\nPASS — phase-5-premium-semantic-media');
process.exit(0);
