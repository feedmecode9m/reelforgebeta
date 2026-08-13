#!/usr/bin/env node
/**
 * Phase 2.5 — multi-signal semantic scoring + manual helper + placeholder gate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createMemoryStorage,
    hydrateCatalogItemWithCreatorMetadata
} from '../src/lib/feed/creatorCatalogMetadata.js';
import { suggestShelfClassification, confidenceBand } from '../src/lib/feed/titleNlpProvider.js';
import {
    evaluateCategorySuggestionReview,
    persistCreatorCategoryChoice,
    canPersistCategoryForAsset,
    shouldShowManualCategoryHelper
} from '../src/lib/feed/categorySuggestionReview.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

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

console.log('\n[phase-2.5 semantic-intelligence]');

console.log('\n[strong classifications]');
{
    const romance = await suggestShelfClassification({
        title: 'Love Me Until Morning',
        category: 'Trending'
    });
    assert(romance.primaryCategory === 'Romance', 'Love Me Until Morning → Romance');
    assert(romance.confidence >= 0.85, `Romance conf >= 0.85 (got ${romance.confidence})`);
    assert(confidenceBand(romance.confidence) === 'strong', 'Romance band strong');

    const cyber = await suggestShelfClassification({
        title: 'Cyber Strike: Tokyo',
        category: 'Trending'
    });
    assert(cyber.primaryCategory === 'Cyber-Action', 'Cyber Strike: Tokyo → Cyber-Action');
    assert(cyber.confidence >= 0.85, `Cyber conf >= 0.85 (got ${cyber.confidence})`);

    const suspense = await suggestShelfClassification({
        title: 'The Last House',
        category: 'Trending'
    });
    assert(suspense.primaryCategory === 'Suspense', 'The Last House → Suspense');
    assert(suspense.confidence >= 0.8, `Suspense conf >= 0.80 (got ${suspense.confidence})`);
}

console.log('\n[ambiguous / conflicting]');
{
    const cyberHearts = await suggestShelfClassification({
        title: 'Cyber Hearts',
        category: 'Trending'
    });
    assert(cyberHearts.ambiguous === true, 'Cyber Hearts ambiguous');
    assert(cyberHearts.confidence < 0.85, 'Cyber Hearts not strong');
    assert(
        cyberHearts.alternativeCategory === 'Romance' ||
            cyberHearts.alternativeCategory === 'Cyber-Action' ||
            cyberHearts.primaryCategory === 'Romance' ||
            cyberHearts.primaryCategory === 'Cyber-Action',
        'Cyber Hearts spans Romance/Cyber-Action'
    );

    const neonLove = await suggestShelfClassification({
        title: 'Love in the Neon City',
        category: 'Trending'
    });
    assert(neonLove.ambiguous === true, 'Love in the Neon City conflicting signals');
    assert(neonLove.confidence < 0.85, 'Neon City not forced high confidence');

    const agentLove = await suggestShelfClassification({
        title: 'Agent of Love',
        category: 'Trending'
    });
    assert(agentLove.ambiguous === true, 'Agent of Love ambiguous');
    assert(agentLove.confidence < 0.85, 'Agent of Love moderate/weak');
}

console.log('\n[generic — no strong genre]');
{
    for (const title of ['After', 'Open', 'Arrival', '']) {
        const r = await suggestShelfClassification({ title, category: 'Trending' });
        assert(
            r.primaryCategory === 'Trending' && r.confidence < 0.5,
            `${title || '(empty)'} → no strong genre (conf ${r.confidence})`
        );
        assert(
            r.confidenceBand === 'manual' || confidenceBand(r.confidence) === 'manual',
            `${title || '(empty)'} → manual band`
        );
    }
}

console.log('\n[creator lock]');
{
    const locked = await suggestShelfClassification({
        title: 'Cyber Strike: Tokyo',
        creatorCategory: 'Romance',
        categorySource: 'creator',
        category: 'Romance'
    });
    assert(locked.primaryCategory === 'Romance', 'primary Romance under creator lock');
    assert(locked.classificationSource === 'metadata', 'source metadata');
    assert(locked.suggestedCategory === 'Cyber-Action', 'suggested Cyber-Action diagnostic');

    const again = await suggestShelfClassification({
        title: 'Cyber Strike: Tokyo',
        creatorCategory: 'Romance',
        categorySource: 'creator',
        category: 'Romance'
    });
    assert(again.primaryCategory === 'Romance', 'second pass still Romance');
}

console.log('\n[manual helper]');
{
    const none = await evaluateCategorySuggestionReview({
        title: 'After',
        category: 'Trending'
    });
    assert(none.offer === false, 'After: no Accept offer');
    assert(none.showManualHelper === true, 'After: Manual Category visible');

    const weak = await evaluateCategorySuggestionReview({
        title: 'Cyber Hearts',
        category: 'Trending'
    });
    assert(weak.showManualHelper === true, 'ambiguous: Manual Category visible');
    assert(shouldShowManualCategoryHelper(weak) === true, 'helper predicate true');

    const storage = createMemoryStorage();
    const id = 'phase25-manual-001';
    const saved = persistCreatorCategoryChoice(
        id,
        { title: 'After', category: 'Cyber-Action' },
        { storage, patchCategory: false }
    );
    assert(saved?.category === 'Cyber-Action', 'manual Cyber-Action persists');
    const hydrated = hydrateCatalogItemWithCreatorMetadata(
        { id, title: 'After', category: 'Trending' },
        { storage }
    );
    assert(hydrated.categorySource === 'creator', 'manual sets categorySource creator');
    const locked = await suggestShelfClassification({
        title: 'Love Me Until Morning',
        ...hydrated
    });
    assert(locked.primaryCategory === 'Cyber-Action', 'manual Cyber-Action survives Romance NLP');
}

console.log('\n[placeholder gate]');
{
    assert(
        canPersistCategoryForAsset({ isPlaceholder: true, id: 'x' }).ok === false,
        'placeholder cannot persist'
    );
    assert(
        canPersistCategoryForAsset({ isBlackStoriesPlaceholder: true, id: 'x' }).ok === false,
        'black-stories placeholder cannot persist'
    );
    assert(canPersistCategoryForAsset({}).ok === false, 'missing durable id cannot persist');
    assert(
        canPersistCategoryForAsset({ id: 'ai-black-stories-Trending-1' }).ok === false,
        'demo id cannot persist'
    );
    assert(
        persistCreatorCategoryChoice('ai-black-stories-x', { category: 'Romance' }, {
            asset: { id: 'ai-black-stories-x', isPlaceholder: true },
            patchCategory: false
        }) === null,
        'persist against placeholder returns null'
    );
    assert(
        canPersistCategoryForAsset({ id: 'real-asset-uuid-001' }).ok === true,
        'real durable id can persist'
    );
}

console.log('\n[UI markers]');
{
    const vault = fs.readFileSync(
        path.join(root, 'src/components/series/VaultEpisodeCreatorStatus.svelte'),
        'utf8'
    );
    const hero = fs.readFileSync(
        path.join(root, 'src/components/studio/HeroManagerPanel.svelte'),
        'utf8'
    );
    assert(vault.includes('data-manual-category-helper'), 'Vault manual helper');
    assert(vault.includes('data-manual-category-apply'), 'Vault manual apply');
    assert(vault.includes('data-nlp-ambiguous'), 'Vault ambiguity copy');
    assert(hero.includes('data-manual-category-helper'), 'Hero manual helper');
    assert(hero.includes('canPersistCategoryForAsset'), 'Hero placeholder gate');
}

if (failed > 0) {
    console.error(`\nFAIL — ${failed} assertion(s)`);
    process.exit(1);
}
console.log('\nPASS — phase-2.5-semantic-intelligence');
process.exit(0);
