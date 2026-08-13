#!/usr/bin/env node
/**
 * Phase 6.2 — Semantic Premium Card Intelligence validator (no production mutations).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enrichSemanticCard } from '../src/lib/feed/semanticCardIntelligence.js';
import { buildViewerSemanticShell } from '../src/lib/feed/viewerSemanticShell.js';

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
    return { ok: true, json: async () => [] };
};

const FORBIDDEN_BADGE = /genre|rating|popular|star|imdb|netflix|apple\s*tv/i;
const WRITE_PATTERN =
    /saveCreatorCatalogMetadata|category\s*PATCH|method:\s*['"]PATCH['"]|PATCH\s*\/api\/reels|fetch\([^)]*method:\s*['"]PATCH/i;

console.log('\n[phase-6-2-semantic-card-intelligence]');

console.log('\n[enrichment — evidence → presentation]');
{
    const enriched = enrichSemanticCard({
        id: '03ef898a-989f-42c3-bdbb-67f37338df65',
        title: '01 ARRIVAL OPEN v1',
        fileName: '01_ARRIVAL_OPEN_v1.mp4',
        description: 'Behind the scenes production documentary on a soundstage.',
        tags: ['production'],
        category: 'Trending',
        type: 'video',
        url: '/videos/x.mp4',
        thumbnailUrl: '/thumbs/x.jpg',
        duration: 125,
        width: 1920,
        height: 1080
    });
    assert(enriched.title === '01 ARRIVAL OPEN v1', 'title from asset');
    assert(enriched.shelf === 'Trending', 'approved shelf only');
    assert(enriched.mediaType === 'video', 'media type video');
    assert(enriched.durationLabel === '2:05', `duration label (got ${enriched.durationLabel})`);
    assert(enriched.resolution === '1920×1080', `resolution (got ${enriched.resolution})`);
    assert(
        enriched.themes.includes('production') || enriched.themes.includes('behind-the-scenes'),
        'themes from evidence'
    );
    assert(Boolean(enriched.mood) || enriched.themes.length > 0, 'mood or themes present');
    assert(enriched.presentation?.family, 'visual theme / presentation family');
    assert(Array.isArray(enriched.badges), 'badges array');
    assert(
        enriched.badges.every((b) => !FORBIDDEN_BADGE.test(String(b))),
        'badges are presentation-only (no genre/rating/popularity)'
    );
    assert(enriched.displayHierarchy?.title === enriched.title, 'hierarchy title');
    assert(enriched.suggestedCategory === '', 'enrichment never sets suggestedCategory');
    assert(enriched.categoryWritten === false, 'categoryWritten false');
}

console.log('\n[no invention — missing fields stay empty]');
{
    const sparse = enrichSemanticCard({
        id: 'sparse-1',
        type: 'video',
        url: '/videos/y.mp4'
    });
    assert(sparse.title === '', 'no invented title');
    assert(sparse.description === '', 'no invented description');
    assert(sparse.inventedDescription === false, 'inventedDescription false');
    assert(sparse.inventedGenre === false, 'inventedGenre false');
    assert(sparse.inventedCreator === false, 'inventedCreator false');
    assert(sparse.inventedEpisode === false, 'inventedEpisode false');
    assert(sparse.inventedRating === false, 'inventedRating false');
    assert(sparse.displayHierarchy.title === '', 'hierarchy title empty');
    assert(sparse.shelf === '', 'no shelf invented');
}

console.log('\n[themes never rewrite shelf]');
{
    const themed = enrichSemanticCard({
        id: 't1',
        title: 'Club Night',
        description: 'Music club intensity action cyber neon.',
        category: 'Suspense',
        type: 'video'
    });
    assert(themed.shelf === 'Suspense', 'shelf unchanged by themes');
    assert(themed.suggestedCategory === '', 'no suggested shelf written');
}

console.log('\n[viewer shell consumes enrichment]');
{
    const shell = buildViewerSemanticShell({
        id: 'a',
        title: 'Open',
        description: 'Behind the scenes production documentary.',
        category: 'Trending',
        type: 'video',
        duration: 60,
        width: 1280,
        height: 720
    });
    assert(Array.isArray(shell.badges), 'shell exposes badges');
    assert(shell.displayHierarchy, 'shell exposes displayHierarchy');
    assert(shell.mood !== undefined, 'shell exposes mood');
    assert(shell.audience !== undefined, 'shell exposes audience');
    assert(shell.mediaType === 'video', 'shell mediaType');
    assert(shell.categoryWritten === false, 'shell categoryWritten false');
}

console.log('\n[static write gates]');
{
    const intel = fs.readFileSync(
        path.join(root, 'src/lib/feed/semanticCardIntelligence.js'),
        'utf8'
    );
    const shellSrc = fs.readFileSync(
        path.join(root, 'src/lib/feed/viewerSemanticShell.js'),
        'utf8'
    );
    const card = fs.readFileSync(
        path.join(root, 'src/components/viewer/ViewerSemanticCard.svelte'),
        'utf8'
    );
    assert(!WRITE_PATTERN.test(intel), 'intelligence module has no category writes');
    assert(!WRITE_PATTERN.test(shellSrc), 'viewer shell has no category writes');
    assert(intel.includes('enrichSemanticCard'), 'enrichSemanticCard export');
    assert(shellSrc.includes('enrichSemanticCard'), 'shell uses enrichSemanticCard');
    assert(card.includes('data-viewer-sem-badges') || card.includes('viewer-sem-card__badges'), 'card badges UI');
    assert(card.includes('data-viewer-sem-title-overlay'), 'title overlay');
    assert(card.includes('data-viewer-sem-title-empty'), 'untitled empty state');
    assert(card.includes('data-viewer-sem-empty-media'), 'empty media state');
    assert(card.includes('data-viewer-sem-hierarchy'), 'hierarchy marker');
}

console.log('\n[mutation attempts]');
assert(fetchMutations === 0, `mutation attempts = 0 (got ${fetchMutations})`);

const report = {
    phase: 'PHASE-6-2-SEMANTIC-CARD-INTELLIGENCE',
    status: failed ? 'FAIL' : 'IMPLEMENTATION_COMPLETE_NO_DEPLOY',
    categoryPatchCount: 0,
    titleWrites: 0,
    descriptionWrites: 0,
    deploy: 0,
    fetchMutations
};
const outPath = path.join(root, 'artifacts/phase-6-2-semantic-card-intelligence-report.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`  · wrote ${outPath}`);

if (failed) {
    console.error(`\nFAIL — phase-6-2-semantic-card-intelligence (${failed} assertions)`);
    process.exit(1);
}
console.log('\nPASS — phase-6-2-semantic-card-intelligence\n');
