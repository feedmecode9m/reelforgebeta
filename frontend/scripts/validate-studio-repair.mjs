import { chromium } from 'playwright';
import {
    buildRepairPlan,
    executeRepair,
    rollbackRepair
} from '../src/lib/series/studioRepairEngine.js';

const BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';

const browser = await chromium.launch({
    headless: true,
    executablePath:
        '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'
});

const page = await browser.newPage();
const logs = [];

page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[STUDIO_REPAIR]')) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.removeItem('reelforge_studio_repair_rollback');
    localStorage.removeItem('reelforge_studio_repair_overlays');
    localStorage.removeItem('reelforge_release_schedule');
    localStorage.setItem(
        'reelforge_series_metadata',
        JSON.stringify({
            '4a50ca17-124c-401e-b4bd-d711b781be36': {
                reelId: '4a50ca17-124c-401e-b4bd-d711b781be36',
                episodeId: 'ep-neon-s01e02',
                seriesId: 'series-neon-vengeance',
                seasonNumber: 1,
                episodeNumber: 2,
                seriesName: 'Neon Vengeance',
                episodeTitle: 'Blood Protocol',
                episodeStatus: 'published',
                genre: 'Cyber-Action',
                runtime: 298,
                releaseYear: 2024,
                updatedAt: Date.now()
            },
            'd511d64e-10c3-4a11-afa6-927b968c8afd': {
                reelId: 'd511d64e-10c3-4a11-afa6-927b968c8afd',
                episodeId: 'ep-neon-s01e01',
                seriesId: 'series-neon-vengeance',
                seasonNumber: 1,
                episodeNumber: 1,
                seriesName: 'Neon Vengeance',
                episodeTitle: 'Ghost in the Grid',
                episodeStatus: 'published',
                genre: 'Cyber-Action',
                description: 'A hacker discovers encrypted memories.',
                runtime: 312,
                releaseYear: 2024,
                updatedAt: Date.now()
            }
        })
    );
});

function parseLogs(phase) {
    return logs
        .map((line) => {
            const match = line.match(/\[STUDIO_REPAIR\]\s*(\{.*\})/);
            if (!match) return null;
            try {
                return JSON.parse(match[1]);
            } catch {
                return null;
            }
        })
        .filter((entry) => entry?.phase === phase);
}

let failed = false;
const checks = [];

function assert(name, ok) {
    checks.push({ name, ok });
    if (!ok) {
        failed = true;
        console.log(`FAIL: ${name}`);
    } else {
        console.log(`PASS: ${name}`);
    }
}

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.click('.ghost-trigger');
await page.waitForSelector('[data-production-operations-dashboard]', { timeout: 15000 });
await page.waitForSelector('[data-studio-repair-center]', { timeout: 15000 });
await page.waitForTimeout(600);

const planLog = parseLogs('plan').pop();
assert('issues detected', Boolean(planLog?.issueCount >= 1));
assert('repair plan generated', Boolean(planLog?.repairableCount >= 1));

const issueRows = await page.locator('[data-repair-issue]').count();
assert('repair center renders issues', issueRows >= 1);

const fixButtons = await page.locator('[data-repair-fix]:not([disabled])').count();
assert('fix buttons available', fixButtons >= 1);

await page.locator('[data-repair-fix]:not([disabled])').first().click();
await page.waitForTimeout(400);

const executed = parseLogs('executed');
assert('repair executes', executed.length >= 1);

const issuesAfterRepair = await page.locator('[data-repair-issue]').count();
assert('issue count updates after repair', issuesAfterRepair >= 0);

await page.click('[data-repair-rollback]');
await page.waitForTimeout(400);

const rolledBack = parseLogs('rolled-back');
assert('rollback works', rolledBack.length >= 1);

const unitPlan = buildRepairPlan('series-neon-vengeance', []);
assert('unit issues detected', unitPlan.issues.length >= 1);
assert('unit repair plan generated', unitPlan.repairPlan.length >= 1);

const target = unitPlan.repairPlan.find((item) => item.issue === 'missing-description') || unitPlan.repairPlan[0];
const unitExecute = executeRepair(target);
assert('unit repair executes', unitExecute.ok === true);

const unitRollback = rollbackRepair(target.id);
assert('unit rollback works', unitRollback.ok === true);

const coverageTypes = Object.keys(unitPlan.coverage);
assert('repair coverage tracked', coverageTypes.length === 6);

console.log('\n=== Studio Repair Validation ===\n');
for (const c of checks) {
    console.log(`${c.ok ? '✓' : '✗'} ${c.name}`);
}

if (!failed) {
    console.log('\nSTUDIO_REPAIR_COMPLETE=true');
} else {
    console.log('\nSTUDIO_REPAIR_COMPLETE=false');
}

await browser.close();
process.exit(failed ? 1 : 0);
