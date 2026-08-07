/**
 * High-confidence vault title → canonical series/episode binding.
 *
 * Only infers when episode numbers are explicit in titles.
 * Persists via seriesStore APIs (does not invent a parallel store).
 * Does not modify mockSeriesData.js.
 */

import { get } from 'svelte/store';
import {
    attachEpisodeReel,
    bindEpisodeToFeedReel,
    getEpisodeById,
    getEpisodeByReelId,
    getReelSeriesMetadata,
    getSeriesById,
    saveReelSeriesMetadata,
    seriesCatalog
} from './seriesStore.js';

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {Record<string, unknown>} detail
 */
export function logVaultSeriesInference(detail = {}) {
    console.info('[VAULT_SERIES_INFERENCE]', {
        ...detail,
        ts: new Date().toISOString()
    });
}

/**
 * @param {string} value
 */
export function slugifySeriesKey(value) {
    return (
        String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48) || 'series'
    );
}

/**
 * @param {string} raw
 */
function stripMediaExtension(raw) {
    return String(raw || '')
        .trim()
        .replace(/\.(mp4|mov|webm|m4v|avi|mkv)$/i, '')
        .trim();
}

/**
 * @param {string} raw
 */
function cleanSeriesBase(raw) {
    return String(raw || '')
        .replace(/[\s\-_.]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Parse only high-confidence episode titles (explicit season/ep or trailing number).
 *
 * @param {string | null | undefined} rawTitle
 * @returns {{
 *   seriesTitle: string;
 *   seasonNumber: number;
 *   episodeNumber: number;
 *   confidence: string;
 * } | null}
 */
export function parseHighConfidenceEpisodeTitle(rawTitle) {
    let text = stripMediaExtension(rawTitle);
    if (!text || text.length < 3) return null;
    if (UUID_RE.test(text)) return null;
    if (/^img[_\s-]?\d+/i.test(text)) return null;
    if (/^hero[-_\s]?background/i.test(text)) return null;
    if (/^untitled/i.test(text)) return null;

    // NAME V1(2) / NAME V1 (2) — version + episode in parens
    let m = text.match(/^(.*?)[\s\-_.]*[Vv]\d+\s*[\(\[]\s*(\d{1,3})\s*[\)\]]\s*$/);
    if (m) {
        const seriesTitle = cleanSeriesBase(m[1]);
        if (seriesTitle.length >= 2) {
            return {
                seriesTitle,
                seasonNumber: 1,
                episodeNumber: Math.max(1, Number(m[2]) || 1),
                confidence: 'version-paren-ep'
            };
        }
    }

    // NAME S01E02 / NAME S1E2
    m = text.match(/^(.*?)[\s\-_.]*(?:[\[(])?S(\d{1,2})\s*[Ee](\d{1,3})[\])]?\s*$/i);
    if (m) {
        const seriesTitle = cleanSeriesBase(m[1]);
        if (seriesTitle.length >= 2) {
            return {
                seriesTitle,
                seasonNumber: Math.max(1, Number(m[2]) || 1),
                episodeNumber: Math.max(1, Number(m[3]) || 1),
                confidence: 'sxe'
            };
        }
    }

    // NAME EP 2 / NAME Episode 3
    m = text.match(/^(.*?)[\s\-_.]+(?:ep(?:isode)?[\s\-_.]*)(\d{1,3})\s*$/i);
    if (m) {
        const seriesTitle = cleanSeriesBase(m[1]);
        if (seriesTitle.length >= 2) {
            return {
                seriesTitle,
                seasonNumber: 1,
                episodeNumber: Math.max(1, Number(m[2]) || 1),
                confidence: 'ep-token'
            };
        }
    }

    // NAME 1 / STIRRED 1 — requires letter in base + standalone trailing number
    m = text.match(/^(?=.*[A-Za-z])(.+?)[\s\-_.]+(\d{1,3})\s*$/);
    if (m) {
        const seriesTitle = cleanSeriesBase(m[1]);
        // Avoid pure camera dumps and year-only bases
        if (
            seriesTitle.length >= 2 &&
            !/^\d+$/.test(seriesTitle) &&
            !/^dsc/i.test(seriesTitle) &&
            !/^vid_/i.test(seriesTitle)
        ) {
            return {
                seriesTitle,
                seasonNumber: 1,
                episodeNumber: Math.max(1, Number(m[2]) || 1),
                confidence: 'trailing-number'
            };
        }
    }

    return null;
}

/**
 * @param {unknown} reelId
 */
export function isRealVaultUuid(reelId) {
    return UUID_RE.test(String(reelId || '').trim());
}

/**
 * @param {Record<string, unknown> | null | undefined} reel
 */
function reelDisplayTitle(reel) {
    return String(reel?.name || reel?.title || reel?.fileName || reel?.file_name || '').trim();
}

/**
 * @param {Record<string, unknown> | null | undefined} reel
 */
function hasPlayableMedia(reel) {
    const url = String(reel?.url || reel?.video_url || reel?.videoUrl || '').trim();
    return Boolean(reel?.id && url && !url.startsWith('blob:'));
}

/**
 * @param {string} reelId
 */
export function isReelAlreadySeriesBound(reelId) {
    const id = String(reelId || '').trim();
    if (!id) return true;
    if (getEpisodeByReelId(id)) return true;
    const meta = getReelSeriesMetadata(id);
    if (meta?.episodeId && getEpisodeById(String(meta.episodeId))) return true;
    // Explicit studio structured metadata — do not override
    if (meta?.seriesId && meta?.episodeNumber && String(meta.seriesName || '').trim()) {
        if (getSeriesById(String(meta.seriesId))) return true;
    }
    return false;
}

/**
 * @param {string} seriesTitle
 */
function ensureSeriesInCatalog(seriesTitle) {
    const title = cleanSeriesBase(seriesTitle);
    const slug = slugifySeriesKey(title);
    const seriesId = `series-${slug}`;

    const byId = getSeriesById(seriesId);
    if (byId) return byId;

    const byTitle = get(seriesCatalog).find(
        (s) => String(s.title || '').trim().toLowerCase() === title.toLowerCase()
    );
    if (byTitle) return byTitle;

    /** @type {import('./seriesTypes.js').Series} */
    const created = {
        id: seriesId,
        title,
        description: `Vault-inferred series: ${title}`,
        tags: ['vault-inferred'],
        seasons: [
            {
                seasonId: `season-${slug}-1`,
                seasonNumber: 1,
                title: 'Season 1',
                episodes: []
            }
        ]
    };

    seriesCatalog.update((items) => {
        if (items.some((s) => s.id === seriesId)) return items;
        return [...items, created];
    });

    logVaultSeriesInference({
        phase: 'series-created',
        seriesId,
        seriesTitle: title,
        source: 'vault-title-inference'
    });

    return getSeriesById(seriesId) || created;
}

/**
 * Ensure episode exists in series catalog.
 * @param {string} seriesId
 * @param {number} seasonNumber
 * @param {number} episodeNumber
 * @param {string} episodeTitle
 * @returns {import('./seriesTypes.js').Episode | null}
 */
function ensureEpisodeInCatalog(seriesId, seasonNumber, episodeNumber, episodeTitle) {
    const series = getSeriesById(seriesId);
    if (!series) return null;

    const slug = slugifySeriesKey(seriesId.replace(/^series-/, '') || series.title);
    const episodeId = `ep-${slug}-s${String(seasonNumber).padStart(2, '0')}e${String(episodeNumber).padStart(2, '0')}`;

    const existingCtx = getEpisodeById(episodeId);
    if (existingCtx?.episode) return existingCtx.episode;

    const seasonHit = series.seasons?.find((s) => s.seasonNumber === seasonNumber);
    const existingByNumber = seasonHit?.episodes?.find((e) => e.episodeNumber === episodeNumber);
    if (existingByNumber) {
        return getEpisodeById(existingByNumber.episodeId)?.episode || existingByNumber;
    }

    /** @type {import('./seriesTypes.js').Episode} */
    const episode = {
        episodeId,
        episodeNumber,
        title: episodeTitle,
        status: 'published',
        reelId: null,
        tags: ['vault-inferred']
    };

    seriesCatalog.update((items) =>
        items.map((s) => {
            if (s.id !== seriesId) return s;
            const seasons = Array.isArray(s.seasons) ? [...s.seasons] : [];
            let seasonIdx = seasons.findIndex((se) => se.seasonNumber === seasonNumber);
            if (seasonIdx < 0) {
                seasons.push({
                    seasonId: `season-${slug}-${seasonNumber}`,
                    seasonNumber,
                    title: `Season ${seasonNumber}`,
                    episodes: [episode]
                });
            } else {
                const season = { ...seasons[seasonIdx] };
                const episodes = Array.isArray(season.episodes) ? [...season.episodes] : [];
                if (episodes.some((e) => e.episodeId === episodeId || e.episodeNumber === episodeNumber)) {
                    return s;
                }
                episodes.push(episode);
                episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
                season.episodes = episodes;
                seasons[seasonIdx] = season;
            }
            return { ...s, seasons };
        })
    );

    logVaultSeriesInference({
        phase: 'episode-created',
        seriesId,
        episodeId,
        episodeNumber,
        episodeTitle,
        source: 'vault-title-inference'
    });

    return getEpisodeById(episodeId)?.episode || episode;
}

/**
 * Group vault reels with high-confidence title parses that share a series base.
 *
 * @param {Record<string, unknown>[]} reels
 */
export function buildHighConfidenceTitleGroups(reels = []) {
    /** @type {Map<string, Array<{ reel: Record<string, unknown>; parsed: ReturnType<typeof parseHighConfidenceEpisodeTitle> }>>} */
    const groups = new Map();

    for (const reel of reels) {
        if (!reel?.id || !hasPlayableMedia(reel)) continue;
        if (!isRealVaultUuid(reel.id)) continue;
        if (isReelAlreadySeriesBound(String(reel.id))) continue;

        const parsed = parseHighConfidenceEpisodeTitle(reelDisplayTitle(reel));
        if (!parsed) continue;

        const key = parsed.seriesTitle.toLowerCase();
        const list = groups.get(key) || [];
        list.push({ reel, parsed });
        groups.set(key, list);
    }

    /** @type {Array<{ seriesTitle: string; members: typeof groups extends Map<string, infer V> ? V : never }>} */
    const out = [];
    for (const [, members] of groups) {
        if (!members.length) continue;
        // High confidence: at least one explicit-number parse (always true here).
        // Prefer multi-member groups; allow singleton when confidence is sxe / ep-token / trailing-number / version-paren.
        const seriesTitle = members[0].parsed.seriesTitle;
        out.push({ seriesTitle, members });
    }
    return out;
}

/**
 * Infer series/episodes from vault titles and bind via seriesStore APIs.
 *
 * @param {Record<string, unknown>[]} reels
 * @param {{ source?: string }} [options]
 * @returns {{ bound: number; skipped: number; groups: number; seriesIds: string[]; bindings: Array<Record<string, unknown>> }}
 */
export function inferAndBindVaultSeries(reels = [], options = {}) {
    const source = options.source || 'vault-inference';
    const groups = buildHighConfidenceTitleGroups(reels);

    logVaultSeriesInference({
        phase: 'start',
        source,
        reelCount: reels.filter((r) => r?.id).length,
        groupCount: groups.length
    });

    let bound = 0;
    let skipped = 0;
    /** @type {string[]} */
    const seriesIds = [];
    /** @type {Array<Record<string, unknown>>} */
    const bindings = [];

    for (const group of groups) {
        const series = ensureSeriesInCatalog(group.seriesTitle);
        if (!series?.id) {
            skipped += group.members.length;
            continue;
        }
        if (!seriesIds.includes(series.id)) seriesIds.push(series.id);

        // Dedupe episode numbers within group (keep first reel)
        /** @type {Map<string, typeof group.members[0]>} */
        const byEpKey = new Map();
        for (const member of group.members) {
            const key = `${member.parsed.seasonNumber}:${member.parsed.episodeNumber}`;
            if (!byEpKey.has(key)) byEpKey.set(key, member);
            else skipped += 1;
        }

        for (const member of byEpKey.values()) {
            const reelId = String(member.reel.id);
            if (isReelAlreadySeriesBound(reelId)) {
                skipped += 1;
                continue;
            }

            const episodeTitle = reelDisplayTitle(member.reel) || group.seriesTitle;
            const episode = ensureEpisodeInCatalog(
                series.id,
                member.parsed.seasonNumber,
                member.parsed.episodeNumber,
                episodeTitle
            );
            const episodeId = episode?.episodeId ? String(episode.episodeId) : '';
            if (!episodeId) {
                skipped += 1;
                logVaultSeriesInference({
                    phase: 'episode-ensure-failed',
                    seriesId: series.id,
                    mediaId: reelId,
                    source
                });
                continue;
            }

            // attachEpisodeReel → bindEpisodeToFeedReel (catalog reelId + metadata seed)
            let attached = false;
            try {
                attached = Boolean(attachEpisodeReel(episodeId, reelId));
            } catch (err) {
                logVaultSeriesInference({
                    phase: 'attach-error',
                    seriesId: series.id,
                    episodeId,
                    mediaId: reelId,
                    error: err?.message || String(err),
                    source
                });
            }
            if (!attached) {
                const boundOk = bindEpisodeToFeedReel(reelId, episodeId, {
                    seriesId: series.id,
                    seriesName: series.title,
                    seasonNumber: member.parsed.seasonNumber,
                    episodeNumber: member.parsed.episodeNumber,
                    episodeTitle,
                    episodeStatus: 'published'
                });
                if (!boundOk) {
                    skipped += 1;
                    logVaultSeriesInference({
                        phase: 'bind-failed',
                        seriesId: series.id,
                        episodeId,
                        mediaId: reelId,
                        source
                    });
                    continue;
                }
            }

            // Authoritative studio map write (includes seriesName, S/E, episodeId)
            const saved = saveReelSeriesMetadata(reelId, {
                reelId,
                seriesId: series.id,
                seriesName: series.title,
                seasonNumber: member.parsed.seasonNumber,
                episodeNumber: member.parsed.episodeNumber,
                episodeTitle,
                episodeId,
                episodeStatus: 'published'
            });

            const byReel = getEpisodeByReelId(reelId);
            if (!byReel?.episode || String(byReel.episode.reelId) !== reelId) {
                skipped += 1;
                logVaultSeriesInference({
                    phase: 'post-bind-verify-failed',
                    seriesId: series.id,
                    episodeId,
                    mediaId: reelId,
                    metaEpisodeId: saved?.episodeId || null,
                    source
                });
                continue;
            }

            bound += 1;
            bindings.push({
                mediaId: reelId,
                seriesId: series.id,
                episodeId,
                seasonNumber: member.parsed.seasonNumber,
                episodeNumber: member.parsed.episodeNumber,
                confidence: member.parsed.confidence,
                metadata: {
                    reelId: saved?.reelId || reelId,
                    seriesId: saved?.seriesId || series.id,
                    seriesName: saved?.seriesName || series.title,
                    seasonNumber: saved?.seasonNumber ?? member.parsed.seasonNumber,
                    episodeNumber: saved?.episodeNumber ?? member.parsed.episodeNumber,
                    episodeTitle: saved?.episodeTitle || episodeTitle,
                    episodeId: saved?.episodeId || episodeId
                }
            });

            logVaultSeriesInference({
                phase: 'bound',
                source,
                seriesId: series.id,
                episodeId,
                mediaId: reelId,
                seriesTitle: series.title,
                episodeTitle,
                confidence: member.parsed.confidence
            });
        }
    }

    logVaultSeriesInference({
        phase: 'complete',
        source,
        bound,
        skipped,
        groups: groups.length,
        seriesIds
    });

    return { bound, skipped, groups: groups.length, seriesIds, bindings };
}
