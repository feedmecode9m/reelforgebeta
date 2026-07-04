#!/usr/bin/env node
/**
 * Phase 55 — Security enforcement runtime validation.
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
const logs = [];

function hasDiagTag(lines, tag) {
    const pattern = new RegExp(`\\[${tag}\\]\\s*\\{`);
    return lines.some((line) => pattern.test(line));
}

page.on('console', (msg) => {
    const text = msg.text();
    if (/\[(SECURITY_POLICY|SENTINEL_ACTION|SENTINEL_CONTAINMENT)\]\s*\{/.test(text)) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
    localStorage.removeItem('reelforge_security_events');
    localStorage.removeItem('reelforge_security_policy_state');
    localStorage.removeItem('reelforge_notifications');
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await page.click('[data-workspace-tab="system"], [data-command-section="system"]');
await page.waitForSelector('[data-sentinel-security-card]', { timeout: 15000 });

assertRuntime(
    'security policy engine initialized',
    await page.evaluate(() => Boolean(window.__reelforgeSecurityPolicy)),
    stats
);

async function simulateLevel(uploadEventCount) {
    return page.evaluate((count) => {
        const now = Date.now();
        const events = [];
        for (let i = 0; i < count; i += 1) {
            events.push({
                id: `phase55-upload-${now}-${i}`,
                category: 'upload',
                type: 'upload_burst',
                timestamp: now - i * 120,
                detail: { simulated: true, phase: 55, index: i }
            });
        }
        localStorage.setItem(
            'reelforge_security_events',
            JSON.stringify({ version: 1, events, updatedAt: now })
        );
        const snapshot = window.__reelforgeThreatDetection.analyzeThreats({ emitDiagnostics: true });
        window.dispatchEvent(new CustomEvent('reelforge:threat-updated', { detail: snapshot }));
        return {
            snapshot,
            policy: window.__reelforgeSecurityPolicy.getSecurityPolicyState()
        };
    }, uploadEventCount);
}

const yellow = await simulateLevel(3);
assertRuntime(
    'yellow level applies warning policy',
    yellow.snapshot.level === 'YELLOW' && yellow.policy.warningActive === true,
    stats,
    yellow
);

const orange = await simulateLevel(9);
assertRuntime(
    'orange level enables upload throttling',
    orange.snapshot.level === 'ORANGE' && orange.policy.uploadThrottleMs > 0,
    stats,
    orange
);

const orangeThrottleCheck = await page.evaluate(() => {
    const first = window.__reelforgeSecurityPolicy.enforceUploadPolicy({ operation: 'phase55-upload-1' });
    const second = window.__reelforgeSecurityPolicy.enforceUploadPolicy({ operation: 'phase55-upload-2' });
    return { first, second };
});
assertRuntime(
    'orange containment throttles repeated upload operations',
    orangeThrottleCheck.first.allowed &&
        orangeThrottleCheck.second.allowed &&
        orangeThrottleCheck.second.throttleMs > 0,
    stats,
    orangeThrottleCheck
);

const red = await simulateLevel(16);
assertRuntime(
    'red level enables upload lock and workflow freeze',
    red.snapshot.level === 'RED' &&
        red.policy.uploadLocked === true &&
        red.policy.workflowFrozen === true,
    stats,
    red
);

const redContainmentCheck = await page.evaluate(() => {
    const upload = window.__reelforgeSecurityPolicy.enforceUploadPolicy({ operation: 'phase55-upload-red' });
    const workflow = window.__reelforgeSecurityPolicy.enforceWorkflowPolicy({
        operation: 'phase55-workflow-red'
    });
    const notifications = window.__reelforgeNotifications?.getNotifications?.() || [];
    const policyRegex = /automatic containment activated/i;
    const adminNotified = notifications.some((item) =>
        policyRegex.test(String(item?.message || ''))
    );
    return { upload, workflow, notificationCount: notifications.length, adminNotified };
});

assertRuntime(
    'red containment blocks uploads and freezes workflow',
    redContainmentCheck.upload.allowed === false && redContainmentCheck.workflow.allowed === false,
    stats,
    redContainmentCheck
);
assertRuntime('red containment triggers admin notification', redContainmentCheck.adminNotified, stats);

assertRuntime(
    'security enforcement diagnostics emitted',
    hasDiagTag(logs, 'SECURITY_POLICY') &&
        hasDiagTag(logs, 'SENTINEL_ACTION') &&
        hasDiagTag(logs, 'SENTINEL_CONTAINMENT'),
    stats,
    { logCount: logs.length }
);

await browser.close();
emitTruthSummary(stats, 'SECURITY_ENFORCEMENT_COMPLETE=true');
