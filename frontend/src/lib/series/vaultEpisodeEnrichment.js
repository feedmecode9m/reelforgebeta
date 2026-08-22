/**
 * Hero Vault creator episode enrichment (presentation package).
 *
 * Complements identity confirmation with editable title / description / artwork.
 * Does not replace seriesIdentity authority, catalog order, publishing, or playback.
 */

import { sealVaultSeriesIdentityForStorage } from './vaultSeriesInference.js';
import { presentVaultIdentityForCreator } from './vaultIdentityConfirmation.js';
import {
    applyVaultEpisodeAccess,
    normalizeVaultEpisodeAccess,
    readVaultEpisodeAccess
} from './episodeAccessPricing.js';

/**
 * @typedef {Object} VaultEpisodeEnrichment
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [artworkUrl]
 */

/**
 * @param {unknown} value
 */
function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {unknown} value
 */
function cleanUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    // Allow relative media paths and absolute https — never data: mega-payloads in storage
    if (raw.startsWith('data:') && raw.length > 256) return '';
    return raw.slice(0, 2048);
}

/**
 * Read durable creator presentation package from a vault asset.
 *
 * @param {Record<string, unknown> | null | undefined} asset
 * @returns {VaultEpisodeEnrichment}
 */
export function readVaultEpisodeEnrichment(asset) {
    if (!asset || typeof asset !== 'object') {
        return { title: '', description: '', artworkUrl: '' };
    }
    const nested =
        asset.episodeEnrichment && typeof asset.episodeEnrichment === 'object'
            ? /** @type {Record<string, unknown>} */ (asset.episodeEnrichment)
            : null;
    const title = cleanText(
        nested?.title || asset.enrichmentTitle || asset.episodePresentationTitle || ''
    );
    const description = cleanText(
        nested?.description || asset.enrichmentDescription || asset.episodeDescription || ''
    );
    const artworkUrl = cleanUrl(
        nested?.artworkUrl ||
            nested?.artwork ||
            nested?.posterUrl ||
            asset.enrichmentArtworkUrl ||
            asset.episodeArtworkUrl ||
            ''
    );
    return { title, description, artworkUrl };
}

/**
 * True when any presentation field is non-empty.
 * @param {VaultEpisodeEnrichment | null | undefined} enrichment
 */
export function hasVaultEpisodeEnrichment(enrichment) {
    if (!enrichment) return false;
    return Boolean(
        cleanText(enrichment.title) ||
            cleanText(enrichment.description) ||
            cleanUrl(enrichment.artworkUrl)
    );
}

/**
 * Normalize enrichment payload for durable vault storage (viewer-safe fields only).
 *
 * @param {Partial<VaultEpisodeEnrichment> | null | undefined} draft
 * @returns {VaultEpisodeEnrichment | null}
 */
export function normalizeVaultEpisodeEnrichment(draft) {
    const title = cleanText(draft?.title);
    const description = cleanText(draft?.description);
    const artworkUrl = cleanUrl(draft?.artworkUrl);
    if (!title && !description && !artworkUrl) return null;
    /** @type {VaultEpisodeEnrichment} */
    const out = {};
    if (title) out.title = title.slice(0, 200);
    if (description) out.description = description.slice(0, 4000);
    if (artworkUrl) out.artworkUrl = artworkUrl;
    return out;
}

/**
 * Attach enrichment onto a sealed vault asset without mutating identity or playback.
 *
 * @param {Record<string, unknown> | null | undefined} asset
 * @returns {Record<string, unknown> | null | undefined}
 */
export function sealVaultEpisodeEnrichmentForStorage(asset) {
    if (!asset || typeof asset !== 'object') return asset;
    const sealed = /** @type {Record<string, unknown>} */ (
        sealVaultSeriesIdentityForStorage(asset) || asset
    );
    const enrichment = normalizeVaultEpisodeEnrichment(readVaultEpisodeEnrichment(asset));
    const access = normalizeVaultEpisodeAccess(readVaultEpisodeAccess(asset));
    /** @type {Record<string, unknown>} */
    let next = { ...sealed };
    if (!enrichment) {
        if (next.episodeEnrichment) {
            const { episodeEnrichment: _drop, ...rest } = next;
            next = rest;
        }
    } else {
        next.episodeEnrichment = enrichment;
    }
    if (access) {
        next = applyVaultEpisodeAccess(next, access);
    }
    return next;
}

