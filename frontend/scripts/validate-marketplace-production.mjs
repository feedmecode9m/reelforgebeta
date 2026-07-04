#!/usr/bin/env node
/**
 * Phase 52 — Marketplace production activation validation.
 * Validates create/edit/delete/search/reload flows via command center UI.
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

const TEST_TITLE = 'Phase 52 Production Listing';
const UPDATED_TITLE = `${TEST_TITLE} Updated`;

page.on('console', (msg) => {
    const text = msg.text();
    if (
        text.includes('[MARKETPLACE_CREATE]') ||
        text.includes('[MARKETPLACE_EDIT]') ||
        text.includes('[MARKETPLACE_DELETE]') ||
        text.includes('[MARKETPLACE_APPLY]') ||
        text.includes('[MARKETPLACE_SEARCH]')
    ) {
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
await page.fill('[data-marketplace-create-title]', TEST_TITLE);
await page.fill('[data-marketplace-create-description]', 'Phase 52 production flow listing.');
await page.fill('[data-marketplace-create-price]', '22000');
await page.fill('[data-marketplace-create-delivery]', '5');
await page.click('[data-marketplace-create-btn]');

await page.waitForSelector('[data-marketplace-my-listings]', { timeout: 10000 });
const createdRow = page.locator('[data-marketplace-my-listing]').first();
const serviceId = await createdRow.getAttribute('data-marketplace-my-listing');
assertRuntime('listing created in my listings', Boolean(serviceId), stats, { serviceId });

if (!serviceId) {
    await browser.close();
    emitTruthSummary(stats, 'MARKETPLACE_PRODUCTION_COMPLETE=true');
}

await page.click(`[data-marketplace-edit="${serviceId}"]`);
await page.waitForSelector(`[data-marketplace-edit-form="${serviceId}"]`, { timeout: 10000 });
await page.fill('[data-marketplace-edit-title]', UPDATED_TITLE);
await page.click('[data-marketplace-save-edit]');

const editedTitle = await page.locator(`[data-marketplace-listing-title="${serviceId}"]`).innerText();
assertRuntime('listing edit updates title', editedTitle.includes('Updated'), stats, { editedTitle });

await page.click('[data-marketplace-section="browse"]');
await page.fill('[data-marketplace-search]', 'Updated');
await page.waitForTimeout(400);
const searchHitCount = await page
    .locator(`[data-marketplace-listing="${serviceId}"]`)
    .count();
assertRuntime('listing is discoverable via search', searchHitCount > 0, stats, { searchHitCount, serviceId });

await page.click('[data-marketplace-section="opportunities"]');
assertRuntime(
    'applications section reachable',
    await page.locator('[data-marketplace-applications]').isVisible(),
    stats
);

const applyButton = page.locator('[data-marketplace-apply]').first();
if (await applyButton.count()) {
    await applyButton.click();
}

await page.click('[data-marketplace-section="analytics"]');
assertRuntime('analytics section reachable', await page.locator('[data-marketplace-analytics]').isVisible(), stats);
assertRuntime(
    'analytics cards rendered',
    (await page.locator('[data-marketplace-metric]').count()) >= 4,
    stats
);

await page.click('[data-marketplace-section="my-listings"]');
await page.click(`[data-marketplace-delete="${serviceId}"]`);
await page.waitForSelector(`[data-marketplace-my-listing="${serviceId}"]`, {
    state: 'detached',
    timeout: 10000
});
assertRuntime('listing deleted from my listings', true, stats, { serviceId });

await page.reload({ waitUntil: 'domcontentloaded' });
await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await openCommandCenterSection(page, 'marketplace');
await page.click('[data-marketplace-section="my-listings"]');
assertRuntime(
    'deleted listing remains removed after reload',
    (await page.locator(`[data-marketplace-my-listing="${serviceId}"]`).count()) === 0,
    stats
);

assertRuntime(
    'required marketplace diagnostics emitted',
    diagLogs.some((line) => line.includes('[MARKETPLACE_CREATE]')) &&
        diagLogs.some((line) => line.includes('[MARKETPLACE_EDIT]')) &&
        diagLogs.some((line) => line.includes('[MARKETPLACE_DELETE]')) &&
        diagLogs.some((line) => line.includes('[MARKETPLACE_SEARCH]')),
    stats,
    { diagCount: diagLogs.length }
);

await browser.close();
emitTruthSummary(stats, 'MARKETPLACE_PRODUCTION_COMPLETE=true');
