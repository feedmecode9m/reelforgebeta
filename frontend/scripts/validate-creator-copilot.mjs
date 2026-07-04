import { chromium } from 'playwright';

const BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';
const PRIORITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

const browser = await chromium.launch({
    headless: true,
    executablePath:
        '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'
});

const page = await browser.newPage();
const logs = [];

page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[COPILOT_ANALYSIS]') || text.includes('[COPILOT_RECOMMENDATION]')) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
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
                description: 'Old allies resurface.',
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
});

function parseLogs(tag) {
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

let failed = false;
const checks = [];

function assert(name, ok) {
    checks.push({ name, ok });
    if (!ok) {
        failed = true;
        console.log(`FAIL: ${name}`);
    } else {
        console.log(`PASS: ${name}`);
    }
}

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.click('.ghost-trigger');
await page.waitForSelector('[data-production-operations-dashboard]', { timeout: 20000 });
await page.click('[data-workspace-tab="automation"], [data-command-section="automation"]');
await page.waitForTimeout(400);
await page.waitForSelector('[data-creator-copilot]', { timeout: 15000 });
await page.waitForTimeout(600);

assert('copilot hook initialized', await page.evaluate(() => Boolean(window.__reelforgeCopilot)));

const analysisLog = parseLogs('COPILOT_ANALYSIS').pop();
const recommendationLogs = parseLogs('COPILOT_RECOMMENDATION');
assert('COPILOT_ANALYSIS emitted', Boolean(analysisLog));
assert('COPILOT_RECOMMENDATION emitted', recommendationLogs.length >= 1);

const blockerText = await page.locator('[data-copilot-blocker] .creator-copilot__blocker-text').innerText();
assert('blocker detection', blockerText.length > 10 && !blockerText.includes('on track'));

const projectedVisible = await page.locator('[data-copilot-projected-readiness]').isVisible();
const projectedAfter = analysisLog?.projectedReadiness ?? 0;
const currentReadiness = analysisLog?.currentReadiness ?? 0;
assert('readiness projection renders', projectedVisible);
assert(
    'readiness projection increases',
    projectedAfter >= currentReadiness && projectedAfter > currentReadiness
);

const recPriorities = recommendationLogs.map((r) => r.priority);
const priorityOrdered =
    recPriorities.length <= 1 ||
    recPriorities.every((priority, index) => {
        if (index === 0) return true;
        return PRIORITY_ORDER.indexOf(priority) >= PRIORITY_ORDER.indexOf(recPriorities[index - 1]);
    });
assert('recommendation ordering', priorityOrdered && recPriorities.length >= 1);

const estimatedTime = analysisLog?.estimatedTime ?? 0;
const topPriorityCount = await page.locator('[data-copilot-priority-item]').count();
assert('estimated time calculation', estimatedTime > 0);
assert('top priorities render', topPriorityCount >= 1);

const analysisVisible = await page.locator('[data-copilot-analysis]').isVisible();
const criticalRisksVisible = await page.locator('[data-copilot-critical-risks]').count();
const recommendedVisible = await page.locator('[data-copilot-recommended-actions]').isVisible();
assert('analysis panel renders', analysisVisible);
assert('critical risks section renders', criticalRisksVisible >= 1);
assert('recommended actions render', recommendedVisible);

const unitResult = await page.evaluate(() => {
    const copilot = window.__reelforgeCopilot;
    const brief = copilot.buildCreatorCopilotBrief('series-neon-vengeance', []);
    const projection = copilot.projectCopilotReadiness(brief);
    return {
        blocker: brief.biggestBlocker,
        readinessAfter: projection.readinessAfter,
        readinessBefore: projection.readinessBefore,
        estimatedTime: brief.estimatedTime,
        criticalPriority: copilot.resolveCopilotPriority('missing-asset', 6, true),
        lowPriority: copilot.resolveCopilotPriority('missing-thumbnail', 1),
        analysis: brief.analysis,
        topPriorities: brief.topPriorities.length,
        quickWins: brief.quickWins.length,
        criticalRisks: brief.criticalRisks.length
    };
});

assert('unit blocker detected', unitResult.blocker.includes('reel attached'));
assert('unit readiness projected', unitResult.readinessAfter > unitResult.readinessBefore);
assert('unit estimated time', unitResult.estimatedTime > 0);
assert(
    'unit priority mapping',
    unitResult.criticalPriority === 'CRITICAL' && unitResult.lowPriority === 'LOW'
);
assert('unit analyzes readiness', unitResult.analysis.readiness.score >= 0);
assert('unit analyzes workflow', unitResult.analysis.workflow.openTasks >= 0);
assert('unit analyzes release', unitResult.analysis.release.launchReadinessScore >= 0);
assert('unit analyzes assets', unitResult.analysis.assets.coveragePercent >= 0);
assert('unit categorizes priorities', unitResult.topPriorities >= 1);
assert('unit categorizes risks', unitResult.criticalRisks >= 1);

console.log('\n=== Creator Copilot Validation ===\n');
for (const c of checks) {
    console.log(`${c.ok ? '✓' : '✗'} ${c.name}`);
}

if (!failed) {
    console.log('\nCREATOR_COPILOT_COMPLETE=true');
} else {
    console.log('\nCREATOR_COPILOT_COMPLETE=false');
}

await browser.close();
process.exit(failed ? 1 : 0);
