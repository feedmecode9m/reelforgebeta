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
import {
    loadCreatorCatalogMetadata,
    previewCreatorShelfClassification
} from '../feed/creatorCatalogMetadata.js';

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
 * Catalog episode publication status for a vault asset (when bound).
 * Presentation only — independent of Hero PUBLIC APPROVED / manager storyStatus.
 * Underlying enum remains draft | ready | published | archived.
 * @param {Record<string, unknown> | null | undefined} asset
 */
export function presentVaultPublishingStatus(asset) {
    const id = String(asset?.id || asset?.mediaAssetId || asset?.assetId || '').trim();
    const wrap = id ? getEpisodeByReelId(id) : null;
    const status = String(wrap?.episode?.status || 'draft').toLowerCase();
    const allowed = ['draft', 'ready', 'published', 'archived'];
    const normalized = allowed.includes(status) ? status : 'draft';
    const bound = Boolean(wrap?.episode);
    const statusWord =
        normalized.charAt(0).toUpperCase() + normalized.slice(1);
    return {
        status: /** @type {'draft' | 'ready' | 'published' | 'archived'} */ (normalized),
        /** Short catalog status word (Draft / Ready / Published / Archived). */
        label: statusWord,
        /** Creator-facing axis label — catalog packaging, not Hero approval. */
        axisLabel: 'Episode publication',
        /** Full status for UI: e.g. "Published" or "Draft · not bound to catalog". */
        displayLabel: bound ? statusWord : `${statusWord} · not bound to catalog`,
        bound,
        hint: 'Series catalog status for this episode. Independent of Hero PUBLIC APPROVED.'
    };
}

/**
 * Unified creator completeness card model for a ready MP4 vault asset.
 * Axes are independent: Identity ≠ Presentation package ≠ Episode publication ≠ Media.
 * @param {Record<string, unknown> | null | undefined} asset
 */
export function presentVaultEpisodeCompleteness(asset) {
    const identity = presentVaultIdentityForCreator(asset);
    const packagePres = presentVaultEpisodeEnrichmentForCreator(asset);
    const enrich = readVaultEpisodeEnrichment(asset);
    const media = presentVaultMediaAvailability(asset);
    const publishing = presentVaultPublishingStatus(asset);
    const mediaAssetId = identity.mediaAssetId || packagePres.mediaAssetId || '';
    // Primary catalog authority (reel_titles_persistent) — fill presentation display holes
    // without requiring series identity. Does not invent titles from UUID/camera dumps.
    const catalog = mediaAssetId ? loadCreatorCatalogMetadata(mediaAssetId) : null;
    const displayTitle = enrich.title || catalog?.title || '';
    const displayDescription = enrich.description || catalog?.description || '';
    const discoveryTags = Array.isArray(catalog?.tags) ? catalog.tags : [];
    const discoveryCategory = catalog?.category || '';
    /** Phase 20: distinguish missing vs intentionally cleared primary fields. */
    const descriptionFieldState = displayDescription
        ? 'set'
        : catalog?.primaryDescriptionAuthority
          ? 'cleared'
          : 'missing';
    const tagsFieldState = discoveryTags.length
        ? 'set'
        : catalog?.primaryTagsAuthority
          ? 'cleared'
          : 'missing';
    const categoryFieldState = discoveryCategory
        ? 'set'
        : catalog?.primaryCategoryAuthority
          ? 'cleared'
          : 'missing';
    const shelfPreview = previewCreatorShelfClassification({
        title: displayTitle,
        description: displayDescription,
        tags: discoveryTags,
        category: discoveryCategory || 'Trending',
        fileName: String(asset?.fileName || asset?.name || '')
    });

    const identityReady = !identity.needsConfirmation;
    const titleOk = Boolean(displayTitle);
    const descOk = Boolean(displayDescription);
    const artOk = Boolean(enrich.artworkUrl);
    const tagsOk = discoveryTags.length > 0;
    const categoryOk = Boolean(discoveryCategory);
    // Phase 25: intentionally cleared fields are addressed — never reported as Missing.
    const descriptionAddressed = descOk || descriptionFieldState === 'cleared';
    const tagsAddressed = tagsOk || tagsFieldState === 'cleared';
    const presentationReady = titleOk && descriptionAddressed && artOk;

    /** Presentation-package gaps only (Title / Description / Artwork). Cleared ≠ Missing. */
    /** @type {string[]} */
    const presentationMissing = [];
    if (!titleOk) presentationMissing.push('Title');
    if (!descriptionAddressed) presentationMissing.push('Description');
    if (!artOk) presentationMissing.push('Artwork');

    /** Aggregated gaps for compatibility with existing consumers (lowercase). */
    /** @type {string[]} */
    const missing = [];
    if (!identityReady) missing.push('identity');
    if (!titleOk) missing.push('title');
    if (!descriptionAddressed) missing.push('description');
    if (!artOk) missing.push('artwork');
    if (media.state === 'missing') missing.push('media');

    return {
        mediaAssetId,
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
            /** What is this video? Confirm Series / Season / Episode. */
            axisLabel: 'Identity',
            statusLabel: identityReady ? 'Confirmed' : 'Needs confirmation',
            needsConfirmation: identity.needsConfirmation,
            marks: {
                series: Boolean(identity.seriesLabel),
                season: identity.seasonNumber != null,
                episode: identity.episodeNumber != null
            }
        },
        presentation: {
            ready: presentationReady,
            /** Episode package readiness (title / description / artwork) — not publication. */
            axisLabel: 'Presentation',
            statusLabel: presentationReady ? 'Ready' : 'Incomplete',
            title: displayTitle,
            description: displayDescription,
            artworkUrl: enrich.artworkUrl || '',
            /** Optional discovery fields from primary catalog metadata (not required for ready). */
            tags: discoveryTags,
            category: discoveryCategory,
            descriptionFieldState,
            tagsFieldState,
            categoryFieldState,
            /** Same classifier path as feed — not a second classifier. */
            shelfPreview: {
                primaryCategory: shelfPreview.primaryCategory,
                explicit: shelfPreview.explicit,
                confidenceLabel: shelfPreview.confidenceLabel,
                source: shelfPreview.source
            },
            marks: {
                title: titleOk,
                /** Addressed = populated or intentionally cleared (not the same as Set). */
                description: descriptionAddressed,
                artwork: artOk,
                tags: tagsAddressed,
                category: categoryOk
            },
            missing: presentationMissing,
            /** Package editing is available even when identity is incomplete (Phase 19). */
            canEditWithoutIdentity: true,
            hint: presentationReady
                ? descriptionFieldState === 'cleared'
                    ? 'Package ready. Description is cleared on purpose — not missing. Tags and shelf improve discovery.'
                    : 'Package fields are set. Tags and shelf category improve discovery; this is not catalog publication.'
                : 'Add title, description, and artwork anytime — series identity is optional for discovery metadata.'
        },
        media: {
            ...media,
            axisLabel: 'Media',
            statusLabel: media.state === 'available' ? 'Available' : 'Missing',
            hint: 'Whether a playable file is available. Independent of package fields and publication.'
        },
        publishing: {
            ...publishing,
            /** Alias used by UI for episode catalog status. */
            statusLabel: publishing.displayLabel
        },
        /**
         * Hero approval is a separate product axis (Hero Manager + server grant).
         * Never inferred from episode catalog status.
         */
        hero: {
            axisLabel: 'Hero',
            statusLabel: 'Managed in Hero Manager',
            hint: 'PUBLIC APPROVED is server-authoritative Hero presentation grant — not episode Draft/Ready/Published.'
        },
        missing,
        presentationMissing,
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
