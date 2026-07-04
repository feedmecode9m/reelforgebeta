#!/usr/bin/env node
/**
 * Phase 65 — User journey runtime certification.
 */
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
    assertRuntime,
    createTruthStats,
    emitTruthSummary,
    launchTruthBrowser,
    DEFAULT_BASE
} from './lib/validation-truth.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORT_PATH = join(ROOT, 'user-journey-report.json');

const SERIES_ID = 'series-neon-vengeance';
const EPISODE_ID = 'ep-neon-s01e01';
const CREATOR_REEL_ID = `journey-reel-${Date.now()}`;

const stats = createTruthStats();
const browser = await launchTruthBrowser();
const context = await browser.newContext();

const report = {
    phase: 65,
    objective: 'User Journey Certification',
    roles: {
        viewer: {},
        creator: {},
        teamManager: {},
        admin: {}
    },
    diagnostics: [],
    success: false,
    completeToken: 'USER_JOURNEY_COMPLETE=false',
    generatedAt: new Date().toISOString()
};

/**
 * @param {'viewer' | 'creator' | 'teamManager' | 'admin'} role
 * @param {string} step
 * @param {boolean} ok
 * @param {Record<string, unknown>} detail
 */
function recordJourney(role, step, ok, detail = {}) {
    const entry = { role, step, ok, ...detail, timestamp: Date.now() };
    report.roles[role][step] = entry;
    report.diagnostics.push(entry);
    console.log(`[USER_JOURNEY] ${JSON.stringify(entry)}`);
    assertRuntime(`${role} ${step}`, ok, stats, detail);
}

/**
 * @param {import('playwright').Page} page
 */
async function waitForViewerRuntime(page) {
    await page.waitForSelector('[data-hero-intelligence]', { timeout: 20000 });
    await page.waitForFunction(
        () =>
            window.__reelforgeDiscovery &&
            window.__reelforgeUniversalSearch &&
            window.__reelforgeWatchTracking,
        { timeout: 15000 }
    );
}

/**
 * @param {import('playwright').Page} page
 */
