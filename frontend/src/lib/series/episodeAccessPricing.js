/**
 * Per-MP4 Free / Paid access for All Episodes (Theater) + Studio admin.
 * Metadata-only — does not change playback enforcement.
 */

import { getStoredReelSeriesMetadata } from './seriesMetadataStorage.js';
import {
    PLATFORM_FREE_WATCH_LIMIT,
    resolveDefaultPaidEpisodePrice
} from './platformAccessPricingFramework.js';
import { lookupVicGEpisodeBinding, VIC_G_SERIES_ID } from './vicGSeriesPackage.js';

/** @typedef {'free' | 'paid'} EpisodeAccessMode */

/**
 * @typedef {Object} EpisodeAccessPricing
 * @property {EpisodeAccessMode} mode
 * @property {string} price - Normalized dollars string e.g. "4.99" (empty when free)
 * @property {string} badgeLabel - Viewer badge: "FREE" or "$4.99"
 * @property {boolean} isFree
 */

/**
 * @param {unknown} value
 * @returns {EpisodeAccessMode}
 */
export function normalizeAccessMode(value) {
    const raw = String(value || '')
        .trim()
        .toLowerCase();
    if (
        raw === 'paid' ||
        raw === 'pay' ||
        raw === 'premium' ||
        raw === 'locked' ||
        raw === 'episode_lock' ||
        raw === 'season_pass' ||
        raw === 'vip' ||
        raw === 'subscription'
    ) {
        return 'paid';
    }
    return 'free';
}

/**
 * Normalize a typed price into "X.XX" or "".
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeEpisodePrice(value) {
    if (value == null) return '';
    const raw = String(value).trim().replace(/^\$/, '').replace(/,/g, '');
    if (!raw) return '';
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return '';
    return n.toFixed(2);
}

/**
 * @param {unknown} mode
 * @param {unknown} price
 * @returns {EpisodeAccessPricing}
 */
export function buildEpisodeAccessPricing(mode, price) {
    const accessMode = normalizeAccessMode(mode);
    const normalizedPrice = normalizeEpisodePrice(price);
    if (accessMode === 'paid' && normalizedPrice) {
        return {
            mode: 'paid',
            price: normalizedPrice,
            badgeLabel: `$${normalizedPrice}`,
            isFree: false
        };
    }
    if (accessMode === 'paid' && !normalizedPrice) {
        const defaultPrice = resolveDefaultPaidEpisodePrice();
        return {
            mode: 'paid',
            price: defaultPrice,
            badgeLabel: `$${defaultPrice}`,
            isFree: false
        };
    }
    return {
        mode: 'free',
        price: '',
        badgeLabel: 'FREE',
        isFree: true
    };
}

/**
 * Read access from a vault asset row (nested or flat fields).
 * @param {Record<string, unknown> | null | undefined} asset
 * @returns {EpisodeAccessPricing | null} null when unset (caller may default to free)
 */
export function readVaultEpisodeAccess(asset) {
    if (!asset || typeof asset !== 'object') return null;
    const nested =
        asset.episodeAccess && typeof asset.episodeAccess === 'object'
            ? /** @type {Record<string, unknown>} */ (asset.episodeAccess)
            : null;
    const boolFree =
        asset.isFree === true || asset.is_free === true
            ? 'free'
            : asset.isFree === false || asset.is_free === false
              ? 'paid'
              : '';
    const modeRaw =
        nested?.mode ??
        nested?.accessMode ??
        asset.accessMode ??
        asset.access_mode ??
        boolFree;
    const priceRaw =
        nested?.price ??
        asset.price ??
        asset.episodePrice ??
        asset.episode_price ??
        asset.vipPrice ??
        asset.vip_price ??
        asset.seasonPrice ??
        asset.season_price ??
        asset.subscriptionPrice ??
        asset.subscription_price ??
        '';
    const hasExplicit =
        Boolean(String(modeRaw || '').trim()) ||
        Boolean(String(priceRaw || '').trim()) ||
        nested != null ||
        asset.isFree === true ||
        asset.isFree === false ||
        asset.is_free === true ||
        asset.is_free === false;
    if (!hasExplicit) return null;
    return buildEpisodeAccessPricing(modeRaw || (priceRaw ? 'paid' : 'free'), priceRaw);
}

