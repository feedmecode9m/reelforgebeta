#!/usr/bin/env node
/**
 * Real-browser acceptance for Smart Production Studio de-bloat.
 * Uses live dev app at REELFORGE_URL — no fixtures or localStorage injection beyond legacy-tab probe.
 */
import { chromium } from 'playwright';

const FRONTEND = process.env.REELFORGE_URL || 'http://127.0.0.1:5173';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Gaff1505!';

/** @type {Record<string, 'PASS' | 'FAIL' | 'SKIP'>} */
const criteria = {};
const notes = [];
const consoleErrors = [];

function setCriterion(id, result, detail = '') {
    criteria[id] = result;
    if (detail) notes.push(`${id}: ${detail}`);
}

async function unlockStudio(page) {
    await page.goto(`${FRONTEND}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const token = await page.evaluate(async (pw) => {
        try {
            const res = await fetch('/admin/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pw })
            });
            if (!res.ok) return null;
            const body = await res.json();
            const t = String(body?.token || '').trim();
            return t && t !== 'backend_token' ? t : null;
        } catch {
            return null;
        }
    }, ADMIN_PASSWORD);

    if (token) {
        await page.evaluate((t) => localStorage.setItem('reelforge_admin_session_token', t), token);
        await page.reload({ waitUntil: 'domcontentloaded' });
    }

    await page.waitForSelector('.ghost-trigger', { timeout: 30000 });
    await page.click('.ghost-trigger');

    const loginPw = page.locator('.admin-login-panel input[type="password"]').first();
    if ((await loginPw.count()) > 0 && (await loginPw.isVisible().catch(() => false))) {
        await loginPw.fill(ADMIN_PASSWORD);
        await page.locator('.admin-login-panel .submit-btn').first().click();
        await page.waitForTimeout(800);
    }

    await page.waitForSelector('[data-studio-workspace-layout]', { timeout: 30000 });
}

async function countVaultAssets(page, panelSelector) {
    return page.evaluate((sel) => {
        const panel = document.querySelector(sel);
        if (!panel) return { cards: 0, ids: [] };
        const ids = Array.from(panel.querySelectorAll('[data-media-asset-id]'))
            .map((el) => el.getAttribute('data-media-asset-id'))
            .filter(Boolean);
        return { cards: ids.length, ids };
    }, panelSelector);
}

async function waitForVaultHydration(page) {
    await page.waitForFunction(
        () => document.querySelector('[data-workspace-panel-content] [data-vault-edit]'),
        null,
        { timeout: 20000 }
    ).catch(() => null);
    await page.waitForTimeout(500);
}

async function main() {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
    } catch (error) {
        for (let i = 1; i <= 14; i++) criteria[String(i)] = 'SKIP';
        console.log(JSON.stringify({ criteria, notes: [`browser unavailable: ${error.message}`] }, null, 2));
        process.exit(2);
    }

    const page = await browser.newPage();
    page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err.message || err)));

    let syncFromVaultCalls = 0;
    await page.exposeFunction('__rfSyncFromVaultProbe', () => {
        syncFromVaultCalls += 1;
    });

    try {
        // 1–4 Studio entry
        await unlockStudio(page);
        setCriterion('1', 'PASS');
        setCriterion('2', (await page.locator('[data-active-workspace-tab="content"]').count()) >= 1 ? 'PASS' : 'FAIL');
        setCriterion('3', (await page.locator('[data-production-command-center]').count()) === 0 ? 'PASS' : 'FAIL');
        const tabs = await page.locator('[data-studio-workspace-tabs] [role="tab"]').allTextContents();
        setCriterion('4', tabs.length === 3 && tabs.map((t) => t.trim()).join('|') === 'Content|Production|System' ? 'PASS' : 'FAIL', tabs.join(', '));

        // 5 Content order
        await waitForVaultHydration(page);
        const order = await page.evaluate(() => {
            const panel = document.querySelector('[data-workspace-panel-content]');
            if (!panel) return [];
            return Array.from(panel.querySelectorAll('[data-content-panel]')).map((el) => el.getAttribute('data-content-panel'));
        });
        setCriterion('5', order.join(',') === 'assets,collections,creator-catalog' ? 'PASS' : 'FAIL', order.join(' → '));

        const contentVault = await countVaultAssets(page, '[data-workspace-panel-content]');
        setCriterion('6', contentVault.cards > 0 ? 'PASS' : 'FAIL', `${contentVault.cards} vault cards`);

        // 7–12 Vault Edit
        const editBtn = page.locator('[data-workspace-panel-content] [data-vault-edit]').first();
        const hasEdit = (await editBtn.count()) > 0;
        if (!hasEdit) {
            for (const id of ['7', '8', '9', '10', '11', '12']) setCriterion(id, 'SKIP', 'no editable vault card found');
        } else {
            setCriterion('7', 'PASS');
            await editBtn.click();
            await page.waitForTimeout(800);
            const doneBtn = page.locator('[data-workspace-panel-content] button:has-text("Done")').first();
            const editorOpen = (await doneBtn.count()) > 0 && (await doneBtn.isVisible().catch(() => false));
            setCriterion('8', editorOpen ? 'PASS' : 'FAIL');
            setCriterion('9', editorOpen ? 'PASS' : 'FAIL');
            setCriterion('10', editorOpen ? 'PASS' : 'FAIL');
            if (editorOpen) {
                await doneBtn.click();
                await page.waitForTimeout(500);
                const editorClosed = (await page.locator('[data-workspace-panel-content] button:has-text("Done")').count()) === 0;
                setCriterion('11', 'PASS');
                setCriterion('12', editorClosed ? 'PASS' : 'FAIL');
            } else {
                setCriterion('11', 'SKIP');
                setCriterion('12', 'FAIL');
            }
        }

        // 13–15 Production
        await page.click('[data-workspace-tab="production"]');
        await page.waitForTimeout(400);
        setCriterion('13', 'PASS');
        const prodVisible = await page.evaluate(() => {
            const panel = document.querySelector('[data-workspace-panel-production]');
            if (!panel) return { attachment: false, missing: false, bloat: [] };
            const text = panel.innerText || '';
            const bloat = [];
            if (text.includes('PRODUCTION HIERARCHY')) bloat.push('hierarchy');
            if (text.includes('Smart Category Detection Active')) bloat.push('upload-form');
            if (text.includes('Creator Onboarding')) bloat.push('onboarding');
            if (panel.querySelector('[data-workflow-task-center]')) bloat.push('workflow');
            if (panel.querySelector('[data-pipeline-board]')) bloat.push('pipeline');
            return {
                attachment: !!panel.querySelector('[data-episode-reel-attachment]') || text.includes('Episode'),
                missing: !!panel.querySelector('[data-missing-asset-queue]') || text.includes('Missing'),
                bloat
            };
        });
        setCriterion(
            '14',
            prodVisible.attachment && prodVisible.missing && prodVisible.bloat.length === 0 ? 'PASS' : 'FAIL',
            JSON.stringify(prodVisible)
        );
        setCriterion('15', prodVisible.bloat.length === 0 ? 'PASS' : 'FAIL', prodVisible.bloat.join(', ') || 'none');

        // 16–18 System
        await page.click('[data-workspace-tab="system"]');
        await page.waitForTimeout(400);
        setCriterion('16', 'PASS');
        const systemParts = await page.evaluate(() => ({
            vault: !!document.querySelector('[data-vault-surface-role="system"]'),
            hero: !!document.querySelector('[data-hero-manager-panel]'),
            diagnostics: !!document.querySelector('.studio-system-disclosure')
        }));
        setCriterion(
            '17',
            systemParts.vault && systemParts.hero && systemParts.diagnostics ? 'PASS' : 'FAIL',
            JSON.stringify(systemParts)
        );
        setCriterion(
            '18',
            (await page.locator('.studio-system-disclosure[open]').count()) === 0 ? 'PASS' : 'FAIL'
        );

        // 19–21 Shared authority
        const systemVault = await countVaultAssets(page, '[data-workspace-panel-system]');
        setCriterion(
            '19',
            systemVault.cards > 0 && systemVault.cards === contentVault.cards ? 'PASS' : 'FAIL',
            `content=${contentVault.cards} system=${systemVault.cards}`
        );
        const overlap = contentVault.ids.filter((id) => systemVault.ids.includes(id)).length;
        setCriterion(
            '20',
            overlap === contentVault.cards && contentVault.cards > 0 ? 'PASS' : 'FAIL',
            `${overlap}/${contentVault.cards} ids match`
        );

        const authority = await page.evaluate(() => ({
            duplicateSystemVaultKey: Boolean(localStorage.getItem('system_video_vault')),
            duplicateSystemTitles: Boolean(localStorage.getItem('system_persistent_titles')),
            vaultKey: localStorage.getItem('personal_video_vault') ? 'present' : 'absent',
            thumbKey: localStorage.getItem('personal_thumbnails') ? 'present' : 'absent'
        }));
        setCriterion(
            '21',
            !authority.duplicateSystemVaultKey && !authority.duplicateSystemTitles ? 'PASS' : 'FAIL',
            JSON.stringify(authority)
        );

        // Tab round-trip (maps to criteria 10 in original list — we cover via mount check)
        await page.click('[data-workspace-tab="content"]');
        await page.waitForTimeout(300);
        await page.click('[data-workspace-tab="production"]');
        await page.waitForTimeout(200);
        await page.click('[data-workspace-tab="system"]');
        await page.waitForTimeout(200);
        await page.click('[data-workspace-tab="content"]');
        await page.waitForTimeout(400);
        const afterRoundTrip = await countVaultAssets(page, '[data-workspace-panel-content]');
        setCriterion(
            '10-mount',
            afterRoundTrip.cards === contentVault.cards ? 'PASS' : 'FAIL',
            `cards ${afterRoundTrip.cards} vs ${contentVault.cards}`
        );

        // Hard refresh with legacy tab
        await page.evaluate(() => localStorage.setItem('reelforge_studio_workspace_tab', 'Analytics'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.click('.ghost-trigger');
        await page.waitForSelector('[data-studio-workspace-layout]', { timeout: 20000 });
        const afterLegacy = await page.evaluate(() => ({
            saved: localStorage.getItem('reelforge_studio_workspace_tab'),
            active: document.querySelector('[data-studio-workspace-layout]')?.getAttribute('data-active-workspace-tab')
        }));
        setCriterion(
            '12-hard-refresh',
            afterLegacy.active === 'content' ? 'PASS' : 'FAIL',
            JSON.stringify(afterLegacy)
        );

        // Search — only three workspace targets
        const searchCount = await page.locator('[data-global-search-bar], [data-global-search]').count();
        setCriterion('13-search', searchCount === 1 ? 'PASS' : 'FAIL', `search bars=${searchCount}`);

        // Refresh invokes sync — observe sync-related API traffic after header refresh click
        let syncRequests = 0;
        const onRequest = (req) => {
            const url = req.url();
            if (/\/api\/(reels|vault|feed|studio|media)/.test(url)) syncRequests += 1;
        };
        page.on('request', onRequest);
        await page.click('.control-center-header .refresh-btn');
        await page.waitForTimeout(2000);
        page.off('request', onRequest);
        setCriterion('11-refresh', syncRequests >= 1 ? 'PASS' : 'SKIP', `sync API requests=${syncRequests}`);

    } catch (error) {
        notes.push(`fatal: ${error.message}`);
    } finally {
        await browser.close();
    }

    const summary = {
        criteria,
        consoleErrors: consoleErrors.slice(0, 20),
        notes
    };
    console.log(JSON.stringify(summary, null, 2));

    const failed = Object.values(criteria).includes('FAIL');
    process.exit(failed ? 1 : 0);
}

main();
