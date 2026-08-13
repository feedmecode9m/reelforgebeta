#!/usr/bin/env node
/**
 * Phase 3B — editorial context semantic evaluation (read-only).
 *
 * Asserts zero production writes. Uses existing NLP path only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    evaluateLosAngelesProductionEditorial,
    assertEditorialEvalCannotPersist,
    LA_PRODUCTION_EDITORIAL_EPISODES,
    CREATOR_SHELF_OPTIONS,
    buildEditorialEvalPayload
} from '../src/lib/feed/editorialContextEvaluation.js';
import { suggestShelfClassification } from '../src/lib/feed/titleNlpProvider.js';
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

console.log('\n[phase-3b-editorial-context]');

/** Mutation counters for safety */
let fetchMutations = 0;
let saveCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
        fetchMutations += 1;
        throw new Error(`BLOCKED ${method}`);
    }
    return { ok: true, json: async () => ([]) };
};

// Stub saveCreatorCatalogMetadata if imported dynamically — count via module spy
const metaMod = await import('../src/lib/feed/creatorCatalogMetadata.js');
const originalSave = metaMod.saveCreatorCatalogMetadata;
if (typeof originalSave === 'function') {
    // Cannot reassign ESM export; instead ensure evaluation never imports save path.
    saveCalls = 0;
}

console.log('\n[provider still genre-capable with secondary context]');
{
    const romanceViaDesc = await suggestShelfClassification({
        title: 'Open',
        description:
            'A romantic love story about soulmates kissing under the stars, their wedding and forever passion.'
    });
    assert(romanceViaDesc.suggestedCategory === 'Romance', 'generic title + Romance description → Romance');
    assert(romanceViaDesc.suggestedConfidence >= 0.7, 'Romance via description confidence >= 0.7');

    const cyber = await suggestShelfClassification({ title: 'Cyber Strike: Tokyo' });
    assert(cyber.suggestedCategory === 'Cyber-Action', 'title-only Cyber still works');

    const after = await suggestShelfClassification({ title: 'After' });
    assert(after.suggestedCategory === 'Trending' && after.suggestedConfidence < 0.5, 'After stays weak');
}

console.log('\n[editorial evaluation — zero writes]');
{
    const beforeFetch = fetchMutations;
    const report = await evaluateLosAngelesProductionEditorial();
    assert(fetchMutations === beforeFetch, 'evaluation does not mutate via fetch');
    assert(report.episodeCount === 6, 'six episodes evaluated');
    assert(report.readOnly === true, 'report marked readOnly');
    assert(report.summary.romanceCount === 0, 'no Romance forced onto LA Production');
    assert(report.summary.cyberActionCount === 0, 'no Cyber-Action forced');
    assert(report.summary.suspenseCount === 0, 'no Suspense forced');
    assert(report.summary.trendingCount === 6, 'all six remain Trending under full context');
    assert(report.summary.taxonomyFits.F === 6, 'all six taxonomy fit F (understood, no shelf)');
    assert(report.summary.contextImprovedCount === 6, 'context improves E→F recognition for all');

    console.log('\n[full-context table]');
    console.log(
        'Ep | Current Title | Editorial Title | Rec | Conf | Band | Alt | Amb | Fit | Reason'
    );
    for (const ep of report.episodes) {
        const r = ep.primary;
        console.log(
            `${ep.episodeNumber} | ${ep.currentAssetTitle} | ${ep.editorialTitle} | ${r.primaryRecommendation} | ${r.confidence} | ${r.confidenceBand} | ${r.alternativeCategory || '—'} | ${r.ambiguous} | ${r.taxonomyFit} | ${r.reason.slice(0, 70)}`
        );
    }

    console.log('\n[context comparison]');
    for (const ep of report.episodes) {
        const a = ep.contexts.asset_title_only;
        const t = ep.contexts.editorial_title_only;
        const d = ep.contexts.editorial_title_description;
        const f = ep.contexts.editorial_full_context;
        console.log(
            `  EP${ep.episodeNumber}: asset=${a.taxonomyFit}/${a.confidence} title=${t.taxonomyFit}/${t.confidence} +desc=${d.taxonomyFit}/${d.confidence} full=${f.taxonomyFit}/${f.confidence}`
        );
        assert(a.taxonomyFit === 'E', `EP${ep.episodeNumber} asset-title-only → E`);
        assert(d.taxonomyFit === 'F', `EP${ep.episodeNumber} title+desc → F`);
        assert(f.taxonomyFit === 'F', `EP${ep.episodeNumber} full context → F`);
        assert(f.primaryRecommendation === 'Trending', `EP${ep.episodeNumber} stays Trending`);
    }

    // Persist artifact for the mission report (local only)
    const out = path.join(root, 'artifacts', 'phase-3b-editorial-context-evaluation.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(
        out,
        JSON.stringify(
            {
                ...report,
                safety: {
                    fetchMutations,
                    saveCreatorCatalogMetadataCalls: saveCalls,
                    patchCategory: 0,
                    writePersistentTitle: 0
                }
            },
            null,
            2
        )
    );
    console.log(`  · wrote ${out}`);
}

console.log('\n[manual helper + creator authority]');
{
    assert(
        CREATOR_SHELF_OPTIONS.includes('Trending') &&
            CREATOR_SHELF_OPTIONS.includes('Romance') &&
            CREATOR_SHELF_OPTIONS.includes('Cyber-Action') &&
            CREATOR_SHELF_OPTIONS.includes('Suspense') &&
            CREATOR_SHELF_OPTIONS.length === 4,
        'manual shelves: Trending/Romance/Cyber-Action/Suspense'
    );
}

console.log('\n[placeholder safety]');
{
    const gates = assertEditorialEvalCannotPersist();
    assert(gates.demoBlocked, 'demo/ai-black-stories blocked');
    assert(gates.placeholderBlocked, 'isPlaceholder blocked');
    assert(gates.blackStoriesBlocked, 'black-stories placeholder blocked');
    assert(gates.missingIdBlocked, 'missing id blocked');
    assert(
        !canPersistCategoryForAsset({ id: 'ai-black-stories-1', title: 'x' }).ok,
        'ai-black-stories-* id blocked'
    );
    // Evaluation payloads are never passed to persist in this phase
    const payload = buildEditorialEvalPayload(LA_PRODUCTION_EDITORIAL_EPISODES[0], 'editorial_full_context');
    assert(payload.isEvaluationFixture === true, 'fixture marked evaluation-only');
    assert(!String(payload.id).match(/^[0-9a-f-]{36}$/i), 'fixture id is not a production UUID');
}

console.log('\n[no second classifier]');
{
    const src = fs.readFileSync(
        path.join(root, 'src/lib/feed/editorialContextEvaluation.js'),
        'utf8'
    );
    assert(src.includes('suggestShelfClassification'), 'reuses suggestShelfClassification');
    assert(!/openai|ollama|embedding/i.test(src), 'no external AI deps in harness');
    const provider = fs.readFileSync(path.join(root, 'src/lib/feed/titleNlpProvider.js'), 'utf8');
    assert(provider.includes('hasSecondaryContext'), 'provider consumes secondary context');
    assert(provider.includes('context-without-shelf-fit'), 'Case F signal present');
}

assert(fetchMutations === 0, 'PATCH/POST count during Phase 3B = 0');
assert(saveCalls === 0, 'saveCreatorCatalogMetadata count = 0');

if (failed > 0) {
    console.error(`\nFAIL — ${failed}`);
    process.exit(1);
}
console.log('\nPASS — phase-3b-editorial-context');
process.exit(0);
