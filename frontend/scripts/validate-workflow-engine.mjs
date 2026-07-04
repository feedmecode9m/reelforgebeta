import { chromium } from 'playwright';

const BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';

const browser = await chromium.launch({
    headless: true,
    executablePath:
        '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'
});

const page = await browser.newPage();
const logs = [];

page.on('console', (msg) => {
    const text = msg.text();
    if (
        text.includes('[WORKFLOW_ENGINE]') ||
        text.includes('[WORKFLOW_TASK_CREATED]') ||
        text.includes('[WORKFLOW_TASK_COMPLETED]') ||
        text.includes('[WORKFLOW_TASK_ASSIGNED]')
    ) {
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
await page.click('[data-workspace-tab="production"], [data-command-section="production"]');
await page.waitForTimeout(400);
await page.waitForSelector('[data-workflow-task-center]', { timeout: 15000 });
await page.waitForTimeout(800);

const engineLog = parseLogs('WORKFLOW_ENGINE').pop();
assert('WORKFLOW_ENGINE emitted', Boolean(engineLog));
assert('tasks generated', Boolean(engineLog?.taskCount >= 1));

const createdLogs = parseLogs('WORKFLOW_TASK_CREATED');
assert('metrics tasks persisted (WORKFLOW_TASK_CREATED)', createdLogs.length >= 1);

const persisted = await page.evaluate(() => {
    const raw = localStorage.getItem('reelforge_workflow_tasks');
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
});
assert('workflow tasks stored in localStorage', Boolean(persisted?.tasks?.length >= 1));
assert(
    'task schema valid',
    persisted?.tasks?.every(
        (task) =>
            task.id &&
            task.seriesId &&
            task.taskType &&
            task.priority &&
            typeof task.estimatedImpact === 'number' &&
            ['PENDING', 'IN_PROGRESS', 'COMPLETE'].includes(task.status) &&
            task.createdAt
    )
);

const assignBtn = page.locator('[data-workflow-task-assign]').first();
if ((await assignBtn.count()) > 0) {
    await assignBtn.click();
    await page.waitForTimeout(300);
}
assert('WORKFLOW_TASK_ASSIGNED emitted', parseLogs('WORKFLOW_TASK_ASSIGNED').length >= 1);

const completeBtn = page.locator('[data-workflow-task-complete]').first();
if ((await completeBtn.count()) > 0) {
    await completeBtn.click();
    await page.waitForTimeout(300);
}
assert('WORKFLOW_TASK_COMPLETED emitted', parseLogs('WORKFLOW_TASK_COMPLETED').length >= 1);

const persistedAfter = await page.evaluate(() => {
    const raw = localStorage.getItem('reelforge_workflow_tasks');
    return raw ? JSON.parse(raw) : null;
});
const impactsCalculated = persistedAfter?.tasks?.every(
    (task) => typeof task.estimatedImpact === 'number' && task.estimatedImpact >= 1
);
assert('impact calculated', impactsCalculated);

await page.click('[data-workspace-tab="content"], [data-command-section="content"]');
await page.waitForTimeout(400);

const navTargets = await page.evaluate(() => {
    const targets = window.__reelforgeWorkflow?.WORKFLOW_NAV_TARGETS || {};
    return Object.entries(targets).map(([name, selector]) => ({
        name,
        selector,
        exists: Boolean(document.querySelector(selector))
    }));
});
assert('navigation targets exist', navTargets.every((entry) => entry.exists));

assert('no mock data', engineLog?.usesMockData === false);
assert(
    'readiness improvement projected',
    typeof engineLog?.readinessBefore === 'number' &&
        typeof engineLog?.readinessAfter === 'number' &&
        engineLog.readinessAfter >= engineLog.readinessBefore
);

await page.click('[data-workspace-tab="production"], [data-command-section="production"]');
await page.waitForTimeout(400);

const taskCenterVisible = await page.locator('[data-workflow-task-center]').isVisible();
const actionButtons = await page.locator('[data-workflow-task-action]').count();
const taskCards = await page.locator('[data-workflow-task-card]').count();
assert('workflow task center renders', taskCenterVisible);
assert('workflow task cards render', taskCards >= 1);
assert('task action buttons render', actionButtons >= 1);

const projectedVisible = await page.locator('[data-workflow-projected-readiness]').isVisible();
assert('projected readiness renders', projectedVisible);

const unit = await page.evaluate(() => {
    const plan = window.__reelforgeWorkflow.buildWorkflowTasks('series-neon-vengeance', []);
    const projection = window.__reelforgeWorkflow.projectReadinessFromWorkflow(plan);
    return { taskCount: plan.tasks.length, projection };
});
assert('unit workflow tasks generated', unit.taskCount >= 1);
assert(
    'unit readiness gain projected',
    unit.projection.readinessAfter >= unit.projection.readinessBefore
);

console.log('\n=== Workflow Engine Validation ===\n');
for (const c of checks) {
    console.log(`${c.ok ? '✓' : '✗'} ${c.name}`);
}

if (!failed) {
    console.log('\nWORKFLOW_ENGINE_COMPLETE=true');
} else {
    console.log('\nWORKFLOW_ENGINE_COMPLETE=false');
}

await browser.close();
process.exit(failed ? 1 : 0);
