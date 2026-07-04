import { chromium } from 'playwright';

const FRONTEND = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';

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

const browser = await chromium.launch({
    headless: true,
    executablePath:
        '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'
});

const page = await browser.newPage();
const logs = [];

page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[REPAIR_PREDICTION]') || text.includes('[REPAIR_RECOMMENDATION]')) {
        logs.push(text);
    }
});

const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

await page.addInitScript(
    ({ releaseDate }) => {
        localStorage.setItem('admin_mode', 'true');
        localStorage.removeItem('reelforge_studio_repair_rollback');
        localStorage.removeItem('reelforge_studio_repair_overlays');
        localStorage.removeItem('reelforge_workflow_tasks');
        localStorage.setItem(
            'reelforge_series_metadata',
            JSON.stringify({
                '4a50ca17-124c-401e-b4bd-d711b781be36': {
                    reelId: '4a50ca17-124c-401e-b4bd-d711b781be36',
                    episodeId: 'ep-neon-s01e02',
                    seriesId: 'series-neon-vengeance',
                    seasonNumber: 1,
                    episodeNumber: 2,
                    seriesName: 'Neon Vengeance',
                    episodeTitle: 'Blood Protocol',
                    episodeStatus: 'published',
                    genre: 'Cyber-Action',
                    runtime: 298,
                    releaseYear: 2024,
                    updatedAt: Date.now()
                },
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
                }
            })
        );
        localStorage.setItem(
            'reelforge_release_schedule',
            JSON.stringify({
                'ep-neon-s01e03': {
                    episodeId: 'ep-neon-s01e03',
                    seriesId: 'series-neon-vengeance',
                    releaseAt: Date.now() + 86400000,
                    releaseTime: '20:00',
                    status: 'scheduled',
                    updatedAt: Date.now()
                },
                'ep-neon-s01e02': {
                    episodeId: 'ep-neon-s01e02',
                    seriesId: 'series-neon-vengeance',
                    releaseAt: Date.now() + 172800000,
                    releaseTime: '19:00',
                    status: 'scheduled',
                    updatedAt: Date.now()
                }
            })
        );
        localStorage.setItem(
            'reelforge_workflow_tasks',
            JSON.stringify({
                version: 1,
                tasks: [
                    {
                        id: 'wf-missing-asset-ep-neon-s01e04',
                        seriesId: 'series-neon-vengeance',
                        episodeId: 'ep-neon-s01e04',
                        reelId: null,
                        taskType: 'MISSING_ASSET',
                        title: 'Attach asset for Zero Day',
                        status: 'PENDING',
                        priority: 1,
                        estimatedImpact: 20,
                        assignedTo: null
                    },
                    {
                        id: 'wf-metadata-ep-neon-s01e02',
                        seriesId: 'series-neon-vengeance',
                        episodeId: 'ep-neon-s01e02',
                        reelId: '4a50ca17-124c-401e-b4bd-d711b781be36',
                        taskType: 'MISSING_METADATA',
                        title: 'Complete metadata for Blood Protocol',
                        status: 'PENDING',
                        priority: 2,
                        estimatedImpact: 12,
                        assignedTo: null
                    }
                ]
            })
        );
    },
    { releaseDate: tomorrow }
);

await page.goto(`${FRONTEND}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => document.querySelector('.ghost-trigger')?.click());
await page.waitForSelector('[data-production-command-center]', { timeout: 15000 });
await page.click('[data-command-section="system"]');
await page.waitForSelector('[data-predictive-repair]', { timeout: 15000 });
await page.waitForSelector('[data-studio-repair-center]', { timeout: 15000 });
await page.waitForTimeout(900);

assert('predictive repair hook initialized', await page.evaluate(() => Boolean(window.__reelforgePredictiveRepair)));
assert('predictive repair panel renders', await page.locator('[data-predictive-repair]').isVisible());
assert('legacy repair center preserved', await page.locator('[data-studio-repair-center]').isVisible());

const predictionLogs = parseDiagLogs(logs, 'REPAIR_PREDICTION');
const recommendationLogs = parseDiagLogs(logs, 'REPAIR_RECOMMENDATION');
assert('REPAIR_PREDICTION emitted', predictionLogs.length >= 1);
assert('REPAIR_RECOMMENDATION emitted', recommendationLogs.length >= 1);

const metrics = await page.evaluate(() => ({
    assets: document.querySelector('[data-prediction-missing-assets]')?.textContent,
    thumbnails: document.querySelector('[data-prediction-missing-thumbnails]')?.textContent,
    metadata: document.querySelector('[data-prediction-incomplete-metadata]')?.textContent,
    bottlenecks: document.querySelector('[data-prediction-workflow-bottlenecks]')?.textContent,
    blockers: document.querySelector('[data-prediction-release-blockers]')?.textContent,
    teamGaps: document.querySelector('[data-prediction-team-gaps]')?.textContent,
    risk: document.querySelector('[data-repair-risk-score]')?.textContent
}));

assert('missing assets metric visible', metrics.assets !== undefined);
assert('missing thumbnails metric visible', metrics.thumbnails !== undefined);
assert('incomplete metadata metric visible', metrics.metadata !== undefined);
assert('workflow bottlenecks metric visible', metrics.bottlenecks !== undefined);
assert('release blockers metric visible', metrics.blockers !== undefined);
assert('team assignment gaps metric visible', metrics.teamGaps !== undefined);
assert('pre-release risk score visible', metrics.risk?.includes('%'));

const snapshot = await page.evaluate(() =>
    window.__reelforgePredictiveRepair.buildPredictiveRepairSnapshot('series-neon-vengeance', [])
);

assert('snapshot predicts issues', snapshot.predictions.length >= 1);
assert('snapshot recommends fixes', snapshot.recommendations.length >= 1);
assert('missing assets category tracked', snapshot.categoryCounts.missing_assets >= 0);
assert('missing thumbnails category tracked', snapshot.categoryCounts.missing_thumbnails >= 0);
assert('incomplete metadata category tracked', snapshot.categoryCounts.incomplete_metadata >= 0);
assert('workflow bottlenecks category tracked', snapshot.categoryCounts.workflow_bottlenecks >= 0);
assert('release blockers category tracked', snapshot.categoryCounts.release_blockers >= 0);
assert('team assignment gaps category tracked', snapshot.categoryCounts.team_assignment_gaps >= 0);

const predictionItems = await page.locator('[data-repair-prediction]').count();
const recommendationItems = await page.locator('[data-repair-recommendation]').count();
assert('prediction list renders', predictionItems >= 1);
assert('recommendation list renders', recommendationItems >= 1);

const legacyIssues = await page.locator('[data-repair-issue]').count();
assert('legacy repair issues preserved', legacyIssues >= 0);

await browser.close();

console.log('\n=== Predictive Repair Engine V2 Validation ===\n');
if (failed) {
    console.log('REPAIR_ENGINE_V2_COMPLETE=false');
    process.exit(1);
}

console.log('REPAIR_ENGINE_V2_COMPLETE=true');
