/**
 * Video Vault → Theater episode family linking.
 *
 * Creator selects matching vault videos to share one seriesLabel so Theater
 * related-episode resolution groups them. Does not invent catalog series rows.
 * Leave unlinked until at least one sibling exists.
 */

import { applyCreatorVaultIdentityConfirmation } from './vaultIdentityConfirmation.js';
import {
    resolveMediaAssetId,
    vaultRowMatchesMediaAssetId
} from '../vault/vaultCreatorCardTargeting.js';
import { normalizeSeriesText } from './resolveRelatedEpisodes.js';
import { stripProductionTitlePrefixes } from './vaultSeriesInference.js';

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
    'season',
    'untitled',
    'video',
    'vault'
]);

/**
 * @param {unknown} value
 */
function cleanLabel(value) {
    return String(value || '')
        .replace(/[\s\-_.]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * @param {Record<string, unknown> | null | undefined} asset
 */
function nestedIdentity(asset) {
    return asset?.seriesIdentity && typeof asset.seriesIdentity === 'object'
        ? /** @type {Record<string, unknown>} */ (asset.seriesIdentity)
        : null;
}

/**
 * @param {Record<string, unknown> | null | undefined} asset
 */
export function readVaultSeriesLabel(asset) {
    const nested = nestedIdentity(asset);
    return cleanLabel(
        nested?.seriesLabel || nested?.series_label || asset?.seriesLabel || asset?.series_label || ''
    );
}

/**
 * @param {Record<string, unknown> | null | undefined} asset
 */
function positiveInt(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.max(1, Math.floor(n));
}

/**
 * @param {Record<string, unknown> | null | undefined} asset
 */
export function readVaultSeasonNumber(asset) {
    const nested = nestedIdentity(asset);
    return positiveInt(nested?.seasonNumber ?? nested?.season_number ?? asset?.seasonNumber);
}

/**
 * @param {Record<string, unknown> | null | undefined} asset
 */
export function readVaultEpisodeNumber(asset) {
    const nested = nestedIdentity(asset);
    return positiveInt(nested?.episodeNumber ?? nested?.episode_number ?? asset?.episodeNumber);
}

/**
 * @param {Record<string, unknown> | null | undefined} asset
 */
export function vaultLinkDisplayTitle(asset) {
    const enrich =
        asset?.episodeEnrichment && typeof asset.episodeEnrichment === 'object'
            ? /** @type {Record<string, unknown>} */ (asset.episodeEnrichment)
            : null;
    return (
        cleanLabel(enrich?.title || asset?.title || asset?.name || asset?.fileName || '') || 'Untitled'
    );
}

/**
 * @param {string} title
 */
function titleTokens(title) {
    return String(title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !STOP.has(w));
}

/**
 * @param {string} a
 * @param {string} b
 */
export function titlesSuggestTheaterMatch(a, b) {
    const ta = new Set(titleTokens(stripProductionTitlePrefixes(a)));
    if (!ta.size) return false;
    return titleTokens(stripProductionTitlePrefixes(b)).some((t) => ta.has(t));
}

/**
 * Same family key Theater uses (normalized series label).
 * @param {unknown} label
 */
export function theaterFamilyKey(label) {
    return normalizeSeriesText(label);
}

/**
 * Expand checkbox / event ids onto every alias a vault row might carry.
 * @param {unknown} list
 * @param {Iterable<string>} ids
 */
export function expandVaultFamilyAllowedIds(list, ids) {
    const rows = (Array.isArray(list) ? list : []).filter((item) => item && typeof item === 'object');
    /** @type {Set<string>} */
    const allowed = new Set();
    for (const raw of ids || []) {
        const id = String(raw || '').trim();
        if (!id) continue;
        allowed.add(id);
        for (const rawRow of rows) {
            const row = /** @type {Record<string, unknown>} */ (rawRow);
            if (!vaultRowMatchesMediaAssetId(row, id)) continue;
            const resolved = resolveMediaAssetId(row);
            if (resolved) allowed.add(resolved);
            for (const key of [row.id, row.mediaAssetId, row.assetId, row.reelId]) {
                const alias = String(key || '').trim();
                if (alias) allowed.add(alias);
            }
        }
    }
    return allowed;
}

/**
 * Checkbox ids the creator already stamped with the same seriesLabel.
 * Catalog / Theater inference must not pre-check unrelated vault files.
 * @param {unknown} vaultList
 * @param {string} currentMediaAssetId
 * @returns {string[]}
 */
export function theaterLinkedSiblingIds(vaultList, currentMediaAssetId) {
    const cur = String(currentMediaAssetId || '').trim();
    const rows = (Array.isArray(vaultList) ? vaultList : []).filter(
        (item) => item && typeof item === 'object'
    );
    const seed = rows.find((row) => vaultRowMatchesMediaAssetId(row, cur));
    const key = theaterFamilyKey(readVaultSeriesLabel(seed));
    if (!seed || !cur || !key) return [];
    const seedTitle = vaultLinkDisplayTitle(seed);
    const seedTitleEmpty = !seedTitle || seedTitle === 'Untitled';
    const seedConfirmed =
        nestedIdentity(seed)?.confirmedByCreator === true ||
        nestedIdentity(seed)?.identitySource === 'creator' ||
        seed.confirmedByCreator === true;
    /** @type {string[]} */
    const out = [];
    const seen = new Set();
    for (const row of rows) {
        if (vaultRowMatchesMediaAssetId(row, cur)) continue;
        if (theaterFamilyKey(readVaultSeriesLabel(row)) !== key) continue;
        const nested = nestedIdentity(row);
        const rowTitle = vaultLinkDisplayTitle(row);
        const titleOk = titlesSuggestTheaterMatch(seedTitle, rowTitle);
        const rowEmpty = !rowTitle || rowTitle === 'Untitled';
        const untitledConfirmed =
            seedConfirmed &&
            seedTitleEmpty &&
            rowEmpty &&
            (nested?.confirmedByCreator === true ||
                nested?.identitySource === 'creator' ||
                row.confirmedByCreator === true);
        if (!titleOk && !untitledConfirmed) continue;
        const checkboxId = resolveMediaAssetId(row);
        if (!checkboxId || seen.has(checkboxId)) continue;
        seen.add(checkboxId);
        out.push(checkboxId);
    }
    return out;
}

/**
 * @param {{ id?: string }} candidate
 * @param {string[]} siblingIds
 */
export function isTheaterFamilyCandidate(candidate, siblingIds) {
    const id = String(candidate?.id || '').trim();
    const ids = (Array.isArray(siblingIds) ? siblingIds : []).map((value) => String(value || '').trim());
    if (id && ids.includes(id)) return true;
    return ids.some((sid) => sid && vaultRowMatchesMediaAssetId(candidate, sid));
}

/**
 * Other Video Vault rows that can be tagged as Theater siblings.
 *
 * @param {unknown} vaultList
 * @param {string} currentMediaAssetId
 * @returns {Array<{
 *   id: string;
 *   title: string;
 *   seriesLabel: string;
 *   seasonNumber: number | null;
 *   episodeNumber: number | null;
 *   suggested: boolean;
 *   confirmedByCreator?: boolean;
 *   sameFamily: boolean;
 * }>}
 */
export function listVaultTheaterLinkCandidates(vaultList, currentMediaAssetId, currentTitle = '') {
    const cur = String(currentMediaAssetId || '').trim();
    const seedTitle = cleanLabel(currentTitle);
    const rows = Array.isArray(vaultList) ? vaultList : [];
    /** @type {ReturnType<typeof listVaultTheaterLinkCandidates>} */
    const out = [];
    const seen = new Set();
    for (const raw of rows) {
        if (!raw || typeof raw !== 'object') continue;
        const row = /** @type {Record<string, unknown>} */ (raw);
        const id = resolveMediaAssetId(row);
        if (!id || seen.has(id)) continue;
        if (cur && vaultRowMatchesMediaAssetId(row, cur)) continue;
        const state = String(row.uploadState || '').toLowerCase();
        if (state === 'failed' || state === 'interrupted' || state === 'uploading') continue;
        seen.add(id);
        const title = vaultLinkDisplayTitle(row);
        const seriesLabel = readVaultSeriesLabel(row);
        const nested = nestedIdentity(row);
        out.push({
            id,
            title,
            seriesLabel,
            seasonNumber: readVaultSeasonNumber(row),
            episodeNumber: readVaultEpisodeNumber(row),
            suggested: Boolean(seedTitle) && titlesSuggestTheaterMatch(seedTitle, title),
            confirmedByCreator:
                nested?.confirmedByCreator === true ||
                nested?.identitySource === 'creator' ||
                row.confirmedByCreator === true,
            sameFamily: false
        });
    }
    return out;
}

/**
 * Mark candidates the creator already stamped onto this family.
 * Matching seriesLabel alone is not enough when titles are different shows
 * (e.g. MICROS Motherland vs 01 Arrival) unless both were creator-confirmed.
 *
 * @param {ReturnType<typeof listVaultTheaterLinkCandidates>} candidates
 * @param {string} seriesLabel
 * @param {{ seedTitle?: string; seedConfirmed?: boolean }} [options]
 */
export function markSameTheaterFamily(candidates, seriesLabel, options = {}) {
    const key = theaterFamilyKey(seriesLabel);
    const seedTitle = cleanLabel(options.seedTitle || '');
    const seedConfirmed = options.seedConfirmed === true;
    return (candidates || []).map((row) => {
        const labelMatch = Boolean(key) && theaterFamilyKey(row.seriesLabel) === key;
        if (!labelMatch) return { ...row, sameFamily: false };
        const rowTitle = String(row.title || '').trim();
        const titleOk = titlesSuggestTheaterMatch(seedTitle || seriesLabel, rowTitle || row.seriesLabel);
        const seedEmpty = !seedTitle || seedTitle === 'Untitled';
        const rowEmpty = !rowTitle || rowTitle === 'Untitled';
        const untitledConfirmed =
            seedConfirmed && row.confirmedByCreator === true && seedEmpty && rowEmpty;
        return { ...row, sameFamily: Boolean(titleOk || untitledConfirmed) };
    });
}

/**
 * Default family name from an existing label or the current title (no S/E suffix).
 *
 * @param {Record<string, unknown> | null | undefined} asset
 * @param {string} [fallbackTitle]
 */
export function defaultTheaterFamilyLabel(asset, fallbackTitle = '') {
    const fromTitle = cleanLabel(
        stripProductionTitlePrefixes(fallbackTitle || vaultLinkDisplayTitle(asset))
    )
        .replace(/\bS\d+\s*E\d+\b/gi, '')
        .replace(/\b(season|episode|ep)\s*\d+\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    const existing = readVaultSeriesLabel(asset);
    if (existing && (!fromTitle || titlesSuggestTheaterMatch(existing, fromTitle))) {
        return existing;
    }
    return fromTitle || existing;
}

/**
 * Apply one seriesLabel + sequential episode numbers to the primary file and selected siblings.
 * Only those ids change. Playback URLs and catalog publish state are untouched.
 *
 * @param {unknown} list
 * @param {{
 *   primaryId: string;
 *   siblingIds?: string[];
 *   seriesLabel: string;
 *   seasonNumber?: unknown;
 * }} spec
 */
export function applyVaultTheaterFamilyLink(list, spec) {
    const primaryId = String(spec?.primaryId || '').trim();
    const siblingIds = (Array.isArray(spec?.siblingIds) ? spec.siblingIds : [])
        .map((id) => String(id || '').trim())
        .filter((id) => id && id !== primaryId);
    const seriesLabel = cleanLabel(spec?.seriesLabel);
    const seasonNumber = positiveInt(spec?.seasonNumber) || 1;
    const rows = (Array.isArray(list) ? list : []).filter((item) => item && typeof item === 'object');
    const allowed = expandVaultFamilyAllowedIds(rows, [primaryId, ...siblingIds]);

    if (!primaryId || !seriesLabel || siblingIds.length < 1) {
        return {
            list: /** @type {Record<string, unknown>[]} */ (rows.map((r) => ({ ...r }))),
            mutated: false,
            allowedIds: [...allowed],
            reason: 'need-siblings'
        };
    }

    /** @type {Array<{ id: string; row: Record<string, unknown>; ep: number | null }>} */
    const members = [];
    for (const raw of rows) {
        const row = /** @type {Record<string, unknown>} */ (raw);
        const id = resolveMediaAssetId(row);
        if (![...allowed].some((allowedId) => vaultRowMatchesMediaAssetId(row, allowedId))) continue;
        members.push({ id, row, ep: readVaultEpisodeNumber(row) });
    }

    const used = new Set();
    /** @type {Map<string, number>} */
    const assignments = new Map();
    for (const member of members) {
        if (member.ep && !used.has(member.ep)) {
            assignments.set(member.id, member.ep);
            used.add(member.ep);
        }
    }
    let nextEp = 1;
    for (const member of members) {
        if (assignments.has(member.id)) continue;
        while (used.has(nextEp)) nextEp += 1;
        assignments.set(member.id, nextEp);
        used.add(nextEp);
        nextEp += 1;
    }

    let mutated = false;
    const next = rows.map((raw) => {
        const row = /** @type {Record<string, unknown>} */ (raw);
        const id = resolveMediaAssetId(row);
        if (![...allowed].some((allowedId) => vaultRowMatchesMediaAssetId(row, allowedId))) return row;
        mutated = true;
        return applyCreatorVaultIdentityConfirmation(row, {
            seriesLabel,
            seasonNumber,
            episodeNumber: assignments.get(id) || 1
        });
    });

    return {
        list: /** @type {Record<string, unknown>[]} */ (next),
        mutated,
        allowedIds: [...allowed],
        reason: mutated ? 'linked' : 'no-match'
    };
}

/**
 * Drop leftover family stamps on vault rows that do not title-match this file.
 * Used when the creator leaves Theater unlinked / unchecks a sibling.
 *
 * @param {unknown} list
 * @param {string} primaryId
 */
export function clearUnrelatedTheaterFamilySiblings(list, primaryId) {
    const cur = String(primaryId || '').trim();
    const rows = (Array.isArray(list) ? list : []).filter((item) => item && typeof item === 'object');
    const seed = rows.find((row) => vaultRowMatchesMediaAssetId(row, cur));
    const key = theaterFamilyKey(readVaultSeriesLabel(seed));
    if (!seed || !cur || !key) {
        return {
            list: /** @type {Record<string, unknown>[]} */ (rows.map((r) => ({ ...r }))),
            mutated: false,
            allowedIds: cur ? [cur] : []
        };
    }
    const seedTitle = vaultLinkDisplayTitle(seed);
    let mutated = false;
    /** @type {Set<string>} */
    const allowed = new Set([cur]);
    const next = rows.map((raw) => {
        const row = /** @type {Record<string, unknown>} */ (raw);
        if (vaultRowMatchesMediaAssetId(row, cur)) return row;
        if (theaterFamilyKey(readVaultSeriesLabel(row)) !== key) return row;
        if (titlesSuggestTheaterMatch(seedTitle, vaultLinkDisplayTitle(row))) return row;
        mutated = true;
        const rid = resolveMediaAssetId(row);
        if (rid) allowed.add(rid);
        const nested = nestedIdentity(row);
        const nextIdentity = nested
            ? {
                  ...nested,
                  seriesLabel: '',
                  series_label: '',
                  confirmedByCreator: false
              }
            : nested;
        return {
            ...row,
            seriesLabel: '',
            series_label: '',
            ...(nextIdentity ? { seriesIdentity: nextIdentity } : {})
        };
    });
    return { list: next, mutated, allowedIds: [...allowed] };
}
