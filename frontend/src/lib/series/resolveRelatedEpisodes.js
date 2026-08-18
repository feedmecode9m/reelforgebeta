/**
 * Canonical related-episode resolver (Series Identity Graph — Phase 1).
 *
 * One relationship intelligence path for Theater, Catalog, Search, and discovery.
 * Does not create a second series store — reads ready vault assets + existing catalog/
 * reel metadata, then unions incomplete catalog rows with vault siblings.
 *
 * Priority:
 *   1. Hero Vault seriesIdentity metadata (labels from vault authority)
 *   2. Explicit seriesId / episodeId / reel metadata (mediaAssetId relationships)
 *   3. Existing catalog relationships
 *   4. Entity / title normalization (+ franchise upgrade from free-form pilots)
 *   5. Creator identity
 *   6. Shared franchise tokens
 *   7. Description references
 *   8. Episode-number parse patterns (via vaultSeriesInference)
 */

import {
    getEpisodeById,
    getEpisodeByMediaIdentity,
    getEpisodeByReelId,
    getReelSeriesMetadata,
    getSeriesById
} from './seriesStore.js';
import { getReadyHeroVaultAssets } from './heroVaultAssetSource.js';
import { assetIdOf, isVideoAsset, isImageAsset } from './episodeVaultResolver.js';
import {
    parseHighConfidenceEpisodeTitle,
    slugifySeriesKey,
    stripProductionTitlePrefixes,
    buildVaultSeriesIdentity,
    isCatalogBindingCreatorConfirmed,
    resolveAuthoritativeEpisodeNumber,
    resolveAuthoritativeEpisodeTitle,
    isSyntheticPackageTitle
} from './vaultSeriesInference.js';
import { viewerFieldsFromVaultEnrichment } from './vaultEpisodeEnrichment.js';
import { sortEpisodesForDisplay } from './seriesCatalogEdits.js';
import { episodeIsViewerDiscoverable } from './publishingLifecycle.js';
import {
    resolveLinkedAssetDisplayTitle,
    isUnsafeHeroFilenameTitle,
    REEL_TITLES_PERSISTENT_KEY,
    UNTITLED_CREATOR_EXPERIENCE
} from '../hero/heroTitleIntelligence.js';
import {
    lookupPersistentTitleEntry,
    mediaPathAssetId,
    mediaRecordTitleKeys
} from '../content/persistentTitleMap.js';
import { isUnsafeViewerCardTitle } from '../feed/viewerMediaIdentity.js';

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
 * @property {'high' | 'medium' | 'low'} [confidence]
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
 * @property {string} [description]
 * @property {string} [seriesLabel]
 * @property {string} [episodeId]
 * @property {string} [source]
 * @property {boolean} [fromVault]
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
 * True when a string is an episode Master Edit / file stem, not a Family / series name.
 * All Episodes shelf heading must not use these.
 * @param {unknown} value
 */
export function looksLikeEpisodeFacingTitle(value) {
    const text = cleanSpaces(stripMediaExtension(value));
    if (!text) return true;
    if (isUnsafeHeroFilenameTitle(text) || isUnsafeViewerCardTitle(text)) return true;
    if (/^\d{1,2}([\s_\-.]|$)/.test(text)) return true;
    if (/\bS\d{1,2}\s*[Ee]\d{1,3}\b/i.test(text)) return true;
    if (/\b(?:ep(?:isode)?)\s*\d{1,3}\b/i.test(text)) return true;
    if (/_v\d+\b/i.test(text)) return true;
    if (/_(?:arrival|open|cut|final|master|edit)\b/i.test(text)) return true;
    if (/\b(?:arrival|open)\b/i.test(text) && /\bv\d+\b/i.test(text)) return true;
    return false;
}

/**
 * All Episodes menu title: Family / series name, never a single episode Master Edit.
 * @param {{
 *   relatedTitle?: unknown;
 *   catalogTitle?: unknown;
 *   familyLabels?: unknown[];
 *   identityFranchise?: unknown;
 *   identityEntity?: unknown;
 *   seedTitle?: unknown;
 *   creatorConfirmedCatalog?: boolean;
 * }} [input]
 */
