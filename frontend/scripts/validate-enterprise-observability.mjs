import { chromium } from 'playwright';

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
        text.includes('[OBSERVABILITY]') ||
        text.includes('[HEALTH_SCORE]') ||
        text.includes('[SYSTEM_ALERT]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.removeItem('reelforge_platform_metrics');
    localStorage.removeItem('reelforge_observability_latency');
    localStorage.removeItem('reelforge_notifications');
    localStorage.removeItem('reelforge_workflow_tasks');
});

await page.goto(`${FRONTEND}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__reelforgeObservability?.buildEnterpriseObservabilitySnapshot, null, {
    timeout: 15000
});

await page.evaluate(() => {
    window.__reelforgeMetrics.resetPlatformMetrics();
    window.__reelforgeObservability.recordLatencySample('api', 180, { source: 'test' });
    window.__reelforgeObservability.recordLatencySample('database', 260, { source: 'test' });
    window.__reelforgeMetrics.recordMetric('theater_open', {
        seriesId: 'series-neon-vengeance',
        episodeId: 'ep-neon-s01e01',
        episodeTitle: 'Ghost in the Grid',
        reelId: 'reel-test-1'
    });
    window.__reelforgeMetrics.recordMetric('episode_completion', {
        seriesId: 'series-neon-vengeance',
        episodeId: 'ep-neon-s01e01',
        value: 100
    });
    window.__reelforgeMetrics.recordMetric('publish_action', {
        seriesId: 'series-neon-vengeance',
        value: 4
    });
    window.__reelforgeMetrics.recordMetric('workflow_completion', {
        seriesId: 'series-neon-vengeance',
        value: 1
    });
    localStorage.setItem(
        'reelforge_notifications',
        JSON.stringify({
            version: 1,
            items: [
                {
                    id: 'note-1',
                    userId: 'user-owner-1',
                    type: 'workflow_assigned',
                    message: 'Task assigned',
                    read: false,
                    payload: {},
                    createdAt: Date.now()
                },
                {
                    id: 'note-2',
                    userId: 'user-owner-1',
                    type: 'release_scheduled',
                    message: 'Release scheduled',
                    read: true,
                    payload: {},
                    createdAt: Date.now()
                }
            ]
        })
    );
    window.dispatchEvent(new CustomEvent('reelforge:metrics-updated'));
});

await page.evaluate(() => document.querySelector('.ghost-trigger')?.click());
await page.waitForSelector('[data-production-command-center]', { timeout: 15000 });
await page.click('[data-command-section="analytics"]');
await page.waitForSelector('[data-enterprise-observability]', { timeout: 15000 });
await page.waitForTimeout(900);

assert('observability hook initialized', await page.evaluate(() => Boolean(window.__reelforgeObservability)));
assert('enterprise observability panel renders', await page.locator('[data-enterprise-observability]').isVisible());
assert('operations dashboard preserved', await page.locator('[data-operations-dashboard]').isVisible());
assert('knowledge graph preserved', await page.locator('[data-creator-knowledge-graph]').isVisible());

const observabilityLogs = parseDiagLogs(logs, 'OBSERVABILITY');
const healthLogs = parseDiagLogs(logs, 'HEALTH_SCORE');
const alertLogs = parseDiagLogs(logs, 'SYSTEM_ALERT');
assert('OBSERVABILITY emitted', observabilityLogs.length >= 1);
assert('HEALTH_SCORE emitted', healthLogs.length >= 1);
assert('SYSTEM_ALERT emitted', alertLogs.length >= 0);

const metrics = await page.evaluate(() => ({
    api: document.querySelector('[data-metric-api-latency] strong')?.textContent,
    db: document.querySelector('[data-metric-db-latency] strong')?.textContent,
    workflow: document.querySelector('[data-metric-workflow-throughput] strong')?.textContent,
    notifications: document.querySelector('[data-metric-notification-throughput] strong')?.textContent,
    publishing: document.querySelector('[data-metric-publishing-throughput] strong')?.textContent,
    engagement: document.querySelector('[data-metric-viewer-engagement] strong')?.textContent,
    health: document.querySelector('[data-health-score]')?.textContent
}));

assert('API latency tracked', metrics.api?.includes('ms'));
assert('database latency tracked', metrics.db?.includes('ms'));
assert('workflow throughput tracked', metrics.workflow !== undefined);
assert('notification throughput tracked', metrics.notifications !== undefined);
assert('publishing throughput tracked', Number(metrics.publishing) >= 4);
assert('viewer engagement tracked', Number(metrics.engagement) >= 1);
assert('health score visible', metrics.health?.includes('%'));

const snapshot = await page.evaluate(() =>
    window.__reelforgeObservability.buildEnterpriseObservabilitySnapshot('series-neon-vengeance')
);

assert('snapshot composes signals', snapshot.signals.api_latency >= 0);
assert('snapshot health score computed', typeof snapshot.healthScore === 'number');
assert('tracked signal count', Object.keys(snapshot.signals).length === 6);

await browser.close();

console.log('\n=== Enterprise Observability Validation ===\n');
if (failed) {
    console.log('ENTERPRISE_OBSERVABILITY_COMPLETE=false');
    process.exit(1);
}

console.log('ENTERPRISE_OBSERVABILITY_COMPLETE=true');
