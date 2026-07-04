import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mergeSyncPayloads } from '../src/lib/sync/syncMerge.js';

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
    execSync(
        `docker exec reelforge-db-1 psql -U user -d reelforge -c "DELETE FROM studio_sync_state;"`,
        { stdio: 'ignore' }
    );
    console.log('PASS: studio_sync_state cleared');
} catch {
    console.log('WARN: could not clear studio_sync_state');
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

// --- Conflict resolution unit test ---
const merged = mergeSyncPayloads(
    {
        seriesMetadata: {
            entries: {
                'reel-a': { reelId: 'reel-a', episodeTitle: 'Device A Newer', updatedAt: 5000 }
            },
            updatedAt: 5000
        }
    },
    {
        seriesMetadata: {
            entries: {
                'reel-a': { reelId: 'reel-a', episodeTitle: 'Device B Older', updatedAt: 2000 }
            },
            updatedAt: 2000
        }
    }
);
assert(
    'conflict resolution keeps latest modified',
    merged.seriesMetadata.entries['reel-a'].episodeTitle === 'Device A Newer'
);
assert('conflict metadata captured', Array.isArray(merged.__conflicts) && merged.__conflicts.length >= 1);

async function apiJson(path, options = {}) {
    const res = await fetch(`${BACKEND}${path}`, options);
    const body = await res.json().catch(() => ({}));
    return { res, body };
}

const { res: statusRes, body: statusBody } = await apiJson('/api/sync/status');
assert('sync API status reachable', statusRes.ok && statusBody.enabled === true);
assert(
    'sync domains include workflow and publishing',
    statusBody.domains?.includes('workflowTasks') && statusBody.domains?.includes('publishingState')
);

const browser = await chromium.launch({
    headless: true,
    executablePath:
        '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'
});

const deviceA = await browser.newContext();
const deviceB = await browser.newContext();
const pageA = await deviceA.newPage();
const pageB = await deviceB.newPage();

const logsA = [];
const logsB = [];
pageA.on('console', (msg) => {
    const text = msg.text();
    if (
        text.includes('[SYNC_PULL]') ||
        text.includes('[SYNC_PUSH]') ||
        text.includes('[SYNC_CONFLICT]') ||
        text.includes('[SYNC_RESOLVED]')
    ) {
        logsA.push(text);
    }
});
pageB.on('console', (msg) => {
    const text = msg.text();
    if (
        text.includes('[SYNC_PULL]') ||
        text.includes('[SYNC_PUSH]') ||
        text.includes('[SYNC_CONFLICT]') ||
        text.includes('[SYNC_RESOLVED]')
    ) {
        logsB.push(text);
    }
});

await pageA.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.removeItem('reelforge_sync_device_id');
});

await pageA.goto(`${FRONTEND}/`, { waitUntil: 'networkidle' });
await pageA.waitForFunction(() => window.__reelforgeSync?.performSync, null, { timeout: 15000 });

const deviceAId = await pageA.evaluate(() => {
    localStorage.setItem(
        'reelforge_series_metadata',
        JSON.stringify({
            'reel-sync-device-a': {
                reelId: 'reel-sync-device-a',
                episodeId: 'ep-sync-a',
                seriesId: 'series-sync-test',
                seriesName: 'Sync Test Series',
                episodeTitle: 'Device A Episode',
                seasonNumber: 1,
                episodeNumber: 1,
                episodeStatus: 'published',
                updatedAt: Date.now()
            }
        })
    );
    localStorage.setItem(
        'reelforge_release_schedule',
        JSON.stringify({
            'ep-sync-a': {
                episodeId: 'ep-sync-a',
                seriesId: 'series-sync-test',
                releaseAt: Date.now() + 86400000,
                releaseTime: '09:00',
                status: 'scheduled',
                updatedAt: Date.now()
            }
        })
    );
    localStorage.setItem(
        'reelforge_workflow_tasks',
        JSON.stringify({
            version: 1,
            tasks: [
                {
                    id: 'task-sync-a',
                    seriesId: 'series-sync-test',
                    episodeId: 'ep-sync-a',
                    taskType: 'MISSING_RELEASE_DATE',
                    priority: 2,
                    estimatedImpact: 5,
                    status: 'PENDING',
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                }
            ]
        })
    );
    localStorage.setItem('reelforge_publishing_profile', 'reelshort');
    localStorage.setItem('reelforge_publishing_profile_updated_at', String(Date.now()));
    return window.__reelforgeSync.performSync();
});