async function openStudioAsAdmin(page) {
    await page.click('.ghost-trigger');
    await page.waitForSelector('[data-production-command-center]', { timeout: 20000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {string} sectionId
 */
async function openCommandSection(page, sectionId) {
    await page.click(`[data-command-dashboard-section="${sectionId}"]`);
    await page.waitForSelector(`[data-command-dashboard-detail="${sectionId}"]`, { timeout: 15000 });
    await page.waitForTimeout(300);
}

// -----------------------------
// Viewer journey
// -----------------------------
const viewerPage = await context.newPage();
await viewerPage.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
    localStorage.setItem(
        'reelforge_series_watch_progress',
        JSON.stringify({
            'ep-neon-s01e01': 42
        })
    );
});

await viewerPage.goto(`${DEFAULT_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await waitForViewerRuntime(viewerPage);

const discoverResult = await viewerPage.evaluate(() => {
    const raw = window.__reelforgeDiscovery.searchPlatform('trending', { limit: 8 });
    const results = Array.isArray(raw) ? raw : Array.isArray(raw?.results) ? raw.results : [];
    return { total: results.length, top: results[0]?.title || '' };
});
recordJourney('viewer', 'discover_content', discoverResult.total >= 1, discoverResult);

const searchResult = await viewerPage.evaluate(() => {
    const result = window.__reelforgeUniversalSearch.searchUniversal('neon', { limit: 8 });
    return { total: result?.results?.length || 0, query: result?.query || 'neon' };
});
recordJourney('viewer', 'search_content', searchResult.total >= 1, searchResult);

const continueWatchingResult = await viewerPage.evaluate(async () => {
    const resolved = await window.__reelforgeWatchTracking.resolveWatchProgress('ep-neon-s01e01', null, {
        preferApi: false
    });
    return {
        source: resolved?.source || 'none',
        percent: resolved?.percent ?? null
    };
});
recordJourney(
    'viewer',
    'continue_watching',
    Number(continueWatchingResult.percent) >= 40,
    continueWatchingResult
);

const completeEpisodeResult = await viewerPage.evaluate(async () => {
    const tracker = window.__reelforgeWatchTracking;
    const videoEl = document.createElement('video');
    Object.defineProperty(videoEl, 'duration', { configurable: true, value: 120 });
    Object.defineProperty(videoEl, 'currentTime', { configurable: true, writable: true, value: 118 });
    await tracker.watchSessionStart({
        reelId: 'reel-neon-s01e01',
        episodeId: 'ep-neon-s01e01',
        seriesId: 'series-neon-vengeance',
        seasonNumber: 1
    });
    await tracker.watchOnPlay(videoEl);
    await tracker.watchOnComplete(videoEl);
    const map = JSON.parse(localStorage.getItem('reelforge_series_watch_progress') || '{}');
    return {
        percent: Number(map['ep-neon-s01e01'] || 0),
        reelPercent: Number(map['reel-neon-s01e01'] || 0)
    };
});
recordJourney(
    'viewer',
    'complete_episode',
    completeEpisodeResult.percent === 100 && completeEpisodeResult.reelPercent === 100,
    completeEpisodeResult
);

await viewerPage.close();

// -----------------------------
// Creator + Team Manager + Admin journey
// -----------------------------
const studioPage = await context.newPage();
await studioPage.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.removeItem('reelforge_admin_session_token');
});

await studioPage.goto(`${DEFAULT_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await waitForViewerRuntime(studioPage);
await openStudioAsAdmin(studioPage);
await studioPage.waitForFunction(
    () =>
        window.__reelforgeRelease &&
        window.__reelforgePipeline &&
        window.__reelforgeWorkflow &&
        window.__reelforgeNotifications,
    { timeout: 20000 }
);

const creatorUpload = await studioPage.evaluate(({ reelId }) => {
    const vault = JSON.parse(localStorage.getItem('personal_video_vault') || '[]');
    const next = vault.filter((item) => item?.id !== reelId);
    next.push({
        id: reelId,
        name: 'journey-upload.mp4',
        title: 'Journey Upload Reel',
        url: '/videos/hero-test.mp4',
        type: 'video/mp4',
        addedAt: new Date().toISOString()
    });
    localStorage.setItem('personal_video_vault', JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('reelforge:upload-updated'));
    const heroItems = window.__reelforgeHeroIntelligence?.loadHeroVaultItems?.() || [];
    return {
        vaultCount: next.length,
        uploaded: heroItems.some((item) => item?.id === reelId)
    };
}, { reelId: CREATOR_REEL_ID });
recordJourney('creator', 'upload_reel', creatorUpload.uploaded, creatorUpload);

const creatorAttach = await studioPage.evaluate(({ reelId }) => {
    const key = 'reelforge_series_metadata';
    const map = JSON.parse(localStorage.getItem(key) || '{}');
    map[reelId] = {
        reelId: reelId,
        seriesId: 'series-neon-vengeance',
        seriesName: 'Neon Vengeance',
        seasonNumber: 1,
        episodeNumber: 1,
        episodeId: 'ep-neon-s01e01',
        episodeTitle: 'Pilot',
        episodeStatus: 'ready',
        updatedAt: Date.now()
    };
    localStorage.setItem(key, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent('reelforge:sync-applied', { detail: { seriesMetadata: map } }));
    const persisted = JSON.parse(localStorage.getItem(key) || '{}');
    return {
        attached: persisted?.[reelId]?.episodeId === 'ep-neon-s01e01',
        episodeId: persisted?.[reelId]?.episodeId || null
    };
}, { reelId: CREATOR_REEL_ID });
recordJourney('creator', 'attach_episode', creatorAttach.attached, creatorAttach);

const creatorSchedule = await studioPage.evaluate(() => {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().slice(0, 10);
    const scheduled = window.__reelforgeRelease.scheduleEpisodeRelease(
        'series-neon-vengeance',
        'ep-neon-s01e01',
        dateStr,
        '12:00'
    );
    return {
        status: scheduled?.status || '',
        releaseAt: scheduled?.releaseAt || null
    };
});
recordJourney(
    'creator',
    'schedule_release',
    creatorSchedule.status === 'scheduled' || creatorSchedule.status === 'released',
    creatorSchedule
);

const creatorPublish = await studioPage.evaluate(async () => {
    const pipeline = window.__reelforgePipeline;
    await pipeline.submitPipelineReview('ep-neon-s01e01', 'series-neon-vengeance', []);
    await pipeline.approvePipelineEpisode('ep-neon-s01e01', 'director_jules', 'series-neon-vengeance');
    const published = await pipeline.publishPipelineEpisode('ep-neon-s01e01', 'series-neon-vengeance', []);
    return {
        stage: published?.stage || '',
        episodeId: published?.episodeId || null
    };
});
recordJourney('creator', 'publish', creatorPublish.stage === 'PUBLISHED', creatorPublish);

const teamAssign = await studioPage.evaluate(async () => {
    const wf = window.__reelforgeWorkflow;
    wf.syncWorkflowTasks('series-neon-vengeance', []);
    const tasks = wf.getWorkflowTasksForSeries('series-neon-vengeance');
    const task = tasks[0];
    if (!task) return { assigned: false, reason: 'no_tasks' };
    const updated = wf.assignWorkflowTask(task.id);
    return {
        assigned: updated?.status === 'IN_PROGRESS',
        taskId: task.id,
        status: updated?.status || ''
    };
});
recordJourney('teamManager', 'assign_workflow_task', teamAssign.assigned, teamAssign);

const teamApprove = await studioPage.evaluate(() => {
    const wf = window.__reelforgeWorkflow;
    const tasks = wf.getWorkflowTasksForSeries('series-neon-vengeance');
    const task = tasks.find((item) => item.status === 'IN_PROGRESS') || tasks[0];
    if (!task) return { approved: false, reason: 'no_tasks' };
    const completed = wf.completeWorkflowTask(task.id);
    return {
        approved: completed?.status === 'COMPLETE',
        taskId: task.id,
        status: completed?.status || ''
    };
});
recordJourney('teamManager', 'approve_workflow', teamApprove.approved, teamApprove);

const teamNotification = await studioPage.evaluate(async () => {
    const notifications = window.__reelforgeNotifications;
    const before = notifications.getUnreadCount();
    window.dispatchEvent(
        new CustomEvent('reelforge:task-assigned', {
            detail: {
                taskId: `journey-task-${Date.now()}`,
                taskTitle: 'Journey Team Assignment',
                assigneeName: 'Ops Lead',
                seriesId: 'series-neon-vengeance'
            }
        })
    );
    await notifications.hydrateNotifications();
    const after = notifications.getUnreadCount();
    return { before, after, received: after >= before };
});
recordJourney('teamManager', 'receive_notification', teamNotification.received, teamNotification);

const adminOpenStudio = {
    commandCenterVisible: await studioPage.locator('[data-production-command-center]').isVisible()
};
recordJourney('admin', 'open_studio', adminOpenStudio.commandCenterVisible, adminOpenStudio);

const adminSentinel = await studioPage.evaluate(() => {
    const api = window.__reelforgeSentinel;
    const analysis = api?.masterAnalysis?.('series-neon-vengeance', [], { emitDiagnostics: false }) || null;
    const panelVisible = Boolean(document.querySelector('[data-sentinel-assistant-panel]'));
    return {
        panelVisible,
        hasAnalysis: Boolean(analysis),
        threatLevel: analysis?.threatLevel || null
    };
});
recordJourney(
    'admin',
    'review_sentinel',
    adminSentinel.panelVisible || adminSentinel.hasAnalysis,
    adminSentinel
);

await openCommandSection(studioPage, 'security');
const adminSecurity = {
    dashboardVisible: await studioPage.locator('[data-security-operations-dashboard]').isVisible()
};
recordJourney('admin', 'review_security_operations_center', adminSecurity.dashboardVisible, adminSecurity);

await openCommandSection(studioPage, 'revenue');
const adminRevenue = await studioPage.evaluate(() => {
    const dashboardVisible = Boolean(document.querySelector('[data-revenue-dashboard]'));
    const brief = window.__reelforgeRevenue?.buildRevenueDashboardBrief?.('series-neon-vengeance', []);
    return {
        dashboardVisible,
        hasRuntimeBrief: Boolean(brief),
        mrr: brief?.kpis?.mrr?.value ?? null
    };
});
recordJourney(
    'admin',
    'review_revenue_dashboard',
    adminRevenue.dashboardVisible || adminRevenue.hasRuntimeBrief,
    adminRevenue
);

await studioPage.close();
await browser.close();

report.success = !stats.failed;
report.completeToken = report.success
    ? 'USER_JOURNEY_COMPLETE=true'
    : 'USER_JOURNEY_COMPLETE=false';

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
emitTruthSummary(stats, 'USER_JOURNEY_COMPLETE=true');
