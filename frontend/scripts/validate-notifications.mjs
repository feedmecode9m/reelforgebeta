import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const FRONTEND = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';
const BACKEND = process.env.REELFORGE_BACKEND_URL || 'http://127.0.0.1:8080';

let failed = false;

function assert(name, ok) {
    if (!ok) {
        failed = true;
        console.log(`FAIL: ${name}`);
    } else {
        console.log(`PASS: ${name}`);
    }
}

try {
    execSync(`docker exec reelforge-db-1 psql -U user -d reelforge -c "TRUNCATE notifications;"`, {
        stdio: 'ignore'
    });
    console.log('PASS: notifications cleared');
} catch {
    console.log('WARN: could not truncate notifications');
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

async function apiJson(path, options = {}) {
    const res = await fetch(`${BACKEND}${path}`, options);
    const body = await res.json().catch(() => ({}));
    return { res, body };
}

const { res: statusRes, body: statusBody } = await apiJson('/api/notifications/status');
assert('notification API status reachable', statusRes.ok && statusBody.enabled === true);
assert('notification types exposed', Array.isArray(statusBody.types) && statusBody.types.length === 5);

const notificationId = `ntf-validation-${Date.now()}`;
const { res: createRes, body: created } = await apiJson('/api/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        id: notificationId,
        userId: 'user-owner-1',
        type: 'workflow_assigned',
        message: 'Validation workflow task assigned to Sam Ortiz.',
        payload: { taskId: 'wf-validation', seriesId: 'series-neon-vengeance' }
    })
});
assert('POST /api/notifications', createRes.status === 201 && created?.id === notificationId);

const { res: listRes, body: listed } = await apiJson(
    '/api/notifications?userId=user-owner-1'
);
assert('GET /api/notifications', listRes.ok && Array.isArray(listed) && listed.length >= 1);

const { res: readRes, body: readBody } = await apiJson(
    `/api/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: 'PUT' }
);
assert('PUT /api/notifications/:id/read', readRes.ok && readBody?.read === true);

const browser = await chromium.launch({
    headless: true,
    executablePath:
        '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'
});

const page = await browser.newPage();
const logs = [];

page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[NOTIFICATION_CREATED]') || text.includes('[NOTIFICATION_READ]')) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.removeItem('reelforge_notifications');
    localStorage.removeItem('reelforge_notification_triggers');
    localStorage.setItem('reelforge_current_team_user', 'user-owner-1');
    localStorage.removeItem('reelforge_workflow_tasks');
    localStorage.setItem(
        'reelforge_series_metadata',
        JSON.stringify({
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

await page.goto(`${FRONTEND}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('[data-notification-center]', { timeout: 15000 });

assert('notification center renders', await page.locator('[data-notification-center]').isVisible());
assert('notifications hook initialized', await page.evaluate(() => Boolean(window.__reelforgeNotifications)));

await page.evaluate(() => {
    window.__reelforgeNotifications.notifyWorkflowAssigned({
        taskId: 'wf-ui-1',
        taskTitle: 'Fix missing thumbnail',
        assigneeName: 'Sam Ortiz',
        seriesId: 'series-neon-vengeance'
    });
    window.__reelforgeNotifications.notifyEpisodePublished({
        episodeId: 'ep-neon-s01e01',
        episodeTitle: 'Ghost in the Grid',
        seriesId: 'series-neon-vengeance'
    });
    window.__reelforgeNotifications.notifyAssetMissing({
        seriesId: 'series-neon-vengeance',
        count: 2
    });
});
await page.waitForTimeout(600);

assert('NOTIFICATION_CREATED emitted', parseDiagLogs(logs, 'NOTIFICATION_CREATED').length >= 3);

await page.click('[data-notification-trigger]');
await page.waitForSelector('[data-notification-panel]', { timeout: 5000 });
const itemCount = await page.locator('[data-notification-item]').count();
assert('notification panel lists items', itemCount >= 3);

const markReadBtn = page.locator('[data-notification-mark-read]').first();
if ((await markReadBtn.count()) > 0) {
    await markReadBtn.click();
    await page.waitForTimeout(400);
}

assert('NOTIFICATION_READ emitted', parseDiagLogs(logs, 'NOTIFICATION_READ').length >= 1);

const cache = await page.evaluate(() => {
    const raw = localStorage.getItem('reelforge_notifications');
    return raw ? JSON.parse(raw) : null;
});
assert('notification local cache written', Array.isArray(cache?.items) && cache.items.length >= 3);

const { body: dbListed } = await apiJson('/api/notifications?userId=user-owner-1');
assert('notifications persisted in PostgreSQL', Array.isArray(dbListed) && dbListed.length >= 3);

await page.click('.ghost-trigger');
await page.waitForSelector('[data-production-operations-dashboard]', { timeout: 15000 });
await page.waitForTimeout(1200);

await browser.close();

console.log('\n=== Notifications Validation ===\n');
if (failed) {
    console.log('NOTIFICATIONS_COMPLETE=false');
    process.exit(1);
}

console.log('NOTIFICATIONS_COMPLETE=true');
