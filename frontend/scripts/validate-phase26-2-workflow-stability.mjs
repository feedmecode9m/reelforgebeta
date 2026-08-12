#!/usr/bin/env node
/**
 * Phase 26.2 — Command Center workflow auth / retry stabilization validator.
 *
 * Verifies surgical containment of the Phase 26.1 unauthorized workflow mutation storm
 * without touching Media Vault / Hero / Theater / backend frozen boundaries.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

let failed = 0;
/** @param {boolean} cond @param {string} label */
function assert(cond, label) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}`);
}

function read(rel) {
    return readFileSync(join(root, rel), 'utf8');
}

function sha(rel) {
    return createHash('sha256').update(read(rel)).digest('hex');
}

async function sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

function installMemoryStorage() {
    /** @type {Map<string, string>} */
    const map = new Map();
    const storage = {
        getItem(key) {
            return map.has(key) ? map.get(key) : null;
        },
        setItem(key, value) {
            map.set(String(key), String(value));
        },
        removeItem(key) {
            map.delete(String(key));
        },
        clear() {
            map.clear();
        }
    };
    globalThis.window = /** @type {any} */ ({
        localStorage: storage,
        dispatchEvent() {
            return true;
        },
        addEventListener() {},
        removeEventListener() {},
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
        setInterval: globalThis.setInterval.bind(globalThis),
        clearInterval: globalThis.clearInterval.bind(globalThis)
    });
    globalThis.localStorage = storage;
    return storage;
}

async function main() {
    console.log('\n[phase26-2-workflow-stability — static contracts]');

    const workflowApi = read('src/lib/api/workflowApi.js');
    const workflowEngine = read('src/lib/workflow/workflowEngine.js');
    const notificationCenter = read('src/lib/notifications/notificationCenter.js');
    const refreshCoord = read('src/lib/command/commandCenterRefresh.js');
    const workspace = read('src/components/studio/StudioWorkspaceLayout.svelte');
    const pcc = read('src/components/studio/ProductionCommandCenter.svelte');

    assert(
        /getAdminAuthHeaders/.test(workflowApi) && /Authorization/.test(workflowApi),
        'A: workflowApi attaches admin Authorization helper on mutations'
    );
    assert(
        /retries:\s*isWrite\s*\?\s*0/.test(workflowApi),
        'A: workflow mutations disable fetchWithRetry retries'
    );
    assert(
        /export function canAttemptWorkflowWrites/.test(workflowApi) &&
            /getAdminToken\(\)/.test(workflowApi),
        'D: canAttemptWorkflowWrites is token-based (not GET status)'
    );
    const pushSlice = workflowEngine.slice(
        workflowEngine.indexOf('async function pushStoreToApi'),
        workflowEngine.indexOf('async function hydrateWorkflowTasksFromApi')
    );
    assert(
        /canAttemptWorkflowWrites\(\)/.test(pushSlice) && !/isWorkflowApiAvailable\(\)/.test(pushSlice),
        'D: pushStoreToApi does not call isWorkflowApiAvailable / GET status'
    );
    assert(
        /isWorkflowWriteCircuitOpen/.test(workflowEngine) &&
            /openWorkflowWriteCircuit/.test(workflowEngine) &&
            /write-circuit-open/.test(workflowEngine),
        'B: workflowEngine has session write circuit breaker'
    );
    assert(
        /scheduleHydrateNotifications/.test(notificationCenter) &&
            /NOTIFICATION_HYDRATE_DEBOUNCE_MS/.test(notificationCenter) &&
            /workflow-tasks-updated[\s\S]{0,160}scheduleHydrateNotifications/.test(notificationCenter),
        'E: workflow-tasks-updated uses debounced hydrateNotifications'
    );
    assert(
        /scheduleCommandCenterRefresh/.test(workspace) &&
            /embeddedInCommandCenter/.test(workspace) &&
            /startCommandCenterRefreshInterval\('studio-workspace'\)/.test(workspace),
        'G: StudioWorkspaceLayout uses shared refresh; interval only when not embedded'
    );
    assert(
        /startCommandCenterRefreshInterval\('production-command-center'\)/.test(pcc) &&
            /scheduleCommandCenterRefresh/.test(pcc) &&
            /registerCommandCenterRefreshListener/.test(pcc),
        'G: ProductionCommandCenter owns shared interval + debounced schedule'
    );
    assert(
        /COMMAND_CENTER_REFRESH_DEBOUNCE_MS/.test(refreshCoord),
        'G: shared refresh coordinator module present'
    );

    console.log('\n[phase26-2-workflow-stability — runtime circuit / debounce]');
    const storage = installMemoryStorage();

    const server = await createServer({
        root,
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error'
    });

    try {
        const {
            canAttemptWorkflowWrites,
            isWorkflowWriteAuthError
        } = await server.ssrLoadModule('/src/lib/api/workflowApi.js');
        const {
            openWorkflowWriteCircuit,
            isWorkflowWriteCircuitOpen,
            clearWorkflowWriteCircuit,
            resetWorkflowWriteCircuitForTests,
            persistWorkflowTaskStore,
            WORKFLOW_TASK_STORAGE_KEY
        } = await server.ssrLoadModule('/src/lib/workflow/workflowEngine.js');
        const {
            scheduleHydrateNotifications,
            getNotificationHydrateStats,
            resetNotificationHydrateForTests,
            NOTIFICATION_HYDRATE_DEBOUNCE_MS
        } = await server.ssrLoadModule('/src/lib/notifications/notificationCenter.js');
        const {
            registerCommandCenterRefreshListener,
            scheduleCommandCenterRefresh,
            startCommandCenterRefreshInterval,
            getCommandCenterRefreshStats,
            resetCommandCenterRefreshForTests,
            COMMAND_CENTER_REFRESH_DEBOUNCE_MS
        } = await server.ssrLoadModule('/src/lib/command/commandCenterRefresh.js');
        const { ADMIN_SESSION_TOKEN_KEY } = await server.ssrLoadModule('/src/lib/adminSession.js');

        resetWorkflowWriteCircuitForTests();

        /** @type {Array<{ url: string; method: string; hasAuth: boolean }>} */
        const fetchLog = [];
        globalThis.fetch = async (input, init = {}) => {
            const url = typeof input === 'string' ? input : String(input?.url || input);
            const method = String(init.method || 'GET').toUpperCase();
            const headers = init.headers || {};
            const auth =
                headers.Authorization ||
                headers.authorization ||
                (typeof headers.get === 'function' ? headers.get('Authorization') : '');
            fetchLog.push({ url, method, hasAuth: Boolean(auth) });
            if (url.includes('/api/workflow/tasks') && method === 'POST') {
                if (!auth) {
                    return {
                        ok: false,
                        status: 401,
                        json: async () => ({ error: 'missing_authorization' })
                    };
                }
                return {
                    ok: true,
                    status: 201,
                    json: async () => ({ id: 'ok', status: 'PENDING' })
                };
            }
            if (url.includes('/api/notifications')) {
                return { ok: true, status: 200, json: async () => [] };
            }
            if (url.includes('/api/workflow/status')) {
                return { ok: true, status: 200, json: async () => ({ enabled: true, count: 0 }) };
            }
            return { ok: true, status: 200, json: async () => ({}) };
        };

        assert(canAttemptWorkflowWrites() === false, 'H: without token, writes are not attempted');
        assert(isWorkflowWriteAuthError('missing_authorization'), 'B: missing_authorization classified');
        assert(
            isWorkflowWriteAuthError(new Error('missing_authorization')),
            'B: Error missing_authorization classified'
        );

        openWorkflowWriteCircuit('missing_authorization');
        assert(isWorkflowWriteCircuitOpen() === true, 'B: circuit opens on auth failure');

        const localTask = {
            id: 't1',
            seriesId: 's1',
            episodeId: 'e1',
            taskType: 'MISSING_METADATA',
            priority: 4,
            estimatedImpact: 1,
            status: 'PENDING',
            createdAt: Date.now(),
            title: 'kept-local'
        };
        persistWorkflowTaskStore({ version: 1, tasks: [localTask] });
        const after = storage.getItem(WORKFLOW_TASK_STORAGE_KEY);
        assert(
            Boolean(after) && after.includes('kept-local'),
            'C: local workflow store survives auth/circuit failure'
        );

        const postsWhileOpen = fetchLog.filter(
            (e) => e.method === 'POST' && e.url.includes('/api/workflow/tasks')
        );
        assert(postsWhileOpen.length === 0, 'B: circuit prevents workflow POST retries');

        storage.setItem(ADMIN_SESSION_TOKEN_KEY, 'fresh-admin-token');
        assert(isWorkflowWriteCircuitOpen() === false, 'H: circuit clears when admin token changes');
        assert(canAttemptWorkflowWrites() === true, 'H: token enables write attempts');

        fetchLog.length = 0;
        persistWorkflowTaskStore({
            version: 1,
            tasks: [{ ...localTask, title: 'authed-write', createdAt: Date.now() + 1 }]
        });
        await sleep(50);
        const authedPosts = fetchLog.filter(
            (e) => e.method === 'POST' && e.url.includes('/api/workflow/tasks')
        );
        assert(authedPosts.length >= 1, 'H: authenticated workflow POST attempted after token present');
        assert(authedPosts.every((e) => e.hasAuth), 'A/H: authenticated workflow POST includes Authorization');

        clearWorkflowWriteCircuit('test');
        resetWorkflowWriteCircuitForTests();

        resetNotificationHydrateForTests();
        for (let i = 0; i < 25; i += 1) {
            scheduleHydrateNotifications(`burst-${i}`);
        }
        const mid = getNotificationHydrateStats();
        assert(mid.scheduleCount === 25, 'F: hydrate schedules count every event');
        assert(mid.runCount === 0, 'F: hydrate runs coalesced (none before debounce)');
        await sleep(NOTIFICATION_HYDRATE_DEBOUNCE_MS + 100);
        const end = getNotificationHydrateStats();
        assert(end.runCount === 1, `F: 25 workflow events → 1 hydrate run (got ${end.runCount})`);

        resetCommandCenterRefreshForTests();
        let flushHits = 0;
        registerCommandCenterRefreshListener(() => {
            flushHits += 1;
        });
        const stopA = startCommandCenterRefreshInterval('production-command-center');
        const stopB = startCommandCenterRefreshInterval('studio-workspace');
        const statsOwners = getCommandCenterRefreshStats();
        assert(
            statsOwners.intervalOwnerId === 'production-command-center',
            'G: only one interval owner (PCC preferred)'
        );
        for (let i = 0; i < 12; i += 1) {
            scheduleCommandCenterRefresh(`burst-${i}`);
        }
        await sleep(COMMAND_CENTER_REFRESH_DEBOUNCE_MS + 100);
        assert(flushHits === 1, `G: 12 overlapping schedules → 1 flush (got ${flushHits})`);
        stopA();
        stopB();
    } finally {
        await server.close();
    }

    console.log('\n[phase26-2-workflow-stability — frozen Media Vault boundaries]');
    const vaultSrc = read('src/components/experiences/VaultExperience.svelte');
    const mediaSrc = read('src/lib/api/media.js');
    assert(
        /stagePendingVaultVideo/.test(vaultSrc) &&
            /acceptPendingVideo/.test(vaultSrc) &&
            /processVaultVideoFile/.test(vaultSrc) &&
            /handleVaultVideoDrop/.test(vaultSrc),
        'I: Media Vault upload/drop functions remain present'
    );
    assert(
        /uploadMedia/.test(mediaSrc) && /SIGNED_UPLOADS_MIN_BYTES/.test(mediaSrc),
        'I: signed upload / uploadMedia path untouched'
    );
    const vaultFingerprint = [
        'src/components/experiences/VaultExperience.svelte',
        'src/lib/api/media.js',
        'src/lib/drag-drop.js'
    ]
        .map((rel) => `${rel}:${sha(rel).slice(0, 12)}`)
        .join('|');
    assert(vaultFingerprint.length > 20, `I: vault fingerprint captured`);

    // Diff against HEAD for frozen vault paths (must be clean).
    const { spawnSync } = await import('node:child_process');
    const vaultDiff = spawnSync(
        'git',
        [
            'diff',
            '--',
            'frontend/src/components/experiences/VaultExperience.svelte',
            'frontend/src/lib/api/media.js',
            'frontend/src/lib/drag-drop.js'
        ],
        { cwd: join(root, '..'), encoding: 'utf8' }
    );
    assert(
        !String(vaultDiff.stdout || '').trim(),
        'M: frozen Media Vault paths have empty git diff'
    );

    console.log('\n[phase26-2-workflow-stability — summary]');
    if (failed > 0) {
        console.error(`FAIL — phase26-2-workflow-stability (${failed} assertion(s))`);
        process.exit(1);
    }
    console.log('PASS — phase26-2-workflow-stability');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
