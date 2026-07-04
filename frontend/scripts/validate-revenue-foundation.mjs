#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';
const REPORT_PATH = join(ROOT, 'revenue-foundation-report.json');

const REVENUE_STREAM_TYPES = [
    'subscriptions',
    'sponsorships',
    'ad_revenue',
    'affiliate_campaigns',
    'premium_episodes',
    'pay_per_view',
    'team_revenue_splits'
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

const enginePath = join(SRC, 'lib/revenue/revenueEngine.js');
const diagnosticsPath = join(SRC, 'lib/revenue/revenueDiagnostics.js');

assert('revenueEngine.js exists', existsSync(enginePath));
assert('revenueDiagnostics.js exists', existsSync(diagnosticsPath));

const engineSrc = readFileSync(enginePath, 'utf8');
const diagnosticsSrc = readFileSync(diagnosticsPath, 'utf8');

assert('REVENUE_STORAGE_KEY is reelforge_revenue_profiles', engineSrc.includes("export const REVENUE_STORAGE_KEY = 'reelforge_revenue_profiles'"));
assert('SeriesRevenueProfile builder exported', engineSrc.includes('export function buildSeriesRevenueProfile'));
assert('CreatorRevenueProfile builder exported', engineSrc.includes('export function buildCreatorRevenueProfile'));
assert('CampaignRevenueProfile builder exported', engineSrc.includes('export function buildCampaignRevenueProfile'));
assert('PlatformRevenueProfile builder exported', engineSrc.includes('export function getDefaultPlatformRevenueProfile'));
assert('subscriptions supported', engineSrc.includes("'subscriptions'"));
assert('sponsorships supported', engineSrc.includes("'sponsorships'"));
assert('ad revenue supported', engineSrc.includes("'ad_revenue'"));
assert('affiliate campaigns supported', engineSrc.includes("'affiliate_campaigns'"));
assert('premium episodes supported', engineSrc.includes("'premium_episodes'"));
assert('pay per view supported', engineSrc.includes("'pay_per_view'"));
assert('team revenue splits supported', engineSrc.includes("'team_revenue_splits'"));
assert('estimateRevenue exported', engineSrc.includes('export function estimateRevenue'));
assert('forecastRevenue exported', engineSrc.includes('export function forecastRevenue'));
assert('initRevenueEngine exported', engineSrc.includes('export function initRevenueEngine'));
assert('REVENUE_PROFILE diagnostics', diagnosticsSrc.includes("'REVENUE_PROFILE'"));
assert('REVENUE_ESTIMATE diagnostics', diagnosticsSrc.includes("'REVENUE_ESTIMATE'"));
assert('REVENUE_FORECAST diagnostics', diagnosticsSrc.includes("'REVENUE_FORECAST'"));

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
        text.includes('[REVENUE_PROFILE]') ||
        text.includes('[REVENUE_ESTIMATE]') ||
        text.includes('[REVENUE_FORECAST]')
    ) {
        logs.push(text);
    }
});

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(800);

assert('revenue hook initialized', await page.evaluate(() => Boolean(window.__reelforgeRevenue)));

const unit = await page.evaluate(() => {
    const revenue = window.__reelforgeRevenue;
    const seriesId = 'series-neon-vengeance';
    const seriesProfile = revenue.buildSeriesRevenueProfile(seriesId);
    revenue.saveSeriesRevenueProfile(seriesId, seriesProfile);
    revenue.saveCreatorRevenueProfile('creator-owner-1', {
        displayName: 'Owner',
        seriesIds: [seriesId]
    });
    revenue.saveCampaignRevenueProfile('campaign-neon-s1', {
        name: 'Neon Season Sponsorship',
        campaignType: 'sponsorships',
        seriesId
    });
    revenue.savePlatformRevenueProfile({ platformFeePercent: 12 });

    const stored = JSON.parse(localStorage.getItem('reelforge_revenue_profiles') || '{}');
    const estimate = revenue.estimateSeriesRevenue(seriesId, { monthlyViewers: 5000, episodes: 12 });
    const forecast = revenue.forecastRevenue(
        {
            ...seriesProfile,
            profileType: 'series',
            profileId: seriesId,
            platformFeePercent: 12
        },
        { months: 3, growthRate: 0.1, monthlyViewers: 5000, episodes: 12 }
    );
    const campaignEstimate = revenue.estimateCampaignRevenue('campaign-neon-s1');

    return {
        storageKey: 'reelforge_revenue_profiles',
        hasSeries: Boolean(stored.series?.[seriesId]),
        hasCreator: Boolean(stored.creators?.['creator-owner-1']),
        hasCampaign: Boolean(stored.campaigns?.['campaign-neon-s1']),
        hasPlatform: Boolean(stored.platform?.platformId),
        streamTypes: seriesProfile.streams.map((stream) => stream.type),
        teamSplitCount: seriesProfile.teamSplits.length,
        estimateGross: estimate.grossMonthlyCents,
        estimateNet: estimate.netCreatorCents,
        forecastMonths: forecast.points.length,
        forecastTotal: forecast.totalNetCreatorCents,
        campaignGross: campaignEstimate.grossMonthlyCents
    };
});

assert('profiles persist to reelforge_revenue_profiles', unit.hasSeries && unit.hasCreator && unit.hasCampaign && unit.hasPlatform);
assert('monetization stream types modeled', REVENUE_STREAM_TYPES.filter((type) => type !== 'team_revenue_splits').every((type) => unit.streamTypes.includes(type)));
assert('team revenue splits modeled', unit.teamSplitCount >= 2);
assert('series estimate computes gross revenue', unit.estimateGross > 0);
assert('series estimate computes net creator revenue', unit.estimateNet >= 0);
assert('forecast generates monthly points', unit.forecastMonths === 3);
assert('forecast computes total net revenue', unit.forecastTotal >= unit.estimateNet);
assert('campaign estimate computes revenue', unit.campaignGross > 0);

const profileLogs = parseLogs(logs, 'REVENUE_PROFILE');
const estimateLogs = parseLogs(logs, 'REVENUE_ESTIMATE');
const forecastLogs = parseLogs(logs, 'REVENUE_FORECAST');

assert('REVENUE_PROFILE emitted', profileLogs.length >= 1);
assert('REVENUE_ESTIMATE emitted', estimateLogs.length >= 1);
assert('REVENUE_FORECAST emitted', forecastLogs.length >= 1);

writeFileSync(
    REPORT_PATH,
    `${JSON.stringify(
        {
            storageKey: 'reelforge_revenue_profiles',
            streamTypes: REVENUE_STREAM_TYPES,
            unit,
            diagnostics: {
                profile: profileLogs.length,
                estimate: estimateLogs.length,
                forecast: forecastLogs.length
            }
        },
        null,
        2
    )}\n`
);

await browser.close();

console.log('\n=== Revenue Foundation Validation ===\n');
if (failed) {
    console.log('REVENUE_FOUNDATION_COMPLETE=false');
    process.exit(1);
}

console.log('REVENUE_FOUNDATION_COMPLETE=true');
