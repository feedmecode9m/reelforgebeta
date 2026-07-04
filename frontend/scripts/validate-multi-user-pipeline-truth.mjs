#!/usr/bin/env node
/**
 * Phase 66B — Multi-user pipeline truth validator.
 * Behavior-only checks with runtime diagnostics + visible state changes.
 */
import {
    assertRuntime,
    createTruthStats,
    emitTruthSummary,
    launchTruthBrowser,
    loginAdminAndOpenStudio,
    DEFAULT_BASE
} from './lib/validation-truth.mjs';

const stats = createTruthStats();
const browser = await launchTruthBrowser();
const page = await browser.newPage();

/** @type {{ tag: string; payload: Record<string, unknown> }[]} */
const diagnostics = [];

page.on('console', (msg) => {
    const line = msg.text();
    for (const tag of ['PIPELINE_CREATED', 'PIPELINE_STAGE', 'PIPELINE_APPROVED', 'PIPELINE_BLOCKED']) {
        const match = line.match(new RegExp(`\\[${tag}\\]\\s*(\\{.*\\})`));
        if (!match) continue;
        try {
            diagnostics.push({ tag, payload: JSON.parse(match[1]) });
        } catch {
            /* ignore malformed */
        }
    }
});

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
    localStorage.setItem('reelforge_studio_workspace_tab', 'Production');
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);

const productionTab = page.getByRole('tab', { name: /Production/i }).first();
if (await productionTab.isVisible().catch(() => false)) {
    await productionTab.click();
}

const boardHeading = page.getByText(/Multi-User Production Pipeline/i).first();
await boardHeading.waitFor({ state: 'visible', timeout: 15000 });

assertRuntime('multi-user pipeline heading visible', await boardHeading.isVisible(), stats);

const beforeState = await page.evaluate(() => {
    return {
        taskCount: document.querySelectorAll('[data-production-pipeline-task]').length,
        blockedCount: document.querySelectorAll('[data-production-pipeline-blocked="true"]').length
    };
});

const runtime = await page.evaluate(async () => {
    const api = window.__reelforgeProductionPipeline;
    if (!api) return { hasHook: false };
    const seriesId = 'series-neon-vengeance';

    const dependency = api.createProductionTask(seriesId, {
        title: 'Dependency Task',
        stage: 'RELEASED'
    });

    const task = api.createProductionTask(seriesId, {
        title: 'Phase 66B Validator Task',
        stage: 'WRITING',
        episodeId: `ep-phase66b-${Date.now()}`,
        ownerUserId: 'user-writer-1',
        dependsOn: [dependency.id]
    });

    await api.assignTaskOwner(seriesId, task.id, 'user-writer-1', 'Lead Writer');
    await api.handoffTask(seriesId, task.id, 'user-editor-1', {
        fromUserId: 'user-writer-1',
        displayName: 'Lead Editor'
    });
    api.submitTaskApproval(seriesId, task.id, 'user-reviewer-1');
    api.submitTaskApproval(seriesId, task.id, 'user-producer-1');
    await api.transitionTaskStage(seriesId, task.id, 'STORYBOARD', []);
    api.blockTask(seriesId, task.id, 'Waiting for assets');
    api.unblockTask(seriesId, task.id);
    await api.transitionTaskStage(seriesId, task.id, 'PRODUCTION', []);

    window.dispatchEvent(new CustomEvent('reelforge:production-pipeline-updated'));

    return {
        hasHook: true,
        taskId: task.id,
        stage: 'PRODUCTION'
    };
});

await page.waitForTimeout(900);

const afterState = await page.evaluate(() => {
    return {
        taskCount: document.querySelectorAll('[data-production-pipeline-task]').length,
        blockedCount: document.querySelectorAll('[data-production-pipeline-blocked="true"]').length
    };
});

assertRuntime('multi-user pipeline hook initialized', runtime.hasHook === true, stats, runtime);
assertRuntime(
    'multi-user pipeline task flow transitions to production',
    runtime.stage === 'PRODUCTION' && Boolean(runtime.taskId),
    stats,
    runtime
);
assertRuntime(
    'multi-user pipeline shows visible UI state change',
    afterState.taskCount > beforeState.taskCount || afterState.blockedCount !== beforeState.blockedCount,
    stats,
    { beforeState, afterState }
);
assertRuntime(
    'multi-user pipeline diagnostics emitted',
    diagnostics.some((entry) => entry.tag === 'PIPELINE_CREATED') &&
        diagnostics.some((entry) => entry.tag === 'PIPELINE_STAGE') &&
        diagnostics.some((entry) => entry.tag === 'PIPELINE_APPROVED') &&
        diagnostics.some((entry) => entry.tag === 'PIPELINE_BLOCKED'),
    stats,
    { diagnosticCount: diagnostics.length }
);

await browser.close();
emitTruthSummary(stats, 'MULTI_USER_PIPELINE_COMPLETE=true');
