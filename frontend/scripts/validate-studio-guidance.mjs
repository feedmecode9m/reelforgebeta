import { chromium } from 'playwright';

const BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';
const WALKTHROUGH_KEY = 'reelforge_studio_walkthrough_complete';

const browser = await chromium.launch({
    headless: true,
    executablePath:
        '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'
});

const page = await browser.newPage();
const logs = [];

page.on('console', (msg) => {
    const text = msg.text();
    if (
        text.includes('[STUDIO_HELP]') ||
        text.includes('[STUDIO_WARNING]') ||
        text.includes('[STUDIO_COACH]') ||
        text.includes('[STUDIO_ACTION_ENGINE]') ||
        text.includes('[STUDIO_WALKTHROUGH]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.removeItem('reelforge_studio_walkthrough_complete');
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
                description: 'Old allies resurface.',
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

function parseLogs(tag) {
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
await page.waitForTimeout(600);

const registryLog = parseLogs('STUDIO_HELP').find((e) => e.phase === 'registry_loaded');
assert('help registry loaded', Boolean(registryLog?.panels?.length >= 8));

const helpTrigger = page.locator('[data-smart-help] .smart-help__trigger').first();
await helpTrigger.click();
await page.waitForSelector('[data-smart-help-panel]', { timeout: 5000 });
const helpPanelVisible = await page.locator('[data-smart-help-panel]').isVisible();
assert('tooltips open', helpPanelVisible);

const helpOpenLog = parseLogs('STUDIO_HELP').some((e) => e.source === 'tap' || e.source === 'hover');
assert('STUDIO_HELP emitted on tooltip open', helpOpenLog);

const warningCount = await page.locator('[data-studio-warning-item]').count();
const warningLog = parseLogs('STUDIO_WARNING').pop();
assert('warnings render', warningCount > 0);
assert('STUDIO_WARNING emitted', Boolean(warningLog?.count >= 1));

const coachCount = await page.locator('[data-coach-action]').count();
const actionEngineLog = parseLogs('STUDIO_ACTION_ENGINE').pop();
assert('coach recommendations render', coachCount > 0);
assert('STUDIO_ACTION_ENGINE emitted', Boolean(actionEngineLog?.recommendations?.length >= 1));

await page.click('[data-studio-guide-me]');
await page.waitForSelector('[data-studio-walkthrough-overlay]', { timeout: 5000 });
const walkStart = parseLogs('STUDIO_WALKTHROUGH').some((e) => e.phase === 'start');
assert('walkthrough starts', walkStart);

const nextBtn = page.locator('.studio-walkthrough__next');
for (let i = 0; i < 5; i++) {
    await nextBtn.scrollIntoViewIfNeeded();
    await nextBtn.click({ force: true });
    await page.waitForTimeout(350);
}

const walkComplete = parseLogs('STUDIO_WALKTHROUGH').some((e) => e.phase === 'complete');
const stored = await page.evaluate((key) => localStorage.getItem(key), WALKTHROUGH_KEY);
assert('walkthrough completes', walkComplete);
assert('localStorage persistence works', stored === 'true');

const overlayGone = (await page.locator('[data-studio-walkthrough-overlay]').count()) === 0;
assert('walkthrough overlay closes', overlayGone);

console.log('\n=== Studio Guidance Validation ===\n');
for (const c of checks) {
    console.log(`${c.ok ? '✓' : '✗'} ${c.name}`);
}

if (!failed) {
    console.log('\nSTUDIO_GUIDANCE_COMPLETE = true');
} else {
    console.log('\nSTUDIO_GUIDANCE_COMPLETE = false');
}

await browser.close();
process.exit(failed ? 1 : 0);
