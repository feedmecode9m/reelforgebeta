/**
 * Studio Repair Engine — one-click reversible fixes for common production issues.
 * Does not delete user data, auto-publish, or modify playback.
 */

import { get } from 'svelte/store';
import { buildEpisodeOperationRows } from './productionHealth.js';
import {
    attachEpisodeReel,
    getEpisodeById,
    getReelSeriesMetadata,
    saveReelSeriesMetadata,
    seriesCatalog,
    reelSeriesMetadata
} from './seriesStore.js';
import {
    loadReelSeriesMetadataMap,
    persistReelSeriesMetadataMap
} from './seriesMetadataStorage.js';
import {
    loadReleaseScheduleMap,
    persistReleaseScheduleMap,
    combineDateAndTime,
    formatReleaseDate
} from './releaseCenter.js';

export const REPAIR_ROLLBACK_KEY = 'reelforge_studio_repair_rollback';
export const REPAIR_OVERLAY_KEY = 'reelforge_studio_repair_overlays';

/** @typedef {'missing-thumbnail' | 'missing-description' | 'missing-runtime' | 'orphaned-episode' | 'unlinked-reel' | 'missing-release-date'} RepairIssueType */

/** @typedef {'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'} RepairSeverity */

/**
 * @typedef {Object} RepairPlanItem
 * @property {string} id
 * @property {RepairIssueType} issue
 * @property {boolean} repairable
 * @property {string} action
 * @property {RepairSeverity} severity
 * @property {string} episodeId
 * @property {string | null} reelId
 * @property {string} label
 * @property {string} detail
 */

/**
 * @typedef {Object} StudioRepairSnapshot
 * @property {string} seriesId
 * @property {RepairPlanItem[]} issues
 * @property {RepairPlanItem[]} repairPlan
 * @property {number} repairableCount
 * @property {Record<RepairIssueType, number>} coverage
 */

const SEVERITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const ISSUE_SEVERITY = {
    'unlinked-reel': 'CRITICAL',
    'orphaned-episode': 'CRITICAL',
    'missing-description': 'HIGH',
    'missing-runtime': 'HIGH',
    'missing-release-date': 'HIGH',
    'missing-thumbnail': 'MEDIUM'
};

/**
 * @param {'STUDIO_REPAIR'} tag
 * @param {Record<string, unknown>} payload
 */
export function logStudioRepair(tag, payload) {
    console.log(`[${tag}] ${JSON.stringify({ ...payload, timestamp: Date.now() })}`);
}

/** @type {{ entries: object[] }} */
let memoryRollbackStack = { entries: [] };

/** @returns {{ entries: object[] }} */
function loadRollbackStack() {
    if (typeof window === 'undefined') return memoryRollbackStack;
    try {
        const raw = localStorage.getItem(REPAIR_ROLLBACK_KEY);
        if (!raw) return { entries: [] };
        const parsed = JSON.parse(raw);
        return parsed?.entries ? parsed : { entries: [] };
    } catch {
        return { entries: [] };
    }
}

/** @param {{ entries: object[] }} stack */
function persistRollbackStack(stack) {
    if (typeof window === 'undefined') {
        memoryRollbackStack = stack;
        return true;
    }
    try {
        localStorage.setItem(REPAIR_ROLLBACK_KEY, JSON.stringify(stack));
        return true;
    } catch {
        return false;
    }
}

