#!/usr/bin/env node
/**
 * Phase 45 — Marketplace UI validation (create, edit, delete, reload, persistence).
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

const TEST_SERVICE_ID = 'service-ui-validation-test';
const TEST_TITLE = 'UI Validation Marketplace Listing';
const UPDATED_TITLE = `${TEST_TITLE} Updated`;
let createdServiceId = TEST_SERVICE_ID;

page.on('console', (msg) => {
    const text = msg.text();
    if (
        text.includes('[MARKETPLACE_CREATE]') ||
        text.includes('[MARKETPLACE_UPDATE]') ||
        text.includes('[MARKETPLACE_DELETE]') ||
        text.includes('[MARKETPLACE_APPLY]')
    ) {
        diagLogs.push(text);
    }
});

await page.addInitScript(
    ({ serviceId }) => {
        localStorage.removeItem('admin_mode');
        localStorage.removeItem('reelforge_admin_session_token');
        const key = 'reelforge_creator_marketplace';
        const raw = localStorage.getItem(key);
        let store;
        try {
            store = raw ? JSON.parse(raw) : null;
        } catch {
            store = null;
        }
        if (!store || typeof store !== 'object') {
            store = { creators: {}, services: {}, gigs: {}, portfolios: {}, reviews: {} };
        }
        if (store.services?.[serviceId]) {
            delete store.services[serviceId];
        }
        store.gigs = store.gigs || {};
        if (!store.gigs['gig-vfx-open']) {
            store.gigs['gig-vfx-open'] = {
                gigId: 'gig-vfx-open',
                serviceId: 'service-vfx-001',
                creatorId: 'creator-vfx-pulse',
                buyerId: '',
                category: 'vfx',
                title: 'Open VFX Composite Gig',
                status: 'open',
                budgetCents: 8500,
                updatedAt: Date.now()
            };
        }
        localStorage.setItem(key, JSON.stringify(store));
    },
    { serviceId: TEST_SERVICE_ID }
);

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await openCommandCenterSection(page, 'marketplace');

assertRuntime(
    'marketplace dashboard mounted in command center',
    await page.locator('[data-marketplace-dashboard]').isVisible(),
    stats
);

await page.locator('[data-marketplace-section="create"]').click();
await page.locator('[data-marketplace-create-title]').fill(TEST_TITLE);
await page.locator('[data-marketplace-create-category]').selectOption('editing');
await page.locator('[data-marketplace-create-description]').fill('Validation listing for marketplace UI.');
await page.locator('[data-marketplace-create-price]').fill('7500');
await page.locator('[data-marketplace-create-delivery]').fill('4');
await page.locator('[data-marketplace-create-btn]').click();

assertRuntime(
    'marketplace create diagnostic emitted',
    diagLogs.some((line) => line.includes('[MARKETPLACE_CREATE]')),
    stats
);

await page.locator('[data-marketplace-section="my-listings"]').click();
await page.waitForSelector('[data-marketplace-my-listing]', { timeout: 10000 });

createdServiceId =
    (await page
        .locator('[data-marketplace-my-listing]')
        .filter({ has: page.locator(`[data-marketplace-listing-title]`, { hasText: TEST_TITLE }) })
        .first()
        .getAttribute('data-marketplace-my-listing')) || createdServiceId;

assertRuntime('created listing visible in my listings', Boolean(createdServiceId), stats, {
    createdServiceId
});

const createdVisible = await page
    .locator(`[data-marketplace-listing-title="${createdServiceId}"]`)
    .textContent();
assertRuntime('created listing title rendered', createdVisible?.includes(TEST_TITLE), stats, {
    createdVisible
});

await page.locator(`[data-marketplace-edit="${createdServiceId}"]`).click();
await page.locator('[data-marketplace-edit-title]').fill(UPDATED_TITLE);
await page.locator('[data-marketplace-save-edit]').click();

assertRuntime(
    'marketplace update diagnostic emitted',
    diagLogs.some((line) => line.includes('[MARKETPLACE_UPDATE]')),
    stats
);

const updatedVisible = await page
    .locator(`[data-marketplace-listing-title="${createdServiceId}"]`)
    .textContent();
assertRuntime('edited listing title persisted in UI', updatedVisible?.includes('Updated'), stats, {
    updatedVisible
});

await page.locator(`[data-marketplace-delete="${createdServiceId}"]`).click();
await page.waitForSelector(`[data-marketplace-my-listing="${createdServiceId}"]`, {
    state: 'detached',
    timeout: 10000
});

assertRuntime(
    'marketplace delete diagnostic emitted',
    diagLogs.some((line) => line.includes('[MARKETPLACE_DELETE]')),
    stats
);

await page.locator('[data-marketplace-section="opportunities"]').click();
const applyButton = page.locator('[data-marketplace-apply="gig-vfx-open"]');
if (await applyButton.isVisible()) {
    await applyButton.click();
    assertRuntime(
        'marketplace apply diagnostic emitted',
        diagLogs.some((line) => line.includes('[MARKETPLACE_APPLY]')),
        stats
    );
} else {
    assertRuntime('open gig available for apply test', false, stats);
}

await page.reload({ waitUntil: 'domcontentloaded' });
await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await openCommandCenterSection(page, 'marketplace');
await page.locator('[data-marketplace-section="my-listings"]').click();

assertRuntime(
    'deleted listing absent after reload',
    (await page.locator(`[data-marketplace-my-listing="${createdServiceId}"]`).count()) === 0,
    stats
);

const storeCheck = await page.evaluate(({ serviceId }) => {
    const api = window.__reelforgeMarketplace;
    const store = api?.loadMarketplaceStore?.();
    return {
        serviceExists: Boolean(store?.services?.[serviceId]),
        gigApplied: store?.gigs?.['gig-vfx-open']?.status === 'in_progress'
    };
}, { serviceId: createdServiceId });

assertRuntime(
    'deleted listing absent from marketplace store after reload',
    !storeCheck.serviceExists,
    stats,
    storeCheck
);

assertRuntime(
    'all marketplace UI diagnostics captured',
    diagLogs.some((line) => line.includes('[MARKETPLACE_CREATE]')) &&
        diagLogs.some((line) => line.includes('[MARKETPLACE_UPDATE]')) &&
        diagLogs.some((line) => line.includes('[MARKETPLACE_DELETE]')),
    stats,
    { diagCount: diagLogs.length }
);

await browser.close();
emitTruthSummary(stats, 'MARKETPLACE_UI_COMPLETE=true');
