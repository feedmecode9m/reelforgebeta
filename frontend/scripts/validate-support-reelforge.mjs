#!/usr/bin/env node
/**
 * Phase 60 — Support ReelForge validation.
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
    if (/\[SUPPORT_CLICK\]\s*\{/.test(text)) logs.push(text);
});

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await page.waitForSelector('[data-studio-workspace-layout]', { timeout: 15000 });
await page.click('[data-workspace-tab="overview"]').catch(() => {});
await page.waitForSelector('[data-support-reelforge]', { timeout: 15000 });

const runtime = await page.evaluate(() => {
    const support = window.__reelforgeSupport;
    const updated = support?.saveSupportConfig?.({
        ctaLabel: 'Support ReelForge',
        methods: {
            patreon: { enabled: true, label: 'Patreon', url: 'https://www.patreon.com/reelforge' },
            kofi: { enabled: true, label: 'Ko-fi', url: 'https://ko-fi.com/reelforge' },
            github_sponsors: {
                enabled: true,
                label: 'GitHub Sponsors',
                url: 'https://github.com/sponsors/reelforge'
            },
            custom: { enabled: true, label: 'Custom URL', url: 'https://reelforge.example.com/support' }
        }
    });
    const enabled = support?.getEnabledSupportMethods?.(updated) || [];
    const persistedRaw = localStorage.getItem('reelforge_support_config');
    const persisted = persistedRaw ? JSON.parse(persistedRaw) : null;
    return {
        hasHook: Boolean(support),
        hasMessage: /We built ReelForge with love and creators in mind\./i.test(
            document.querySelector('[data-support-reelforge-message]')?.textContent || ''
        ),
        methodsPresent: enabled.map((method) => method.id),
        persistedMethods: Object.keys(persisted?.methods || {}),
        hasStorage: Boolean(persistedRaw)
    };
});

await page.waitForTimeout(150);
await page.click('[data-support-reelforge-button]');
await page.waitForTimeout(150);

assertRuntime('support hook initialized', runtime.hasHook, stats, runtime);
assertRuntime('support homepage message rendered', runtime.hasMessage, stats, runtime);
assertRuntime(
    'support methods include required donation providers',
    (() => {
        const persisted = new Set(runtime.persistedMethods || []);
        return ['patreon', 'kofi', 'github_sponsors', 'custom'].every((id) => persisted.has(id));
    })(),
    stats,
    runtime
);
assertRuntime('support config persisted in local storage', runtime.hasStorage, stats, runtime);
assertRuntime(
    'support click diagnostics emitted',
    hasDiagTag(logs, 'SUPPORT_CLICK'),
    stats,
    { logCount: logs.length }
);

await browser.close();
emitTruthSummary(stats, 'SUPPORT_REELFORGE_COMPLETE=true');
