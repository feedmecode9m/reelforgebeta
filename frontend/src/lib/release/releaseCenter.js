/**
 * Phase 11 — Release Center: centralized production scheduling.
 * Uses productionHealth episode rows; does not modify playback or theater.
 */

import { buildEpisodeOperationRows } from '../series/productionHealth.js';
import { getEpisodeById } from '../series/seriesStore.js';

export const RELEASE_SCHEDULE_STORAGE_KEY = 'reelforge_release_schedule';

/** @typedef {'draft' | 'ready' | 'scheduled' | 'released'} ReleaseDisplayStatus */
/** @typedef {'daily' | 'weekly' | 'custom'} ReleaseCadence */

/**
 * @typedef {Object} EpisodeReleaseSchedule
 * @property {string} episodeId
 * @property {string} seriesId
 * @property {number} releaseAt
 * @property {string} releaseTime
 * @property {ReleaseDisplayStatus} status
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} ReleaseCalendarEntry
 * @property {string} episodeId
 * @property {string} episodeLabel
 * @property {string} episodeTitle
 * @property {number} seasonNumber
 * @property {number} episodeNumber
 * @property {string | null} releaseDate
 * @property {string | null} releaseTime
 * @property {ReleaseDisplayStatus} status
 * @property {boolean} hasAsset
 */

/**
 * @typedef {Object} LaunchReadinessSnapshot
 * @property {number} readyEpisodes
 * @property {number} scheduledEpisodes
 * @property {number} missingEpisodes
 * @property {number} launchReadinessScore
 */

/**
 * @typedef {Object} ReleaseHealthSnapshot
 * @property {number} episodesReady
 * @property {number} episodesScheduled
 * @property {number} episodesMissingAssets
 * @property {number | null} daysUntilLaunch
 * @property {string | null} launchDate
 */

/**
 * @typedef {Object} PremiereCountdown
 * @property {number | null} days
 * @property {number | null} hours
 * @property {string | null} launchDate
 * @property {string | null} launchTime
 * @property {string} label
 */

/**
 * @typedef {Object} BulkScheduleConfig
 * @property {ReleaseCadence} cadence
 * @property {string} startDate
 * @property {string} releaseTime
 * @property {number} [dayOfWeek]
 * @property {number} [intervalDays]
 * @property {string[]} [episodeIds]
 * @property {number} [seasonNumber]
 */

/**
 * @param {string} tag
 * @param {Record<string, unknown>} detail
 */
export function logReleaseDiag(tag, detail) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @returns {Record<string, EpisodeReleaseSchedule>} */
export function loadReleaseScheduleMap() {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(RELEASE_SCHEDULE_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};
        return /** @type {Record<string, EpisodeReleaseSchedule>} */ (parsed);
    } catch {
        return {};
    }
}

/** @param {Record<string, EpisodeReleaseSchedule>} map */
export function persistReleaseScheduleMap(map) {
    if (typeof window === 'undefined') return false;
    try {
        localStorage.setItem(RELEASE_SCHEDULE_STORAGE_KEY, JSON.stringify(map));
        window.dispatchEvent(new CustomEvent('reelforge:release-schedule-updated'));
        window.dispatchEvent(
            new CustomEvent('reelforge:sync-schedule', { detail: { domain: 'releaseSchedule' } })
        );
        return true;
    } catch (err) {
        console.warn('[releaseCenter] persist failed', err);
        return false;
    }
}

/** @param {string} dateStr @param {string} timeStr */
export function combineDateAndTime(dateStr, timeStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hours, minutes] = timeStr.split(':').map(Number);
    return new Date(year, month - 1, day, hours || 0, minutes || 0, 0, 0).getTime();
}

