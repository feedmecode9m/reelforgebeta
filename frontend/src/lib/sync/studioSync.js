/**
 * Phase 14 — Cross-device Studio sync.
 * Pull on startup, push on mutation, last-write-wins conflict resolution.
 */

import { writable, get } from 'svelte/store';
import { fetchSyncStatus, pullSyncState, pushSyncState, getOrCreateSyncDeviceId } from '../api/syncApi.js';
import {
    SYNC_DOMAINS,
    entryUpdatedAt,
    mergeSyncPayloads
} from './syncMerge.js';
import {
    loadReelSeriesMetadataMap,
    persistReelSeriesMetadataMap
} from '../series/seriesMetadataStorage.js';
import {
    loadReleaseScheduleMap,
    persistReleaseScheduleMap
} from '../release/releaseCenter.js';
import {
    loadWorkflowTaskStore,
    persistWorkflowTaskStore,
    WORKFLOW_TASK_STORAGE_KEY
} from '../workflow/workflowEngine.js';
import {
    PUBLISHING_PROFILE_STORAGE_KEY,
    PUBLISHING_PROFILE_UPDATED_AT_KEY,
    activePublishingProfile
} from '../publishing/publishingProfileStore.js';
import { normalizePublishingProfileId } from '../publishing/publishingProfiles.js';

/** @typedef {'online' | 'syncing' | 'offline' | 'error'} SyncStatus */

/** @type {import('svelte/store').Writable<SyncStatus>} */
export const syncStatus = writable(/** @type {SyncStatus} */ ('offline'));

/** @type {import('svelte/store').Writable<number | null>} */
export const lastSyncAt = writable(null);

const SYNC_INTERVAL_MS = 15000;
const PUSH_DEBOUNCE_MS = 1200;

let syncTimer = null;
let pushTimer = null;
let initialized = false;
let pushPending = false;

/**
 * @param {string} tag
 * @param {Record<string, unknown>} detail
 */
export function logStudioSyncDiag(tag, detail = {}) {
    console.log(
        `[${tag}] ${JSON.stringify({
            deviceId: getOrCreateSyncDeviceId(),
            status: get(syncStatus),
            ...detail,
            timestamp: Date.now()
        })}`
    );
}

/** @param {Record<string, import('../series/seriesMetadataStorage.js').ReelSeriesMetadata>} metadataMap */
function buildSeriesMetadataDomain(metadataMap) {
    /** @type {Record<string, Record<string, unknown>>} */
    const entries = {};
    for (const [reelId, meta] of Object.entries(metadataMap)) {
        entries[reelId] = {
            ...meta,
            updatedAt: meta.updatedAt || Date.now()
        };
    }
    const updatedAt = Object.values(entries).reduce(
        (max, entry) => Math.max(max, entryUpdatedAt(entry)),
        0
    );
    return { entries, updatedAt };
}

function buildWorkflowTasksDomain() {
    const store = loadWorkflowTaskStore();
    /** @type {Record<string, Record<string, unknown>>} */
    const entries = {};
    for (const task of store.tasks) {
        entries[task.id] = {
            ...task,
            updatedAt: task.updatedAt || task.createdAt || Date.now()
        };
    }
    const updatedAt = Object.values(entries).reduce(
        (max, entry) => Math.max(max, entryUpdatedAt(entry)),
        0
    );
    return { entries, updatedAt };
}

function buildReleaseScheduleDomain() {
    const releaseScheduleMap = loadReleaseScheduleMap();
    /** @type {Record<string, Record<string, unknown>>} */
    const entries = {};
    for (const [episodeId, schedule] of Object.entries(releaseScheduleMap)) {
        entries[episodeId] = {
            ...schedule,
            updatedAt: schedule.updatedAt || Date.now()
        };
    }
    const updatedAt = Object.values(entries).reduce(
        (max, entry) => Math.max(max, entryUpdatedAt(entry)),
        0
    );
    return { entries, updatedAt };
}

