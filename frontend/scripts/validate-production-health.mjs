#!/usr/bin/env node
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';

let failed = false;

function assert(name, ok) {
    if (!ok) {
        failed = true;
        console.log(`FAIL: ${name}`);
    } else {
        console.log(`PASS: ${name}`);
    }
}

const enginePath = join(SRC, 'lib/series/productionHealth.js');
assert('productionHealth.js exists', existsSync(enginePath));

const engineSrc = readFileSync(enginePath, 'utf8');
assert('computeProductionReadiness exported', engineSrc.includes('export function computeProductionReadiness'));
assert('computeSeriesHealth exported', engineSrc.includes('export function computeSeriesHealth'));
assert('getMissingAssetQueue exported', engineSrc.includes('export function getMissingAssetQueue'));

const browser = await chromium.launch({
    headless: true,
    executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'
});

const page = await browser.newPage();

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_studio_workspace_tab', 'Overview');
});

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => document.querySelector('.ghost-trigger')?.click());
await page.waitForSelector('[data-workspace-metric-readiness], [data-command-metric-readiness]', {
    timeout: 15000
});
await page.waitForTimeout(800);

assert('readiness metric renders', (await page.locator('[data-workspace-metric-readiness], [data-command-metric-readiness]').count()) >= 1);

const unit = await page.evaluate(() => {
    const readiness = window.__reelforgeCommandCenter?.buildCommandCenterSnapshot?.('series-neon-vengeance', []);
    return {
        score: readiness?.readiness?.score,
        metadata: readiness?.readiness?.metadata,
        assets: readiness?.readiness?.assets,
        publishing: readiness?.readiness?.publishing
    };
});

assert('readiness score computed', typeof unit.score === 'number');
assert('readiness pillars present', typeof unit.metadata === 'number' && typeof unit.assets === 'number');

await browser.close();

console.log('\n=== Production Health Validation ===\n');
if (failed) {
    console.log('PRODUCTION_HEALTH_COMPLETE=false');
    process.exit(1);
}

console.log('PRODUCTION_HEALTH_COMPLETE=true');
