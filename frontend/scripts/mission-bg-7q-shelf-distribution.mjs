#!/usr/bin/env node
/**
 * BG-7Q — shelf distribution validation from live API (audit only).
 */
const API = process.env.API_URL || 'https://reelforge-deploy-production.up.railway.app/api/reels';

const SHELVES = ['Trending', 'Romance', 'Cyber-Action', 'Suspense'];

function mapFeedCategory(category) {
    const cat = String(category || 'Trending').trim();
    if (cat === 'Network') return 'Trending';
    if (cat === 'Love' || cat === 'Drama') return 'Romance';
    if (cat === 'Action') return 'Cyber-Action';
    if (SHELVES.includes(cat)) return cat;
    return 'Trending';
}

function assignReason(reel) {
    const cat = String(reel?.category || '').trim();
    if (SHELVES.includes(cat)) return `explicit category "${cat}"`;
    if (cat === 'HERO') return 'HERO is not a feed shelf; mapFeedCategory fallback → Trending';
    if (cat === 'Network') return 'alias Network → Trending';
    if (cat === 'Love' || cat === 'Drama') return `alias ${cat} → Romance`;
    if (cat === 'Action') return 'alias Action → Cyber-Action';
    if (!cat) return 'missing category; default → Trending';
    return `unknown category "${cat}"; fallback → Trending`;
}

async function main() {
    const res = await fetch(`${API}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`API ${res.status}`);
    const catalog = await res.json();

    const output = {
        Trending: [],
        Romance: [],
        'Cyber-Action': [],
        Suspense: []
    };

    const rows = catalog.map((reel) => {
        const assignedShelf = mapFeedCategory(reel.category);
        const entry = {
            id: reel.id,
            category: reel.category ?? null,
            genre: reel.genre ?? null,
            tags: reel.tags ?? reel.ai_tags ?? null,
            title: reel.name ?? null,
            assignedShelf,
            reason: assignReason(reel)
        };
        output[assignedShelf].push(entry.id);
        return entry;
    });

    const shelfCounts = Object.fromEntries(
        SHELVES.map((s) => [s, output[s].length])
    );

    console.info('[BG7Q_SHELF_REPORT]', {
        catalogCount: catalog.length,
        apiFields: catalog[0] ? Object.keys(catalog[0]).sort() : [],
        shelfCounts,
        canPopulateAllShelves: SHELVES.every((s) => shelfCounts[s] >= 1)
    });
    console.table(rows);
    console.log(JSON.stringify({ output, rows }, null, 2));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
