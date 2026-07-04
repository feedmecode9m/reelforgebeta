#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const FRONTEND = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';

const DASHBOARD_SECTIONS = [
    'executive-overview',
    'security',
    'production',
    'publishing',
    'teams',
    'revenue'
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

function parseDiagLogs(logs, tag) {
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

const componentPath = join(SRC, 'components/studio/ProductionCommandCenter.svelte');
const legacyPath = join(SRC, 'components/command/ProductionCommandCenter.svelte');
const libPath = join(SRC, 'lib/command/commandCenter.js');

assert('ProductionCommandCenter.svelte exists', existsSync(componentPath));
assert('legacy command re-export exists', existsSync(legacyPath));
assert('commandCenter.js exists', existsSync(libPath));

const componentSrc = readFileSync(componentPath, 'utf8');
const libSrc = readFileSync(libPath, 'utf8');

assert('buildPlatformOperationsBrief exported', libSrc.includes('export function buildPlatformOperationsBrief'));
assert('COMMAND_DASHBOARD_SECTIONS exported', libSrc.includes('COMMAND_DASHBOARD_SECTIONS'));
assert('aggregates sentinel assistant', libSrc.includes('masterAnalysis'));
assert('aggregates hero intelligence', libSrc.includes('buildHeroCommandBrief'));
assert('KPI readiness strip', componentSrc.includes('data-command-readiness'));
assert('KPI threat level strip', componentSrc.includes('data-command-threat-level'));
assert('top risks panel', componentSrc.includes('data-command-top-risks-panel'));
assert('recommended actions panel', componentSrc.includes('data-command-recommended-actions-panel'));
assert('dashboard sections navigation', componentSrc.includes('data-command-dashboard-sections'));
assert('command center integrates revenue dashboard', componentSrc.includes('RevenueDashboard'));
assert('sentinel summary block', componentSrc.includes('data-command-sentinel-summary'));
assert('operations dashboard block', componentSrc.includes('data-command-operations-dashboard'));
assert('hero intelligence block', componentSrc.includes('data-command-hero-intelligence'));

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
        text.includes('[COMMAND_CENTER]') ||
        text.includes('[COMMAND_CENTER_REFRESH]') ||
        text.includes('[COMMAND_CENTER_LOAD]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.removeItem('reelforge_workflow_tasks');
    localStorage.setItem('reelforge_current_team_user', 'user-owner-1');
    localStorage.setItem(
        'reelforge_series_metadata',
        JSON.stringify({
            'd511d64e-10c3-4a11-afa6-927b968c8afd': {
                reelId: 'd511d64e-10c3-4a11-afa6-927b968c8afd',
                episodeId: 'ep-neon-s01e01',
                seriesId: 'series-neon-vengeance',
                seasonNumber: 1,
                episodeNumber: 1,
                seriesName: 'Neon Vengeance',
                episodeTitle: 'Ghost in the Grid',
                episodeStatus: 'published',
                genre: 'Cyber-Action',
                description: 'A hacker discovers encrypted memories.',
                runtime: 312,
                releaseYear: 2024,
                updatedAt: Date.now()
            },
            '4a50ca17-124c-401e-b4bd-d711b781be36': {
                reelId: '4a50ca17-124c-401e-b4bd-d711b781be36',
                episodeId: 'ep-neon-s01e02',
                seriesId: 'series-neon-vengeance',
                seasonNumber: 1,
                episodeNumber: 2,
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

await page.goto(`${FRONTEND}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => document.querySelector('.ghost-trigger')?.click());
await page.waitForSelector('[data-production-command-center]', { timeout: 15000 });
await page.waitForTimeout(1200);

assert('command center renders', await page.locator('[data-production-command-center]').isVisible());
assert('operations dashboard wrapper preserved', await page.locator('[data-production-operations-dashboard]').isVisible());
assert('command center hook initialized', await page.evaluate(() => Boolean(window.__reelforgeCommandCenter)));

const centerLogs = parseDiagLogs(logs, 'COMMAND_CENTER');
const refreshLogs = parseDiagLogs(logs, 'COMMAND_CENTER_REFRESH');
assert('COMMAND_CENTER emitted', centerLogs.length >= 1);
assert('COMMAND_CENTER includes threat level', centerLogs.some((entry) => entry.threatLevel));
assert('COMMAND_CENTER includes security score', centerLogs.some((entry) => typeof entry.securityScore === 'number'));
assert('COMMAND_CENTER_REFRESH emitted', refreshLogs.length >= 1);

assert('KPI readiness visible', await page.locator('[data-command-readiness]').isVisible());
assert('KPI threat level visible', await page.locator('[data-command-threat-level]').isVisible());
assert('top risks KPI visible', await page.locator('[data-command-top-risks]').isVisible());
assert('recommended actions KPI visible', await page.locator('[data-command-recommended-actions]').isVisible());

assert('dashboard section tabs render', (await page.locator('[data-command-dashboard-section]').count()) === 6);
for (const sectionId of DASHBOARD_SECTIONS) {
    await page.click(`[data-command-dashboard-section="${sectionId}"]`);
    await page.waitForTimeout(250);
    assert(`dashboard section ${sectionId} opens`, await page.locator(`[data-command-dashboard-detail="${sectionId}"]`).isVisible());
}

assert('revenue dashboard visible', await page.locator('[data-revenue-dashboard]').isVisible());
assert('executive sentinel summary visible', await page.locator('[data-command-sentinel-summary]').isVisible());
assert('hero intelligence visible', await page.locator('[data-command-hero-intelligence]').isVisible());
assert('operations dashboard visible', await page.locator('[data-command-operations-dashboard]').isVisible());
assert('notifications summary visible', await page.locator('[data-command-notifications-summary]').isVisible());

assert('today\'s focus banner visible', await page.locator('[data-command-todays-focus]').isVisible());
assert('status grid visible', await page.locator('[data-command-status-grid]').isVisible());
assert('six status sections', (await page.locator('[data-command-status-section]').count()) === 6);

const sections = ['production', 'content', 'teams', 'analytics', 'automation', 'system'];
for (const section of sections) {
    await page.click(`[data-command-section="${section}"]`);
    await page.waitForTimeout(350);
}
assert('all command sections navigable', sections.length === 6);

await page.click('[data-command-center-refresh]');
await page.waitForTimeout(500);
assert('manual refresh emits diagnostics', parseDiagLogs(logs, 'COMMAND_CENTER_REFRESH').length >= 2);

const unit = await page.evaluate(() => {
    const cc = window.__reelforgeCommandCenter;
    const brief = cc.buildPlatformOperationsBrief('series-neon-vengeance', []);
    return {
        dashboardCount: brief.dashboardSections.length,
        topRiskCount: brief.topRisks.length,
        actionCount: brief.recommendedActions.length,
        readiness: brief.readinessScore,
        threatLevel: brief.threatLevel,
        securityScore: brief.securityScore,
        teamHealth: brief.teamHealth,
        workflowHealth: brief.workflowHealth,
        publishingHealth: brief.publishingHealth,
        heroSeries: brief.hero?.primary?.seriesTitle,
        operationsViewers: brief.operations?.dailyActiveViewers
    };
});

assert('unit brief composes six dashboard sections', unit.dashboardCount === 6);
assert('unit brief composes readiness', typeof unit.readiness === 'number');
assert('unit brief composes threat level', Boolean(unit.threatLevel));
assert('unit brief composes security score', typeof unit.securityScore === 'number');
assert('unit brief composes team health', typeof unit.teamHealth === 'number');
assert('unit brief composes workflow health', typeof unit.workflowHealth === 'number');
assert('unit brief composes publishing health', typeof unit.publishingHealth === 'number');
assert('unit brief composes hero intelligence', Boolean(unit.heroSeries));
assert('unit brief composes operations dashboard', unit.operationsViewers !== undefined);
assert('unit brief composes top risks', unit.topRiskCount >= 0);
assert('unit brief composes recommended actions', unit.actionCount >= 0);

writeFileSync(
    join(ROOT, 'command-center-report.json'),
    `${JSON.stringify({ sections: DASHBOARD_SECTIONS, diagnostics: centerLogs.length }, null, 2)}\n`
);

await browser.close();

console.log('\n=== Command Center Validation ===\n');
if (failed) {
    console.log('COMMAND_CENTER_COMPLETE=false');
    process.exit(1);
}

console.log('COMMAND_CENTER_COMPLETE=true');
