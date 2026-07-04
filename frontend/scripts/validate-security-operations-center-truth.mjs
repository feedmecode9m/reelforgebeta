#!/usr/bin/env node
/**
 * Phase 66B — Security Operations Center truth validator.
 * Behavior-only checks with runtime diagnostics + visible state changes.
 */
import {
    assertRuntime,
    createTruthStats,
    emitTruthSummary,
    launchTruthBrowser,
    loginAdminAndOpenStudio,
    openCommandCenterSection,
    DEFAULT_BASE
} from './lib/validation-truth.mjs';

const stats = createTruthStats();
const browser = await launchTruthBrowser();
const page = await browser.newPage();

/** @type {{ tag: string; payload: Record<string, unknown> }[]} */
const diagnostics = [];

page.on('console', (msg) => {
    const line = msg.text();
    for (const tag of ['SOC_SCORE', 'SOC_ALERT', 'SECURITY_INCIDENT', 'SOC_TIMELINE']) {
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
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await openCommandCenterSection(page, 'security');

const socHeading = page.getByRole('heading', { name: /Security Operations Center/i });
await socHeading.waitFor({ state: 'visible', timeout: 15000 });

assertRuntime('security operations center heading visible', await socHeading.isVisible(), stats);
assertRuntime(
    'security operations score panel visible',
    await page.getByText(/Platform Security Score/i).first().isVisible(),
    stats
);

const beforeState = await page.evaluate(() => {
    const levelNode = document.querySelector('[data-soc-threat-level]');
    const incidentCount = document.querySelectorAll('[data-soc-incident]').length;
    const scoreText = document.querySelector('[data-soc-platform-score] strong')?.textContent || '';
    return {
        threatLevel: String(levelNode?.textContent || '').trim(),
        incidentCount,
        scoreText
    };
});

const runtime = await page.evaluate(() => {
    const threat = window.__reelforgeThreatDetection;
    const soc = window.__reelforgeSecurityOperationsCenter;
    if (!soc || !threat) {
        return { hasHooks: false };
    }
    const now = Date.now();
    for (let i = 0; i < 22; i += 1) {
        threat.recordThreatEvent('api', 'endpoint_burst', {
            source: 'phase66b-soc-truth',
            simulated: true,
            now,
            index: i
        });
    }
    const snapshot = threat.analyzeThreats({ emitDiagnostics: true });
    window.dispatchEvent(new CustomEvent('reelforge:threat-updated', { detail: snapshot }));
    const brief = soc.buildSecurityOperationsBrief('series-neon-vengeance', [], { emitDiagnostics: true });
    return {
        hasHooks: true,
        threatLevel: brief?.threatLevel || '',
        incidentCount: brief?.sections?.activeIncidents?.length || 0,
        score: brief?.platformSecurityScore?.combinedScore ?? null
    };
});

await page.waitForTimeout(700);

const afterState = await page.evaluate(() => {
    const levelNode = document.querySelector('[data-soc-threat-level]');
    const incidentCount = document.querySelectorAll('[data-soc-incident]').length;
    const scoreText = document.querySelector('[data-soc-platform-score] strong')?.textContent || '';
    return {
        threatLevel: String(levelNode?.textContent || '').trim(),
        incidentCount,
        scoreText
    };
});

assertRuntime('security operations hooks initialized', runtime.hasHooks === true, stats, runtime);
assertRuntime(
    'security operations emits valid threat score',
    typeof runtime.score === 'number' && runtime.score >= 0 && runtime.score <= 100,
    stats,
    runtime
);
assertRuntime(
    'security operations shows visible UI state change',
    beforeState.threatLevel !== afterState.threatLevel ||
        beforeState.incidentCount !== afterState.incidentCount ||
        beforeState.scoreText !== afterState.scoreText,
    stats,
    { beforeState, afterState }
);
assertRuntime(
    'security operations diagnostics emitted',
    diagnostics.some((entry) => entry.tag === 'SOC_SCORE' || entry.tag === 'SOC_ALERT') &&
        diagnostics.some((entry) => entry.tag === 'SECURITY_INCIDENT' || entry.tag === 'SOC_TIMELINE'),
    stats,
    { diagnosticCount: diagnostics.length }
);

await browser.close();
emitTruthSummary(stats, 'SECURITY_OPERATIONS_CENTER_COMPLETE=true');
