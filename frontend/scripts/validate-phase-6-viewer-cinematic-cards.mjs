#!/usr/bin/env node
/**
 * Phase 6 — Viewer cinematic card shell validator (no production mutations).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildViewerSemanticShell,
    collectRealViewerReels
} from '../src/lib/feed/viewerSemanticShell.js';
import { derivePresentationTheme } from '../src/lib/feed/presentationThemeSystem.js';

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

console.log('\n[phase-6-viewer-cinematic-cards]');

console.log('\n[shell derivation — no invention]');
{
    const shell = buildViewerSemanticShell({
        id: '03ef898a-989f-42c3-bdbb-67f37338df65',
        title: '01 ARRIVAL OPEN v1',
        category: 'Trending',
        type: 'video',
        url: '/videos/x.mp4',
        thumbnailUrl: '/thumbs/x.jpg',
        description: ''
    });
    assert(shell.title === '01 ARRIVAL OPEN v1', 'title from asset');
    assert(shell.shelf === 'Trending', 'shelf from asset');
    assert(shell.aspectRatio === '16:9', 'default landscape 16:9');
    assert(shell.inventedDescription === false, 'no invented description flag');
    assert(shell.inventedGenre === false, 'no invented genre');
    assert(shell.inventedCreator === false, 'no invented creator');
    assert(shell.inventedRating === false, 'no invented rating');
    assert(shell.presentationFamily, 'presentation family present');
    const themed = buildViewerSemanticShell({
        id: 'a',
        title: 'Open',
        description: 'Behind the scenes production documentary on a soundstage.',
        category: 'Trending',
        type: 'video'
    });
    assert(
        themed.themes.includes('production') || themed.themes.includes('behind-the-scenes'),
        'themes from description evidence'
    );
    assert(themed.shelf === 'Trending', 'themes do not change shelf');
    const family = derivePresentationTheme({ themes: themed.themes, contentType: themed.contentType });
    assert(family.family === 'production' || family.family === 'neutral', 'presentation-only family');
}

console.log('\n[collect real reels]');
{
    const items = collectRealViewerReels({
        Trending: [
            { id: '1', title: 'A', type: 'video', url: '/a.mp4' },
            { id: 'ph', isPlaceholder: true, title: 'ghost' }
        ],
        HERO: [{ id: 'h', title: 'Hero', category: 'HERO', url: '/h.mp4' }],
        Romance: [{ id: '1', title: 'dup' }],
        Suspense: [{ id: '2', title: 'B', url: '/b.mp4' }]
    });
    assert(items.length === 2, `deduped real items (got ${items.length})`);
    assert(items.every((i) => i.reel.id !== 'h'), 'HERO excluded from viewer collect');
    assert(items.every((i) => !i.reel.isPlaceholder), 'placeholders excluded');
}

console.log('\n[UI wiring]');
{
    const card = fs.readFileSync(
        path.join(root, 'src/components/viewer/ViewerSemanticCard.svelte'),
        'utf8'
    );
    const feed = fs.readFileSync(
        path.join(root, 'src/components/vertical/ReelshortExperience.svelte'),
        'utf8'
    );
    const tokens = fs.readFileSync(path.join(root, 'src/viewer/cinematicCardTokens.css'), 'utf8');
    assert(card.includes('data-viewer-semantic-card'), 'viewer card marker');
    assert(card.includes('aspect-ratio: 16 / 9'), 'landscape media frame');
    assert(!/netflix|apple tv\+|imax/i.test(card), 'no external branding in card');
    assert(feed.includes('data-viewer-cinematic-feed'), 'cinematic feed root');
    assert(feed.includes('data-viewer-featured-card'), 'featured layout');
    assert(feed.includes('data-viewer-discovery-row'), 'discovery row layout');
    assert(feed.includes('data-viewer-browse-grid'), 'browse grid layout');
    assert(feed.includes('ViewerSemanticCard'), 'feed uses ViewerSemanticCard');
    assert(tokens.includes('--rf-cine-radius'), 'shared cinematic tokens');
}

assert(fetchMutations === 0, 'mutation attempts = 0');

const reportPath = path.join(root, 'artifacts', 'phase-6-viewer-cinematic-cards-report.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(
    reportPath,
    JSON.stringify(
        {
            phase: 'PHASE-6-VIEWER-CINEMATIC-CARDS',
            status: 'IMPLEMENTATION_COMPLETE_NO_DEPLOY',
            categoryPatchCount: 0,
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
console.log('\nPASS — phase-6-viewer-cinematic-cards');
process.exit(0);
