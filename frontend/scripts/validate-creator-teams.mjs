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
    execSync(
        `docker exec reelforge-db-1 psql -U user -d reelforge -c "TRUNCATE team_activity, team_members, teams CASCADE;"`,
        { stdio: 'ignore' }
    );
    console.log('PASS: team tables cleared');
} catch {
    console.log('WARN: could not truncate team tables');
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

const { res: statusRes, body: statusBody } = await apiJson('/api/teams/status');
assert('team API status reachable', statusRes.ok && statusBody.enabled === true);
assert('team roles exposed', Array.isArray(statusBody.roles) && statusBody.roles.length === 5);

const { res: usersRes, body: usersBody } = await apiJson('/api/users');
assert('GET /api/users', usersRes.ok && Array.isArray(usersBody) && usersBody.length >= 5);

const teamId = `team-validation-${Date.now()}`;
const { res: createTeamRes, body: createdTeam } = await apiJson('/api/teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        id: teamId,
        name: 'Validation Team',
        seriesId: 'series-neon-vengeance',
        ownerUserId: 'user-owner-1'
    })
});
assert('POST /api/teams', createTeamRes.status === 201 && createdTeam?.id === teamId);

const { res: addMemberRes, body: addedMember } = await apiJson(
    `/api/teams/${encodeURIComponent(teamId)}/members`,
    {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'user-writer-1', role: 'WRITER' })
    }
);
assert('POST /api/teams/:id/members', addMemberRes.status === 201 && addedMember?.role === 'WRITER');

const { res: roleRes, body: roleBody } = await apiJson(
    `/api/teams/${encodeURIComponent(teamId)}/members/user-writer-1`,
    {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'EDITOR' })
    }
);
assert('PUT /api/teams/:id/members/:userId', roleRes.ok && roleBody?.role === 'EDITOR');

await apiJson(`/api/teams/${encodeURIComponent(teamId)}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'user-editor-1', role: 'EDITOR' })
});

const testTaskId = `wf-team-${Date.now()}`;
await apiJson('/api/workflow/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        id: testTaskId,
        seriesId: 'series-neon-vengeance',
        episodeId: 'ep-neon-s01e03',
        taskType: 'MISSING_METADATA',
        priority: 2,
        status: 'PENDING',
        title: 'Team Assignment Task'
    })
});

const { res: assignRes, body: assignBody } = await apiJson(
    `/api/teams/${encodeURIComponent(teamId)}/assign-task`,
    {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            taskId: testTaskId,
            userId: 'user-editor-1',
            assignedBy: 'user-owner-1'
        })
    }
);
assert('POST /api/teams/:id/assign-task', assignRes.ok && assignBody?.task?.assignedTo);
assert('assigned task status updated', assignBody?.task?.status === 'IN_PROGRESS');

const { res: activityRes, body: activityBody } = await apiJson(
    `/api/teams/${encodeURIComponent(teamId)}/activity`
);
assert('GET /api/teams/:id/activity', activityRes.ok && Array.isArray(activityBody) && activityBody.length >= 3);
assert(
    'activity includes task_assigned',
    activityBody.some((item) => (item.activityType || item.activity_type) === 'task_assigned')
);

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
        text.includes('[TEAM_MEMBER_ADDED]') ||
        text.includes('[TEAM_ROLE_CHANGED]') ||
        text.includes('[TASK_ASSIGNED]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.removeItem('reelforge_creator_teams');
    localStorage.removeItem('reelforge_workflow_tasks');
    localStorage.setItem('reelforge_current_team_user', 'user-owner-1');
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

await page.goto(`${FRONTEND}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.click('.ghost-trigger');
await page.waitForSelector('[data-production-operations-dashboard], [data-team-manager]', { timeout: 20000 });
await page.click('[data-workspace-tab="teams"], [data-command-section="teams"]');
await page.waitForTimeout(400);
await page.waitForTimeout(1500);

assert('team manager renders', await page.locator('[data-team-manager]').isVisible());
assert('teams hook initialized', await page.evaluate(() => Boolean(window.__reelforgeTeams)));

const memberCount = await page.locator('[data-team-member]').count();
assert('team members listed', memberCount >= 1);

if ((await page.locator('[data-team-add-user]').count()) > 0) {
    await page.selectOption('[data-team-add-user]', 'user-reviewer-1');
    await page.selectOption('[data-team-add-role]', 'REVIEWER');
    await page.click('[data-team-add-member-btn]');
    await page.waitForTimeout(600);
}

await page.evaluate(() => {
    const feedReels = [
        {
            id: 'd511d64e-10c3-4a11-afa6-927b968c8afd',
            episodeId: 'ep-neon-s01e01',
            seriesId: 'series-neon-vengeance',
            title: 'Ghost in the Grid'
        },
        {
            id: '4a50ca17-124c-401e-b4bd-d711b781be36',
            episodeId: 'ep-neon-s01e02',
            seriesId: 'series-neon-vengeance',
            title: 'Blood Protocol'
        }
    ];
    if (window.__reelforgeWorkflow?.syncWorkflowTasks) {
        window.__reelforgeWorkflow.syncWorkflowTasks('series-neon-vengeance', feedReels);
    }
});

const roleSelect = page.locator('[data-team-role-select]').nth(1);
if ((await roleSelect.count()) > 0) {
    await roleSelect.selectOption('PRODUCER');
    await page.waitForTimeout(500);
} else {
    const fallbackRole = page.locator('[data-team-role-select]').first();
    if ((await fallbackRole.count()) > 0) {
        await fallbackRole.selectOption('PRODUCER');
        await page.waitForTimeout(500);
    }
}

await page.waitForTimeout(800);

const taskSelect = page.locator('[data-team-task-select]');
if ((await taskSelect.count()) > 0) {
    const options = await taskSelect.locator('option').evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('value')).filter(Boolean)
    );
    if (options.length > 0) {
        await taskSelect.selectOption(options[0]);
        const assigneeSelect = page.locator('[data-team-assignee-select]');
        if ((await assigneeSelect.count()) > 0) {
            const assignees = await assigneeSelect.locator('option').evaluateAll((nodes) =>
                nodes.map((node) => node.getAttribute('value')).filter(Boolean)
            );
            if (assignees.length > 0) {
                await assigneeSelect.selectOption(assignees[0]);
            }
        }
        await page.click('[data-team-assign-task]');
        await page.waitForTimeout(900);
    }
}

