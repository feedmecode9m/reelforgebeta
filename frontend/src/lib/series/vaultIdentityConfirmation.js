/**
 * Hero Vault creator identity confirmation (product layer).
 *
 * Does not replace vault seriesIdentity authority, seal pipeline, catalog ownership,
 * or publishing lifecycle. Presents sealed identity and applies creator corrections
 * only to vault identity fields (mediaAssetId / playback preserved).
 */

import { sealVaultSeriesIdentityForStorage } from './vaultSeriesInference.js';

/** Viewer-safe status copy — never expose confidence/parser/validator language. */
export const CREATOR_IDENTITY_STATUS = {
    CONFIRMED_FROM_FILENAME: 'Confirmed from filename/title',
    CONFIRMED: 'Confirmed',
    NEEDS_CONFIRMATION: 'Needs confirmation'
};

/** Words that must never appear in creator-facing identity UI. */
export const CREATOR_IDENTITY_BANNED_TERMS = [
    'confidence',
    'parseconfidence',
    'parse confidence',
    'high-confidence',
    'infer',
    'inference',
    'validator',
    'admin',
    'internal',
    'ssr',
    'payload',
    'serialize'
];

/**
 * @param {unknown} value
 */
function cleanSeriesBase(value) {
    return String(value || '')
        .replace(/[\s\-_.]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * @param {unknown} value
 */
function positiveInt(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.max(1, Math.floor(n));
}

/**
 * @param {Record<string, unknown> | null | undefined} asset
 */
function readIdentityTriple(asset) {
    if (!asset || typeof asset !== 'object') {
        return { seriesLabel: '', seasonNumber: null, episodeNumber: null, confirmedByCreator: false };
    }
    const nested =
        asset.seriesIdentity && typeof asset.seriesIdentity === 'object'
            ? /** @type {Record<string, unknown>} */ (asset.seriesIdentity)
            : null;
    const seriesLabel = cleanSeriesBase(
        nested?.seriesLabel || nested?.series_label || asset.seriesLabel || asset.series_label || ''
    );
    const seasonNumber = positiveInt(nested?.seasonNumber ?? nested?.season_number ?? asset.seasonNumber);
    const episodeNumber = positiveInt(
        nested?.episodeNumber ?? nested?.episode_number ?? asset.episodeNumber
    );
    const confirmedByCreator =
        nested?.confirmedByCreator === true ||
        nested?.identitySource === 'creator' ||
        asset.confirmedByCreator === true;
    return { seriesLabel, seasonNumber, episodeNumber, confirmedByCreator };
}

/**
 * Present creator-facing identity after MP4 seal (no internal fields).
 *
 * @param {Record<string, unknown> | null | undefined} asset
 */
export function presentVaultIdentityForCreator(asset) {
    const sealed =
        /** @type {Record<string, unknown>} */ (sealVaultSeriesIdentityForStorage(asset) || asset || {});
    const { seriesLabel, seasonNumber, episodeNumber, confirmedByCreator } = readIdentityTriple(sealed);
    const complete = Boolean(seriesLabel && seasonNumber != null && episodeNumber != null);

    /** @type {'confirmed_from_filename' | 'confirmed' | 'needs_confirmation'} */
    let status = 'needs_confirmation';
    let statusLabel = CREATOR_IDENTITY_STATUS.NEEDS_CONFIRMATION;
    if (complete) {
        if (confirmedByCreator) {
            status = 'confirmed';
            statusLabel = CREATOR_IDENTITY_STATUS.CONFIRMED;
        } else {
            status = 'confirmed_from_filename';
            statusLabel = CREATOR_IDENTITY_STATUS.CONFIRMED_FROM_FILENAME;
        }
    }

    const mediaAssetId = String(sealed.id || sealed.mediaAssetId || sealed.assetId || '').trim();

    return {
        mediaAssetId,
        seriesLabel: seriesLabel || '',
        seasonNumber: complete ? /** @type {number} */ (seasonNumber) : null,
        episodeNumber: complete ? /** @type {number} */ (episodeNumber) : null,
        seriesDisplay: seriesLabel || '—',
        seasonDisplay: complete ? `Season ${seasonNumber}` : '—',
        episodeDisplay: complete ? `Episode ${episodeNumber}` : '—',
        status,
        statusLabel,
        summaryLine: complete ? `${seriesLabel} • Season ${seasonNumber} • Episode ${episodeNumber}` : '',
        needsConfirmation: status === 'needs_confirmation',
        canEdit: true
    };
}

/**
 * Normalize + seal a creator identity edit onto a vault asset.
 * Preserves mediaAssetId and playback URL fields; does not touch catalog/publish.
 *
 * @param {Record<string, unknown> | null | undefined} asset
 * @param {{ seriesLabel?: unknown; seasonNumber?: unknown; episodeNumber?: unknown }} draft
 * @returns {Record<string, unknown>}
 */
export function applyCreatorVaultIdentityConfirmation(asset, draft = {}) {
    if (!asset || typeof asset !== 'object') {
        throw new Error('Vault asset required for identity confirmation');
    }
    const seriesLabel = cleanSeriesBase(draft.seriesLabel ?? '');
    const seasonNumber = positiveInt(draft.seasonNumber);
    const episodeNumber = positiveInt(draft.episodeNumber);
    if (!seriesLabel || seasonNumber == null || episodeNumber == null) {
        throw new Error('Series title, season, and episode are required');
    }

    const mediaAssetId = String(asset.id || asset.mediaAssetId || asset.assetId || '').trim();
    const next = {
        ...asset,
        ...(mediaAssetId ? { id: mediaAssetId } : {}),
        seriesLabel,
        seasonNumber,
        episodeNumber,
        seriesIdentity: {
            seriesLabel,
            seasonNumber,
            episodeNumber,
            confirmedByCreator: true
        }
    };

    const sealed = sealVaultSeriesIdentityForStorage(next);
    if (!sealed || typeof sealed !== 'object') {
        return /** @type {Record<string, unknown>} */ (next);
    }

    // Seal drops non-authority fields; re-assert creator confirmation flag for UI state.
    const nested =
        sealed.seriesIdentity && typeof sealed.seriesIdentity === 'object'
            ? { .../** @type {Record<string, unknown>} */ (sealed.seriesIdentity), confirmedByCreator: true }
            : {
                  seriesLabel,
                  seasonNumber,
                  episodeNumber,
                  confirmedByCreator: true
              };

    return {
        ...sealed,
        seriesLabel: String(nested.seriesLabel || seriesLabel).trim(),
        seasonNumber: positiveInt(nested.seasonNumber) ?? seasonNumber,
        episodeNumber: positiveInt(nested.episodeNumber) ?? episodeNumber,
        seriesIdentity: {
            seriesLabel: String(nested.seriesLabel || seriesLabel).trim(),
            seasonNumber: positiveInt(nested.seasonNumber) ?? seasonNumber,
            episodeNumber: positiveInt(nested.episodeNumber) ?? episodeNumber,
            confirmedByCreator: true
        }
    };
}

/**
 * True when presentation text (and optional extra strings) lack banned internals language.
 * @param {ReturnType<typeof presentVaultIdentityForCreator> | null | undefined} presentation
 * @param {string[]} [extraStrings]
 */
export function isCreatorIdentityCopySafe(presentation, extraStrings = []) {
    const parts = [
        presentation?.seriesDisplay,
        presentation?.seasonDisplay,
        presentation?.episodeDisplay,
        presentation?.statusLabel,
        presentation?.summaryLine,
        ...extraStrings
    ]
        .map((s) => String(s || '').toLowerCase())
        .join(' ');
    return !CREATOR_IDENTITY_BANNED_TERMS.some((term) => parts.includes(term));
}
