#!/usr/bin/env node
/**
 * Phase 2 — creator category suggestion review (Accept / Override, no auto-PATCH).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createMemoryStorage,
    hydrateCatalogItemWithCreatorMetadata,
    loadCreatorCatalogMetadata
} from '../src/lib/feed/creatorCatalogMetadata.js';
import { classifyContent } from '../src/lib/feed/contentClassifier.js';
import { suggestShelfClassification as suggestFromProvider } from '../src/lib/feed/titleNlpProvider.js';
import {
    evaluateCategorySuggestionReview,
    persistCreatorCategoryChoice,
    shouldOfferCategorySuggestion,
    isReviewableCanonicalTitle
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

console.log('\n[category-suggestion-review Phase 2]');

console.log('\n[title gate]');
{
    assert(isReviewableCanonicalTitle('Love Me Until Morning') === true, 'romance title reviewable');
    assert(isReviewableCanonicalTitle('After') === true, 'short title still reviewable string-wise');
    assert(isReviewableCanonicalTitle('') === false, 'empty title not reviewable');
    assert(isReviewableCanonicalTitle('IMG_0113.JPEG') === false, 'generic title not reviewable');
}

console.log('\n[a] Romance suggestion offer');
{
    const review = await evaluateCategorySuggestionReview({
        title: 'Love Me Until Morning',
        category: 'Trending'
    });
    assert(review.offer === true, 'Romance offer true');
    assert(review.suggestedCategory === 'Romance', 'suggested Romance');
    assert(review.currentCategory === 'Trending', 'current Trending');
    assert(review.confidence >= 0.5, `confidence >= 0.5 (got ${review.confidence})`);
}

console.log('\n[b] Cyber-Action suggestion offer');
{
    const review = await evaluateCategorySuggestionReview({
        title: 'Cyber Strike: Tokyo',
        category: 'Trending'
    });
    assert(review.offer === true, 'Cyber-Action offer true');
    assert(review.suggestedCategory === 'Cyber-Action', 'suggested Cyber-Action');
}

console.log('\n[ambiguous hidden]');
{
    const review = await evaluateCategorySuggestionReview({
        title: 'After',
        category: 'Trending'
    });
    assert(review.offer === false, 'low-confidence After not offered');
    const empty = await evaluateCategorySuggestionReview({ title: '', category: 'Trending' });
    assert(empty.offer === false, 'empty title not offered');
}

console.log('\n[c] creator override persistence + lock');
{
    const storage = createMemoryStorage();
    const id = 'phase2-override-001';
    let patchCalls = 0;
    const originalFetch = globalThis.fetch;
    const originalWindow = globalThis.window;
    globalThis.window = globalThis.window || /** @type {any} */ ({});
    globalThis.fetch = async (url, init) => {
        if (String(url).includes('/category') && String(init?.method || '').toUpperCase() === 'PATCH') {
            patchCalls += 1;
            return {
                ok: true,
                json: async () => ({ id, category: 'Suspense', updated: true })
            };
        }
        return { ok: true, json: async () => ({}) };
    };

    // Suggestion evaluation must not PATCH
    await evaluateCategorySuggestionReview(
        { id, title: 'Love Me Until Morning', category: 'Trending' },
        { storage }
    );
    assert(patchCalls === 0, 'no PATCH during suggestion evaluate');

    // Local creator lock (patchCategory false — Node cannot load Vite media.js PATCH client)
    const saved = persistCreatorCategoryChoice(
        id,
        { title: 'Love Me Until Morning', category: 'Suspense' },
        { storage, patchCategory: false }
    );
    assert(saved?.category === 'Suspense', 'override persisted Suspense locally');
    assert(patchCalls === 0, 'e) no PATCH until browser media client runs (still zero here)');

    const meta = loadCreatorCatalogMetadata(id, { storage });
    assert(meta.category === 'Suspense', 'creator metadata Suspense');

    const hydrated = hydrateCatalogItemWithCreatorMetadata(
        { id, title: 'Love Me Until Morning', category: 'Trending' },
        { storage }
    );
    assert(hydrated.creatorCategory === 'Suspense', 'hydrate stamps creatorCategory');
    assert(hydrated.categorySource === 'creator', 'hydrate categorySource creator');

    const locked = await suggestFromProvider({
        title: 'Cyber Strike: Tokyo',
        creatorCategory: 'Suspense',
        categorySource: 'creator',
        category: 'Suspense'
    });
    assert(locked.primaryCategory === 'Suspense', 'd) authored Suspense survives Cyber NLP pass');
    assert(locked.classificationSource === 'metadata', 'locked source metadata');
    assert(locked.suggestedCategory === 'Cyber-Action', 'NLP still diagnostic only');
    assert(
        shouldOfferCategorySuggestion(locked, 'Suspense') === true,
        'review may still offer alternate suggestion under lock'
    );

    const afterAcceptRomance = persistCreatorCategoryChoice(
        id,
        { title: 'Love Me Until Morning', category: 'Romance' },
        { storage, patchCategory: false }
    );
    assert(afterAcceptRomance?.category === 'Romance', 'accept Romance persisted without requiring second PATCH in test');
    const pass2 = await suggestFromProvider({
        id,
        title: 'Cyber Strike: Tokyo',
        ...hydrateCatalogItemWithCreatorMetadata({ id, title: 'Cyber Strike: Tokyo' }, { storage })
    });
    assert(pass2.primaryCategory === 'Romance', 'd) Romance lock survives later Cyber title NLP');

    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
        delete globalThis.window;
    } else {
        globalThis.window = originalWindow;
    }
}

