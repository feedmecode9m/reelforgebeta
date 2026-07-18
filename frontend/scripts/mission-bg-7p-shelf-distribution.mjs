#!/usr/bin/env node
/** BG-7P — prove shelf assignment from production catalog (no browser). */
const API = process.env.API_URL || 'https://reelforge-deploy-production.up.railway.app/api/reels';

function mapFeedCategory(category) {
    const shelves = ['Trending', 'Romance', 'Cyber-Action', 'Suspense'];
    const cat = String(category || 'Trending').trim();
    if (cat === 'Network') return 'Trending';
    if (cat === 'Love' || cat === 'Drama') return 'Romance';
    if (cat === 'Action') return 'Cyber-Action';
    if (shelves.includes(cat)) return cat;
    return 'Trending';
}

async function main() {
    const catalog = await fetch(`${API}?t=${Date.now()}`).then((r) => r.json());
    const rows = catalog.map((r) => ({
        id: String(r.id).slice(0, 8),
        apiCategory: r.category,
        mappedShelf: mapFeedCategory(r.category),
        type: r.type
    }));
    const counts = { Trending: 0, Romance: 0, 'Cyber-Action': 0, Suspense: 0 };
    for (const row of rows) counts[row.mappedShelf] += 1;
    console.info('[BG7P_CATALOG_TO_SHELF]', { shelfCounts: counts, total: catalog.length });
    console.table(rows);
}

main();
