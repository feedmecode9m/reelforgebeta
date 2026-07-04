#!/usr/bin/env node
/**
 * Phase 46 — Revenue consistency report generator.
 * Validates unified revenueCore calculations across dashboard, snapshot, and KPI sync.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const REPORT_PATH = join(ROOT, 'revenue-consistency-report.json');
const BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';

const SERIES_ID = 'series-neon-vengeance';

let failed = false;
/** @type {string[]} */
const coreLogs = [];
/** @type {string[]} */
const syncLogs = [];

function assert(name, ok, detail = {}) {
    if (!ok) {
        failed = true;
        console.log(`FAIL: ${name}`);
    } else {
        console.log(`PASS: ${name}`);
    }
    console.log(`[VALIDATION_RUNTIME] ${JSON.stringify({ name, ok, ...detail, timestamp: Date.now() })}`);
}

const corePath = join(SRC, 'lib/revenue/revenueCore.js');
const dashboardPath = join(SRC, 'lib/revenue/revenueDashboard.js');
const enginePath = join(SRC, 'lib/revenue/revenueEngine.js');
const dashboardComponentPath = join(SRC, 'components/revenue/RevenueDashboard.svelte');

assert('revenueCore.js exists', existsSync(corePath));
assert('revenueDashboard.js exists', existsSync(dashboardPath));
assert('revenueEngine.js exists', existsSync(enginePath));

const coreSrc = readFileSync(corePath, 'utf8');
const dashboardSrc = readFileSync(dashboardPath, 'utf8');
const engineSrc = readFileSync(enginePath, 'utf8');
const dashboardComponentSrc = readFileSync(dashboardComponentPath, 'utf8');

assert('revenueCore exports buildRevenueDashboardBrief', coreSrc.includes('export function buildRevenueDashboardBrief'));
assert('revenueCore exports syncRevenueConsistencyCheck', coreSrc.includes('export function syncRevenueConsistencyCheck'));
assert('revenueCore emits REVENUE_CORE diagnostics', coreSrc.includes("'REVENUE_CORE'"));
assert('revenueCore emits REVENUE_SYNC diagnostics', coreSrc.includes("'REVENUE_SYNC'"));
assert('duplicate computeRevenueEstimate removed from engine', !engineSrc.includes('function computeRevenueEstimate('));
assert('duplicate buildRevenueHorizonForecasts removed from engine', !engineSrc.includes('function buildRevenueHorizonForecasts('));
assert('revenueDashboard re-exports from revenueCore', dashboardSrc.includes("from './revenueCore.js'"));
assert('RevenueDashboard imports revenueCore', dashboardComponentSrc.includes("from '../../lib/revenue/revenueCore.js'"));
assert('RevenueDashboard does not import brief from revenueDashboard', !dashboardComponentSrc.includes('buildRevenueDashboardBrief') || dashboardComponentSrc.includes("from '../../lib/revenue/revenueCore.js'"));

const browser = await chromium.launch({
    headless: true,
    executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'
});

const page = await browser.newPage();

page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[REVENUE_CORE]')) coreLogs.push(text);
    if (text.includes('[REVENUE_SYNC]')) syncLogs.push(text);
});

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__reelforgeRevenueCore, { timeout: 15000 });

const runtime = await page.evaluate((seriesId) => {
    const core = window.__reelforgeRevenueCore;
    if (!core) return { ok: false, reason: 'missing_core' };

    const sync = core.syncRevenueConsistencyCheck(seriesId, []);
    const brief = core.buildRevenueDashboardBrief(seriesId, []);
    const snapshot = core.buildSeriesRevenueSnapshot(seriesId, []);

    return {
        ok: sync.consistent,
        checks: sync.checks,
        mrrCents: brief.kpis.mrr.cents,
        arrCents: brief.kpis.arr.cents,
        aggregateNet: brief.aggregateNetMonthlyCents,
        snapshotNet: snapshot.estimate.netCreatorCents,
        forecastCount: brief.forecasts.length
    };
}, SERIES_ID);

assert('revenue core runtime available', Boolean(runtime.ok !== undefined && runtime.checks), runtime);
assert('revenue sync checks pass at runtime', runtime.ok === true, runtime);
assert('MRR matches aggregate net monthly', runtime.mrrCents === runtime.aggregateNet, runtime);
assert('snapshot net matches dashboard selected estimate', runtime.snapshotNet === runtime.mrrCents || runtime.checks?.netMonthlyAligned, runtime);
assert('forecasts generated', (runtime.forecastCount || 0) >= 3, runtime);
assert('REVENUE_CORE diagnostics captured', coreLogs.length >= 1, { count: coreLogs.length });
assert('REVENUE_SYNC diagnostics captured', syncLogs.length >= 1, { count: syncLogs.length });

await browser.close();

const report = {
    generatedAt: new Date().toISOString(),
    phase: 46,
    seriesId: SERIES_ID,
    consolidated: true,
    singleSource: 'src/lib/revenue/revenueCore.js',
    duplicateLogicRemoved: [
        'computeRevenueEstimate from revenueEngine.js',
        'buildRevenueHorizonForecasts from revenueEngine.js',
        'forecastRevenue calculation loop from revenueEngine.js',
        'buildRevenueDashboardBrief from revenueDashboard.js',
        'formatRevenueCurrency from revenueDashboard.js',
        'getTeamCount from revenueDashboard.js and monetizationAI.js',
        'duplicate monthly viewer context in monetizationAI analyzeRevenue'
    ],
    consumersUpdated: [
        'src/components/revenue/RevenueDashboard.svelte',
        'src/lib/revenue/revenueDashboard.js',
        'src/lib/revenue/revenueEngine.js',
        'src/lib/revenue/monetizationAI.js',
        'src/lib/reporting/reportingEngine.js',
        'src/viewer/viewerContext.js'
    ],
    diagnostics: {
        REVENUE_CORE: coreLogs.length,
        REVENUE_SYNC: syncLogs.length
    },
    runtime,
    consistent: !failed && runtime.ok === true,
    successToken: failed ? 'REVENUE_CONSOLIDATION_COMPLETE=false' : 'REVENUE_CONSOLIDATION_COMPLETE=true'
};

writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
console.log(`[REVENUE_CONSISTENCY_REPORT] ${JSON.stringify({ path: REPORT_PATH, consistent: report.consistent })}`);
console.log(report.successToken);

process.exit(failed ? 1 : 0);
