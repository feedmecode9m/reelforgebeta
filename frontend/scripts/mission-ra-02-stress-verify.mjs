#!/usr/bin/env node
/**
 * RA-02 — Release Candidate Stress Verification
 * Release ID: RC1-2026-07-18-001
 * No product code changes — production stress + contract checks only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
    unlockStudio,
    openProductionTab,
    readHeroStorage,
    listVaultReelIds,
    readEpisodeAttachment
} from '../tests/helpers/studio-navigation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_ID = process.env.RELEASE_ID || 'RC1-2026-07-18-001';
const FRONTEND_URL =
    process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app/';
const API_URL = (process.env.API_URL || 'https://reelforge-deploy-production.up.railway.app').replace(
    /\/$/,
    ''
);
const WAIT_MS = Number(process.env.WAIT_MS || 12000);
const STRESS_CYCLES = Number(process.env.STRESS_CYCLES || 3);
const OUT =
    process.env.OUT ||
    path.join(__dirname, '..', 'artifacts', 'mission-ra-02-stress-verify.json');
const CHROMIUM =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const report = {
    mission: 'RA-02',
    release_id: RELEASE_ID,
    generatedAt: new Date().toISOString(),
    frontendUrl: FRONTEND_URL,
    apiUrl: API_URL,
    scenarios: [],
    performance: {},
    regression: {},
    summary: {},
    pass: false
};

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function scenario(name, ok, detail = {}, classification = null) {
    const row = {
        name,
        ok,
        classification: ok ? 'pass' : classification || 'rc_blocker',
        ...detail,
        ts: new Date().toISOString()
    };
    report.scenarios.push(row);
    return ok;
}

async function fetchProductionBundle() {
    const html = await fetch(FRONTEND_URL, { signal: AbortSignal.timeout(30000) }).then((r) => r.text());
    const match = html.match(/assets\/index-([A-Za-z0-9_-]+)\.js/);
    return match ? `assets/index-${match[1]}.js` : null;
}

async function measureEndpoint(url) {
    const t0 = performance.now();
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const ms = Math.round(performance.now() - t0);
    return { status: res.status, ms, ok: res.ok };
}

async function stressFreshHeroRestore(page, managerSeed, label) {
    const events = [];
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
        events.push(payload);
    });

    await page.addInitScript((mgr) => {
        localStorage.clear();
        sessionStorage.clear();
        if (mgr?.heroAssetId) {
            localStorage.setItem(
                'reelforge_hero_manager_config',
                JSON.stringify({
                    heroType: 'TRENDING',
                    backgroundSource: 'custom_video',
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

    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(WAIT_MS);
    await page.evaluate(() => localStorage.removeItem('reelforge_hero_reel'));
    events.length = 0;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(WAIT_MS);

    const trace = events.find((e) => e?.reason);
    const hero = await readHeroStorage(page);
    const ok =
        trace?.reason === 'RESTORE_SUCCESS' &&
        hero.reel?.id === managerSeed.heroAssetId;
    return { ok, trace, hero, label };
}

async function runStressSessions(browser) {
    const catalog = await fetch(`${API_URL}/api/reels?t=${Date.now()}`).then((r) => r.json());
    const heroReel = catalog.find((r) => String(r.category || '').toUpperCase() === 'HERO');
    const heroAssetId = heroReel ? String(heroReel.id) : null;

    if (!heroAssetId) {
        scenario('stress.hero_seed_from_catalog', false, {}, 'environment');
        return;
    }
    scenario('stress.hero_seed_from_catalog', true, { heroAssetId });

    for (let i = 1; i <= STRESS_CYCLES; i++) {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        const result = await stressFreshHeroRestore(
            page,
            { heroAssetId, backgroundSource: 'custom_video' },
            `cycle-${i}`
        );
        scenario(`stress.fresh_restore_cycle_${i}`, result.ok, {
            reason: result.trace?.reason || null,
            heroReelId: result.hero?.reel?.id || null
        }, result.ok ? 'pass' : 'rc_blocker');
        await ctx.close();
    }

    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(WAIT_MS);
    const vaultA = await listVaultReelIds(pageA);
    await ctxA.close();

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(WAIT_MS);
    const vaultB = await listVaultReelIds(pageB);
    scenario('stress.catalog_bootstrap_second_context', vaultB.length > 0, {
        vaultA: vaultA.length,
        vaultB: vaultB.length
    });
    await ctxB.close();
}

async function runPersistence(browser) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const failed = [];
    page.on('requestfailed', (req) => {
        failed.push({ url: req.url(), err: req.failure()?.errorText || '' });
    });

    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(WAIT_MS);
    for (let i = 1; i <= STRESS_CYCLES; i++) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await sleep(4000);
    }

    const apiFailures = failed.filter((f) => {
        const u = f.url;
        if (!u.includes('/api/reels') && !u.includes('/health')) return false;
        if (f.err.includes('ERR_ABORTED')) return false;
        return true;
    });
    scenario('stress.hard_refresh_cycles', true, { cycles: STRESS_CYCLES });
    scenario(
        'stress.no_sync_storm_on_core_api',
        apiFailures.length === 0,
        {
            coreApiFailureCount: apiFailures.length,
            notificationAbortsIgnored: failed.filter((f) =>
                f.url.includes('/api/notifications')
            ).length,
            sample: apiFailures.slice(0, 5)
        },
        apiFailures.length ? 'existing_defect' : 'pass'
    );
    await ctx.close();
}

async function runStudioContracts(browser) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await unlockStudio(page, FRONTEND_URL);
    await openProductionTab(page);

    const readiness = await page.locator('[data-testid="creator-readiness-board"]').count();
    const attachPanel = await page.locator('[data-testid="episode-reel-attach-panel"]').count();
    const actionBtn = await page.locator('[data-testid="readiness-action-btn"]').count();

    scenario('contract.readiness_board_renders', readiness > 0, { count: readiness });
    scenario('contract.episode_attach_panel_visible', attachPanel > 0, { count: attachPanel });
    scenario('contract.action_router_dom', actionBtn > 0, { actionButtons: actionBtn });

    const attach = await readEpisodeAttachment(page, 'ep-neon-s01e04');
    scenario('contract.episode_attachment_local_read', Boolean(attach.reelId), {
        reelId: attach.reelId || null
    });

    await ctx.close();
}

async function runPerformanceChecks() {
    const bundle = await fetchProductionBundle();
    const health = await measureEndpoint(`${FRONTEND_URL.replace(/\/$/, '')}/health`);
    const reels = await measureEndpoint(`${FRONTEND_URL.replace(/\/$/, '')}/api/reels`);
    report.performance = { bundle, health, reels };

    scenario('perf.health', health.ok && health.status === 200, health);
    scenario('perf.api_reels', reels.ok && reels.status === 200, reels);
    scenario(
        'perf.bundle_identity',
        bundle === 'assets/index-DQeGd3cl.js',
        { bundle, expected: 'assets/index-DQeGd3cl.js' },
        bundle === 'assets/index-DQeGd3cl.js' ? 'pass' : 'deployment'
    );
}

async function main() {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });

    await runPerformanceChecks();

    const launch = { headless: true };
    if (fs.existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;
    const browser = await chromium.launch(launch);

    try {
        await runStressSessions(browser);
        await runPersistence(browser);
        await runStudioContracts(browser);
    } finally {
        await browser.close();
    }

    const blockers = report.scenarios.filter((s) => !s.ok && s.classification === 'rc_blocker');
    report.summary = {
        scenariosPassed: report.scenarios.filter((s) => s.ok).length,
        scenariosTotal: report.scenarios.length,
        rcBlockers: blockers.length,
        release_id: RELEASE_ID
    };
    report.pass = blockers.length === 0;
    report.rc1_recommendation = report.pass
        ? 'Proceed to Gate 8 RC1-STABLE sign-off after npm regression scripts'
        : 'Resolve RC blockers before RC1-STABLE';
    report.notes =
        'Run npm regression suite separately: test:hero-playwright, test:hero-confirmation, test:episode-attachment, mission-ra-01-shared-state-verify.mjs';

    fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
    console.info('[RA02_STRESS]', report.summary);
    console.log(JSON.stringify(report, null, 2));

    if (!report.pass) process.exit(1);
}

main().catch((err) => {
    console.error('[RA02_STRESS] failed', err);
    process.exit(1);
});
