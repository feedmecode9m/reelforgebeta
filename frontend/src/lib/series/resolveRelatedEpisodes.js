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
 * @typedef {Object} RelatedEpisodeMember
 * @property {string} assetId
 * @property {string | null} reelId
 * @property {string} title
 * @property {number} episodeNumber
 * @property {number} seasonNumber
 * @property {string} mediaUrl
 * @property {string} thumbnailUrl
 * @property {string} [episodeId]
 * @property {string} [source]
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
        return String(a.title).localeCompare(String(b.title));
    });
}

/**
 * Build a Series-shaped object (catalog compatible) for Theater drawer rendering.
 * Catalog remains preferred; incomplete catalog is unioned with related vault members.
 *
 * @param {RelatedEpisodesResult} related
 * @param {import('./seriesTypes.js').Series | null | undefined} [catalogSeries]
 * @returns {import('./seriesTypes.js').Series | null}
 */
export function buildSeriesViewFromRelated(related, catalogSeries = null) {
    if (!related?.members?.length && !catalogSeries) return null;

    const seriesId =
        String(catalogSeries?.id || related.seriesId || '').trim() ||
        `series-${slugifySeriesKey(related.seriesTitle || 'related')}`;
    const seriesTitle =
        String(catalogSeries?.title || related.seriesTitle || '').trim() || 'Series';

    /** @type {Map<string, import('./seriesTypes.js').Episode>} */
    const episodeMap = new Map();

    // Catalog first (preferred rows)
    for (const season of catalogSeries?.seasons || []) {
        for (const ep of season.episodes || []) {
            episodeMap.set(String(ep.episodeId), {
                ...ep,
                seasonNumber: season.seasonNumber
            });
        }
    }

    // Union related members not already present by reel / title
    for (const m of related.members || []) {
        const byReel =
            m.reelId &&
            [...episodeMap.values()].find((e) => e.reelId && String(e.reelId) === String(m.reelId));
        if (byReel) {
            // Fill missing media links
            if (!byReel.mediaAssetId && m.assetId) {
                episodeMap.set(byReel.episodeId, {
                    ...byReel,
                    mediaAssetId: m.assetId,
                    reelId: byReel.reelId || m.reelId
                });
            }
            continue;
        }
        const titleKey = normalizeSeriesText(m.title);
        const byTitle = [...episodeMap.values()].find(
            (e) => normalizeSeriesText(e.title) === titleKey
        );
        if (byTitle) {
            episodeMap.set(byTitle.episodeId, {
                ...byTitle,
                reelId: byTitle.reelId || m.reelId,
                mediaAssetId: byTitle.mediaAssetId || m.assetId || null
            });
            continue;
        }

        const episodeId =
            m.episodeId ||
            `related-${slugifySeriesKey(seriesId)}-s${m.seasonNumber}-e${m.episodeNumber}-${slugifySeriesKey(m.title)}`.slice(
                0,
                96
            );
        episodeMap.set(episodeId, {
            episodeId,
            episodeNumber: m.episodeNumber,
            title: m.title,
            status: 'published',
            reelId: m.reelId,
            mediaAssetId: m.assetId || null,
            tags: ['related-resolver']
        });
    }

    /** @type {Map<number, import('./seriesTypes.js').Episode[]>} */
    const bySeason = new Map();
    for (const ep of episodeMap.values()) {
        const sn = Number(/** @type {{ seasonNumber?: number }} */ (ep).seasonNumber) || 1;
        const { seasonNumber: _drop, ...rest } = /** @type {any} */ (ep);
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
                return String(a.title).localeCompare(String(b.title));
            })
        }));

    if (!seasons.length) return catalogSeries || null;

    return {
        id: seriesId,
        title: seriesTitle,
        description: catalogSeries?.description || '',
        poster: catalogSeries?.poster || related.members.find((m) => m.thumbnailUrl)?.thumbnailUrl || '',
        genre: catalogSeries?.genre,
        tags: catalogSeries?.tags || ['related-resolver'],
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
    const vaultMembers = poolMeta.map(({ asset, title, parsed }) => {
        const id = resolveSeedId(asset) || assetIdOf(asset);
        const seasonNumber = parsed?.seasonNumber || 1;
        const episodeNumber = episodeNumberForTitle(title, parsed);
        const reelId = UUID_RE.test(String(id)) ? String(id) : null;
        return {
            assetId: String(assetIdOf(asset) || id || ''),
            reelId,
            title,
            episodeNumber,
            seasonNumber,
            mediaUrl: mediaUrlOf(asset),
            thumbnailUrl: thumbnailUrlOf(asset),
            episodeId: '',
            source: 'vault'
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

    // Ensure seed is represented even if ready list was empty of media fields
    if (seedTitle && !members.some((m) => normalizeSeriesText(m.title) === normalizeSeriesText(seedTitle))) {
        members = dedupeMembers([
            ...members,
            {
                assetId: seedId || assetIdOf(assetOrReel) || '',
                reelId: UUID_RE.test(seedId) ? seedId : null,
                title: seedTitle,
                episodeNumber: episodeNumberForTitle(seedTitle, seedParsed),
                seasonNumber: seedParsed?.seasonNumber || 1,
                mediaUrl: seedMedia,
                thumbnailUrl: thumbnailUrlOf(assetOrReel),
                episodeId: episodeIdHint || '',
                source: 'seed'
            }
        ]);
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
