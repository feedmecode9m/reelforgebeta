#!/usr/bin/env node
/**
 * RC1 Hero Background Vault Acceptance — condo_v1_2.mp4
 * Validation only. No application code changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
    unlockStudioWithHeroSection,
    readHeroStorage
} from '../tests/helpers/studio-navigation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_ID = 'RC1-2026-07-18-001';
const FRONTEND_URL =
    process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app/';
const API_URL = (process.env.API_URL || 'https://reelforge-deploy-production.up.railway.app').replace(
    /\/$/,
    ''
);
const VIDEO_PATH =
    process.env.HERO_VAULT_VIDEO ||
    '/home/youloose2dafish/Downloads/condo_v1_2.mp4';
const OUT = path.join(__dirname, '..', 'artifacts', 'mission-rc1-hero-vault-condo-v1-2.json');
const WAIT_MS = Number(process.env.WAIT_MS || 20000);
const UPLOAD_WAIT_MS = Number(process.env.UPLOAD_WAIT_MS || 900000);
const CHROMIUM =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const report = {
    mission: 'RC1-HERO-VAULT-CONDO-V1-2',
    release_id: RELEASE_ID,
    generatedAt: new Date().toISOString(),
    frontendUrl: FRONTEND_URL,
    apiUrl: API_URL,
    videoPath: VIDEO_PATH,
    videoSizeBytes: null,
    deployGate: {},
    browserA: {},
    catalog: {},
    browserB: {},
    classification: null,
    pass: false
};

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function fetchProductionBundle() {
    const html = await fetch(FRONTEND_URL, { signal: AbortSignal.timeout(30000) }).then((r) => r.text());
    const match = html.match(/assets\/index-([A-Za-z0-9_-]+)\.js/);
    const bundleJs = await fetch(`${FRONTEND_URL.replace(/\/$/, '')}/assets/index-${match?.[1]}.js`, {
        signal: AbortSignal.timeout(120000)
    }).then((r) => r.text());
    return {
        bundle: match ? `assets/index-${match[1]}.js` : null,
        hasBg7vMarker: bundleJs.includes('BG7V_HERO_RESTORE_REASON')
    };
}

async function fetchCatalog() {
    const res = await fetch(`${API_URL}/api/reels?t=${Date.now()}`, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
    return res.json();
}

function findCondoReel(catalog, reelIdHint) {
    if (reelIdHint) {
        const byId = catalog.find((r) => String(r.id) === String(reelIdHint));
        if (byId) return byId;
    }
    return catalog.find((r) => {
        const name = String(r.name || r.fileName || r.filename || '').toLowerCase();
        const url = String(r.url || r.video_url || '').toLowerCase();
        return name.includes('condo') || url.includes('condo');
    });
}

async function readStageHeroVideo(page) {
    return page.evaluate(() => {
        const v =
            document.querySelector('.hero-stage .hero-video') ||
            document.querySelector('.hero-background video.hero-media') ||
            document.querySelector('.hero-video-container video') ||
            document.querySelector('.hero-background video');
        return v
            ? { src: v.currentSrc || v.src || '', readyState: v.readyState, paused: v.paused }
            : null;
    });
}

function collectBg7vTraces(page, events) {
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
        events.push({ ...payload, ts: new Date().toISOString() });
    });
}

function classifyFailure(report) {
    if (!report.deployGate.ok) return 'deployment';
    if (!report.browserA.upload?.ok) return 'A';
    if (!report.catalog?.ok) return 'B';
    if (!report.browserA.refresh?.ok) return 'C';
    if (!report.browserB.restore?.ok) return 'D';
    return null;
}

async function main() {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });

    if (!fs.existsSync(VIDEO_PATH)) {
        report.error = `Missing video: ${VIDEO_PATH}`;
        report.classification = 'environment';
        fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
        process.exit(1);
    }
    report.videoSizeBytes = fs.statSync(VIDEO_PATH).size;

    const deploy = await fetchProductionBundle();
    report.deployGate = {
        bundle: deploy.bundle,
        expectedBundle: 'assets/index-DQeGd3cl.js',
        hasBg7vMarker: deploy.hasBg7vMarker,
        ok: deploy.bundle === 'assets/index-DQeGd3cl.js' && deploy.hasBg7vMarker
    };

    const catalogBefore = await fetchCatalog();
    const beforeIds = new Set(catalogBefore.map((r) => String(r.id)));

    const launch = { headless: true };
    if (fs.existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;
    const browser = await chromium.launch(launch);

    const uploadNetwork = [];
    let uploadedReelId = null;

    // --- Browser A: upload ---
    {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        page.setDefaultTimeout(120000);

        page.on('request', (req) => {
            if (req.method() === 'POST' && req.url().includes('/api/reels')) {
                uploadNetwork.push({
                    phase: 'request',
                    url: req.url(),
                    ts: new Date().toISOString()
                });
            }
        });
        page.on('response', async (res) => {
            if (res.request().method() === 'POST' && res.url().includes('/api/reels')) {
                let body = null;
                try {
                    body = await res.json();
                } catch {
                    body = null;
                }
                uploadNetwork.push({
                    phase: 'response',
                    status: res.status(),
                    id: body?.id || null,
                    url: body?.url || null,
                    fileName: body?.fileName || body?.filename || null,
                    category: body?.category || null,
                    type: body?.type || null,
                    ts: new Date().toISOString()
                });
            }
        });

        await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.evaluate(() => {
            localStorage.removeItem('reelforge_hero_reel');
        });
        await unlockStudioWithHeroSection(page, FRONTEND_URL);

        const fileInput = page.locator('.hero-replace-section input[type="file"]');
        await fileInput.setInputFiles(VIDEO_PATH);

        const uploadDeadline = Date.now() + UPLOAD_WAIT_MS;
        let heroAfterUpload = null;
        while (Date.now() < uploadDeadline) {
            heroAfterUpload = await readHeroStorage(page);
            const responses = uploadNetwork.filter((n) => n.phase === 'response');
            const lastOk = responses.find((r) => r.status >= 200 && r.status < 300);
            if (heroAfterUpload.reel?.id && lastOk?.id) {
                uploadedReelId = heroAfterUpload.reel.id;
                break;
            }
            await sleep(3000);
        }

        const stageVideo = await readStageHeroVideo(page);
        const uploadResponse = uploadNetwork.filter((n) => n.phase === 'response').pop() || null;

        report.browserA.upload = {
            ok: Boolean(
                uploadedReelId &&
                    heroAfterUpload?.mgr?.heroAssetId === uploadedReelId &&
                    heroAfterUpload?.mgr?.backgroundSource === 'custom_video'
            ),
            uploadNetwork,
            uploadResponse,
            heroIdentity: {
                reel: heroAfterUpload?.reel || null,
                mgr: heroAfterUpload?.mgr
                    ? {
                          heroAssetId: heroAfterUpload.mgr.heroAssetId,
                          backgroundSource: heroAfterUpload.mgr.backgroundSource
                      }
                    : null
            },
            stageVideo,
            reelId: uploadedReelId
        };

        await page.reload({ waitUntil: 'domcontentloaded' });
        await sleep(WAIT_MS);
        const heroAfterRefresh = await readHeroStorage(page);
        const stageAfterRefresh = await readStageHeroVideo(page);

        report.browserA.refresh = {
            ok:
                heroAfterRefresh.reel?.id === uploadedReelId &&
                Boolean(stageAfterRefresh?.src),
            heroIdentity: {
                reel: heroAfterRefresh.reel,
                mgr: heroAfterRefresh.mgr
            },
            stageVideo: stageAfterRefresh,
            reelId: heroAfterRefresh.reel?.id || null
        };

        await ctx.close();
    }

    // --- Catalog API ---
    {
        const catalog = await fetchCatalog();
        const reel =
            findCondoReel(catalog, uploadedReelId) ||
            catalog.find((r) => !beforeIds.has(String(r.id)));
        report.catalog = {
            ok: Boolean(reel?.id),
            reel: reel
                ? {
                      id: reel.id,
                      fileName: reel.fileName || reel.filename || null,
                      url: reel.url || reel.video_url || reel.videoUrl || null,
                      category: reel.category || null,
                      type: reel.type || null,
                      name: reel.name || null
                  }
                : null,
            newReelIds: catalog.filter((r) => !beforeIds.has(String(r.id))).map((r) => r.id)
        };
        if (!uploadedReelId && reel?.id) uploadedReelId = String(reel.id);
    }

    // --- Browser B: fresh restore boundary (manager from catalog id, not A localStorage) ---
    {
        const restoreEvents = [];
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        collectBg7vTraces(page, restoreEvents);

        const heroAssetId =
            uploadedReelId || report.catalog.reel?.id || report.browserA.upload.reelId;

        await page.addInitScript((assetId) => {
            localStorage.clear();
            sessionStorage.clear();
            if (assetId) {
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
            }
        }, heroAssetId);

        await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await sleep(WAIT_MS);

        const bootstrapTrace = restoreEvents.find((e) => e.reason);
        const heroBootstrap = await readHeroStorage(page);

        await page.evaluate(() => localStorage.removeItem('reelforge_hero_reel'));
        restoreEvents.length = 0;
        await page.reload({ waitUntil: 'domcontentloaded' });
        await sleep(WAIT_MS);

        const restoreTrace = restoreEvents.find((e) => e.reason);
        const heroAfterRestore = await readHeroStorage(page);
        const stageB = await readStageHeroVideo(page);

        report.browserB = {
            freshContext: true,
            copiedLocalStorageFromA: false,
            heroAssetIdFromCatalog: heroAssetId,
            bootstrap: {
                trace: bootstrapTrace || null,
                heroReelId: heroBootstrap.reel?.id || null
            },
            restore: {
                ok:
                    restoreTrace?.reason === 'RESTORE_SUCCESS' &&
                    restoreTrace?.restored === true &&
                    heroAfterRestore.reel?.id === heroAssetId,
                trace: restoreTrace || null,
                heroIdentity: {
                    reel: heroAfterRestore.reel,
                    mgr: heroAfterRestore.mgr
                },
                stageVideo: stageB
            },
            allBg7vTraces: restoreEvents
        };

        await ctx.close();
    }

    await browser.close();

    report.pass =
        report.deployGate.ok &&
        report.browserA.upload.ok &&
        report.catalog.ok &&
        report.browserA.refresh.ok &&
        report.browserB.restore.ok;

    report.classification = report.pass ? 'pass' : classifyFailure(report);
    report.completedAt = new Date().toISOString();

    fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ pass: report.pass, artifact: OUT, classification: report.classification }, null, 2));
    process.exit(report.pass ? 0 : 1);
}

main().catch((err) => {
    report.error = err?.message || String(err);
    report.classification = 'environment';
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
    console.error('[RC1_HERO_VAULT]', err);
    process.exit(1);
});
