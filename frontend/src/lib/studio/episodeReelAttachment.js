/**
 * PRODUCT-02 — Episode ↔ vault reel attachment orchestration.
 * Uses attachReelToEpisode()/rebindReelToEpisode() when studio hierarchy UUID is available;
 * updates local catalog only after studio operation succeeds.
 */
import { attachReelToEpisode, rebindReelToEpisode } from '../api/studio.js';
import { attachEpisodeReel, getEpisodeById } from '../series/seriesStore.js';

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {import('../series/seriesTypes.js').Series[]} catalog
 */
export function flattenCatalogEpisodes(catalog) {
    /** @type {Array<{ episodeId: string; seriesId: string; seriesTitle: string; seasonNumber: number; episodeNumber: number; title: string; reelId: string | null; label: string }>} */
    const items = [];
    for (const series of catalog || []) {
        for (const season of series.seasons || []) {
            for (const episode of season.episodes || []) {
                items.push({
                    episodeId: episode.episodeId,
                    seriesId: series.id,
                    seriesTitle: series.title,
                    seasonNumber: season.seasonNumber,
                    episodeNumber: episode.episodeNumber,
                    title: episode.title,
                    reelId: episode.reelId || null,
                    label: `${series.title} · S${season.seasonNumber}E${String(episode.episodeNumber).padStart(2, '0')} — ${episode.title}`
                });
            }
        }
    }
    return items;
}

/**
 * @param {{ seriesId?: string; seriesTitle?: string; seasonNumber: number; episodeNumber: number }} episodeRow
 * @param {Record<string, unknown> | null | undefined} projectTree
 * @returns {string | null}
 */
export function resolveStudioEpisodeUuid(episodeRow, projectTree) {
    if (!projectTree?.series?.length || !episodeRow) return null;
    const series = projectTree.series.find(
        (s) =>
            s.id === episodeRow.seriesId ||
            String(s.title || '').toLowerCase() === String(episodeRow.seriesTitle || '').toLowerCase()
    );
    if (!series) return null;
    const season = (series.seasons || []).find((s) => s.season_number === episodeRow.seasonNumber);
    if (!season) return null;
    const ep = (season.episodes || []).find((e) => e.episode_number === episodeRow.episodeNumber);
    if (!ep?.id || !UUID_RE.test(String(ep.id))) return null;
    return String(ep.id);
}

/**
 * @param {Record<string, unknown> | null | undefined} projectTree
 * @param {string} reelId
 * @returns {string | null}
 */
export function resolveCurrentStudioOwnerEpisodeUuid(projectTree, reelId) {
    if (!projectTree?.series?.length || !UUID_RE.test(String(reelId || ''))) return null;
    const targetReel = String(reelId);
    for (const series of projectTree.series || []) {
        for (const season of series.seasons || []) {
            for (const ep of season.episodes || []) {
                if (String(ep?.reel_id || '') !== targetReel) continue;
                if (ep?.id && UUID_RE.test(String(ep.id))) return String(ep.id);
            }
        }
    }
    return null;
}

/**
 * @param {string} episodeId
 * @param {string} reelId
 * @param {Record<string, unknown> | null | undefined} projectTree
 * @param {{ replaceExisting?: boolean }} [options]
 */
export async function performEpisodeReelAttach(episodeId, reelId, projectTree, options = {}) {
    const ctx = getEpisodeById(episodeId);
    if (!ctx) {
        throw new Error('Episode not found in series catalog');
    }
    if (!reelId) {
        throw new Error('Select a vault reel to attach');
    }

    const existingReelId = ctx.episode.reelId || null;
    if (existingReelId && existingReelId !== reelId && !options.replaceExisting) {
        return {
            ok: false,
            needsReplaceConfirm: true,
            existingReelId,
            episodeId,
            reelId
        };
    }

    let studioAttached = false;
    let studioError = null;
    let studioRebound = false;
    const studioUuid = resolveStudioEpisodeUuid(
        {
            seriesId: ctx.series.id,
            seriesTitle: ctx.series.title,
            seasonNumber: ctx.season.seasonNumber,
            episodeNumber: ctx.episode.episodeNumber
        },
        projectTree
    );

    const resolvedStudioEpisodeId = studioUuid
        ? studioUuid
        : UUID_RE.test(episodeId)
          ? episodeId
          : null;

    if (!resolvedStudioEpisodeId || !UUID_RE.test(reelId)) {
        throw new Error('Studio episode mapping unavailable; attachment aborted');
    }

    try {
        await attachReelToEpisode(resolvedStudioEpisodeId, reelId);
        studioAttached = true;
    } catch (err) {
        studioError = err?.message || String(err);
        const alreadyBound =
            /already attached to another episode/i.test(studioError) ||
            /reelalreadybound/i.test(studioError);
        if (!alreadyBound) {
            throw new Error(studioError || 'Studio attach failed');
        }
        const sourceEpisodeId = resolveCurrentStudioOwnerEpisodeUuid(projectTree, reelId);
        if (!sourceEpisodeId) {
            throw new Error('Studio rebind requires source episode, but current owner was not found');
        }
        if (sourceEpisodeId === resolvedStudioEpisodeId) {
            studioAttached = true;
            studioRebound = true;
            studioError = null;
        } else {
            await rebindReelToEpisode(resolvedStudioEpisodeId, reelId, sourceEpisodeId);
            studioAttached = true;
            studioRebound = true;
            studioError = null;
        }
    }

    const localOk = attachEpisodeReel(episodeId, reelId);
    if (!localOk) {
        throw new Error('Failed to update episode in series catalog');
    }

    return {
        ok: true,
        needsReplaceConfirm: false,
        localOk,
        studioAttached,
        studioError,
        studioRebound,
        episodeId,
        reelId,
        episodeLabel: `S${ctx.season.seasonNumber}E${ctx.episode.episodeNumber} — ${ctx.episode.title}`
    };
}

/**
 * @param {unknown} reel
 * @returns {string}
 */
export function reelDisplayName(reel) {
    if (!reel || typeof reel !== 'object') return 'Untitled reel';
    const r = /** @type {Record<string, unknown>} */ (reel);
    return String(r.name || r.title || r.fileName || r.file_name || r.id || 'Untitled reel');
}

/**
 * @param {unknown} reel
 * @returns {string}
 */
export function reelStatusLabel(reel) {
    if (!reel || typeof reel !== 'object') return 'unknown';
    const r = /** @type {Record<string, unknown>} */ (reel);
    return String(r.status || r.ingest_status || 'ready');
}
