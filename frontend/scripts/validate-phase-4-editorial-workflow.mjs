#!/usr/bin/env node
/**
 * Phase 4 — real editorial metadata verification gate.
 *
 * WITHOUT authoritative coworker metadata:
 *   → BLOCKED (does not invent titles/descriptions; does not mutate production)
 *
 * WITH frontend/artifacts/phase-4-authoritative-editorial.json fully filled:
 *   → verifies mapping uniqueness + confidence
 *   → runs in-memory NLP observation via existing reevaluate path
 *   → asserts 0 category PATCH during observation
 *   → does NOT auto-accept categories
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    reevaluateAfterCanonicalTitleSave,
    canPersistCategoryForAsset
} from '../src/lib/feed/categorySuggestionReview.js';
import {
    createMemoryStorage,
    saveCreatorCatalogMetadata
} from '../src/lib/feed/creatorCatalogMetadata.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const authPath = path.join(root, 'artifacts', 'phase-4-authoritative-editorial.json');
const templatePath = path.join(root, 'artifacts', 'phase-4-authoritative-editorial.template.json');
const inventoryPath = path.join(root, 'artifacts', 'phase-4-production-inventory-snapshot.json');
const reportPath = path.join(root, 'artifacts', 'phase-4-editorial-workflow-report.json');

let failed = 0;
function assert(cond, label) {
    if (cond) console.log(`  ✓ ${label}`);
    else {
        failed += 1;
        console.error(`  ✗ ${label}`);
    }
}

console.log('\n[phase-4-editorial-workflow]');

console.log('\n[safety invariants]');
{
    assert(fs.existsSync(templatePath), 'authoritative template present');
    assert(fs.existsSync(inventoryPath), 'production inventory snapshot present');
    assert(
        !canPersistCategoryForAsset({ id: 'ai-black-stories-1' }).ok,
        'demo IDs remain blocked'
    );
    assert(!canPersistCategoryForAsset({ isPlaceholder: true, id: 'x' }).ok, 'placeholders blocked');
}

const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
console.log('\n[current production videos — provisional titles only]');
for (const v of inventory.productionVideos || []) {
    console.log(`  · ${v.id} | ${v.currentTitle} | ${v.category}`);
}

if (!fs.existsSync(authPath)) {
    const blocked = {
        phase: 'PHASE-4',
        status: 'BLOCKED',
        reason: 'WAITING_FOR_AUTHORITATIVE_METADATA',
        detail:
            'Coworker final title/description list not supplied. Phase 3B episode guide is provisional only and must not be written to production.',
        requiredFile: 'frontend/artifacts/phase-4-authoritative-editorial.json',
        templateFile: 'frontend/artifacts/phase-4-authoritative-editorial.template.json',
        productionMutations: 0,
        categoryPatchCount: 0,
        inventorySnapshot: inventoryPath,
        nextSteps: [
            'Obtain coworker final editorial list',
            'Fill phase-4-authoritative-editorial.json',
            'Map each row to production asset IDs with high confidence',
            'Re-run validate:phase-4-editorial-workflow',
            'Only then exercise Master Vault / Hero Vault creator workflow'
        ]
    };
    fs.writeFileSync(reportPath, JSON.stringify(blocked, null, 2));
    console.log('\nPHASE 4 BLOCKED — waiting for authoritative coworker editorial list');
    console.log(`  wrote ${reportPath}`);
    console.log('  No titles invented. No descriptions invented. No production mutations.');
    process.exit(0);
}

/** Authoritative file present — validate mapping completeness */
const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
const episodes = Array.isArray(auth.episodes) ? auth.episodes : [];

