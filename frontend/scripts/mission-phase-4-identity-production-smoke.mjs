#!/usr/bin/env node
/**
 * Phase 4 identity-backed editorial — PRODUCTION Studio smoke (read-only).
 * Does NOT PATCH / rename / invent authoritative editorial metadata.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unlockStudio, openContentTab } from '../tests/helpers/studio-navigation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const FRONTEND = (process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app').replace(
    /\/$/,
    ''
);

const EXPECTED = Object.freeze([
    {
        id: '03ef898a-989f-42c3-bdbb-67f37338df65',
        title: '01 ARRIVAL OPEN v1',
        file: '01_ARRIVAL_OPEN_v1.mp4'
    },
    {
        id: 'd2aafde7-d7ba-492c-a860-20b51f7f4033',
        title: '03 CLUB POOM POOM V1',
        file: '03_CLUB POOM POOM_V1.mp4'
    },
    {
        id: '615e0eae-47b4-468a-b6dd-a6846b464846',
        title: 'MICROS STIRRED V1',
        file: 'MICROS_STIRRED_V1.mp4'
    },
    {
        id: '9a1251a2-d6a6-42e5-9fcd-4eca17dcd6ef',
        title: 'MICROS Motherland V1(1)',
        file: 'MICROS_Motherland_V1(1).mp4'
    },
    {
        id: '3894107e-ae44-43c5-af72-b3f5d5e0ad90',
        title: 'condo v1 2',
        file: 'condo_v1_2.mp4'
    },
    {
        id: '201ec6ee-6822-4bda-9295-080beb6f4e35',
        title: '07 AMP JAM V1',
        file: '07_AMP_JAM_V1.mp4'
    }
]);

let failed = 0;
function assert(cond, label) {
    if (cond) console.log(`  ✓ ${label}`);
    else {
        failed += 1;
        console.error(`  ✗ ${label}`);
    }
}

const report = {
    phase: 'PHASE-4-IDENTITY-PRODUCTION-SMOKE',
    frontendUrl: FRONTEND,
    ui: {},
    identityRows: [],
    authorityGate: {},
    mutations: {},
    consoleErrors: [],
    pageErrors: [],
    status: 'PENDING'
};

console.log('\n[phase-4-identity production smoke]');
console.log(`  · ${FRONTEND}`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

/** @type {string[]} */
const consoleErrors = [];
/** @type {string[]} */
const pageErrors = [];
page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource|net::ERR_|WebSocket|favicon|CORS/i.test(text)) return;
    consoleErrors.push(text.slice(0, 400));
});
page.on('pageerror', (err) => pageErrors.push(String(err?.message || err).slice(0, 400)));

/** @type {{ method: string; url: string }[]} */
const mutationRequests = [];
let categoryPatch = 0;
let titleWrites = 0;
let descriptionWrites = 0;
let catalogWrites = 0;

