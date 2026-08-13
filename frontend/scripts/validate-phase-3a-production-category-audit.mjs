#!/usr/bin/env node
/**
 * Phase 3A — production category audit (read-only validator).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    auditCatalogAsset,
    auditProductionCatalog,
    deriveAuditState,
    applyAuditCategoryDecision,
    explainTrendingReason
} from '../src/lib/feed/productionCategoryAudit.js';
import {
    createMemoryStorage,
    hydrateCatalogItemWithCreatorMetadata
} from '../src/lib/feed/creatorCatalogMetadata.js';

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

console.log('\n[phase-3a-production-category-audit]');

console.log('\n[audit states]');
{
    assert(
        deriveAuditState({
            creatorLocked: true,
            currentCategory: 'Romance',
            suggestedCategory: 'Cyber-Action',
            confidence: 0.94,
            ambiguous: false,
            confidenceBand: 'strong'
        }) === 'CREATOR_LOCK',
        'creator lock state'
    );
    assert(
        deriveAuditState({
            creatorLocked: false,
            currentCategory: 'Trending',
            suggestedCategory: 'Cyber-Action',
            confidence: 0.94,
            ambiguous: false,
            confidenceBand: 'strong'
        }) === 'RECOMMEND_CHANGE',
        'strong recommend change'
    );
    assert(
        deriveAuditState({
            creatorLocked: false,
            currentCategory: 'Trending',
            suggestedCategory: 'Romance',
            confidence: 0.62,
            ambiguous: true,
            confidenceBand: 'weak'
        }) === 'AMBIGUOUS',
        'ambiguous state'
    );
    assert(
        deriveAuditState({
            creatorLocked: false,
            currentCategory: 'Trending',
            suggestedCategory: 'Trending',
            confidence: 0.15,
            ambiguous: false,
            confidenceBand: 'manual'
        }) === 'FALLBACK_TRENDING',
        'fallback trending'
    );
    assert(
        deriveAuditState({
            creatorLocked: false,
            currentCategory: 'Romance',
            suggestedCategory: 'Romance',
            confidence: 0.9,
            ambiguous: false,
            confidenceBand: 'strong'
        }) === 'MATCH',
        'match state'
    );
}

console.log('\n[fixture catalog — representative + production-like titles]');
{
    const fixture = [
        {
            id: 'fix-love',
            title: 'Love Me Until Morning',
            category: 'Trending',
            type: 'video',
            url: 'https://cdn.example/love.mp4'
        },
        {
            id: 'fix-cyber',
            title: 'Cyber Strike: Tokyo',
            category: 'Trending',
            type: 'video',
            url: 'https://cdn.example/cyber.mp4'
        },
        {
            id: 'fix-house',
            title: 'The Last House',
            category: 'Trending',
            type: 'video',
            url: 'https://cdn.example/house.mp4'
        },
        {
            id: 'fix-hearts',
            title: 'Cyber Hearts',
            category: 'Trending',
            type: 'video',
            url: 'https://cdn.example/hearts.mp4'
        },
        {
            id: 'fix-neon',
            title: 'Love in the Neon City',
            category: 'Trending',
            type: 'video',
            url: 'https://cdn.example/neon.mp4'
        },
        {
            id: 'fix-after',
            title: 'After',
            category: 'Trending',
            type: 'video',
            url: 'https://cdn.example/after.mp4'
        },
        {
            id: 'fix-open',
            title: 'Open',
            category: 'Trending',
            type: 'video',
            url: 'https://cdn.example/open.mp4'
        },
        {
            id: 'fix-arrival',
            title: 'Arrival',
            category: 'Trending',
            type: 'video',
            url: 'https://cdn.example/arrival.mp4'
        },
        // production-shaped generic titles (not hard-coded as special cases)
        { id: 'prod-arrival', title: '01 ARRIVAL OPEN v1', category: 'Trending', type: 'video', url: 'x.mp4' },
        { id: 'prod-amp', title: '07 AMP JAM V1', category: 'Trending', type: 'video', url: 'x.mp4' },
        { id: 'prod-micros', title: 'MICROS STIRRED V1', category: 'Trending', type: 'video', url: 'x.mp4' },
        {
            id: 'prod-mother',
            title: 'MICROS Motherland V1(1)',
            category: 'Trending',
            type: 'video',
            url: 'x.mp4'
        },
        { id: 'prod-club', title: '03 CLUB POOM POOM V1', category: 'Trending', type: 'video', url: 'x.mp4' },
        { id: 'prod-condo', title: 'condo v1 2', category: 'Trending', type: 'video', url: 'x.mp4' },
        { id: 'ai-black-stories-1', title: 'Demo', category: 'Trending', isPlaceholder: true },
        { id: 'ghost', title: 'No id placeholder', isPlaceholder: true }
    ];

    const report = await auditProductionCatalog(fixture);
    assert(report.excludedCount >= 2, 'placeholders excluded');
    assert(report.eligibleCount >= 12, 'real assets audited');

    const byId = Object.fromEntries(report.eligible.map((r) => [r.id, r]));
    assert(byId['fix-love']?.suggestedCategory === 'Romance', 'Love → Romance recommend');
    assert(byId['fix-love']?.auditState === 'RECOMMEND_CHANGE', 'Love recommend change');
    assert(byId['fix-cyber']?.suggestedCategory === 'Cyber-Action', 'Cyber → Cyber-Action');
    assert(byId['fix-cyber']?.suggestedConfidence >= 0.85, 'Cyber strong confidence');
    assert(byId['fix-house']?.suggestedCategory === 'Suspense', 'Last House → Suspense');
    assert(byId['fix-hearts']?.ambiguous === true || byId['fix-hearts']?.auditState === 'AMBIGUOUS', 'Cyber Hearts ambiguous');
    assert(byId['fix-after']?.suggestedConfidence < 0.5, 'After not high confidence');
    assert(
        ['FALLBACK_TRENDING', 'MANUAL'].includes(byId['fix-after']?.auditState),
        'After fallback/manual'
    );
    assert(byId['fix-open']?.suggestedConfidence < 0.5, 'Open not high confidence');
    assert(byId['fix-arrival']?.suggestedConfidence < 0.5, 'Arrival not high confidence');

    // Production-like titles must not get unjustified strong genre
    for (const id of ['prod-arrival', 'prod-amp', 'prod-micros', 'prod-mother', 'prod-club', 'prod-condo']) {
        const row = byId[id];
        assert(row, `${id} present`);
        assert(
            row.suggestedConfidence < 0.85 || row.auditState !== 'RECOMMEND_CHANGE',
            `${id} not unjustified strong genre (state=${row.auditState} conf=${row.suggestedConfidence})`
        );
        console.log(
            `  · ${row.canonicalTitle} → state=${row.auditState} current=${row.currentCategory} suggested=${row.suggestedCategory} conf=${row.suggestedConfidence} reason=${explainTrendingReason(row)}`
        );
    }

    assert(report.currentDistribution.Trending >= 12, 'current mostly Trending');
    assert(typeof report.recommendedDistribution.Romance === 'number', 'recommended distribution present');
}

console.log('\n[creator lock protection]');
{
    const storage = createMemoryStorage();
    const id = 'lock-asset-1';
    // Seed creator Romance
    const { saveCreatorCatalogMetadata } = await import('../src/lib/feed/creatorCatalogMetadata.js');
    saveCreatorCatalogMetadata(
        id,
        { title: 'Cyber Strike: Tokyo', category: 'Romance' },
        { storage, patchCategory: false }
    );
    const asset = hydrateCatalogItemWithCreatorMetadata(
        {
            id,
            title: 'Cyber Strike: Tokyo',
            category: 'Trending',
            type: 'video',
            url: 'x.mp4'
        },
        { storage }
    );
    const row = await auditCatalogAsset(asset, { storage });
    assert(row.creatorLocked === true, 'creator locked');
    assert(row.auditState === 'CREATOR_LOCK', 'audit CREATOR_LOCK');
    assert(row.currentCategory === 'Romance', 'current Romance');
    assert(row.suggestedCategory === 'Cyber-Action', 'NLP still suggests Cyber-Action');
    assert(row.eligibleForApproval === false, 'not approval-eligible when locked');

    const blocked = applyAuditCategoryDecision(
        id,
        { title: 'Cyber Strike: Tokyo', category: 'Cyber-Action', action: 'accept' },
        { storage, patchCategory: false, asset }
    );
    assert(blocked.ok === false && blocked.reason === 'creator-lock', 'Accept blocked by creator lock');
}

console.log('\n[zero-write audit]');
{
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        fetchCalls += 1;
        return { ok: true, json: async () => ({}) };
    };
    await auditProductionCatalog([
        { id: 'zw-1', title: 'Cyber Strike: Tokyo', category: 'Trending', type: 'video', url: 'x.mp4' }
    ]);
    assert(fetchCalls === 0, 'audit does not call fetch/PATCH');
    globalThis.fetch = originalFetch;
}

console.log('\n[approval persistence behavior]');
{
    const storage = createMemoryStorage();
    const id = 'approve-1';
    const result = applyAuditCategoryDecision(
        id,
        { title: 'Love Me Until Morning', category: 'Romance', action: 'accept' },
        {
            storage,
            patchCategory: false,
            asset: { id, title: 'Love Me Until Morning', category: 'Trending', type: 'video' }
        }
    );
    assert(result.ok === true, 'accept persists locally');
    const leave = applyAuditCategoryDecision(
        id,
        { title: 'Love Me Until Morning', category: 'Romance', action: 'leave' },
        { storage, patchCategory: false, asset: { id } }
    );
    assert(leave.skipped === true, 'leave current skips persist');
}

console.log('\n[UI wiring]');
{
    const panel = fs.readFileSync(
        path.join(root, 'src/components/studio/SmartCategoryAuditPanel.svelte'),
        'utf8'
    );
    const studio = fs.readFileSync(
        path.join(root, 'src/components/experiences/StudioExperience.svelte'),
        'utf8'
    );
    assert(panel.includes('data-smart-category-audit'), 'audit panel marker');
    assert(panel.includes('data-current-distribution'), 'current distribution marker');
    assert(panel.includes('data-recommended-distribution'), 'recommended distribution marker');
    assert(panel.includes('data-audit-queue'), 'approval queue marker');
    assert(panel.includes('Approve Selected'), 'bulk approve control');
    assert(studio.includes('SmartCategoryAuditPanel'), 'Studio mounts audit panel');
    assert(!panel.includes('bulkPatchAll'), 'no auto bulk migrate helper');
}

if (failed > 0) {
    console.error(`\nFAIL — ${failed}`);
    process.exit(1);
}
console.log('\nPASS — phase-3a-production-category-audit');
process.exit(0);
