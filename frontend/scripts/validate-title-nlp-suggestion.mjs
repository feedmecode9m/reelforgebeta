#!/usr/bin/env node
/**
 * Phase 1 — title NLP suggestion (suggestion-only, no persistence).
 */
import {
    classifyContent,
    classifyContentSemantic,
    resolveClassificationTitle,
    hasExplicitCreatorCategoryLock
} from '../src/lib/feed/contentClassifier.js';
import {
    defaultTitleNlpProvider,
    suggestShelfClassification
} from '../src/lib/feed/titleNlpProvider.js';

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

console.log('\n[title-nlp-suggestion Phase 1]');

console.log('\n[high-confidence title suggestions]');
{
    const romance = await suggestShelfClassification({
        title: 'Love Me Until Morning',
        category: 'Trending'
    });
    assert(romance.primaryCategory === 'Romance', 'Love Me Until Morning → Romance');
    assert(romance.classificationSource === 'nlp', 'Romance source nlp');
    assert(romance.confidence >= 0.85, `Romance confidence high (got ${romance.confidence})`);
    assert(romance.suggestedCategory === 'Romance', 'Romance suggestedCategory set');

    const cyber = await suggestShelfClassification({
        title: 'Cyber Strike: Tokyo',
        category: 'Trending'
    });
    assert(cyber.primaryCategory === 'Cyber-Action', 'Cyber Strike: Tokyo → Cyber-Action');
    assert(cyber.classificationSource === 'nlp', 'Cyber-Action source nlp');
    assert(cyber.confidence >= 0.85, `Cyber-Action confidence high (got ${cyber.confidence})`);

    const suspense = await suggestShelfClassification({
        title: 'The Last House',
        category: 'Trending'
    });
    assert(suspense.primaryCategory === 'Suspense', 'The Last House → Suspense');
    assert(suspense.classificationSource === 'nlp', 'Suspense source nlp');
    assert(suspense.confidence >= 0.75, `Suspense confidence moderate/high (got ${suspense.confidence})`);
}

console.log('\n[ambiguous / empty title]');
{
    const ambiguous = await suggestShelfClassification({ title: 'After', category: 'Trending' });
    assert(ambiguous.primaryCategory === 'Trending', 'After → Trending fallback');
    assert(ambiguous.confidence < 0.35, `After low confidence (got ${ambiguous.confidence})`);
    assert(ambiguous.classificationSource === 'nlp', 'ambiguous still nlp suggestion source');

    const empty = await suggestShelfClassification({ title: '', category: 'Trending' });
    assert(empty.primaryCategory === 'Trending', 'empty title → Trending');
    assert(empty.confidence < 0.25, `empty low confidence (got ${empty.confidence})`);

    const missing = await suggestShelfClassification({ category: 'Trending' });
    assert(missing.primaryCategory === 'Trending', 'missing title → Trending');
    assert(missing.confidence < 0.25, 'missing title low confidence');
}

console.log('\n[explicit creator category protection]');
{
    const romanceLock = await suggestShelfClassification({
        title: 'Cyber Strike: Tokyo',
        creatorCategory: 'Romance',
        categorySource: 'creator',
        category: 'Romance'
    });
    assert(romanceLock.primaryCategory === 'Romance', 'creator Romance wins over Cyber NLP');
    assert(romanceLock.classificationSource === 'metadata', 'authored source remains metadata');
    assert(romanceLock.confidence === 1, 'authored confidence 1');
    assert(
        romanceLock.suggestedCategory === 'Cyber-Action',
        `NLP still exposed as suggestion (got ${romanceLock.suggestedCategory})`
    );
    assert(hasExplicitCreatorCategoryLock({
        creatorCategory: 'Romance',
        categorySource: 'creator'
    }) === true, 'creator lock detector true for Romance');

    const cyberLock = await suggestShelfClassification({
        title: 'Love Me Until Morning',
        creatorCategory: 'Cyber-Action',
        categorySource: 'creator',
        category: 'Cyber-Action'
    });
    assert(cyberLock.primaryCategory === 'Cyber-Action', 'creator Cyber-Action wins over Romance NLP');
    assert(cyberLock.classificationSource === 'metadata', 'Cyber authored source metadata');
    assert(
        cyberLock.suggestedCategory === 'Romance',
        `Romance remains non-authoritative suggestion (got ${cyberLock.suggestedCategory})`
    );
}

console.log('\n[canonical persistent title beats stale display]');
{
    const resolved = resolveClassificationTitle({
        title: 'After',
        displayTitle: 'After',
        name: 'After',
        persistentTitle: 'Love Me Until Morning'
    });
    assert(resolved.title === 'Love Me Until Morning', 'persistentTitle preferred');
    assert(resolved.titleSource === 'creator', 'titleSource creator for persistent');

    const suggested = await suggestShelfClassification({
        title: 'After',
        displayTitle: 'After',
        persistentTitle: 'Love Me Until Morning',
        category: 'Trending'
    });
    assert(suggested.primaryCategory === 'Romance', 'canonical title drives Romance suggestion');
    assert(suggested.titleSource === 'creator', 'suggestion titleSource creator');
}

console.log('\n[provider contract via classifyContentSemantic]');
{
    const viaHook = await classifyContentSemantic(
        { title: 'Cyber Strike: Tokyo', category: 'Trending' },
        { nlpProvider: defaultTitleNlpProvider }
    );
    assert(viaHook.primaryCategory === 'Cyber-Action', 'hook + defaultTitleNlpProvider');
    assert(viaHook.classificationSource === 'nlp', 'hook source nlp');

    const compact = await classifyContentSemantic(
        { title: 'x', category: 'Trending' },
        {
            nlpProvider: () => ({ category: 'Suspense', confidence: 0.77, source: 'nlp' })
        }
    );
    assert(compact.primaryCategory === 'Suspense', 'compact provider shape accepted');
    assert(compact.confidence === 0.77, 'compact confidence preserved');
}

console.log('\n[no persistence side effects in module surface]');
{
    const src = await import('node:fs').then((fs) =>
        fs.readFileSync(new URL('../src/lib/feed/titleNlpProvider.js', import.meta.url), 'utf8')
    );
    assert(!src.includes('patchReelCategory'), 'titleNlpProvider never calls patchReelCategory');
    assert(!src.includes('localStorage'), 'titleNlpProvider does not touch localStorage');
    assert(!/\bfetch\s*\(/.test(src), 'titleNlpProvider has no fetch/network');

    // Deterministic classifyContent still authoritative without NLP provider
    const base = classifyContent({ title: 'Harbor Romance', category: 'Trending' });
    assert(base.primaryCategory === 'Romance', 'deterministic classifyContent unchanged path');
}

if (failed > 0) {
    console.error(`\nFAIL — ${failed} assertion(s)`);
    process.exit(1);
}
console.log('\nPASS — title-nlp-suggestion');
process.exit(0);