page.on('request', (req) => {
    const method = req.method().toUpperCase();
    if (!['PATCH', 'PUT', 'POST', 'DELETE'].includes(method)) return;
    const url = req.url();
    // Ignore auth unlock + ordinary telemetry; count catalog/title/category mutations only.
    if (/\/admin\/auth/i.test(url)) return;
    if (/\/ingest\//i.test(url)) return;
    if (/\/api\/(analytics|security|notifications|sync|workflow)\b/i.test(url) && method === 'POST') {
        // status/hydrate traffic — not title/category persistence
        if (!/title|description|category|catalog|reels/i.test(url)) return;
    }
    const isCatalogish =
        /\/api\/reels/i.test(url) ||
        /\/category/i.test(url) ||
        /\/api\/.*title/i.test(url) ||
        /\/api\/.*description/i.test(url) ||
        /\/api\/.*metadata/i.test(url) ||
        /\/api\/.*catalog/i.test(url);
    if (!isCatalogish) return;
    mutationRequests.push({ method, url: url.slice(0, 220) });
    if (/\/category/i.test(url) || method === 'PATCH') categoryPatch += 1;
    if (/title/i.test(url)) titleWrites += 1;
    if (/description/i.test(url)) descriptionWrites += 1;
    catalogWrites += 1;
});

try {
    await unlockStudio(page, FRONTEND + '/');
    await openContentTab(page);
    await page.evaluate(() => {
        document
            .querySelector('[data-identity-backed-editorial-review]')
            ?.scrollIntoView({ block: 'center' });
    });
    await page.waitForSelector('[data-identity-backed-editorial-review]', {
        timeout: 60_000,
        state: 'visible'
    });
    await page.waitForSelector('[data-id-editorial-row]', { timeout: 60_000 });
    await page.waitForTimeout(1500);

    assert(
        (await page.locator('[data-identity-backed-editorial-review]').count()) === 1,
        'identity panel renders'
    );
    assert((await page.locator('[data-smart-category-audit]').count()) >= 1, 'Phase 3A audit renders');
    assert(
        (await page.locator('[data-current-distribution]').count()) >= 1,
        'current distribution renders'
    );
    assert(
        (await page.locator('[data-recommended-distribution]').count()) >= 1,
        'recommended distribution renders'
    );

    const rows = await page.locator('[data-id-editorial-row]').evaluateAll((nodes) =>
        nodes.map((el) => ({
            productionId: el.getAttribute('data-production-id') || '',
            identityConfidence: el.getAttribute('data-identity-confidence') || '',
            metadataStatus: el.getAttribute('data-metadata-status') || '',
            workflowState: el.getAttribute('data-workflow-state') || '',
            actionsEnabled: el.getAttribute('data-actions-enabled') || '',
            currentTitle: el.querySelector('[data-id-current-title]')?.textContent?.trim() || '',
            matchedFile: el.querySelector('[data-id-matched-file]')?.textContent?.trim() || '',
            waitingVisible: Boolean(el.querySelector('[data-waiting-for-authoritative-metadata]')),
            nlpBlockVisible: Boolean(el.querySelector('[data-id-nlp-block]')),
            acceptDisabled: Boolean(el.querySelector('[data-id-accept]')?.disabled),
            overrideDisabled: Boolean(el.querySelector('[data-id-override]')?.disabled),
            manualDisabled: Boolean(el.querySelector('[data-id-manual]')?.disabled),
            editorialTitle: el.querySelector('[data-id-editorial-title]')?.textContent?.trim() || ''
        }))
    );
    report.identityRows = rows;

    assert(rows.length === 6, `six identity rows (got ${rows.length})`);
    assert(
        rows.every((r) => r.identityConfidence === 'EXACT'),
        'all EXACT'
    );
    assert(
        rows.every((r) => r.workflowState === 'WAITING_FOR_AUTHORITATIVE_METADATA'),
        'all WAITING_FOR_AUTHORITATIVE_METADATA'
    );
    assert(
        rows.every((r) => r.metadataStatus === 'PROVISIONAL' || r.metadataStatus === 'MISSING'),
        'authority not AUTHORITATIVE'
    );
    assert(
        rows.every((r) => r.actionsEnabled === 'false'),
        'actions disabled'
    );
    assert(
        rows.every((r) => r.waitingVisible),
        'waiting copy visible'
    );
    assert(
        rows.every((r) => !r.nlpBlockVisible),
        'NLP production decision hidden'
    );
    assert(
        rows.every((r) => r.acceptDisabled && r.overrideDisabled && r.manualDisabled),
        'Accept/Override/Manual disabled'
    );
    assert(
        rows.every((r) => !r.editorialTitle),
        'no invented editorial titles'
    );

    for (const expected of EXPECTED) {
        const row = rows.find((r) => r.productionId === expected.id);
        assert(Boolean(row), `row ${expected.id.slice(0, 8)}…`);
        if (!row) continue;
        assert(
            row.currentTitle.includes(expected.title),
            `${expected.id.slice(0, 8)}… title unchanged`
        );
        assert(
            row.matchedFile.includes(expected.file),
            `${expected.id.slice(0, 8)}… source ${expected.file}`
        );
    }

    // Disabled action clicks must not mutate.
    await page.locator('[data-id-accept]').first().click({ force: true }).catch(() => {});
    await page.locator('[data-id-override]').first().click({ force: true }).catch(() => {});
    await page.locator('[data-id-manual]').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);

    assert(categoryPatch === 0, 'category PATCH = 0');
    assert(titleWrites === 0, 'title writes = 0');
    assert(descriptionWrites === 0, 'description writes = 0');
    assert(catalogWrites === 0, 'production catalog writes = 0');

    assert(
        (await page.locator('.video-vault-drop, [data-content-panel="assets"]').count()) >= 1,
        'Vault surface present'
    );
    assert(
        (await page.locator('.hero-replace-section, [data-hero-replace]').count()) >= 1,
        'Hero surface present'
    );
    assert(pageErrors.length === 0, `no uncaught exceptions (${pageErrors.length})`);
    if (consoleErrors.length) {
        console.log(`  · console errors after filter: ${consoleErrors.length}`);
        for (const e of consoleErrors.slice(0, 5)) console.log(`    · ${e}`);
    } else {
        console.log('  ✓ no application console errors');
    }

    report.ui = {
        panelRendered: true,
        auditRendered: true,
        rowCount: rows.length
    };
    report.authorityGate = {
        waitingCount: 6,
        actionsDisabled: true,
        nlpDecisionHidden: true
    };
    report.mutations = {
        categoryPatch,
        titleWrites,
        descriptionWrites,
        productionCatalogWrites: catalogWrites,
        mutationRequests
    };
    report.consoleErrors = consoleErrors;
    report.pageErrors = pageErrors;
    report.status = failed === 0 ? 'PASS' : 'FAIL';
} finally {
    await browser.close();
}

const out = path.join(root, 'artifacts', 'phase-4-identity-production-smoke.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`  · wrote ${out}`);

if (failed > 0) {
    console.error(`\nFAIL — ${failed}`);
    process.exit(1);
}
console.log('\nPASS — phase-4-identity production smoke');
console.log('Phase 4 remains READY_FOR_AUTHORITATIVE_METADATA');
process.exit(0);