/** @param {number} timestamp */
export function formatReleaseDate(timestamp) {
    const date = new Date(timestamp);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * @param {import('../series/productionHealth.js').EpisodeOperationRow} row
 * @param {EpisodeReleaseSchedule | null} schedule
 */
export function resolveReleaseDisplayStatus(row, schedule) {
    const now = Date.now();
    const ctx = getEpisodeById(row.episodeId);
    const episodeStatus = ctx?.episode?.status || 'draft';

    if (episodeStatus === 'published') return 'released';
    if (schedule?.releaseAt && schedule.releaseAt <= now) return 'released';
    if (schedule?.releaseAt && schedule.releaseAt > now) return 'scheduled';

    const hasAsset = Boolean(row.reelId);
    if (hasAsset && (episodeStatus === 'ready' || row.status === 'Ready')) return 'ready';
    if (hasAsset && episodeStatus === 'draft') return 'ready';

    return 'draft';
}

/** @param {string} seriesId @param {Record<string, unknown>[]} [feedReels] @param {Record<string, EpisodeReleaseSchedule>} [scheduleMap] */
export function buildReleaseCalendar(seriesId, feedReels = [], scheduleMap = loadReleaseScheduleMap()) {
    const rows = buildEpisodeOperationRows(feedReels, seriesId);

    const entries = rows.map((row) => {
        const schedule = scheduleMap[row.episodeId] || null;
        const status = resolveReleaseDisplayStatus(row, schedule);
        const releaseAt = schedule?.releaseAt || null;
        const hasAsset = Boolean(row.reelId);

        return {
            episodeId: row.episodeId,
            episodeLabel: `S${row.seasonNumber}:E${String(row.episodeNumber).padStart(2, '0')}`,
            episodeTitle: row.episodeTitle,
            seasonNumber: row.seasonNumber,
            episodeNumber: row.episodeNumber,
            releaseDate: releaseAt ? formatReleaseDate(releaseAt) : null,
            releaseTime: schedule?.releaseTime || null,
            status,
            hasAsset
        };
    });

    return entries.sort((a, b) => {
        if (a.releaseDate && b.releaseDate) return a.releaseDate.localeCompare(b.releaseDate);
        if (a.releaseDate) return -1;
        if (b.releaseDate) return 1;
        if (a.seasonNumber !== b.seasonNumber) return a.seasonNumber - b.seasonNumber;
        return a.episodeNumber - b.episodeNumber;
    });
}

/** @param {ReleaseCalendarEntry[]} calendar */
export function computeLaunchReadiness(calendar) {
    const total = calendar.length || 1;
    const readyEpisodes = calendar.filter((e) => e.status === 'ready').length;
    const scheduledEpisodes = calendar.filter((e) => e.status === 'scheduled').length;
    const missingEpisodes = calendar.filter((e) => !e.hasAsset).length;
    const releasedEpisodes = calendar.filter((e) => e.status === 'released').length;

    const weighted =
        ((releasedEpisodes * 1 + scheduledEpisodes * 0.85 + readyEpisodes * 0.6) / total) * 100;
    const missingPenalty = (missingEpisodes / total) * 20;
    const launchReadinessScore = Math.max(0, Math.min(100, Math.round(weighted - missingPenalty)));

    return { readyEpisodes, scheduledEpisodes, missingEpisodes, launchReadinessScore };
}

/** @param {ReleaseCalendarEntry[]} calendar */
export function computeReleaseHealth(calendar) {
    const episodesReady = calendar.filter((e) => e.status === 'ready').length;
    const episodesScheduled = calendar.filter((e) => e.status === 'scheduled').length;
    const episodesMissingAssets = calendar.filter((e) => !e.hasAsset).length;

    const now = Date.now();
    const futureScheduled = calendar
        .filter((e) => e.status === 'scheduled' && e.releaseDate)
        .map((e) => combineDateAndTime(e.releaseDate, e.releaseTime || '00:00'))
        .filter((ts) => ts > now)
        .sort((a, b) => a - b);

    const earliest = futureScheduled[0] || null;
    const daysUntilLaunch =
        earliest != null ? Math.max(0, Math.ceil((earliest - now) / (1000 * 60 * 60 * 24))) : null;

    return {
        episodesReady,
        episodesScheduled,
        episodesMissingAssets,
        daysUntilLaunch,
        launchDate: earliest ? formatReleaseDate(earliest) : null
    };
}

/**
 * @param {ReleaseHealthSnapshot} releaseHealth
 * @param {string} [defaultTime]
 * @returns {PremiereCountdown}
 */
export function computePremiereCountdown(releaseHealth, defaultTime = '19:00') {
    if (releaseHealth.daysUntilLaunch == null || !releaseHealth.launchDate) {
        return {
            days: null,
            hours: null,
            launchDate: null,
            launchTime: null,
            label: 'No premiere scheduled'
        };
    }

    const launchTs = combineDateAndTime(releaseHealth.launchDate, defaultTime);
    const diffMs = Math.max(0, launchTs - Date.now());
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    return {
        days,
        hours,
        launchDate: releaseHealth.launchDate,
        launchTime: defaultTime,
        label: days === 0 ? `Premiere in ${hours}h` : `Premiere in ${days}d ${hours}h`
    };
}

function alignToWeekday(startDate, dayOfWeek) {
    const base = combineDateAndTime(startDate, '00:00');
    const date = new Date(base);
    const current = date.getDay();
    let delta = dayOfWeek - current;
    if (delta < 0) delta += 7;
    date.setDate(date.getDate() + delta);
    return formatReleaseDate(date.getTime());
}

function addDays(dateStr, days) {
    const base = combineDateAndTime(dateStr, '00:00');
    const date = new Date(base);
    date.setDate(date.getDate() + days);
    return formatReleaseDate(date.getTime());
}

/**
 * Schedule a single episode release.
 * @param {string} seriesId
 * @param {string} episodeId
 * @param {string} dateStr
 * @param {string} timeStr
 */
export function scheduleEpisodeRelease(seriesId, episodeId, dateStr, timeStr) {
    const map = loadReleaseScheduleMap();
    const existing = map[episodeId] || null;
    const releaseAt = combineDateAndTime(dateStr, timeStr);
    const now = Date.now();

    map[episodeId] = {
        episodeId,
        seriesId,
        releaseAt,
        releaseTime: timeStr,
        status: releaseAt <= now ? 'released' : 'scheduled',
        updatedAt: now
    };

    persistReleaseScheduleMap(map);

    const tag = existing ? 'RELEASE_UPDATED' : 'RELEASE_CREATED';
    logReleaseDiag(tag, {
        seriesId,
        episodeId,
        releaseDate: dateStr,
        releaseTime: timeStr,
        releaseAt
    });

    if (releaseAt <= now) {
        logReleaseDiag('RELEASE_PUBLISHED', { seriesId, episodeId, releaseAt });
        if (typeof window !== 'undefined') {
            window.dispatchEvent(
                new CustomEvent('reelforge:episode-published', {
                    detail: { seriesId, episodeId, releaseAt }
                })
            );
        }
    }

    if (typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent('reelforge:release-updated', { detail: { seriesId } })
        );
    }

    return map[episodeId];
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} feedReels
 * @param {BulkScheduleConfig} config
 */
