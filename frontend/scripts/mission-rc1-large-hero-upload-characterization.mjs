#!/usr/bin/env node
/**
 * RC1-2026-07-18-001 — Large Hero Upload Characterization
 * Validation / timing only. No application code changes.
 *
 * Separates: upload transfer → ingestion → hero restore
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { unlockStudioWithHeroSection, readHeroStorage } from '../tests/helpers/studio-navigation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_ID = 'RC1-2026-07-18-001';
const FRONTEND_URL =
    process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app/';
const API_URL = (process.env.API_URL || 'https://strong-lolly-a9fcb4.netlify.app').replace(/\/$/, '');
const VIDEO_PATH =
    process.env.HERO_VAULT_VIDEO ||
    '/home/youloose2dafish/Downloads/condo_v1_2.mp4';
const OUT =
    process.env.OUT ||
    path.join(__dirname, '..', 'artifacts', 'rc1-large-hero-upload-characterization.json');
const WAIT_MS = Number(process.env.WAIT_MS || 20000);
const UPLOAD_WAIT_MS = Number(process.env.UPLOAD_WAIT_MS || 1800000);
const INGEST_POLL_MS = Number(process.env.INGEST_POLL_MS || 5000);
const INGEST_WAIT_MS = Number(process.env.INGEST_WAIT_MS || 900000);
const CHROMIUM =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const report = {
    mission: 'RC1-LARGE-HERO-UPLOAD-CHARACTERIZATION',
    release_id: RELEASE_ID,
    generatedAt: new Date().toISOString(),
    frontendUrl: FRONTEND_URL,
    apiUrl: API_URL,
    videoPath: VIDEO_PATH,
    videoSizeBytes: null,
    phases: [],
    testA_upload: {},
    testB_catalog: {},
    testC_restore: {},
    pass: false
};

function phase(name, detail = {}) {
    const row = { name, ts: new Date().toISOString(), ...detail };
    report.phases.push(row);
    console.info('[RC1_CHAR]', name, detail);
    return row;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function fetchCatalog() {
    const res = await fetch(`${API_URL}/api/reels?t=${Date.now()}`, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
    return res.json();
}

async function pollIngestion(reelId) {
    const started = Date.now();
    phase('INGESTION_STARTED', { reelId });
    while (Date.now() - started < INGEST_WAIT_MS) {
        const res = await fetch(`${API_URL}/api/reels/${encodeURIComponent(reelId)}`, {
            signal: AbortSignal.timeout(30000)
        });
        if (res.ok) {
            const body = await res.json();
            const status = String(body.status || body.reel?.status || '').toLowerCase();
            if (status === 'ready') {
                phase('INGESTION_COMPLETE', {
                    reelId,
                    elapsedMs: Date.now() - started,
                    url: body.url || body.video_url || null,
                    category: body.category || null
                });
                return body;
            }
            if (status === 'failed') {
                phase('INGESTION_FAILED', { reelId, body });
                return body;
            }
        }
        await sleep(INGEST_POLL_MS);
    }
    phase('INGESTION_TIMEOUT', { reelId, waitedMs: INGEST_WAIT_MS });
    return null;
}

async function runTestA(browser) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const postEvents = [];

    page.on('request', (req) => {
        if (req.method() === 'POST' && req.url().includes('/api/reels')) {
            postEvents.push({
                phase: 'request',
                url: req.url(),
                ts: new Date().toISOString(),
                t0: Date.now()
            });
        }
    });
    page.on('response', async (res) => {
        if (res.request().method() !== 'POST' || !res.url().includes('/api/reels')) return;
        let body = null;
        try {
            body = await res.json();
        } catch {
            body = null;
        }
        const reqEv = postEvents.find((e) => e.phase === 'request' && !e.status);
        const elapsedMs = reqEv?.t0 ? Date.now() - reqEv.t0 : null;
        postEvents.push({
            phase: 'response',
            status: res.status(),
            elapsedMs,
            id: body?.id || null,
            ingestStatus: body?.status || null,
            ts: new Date().toISOString()
        });
        phase('POST_COMPLETE', { status: res.status(), elapsedMs, reelId: body?.id || null });
    });

    phase('UPLOAD_STARTED', { file: path.basename(VIDEO_PATH), sizeBytes: report.videoSizeBytes });
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.evaluate(() => localStorage.removeItem('reelforge_hero_reel'));
    await unlockStudioWithHeroSection(page, FRONTEND_URL);

    const fileInput = page.locator('.hero-replace-section input[type="file"]');
    const selectT0 = Date.now();
    await fileInput.setInputFiles(VIDEO_PATH);
    phase('UPLOAD_BYTES_SENT', { note: 'setInputFiles dispatched to hero pipeline', elapsedMs: Date.now() - selectT0 });

    const deadline = Date.now() + UPLOAD_WAIT_MS;
    let heroState = null;
    let postResponse = null;
    while (Date.now() < deadline) {
        postResponse = postEvents.find((e) => e.phase === 'response');
        heroState = await readHeroStorage(page);
        if (postResponse?.id && heroState.reel?.id) break;
        await sleep(5000);
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(WAIT_MS);
    const afterRefresh = await readHeroStorage(page);

    report.testA_upload = {
        postEvents,
        heroAfterUpload: heroState,
        heroAfterRefresh: afterRefresh,
        uploadWaitMs: UPLOAD_WAIT_MS,
        ok: Boolean(postResponse?.status && postResponse.status < 300 && heroState?.reel?.id)
    };

    await ctx.close();
    return {
        reelId: postResponse?.id || heroState?.reel?.id || null,
        postStatus: postResponse?.status || null,
        postElapsedMs: postResponse?.elapsedMs || null
    };
}

async function runTestB(reelId, beforeIds) {
    phase('TEST_B_CATALOG_CHECK', { reelId });
    const catalog = await fetchCatalog();
    const byId = reelId ? catalog.find((r) => String(r.id) === String(reelId)) : null;
    const condoMatch = catalog.find((r) => {
        const n = String(r.name || r.fileName || '').toLowerCase();
        return n.includes('condo');
    });
    const reel = byId || condoMatch || catalog.find((r) => !beforeIds.has(String(r.id)));

    report.testB_catalog = {
        exists: Boolean(reel?.id),
        reel: reel
            ? {
                  id: reel.id,
                  name: reel.name || null,
                  fileName: reel.fileName || reel.filename || null,
                  status: reel.status || null,
                  category: reel.category || null,
                  url: reel.url || reel.video_url || null
              }
            : null,
        ok: Boolean(reel?.id)
    };

    if (reel?.id && String(reel.status || '').toLowerCase() !== 'ready') {
        await pollIngestion(reel.id);
        const refreshed = await fetch(`${API_URL}/api/reels/${encodeURIComponent(reel.id)}`).then((r) =>
            r.json()
        );
        report.testB_catalog.afterIngestPoll = {
            status: refreshed.status || null,
            url: refreshed.url || null
        };
    }

    return reel?.id || reelId;
}

async function runTestC(browser, heroAssetId) {
    if (!heroAssetId) {
        report.testC_restore = { skipped: true, reason: 'no_reel_id' };
        return;
    }

    const restoreEvents = [];
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('console', async (msg) => {
        if (!msg.text().includes('[BG7V_HERO_RESTORE_REASON]')) return;
        const parts = [];
        for (const arg of msg.args()) {
            try {
                parts.push(await arg.jsonValue());
            } catch {
                parts.push(msg.text());
            }
        }
        const payload = parts.find((p) => p && typeof p === 'object') || null;
        if (payload?.reason) restoreEvents.push({ ...payload, ts: new Date().toISOString() });
    });

    await page.addInitScript((assetId) => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem(
            'reelforge_hero_manager_config',
            JSON.stringify({
                heroType: 'TRENDING',
                backgroundSource: 'custom_video',
                heroAssetId: assetId,
                backgroundStyle: 'video',
                autoRotate: false,
                rotateIntervalMs: 30000,
                spotlightPriority: ['TRENDING'],
                seasonalCampaigns: [],
                carouselDurationMs: 8000
            })
        );
    }, heroAssetId);

    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(WAIT_MS);
    await page.evaluate(() => localStorage.removeItem('reelforge_hero_reel'));
    restoreEvents.length = 0;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(WAIT_MS);

    const trace = restoreEvents.find((e) => e.reason);
    const hero = await readHeroStorage(page);
    const ok =
        trace?.reason === 'RESTORE_SUCCESS' &&
        trace?.restored === true &&
        hero.reel?.id === heroAssetId;

    if (ok) phase('RESTORE_COMPLETE', { reelId: hero.reel.id, reason: trace.reason });
    else phase('RESTORE_INCOMPLETE', { trace, heroReelId: hero.reel?.id || null });

    report.testC_restore = { trace, hero, ok };
    await ctx.close();
}

async function main() {
    if (!fs.existsSync(VIDEO_PATH)) {
        throw new Error(`Missing video: ${VIDEO_PATH}`);
    }
    report.videoSizeBytes = fs.statSync(VIDEO_PATH).size;
    fs.mkdirSync(path.dirname(OUT), { recursive: true });

    const catalogBefore = await fetchCatalog();
    const beforeIds = new Set(catalogBefore.map((r) => String(r.id)));

    const launch = { headless: true };
    if (fs.existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;
    const browser = await chromium.launch(launch);

    const testA = await runTestA(browser);
    const reelId = await runTestB(testA.reelId, beforeIds);
    await runTestC(browser, reelId);

    await browser.close();

    report.completedAt = new Date().toISOString();
    report.pass =
        report.testA_upload.ok &&
        report.testB_catalog.ok &&
        report.testC_restore.ok === true;

    fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ pass: report.pass, artifact: OUT }, null, 2));
    process.exit(report.pass ? 0 : 1);
}

main().catch((err) => {
    report.error = err?.message || String(err);
    report.completedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
    console.error('[RC1_CHAR] failed', err);
    process.exit(1);
});
