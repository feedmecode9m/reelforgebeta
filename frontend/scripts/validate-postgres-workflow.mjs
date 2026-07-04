import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const FRONTEND = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';
const BACKEND = process.env.REELFORGE_BACKEND_URL || 'http://127.0.0.1:8080';

let failed = false;

function assert(name, ok) {
    if (!ok) {
        failed = true;
        console.log(`FAIL: ${name}`);
    } else {
        console.log(`PASS: ${name}`);
    }
}

try {
    execSync(`docker exec reelforge-db-1 psql -U user -d reelforge -c "TRUNCATE workflow_tasks;"`, {
        stdio: 'ignore'
    });
    console.log('PASS: workflow_tasks cleared');
} catch {
    console.log('WARN: could not truncate workflow_tasks');
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

async function apiJson(path, options = {}) {
    const res = await fetch(`${BACKEND}${path}`, options);
    const body = await res.json().catch(() => ({}));
    return { res, body };
}

const { res: statusRes, body: statusBody } = await apiJson('/api/workflow/status');
assert('workflow API status reachable', statusRes.ok && statusBody.enabled === true);

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
        text.includes('[WORKFLOW_DB_READ]') ||
        text.includes('[WORKFLOW_DB_WRITE]') ||
        text.includes('[WORKFLOW_ENGINE]') ||
        text.includes('[WORKFLOW_TASK_CREATED]') ||
        text.includes('[WORKFLOW_TASK_ASSIGNED]') ||
        text.includes('[WORKFLOW_TASK_COMPLETED]')
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

await page.goto(`${FRONTEND}/`, { waitUntil: 'networkidle' });
await page.click('.ghost-trigger');
await page.waitForSelector('[data-workflow-task-center]', { timeout: 15000 });
await page.waitForTimeout(1200);

assert('workflow hook initialized', await page.evaluate(() => Boolean(window.__reelforgeWorkflow)));

const readLogs = parseDiagLogs(logs, 'WORKFLOW_DB_READ');
const writeLogs = parseDiagLogs(logs, 'WORKFLOW_DB_WRITE');
assert('WORKFLOW_DB_READ emitted', readLogs.length >= 1);
assert('WORKFLOW_DB_WRITE emitted', writeLogs.length >= 1);

const engineLog = parseDiagLogs(logs, 'WORKFLOW_ENGINE').pop();
assert('WORKFLOW_ENGINE emitted', Boolean(engineLog));
assert('tasks generated', Boolean(engineLog?.taskCount >= 1));

const persisted = await page.evaluate(() => {
    const raw = localStorage.getItem('reelforge_workflow_tasks');
    return raw ? JSON.parse(raw) : null;
});
assert('workflow tasks stored in localStorage cache', Boolean(persisted?.tasks?.length >= 1));

const { body: dbTasks } = await apiJson('/api/workflow/tasks?seriesId=series-neon-vengeance');
assert('tasks persisted in PostgreSQL', Array.isArray(dbTasks) && dbTasks.length >= 1);
assert(
    'postgres task schema valid',
    dbTasks.every(
        (task) =>
            task.id &&
            task.seriesId &&
            task.taskType &&
            task.priority &&
            ['PENDING', 'IN_PROGRESS', 'COMPLETE'].includes(task.status) &&
            task.createdAt
    )
);

const assignBtn = page.locator('[data-workflow-task-assign]').first();
if ((await assignBtn.count()) > 0) {
    await assignBtn.click();
    await page.waitForTimeout(500);
}
assert('WORKFLOW_TASK_ASSIGNED emitted', parseDiagLogs(logs, 'WORKFLOW_TASK_ASSIGNED').length >= 1);

const completeBtn = page.locator('[data-workflow-task-complete]').first();
if ((await completeBtn.count()) > 0) {
    await completeBtn.click();
    await page.waitForTimeout(500);
}
assert('WORKFLOW_TASK_COMPLETED emitted', parseDiagLogs(logs, 'WORKFLOW_TASK_COMPLETED').length >= 1);

const taskCenterVisible = await page.locator('[data-workflow-task-center]').isVisible();
const taskCards = await page.locator('[data-workflow-task-card]').count();
assert('workflow task center renders', taskCenterVisible);
assert('workflow task cards render', taskCards >= 1);

const testTaskId = `wf-validation-${Date.now()}`;
const { res: createRes, body: created } = await apiJson('/api/workflow/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        id: testTaskId,
        seriesId: 'series-neon-vengeance',
        episodeId: 'ep-neon-s01e03',
        taskType: 'MISSING_ASSET',
        priority: 1,
        status: 'PENDING',
        estimatedImpact: 8,
        title: 'Validation Task'
    })
});
assert('POST /api/workflow/tasks', createRes.status === 201 && created?.id === testTaskId);

const { res: updateRes, body: updated } = await apiJson(
    `/api/workflow/tasks/${encodeURIComponent(testTaskId)}`,
    {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'IN_PROGRESS', assignedTo: 'validator' })
    }
);
assert(
    'PUT /api/workflow/tasks/:id',
    updateRes.ok && updated?.status === 'IN_PROGRESS' && updated?.assignedTo === 'validator'
);

const { res: deleteRes } = await apiJson(`/api/workflow/tasks/${encodeURIComponent(testTaskId)}`, {
    method: 'DELETE'
});
assert('DELETE /api/workflow/tasks/:id', deleteRes.ok);

await browser.close();

console.log('\n=== PostgreSQL Workflow Validation ===\n');
if (failed) {
    console.log('POSTGRES_WORKFLOW_COMPLETE=false');
    process.exit(1);
}

console.log('POSTGRES_WORKFLOW_COMPLETE=true');
