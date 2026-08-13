#!/usr/bin/env node
/**
 * Phase 3A — READ-ONLY production catalog smart-category audit.
 *
 * Fetches live GET /api/reels, runs auditProductionCatalog, writes artifact.
 * NEVER PATCHes. NEVER mutates production categories.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    auditProductionCatalog,
    explainTrendingReason
} from '../src/lib/feed/productionCategoryAudit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const FRONTEND = (process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app').replace(
    /\/$/,
    ''
);
const outPath = path.join(root, 'artifacts', 'phase-3a-production-category-audit.json');

let patchAttempts = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'PATCH' || method === 'PUT' || method === 'POST' || method === 'DELETE') {
        patchAttempts += 1;
        throw new Error(`BLOCKED mutation ${method} ${url}`);
    }
    return originalFetch(input, init);
};

function isVideo(row) {
    const kind = String(row.mediaKind || row.type || '').toLowerCase();
    if (kind === 'video' || row.isPersonalVideo) return true;
    return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(String(row.url || row.video_url || ''));
}

console.log('\n[phase-3a production audit — READ ONLY]');
console.log(`  source: ${FRONTEND}/api/reels`);

const res = await originalFetch(`${FRONTEND}/api/reels`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30000)
});
if (!res.ok) {
    console.error(`FAIL: GET /api/reels → ${res.status}`);
    process.exit(1);
}
const catalog = await res.json();
if (!Array.isArray(catalog)) {
    console.error('FAIL: /api/reels did not return an array');
    process.exit(1);
}

const report = await auditProductionCatalog(catalog);
const videos = report.eligible.filter((r) => {
    const raw = catalog.find((c) => String(c?.id) === String(r.id));
    return raw ? isVideo(raw) : String(r.mediaKind || '').toLowerCase() === 'video';
});

/** @type {Record<string, number>} */
const verdictCounts = { A: 0, B: 0, C: 0, D: 0, other: 0 };
for (const row of report.eligible) {
    const reason = explainTrendingReason(row);
    if (reason.startsWith('A')) verdictCounts.A += 1;
    else if (reason.startsWith('B')) verdictCounts.B += 1;
    else if (reason.startsWith('C')) verdictCounts.C += 1;
    else if (reason.startsWith('D')) verdictCounts.D += 1;
    else verdictCounts.other += 1;
}

const artifact = {
    auditedAt: report.auditedAt,
    source: `${FRONTEND}/api/reels`,
    readOnly: true,
    patchAttempts,
    inventory: {
        totalInput: report.totalInput,
        eligibleCount: report.eligibleCount,
        excludedCount: report.excludedCount,
        videoEligibleCount: videos.length,
        approvalEligibleCount: report.approvalEligibleCount
    },
    currentDistribution: report.currentDistribution,
    recommendedDistribution: report.recommendedDistribution,
    byState: report.byState,
    verdictCounts,
    videos: videos.map((r) => ({
        id: r.id,
        canonicalTitle: r.canonicalTitle,
        titleSource: r.titleSource,
        currentCategory: r.currentCategory,
        currentCategorySource: r.currentCategorySource,
        suggestedCategory: r.suggestedCategory,
        suggestedConfidence: r.suggestedConfidence,
        confidenceBand: r.confidenceBand,
        alternativeCategory: r.alternativeCategory,
        ambiguous: r.ambiguous,
        signals: r.signals,
        auditState: r.auditState,
        creatorLocked: r.creatorLocked,
        eligibleForApproval: r.eligibleForApproval,
        reason: explainTrendingReason(r)
    })),
    eligible: report.eligible.map((r) => ({
        id: r.id,
        canonicalTitle: r.canonicalTitle,
        mediaKind: r.mediaKind,
        currentCategory: r.currentCategory,
        currentCategorySource: r.currentCategorySource,
        suggestedCategory: r.suggestedCategory,
        suggestedConfidence: r.suggestedConfidence,
        confidenceBand: r.confidenceBand,
        alternativeCategory: r.alternativeCategory,
        ambiguous: r.ambiguous,
        signals: r.signals,
        auditState: r.auditState,
        creatorLocked: r.creatorLocked,
        eligibleForApproval: r.eligibleForApproval,
        recommendedShelf: r.recommendedShelf,
        reason: explainTrendingReason(r)
    }))
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2));

console.log('\n[inventory]');
console.log(`  total: ${report.totalInput}`);
console.log(`  eligible: ${report.eligibleCount}`);
console.log(`  excluded: ${report.excludedCount}`);
console.log(`  videos: ${videos.length}`);
console.log(`  approval-ready: ${report.approvalEligibleCount}`);

console.log('\n[CURRENT DISTRIBUTION]');
for (const [k, v] of Object.entries(report.currentDistribution)) {
    console.log(`  ${k}: ${v}`);
}
console.log('\n[RECOMMENDED DISTRIBUTION]');
for (const [k, v] of Object.entries(report.recommendedDistribution)) {
    console.log(`  ${k}: ${v}`);
}

console.log('\n[byState]');
for (const [k, v] of Object.entries(report.byState)) {
    if (v) console.log(`  ${k}: ${v}`);
}

console.log('\n[videos — full audit]');
console.log(
    'Title | Current | Recommended | Conf | State | Signals | Reason'
);
for (const r of videos) {
    console.log(
        `${r.canonicalTitle} | ${r.currentCategory} | ${r.suggestedCategory} | ${r.suggestedConfidence} | ${r.auditState} | ${(r.signals || []).slice(0, 4).join(';')} | ${explainTrendingReason(r)}`
    );
}

console.log('\n[verdict counts across eligible catalog]');
console.log(JSON.stringify(verdictCounts));

console.log(`\n[PATCH attempts during audit]: ${patchAttempts}`);
if (patchAttempts !== 0) {
    console.error('FAIL: mutation attempted during read-only audit');
    process.exit(1);
}

console.log(`\nWrote ${outPath}`);
console.log('PASS — phase-3a production audit (read-only, no mutations)');
process.exit(0);
