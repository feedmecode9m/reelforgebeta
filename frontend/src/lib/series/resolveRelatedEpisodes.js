/**
 * Canonical related-episode resolver (Series Identity Graph — Phase 1).
 *
 * One relationship intelligence path for Theater, Catalog, Search, and discovery.
 * Does not create a second series store — reads ready vault assets + existing catalog/
 * reel metadata, then unions incomplete catalog rows with vault siblings.
 *
 * Priority:
 *   1. Explicit seriesId / episodeId / reel metadata
 *   2. Existing catalog relationships
 *   3. Entity / title normalization (+ franchise upgrade from free-form pilots)
 *   4. Creator identity
 *   5. Shared franchise tokens
 *   6. Description references
 *   7. Episode-number parse patterns (via vaultSeriesInference)
 */

import { getEpisodeById, getEpisodeByReelId, getReelSeriesMetadata, getSeriesById } from './seriesStore.js';
import { getReadyHeroVaultAssets } from './heroVaultAssetSource.js';
import { assetIdOf } from './episodeVaultResolver.js';
import {
    parseHighConfidenceEpisodeTitle,
    slugifySeriesKey,
    stripProductionTitlePrefixes
} from './vaultSeriesInference.js';

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STOP = new Set([
    'the',
    'a',
    'an',
    'and',
    'of',
    'to',
    'in',
    'for',
    'on',
    'at',
    'ep',
    'episode',
    'part',
    'pt',
    's',
    'e',
    'v'
]);

/**
 * @typedef {Object} HeroVaultSeriesLabel
 * @property {string} assetId
 * @property {string} title
 * @property {string} seriesLabel
 * @property {number} seasonNumber
 * @property {number} episodeNumber
 * @property {string} episodeTitle
 */

/**
 * @typedef {Object} RelatedEpisodeMember
 * @property {string} assetId
 * @property {string | null} reelId
 * @property {string} title
 * @property {number} episodeNumber
 * @property {number} seasonNumber
 * @property {string} mediaUrl
 * @property {string} thumbnailUrl
 * @property {string} [seriesLabel]
 * @property {string} [episodeId]
 * @property {string} [source]
 * @property {number} [createdAtMs]
 * @property {number} [vaultIndex]
 */

/**
 * @typedef {Object} RelatedEpisodesResult
 * @property {string | null} seriesId
 * @property {string} seriesTitle
 * @property {RelatedEpisodeMember[]} members
 * @property {{ entity: string; franchise: string } | null} [identity]
 */

/**
 * @param {unknown} value
 */
function stripMediaExtension(value) {
    return String(value || '')
        .trim()
        .replace(/\.(mp4|mov|webm|m4v|avi|mkv)$/i, '')
        .trim();
}

/**
 * @param {unknown} value
 */
