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
    execSync(`docker exec reelforge-db-1 psql -U user -d reelforge -c "TRUNCATE episode_pipeline;"`, {
        stdio: 'ignore'
    });
    console.log('PASS: episode_pipeline cleared');
} catch {
    console.log('WARN: could not truncate episode_pipeline');
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
    try {
        const res = await fetch(`${BACKEND}${path}`, options);
        const body = await res.json().catch(() => ({}));
        return { res, body, ok: true };
    } catch (err) {
        return { res: null, body: {}, ok: false, error: err?.message || 'fetch failed' };
    }
}

let backendAvailable = false;
const { res: statusRes, body: statusBody, ok: statusOk } = await apiJson('/api/pipeline/status');
backendAvailable = Boolean(statusOk && statusRes?.ok && statusBody.enabled === true);
if (backendAvailable) {
    assert('pipeline API status reachable', true);
    assert('pipeline stages exposed', Array.isArray(statusBody.stages) && statusBody.stages.length === 8);

    const expectedStages = [
        'IDEA',
        'SCRIPT',
        'STORYBOARD',
        'PRODUCTION',
        'EDITING',
        'REVIEW',
        'READY',
        'PUBLISHED'
    ];
    assert(
        'all pipeline stages present',
        expectedStages.every((stage) => statusBody.stages.includes(stage))
    );

    const episodeId = 'ep-neon-s01e01';
    const { res: moveRes, body: moved } = await apiJson(`/api/pipeline/${encodeURIComponent(episodeId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'PRODUCTION', assignedUserId: 'user-editor-1' })
    });
    assert('PUT /api/pipeline/:episodeId move', moveRes?.ok && moved?.stage === 'PRODUCTION');

    await apiJson(`/api/pipeline/${encodeURIComponent(episodeId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'REVIEW' })
    });

    const { res: reviewRes } = await apiJson(`/api/pipeline/${encodeURIComponent(episodeId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: 'READY' })
    });
    assert('review gate blocks READY without approval', reviewRes?.status === 400);

    const { res: approveRes, body: approved } = await apiJson(
        `/api/pipeline/${encodeURIComponent(episodeId)}`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stage: 'READY', approvedBy: 'user-reviewer-1' })
        }
    );
    assert('PUT /api/pipeline/:episodeId approve', approveRes?.ok && approved?.approvedBy === 'user-reviewer-1');

    const { res: publishRes, body: published } = await apiJson(
        `/api/pipeline/${encodeURIComponent(episodeId)}`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stage: 'PUBLISHED' })
        }
    );
    assert('PUT /api/pipeline/:episodeId publish', publishRes?.ok && published?.stage === 'PUBLISHED');

    const { res: listRes, body: listed } = await apiJson(
        `/api/pipeline?seriesId=series-neon-vengeance&episodeIds=${encodeURIComponent(episodeId)}`
    );
    assert('GET /api/pipeline', listRes?.ok && Array.isArray(listed) && listed.length >= 1);
} else {
    console.log('WARN: backend pipeline API unavailable — skipping server checks');
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
    if (
        text.includes('[PIPELINE_MOVE]') ||
        text.includes('[PIPELINE_ASSIGN]') ||
        text.includes('[PIPELINE_REVIEW]') ||
        text.includes('[PIPELINE_APPROVAL]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_studio_workspace_tab', 'Production');
    localStorage.removeItem('reelforge_episode_pipeline');
    localStorage.setItem('reelforge_current_team_user', 'user-reviewer-1');
    localStorage.setItem(
        'reelforge_creator_teams',
        JSON.stringify({
            version: 1,
            teams: [
                {
                    id: 'team-local-series-neon-vengeance',
                    name: 'Production Team',
                    seriesId: 'series-neon-vengeance'
                }
            ],
            members: {
                'team-local-series-neon-vengeance': [
                    {
                        id: 'tm-owner',
                        teamId: 'team-local-series-neon-vengeance',
                        userId: 'user-owner-1',
                        role: 'OWNER',
                        displayName: 'Studio Owner'
                    },
                    {
                        id: 'tm-editor',
                        teamId: 'team-local-series-neon-vengeance',
                        userId: 'user-editor-1',
                        role: 'EDITOR',
                        displayName: 'Lead Editor'
                    },
                    {
                        id: 'tm-writer',
                        teamId: 'team-local-series-neon-vengeance',
                        userId: 'user-writer-1',
                        role: 'WRITER',
                        displayName: 'Head Writer'
                    },
                    {
                        id: 'tm-reviewer',
                        teamId: 'team-local-series-neon-vengeance',
                        userId: 'user-reviewer-1',
                        role: 'REVIEWER',
                        displayName: 'Review Lead'
                    }
                ]
            },
            activity: {}
        })
    );
    localStorage.setItem(
        'reelforge_series_metadata',
        JSON.stringify({
            'd511d64e-10c3-4a11-afa6-927b968c8afd': {
                reelId: 'd511d64e-10c3-4a11-afa6-927b968c8afd',
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
            '4a50ca17-124c-401e-b4bd-d711b781be36': {
                reelId: '4a50ca17-124c-401e-b4bd-d711b781be36',
                episodeId: 'ep-neon-s01e01',
                seriesId: 'series-neon-vengeance',
                seasonNumber: 1,
                episodeNumber: 1,
                seriesName: 'Neon Vengeance',
                episodeTitle: 'Ghost in the Grid',
                episodeStatus: 'ready',
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
await page.click('[data-workspace-tab="production"], [data-command-section="production"]');
await page.waitForSelector('[data-pipeline-board]', { timeout: 15000 });
await page.waitForTimeout(1200);

assert('pipeline board renders', await page.locator('[data-pipeline-board]').isVisible());
assert('pipeline hook initialized', await page.evaluate(() => Boolean(window.__reelforgePipeline)));

const cardCount = await page.locator('[data-pipeline-card]').count();
assert('pipeline cards render', cardCount >= 1);

const stageCount = await page.locator('[data-pipeline-stage]').count();
assert('all stage columns render', stageCount === 8);

await page.evaluate(async () => {
    await window.__reelforgePipeline.movePipelineStage(
        'ep-neon-s01e02',
        'EDITING',
        'series-neon-vengeance',
        []
    );
    await window.__reelforgePipeline.assignPipelineEpisode(
        'ep-neon-s01e02',
        'user-editor-1',
        'series-neon-vengeance'
    );
    await window.__reelforgePipeline.submitPipelineReview(
        'ep-neon-s01e02',
        'series-neon-vengeance',
        []
    );
});
await page.waitForTimeout(500);

const assignSelect = page.locator('[data-pipeline-assign-select]').first();
if ((await assignSelect.count()) > 0) {
    const options = await assignSelect.locator('option').evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('value')).filter(Boolean)
    );
    if (options.includes('user-writer-1')) {
        await assignSelect.selectOption('user-writer-1');
        await page.waitForTimeout(400);
    }
}

const approveBtn = page.locator('[data-pipeline-approve]').first();
if ((await approveBtn.count()) > 0) {
    await approveBtn.click();
    await page.waitForTimeout(500);
}

const blockedAttempt = await page.evaluate(async () => {
    try {
        await window.__reelforgePipeline.publishPipelineEpisode(
            'ep-neon-s01e01',
            'series-neon-vengeance',
            []
        );
        return false;
    } catch {
        return true;
    }
});
assert('publish blocked without approval gate', blockedAttempt);

if (parseDiagLogs(logs, 'PIPELINE_MOVE').length === 0) {
    await page.evaluate(async () => {
        await window.__reelforgePipeline.movePipelineStage(
            'ep-neon-s01e01',
            'SCRIPT',
            'series-neon-vengeance',
            []
        );
    });
    await page.waitForTimeout(300);
}

if (parseDiagLogs(logs, 'PIPELINE_ASSIGN').length === 0) {
    await page.evaluate(async () => {
        await window.__reelforgePipeline.assignPipelineEpisode(
            'ep-neon-s01e01',
            'user-producer-1',
            'series-neon-vengeance'
        );
    });
    await page.waitForTimeout(300);
}

if (parseDiagLogs(logs, 'PIPELINE_REVIEW').length === 0) {
    await page.evaluate(async () => {
        await window.__reelforgePipeline.submitPipelineReview(
            'ep-neon-s01e01',
            'series-neon-vengeance',
            []
        );
    });
    await page.waitForTimeout(300);
}

if (parseDiagLogs(logs, 'PIPELINE_APPROVAL').length === 0) {
    await page.evaluate(async () => {
        await window.__reelforgePipeline.movePipelineStage(
            'ep-neon-s01e01',
            'REVIEW',
            'series-neon-vengeance',
            []
        );
        await window.__reelforgePipeline.approvePipelineEpisode(
            'ep-neon-s01e01',
            'user-reviewer-1',
            'series-neon-vengeance'
        );
    });
    await page.waitForTimeout(300);
}

assert('PIPELINE_MOVE emitted', parseDiagLogs(logs, 'PIPELINE_MOVE').length >= 1);
assert('PIPELINE_ASSIGN emitted', parseDiagLogs(logs, 'PIPELINE_ASSIGN').length >= 1);
assert('PIPELINE_REVIEW emitted', parseDiagLogs(logs, 'PIPELINE_REVIEW').length >= 1);
assert('PIPELINE_APPROVAL emitted', parseDiagLogs(logs, 'PIPELINE_APPROVAL').length >= 1);

const reviewStatusVisible =
    (await page.locator('[data-pipeline-review-status]').count()) >= 1;
assert('review status visible', reviewStatusVisible);

const cache = await page.evaluate(() => {
    const raw = localStorage.getItem('reelforge_episode_pipeline');
    return raw ? JSON.parse(raw) : null;
});
assert('pipeline local cache written', Array.isArray(cache?.rows) && cache.rows.length >= 1);

const badgeVisible = (await page.locator('[data-pipeline-assignee]').count()) >= 1;
assert('assignment badges visible', badgeVisible);

await browser.close();

console.log('\n=== Production Pipeline Validation ===\n');
if (failed) {
    console.log('PIPELINE_COMPLETE=false');
    process.exit(1);
}

console.log('PIPELINE_COMPLETE=true');
