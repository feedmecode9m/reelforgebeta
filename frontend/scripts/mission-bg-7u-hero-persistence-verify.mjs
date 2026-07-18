#!/usr/bin/env node
/**
 * BG-7U — Hero MP4 persistence verification (instrumentation / forensic only).
 * Tests production lifecycle: fresh → upload → refresh → identity restore boundary.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_URL =
    process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app/';
const API_URL =
    (process.env.API_URL || 'https://reelforge-deploy-production.up.railway.app').replace(/\/$/, '');
const OUT = process.env.OUT || '/tmp/bg-7u-hero-persistence.json';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Gaff1505!';
const WAIT_MS = Number(process.env.WAIT_MS || 15000);
const CHROMIUM =
    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const TRACE_TAGS = [
    '[BG7J_HERO_RESTORE]',
    '[BG7V_HERO_RESTORE_REASON]',
    '[BG7J_HERO_GATE]',
    '[BG7J_HYDRATION_READY]',
    '[HERO]',
    '[HERO_CLASSIFY]',
    'CONFIG_SAVE'
];

function ensureTestMp4() {
    const p = path.join(__dirname, '..', 'tests', 'tmp', 'bg-7u-hero.mp4');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (!fs.existsSync(p)) {
        execSync(
            `ffmpeg -y -f lavfi -i color=c=purple:s=640x360:d=3 -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${p}"`,
            { stdio: 'ignore' }
        );
    }
    return p;
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
    return { payload, text: msg.text(), wallMs: Date.now() };
}

function collectTraces(page, events) {
    page.on('console', async (msg) => {
        const text = msg.text();
        if (!TRACE_TAGS.some((t) => text.includes(t))) return;
        events.push(await parseConsole(msg));
    });
}

async function readHeroState(page) {
    return page.evaluate(() => {
        const keys = Object.keys(localStorage).filter((k) => k.includes('hero'));
        let reel = null;
        let mgr = null;
        try {
            reel = JSON.parse(localStorage.getItem('reelforge_hero_reel') || 'null');
        } catch {
            reel = null;
        }
        try {
            mgr = JSON.parse(localStorage.getItem('reelforge_hero_manager_config') || 'null');
        } catch {
            mgr = null;
        }
        const heroVideo = document.querySelector('.hero-background video, .hero-section video, video.hero-video');
        return {
            heroKeys: keys,
            reel,
            mgr,
            heroVideoSrc: heroVideo?.currentSrc || heroVideo?.src || null,
            heroVideoPresent: Boolean(heroVideo)
        };
    });
}

async function unlockStudioWithHero(page) {
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('.ghost-trigger', { timeout: 60000 });
    await page.click('.ghost-trigger');
    const pw = page.locator('.admin-login-panel input[type="password"]').first();
    if (await pw.count()) {
        await pw.fill(ADMIN_PASSWORD);
        const btn = page.locator('.admin-login-panel .submit-btn').first();
        if (await btn.count()) await btn.click();
        else await pw.press('Enter');
    }
    await page.waitForSelector('[data-production-command-center], .control-center-container', {
        timeout: 60000
    });
    await page.waitForTimeout(800);
    const tab = page.locator('#workspace-tab-content, [data-workspace-tab-button="content"]').first();
    if (await tab.count()) await tab.click();
    await page.waitForSelector('.hero-replace-section', { timeout: 60000 });
    await page.evaluate(() => {
        document.querySelector('.hero-replace-section')?.scrollIntoView({ block: 'center' });
    });
}

async function fetchHeroCatalog() {
    const res = await fetch(`${API_URL}/api/reels?t=${Date.now()}`);
    if (!res.ok) throw new Error(`catalog ${res.status}`);
    const reels = await res.json();
    return reels.filter((r) => String(r.category || '').toUpperCase() === 'HERO');
}

async function run() {
    const events = [];
    const report = {
        url: FRONTEND_URL,
        apiUrl: API_URL,
        tests: {}
    };

    const browser = await chromium.launch({
        headless: true,
        executablePath: fs.existsSync(CHROMIUM) ? CHROMIUM : undefined
    });

    // --- Test 1: Fresh production state ---
    {
        const context = await browser.newContext();
        const page = await context.newPage();
        collectTraces(page, events);
        await page.addInitScript(() => localStorage.clear());
        await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForTimeout(WAIT_MS);
        const state = await readHeroState(page);
        report.tests.freshSession = {
            heroReelAbsent: !state.reel?.id,
            heroManagerAbsent: !state.mgr?.heroAssetId,
            heroVideoPresent: state.heroVideoPresent,
            heroVideoSrc: state.heroVideoSrc,
            heroKeys: state.heroKeys,
            traces: events.filter((e) => e.text.includes('[BG7J') || e.text.includes('[HERO'))
        };
        await context.close();
    }

    // --- Test 2: Upload custom MP4 via Hero UI ---
    let uploadedReelId = null;
    let uploadedReelUrl = null;
    {
        const context = await browser.newContext();
        const page = await context.newPage();
        const uploadEvents = [];
        collectTraces(page, uploadEvents);
        await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.evaluate(() => localStorage.clear());
        await page.reload({ waitUntil: 'domcontentloaded' });
        const postUrls = [];
        page.on('request', (req) => {
            if (req.method() === 'POST' && req.url().includes('/api/reels')) postUrls.push(req.url());
        });

        await unlockStudioWithHero(page);
        const mp4 = ensureTestMp4();
        const fileInput = page.locator('.hero-replace-section input[type="file"]');
        await fileInput.setInputFiles(mp4);

        const deadline = Date.now() + 90000;
        while (Date.now() < deadline) {
            const state = await readHeroState(page);
            if (state.reel?.id && state.mgr?.heroAssetId) {
                uploadedReelId = state.reel.id;
                uploadedReelUrl = state.reel.url || null;
                break;
            }
            await page.waitForTimeout(1500);
        }

        const afterUpload = await readHeroState(page);
        report.tests.upload = {
            postCount: postUrls.length,
            reel: afterUpload.reel,
            mgr: afterUpload.mgr,
            heroVideoSrc: afterUpload.heroVideoSrc,
            expected: {
                heroAssetId: afterUpload.reel?.id || null,
                backgroundSource: 'custom_video'
            },
            ok: Boolean(
                afterUpload.reel?.id &&
                    afterUpload.mgr?.heroAssetId === afterUpload.reel.id &&
                    afterUpload.mgr?.backgroundSource === 'custom_video'
            ),
            traces: uploadEvents.filter((e) =>
                ['[BG7J_HERO_RESTORE]', '[HERO]', 'CONFIG_SAVE'].some((t) => e.text.includes(t))
            )
        };

        // --- Test 3: Hard refresh (same session localStorage) ---
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(WAIT_MS);
        const afterReload = await readHeroState(page);
        report.tests.hardRefresh = {
            reel: afterReload.reel,
            mgr: afterReload.mgr,
            heroVideoSrc: afterReload.heroVideoSrc,
            sameReelId: afterReload.reel?.id === uploadedReelId,
            sameUrl: Boolean(uploadedReelUrl && afterReload.reel?.url === uploadedReelUrl),
            ok: afterReload.reel?.id === uploadedReelId
        };

        // --- Test 4: Identity restore boundary (clear hero_reel only, keep manager) ---
        await page.evaluate(() => localStorage.removeItem('reelforge_hero_reel'));
        const restoreEvents = [];
        page.removeAllListeners('console');
        collectTraces(page, restoreEvents);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(WAIT_MS);
        const afterRestore = await readHeroState(page);
        const restoreTrace = restoreEvents.find((e) => e.text.includes('[BG7J_HERO_RESTORE]'));
        const bg7vRestoreTrace = restoreEvents.find((e) => e.text.includes('[BG7V_HERO_RESTORE_REASON]'));
        report.tests.identityRestore = {
            clearedHeroReelOnly: true,
            restoredReel: afterRestore.reel,
            mgr: afterRestore.mgr,
            restoreTrace: restoreTrace?.payload || null,
            bg7vRestoreTrace: bg7vRestoreTrace?.payload || null,
            restoreReason: bg7vRestoreTrace?.payload?.reason || restoreTrace?.payload?.reason || null,
            restoredFromApi: afterRestore.reel?.id === uploadedReelId,
            ok: afterRestore.reel?.id === uploadedReelId
        };

        report.tests.localStorage = {
            keys: afterRestore.heroKeys,
            reel: afterRestore.reel,
            hasVideoType: afterRestore.reel?.type === 'video' || String(afterRestore.reel?.url || '').includes('/videos/')
        };

        await context.close();
    }

    report.heroCatalog = await fetchHeroCatalog();
    report.summary = {
        freshDefaultOk: report.tests.freshSession?.heroReelAbsent !== false,
        uploadOk: report.tests.upload?.ok === true,
        hardRefreshOk: report.tests.hardRefresh?.ok === true,
        identityRestoreOk: report.tests.identityRestore?.ok === true,
        restoreReason: report.tests.identityRestore?.restoreReason || null,
        allPassed:
            report.tests.upload?.ok &&
            report.tests.hardRefresh?.ok &&
            report.tests.identityRestore?.ok
    };

    fs.writeFileSync(OUT, JSON.stringify({ report, events }, null, 2));
    console.info('[BG7U_HERO_PERSISTENCE]', report.summary);
    console.log(JSON.stringify(report, null, 2));

    if (!report.summary.allPassed) process.exit(1);
}

run().catch((err) => {
    console.error('[BG7U_HERO_PERSISTENCE] failed', err);
    process.exit(1);
});
