#!/usr/bin/env node
/**
 * Phase 72 — Monetization Expansion validation.
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
    if (/\[(MONETIZATION|DONATION_CLICK|PLAN_VIEW)\]\s*\{/.test(text)) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
    localStorage.removeItem('reelforge_monetization_hub');
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await page.waitForSelector('[data-studio-workspace-layout]', { timeout: 15000 });
await page.click('[data-workspace-tab="overview"]').catch(() => {});
await page.waitForSelector('[data-workspace-overview]', { timeout: 15000 });
await page.waitForTimeout(250);

const runtime = await page.evaluate(async () => {
    let hub = window.__reelforgeMonetizationHub;
    if (!hub) {
        try {
            const mod = await import('/src/lib/monetization/monetizationHub.js');
            mod.initMonetizationHub?.();
            hub = window.__reelforgeMonetizationHub;
        } catch {
            /* ignore */
        }
    }

    const updated = hub?.saveMonetizationHubState?.({
        message: 'Built with love for creators. Support the future of ReelForge.',
        supportMethods: {
            patreon: { enabled: true, label: 'Patreon', url: 'https://www.patreon.com/reelforge' },
            kofi: { enabled: true, label: 'Ko-fi', url: 'https://ko-fi.com/reelforge' },
            stripe_donation: { enabled: true, label: 'Stripe Donation', url: 'https://buy.stripe.com/test_reelforge' },
            sponsor_reelforge: { enabled: true, label: 'Sponsor ReelForge', url: 'https://reelforge.example.com/sponsor' }
        }
    });
    const methods = hub?.getEnabledDonationMethods?.(updated) || [];
    const requiredMethods = ['patreon', 'kofi', 'stripe_donation', 'sponsor_reelforge'];
    const requiredPlans = [
        'creator_plans',
        'team_plans',
        'enterprise_plans',
        'storage_plans',
        'ai_plans',
        'marketplace_fees'
    ];

    if (methods[0]) {
        hub?.trackDonationClick?.(methods[0].id, methods[0].url, { source: 'validator' });
    }
    hub?.viewPlan?.('creator_plans', { source: 'validator' });
    hub?.viewPlan?.('enterprise_plans', { source: 'validator' });

    const persisted = localStorage.getItem('reelforge_monetization_hub');
    const parsed = persisted ? JSON.parse(persisted) : null;

    return {
        hasHook: Boolean(hub),
        hasMainMessage:
            /Built with love for creators\. Support the future of ReelForge\./i.test(
                document.querySelector('[data-monetization-message]')?.textContent || ''
            ),
        methodsPresent: methods.map((method) => method.id),
        hasRequiredMethods: requiredMethods.every((id) => methods.some((method) => method.id === id)),
        hasRequiredPlans: requiredPlans.every((id) => Boolean(parsed?.plans?.[id])),
        hasStorage: Boolean(persisted),
        renderedHub: Boolean(document.querySelector('[data-monetization-hub]')),
        renderedPlanCards: document.querySelectorAll('[data-plan-id]').length >= requiredPlans.length
    };
});

assertRuntime('monetization hub hook initialized', runtime.hasHook, stats, runtime);
assertRuntime('monetization support message rendered', runtime.hasMainMessage, stats, runtime);
assertRuntime('monetization includes required donation methods', runtime.hasRequiredMethods, stats, runtime);
assertRuntime('monetization includes future SaaS plan architecture', runtime.hasRequiredPlans, stats, runtime);
assertRuntime('monetization hub persists state', runtime.hasStorage, stats, runtime);
assertRuntime(
    'monetization plans render on main page',
    runtime.renderedHub && runtime.renderedPlanCards,
    stats,
    runtime
);
assertRuntime(
    'monetization diagnostics emitted',
    hasDiagTag(logs, 'MONETIZATION') &&
        hasDiagTag(logs, 'DONATION_CLICK') &&
        hasDiagTag(logs, 'PLAN_VIEW'),
    stats,
    { logCount: logs.length }
);

await browser.close();
emitTruthSummary(stats, 'MONETIZATION_EXPANSION_COMPLETE=true');