console.log('\n[e] UI wiring markers present');
{
    const vaultSrc = fs.readFileSync(
        path.join(root, 'src/components/series/VaultEpisodeCreatorStatus.svelte'),
        'utf8'
    );
    const heroSrc = fs.readFileSync(
        path.join(root, 'src/components/studio/HeroManagerPanel.svelte'),
        'utf8'
    );
    const helperSrc = fs.readFileSync(
        path.join(root, 'src/lib/feed/categorySuggestionReview.js'),
        'utf8'
    );
    assert(vaultSrc.includes('data-nlp-category-review'), 'Vault review panel marker');
    assert(vaultSrc.includes('data-nlp-accept-suggestion'), 'Vault Accept marker');
    assert(vaultSrc.includes('data-nlp-apply-override'), 'Vault Override marker');
    assert(vaultSrc.includes('evaluateCategorySuggestionReview'), 'Vault uses Phase 2 helper');
    assert(!vaultSrc.includes('patchReelCategory'), 'Vault UI does not call patchReelCategory directly');
    assert(heroSrc.includes('data-hero-nlp-category-review'), 'Hero review panel marker');
    assert(heroSrc.includes('persistCreatorCategoryChoice'), 'Hero Accept/Override persist helper');
    assert(
        heroSrc.includes('reevaluateAfterCanonicalTitleSave') ||
            heroSrc.includes('evaluateCategorySuggestionReview'),
        'Hero evaluates after title save'
    );
    assert(helperSrc.includes('suggestShelfClassification'), 'helper reuses Phase 1 path');
    assert(!helperSrc.includes('openai') && !helperSrc.includes('ollama'), 'no external AI deps');
    assert(
        helperSrc.includes('saveCreatorCatalogMetadata') && helperSrc.includes('persistCreatorCategoryChoice'),
        'Accept/Override persist via existing saveCreatorCatalogMetadata'
    );
    assert(vaultSrc.includes('submitPackage'), 'Vault Accept/Override routes through submitPackage');
}

console.log('\n[deterministic classify still available]');
{
    // contentClassifier does not export suggestShelfClassification — use title provider
    assert(typeof suggestFromProvider === 'function', 'Phase 1 suggestShelfClassification export');
    assert(typeof classifyContent === 'function', 'classifyContent intact');
}

if (failed > 0) {
    console.error(`\nFAIL — ${failed} assertion(s)`);
    process.exit(1);
}
console.log('\nPASS — category-suggestion-review');
process.exit(0);