function buildPublishingStateDomain() {
    let profileId = get(activePublishingProfile);
    if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(PUBLISHING_PROFILE_STORAGE_KEY);
        if (stored) {
            profileId = normalizePublishingProfileId(stored);
        }
    }
    let updatedAt = 0;
    if (typeof window !== 'undefined') {
        const raw = localStorage.getItem(PUBLISHING_PROFILE_UPDATED_AT_KEY);
        updatedAt = raw ? Number(raw) || 0 : 0;
    }
    return {
        entries: {
            active: {
                profileId,
                updatedAt
            }
        },
        updatedAt
    };
}

/** @returns {Record<string, unknown>} */
export function collectLocalSyncPayload() {
    const seriesMetadataMap = loadReelSeriesMetadataMap();
    return {
        version: 1,
        seriesMetadata: buildSeriesMetadataDomain(seriesMetadataMap),
        workflowTasks: buildWorkflowTasksDomain(),
        releaseSchedule: buildReleaseScheduleDomain(),
        publishingState: buildPublishingStateDomain()
    };
}

/** @param {Record<string, unknown>} payload */
export function applySyncPayloadToLocal(payload) {
    const seriesEntries = /** @type {Record<string, Record<string, unknown>>} */ (
        payload?.seriesMetadata?.entries || {}
    );
    const workflowEntries = /** @type {Record<string, Record<string, unknown>>} */ (
        payload?.workflowTasks?.entries || {}
    );
    const releaseEntries = /** @type {Record<string, Record<string, unknown>>} */ (
        payload?.releaseSchedule?.entries || {}
    );
    const publishingEntries = /** @type {Record<string, Record<string, unknown>>} */ (
        payload?.publishingState?.entries || {}
    );

    /** @type {Record<string, import('../series/seriesMetadataStorage.js').ReelSeriesMetadata>} */
    const metadataMap = {};
    for (const [reelId, entry] of Object.entries(seriesEntries)) {
        metadataMap[reelId] = /** @type {import('../series/seriesMetadataStorage.js').ReelSeriesMetadata} */ ({
            ...entry,
            reelId
        });
    }
    persistReelSeriesMetadataMap(metadataMap);

    const workflowStore = loadWorkflowTaskStore();
    workflowStore.tasks = Object.values(workflowEntries).map((entry) => ({
        id: String(entry.id),
        seriesId: String(entry.seriesId || ''),
        episodeId: String(entry.episodeId || ''),
        taskType: entry.taskType || 'MISSING_METADATA',
        priority: Number(entry.priority) || 4,
        estimatedImpact: Number(entry.estimatedImpact) || 1,
        status: entry.status || 'PENDING',
        createdAt: Number(entry.createdAt) || Date.now(),
        title: entry.title ? String(entry.title) : undefined,
        reelId: entry.reelId ? String(entry.reelId) : null,
        estimatedMinutes: entry.estimatedMinutes != null ? Number(entry.estimatedMinutes) : undefined,
        updatedAt: entryUpdatedAt(entry)
    }));
    persistWorkflowTaskStore(workflowStore);

    /** @type {Record<string, import('../release/releaseCenter.js').EpisodeReleaseSchedule>} */
    const releaseMap = {};
    for (const [episodeId, entry] of Object.entries(releaseEntries)) {
        releaseMap[episodeId] = /** @type {import('../release/releaseCenter.js').EpisodeReleaseSchedule} */ (
            entry
        );
    }
    persistReleaseScheduleMap(releaseMap);

    const activePublishing = publishingEntries.active;
    if (activePublishing?.profileId) {
        const profileId = normalizePublishingProfileId(String(activePublishing.profileId));
        const updatedAt = entryUpdatedAt(activePublishing);
        if (typeof window !== 'undefined') {
            localStorage.setItem(PUBLISHING_PROFILE_STORAGE_KEY, profileId);
            localStorage.setItem(PUBLISHING_PROFILE_UPDATED_AT_KEY, String(updatedAt));
        }
        activePublishingProfile.set(profileId);
    }

    if (typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent('reelforge:sync-applied', {
                detail: {
                    seriesMetadata: metadataMap,
                    workflowTasks: workflowStore.tasks,
                    releaseSchedule: releaseMap,
                    publishingState: activePublishing
                }
            })
        );
    }

    return {
        seriesMetadata: metadataMap,
        workflowTasks: workflowStore.tasks,
        releaseSchedule: releaseMap,
        publishingState: activePublishing
    };
}