export function resolveFamilySeriesTitle(input = {}) {
    const catalogTitle = cleanSpaces(input.catalogTitle);
    const relatedTitle = cleanSpaces(input.relatedTitle);
    const franchise = cleanSpaces(input.identityFranchise);
    const entity = cleanSpaces(input.identityEntity);
    const seedTitle = cleanSpaces(input.seedTitle);
    const labels = (Array.isArray(input.familyLabels) ? input.familyLabels : [])
        .map((value) => cleanSpaces(value))
        .filter(Boolean);

    /** @type {string[]} */
    const ranked = [];
    const push = (value) => {
        const next = cleanSpaces(value);
        if (!next) return;
        if (looksLikeEpisodeFacingTitle(next)) return;
        if (ranked.some((existing) => normalizeSeriesText(existing) === normalizeSeriesText(next))) {
            return;
        }
        ranked.push(next);
    };

    if (input.creatorConfirmedCatalog && catalogTitle) push(catalogTitle);
    for (const label of labels) push(label);
    push(catalogTitle);
    push(entity);
    push(stripEpisodeDecorFromTitle(franchise) || franchise);
    push(stripEpisodeDecorFromTitle(relatedTitle) || relatedTitle);
    push(stripEpisodeDecorFromTitle(seedTitle));

    if (!ranked.length) {
        const fallback =
            (!looksLikeEpisodeFacingTitle(catalogTitle) && catalogTitle) ||
            (!looksLikeEpisodeFacingTitle(relatedTitle) && relatedTitle) ||
            stripEpisodeDecorFromTitle(seedTitle) ||
            catalogTitle ||
            relatedTitle ||
            'Series';
        return cleanSpaces(fallback) || 'Series';
    }

    // Prefer the shortest stable family root among equally episode-free labels
    // ("Vic G" over a longer episode-adjacent phrase), but keep free-form franchise
    // when it is the only non-episode candidate.
    ranked.sort((a, b) => {
        const aTokens = a.split(/\s+/).length;
        const bTokens = b.split(/\s+/).length;
        if (aTokens !== bTokens) return aTokens - bTokens;
        return a.length - b.length;
    });
    return ranked[0];
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
        .filter((t) => !STOP.has(t))
        .filter((t) => !/^\d{1,3}$/.test(t));
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
 * Persistent Hero Vault Master Edit via id or playback-URL alias.
 * @param {Record<string, unknown> | null | undefined} asset
 * @param {string} reelId
 * @param {string} [mediaUrl]
 * @returns {string}
 */
function persistentMasterEditTitle(asset, reelId, mediaUrl = '') {
    if (typeof localStorage === 'undefined') return '';
    try {
        const map = JSON.parse(localStorage.getItem(REEL_TITLES_PERSISTENT_KEY) || '{}');
        const saved = lookupPersistentTitleEntry(map, {
            ...(asset && typeof asset === 'object' ? asset : {}),
            id: reelId || assetIdOf(asset),
            url: mediaUrl || mediaUrlOf(asset)
        });
        return String(saved?.title || saved?.title_original || '').trim();
    } catch {
        return '';
    }
}

/**
 * All Episodes rows use the same Hero Vault Master Edit label as the vault card.
 * @param {Record<string, unknown> | null | undefined} asset
 * @param {string} reelId
 * @param {string} fallbackTitle
 * @param {string} [mediaUrl]
 * @returns {string}
 */
function heroVaultMasterEditTitle(asset, reelId, fallbackTitle = '', mediaUrl = '') {
    const id = String(reelId || assetIdOf(asset) || '').trim();
    const fallback = String(fallbackTitle || '').trim();
    if (!id && !fallback) return '';
    const fromMap = persistentMasterEditTitle(asset, id, mediaUrl);
    const canonical = resolveLinkedAssetDisplayTitle(id, {
        persistentTitle: fromMap || undefined,
        episodeTitle: fallback,
        assetTitle: displayTitleOf(asset) || fallback,
        fileName: String(asset?.fileName || asset?.file_name || '')
    });
    if (canonical && canonical !== UNTITLED_CREATOR_EXPERIENCE) {
        if (
            isUnsafeHeroFilenameTitle(canonical) ||
            isUnsafeViewerCardTitle(canonical)
        ) {
            return fallback &&
                !isUnsafeHeroFilenameTitle(fallback) &&
                !isUnsafeViewerCardTitle(fallback)
                ? fallback
                : '';
        }
        return canonical;
    }
    if (
        fallback &&
        !isUnsafeHeroFilenameTitle(fallback) &&
        !isUnsafeViewerCardTitle(fallback) &&
        !/^episode\s+\d+$/i.test(fallback)
    ) {
        return fallback;
    }
    return '';
}

/**
 * @param {Record<string, unknown> | null | undefined} item
 */
function displayTitleOf(item) {
    const enrich =
        item?.episodeEnrichment && typeof item.episodeEnrichment === 'object'
            ? /** @type {Record<string, unknown>} */ (item.episodeEnrichment)
            : null;
    const nested =
        item?.seriesIdentity && typeof item.seriesIdentity === 'object'
            ? /** @type {Record<string, unknown>} */ (item.seriesIdentity)
            : null;
    return String(
        enrich?.title ||
            item?.name ||
            item?.title ||
            nested?.episodeTitle ||
            nested?.seriesLabel ||
            item?.seriesLabel ||
            item?.fileName ||
            item?.file_name ||
            item?.assetId ||
            ''
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
 * Example: "STIRRED S01E01" → { seriesLabel:"STIRRED", seasonNumber:1, episodeNumber:1, confidence:"high" }
 *
 * Priority: seriesIdentity → flat vault fields → title parse → safe fallback.
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

    const identity = buildVaultSeriesIdentity(assetOrTitle);
    if (identity?.seriesLabel) {
        return {
            assetId,
            title: title || identity.episodeTitle || identity.seriesLabel,
            seriesLabel: identity.seriesLabel,
            seasonNumber: identity.seasonNumber,
            episodeNumber: identity.episodeNumber,
            episodeTitle: identity.episodeTitle || title || identity.seriesLabel,
            confidence: identity.confidence
        };
    }

    // Safe fallback when identity cannot be resolved — still deterministic
    const seriesLabel = stripEpisodeDecorFromTitle(title) || title || 'Series';
    return {
        assetId,
        title: title || seriesLabel,
        seriesLabel: cleanSpaces(seriesLabel),
        seasonNumber: 1,
        episodeNumber: 1,
        episodeTitle: title || seriesLabel,
        confidence: 'low'
    };
}

/**
 * Normalized series identity key for family grouping (Hero Vault labels).
 * Low-confidence placeholders never form a family key (avoids false "Series" joins).
 * @param {Record<string, unknown> | null | undefined} asset
 */
function seriesIdentityKeyOf(asset) {
    if (!asset || typeof asset !== 'object') return '';
    const nested =
        asset.seriesIdentity && typeof asset.seriesIdentity === 'object'
            ? /** @type {Record<string, unknown>} */ (asset.seriesIdentity)
            : null;
    const creatorLinked =
        nested?.confirmedByCreator === true ||
        nested?.identitySource === 'creator' ||
        asset.confirmedByCreator === true;
    const label = normalizeHeroVaultSeriesLabel(asset);
    if (label.confidence === 'low' && !creatorLinked) return '';
    const key = normalizeSeriesText(label.seriesLabel || '');
    if (!key || key === 'series') return '';
    return key;
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
function creatorConfirmedVaultIdentity(asset) {
    if (!asset || typeof asset !== 'object') return false;
    const nested =
        asset.seriesIdentity && typeof asset.seriesIdentity === 'object'
            ? /** @type {Record<string, unknown>} */ (asset.seriesIdentity)
            : null;
    return (
        nested?.confirmedByCreator === true ||
        nested?.identitySource === 'creator' ||
        asset.confirmedByCreator === true
    );
}

/**
 * Vault files join a Theater family when titles actually relate, or when both are
 * untitled creator-stamped siblings. Shared catalog series / leftover labels are not enough.
 */
function vaultFamilyAllowsJoin(
    seed,
    other,
    seedTitle,
    otherTitle,
    seedDesc,
    otherDesc,
    seedCreator,
    otherCreator
) {
    if (titlesRelated(seedTitle, otherTitle, seedDesc, otherDesc, seedCreator, otherCreator)) {
        return true;
    }
    const seedEmpty = !String(seedTitle || '').trim();
    const otherEmpty = !String(otherTitle || '').trim();
    return seedEmpty && otherEmpty && creatorConfirmedVaultIdentity(seed) && creatorConfirmedVaultIdentity(other);
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
    // Filename / "copy UUID" stems never form an All Episodes family by title alone.
    if (
        isUnsafeHeroFilenameTitle(seedTitle) ||
        isUnsafeHeroFilenameTitle(otherTitle) ||
        isUnsafeViewerCardTitle(seedTitle) ||
        isUnsafeViewerCardTitle(otherTitle)
    ) {
        return false;
    }
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
            const mediaOnly =
                ep.mediaAssetId != null && String(ep.mediaAssetId).trim()
                    ? String(ep.mediaAssetId).trim()
                    : '';
            // Membership is media-backed: package shells with no reel/media are not siblings
            if (!reelId && !mediaOnly) continue;
            const assetId = String(ep.mediaAssetId || ep.heroVaultAssetId || reelId || ep.episodeId || '');
            out.push({
                assetId: assetId || String(ep.episodeId || ''),
                reelId,
                // Empty package titles stay empty — viewer chips resolve Master Edit / safe catalog names.
                // Never invent "Episode N" for All Episodes (mobile shows that instead of real names).
                title: String(ep.title || '').trim(),
                episodeNumber: Number(ep.episodeNumber) || 1,
                seasonNumber: Number(season.seasonNumber) || 1,
                mediaUrl: '',
                thumbnailUrl: '',
                episodeId: String(ep.episodeId || ''),
                source: 'catalog',
                status: ep.status || 'draft',
                displayOrder: Number.isFinite(Number(ep.displayOrder))
                    ? Number(ep.displayOrder)
                    : undefined
            });
        }
    }
    return out;
}

/**
 * Prefer human presentation titles over raw media filenames when merging members.
 * @param {unknown} a
 * @param {unknown} b
 */
function preferPresentationTitle(a, b) {
    const A = String(a || '').trim();
    const B = String(b || '').trim();
    const unsafe = (t) =>
        !t ||
        isUnsafeHeroFilenameTitle(t) ||
        isUnsafeViewerCardTitle(t) ||
        /^episode\s+\d+$/i.test(t);
    if (unsafe(A) && !unsafe(B)) return B;
    if (unsafe(B) && !unsafe(A)) return A;
    if (unsafe(A) && unsafe(B)) return '';
    if (!A) return B;
    if (!B) return A;
    const mediaish = (t) => /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(t);
    if (mediaish(A) && !mediaish(B)) return B;
    if (mediaish(B) && !mediaish(A)) return A;
    const genericEp = (t) => /^episode\s+\d+$/i.test(t);
    if (genericEp(A) && !genericEp(B)) return B;
    if (genericEp(B) && !genericEp(A)) return A;
    return A;
}

/**
 * Catalog reel id, vault id, and R2 /prod/{uuid}.mp4 are the same episode.
 * @param {RelatedEpisodeMember} m
 * @returns {string[]}
 */
function aliasIdsForMember(m) {
    return mediaRecordTitleKeys({
        id: m.assetId || m.reelId,
        assetId: m.assetId,
        reelId: m.reelId,
        mediaAssetId: m.assetId,
        mediaUrl: m.mediaUrl,
        url: m.mediaUrl
    }).map((id) => String(id || '').trim().toLowerCase()).filter(Boolean);
}

/**
 * @param {RelatedEpisodeMember} prev
 * @param {RelatedEpisodeMember} m
 * @returns {RelatedEpisodeMember}
 */
function mergeRelatedMembers(prev, m) {
    return {
        ...prev,
        ...m,
        title: preferPresentationTitle(m.title, prev.title),
        description: String(prev.description || m.description || '').trim() || m.description || '',
        thumbnailUrl: (() => {
            const a = String(m.thumbnailUrl || '').trim();
            const b = String(prev.thumbnailUrl || '').trim();
            return a || b;
        })(),
        reelId: m.reelId || prev.reelId,
        assetId: m.assetId || prev.assetId,
        episodeId: m.episodeId || prev.episodeId,
        mediaUrl: (() => {
            const a = String(m.mediaUrl || '').trim();
            const b = String(prev.mediaUrl || '').trim();
            if (isVideoAsset(a, '') && !isVideoAsset(b, '')) return a;
            if (isVideoAsset(b, '') && !isVideoAsset(a, '')) return b;
            return a || b;
        })(),
        source: m.source === 'catalog' || prev.source === 'catalog' ? 'catalog' : m.source || prev.source
    };
}

/**
 * @param {RelatedEpisodeMember[]} list
 * @returns {RelatedEpisodeMember[]}
 */
function dedupeMembers(list) {
    /** @type {{ ids: Set<string>; titleKey: string; member: RelatedEpisodeMember }[]} */
    const groups = [];
    for (const m of list) {
        const ids = new Set(aliasIdsForMember(m));
        const titleKey = `${normalizeSeriesText(m.title)}|s${Number(m.seasonNumber) || 1}|e${Number(m.episodeNumber) || 0}`;
        let hit = -1;
        for (let i = 0; i < groups.length; i++) {
            let overlap = false;
            for (const id of ids) {
                if (groups[i].ids.has(id)) {
                    overlap = true;
                    break;
                }
            }
            if (!overlap && titleKey && !titleKey.startsWith('|') && groups[i].titleKey === titleKey) {
                overlap = Boolean(normalizeSeriesText(m.title));
            }
            if (overlap) {
                hit = i;
                break;
            }
        }
        if (hit >= 0) {
            for (const id of ids) groups[hit].ids.add(id);
            groups[hit].member = mergeRelatedMembers(groups[hit].member, m);
            continue;
        }
        groups.push({ ids, titleKey, member: m });
    }
    return groups.map((g) => g.member).sort((a, b) => {
        if (a.seasonNumber !== b.seasonNumber) return a.seasonNumber - b.seasonNumber;
        // Creator displayOrder overrides episodeNumber presentation order when present
        const da = Number(a.displayOrder);
        const db = Number(b.displayOrder);
        const aHas = Number.isFinite(da);
        const bHas = Number.isFinite(db);
        if (aHas && bHas && da !== db) return da - db;
        if (aHas !== bHas) return aHas ? -1 : 1;
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
 * @param {{ viewerMode?: boolean }} [options] viewerMode defaults true — draft/ready/archived filtered from shelf
 * @returns {import('./seriesTypes.js').Series | null}
 */
export function buildSeriesViewFromRelated(related, catalogSeries = null, options = {}) {
    const viewerMode = options.viewerMode !== false;
    if (!related?.members?.length && !catalogSeries) return null;

    const seriesId =
        String(related.seriesId || catalogSeries?.id || '').trim() ||
        `series-${slugifySeriesKey(related.seriesTitle || catalogSeries?.title || 'related')}`;
    const creatorConfirmedCatalog = Boolean(
        catalogSeries?.confirmedByCreator === true ||
            (Array.isArray(catalogSeries?.tags) &&
                catalogSeries.tags.some((tag) => /creator-(?:package|confirmed)/i.test(String(tag || ''))))
    );
    // Viewer shelf heading = Family / series name (never an episode Master Edit).
    const seriesTitle = resolveFamilySeriesTitle({
        relatedTitle: related.seriesTitle,
        catalogTitle: catalogSeries?.title,
        familyLabels: (related.members || []).map((m) => m.seriesLabel),
        identityFranchise: related.identity?.franchise,
        identityEntity: related.identity?.entity,
        creatorConfirmedCatalog
    });

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
        // Catalog status + displayOrder win when present (publishing + creator order).
        // Vault presentation package (title/description/artwork) wins when already set
        // unless catalog title is creator package and non-synthetic.
        const nextDisplay =
            Number.isFinite(Number(ep.displayOrder))
                ? Number(ep.displayOrder)
                : Number.isFinite(Number(prev.displayOrder))
                  ? Number(prev.displayOrder)
                  : undefined;

        const prevEn = Number(prev.episodeNumber);
        const epEn = Number(ep.episodeNumber);
        // Prefer earlier vault high identity when present; catalog en only when vault missing
        // (catalog may have been pre-stamped by applyCanonicalEpisodeMetadataFromVault).
        let nextEn = prev.episodeNumber;
        if (Number.isFinite(prevEn) && prevEn >= 1) {
            nextEn = prevEn;
        } else if (Number.isFinite(epEn) && epEn >= 1) {
            nextEn = epEn;
        }

        const catTitle = String(ep.title || '').trim();
        const prevTitle = String(prev.title || '').trim();
        let nextTitle = prevTitle || catTitle;
        if (prevTitle && isSyntheticPackageTitle(prevTitle) && catTitle && !isSyntheticPackageTitle(catTitle)) {
            nextTitle = catTitle;
        } else if (catTitle && isSyntheticPackageTitle(catTitle) && prevTitle) {
            nextTitle = prevTitle;
        } else if (!prevTitle && catTitle) {
            nextTitle = catTitle;
        }

        episodeMap.set(key, {
            ...prev,
            ...ep,
            reelId: prev.reelId || ep.reelId,
            mediaAssetId: prev.mediaAssetId || ep.mediaAssetId || null,
            mediaUrl: prev.mediaUrl || ep.mediaUrl || '',
            title: nextTitle,
            description: prev.description || ep.description,
            genre: ep.genre || prev.genre,
            tags: [...new Set([...(prev.tags || []), ...(ep.tags || [])])],
            seriesLabel: prev.seriesLabel || ep.seriesLabel,
            createdAtMs: prev.createdAtMs || ep.createdAtMs,
            status: ep.status || prev.status,
            displayOrder: nextDisplay,
            thumbnailUrl: prev.thumbnailUrl || ep.thumbnailUrl,
            episodeNumber: nextEn,
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
            description: m.description || '',
            status: m.status || 'ready',
            reelId: m.reelId,
            mediaAssetId: m.assetId || null,
            mediaUrl: m.mediaUrl || '',
            tags: m.fromVault || m.source === 'vault' ? ['vault-related'] : ['catalog-related'],
            seasonNumber: m.seasonNumber,
            seriesLabel: m.seriesLabel || related.seriesTitle || seriesTitle,
            createdAtMs: m.createdAtMs,
            vaultIndex: m.vaultIndex,
            displayOrder: m.displayOrder,
            thumbnailUrl: m.thumbnailUrl || undefined
        });
    }

    // 2) Catalog enrichment — fill gaps, never drop vault rows
    for (const season of catalogSeries?.seasons || []) {
        for (const ep of season.episodes || []) {
            const byReel =
                (ep.reelId || ep.mediaAssetId || ep.heroVaultAssetId) &&
                [...episodeMap.entries()].find(([, e]) => {
                    const ids = [
                        e.reelId,
                        e.mediaAssetId,
                        mediaPathAssetId({
                            id: e.reelId || e.mediaAssetId,
                            url: e.mediaUrl,
                            mediaUrl: e.mediaUrl
                        })
                    ]
                        .map((v) => String(v || '').trim().toLowerCase())
                        .filter(Boolean);
                    const catalogIds = [ep.reelId, ep.mediaAssetId, ep.heroVaultAssetId]
                        .map((v) => String(v || '').trim().toLowerCase())
                        .filter(Boolean);
                    return catalogIds.some((id) => ids.includes(id));
                });
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
            const byTitle =
                titleKey &&
                [...episodeMap.entries()].find(([, e]) => normalizeSeriesText(e.title) === titleKey);
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
            // Catalog-only episode (not in vault) — viewer mode: published only
            if (viewerMode && !episodeIsViewerDiscoverable(ep)) continue;
            const seasonN = Number(season.seasonNumber) || 1;
            const epN = Number(ep.episodeNumber) || 0;
            const slotTaken = [...episodeMap.values()].some((e) => {
                const sameSeason = (Number(e.seasonNumber) || 1) === seasonN;
                const sameEp = Number(e.episodeNumber) === epN && epN >= 1;
                return sameSeason && sameEp;
            });
            const catTitle = String(ep.title || '').trim();
            if (!catTitle || isSyntheticPackageTitle(catTitle)) {
                if (slotTaken || viewerMode) continue;
            }
            putEpisode(`c:${ep.episodeId}`, {
                ...ep,
                seasonNumber: season.seasonNumber,
                displayOrder: ep.displayOrder,
                tags: [...(ep.tags || []), 'catalog-only']
            });
        }
    }

    // Carry catalog display order + status onto vault spine when episodeId/reel match
    // (already merged via putEpisode enrich above)

    /** @type {Map<number, Array<import('./seriesTypes.js').Episode & { seriesLabel?: string; createdAtMs?: number; vaultIndex?: number; displayOrder?: number }>>} */
    const bySeason = new Map();
    for (const ep of episodeMap.values()) {
        // Catalog-only rows stay published-gated. Vault-linked Theater family always paints.
        const vaultSpine = (ep.tags || []).includes('vault-related');
        if (viewerMode && !vaultSpine && ep.status && !episodeIsViewerDiscoverable(ep)) continue;
        const sn = Number(ep.seasonNumber) || 1;
        const { seasonNumber: _drop, ...rest } = ep;
        const list = bySeason.get(sn) || [];
        list.push(rest);
        bySeason.set(sn, list);
    }

    const seasons = [...bySeason.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([seasonNumber, episodes]) => {
            const catSeason = catalogSeries?.seasons?.find((s) => s.seasonNumber === seasonNumber);
            return {
                seasonId: catSeason?.seasonId || `season-${slugifySeriesKey(seriesId)}-${seasonNumber}`,
                seasonNumber,
                title: catSeason?.title || `Season ${seasonNumber}`,
                description: catSeason?.description || '',
                poster: /** @type {{ poster?: string }} */ (catSeason || {}).poster || '',
                episodes: sortEpisodesForDisplay(episodes)
            };
        });

    if (!seasons.length) {
        // Viewer mode: never fall back to raw catalog (would reintroduce draft/ready/archived)
        if (viewerMode) {
            return {
                id: seriesId,
                title: seriesTitle || catalogSeries?.title || 'Series',
                description: catalogSeries?.description || '',
                poster: catalogSeries?.poster || '',
                genre: catalogSeries?.genre,
                tags: [...new Set([...(catalogSeries?.tags || []), 'vault-inferred', 'related-resolver'])],
                seasons: []
            };
        }
        return catalogSeries || null;
    }

    return {
        id: seriesId,
        title: seriesTitle || catalogSeries?.title || 'Series',
        description: catalogSeries?.description || '',
        poster:
            catalogSeries?.poster ||
            related.members?.find((m) => m.thumbnailUrl)?.thumbnailUrl ||
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

    // --- 1. Explicit reel/catalog metadata (mediaAssetId relationship) ---
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

    // --- Vault family: seriesIdentity first, then reel/catalog links, then title/entity ---
    const seedParsed = parseHighConfidenceEpisodeTitle(seedTitle);
    const seedTokens = identityTokens(seedTitle);
    const seedEntity = entityKeyFromTokens(seedTokens);
    const seedIdentityKey = seriesIdentityKeyOf(assetOrReel);
    // Prefer Hero Vault identity title when present
    const seedVaultIdentity = buildVaultSeriesIdentity(assetOrReel);
    if (!seriesTitle && seedVaultIdentity?.seriesLabel) {
        seriesTitle = seedVaultIdentity.seriesLabel;
    }

    /** @type {Array<Record<string, unknown>>} */
    const family = [];
    for (const asset of readyAssets) {
        const identityKey = seriesIdentityKeyOf(asset);
        const title = displayTitleOf(asset);
        if (!title && !identityKey) continue;
        const id = resolveSeedId(asset) || assetIdOf(asset);
        const otherUrl = mediaUrlOf(asset);
        const imageOnly =
            isImageAsset(otherUrl, String(asset?.type || '')) &&
            !isVideoAsset(otherUrl, String(asset?.type || ''));
        const isSeed =
            (seedId && (id === seedId || assetIdOf(asset) === seedId)) ||
            (!seedId && normalizeSeriesText(title) === normalizeSeriesText(seedTitle));

        if (imageOnly && !isSeed) continue;

        if (isSeed) {
            family.push(asset);
            continue;
        }

        // 1) Shared Hero Vault seriesIdentity / seriesLabel (authority — not a second matcher)
        const otherIdentityKey = seriesIdentityKeyOf(asset);
        if (
            seedIdentityKey &&
            otherIdentityKey &&
            seedIdentityKey === otherIdentityKey &&
            seedIdentityKey.length >= 2 &&
            vaultFamilyAllowsJoin(
                assetOrReel,
                asset,
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

        // 2) Explicit same series from mediaAssetId / reel metadata
        const otherMeta = id ? getReelSeriesMetadata(id) : null;
        if (seriesId && otherMeta?.seriesId && String(otherMeta.seriesId) === seriesId) {
            if (
                vaultFamilyAllowsJoin(
                    assetOrReel,
                    asset,
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
        }
        if (seriesId) {
            const ctx = id ? getEpisodeByReelId(id) : null;
            if (ctx?.series?.id && String(ctx.series.id) === seriesId) {
                if (
                    vaultFamilyAllowsJoin(
                        assetOrReel,
                        asset,
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
            }
        }

        // 3–4) Title / entity / creator / description inference (existing fallback)
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
        const aliases = mediaRecordTitleKeys({
            ...a,
            url: mediaUrlOf(a),
            mediaUrl: mediaUrlOf(a)
        }).map((id) => String(id || '').trim().toLowerCase()).filter(Boolean);
        const fallback = resolveSeedId(a) || assetIdOf(a) || normalizeSeriesText(displayTitleOf(a));
        const keys = aliases.length ? aliases : fallback ? [fallback] : [];
        const existingKey = keys.find((k) => familyMap.has(k));
        if (existingKey) {
            const kept = familyMap.get(existingKey);
            if (kept) {
                const donated = (() => {
                    const keptThumb = String(
                        kept.thumbnailUrl || kept.thumbnail_url || kept.thumbnail || kept.posterUrl || ''
                    ).trim();
                    if (keptThumb && !/\.(mp4|mov|webm|m4v)(\?|$)/i.test(keptThumb)) return kept;
                    const still = String(
                        a.thumbnailUrl || a.thumbnail_url || a.thumbnail || a.posterUrl || ''
                    ).trim();
                    if (!still || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(still)) return kept;
                    return { ...kept, thumbnailUrl: still, thumbnail: still };
                })();
                familyMap.set(existingKey, donated);
                for (const k of keys) {
                    if (familyMap.get(k) === kept) familyMap.set(k, donated);
                    else if (!familyMap.has(k)) familyMap.set(k, donated);
                }
            }
            continue;
        }
        const primary = keys[0] || fallback;
        if (!primary || familyMap.has(primary)) continue;
        familyMap.set(primary, a);
        for (const k of keys) {
            if (!familyMap.has(k)) familyMap.set(k, a);
        }
    }
    const familyList = [...new Set(familyMap.values())];

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
        const identity = buildVaultSeriesIdentity(asset);
        const label = normalizeHeroVaultSeriesLabel(asset);
        const enrich = viewerFieldsFromVaultEnrichment(asset);
        const playbackId = mediaPathAssetId({
            ...(asset && typeof asset === 'object' ? asset : {}),
            url: mediaUrlOf(asset),
            mediaUrl: mediaUrlOf(asset)
        });
        const reelId = UUID_RE.test(String(id))
            ? String(id)
            : UUID_RE.test(String(playbackId))
              ? String(playbackId)
              : null;
        const ctx =
            (reelId ? getEpisodeByMediaIdentity(reelId) : null) ||
            (playbackId ? getEpisodeByMediaIdentity(playbackId) : null);
        const creatorConfirmed = isCatalogBindingCreatorConfirmed(asset, ctx);
        const enRes = resolveAuthoritativeEpisodeNumber({
            identity,
            catalogEpisodeNumber: ctx?.episode?.episodeNumber,
            creatorConfirmed
        });
        // Viewer en: never invent from vaultIndex. Use high NLP / creator / catalog only.
        // Free-form low-identity vault en (default 1) only for unbound viewer spine when label set.
        let episodeNumber =
            enRes.episodeNumber != null
                ? enRes.episodeNumber
                : identity?.confidence === 'medium' && Number(identity.episodeNumber) >= 1
                  ? Number(identity.episodeNumber)
                  : Number(label.episodeNumber) >= 1
                    ? Number(label.episodeNumber)
                    : 1;
        if (enRes.source === 'none' && identity?.confidence === 'low') {
            // Keep a display placeholder of 1 for free-form pilots only — not written to catalog
            episodeNumber = Number(label.episodeNumber) >= 1 ? Number(label.episodeNumber) : 1;
        }

        const titleRes = resolveAuthoritativeEpisodeTitle({
            vaultTitle: title,
            identityTitle: identity?.episodeTitle || label.episodeTitle || '',
            catalogTitle: ctx?.episode?.title || '',
            creatorConfirmed
        });

        return {
            assetId: String(assetIdOf(asset) || id || label.assetId || ''),
            reelId,
            // Creator package enrichment wins for presentation titles
            title: enrich.title || titleRes || label.episodeTitle || title,
            description: enrich.description || descriptionOf(asset) || '',
            episodeNumber,
            seasonNumber:
                Number(identity?.seasonNumber) >= 1
                    ? Number(identity.seasonNumber)
                    : Number(label.seasonNumber) || 1,
            seriesLabel: label.seriesLabel,
            mediaUrl: mediaUrlOf(asset),
            thumbnailUrl: enrich.artworkUrl || thumbnailUrlOf(asset),
            episodeId: '',
            source: 'vault',
            fromVault: true,
            createdAtMs: createdAtMsOf(asset),
            vaultIndex
        };
    });

    // Enrich vault members with catalog binding (status + displayOrder; S/E from authority helpers)
    for (const m of vaultMembers) {
        if (!m.reelId) continue;
        const ctx = getEpisodeByReelId(m.reelId);
        if (ctx?.episode?.episodeId) {
            m.episodeId = String(ctx.episode.episodeId);
            m.source = 'catalog';
            if (ctx.episode.status) m.status = ctx.episode.status;
            // Creator displayOrder always wins when present
            if (Number.isFinite(Number(ctx.episode.displayOrder))) {
                m.displayOrder = Number(ctx.episode.displayOrder);
            }
            // Creator-confirmed catalog number wins over vault NLP defaults
            const asset = poolMeta.find(
                (p) =>
                    resolveSeedId(p.asset) === m.reelId ||
                    assetIdOf(p.asset) === m.reelId
            )?.asset;
            if (asset && isCatalogBindingCreatorConfirmed(asset, ctx)) {
                if (Number(ctx.episode.episodeNumber) >= 1) {
                    m.episodeNumber = Number(ctx.episode.episodeNumber);
                }
                const packageTitle = viewerFieldsFromVaultEnrichment(asset).title;
                if (packageTitle) {
                    m.title = packageTitle;
                } else if (String(ctx.episode.title || '').trim()) {
                    m.title = String(ctx.episode.title).trim();
                }
            } else if (Number(ctx.episode.episodeNumber) >= 1) {
                // Catalog already NLP-corrected — prefer it when vault conf wasn't high
                const id = buildVaultSeriesIdentity(asset || {});
                if (!id || id.confidence !== 'high') {
                    m.episodeNumber = Number(ctx.episode.episodeNumber);
                } else if (Number(id.episodeNumber) >= 1) {
                    m.episodeNumber = Number(id.episodeNumber);
                }
            }
        }
    }

    for (const m of vaultMembers) {
        const asset = poolMeta.find(
            (p) =>
                resolveSeedId(p.asset) === m.reelId ||
                assetIdOf(p.asset) === m.reelId ||
                assetIdOf(p.asset) === m.assetId
        )?.asset;
        const stamped = heroVaultMasterEditTitle(
            asset,
            String(m.reelId || m.assetId || ''),
            m.title,
            m.mediaUrl
        );
        if (stamped) m.title = stamped;
    }

    const vaultFamilyKeys = new Set();
    for (const m of vaultMembers) {
        for (const key of aliasIdsForMember(m)) {
            vaultFamilyKeys.add(key);
        }
    }
    const filteredCatalog = catalogMembers.filter((member) => {
        const ids = aliasIdsForMember(member);
        const hasVaultCounterpart = readyAssets.some((asset) => {
            const assetIds = mediaRecordTitleKeys({
                ...asset,
                url: mediaUrlOf(asset),
                mediaUrl: mediaUrlOf(asset)
            }).map((value) => String(value || '').trim().toLowerCase());
            return ids.some((id) => assetIds.includes(id));
        });
        if (!hasVaultCounterpart) return true;
        return ids.some((id) => vaultFamilyKeys.has(id));
    });
    let members = dedupeMembers([...filteredCatalog, ...vaultMembers]);
    for (const m of members) {
        const asset = poolMeta.find(
            (p) =>
                resolveSeedId(p.asset) === m.reelId ||
                assetIdOf(p.asset) === m.reelId ||
                assetIdOf(p.asset) === m.assetId
        )?.asset;
        const stamped = heroVaultMasterEditTitle(
            asset,
            String(m.reelId || m.assetId || ''),
            m.title,
            m.mediaUrl
        );
        if (stamped) m.title = stamped;
    }

    // Viewer All Episodes heading: Family / series name, never an episode Master Edit.
    if (vaultMembers.length) {
        /** @type {Map<string, { display: string; n: number }>} */
        const labelFreq = new Map();
        for (const m of vaultMembers) {
            const display = String(m.seriesLabel || '').trim();
            if (!display || looksLikeEpisodeFacingTitle(display)) continue;
            const k = normalizeSeriesText(display);
            const cur = labelFreq.get(k) || { display, n: 0 };
            cur.n += 1;
            // Prefer shorter family root over longer episode-adjacent phrasing
            if (display.length < cur.display.length) cur.display = display;
            labelFreq.set(k, cur);
        }
        let top = /** @type {{ display: string; n: number } | null} */ (null);
        for (const v of labelFreq.values()) {
            if (!top || v.n > top.n || (v.n === top.n && v.display.length < top.display.length)) {
                top = v;
            }
        }
        if (top?.display) {
            seriesTitle = top.display;
        }
    }

    // Ensure seed is represented even if ready list was empty of media fields
    const seedAlreadyMember = members.some(
        (m) =>
            (seedId &&
                (String(m.reelId || '') === seedId || String(m.assetId || '') === seedId)) ||
            normalizeSeriesText(m.title) === normalizeSeriesText(seedTitle)
    );
    if (seedTitle && !seedAlreadyMember) {
        const seedLabel = normalizeHeroVaultSeriesLabel(assetOrReel);
        const seedEnrich = viewerFieldsFromVaultEnrichment(assetOrReel);
        members = dedupeMembers([
            ...members,
            {
                assetId: seedId || assetIdOf(assetOrReel) || '',
                reelId: UUID_RE.test(seedId) ? seedId : null,
                title: seedEnrich.title || seedTitle,
                description: seedEnrich.description || seedDesc || '',
                episodeNumber: seedLabel.episodeNumber,
                seasonNumber: seedLabel.seasonNumber,
                seriesLabel: seedLabel.seriesLabel,
                mediaUrl: seedMedia,
                thumbnailUrl: seedEnrich.artworkUrl || thumbnailUrlOf(assetOrReel),
                episodeId: episodeIdHint || '',
                source: 'seed',
                createdAtMs: createdAtMsOf(assetOrReel),
                vaultIndex: 0
            }
        ]);
        if (!seriesTitle && !looksLikeEpisodeFacingTitle(seedLabel.seriesLabel)) {
            seriesTitle = seedLabel.seriesLabel;
        }
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

    const creatorConfirmedCatalog = Boolean(
        catalogSeries?.confirmedByCreator === true ||
            (Array.isArray(catalogSeries?.tags) &&
                catalogSeries.tags.some((tag) => /creator-(?:package|confirmed)/i.test(String(tag || ''))))
    );

    seriesTitle = resolveFamilySeriesTitle({
        relatedTitle: seriesTitle,
        catalogTitle: catalogSeries?.title,
        familyLabels: members.map((m) => m.seriesLabel),
        identityFranchise: identity?.franchise,
        identityEntity: identity?.entity,
        seedTitle,
        creatorConfirmedCatalog
    });

    return {
        seriesId,
        seriesTitle: seriesTitle || 'Series',
        members,
        identity
    };
}