export function applyBulkReleaseSchedule(seriesId, feedReels = [], config) {
    const calendar = buildReleaseCalendar(seriesId, feedReels);
    let schedulable = calendar.filter((e) => e.status !== 'released' && e.hasAsset);

    if (config.seasonNumber != null) {
        schedulable = schedulable.filter((e) => e.seasonNumber === config.seasonNumber);
    }

    const episodeIds = config.episodeIds?.length
        ? config.episodeIds
        : schedulable.map((e) => e.episodeId);

    if (!episodeIds.length) {
        return {
            applied: 0,
            calendar,
            launchReadiness: computeLaunchReadiness(calendar),
            releaseHealth: computeReleaseHealth(calendar)
        };
    }

    const map = loadReleaseScheduleMap();
    let cursorDate = config.startDate;

    if (config.cadence === 'weekly') {
        cursorDate = alignToWeekday(config.startDate, config.dayOfWeek ?? 5);
    }

    let applied = 0;
    let created = 0;
    let updated = 0;

    for (let i = 0; i < episodeIds.length; i++) {
        const episodeId = episodeIds[i];
        const entry = calendar.find((e) => e.episodeId === episodeId);
        if (!entry || entry.status === 'released' || !entry.hasAsset) continue;

        const releaseAt = combineDateAndTime(cursorDate, config.releaseTime);
        const hadExisting = Boolean(map[episodeId]);
        map[episodeId] = {
            episodeId,
            seriesId,
            releaseAt,
            releaseTime: config.releaseTime,
            status: releaseAt <= Date.now() ? 'released' : 'scheduled',
            updatedAt: Date.now()
        };
        applied += 1;
        if (hadExisting) updated += 1;
        else created += 1;

        logReleaseDiag(hadExisting ? 'RELEASE_UPDATED' : 'RELEASE_CREATED', {
            seriesId,
            episodeId,
            releaseDate: cursorDate,
            releaseTime: config.releaseTime,
            cadence: config.cadence,
            bulk: true
        });

        if (releaseAt <= Date.now()) {
            logReleaseDiag('RELEASE_PUBLISHED', { seriesId, episodeId, releaseAt, bulk: true });
        }

        if (config.cadence === 'daily') {
            cursorDate = addDays(cursorDate, 1);
        } else if (config.cadence === 'weekly') {
            cursorDate = addDays(cursorDate, 7);
        } else {
            cursorDate = addDays(cursorDate, config.intervalDays || 7);
        }
    }

    persistReleaseScheduleMap(map);

    if (applied > 0 && typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent('reelforge:metrics-publish', {
                detail: { seriesId, episodeCount: applied, cadence: config.cadence }
            })
        );
    }

    const updatedCalendar = buildReleaseCalendar(seriesId, feedReels, map);

    logReleaseDiag('RELEASE_CENTER', {
        seriesId,
        applied,
        created,
        updated,
        cadence: config.cadence,
        calendarSize: updatedCalendar.length,
        launchReadiness: computeLaunchReadiness(updatedCalendar),
        releaseHealth: computeReleaseHealth(updatedCalendar)
    });

    return {
        applied,
        created,
        updated,
        calendar: updatedCalendar,
        launchReadiness: computeLaunchReadiness(updatedCalendar),
        releaseHealth: computeReleaseHealth(updatedCalendar)
    };
}

