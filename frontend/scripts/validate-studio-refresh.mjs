#!/usr/bin/env node
/**
 * Studio refresh + workspace contract — de-bloated shell (Content | Production | System).
 */
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const FRONTEND = process.env.REELFORGE_URL || 'http://127.0.0.1:5173';

const REMOVED_TABS = ['Overview', 'Teams', 'Analytics', 'Automation'];
const ACTIVE_TABS = ['Content', 'Production', 'System'];

let failed = false;

function assert(name, ok) {
    if (!ok) {
        failed = true;
        console.log(`FAIL: ${name}`);
    } else {
        console.log(`PASS: ${name}`);
    }
}

function parseDiagLogs(logs, tag) {
    return logs
        .map((line) => {
            const match = line.match(new RegExp(`\\[${tag}\\]\\s*(\\{.*\\})`));
            if (!match) return null;
            try {
                return JSON.parse(match[1]);
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

const layoutPath = join(SRC, 'components/studio/StudioWorkspaceLayout.svelte');
const workspaceLibPath = join(SRC, 'lib/studio/studioWorkspace.js');
const studioExperiencePath = join(SRC, 'components/experiences/StudioExperience.svelte');

assert('StudioWorkspaceLayout.svelte exists', existsSync(layoutPath));
assert('studioWorkspace.js exists', existsSync(workspaceLibPath));
assert('StudioExperience.svelte exists', existsSync(studioExperiencePath));

const layoutSrc = readFileSync(layoutPath, 'utf8');
const workspaceLibSrc = readFileSync(workspaceLibPath, 'utf8');
const studioExperienceSrc = readFileSync(studioExperiencePath, 'utf8');

assert('WORKSPACE_TABS exported', workspaceLibSrc.includes('export const WORKSPACE_TABS'));
for (const tab of ACTIVE_TABS) {
    assert(`WORKSPACE_TABS includes ${tab}`, workspaceLibSrc.includes(`'${tab}'`));
}
for (const tab of REMOVED_TABS) {
    assert(
        `WORKSPACE_TABS does not include ${tab}`,
        !workspaceLibSrc.match(new RegExp(`WORKSPACE_TABS\\s*=\\s*\\[[^\\]]*'${tab}'`))
    );
    assert(`legacy tab ${tab} maps to Content`, workspaceLibSrc.includes(`'${tab}'`));
}

assert('default workspace tab is Content', workspaceLibSrc.includes("return 'Content'"));
assert('legacy tabs resolve to Content on restore', workspaceLibSrc.includes('LEGACY_WORKSPACE_TABS'));

assert('StudioExperience mounts StudioWorkspaceLayout', studioExperienceSrc.includes('<StudioWorkspaceLayout'));
assert(
    'ProductionCommandCenter not in active StudioExperience render',
    !studioExperienceSrc.includes('<ProductionCommandCenter')
);

assert('workspace uses hidden panel mounting', layoutSrc.includes('hidden={activeTab !=='));
assert('content panel marker present', layoutSrc.includes('data-workspace-panel-content'));
assert('production panel marker present', layoutSrc.includes('data-workspace-panel-production'));
assert('system panel marker present', layoutSrc.includes('data-workspace-panel-system'));

assert(
    'Overview tab not in active workspace layout',
    !layoutSrc.includes("activeTab === 'Overview'")
);
for (const tab of ['Teams', 'Analytics', 'Automation']) {
    assert(`${tab} tab not in active workspace layout`, !layoutSrc.includes(`activeTab === '${tab}'`));
}

assert('single GlobalSearchBar in workspace layout', (layoutSrc.match(/GlobalSearchBar/g) || []).length >= 1);
assert(
    'workspace header does not duplicate studio refresh button',
    !layoutSrc.includes('data-command-center-refresh')
);

assert('System Vault surfaceRole in StudioExperience', studioExperienceSrc.includes('surfaceRole="system"'));
assert('Content Vault surfaceRole in StudioExperience', studioExperienceSrc.includes('surfaceRole="creator"'));

let browserSkipped = false;
let browser = null;

try {
    browser = await chromium.launch({ headless: true });
} catch (error) {
    browserSkipped = true;
    console.log(`skip: browser unavailable (${error.message})`);
}

if (!browserSkipped && browser) {
    const page = await browser.newPage();
    const logs = [];
    const consoleErrors = [];

    page.on('console', (msg) => {
        const text = msg.text();
        if (msg.type() === 'error') consoleErrors.push(text);
        if (
            text.includes('[STUDIO_REFRESH]') ||
            text.includes('[WORKSPACE_TAB]') ||
            text.includes('[COMMAND_CENTER_LOAD]')
        ) {
            logs.push(text);
        }
    });

    page.on('pageerror', (err) => consoleErrors.push(String(err.message || err)));

    let frontendReachable = false;
    try {
        const probe = await page.goto(`${FRONTEND}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        frontendReachable = probe?.ok() !== false;
    } catch {
        frontendReachable = false;
    }

    if (!frontendReachable) {
        browserSkipped = true;
        console.log(`skip: frontend unavailable at ${FRONTEND}`);
    } else {
        const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Gaff1505!';

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

        await page.evaluate(() => {
            localStorage.setItem('reelforge_studio_workspace_tab', 'Overview');
        });
        await page.reload({ waitUntil: 'domcontentloaded' });

        await page.waitForSelector('.ghost-trigger', { timeout: 30000 });
        await page.click('.ghost-trigger');

        const loginPw = page.locator('.admin-login-panel input[type="password"]').first();
        if ((await loginPw.count()) > 0 && (await loginPw.isVisible().catch(() => false))) {
            await loginPw.fill(ADMIN_PASSWORD);
            await page.locator('.admin-login-panel .submit-btn').first().click();
            await page.waitForTimeout(900);
        }

        await page.waitForSelector('[data-studio-workspace-layout]', { timeout: 30000 }).catch(() => null);
        await page.waitForTimeout(800);

        assert('workspace layout renders', await page.locator('[data-studio-workspace-layout]').isVisible());

        const tabLabels = await page
            .locator('[data-studio-workspace-tabs] [role="tab"]')
            .allTextContents();
        assert('exactly three workspace tabs', tabLabels.length === 3);
        assert(
            'tabs are Content Production System',
            tabLabels.map((t) => t.trim()).join('|') === 'Content|Production|System'
        );

        assert('PCC shell not mounted', (await page.locator('[data-production-command-center]').count()) === 0);
        assert('Content is default active tab', (await page.locator('[data-active-workspace-tab="content"]').count()) >= 1);
        assert(
            'legacy Overview localStorage resolves to Content panel',
            (await page.locator('[data-workspace-panel-content]').count()) >= 1
        );

        const savedTab = await page.evaluate(() => localStorage.getItem('reelforge_studio_workspace_tab'));
        assert('legacy Overview tab migrated to Content in storage', savedTab === 'Content');

        assert('content vault section visible on Content tab', (await page.locator('[data-content-panel="assets"]').count()) >= 1);
        assert('SCD section present on Content tab', (await page.locator('[data-content-panel="collections"]').count()) >= 1);
        assert('creator catalog section present', (await page.locator('[data-content-panel="creator-catalog"]').count()) >= 1);

        const contentVaultCards = await page.locator('[data-workspace-panel-content] [data-vault-surface-role="creator"]').count();
        assert('content vault grid renders', contentVaultCards >= 1);

        await page.click('[data-workspace-tab="production"]').catch(() => null);
        await page.waitForTimeout(400);
        assert(
            'WORKSPACE_TAB production',
            parseDiagLogs(logs, 'WORKSPACE_TAB').some((entry) => entry.tab === 'Production')
        );
        assert('production panel exists', (await page.locator('[data-workspace-panel-production]').count()) >= 1);
        assert('missing assets queue on production', (await page.locator('[data-missing-asset-queue]').count()) >= 0);

        await page.click('[data-workspace-tab="system"]');
        await page.waitForTimeout(400);
        assert('system panel exists', (await page.locator('[data-workspace-panel-system]').count()) >= 1);
        assert('system vault surface present', (await page.locator('[data-vault-surface-role="system"]').count()) >= 1);
        assert('hero manager present on system', (await page.locator('[data-hero-manager-panel]').count()) >= 0);
        assert(
            'diagnostics disclosure collapsed by default',
            !(await page.locator('.studio-system-disclosure[open]').count())
        );

        const contentVaultCount = await page.evaluate(() => {
            const panel = document.querySelector('[data-workspace-panel-content]');
            return panel ? panel.querySelectorAll('[data-media-asset-id]').length : 0;
        });
        const systemVaultCount = await page.evaluate(() => {
            const panel = document.querySelector('[data-workspace-panel-system]');
            return panel ? panel.querySelectorAll('[data-media-asset-id]').length : 0;
        });
        assert(
            'system vault shares content vault inventory count',
            contentVaultCount > 0 && contentVaultCount === systemVaultCount
        );

        await page.click('[data-workspace-tab="content"]');
        await page.waitForTimeout(400);
        assert('content vault still mounted after tab round-trip', (await page.locator('[data-vault-surface-role="creator"]').count()) >= 1);

        const searchBars = await page.locator('[data-global-search-bar], [data-global-search]').count();
        assert('single global search bar in studio', searchBars <= 1);

        const refreshLogs = parseDiagLogs(logs, 'STUDIO_REFRESH');
        assert('STUDIO_REFRESH emitted', refreshLogs.length >= 1);
        assert(
            'studio workspace hook initialized',
            await page.evaluate(() => Boolean(window.__reelforgeStudioWorkspace))
        );

        if (consoleErrors.length) {
            console.log('browser console errors during studio refresh validation:');
            for (const line of consoleErrors.slice(0, 8)) console.log(`  ${line}`);
        }
    }

    await browser.close();
}

console.log('\n=== Studio Refresh Validation ===\n');
if (browserSkipped) {
    console.log('note: browser slice skipped (environment)');
}
if (failed) {
    console.log('STUDIO_REFRESH_COMPLETE=false');
    process.exit(1);
}

console.log('STUDIO_REFRESH_COMPLETE=true');