await pageA.waitForTimeout(1500);

const pullA = parseDiagLogs(logsA, 'SYNC_PULL');
const pushA = parseDiagLogs(logsA, 'SYNC_PUSH');
assert('device A SYNC_PULL emitted', pullA.length >= 1);
assert('device A SYNC_PUSH emitted', pushA.length >= 1 || deviceAId?.ok === true);

await pageB.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.removeItem('reelforge_sync_device_id');
});

await pageB.goto(`${FRONTEND}/`, { waitUntil: 'networkidle' });
await pageB.waitForFunction(() => window.__reelforgeSync?.performSync, null, { timeout: 15000 });
await pageB.evaluate(() => window.__reelforgeSync.performSync());
await pageB.waitForTimeout(2000);

const received = await pageB.evaluate(() => {
    const metadata = JSON.parse(localStorage.getItem('reelforge_series_metadata') || '{}');
    const schedule = JSON.parse(localStorage.getItem('reelforge_release_schedule') || '{}');
    const workflow = JSON.parse(localStorage.getItem('reelforge_workflow_tasks') || '{"tasks":[]}');
    const publishing = localStorage.getItem('reelforge_publishing_profile');
    return {
        title: metadata['reel-sync-device-a']?.episodeTitle || null,
        scheduled: schedule['ep-sync-a']?.status || null,
        workflowTask: workflow.tasks?.[0]?.id || null,
        publishing
    };
});

assert('device B receives series metadata update', received.title === 'Device A Episode');
assert('device B receives release schedule update', received.scheduled === 'scheduled');
assert('device B receives workflow tasks update', received.workflowTask === 'task-sync-a');
assert('device B receives publishing state update', received.publishing === 'reelshort');

// --- Conflict via API then device sync ---
await apiJson('/api/sync/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        device_id: 'conflict-seed',
        domains: {
            seriesMetadata: {
                entries: {
                    'reel-conflict': {
                        reelId: 'reel-conflict',
                        episodeTitle: 'Stale Remote',
                        updatedAt: 1000
                    }
                },
                updatedAt: 1000
            }
        }
    })
});

await pageA.evaluate(() => {
    const map = JSON.parse(localStorage.getItem('reelforge_series_metadata') || '{}');
    map['reel-conflict'] = {
        reelId: 'reel-conflict',
        episodeTitle: 'Fresh Local',
        updatedAt: 9000
    };
    localStorage.setItem('reelforge_series_metadata', JSON.stringify(map));
    return window.__reelforgeSync.performSync();
});
await pageA.waitForTimeout(2000);

const { body: remoteAfterConflict } = await apiJson('/api/sync/state');
const winner =
    remoteAfterConflict?.payload?.seriesMetadata?.entries?.['reel-conflict']?.episodeTitle;
assert('conflict resolution on push keeps freshest entry', winner === 'Fresh Local');

const resolvedA = parseDiagLogs(logsA, 'SYNC_RESOLVED');
const conflictA = parseDiagLogs(logsA, 'SYNC_CONFLICT');
assert('SYNC_CONFLICT emitted', conflictA.length >= 1);
assert('SYNC_RESOLVED emitted', resolvedA.length >= 1);

const pullB = parseDiagLogs(logsB, 'SYNC_PULL');
assert('device B SYNC_PULL emitted', pullB.length >= 1);

await browser.close();

console.log('\n=== Cross Device Sync Validation ===\n');
if (failed) {
    console.log('CROSS_DEVICE_SYNC_COMPLETE=false');
    process.exit(1);
}

console.log('CROSS_DEVICE_SYNC_COMPLETE=true');
