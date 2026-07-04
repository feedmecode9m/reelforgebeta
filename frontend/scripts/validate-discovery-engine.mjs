#!/usr/bin/env node
/**
 * Phase 56 — Discovery engine runtime validation.
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
    if (/\[(DISCOVERY_INDEX|DISCOVERY_QUERY|DISCOVERY_RESULT)\]\s*\{/.test(text)) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
    localStorage.removeItem('reelforge_discovery_index');
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await page.waitForSelector('[data-production-command-center]', { timeout: 15000 });

const runtime = await page.evaluate(async () => {
    let discovery = window.__reelforgeDiscovery;
    if (!discovery) {
        try {
            const mod = await import('/src/lib/discovery/discoveryEngine.js');
            mod.initDiscoveryEngine?.();
            discovery = window.__reelforgeDiscovery;
        } catch {
            /* ignore fallback import errors */
        }
    }
    const notifications = window.__reelforgeNotifications;
    const threat = window.__reelforgeThreatDetection;

    if (notifications?.createNotification) {
        await notifications.createNotification(
            'readiness_changed',
            'Discovery validator security workflow market signal.',
            { source: 'phase56-validator', seriesId: 'series-neon-vengeance' }
        );
    }

    if (threat?.recordThreatEvent) {
        threat.recordThreatEvent('api', 'endpoint_burst', {
            simulated: true,
            source: 'phase56-validator'
        });
    }

    const indexed = discovery?.indexPlatformData?.();
    const search = discovery?.searchPlatform?.('security workflow validator');
    const suggestions = discovery?.suggestQueries?.('sec');

    return {
        hasHook: Boolean(discovery),
        indexedCount: indexed?.totalDocuments || 0,
        searchTotal: search?.total || 0,
        topResultSource: search?.results?.[0]?.source || null,
        topResultTitle: search?.results?.[0]?.title || null,
        suggestions: suggestions?.suggestions || []
    };
});

assertRuntime('discovery hook initialized', runtime.hasHook, stats, runtime);
assertRuntime('discovery index built with documents', runtime.indexedCount >= 20, stats, runtime);
assertRuntime('discovery query returns results', runtime.searchTotal >= 1, stats, runtime);
assertRuntime(
    'discovery suggestions returned',
    Array.isArray(runtime.suggestions) && runtime.suggestions.length >= 1,
    stats,
    runtime
);
assertRuntime(
    'discovery diagnostics emitted',
    hasDiagTag(logs, 'DISCOVERY_INDEX') &&
        hasDiagTag(logs, 'DISCOVERY_QUERY') &&
        hasDiagTag(logs, 'DISCOVERY_RESULT'),
    stats,
    { logCount: logs.length }
);

await browser.close();
emitTruthSummary(stats, 'DISCOVERY_ENGINE_COMPLETE=true');