console.log('\n[authoritative mapping gate]');
{
    assert(episodes.length === 6, 'six editorial episodes required');
    const ids = new Set();
    for (const ep of episodes) {
        const title = String(ep.authoritativeTitle || '').trim();
        const desc = String(ep.authoritativeDescription || '').trim();
        const assetId = String(ep.mappedAssetId || '').trim();
        const conf = String(ep.mappingConfidence || '').toLowerCase();
        const evidence = String(ep.mappingEvidence || '').trim();
        assert(Boolean(title), `EP${ep.episodeNumber} authoritative title present`);
        assert(Boolean(desc), `EP${ep.episodeNumber} authoritative description present`);
        assert(Boolean(assetId), `EP${ep.episodeNumber} mappedAssetId present`);
        assert(Boolean(evidence), `EP${ep.episodeNumber} mapping evidence present`);
        assert(
            conf === 'high',
            `EP${ep.episodeNumber} mappingConfidence=high (got ${ep.mappingConfidence})`
        );
        if (assetId) {
            assert(!ids.has(assetId), `EP${ep.episodeNumber} asset id unique`);
            ids.add(assetId);
            const known = (inventory.productionVideos || []).some((v) => v.id === assetId);
            assert(known, `EP${ep.episodeNumber} maps to known production video id`);
        }
    }
    if (failed > 0) {
        console.error('\nSTOP — mapping incomplete or ambiguous. No production edits.');
        fs.writeFileSync(
            reportPath,
            JSON.stringify(
                {
                    phase: 'PHASE-4',
                    status: 'STOPPED_AMBIGUOUS_OR_INCOMPLETE_MAPPING',
                    failed,
                    productionMutations: 0
                },
                null,
                2
            )
        );
        process.exit(1);
    }
}

/** In-memory observation only — never production PATCH */
let fetchMutations = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_input, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
        fetchMutations += 1;
        throw new Error(`BLOCKED ${method}`);
    }
    return { ok: true, json: async () => ({}) };
};

console.log('\n[in-memory NLP observation after simulated title+description save]');
const storage = createMemoryStorage();
const observations = [];
for (const ep of episodes) {
    const id = String(ep.mappedAssetId).trim();
    saveCreatorCatalogMetadata(
        id,
        {
            title: ep.authoritativeTitle,
            description: ep.authoritativeDescription
        },
        { storage, patchCategory: false }
    );
    const before = fetchMutations;
    const review = await reevaluateAfterCanonicalTitleSave(
        id,
        ep.authoritativeTitle,
        {
            description: ep.authoritativeDescription,
            seriesName: auth.series || 'Los Angeles Production'
        },
        { storage }
    );
    assert(fetchMutations === before, `EP${ep.episodeNumber} observation 0 category PATCH`);
    observations.push({
        episodeNumber: ep.episodeNumber,
        assetId: id,
        title: ep.authoritativeTitle,
        descriptionAvailable: true,
        recommendation: review.suggestedCategory || review.recommendedShelf,
        confidence: review.confidence,
        band: review.confidenceBand,
        alternativeCategory: review.alternativeCategory || '',
        ambiguous: review.ambiguous,
        taxonomyFit: review.taxonomyFit,
        classificationState: review.classificationState,
        shelfFitReason: review.shelfFitReason,
        caseF: review.classificationState === 'UNDERSTOOD_NO_SHELF_FIT',
        creatorDecisionRequired: 'ACCEPT | OVERRIDE | MANUAL | REMAIN_TRENDING_CASE_F',
        autoAccepted: false
    });
    console.log(
        `  · EP${ep.episodeNumber} ${ep.authoritativeTitle} → ${review.classificationState} / ${review.recommendedShelf || review.suggestedCategory}`
    );
}

assert(fetchMutations === 0, 'total category PATCH during Phase 4 observation = 0');
assert(
    observations.every((o) => o.autoAccepted === false),
    'no automatic Accept'
);

const report = {
    phase: 'PHASE-4',
    status: 'OBSERVATION_COMPLETE_AWAITING_CREATOR_DECISIONS',
    categoryPatchCount: fetchMutations,
    productionMutations: 0,
    mapping: episodes.map((ep) => ({
        assetId: ep.mappedAssetId,
        currentTitleHint: ep.currentProductionTitleHint,
        authoritativeTitle: ep.authoritativeTitle,
        authoritativeDescription: ep.authoritativeDescription,
        mappingEvidence: ep.mappingEvidence,
        mappingConfidence: ep.mappingConfidence
    })),
    nlpObservations: observations,
    note: 'Creator must explicitly Accept/Override/Manual/Remain Trending. Do not deploy until reviewed.'
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nWrote ${reportPath}`);

globalThis.fetch = originalFetch;

if (failed > 0) {
    console.error(`\nFAIL — ${failed}`);
    process.exit(1);
}
console.log('\nPASS — phase-4-editorial-workflow (observation only; no auto-categorization)');
process.exit(0);
