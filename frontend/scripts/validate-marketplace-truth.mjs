#!/usr/bin/env node
/**
 * Phase 51 — Marketplace runtime validation through UI CRUD flow.
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
const diagLogs = [];

function hasDiagTag(lines, tag) {
    const pattern = new RegExp(`\\[${tag}\\]\\s*\\{`);
    return lines.some((line) => pattern.test(line));
}

page.on('console', (msg) => {
    const text = msg.text();
    if (/\[(MARKETPLACE_CREATE|MARKETPLACE_UPDATE|MARKETPLACE_DELETE|MARKETPLACE_APPLY)\]\s*\{/.test(text)) {
        diagLogs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await openCommandCenterSection(page, 'marketplace');

assertRuntime(
    'marketplace dashboard visible',
    await page.locator('[data-marketplace-dashboard]').isVisible(),
    stats
);

await page.click('[data-marketplace-section="create"]');
await page.fill('[data-marketplace-create-title]', 'Phase 51 Validator Listing');
await page.fill('[data-marketplace-create-description]', 'Runtime CRUD verification listing.');
await page.fill('[data-marketplace-create-price]', '12345');
await page.fill('[data-marketplace-create-delivery]', '3');
await page.click('[data-marketplace-create-btn]');
await page.waitForSelector('[data-marketplace-my-listings]', { timeout: 10000 });

const createdListing = page.locator('[data-marketplace-my-listing]').first();
assertRuntime('created listing appears in my listings', await createdListing.isVisible(), stats);

const createdServiceId = await createdListing.getAttribute('data-marketplace-my-listing');
assertRuntime('created listing service id available', Boolean(createdServiceId), stats, { createdServiceId });

if (createdServiceId) {
    await page.click(`[data-marketplace-edit="${createdServiceId}"]`);
    await page.waitForSelector(`[data-marketplace-edit-form="${createdServiceId}"]`, { timeout: 10000 });
    await page.fill('[data-marketplace-edit-title]', 'Phase 51 Validator Listing Updated');
    await page.click('[data-marketplace-save-edit]');
    await page.waitForTimeout(250);

    const updatedTitle = await page
        .locator(`[data-marketplace-listing-title="${createdServiceId}"]`)
        .innerText();
    assertRuntime(
        'listing edit updates visible title',
        /Updated/i.test(updatedTitle),
        stats,
        { updatedTitle }
    );

    await page.click(`[data-marketplace-delete="${createdServiceId}"]`);
    await page.waitForTimeout(350);
    assertRuntime(
        'listing delete removes row',
        (await page.locator(`[data-marketplace-my-listing="${createdServiceId}"]`).count()) === 0,
        stats
    );
}

await page.click('[data-marketplace-section="opportunities"]');
await page.waitForSelector('[data-marketplace-opportunities]', { timeout: 10000 });
const applyButton = page.locator('[data-marketplace-apply]').first();
if (await applyButton.count()) {
    await applyButton.click();
}
assertRuntime('opportunities section reachable', await page.locator('[data-marketplace-opportunities]').isVisible(), stats);

assertRuntime(
    'marketplace create/update/delete diagnostics emitted',
    hasDiagTag(diagLogs, 'MARKETPLACE_CREATE') &&
        hasDiagTag(diagLogs, 'MARKETPLACE_UPDATE') &&
        hasDiagTag(diagLogs, 'MARKETPLACE_DELETE'),
    stats
);

await browser.close();
emitTruthSummary(stats, 'MARKETPLACE_TRUTH_COMPLETE=true');