/**
 * Durable nest for vault storage.
 * @param {Partial<{ mode?: unknown; accessMode?: unknown; price?: unknown }> | null | undefined} draft
 * @returns {{ mode: EpisodeAccessMode; price: string } | null}
 */
export function normalizeVaultEpisodeAccess(draft) {
    if (!draft || typeof draft !== 'object') return null;
    const pricing = buildEpisodeAccessPricing(
        draft.mode ?? draft.accessMode,
        draft.price
    );
    return { mode: pricing.mode, price: pricing.price };
}

/** @param {unknown} value @returns {boolean} */
export function isPaidSeriesAccessMode(value) {
    const raw = String(value || '')
        .trim()
        .toUpperCase();
    return ['PAID', 'EPISODE_LOCK', 'SEASON_PASS', 'VIP', 'SUBSCRIPTION'].includes(raw);
}

/** @param {{ episodeNumber?: unknown; isFreeOverride?: unknown; accessMode?: unknown; freeEpisodeCount?: unknown }} input */
export function resolveSeriesEpisodeAccessPricing(input = {}) {
    const episodeNumber = Number(input.episodeNumber);
    if (!Number.isFinite(episodeNumber) || episodeNumber < 1) return null;
    if (input.isFreeOverride === true) return buildEpisodeAccessPricing('free', '');
    if (!isPaidSeriesAccessMode(input.accessMode)) return null;
    const freeCountRaw = Number(input.freeEpisodeCount);
    const freeEpisodeCount =
        Number.isFinite(freeCountRaw) && freeCountRaw >= 0
            ? Math.floor(freeCountRaw)
            : PLATFORM_FREE_WATCH_LIMIT;
    return episodeNumber <= freeEpisodeCount
        ? buildEpisodeAccessPricing('free', '')
        : buildEpisodeAccessPricing('paid', resolveDefaultPaidEpisodePrice());
}

/**
 * Price field default for Access & Price editors (paid → framework monthly price).
 * @param {unknown} mode
 * @param {unknown} price
 * @returns {string}
 */
export function resolveAccessPriceDraft(mode, price) {
    const accessMode = normalizeAccessMode(mode);
    if (accessMode !== 'paid') return '';
    return normalizeEpisodePrice(price) || resolveDefaultPaidEpisodePrice();
}

/**
 * When creator switches Viewer access to Paid, pre-fill framework price if empty.
 * @param {'free' | 'paid'} mode
 * @param {unknown} currentPrice
 * @returns {string}
 */
export function resolveAccessPriceOnModeChange(mode, currentPrice) {
    if (mode !== 'paid') return '';
    return resolveAccessPriceDraft('paid', currentPrice);
}

/**
 * Resolve viewer badge for an episode / vault media id.
 * Priority: episode fields → vault asset → series metadata → default FREE.
 *
 * @param {{
 *   episode?: Record<string, unknown> | null;
 *   mediaAssetId?: string | null;
 *   reelId?: string | null;
 *   vaultAsset?: Record<string, unknown> | null;
 *   seriesAccessMode?: unknown;
 *   freeEpisodeCount?: unknown;
 *   seriesId?: string | null;
 * }} input
 * @returns {EpisodeAccessPricing}
 */