/** Bulk schedule all episodes in a season. */
export function scheduleSeasonRelease(seriesId, feedReels, seasonNumber, config) {
    return applyBulkReleaseSchedule(seriesId, feedReels, {
        ...config,
        seasonNumber
    });
}

/** @param {string} seriesId @param {Record<string, unknown>[]} [feedReels] */
export function buildReleaseCenterSnapshot(seriesId, feedReels = []) {
    const scheduleMap = loadReleaseScheduleMap();
    const calendar = buildReleaseCalendar(seriesId, feedReels, scheduleMap);
    const launchReadiness = computeLaunchReadiness(calendar);
    const releaseHealth = computeReleaseHealth(calendar);

    return {
        seriesId,
        calendar,
        launchReadiness,
        releaseHealth,
        scheduleMap,
        premiereCountdown: computePremiereCountdown(releaseHealth)
    };
}

export function initReleaseCenter() {
    if (typeof window === 'undefined') return;
    window.__reelforgeRelease = {
        scheduleEpisodeRelease,
        applyBulkReleaseSchedule,
        scheduleSeasonRelease,
        buildReleaseCenterSnapshot,
        computePremiereCountdown,
        computeLaunchReadiness,
        computeReleaseHealth,
        loadReleaseScheduleMap
    };
}
