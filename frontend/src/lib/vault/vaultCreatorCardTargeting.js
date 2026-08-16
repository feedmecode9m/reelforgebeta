/**
 * Hero Vault creator card mutation targeting.
 *
 * Stable target is always mediaAssetId. Never target by array index, displayOrder,
 * episode number, DOM position, filename, or title.
 */

import { applyCreatorVaultIdentityConfirmation } from '../series/vaultIdentityConfirmation.js';
import { applyCreatorVaultEpisodeEnrichment } from '../series/vaultEpisodeEnrichment.js';

/**
 * Stable media asset identity from a vault row / card model / event detail.
 * @param {unknown} source
 * @returns {string}
 */
export function resolveMediaAssetId(source) {
    if (source == null) return '';
    if (typeof source === 'string' || typeof source === 'number') {
        return String(source).trim();
    }
    if (typeof source !== 'object') return '';
    const row = /** @type {Record<string, unknown>} */ (source);
    return String(row.mediaAssetId || row.id || row.assetId || row.reelId || '').trim();
}

/**
 * True when a vault row owns the given mediaAssetId.
 * Match only stable id fields — never episode, title, or filename.
 * @param {unknown} item
 * @param {string} mediaAssetId
 */
export function vaultRowMatchesMediaAssetId(item, mediaAssetId) {
    const want = String(mediaAssetId || '').trim();
    if (!want || !item || typeof item !== 'object') return false;
    const row = /** @type {Record<string, unknown>} */ (item);
    const candidates = [row.id, row.mediaAssetId, row.assetId, row.reelId]
        .map((v) => String(v || '').trim())
        .filter(Boolean);
    return candidates.includes(want);
}

/**
 * Resolve mutation target from creator card event detail (and optional card prop).
 * Event mediaAssetId is authoritative. Refuses index / episode / title keys.
 *
 * @param {Record<string, unknown> | null | undefined} detail
 * @param {string} [cardMediaAssetId] explicit data-media-asset-id from the card that fired
 * @returns {{ mediaAssetId: string; ok: boolean; reason: string }}
 */
export function resolveCreatorCardMutationTarget(detail, cardMediaAssetId = '') {
    const fromEvent = resolveMediaAssetId(detail);
    const fromCard = String(cardMediaAssetId || '').trim();

    if (fromEvent && fromCard && fromEvent !== fromCard) {
        // Prefer the event payload minted by the card that submitted the form.
        return {
            mediaAssetId: fromEvent,
            ok: false,
            reason: `card/event mediaAssetId mismatch event=${fromEvent} card=${fromCard}`
        };
    }
    const mediaAssetId = fromEvent || fromCard;
    if (!mediaAssetId) {
        return { mediaAssetId: '', ok: false, reason: 'missing mediaAssetId' };
    }
    return { mediaAssetId, ok: true, reason: 'mediaAssetId' };
}

/**
 * Snapshot package + identity fields keyed by mediaAssetId for cross-write asserts.
 * @param {unknown} list
 * @returns {Map<string, { episodeNumber: number | null; seriesLabel: string; title: string; confirmed: boolean }>}
 */
export function snapshotVaultCreatorFieldsByMediaId(list) {
    /** @type {Map<string, { episodeNumber: number | null; seriesLabel: string; title: string; confirmed: boolean }>} */
    const map = new Map();
    for (const item of Array.isArray(list) ? list : []) {
        if (!item || typeof item !== 'object') continue;
        const id = resolveMediaAssetId(item);
        if (!id) continue;
        const row = /** @type {Record<string, unknown>} */ (item);
        const si =
            row.seriesIdentity && typeof row.seriesIdentity === 'object'
                ? /** @type {Record<string, unknown>} */ (row.seriesIdentity)
                : null;
        const en =
            row.episodeEnrichment && typeof row.episodeEnrichment === 'object'
                ? /** @type {Record<string, unknown>} */ (row.episodeEnrichment)
                : null;
        const episodeNumber = Number(si?.episodeNumber ?? row.episodeNumber);
        map.set(id, {
            episodeNumber: Number.isFinite(episodeNumber) && episodeNumber >= 1 ? episodeNumber : null,
            seriesLabel: String(si?.seriesLabel || row.seriesLabel || '').trim(),
            title: String(en?.title || '').trim(),
            confirmed: si?.confirmedByCreator === true || row.confirmedByCreator === true
        });
    }
    return map;
}

/**
 * Assert non-target rows did not change identity/package fields.
 * @param {unknown} beforeList
 * @param {unknown} afterList
 * @param {string} [targetMediaAssetId]
 * @param {string[]} [allowedExtraIds] extra ids intentionally mutated (Theater family link)
 * @returns {{ ok: boolean; violations: string[] }}
 */