export function resolveEpisodeAccessPricing(input = {}) {
    const episode = input.episode && typeof input.episode === 'object' ? input.episode : null;
    if (episode) {
        const fromEp = readVaultEpisodeAccess(episode);
        if (fromEp) return fromEp;
        if (
            episode.accessMode != null ||
            episode.price != null ||
            episode.isFree === true ||
            episode.isFree === false
        ) {
            return buildEpisodeAccessPricing(
                episode.accessMode ?? (episode.isFree === false ? 'paid' : 'free'),
                episode.price
            );
        }
    }

    const fromVault = readVaultEpisodeAccess(input.vaultAsset || null);
    if (fromVault) return fromVault;

    const ids = [input.mediaAssetId, input.reelId, episode?.mediaAssetId, episode?.reelId]
        .map((v) => String(v || '').trim())
        .filter(Boolean);
    for (const id of ids) {
        const meta = getStoredReelSeriesMetadata(id);
        if (!meta) continue;
        if (
            meta.accessMode != null ||
            meta.price != null ||
            /** @type {{ isFree?: boolean }} */ (meta).isFree != null
        ) {
            return buildEpisodeAccessPricing(
                meta.accessMode ??
                    (/** @type {{ isFree?: boolean }} */ (meta).isFree === false ? 'paid' : 'free'),
                meta.price
            );
        }
    }

    for (const id of ids) {
        const vicBinding = lookupVicGEpisodeBinding(id);
        if (!vicBinding) continue;
        const fromSeries = resolveSeriesEpisodeAccessPricing({
            episodeNumber: vicBinding.episodeNumber,
            accessMode: 'SUBSCRIPTION',
            freeEpisodeCount: PLATFORM_FREE_WATCH_LIMIT
        });
        if (fromSeries) return fromSeries;
    }

    const vaultAsset =
        input.vaultAsset && typeof input.vaultAsset === 'object' ? input.vaultAsset : null;
    const vaultEpisodeNumber = Number(
        vaultAsset?.episodeNumber ?? vaultAsset?.episode_number ?? episode?.episodeNumber ?? episode?.episode_number
    );
    if (Number.isFinite(vaultEpisodeNumber) && vaultEpisodeNumber >= 1) {
        const vaultSeriesId = String(
            input.seriesId ||
                vaultAsset?.seriesId ||
                vaultAsset?.series_id ||
                episode?.seriesId ||
                episode?.series_id ||
                ''
        ).trim();
        const seriesAccessMode =
            input.seriesAccessMode ??
            (vaultSeriesId === VIC_G_SERIES_ID ? 'SUBSCRIPTION' : undefined);
        const freeEpisodeCount =
            input.freeEpisodeCount ??
            (vaultSeriesId === VIC_G_SERIES_ID ? PLATFORM_FREE_WATCH_LIMIT : undefined);
        const fromVaultSeries = resolveSeriesEpisodeAccessPricing({
            episodeNumber: vaultEpisodeNumber,
            accessMode: seriesAccessMode,
            freeEpisodeCount
        });
        if (fromVaultSeries) return fromVaultSeries;
    }

    const seriesId = String(
        input.seriesId || episode?.seriesId || episode?.series_id || ''
    ).trim();
    const seriesAccessMode =
        input.seriesAccessMode ??
        (seriesId === VIC_G_SERIES_ID ? 'SUBSCRIPTION' : undefined);
    const freeEpisodeCount =
        input.freeEpisodeCount ??
        (seriesId === VIC_G_SERIES_ID ? PLATFORM_FREE_WATCH_LIMIT : undefined);
    const fromSeries = resolveSeriesEpisodeAccessPricing({
        episodeNumber: episode?.episodeNumber ?? episode?.episode_number,
        isFreeOverride: episode?.isFreeOverride ?? episode?.is_free_override,
        accessMode: seriesAccessMode,
        freeEpisodeCount
    });
    if (fromSeries) return fromSeries;

    return buildEpisodeAccessPricing('free', '');
}

/**
 * Attach access onto a vault asset without mutating playback identity.
 * @param {Record<string, unknown>} asset
 * @param {{ mode?: unknown; accessMode?: unknown; price?: unknown }} draft
 */
export function applyVaultEpisodeAccess(asset, draft = {}) {
    if (!asset || typeof asset !== 'object') return asset;
    const access = normalizeVaultEpisodeAccess(draft);
    /** @type {Record<string, unknown>} */
    const next = { ...asset };
    if (!access) {
        delete next.episodeAccess;
        delete next.accessMode;
        delete next.price;
        delete next.isFree;
        return next;
    }
    next.episodeAccess = access;
    next.accessMode = access.mode;
    next.price = access.price;
    next.isFree = access.mode === 'free';
    return next;
}

/**
 * Notify Theater / All Episodes to remount access badges.
 * @param {{ reelId?: string; mode?: string; price?: string }} detail
 */
export function dispatchVaultAccessUpdated(detail = {}) {
    if (typeof window === 'undefined') return;
    try {
        window.dispatchEvent(
            new CustomEvent('reelforge:vault-access-updated', {
                detail: {
                    reelId: String(detail.reelId || '').trim(),
                    mode: String(detail.mode || '').trim(),
                    price: String(detail.price || '').trim(),
                    at: Date.now()
                }
            })
        );
    } catch {
        /* ignore */
    }
}