/** @returns {Record<string, { thumbnailUrl?: string }>} */
export function loadRepairOverlays() {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(REPAIR_OVERLAY_KEY);
        if (!raw) return {};
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

/** @param {Record<string, { thumbnailUrl?: string }>} overlays */
function persistRepairOverlays(overlays) {
    if (typeof window === 'undefined') return false;
    try {
        localStorage.setItem(REPAIR_OVERLAY_KEY, JSON.stringify(overlays));
        return true;
    } catch {
        return false;
    }
}

/**
 * @param {string} episodeId
 */
function episodeLabel(episodeId) {
    const ctx = getEpisodeById(episodeId);
    if (!ctx) return episodeId;
    return `S${ctx.season.seasonNumber}:E${String(ctx.episode.episodeNumber).padStart(2, '0')}`;
}

/**
 * @param {string} seriesTitle
 * @param {string} episodeTitle
 * @param {number} episodeNumber
 */
function defaultDescription(seriesTitle, episodeTitle, episodeNumber) {
    return `${episodeTitle} — Episode ${episodeNumber} of ${seriesTitle}.`;
}

/**
 * @param {string} episodeId
 * @param {Record<string, unknown>[]} feedReels
 * @param {Record<string, import('./seriesMetadataStorage.js').ReelSeriesMetadata>} metadataMap
 */
function findUnlinkedFeedReel(episodeId, feedReels, metadataMap) {
    for (const reel of feedReels) {
        const id = reel?.id ? String(reel.id) : '';
        if (!id) continue;
        const meta = metadataMap[id];
        if (meta?.episodeId === episodeId) return id;
    }
    return null;
}

/**
 * @param {string} seriesId
 * @param {number} seasonNumber
 * @param {number} episodeNumber
 */
function findEpisodeByNumbers(seriesId, seasonNumber, episodeNumber) {
    for (const series of get(seriesCatalog)) {
        if (series.id !== seriesId) continue;
        for (const season of series.seasons) {
            if (season.seasonNumber !== seasonNumber) continue;
            const episode = season.episodes.find((e) => e.episodeNumber === episodeNumber);
            if (episode) return episode.episodeId;
        }
    }
    return null;
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} feedReels
 */
export function detectStudioRepairIssues(seriesId, feedReels = []) {
    const rows = buildEpisodeOperationRows(feedReels, seriesId).filter((r) => r.seriesId === seriesId);
    const scheduleMap = loadReleaseScheduleMap();
    const metadataMap = loadReelSeriesMetadataMap();
    const overlays = loadRepairOverlays();
    /** @type {RepairPlanItem[]} */
    const issues = [];
    const seen = new Set();

    function pushIssue(item) {
        if (seen.has(item.id)) return;
        seen.add(item.id);
        issues.push(item);
    }

    for (const row of rows) {
        const ctx = getEpisodeById(row.episodeId);
        const studio = row.reelId ? getReelSeriesMetadata(row.reelId) : null;
        const label = episodeLabel(row.episodeId);

        const hasDescription = Boolean(
            studio?.description?.trim() ||
                ctx?.episode?.description?.trim() ||
                ctx?.series?.description?.trim()
        );
        if (!hasDescription && row.reelId) {
            pushIssue({
                id: `repair-${row.episodeId}-missing-description`,
                issue: 'missing-description',
                repairable: true,
                action: 'generate-default-description',
                severity: ISSUE_SEVERITY['missing-description'],
                episodeId: row.episodeId,
                reelId: row.reelId,
                label,
                detail: `${label} has no synopsis`
            });
        }

        if (!(row.runtime != null && row.runtime > 0) && row.reelId) {
            pushIssue({
                id: `repair-${row.episodeId}-missing-runtime`,
                issue: 'missing-runtime',
                repairable: true,
                action: 'infer-runtime-from-catalog',
                severity: ISSUE_SEVERITY['missing-runtime'],
                episodeId: row.episodeId,
                reelId: row.reelId,
                label,
                detail: `${label} runtime is missing`
            });
        }

        const hasThumbnail =
            Boolean(row.thumbnailUrl) ||
            Boolean(overlays[row.episodeId]?.thumbnailUrl) ||
            Boolean(ctx?.series?.poster);
        if (row.reelId && !hasThumbnail) {
            pushIssue({
                id: `repair-${row.episodeId}-missing-thumbnail`,
                issue: 'missing-thumbnail',
                repairable: Boolean(ctx?.series?.poster),
                action: 'assign-series-poster-thumbnail',
                severity: ISSUE_SEVERITY['missing-thumbnail'],
                episodeId: row.episodeId,
                reelId: row.reelId,
                label,
                detail: `${label} has no thumbnail`
            });
        }

        if (
            row.reelId &&
            row.publishingStatus !== 'Published' &&
            !scheduleMap[row.episodeId]
        ) {
            pushIssue({
                id: `repair-${row.episodeId}-missing-release-date`,
                issue: 'missing-release-date',
                repairable: true,
                action: 'schedule-default-release-date',
                severity: ISSUE_SEVERITY['missing-release-date'],
                episodeId: row.episodeId,
                reelId: row.reelId,
                label,
                detail: `${label} has no release date`
            });
        }

        if (!row.reelId || !row.reelInFeed) {
            const matchReelId = findUnlinkedFeedReel(row.episodeId, feedReels, metadataMap);
            if (matchReelId) {
                pushIssue({
                    id: `repair-${row.episodeId}-unlinked-reel`,
                    issue: 'unlinked-reel',
                    repairable: true,
                    action: 'link-feed-reel-to-episode',
                    severity: ISSUE_SEVERITY['unlinked-reel'],
                    episodeId: row.episodeId,
                    reelId: matchReelId,
                    label,
                    detail: `${label} reel exists in feed but is not linked`
                });
            }
        }
    }

    for (const [reelId, meta] of Object.entries(metadataMap)) {
        if (meta.seriesId !== seriesId) continue;
        if (!meta.episodeId || getEpisodeById(meta.episodeId)) continue;

        const resolvedEpisodeId = findEpisodeByNumbers(
            seriesId,
            meta.seasonNumber,
            meta.episodeNumber
        );

        pushIssue({
            id: `repair-${reelId}-orphaned-episode`,
            issue: 'orphaned-episode',
            repairable: Boolean(resolvedEpisodeId),
            action: 'relink-orphaned-metadata',
            severity: ISSUE_SEVERITY['orphaned-episode'],
            episodeId: resolvedEpisodeId || meta.episodeId,
            reelId,
            label: `Reel ${reelId.slice(0, 8)}…`,
            detail: `Metadata points to missing episode ${meta.episodeId}`
        });
    }

    return issues.sort(
        (a, b) =>
            SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
            a.label.localeCompare(b.label)
    );
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 */
export function buildRepairPlan(seriesId, feedReels = []) {
    const issues = detectStudioRepairIssues(seriesId, feedReels);
    const repairPlan = issues.filter((item) => item.repairable);

    /** @type {Record<RepairIssueType, number>} */
    const coverage = {
        'missing-thumbnail': 0,
        'missing-description': 0,
        'missing-runtime': 0,
        'orphaned-episode': 0,
        'unlinked-reel': 0,
        'missing-release-date': 0
    };

    for (const issue of issues) {
        coverage[issue.issue] += 1;
    }

    return {
        seriesId,
        issues,
        repairPlan,
        repairableCount: repairPlan.length,
        coverage
    };
}

/**
 * @param {RepairPlanItem} item
 */
function captureRollbackSnapshot(item) {
    const metadataMap = loadReelSeriesMetadataMap();
    const scheduleMap = loadReleaseScheduleMap();
    const overlays = loadRepairOverlays();
    const ctx = item.episodeId ? getEpisodeById(item.episodeId) : null;

    return {
        repairId: item.id,
        timestamp: Date.now(),
        issue: item.issue,
        metadata:
            item.reelId && metadataMap[item.reelId]
                ? { [item.reelId]: { ...metadataMap[item.reelId] } }
                : {},
        releaseSchedule: item.episodeId
            ? { [item.episodeId]: scheduleMap[item.episodeId] ? { ...scheduleMap[item.episodeId] } : null }
            : {},
        catalogReelId: item.episodeId
            ? { [item.episodeId]: ctx?.episode?.reelId ?? null }
            : {},
        overlay: item.episodeId
            ? { [item.episodeId]: overlays[item.episodeId] ? { ...overlays[item.episodeId] } : null }
            : {}
    };
}

/**
 * @param {object} snapshot
 */
function pushRollbackSnapshot(snapshot) {
    const stack = loadRollbackStack();
    stack.entries.push(snapshot);
    if (stack.entries.length > 50) {
        stack.entries = stack.entries.slice(-50);
    }
    persistRollbackStack(stack);
}

/**
 * @param {RepairPlanItem} item
 */
export function executeRepair(item) {
    if (!item.repairable) {
        logStudioRepair('STUDIO_REPAIR', { phase: 'skipped', repairId: item.id, reason: 'not-repairable' });
        return { ok: false, repairId: item.id };
    }

    const snapshot = captureRollbackSnapshot(item);
    const ctx = getEpisodeById(item.episodeId);
    let ok = false;

    try {
        if (item.action === 'generate-default-description' && item.reelId && ctx) {
            const description = defaultDescription(
                ctx.series.title,
                ctx.episode.title,
                ctx.episode.episodeNumber
            );
            saveReelSeriesMetadata(item.reelId, { description });
            ok = true;
        }

        if (item.action === 'infer-runtime-from-catalog' && item.reelId && ctx) {
            const runtime = ctx.episode.runtime && ctx.episode.runtime > 0 ? ctx.episode.runtime : 300;
            saveReelSeriesMetadata(item.reelId, { runtime });
            ok = true;
        }

        if (item.action === 'assign-series-poster-thumbnail' && item.episodeId && ctx?.series?.poster) {
            const overlays = loadRepairOverlays();
            overlays[item.episodeId] = { thumbnailUrl: String(ctx.series.poster) };
            persistRepairOverlays(overlays);
            ok = true;
        }

        if (item.action === 'schedule-default-release-date' && item.episodeId) {
            const scheduleMap = loadReleaseScheduleMap();
            const launch = new Date();
            launch.setDate(launch.getDate() + 7);
            const dateStr = formatReleaseDate(launch.getTime());
            scheduleMap[item.episodeId] = {
                episodeId: item.episodeId,
                seriesId: ctx?.series.id || '',
                releaseAt: combineDateAndTime(dateStr, '19:00'),
                releaseTime: '19:00',
                status: 'scheduled',
                updatedAt: Date.now()
            };
            persistReleaseScheduleMap(scheduleMap);
            ok = true;
        }

        if (item.action === 'link-feed-reel-to-episode' && item.episodeId && item.reelId) {
            ok = attachEpisodeReel(item.episodeId, item.reelId);
        }

        if (item.action === 'relink-orphaned-metadata' && item.reelId && item.episodeId) {
            const meta = loadReelSeriesMetadataMap()[item.reelId];
            if (meta) {
                saveReelSeriesMetadata(item.reelId, { episodeId: item.episodeId });
                ok = true;
            }
        }
    } catch (err) {
        logStudioRepair('STUDIO_REPAIR', {
            phase: 'error',
            repairId: item.id,
            error: String(err)
        });
        return { ok: false, repairId: item.id };
    }

    if (ok) {
        pushRollbackSnapshot(snapshot);
        logStudioRepair('STUDIO_REPAIR', {
            phase: 'executed',
            repairId: item.id,
            issue: item.issue,
            action: item.action,
            episodeId: item.episodeId,
            reelId: item.reelId
        });
        if (typeof window !== 'undefined') {
            window.dispatchEvent(
                new CustomEvent('reelforge:metrics-repair', {
                    detail: {
                        seriesId: ctx?.series?.id || null,
                        reelId: item.reelId,
                        issueType: item.issue
                    }
                })
            );
        }
    } else {
        logStudioRepair('STUDIO_REPAIR', {
            phase: 'failed',
            repairId: item.id,
            issue: item.issue,
            action: item.action
        });
    }

    return { ok, repairId: item.id, rollbackId: snapshot.repairId };
}

/**
 * @param {RepairPlanItem[]} repairPlan
 */
export function executeAllRepairs(repairPlan) {
    /** @type {{ ok: boolean; repairId: string }[]} */
    const results = [];
    for (const item of repairPlan) {
        results.push(executeRepair(item));
    }
    const succeeded = results.filter((r) => r.ok).length;
    logStudioRepair('STUDIO_REPAIR', {
        phase: 'batch-complete',
        total: repairPlan.length,
        succeeded
    });
    return { results, succeeded };
}

/**
 * @param {string} [repairId]
 */
export function rollbackRepair(repairId) {
    const stack = loadRollbackStack();
    const index = repairId
        ? stack.entries.findIndex((e) => e.repairId === repairId)
        : stack.entries.length - 1;

    if (index < 0) {
        logStudioRepair('STUDIO_REPAIR', { phase: 'rollback-missed', repairId: repairId || 'last' });
        return { ok: false };
    }

    const snapshot = stack.entries[index];
    const metadataMap = loadReelSeriesMetadataMap();
    const scheduleMap = loadReleaseScheduleMap();
    const overlays = loadRepairOverlays();

    for (const [reelId, prev] of Object.entries(snapshot.metadata || {})) {
        if (prev) metadataMap[reelId] = /** @type {import('./seriesMetadataStorage.js').ReelSeriesMetadata} */ (prev);
        else delete metadataMap[reelId];
    }
    persistReelSeriesMetadataMap(metadataMap);
    reelSeriesMetadata.set({ ...metadataMap });

    for (const [episodeId, prev] of Object.entries(snapshot.releaseSchedule || {})) {
        if (prev) scheduleMap[episodeId] = prev;
        else delete scheduleMap[episodeId];
        persistReleaseScheduleMap(scheduleMap);
    }

    for (const [episodeId, prevReelId] of Object.entries(snapshot.catalogReelId || {})) {
        const ctx = getEpisodeById(episodeId);
        if (!ctx) continue;
        seriesCatalog.update((catalog) =>
            catalog.map((series) => ({
                ...series,
                seasons: series.seasons.map((season) => ({
                    ...season,
                    episodes: season.episodes.map((episode) =>
                        episode.episodeId === episodeId
                            ? { ...episode, reelId: /** @type {string | null} */ (prevReelId) }
                            : episode
                    )
                }))
            }))
        );
    }

    for (const [episodeId, prev] of Object.entries(snapshot.overlay || {})) {
        if (prev) overlays[episodeId] = prev;
        else delete overlays[episodeId];
        persistRepairOverlays(overlays);
    }

    stack.entries.splice(index, 1);
    persistRollbackStack(stack);

    logStudioRepair('STUDIO_REPAIR', {
        phase: 'rolled-back',
        repairId: snapshot.repairId,
        issue: snapshot.issue
    });

    return { ok: true, repairId: snapshot.repairId };
}
