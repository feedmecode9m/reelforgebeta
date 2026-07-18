#!/usr/bin/env node
/**
 * BG-7V — Isolated hero restore reason smoke (Test 4 boundary only).
 * Seeds manager config + clears hero_reel, reloads, captures [BG7V_HERO_RESTORE_REASON].
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:4173/';
const HERO_ASSET_ID =
    process.env.HERO_ASSET_ID || 'aa0691a3-69da-46d6-9ffd-a7f20cf7c976';
const CHROMIUM =
    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const WAIT_MS = Number(process.env.WAIT_MS || 20000);

const MOCK_HERO_REEL = {
    id: HERO_ASSET_ID,
    name: 'Bg 7u Hero',
    fileName: `${HERO_ASSET_ID}.mp4`,
    type: 'video',
    url: `https://strong-lolly-a9fcb4.netlify.app/videos/${HERO_ASSET_ID}.mp4`,
    thumbnailUrl: `https://strong-lolly-a9fcb4.netlify.app/thumbs/${HERO_ASSET_ID}.jpg`,
    thumbnailPath: `/thumbs/${HERO_ASSET_ID}.jpg`,
    category: 'HERO',
    status: 'ready',
    validated: true,
    createdAt: '2026-07-18T05:31:30.982772+00:00'
};

async function installApiMocks(page) {
    await page.route('**/api/health**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true })
        })
    );
    await page.route('**/health**', (route) => {
        if (route.request().url().includes('/api/')) return route.fallback();
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true })
        });
    });
    await page.route('**/api/reels**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([MOCK_HERO_REEL])
        })
    );
}

async function parseConsole(msg) {
    const parts = [];
    for (const arg of msg.args()) {
        try {
            parts.push(await arg.jsonValue());
        } catch {
            parts.push(arg.toString());
        }
    }
    const payload = parts.find((p) => p && typeof p === 'object' && !Array.isArray(p)) || null;
    return { payload, text: msg.text() };
}

async function run() {
    const events = [];
    const browser = await chromium.launch({
        headless: true,
        executablePath: fs.existsSync(CHROMIUM) ? CHROMIUM : undefined
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    await installApiMocks(page);
    page.on('console', async (msg) => {
        const text = msg.text();
        if (
            text.includes('[BG7V_HERO_RESTORE_REASON]') ||
            text.includes('[BG7J_HERO_RESTORE]') ||
            text.includes('[mediaBootstrap]') ||
            text.includes('[VAULT_BOOTSTRAP]')
        ) {
            events.push(await parseConsole(msg));
        }
    });

    await page.addInitScript(
        ({ heroAssetId }) => {
            localStorage.clear();
            localStorage.setItem(
                'reelforge_hero_manager_config',
                JSON.stringify({
                    heroType: 'TRENDING',
                    backgroundSource: 'custom_video',
                    heroAssetId,
                    backgroundStyle: 'video',
                    autoRotate: false,
                    rotateIntervalMs: 30000,
                    spotlightPriority: ['TRENDING'],
                    seasonalCampaigns: [],
                    carouselDurationMs: 8000
                })
            );
        },
        { heroAssetId: HERO_ASSET_ID }
    );

    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForTimeout(WAIT_MS);

    const bg7v = events.find((e) => e.text.includes('[BG7V_HERO_RESTORE_REASON]'));
    const bg7j = events.find((e) => e.text.includes('[BG7J_HERO_RESTORE]'));

    const reel = await page.evaluate(() => {
        try {
            return JSON.parse(localStorage.getItem('reelforge_hero_reel') || 'null');
        } catch {
            return null;
        }
    });

    const mgr = await page.evaluate(() => {
        try {
            return JSON.parse(localStorage.getItem('reelforge_hero_manager_config') || 'null');
        } catch {
            return null;
        }
    });

    const result = {
        heroAssetId: HERO_ASSET_ID,
        bg7vRestoreTrace: bg7v?.payload || null,
        bg7jRestoreTrace: bg7j?.payload || null,
        restoreReason: bg7v?.payload?.reason || null,
        restoredReel: reel,
        mgrHeroAssetId: mgr?.heroAssetId || null,
        bootstrapEvents: events.filter((e) => e.text.includes('bootstrap') || e.text.includes('VAULT')),
        allRestoreEvents: events,
        ok: Boolean(bg7v?.payload?.reason)
    };

    console.info('[BG7V_RESTORE_SMOKE]', JSON.stringify(result, null, 2));
    await browser.close();

    if (!result.restoreReason) process.exit(1);
}

run().catch((err) => {
    console.error('[BG7V_RESTORE_SMOKE] failed', err);
    process.exit(1);
});
