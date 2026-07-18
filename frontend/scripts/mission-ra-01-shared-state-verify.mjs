#!/usr/bin/env node
/**
 * RA-01 — Shared State Verification
 *
 * Simulates three independent browser contexts against production (or preview):
 *   A — actor (upload vault reel, attach episode, change hero)
 *   B — observer (separate context, refresh, read shared server state)
 *   C — fresh session (cleared storage; catalog + hero restore boundary)
 *
 * Usage:
 *   node scripts/mission-ra-01-shared-state-verify.mjs
 *   FRONTEND_URL=https://strong-lolly-a9fcb4.netlify.app/ node scripts/mission-ra-01-shared-state-verify.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
    unlockStudio,
    openContentTab,
    openProductionTab,
    readEpisodeAttachment,
    listVaultReelIds,
    readHeroStorage
} from '../tests/helpers/studio-navigation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_URL =
    process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app/';
const API_URL = (process.env.API_URL || 'https://reelforge-deploy-production.up.railway.app').replace(
    /\/$/,
    ''
);
const TARGET_EPISODE_ID = process.env.TARGET_EPISODE_ID || 'ep-neon-s01e04';
const WAIT_MS = Number(process.env.WAIT_MS || 18000);
const OUT =
    process.env.OUT ||
    path.join(__dirname, '..', 'artifacts', 'mission-ra-01-shared-state-verify.json');
const CHROMIUM =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const report = {
    mission: 'RA-01',
    generatedAt: new Date().toISOString(),
    frontendUrl: FRONTEND_URL,
    apiUrl: API_URL,
    deployGate: {},
    scenarios: [],
    contexts: { A: {}, B: {}, C: {} },
    regression: {},
    summary: {},
    pass: false
};

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function scenario(name, ok, detail = {}) {
    const row = { name, ok, ...detail, ts: new Date().toISOString() };
    report.scenarios.push(row);
    return ok;
}

function ensureTestMp4(label = 'ra01') {
    const p = path.join(__dirname, '..', 'tests', 'tmp', `${label}-${Date.now()}.mp4`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    execSync(
        `ffmpeg -y -f lavfi -i color=c=teal:s=640x360:d=3 -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${p}"`,
        { stdio: 'ignore' }
    );
    return p;
}

async function fetchStudioEpisodeReelIds() {
    try {
        const projectsRes = await fetch(`${API_URL}/api/studio/projects`);
        if (!projectsRes.ok) return { enabled: false, matches: [] };
        const projects = await projectsRes.json();
        const matches = [];
        for (const project of projects || []) {
            const treeRes = await fetch(`${API_URL}/api/studio/projects/${project.id}/tree`);
            if (!treeRes.ok) continue;
            const tree = await treeRes.json();
            for (const series of tree.series || []) {
                for (const season of series.seasons || []) {
                    for (const episode of season.episodes || []) {
                        if (episode.reel_id) {
                            matches.push({
                                episodeId: episode.id,
                                reelId: String(episode.reel_id),
                                episodeNumber: episode.episode_number,
                                seasonNumber: season.season_number
                            });
                        }
                    }
                }
            }
        }
        return { enabled: true, matches };
    } catch {
        return { enabled: false, matches: [] };
    }
}

async function fetchCatalog() {
    const res = await fetch(`${API_URL}/api/reels?t=${Date.now()}`);
    if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
    return res.json();
}

async function fetchProductionBundleJs() {
    const html = await fetch(FRONTEND_URL, { signal: AbortSignal.timeout(30000) }).then((r) => r.text());
    const match = html.match(/assets\/index-([A-Za-z0-9_-]+)\.js/);
    if (!match) return { bundle: null, js: '' };
    const file = `index-${match[1]}.js`;
    const js = await fetch(`${FRONTEND_URL.replace(/\/$/, '')}/assets/${file}`, {
        signal: AbortSignal.timeout(60000)
    }).then((r) => r.text());
    return { bundle: file, js };
}

async function checkDeployGate() {
    const { bundle, js } = await fetchProductionBundleJs();
    const gate = {
        bundle,
        hasBg7vInstrumentation: js.includes('BG7V_HERO_RESTORE_REASON'),
        hasBg7wFixMarker: js.includes('hero-restore'),
        ready: js.includes('BG7V_HERO_RESTORE_REASON') && js.includes('hero-restore')
    };
    report.deployGate = gate;
    scenario('deploy.bg7v_instrumentation', gate.hasBg7vInstrumentation, gate);
    scenario('deploy.bg7w_fix_live', gate.hasBg7wFixMarker, gate);
    return gate.ready;
}

async function dropVaultMp4(page, filePath) {
    const b64 = fs.readFileSync(filePath).toString('base64');
    const fileName = path.basename(filePath);
    await page.evaluate(
        async ({ mp4B64, name }) => {
            const target = document.querySelector('.video-vault-drop');
            if (!target) throw new Error('Missing .video-vault-drop');
            const bytes = Uint8Array.from(atob(mp4B64), (c) => c.charCodeAt(0));
            const file = new File([bytes], name, { type: 'video/mp4' });
            const dt = new DataTransfer();
            dt.items.add(file);
            target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
        },
        { mp4B64: b64, name: fileName }
    );
}

async function uploadHeroMp4(page, filePath) {
    const input = page.locator('.hero-replace-section input[type="file"]');
    await input.setInputFiles(filePath);
}

async function waitForVaultReelId(page, apiBeforeIds = new Set()) {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        const ids = await listVaultReelIds(page);
        const fresh = ids.find((id) => !apiBeforeIds.has(id));
        if (fresh) return fresh;
        if (ids.length && !apiBeforeIds.size) return ids[ids.length - 1];
        await sleep(1500);
    }
    return null;
}

async function waitForCatalogReelAfterUpload(beforeIds, nameHint = 'ra01') {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        const catalog = await fetchCatalog();
        const candidate = catalog.find(
            (r) => !beforeIds.has(String(r.id)) && String(r.name || '').toLowerCase().includes('ra01')
        );
        if (candidate) return String(candidate.id);
        const anyNew = catalog.find((r) => !beforeIds.has(String(r.id)));
        if (anyNew) return String(anyNew.id);
        await sleep(1500);
    }
    return null;
}

async function collectRestoreTraces(page, events) {
    page.on('console', async (msg) => {
        const text = msg.text();
        if (!text.includes('[BG7V_HERO_RESTORE_REASON]') && !text.includes('[BG7J_HERO_RESTORE]')) return;
        const parts = [];
        for (const arg of msg.args()) {
            try {
                parts.push(await arg.jsonValue());
            } catch {
                parts.push(arg.toString());
            }
        }
        const payload = parts.find((p) => p && typeof p === 'object' && !Array.isArray(p)) || null;
        events.push({ text, payload });
    });
}

async function runBrowserA(browser) {
    const vaultMp4 = ensureTestMp4('ra01-vault');
    const heroMp4 = ensureTestMp4('ra01-hero');
    const context = await browser.newContext();
    const page = await context.newPage();
    const postUrls = [];
    page.on('request', (req) => {
        if (req.method() === 'POST' && req.url().includes('/api/reels')) postUrls.push(req.url());
    });

    await unlockStudio(page, FRONTEND_URL);
    await openContentTab(page);

    const catalogBefore = await fetchCatalog();
    const beforeIds = new Set(catalogBefore.map((r) => String(r.id)));

    await dropVaultMp4(page, vaultMp4);

    let reelId = await waitForVaultReelId(page, beforeIds);
    if (!reelId) {
        reelId = await waitForCatalogReelAfterUpload(beforeIds, 'ra01-vault');
    }

    report.contexts.A.vaultReelId = reelId;
    report.contexts.A.postCount = postUrls.length;
    scenario('A.vault_upload', Boolean(reelId) && postUrls.length > 0, {
        reelId,
        postCount: postUrls.length
    });

    if (!reelId) {
        await context.close();
        return { reelId: null, heroState: null, attached: null };
    }

    await openProductionTab(page);
    const vaultOptions = await page.locator('[data-testid="vault-reel-option"]').count();
    if (vaultOptions > 0) {
        await page.locator('[data-testid="episode-reel-select"]').selectOption(TARGET_EPISODE_ID);
        await page.locator(`[data-testid="vault-reel-option"][data-reel-id="${reelId}"]`).click();
        await page.locator('[data-testid="attach-reel-to-episode"]').click();
        if (await page.locator('[data-testid="attach-reel-replace"]').isVisible().catch(() => false)) {
            await page.locator('[data-testid="attach-reel-replace"]').click();
        }
        await sleep(2000);
    }
    const attached = await readEpisodeAttachment(page, TARGET_EPISODE_ID);
    report.contexts.A.attachment = attached;
    scenario('A.episode_attach', attached.reelId === reelId && Boolean(reelId), attached);

    await openContentTab(page);
    await uploadHeroMp4(page, heroMp4);
    const heroDeadline = Date.now() + 120000;
    let heroState = null;
    while (Date.now() < heroDeadline) {
        heroState = await readHeroStorage(page);
        if (heroState.reel?.id && heroState.mgr?.heroAssetId) break;
        await sleep(1500);
    }
    report.contexts.A.hero = heroState;
    scenario('A.hero_change', heroState?.reel?.id === heroState?.mgr?.heroAssetId, {
        heroAssetId: heroState?.mgr?.heroAssetId || null,
        heroReelId: heroState?.reel?.id || null
    });

    await context.close();
    return { reelId, heroState, attached };
}

async function runBrowserB(browser, shared) {
    const context = await browser.newContext();
    const page = await context.newPage();

    const catalog = await fetchCatalog();
    const inCatalog = catalog.some((r) => String(r.id) === String(shared.reelId));
    report.contexts.B.catalogHasVaultReel = inCatalog;
    scenario('B.catalog_shows_A_upload', inCatalog, { reelId: shared.reelId });

    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(WAIT_MS);

    const vaultIds = await listVaultReelIds(page);
    const vaultHasReel = vaultIds.includes(String(shared.reelId));
    report.contexts.B.vaultIds = vaultIds;
    scenario('B.vault_bootstrap_includes_reel', vaultHasReel, {
        reelId: shared.reelId,
        vaultCount: vaultIds.length
    });

    await unlockStudio(page, FRONTEND_URL);
    await openProductionTab(page);
    const afterRefreshAttach = await readEpisodeAttachment(page, TARGET_EPISODE_ID);
    report.contexts.B.attachmentLocal = afterRefreshAttach;
    scenario('B.attachment_local_metadata', afterRefreshAttach.reelId === shared.reelId, {
        expected: shared.reelId,
        actual: afterRefreshAttach.reelId,
        note: 'localStorage-only; may fail until series metadata syncs cross-browser'
    });

    const studio = await fetchStudioEpisodeReelIds();
    const serverAttach = studio.matches.find((m) => m.reelId === String(shared.reelId));
    report.contexts.B.studioAttachment = serverAttach || null;
    scenario('B.attachment_visible_on_server', Boolean(serverAttach), {
        studioEnabled: studio.enabled,
        serverAttach
    });

    const hero = await readHeroStorage(page);
    report.contexts.B.heroLocal = hero;
    scenario('B.hero_local_matches_A', hero.mgr?.heroAssetId === shared.heroState?.mgr?.heroAssetId, {
        aHeroAssetId: shared.heroState?.mgr?.heroAssetId || null,
        bHeroAssetId: hero.mgr?.heroAssetId || null
    });

    await context.close();
}

async function runBrowserC(browser, shared) {
    const restoreEvents = [];
    const context = await browser.newContext();
    const page = await context.newPage();
    collectRestoreTraces(page, restoreEvents);

    const managerSeed = shared.heroState?.mgr || {
        backgroundSource: 'custom_video',
        heroAssetId: shared.heroState?.mgr?.heroAssetId || shared.heroState?.reel?.id
    };

    await page.addInitScript((mgr) => {
        localStorage.clear();
        sessionStorage.clear();
        if (mgr?.heroAssetId) {
            localStorage.setItem(
                'reelforge_hero_manager_config',
                JSON.stringify({
                    heroType: 'TRENDING',
                    backgroundSource: mgr.backgroundSource || 'custom_video',
                    heroAssetId: mgr.heroAssetId,
                    backgroundStyle: 'video',
                    autoRotate: false,
                    rotateIntervalMs: 30000,
                    spotlightPriority: ['TRENDING'],
                    seasonalCampaigns: [],
                    carouselDurationMs: 8000
                })
            );
        }
    }, managerSeed);

    const catalog = await fetchCatalog();
    const inCatalog = catalog.some((r) => String(r.id) === String(shared.reelId));
    report.contexts.C.catalogHasVaultReel = inCatalog;
    scenario('C.fresh_catalog_has_A_upload', inCatalog, { reelId: shared.reelId });

    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(WAIT_MS);

    const vaultIds = await listVaultReelIds(page);
    scenario('C.fresh_vault_bootstrap', vaultIds.includes(String(shared.reelId)), {
        vaultIds,
        reelId: shared.reelId
    });

    const bg7v = restoreEvents.find((e) => e.text.includes('[BG7V_HERO_RESTORE_REASON]'));
    const heroAfterBootstrap = await readHeroStorage(page);
    report.contexts.C.restoreTrace = bg7v?.payload || null;
    report.contexts.C.heroAfterBootstrap = heroAfterBootstrap;

    const restoreOk =
        bg7v?.payload?.reason === 'RESTORE_SUCCESS' &&
        heroAfterBootstrap.reel?.id === managerSeed.heroAssetId;
    scenario('C.hero_restore_after_fresh_session', restoreOk, {
        reason: bg7v?.payload?.reason || null,
        heroReelId: heroAfterBootstrap.reel?.id || null,
        heroAssetId: managerSeed.heroAssetId || null
    });

    await page.evaluate(() => localStorage.removeItem('reelforge_hero_reel'));
    restoreEvents.length = 0;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(WAIT_MS);
    const bg7vAfterClear = restoreEvents.find((e) => e.text.includes('[BG7V_HERO_RESTORE_REASON]'));
    const heroAfterClear = await readHeroStorage(page);
    report.contexts.C.restoreAfterClear = bg7vAfterClear?.payload || null;
    report.contexts.C.heroAfterClear = heroAfterClear;
    scenario('C.identity_restore_boundary', bg7vAfterClear?.payload?.reason === 'RESTORE_SUCCESS', {
        reason: bg7vAfterClear?.payload?.reason || null,
        restoredReelId: heroAfterClear.reel?.id || null
    });

    await context.close();
}

async function runRegressionChecks() {
    const checks = {
        heroRestoreSmokeScript: fs.existsSync(path.join(__dirname, 'mission-bg-7v-restore-reason-smoke.mjs')),
        heroPersistenceScript: fs.existsSync(path.join(__dirname, 'mission-bg-7u-hero-persistence-verify.mjs')),
        episodeAttachScript: fs.existsSync(path.join(__dirname, 'mission-product-03-episode-attach.mjs')),
        actionRouterModule: fs.existsSync(
            path.join(__dirname, '..', 'src', 'lib', 'studio', 'creatorActionRouter.js')
        ),
        readinessBoardModule: fs.existsSync(
            path.join(__dirname, '..', 'src', 'components', 'studio', 'CreatorEpisodeReadinessBoard.svelte')
        )
    };
    report.regression = checks;
    const ok = Object.values(checks).every(Boolean);
    scenario('regression.modules_present', ok, checks);
    return ok;
}

async function main() {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });

    const deployReady = await checkDeployGate();
    if (!deployReady) {
        console.warn('[RA-01] Deploy gate: BG-7V/7W bundle markers not found on target URL.');
        console.warn('[RA-01] Run: bash scripts/deploy-netlify.sh "BG-7W hero restore fix"');
    }

    const launch = { headless: true };
    if (fs.existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;
    const browser = await chromium.launch(launch);

    try {
        const shared = await runBrowserA(browser);
        if (!shared.reelId) {
            report.fatalError = 'Browser A failed to upload vault reel — cannot continue shared-state tests';
        } else {
            await runBrowserB(browser, shared);
            await runBrowserC(browser, shared);
        }
        await runRegressionChecks();
    } catch (err) {
        report.fatalError = String(err.stack || err);
    } finally {
        await browser.close();
    }

    const required = [
        'A.vault_upload',
        'A.hero_change',
        'B.catalog_shows_A_upload',
        'B.vault_bootstrap_includes_reel',
        'C.fresh_catalog_has_A_upload',
        'C.identity_restore_boundary'
    ];
    const requiredOk = required.every((name) => report.scenarios.find((s) => s.name === name)?.ok);
    const deployOk = report.deployGate.ready === true;

    report.summary = {
        deployReady: deployOk,
        scenariosPassed: report.scenarios.filter((s) => s.ok).length,
        scenariosTotal: report.scenarios.length,
        requiredOk,
        sharedStateReady: requiredOk && deployOk
    };
    report.pass = requiredOk && deployOk;

    fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
    console.info('[RA01_SHARED_STATE]', report.summary);
    console.log(JSON.stringify(report, null, 2));

    if (!report.pass) process.exit(1);
}

main().catch((err) => {
    console.error('[RA01_SHARED_STATE] failed', err);
    process.exit(1);
});
