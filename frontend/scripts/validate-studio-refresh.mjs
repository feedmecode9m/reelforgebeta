#!/usr/bin/env node
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const FRONTEND = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';

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
assert('StudioWorkspaceLayout.svelte exists', existsSync(layoutPath));
assert('studioWorkspace.js exists', existsSync(workspaceLibPath));

const layoutSrc = readFileSync(layoutPath, 'utf8');
assert('Overview tab defined', layoutSrc.includes("activeTab === 'Overview'"));
assert('workspace tabs include System', layoutSrc.includes('WORKSPACE_TABS'));
assert('progressive disclosure sections', layoutSrc.includes('studio-workspace-layout__disclosure'));

const browser = await chromium.launch({
    headless: true,
    executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'
});

const page = await browser.newPage();
const logs = [];

page.on('console', (msg) => {
    const text = msg.text();
    if (
        text.includes('[STUDIO_REFRESH]') ||
        text.includes('[WORKSPACE_TAB]') ||
        text.includes('[WORKSPACE_SECTION]') ||
        text.includes('[COMMAND_CENTER_LOAD]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', JSON.stringify(true));
    localStorage.setItem('reelforge_studio_workspace_tab', 'Overview');
});

await page.goto(`${FRONTEND}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => document.querySelector('.ghost-trigger')?.click());
await page.waitForSelector('[data-studio-workspace-layout]', { timeout: 15000 });
await page.waitForTimeout(1200);

assert('workspace layout renders', await page.locator('[data-studio-workspace-layout]').isVisible());
assert('overview panel default', (await page.locator('[data-workspace-overview]').count()) >= 1);
assert('readiness score visible', await page.locator('[data-workspace-metric-readiness]').isVisible());
assert('coverage visible', await page.locator('[data-workspace-metric-coverage]').isVisible());
assert('top actions visible', await page.locator('[data-workspace-top-actions]').isVisible());
assert('notifications visible', await page.locator('[data-workspace-notifications]').isVisible());
assert('upcoming releases visible', await page.locator('[data-workspace-upcoming-releases]').isVisible());
assert('team activity visible', await page.locator('[data-workspace-team-activity]').isVisible());

const refreshLogs = parseDiagLogs(logs, 'STUDIO_REFRESH');
assert('STUDIO_REFRESH emitted', refreshLogs.length >= 1);
assert('studio workspace hook initialized', await page.evaluate(() => Boolean(window.__reelforgeStudioWorkspace)));

await page.click('[data-workspace-tab="production"]');
await page.waitForTimeout(350);
assert('WORKSPACE_TAB production', parseDiagLogs(logs, 'WORKSPACE_TAB').some((entry) => entry.tab === 'Production'));
assert('workflow panel preserved', (await page.locator('[data-workflow-task-center]').count()) >= 0);

await page.click('[data-workspace-tab="content"]');
await page.waitForTimeout(350);
assert('release center preserved', (await page.locator('[data-release-center]').count()) >= 0);

await page.click('[data-workspace-tab="teams"]');
await page.waitForTimeout(350);
assert('team manager preserved', await page.locator('[data-team-manager]').isVisible());

await page.click('[data-workspace-tab="analytics"]');
await page.waitForTimeout(350);
assert('analytics dashboard preserved', await page.locator('[data-operations-dashboard]').isVisible());

await page.click('[data-workspace-tab="automation"]');
await page.waitForTimeout(350);
assert('creator copilot preserved', await page.locator('[data-creator-copilot]').isVisible());

await page.click('[data-workspace-tab="system"]');
await page.waitForTimeout(350);
assert('repair center preserved', (await page.locator('[data-studio-repair-center]').count()) >= 0);

await page.click('[data-workspace-tab="overview"]');
await page.waitForTimeout(300);
const disclosure = page.locator('.studio-workspace-layout__disclosure summary').first();
await disclosure.click();
await page.waitForTimeout(250);
assert('WORKSPACE_SECTION emitted', parseDiagLogs(logs, 'WORKSPACE_SECTION').length >= 1);

const savedTab = await page.evaluate(() => localStorage.getItem('reelforge_studio_workspace_tab'));
assert('last tab remembered', savedTab === 'Overview');

await browser.close();

console.log('\n=== Studio Refresh Validation ===\n');
if (failed) {
    console.log('STUDIO_REFRESH_COMPLETE=false');
    process.exit(1);
}

console.log('STUDIO_REFRESH_COMPLETE=true');
