#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';
const REPORT_PATH = join(ROOT, 'monetization-ai-report.json');

const RECOMMENDATION_CATEGORIES = [
    'Revenue Growth',
    'Sponsorship Opportunities',
    'Subscription Opportunities',
    'Premium Episode Opportunities',
    'Marketplace Opportunities',
    'Cross Promotion',
    'Series Expansion',
    'Team Expansion'
];

const MASTER_FIELDS = [
    'revenueScore',
    'monetizationReadiness',
    'sponsorReadiness',
    'subscriptionReadiness',
    'marketplacePotential',
    'topOpportunities',
    'blockers',
    'recommendations',
    'projectedMonthlyRevenue',
    'projectedAnnualRevenue'
];

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

const enginePath = join(SRC, 'lib/revenue/monetizationAI.js');
const diagnosticsPath = join(SRC, 'lib/revenue/monetizationDiagnostics.js');
const panelPath = join(SRC, 'components/revenue/MonetizationAssistantPanel.svelte');
const revenueDashboardPath = join(SRC, 'components/revenue/RevenueDashboard.svelte');
const sentinelPanelPath = join(SRC, 'components/studio/SentinelAssistantPanel.svelte');
const commandCenterPath = join(SRC, 'components/studio/ProductionCommandCenter.svelte');

assert('monetizationAI.js exists', existsSync(enginePath));
assert('monetizationDiagnostics.js exists', existsSync(diagnosticsPath));
assert('MonetizationAssistantPanel.svelte exists', existsSync(panelPath));

const engineSrc = readFileSync(enginePath, 'utf8');
const diagnosticsSrc = readFileSync(diagnosticsPath, 'utf8');
const panelSrc = readFileSync(panelPath, 'utf8');
const revenueDashboardSrc = readFileSync(revenueDashboardPath, 'utf8');
const sentinelPanelSrc = readFileSync(sentinelPanelPath, 'utf8');
const commandCenterSrc = readFileSync(commandCenterPath, 'utf8');

assert('analyzeRevenue exported', engineSrc.includes('export function analyzeRevenue'));
assert('analyzeSubscriptions exported', engineSrc.includes('export function analyzeSubscriptions'));
assert('analyzeSponsors exported', engineSrc.includes('export function analyzeSponsors'));
assert('analyzeMarketplace exported', engineSrc.includes('export function analyzeMarketplace'));
assert('analyzeSeriesPerformance exported', engineSrc.includes('export function analyzeSeriesPerformance'));
assert('masterMonetizationAnalysis exported', engineSrc.includes('export function masterMonetizationAnalysis'));
assert('initMonetizationAI exported', engineSrc.includes('export function initMonetizationAI'));
assert('getMonetizationSentinelOverlay exported', engineSrc.includes('export function getMonetizationSentinelOverlay'));
assert('MONETIZATION_ANALYSIS diagnostics', diagnosticsSrc.includes("'MONETIZATION_ANALYSIS'"));
assert('MONETIZATION_RECOMMENDATION diagnostics', diagnosticsSrc.includes("'MONETIZATION_RECOMMENDATION'"));
assert('MONETIZATION_OPPORTUNITY diagnostics', diagnosticsSrc.includes("'MONETIZATION_OPPORTUNITY'"));
assert('MONETIZATION_FORECAST diagnostics', diagnosticsSrc.includes("'MONETIZATION_FORECAST'"));
assert('recommendation categories defined', RECOMMENDATION_CATEGORIES.every((category) => engineSrc.includes(`'${category}'`)));
assert('example release episode recommendation', engineSrc.includes('Release Episode'));
assert('example premium revenue recommendation', engineSrc.includes('Premium access could increase monthly revenue'));
assert('example sponsorship recommendation', engineSrc.includes('strongest sponsorship potential'));
assert('example marketplace recommendation', engineSrc.includes('under-supplied'));
assert('panel root hook', panelSrc.includes('data-monetization-assistant-panel'));
assert('revenue dashboard integrates panel', revenueDashboardSrc.includes('MonetizationAssistantPanel'));
assert('command center integrates revenue dashboard', commandCenterSrc.includes('RevenueDashboard'));
assert('sentinel integrates monetization intelligence', sentinelPanelSrc.includes('data-sentinel-monetization'));

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
        text.includes('[MONETIZATION_ANALYSIS]') ||
        text.includes('[MONETIZATION_RECOMMENDATION]') ||
        text.includes('[MONETIZATION_OPPORTUNITY]') ||
        text.includes('[MONETIZATION_FORECAST]')
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
await page.waitForSelector('[data-monetization-assistant-panel]', { timeout: 15000 });
await page.waitForTimeout(900);

