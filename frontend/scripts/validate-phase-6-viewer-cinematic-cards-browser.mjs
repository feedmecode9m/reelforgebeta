#!/usr/bin/env node
/**
 * Phase 6 — local Chromium viewer cinematic card smoke (no deploy / no mutations).
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { PHASE4_EXACT_MEDIA_IDENTITY } from '../src/lib/feed/identityBackedEditorialReview.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const FIXTURE = PHASE4_EXACT_MEDIA_IDENTITY.map((row, i) => ({
    id: row.productionId,
    title: row.currentProductionTitleAtForensics,
    name: row.currentProductionTitleAtForensics,
    category: i % 2 === 0 ? 'Trending' : 'Suspense',
    type: 'video',
    status: 'ready',
    url: `https://cdn.example/${row.matchedLocalFiles[0]}`,
    thumbnailUrl: `https://cdn.example/thumbs/${row.productionId}.jpg`
}));

let failed = 0;
function assert(cond, label) {
    if (cond) console.log(`  ✓ ${label}`);
    else {
        failed += 1;
        console.error(`  ✗ ${label}`);
    }
}

console.log('\n[phase-6-viewer-cinematic-cards-browser]');

const port = Number(process.env.PHASE6_VIEWER_SMOKE_PORT || 5197);
const server = await createServer({
    root,
    logLevel: 'error',
    server: { host: '127.0.0.1', port, strictPort: true }
});
await server.listen();
const frontendUrl = server.resolvedUrls?.local?.[0]?.replace(/\/$/, '') || `http://127.0.0.1:${port}`;
console.log(`  · local frontend ${frontendUrl}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err?.message || err).slice(0, 300)));

let categoryPatch = 0;
let catalogWrites = 0;

// Route only backend /api HTTP paths — never /src/lib/api/* modules.
await page.route((url) => {
    try {
        return new URL(url).pathname.startsWith('/api/');
    } catch {
        return false;
    }
}, async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const url = req.url();
    const pathname = new URL(url).pathname;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
        if (pathname === '/api/reels') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(FIXTURE)
            });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, items: [], events: [] })
        });
        return;
    }
    if (['PATCH', 'PUT', 'POST', 'DELETE'].includes(method)) {
        if (/\/api\/reels|\/category|title|description|catalog/i.test(url)) {
            catalogWrites += 1;
            if (/\/category/i.test(url) || method === 'PATCH') categoryPatch += 1;
            await route.fulfill({
                status: 403,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'blocked' })
            });
            return;
        }
    }
    await route.continue();
});

await page.route('**/videos/**', async (route) => {
    await route.fulfill({ status: 204, body: '' });
});
await page.route('**/thumbs/**', async (route) => {
    await route.fulfill({ status: 204, body: '' });
});
await page.route('**/cdn.example/**', async (route) => {
    await route.fulfill({ status: 204, body: '' });
});

try {
    await page.goto(frontendUrl + '/', { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForSelector('[data-viewer-cinematic-feed], .reelshort-feed-root, .shelf, .forge-loader', {
        timeout: 90_000
    });
    // Allow syncFromVault / safety loading timeout
    await page.waitForSelector('[data-viewer-semantic-card], [data-viewer-cinematic-feed]', {
        timeout: 90_000
    });
    await page.waitForTimeout(800);

    assert((await page.locator('[data-viewer-cinematic-feed]').count()) >= 1, 'cinematic feed root present');

    const cards = await page.locator('[data-viewer-semantic-card]').count();
    assert(cards >= 1, `viewer semantic cards render (got ${cards})`);

    const featured = await page.locator('[data-viewer-featured-card]').count();
    const rows = await page.locator('[data-viewer-discovery-row]').count();
    const grid = await page.locator('[data-viewer-browse-grid]').count();
    assert(featured >= 1, 'featured layout present');
    assert(rows >= 1, 'discovery rows present');
    if (cards > 1) assert(grid >= 1, 'browse grid present when multiple cards');

    const landscape = await page.evaluate(() => {
        const el = document.querySelector('[data-viewer-sem-media]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width > 0 ? r.width / r.height : null;
    });
    assert(
        landscape != null && Math.abs(landscape - 16 / 9) < 0.35,
        `landscape ~16:9 (got ${landscape})`
    );

    const brand = await page.evaluate(() => {
        const root = document.querySelector('[data-viewer-cinematic-feed]');
        if (!root) return ['missing'];
        const hits = [];
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) {
            if (/netflix|apple\s*tv\+?|\bimax\b/i.test(n.textContent || '')) {
                hits.push((n.textContent || '').trim().slice(0, 60));
            }
        }
        return hits;
    });
    assert(brand.length === 0, 'no external branding in viewer feed');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    assert((await page.locator('[data-viewer-semantic-card]').count()) >= 1, 'mobile cards remain');

    assert(categoryPatch === 0, 'category PATCH = 0');
    assert(catalogWrites === 0, 'catalog writes = 0');
    assert(pageErrors.length === 0, `no uncaught exceptions (${pageErrors.join(' | ') || 0})`);
} finally {
    await browser.close();
    await server.close();
}

const out = path.join(root, 'artifacts', 'phase-6-viewer-cinematic-cards-browser.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
    out,
    JSON.stringify(
        { status: failed === 0 ? 'PASS' : 'FAIL', categoryPatch, catalogWrites, pageErrors },
        null,
        2
    )
);

if (failed > 0) {
    console.error(`\nFAIL — ${failed}`);
    process.exit(1);
}
console.log('\nPASS — phase-6-viewer-cinematic-cards-browser');
process.exit(0);
