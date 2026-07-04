#!/usr/bin/env node
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';

const ENTERPRISE_ROLES = ['Owner', 'Executive', 'Producer', 'Manager', 'Creator', 'Viewer'];
const ENTERPRISE_HIERARCHY = ['Organization', 'Studios', 'Departments', 'Teams', 'Series', 'Creators'];

let failed = false;

function assert(name, ok) {
    if (!ok) {
        failed = true;
        console.log(`FAIL: ${name}`);
    } else {
        console.log(`PASS: ${name}`);
    }
}

function parseLogs(logs, tag) {
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

const enginePath = join(SRC, 'lib/enterprise/enterpriseManager.js');
const dashboardPath = join(SRC, 'components/enterprise/EnterpriseControlCenter.svelte');
const commandCenterPath = join(SRC, 'components/studio/ProductionCommandCenter.svelte');
const viewerContextPath = join(SRC, 'viewer/viewerContext.js');

assert('enterpriseManager.js exists', existsSync(enginePath));
assert('EnterpriseControlCenter.svelte exists', existsSync(dashboardPath));

const engineSrc = readFileSync(enginePath, 'utf8');
const dashboardSrc = readFileSync(dashboardPath, 'utf8');
const commandCenterSrc = readFileSync(commandCenterPath, 'utf8');
const viewerContextSrc = readFileSync(viewerContextPath, 'utf8');

assert('ENTERPRISE_STORAGE_KEY defined', engineSrc.includes("export const ENTERPRISE_STORAGE_KEY = 'reelforge_enterprise_structure'"));
assert('ENTERPRISE_ROLES defined', engineSrc.includes('export const ENTERPRISE_ROLES'));
assert('ENTERPRISE_HIERARCHY defined', engineSrc.includes('export const ENTERPRISE_HIERARCHY'));
assert('createOrganization exported', engineSrc.includes('export function createOrganization'));
assert('createStudio exported', engineSrc.includes('export function createStudio'));
assert('createDepartment exported', engineSrc.includes('export function createDepartment'));
assert('assignRole exported', engineSrc.includes('export function assignRole'));
assert('getOrganizationHealth exported', engineSrc.includes('export function getOrganizationHealth'));
assert('initEnterpriseManager exported', engineSrc.includes('export function initEnterpriseManager'));
assert('ENTERPRISE_CREATED diagnostics', engineSrc.includes("logEnterpriseDiag('ENTERPRISE_CREATED'"));
assert('ENTERPRISE_ROLE diagnostics', engineSrc.includes("logEnterpriseDiag('ENTERPRISE_ROLE'"));
assert('ENTERPRISE_HEALTH diagnostics', engineSrc.includes("logEnterpriseDiag('ENTERPRISE_HEALTH'"));
for (const role of ENTERPRISE_ROLES) {
    assert(`role ${role} supported`, engineSrc.includes(`'${role}'`));
}
for (const level of ENTERPRISE_HIERARCHY) {
    assert(`hierarchy ${level} supported`, engineSrc.includes(`'${level}'`));
}
assert('enterprise dashboard hook', dashboardSrc.includes('data-enterprise-control-center'));
assert('enterprise health score panel', dashboardSrc.includes('data-enterprise-health-score'));
assert('enterprise hierarchy panel', dashboardSrc.includes('data-enterprise-hierarchy'));
assert('enterprise roles panel', dashboardSrc.includes('data-enterprise-roles'));
assert('command center wires enterprise panel', commandCenterSrc.includes('EnterpriseControlCenter'));
assert('viewerContext initializes enterprise', viewerContextSrc.includes('initEnterpriseManager()'));

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
        text.includes('[ENTERPRISE_CREATED]') ||
        text.includes('[ENTERPRISE_ROLE]') ||
        text.includes('[ENTERPRISE_HEALTH]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.removeItem('reelforge_enterprise_structure');
    localStorage.setItem('admin_mode', 'true');
});

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => Boolean(window.__reelforgeEnterprise), null, { timeout: 15000 });

const bootstrap = await page.evaluate(() => {
    const api = window.__reelforgeEnterprise;
    const org = api.createOrganization({ name: 'Neon Vengeance Group', ownerUserId: 'user-owner-1' });
    const studio = api.createStudio(org.id, { name: 'Main Production Studio' });
    const department = api.createDepartment(org.id, studio.id, { name: 'Original Series' });
    const team = api.createTeam(org.id, studio.id, department.id, {
        name: 'Neon Team Alpha',
        seriesId: 'series-neon-vengeance',
        seriesTitle: 'Neon Vengeance',
        creator: { userId: 'creator-1', displayName: 'Lead Creator', role: 'Creator' }
    });
    api.assignRole({
        organizationId: org.id,
        userId: 'exec-1',
        displayName: 'Studio Executive',
        role: 'Executive',
        scopeType: 'studio',
        scopeId: studio.id
    });
    const health = api.getOrganizationHealth(org.id, []);
    return { org, studio, department, team, health };
});

assert('organization created', Boolean(bootstrap.org?.id));
assert('studio created', Boolean(bootstrap.studio?.id));
assert('department created', Boolean(bootstrap.department?.id));
assert('team created with series + creator', bootstrap.team?.series?.length >= 1 && bootstrap.team?.creators?.length >= 1);
assert('organization health computed', typeof bootstrap.health?.healthScore === 'number');
assert('health counts studios', bootstrap.health.counts.studios >= 1);
assert('health counts departments', bootstrap.health.counts.departments >= 1);
assert('health counts teams', bootstrap.health.counts.teams >= 1);
assert('health counts series', bootstrap.health.counts.series >= 1);
assert('health counts creators', bootstrap.health.counts.creators >= 1);

const createdLogs = parseLogs(logs, 'ENTERPRISE_CREATED');
const roleLogs = parseLogs(logs, 'ENTERPRISE_ROLE');
const healthLogs = parseLogs(logs, 'ENTERPRISE_HEALTH');
assert('ENTERPRISE_CREATED emitted', createdLogs.length >= 1);
assert('ENTERPRISE_ROLE emitted', roleLogs.length >= 1);
assert('ENTERPRISE_HEALTH emitted', healthLogs.length >= 1);

await page.click('.ghost-trigger');
await page.waitForSelector('.control-center-container', { timeout: 15000 });
await page.click('[data-workspace-tab="overview"], [data-command-section="overview"]');
await page.waitForSelector('[data-production-command-center]', { timeout: 15000 });
await page.click('[data-command-dashboard-section="enterprise"]');
await page.waitForSelector('[data-enterprise-control-center]', { timeout: 15000 });
assert('enterprise control center renders', await page.locator('[data-enterprise-control-center]').isVisible());
assert('enterprise health score visible', Boolean(await page.locator('[data-enterprise-health-score]').textContent()));
assert('enterprise hierarchy visible', await page.locator('[data-enterprise-hierarchy]').isVisible());
assert('enterprise roles visible', await page.locator('[data-enterprise-roles]').isVisible());

const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('reelforge_enterprise_structure') || '{}'));
assert('enterprise structure persisted', Array.isArray(persisted.organizations) && persisted.organizations.length >= 1);

await browser.close();

console.log('\n=== Enterprise Foundation Validation ===\n');
if (failed) {
    console.log('ENTERPRISE_FOUNDATION_COMPLETE=false');
    process.exit(1);
}

console.log('ENTERPRISE_FOUNDATION_COMPLETE=true');
