#!/usr/bin/env node
/**
 * Phase 4 identity-backed editorial — local Chromium Studio smoke.
 *
 * Serves the local frontend (not Netlify). Does NOT deploy, PATCH production,
 * invent coworker editorial metadata, or rename assets.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import {
    PHASE4_EXACT_MEDIA_IDENTITY,
    PHASE4_PROVISIONAL_EPISODE_GUIDE,
    buildIdentityBackedEditorialRow,
    applyIdentityBackedCategoryDecision,
    resolveEditorialMetadataStatus,
    canEnableEditorialCategoryActions,
    identityAloneMustNotPersist
} from '../src/lib/feed/identityBackedEditorialReview.js';
import {
    createMemoryStorage,
    loadCreatorCatalogMetadata,
    saveCreatorCatalogMetadata
} from '../src/lib/feed/creatorCatalogMetadata.js';
import { canPersistCategoryForAsset } from '../src/lib/feed/categorySuggestionReview.js';
import { openContentTab, ADMIN_PASSWORD } from '../tests/helpers/studio-navigation.mjs';

/**
 * Cold-start Studio unlock for local smoke.
 * Seeds password session so ghost-trigger mounts, then completes adminMode via login panel.
 * @param {import('@playwright/test').Page} page
 * @param {string} frontendUrl
 */