/**
 * Seal identity + enrichment on a list of vault assets.
 * @param {unknown} list
 * @returns {Record<string, unknown>[]}
 */
export function sealVaultAssetsWithEnrichment(list) {
    return (Array.isArray(list) ? list : [])
        .map((item) => {
            if (!item || typeof item !== 'object') return null;
            return /** @type {Record<string, unknown>} */ (
                sealVaultEpisodeEnrichmentForStorage(
                    /** @type {Record<string, unknown>} */ (item)
                ) || item
            );
        })
        .filter(Boolean);
}

/**
 * Present enrichment for creator UI (no parser / confidence fields).
 *
 * @param {Record<string, unknown> | null | undefined} asset
 */
export function presentVaultEpisodeEnrichmentForCreator(asset) {
    const identity = presentVaultIdentityForCreator(asset);
    const enrichment = readVaultEpisodeEnrichment(asset);
    const confirmed = !identity.needsConfirmation && Boolean(identity.seriesLabel);
    const episodeLine =
        confirmed && identity.seasonNumber != null && identity.episodeNumber != null
            ? `${identity.seriesLabel} • S${identity.seasonNumber} • E${identity.episodeNumber}`
            : '';
    return {
        mediaAssetId: identity.mediaAssetId,
        identityConfirmed: confirmed,
        episodeLine,
        seriesLabel: identity.seriesLabel || '',
        seasonNumber: identity.seasonNumber,
        episodeNumber: identity.episodeNumber,
        title: enrichment.title || '',
        description: enrichment.description || '',
        artworkUrl: enrichment.artworkUrl || '',
        hasEnrichment: hasVaultEpisodeEnrichment(enrichment),
        // Phase 19: package/catalog metadata is independent of series identity.
        // Generic UUID/camera assets must be able to author title/description/tags/category
        // without confirming Series/Season/Episode first.
        canEdit: true
    };
}

/**
 * Apply creator presentation package. Preserves identity, mediaAssetId, and playback URL.
 *
 * @param {Record<string, unknown> | null | undefined} asset
 * @param {{
 *   title?: unknown;
 *   description?: unknown;
 *   artworkUrl?: unknown;
 *   accessMode?: unknown;
 *   mode?: unknown;
 *   price?: unknown;
 * }} draft
 * @returns {Record<string, unknown>}
 */
export function applyCreatorVaultEpisodeEnrichment(asset, draft = {}) {
    if (!asset || typeof asset !== 'object') {
        throw new Error('Vault asset required for episode enrichment');
    }
    const mediaAssetId = String(asset.id || asset.mediaAssetId || asset.assetId || '').trim();
    const enrichment = normalizeVaultEpisodeEnrichment({
        title: draft.title,
        description: draft.description,
        artworkUrl: draft.artworkUrl
    });

    /** @type {Record<string, unknown>} */
    let next = {
        ...asset,
        ...(mediaAssetId ? { id: mediaAssetId } : {})
    };
    if (enrichment) {
        next.episodeEnrichment = enrichment;
    } else {
        delete next.episodeEnrichment;
    }

    if (
        draft.accessMode != null ||
        draft.mode != null ||
        draft.price != null ||
        Object.prototype.hasOwnProperty.call(draft, 'accessMode') ||
        Object.prototype.hasOwnProperty.call(draft, 'price')
    ) {
        next = applyVaultEpisodeAccess(next, {
            mode: draft.mode ?? draft.accessMode,
            price: draft.price
        });
    } else {
        const existing = normalizeVaultEpisodeAccess(readVaultEpisodeAccess(asset));
        if (existing) next = applyVaultEpisodeAccess(next, existing);
    }

    const sealed = sealVaultEpisodeEnrichmentForStorage(next);
    return /** @type {Record<string, unknown>} */ (sealed || next);
}

/**
 * Viewer-facing presentation fields from vault enrichment (prefer over raw file title).
 *
 * @param {Record<string, unknown> | null | undefined} asset
 * @returns {{ title: string; description: string; artworkUrl: string }}
 */
export function viewerFieldsFromVaultEnrichment(asset) {
    const enrichment = readVaultEpisodeEnrichment(asset);
    return {
        title: enrichment.title || '',
        description: enrichment.description || '',
        artworkUrl: enrichment.artworkUrl || ''
    };
}