function cleanSpaces(value) {
    return String(value || '')
        .replace(/[\s\-_.]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * @param {unknown} value
 */
export function normalizeSeriesText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Strip episode markers / suffixes so franchise roots remain.
 * @param {unknown} rawTitle
 */
export function stripEpisodeDecorFromTitle(rawTitle) {
    let text = stripProductionTitlePrefixes(stripMediaExtension(rawTitle));
    if (!text) return '';

    // EPISODE 2 - subtitle (mid/end)
    text = text.replace(/[\s\-_.]+(?:ep(?:isode)?[\s\-_.]*)\d{1,3}(?:[\s\-_.]+.*)?$/i, '');
    // S01E02 + optional trailing
    text = text.replace(/[\s\-_.]*(?:[\[(])?S\d{1,2}\s*[Ee]\d{1,3}[\])]?(?:[\s\-_.]+.*)?$/i, '');
    // trailing V1 / V1(2)
    text = text.replace(/[\s\-_.]+[Vv]\d{1,3}(?:\s*[\(\[]\s*\d{1,3}\s*[\)\]])?\s*$/i, '');
    // trailing standalone number (STIRRED 2)
    text = text.replace(/[\s\-_.]+(\d{1,3})\s*$/i, (full, num, offset, whole) => {
        // Keep years occasionally mistaken for episodes when base is short
        const asNum = Number(num);
        if (asNum >= 1900 && asNum <= 2100) return full;
        return '';
    });

    return cleanSpaces(text);
}

/**
 * Identity token stream — keeps single-letter tokens after a longer word (Vic G).
 * @param {unknown} title
 * @returns {string[]}
 */
export function identityTokens(title) {
    const root = stripEpisodeDecorFromTitle(title);
    if (!root) return [];
    return normalizeSeriesText(root)
        .split(' ')
        .map((t) => t.trim())
        .filter(Boolean)
        .filter((t) => !STOP.has(t));
}

/**
 * Shared entity key (e.g. "vic g") from identity tokens.
 * @param {string[]} tokens
 */
export function entityKeyFromTokens(tokens) {
    if (!tokens?.length) return '';
    // Prefer first two tokens when second is single char or both short name parts
    if (tokens.length >= 2 && (tokens[1].length <= 2 || tokens[0].length <= 4)) {
        return `${tokens[0]} ${tokens[1]}`.trim();
    }
    // Franchise root keyword
    if (tokens[0].length >= 4) return tokens[0];
    if (tokens.length >= 2) return `${tokens[0]} ${tokens[1]}`.trim();
    return tokens[0] || '';
}

/**
 * @param {string[]} a
 * @param {string[]} b
 */
export function sharesEntityTokenPrefix(a, b) {
    if (!a?.length || !b?.length) return false;
    const short = a.length <= b.length ? a : b;
    const long = a.length <= b.length ? b : a;
    // Shorter token list is full prefix of longer
    if (short.length >= 2 && short.every((t, i) => long[i] === t)) return true;
    // Long franchise keyword head
    if (short.length === 1 && short[0].length >= 5 && long[0] === short[0]) return true;
    // Shared first 2 tokens
    if (a.length >= 2 && b.length >= 2 && a[0] === b[0] && a[1] === b[1]) return true;
    return false;
}

/**
 * @param {Record<string, unknown> | null | undefined} item
 */
function displayTitleOf(item) {
    return String(
        item?.name || item?.title || item?.fileName || item?.file_name || item?.assetId || ''
    ).trim();
}

/**
 * @param {Record<string, unknown> | null | undefined} item
 */
function mediaUrlOf(item) {
    return String(
        item?.url || item?.video_url || item?.videoUrl || item?.mediaUrl || item?.src || ''
    ).trim();
}

/**
 * @param {Record<string, unknown> | null | undefined} item
 */
function thumbnailUrlOf(item) {
    return String(
        item?.thumbnailUrl || item?.thumbnail_url || item?.thumbnail || item?.posterUrl || ''
    ).trim();
}

/**
 * @param {Record<string, unknown> | null | undefined} item
 */
function creatorKeyOf(item) {
    return normalizeSeriesText(
        item?.creatorId ||
            item?.creator_id ||
            item?.userId ||
            item?.user_id ||
            item?.ownerId ||
            item?.owner_id ||
            item?.creatorName ||
            item?.creator_name ||
            ''
    );
}

/**
 * @param {Record<string, unknown> | null | undefined} item
 */
function descriptionOf(item) {
    return String(item?.description || item?.synopsis || item?.summary || '').trim();
}

/**
 * @param {Record<string, unknown> | null | undefined} assetOrReel
 */
function resolveSeedId(assetOrReel) {
    return String(
        assetOrReel?.id || assetOrReel?.assetId || assetOrReel?.reelId || assetOrReel?.reel_id || ''
    ).trim();
}

/**
 * Prefer longest free-form (no episode number) title as franchise / series name.
 * @param {Array<{ title: string; parsed: ReturnType<typeof parseHighConfidenceEpisodeTitle>; isFreeForm: boolean }>} pool
 */
export function pickFranchiseTitle(pool) {
    if (!pool?.length) return '';
    const free = pool.filter((p) => p.isFreeForm && p.title);
    const candidates = free.length ? free : pool;
    let best = candidates[0].title;
    for (const c of candidates) {
        if (String(c.title || '').length > String(best || '').length) best = c.title;
    }
    // Prefer de-marked franchise root length when free-form differs
    for (const c of free) {
        const decor = stripEpisodeDecorFromTitle(c.title);
        if (decor.length > stripEpisodeDecorFromTitle(best).length) best = c.title;
    }
    return cleanSpaces(best);
}

/**
 * @param {string} title
 * @param {ReturnType<typeof parseHighConfidenceEpisodeTitle>} parsed
 */
function episodeNumberForTitle(title, parsed) {
    if (parsed?.episodeNumber != null && Number.isFinite(parsed.episodeNumber)) {
        return Math.max(1, Number(parsed.episodeNumber));
    }
    // Free-form pilot / master entry when no explicit number
    return 1;
}

/**
 * Viewer-facing series label normalization from Hero Vault titles / metadata.
 * Example: "STIRRED S01E01" → { seriesLabel:"STIRRED", seasonNumber:1, episodeNumber:1 }
 *
 * Does not touch Hero Manager UI — pure label parsing for Theater relationships.
 *
 * @param {Record<string, unknown> | string | null | undefined} assetOrTitle
 * @returns {HeroVaultSeriesLabel}
 */
export function normalizeHeroVaultSeriesLabel(assetOrTitle) {
    const isObj = assetOrTitle && typeof assetOrTitle === 'object';
    /** @type {Record<string, unknown>} */
    const item = isObj ? /** @type {Record<string, unknown>} */ (assetOrTitle) : {};
    const title = isObj
        ? displayTitleOf(item)
        : String(assetOrTitle || '')
              .trim()
              .replace(/\.(mp4|mov|webm|m4v|avi|mkv)$/i, '');
    const assetId = isObj
        ? String(resolveSeedId(item) || assetIdOf(item) || '').trim()
        : '';

    // Explicit vault metadata fields win when present
    const explicitLabel = String(
        item.seriesLabel || item.series_label || item.seriesName || item.series_name || ''
    ).trim();
    const explicitSeason = Number(item.seasonNumber ?? item.season_number);
    const explicitEpisode = Number(item.episodeNumber ?? item.episode_number);
    const explicitEpisodeTitle = String(
        item.episodeTitle || item.episode_title || ''
    ).trim();

    if (
        explicitLabel &&
        Number.isFinite(explicitSeason) &&
        explicitSeason >= 1 &&
        Number.isFinite(explicitEpisode) &&
        explicitEpisode >= 1
    ) {
        return {
            assetId,
            title: title || explicitEpisodeTitle || explicitLabel,
            seriesLabel: explicitLabel,
            seasonNumber: Math.max(1, Math.floor(explicitSeason)),
            episodeNumber: Math.max(1, Math.floor(explicitEpisode)),
            episodeTitle: explicitEpisodeTitle || title || explicitLabel
        };
    }

    const parsed = parseHighConfidenceEpisodeTitle(title);
    if (parsed) {
        return {
            assetId,
            title: title || String(parsed.episodeTitle || ''),
            seriesLabel: String(parsed.seriesTitle || '').trim() || stripEpisodeDecorFromTitle(title),
            seasonNumber: Math.max(1, Number(parsed.seasonNumber) || 1),
            episodeNumber: Math.max(1, Number(parsed.episodeNumber) || 1),
            episodeTitle: String(parsed.episodeTitle || title || '').trim()
        };
    }

    const seriesLabel =
        explicitLabel || stripEpisodeDecorFromTitle(title) || title || 'Series';
    return {
        assetId,
        title: title || seriesLabel,
        seriesLabel: cleanSpaces(seriesLabel),
        seasonNumber:
            Number.isFinite(explicitSeason) && explicitSeason >= 1
                ? Math.floor(explicitSeason)
                : 1,
        episodeNumber:
            Number.isFinite(explicitEpisode) && explicitEpisode >= 1
                ? Math.floor(explicitEpisode)
                : 1,
        episodeTitle: explicitEpisodeTitle || title || seriesLabel
    };
}

/**
 * @param {Record<string, unknown> | null | undefined} asset
 * @returns {number}
 */
function createdAtMsOf(asset) {
    const raw =
        asset?.createdAt ||
        asset?.created_at ||
        asset?.addedAt ||
        asset?.added_at ||
        asset?.uploadedAt ||
        '';
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    const t = Date.parse(String(raw || ''));
    return Number.isFinite(t) ? t : 0;
}

/**
 * @param {string} seedTitle
 * @param {string} otherTitle
 * @param {string} seedDesc
 * @param {string} otherDesc
 * @param {string} seedCreator
 * @param {string} otherCreator
 */
function titlesRelated(seedTitle, otherTitle, seedDesc, otherDesc, seedCreator, otherCreator) {
    const ta = identityTokens(seedTitle);
    const tb = identityTokens(otherTitle);
    if (sharesEntityTokenPrefix(ta, tb)) return true;

    // Creator identity when both set and entity head token matches
    if (seedCreator && otherCreator && seedCreator === otherCreator) {
        if (ta[0] && tb[0] && ta[0] === tb[0]) return true;
    }

    // Description references the other display title fragment
    const na = normalizeSeriesText(seedTitle);
    const nb = normalizeSeriesText(otherTitle);
    const da = normalizeSeriesText(seedDesc);
    const db = normalizeSeriesText(otherDesc);
    if (na.length >= 6 && db.includes(na)) return true;
    if (nb.length >= 6 && da.includes(nb)) return true;

    // Shared franchise token spans (3+ consecutive shared from identity stream is handled by prefix;
    // also allow equal entity key from first two tokens)
    const ea = entityKeyFromTokens(ta);
    const eb = entityKeyFromTokens(tb);
    if (ea && eb && ea === eb) return true;

    return false;
}

/**
 * Collect catalog episode members for a series id.
 * @param {string} seriesId
 * @returns {RelatedEpisodeMember[]}
 */
function membersFromCatalog(seriesId) {
    const series = seriesId ? getSeriesById(seriesId) : null;
    if (!series) return [];
    /** @type {RelatedEpisodeMember[]} */
    const out = [];
    for (const season of series.seasons || []) {
        for (const ep of season.episodes || []) {
            const reelId = ep.reelId ? String(ep.reelId) : null;
            const assetId = String(ep.mediaAssetId || ep.heroVaultAssetId || reelId || ep.episodeId || '');
            out.push({
                assetId: assetId || String(ep.episodeId || ''),
                reelId,
                title: String(ep.title || `Episode ${ep.episodeNumber}`),
                episodeNumber: Number(ep.episodeNumber) || 1,
                seasonNumber: Number(season.seasonNumber) || 1,
                mediaUrl: '',
                thumbnailUrl: '',
                episodeId: String(ep.episodeId || ''),
                source: 'catalog'
            });
        }
    }
    return out;
}

/**
 * @param {RelatedEpisodeMember[]} list
 * @returns {RelatedEpisodeMember[]}
 */
function dedupeMembers(list) {
    /** @type {Map<string, RelatedEpisodeMember>} */
    const byKey = new Map();
    for (const m of list) {
        const key =
            (m.reelId && `r:${m.reelId}`) ||
            (m.assetId && `a:${m.assetId}`) ||
            `t:${normalizeSeriesText(m.title)}|e${m.episodeNumber}`;
        const prev = byKey.get(key);
        if (!prev) {
            byKey.set(key, m);
            continue;
        }
        // Prefer catalog-bound reel + richer media
        byKey.set(key, {
            ...prev,
            ...m,
            mediaUrl: m.mediaUrl || prev.mediaUrl,
            thumbnailUrl: m.thumbnailUrl || prev.thumbnailUrl,
            reelId: m.reelId || prev.reelId,
            episodeId: m.episodeId || prev.episodeId,
            source: m.source === 'catalog' || prev.source === 'catalog' ? 'catalog' : m.source || prev.source
        });
    }
    return [...byKey.values()].sort((a, b) => {
        if (a.seasonNumber !== b.seasonNumber) return a.seasonNumber - b.seasonNumber;
        if (a.episodeNumber !== b.episodeNumber) return a.episodeNumber - b.episodeNumber;
        const ca = Number(a.createdAtMs) || 0;
        const cb = Number(b.createdAtMs) || 0;
        if (ca && cb && ca !== cb) return ca - cb;
        const ia = Number(a.vaultIndex);
        const ib = Number(b.vaultIndex);
        if (Number.isFinite(ia) && Number.isFinite(ib) && ia !== ib) return ia - ib;
        return String(a.title).localeCompare(String(b.title));
    });
}

/**
 * Build a Series-shaped object for Theater drawer rendering.
 * Hero Vault / related members are the spine; catalog enriches but cannot hide vault members.
 *
 * @param {RelatedEpisodesResult} related
 * @param {import('./seriesTypes.js').Series | null | undefined} [catalogSeries]
 * @returns {import('./seriesTypes.js').Series | null}
 */
export function buildSeriesViewFromRelated(related, catalogSeries = null) {
    if (!related?.members?.length && !catalogSeries) return null;

    const seriesId =
        String(related.seriesId || catalogSeries?.id || '').trim() ||
        `series-${slugifySeriesKey(related.seriesTitle || catalogSeries?.title || 'related')}`;
    // Viewer prefers vault-inferred franchise title; catalog title only when related empty.
    const seriesTitle =
        String(related.seriesTitle || catalogSeries?.title || '').trim() || 'Series';

    /** @type {Map<string, import('./seriesTypes.js').Episode & { seasonNumber?: number; seriesLabel?: string; createdAtMs?: number; vaultIndex?: number }>} */
    const episodeMap = new Map();

    /**
     * @param {import('./seriesTypes.js').Episode & { seasonNumber?: number; seriesLabel?: string; createdAtMs?: number; vaultIndex?: number }} ep
     * @param {string} key
     */
    function putEpisode(key, ep) {
        const prev = episodeMap.get(key);
        if (!prev) {
            episodeMap.set(key, ep);
            return;
        }
        // Keep vault media/reel; catalog fields enrich metadata only.
        episodeMap.set(key, {
            ...prev,
            ...ep,
            reelId: prev.reelId || ep.reelId,
            mediaAssetId: prev.mediaAssetId || ep.mediaAssetId || null,
            title: prev.title || ep.title,
            description: ep.description || prev.description,
            genre: ep.genre || prev.genre,
            tags: [...new Set([...(prev.tags || []), ...(ep.tags || [])])],
            seriesLabel: prev.seriesLabel || ep.seriesLabel,
            createdAtMs: prev.createdAtMs || ep.createdAtMs,
            vaultIndex:
                Number.isFinite(prev.vaultIndex) && prev.vaultIndex != null
                    ? prev.vaultIndex
                    : ep.vaultIndex
        });
    }

    // 1) Related / vault members first (source of truth for Theater)
    for (const m of related.members || []) {
        const episodeId =
            m.episodeId ||
            `related-${slugifySeriesKey(seriesId)}-s${m.seasonNumber}-e${m.episodeNumber}-${slugifySeriesKey(m.title)}`.slice(
                0,
                96
            );
        const key =
            (m.reelId && `r:${m.reelId}`) ||
            (m.assetId && `a:${m.assetId}`) ||
            `t:${normalizeSeriesText(m.title)}`;
        putEpisode(key, {
            episodeId,
            episodeNumber: m.episodeNumber,
            title: m.title,
            status: 'published',
            reelId: m.reelId,
            mediaAssetId: m.assetId || null,
            tags: ['vault-related'],
            seasonNumber: m.seasonNumber,
            seriesLabel: m.seriesLabel || related.seriesTitle || seriesTitle,
            createdAtMs: m.createdAtMs,
            vaultIndex: m.vaultIndex,
            thumbnailUrl: m.thumbnailUrl || undefined
        });
    }

    // 2) Catalog enrichment — fill gaps, never drop vault rows
    for (const season of catalogSeries?.seasons || []) {
        for (const ep of season.episodes || []) {
            const byReel =
                ep.reelId &&
                [...episodeMap.entries()].find(
                    ([, e]) => e.reelId && String(e.reelId) === String(ep.reelId)
                );
            if (byReel) {
                const [key, prev] = byReel;
                putEpisode(key, {
                    ...prev,
                    ...ep,
                    seasonNumber: season.seasonNumber,
                    reelId: prev.reelId || ep.reelId,
                    mediaAssetId: prev.mediaAssetId || ep.mediaAssetId || null,
                    tags: [...new Set([...(prev.tags || []), ...(ep.tags || []), 'catalog-enrich'])]
                });
                continue;
            }
            const titleKey = normalizeSeriesText(ep.title);
            const byTitle = [...episodeMap.entries()].find(
                ([, e]) => normalizeSeriesText(e.title) === titleKey
            );
            if (byTitle) {
                const [key, prev] = byTitle;
                putEpisode(key, {
                    ...prev,
                    description: ep.description || prev.description,
                    genre: ep.genre || prev.genre,
                    tags: [...new Set([...(prev.tags || []), ...(ep.tags || []), 'catalog-enrich'])],
                    reelId: prev.reelId || ep.reelId,
                    mediaAssetId: prev.mediaAssetId || ep.mediaAssetId || null
                });
                continue;
            }
            // Catalog-only episode (not in vault) — still list for completeness
            putEpisode(`c:${ep.episodeId}`, {
                ...ep,
                seasonNumber: season.seasonNumber,
                tags: [...(ep.tags || []), 'catalog-only']
            });
        }
    }

    /** @type {Map<number, Array<import('./seriesTypes.js').Episode & { seriesLabel?: string; createdAtMs?: number; vaultIndex?: number }>>} */
    const bySeason = new Map();
    for (const ep of episodeMap.values()) {
        const sn = Number(ep.seasonNumber) || 1;
        const { seasonNumber: _drop, ...rest } = ep;
        const list = bySeason.get(sn) || [];
        list.push(rest);
        bySeason.set(sn, list);
    }

    const seasons = [...bySeason.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([seasonNumber, episodes]) => ({
            seasonId: `season-${slugifySeriesKey(seriesId)}-${seasonNumber}`,
            seasonNumber,
            title: `Season ${seasonNumber}`,
            episodes: episodes.sort((a, b) => {
                if (a.episodeNumber !== b.episodeNumber) return a.episodeNumber - b.episodeNumber;
                const ca = Number(a.createdAtMs) || 0;
                const cb = Number(b.createdAtMs) || 0;
                if (ca && cb && ca !== cb) return ca - cb;
                const ia = Number(a.vaultIndex);
                const ib = Number(b.vaultIndex);
                if (Number.isFinite(ia) && Number.isFinite(ib) && ia !== ib) return ia - ib;
                return String(a.title).localeCompare(String(b.title));
            })
        }));

    if (!seasons.length) return catalogSeries || null;

    return {
        id: seriesId,
        title: seriesTitle,
        description: catalogSeries?.description || '',
        poster:
            related.members?.find((m) => m.thumbnailUrl)?.thumbnailUrl ||
            catalogSeries?.poster ||
            '',
        genre: catalogSeries?.genre,
        tags: [...new Set([...(catalogSeries?.tags || []), 'vault-inferred', 'related-resolver'])],
        seasons
    };
}

/**
 * Canonical related-episode resolution.
 *
 * @param {Record<string, unknown> | null | undefined} assetOrReel
 * @param {{
 *   readyAssets?: Record<string, unknown>[];
 *   items?: Record<string, unknown>[];
 *   extraItems?: Record<string, unknown>[];
 * }} [options]
 * @returns {RelatedEpisodesResult}
 */
export function resolveRelatedEpisodes(assetOrReel, options = {}) {
    /** @type {RelatedEpisodesResult} */
    const empty = {
        seriesId: null,
        seriesTitle: '',
        members: [],
        identity: null
    };

    if (!assetOrReel || typeof assetOrReel !== 'object') return empty;

    const seedId = resolveSeedId(assetOrReel);
    const seedTitle = displayTitleOf(assetOrReel);
    const seedCreator = creatorKeyOf(assetOrReel);
    const seedDesc = descriptionOf(assetOrReel);
    const seedMedia = mediaUrlOf(assetOrReel);

    /** @type {Record<string, unknown>[]} */
    let readyAssets = Array.isArray(options.readyAssets)
        ? options.readyAssets
        : getReadyHeroVaultAssets({
              items: options.items,
              extraItems: options.extraItems
          });

    // Ensure seed is in pool even if filters excluded it (tests / partial lists)
    if (seedId && !readyAssets.some((a) => assetIdOf(a) === seedId || resolveSeedId(a) === seedId)) {
        readyAssets = [...readyAssets, assetOrReel];
    } else if (!seedId && seedTitle) {
        readyAssets = readyAssets.some((a) => displayTitleOf(a) === seedTitle)
            ? readyAssets
            : [...readyAssets, assetOrReel];
    }

    // --- 1. Explicit metadata ---
    const meta = seedId ? getReelSeriesMetadata(seedId) : null;
    let seriesId =
        String(meta?.seriesId || assetOrReel.seriesId || assetOrReel.series_id || '').trim() || null;
    let episodeIdHint = String(
        meta?.episodeId || assetOrReel.episodeId || assetOrReel.episode_id || ''
    ).trim();

    if (!seriesId && episodeIdHint) {
        const byEp = getEpisodeById(episodeIdHint);
        if (byEp?.series?.id) seriesId = String(byEp.series.id);
    }
    if (!seriesId && seedId) {
        const byReel = getEpisodeByReelId(seedId);
        if (byReel?.series?.id) seriesId = String(byReel.series.id);
    }

    /** @type {RelatedEpisodeMember[]} */
    let catalogMembers = seriesId ? membersFromCatalog(seriesId) : [];
    let catalogSeries = seriesId ? getSeriesById(seriesId) : null;
    if (!catalogSeries && seriesId) catalogSeries = null;

    // Catalog title preferred when present
    let seriesTitle = String(catalogSeries?.title || meta?.seriesName || '').trim();

    // --- 3–7. Vault family via entity/franchise ---
    const seedParsed = parseHighConfidenceEpisodeTitle(seedTitle);
    const seedTokens = identityTokens(seedTitle);
    const seedEntity = entityKeyFromTokens(seedTokens);

    /** @type {Array<Record<string, unknown>>} */
    const family = [];
    for (const asset of readyAssets) {
        const title = displayTitleOf(asset);
        if (!title) continue;
        const id = resolveSeedId(asset) || assetIdOf(asset);
        const isSeed =
            (seedId && (id === seedId || assetIdOf(asset) === seedId)) ||
            (!seedId && normalizeSeriesText(title) === normalizeSeriesText(seedTitle));

        if (isSeed) {
            family.push(asset);
            continue;
        }

        // Explicit same series from metadata
        const otherMeta = id ? getReelSeriesMetadata(id) : null;
        if (seriesId && otherMeta?.seriesId && String(otherMeta.seriesId) === seriesId) {
            family.push(asset);
            continue;
        }
        if (seriesId) {
            const ctx = id ? getEpisodeByReelId(id) : null;
            if (ctx?.series?.id && String(ctx.series.id) === seriesId) {
                family.push(asset);
                continue;
            }
        }

        if (
            titlesRelated(
                seedTitle,
                title,
                seedDesc,
                descriptionOf(asset),
                seedCreator,
                creatorKeyOf(asset)
            )
        ) {
            family.push(asset);
            continue;
        }

        // Description of seed names this vault title token block
        if (
            normalizeSeriesText(seedDesc).includes(normalizeSeriesText(stripEpisodeDecorFromTitle(title))) &&
            stripEpisodeDecorFromTitle(title).length >= 6
        ) {
            family.push(asset);
        }
    }

    // Deduplicate family by id/title
    /** @type {Map<string, Record<string, unknown>>} */
    const familyMap = new Map();
    for (const a of family) {
        const k = resolveSeedId(a) || assetIdOf(a) || normalizeSeriesText(displayTitleOf(a));
        if (!k || familyMap.has(k)) continue;
        familyMap.set(k, a);
    }
    const familyList = [...familyMap.values()];

    const poolMeta = familyList.map((asset) => {
        const title = displayTitleOf(asset);
        const parsed = parseHighConfidenceEpisodeTitle(title);
        // Free-form pilot / series master: no high-confidence episode number parse
        const isFreeForm = !parsed;
        return { asset, title, parsed, isFreeForm };
    });

    const franchiseTitle =
        pickFranchiseTitle(poolMeta.map((p) => ({ title: p.title, parsed: p.parsed, isFreeForm: p.isFreeForm }))) ||
        seriesTitle ||
        seedParsed?.seriesTitle ||
        stripEpisodeDecorFromTitle(seedTitle) ||
        seedTitle;

    seriesTitle = seriesTitle || franchiseTitle;

    if (!seriesId && seriesTitle) {
        const slugId = `series-${slugifySeriesKey(seriesTitle)}`;
        // Only adopt catalog id when it already exists — do not invent store rows here
        if (getSeriesById(slugId)) seriesId = slugId;
        else {
            // Try title match in nothing injectable from store beyond getSeriesById — leave synthetic
            seriesId = slugId;
        }
        // Re-load catalog if we resolved a real slug that exists
        catalogSeries = getSeriesById(seriesId);
        if (catalogSeries) {
            catalogMembers = membersFromCatalog(seriesId);
            seriesTitle = catalogSeries.title || seriesTitle;
        }
    }

    /** @type {RelatedEpisodeMember[]} */
    const vaultMembers = poolMeta.map(({ asset, title }, vaultIndex) => {
        const id = resolveSeedId(asset) || assetIdOf(asset);
        const label = normalizeHeroVaultSeriesLabel(asset);
        const reelId = UUID_RE.test(String(id)) ? String(id) : null;
        return {
            assetId: String(assetIdOf(asset) || id || label.assetId || ''),
            reelId,
            title: label.episodeTitle || title,
            episodeNumber: label.episodeNumber,
            seasonNumber: label.seasonNumber,
            seriesLabel: label.seriesLabel,
            mediaUrl: mediaUrlOf(asset),
            thumbnailUrl: thumbnailUrlOf(asset),
            episodeId: '',
            source: 'vault',
            createdAtMs: createdAtMsOf(asset),
            vaultIndex
        };
    });

    // Enrich vault members with catalog episode ids when known
    for (const m of vaultMembers) {
        if (!m.reelId) continue;
        const ctx = getEpisodeByReelId(m.reelId);
        if (ctx?.episode?.episodeId) {
            m.episodeId = String(ctx.episode.episodeId);
            m.source = 'catalog';
            if (ctx.episode.episodeNumber) m.episodeNumber = Number(ctx.episode.episodeNumber);
        }
    }

    let members = dedupeMembers([...catalogMembers, ...vaultMembers]);

    // Viewer franchise title: majority vault seriesLabel wins over longest raw episode title.
    if (vaultMembers.length) {
        /** @type {Map<string, { display: string; n: number }>} */
        const labelFreq = new Map();
        for (const m of vaultMembers) {
            const display = String(m.seriesLabel || '').trim();
            if (!display) continue;
            const k = normalizeSeriesText(display);
            const cur = labelFreq.get(k) || { display, n: 0 };
            cur.n += 1;
            // Prefer shorter display (franchise root over full episode phrasing)
            if (display.length < cur.display.length) cur.display = display;
            labelFreq.set(k, cur);
        }
        let top = /** @type {{ display: string; n: number } | null} */ (null);
        for (const v of labelFreq.values()) {
            if (
                !top ||
                v.n > top.n ||
                // On a tie, prefer the longer franchise/master title (Vic G LA Story over Vic G)
                (v.n === top.n && v.display.length > top.display.length)
            ) {
                top = v;
            }
        }
        if (top?.display) {
            seriesTitle = top.display;
        }
    }

    // Ensure seed is represented even if ready list was empty of media fields
    if (seedTitle && !members.some((m) => normalizeSeriesText(m.title) === normalizeSeriesText(seedTitle))) {
        const seedLabel = normalizeHeroVaultSeriesLabel(assetOrReel);
        members = dedupeMembers([
            ...members,
            {
                assetId: seedId || assetIdOf(assetOrReel) || '',
                reelId: UUID_RE.test(seedId) ? seedId : null,
                title: seedTitle,
                episodeNumber: seedLabel.episodeNumber,
                seasonNumber: seedLabel.seasonNumber,
                seriesLabel: seedLabel.seriesLabel,
                mediaUrl: seedMedia,
                thumbnailUrl: thumbnailUrlOf(assetOrReel),
                episodeId: episodeIdHint || '',
                source: 'seed',
                createdAtMs: createdAtMsOf(assetOrReel),
                vaultIndex: 0
            }
        ]);
        if (!seriesTitle) seriesTitle = seedLabel.seriesLabel || seedTitle;
    }

    // Assign free-form pilot episode number 1 but avoid colliding with another ep 1
    // When two members share ep numbers from parse + pilot both as 1, keep both (titles differ) — ok

    /** @param {string} key */
    function titleCaseEntity(key) {
        return String(key || '')
            .split(/\s+/)
            .filter(Boolean)
            .map((p) => {
                if (p.length <= 2) return p.toUpperCase();
                return p[0].toUpperCase() + p.slice(1).toLowerCase();
            })
            .join(' ');
    }

    const identity =
        seedEntity || franchiseTitle
            ? {
                  entity: titleCaseEntity(
                      seedEntity || entityKeyFromTokens(identityTokens(franchiseTitle))
                  ),
                  franchise: franchiseTitle
              }
            : null;

    return {
        seriesId,
        seriesTitle: seriesTitle || franchiseTitle || seedTitle || '',
        members,
        identity
    };
}
