import { chromium } from 'playwright';

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
    if (text.includes('[STUDIO_ACTION_ENGINE]')) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
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
await page.waitForSelector('[data-studio-action-coach]', { timeout: 15000 });
await page.waitForTimeout(600);

const engineLog = parseLogs('STUDIO_ACTION_ENGINE').pop();
assert('STUDIO_ACTION_ENGINE emitted', Boolean(engineLog));
assert('recommendations generated', Boolean(engineLog?.recommendations?.length >= 1));

const recommendations = engineLog?.recommendations || [];
const priorities = recommendations.map((r) => r.priority);
const priorityOrdered =
    priorities.length <= 1 ||
    priorities.every((priority, index) => index === 0 || priority >= priorities[index - 1]);
assert('priority ordering correct', priorityOrdered);

const impactTotal = recommendations.reduce((sum, r) => sum + (r.impact || 0), 0);
const topAndQuickImpact =
    (recommendations[0]?.impact || 0) +
    (recommendations[1]?.impact || 0) +
    recommendations.slice(2, 4).reduce((sum, r) => sum + (r.impact || 0), 0);
assert('impact totals calculated', impactTotal > 0 && topAndQuickImpact > 0);

assert(
    'projected readiness > current readiness',
    typeof engineLog?.readinessBefore === 'number' &&
        typeof engineLog?.readinessAfter === 'number' &&
        engineLog.readinessAfter > engineLog.readinessBefore
);

const coachVisible = await page.locator('[data-studio-action-coach]').isVisible();
const priorityVisible = await page.locator('[data-action-coach-priority]').isVisible();
const projectedVisible = await page.locator('[data-action-coach-projected]').isVisible();
assert('action coach renders', coachVisible);
assert('top priority renders', priorityVisible);
assert('projected readiness renders', projectedVisible);

console.log('\n=== Studio Action Engine Validation ===\n');
for (const c of checks) {
    console.log(`${c.ok ? '✓' : '✗'} ${c.name}`);
}

if (!failed) {
    console.log('\nSTUDIO_ACTION_ENGINE_COMPLETE = true');
} else {
    console.log('\nSTUDIO_ACTION_ENGINE_COMPLETE = false');
}

await browser.close();
process.exit(failed ? 1 : 0);