export function assertNoCrossWrite(beforeList, afterList, targetMediaAssetId, allowedExtraIds = []) {
    const target = String(targetMediaAssetId || '').trim();
    const allowed = new Set(
        [target, ...(Array.isArray(allowedExtraIds) ? allowedExtraIds : [])]
            .map((id) => String(id || '').trim())
            .filter(Boolean)
    );
    const before = snapshotVaultCreatorFieldsByMediaId(beforeList);
    const after = snapshotVaultCreatorFieldsByMediaId(afterList);
    /** @type {string[]} */
    const violations = [];

    for (const [id, prev] of before.entries()) {
        if (allowed.has(id)) continue;
        const next = after.get(id);
        if (!next) {
            violations.push(`${id}: row removed by mutation targeting ${target}`);
            continue;
        }
        if (prev.episodeNumber !== next.episodeNumber) {
            violations.push(
                `${id}: episodeNumber ${prev.episodeNumber} → ${next.episodeNumber} (cross-write)`
            );
        }
        if (prev.seriesLabel !== next.seriesLabel) {
            violations.push(`${id}: seriesLabel changed (cross-write)`);
        }
        if (prev.title !== next.title) {
            violations.push(`${id}: package title changed (cross-write)`);
        }
        if (prev.confirmed !== next.confirmed) {
            violations.push(`${id}: confirmedByCreator changed (cross-write)`);
        }
    }

    return { ok: violations.length === 0, violations };
}

/**
 * Apply identity confirmation to exactly one vault row by mediaAssetId.
 * @param {unknown} list
 * @param {string} mediaAssetId
 * @param {{ seriesLabel?: unknown; seasonNumber?: unknown; episodeNumber?: unknown }} draft
 * @returns {{ list: Record<string, unknown>[]; mutated: boolean; mediaAssetId: string }}
 */
export function applyIdentityToVaultListByMediaAssetId(list, mediaAssetId, draft) {
    const id = String(mediaAssetId || '').trim();
    const rows = (Array.isArray(list) ? list : []).filter(Boolean).map((item) =>
        item && typeof item === 'object' ? { .../** @type {Record<string, unknown>} */ (item) } : item
    );
    if (!id) {
        return { list: /** @type {Record<string, unknown>[]} */ (rows), mutated: false, mediaAssetId: id };
    }

    let mutated = false;
    const next = rows.map((item) => {
        if (!vaultRowMatchesMediaAssetId(item, id)) return item;
        mutated = true;
        return applyCreatorVaultIdentityConfirmation(
            /** @type {Record<string, unknown>} */ (item),
            draft
        );
    });

    return { list: /** @type {Record<string, unknown>[]} */ (next), mutated, mediaAssetId: id };
}

/**
 * Apply episode package to exactly one vault row by mediaAssetId.
 * @param {unknown} list
 * @param {string} mediaAssetId
 * @param {{ title?: unknown; description?: unknown; artworkUrl?: unknown }} draft
 * @returns {{ list: Record<string, unknown>[]; mutated: boolean; mediaAssetId: string }}
 */
export function applyPackageToVaultListByMediaAssetId(list, mediaAssetId, draft) {
    const id = String(mediaAssetId || '').trim();
    const rows = (Array.isArray(list) ? list : []).filter(Boolean).map((item) =>
        item && typeof item === 'object' ? { .../** @type {Record<string, unknown>} */ (item) } : item
    );
    if (!id) {
        return { list: /** @type {Record<string, unknown>[]} */ (rows), mutated: false, mediaAssetId: id };
    }

    let mutated = false;
    const next = rows.map((item) => {
        if (!vaultRowMatchesMediaAssetId(item, id)) return item;
        mutated = true;
        return applyCreatorVaultEpisodeEnrichment(
            /** @type {Record<string, unknown>} */ (item),
            draft
        );
    });

    return { list: /** @type {Record<string, unknown>[]} */ (next), mutated, mediaAssetId: id };
}

/**
 * Reorder vault display list without touching identity/package fields.
 * New order is array of mediaAssetId values; unknown ids append last.
 * @param {unknown} list
 * @param {string[]} orderedMediaAssetIds
 */
export function reorderVaultListByMediaAssetIds(list, orderedMediaAssetIds) {
    const rows = (Array.isArray(list) ? list : []).filter(
        (item) => item && typeof item === 'object'
    );
    /** @type {Record<string, unknown>[]} */
    const out = [];
    const used = new Set();
    for (const rawId of orderedMediaAssetIds || []) {
        const id = String(rawId || '').trim();
        if (!id || used.has(id)) continue;
        const hit = rows.find((item) => vaultRowMatchesMediaAssetId(item, id));
        if (hit) {
            out.push(/** @type {Record<string, unknown>} */ (hit));
            used.add(id);
        }
    }
    for (const item of rows) {
        const id = resolveMediaAssetId(item);
        if (!id || used.has(id)) continue;
        out.push(/** @type {Record<string, unknown>} */ (item));
        used.add(id);
    }
    return out;
}