assert('monetization hook initialized', await page.evaluate(() => Boolean(window.__reelforgeMonetizationAI)));
assert('monetization assistant panel renders', await page.locator('[data-monetization-assistant-panel]').isVisible());
assert('revenue score visible', await page.locator('[data-monetization-revenue-score]').isVisible());
assert('monetization readiness visible', await page.locator('[data-monetization-readiness]').isVisible());
assert('monetization forecast visible', await page.locator('[data-monetization-forecast]').isVisible());
assert('monetization opportunities visible', await page.locator('[data-monetization-opportunities]').isVisible());
assert('monetization recommendations visible', await page.locator('[data-monetization-recommendations]').isVisible());

await page.click('[data-command-section="system"]');
await page.waitForSelector('[data-sentinel-monetization]', { timeout: 15000 });
assert('sentinel monetization block visible', await page.locator('[data-sentinel-monetization]').isVisible());

const unit = await page.evaluate(() => {
    const ai = window.__reelforgeMonetizationAI;
    const master = ai.masterMonetizationAnalysis('series-neon-vengeance', []);
    return {
        fields: Object.keys(master),
        revenueScore: master.revenueScore,
        monetizationReadiness: master.monetizationReadiness,
        sponsorReadiness: master.sponsorReadiness,
        subscriptionReadiness: master.subscriptionReadiness,
        marketplacePotential: master.marketplacePotential,
        opportunityCount: master.topOpportunities.length,
        recommendationCount: master.recommendations.length,
        blockerCount: master.blockers.length,
        projectedMonthlyRevenue: master.projectedMonthlyRevenue,
        projectedAnnualRevenue: master.projectedAnnualRevenue,
        categories: master.recommendations.map((item) => item.category),
        analyzeRevenue: ai.analyzeRevenue('series-neon-vengeance', []).netMonthlyCents,
        analyzeMarketplace: ai.analyzeMarketplace().marketplacePotential
    };
});

for (const field of MASTER_FIELDS) {
    assert(`masterMonetizationAnalysis returns ${field}`, unit.fields.includes(field));
}

assert('revenue score computed', unit.revenueScore > 0);
assert('monetization readiness computed', unit.monetizationReadiness >= 0);
assert('sponsor readiness computed', unit.sponsorReadiness >= 0);
assert('subscription readiness computed', unit.subscriptionReadiness >= 0);
assert('marketplace potential computed', unit.marketplacePotential >= 0);
assert('top opportunities generated', unit.opportunityCount >= 3);
assert('recommendations generated', unit.recommendationCount >= 4);
assert('projected monthly revenue computed', unit.projectedMonthlyRevenue > 0);
assert('projected annual revenue equals monthly x 12', unit.projectedAnnualRevenue === unit.projectedMonthlyRevenue * 12);
assert('recommendation categories represented', RECOMMENDATION_CATEGORIES.some((category) => unit.categories.includes(category)));
assert('analyzeRevenue API works', unit.analyzeRevenue >= 0);
assert('analyzeMarketplace API works', unit.analyzeMarketplace >= 0);

const analysisLogs = parseLogs(logs, 'MONETIZATION_ANALYSIS');
const recommendationLogs = parseLogs(logs, 'MONETIZATION_RECOMMENDATION');
const opportunityLogs = parseLogs(logs, 'MONETIZATION_OPPORTUNITY');
const forecastLogs = parseLogs(logs, 'MONETIZATION_FORECAST');

assert('MONETIZATION_ANALYSIS emitted', analysisLogs.length >= 1);
assert('MONETIZATION_RECOMMENDATION emitted', recommendationLogs.length >= 1);
assert('MONETIZATION_OPPORTUNITY emitted', opportunityLogs.length >= 1);
assert('MONETIZATION_FORECAST emitted', forecastLogs.length >= 1);

writeFileSync(
    REPORT_PATH,
    `${JSON.stringify(
        {
            recommendationCategories: RECOMMENDATION_CATEGORIES,
            unit,
            diagnostics: {
                analysis: analysisLogs.length,
                recommendation: recommendationLogs.length,
                opportunity: opportunityLogs.length,
                forecast: forecastLogs.length
            }
        },
        null,
        2
    )}\n`
);

await browser.close();

console.log('\n=== Monetization AI Validation ===\n');
if (failed) {
    console.log('MONETIZATION_AI_COMPLETE=false');
    process.exit(1);
}

console.log('MONETIZATION_AI_COMPLETE=true');
