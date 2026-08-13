#!/usr/bin/env node
/**
 * Phase 4 semantic cards — local Chromium Studio smoke (no deploy / no production writes).
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { openContentTab, unlockStudio } from '../tests/helpers/studio-navigation.mjs';
import { PHASE4_EXACT_MEDIA_IDENTITY } from '../src/lib/feed/identityBackedEditorialReview.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const FIXTURE_VIDEOS = PHASE4_EXACT_MEDIA_IDENTITY.map((row) => ({
    id: row.productionId,
    title: row.currentProductionTitleAtForensics,
    name: row.currentProductionTitleAtForensics,
    category: 'Trending',
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

console.log('\n[phase-4-semantic-cards-browser]');

const port = Number(process.env.PHASE4_SEM_SMOKE_PORT || 5195);
const server = await createServer({
    root,
    logLevel: 'error',
    server: { host: '127.0.0.1', port, strictPort: true }
});
await server.listen();
const frontendUrl = server.resolvedUrls?.local?.[0]?.replace(/\/$/, '') || `http://127.0.0.1:${port}`;
console.log(`  · local frontend ${frontendUrl}`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
/** @type {string[]} */
const pageErrors = [];
/** @type {string[]} */
const consoleErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err?.message || err).slice(0, 400)));
page.on('console', (msg) => {
    if (msg.type() === 'error') {
        const text = msg.text();
        if (/Failed to load resource|net::ERR_|WebSocket|favicon/i.test(text)) return;
        consoleErrors.push(text.slice(0, 400));
    }
});

let categoryPatch = 0;
let catalogWrites = 0;

await page.addInitScript(() => {
    try {
        localStorage.setItem('reelforge_admin_session_token', 'dev_local_session');
    } catch {
        /* ignore */
    }
});

await page.route('**/*', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const url = req.url();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
        if (/\/api\/reels(?:\?|$)/.test(url) && !/\/api\/reels\/[^/]+/.test(url)) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(FIXTURE_VIDEOS)
            });
            return;
        }
        if (/\/api\/health|\/health(?:\?|$)/.test(url)) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true, status: 'ok' })
            });
            return;
        }
        if (/\/api\/(sync|notifications|analytics|security|workflow|hero)\//i.test(url)) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true, items: [], events: [] })
            });
            return;
        }
        if (/\/(videos|thumbs|ingest)\//i.test(url)) {
            await route.fulfill({ status: 204, body: '' });
            return;
        }
        await route.continue();
        return;
    }
    if (method === 'POST' && /\/admin\/auth/i.test(url)) {
        await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'phase4_sem_smoke_offline_auth' })
        });
        return;
    }
    if (
        ['PATCH', 'PUT', 'POST', 'DELETE'].includes(method) &&
        (/\/api\/reels/i.test(url) ||
            /\/category/i.test(url) ||
            /\/api\/.*title/i.test(url) ||
            /\/api\/.*description/i.test(url) ||
            /\/api\/.*catalog/i.test(url))
    ) {
        catalogWrites += 1;
        if (/\/category/i.test(url) || method === 'PATCH') categoryPatch += 1;
        await route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'blocked' })
        });
        return;
    }
    await route.continue();
});

try {
    try {
        await unlockStudio(page, frontendUrl);
    } catch (unlockErr) {
        const diag = await page.evaluate(() => ({
            href: location.href,
            title: document.title,
            bodyText: (document.body?.innerText || '').slice(0, 500),
            hasGhost: Boolean(document.querySelector('.ghost-trigger')),
            token: localStorage.getItem('reelforge_admin_session_token')
        }));
        console.error('  · unlock failed diagnostics:', JSON.stringify(diag, null, 2));
        console.error('  · pageErrors:', pageErrors);
        console.error('  · consoleErrors:', consoleErrors.slice(0, 8));
        throw unlockErr;
    }

    await openContentTab(page);
    await page.evaluate(() => {
        document.querySelector('[data-semantic-production-cards]')?.scrollIntoView({
            block: 'center'
        });
        document.querySelector('[data-smart-category-audit]')?.scrollIntoView({
            block: 'center'
        });
    });
    await page.waitForSelector('[data-semantic-production-cards]', { timeout: 60_000 });
    await page.waitForSelector('[data-semantic-production-card]', { timeout: 60_000 });
    await page.waitForTimeout(800);

    assert((await page.locator('[data-semantic-production-cards]').count()) === 1, 'semantic panel renders');
    assert((await page.locator('[data-smart-category-audit]').count()) >= 1, 'Phase 3A audit still renders');
    const cards = await page.locator('[data-semantic-production-card]').count();
    assert(cards === 6, `six production cards render (got ${cards})`);

    const titles = await page.locator('[data-sem-title]').allTextContents();
    assert(titles.some((t) => /ARRIVAL/i.test(t)), 'Arrival title present');
    assert(titles.some((t) => /AMP JAM/i.test(t)), 'Amp Jam title present');
    assert(
        (await page.locator('[data-sem-handoff-label]').count()) >= 1,
        'human handoff labels present'
    );
    // Scope branding check to semantic cards (Studio may still have unrelated publishing-profile copy).
    const panelBrandHits = await page.evaluate(() => {
        const root = document.querySelector('[data-semantic-production-cards]');
        if (!root) return ['missing-panel'];
        const hits = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const t = String(node.textContent || '');
            if (/netflix|apple\s*tv\+?|\bimax\b/i.test(t)) hits.push(t.trim().slice(0, 80));
        }
        const html = root.innerHTML || '';
        if (/netflix|apple\s*tv\+?|\bimax\b/i.test(html)) {
            /* class names / attrs also count */
            if (!hits.length) hits.push('markup-match');
        }
        return hits;
    });
    assert(panelBrandHits.length === 0, `no fake external platform branding on cards (${panelBrandHits.join('|') || 'clean'})`);

    const apply = page.locator('[data-sem-manual-apply]').first();
    if (await apply.count()) await apply.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
    assert(categoryPatch === 0, 'category PATCH = 0');
    assert(catalogWrites === 0, 'catalog writes = 0');
    assert(pageErrors.length === 0, `no uncaught exceptions (${pageErrors.join(' | ') || 0})`);
} finally {
    await browser.close();
    await server.close();
}

const out = path.join(root, 'artifacts', 'phase-4-semantic-cards-browser.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
    out,
    JSON.stringify(
        {
            status: failed === 0 ? 'PASS' : 'FAIL',
            categoryPatch,
            catalogWrites,
            pageErrors,
            consoleErrors: consoleErrors.slice(0, 12)
        },
        null,
        2
    )
);

if (failed > 0) {
    console.error(`\nFAIL — ${failed}`);
    process.exit(1);
}
console.log('\nPASS — phase-4-semantic-cards-browser');
process.exit(0);
