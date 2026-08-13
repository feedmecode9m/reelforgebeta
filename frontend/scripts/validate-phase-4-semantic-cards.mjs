#!/usr/bin/env node
/**
 * Phase 4 — semantic card system validator (no production mutations).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { extractSemanticThemes } from '../src/lib/feed/semanticThemeSignals.js';
import {
    buildSemanticCardProfile,
    deriveHumanHandoffMode,
    humanHandoffLabel
} from '../src/lib/feed/semanticCardProfile.js';
import { defaultTitleNlpProvider } from '../src/lib/feed/titleNlpProvider.js';
import { normalizeClassificationMetadata } from '../src/lib/feed/contentClassifier.js';
import { PHASE4_EXACT_MEDIA_IDENTITY } from '../src/lib/feed/identityBackedEditorialReview.js';
import {
    createMemoryStorage,
    loadCreatorCatalogMetadata,
    saveCreatorCatalogMetadata
} from '../src/lib/feed/creatorCatalogMetadata.js';
import { canPersistCategoryForAsset } from '../src/lib/feed/categorySuggestionReview.js';

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

console.log('\n[phase-4-semantic-cards]');

console.log('\n[semantic themes separate from shelf]');
{
    const themes = extractSemanticThemes({
        title: '01 ARRIVAL OPEN v1',
        description:
            'Behind the scenes production documentary from a Los Angeles soundstage music video shoot.',
        tags: ['production'],
        mediaKind: 'video'
    });
    assert(
        themes.themes.includes('behind-the-scenes') || themes.themes.includes('production'),
        'themes from description'
    );
    assert(
        themes.themes.includes('documentary') ||
            themes.contentType === 'documentary' ||
            themes.themes.includes('music') ||
            themes.themes.includes('production'),
        'content semantics present'
    );
    assert(
        themes.locationHints.includes('Los Angeles') || themes.themes.includes('los-angeles'),
        'LA location hint'
    );
}

console.log('\n[NLP classification cases]');
{
    const romance = defaultTitleNlpProvider(
        normalizeClassificationMetadata({
            title: 'Love Me Until Morning',
            description: 'A romantic love story about soulmates kissing under the stars.'
        })
    );
    assert(romance.suggestedCategory === 'Romance', 'title+desc Romance');
    assert(Number(romance.confidence) >= 0.7, 'Romance confidence');

    const weak = defaultTitleNlpProvider(
        normalizeClassificationMetadata({ title: '01 ARRIVAL OPEN v1' })
    );
    assert(weak.suggestedCategory === 'Trending', 'weak title stays Trending suggestion');
    assert(
        ['manual', 'none', 'weak'].includes(String(weak.confidenceBand)),
        'weak/manual band'
    );

    const understood = defaultTitleNlpProvider(
        normalizeClassificationMetadata({
            title: '01 ARRIVAL OPEN v1',
            description:
                'A long-form production diary about building the night club set, camera rehearsals, and crew logistics across the week.'
        })
    );
    assert(understood.suggestedCategory === 'Trending', 'production diary does not force genre shelf');
    assert(
        (understood.signals || []).some((s) => String(s).includes('context-without-shelf-fit')),
        'context-without-shelf-fit signal'
    );
}

console.log('\n[human handoff modes]');
{
    assert(deriveHumanHandoffMode('STRONG_SHELF_MATCH', 'strong') === 'recommend-accept', 'strong → accept');
    assert(deriveHumanHandoffMode('GOOD_SHELF_MATCH', 'good') === 'recommend-review', 'good → review');
    assert(deriveHumanHandoffMode('WEAK_SHELF_MATCH', 'weak') === 'human-review', 'weak → human review');
    assert(
        deriveHumanHandoffMode('UNDERSTOOD_NO_SHELF_FIT', 'manual') === 'human-category',
        'no shelf fit → human category'
    );
    assert(humanHandoffLabel('human-category') === 'Human decision required', 'handoff label');
}

console.log('\n[card profile derivation + safety]');
{
    const before = fetchMutations;
    const storage = createMemoryStorage();
    const id = '03ef898a-989f-42c3-bdbb-67f37338df65';
    const profile = await buildSemanticCardProfile(
        {
            id,
            title: '01 ARRIVAL OPEN v1',
            name: '01 ARRIVAL OPEN v1',
            category: 'Trending',
            type: 'video',
            url: '/videos/03ef898a-989f-42c3-bdbb-67f37338df65.mp4',
            thumbnailUrl: '/thumbs/03ef898a.jpg',
            status: 'ready',
            description: ''
        },
        { storage }
    );
    assert(fetchMutations === before, 'profile build does not PATCH');
    assert(profile.identity === id, 'identity preserved');
    assert(profile.canonicalTitle === '01 ARRIVAL OPEN v1', 'canonical title from asset');
    assert(profile.canAppearAsCard === true, 'real production can appear as card');
    assert(profile.isRealProductionVideo === true, 'real production video');
    assert(profile.isPlaceholder === false, 'not placeholder');
    assert(
        profile.handoffMode === 'human-category' || profile.handoffMode === 'human-review',
        'human handoff when weak'
    );
    assert(profile.shelfCategory === 'Trending', 'shelf separate');
    assert(Array.isArray(profile.themes), 'themes array present');
    assert(!/netflix|imax/i.test(JSON.stringify(profile)), 'no Netflix/IMAX branding in profile');

    const ph = await buildSemanticCardProfile(
        {
            id: 'ai-black-stories-1',
            title: 'Demo',
            type: 'video',
            url: '/x.mp4',
            isPlaceholder: true
        },
        { storage }
    );
    assert(ph.isPlaceholder === true, 'placeholder flagged');
    assert(ph.isRealProductionVideo === false, 'placeholder not real production');
    assert(!canPersistCategoryForAsset({ id: 'ai-black-stories-1' }).ok, 'demo id persist blocked');

    saveCreatorCatalogMetadata(
        id,
        { title: '01 ARRIVAL OPEN v1', category: 'Suspense' },
        { storage, patchCategory: false }
    );
    const locked = await buildSemanticCardProfile(
        {
            id,
            title: '01 ARRIVAL OPEN v1',
            type: 'video',
            url: '/videos/x.mp4',
            category: 'Trending'
        },
        { storage }
    );
    assert(locked.creatorLocked === true, 'creator lock preserved on profile');
    assert(loadCreatorCatalogMetadata(id, { storage }).category === 'Suspense', 'Suspense lock intact');
}

console.log('\n[card population — fixture catalog via Vite SSR]');
{
    const vite = await createServer({
        root,
        logLevel: 'error',
        server: { middlewareMode: true },
        appType: 'custom'
    });
    try {
        const { buildHomeFeed } = await vite.ssrLoadModule('/src/lib/feed/buildHomeFeed.js');
        const six = PHASE4_EXACT_MEDIA_IDENTITY.map((row) => ({
            id: row.productionId,
            title: row.currentProductionTitleAtForensics,
            name: row.currentProductionTitleAtForensics,
            category: 'Trending',
            type: 'video',
            status: 'ready',
            url: `/videos/${row.productionId}.mp4`,
            thumbnailUrl: `/thumbs/${row.productionId}.jpg`
        }));
        const heroNoise = {
            id: 'hero-noise-1',
            title: 'Bg7a1 Valid',
            category: 'HERO',
            type: 'video',
            status: 'ready',
            url: '/videos/hero-noise-1.mp4'
        };
        const { feed, cardCount, decisions } = buildHomeFeed([...six, heroNoise], {
            smartPopulation: true,
            personalThumbnailReelIds: []
        });
        const trending = feed.Trending || [];
        const trendingIds = new Set(trending.map((c) => String(c.id)));
        assert(cardCount === 6, `six production cards reach feed (got ${cardCount})`);
        assert(!trendingIds.has('hero-noise-1'), 'HERO excluded from discovery shelves');
        assert(
            decisions.some((d) => d.rejectionReason === 'hero_stage_not_discovery_shelf'),
            'hero exclusion decision recorded'
        );
        for (const row of six) {
            assert(trendingIds.has(row.id), `card present for ${row.id.slice(0, 8)}…`);
        }
        assert((feed.Romance || []).length === 0, 'Romance empty without genre evidence');
    } finally {
        await vite.close();
    }
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
    const studio = fs.readFileSync(
        path.join(root, 'src/components/experiences/StudioExperience.svelte'),
        'utf8'
    );
    const buildSrc = fs.readFileSync(path.join(root, 'src/lib/feed/buildHomeFeed.js'), 'utf8');
    assert(card.includes('data-semantic-production-card'), 'card marker');
    assert(!/netflix|apple tv\+|imax/i.test(card), 'no external platform branding in card');
    assert(panel.includes('data-semantic-production-cards'), 'panel marker');
    assert(panel.includes('allowPersist = false'), 'persist default false');
    assert(studio.includes('SemanticProductionCardsPanel'), 'Studio mounts panel');
    assert(studio.includes('allowPersist={false}'), 'Studio keeps persist off');
    assert(buildSrc.includes('hero_stage_not_discovery_shelf'), 'hero exclusion in buildHomeFeed');
}

assert(fetchMutations === 0, 'total mutation attempts = 0');

const reportPath = path.join(root, 'artifacts', 'phase-4-semantic-cards-report.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(
    reportPath,
    JSON.stringify(
        {
            phase: 'PHASE-4-SEMANTIC-CARDS',
            status: 'IMPLEMENTATION_COMPLETE_NO_DEPLOY',
            rootCause: {
                catalogGap:
                    'Only a subset of the six EXACT identity videos may be present in live /api/reels; missing IDs are reported, not invented.',
                trendingInflation:
                    'HERO-category stage assets previously mapped into Trending discovery shelves; excluded via buildHomeFeed heroShelfExclusion.',
                cardUi:
                    'Studio inventory was list-row based; SemanticProductionCardsPanel adds premium card layer from ReelForge metadata.'
            },
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
console.log('\nPASS — phase-4-semantic-cards');
process.exit(0);
