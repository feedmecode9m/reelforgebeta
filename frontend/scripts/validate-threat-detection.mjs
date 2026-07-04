#!/usr/bin/env node
/**
 * Phase 51 — Threat detection runtime validation with UI simulation.
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

page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[THREAT_EVENT]') || text.includes('[THREAT_SCORE]') || text.includes('[THREAT_LEVEL]')) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
    localStorage.removeItem('reelforge_security_events');
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await page.click('[data-workspace-tab="system"], [data-command-section="system"]');
await page.waitForSelector('[data-sentinel-security-card]', { timeout: 15000 });

assertRuntime(
    'sentinel security card visible',
    await page.locator('[data-sentinel-security-card]').isVisible(),
    stats
);

const beforeLevel = (await page.locator('[data-sentinel-security-card] [data-sentinel-threat-level]').innerText()).trim();

// Drive threat simulation through persisted event timeline + threat update event.
await page.evaluate(() => {
    const now = Date.now();
    const seeded = [];
    for (let i = 0; i < 20; i += 1) {
        seeded.push({
            id: `sim-api-${now}-${i}`,
            category: 'api',
            type: 'endpoint_burst',
            timestamp: now - i * 200,
            detail: { simulated: true, burst: 'phase51', index: i }
        });
    }
    localStorage.setItem(
        'reelforge_security_events',
        JSON.stringify({ version: 1, events: seeded, updatedAt: now })
    );
    window.dispatchEvent(new CustomEvent('reelforge:threat-updated'));
});
await page.waitForTimeout(700);

const afterLevel = (await page.locator('[data-sentinel-security-card] [data-sentinel-threat-level]').innerText()).trim();
const activeThreatsText = await page
    .locator('[data-sentinel-security-card] [data-sentinel-active-threats] strong')
    .innerText();
const activeThreats = Number(String(activeThreatsText).trim() || 0);

assertRuntime(
    'threat level updates after simulation',
    beforeLevel !== afterLevel || activeThreats > 0,
    stats,
    { beforeLevel, afterLevel, activeThreats }
);
assertRuntime(
    'threat diagnostics emitted',
    logs.some((line) => line.includes('[THREAT_EVENT]')) &&
        logs.some((line) => line.includes('[THREAT_SCORE]')) &&
        logs.some((line) => line.includes('[THREAT_LEVEL]')),
    stats,
    { logCount: logs.length }
);

await browser.close();
emitTruthSummary(stats, 'THREAT_DETECTION_COMPLETE=true');
