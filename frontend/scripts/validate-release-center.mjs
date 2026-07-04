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
    if (
        text.includes('[RELEASE_CENTER]') ||
        text.includes('[RELEASE_CREATED]') ||
        text.includes('[RELEASE_UPDATED]') ||
        text.includes('[RELEASE_PUBLISHED]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
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

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.click('.ghost-trigger');
await page.waitForSelector('[data-production-operations-dashboard]', { timeout: 20000 });
await page.click('[data-workspace-tab="content"], [data-command-section="content"]');
await page.waitForTimeout(400);
await page.waitForSelector('[data-release-center]', { timeout: 15000 });
await page.waitForTimeout(600);

assert('release hook initialized', await page.evaluate(() => Boolean(window.__reelforgeRelease)));

const premiereVisible = await page.locator('[data-premiere-countdown]').count();
assert('premiere countdown renders', premiereVisible >= 1);

const calendarRows = await page.locator('[data-release-calendar-row]').count();
assert('calendar renders', calendarRows >= 1);

const readinessBefore = Number(
    (await page.locator('[data-launch-readiness-score]').innerText()).replace('%', '').trim()
);
assert('readiness score renders', Number.isFinite(readinessBefore));

await page.selectOption('[data-release-cadence]', 'weekly');
await page.selectOption('[data-release-day]', '5');
await page.fill('[data-release-time]', '19:00');
const futureDate = new Date();
futureDate.setDate(futureDate.getDate() + 14);
const futureDateStr = futureDate.toISOString().slice(0, 10);
await page.fill('[data-release-start-date]', futureDateStr);
await page.click('[data-release-apply-schedule]');
await page.waitForTimeout(500);

const createdLogs = parseLogs('RELEASE_CREATED');
const scheduleUpdatedLogs = parseLogs('RELEASE_UPDATED');
const centerLogs = parseLogs('RELEASE_CENTER');
const afterLog = centerLogs.pop();

const readinessAfter = Number(
    (await page.locator('[data-launch-readiness-score]').innerText()).replace('%', '').trim()
);
const scheduledRows = await page.locator('[data-release-status="scheduled"]').count();
const scheduledStat = Number(await page.locator('[data-release-stat-scheduled] .release-center__stat-value').innerText());

assert('RELEASE_CREATED or RELEASE_UPDATED emitted', createdLogs.length >= 1 || scheduleUpdatedLogs.length >= 1);
assert('RELEASE_CENTER emitted', Boolean(afterLog));
assert('scheduling works', scheduledRows >= 1);
assert('readiness score updates', readinessAfter >= readinessBefore);
assert('scheduled stat updates', scheduledStat >= 1);

const daysUntilLaunch = await page.locator('[data-release-stat-days] .release-center__stat-value').innerText();
assert('days until launch metric renders', daysUntilLaunch !== '—' && Number(daysUntilLaunch) >= 0);

const premiereDays = await page.locator('[data-premiere-days]').innerText();
assert('premiere countdown updates', premiereDays !== '—');

const unitResult = await page.evaluate(
    ({ seriesId, futureDateStr }) => {
        const release = window.__reelforgeRelease;
        const before = release.buildReleaseCenterSnapshot(seriesId, []);
        const result = release.applyBulkReleaseSchedule(seriesId, [], {
            cadence: 'weekly',
            startDate: futureDateStr,
            releaseTime: '19:00',
            dayOfWeek: 5
        });
        const health = release.computeReleaseHealth(result.calendar);
        const readiness = release.computeLaunchReadiness(result.calendar);
        return {
            beforeScore: before.launchReadiness.launchReadinessScore,
            applied: result.applied,
            readiness,
            health
        };
    },
    { seriesId: 'series-neon-vengeance', futureDateStr }
);

const metricsMatch =
    unitResult.readiness.scheduledEpisodes === unitResult.health.episodesScheduled &&
    unitResult.readiness.readyEpisodes === unitResult.health.episodesReady &&
    unitResult.readiness.missingEpisodes === unitResult.health.episodesMissingAssets;
assert('launch metrics accurate', metricsMatch);
assert('unit bulk schedule applied', unitResult.applied >= 1);
assert(
    'unit readiness computed',
    unitResult.readiness.launchReadinessScore >= unitResult.beforeScore
);

const updateResult = await page.evaluate(
    ({ seriesId, futureDateStr }) => {
        const release = window.__reelforgeRelease;
        release.scheduleEpisodeRelease(seriesId, 'ep-neon-s01e02', futureDateStr, '20:00');
        return release.loadReleaseScheduleMap()['ep-neon-s01e02'];
    },
    { seriesId: 'series-neon-vengeance', futureDateStr }
);
const updatedLogs = parseLogs('RELEASE_UPDATED');
assert('single episode schedule works', Boolean(updateResult));
assert('RELEASE_UPDATED emitted', updatedLogs.length >= 1);

const engineScheduled = afterLog?.launchReadiness?.scheduledEpisodes ?? 0;
assert('diagnostic readiness matches UI', engineScheduled === scheduledStat);

console.log('\n=== Release Center Validation ===\n');
for (const c of checks) {
    console.log(`${c.ok ? '✓' : '✗'} ${c.name}`);
}

if (!failed) {
    console.log('\nRELEASE_CENTER_COMPLETE=true');
} else {
    console.log('\nRELEASE_CENTER_COMPLETE=false');
}

await browser.close();
process.exit(failed ? 1 : 0);
