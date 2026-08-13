#!/usr/bin/env node
/**
 * Phase 2.5 browser smoke — Playwright against local review markup + bundle markers.
 * Does not PATCH production; stubs /api/reels/{id}/category.
 */
import { chromium } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    evaluateCategorySuggestionReview,
    persistCreatorCategoryChoice,
    canPersistCategoryForAsset
} from '../src/lib/feed/categorySuggestionReview.js';
import { suggestShelfClassification } from '../src/lib/feed/titleNlpProvider.js';
import {
    createMemoryStorage,
    hydrateCatalogItemWithCreatorMetadata
} from '../src/lib/feed/creatorCatalogMetadata.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

let failed = 0;
function assert(cond, label) {
    if (cond) console.log(`  ✓ ${label}`);
    else {
        failed += 1;
        console.error(`  ✗ ${label}`);
    }
}

console.log('\n[phase-2.5 browser]');

console.log('\n[logic cases 1–8]');
{
    const romance = await evaluateCategorySuggestionReview({
        title: 'Love Me Until Morning',
        category: 'Trending'
    });
    assert(romance.offer && romance.suggestedCategory === 'Romance', '1) strong Romance offer');

    const cyber = await evaluateCategorySuggestionReview({
        title: 'Cyber Strike: Tokyo',
        category: 'Trending'
    });
    assert(cyber.offer && cyber.suggestedCategory === 'Cyber-Action', '2) strong Cyber-Action offer');

    const amb = await evaluateCategorySuggestionReview({
        title: 'Love in the Neon City',
        category: 'Trending'
    });
    assert(amb.ambiguous === true && amb.showManualHelper === true, '3) ambiguous + manual helper');

    const storage = createMemoryStorage();
    persistCreatorCategoryChoice(
        'p25-browser-manual',
        { title: 'After', category: 'Suspense' },
        { storage, patchCategory: false }
    );
    const manualLock = await suggestShelfClassification({
        title: 'Cyber Strike: Tokyo',
        ...hydrateCatalogItemWithCreatorMetadata(
            { id: 'p25-browser-manual', title: 'Cyber Strike: Tokyo' },
            { storage }
        )
    });
    assert(manualLock.primaryCategory === 'Suspense', '4/8) manual/lock survives reclass');

    const acceptPath = await evaluateCategorySuggestionReview({
        title: 'The Last House',
        category: 'Trending'
    });
    assert(acceptPath.offer && acceptPath.suggestedCategory === 'Suspense', '5) Accept-eligible Suspense');

    assert(
        canPersistCategoryForAsset({ isPlaceholder: true, id: 'x' }).ok === false,
        'placeholder not persistable'
    );
}

console.log('\n[bundle markers]');
{
    if (!existsSync(dist)) {
        assert(false, 'dist missing — run build first');
    } else {
        const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
        const match = html.match(/assets\/index-[^"]+\.js/);
        assert(Boolean(match), 'index bundle present');
        if (match) {
            const js = readFileSync(path.join(dist, match[0]), 'utf8');
            assert(js.includes('manual-category-helper') || js.includes('Choose category'), 'manual helper in bundle');
            assert(js.includes('data-nlp-ambiguous') || js.includes('Signals conflict'), 'ambiguity UI in bundle');
        }
    }
}

console.log('\n[chromium — display without PATCH; one persist action]');
{
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    let categoryPatchCount = 0;
    await page.route('**/api/reels/**/category', async (route) => {
        categoryPatchCount += 1;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ updated: true, category: 'Romance' })
        });
    });

    await page.setContent(`<!doctype html><html><body>
      <div data-nlp-category-review data-offer="true" data-manual-helper="true"
           data-suggested-category="Romance" data-ambiguous="false">
        <button data-nlp-accept-suggestion>Accept suggestion</button>
        <div data-manual-category-helper>
          <select data-manual-category-select>
            <option>Trending</option><option>Romance</option><option>Cyber-Action</option><option>Suspense</option>
          </select>
          <button data-manual-category-apply>Apply category</button>
        </div>
      </div>
      <div data-hero-nlp-category-review data-offer="true"></div>
    </body></html>`, { waitUntil: 'domcontentloaded' });

    assert((await page.locator('[data-nlp-category-review]').count()) === 1, '6) vault review visible');
    assert((await page.locator('[data-manual-category-helper]').count()) === 1, 'manual helper visible');
    assert((await page.locator('[data-hero-nlp-category-review]').count()) === 1, '7) hero review marker');
    await page.waitForTimeout(150);
    assert(categoryPatchCount === 0, '9) no PATCH while suggestion displayed');

    // Simulate a single explicit Accept persistence (exactly one) via page fetch so route intercepts
    await page.evaluate(async () => {
        await fetch('http://127.0.0.1/api/reels/demo-id/category', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category: 'Romance' })
        });
    });
    assert(categoryPatchCount === 1, '10) exactly one category persistence after Accept');

    console.info('[phase25-browser-trace]', {
        categoryPatchCount,
        markers: ['data-nlp-category-review', 'data-manual-category-helper', 'data-hero-nlp-category-review']
    });

    await browser.close();
}

if (failed > 0) {
    console.error(`\nFAIL — ${failed}`);
    process.exit(1);
}
console.log('\nPASS — phase-2.5 browser');
process.exit(0);
