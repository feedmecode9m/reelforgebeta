#!/usr/bin/env node
/**
 * BG-7S — validate presentation-only shelf padding (no feed mutation).
 */
import {
    fillShelfPresentation,
    MIN_SHELF_PRESENTATION_COUNT,
    isRealShelfCard
} from '../src/lib/feed/fillShelfPresentation.js';

const API = (process.env.API_URL || 'https://reelforge-deploy-production.up.railway.app').replace(
    /\/$/,
    ''
);

const SHELVES = ['Trending', 'Romance', 'Cyber-Action', 'Suspense'];

function mapFeedCategory(category) {
    const cat = String(category || 'Trending').trim();
    if (cat === 'Network') return 'Trending';
    if (cat === 'Love' || cat === 'Drama') return 'Romance';
    if (cat === 'Action') return 'Cyber-Action';
    if (SHELVES.includes(cat)) return cat;
    return 'Trending';
}

async function fetchCatalog() {
    const res = await fetch(`${API}/api/reels?t=${Date.now()}`);
    if (!res.ok) throw new Error(`GET /api/reels ${res.status}`);
    return res.json();
}

function buildFeedFromCatalog(catalog) {
    /** @type {Record<string, Array<Record<string, unknown>>>} */
    const feed = Object.fromEntries(SHELVES.map((s) => [s, []]));
    for (const reel of catalog) {
        const shelf = mapFeedCategory(reel.category);
        feed[shelf].push({ ...reel, category: shelf });
    }
    return feed;
}

function validateShelfPresentation() {
    const cases = [
        { shelf: 'Trending', items: [{ id: 'a' }, { id: 'b' }] },
        { shelf: 'Romance', items: [{ id: 'c' }] },
        { shelf: 'Cyber-Action', items: [{ id: 'd' }] },
        { shelf: 'Suspense', items: [{ id: 'e' }] }
    ];

    const rows = cases.map(({ shelf, items }) => {
        const display = fillShelfPresentation(items, shelf);
        const realCount = display.filter(isRealShelfCard).length;
        const fillerCount = display.filter((r) => r.isPresentationOnly).length;
        return {
            shelf,
            realCount,
            displayCount: display.length,
            fillerCount,
            ok: realCount === items.length && display.length === MIN_SHELF_PRESENTATION_COUNT
        };
    });

    return rows;
}

async function main() {
    const catalog = await fetchCatalog();
    const feed = buildFeedFromCatalog(catalog);

    const rows = SHELVES.map((shelf) => {
        const realItems = feed[shelf] || [];
        const display = fillShelfPresentation(realItems, shelf);
        const realCount = display.filter(isRealShelfCard).length;
        const fillerCount = display.filter((r) => r.isPresentationOnly).length;
        const touchesFeedStore = display.some((r) => realItems.includes(r) === false && !r.isPresentationOnly);
        return {
            shelf,
            realCount,
            displayCount: display.length,
            fillerCount,
            feedUnchanged: realItems.length === realCount,
            presentationOnlyFillers: fillerCount === display.length - realCount,
            noFeedMutation: !touchesFeedStore
        };
    });

    const synthetic = validateShelfPresentation();
    const allDisplayFive = rows.every((r) => r.displayCount === MIN_SHELF_PRESENTATION_COUNT);
    const allSyntheticOk = synthetic.every((r) => r.ok);

    console.info('[BG7S_VALIDATION]', {
        minVisible: MIN_SHELF_PRESENTATION_COUNT,
        catalogCount: catalog.length,
        allDisplayFive,
        allSyntheticOk,
        rows,
        synthetic
    });

    if (!allDisplayFive || !allSyntheticOk) {
        throw new Error('BG-7S shelf presentation validation failed');
    }
}

main().catch((e) => {
    console.error('[BG7S_VALIDATION] failed', e.message || e);
    process.exit(1);
});
