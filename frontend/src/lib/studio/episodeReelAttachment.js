/**
 * PRODUCT-02 — Episode ↔ vault reel attachment orchestration.
 * Uses attachReelToEpisode() when studio hierarchy UUID is available;
 * always updates local catalog via attachEpisodeReel().
 */
import { attachReelToEpisode } from '../api/studio.js';
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

    const localOk = attachEpisodeReel(episodeId, reelId);
    if (!localOk) {
        throw new Error('Failed to update episode in series catalog');
    }

    let studioAttached = false;
    let studioError = null;
    const studioUuid = resolveStudioEpisodeUuid(
        {
            seriesId: ctx.series.id,
            seriesTitle: ctx.series.title,
            seasonNumber: ctx.season.seasonNumber,
            episodeNumber: ctx.episode.episodeNumber
        },
        projectTree
    );

    if (studioUuid && UUID_RE.test(reelId)) {
        try {
            await attachReelToEpisode(studioUuid, reelId);
            studioAttached = true;
        } catch (err) {
            studioError = err?.message || String(err);
        }
    } else if (UUID_RE.test(episodeId) && UUID_RE.test(reelId)) {
        try {
            await attachReelToEpisode(episodeId, reelId);
            studioAttached = true;
        } catch (err) {
            studioError = err?.message || String(err);
        }
    }

    return {
        ok: true,
        needsReplaceConfirm: false,
        localOk,
        studioAttached,
        studioError,
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
