#!/usr/bin/env node
/**
 * BG-7R.3 — Reassign production catalog categories via PATCH /api/reels/{id}/category.
 * Requires backend with real update_reel_category handler deployed.
 */
const API_BASE = (process.env.API_URL || 'https://reelforge-deploy-production.up.railway.app').replace(
    /\/$/,
    ''
);

const REASSIGNMENTS = [
    { id: 'd96e274d-5b7a-4387-9a15-4b6ba3efc3b9', category: 'Romance', note: 'IMG_0113 image' },
    { id: '3004f952-c60d-429b-a247-760ab636e059', category: 'Cyber-Action', note: 'IMG_0121 image' },
    { id: '3538ddd6-463d-46df-b896-2df21e57e99e', category: 'Suspense', note: 'Bg7g Live Trace video (was HERO)' }
];

const SHELVES = ['Trending', 'Romance', 'Cyber-Action', 'Suspense'];

function mapFeedCategory(category) {
    const cat = String(category || 'Trending').trim();
    if (cat === 'Network') return 'Trending';
    if (cat === 'Love' || cat === 'Drama') return 'Romance';
    if (cat === 'Action') return 'Cyber-Action';
    if (SHELVES.includes(cat)) return cat;
    return 'Trending';
}

async function patchCategory(id, category) {
    const res = await fetch(`${API_BASE}/api/reels/${id}/category`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category })
    });
    const text = await res.text();
    let body;
    try {
        body = JSON.parse(text);
    } catch {
        body = { raw: text };
    }
    return { ok: res.ok, status: res.status, body };
}

async function fetchCatalog() {
    const res = await fetch(`${API_BASE}/api/reels?t=${Date.now()}`);
    if (!res.ok) throw new Error(`GET /api/reels ${res.status}`);
    return res.json();
}

async function main() {
    console.info('[BG7R_REPAIR] starting', { api: API_BASE, count: REASSIGNMENTS.length });

    for (const row of REASSIGNMENTS) {
        const result = await patchCategory(row.id, row.category);
        console.info('[BG7R_REPAIR] patch', {
            id: row.id,
            category: row.category,
            note: row.note,
            status: result.status,
            body: result.body
        });
        if (!result.ok) {
            throw new Error(`PATCH failed for ${row.id}: ${JSON.stringify(result.body)}`);
        }
        if (result.body?.updated !== true && !result.body?.category) {
            throw new Error(
                `PATCH returned success but handler may still be stub for ${row.id}: ${JSON.stringify(result.body)}`
            );
        }
    }

    const catalog = await fetchCatalog();
    const shelfCounts = Object.fromEntries(SHELVES.map((s) => [s, 0]));
    for (const reel of catalog) {
        const shelf = mapFeedCategory(reel.category);
        shelfCounts[shelf] = (shelfCounts[shelf] || 0) + 1;
    }

    console.info('[BG7R_REPAIR] post-repair shelfCounts', shelfCounts);
    console.info('[BG7R_REPAIR] canPopulateAllShelves', SHELVES.every((s) => shelfCounts[s] >= 1));
    console.table(
        catalog.map((r) => ({
            id: r.id,
            name: r.name,
            category: r.category,
            assignedShelf: mapFeedCategory(r.category)
        }))
    );
}

main().catch((e) => {
    console.error('[BG7R_REPAIR] failed', e.message || e);
    process.exit(1);
});