async function unlockStudioLocal(page, frontendUrl) {
    await page.addInitScript((tokenKey) => {
        try {
            localStorage.setItem(tokenKey, 'dev_local_session');
        } catch {
            /* ignore */
        }
    }, 'reelforge_admin_session_token');

    await page.goto(frontendUrl.replace(/\/$/, '') + '/', {
        waitUntil: 'domcontentloaded',
        timeout: 120_000
    });
    await page.waitForSelector('.ghost-trigger', { timeout: 60_000 });
    await page.click('.ghost-trigger');
    await page.waitForTimeout(600);

    const pw = page.locator('.admin-login-panel input[type="password"]').first();
    if ((await pw.count()) > 0 && (await pw.isVisible().catch(() => false))) {
        await pw.fill(ADMIN_PASSWORD);
        const btn = page.locator('.admin-login-panel .submit-btn').first();
        if (await btn.count()) await btn.click();
        else await pw.press('Enter');
    }

    await page.waitForSelector('[data-production-command-center], .control-center-container', {
        timeout: 60_000
    });
    await page.waitForTimeout(800);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const reportPath = path.join(root, 'artifacts', 'phase-4-identity-backed-browser-smoke.json');

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

/** @type {Record<string, unknown>} */
const report = {
    phase: 'PHASE-4-IDENTITY-BACKED-BROWSER-SMOKE',
    frontendUrl: '',
    ui: {},
    identityRows: [],
    authorityGate: {},
    mutations: {},
    consoleErrors: [],
    pageErrors: [],
    validators: {},
    deploy: 0
};

console.log('\n[phase-4-identity-backed-browser-smoke]');

console.log('\n[safety logic — no production writes]');
{
    const safety = identityAloneMustNotPersist();
    assert(safety.writesTitle === false, 'identity alone does not write title');
    assert(safety.writesDescription === false, 'identity alone does not write description');
    assert(safety.patchesCategory === false, 'identity alone does not PATCH category');

    const filenameStatus = resolveEditorialMetadataStatus({
        productionId: EXPECTED[0].id,
        authoritativeTitle: '01_ARRIVAL_OPEN_v1.mp4',
        authoritativeDescription: ''
    });
    assert(filenameStatus.status !== 'AUTHORITATIVE', 'filename alone is not authoritative');
    assert(
        filenameStatus.workflowState === 'WAITING_FOR_AUTHORITATIVE_METADATA',
        'filename alone waits for authority'
    );

    const provisional = resolveEditorialMetadataStatus({
        productionId: EXPECTED[0].id,
        provisionalTitle: PHASE4_PROVISIONAL_EPISODE_GUIDE[0].provisionalTitle
    });
    assert(provisional.status === 'PROVISIONAL', 'episode-guide remains PROVISIONAL');
    assert(provisional.editorialTitle === '', 'provisional title not promoted');

    const storage = createMemoryStorage();
    const row = await buildIdentityBackedEditorialRow(
        {
            productionId: EXPECTED[0].id,
            currentProductionTitle: EXPECTED[0].title
        },
        { storage }
    );
    assert(row.nlpRan === false, 'exact identity alone does not run NLP decision');
    assert(row.actionsEnabled === false, 'actions disabled without authority');
    const blocked = applyIdentityBackedCategoryDecision(
        row,
        { action: 'accept', category: 'Romance' },
        { storage, patchCategory: true }
    );
    assert(blocked.ok === false, 'exact identity cannot assign category');
    assert(
        blocked.reason === 'WAITING_FOR_AUTHORITATIVE_METADATA',
        'block reason WAITING_FOR_AUTHORITATIVE_METADATA'
    );

    saveCreatorCatalogMetadata(
        EXPECTED[1].id,
        { title: 'Locked', category: 'Suspense' },
        { storage, patchCategory: false }
    );
    const lockedRow = await buildIdentityBackedEditorialRow(
        {
            productionId: EXPECTED[1].id,
            editorialAuthority: 'authoritative',
            authoritativeTitle: 'Cyber Strike: Tokyo',
            authoritativeDescription:
                'A cyberpunk hacker breach in neon Tokyo with combat operatives and digital warfare.'
        },
        { storage }
    );
    assert(lockedRow.creatorLocked === true, 'creator-lock still detected');
    const lockBlock = applyIdentityBackedCategoryDecision(
        { ...lockedRow, creatorLocked: true },
        { action: 'accept', category: 'Cyber-Action' },
        { storage, patchCategory: false }
    );
    assert(lockBlock.ok === false && lockBlock.reason === 'creator-lock', 'creator-lock blocks Accept');
    assert(
        loadCreatorCatalogMetadata(EXPECTED[1].id, { storage }).category === 'Suspense',
        'creator lock category preserved'
    );

    assert(!canPersistCategoryForAsset({ id: 'ai-black-stories-1' }).ok, 'demo ID blocked');
    assert(!canPersistCategoryForAsset({ isPlaceholder: true, id: 'x' }).ok, 'placeholder blocked');
    assert(
        !canEnableEditorialCategoryActions({
            metadataStatus: 'MISSING',
            identityConfidence: 'EXACT',
            productionId: EXPECTED[0].id
        }),
        'missing authority disables actions'
    );
}

console.log('\n[bundle markers]');
{
    if (!fs.existsSync(dist)) {
        assert(false, 'dist missing — run npm run build first');
    } else {
        const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
        const match = html.match(/assets\/index-[^"]+\.js/);
        assert(Boolean(match), 'index bundle present');
        if (match) {
            const js = fs.readFileSync(path.join(dist, match[0]), 'utf8');
            assert(
                js.includes('data-identity-backed-editorial-review') ||
                    js.includes('Identity-backed editorial'),
                'identity panel in bundle'
            );
            assert(
                js.includes('WAITING_FOR_AUTHORITATIVE_METADATA'),
                'waiting state string in bundle'
            );
            assert(
                js.includes('data-smart-category-audit') || js.includes('CURRENT DISTRIBUTION'),
                'Phase 3A audit still in bundle'
            );
            assert(
                js.includes('data-nlp-category-review') || js.includes('nlp-category-review'),
                'Vault review marker still in bundle'
            );
            assert(
                js.includes('data-hero-nlp-category-review') ||
                    js.includes('hero-nlp-category-review'),
                'Hero review marker still in bundle'
            );
        }
    }
}

console.log('\n[chromium — local Studio UI]');
{
    const port = Number(process.env.PHASE4_SMOKE_PORT || 5194);
    const server = await createServer({
        root,
        logLevel: 'error',
        server: {
            host: '127.0.0.1',
            port,
            strictPort: true
        }
    });
    await server.listen();
    const frontendUrl =
        server.resolvedUrls?.local?.[0]?.replace(/\/$/, '') || `http://127.0.0.1:${port}`;
    report.frontendUrl = frontendUrl;
    console.log(`  · local frontend ${frontendUrl}`);

    /** @type {import('@playwright/test').Browser | null} */
    let browser = null;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            viewport: { width: 1440, height: 900 }
        });
        const page = await context.newPage();

        /** @type {string[]} */
        const consoleErrors = [];
        /** @type {string[]} */
        const pageErrors = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') {
                const text = msg.text();
                // Vite/HMR websocket noise and optional missing backend GETs are not app crashes.
                if (/Failed to load resource|net::ERR_|WebSocket|favicon/i.test(text)) return;
                consoleErrors.push(text.slice(0, 400));
            }
        });
        page.on('pageerror', (err) => {
            pageErrors.push(String(err?.message || err).slice(0, 400));
        });

        /** @type {{ method: string; url: string }[]} */
        const mutationRequests = [];
        let categoryPatchCount = 0;
        let titleWriteAttempts = 0;
        let descriptionWriteAttempts = 0;
        let catalogWriteAttempts = 0;

        await page.addInitScript(() => {
            window.__rfPhase4Mutations = {
                categoryPatch: 0,
                titleWrites: 0,
                descriptionWrites: 0,
                catalogWrites: 0,
                saveCreatorCatalogMetadata: 0
            };
            const watchedKeys = /reel_titles_persistent|series-metadata|creator_catalog/i;
            const origSet = Storage.prototype.setItem;
            Storage.prototype.setItem = function setItem(key, value) {
                const k = String(key || '');
                if (watchedKeys.test(k)) {
                    window.__rfPhase4Mutations.catalogWrites += 1;
                    try {
                        const parsed = JSON.parse(String(value || '{}'));
                        const ids = [
                            '03ef898a-989f-42c3-bdbb-67f37338df65',
                            'd2aafde7-d7ba-492c-a860-20b51f7f4033',
                            '615e0eae-47b4-468a-b6dd-a6846b464846',
                            '9a1251a2-d6a6-42e5-9fcd-4eca17dcd6ef',
                            '3894107e-ae44-43c5-af72-b3f5d5e0ad90',
                            '201ec6ee-6822-4bda-9295-080beb6f4e35'
                        ];
                        for (const id of ids) {
                            const entry = parsed?.[id];
                            if (!entry || typeof entry !== 'object') continue;
                            if (Object.prototype.hasOwnProperty.call(entry, 'title')) {
                                window.__rfPhase4Mutations.titleWrites += 1;
                            }
                            if (Object.prototype.hasOwnProperty.call(entry, 'description')) {
                                window.__rfPhase4Mutations.descriptionWrites += 1;
                            }
                        }
                    } catch {
                        /* ignore */
                    }
                }
                return origSet.call(this, key, value);
            };
        });

        // Serve six production videos on GET /api/reels (titles only — no editorial authority).
        const readyCatalog = EXPECTED.map((row) => ({
            id: row.id,
            title: row.title,
            name: row.title,
            category: 'Trending',
            type: 'video',
            url: `https://cdn.example/${row.file}`,
            status: 'ready'
        }));

        await page.route('**/*', async (route) => {
            const req = route.request();
            const method = req.method().toUpperCase();
            const url = req.url();

            if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
                // Mock ready catalog for title overlay only (no editorial fields).
                if (/\/api\/reels(?:\?|$)/.test(url) && !/\/api\/reels\/[^/]+/.test(url)) {
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify(readyCatalog)
                    });
                    return;
                }
                // Soft stubs so local Studio can boot without a backend.
                if (/\/api\/health(?:\?|$)/.test(url) || /\/health(?:\?|$)/.test(url)) {
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({ ok: true, status: 'ok' })
                    });
                    return;
                }
                if (/\/api\/(sync|notifications|analytics|security|workflow|hero)\//i.test(url)) {
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({ ok: true, items: [], events: [] })
                    });
                    return;
                }
                if (/\/(videos|thumbs|ingest)\//i.test(url)) {
                    await route.fulfill({ status: 204, body: '' });
                    return;
                }
                await route.continue();
                return;
            }

            // Force local password fallback (do not talk to production/backend auth).
            if (method === 'POST' && /\/admin\/auth/i.test(url)) {
                await route.fulfill({
                    status: 503,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'phase4_smoke_offline_auth' })
                });
                return;
            }

            const isCatalogish =
                /\/api\/reels/i.test(url) ||
                /\/category/i.test(url) ||
                /\/api\/.*title/i.test(url) ||
                /\/api\/.*description/i.test(url) ||
                /\/api\/.*metadata/i.test(url) ||
                /\/api\/.*catalog/i.test(url);

            if (['PATCH', 'PUT', 'POST', 'DELETE'].includes(method) && isCatalogish) {
                mutationRequests.push({ method, url: url.slice(0, 220) });
                if (/\/category/i.test(url) || method === 'PATCH') categoryPatchCount += 1;
                if (/title/i.test(url)) titleWriteAttempts += 1;
                if (/description/i.test(url)) descriptionWriteAttempts += 1;
                catalogWriteAttempts += 1;
                await route.fulfill({
                    status: 403,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        error: 'phase4_smoke_blocked_mutation',
                        blocked: true
                    })
                });
                return;
            }

            // Allow unrelated POSTs but never forward mutating catalog traffic.
            await route.continue();
        });

        await unlockStudioLocal(page, frontendUrl);
        await openContentTab(page);

        // Identity panel may be below the fold in Content tab.
        await page.evaluate(() => {
            document
                .querySelector('[data-identity-backed-editorial-review]')
                ?.scrollIntoView({ block: 'center' });
            document
                .querySelector('[data-smart-category-audit]')
                ?.scrollIntoView({ block: 'center' });
        });
        await page.waitForSelector('[data-identity-backed-editorial-review]', {
            timeout: 60_000,
            state: 'visible'
        });
        await page.waitForSelector('[data-id-editorial-row]', { timeout: 60_000 });
        await page.waitForTimeout(1200);

        const panelCount = await page.locator('[data-identity-backed-editorial-review]').count();
        assert(panelCount === 1, 'identity-backed editorial panel renders');

        const auditCount = await page.locator('[data-smart-category-audit]').count();
        assert(auditCount >= 1, 'Phase 3A Smart Category Audit still renders');

        const currentDist = await page.locator('[data-current-distribution]').count();
        const recommendedDist = await page.locator('[data-recommended-distribution]').count();
        assert(currentDist >= 1, 'Smart Category current distribution renders');
        assert(recommendedDist >= 1, 'Smart Category recommended distribution renders');

        const rows = await page.locator('[data-id-editorial-row]').evaluateAll((nodes) =>
            nodes.map((el) => ({
                productionId: el.getAttribute('data-production-id') || '',
                identityConfidence: el.getAttribute('data-identity-confidence') || '',
                metadataStatus: el.getAttribute('data-metadata-status') || '',
                workflowState: el.getAttribute('data-workflow-state') || '',
                actionsEnabled: el.getAttribute('data-actions-enabled') || '',
                currentTitle:
                    el.querySelector('[data-id-current-title]')?.textContent?.trim() || '',
                matchedFile:
                    el.querySelector('[data-id-matched-file]')?.textContent?.trim() || '',
                waitingVisible: Boolean(
                    el.querySelector('[data-waiting-for-authoritative-metadata]')
                ),
                nlpBlockVisible: Boolean(el.querySelector('[data-id-nlp-block]')),
                acceptDisabled: Boolean(el.querySelector('[data-id-accept]')?.disabled),
                overrideDisabled: Boolean(el.querySelector('[data-id-override]')?.disabled),
                manualDisabled: Boolean(el.querySelector('[data-id-manual]')?.disabled),
                provisionalText:
                    el.querySelector('[data-id-provisional-title]')?.textContent?.trim() || '',
                editorialTitle:
                    el.querySelector('[data-id-editorial-title]')?.textContent?.trim() || ''
            }))
        );

        report.identityRows = rows;
        assert(rows.length === 6, `six identity rows rendered (got ${rows.length})`);
        assert(
            rows.every((r) => r.identityConfidence === 'EXACT'),
            'all rows identityConfidence=EXACT'
        );
        assert(
            rows.every((r) => r.workflowState === 'WAITING_FOR_AUTHORITATIVE_METADATA'),
            'all rows WAITING_FOR_AUTHORITATIVE_METADATA'
        );
        assert(
            rows.every((r) => r.metadataStatus === 'PROVISIONAL' || r.metadataStatus === 'MISSING'),
            'authority missing/provisional (not AUTHORITATIVE)'
        );
        assert(
            rows.every((r) => r.actionsEnabled === 'false'),
            'actionsEnabled=false on all rows'
        );
        assert(
            rows.every((r) => r.waitingVisible === true),
            'WAITING copy visible on all rows'
        );
        assert(
            rows.every((r) => r.nlpBlockVisible === false),
            'NLP production decision block not shown'
        );
        assert(
            rows.every((r) => r.acceptDisabled && r.overrideDisabled && r.manualDisabled),
            'Accept / Override / Manual all disabled'
        );
        assert(
            rows.every((r) => !r.editorialTitle),
            'no invented editorial titles in UI'
        );

        for (const expected of EXPECTED) {
            const row = rows.find((r) => r.productionId === expected.id);
            assert(Boolean(row), `row present for ${expected.id.slice(0, 8)}…`);
            if (!row) continue;
            assert(
                row.currentTitle.includes(expected.title) ||
                    row.currentTitle === expected.title,
                `${expected.id.slice(0, 8)}… preserves production title`
            );
            assert(
                row.matchedFile.includes(expected.file),
                `${expected.id.slice(0, 8)}… matched source ${expected.file}`
            );
        }

        // Attempt actions while disabled — must not mutate.
        const firstAccept = page.locator('[data-id-accept]').first();
        const firstOverride = page.locator('[data-id-override]').first();
        const firstManual = page.locator('[data-id-manual]').first();
        await firstAccept.click({ force: true }).catch(() => {});
        await firstOverride.click({ force: true }).catch(() => {});
        await firstManual.click({ force: true }).catch(() => {});
        await page.waitForTimeout(400);

        const lsMutations = await page.evaluate(() => window.__rfPhase4Mutations || {});
        // Baseline localStorage traffic from app boot may touch unrelated keys; focus on
        // title/description counters for the six production IDs and network mutations.
        assert(categoryPatchCount === 0, 'category PATCH count = 0');
        assert(
            mutationRequests.filter((m) => /\/category/i.test(m.url)).length === 0,
            'no category mutation requests'
        );
        assert(titleWriteAttempts === 0, 'network title write attempts = 0');
        assert(descriptionWriteAttempts === 0, 'network description write attempts = 0');
        assert(catalogWriteAttempts === 0, 'production catalog write attempts = 0');
        assert(
            Number(lsMutations.titleWrites || 0) === 0,
            'persistent title writes for six IDs = 0'
        );
        assert(
            Number(lsMutations.descriptionWrites || 0) === 0,
            'persistent description writes for six IDs = 0'
        );

        // Vault / Hero review surfaces remain mountable in Content tab.
        const vaultRoot = await page.locator('.video-vault-drop, [data-content-panel="assets"]').count();
        const heroReplace = await page.locator('.hero-replace-section, [data-hero-replace]').count();
        assert(vaultRoot >= 1, 'Vault content surface still present');
        assert(heroReplace >= 1, 'Hero replace surface still present');

        // Note text separates the three confidence axes.
        const note = (
            (await page.locator('[data-id-editorial-note]').textContent()) || ''
        ).toLowerCase();
        assert(
            note.includes('media identity') &&
                note.includes('editorial') &&
                note.includes('nlp'),
            'UI separates media identity / editorial / NLP'
        );

        report.ui = {
            panelRendered: panelCount === 1,
            auditRendered: auditCount >= 1,
            currentDistribution: currentDist >= 1,
            recommendedDistribution: recommendedDist >= 1,
            rowCount: rows.length
        };
        report.authorityGate = {
            waitingCount: rows.filter(
                (r) => r.workflowState === 'WAITING_FOR_AUTHORITATIVE_METADATA'
            ).length,
            actionsDisabled: rows.every((r) => r.actionsEnabled === 'false'),
            nlpDecisionHidden: rows.every((r) => r.nlpBlockVisible === false)
        };
        report.mutations = {
            categoryPatch: categoryPatchCount,
            titleWrites: Number(lsMutations.titleWrites || 0) + titleWriteAttempts,
            descriptionWrites:
                Number(lsMutations.descriptionWrites || 0) + descriptionWriteAttempts,
            productionCatalogWrites: catalogWriteAttempts,
            mutationRequests: mutationRequests.slice(0, 20),
            localStorage: lsMutations
        };
        report.consoleErrors = consoleErrors;
        report.pageErrors = pageErrors;

        // Soft console filter: fail on uncaught exceptions; warn-only on residual console errors.
        assert(pageErrors.length === 0, `no uncaught page exceptions (got ${pageErrors.length})`);
        if (consoleErrors.length) {
            console.log(`  · console errors (non-fatal noise filtered): ${consoleErrors.length}`);
            for (const e of consoleErrors.slice(0, 5)) console.log(`    · ${e}`);
        } else {
            console.log('  ✓ no console errors');
        }

        // Confirm registry still matches expected six EXACT mappings.
        assert(PHASE4_EXACT_MEDIA_IDENTITY.length === 6, 'registry still has six EXACT identities');
        for (const expected of EXPECTED) {
            const reg = PHASE4_EXACT_MEDIA_IDENTITY.find((r) => r.productionId === expected.id);
            assert(
                Boolean(reg?.matchedLocalFiles?.includes(expected.file)),
                `registry ${expected.id.slice(0, 8)}… → ${expected.file}`
            );
        }
    } finally {
        if (browser) await browser.close();
        await server.close();
    }
}

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`  · wrote ${reportPath}`);

if (failed > 0) {
    console.error(`\nFAIL — ${failed}`);
    process.exit(1);
}
console.log('\nPASS — phase-4-identity-backed-browser-smoke');
console.log('STOP — no deploy / no production PATCH / no editorial invention');
process.exit(0);
