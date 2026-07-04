#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';
const REPORT_PATH = join(ROOT, 'revenue-dashboard-report.json');

const KPI_HOOKS = [
    'data-revenue-kpi-mrr',
    'data-revenue-kpi-arr',
    'data-revenue-kpi-series-revenue',
    'data-revenue-kpi-revenue-per-episode',
    'data-revenue-kpi-revenue-per-creator',
    'data-revenue-kpi-revenue-per-team'
];

const FORECAST_HORIZONS = ['30', '90', '365'];

let failed = false;

function assert(name, ok) {
    if (!ok) {
        failed = true;
        console.log(`FAIL: ${name}`);
    } else {
        console.log(`PASS: ${name}`);
    }
}

function parseLogs(logs, tag) {
    return logs
        .map((line) => {
            const match = line.match(new RegExp(`\\[${tag}\\]\\s*(\\{.*\\})`));
            if (!match) return null;
            try {
                return JSON.parse(match[1]);
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

const corePath = join(SRC, 'lib/revenue/revenueCore.js');
const componentPath = join(SRC, 'components/revenue/RevenueDashboard.svelte');
const dashboardPath = join(SRC, 'lib/revenue/revenueDashboard.js');
const enginePath = join(SRC, 'lib/revenue/revenueEngine.js');
const diagnosticsPath = join(SRC, 'lib/revenue/revenueDiagnostics.js');

assert('RevenueDashboard.svelte exists', existsSync(componentPath));
assert('revenueCore.js exists', existsSync(corePath));
assert('revenueDashboard.js exists', existsSync(dashboardPath));
assert('revenueDiagnostics.js exists', existsSync(diagnosticsPath));

const componentSrc = readFileSync(componentPath, 'utf8');
const coreSrc = readFileSync(corePath, 'utf8');
const dashboardSrc = readFileSync(dashboardPath, 'utf8');
const engineSrc = readFileSync(enginePath, 'utf8');
const diagnosticsSrc = readFileSync(diagnosticsPath, 'utf8');

assert('buildRevenueDashboardBrief exported from revenueCore', coreSrc.includes('export function buildRevenueDashboardBrief'));
assert('RevenueDashboard imports revenueCore brief', componentSrc.includes("from '../../lib/revenue/revenueCore.js'"));
assert('emitRevenueDashboardDiagnostics exported', dashboardSrc.includes('export function emitRevenueDashboardDiagnostics'));
assert('MRR metric modeled', coreSrc.includes("id: 'mrr'") && coreSrc.includes("label: 'MRR'"));
assert('ARR metric modeled', coreSrc.includes("id: 'arr'") && coreSrc.includes("label: 'ARR'"));
assert('Series Revenue metric modeled', coreSrc.includes("label: 'Series Revenue'"));
assert('Revenue Per Episode metric modeled', coreSrc.includes("label: 'Revenue Per Episode'"));
assert('Revenue Per Creator metric modeled', coreSrc.includes("label: 'Revenue Per Creator'"));
assert('Revenue Per Team metric modeled', coreSrc.includes("label: 'Revenue Per Team'"));
assert('30 day forecast modeled', coreSrc.includes('30 day') && coreSrc.includes('REVENUE_FORECAST_HORIZONS = [30, 90, 365]'));
assert('90 day forecast modeled', coreSrc.includes('90 day'));
assert('365 day forecast modeled', coreSrc.includes('365'));
assert('buildRevenueHorizonForecasts exported', coreSrc.includes('export function buildRevenueHorizonForecasts'));
assert('REVENUE_DASHBOARD diagnostics', diagnosticsSrc.includes("'REVENUE_DASHBOARD'"));
assert('REVENUE_KPI diagnostics', diagnosticsSrc.includes("'REVENUE_KPI'"));
assert('REVENUE_FORECAST diagnostics', diagnosticsSrc.includes("'REVENUE_FORECAST'"));
assert('dashboard root hook', componentSrc.includes('data-revenue-dashboard'));
assert('KPI grid hook', componentSrc.includes('data-revenue-kpi-grid'));
assert('forecast panel hook', componentSrc.includes('data-revenue-forecast-panel'));

const browser = await chromium.launch({
    headless: true,
    executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'
});

const page = await browser.newPage();
const logs = [];

page.on('console', (msg) => {
    const text = msg.text();
    if (
        text.includes('[REVENUE_DASHBOARD]') ||
        text.includes('[REVENUE_KPI]') ||
        text.includes('[REVENUE_FORECAST]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem(
        'reelforge_series_metadata',
        JSON.stringify({
            'd511d64e-10c3-4a11-afa6-927b968c8afd': {
                reelId: 'd511d64e-10c3-4a11-afa6-927b968c8afd',
                seriesId: 'series-neon-vengeance',
                seriesName: 'Neon Vengeance',
                episodeTitle: 'Blood Protocol',
                episodeStatus: 'ready',
                genre: 'Cyber-Action',
                description: 'Old allies resurface.',
                runtime: 298,
                releaseYear: 2024,
                updatedAt: Date.now()
            }
        })
    );
});

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => document.querySelector('.ghost-trigger')?.click());
await page.waitForSelector('[data-production-command-center]', { timeout: 15000 });
await page.click('[data-command-dashboard-section="revenue"]');
await page.waitForSelector('[data-revenue-dashboard]', { timeout: 15000 });
await page.waitForTimeout(900);

assert('revenue dashboard renders', await page.locator('[data-revenue-dashboard]').isVisible());

for (const hook of KPI_HOOKS) {
    assert(`${hook} visible`, await page.locator(`[${hook}]`).isVisible());
}

for (const horizon of FORECAST_HORIZONS) {
    assert(`forecast ${horizon} day visible`, await page.locator(`[data-revenue-forecast="${horizon}"]`).isVisible());
}

const unit = await page.evaluate(() => {
    const revenue = window.__reelforgeRevenue;
    const brief = revenue.buildRevenueDashboardBrief('series-neon-vengeance', []);
    revenue.emitRevenueDashboardDiagnostics('load', brief, { source: 'validator' });
    return {
        mrr: brief.kpis.mrr.cents,
        arr: brief.kpis.arr.cents,
        seriesRevenue: brief.kpis.seriesRevenue.cents,
        revenuePerEpisode: brief.kpis.revenuePerEpisode.cents,
        revenuePerCreator: brief.kpis.revenuePerCreator.cents,
        revenuePerTeam: brief.kpis.revenuePerTeam.cents,
        forecastCount: brief.forecasts.length,
        forecast30: brief.forecasts.find((item) => item.horizonDays === 30)?.netCents || 0,
        forecast90: brief.forecasts.find((item) => item.horizonDays === 90)?.netCents || 0,
        forecast365: brief.forecasts.find((item) => item.horizonDays === 365)?.netCents || 0
    };
});

assert('MRR computed', unit.mrr > 0);
assert('ARR equals MRR x 12', unit.arr === unit.mrr * 12);
assert('series revenue computed', unit.seriesRevenue > 0);
assert('revenue per episode computed', unit.revenuePerEpisode >= 0);
assert('revenue per creator computed', unit.revenuePerCreator >= 0);
assert('revenue per team computed', unit.revenuePerTeam >= 0);
assert('three forecast horizons generated', unit.forecastCount === 3);
assert('30 day forecast computed', unit.forecast30 > 0);
assert('90 day forecast computed', unit.forecast90 >= unit.forecast30);
assert('365 day forecast computed', unit.forecast365 >= unit.forecast90);

const dashboardLogs = parseLogs(logs, 'REVENUE_DASHBOARD');
const kpiLogs = parseLogs(logs, 'REVENUE_KPI');
const forecastLogs = parseLogs(logs, 'REVENUE_FORECAST');

assert('REVENUE_DASHBOARD emitted', dashboardLogs.length >= 1);
assert('REVENUE_KPI emitted', kpiLogs.length >= 6);
assert('REVENUE_FORECAST emitted', forecastLogs.length >= 3);

writeFileSync(
    REPORT_PATH,
    `${JSON.stringify(
        {
            kpis: KPI_HOOKS,
            forecasts: FORECAST_HORIZONS,
            unit,
            diagnostics: {
                dashboard: dashboardLogs.length,
                kpi: kpiLogs.length,
                forecast: forecastLogs.length
            }
        },
        null,
        2
    )}\n`
);

await browser.close();

console.log('\n=== Revenue Dashboard Validation ===\n');
if (failed) {
    console.log('REVENUE_DASHBOARD_COMPLETE=false');
    process.exit(1);
}

console.log('REVENUE_DASHBOARD_COMPLETE=true');