/** @returns {Promise<boolean>} */
async function isSyncApiAvailable() {
    const status = await fetchSyncStatus();
    return !status.disabled && status.enabled !== false;
}

/** @param {Record<string, unknown>} payload */
function payloadToPushDomains(payload) {
    /** @type {Record<string, unknown>} */
    const domains = {};
    for (const domain of SYNC_DOMAINS) {
        domains[domain] = payload[domain];
    }
    return domains;
}

export async function performSync() {
    syncStatus.set('syncing');

    try {
        const available = await isSyncApiAvailable();
        if (!available) {
            syncStatus.set('offline');
            logStudioSyncDiag('SYNC_PULL', { source: 'offline', reason: 'api-unavailable' });
            return { ok: false, offline: true };
        }

        const localPayload = collectLocalSyncPayload();
        const remote = await pullSyncState();
        if (remote?.disabled) {
            syncStatus.set('offline');
            logStudioSyncDiag('SYNC_PULL', { source: 'offline', reason: remote.error || 'pull-disabled' });
            return { ok: false, offline: true };
        }

        logStudioSyncDiag('SYNC_PULL', {
            domains: SYNC_DOMAINS,
            remoteUpdatedAt: remote?.updatedAt || null
        });

        const remotePayload = /** @type {Record<string, unknown>} */ (remote?.payload || {});
        const merged = mergeSyncPayloads(localPayload, remotePayload);
        const conflicts = /** @type {Array<Record<string, unknown>>} */ (merged.__conflicts || []);
        delete merged.__conflicts;

        if (conflicts.length > 0) {
            for (const conflict of conflicts) {
                logStudioSyncDiag('SYNC_CONFLICT', conflict);
            }
            logStudioSyncDiag('SYNC_RESOLVED', {
                conflictCount: conflicts.length,
                strategy: 'last-write-wins'
            });
        }

        applySyncPayloadToLocal(merged);

        const pushResult = await pushSyncState(payloadToPushDomains(merged));
        const mergedPayload = /** @type {Record<string, unknown>} */ (pushResult?.payload || merged);
        applySyncPayloadToLocal(mergedPayload);

        logStudioSyncDiag('SYNC_PUSH', {
            domains: SYNC_DOMAINS,
            conflictCount: conflicts.length
        });

        const at = Date.now();
        lastSyncAt.set(at);
        syncStatus.set('online');

        return { ok: true, payload: mergedPayload, conflicts };
    } catch (err) {
        syncStatus.set('error');
        logStudioSyncDiag('SYNC_PUSH', { source: 'error', reason: err?.message || 'sync-failed' });
        return { ok: false, error: err };
    }
}

/** @param {typeof SYNC_DOMAINS[number]} [_domain] */
export function scheduleSyncPush(_domain) {
    pushPending = true;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
        pushTimer = null;
        if (!pushPending) return;
        pushPending = false;
        void performSync();
    }, PUSH_DEBOUNCE_MS);
}

export function initStudioSync() {
    if (initialized) return;
    initialized = true;

    void performSync();

    if (typeof window !== 'undefined') {
        syncTimer = setInterval(() => {
            void performSync();
        }, SYNC_INTERVAL_MS);

        window.addEventListener('online', () => {
            void performSync();
        });

        window.addEventListener('offline', () => {
            syncStatus.set('offline');
        });

        window.addEventListener('reelforge:sync-schedule', (event) => {
            const domain = /** @type {CustomEvent} */ (event).detail?.domain;
            scheduleSyncPush(domain);
        });

        window.addEventListener('reelforge:workflow-tasks-updated', () => {
            scheduleSyncPush('workflowTasks');
        });

        window.__reelforgeSync = {
            performSync,
            collectLocalSyncPayload,
            applySyncPayloadToLocal,
            mergeSyncPayloads,
            getSyncStatus: () => get(syncStatus),
            SYNC_DOMAINS,
            WORKFLOW_TASK_STORAGE_KEY
        };
    }
}

export function stopStudioSync() {
    if (syncTimer) clearInterval(syncTimer);
    if (pushTimer) clearTimeout(pushTimer);
    syncTimer = null;
    pushTimer = null;
    initialized = false;
}
