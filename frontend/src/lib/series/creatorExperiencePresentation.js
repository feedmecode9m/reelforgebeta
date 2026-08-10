/**
 * Creator-facing completeness presentation for Hero Vault cards + Assembly polish.
 * Presentation only — does not mutate vault identity, enrichment, or catalog authority.
 */

import { presentVaultIdentityForCreator } from './vaultIdentityConfirmation.js';
import {
    presentVaultEpisodeEnrichmentForCreator,
    readVaultEpisodeEnrichment
} from './vaultEpisodeEnrichment.js';
import {
    resolveAssemblyMediaUrl,
    resolveVaultAssetForEpisode,
    vaultIdentityIsConfirmed
} from './seriesAssemblyWorkflow.js';
import { getEpisodeByReelId } from './seriesStore.js';

/**
 * Creator-safe media availability for a vault asset.
 * @param {Record<string, unknown> | null | undefined} asset
 */
export function presentVaultMediaAvailability(asset) {
    const url = resolveAssemblyMediaUrl(asset);
    const available = Boolean(url);
    return {
        state: /** @type {'available' | 'missing'} */ (available ? 'available' : 'missing'),
        label: available ? 'Available' : 'Missing',
        url
    };
}

/**
 * Catalog publishing status for a vault asset (when bound). Presentation only.
 * @param {Record<string, unknown> | null | undefined} asset
 */
export function presentVaultPublishingStatus(asset) {
    const id = String(asset?.id || asset?.mediaAssetId || asset?.assetId || '').trim();
    const wrap = id ? getEpisodeByReelId(id) : null;
    const status = String(wrap?.episode?.status || 'draft').toLowerCase();
    const allowed = ['draft', 'ready', 'published', 'archived'];
    const normalized = allowed.includes(status) ? status : 'draft';
    return {
        status: /** @type {'draft' | 'ready' | 'published' | 'archived'} */ (normalized),
        label: normalized.charAt(0).toUpperCase() + normalized.slice(1),
        bound: Boolean(wrap?.episode)
    };
}

/**
 * Unified creator completeness card model for a ready MP4 vault asset.
 * @param {Record<string, unknown> | null | undefined} asset
 */
export function presentVaultEpisodeCompleteness(asset) {
    const identity = presentVaultIdentityForCreator(asset);
    const packagePres = presentVaultEpisodeEnrichmentForCreator(asset);
    const enrich = readVaultEpisodeEnrichment(asset);
    const media = presentVaultMediaAvailability(asset);
    const publishing = presentVaultPublishingStatus(asset);

    const identityReady = !identity.needsConfirmation;
    const titleOk = Boolean(enrich.title);
    const descOk = Boolean(enrich.description);
    const artOk = Boolean(enrich.artworkUrl);
    const presentationReady = titleOk && descOk && artOk;

    /** @type {string[]} */
    const missing = [];
    if (!identityReady) missing.push('identity');
    if (!titleOk) missing.push('title');
    if (!descOk) missing.push('description');
    if (!artOk) missing.push('artwork');
    if (media.state === 'missing') missing.push('media');

    return {
        mediaAssetId: identity.mediaAssetId || packagePres.mediaAssetId || '',
        /** Clear Series / Season / Episode values for creator (no parser language). */
        series: identity.seriesLabel || '',
        season: identity.seasonNumber,
        episode: identity.episodeNumber,
        seriesDisplay: identity.seriesLabel || '—',
        seasonDisplay: identity.seasonNumber != null ? String(identity.seasonNumber) : '—',
        episodeDisplay: identity.episodeNumber != null ? String(identity.episodeNumber) : '—',
        identityLine:
            identityReady && identity.seriesLabel
                ? `${identity.seriesLabel} • S${identity.seasonNumber} • E${identity.episodeNumber}`
                : '',
        identity: {
            ready: identityReady,
            statusLabel: identity.statusLabel,
            needsConfirmation: identity.needsConfirmation,
            marks: {
                series: Boolean(identity.seriesLabel),
                season: identity.seasonNumber != null,
                episode: identity.episodeNumber != null
            }
        },
        presentation: {
            ready: presentationReady,
            title: enrich.title || '',
            description: enrich.description || '',
            artworkUrl: enrich.artworkUrl || '',
            marks: {
                title: titleOk,
                description: descOk,
                artwork: artOk
            }
        },
        media,
        publishing,
        missing,
        complete: missing.length === 0
    };
}

/**
 * True when copy lacks internal/admin/parser language.
 * @param {string[]} strings
 */
export function isCreatorExperienceCopySafe(strings) {
    const bag = (Array.isArray(strings) ? strings : []).map((s) => String(s || '').toLowerCase()).join(' ');
    const banned = [
        'confidence',
        'parseconfidence',
        'parse confidence',
        'validator',
        'inference',
        'high-confidence',
        'admin',
        'ssr'
    ];
    return !banned.some((t) => bag.includes(t));
}

/**
 * Assembly row polish markers for ready-gate UI.
 * @param {ReturnType<import('./seriesAssemblyWorkflow.js').assessEpisodeAssembly>} assessed
 */
export function polishAssemblyRowMarks(assessed) {
    if (!assessed) {
        return {
            identityMark: false,
            presentationMarks: { title: false, description: false, artwork: false },
            mediaMark: false,
            publishLabel: 'draft'
        };
    }
    const missing = new Set(assessed.presentation?.missing || []);
    return {
        identityMark: assessed.identity?.state === 'confirmed',
        presentationMarks: {
            title: !missing.has('title') && Boolean(assessed.presentation?.title),
            description: !missing.has('description') && Boolean(assessed.presentation?.description),
            artwork: !missing.has('artwork') && Boolean(assessed.presentation?.artworkUrl)
        },
        mediaMark: assessed.media?.state === 'available',
        publishLabel: assessed.publishing?.status || 'draft',
        canMarkReady: assessed.canMarkReady === true,
        missingReady: assessed.readyRequirements?.missing || []
    };
}

// Touch resolve for tree-shaking clarity in audits
export function _identityConfirmed(asset) {
    return vaultIdentityIsConfirmed(asset);
}

export function _resolveBoundAsset(episode, assets) {
    return resolveVaultAssetForEpisode(episode, assets);
}
