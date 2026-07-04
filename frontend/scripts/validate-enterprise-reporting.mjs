#!/usr/bin/env node
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';

const REPORT_CADENCES = ['Daily', 'Weekly', 'Monthly', 'Quarterly'];
const REPORT_METRICS = ['Production', 'Publishing', 'Revenue', 'Security', 'Teams', 'Marketplace'];

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

const enginePath = join(SRC, 'lib/reporting/reportingEngine.js');
const dashboardPath = join(SRC, 'components/reporting/ExecutiveReportsDashboard.svelte');
const commandCenterPath = join(SRC, 'components/studio/ProductionCommandCenter.svelte');
const viewerContextPath = join(SRC, 'viewer/viewerContext.js');

assert('reportingEngine.js exists', existsSync(enginePath));
assert('ExecutiveReportsDashboard.svelte exists', existsSync(dashboardPath));

const engineSrc = readFileSync(enginePath, 'utf8');
const dashboardSrc = readFileSync(dashboardPath, 'utf8');
const commandCenterSrc = readFileSync(commandCenterPath, 'utf8');
const viewerContextSrc = readFileSync(viewerContextPath, 'utf8');

assert('REPORTING_STORAGE_KEY defined', engineSrc.includes("export const REPORTING_STORAGE_KEY = 'reelforge_executive_reports'"));
assert('REPORT_CADENCES defined', engineSrc.includes('export const REPORT_CADENCES'));
assert('REPORT_METRICS defined', engineSrc.includes('export const REPORT_METRICS'));
assert('generateExecutiveReport exported', engineSrc.includes('export function generateExecutiveReport'));
assert('exportExecutiveReport exported', engineSrc.includes('export function exportExecutiveReport'));
assert('buildExecutiveReportsDashboard exported', engineSrc.includes('export function buildExecutiveReportsDashboard'));
assert('initReportingEngine exported', engineSrc.includes('export function initReportingEngine'));
assert('REPORT_GENERATED diagnostics', engineSrc.includes("logReportingDiag('REPORT_GENERATED'"));
assert('REPORT_EXPORT diagnostics', engineSrc.includes("logReportingDiag('REPORT_EXPORT'"));
assert('REPORT_SUMMARY diagnostics', engineSrc.includes("logReportingDiag('REPORT_SUMMARY'"));
for (const cadence of REPORT_CADENCES) {
    assert(`cadence ${cadence} supported`, engineSrc.includes(`'${cadence}'`));
}
for (const metric of REPORT_METRICS) {
    assert(`metric ${metric} supported`, engineSrc.includes(`'${metric}'`));
}
assert('json export supported', engineSrc.includes("format === 'json'"));
assert('csv export supported', engineSrc.includes("format === 'csv'"));
assert('pdf-ready export supported', engineSrc.includes('pdfReady'));
assert('executive reports dashboard hook', dashboardSrc.includes('data-executive-reports-dashboard'));
assert('command center wires reports panel', commandCenterSrc.includes('ExecutiveReportsDashboard'));
assert('viewerContext initializes reporting', viewerContextSrc.includes('initReportingEngine()'));

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
        text.includes('[REPORT_GENERATED]') ||
        text.includes('[REPORT_EXPORT]') ||
        text.includes('[REPORT_SUMMARY]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.removeItem('reelforge_executive_reports');
    localStorage.setItem('admin_mode', 'true');
});

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => Boolean(window.__reelforgeReporting), null, { timeout: 15000 });

const generated = await page.evaluate(() => {
    const api = window.__reelforgeReporting;
    const seriesId = 'series-neon-vengeance';
    const daily = api.generateExecutiveReport(seriesId, [], { cadence: 'Daily' });
    const weekly = api.generateExecutiveReport(seriesId, [], { cadence: 'Weekly' });
    const jsonExport = api.exportExecutiveReport(daily, 'json');
    const csvExport = api.exportExecutiveReport(weekly, 'csv');
    const pdfExport = api.exportExecutiveReport(daily, 'pdf');
    const dashboard = api.buildExecutiveReportsDashboard(seriesId, []);
    return {
        dailyId: daily.id,
        metricCount: Object.keys(daily.metrics).length,
        jsonFormat: jsonExport.format,
        csvFormat: csvExport.format,
        pdfFormat: pdfExport.format,
        pdfReady: Boolean(pdfExport.pdfReady?.printable),
        cadenceCount: dashboard.cadences.length
    };
});

assert('daily report generated', Boolean(generated.dailyId));
assert('all metrics collected', generated.metricCount === REPORT_METRICS.length);
assert('json export works', generated.jsonFormat === 'json');
assert('csv export works', generated.csvFormat === 'csv');
assert('pdf-ready payload works', generated.pdfFormat === 'pdf' && generated.pdfReady === true);
assert('dashboard exposes cadences', generated.cadenceCount === REPORT_CADENCES.length);
assert('REPORT_GENERATED emitted', parseLogs(logs, 'REPORT_GENERATED').length >= 1);
assert('REPORT_EXPORT emitted', parseLogs(logs, 'REPORT_EXPORT').length >= 1);
assert('REPORT_SUMMARY emitted', parseLogs(logs, 'REPORT_SUMMARY').length >= 1);

await page.click('.ghost-trigger');
await page.waitForSelector('.control-center-container', { timeout: 15000 });
await page.click('[data-workspace-tab="overview"], [data-command-section="overview"]');
await page.waitForSelector('[data-production-command-center]', { timeout: 15000 });
await page.click('[data-command-dashboard-section="reports"]');
await page.waitForSelector('[data-executive-reports-dashboard]', { timeout: 15000 });
assert('executive reports dashboard renders', await page.locator('[data-executive-reports-dashboard]').isVisible());
assert('report metrics panel visible', await page.locator('[data-executive-report-metrics]').isVisible());
assert('report summary panel visible', await page.locator('[data-executive-report-summary]').isVisible());

await page.click('[data-executive-report-generate]');
await page.waitForTimeout(300);
await page.click('[data-executive-report-export-json]');
await page.waitForTimeout(200);

const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('reelforge_executive_reports') || '{}'));
assert('reports persisted', Array.isArray(persisted.reports) && persisted.reports.length >= 1);

await browser.close();

console.log('\n=== Enterprise Reporting Validation ===\n');
if (failed) {
    console.log('ENTERPRISE_REPORTING_COMPLETE=false');
    process.exit(1);
}

console.log('ENTERPRISE_REPORTING_COMPLETE=true');