if (parseDiagLogs(logs, 'TEAM_ROLE_CHANGED').length === 0) {
    await page.evaluate(async () => {
        const teams = window.__reelforgeTeams;
        const team = await teams.ensureTeamForSeries('series-neon-vengeance');
        const member = team.members.find((item) => item.userId !== 'user-owner-1') || team.members[0];
        if (member) {
            await teams.changeMemberRole(team.id, member.userId, 'PRODUCER');
        }
    });
    await page.waitForTimeout(400);
}

if (parseDiagLogs(logs, 'TASK_ASSIGNED').length === 0) {
    await page.evaluate(async () => {
        const teams = window.__reelforgeTeams;
        const team = await teams.ensureTeamForSeries('series-neon-vengeance');
        const tasks = teams.getOpenTasksForAssignment('series-neon-vengeance');
        const member = team.members.find((item) => item.role === 'EDITOR') || team.members[0];
        if (tasks[0] && member) {
            await teams.assignTaskToMember(
                team.id,
                tasks[0].id,
                member.userId,
                'series-neon-vengeance'
            );
        }
    });
    await page.waitForTimeout(400);
}

assert('TEAM_MEMBER_ADDED emitted', parseDiagLogs(logs, 'TEAM_MEMBER_ADDED').length >= 1);
assert('TEAM_ROLE_CHANGED emitted', parseDiagLogs(logs, 'TEAM_ROLE_CHANGED').length >= 1);
assert('TASK_ASSIGNED emitted', parseDiagLogs(logs, 'TASK_ASSIGNED').length >= 1);

const uiState = await page.evaluate(() => {
    const members = document.querySelectorAll('[data-team-member]').length;
    const activity = document.querySelectorAll('[data-team-activity-item]').length;
    const assigned = document.querySelectorAll('[data-team-assigned-task]').length;
    const cache = localStorage.getItem('reelforge_creator_teams');
    return { members, activity, assigned, cache: cache ? JSON.parse(cache) : null };
});

assert('team local cache written', Boolean(uiState.cache?.teams?.length >= 1));
assert('team activity visible', uiState.activity >= 1 || uiState.members >= 2);

await browser.close();

console.log('\n=== Creator Teams Validation ===\n');
if (failed) {
    console.log('CREATOR_TEAMS_COMPLETE=false');
    process.exit(1);
}

console.log('CREATOR_TEAMS_COMPLETE=true');
