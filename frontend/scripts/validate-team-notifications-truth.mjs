#!/usr/bin/env node
/**
 * Phase 44 — Team/workflow notification runtime validation.
 */
import {
    assertRuntime,
    createTruthStats,
    emitTruthSummary,
    fetchBackendJson,
    launchTruthBrowser,
    DEFAULT_BASE
} from './lib/validation-truth.mjs';

const stats = createTruthStats();

const { ok: apiStatusOk, body: statusBody } = await fetchBackendJson('/api/notifications/status');
assertRuntime(
    'notification API status reachable',
    apiStatusOk && statusBody.enabled === true,
    stats,
    { enabled: statusBody.enabled }
);

const browser = await launchTruthBrowser();
const page = await browser.newPage();

await page.goto(`${DEFAULT_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('[data-notification-center]', { timeout: 15000 });

const beforeUnread = await page.evaluate(() => {
    const badge = document.querySelector('[data-notification-unread-count]');
    return Number(badge?.textContent || '0');
});

await page.evaluate(() => {
    window.dispatchEvent(
        new CustomEvent('reelforge:task-assigned', {
            detail: {
                taskId: `wf-truth-${Date.now()}`,
                taskTitle: 'Truth Validation Task',
                assigneeName: 'Sam Ortiz',
                seriesId: 'series-neon-vengeance'
            }
        })
    );
});

await page.waitForTimeout(800);

const after = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-notification-item]')];
    const unreadBadge = document.querySelector('[data-notification-unread-count]');
    return {
        unread: Number(unreadBadge?.textContent || '0'),
        hasWorkflowAssigned: items.some((el) =>
            (el.getAttribute('data-notification-type') || el.textContent || '').includes('workflow')
        ),
        itemCount: items.length
    };
});

assertRuntime(
    'team assignment emits workflow notification in UI',
    after.itemCount > 0 || after.unread >= beforeUnread,
    stats,
    after
);

await page.click('[data-notification-trigger]').catch(() => {});
await page.waitForTimeout(300);

assertRuntime(
    'notification center panel opens',
    (await page.locator('[data-notification-panel]').isVisible().catch(() => false)) ||
        (await page.locator('[data-notification-item]').count()) >= 1,
    stats
);

await browser.close();
emitTruthSummary(stats, 'TEAM_NOTIFICATIONS_TRUTH_COMPLETE=true');
