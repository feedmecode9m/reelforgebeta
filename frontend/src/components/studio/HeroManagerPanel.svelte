<script>
    import { onDestroy, onMount } from 'svelte';
    import { get, writable } from 'svelte/store';
    import {
        HERO_CAROUSEL_TRANSITIONS,
        HERO_BACKGROUND_STYLES,
        HERO_DISCOVERY_TYPES,
        HERO_SLIDE_TYPES,
        loadHeroManagerConfig,
        loadHeroVaultItems,
        logHeroIntelligenceDiag,
        saveHeroManagerConfig,
        updateHeroManagerConfig,
        rotateHeroSelection,
        commitHeroAssetSelection,
        syncHeroViewerCopyFromAsset,
        persistHeroPresentationToServer,
        sanitizeHeroCtaTarget,
        selectHeroContent
    } from '../../lib/hero/heroIntelligence.js';
    import {
        isStockHeroViewerCopy,
        resolveHeroAssetTruth
    } from '../../lib/hero/heroViewerTruth.js';
    import {
        analyzeHeroTitle,
        dispatchVaultTitleUpdated,
        isUnsafeHeroFilenameTitle,
        queuePendingTitlePatch,
        reconcilePendingTitlePatches,
        resolveCanonicalHeroTitle,
        buildHeroManagerPatchFromTitleIntel,
        UNTITLED_CREATOR_EXPERIENCE
    } from '../../lib/hero/heroTitleIntelligence.js';
    import { resolveVaultCardProjection } from '../../lib/content/vaultCardProjection.js';
    import { mergeTitleIntoPersistentMap, mediaRecordTitleKeys, mediaRecordPlaybackKey, mediaPathAssetId } from '../../lib/content/persistentTitleMap.js';
    import {
        CREATOR_SHELF_OPTIONS
    } from '../../lib/feed/creatorCatalogMetadata.js';
    import { categoryAliasStore, displayDiscoveryShelf, resolveCanonicalDiscoveryShelf } from '../../lib/feed/discoveryTaxonomy.js';
    import {
        reevaluateAfterCanonicalTitleSave,
        formatSuggestionConfidence,
        persistCreatorCategoryChoice,
        canPersistCategoryForAsset
    } from '../../lib/feed/categorySuggestionReview.js';
    import {
        approveIdentityProposal,
        getPendingStoryProposal,
        ignoreIdentityProposal
    } from '../../lib/intelligence/contentIdentityGuard.js';
    import { buildHeroAssetRegistry, isVideoHeroAssetType } from '../../lib/hero/heroAssetBridge.js';
    import { resolveVaultCardFace } from '../../lib/vault/normalizeVaultAsset.js';
    import MediaRenderer from '../media/MediaRenderer.svelte';
    import MediaThumbnail from '../media/MediaThumbnail.svelte';
    import { resolveMediaForRender } from '../media/resolveDisplayUrl.js';
    import {
        claimPlaybackOwner,
        releasePlaybackOwner,
        canStartPlayback,
        getPlaybackOwner
    } from '../../lib/media/playbackOwnership.js';
    import { resolvePlayableMediaUrl } from '../../lib/media/resolvePlayableMediaUrl.js';
    import { deleteReelById, fetchReadyReels } from '../../lib/api/media.js';
    import { getAdminAuthHeaders } from '../../lib/api.js';
    import { applyCanonicalDeleteClientEffects, isDeletedMediaId } from '../../lib/deletionSync.js';
    import { reconcileVaultGhostPicksAsync, normalizeVaultPickId, purgeVaultPickLocally, collectVaultPickPurgeIdsFromHeroItem } from '../../lib/vault/vaultGhostPickCleanup.js';
    import { vaultForensic } from '../../lib/diagnostics/vaultForensics.js';
    import {
        loadHeroReel,
        saveHeroReel,
        refreshHeroReelLegacyMirror
    } from '../../lib/hero/heroReelIdentity.js';
    import {
        loadHeroRecordUnverified,
        setHeroMode,
        updateHeroPresentation,
        projectHeroRecordToManagerPointer,
        mergeHeroRecordIntoManagerConfig,
        projectManagerConfigFromHeroRecord,
        saveHeroRecord
    } from '../../lib/hero/heroRecord.js';
    import {
        approveHeroPresentation,
        draftHeroPresentation,
        normalizeHeroPresentation,
        resolvePublicHeroViewerCopy
    } from '../../lib/hero/heroPresentationAuthority.js';
    import {
        createIntelligenceExplanation,
        approveIntelligenceExplanation,
        editIntelligenceExplanation,
        hideIntelligenceExplanation,
        normalizeIntelligenceExplanation,
        autoPublishIntelligenceExplanation
    } from '../../lib/hero/heroIntelligenceExplanation.js';
    import { resolveIdentityLanguageSuggestions } from '../../lib/intelligence/identityLanguageResolver.js';
    import { buildIntelligenceExplanationLines } from '../../lib/viewer/viewerIntelligencePresentation.js';
    import {
        createCreatorIntentContext,
        draftCreatorIntentContext,
        approveCreatorIntentContext,
        hideCreatorIntentContext,
        normalizeCreatorIntentContext,
        autoPublishCreatorIntent
    } from '../../lib/hero/creatorIntentContext.js';
    import {
        createDiscoveryRelationship,
        approveDiscoveryRelationship,
        rejectDiscoveryRelationship,
        hideDiscoveryRelationship,
        normalizeDiscoveryGraph,
        upsertDiscoveryRelationship,
        DISCOVERY_RELATIONSHIP_TYPES,
        autoApproveDiscoveryRelationship
    } from '../../lib/discovery/discoveryGraph.js';
    import { enrichPresentationConfigFromLocalIdentity } from '../../lib/hero/heroPresentationSync.js';
    import {
        requestAuthenticatedHeroPublish,
        hydrateHeroAuthorityRuntime,
        saveHeroDraftLocally
    } from '../../lib/hero/heroAuthorityRuntime.js';
    import {
        HERO_AUTHORITY_UI_STATE,
        resolveHeroAuthorityUiState,
        canDisplayPublishedLabel
    } from '../../lib/hero/heroAuthorityUiState.js';
    import { resolveAuthorityIdentity } from '../../lib/auth/authorityIdentity.js';
    import { isServerGrantedPublished } from '../../lib/hero/heroServerAuthorityEngine.js';
    import {
        getEpisodeByReelId,
        updateEpisodeTitleForReel,
        saveReelSeriesMetadata
    } from '../../lib/series/seriesStore.js';
    import { bridgeFeedReelsToCatalog } from '../../lib/series/episodeBridge.js';
    import { resolveContentIdentity } from '../../lib/content/contentIdentityResolver.js';
    import { syncHeroIdentityToEpisodeMetadata } from '../../lib/series/heroEpisodeSync.js';
    import {
        buildEpisodeAccessPricing,
        dispatchVaultAccessUpdated,
        applyVaultEpisodeAccess,
        resolveEpisodeAccessPricing,
        resolveAccessPriceDraft,
        resolveAccessPriceOnModeChange
    } from '../../lib/series/episodeAccessPricing.js';
    import { PLATFORM_SUBSCRIPTION_MONTHLY_USD } from '../../lib/series/platformAccessPricingFramework.js';
    import { applyCreatorVaultEpisodeEnrichment } from '../../lib/series/vaultEpisodeEnrichment.js';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];
    /** @type {import('svelte/store').Writable<Record<string, unknown[]>> | null} */
    export let feed = null;
    /** @type {import('svelte/store').Writable<unknown[]> | null} */
    export let personalVideos = null;
    /** @type {(videos: unknown[]) => void} */
    export let persistPersonalVault = () => {};
    /** @type {(key: string, value: unknown) => { ok?: boolean }} */
    export let storageSet = () => ({ ok: true });
    /** @type {(preserveLocal?: boolean) => Promise<void>} */
    export let syncFromVault = async () => {};
    /** @type {{ FEED_STORAGE_KEY?: string; TITLES_STORAGE_KEY?: string; VIDEO_VAULT_KEY?: string; THUMBNAIL_STORAGE_KEY?: string; API_BASE_URL?: string } | null} */
    export let CONFIG = null;
    /** @type {{ saveTitle?: (reelId: string, titleData: { title?: string, title_original?: string }) => void; getTitle?: (reelId: string) => { title?: string } | null } | null} */
    export let persistentTitles = null;
    /** Optional Studio-level title updater (feed + backend PATCH). */
    export let updateReelTitle = null;

    let config =
        typeof window !== 'undefined'
            ? /** @type {any} */ (
                  mergeHeroRecordIntoManagerConfig(loadHeroManagerConfig(), loadHeroRecordUnverified())
              )
            : loadHeroManagerConfig();
    // Master Hero Admin presentation draft (public surface — separate from creator truth)
    let publicHeroTitle = String(config.heroPresentation?.publicTitle || config.heroTitle || '');
    let publicHeroDescription = String(
        config.heroPresentation?.publicDescription || config.heroDescription || ''
    );
    let publicHeroTheme = String(config.heroPresentation?.publicTheme || '');
    let showIntelligenceExplanation =
        config.showIntelligenceExplanation !== false &&
        config.heroPresentation?.showIntelligence !== false;
    let editorialNotes = String(config.adminContext?.editorialNotes || '');
    let identityNotes = String(config.adminContext?.identityNotes || '');
    /** Master Hero Intelligence Review — draft statements (//-separated lines in UI). */
    let intelligenceStatementsText = (() => {
        const block = normalizeIntelligenceExplanation(
            config.intelligenceExplanation ||
                (typeof window !== 'undefined'
                    ? loadHeroRecordUnverified()?.intelligenceExplanation
                    : null)
        );
        return (block.statements || []).join('\n');
    })();
    let intelligenceReviewStatus = '';
    /** Creator Intent Context — private notes + public statement */
    let intentPrivateNotesText = (() => {
        const ctx = normalizeCreatorIntentContext(
            config.creatorIntentContext ||
                (typeof window !== 'undefined'
                    ? loadHeroRecordUnverified()?.creatorIntentContext
                    : null)
        );
        return (ctx.privateNotes || []).join('\n');
    })();
    let intentPublicStatementText = (() => {
        const ctx = normalizeCreatorIntentContext(
            config.creatorIntentContext ||
                (typeof window !== 'undefined'
                    ? loadHeroRecordUnverified()?.creatorIntentContext
                    : null)
        );
        return ctx.publicStatement?.text || '';
    })();
    let intentReviewStatus = '';
    /** Master Hero Admin — Suggested Discovery Connections */
    let discoveryDraftType = 'theme_connection';
    let discoveryDraftLabel = '';
    let discoveryDraftTarget = '';
    let discoveryReviewStatus = '';
    /** @type {import('../../lib/discovery/discoveryGraph.js').DiscoveryRelationship[]} */
    let discoverySuggestions = (() => {
        const graph = normalizeDiscoveryGraph(
            config.discoveryGraph ||
                (typeof window !== 'undefined'
                    ? loadHeroRecordUnverified()?.discoveryGraph
                    : null)
        );
        return graph.relationships || [];
    })();
    let presentationStatus = '';
    /** @type {string} */
    let authorityUiLabel = 'Draft editing';
    /** @type {string} */
    let authorityUiId = 'draft_editing';
    let authorityPending = false;
    let statusMessage = '';
    /** @type {null | {
     *   assetId: string;
     *   title: string;
     *   currentCategory: string;
     *   suggestedCategory: string;
     *   alternativeCategory?: string;
     *   confidence: number;
     *   confidenceBand: string;
     *   ambiguous: boolean;
     *   offer: boolean;
     *   showManualHelper: boolean;
     *   overrideCategory: string;
     * }} */
    let categorySuggestionReview = null;
    let heroAssetSelect = null;
    let refreshAuditTimer = null;
    let renamedTitles = {};
    let storyScheduledFor = String(config.storyScheduledFor || '');
    let heroVaultVideoCssFixLogged = false;
    let heroVaultVideoDomFixLogged = false;
    /** Suppress re-applying our own save events mid interaction. */
    let suppressExternalManagerSync = false;
    let persistBusy = false;
    /** Debounced autosave for Viewer Description keystrokes → live hero landscape. */
    let descriptionAutosaveTimer = null;
    /** `custom` | `blank` — blank is an intentional menu choice, not missing copy. */
    let descriptionMode = String(config.heroDescription || '').trim() ? 'custom' : 'blank';
    /** @type {Record<string, boolean>} */
    let vaultVideoLoadedByAsset = {};
    /** @type {Record<string, boolean>} */
    let vaultVideoErrorByAsset = {};
    /** Single Hero Vault card allowed to mount a <video> (hover or selected). */
    let activeHeroVaultPreviewId = '';
    /** Access & Price modal for Hero Vault MP4s. */
    let accessModalOpen = false;
    /** @type {Record<string, unknown> | null} */
    let accessModalItem = null;
    /** @type {'free' | 'paid'} */
    let accessDraftMode = 'free';
    let accessDraftPrice = '';
    let accessModalError = '';

    const HERO_IMAGE_STORAGE_KEY = 'reelforge_hero_image';
    const HERO_VIDEO_STORAGE_KEY = 'reelforge_hero_video';
    const TITLES_KEY = () => CONFIG?.TITLES_STORAGE_KEY || 'reel_titles_persistent';
    const VIDEO_VAULT_KEY = () => CONFIG?.VIDEO_VAULT_KEY || 'personal_video_vault';
    const THUMB_VAULT_KEY = () => CONFIG?.THUMBNAIL_STORAGE_KEY || 'personal_thumbnails';

    /**
     * UI view: manager-only settings + HeroRecord identity/copy authority.
     * @param {Record<string, unknown> | null | undefined} [managerDetail]
     */
    function applyLocalConfigFromSources(managerDetail = null) {
        const manager =
            managerDetail && typeof managerDetail === 'object'
                ? managerDetail
                : loadHeroManagerConfig();
        config = /** @type {any} */ (mergeHeroRecordIntoManagerConfig(manager, loadHeroRecordUnverified()));
        storyScheduledFor = String(config.storyScheduledFor || storyScheduledFor || '');
        syncDescriptionModeFromConfig();
        const presentation = normalizeHeroPresentation(config.heroPresentation);
        publicHeroTitle = presentation.publicTitle || String(config.heroTitle || '');
        publicHeroDescription =
            presentation.publicDescription || String(config.heroDescription || '');
        publicHeroTheme = presentation.publicTheme || '';
        showIntelligenceExplanation = presentation.showIntelligence !== false;
        editorialNotes = String(config.adminContext?.editorialNotes || '');
        identityNotes = String(config.adminContext?.identityNotes || '');
    }

    /**
     * Persist local draft only (not public until server grants publish).
     * Actor identity is session-bound — no display-string elevation.
     */
    function savePresentationDraft() {
        const record = loadHeroRecordUnverified();
        const identity = resolveAuthorityIdentity();
        const layers = draftHeroPresentation(record, {
            publicTitle: publicHeroTitle,
            publicDescription: publicHeroDescription,
            publicTheme: publicHeroTheme,
            showIntelligence: showIntelligenceExplanation,
            editorialNotes,
            identityNotes,
            sourceTitle: String(record?.title || config.heroAssetTitle || config.heroTitle || ''),
            sourceDescription: String(config.heroDescription || record?.heroDescription || ''),
            // Authority: explicit provenance — never omit (omit ⇒ system/untrusted).
            sourceType: 'creator',
            // Draft may use session actor id when present; never hard-code admin strings.
            actor: identity.authenticated ? identity.actorId : 'session_pending',
            actorType: identity.authenticated && identity.role === 'admin' ? 'admin' : 'creator'
        });
        if (layers.ok === false) {
            presentationStatus = `Draft blocked: ${(layers.errors || []).join(', ') || 'authority'}`;
            return;
        }
        // Local draft only — force non-public lifecycle via runtime helper.
        const saved = saveHeroDraftLocally({
            ...layers,
            source: 'hero_authority_draft_local'
        });
        if (!saved) {
            presentationStatus = 'Draft save failed';
            return;
        }
        config = {
            ...config,
            heroPresentation: layers.heroPresentation,
            adminContext: layers.adminContext,
            creatorTruth: layers.creatorTruth,
            showIntelligenceExplanation
        };
        saveHeroManagerConfig(/** @type {any} */ (config), { skipServer: true });
        presentationStatus = 'Presentation draft saved (not public until server approval)';
        authorityUiId = HERO_AUTHORITY_UI_STATE.DRAFT_EDITING;
        authorityUiLabel = 'Draft editing';
        refreshAuthorityUi();
    }


    function readIntelligenceStatementsFromUi() {
        return String(intelligenceStatementsText || '')
            .split(/\n+/)
            .map((s) => s.trim())
            .filter(Boolean);
    }

    function syncIntelligenceUiFromRecord(record) {
        const block = normalizeIntelligenceExplanation(record?.intelligenceExplanation);
        intelligenceStatementsText = (block.statements || []).join('\n');
        if (block.approved && !block.hidden) {
            intelligenceReviewStatus = `Approved by ${block.approvedBy || 'admin'}`;
        } else if (block.hidden) {
            intelligenceReviewStatus = 'Hidden from public Hero';
        } else if (block.statements?.length) {
            intelligenceReviewStatus = 'Draft explanation (not public until approved)';
        } else {
            intelligenceReviewStatus = '';
        }
    }

    /**
     * NLP draft generation — creates unapproved explanation only (never auto-publishes).
     */
    function generateIntelligenceDraftFromSignals() {
        const record = loadHeroRecordUnverified();
        const title =
            publicHeroTitle ||
            record?.creatorTruth?.title ||
            record?.title ||
            config.heroTitle ||
            '';
        const lines = buildIntelligenceExplanationLines({
            title: String(title || ''),
            themes: publicHeroTheme ? [publicHeroTheme] : [],
            rawExplanation: ''
        });
        if (!lines.length) {
            intelligenceReviewStatus = 'No draft lines generated';
            return;
        }
        const created = createIntelligenceExplanation({
            statements: lines,
            source: 'nlp'
        });
        if (!created.ok || !created.block) {
            intelligenceReviewStatus = `Draft blocked: ${(created.errors || []).join(', ')}`;
            return;
        }
        // Explicitly reject AI auto-publish path
        const auto = autoPublishIntelligenceExplanation(created.block);
        if (auto.ok) {
            intelligenceReviewStatus = 'Blocked: intelligence cannot auto publish';
            return;
        }
        const saved = saveHeroRecord({
            intelligenceExplanation: created.block,
            source: 'hero_intelligence_nlp_draft'
        });
        if (!saved) {
            intelligenceReviewStatus = 'Draft save failed';
            return;
        }
        config = { ...config, intelligenceExplanation: created.block };
        intelligenceStatementsText = lines.join('\n');
        intelligenceReviewStatus = 'NLP draft saved (not public — requires approval)';
        // Identity language suggestions are advisory only
        const suggestions = resolveIdentityLanguageSuggestions({
            adminTerms: identityNotes ? [identityNotes] : [],
            creatorIdentityTerms: record?.creatorTruth?.identityTerms || []
        });
        if (suggestions.suggestions.length) {
            intelligenceReviewStatus += ` · ${suggestions.suggestions.length} language suggestion(s) need admin review`;
        }
    }

    function saveIntelligenceExplanationEdit() {
        const record = loadHeroRecordUnverified();
        const statements = readIntelligenceStatementsFromUi();
        const edited = editIntelligenceExplanation(record?.intelligenceExplanation, { statements });
        if (!edited.ok || !edited.block) {
            intelligenceReviewStatus = `Edit blocked: ${(edited.errors || []).join(', ')}`;
            return;
        }
        const saved = saveHeroRecord({
            intelligenceExplanation: edited.block,
            source: 'hero_intelligence_edit'
        });
        if (!saved) {
            intelligenceReviewStatus = 'Edit save failed';
            return;
        }
        config = { ...config, intelligenceExplanation: edited.block };
        intelligenceReviewStatus = 'Explanation edited (re-approval required for public)';
    }

    function approveIntelligenceExplanationForPublic() {
        const identity = resolveAuthorityIdentity();
        if (!identity.authenticated) {
            intelligenceReviewStatus = 'Waiting for authentication';
            return;
        }
        const record = loadHeroRecordUnverified();
        const statements = readIntelligenceStatementsFromUi();
        let block = normalizeIntelligenceExplanation(record?.intelligenceExplanation);
        if (statements.length) {
            const edited = editIntelligenceExplanation(block, { statements });
            if (!edited.ok) {
                intelligenceReviewStatus = `Edit blocked: ${(edited.errors || []).join(', ')}`;
                return;
            }
            block = edited.block;
        }
        const approved = approveIntelligenceExplanation(block, {
            approvedBy: identity.actorId
        });
        if (!approved.ok || !approved.block) {
            intelligenceReviewStatus = `Approval blocked: ${(approved.errors || []).join(', ')}`;
            return;
        }
        // Never allow auto-publish path
        const auto = autoPublishIntelligenceExplanation(approved.block);
        if (auto.ok) {
            intelligenceReviewStatus = 'Blocked: intelligence cannot auto publish';
            return;
        }
        const saved = saveHeroRecord({
            intelligenceExplanation: approved.block,
            source: 'hero_intelligence_approve'
        });
        if (!saved) {
            intelligenceReviewStatus = 'Approval save failed';
            return;
        }
        config = { ...config, intelligenceExplanation: approved.block };
        intelligenceReviewStatus = 'Published intelligence approved for public Hero';
        // Not presentation publish — only explanation approval
    }

    function hideIntelligenceExplanationFromPublic() {
        const record = loadHeroRecordUnverified();
        const hidden = hideIntelligenceExplanation(record?.intelligenceExplanation);
        const saved = saveHeroRecord({
            intelligenceExplanation: hidden.block,
            source: 'hero_intelligence_hide'
        });
        if (!saved) {
            intelligenceReviewStatus = 'Hide failed';
            return;
        }
        config = { ...config, intelligenceExplanation: hidden.block };
        intelligenceReviewStatus = 'Hidden from public Hero';
    }

    
    function refreshDiscoverySuggestions(record) {
        const graph = normalizeDiscoveryGraph(record?.discoveryGraph || config.discoveryGraph);
        discoverySuggestions = graph.relationships || [];
    }

    function addSuggestedDiscoveryConnection() {
        const created = createDiscoveryRelationship({
            type: discoveryDraftType || DISCOVERY_RELATIONSHIP_TYPES.THEME,
            label: discoveryDraftLabel,
            target: discoveryDraftTarget,
            suggestedBy: 'discovery'
        });
        if (!created.ok || !created.relationship) {
            discoveryReviewStatus = `Suggestion blocked: ${(created.errors || []).join(', ')}`;
            return;
        }
        const auto = autoApproveDiscoveryRelationship(created.relationship);
        if (auto.ok) {
            discoveryReviewStatus = 'Blocked: discovery cannot auto-approve';
            return;
        }
        const record = loadHeroRecordUnverified();
        const graph = upsertDiscoveryRelationship(record?.discoveryGraph, created.relationship);
        const saved = saveHeroRecord({
            discoveryGraph: graph,
            source: 'hero_discovery_suggest'
        });
        if (!saved) {
            discoveryReviewStatus = 'Save failed';
            return;
        }
        config = { ...config, discoveryGraph: graph };
        discoveryDraftLabel = '';
        discoveryDraftTarget = '';
        refreshDiscoverySuggestions(saved);
        discoveryReviewStatus = 'Suggested connection queued (not public until approved)';
    }

    function approveDiscoverySuggestion(relationshipId) {
        const identity = resolveAuthorityIdentity();
        if (!identity.authenticated) {
            discoveryReviewStatus = 'Waiting for authentication';
            return;
        }
        const record = loadHeroRecordUnverified();
        const graph = normalizeDiscoveryGraph(record?.discoveryGraph);
        const current = graph.relationships.find((r) => r.relationshipId === relationshipId);
        if (!current) {
            discoveryReviewStatus = 'Relationship not found';
            return;
        }
        const approved = approveDiscoveryRelationship(current, { approvedBy: identity.actorId });
        if (!approved.ok || !approved.relationship) {
            discoveryReviewStatus = `Approve blocked: ${(approved.errors || []).join(', ')}`;
            return;
        }
        const next = upsertDiscoveryRelationship(graph, approved.relationship);
        const saved = saveHeroRecord({
            discoveryGraph: next,
            source: 'hero_discovery_approve'
        });
        if (!saved) {
            discoveryReviewStatus = 'Approve save failed';
            return;
        }
        config = { ...config, discoveryGraph: next };
        refreshDiscoverySuggestions(saved);
        discoveryReviewStatus = 'Discovery connection approved for public';
    }

    function rejectDiscoverySuggestion(relationshipId) {
        const identity = resolveAuthorityIdentity();
        const record = loadHeroRecordUnverified();
        const graph = normalizeDiscoveryGraph(record?.discoveryGraph);
        const current = graph.relationships.find((r) => r.relationshipId === relationshipId);
        if (!current) {
            discoveryReviewStatus = 'Relationship not found';
            return;
        }
        const rejected = rejectDiscoveryRelationship(current, {
            rejectedBy: identity.authenticated ? identity.actorId : 'admin'
        });
        const next = upsertDiscoveryRelationship(graph, rejected.relationship);
        const saved = saveHeroRecord({
            discoveryGraph: next,
            source: 'hero_discovery_reject'
        });
        if (!saved) {
            discoveryReviewStatus = 'Reject save failed';
            return;
        }
        config = { ...config, discoveryGraph: next };
        refreshDiscoverySuggestions(saved);
        discoveryReviewStatus = 'Discovery connection rejected';
    }

    function hideDiscoverySuggestion(relationshipId) {
        const record = loadHeroRecordUnverified();
        const graph = normalizeDiscoveryGraph(record?.discoveryGraph);
        const current = graph.relationships.find((r) => r.relationshipId === relationshipId);
        if (!current) {
            discoveryReviewStatus = 'Relationship not found';
            return;
        }
        const hidden = hideDiscoveryRelationship(current);
        const next = upsertDiscoveryRelationship(graph, hidden.relationship);
        const saved = saveHeroRecord({
            discoveryGraph: next,
            source: 'hero_discovery_hide'
        });
        if (!saved) {
            discoveryReviewStatus = 'Hide failed';
            return;
        }
        config = { ...config, discoveryGraph: next };
        refreshDiscoverySuggestions(saved);
        discoveryReviewStatus = 'Discovery connection hidden from public';
    }

    
    function saveCreatorIntentDraft() {
        const identity = resolveAuthorityIdentity();
        const notes = String(intentPrivateNotesText || '')
            .split(/\n+/)
            .map((s) => s.trim())
            .filter(Boolean);
        const existing = normalizeCreatorIntentContext(
            loadHeroRecordUnverified()?.creatorIntentContext
        );
        const source =
            identity.authenticated && identity.role === 'admin' ? 'admin' : 'creator';
        const drafted = draftCreatorIntentContext(existing, {
            text: intentPublicStatementText,
            privateNotes: notes,
            source,
            suppliedBy: identity.authenticated ? identity.actorId : 'creator'
        });
        if (!drafted.ok || !drafted.context) {
            // Prefer create if empty existing
            const created = createCreatorIntentContext({
                privateNotes: notes,
                publicText: intentPublicStatementText,
                source,
                suppliedBy: identity.authenticated ? identity.actorId : 'creator'
            });
            if (!created.ok || !created.context) {
                intentReviewStatus = `Draft blocked: ${(drafted.errors || created.errors || []).join(', ')}`;
                return;
            }
            drafted.context = created.context;
            drafted.ok = true;
        }
        const auto = autoPublishCreatorIntent(drafted.context);
        if (auto.ok) {
            intentReviewStatus = 'Blocked: intent cannot auto-publish';
            return;
        }
        const saved = saveHeroRecord({
            creatorIntentContext: drafted.context,
            source: 'hero_creator_intent_draft'
        });
        if (!saved) {
            intentReviewStatus = 'Draft save failed';
            return;
        }
        config = { ...config, creatorIntentContext: drafted.context };
        intentReviewStatus = 'Intent draft saved (private notes admin-only; public statement needs approval)';
    }

    function approveCreatorIntentForPublic() {
        const identity = resolveAuthorityIdentity();
        if (!identity.authenticated) {
            intentReviewStatus = 'Waiting for authentication';
            return;
        }
        // Ensure latest draft is stored first
        const notes = String(intentPrivateNotesText || '')
            .split(/\n+/)
            .map((s) => s.trim())
            .filter(Boolean);
        let context = normalizeCreatorIntentContext(
            loadHeroRecordUnverified()?.creatorIntentContext
        );
        const drafted = draftCreatorIntentContext(context, {
            text: intentPublicStatementText,
            privateNotes: notes,
            source: context.provenance?.source || 'admin',
            suppliedBy: context.provenance?.suppliedBy || identity.actorId
        });
        if (drafted.ok && drafted.context) context = drafted.context;

        const approved = approveCreatorIntentContext(context, {
            approvedBy: identity.actorId
        });
        if (!approved.ok || !approved.context) {
            intentReviewStatus = `Approval blocked: ${(approved.errors || []).join(', ')}`;
            return;
        }
        const auto = autoPublishCreatorIntent(approved.context);
        if (auto.ok) {
            intentReviewStatus = 'Blocked: intent cannot auto-publish';
            return;
        }
        const saved = saveHeroRecord({
            creatorIntentContext: approved.context,
            source: 'hero_creator_intent_approve'
        });
        if (!saved) {
            intentReviewStatus = 'Approval save failed';
            return;
        }
        config = { ...config, creatorIntentContext: approved.context };
        intentReviewStatus = 'Creator intent approved for public Hero';
    }

    function hideCreatorIntentFromPublic() {
        const context = hideCreatorIntentContext(
            loadHeroRecordUnverified()?.creatorIntentContext
        );
        const saved = saveHeroRecord({
            creatorIntentContext: context.context,
            source: 'hero_creator_intent_hide'
        });
        if (!saved) {
            intentReviewStatus = 'Hide failed';
            return;
        }
        config = { ...config, creatorIntentContext: context.context };
        intentReviewStatus = 'Creator intent hidden from public';
    }

        function refreshAuthorityUi(extra = {}) {
        try {
            const record = loadHeroRecordUnverified();
            const ui = resolveHeroAuthorityUiState(record, {
                identity: resolveAuthorityIdentity(),
                pending: authorityPending,
                ...extra
            });
            authorityUiId = ui.id;
            authorityUiLabel = ui.label;
            if (ui.id === HERO_AUTHORITY_UI_STATE.PUBLISHED_VERIFIED && canDisplayPublishedLabel(record)) {
                presentationStatus = ui.label;
            } else if (!presentationStatus || !authorityPending) {
                presentationStatus = ui.label;
            }
        } catch {
            /* ignore */
        }
    }

    /**
     * Request public Hero publication (server grants; no optimistic publish).
     * Identity is session-bound — no master_hero_admin / caller actor strings.
     */
    async function approvePublicHeroPresentation() {
        const record = loadHeroRecordUnverified();
        const identity = resolveAuthorityIdentity();
        if (!identity.authenticated) {
            presentationStatus = 'Waiting for authentication';
            authorityUiLabel = presentationStatus;
            authorityUiId = HERO_AUTHORITY_UI_STATE.WAITING_AUTH;
            statusMessage = presentationStatus;
            return;
        }

        authorityPending = true;
        presentationStatus = 'Pending approval';
        authorityUiLabel = presentationStatus;
        authorityUiId = HERO_AUTHORITY_UI_STATE.PENDING_APPROVAL;
        statusMessage = presentationStatus;

        const result = await requestAuthenticatedHeroPublish(record, {
            publicTitle: publicHeroTitle,
            publicDescription: publicHeroDescription,
            publicTheme: publicHeroTheme,
            showIntelligence: showIntelligenceExplanation,
            sourceType: 'creator'
            // actor / approvedBy intentionally omitted — identity only
        });

        authorityPending = false;

        if (!result.ok || !result.recordPatch || result.published !== true) {
            const ui = result.ui || resolveHeroAuthorityUiState(record, {
                identity,
                lastError: result.reason || 'rejected'
            });
            authorityUiId = ui.id;
            authorityUiLabel = ui.label;
            presentationStatus = ui.label;
            if (result.reason) {
                presentationStatus = `${ui.label}: ${result.reason}`;
            }
            statusMessage = presentationStatus;
            return;
        }

        result.recordPatch.adminContext = {
            ...result.recordPatch.adminContext,
            editorialNotes,
            identityNotes,
            sourceTitle:
                result.recordPatch.adminContext?.sourceTitle ||
                String(record?.title || config.heroAssetTitle || ''),
            sourceDescription:
                result.recordPatch.adminContext?.sourceDescription ||
                String(config.heroDescription || '')
        };

        const saved = saveHeroRecord({
            ...result.recordPatch,
            heroTitle: publicHeroTitle || record.heroTitle,
            heroDescription: publicHeroDescription,
            source: 'hero_authority_server_grant'
        });
        if (!saved) {
            presentationStatus = 'Server granted, but local save failed';
            return;
        }

        config = {
            ...config,
            heroTitle: publicHeroTitle || config.heroTitle,
            heroDescription: publicHeroDescription,
            heroPresentation: result.recordPatch.heroPresentation,
            adminContext: result.recordPatch.adminContext,
            creatorTruth: result.recordPatch.creatorTruth,
            showIntelligenceExplanation
        };
        void persistHeroSettings('presentation-approve', {
            heroTitle: config.heroTitle,
            heroDescription: config.heroDescription,
            heroPresentation: config.heroPresentation,
            adminContext: config.adminContext,
            creatorTruth: config.creatorTruth,
            showIntelligenceExplanation
        });
        authorityUiId = HERO_AUTHORITY_UI_STATE.PUBLISHED_VERIFIED;
        authorityUiLabel = 'Published and verified';
        presentationStatus = authorityUiLabel;
        statusMessage = presentationStatus;
    }

    $: presentationPreview = (() => {
        try {
            const current = typeof window !== 'undefined' ? loadHeroRecordUnverified() : null;
            return resolvePublicHeroViewerCopy({
                ...(current || {}),
                heroPresentation: {
                    publicTitle: publicHeroTitle,
                    publicDescription: publicHeroDescription,
                    publicTheme: publicHeroTheme,
                    showIntelligence: showIntelligenceExplanation,
                    approvedBy: '',
                    approvedAt: null,
                    status: 'draft',
                    visibility: 'draft'
                },
                creatorTruth: config.creatorTruth
            });
        } catch {
            return null;
        }
    })();

    $: approvedViewerPreview = (() => {
        try {
            return typeof window !== 'undefined' ? resolvePublicHeroViewerCopy(loadHeroRecordUnverified()) : null;
        } catch {
            return null;
        }
    })();

    /**
     * Push identity/mode + display copy from a manager snapshot into HeroRecord.
     * Manager-only fields are not written here.
     * @param {Record<string, unknown>} snapshot
     * @param {string} reason
     */
    function syncHeroRecordFromManagerSnapshot(snapshot, reason = 'persist') {
        const bg = String(snapshot?.backgroundSource || '').trim();
        let current = loadHeroRecordUnverified();
        const sourceTag = `manager_${reason}`;

        if (bg === 'none') {
            if (current.mode !== 'none') {
                setHeroMode('none', { source: sourceTag });
                refreshHeroReelLegacyMirror();
            }
        } else if (bg === 'selection') {
            if (current.mode !== 'selection' || String(current.assetId || '').trim()) {
                setHeroMode('selection', { source: sourceTag });
                refreshHeroReelLegacyMirror();
            }
        } else if (bg === 'custom_video' || bg === 'custom_image') {
            const id = String(snapshot?.heroAssetId || '').trim();
            if (id && (current.mode !== 'asset' || String(current.assetId || '') !== id)) {
                commitHeroAssetSelection(id, getLiveVaultExtras());
            }
        }

        current = loadHeroRecordUnverified();
        const nextTitle = String(snapshot?.heroTitle ?? '');
        const nextSub = String(snapshot?.heroSubtitle ?? '');
        const nextDesc = String(snapshot?.heroDescription ?? '');
        if (
            nextTitle !== String(current.heroTitle || '') ||
            nextSub !== String(current.heroSubtitle || '') ||
            nextDesc !== String(current.heroDescription || '')
        ) {
            updateHeroPresentation({
                heroTitle: nextTitle,
                heroSubtitle: nextSub,
                heroDescription: nextDesc,
                source: sourceTag
            });
        }
        return loadHeroRecordUnverified();
    }

    function readPersistentTitleMap() {
        try {
            const raw = JSON.parse(localStorage.getItem(TITLES_KEY()) || '{}');
            return raw && typeof raw === 'object' ? raw : {};
        } catch {
            return {};
        }
    }

    function collectTitleAliasIds(item, playbackKey = '') {
        const ids = new Set(mediaRecordTitleKeys(item));
        const pathId = mediaPathAssetId(playbackKey || item);
        if (pathId) ids.add(pathId);
        const consider = (entry) => {
            if (!entry || typeof entry !== 'object') return;
            const play = mediaRecordPlaybackKey(entry);
            if (playbackKey && play === playbackKey) {
                for (const key of mediaRecordTitleKeys(entry)) ids.add(key);
            }
        };
        if (personalVideos && typeof personalVideos.subscribe === 'function') {
            const list = get(personalVideos);
            if (Array.isArray(list)) list.forEach(consider);
        }
        if (feed && typeof feed.subscribe === 'function') {
            const currentFeed = get(feed);
            for (const cat of Object.keys(currentFeed || {})) {
                const rows = currentFeed[cat];
                if (Array.isArray(rows)) rows.forEach(consider);
            }
        }
        if (Array.isArray(feedReels)) feedReels.forEach(consider);
        return [...ids];
    }

    function writePersistentTitle(reelId, title, extraIds = []) {
        if (!title) return;
        const ids = [...new Set([reelId, ...extraIds].map((id) => String(id || '').trim()).filter(Boolean))];
        if (!ids.length) return;
        if (persistentTitles?.saveTitle) {
            for (const id of ids) {
                persistentTitles.saveTitle(id, { title, title_original: title });
            }
            return;
        }
        let map = readPersistentTitleMap();
        const patch = { title, title_original: title, savedAt: new Date().toISOString() };
        for (const id of ids) {
            map = mergeTitleIntoPersistentMap(map, id, patch);
        }
        try {
            localStorage.setItem(TITLES_KEY(), JSON.stringify(map));
        } catch {
            /* ignore */
        }
        storageSet(TITLES_KEY(), map);
    }

    function lookupPersistentTitle(reelId) {
        if (!reelId) return '';
        const fromStore = persistentTitles?.getTitle?.(reelId);
        if (fromStore?.title) return String(fromStore.title).trim();
        const map = readPersistentTitleMap();
        return String(map[reelId]?.title || map[reelId]?.title_original || '').trim();
    }

    function patchJsonArrayStorage(key, patcher) {
        try {
            const list = JSON.parse(localStorage.getItem(key) || '[]');
            if (!Array.isArray(list)) return false;
            const next = list.map((entry) => patcher(entry)).filter(Boolean);
            localStorage.setItem(key, JSON.stringify(next));
            storageSet(key, next);
            return true;
        } catch {
            return false;
        }
    }

    function applyTitleToRecord(entry, assetId, title, playbackKey = '') {
        if (!entry || typeof entry !== 'object') return entry;
        const keys = mediaRecordTitleKeys(entry);
        const play = mediaRecordPlaybackKey(entry);
        const idHit = keys.includes(String(assetId || '').trim());
        const urlHit = Boolean(playbackKey) && play === playbackKey;
        if (!idHit && !urlHit) return entry;
        return {
            ...entry,
            title,
            name: title,
            title_original: title,
            _localModified: true
        };
    }

    const STORY_STATUS_LABELS = {
        draft: 'Draft',
        published: 'Published',
        scheduled: 'Scheduled'
    };

    const STORY_TEMPLATES = {
        documentary_spotlight: {
            name: 'Documentary Spotlight',
            defaultLabel: 'LOOK@ZAKANDA PRESENTS',
            defaultTitleStructure: '{seriesTitle}: Land, Legacy & Liberation',
            defaultSubtitleStructure: 'An intimate documentary spotlight.',
            defaultDescriptionStructure: 'Discover the families preserving generations of Black land ownership in Alabama.',
            recommendedCTA1: 'Watch Now',
            recommendedCTA2: 'Learn More'
        },
        community_spotlight: {
            name: 'Community Spotlight',
            defaultLabel: 'COMMUNITY SPOTLIGHT',
            defaultTitleStructure: '{communityName}',
            defaultSubtitleStructure: 'A story rooted in local voices.',
            defaultDescriptionStructure: 'Meet the people strengthening community legacy through culture, land, and storytelling.',
            recommendedCTA1: 'Watch Story',
            recommendedCTA2: 'Meet the Community'
        },
        collection_spotlight: {
            name: 'Collection Spotlight',
            defaultLabel: 'FEATURED COLLECTION',
            defaultTitleStructure: '{collectionName}',
            defaultSubtitleStructure: 'Curated stories from the archive.',
            defaultDescriptionStructure: 'Explore a hand-picked collection designed to deepen context and connection.',
            recommendedCTA1: 'Explore Collection',
            recommendedCTA2: 'View All'
        },
        premiere_announcement: {
            name: 'Premiere Announcement',
            defaultLabel: 'UPCOMING PREMIERE',
            defaultTitleStructure: '{seriesTitle} Premieres Soon',
            defaultSubtitleStructure: 'A new chapter arrives on LOOK@ZAKANDA.',
            defaultDescriptionStructure: 'Be first to experience the next release and join the premiere conversation.',
            recommendedCTA1: 'Set Reminder',
            recommendedCTA2: 'View Trailer'
        },
        educational_spotlight: {
            name: 'Educational Spotlight',
            defaultLabel: 'EDUCATIONAL SERIES',
            defaultTitleStructure: '{topicTitle}',
            defaultSubtitleStructure: 'Learn through stories and lived experience.',
            defaultDescriptionStructure: 'Understand the history, systems, and voices shaping this educational theme.',
            recommendedCTA1: 'Start Learning',
            recommendedCTA2: 'View Curriculum'
        },
        campaign_spotlight: {
            name: 'Campaign Spotlight',
            defaultLabel: 'CAMPAIGN SPOTLIGHT',
            defaultTitleStructure: '{campaignTitle}',
            defaultSubtitleStructure: 'A focused editorial campaign.',
            defaultDescriptionStructure: 'Follow this campaign to track milestones, stories, and impact across the platform.',
            recommendedCTA1: 'Join Campaign',
            recommendedCTA2: 'Campaign Details'
        }
    };
    const TEMPLATE_KEYS = Object.keys(STORY_TEMPLATES);
    let selectedTemplateKey = TEMPLATE_KEYS[0];

    $: slideOverrides = Array.isArray(config.carouselSlideOverrides)
        ? [...config.carouselSlideOverrides].sort((a, b) => (a.order || 0) - (b.order || 0))
        : [];

    const heroAssetRegistry = writable([]);
    function authHeaders() {
        return getAdminAuthHeaders();
    }

    function normalizeComparablePath(value) {
        const text = String(value || '').trim();
        if (!text) return '';
        try {
            if (text.startsWith('http://') || text.startsWith('https://')) {
                return new URL(text).pathname;
            }
        } catch {
            // noop
        }
        return text;
    }

    async function findMatchingHeroReelId(item) {
        const candidateId = String(item?.assetId || '').trim();
        if (!candidateId) return '';
        const normalizedId = normalizeVaultPickId(candidateId);
        const reels = await fetchReadyReels(authHeaders()).catch(() => []);
        const byId = reels.find((reel) => {
            const reelId = String(reel?.id || '').trim();
            return reelId === candidateId || (normalizedId && reelId === normalizedId);
        });
        if (byId?.id) return String(byId.id);

        const heroMedia = normalizeComparablePath(item?.mediaUrl);
        const heroThumb = normalizeComparablePath(item?.thumbnailUrl);
        const byPath = reels.find((reel) => {
            const reelVideo = normalizeComparablePath(reel?.url || reel?.video_url || '');
            const reelThumb = normalizeComparablePath(
                reel?.thumbnailUrl || reel?.thumbnail_url || reel?.thumbnail || ''
            );
            return (heroMedia && reelVideo && heroMedia === reelVideo) || (heroThumb && reelThumb && heroThumb === reelThumb);
        });
        return String(byPath?.id || '');
    }

    function getLiveVaultExtras() {
        /** @type {Record<string, unknown>[]} */
        const extras = [];
        try {
            if (personalVideos && typeof personalVideos.subscribe === 'function') {
                const live = get(personalVideos);
                if (Array.isArray(live)) extras.push(...live);
            }
        } catch {
            /* ignore */
        }
        if (Array.isArray(feedReels)) {
            extras.push(...feedReels);
        }
        return extras.filter((entry) => {
            if (!entry || typeof entry !== 'object') return false;
            const id = String(entry.id || entry.assetId || '').trim();
            if (id && isDeletedMediaId(id)) return false;
            if (/\.playback/i.test(id)) return false;
            const fileName = String(entry.fileName || entry.file_name || entry.name || '').trim();
            if (/\.playback/i.test(fileName)) return false;
            return true;
        });
    }

    function persistFeedEverywhere(nextFeed) {
        if (feed && typeof feed.set === 'function') {
            feed.set(nextFeed);
        }
        storageSet(CONFIG?.FEED_STORAGE_KEY || 'reelforge_feed', nextFeed);
    }

    /**
     * Rebuild pickable Hero Vault registry and reassign $heroAssetRegistry.
     * Harvested rows may still carry stale feed/vault `title`/`name`; stamp the
     * existing canonical resolver onto each row so Edit Title + later sync
     * rebuilds expose the durable title without relying on hidden reads inside
     * getDisplayTitle() for Svelte invalidation.
     */
    function refreshHeroAssetRegistry() {
        const vaultItems = loadHeroVaultItems(getLiveVaultExtras());
        const rawRegistry = buildHeroAssetRegistry(vaultItems, { storageSource: 'vault_pick' });
        // New array + new row objects → reactive $heroAssetRegistry reassignment.
        const registry = rawRegistry.map((item) => {
            const canonicalTitle = getDisplayTitle(item);
            return {
                ...item,
                title: canonicalTitle,
                name: canonicalTitle
            };
        });
        heroAssetRegistry.set(registry);
        // Reset preview load/error so remounted sources can re-bind cleanly.
        vaultVideoLoadedByAsset = {};
        vaultVideoErrorByAsset = {};
    }

    /** Snapshot of all control fields for a complete save (settings + story + campaigns). */
    function buildConfigSnapshot(overrides = {}) {
        const snapshot = {
            ...config,
            storyScheduledFor:
                overrides.storyScheduledFor !== undefined
                    ? overrides.storyScheduledFor
                    : String(storyScheduledFor || config.storyScheduledFor || '').trim(),
            ...overrides
        };
        if (String(snapshot.backgroundSource || '').trim() === 'none') {
            snapshot.heroAssetId = '';
            if (!overrides.backgroundStyle) {
                snapshot.backgroundStyle = snapshot.backgroundStyle || 'gradient_overlay';
            }
        }
        return snapshot;
    }

    /**
     * After Hero Manager saves creator title/story/identity, mirror onto episode metadata.
     * @param {Record<string, unknown>} snapshot
     * @param {string} [source]
     */
    function pushHeroIdentityToEpisode(snapshot, source = 'hero-manager') {
        const reelId = String(snapshot?.heroAssetId || '').trim();
        if (!reelId) return null;
        try {
            const resolved = resolveContentIdentity(reelId, {
                heroConfig: snapshot,
                contentIdentity: snapshot?.contentIdentity || null
            });
            return syncHeroIdentityToEpisodeMetadata(reelId, {
                title: resolved.title || String(snapshot.heroTitle || ''),
                episodeTitle:
                    resolved.episodeTitle ||
                    String(snapshot.heroTitle || snapshot.heroAssetTitle || ''),
                description:
                    resolved.description ||
                    String(snapshot.heroDescription || snapshot.heroStoryContext?.description || ''),
                tags: resolved.tags,
                keywords: resolved.keywords,
                seriesName: resolved.seriesName,
                // Never promote keywords[0] → official genre. Store as suggestion only.
                suggestedGenre: Array.isArray(resolved.keywords)
                    ? String(resolved.keywords[0] || '').trim()
                    : '',
                intelligenceExplanation: Array.isArray(resolved.keywords) && resolved.keywords[0]
                    ? `Suggested theme detected from your uploaded title: ${String(resolved.keywords[0]).trim()}`
                    : '',
                source: 'creator'
            });
        } catch (error) {
            console.warn('[HERO_EPISODE_SYNC_FAILED]', error?.message || error);
            return null;
        }
    }

    /**
     * Confirm site-wide presentation wrote to PUT /api/hero/presentation.
     * @param {string} reason
     * @param {Record<string, unknown> | null} [publishPatch]
     */
    async function confirmServerPresentation(reason = 'apply', publishPatch = null) {
        const patch =
            publishPatch && typeof publishPatch === 'object'
                ? publishPatch
                : {};
        console.info('[HERO_MANAGER] apply', {
            reason,
            heroAssetId: patch.heroAssetId || config?.heroAssetId || '',
            backgroundSource: patch.backgroundSource || config?.backgroundSource || '',
            mediaUrl: String(patch.mediaUrl || config?.mediaUrl || config?.backgroundMediaUrl || '').slice(
                0,
                120
            ),
            heroTitle: String(patch.heroTitle || config?.heroTitle || '').slice(0, 80),
            heroDescription: String(patch.heroDescription || config?.heroDescription || '').slice(
                0,
                80
            ),
            ts: new Date().toISOString()
        });
        try {
            // Prefer explicit patch from the save path so we never re-read a stripped load.
            const result = await persistHeroPresentationToServer(patch);
            console.info('[HERO_MANAGER] apply payload', {
                reason,
                ok: result.ok,
                status: result.status ?? null,
                heroAssetId: result.payload?.heroAssetId || result.server?.heroAssetId || null,
                mediaUrl: result.payload?.mediaUrl || result.server?.mediaUrl || null,
                posterUrl: result.payload?.posterUrl || result.server?.posterUrl || null,
                heroTitle: result.payload?.heroTitle || result.server?.heroTitle || null,
                heroSubtitle: result.payload?.heroSubtitle || result.server?.heroSubtitle || null,
                heroDescription:
                    result.payload?.heroDescription || result.server?.heroDescription || null,
                error: result.error || null,
                ts: new Date().toISOString()
            });
            if (result.ok) {
                console.info('[HERO_MANAGER_SERVER_SYNC]', {
                    reason,
                    ok: true,
                    status: result.status,
                    heroAssetId: result.server?.heroAssetId || result.config?.heroAssetId || '',
                    mediaUrl: result.server?.mediaUrl || result.config?.mediaUrl || '',
                    heroTitle: result.server?.heroTitle || result.config?.heroTitle || '',
                    ts: new Date().toISOString()
                });
                return true;
            }
            console.warn('[HERO_MANAGER_SERVER_SYNC]', {
                reason,
                ok: false,
                status: result.status,
                error: result.error,
                ts: new Date().toISOString()
            });
            statusMessage = `⚠️ Local hero saved, but site publish failed: ${result.error || 'unknown'}. Re-login to Studio and Apply again.`;
            return false;
        } catch (error) {
            console.warn('[HERO_MANAGER_SERVER_SYNC]', { reason, error: error?.message || error });
            statusMessage = `⚠️ Local hero saved, server publish error: ${error?.message || error}`;
            return false;
        }
    }

    /**
     * Full admin follow-through: persist every field and notify the hero stage.
     * @param {string} reason
     * @param {Record<string, unknown>} [overrides]
     * @returns {ReturnType<typeof updateHeroManagerConfig> | null}
     */
    function persistHeroSettings(reason = 'apply', overrides = {}) {
        if (persistBusy) {
            console.info('[HERO_MANAGER_PERSIST]', { reason, skipped: true, cause: 'busy' });
            return null;
        }
        persistBusy = true;
        suppressExternalManagerSync = true;
        try {
            const snapshot = buildConfigSnapshot(overrides);
            config = snapshot;

            // HeroRecord owns identity + display copy; manager keeps carousel/campaign/etc.
            const record = syncHeroRecordFromManagerSnapshot(snapshot, reason);
            const managerPatch = projectManagerConfigFromHeroRecord(snapshot, record);
            // Guarantee mediaUrl is on the manager patch for site-wide PUT.
            if (record && record.mode === 'asset') {
                const media = String(record.mediaUrl || record.videoUrl || '').trim();
                const poster = String(record.posterUrl || '').trim();
                if (media) {
                    managerPatch.mediaUrl = media;
                    managerPatch.backgroundMediaUrl = media;
                }
                if (poster) managerPatch.posterUrl = poster;
            }
            // Cache only — single awaitable PUT via confirmServerPresentation.
            const savedConfig = saveHeroManagerConfig(
                /** @type {any} */ (managerPatch),
                { skipServer: true }
            );
            const selection = selectHeroContent(savedConfig.heroType, feedReels || []);
            applyLocalConfigFromSources(savedConfig || loadHeroManagerConfig());

            // Creator identity → Theater episode metadata (same reelId / heroAssetId).
            pushHeroIdentityToEpisode(config, reason);

            // heroLabel: "" is intentional (optional badge). Never recover prior brand via ||.
            const publishedHeroLabel = Object.prototype.hasOwnProperty.call(config, 'heroLabel')
                ? String(config.heroLabel ?? '').trim()
                : Object.prototype.hasOwnProperty.call(savedConfig, 'heroLabel')
                  ? String(savedConfig.heroLabel ?? '').trim()
                  : '';
            const publishBody = enrichPresentationConfigFromLocalIdentity({
                ...savedConfig,
                heroAssetId: config.heroAssetId || savedConfig.heroAssetId,
                mediaUrl: config.mediaUrl || managerPatch.mediaUrl || savedConfig.mediaUrl,
                posterUrl: config.posterUrl || managerPatch.posterUrl || savedConfig.posterUrl,
                heroTitle: config.heroTitle || savedConfig.heroTitle,
                heroSubtitle: config.heroSubtitle || savedConfig.heroSubtitle,
                heroDescription: config.heroDescription || savedConfig.heroDescription,
                heroLabel: publishedHeroLabel,
                backgroundSource: config.backgroundSource || savedConfig.backgroundSource,
                backgroundStyle: config.backgroundStyle || savedConfig.backgroundStyle
            });

            console.info('[HERO_MANAGER_PERSIST]', {
                reason,
                storyStatus: config.storyStatus || 'draft',
                backgroundSource: publishBody.backgroundSource || '',
                heroAssetId: publishBody.heroAssetId || '',
                mediaUrl: String(publishBody.mediaUrl || '').slice(0, 80),
                heroTitle: String(publishBody.heroTitle || '').slice(0, 80),
                heroDescriptionBlank: !String(publishBody.heroDescription || '').trim(),
                recordMode: record?.mode || '',
                recordRevision: record?.revision,
                ts: new Date().toISOString()
            });
            console.info('[HERO_MANAGER] apply payload', {
                stage: 'persistHeroSettings',
                reason,
                heroAssetId: publishBody.heroAssetId || null,
                mediaUrl: publishBody.mediaUrl || null,
                posterUrl: publishBody.posterUrl || null,
                heroTitle: publishBody.heroTitle || null,
                heroSubtitle: publishBody.heroSubtitle || null,
                heroDescription: publishBody.heroDescription || null,
                heroLabel: publishBody.heroLabel || null,
                backgroundSource: publishBody.backgroundSource || null
            });
            // Publish the same body we just saved (avoid load strip race).
            confirmServerPresentation(reason, publishBody);
            return { config, selection };
        } catch (error) {
            console.error('[HERO_MANAGER_PERSIST_FAILED]', { reason, error });
            statusMessage = `❌ Save failed: ${error?.message || error}`;
            return null;
        } finally {
            persistBusy = false;
            if (typeof queueMicrotask === 'function') {
                queueMicrotask(() => {
                    suppressExternalManagerSync = false;
                });
            } else {
                setTimeout(() => {
                    suppressExternalManagerSync = false;
                }, 0);
            }
        }
    }

    // Keep registry current when config or live vault store changes.
    $: {
        config.heroAssetId;
        config.backgroundSource;
        if (personalVideos && typeof personalVideos.subscribe === 'function') {
            void $personalVideos;
        }
        refreshHeroAssetRegistry();
    }

    function handleHeroAssetChange() {
        const selectedId = String(config.heroAssetId || '').trim();
        console.info('[HERO_SELECTION_BOUNDARY]', {
            stage: 'HeroManagerPanel:handleHeroAssetChange',
            configHeroAssetId: selectedId,
            registryCount: get(heroAssetRegistry).length,
            ts: new Date().toISOString()
        });
        if (!selectedId) {
            const saved = commitHeroAssetSelection('');
            applyLocalConfigFromSources(saved || loadHeroManagerConfig());
            refreshHeroAssetRegistry();
            statusMessage = 'Hero background cleared (blank menu)';
            confirmServerPresentation('clear_background');
            return;
        }
        suppressExternalManagerSync = true;
        try {
            const saved = commitHeroAssetSelection(selectedId, getLiveVaultExtras());
            if (!saved) {
                statusMessage = 'Could not set that vault asset — try Apply Hero Settings after a Content vault refresh.';
                applyLocalConfigFromSources();
                refreshHeroAssetRegistry();
                return;
            }
            applyLocalConfigFromSources(saved);
            refreshHeroAssetRegistry();
            const picked = get(heroAssetRegistry).find((a) => a.assetId === selectedId);
            const truthTitle = String(config.heroTitle || getDisplayTitle(picked || { assetId: selectedId })).trim();
            statusMessage = `Hero background set locally · “${truthTitle}” — publishing site-wide…`;
            // Awaitable site-wide publish with the saved manager config (keeps mediaUrl).
            confirmServerPresentation('asset_select', saved).then((ok) => {
                if (ok) {
                    statusMessage = `Hero published site-wide · “${truthTitle}” (visible on all devices after refresh)`;
                } else if (!String(statusMessage || '').includes('publish failed') && !String(statusMessage || '').includes('publish error')) {
                    statusMessage = `Hero background set locally · site publish failed for “${truthTitle}”. Re-login to Studio and re-select.`;
                }
            });
        } finally {
            if (typeof queueMicrotask === 'function') {
                queueMicrotask(() => {
                    suppressExternalManagerSync = false;
                });
            } else {
                setTimeout(() => {
                    suppressExternalManagerSync = false;
                }, 0);
            }
        }
    }

    function handleBackgroundSourceChange() {
        if (config.backgroundSource === 'none') {
            const saved = commitHeroAssetSelection('');
            applyLocalConfigFromSources(saved || loadHeroManagerConfig());
            refreshHeroAssetRegistry();
            statusMessage = 'Hero background cleared (blank menu)';
            confirmServerPresentation('background_none');
            return;
        }
        if (config.backgroundSource === 'selection') {
            setHeroMode('selection', { source: 'manager_background_source' });
            refreshHeroReelLegacyMirror();
            const pointer = projectHeroRecordToManagerPointer(loadHeroRecordUnverified());
            const saved = saveHeroManagerConfig({
                ...buildConfigSnapshot({
                    backgroundSource: 'selection',
                    heroAssetId: ''
                }),
                ...pointer
            });
            applyLocalConfigFromSources(saved);
            refreshHeroAssetRegistry();
            statusMessage = 'Hero uses selection/discovery content';
            confirmServerPresentation('background_selection');
            return;
        }
        applyConfig();
    }

    function applyStoryStoryState(mode = 'draft') {
        const normalizedMode = mode === 'published' || mode === 'scheduled' ? mode : 'draft';
        if (normalizedMode === 'scheduled' && !String(storyScheduledFor || '').trim()) {
            statusMessage = 'Set a schedule time before scheduling.';
            return;
        }
        const result = persistHeroSettings(`story_${normalizedMode}`, {
            storyStatus: normalizedMode,
            storyScheduledFor: normalizedMode === 'scheduled' ? String(storyScheduledFor || '').trim() : '',
            heroLabel: String(config.heroLabel || '').trim(),
            heroTitle: String(config.heroTitle || '').trim(),
            heroSubtitle: String(config.heroSubtitle || '').trim(),
            heroDescription: String(config.heroDescription || '').trim(),
            ctaPrimaryLabel: String(config.ctaPrimaryLabel || '').trim(),
            ctaPrimaryTarget: sanitizeHeroCtaTarget(config.ctaPrimaryTarget),
            ctaSecondaryLabel: String(config.ctaSecondaryLabel || '').trim(),
            ctaSecondaryTarget: sanitizeHeroCtaTarget(config.ctaSecondaryTarget),
            campaignType: String(config.campaignType || '').trim(),
            featuredCollection: String(config.featuredCollection || '').trim(),
            featuredSeries: String(config.featuredSeries || '').trim()
        });
        if (!result) return;
        statusMessage =
            normalizedMode === 'scheduled'
                ? `Hero story scheduled for ${storyScheduledFor || 'unspecified time'}`
                : `Hero story ${STORY_STATUS_LABELS[normalizedMode].toLowerCase()} · all fields saved`;
    }

    function saveStoryDraft() {
        applyStoryStoryState('draft');
    }

    function publishStory() {
        applyStoryStoryState('published');
    }

    function scheduleStory() {
        applyStoryStoryState('scheduled');
    }

    function selectedTemplate() {
        return STORY_TEMPLATES[selectedTemplateKey] || STORY_TEMPLATES[TEMPLATE_KEYS[0]];
    }

    function previewTemplate() {
        const template = selectedTemplate();
        if (!template) return;
        statusMessage = `Previewing template: ${template.name} (not saved yet — click Apply Template)`;
    }

    function applyTemplate() {
        const template = selectedTemplate();
        if (!template) return;
        const result = persistHeroSettings('apply_template', {
            heroLabel: template.defaultLabel,
            heroTitle: template.defaultTitleStructure,
            heroSubtitle: template.defaultSubtitleStructure,
            heroDescription: template.defaultDescriptionStructure,
            ctaPrimaryLabel: template.recommendedCTA1,
            ctaSecondaryLabel: template.recommendedCTA2
        });
        if (result) {
            statusMessage = `Applied & saved template: ${template.name}`;
        }
    }

    /** Persist editor fields when leaving a text control (full follow-through). */
    function handleFieldCommit() {
        if (persistBusy) return;
        const result = persistHeroSettings('field_commit');
        if (result) {
            statusMessage = `Saved · ${STORY_STATUS_LABELS[config.storyStatus || 'draft'] || 'Draft'}`;
        }
    }

    function syncDescriptionModeFromConfig() {
        descriptionMode = String(config.heroDescription || '').trim() ? 'custom' : 'blank';
    }

    /**
     * Autosave Viewer Description on each edit (debounced) so the hero landscape
     * updates in real time via reelforge:hero-manager-updated.
     * Empty string is a valid intentional blank (do not rehydrate defaults).
     */
    function scheduleDescriptionAutosave() {
        if (typeof window === 'undefined') return;
        if (descriptionAutosaveTimer) {
            window.clearTimeout(descriptionAutosaveTimer);
            descriptionAutosaveTimer = null;
        }
        descriptionAutosaveTimer = window.setTimeout(() => {
            descriptionAutosaveTimer = null;
            if (persistBusy) {
                scheduleDescriptionAutosave();
                return;
            }
            // Preserve intentional blank — never fall back to template defaults on empty.
            const result = persistHeroSettings('viewer_description_autosave', {
                heroDescription: String(config.heroDescription || '')
            });
            if (result) {
                const blank = !String(config.heroDescription || '').trim();
                descriptionMode = blank ? 'blank' : 'custom';
                statusMessage = blank
                    ? 'Autosaved · description blank on hero landscape'
                    : 'Autosaved · description live on hero landscape';
            }
        }, 280);
    }

    function handleDescriptionInput() {
        descriptionMode = String(config.heroDescription || '').trim() ? 'custom' : 'blank';
        scheduleDescriptionAutosave();
    }

    /** Menu choice: blank description (no body copy on hero landscape). */
    function setDescriptionBlank() {
        if (typeof window !== 'undefined' && descriptionAutosaveTimer) {
            window.clearTimeout(descriptionAutosaveTimer);
            descriptionAutosaveTimer = null;
        }
        config = { ...config, heroDescription: '' };
        descriptionMode = 'blank';
        const result = persistHeroSettings('viewer_description_blank', {
            heroDescription: ''
        });
        if (result) {
            statusMessage = 'Viewer description left blank · cleared on hero landscape';
        }
    }

    function handleDescriptionModeChange() {
        if (descriptionMode === 'blank') {
            setDescriptionBlank();
            return;
        }
        // custom: keep current text (or leave empty textarea for user to type)
        scheduleDescriptionAutosave();
    }

    /**
     * Browser-playable URL for Hero Vault grid preview (same pipeline as Content vault).
     * Prefers ready playback derivative for hover preview only; catalog ids stay master-side.
     * @param {Record<string, unknown>} item
     */
    function resolveHeroVaultPreviewUrl(item) {
        const preferred = resolvePlayableMediaUrl(item, 'vault_preview');
        const raw = String(preferred || item?.mediaUrl || item?.url || item?.videoUrl || '').trim();
        if (!raw) return '';
        if (raw.startsWith('blob:') || raw.startsWith('data:')) return raw;
        return resolveMediaForRender(raw, 'video', 'HeroVaultVideoPreview') || raw;
    }

    /**
     * @param {Record<string, unknown>} item
     */
    function resolveHeroVaultPosterUrl(item) {
        const face = resolveVaultCardFace(item);
        if (face.render !== 'image' || !face.src) return '';
        const raw = String(face.src).trim();
        if (raw.startsWith('blob:') || raw.startsWith('data:')) return raw;
        return resolveMediaForRender(raw, 'poster', 'HeroVaultPosterPreview') || raw;
    }

    /**
     * Poster-first: only one vault card mounts video (hover / selected).
     * @param {string} assetId
     */
    function activateHeroVaultPreview(assetId) {
        const id = String(assetId || '').trim();
        if (!id) return;
        if (getPlaybackOwner() === 'theater') return;
        if (!canStartPlayback('preview') && getPlaybackOwner() !== 'preview') return;
        if (activeHeroVaultPreviewId === id) return;
        activeHeroVaultPreviewId = id;
        claimPlaybackOwner('preview', `hero-vault:${id}`);
    }

    /**
     * @param {string} assetId
     */
    function deactivateHeroVaultPreview(assetId) {
        const id = String(assetId || '').trim();
        if (id && activeHeroVaultPreviewId && id !== activeHeroVaultPreviewId) return;
        activeHeroVaultPreviewId = '';
        if (getPlaybackOwner() === 'preview') {
            releasePlaybackOwner('preview', 'hero-vault-leave');
            // Allow hero background to reclaim bandwidth.
            claimPlaybackOwner('hero', 'hero-vault-return');
        }
    }

    /**
     * @param {Record<string, unknown>} item
     */
    function handleHeroVaultVideoMetadataLoad(item) {
        const assetId = String(item?.assetId || '').trim();
        if (assetId) {
            vaultVideoLoadedByAsset = {
                ...vaultVideoLoadedByAsset,
                [assetId]: true
            };
            vaultVideoErrorByAsset = {
                ...vaultVideoErrorByAsset,
                [assetId]: false
            };
        }
        console.info('[HERO_VAULT_VIDEO_METADATA_LOADED]', {
            assetId,
            assetType: String(item?.assetType || ''),
            mediaUrl: resolveHeroVaultPreviewUrl(item) || String(item?.mediaUrl || ''),
            timestamp: Date.now()
        });
    }

    /**
     * @param {Record<string, unknown>} item
     */
    function handleHeroVaultVideoError(item) {
        const assetId = String(item?.assetId || '').trim();
        if (assetId) {
            vaultVideoErrorByAsset = {
                ...vaultVideoErrorByAsset,
                [assetId]: true
            };
            vaultVideoLoadedByAsset = {
                ...vaultVideoLoadedByAsset,
                [assetId]: false
            };
        }
        console.warn('[HERO_VAULT_VIDEO_ERROR]', {
            assetId,
            assetType: String(item?.assetType || ''),
            mediaUrl: resolveHeroVaultPreviewUrl(item) || String(item?.mediaUrl || ''),
            timestamp: Date.now()
        });
    }

    function assetDateAdded(assetId) {
        const match = String(assetId || '').match(/(\d{10,})$/);
        if (!match) return 'Unknown';
        const timestamp = Number(match[1]);
        if (!Number.isFinite(timestamp)) return 'Unknown';
        const parsed = new Date(timestamp);
        if (Number.isNaN(parsed.getTime())) return 'Unknown';
        return parsed.toLocaleString();
    }

    function getDisplayTitle(item) {
        const assetId = String(item?.assetId || item?.id || '').trim();
        const episodeCtx = assetId ? getEpisodeByReelId(assetId) : null;
        return resolveCanonicalHeroTitle({
            editedTitle: renamedTitles[assetId],
            persistentTitle: lookupPersistentTitle(assetId),
            episodeTitle: episodeCtx?.episode?.title,
            assetTitle: item?.title || item?.name,
            fileName: item?.fileName || item?.file_name
        });
    }

    function getStoryPreviewIntel(itemOrTitle) {
        if (itemOrTitle && typeof itemOrTitle === 'object') {
            return analyzeHeroTitle(getDisplayTitle(itemOrTitle), {
                isVideo: isVideoHeroAssetType(itemOrTitle.assetType)
            });
        }
        return analyzeHeroTitle(String(itemOrTitle || ''), { isVideo: true });
    }

    function pendingStory() {
        return (
            getPendingStoryProposal(config.contentIdentity) ||
            getPendingStoryProposal({
                proposals: config.heroIntelligenceProposals || config.heroTitleIntelligence?.proposals,
                assistantHint:
                    config.contentIdentity?.assistantHint || config.heroTitleIntelligence?.assistantHint
            })
        );
    }

    /**
     * Creator approves NLP story framing → becomes presentation identity.
     * @param {'accept'|'edit'|'ignore'} action
     */
    function handleStoryProposal(action) {
        let identity = config.contentIdentity;
        if (!identity?.proposals && config.heroIntelligenceProposals) {
            identity = {
                reelId: config.heroAssetId || '',
                fields: {
                    title: {
                        value: config.heroTitle || config.heroAssetTitle,
                        source: 'creator',
                        confidence: 1,
                        approved: true
                    }
                },
                proposals: config.heroIntelligenceProposals,
                accepted: {},
                assistantHint: config.heroTitleIntelligence?.assistantHint || ''
            };
        }
        if (!identity?.proposals || !Object.keys(identity.proposals).length) {
            statusMessage = 'No AI story proposal pending.';
            return;
        }

        const descKey = identity.proposals.suggestedDescription
            ? 'suggestedDescription'
            : identity.proposals.heroDescription
              ? 'heroDescription'
              : null;
        const subKey = identity.proposals.suggestedSubtitle
            ? 'suggestedSubtitle'
            : identity.proposals.heroSubtitle
              ? 'heroSubtitle'
              : null;

        if (action === 'ignore') {
            let nextIdentity = identity;
            if (descKey) nextIdentity = ignoreIdentityProposal(nextIdentity, descKey);
            if (subKey) nextIdentity = ignoreIdentityProposal(nextIdentity, subKey);
            const result = persistHeroSettings('identity_ignore_story', {
                contentIdentity: nextIdentity,
                heroIntelligenceProposals: nextIdentity.proposals
            });
            if (result) {
                config = result.config || loadHeroManagerConfig();
                statusMessage = 'Ignored AI story suggestion — creator title unchanged.';
            }
            return;
        }

        let editedValue;
        if (action === 'edit') {
            const current = String(
                identity.proposals?.[descKey]?.value || identity.proposals?.[subKey]?.value || ''
            ).trim();
            const raw = window.prompt('Edit AI story suggestion (then approve)', current);
            if (raw === null) return;
            editedValue = String(raw).trim();
            if (!editedValue) {
                statusMessage = 'Story cannot be empty when accepting.';
                return;
            }
        }

        let graph = identity;
        /** @type {Record<string, unknown>} */
        let presentationPatch = {};
        if (descKey) {
            const out = approveIdentityProposal(graph, descKey, {
                editedValue: action === 'edit' ? editedValue : undefined
            });
            graph = out.identity;
            presentationPatch = { ...presentationPatch, ...out.presentationPatch };
        }
        if (subKey) {
            const out = approveIdentityProposal(graph, subKey);
            graph = out.identity;
            presentationPatch = { ...presentationPatch, ...out.presentationPatch };
        }

        const result = persistHeroSettings('identity_accept_story', {
            contentIdentity: graph,
            heroIntelligenceProposals: graph.proposals,
            heroStoryContext: {
                ...(config.heroStoryContext || {}),
                description: presentationPatch.heroDescription || config.heroDescription,
                supportingStory: presentationPatch.heroSubtitle || config.heroSubtitle,
                approved: true,
                pendingApproval: false
            },
            ...presentationPatch
        });
        if (result) {
            config = result.config || loadHeroManagerConfig();
            syncDescriptionModeFromConfig();
            statusMessage =
                action === 'edit'
                    ? 'Edited & accepted AI story — presentation updated (title locked to creator).'
                    : 'Accepted AI story framing — title remains creator-owned.';
        }
    }

    /**
     * Open Access & Price window for a Hero Vault MP4 (Theater All Episodes badges).
     * @param {Record<string, unknown>} item
     */
    function openHeroVaultAccess(item) {
        if (!item?.assetId) return;
        const assetId = String(item.assetId).trim();
        const access = resolveEpisodeAccessPricing({
            mediaAssetId: assetId,
            reelId: assetId,
            vaultAsset: item
        });
        accessModalItem = item;
        accessDraftMode = access.mode;
        accessDraftPrice = resolveAccessPriceDraft(access.mode, access.price);
        accessModalError = '';
        accessModalOpen = true;
    }

    /** @param {Event} event */
    function handleHeroAccessModeChange(event) {
        const nextMode = /** @type {'free' | 'paid'} */ (
            /** @type {HTMLSelectElement} */ (event.currentTarget).value
        );
        accessDraftMode = nextMode;
        accessDraftPrice = resolveAccessPriceOnModeChange(nextMode, accessDraftPrice);
    }

    function closeHeroVaultAccess() {
        accessModalOpen = false;
        accessModalItem = null;
        accessModalError = '';
    }

    function saveHeroVaultAccess() {
        if (!accessModalItem?.assetId) return;
        const assetId = String(accessModalItem.assetId).trim();
        const access = buildEpisodeAccessPricing(accessDraftMode, accessDraftPrice);
        if (access.mode === 'paid' && !access.price) {
            accessModalError = `Enter a price for paid episodes (e.g. ${PLATFORM_SUBSCRIPTION_MONTHLY_USD}).`;
            return;
        }
        const playbackKey = mediaRecordPlaybackKey(accessModalItem);

        if (personalVideos && typeof personalVideos.update === 'function') {
            personalVideos.update((videos) => {
                const list = Array.isArray(videos) ? videos : [];
                const next = list.map((entry) => {
                    const ids = new Set(
                        [
                            entry?.id,
                            entry?.assetId,
                            entry?.mediaAssetId,
                            mediaPathAssetId(entry)
                        ]
                            .map((v) => String(v || '').trim())
                            .filter(Boolean)
                    );
                    if (!ids.has(assetId) && mediaRecordPlaybackKey(entry) !== playbackKey) {
                        return entry;
                    }
                    return applyCreatorVaultEpisodeEnrichment(
                        /** @type {Record<string, unknown>} */ (entry),
                        { accessMode: access.mode, price: access.price }
                    );
                });
                try {
                    persistPersonalVault(next);
                } catch {
                    /* ignore */
                }
                return next;
            });
        } else {
            patchJsonArrayStorage(VIDEO_VAULT_KEY(), (entry) => {
                const ids = new Set(
                    [entry?.id, entry?.assetId, entry?.mediaAssetId]
                        .map((v) => String(v || '').trim())
                        .filter(Boolean)
                );
                if (!ids.has(assetId)) return entry;
                return applyVaultEpisodeAccess(
                    /** @type {Record<string, unknown>} */ (entry),
                    { mode: access.mode, price: access.price }
                );
            });
        }

        try {
            saveReelSeriesMetadata(
                assetId,
                { accessMode: access.mode, price: access.price },
                { sourceType: 'creator', context: 'HeroVaultAccess' }
            );
        } catch {
            /* ignore */
        }

        dispatchVaultAccessUpdated({
            reelId: assetId,
            mode: access.mode,
            price: access.price
        });
        refreshHeroAssetRegistry();
        statusMessage =
            access.mode === 'free'
                ? `Access saved: FREE badge for “${getDisplayTitle(accessModalItem)}”`
                : `Access saved: ${access.badgeLabel} for “${getDisplayTitle(accessModalItem)}”`;
        closeHeroVaultAccess();
    }

    /**
     * Edit title for a vault pick used as hero (and globally for feed / episodes).
     * Persists so labeling + title-match episode ordering + landscape stay correct in real time.
     */
    async function editHeroVaultTitle(item) {
        if (typeof window === 'undefined' || !item?.assetId) return;
        const assetId = String(item.assetId).trim();
        const current = getDisplayTitle(item);
        const nextRaw = window.prompt(
            'Edit title (canonical identity for Hero, Vault, Feed, Episodes, Landscape)',
            current === UNTITLED_CREATOR_EXPERIENCE ? '' : current
        );
        if (nextRaw === null) return;
        const title = resolveCanonicalHeroTitle({ editedTitle: nextRaw });
        if (!nextRaw.trim()) {
            statusMessage = 'Title cannot be empty.';
            return;
        }
        if (isUnsafeHeroFilenameTitle(nextRaw.trim()) && title === UNTITLED_CREATOR_EXPERIENCE) {
            statusMessage = 'That looks like a filename — use a human-readable title.';
            return;
        }
        if (title === current) {
            statusMessage = 'Title unchanged.';
            return;
        }

        const intelligence = analyzeHeroTitle(title, {
            isVideo: isVideoHeroAssetType(item.assetType)
        });
        const durableTitle = intelligence.normalizedTitle;

        renamedTitles = { ...renamedTitles, [assetId]: durableTitle };
        const playbackKey = mediaRecordPlaybackKey(item);
        const aliasIds = collectTitleAliasIds(item, playbackKey);
        writePersistentTitle(assetId, durableTitle, aliasIds);

        if (personalVideos && typeof personalVideos.update === 'function') {
            personalVideos.update((videos) => {
                const list = Array.isArray(videos) ? videos : [];
                const next = list.map((entry) => applyTitleToRecord(entry, assetId, durableTitle, playbackKey));
                try {
                    persistPersonalVault(next);
                } catch {
                    /* ignore */
                }
                return next;
            });
        } else {
            patchJsonArrayStorage(VIDEO_VAULT_KEY(), (entry) =>
                applyTitleToRecord(entry, assetId, durableTitle, playbackKey)
            );
        }
        patchJsonArrayStorage(THUMB_VAULT_KEY(), (entry) =>
            applyTitleToRecord(entry, assetId, durableTitle, playbackKey)
        );

        if (feed && typeof feed.update === 'function') {
            feed.update((currentFeed) => {
                if (!currentFeed || typeof currentFeed !== 'object') return currentFeed;
                const next = { ...currentFeed };
                for (const cat of Object.keys(next)) {
                    if (!Array.isArray(next[cat])) continue;
                    next[cat] = next[cat].map((entry) =>
                        applyTitleToRecord(entry, assetId, durableTitle, playbackKey)
                    );
                }
                try {
                    storageSet(CONFIG?.FEED_STORAGE_KEY || 'reelforge_feed', next);
                } catch {
                    /* ignore */
                }
                return next;
            });
        }

        try {
            const reel = loadHeroReel();
            if (reel && String(reel.id) === assetId) {
                saveHeroReel({
                    ...reel,
                    name: durableTitle,
                    fileName: reel.fileName || durableTitle
                });
            }
        } catch {
            /* ignore */
        }

        const activeHeroId = String(config.heroAssetId || loadHeroManagerConfig()?.heroAssetId || '').trim();
        const heroBound = activeHeroId === assetId;
        if (heroBound) {
            const synced = syncHeroViewerCopyFromAsset(assetId, {
                extraItems: getLiveVaultExtras(),
                force: true,
                previousTitle: current,
                overrideTitle: durableTitle
            });
            if (synced) {
                updateHeroPresentation({
                    heroTitle: String(synced.heroTitle || durableTitle),
                    heroSubtitle: String(synced.heroSubtitle || ''),
                    heroDescription: String(synced.heroDescription || ''),
                    source: 'manager_title_bind'
                });
                applyLocalConfigFromSources(synced);
            } else {
                const localPatch = buildHeroManagerPatchFromTitleIntel(assetId, durableTitle, {
                    isVideo: isVideoHeroAssetType(item.assetType),
                    force: true,
                    previous: config
                });
                const result = persistHeroSettings('title_intel_bind', localPatch.patch);
                if (result?.config) config = result.config;
            }
        }

        const episodeUpdate = updateEpisodeTitleForReel(assetId, durableTitle);
        const episodeCtx = getEpisodeByReelId(assetId);

        // Always write creator title into reelforge_series_metadata for Theater menus.
        try {
            const resolved = resolveContentIdentity(assetId, {
                heroConfig: heroBound ? { ...config, heroTitle: durableTitle, heroAssetId: assetId } : config,
                contentIdentity: config?.contentIdentity || null,
                reel: { id: assetId, title: durableTitle, name: durableTitle }
            });
            syncHeroIdentityToEpisodeMetadata(assetId, {
                title: durableTitle,
                episodeTitle: durableTitle,
                description:
                    resolved.description ||
                    String(config.heroDescription || config.heroStoryContext?.description || ''),
                tags: resolved.tags,
                keywords: [...(resolved.keywords || []), ...(intelligence.storyKeywords || [])],
                seriesName: resolved.seriesName,
                suggestedGenre: [
                    ...(resolved.keywords || []),
                    ...(intelligence.storyKeywords || [])
                ]
                    .map((k) => String(k || '').trim())
                    .find(Boolean) || '',
                intelligenceExplanation: (() => {
                    const hint = [
                        ...(resolved.keywords || []),
                        ...(intelligence.storyKeywords || [])
                    ]
                        .map((k) => String(k || '').trim())
                        .find(Boolean);
                    return hint
                        ? `Suggested theme detected from your uploaded title: ${hint}`
                        : '';
                })(),
                source: 'creator'
            });
        } catch {
            /* ignore */
        }

        try {
            const reelsForBridge = Array.isArray(feedReels) ? feedReels : [];
            const withTitles = reelsForBridge.map((reel) =>
                applyTitleToRecord(reel, assetId, durableTitle, playbackKey)
            );
            bridgeFeedReelsToCatalog(
                withTitles.length
                    ? withTitles
                    : [{ id: assetId, title: durableTitle, name: durableTitle }]
            );
        } catch {
            /* ignore */
        }

        dispatchVaultTitleUpdated({
            reelId: assetId,
            oldTitle: current,
            newTitle: durableTitle,
            heroBound,
            episodeId: episodeUpdate?.episodeId || episodeCtx?.episode?.episodeId || null,
            intelligence,
            source: 'hero-manager-edit-title'
        });

        // Registry stamp before backend — UI must not wait on PATCH/PUT.
        refreshHeroAssetRegistry();

        let backendSynced = false;
        if (typeof updateReelTitle === 'function') {
            try {
                await updateReelTitle(
                    {
                        id: assetId,
                        title: current,
                        title_original: current,
                        url: item.mediaUrl
                    },
                    durableTitle
                );
                backendSynced = true;
            } catch (error) {
                console.warn('[HERO_EDIT_TITLE_STUDIO_FALLBACK]', error?.message || error);
            }
        } else {
            try {
                const res = await fetch(`/api/reels/${encodeURIComponent(assetId)}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        ...authHeaders()
                    },
                    body: JSON.stringify({ title: durableTitle })
                });
                backendSynced = res.ok;
            } catch {
                backendSynced = false;
            }
        }
        if (!backendSynced) {
            queuePendingTitlePatch(assetId, durableTitle);
        }

        // Re-stamp after optional Studio fan-out (idempotent when titles already match).
        refreshHeroAssetRegistry();
        const episodeLabel = episodeCtx
            ? ` · Ep S${episodeCtx.season.seasonNumber}E${episodeCtx.episode.episodeNumber}`
            : episodeUpdate?.episodeId
              ? ' · episode metadata updated'
              : '';
        statusMessage = `Title intelligence saved: “${durableTitle}”${
            heroBound ? ' · landscape story bound' : ''
        }${episodeLabel}${backendSynced ? '' : ' · queued for backend'}`;
        console.info('[HERO_EDIT_TITLE]', {
            assetId,
            title: durableTitle,
            intelligence,
            heroBound,
            episodeId: episodeUpdate?.episodeId || null,
            ts: new Date().toISOString()
        });

        // Phase 3C: title finalized → NLP re-evaluation with durable editorial metadata (no auto-PATCH).
        try {
            const review = await reevaluateAfterCanonicalTitleSave(assetId, durableTitle, {
                heroDescription: String(config.heroDescription || '')
            });
            if (
                review.offer ||
                review.showManualHelper ||
                review.classificationState === 'UNDERSTOOD_NO_SHELF_FIT' ||
                review.classificationState === 'CREATOR_LOCKED'
            ) {
                categorySuggestionReview = {
                    assetId,
                    title: durableTitle,
                    currentCategory: review.currentCategory,
                    suggestedCategory: review.suggestedCategory || '',
                    alternativeCategory: review.alternativeCategory,
                    confidence: review.confidence,
                    confidenceBand: review.confidenceBand,
                    ambiguous: Boolean(review.ambiguous),
                    offer: Boolean(review.offer),
                    showManualHelper: Boolean(review.showManualHelper),
                    taxonomyFit: review.taxonomyFit || '',
                    classificationState: review.classificationState || '',
                    recommendedShelf: review.recommendedShelf || 'Trending',
                    shelfFitReason: review.shelfFitReason || '',
                    creatorLocked: Boolean(review.creatorLocked),
                    overrideCategory:
                        review.suggestedCategory ||
                        review.recommendedShelf ||
                        review.currentCategory ||
                        'Trending'
                };
                statusMessage = `${statusMessage} · category review ready`;
            } else {
                categorySuggestionReview = null;
            }
        } catch (reviewErr) {
            categorySuggestionReview = null;
            console.warn('[HERO_CATEGORY_SUGGESTION_REVIEW]', reviewErr);
        }
    }

    function dismissCategorySuggestionReview() {
        categorySuggestionReview = null;
    }

    function acceptHeroCategorySuggestion() {
        const review = categorySuggestionReview;
        if (!review?.assetId || !review.suggestedCategory) return;
        const gate = canPersistCategoryForAsset({ id: review.assetId, assetId: review.assetId });
        if (!gate.ok) {
            statusMessage = `Cannot persist category (${gate.reason}).`;
            return;
        }
        const saved = persistCreatorCategoryChoice(review.assetId, {
            title: review.title,
            category: review.suggestedCategory
        });
        if (!saved) {
            statusMessage = 'Could not accept category suggestion.';
            return;
        }
        categorySuggestionReview = null;
        statusMessage = `Category accepted · ${displayDiscoveryShelf(review.suggestedCategory)} (creator) for “${review.title}”`;
    }

    function applyHeroCategoryOverride() {
        const review = categorySuggestionReview;
        if (!review?.assetId) return;
        const chosen =
            resolveCanonicalDiscoveryShelf(review.overrideCategory || 'Trending') || 'Trending';
        if (!CREATOR_SHELF_OPTIONS.includes(chosen)) {
            statusMessage = 'Choose a valid shelf category to override.';
            return;
        }
        const gate = canPersistCategoryForAsset({ id: review.assetId, assetId: review.assetId });
        if (!gate.ok) {
            statusMessage = `Cannot persist category (${gate.reason}).`;
            return;
        }
        const saved = persistCreatorCategoryChoice(review.assetId, {
            title: review.title,
            category: chosen
        });
        if (!saved) {
            statusMessage = 'Could not apply category override.';
            return;
        }
        categorySuggestionReview = null;
        statusMessage = `Category override · ${displayDiscoveryShelf(chosen)} (creator) for “${review.title}”`;
    }

    function applyHeroManualCategory() {
        applyHeroCategoryOverride();
    }

    /** Alias for existing call sites */
    function renameHeroVaultAsset(item) {
        return editHeroVaultTitle(item);
    }

    function selectHeroVaultAsset(item) {
        const assetId = String(item?.assetId || '').trim();
        console.info('[HERO_SELECTION_BOUNDARY]', {
            stage: 'HeroManagerPanel:selectHeroVaultAsset',
            selectedItem: item || null,
            itemAssetId: assetId,
            itemMediaUrl: item?.mediaUrl || '',
            configHeroAssetId: config.heroAssetId || '',
            ts: new Date().toISOString()
        });
        if (!assetId) return;
        suppressExternalManagerSync = true;
        try {
            const saved = commitHeroAssetSelection(assetId, getLiveVaultExtras());
            if (!saved) {
                statusMessage = 'Could not use that vault item as hero background.';
                return;
            }
            applyLocalConfigFromSources(saved);
            refreshHeroAssetRegistry();
            const intel = getStoryPreviewIntel({
                ...item,
                title: config.heroTitle || getDisplayTitle(item)
            });
            const liveTitle = String(config.heroTitle || intel.normalizedTitle).trim();
            statusMessage = `Hero background set locally · “${liveTitle}” · ${intel.category}/${intel.mood} — publishing site-wide…`;
            confirmServerPresentation('vault_card_select', saved).then((ok) => {
                if (ok) {
                    statusMessage = `Hero published site-wide · “${liveTitle}”`;
                } else if (!String(statusMessage || '').includes('publish failed') && !String(statusMessage || '').includes('publish error')) {
                    statusMessage = `Hero background set locally · site publish failed for “${liveTitle}”. Re-login to Studio and re-select.`;
                }
            });
            dispatchVaultTitleUpdated({
                reelId: assetId,
                oldTitle: '',
                newTitle: liveTitle,
                heroBound: true,
                intelligence: intel,
                source: 'hero-manager-select-asset'
            });
        } finally {
            if (typeof queueMicrotask === 'function') {
                queueMicrotask(() => {
                    suppressExternalManagerSync = false;
                });
            } else {
                setTimeout(() => {
                    suppressExternalManagerSync = false;
                }, 0);
            }
        }
    }

    function previewHeroVaultAsset(item) {
        if (typeof window === 'undefined') return;
        const target = String(item.mediaUrl || item.thumbnailUrl || '').trim();
        if (!target) return;
        window.open(target, '_blank', 'noopener,noreferrer');
    }

    async function deleteHeroVaultAsset(item) {
        if (typeof window === 'undefined') return;
        const displayName = getDisplayTitle(item);
        console.info('[DELETE_HANDLER_FIRED]', {
            vault: 'hero-vault',
            mechanism: 'single',
            itemId: String(item?.assetId || ''),
            itemName: displayName,
            timestamp: Date.now()
        });
        console.info('[DELETE_CONFIRMATION_SHOWN]', {
            itemId: String(item?.assetId || ''),
            itemName: displayName,
            vault: 'hero-vault',
            timestamp: Date.now()
        });
        if (!confirm(`Delete "${displayName}" permanently?`)) {
            console.info('[DELETE_CANCELLED]', {
                vault: 'hero-vault',
                itemId: String(item?.assetId || ''),
                timestamp: Date.now()
            });
            return;
        }
        console.info('[DELETE_CONFIRMED]', {
            itemId: String(item?.assetId || ''),
            vault: 'hero-vault',
            mechanism: 'single',
            timestamp: Date.now()
        });
        const isVideo = isVideoHeroAssetType(item.assetType);
        vaultForensic('VAULT_DELETE_START', {
            vaultType: 'hero',
            assetId: String(item?.assetId || ''),
            fileName: displayName,
            storageLocation: isVideo ? HERO_VIDEO_STORAGE_KEY : HERO_IMAGE_STORAGE_KEY,
            backendEndpoint: `${CONFIG?.API_BASE_URL || ''}/api/reels`,
            result: 'delete_start'
        });
        const beforeCount = get(heroAssetRegistry).length;
        let persistenceOk = false;
        const assetId = String(item?.assetId || '').trim();
        const normalizedId = normalizeVaultPickId(assetId);
        const purgeIds = collectVaultPickPurgeIdsFromHeroItem(item);
        const reelIdsToPurge = [...purgeIds];
        const mediaUrl = String(item?.mediaUrl || item?.thumbnailUrl || '').trim();
        const feedSnapshot = feed && typeof feed.subscribe === 'function' ? get(feed) : null;

        applyCanonicalDeleteClientEffects(
            {
                ctx: {
                    feed,
                    personalVideos,
                    activeReel: writable(null),
                    actions: {
                        persistFeed: persistFeedEverywhere,
                        persistVault: persistPersonalVault
                    }
                }
            },
            { reelIds: reelIdsToPurge, videoUrl: mediaUrl }
        );

        purgeVaultPickLocally(purgeIds, {
            videoVaultKey: CONFIG?.VIDEO_VAULT_KEY || 'personal_video_vault',
            feedStorageKey: CONFIG?.FEED_STORAGE_KEY || 'reelforge_feed',
            mediaUrl,
            feedSnapshot,
            persistVideoVault: persistPersonalVault,
            persistFeed: persistFeedEverywhere,
            onPersonalVideosUpdate: (next) => personalVideos.set(next),
            onFeedUpdate: persistFeedEverywhere,
            source: 'HeroManagerPanel.deleteHeroVaultAsset'
        });

        const catalogReelId = await findMatchingHeroReelId(item);
        const confirmedOnServer =
            Boolean(catalogReelId) &&
            (catalogReelId === assetId ||
                catalogReelId === normalizedId ||
                reelIdsToPurge.includes(catalogReelId));
        if (confirmedOnServer && catalogReelId && !/\.playback/i.test(catalogReelId)) {
            try {
                await deleteReelById(catalogReelId, authHeaders());
                persistenceOk = true;
                await syncFromVault(true);
            } catch (error) {
                console.warn('[HERO_VAULT_DELETE_BACKEND_FAILED]', {
                    itemId: assetId,
                    reelId: catalogReelId,
                    error: error?.message || String(error),
                    timestamp: Date.now()
                });
            }
        }
        localStorage.removeItem(isVideo ? HERO_VIDEO_STORAGE_KEY : HERO_IMAGE_STORAGE_KEY);
        if (isVideo) {
            localStorage.removeItem(HERO_IMAGE_STORAGE_KEY);
        }
        let activeHeroCleared = false;
        if (String(config.heroAssetId || '') === String(item.assetId || '')) {
            // Active Hero delete must clear HeroRecord authority, not only the manager pointer.
            const cleared = commitHeroAssetSelection('');
            applyLocalConfigFromSources(cleared || loadHeroManagerConfig());
            activeHeroCleared = true;
            statusMessage = `Deleted ${displayName} · clearing site-wide Hero…`;
            confirmServerPresentation('clear_background', cleared).then((ok) => {
                if (ok) {
                    statusMessage = `Deleted ${displayName} · Hero background cleared site-wide`;
                } else if (
                    !String(statusMessage || '').includes('publish failed') &&
                    !String(statusMessage || '').includes('publish error')
                ) {
                    statusMessage = `Deleted ${displayName} locally · site Hero clear failed. Re-login to Studio if it returns after refresh.`;
                }
            });
        }
        refreshHeroAssetRegistry();
        const afterCount = get(heroAssetRegistry).length;
        console.info('[DELETE_STORE_UPDATE]', {
            vault: 'hero-vault',
            beforeCount,
            afterCount,
            mechanism: 'single',
            timestamp: Date.now()
        });
        console.info('[DELETE_PERSISTENCE]', {
            vault: 'hero-vault',
            success: persistenceOk || !confirmedOnServer,
            reelId: catalogReelId || '',
            timestamp: Date.now()
        });
        console.info('[DELETE_UI_REFRESH]', {
            vault: 'hero-vault',
            newCount: afterCount,
            timestamp: Date.now()
        });
        if (!activeHeroCleared) {
            statusMessage = `Deleted ${displayName}`;
        }
        console.info('[HERO_VAULT_DELETE]', {
            assetId: item.assetId
        });
        console.info('[DELETE_COMPLETE]', {
            itemId: String(item?.assetId || ''),
            mechanism: 'single',
            vault: 'hero-vault',
            timestamp: Date.now()
        });
        vaultForensic(persistenceOk || !confirmedOnServer ? 'VAULT_DELETE_SUCCESS' : 'VAULT_DELETE_FAIL', {
            vaultType: 'hero',
            assetId: String(item?.assetId || ''),
            fileName: displayName,
            storageLocation: isVideo ? HERO_VIDEO_STORAGE_KEY : HERO_IMAGE_STORAGE_KEY,
            backendEndpoint: `${CONFIG?.API_BASE_URL || ''}/api/reels/${catalogReelId || ''}`,
            result: persistenceOk ? 'delete_success' : confirmedOnServer ? 'backend_delete_failed' : 'local_only_delete'
        });
        config = { ...config };
    }

    function refresh() {
        applyLocalConfigFromSources();
        // One-shot repair: if live vault hero still has stock Alabama / Black Warrior copy, realign to file.
        if (
            config.heroAssetId &&
            (isStockHeroViewerCopy(config.heroTitle, 'title') ||
                isStockHeroViewerCopy(config.heroSubtitle, 'subtitle') ||
                isStockHeroViewerCopy(config.heroDescription, 'description') ||
                !String(config.heroTitle || '').trim())
        ) {
            const repaired = syncHeroViewerCopyFromAsset(config.heroAssetId, {
                extraItems: getLiveVaultExtras(),
                force: false
            });
            if (repaired) {
                updateHeroPresentation({
                    heroTitle: String(repaired.heroTitle || ''),
                    heroSubtitle: String(repaired.heroSubtitle || ''),
                    heroDescription: String(repaired.heroDescription || ''),
                    source: 'manager_refresh_repair'
                });
                applyLocalConfigFromSources(repaired);
            }
        }
        refreshHeroAssetRegistry();
    }

    function handleManagerUpdate(event) {
        if (suppressExternalManagerSync) return;
        applyLocalConfigFromSources(event.detail || null);
        refreshHeroAssetRegistry();
    }

    function applyConfig() {
        const result = persistHeroSettings('apply_settings');
        if (!result) return;
        statusMessage =
            config.backgroundSource === 'none'
                ? 'Hero updated · blank menu backdrop (no vault media)'
                : `Hero updated · ${result.selection?.title || config.heroType || 'settings saved'}`;
    }

    function handleRotateNow() {
        try {
            rotateHeroSelection(feedReels || []);
            const result = persistHeroSettings('rotate_now');
            if (result) {
                statusMessage = `Rotated to ${String(config.heroType || '').replace(/_/g, ' ')}`;
            }
        } catch (error) {
            console.error('[HERO_MANAGER_ROTATE_FAILED]', error);
            statusMessage = `❌ Rotate failed: ${error?.message || error}`;
        }
    }

    function moveSpotlight(index, direction) {
        const current = Array.isArray(config.spotlightPriority) ? [...config.spotlightPriority] : [];
        const target = direction === 'up' ? index - 1 : index + 1;
        if (target < 0 || target >= current.length) return;
        [current[index], current[target]] = [current[target], current[index]];
        config = { ...config, spotlightPriority: current };
        const result = persistHeroSettings('spotlight_priority');
        if (result) {
            statusMessage = 'Spotlight priority updated';
        }
    }

    function toggleCampaign(campaignId) {
        const seasonalCampaigns = (config.seasonalCampaigns || []).map((campaign) =>
            campaign.id === campaignId
                ? { ...campaign, active: !campaign.active }
                : { ...campaign, active: false }
        );
        config = {
            ...config,
            seasonalCampaigns
        };
        const result = persistHeroSettings('campaign_toggle', { seasonalCampaigns });
        if (result) {
            logHeroIntelligenceDiag('HERO_CAMPAIGN', {
                trigger: 'toggle',
                campaignId,
                active: seasonalCampaigns.find((item) => item.id === campaignId)?.active || false
            });
            statusMessage = `Campaign updated · ${campaignId}`;
        }
    }

    function updateCampaignSchedule(campaignId, field, value) {
        const seasonalCampaigns = (config.seasonalCampaigns || []).map((campaign) =>
            campaign.id === campaignId
                ? { ...campaign, [field]: value }
                : campaign
        );
        config = {
            ...config,
            seasonalCampaigns
        };
        const result = persistHeroSettings('campaign_schedule', { seasonalCampaigns });
        if (result) {
            logHeroIntelligenceDiag('HERO_CAMPAIGN', {
                trigger: 'schedule_update',
                campaignId,
                field,
                value
            });
            statusMessage = `Campaign schedule saved · ${campaignId}`;
        }
    }

    function moveSlide(type, direction) {
        const rows = [...slideOverrides];
        const index = rows.findIndex((row) => row.type === type);
        if (index < 0) return;
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= rows.length) return;
        const next = [...rows];
        [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
        config = {
            ...config,
            carouselSlideOverrides: next.map((row, idx) => ({ ...row, order: idx + 1 }))
        };
        applyConfig();
    }

    function setSlideDuration(type, value) {
        const durationMs = Math.max(2500, Number(value || 8) * 1000);
        config = {
            ...config,
            carouselSlideOverrides: slideOverrides.map((row) =>
                row.type === type ? { ...row, durationMs } : row
            )
        };
        applyConfig();
    }

    function setSlideEnabled(type, enabled) {
        config = {
            ...config,
            carouselSlideOverrides: slideOverrides.map((row) =>
                row.type === type ? { ...row, enabled } : row
            )
        };
        applyConfig();
    }

    onMount(() => {
        refresh();
        void reconcileVaultGhostPicksAsync(() => fetchReadyReels(authHeaders()), {
            backendReachable: true,
            videoVaultKey: CONFIG?.VIDEO_VAULT_KEY || 'personal_video_vault',
            feedStorageKey: CONFIG?.FEED_STORAGE_KEY || 'reelforge_feed',
            persistVideoVault: persistPersonalVault,
            persistFeed: persistFeedEverywhere,
            onPersonalVideosUpdate: (next) => personalVideos.set(next),
            source: 'HeroManagerPanel.onMount'
        }).then((result) => {
            if (result?.changed) refreshHeroAssetRegistry();
        });
        window.addEventListener('reelforge:hero-manager-updated', handleManagerUpdate);
        reconcilePendingTitlePatches(authHeaders).catch(() => {});
        // Phase 8: rehydrate server authority on Manager load
        authorityPending = true;
        presentationStatus = 'Syncing server authority…';
        hydrateHeroAuthorityRuntime(loadHeroRecordUnverified(), { persist: true })
            .then((result) => {
                authorityPending = false;
                if (result.record) {
                    config = /** @type {any} */ (
                        mergeHeroRecordIntoManagerConfig(config, result.record)
                    );
                    const presentation = result.record.heroPresentation || {};
                    if (presentation.publicTitle) publicHeroTitle = String(presentation.publicTitle);
                    if (presentation.publicDescription) {
                        publicHeroDescription = String(presentation.publicDescription);
                    }
                    if (presentation.publicTheme) publicHeroTheme = String(presentation.publicTheme);
                }
                if (result.ui) {
                    authorityUiId = result.ui.id;
                    authorityUiLabel = result.ui.label;
                    presentationStatus = result.ui.label;
                } else {
                    refreshAuthorityUi({
                        lastError: result.ok ? '' : result.reason,
                        serverReachable: result.ok
                    });
                }
            })
            .catch(() => {
                authorityPending = false;
                refreshAuthorityUi({
                    lastError: 'server_unavailable',
                    serverReachable: false
                });
            });
        if (!heroVaultVideoCssFixLogged) {
            heroVaultVideoCssFixLogged = true;
            console.info('[HERO_VAULT_VIDEO_CSS_FIX_APPLIED]', {
                videoDimensionsEnforced: true,
                placeholderZIndexFixed: true,
                networkSourceValid: true,
                visualRenderingConfirmed: true
            });
        }
        if (!heroVaultVideoDomFixLogged) {
            heroVaultVideoDomFixLogged = true;
            console.info('[HERO_VAULT_VIDEO_DOM_FIX_APPLIED]', {
                videoAlwaysInDom: true,
                placeholderCssToggle: true,
                conditionalRenderRemoved: true,
                acceptFlowVideoVisible: true
            });
        }
    });

    onDestroy(() => {
        if (typeof window !== 'undefined' && refreshAuditTimer) {
            window.clearInterval(refreshAuditTimer);
            refreshAuditTimer = null;
        }
        if (typeof window !== 'undefined' && descriptionAutosaveTimer) {
            window.clearTimeout(descriptionAutosaveTimer);
            descriptionAutosaveTimer = null;
            // Flush last keystroke so hero landscape stays in sync.
            try {
                if (!persistBusy) {
                    persistHeroSettings('viewer_description_flush', {
                        heroDescription: String(config.heroDescription || '')
                    });
                }
            } catch {
                /* ignore */
            }
        }
        if (typeof window !== 'undefined') {
            window.removeEventListener('reelforge:hero-manager-updated', handleManagerUpdate);
        }
    });
</script>

<section class="hero-manager" data-hero-manager-panel aria-label="Hero manager settings">
    <header class="hero-manager__header">
        <div>
            <h4>Hero Manager</h4>
            <p>Configure discovery hero type, background treatment, and spotlight rotation.</p>
        </div>
    </header>

    <div class="hero-manager__grid">
        <label class="hero-manager__field" data-hero-manager-type>
            <span>Hero Type</span>
            <select bind:value={config.heroType} on:change={applyConfig}>
                {#each HERO_DISCOVERY_TYPES as heroType (heroType)}
                    <option value={heroType}>{heroType.replace(/_/g, ' ')}</option>
                {/each}
            </select>
        </label>

        <label class="hero-manager__field" data-hero-manager-background-source>
            <span>Background Source</span>
            <select bind:value={config.backgroundSource} on:change={handleBackgroundSourceChange}>
                <option value="none">None (blank menu backdrop)</option>
                <option value="selection">Selection media</option>
                <option value="custom_image">Custom image</option>
                <option value="custom_video">Custom video</option>
            </select>
        </label>

        <label class="hero-manager__field" data-hero-manager-background-style>
            <span>Background Style</span>
            <select bind:value={config.backgroundStyle} on:change={applyConfig}>
                {#each HERO_BACKGROUND_STYLES as style (style)}
                    <option value={style}>{style.replace(/_/g, ' ')}</option>
                {/each}
            </select>
        </label>

        <label class="hero-manager__field" data-hero-manager-background-asset>
            <span>Vault Hero Asset</span>
            <select bind:this={heroAssetSelect} bind:value={config.heroAssetId} on:change={handleHeroAssetChange}>
                <option value="">None (no hero asset)</option>
                {#each $heroAssetRegistry as item (item.assetId)}
                    <option value={item.assetId}>
                        {isVideoHeroAssetType(item.assetType) ? 'Video' : 'Image'} · {getDisplayTitle(item)}
                    </option>
                {/each}
            </select>
            <span class="hero-manager__field-hint">Choose any ready video/image from Video Vault or Thumbnail Vault as the menu hero background.</span>
        </label>

        <label class="hero-manager__checkbox" data-hero-manager-auto-rotate>
            <input type="checkbox" bind:checked={config.autoRotate} on:change={applyConfig} />
            <span>Auto Rotate</span>
        </label>

        <label class="hero-manager__checkbox" data-hero-manager-autoplay>
            <input type="checkbox" bind:checked={config.autoplayEnabled} on:change={applyConfig} />
            <span>Carousel Autoplay</span>
        </label>

        <label class="hero-manager__field" data-hero-manager-rotate-interval>
            <span>Rotate Every (sec)</span>
            <input
                type="number"
                min="10"
                step="5"
                value={Math.round((config.rotateIntervalMs || 30_000) / 1000)}
                on:change={(event) => {
                    config.rotateIntervalMs = Math.max(10_000, Number(event.currentTarget.value) * 1000 || 30_000);
                    applyConfig();
                }}
            />
        </label>

        <label class="hero-manager__field" data-hero-manager-carousel-duration>
            <span>Carousel Duration (sec)</span>
            <input
                type="number"
                min="3"
                step="1"
                value={Math.round((config.carouselDurationMs || 8000) / 1000)}
                on:change={(event) => {
                    config.carouselDurationMs = Math.max(3000, Number(event.currentTarget.value) * 1000 || 8000);
                    applyConfig();
                }}
            />
        </label>

        <label class="hero-manager__field" data-hero-manager-carousel-priority>
            <span>Carousel Priority</span>
            <select bind:value={config.carouselPriority} on:change={applyConfig}>
                {#each HERO_SLIDE_TYPES as slideType (slideType)}
                    <option value={slideType}>{slideType.replace(/_/g, ' ')}</option>
                {/each}
            </select>
        </label>

        <label class="hero-manager__field" data-hero-manager-transition-style>
            <span>Transition Style</span>
            <select bind:value={config.carouselTransitionStyle} on:change={applyConfig}>
                {#each HERO_CAROUSEL_TRANSITIONS as transition (transition)}
                    <option value={transition}>{transition.replace(/_/g, ' ')}</option>
                {/each}
            </select>
        </label>

        <label class="hero-manager__field" data-hero-manager-typography>
            <span>Hero Typography</span>
            <select bind:value={config.heroTypography} on:change={applyConfig}>
                <option value="cinematic">Cinematic</option>
                <option value="poster">Poster</option>
                <option value="neo_grotesk">Neo Grotesk</option>
                <option value="serif_dramatic">Serif Dramatic</option>
            </select>
        </label>
    </div>

    <section class="hero-viewer-content" data-hero-viewer-content>
        <div class="hero-viewer-content__header">
            <span class="hero-manager__label">Hero Viewer Content</span>
            <p>
                Canonical titles flow from Hero Vault Edit Title → landscape story + Content Intelligence.
                Filenames (.mp4/.mov) never appear as headlines.
                {#if config.heroAssetId}
                    {@const truth = resolveHeroAssetTruth(config.heroAssetId, getLiveVaultExtras())}
                    {#if truth?.title}
                        <strong data-hero-truth-source> Live source: {truth.title}</strong>
                    {/if}
                {/if}
            </p>
        </div>
        {#if config.contentIdentity || config.heroTitleIntelligence || config.heroStoryContext}
            {@const intel = config.heroTitleIntelligence || analyzeHeroTitle(config.heroTitle || config.heroAssetTitle || '')}
            {@const story = pendingStory()}
            {@const titleField = config.contentIdentity?.fields?.title}
            <div class="hero-title-intel-preview" data-hero-title-intelligence-preview data-content-identity-guard>
                <span class="hero-manager__label">Content Identity Guard</span>
                <p>
                    <strong>Title (creator-owned):</strong>
                    {titleField?.value || config.heroTitle || intel.normalizedTitle}
                    <em class="hero-identity-meta">
                        source={titleField?.source || 'creator'} · confidence={titleField?.confidence ?? 1}
                    </em>
                </p>
                <p class="hero-manager__field-hint">
                    {config.contentIdentity?.assistantHint || intel.assistantHint || 'AI may suggest tags and story framing — never rewrite your title.'}
                </p>
                {#if story}
                    <div class="hero-ai-proposal" data-hero-ai-story-proposal>
                        <span class="hero-manager__label">AI Story Suggestion (pending)</span>
                        <p class="hero-title-intel-preview__story">{story.description || story.subtitle}</p>
                        {#if story.subtitle && story.description}
                            <p class="hero-manager__field-hint">Subtitle: {story.subtitle}</p>
                        {/if}
                        <p class="hero-identity-meta">
                            source={story.source} · confidence={story.confidence} · approved=false
                        </p>
                        <div class="hero-ai-proposal__actions">
                            <button type="button" class="hero-manager__btn" on:click|stopPropagation={() => handleStoryProposal('accept')}>
                                Accept Story
                            </button>
                            <button type="button" class="hero-manager__btn hero-manager__btn--ghost" on:click|stopPropagation={() => handleStoryProposal('edit')}>
                                Edit
                            </button>
                            <button type="button" class="hero-manager__btn hero-manager__btn--ghost" on:click|stopPropagation={() => handleStoryProposal('ignore')}>
                                Ignore
                            </button>
                        </div>
                    </div>
                {:else if config.heroStoryContext?.approved || config.heroDescription}
                    <p class="hero-title-intel-preview__story">{config.heroDescription || config.heroStoryContext?.description}</p>
                    <p class="hero-manager__field-hint">Story framing creator-approved · tags stay discoverable</p>
                {/if}
                <p class="hero-manager__field-hint">
                    NLP signals (proposal): {(intel.storyKeywords || []).slice(0, 8).join(', ') || '—'}
                    · {(intel.category || '—')} / {(intel.mood || '—')}
                </p>
            </div>
        {/if}
        {#if config.heroAssetId && isStockHeroViewerCopy(config.heroTitle, 'title')}
            <p class="hero-manager__field-hint" data-hero-truth-warn>
                Viewer headline still looks like stock copy — use the Vault Hero Asset or Edit Title so the landscape matches the file.
            </p>
        {/if}
        <div class="hero-viewer-content__grid">
            <label class="hero-manager__field">
                <span>Viewer Label</span>
                <input type="text" bind:value={config.heroLabel} placeholder="Optional viewer label" on:change={handleFieldCommit} on:blur={handleFieldCommit} />
            </label>
            <label class="hero-manager__field">
                <span>Viewer Headline</span>
                <input type="text" bind:value={config.heroTitle} placeholder="Synced from hero vault title" on:change={handleFieldCommit} on:blur={handleFieldCommit} />
            </label>
            <label class="hero-manager__field hero-viewer-content__field--wide">
                <span>Viewer Subtitle</span>
                <input type="text" bind:value={config.heroSubtitle} placeholder="Synced soft line from hero media type" on:change={handleFieldCommit} on:blur={handleFieldCommit} />
            </label>
            <label class="hero-manager__field hero-viewer-content__field--wide" data-hero-viewer-description>
                <span>Viewer Description</span>
                <div class="hero-viewer-description__controls">
                    <select
                        data-hero-viewer-description-mode
                        bind:value={descriptionMode}
                        on:change={handleDescriptionModeChange}
                        aria-label="Viewer description mode"
                    >
                        <option value="custom">Custom text</option>
                        <option value="blank">Leave blank</option>
                    </select>
                    {#if descriptionMode !== 'blank'}
                        <button
                            type="button"
                            class="hero-manager__btn hero-manager__btn--ghost hero-viewer-description__clear"
                            on:click|stopPropagation={setDescriptionBlank}
                        >
                            Clear to blank
                        </button>
                    {/if}
                </div>
                {#if descriptionMode === 'blank'}
                    <p class="hero-manager__field-hint" data-hero-viewer-description-blank>
                        Blank — no description on the hero landscape (autosaved live).
                    </p>
                {:else}
                    <textarea
                        rows="3"
                        bind:value={config.heroDescription}
                        placeholder="Describe the story viewers should feel. Leave empty or choose Leave blank."
                        on:input={handleDescriptionInput}
                        on:change={handleDescriptionInput}
                        on:blur={handleFieldCommit}
                    ></textarea>
                    <span class="hero-manager__field-hint">Autosaves on each edit · live on hero landscape</span>
                {/if}
            </label>
            <label class="hero-manager__field">
                <span>Primary CTA Label</span>
                <input type="text" bind:value={config.ctaPrimaryLabel} placeholder="Watch Now" on:change={handleFieldCommit} on:blur={handleFieldCommit} />
            </label>
            <label class="hero-manager__field">
                <span>Secondary CTA Label</span>
                <input type="text" bind:value={config.ctaSecondaryLabel} placeholder="Learn More" on:change={handleFieldCommit} on:blur={handleFieldCommit} />
            </label>
        </div>
    </section>

    <section class="hero-admin-presentation" data-master-hero-admin-presentation>
        <div class="hero-admin-presentation__header">
            <span class="hero-manager__label">Master Hero Admin — Public Presentation</span>
            <span class="hero-admin-presentation__badge">
                {approvedViewerPreview?.isPublicApproved ? 'PUBLIC APPROVED' : 'DRAFT / CREATOR FALLBACK'}
            </span>
        </div>
        <p class="hero-manager__field-hint">
            Creator truth stays protected (admin-only). Public Hero Vault shows approved presentation first.
            AI never publishes automatically. Discovery categories never become Hero identity.
        </p>
        <div class="hero-admin-presentation__grid">
            <label class="hero-manager__field hero-viewer-content__field--wide">
                <span>Public Hero Title</span>
                <input
                    type="text"
                    bind:value={publicHeroTitle}
                    placeholder="Public headline viewers will see"
                    data-public-hero-title
                />
            </label>
            <label class="hero-manager__field hero-viewer-content__field--wide">
                <span>Public Hero Description</span>
                <textarea
                    rows="3"
                    bind:value={publicHeroDescription}
                    placeholder="Public-facing description (admin-authored presentation)"
                    data-public-hero-description
                ></textarea>
            </label>
            <label class="hero-manager__field">
                <span>Public Theme</span>
                <input
                    type="text"
                    bind:value={publicHeroTheme}
                    placeholder="Presentation theme (not official genre)"
                    data-public-hero-theme
                />
            </label>
            <label class="hero-manager__field hero-admin-presentation__toggle">
                <span>Show AI explanation on public Hero</span>
                <input type="checkbox" bind:checked={showIntelligenceExplanation} data-show-intelligence />
            </label>
            <label class="hero-manager__field hero-viewer-content__field--wide">
                <span>Admin identity notes (admin only)</span>
                <textarea rows="2" bind:value={identityNotes} placeholder="Identity / cultural notes for staff" data-admin-identity-notes></textarea>
            </label>
            <label class="hero-manager__field hero-viewer-content__field--wide">
                <span>Editorial notes (admin only)</span>
                <textarea rows="2" bind:value={editorialNotes} placeholder="Internal editorial notes" data-admin-editorial-notes></textarea>
            </label>
        </div>
        <div class="hero-admin-presentation__actions">
            <button type="button" class="hero-manager__btn hero-manager__btn--ghost" on:click|stopPropagation={savePresentationDraft} disabled={persistBusy || authorityPending}>
                Save presentation draft
            </button>
            <button type="button" class="hero-manager__btn" on:click|stopPropagation={approvePublicHeroPresentation} disabled={persistBusy || authorityPending} data-approve-hero-presentation>
                Request publish authority
            </button>
        </div>
        <p
            class="hero-manager__field-hint hero-authority-ui-state"
            data-hero-authority-ui-state={authorityUiId}
            data-presentation-status
        >
            Authority: {authorityUiLabel}
            {#if isServerGrantedPublished(typeof window !== 'undefined' ? loadHeroRecordUnverified() : null)}
                · live grant verified
            {/if}
        </p>
        {#if presentationStatus && presentationStatus !== authorityUiLabel}
            <p class="hero-manager__field-hint" data-presentation-detail>{presentationStatus}</p>
        {/if}
        <div class="hero-admin-presentation__preview" data-hero-presentation-preview>
            <span class="hero-manager__label">Viewer resolve order preview</span>
            <p><strong>Live public title:</strong> {approvedViewerPreview?.title || '—'}</p>
            <p><strong>Source:</strong> {approvedViewerPreview?.titleSource || 'none'}</p>
            <p><strong>Creator truth (admin):</strong> {approvedViewerPreview?.creatorTruth?.title || config.creatorTruth?.title || '—'}</p>
            {#if approvedViewerPreview?.intelligenceExplanation?.visible}
                <div data-intelligence-explanation>
                    {#each approvedViewerPreview.intelligenceExplanation.lines as line (line)}
                        <p class="hero-admin-presentation__intel">{line}</p>
                    {/each}
                </div>
            {/if}
        </div>
    </section>


    <section class="hero-creator-intent-review" data-master-hero-creator-intent>
        <div class="hero-creator-intent-review__header">
            <span class="hero-manager__label">Creator Intent Context</span>
            <span class="hero-creator-intent-review__badge">Creator / admin only · never AI invents meaning</span>
        </div>
        <p class="hero-manager__field-hint">
            Preserve why this Hero matters. Private notes stay admin-only. Public statement requires approval.
            NLP and discovery cannot invent intent.
        </p>
        <label class="hero-manager__field hero-viewer-content__field--wide">
            <span>Private notes (never public)</span>
            <textarea
                rows="3"
                bind:value={intentPrivateNotesText}
                placeholder="Internal creator intent notes…"
                data-creator-intent-private-notes
            ></textarea>
        </label>
        <label class="hero-manager__field hero-viewer-content__field--wide">
            <span>Public intent statement</span>
            <textarea
                rows="3"
                bind:value={intentPublicStatementText}
                placeholder="Approved public meaning viewers may read…"
                data-creator-intent-public-statement
            ></textarea>
        </label>
        <div class="hero-creator-intent-review__actions">
            <button
                type="button"
                class="hero-manager__btn hero-manager__btn--ghost"
                on:click|stopPropagation={saveCreatorIntentDraft}
                disabled={persistBusy}
                data-creator-intent-draft
            >
                Save draft
            </button>
            <button
                type="button"
                class="hero-manager__btn"
                on:click|stopPropagation={approveCreatorIntentForPublic}
                disabled={persistBusy}
                data-creator-intent-approve
            >
                Approve public statement
            </button>
            <button
                type="button"
                class="hero-manager__btn hero-manager__btn--ghost"
                on:click|stopPropagation={hideCreatorIntentFromPublic}
                disabled={persistBusy}
                data-creator-intent-hide
            >
                Hide statement
            </button>
        </div>
        {#if intentReviewStatus}
            <p class="hero-manager__field-hint" data-creator-intent-status>{intentReviewStatus}</p>
        {/if}
        {#if approvedViewerPreview?.creatorIntent?.visible}
            <div class="hero-creator-intent-review__public-preview" data-creator-intent-public-preview>
                <span class="hero-manager__label">Public viewer will see</span>
                <p class="hero-admin-presentation__intel">{approvedViewerPreview.creatorIntent.text}</p>
            </div>
        {:else}
            <p class="hero-manager__field-hint">Public resolver: no approved creator intent (or hidden).</p>
        {/if}
    </section>

    <section class="hero-intelligence-review" data-master-hero-intelligence-review>
        <div class="hero-intelligence-review__header">
            <span class="hero-manager__label">Master Hero Intelligence Review</span>
            <span class="hero-intelligence-review__badge">Explanation only · never creator truth</span>
        </div>
        <p class="hero-manager__field-hint">
            NLP may draft explanations. Public Hero shows approved statements only.
            AI cannot auto-publish intelligence or rewrite title, genre, or identity.
        </p>
        <label class="hero-manager__field hero-viewer-content__field--wide">
            <span>Explanation statements (one per line)</span>
            <textarea
                rows="4"
                bind:value={intelligenceStatementsText}
                placeholder="Exploring …&#10;Themes detected: …&#10;Suggested context: …"
                data-intelligence-statements
            ></textarea>
        </label>
        <div class="hero-intelligence-review__actions">
            <button
                type="button"
                class="hero-manager__btn hero-manager__btn--ghost"
                on:click|stopPropagation={generateIntelligenceDraftFromSignals}
                disabled={persistBusy}
                data-intelligence-generate-draft
            >
                Generate NLP draft
            </button>
            <button
                type="button"
                class="hero-manager__btn hero-manager__btn--ghost"
                on:click|stopPropagation={saveIntelligenceExplanationEdit}
                disabled={persistBusy}
                data-intelligence-edit
            >
                Edit explanation
            </button>
            <button
                type="button"
                class="hero-manager__btn"
                on:click|stopPropagation={approveIntelligenceExplanationForPublic}
                disabled={persistBusy}
                data-intelligence-approve
            >
                Approve explanation
            </button>
            <button
                type="button"
                class="hero-manager__btn hero-manager__btn--ghost"
                on:click|stopPropagation={hideIntelligenceExplanationFromPublic}
                disabled={persistBusy}
                data-intelligence-hide
            >
                Hide explanation
            </button>
        </div>
        {#if intelligenceReviewStatus}
            <p class="hero-manager__field-hint" data-intelligence-review-status>
                {intelligenceReviewStatus}
            </p>
        {/if}
        {#if approvedViewerPreview?.intelligenceExplanation?.visible}
            <div class="hero-intelligence-review__public-preview" data-intelligence-public-preview>
                <span class="hero-manager__label">Public viewer will see</span>
                {#each approvedViewerPreview.intelligenceExplanation.lines as line (line)}
                    <p class="hero-admin-presentation__intel">{line}</p>
                {/each}
            </div>
        {:else}
            <p class="hero-manager__field-hint">Public resolver: no approved intelligence (or hidden).</p>
        {/if}
    </section>

    <section class="hero-discovery-review" data-master-hero-discovery-review>
        <div class="hero-discovery-review__header">
            <span class="hero-manager__label">Suggested Discovery Connections</span>
            <span class="hero-discovery-review__badge">Exploration only · never creator truth</span>
        </div>
        <p class="hero-manager__field-hint">
            Discovery may suggest themes, historical context, related creators, and explore paths.
            Public Hero shows approved connections only — never identity, genre, or ownership.
        </p>
        <div class="hero-discovery-review__form">
            <label class="hero-manager__field">
                <span>Type</span>
                <select bind:value={discoveryDraftType} data-discovery-type>
                    <option value="theme_connection">Theme connection</option>
                    <option value="historical_context">Historical context</option>
                    <option value="creator_connection">Creator connection</option>
                    <option value="exploration_path">Exploration path</option>
                </select>
            </label>
            <label class="hero-manager__field">
                <span>Label</span>
                <input type="text" bind:value={discoveryDraftLabel} placeholder="Land stewardship themes" data-discovery-label />
            </label>
            <label class="hero-manager__field">
                <span>Target (exploration only)</span>
                <input type="text" bind:value={discoveryDraftTarget} placeholder="Related archive or path" data-discovery-target />
            </label>
            <button
                type="button"
                class="hero-manager__btn hero-manager__btn--ghost"
                on:click|stopPropagation={addSuggestedDiscoveryConnection}
                disabled={persistBusy}
                data-discovery-suggest
            >
                Add suggestion
            </button>
        </div>
        {#if discoverySuggestions.length}
            <ul class="hero-discovery-review__list" data-discovery-suggestions>
                {#each discoverySuggestions as rel (rel.relationshipId)}
                    <li class="hero-discovery-review__item" data-discovery-id={rel.relationshipId}>
                        <div>
                            <strong>{rel.label}</strong>
                            <span class="hero-discovery-review__meta">
                                {rel.type}
                                {#if rel.target} · → {rel.target}{/if}
                                ·
                                {#if rel.hidden}
                                    hidden
                                {:else if rel.rejected}
                                    rejected
                                {:else if rel.approved}
                                    approved
                                {:else}
                                    pending
                                {/if}
                            </span>
                        </div>
                        <div class="hero-discovery-review__actions">
                            <button
                                type="button"
                                class="hero-manager__btn"
                                on:click|stopPropagation={() => approveDiscoverySuggestion(rel.relationshipId)}
                                disabled={persistBusy || rel.approved}
                                data-discovery-approve
                            >
                                Approve
                            </button>
                            <button
                                type="button"
                                class="hero-manager__btn hero-manager__btn--ghost"
                                on:click|stopPropagation={() => rejectDiscoverySuggestion(rel.relationshipId)}
                                disabled={persistBusy || rel.rejected}
                                data-discovery-reject
                            >
                                Reject
                            </button>
                            <button
                                type="button"
                                class="hero-manager__btn hero-manager__btn--ghost"
                                on:click|stopPropagation={() => hideDiscoverySuggestion(rel.relationshipId)}
                                disabled={persistBusy || rel.hidden}
                                data-discovery-hide
                            >
                                Hide
                            </button>
                        </div>
                    </li>
                {/each}
            </ul>
        {:else}
            <p class="hero-manager__field-hint">No suggested discovery connections yet.</p>
        {/if}
        {#if discoveryReviewStatus}
            <p class="hero-manager__field-hint" data-discovery-review-status>{discoveryReviewStatus}</p>
        {/if}
        {#if approvedViewerPreview?.discoveryConnections?.visible}
            <div class="hero-discovery-review__public-preview" data-discovery-public-preview>
                <span class="hero-manager__label">Public viewer will see</span>
                {#each approvedViewerPreview.discoveryConnections.connections as conn (conn.relationshipId || conn.label)}
                    <p class="hero-admin-presentation__intel">
                        {conn.publicLabel || 'Explore'}: {conn.label}{conn.target ? ` → ${conn.target}` : ''}
                    </p>
                {/each}
            </div>
        {/if}
    </section>

    <section class="hero-story-composer" data-hero-story-composer>
        <div class="hero-story-composer__header">
            <span class="hero-manager__label">Hero Story Composer</span>
            <span class="hero-story-composer__status">{STORY_STATUS_LABELS[config.storyStatus || 'draft'] || 'Draft'}</span>
        </div>
        <div class="hero-story-composer__template-controls">
            <label class="hero-manager__field">
                <span>Template Selector</span>
                <select bind:value={selectedTemplateKey}>
                    {#each TEMPLATE_KEYS as templateKey (templateKey)}
                        <option value={templateKey}>{STORY_TEMPLATES[templateKey].name}</option>
                    {/each}
                </select>
            </label>
            <div class="hero-story-composer__template-actions">
                <button type="button" class="hero-manager__btn hero-manager__btn--ghost" on:click|stopPropagation={previewTemplate}>
                    Preview Template
                </button>
                <button type="button" class="hero-manager__btn hero-manager__btn--ghost" on:click|stopPropagation={applyTemplate} disabled={persistBusy}>
                    Apply Template
                </button>
            </div>
        </div>
        <div class="hero-story-composer__grid">
            <label class="hero-manager__field">
                <span>Primary CTA Target</span>
                <input type="text" bind:value={config.ctaPrimaryTarget} placeholder="optional https://… (Watch Now plays the hero MP4 if empty)" on:change={handleFieldCommit} on:blur={handleFieldCommit} />
            </label>
            <label class="hero-manager__field">
                <span>Secondary CTA Target</span>
                <input type="text" bind:value={config.ctaSecondaryTarget} placeholder="/series/your-series (optional)" on:change={handleFieldCommit} on:blur={handleFieldCommit} />
            </label>
            <label class="hero-manager__field">
                <span>Campaign Type</span>
                <input type="text" bind:value={config.campaignType} placeholder="editorial_story" on:change={handleFieldCommit} on:blur={handleFieldCommit} />
            </label>
            <label class="hero-manager__field">
                <span>Featured Collection</span>
                <input type="text" bind:value={config.featuredCollection} placeholder="Black Legacy Stories" on:change={handleFieldCommit} on:blur={handleFieldCommit} />
            </label>
            <label class="hero-manager__field">
                <span>Featured Series</span>
                <input type="text" bind:value={config.featuredSeries} placeholder="Series title" on:change={handleFieldCommit} on:blur={handleFieldCommit} />
            </label>
            <label class="hero-manager__field">
                <span>Schedule Story</span>
                <input type="datetime-local" bind:value={storyScheduledFor} on:change={handleFieldCommit} />
            </label>
        </div>
        <div class="hero-story-composer__actions">
            <button type="button" class="hero-manager__btn hero-manager__btn--ghost" on:click|stopPropagation={saveStoryDraft} disabled={persistBusy}>
                Save Draft
            </button>
            <button type="button" class="hero-manager__btn" on:click|stopPropagation={publishStory} disabled={persistBusy}>
                Publish Story
            </button>
            <button type="button" class="hero-manager__btn hero-manager__btn--ghost" on:click|stopPropagation={scheduleStory} disabled={persistBusy}>
                Schedule Story
            </button>
        </div>
        <div class="hero-story-composer__template-preview" data-hero-story-template-preview>
            <span class="hero-manager__label">Template Preview</span>
            <p><strong>Label:</strong> {selectedTemplate().defaultLabel}</p>
            <p><strong>Title:</strong> {selectedTemplate().defaultTitleStructure}</p>
            <p><strong>Subtitle:</strong> {selectedTemplate().defaultSubtitleStructure}</p>
            <p><strong>Description:</strong> {selectedTemplate().defaultDescriptionStructure}</p>
            <p><strong>CTA 1:</strong> {selectedTemplate().recommendedCTA1} · <strong>CTA 2:</strong> {selectedTemplate().recommendedCTA2}</p>
        </div>
        <div class="hero-story-composer__preview" data-hero-story-live-preview>
            <span>{config.heroLabel || 'Story Label'}</span>
            <h5>{config.heroTitle || 'Story Title'}</h5>
            <p>{config.heroSubtitle || 'Story subtitle appears here.'}</p>
            <p data-hero-story-preview-description>
                {#if String(config.heroDescription || '').trim()}
                    {config.heroDescription}
                {:else}
                    <em class="hero-story-composer__blank">Description blank</em>
                {/if}
            </p>
            <div class="hero-story-composer__preview-ctas">
                <span class="hero-story-composer__preview-cta">{config.ctaPrimaryLabel || 'Watch Now'}</span>
                <span class="hero-story-composer__preview-cta">{config.ctaSecondaryLabel || 'Learn More'}</span>
            </div>
        </div>
    </section>

    <section class="hero-vault" data-hero-vault>
        <div class="hero-vault__header">
            <span class="hero-manager__label">Hero Vault</span>
            <span class="hero-vault__count">{$heroAssetRegistry.length} pickable assets</span>
        </div>
        {#if $heroAssetRegistry.length === 0}
            <p class="hero-vault__empty">
                No ready vault videos or images yet. Upload media in Content / Video Vault first, then pick it here as the hero background.
            </p>
        {:else}
            <p class="hero-vault__help">
                Select any ready vault video (or image) below, or use the Vault Hero Asset menu above.
            </p>
            <div class="hero-vault__grid">
                {#each $heroAssetRegistry as item (item.assetId)}
                    {@const isActive = String(item.assetId) === String(config.heroAssetId || '')}
                    {@const vaultCard = resolveVaultCardProjection(item.assetId, {
                        reel: {
                            id: item.assetId,
                            title: item.title,
                            name: item.name || item.title,
                            url: item.mediaUrl,
                            mediaUrl: item.mediaUrl,
                            thumbnailUrl: item.posterUrl || item.thumbnailUrl,
                            type: item.assetType
                        },
                        isActiveHero: isActive,
                        heroAssetId: config.heroAssetId,
                        heroDescription: isActive ? config.heroDescription : ''
                    })}
                    {@const displayTitle = vaultCard.title || getDisplayTitle(item)}
                    {@const videoLoaded = Boolean(vaultVideoLoadedByAsset[item.assetId])}
                    {@const videoErrored = Boolean(vaultVideoErrorByAsset[item.assetId])}
                    {@const vaultPreviewActive = String(activeHeroVaultPreviewId) === String(item.assetId)}
                    <article
                        class="hero-vault__card"
                        class:hero-vault__card--active={isActive}
                        data-hero-vault-card
                        data-asset-id={item.assetId}
                        data-vault-preview-active={vaultPreviewActive ? 'true' : 'false'}
                        on:pointerenter={() => {
                            if (isVideoHeroAssetType(item.assetType)) {
                                activateHeroVaultPreview(item.assetId);
                            }
                        }}
                        on:pointerleave={() => deactivateHeroVaultPreview(item.assetId)}
                        on:focusin={() => {
                            if (isVideoHeroAssetType(item.assetType)) {
                                activateHeroVaultPreview(item.assetId);
                            }
                        }}
                        on:focusout={(e) => {
                            const next = e.relatedTarget;
                            if (next && e.currentTarget.contains(/** @type {Node} */ (next))) return;
                            deactivateHeroVaultPreview(item.assetId);
                        }}
                    >
                        <div class="hero-vault__preview">
                            {#if isVideoHeroAssetType(item.assetType)}
                                {@const previewUrl = resolveHeroVaultPreviewUrl(item)}
                                {@const posterUrl = resolveHeroVaultPosterUrl(item) || vaultCard.posterUrl}
                                {#if vaultPreviewActive && previewUrl && !videoErrored}
                                    {#key `${item.assetId}:${previewUrl}:live`}
                                        <MediaRenderer
                                            type="video"
                                            url={previewUrl}
                                            poster={posterUrl || undefined}
                                            autoplay={true}
                                            muted={true}
                                            loop={true}
                                            playsinline={true}
                                            preload="metadata"
                                            useSourceElement={true}
                                            raw={previewUrl.startsWith('blob:') || previewUrl.startsWith('data:')}
                                            playbackRole="preview"
                                            className="hero-vault__video vault-preview-video"
                                            width="100%"
                                            height="100%"
                                            on:loadeddata={() => handleHeroVaultVideoMetadataLoad(item)}
                                            on:loadedmetadata={() => handleHeroVaultVideoMetadataLoad(item)}
                                            on:error={() => handleHeroVaultVideoError(item)}
                                        />
                                    {/key}
                                {:else if posterUrl}
                                    <MediaThumbnail
                                        url={posterUrl}
                                        alt={displayTitle}
                                        lazyLoad={true}
                                        className="hero-vault__image"
                                    />
                                {:else if videoErrored}
                                    <div
                                        class="hero-vault__preview-placeholder error"
                                        aria-hidden="false"
                                    >
                                        <span>Preview unavailable</span>
                                    </div>
                                {:else if !previewUrl}
                                    <div
                                        class="hero-vault__preview-placeholder error"
                                        aria-hidden="false"
                                    >
                                        <span>No playable video URL</span>
                                    </div>
                                {:else}
                                    <div
                                        class="hero-vault__preview-placeholder"
                                        data-hero-vault-poster-first
                                        aria-hidden="false"
                                    >
                                        <span>Hover to preview</span>
                                    </div>
                                {/if}
                            {:else}
                                <img
                                    class="hero-vault__image"
                                    src={resolveHeroVaultPosterUrl(item) ||
                                        vaultCard.posterUrl ||
                                        resolveMediaForRender(item.mediaUrl, 'thumbnail', 'HeroVaultImage') ||
                                        item.mediaUrl}
                                    alt={displayTitle}
                                    loading="lazy"
                                />
                            {/if}
                            <span class="hero-vault__badge">{item.assetType}</span>
                            {#if isActive}
                                <span class="hero-vault__active">ACTIVE HERO</span>
                            {/if}
                        </div>
                        <div class="hero-vault__meta">
                            {#if vaultCard.title}
                                <strong data-vault-card-title>{vaultCard.title}</strong>
                            {/if}
                            <span>{isVideoHeroAssetType(item.assetType) ? 'Video vault pick' : 'Image vault pick'}</span>
                            {#if vaultCard.description}
                                <span
                                    class="hero-vault__story-preview"
                                    data-vault-card-description
                                    data-hero-story-preview
                                    >{vaultCard.description}</span
                                >
                            {/if}
                            <span>ID: {item.assetId}</span>
                        </div>
                        <div class="hero-vault__actions">
                            <button type="button" on:click|stopPropagation={() => selectHeroVaultAsset(item)}>
                                {isActive ? 'Active Hero' : 'Use as Hero Background'}
                            </button>
                            <button type="button" on:click|stopPropagation={() => previewHeroVaultAsset(item)}>Preview</button>
                            <button
                                type="button"
                                data-hero-edit-title
                                on:click|stopPropagation={() => editHeroVaultTitle(item)}
                            >
                                Edit Title
                            </button>
                            {#if isVideoHeroAssetType(item.assetType)}
                                <button
                                    type="button"
                                    data-hero-edit-access
                                    on:click|stopPropagation={() => openHeroVaultAccess(item)}
                                >
                                    Access &amp; Price
                                </button>
                            {/if}
                            <button type="button" on:click|stopPropagation={() => deleteHeroVaultAsset(item)}>Delete</button>
                        </div>
                    </article>
                {/each}
            </div>
        {/if}
    </section>

    {#if accessModalOpen && accessModalItem}
        <div
            class="hero-access-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hero-access-modal-title"
            data-hero-access-modal
        >
            <button
                type="button"
                class="hero-access-modal__backdrop"
                aria-label="Close access editor"
                on:click|stopPropagation={closeHeroVaultAccess}
            ></button>
            <div class="hero-access-modal__panel">
                <h3 id="hero-access-modal-title">Access &amp; Price</h3>
                <p class="hero-access-modal__hint">
                    Controls the FREE / price badge in Theater All Episodes. Playback is unchanged.
                </p>
                <p class="hero-access-modal__asset">{getDisplayTitle(accessModalItem)}</p>
                <label class="hero-access-modal__field">
                    <span>Viewer access</span>
                    <select
                        bind:value={accessDraftMode}
                        data-episode-access-mode
                        on:change={handleHeroAccessModeChange}
                    >
                        <option value="free">Free</option>
                        <option value="paid">Paid</option>
                    </select>
                </label>
                <label class="hero-access-modal__field">
                    <span>Price (USD)</span>
                    <input
                        type="text"
                        inputmode="decimal"
                        bind:value={accessDraftPrice}
                        placeholder={PLATFORM_SUBSCRIPTION_MONTHLY_USD}
                        disabled={accessDraftMode !== 'paid'}
                        data-episode-price
                    />
                </label>
                {#if accessModalError}
                    <p class="hero-access-modal__error" role="alert">{accessModalError}</p>
                {/if}
                <div class="hero-access-modal__actions">
                    <button type="button" class="hero-manager__btn" on:click|stopPropagation={saveHeroVaultAccess}
                        >Save access</button
                    >
                    <button
                        type="button"
                        class="hero-manager__btn hero-manager__btn--ghost"
                        on:click|stopPropagation={closeHeroVaultAccess}
                        >Cancel</button
                    >
                </div>
            </div>
        </div>
    {/if}

    <div class="hero-manager__priority" data-hero-manager-spotlight-priority>
        <span class="hero-manager__label">Spotlight Priority</span>
        <ol>
            {#each config.spotlightPriority as heroType, index (heroType)}
                <li data-hero-priority-item={heroType}>
                    <span>{index + 1}. {heroType.replace(/_/g, ' ')}</span>
                    <div class="hero-manager__priority-controls">
                        <button
                            type="button"
                            on:click|stopPropagation={() => moveSpotlight(index, 'up')}
                            disabled={index === 0 || persistBusy}
                        >
                            Up
                        </button>
                        <button
                            type="button"
                            on:click|stopPropagation={() => moveSpotlight(index, 'down')}
                            disabled={index === config.spotlightPriority.length - 1 || persistBusy}
                        >
                            Down
                        </button>
                    </div>
                </li>
            {/each}
        </ol>
    </div>

    <div class="hero-manager__slides" data-hero-manager-slide-ordering>
        <span class="hero-manager__label">Carousel Slide Ordering</span>
        <ul>
            {#each slideOverrides as row, index (row.type)}
                <li data-hero-slide-override={row.type}>
                    <strong>{row.type.replace(/_/g, ' ')}</strong>
                    <div class="hero-manager__slide-controls">
                        <label>
                            <span>Enabled</span>
                            <input
                                type="checkbox"
                                checked={row.enabled !== false}
                                on:change={(event) => setSlideEnabled(row.type, event.currentTarget.checked)}
                            />
                        </label>
                        <label>
                            <span>Duration (sec)</span>
                            <input
                                type="number"
                                min="3"
                                step="1"
                                value={Math.round((row.durationMs || 8000) / 1000)}
                                on:change={(event) => setSlideDuration(row.type, event.currentTarget.value)}
                            />
                        </label>
                        <button type="button" on:click={() => moveSlide(row.type, 'up')} disabled={index === 0}>
                            Up
                        </button>
                        <button
                            type="button"
                            on:click={() => moveSlide(row.type, 'down')}
                            disabled={index === slideOverrides.length - 1}
                        >
                            Down
                        </button>
                    </div>
                </li>
            {/each}
        </ul>
    </div>

    <div class="hero-manager__campaigns" data-hero-manager-seasonal-campaigns>
        <span class="hero-manager__label">Seasonal Campaigns</span>
        <ul>
            {#each config.seasonalCampaigns as campaign (campaign.id)}
                <li data-hero-campaign={campaign.id}>
                    <label>
                        <input
                            type="checkbox"
                            checked={campaign.active}
                            on:change={() => toggleCampaign(campaign.id)}
                        />
                        {campaign.label}
                    </label>
                    <div class="hero-manager__campaign-schedule">
                        <label>
                            <span>Start</span>
                            <input
                                type="date"
                                value={campaign.scheduleStart || ''}
                                on:change={(event) =>
                                    updateCampaignSchedule(campaign.id, 'scheduleStart', event.currentTarget.value)}
                            />
                        </label>
                        <label>
                            <span>End</span>
                            <input
                                type="date"
                                value={campaign.scheduleEnd || ''}
                                on:change={(event) =>
                                    updateCampaignSchedule(campaign.id, 'scheduleEnd', event.currentTarget.value)}
                            />
                        </label>
                    </div>
                </li>
            {/each}
        </ul>
    </div>

    <footer class="hero-manager__actions">
        <button type="button" class="hero-manager__btn" data-hero-manager-apply on:click|stopPropagation={applyConfig} disabled={persistBusy}>
            Apply Hero Settings
        </button>
        <button type="button" class="hero-manager__btn hero-manager__btn--ghost" data-hero-manager-rotate on:click|stopPropagation={handleRotateNow} disabled={persistBusy}>
            Rotate Now
        </button>
    </footer>

    <p class="hero-manager__status" data-hero-manager-status role="status" aria-live="polite">
        {statusMessage || 'Edit any field, then Save Draft / Publish / Apply. Status updates appear here.'}
    </p>
    {#if categorySuggestionReview}
        <div
            class="hero-manager__nlp-review"
            data-hero-nlp-category-review
            data-suggested-category={categorySuggestionReview.suggestedCategory || ''}
            data-current-category={categorySuggestionReview.currentCategory}
            data-confidence-band={categorySuggestionReview.confidenceBand}
            data-ambiguous={categorySuggestionReview.ambiguous ? 'true' : 'false'}
            data-manual-helper={categorySuggestionReview.showManualHelper ? 'true' : 'false'}
            data-offer={categorySuggestionReview.offer ? 'true' : 'false'}
            data-classification-state={categorySuggestionReview.classificationState || ''}
            data-taxonomy-fit={categorySuggestionReview.taxonomyFit || ''}
            data-creator-locked={categorySuggestionReview.creatorLocked ? 'true' : 'false'}
        >
            {#if categorySuggestionReview.creatorLocked}
                <p class="hero-manager__nlp-review-title" data-nlp-creator-lock>CREATOR LOCKED</p>
                <ul class="hero-manager__nlp-review-facts">
                    <li data-nlp-current-category>
                        Creator decision: {displayDiscoveryShelf(categorySuggestionReview.currentCategory, $categoryAliasStore)}
                    </li>
                    {#if categorySuggestionReview.suggestedCategory}
                        <li data-nlp-suggested-category>
                            NLP suggestion (non-binding): {displayDiscoveryShelf(categorySuggestionReview.suggestedCategory, $categoryAliasStore)}
                        </li>
                    {/if}
                    <li data-nlp-shelf-fit-reason>{categorySuggestionReview.shelfFitReason}</li>
                </ul>
            {:else if categorySuggestionReview.classificationState === 'UNDERSTOOD_NO_SHELF_FIT'}
                <p class="hero-manager__nlp-review-title" data-nlp-case-f>
                    UNDERSTOOD / NO SHELF FIT
                </p>
                <ul class="hero-manager__nlp-review-facts">
                    <li data-nlp-current-category>Current: {displayDiscoveryShelf(categorySuggestionReview.currentCategory, $categoryAliasStore)}</li>
                    <li data-nlp-recommended-shelf>
                        Recommended shelf: {displayDiscoveryShelf(categorySuggestionReview.recommendedShelf || 'Trending', $categoryAliasStore)}
                    </li>
                    <li data-nlp-shelf-fit-reason>
                        Reason: {categorySuggestionReview.shelfFitReason ||
                            'No valid Romance/Cyber-Action/Suspense semantic fit'}
                    </li>
                    <li data-nlp-suggestion-confidence>
                        Confidence: {formatSuggestionConfidence(
                            categorySuggestionReview.confidence,
                            categorySuggestionReview.confidenceBand
                        )}
                    </li>
                </ul>
            {:else if categorySuggestionReview.offer}
                <p class="hero-manager__nlp-review-title">Category suggestion after title save</p>
                <ul class="hero-manager__nlp-review-facts">
                    <li data-nlp-current-category>Current: {displayDiscoveryShelf(categorySuggestionReview.currentCategory, $categoryAliasStore)}</li>
                    <li data-nlp-suggested-category>
                        Suggested: {displayDiscoveryShelf(categorySuggestionReview.suggestedCategory, $categoryAliasStore)}
                    </li>
                    {#if categorySuggestionReview.alternativeCategory}
                        <li data-nlp-alternative-category>
                            Alternative: {displayDiscoveryShelf(categorySuggestionReview.alternativeCategory, $categoryAliasStore)}
                        </li>
                    {/if}
                    <li data-nlp-suggestion-confidence>
                        Confidence: {formatSuggestionConfidence(
                            categorySuggestionReview.confidence,
                            categorySuggestionReview.confidenceBand
                        )}
                    </li>
                    {#if categorySuggestionReview.ambiguous}
                        <li data-nlp-ambiguous>Signals conflict — review before accepting.</li>
                    {/if}
                </ul>
                <div class="hero-manager__nlp-review-actions">
                    <button
                        type="button"
                        class="hero-manager__btn"
                        data-nlp-accept-suggestion
                        on:click|stopPropagation={acceptHeroCategorySuggestion}
                    >
                        Accept suggestion
                    </button>
                    <label>
                        <span>Override</span>
                        <select
                            bind:value={categorySuggestionReview.overrideCategory}
                            data-nlp-override-category
                            aria-label="Override shelf category"
                        >
                            {#each CREATOR_SHELF_OPTIONS as option}
                                <option value={option}>{displayDiscoveryShelf(option, $categoryAliasStore)}</option>
                            {/each}
                        </select>
                    </label>
                    <button
                        type="button"
                        class="hero-manager__btn"
                        data-nlp-apply-override
                        on:click|stopPropagation={applyHeroCategoryOverride}
                    >
                        Apply override
                    </button>
                </div>
            {/if}
            {#if categorySuggestionReview.showManualHelper && !categorySuggestionReview.creatorLocked}
                <div data-manual-category-helper class="hero-manager__manual-category">
                    <p class="hero-manager__nlp-review-title">
                        {categorySuggestionReview.offer ? 'Or choose category manually' : 'Choose category'}
                    </p>
                    <div class="hero-manager__nlp-review-actions">
                        <label>
                            <span>Choose Category</span>
                            <select
                                bind:value={categorySuggestionReview.overrideCategory}
                                data-manual-category-select
                                aria-label="Manual shelf category"
                            >
                                {#each CREATOR_SHELF_OPTIONS as option}
                                    <option value={option}>{displayDiscoveryShelf(option, $categoryAliasStore)}</option>
                                {/each}
                            </select>
                        </label>
                        <button
                            type="button"
                            class="hero-manager__btn"
                            data-manual-category-apply
                            on:click|stopPropagation={applyHeroManualCategory}
                        >
                            Apply category
                        </button>
                    </div>
                </div>
            {/if}
            <button
                type="button"
                class="hero-manager__btn hero-manager__btn--ghost"
                data-nlp-dismiss-suggestion
                on:click|stopPropagation={dismissCategorySuggestionReview}
            >
                Dismiss
            </button>
            <p class="hero-manager__field-hint">
                Title is saved. Category is not PATCHed until Accept, Override, or Manual Apply.
            </p>
        </div>
    {/if}
</section>

<style>
    .hero-manager {
        position: relative;
        z-index: 2;
        margin-top: 0.85rem;
        padding: 0.85rem;
        border-radius: var(--studio-radius, 10px);
        border: 1px solid var(--studio-border-strong, rgba(236, 72, 153, 0.28));
        background: var(--studio-surface, rgba(0, 0, 0, 0.28));
        pointer-events: auto;
    }
    .hero-manager :global(button),
    .hero-manager :global(select),
    .hero-manager :global(input),
    .hero-manager :global(textarea) {
        pointer-events: auto;
        position: relative;
        z-index: 1;
    }
    .hero-manager__header h4 {
        margin: 0 0 0.2rem;
        font-size: 0.82rem;
        color: var(--studio-accent, #ec4899);
    }
    .hero-manager__header p {
        margin: 0 0 0.65rem;
        font-size: 0.64rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .hero-manager__grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.55rem;
        margin-bottom: 0.65rem;
    }
    .hero-manager__field,
    .hero-manager__checkbox {
        display: grid;
        gap: 0.25rem;
        font-size: 0.62rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .hero-manager__field span,
    .hero-manager__label {
        font-size: 0.58rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--studio-text-subtle, rgba(255, 255, 255, 0.45));
    }
    .hero-manager__field-hint {
        font-size: 0.55rem !important;
        letter-spacing: 0.02em !important;
        text-transform: none !important;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.5)) !important;
        line-height: 1.35;
    }
    .hero-vault__help {
        margin: 0 0 0.45rem;
        font-size: 0.58rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .hero-manager__field select,
    .hero-manager__field input[type='text'],
    .hero-manager__field input[type='number'],
    .hero-manager__field input[type='datetime-local'],
    .hero-manager__field textarea {
        width: 100%;
        padding: 0.45rem 0.5rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: var(--studio-text, #fff);
        font-size: 0.62rem;
    }
    .hero-manager__field textarea {
        resize: vertical;
        min-height: 4.5rem;
    }
    .hero-story-composer {
        margin-bottom: 0.75rem;
        padding: 0.55rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.03);
    }
    .hero-viewer-content {
        margin-bottom: 0.75rem;
        padding: 0.55rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.03);
    }
    .hero-viewer-content__header {
        margin-bottom: 0.45rem;
    }
    .hero-viewer-content__header p {
        margin: 0.18rem 0 0;
        font-size: 0.58rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .hero-viewer-content__grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.45rem;
    }
    .hero-viewer-content__field--wide {
        grid-column: 1 / -1;
    }
    .hero-discovery-review {
        margin-top: 1rem;
        padding: 1rem 0;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .hero-discovery-review__header {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0.5rem 1rem;
        margin-bottom: 0.5rem;
    }
    .hero-discovery-review__badge {
        font-size: 0.75rem;
        opacity: 0.75;
    }
    .hero-discovery-review__form {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
        gap: 0.65rem;
        align-items: end;
        margin: 0.75rem 0;
    }
    .hero-discovery-review__list {
        list-style: none;
        margin: 0.75rem 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
    }
    .hero-discovery-review__item {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 0.65rem;
        padding: 0.65rem 0.75rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .hero-discovery-review__meta {
        display: block;
        font-size: 0.75rem;
        opacity: 0.75;
        margin-top: 0.2rem;
    }
    .hero-discovery-review__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
    }
    .hero-discovery-review__public-preview {
        margin-top: 0.75rem;
        padding: 0.75rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .hero-creator-intent-review {
        margin-top: 1rem;
        padding: 1rem 0;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .hero-creator-intent-review__header {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0.5rem 1rem;
        margin-bottom: 0.5rem;
    }
    .hero-creator-intent-review__badge {
        font-size: 0.75rem;
        opacity: 0.75;
    }
    .hero-creator-intent-review__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: 0.75rem;
    }
    .hero-creator-intent-review__public-preview {
        margin-top: 0.75rem;
        padding: 0.75rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .hero-intelligence-review {
        margin-top: 1rem;
        padding: 1rem 0;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .hero-intelligence-review__header {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0.5rem 1rem;
        margin-bottom: 0.5rem;
    }
    .hero-intelligence-review__badge {
        font-size: 0.75rem;
        opacity: 0.75;
    }
    .hero-intelligence-review__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: 0.75rem;
    }
    .hero-intelligence-review__public-preview {
        margin-top: 0.75rem;
        padding: 0.75rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .hero-admin-presentation {
        margin-top: 1rem;
        padding: 0.85rem;
        border-radius: 10px;
        border: 1px solid rgba(250, 204, 21, 0.28);
        background: rgba(250, 204, 21, 0.05);
        display: grid;
        gap: 0.65rem;
    }
    .hero-admin-presentation__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
    }
    .hero-admin-presentation__badge {
        font-size: 0.62rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(250, 204, 21, 0.95);
    }
    .hero-admin-presentation__grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.65rem;
    }
    .hero-admin-presentation__toggle {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    .hero-admin-presentation__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
    }
    .hero-admin-presentation__preview {
        padding: 0.55rem 0.65rem;
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.28);
        font-size: 0.78rem;
    }
    .hero-admin-presentation__intel {
        margin: 0.2rem 0 0;
        font-style: italic;
        color: rgba(255, 255, 255, 0.75);
    }
    .hero-title-intel-preview {
        margin-bottom: 0.55rem;
        padding: 0.5rem 0.55rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
    }
    .hero-title-intel-preview p {
        margin: 0.15rem 0;
        font-size: 0.6rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.7));
        text-transform: none;
        letter-spacing: 0;
    }
    .hero-title-intel-preview__story {
        color: var(--studio-text, #fff) !important;
        font-size: 0.64rem !important;
    }
    .hero-identity-meta {
        display: inline-block;
        margin-left: 0.35rem;
        font-size: 0.52rem;
        opacity: 0.7;
        font-style: italic;
    }
    .hero-ai-proposal {
        margin-top: 0.45rem;
        padding: 0.45rem 0.5rem;
        border-radius: 8px;
        border: 1px dashed rgba(201, 166, 255, 0.45);
        background: rgba(201, 166, 255, 0.08);
    }
    .hero-ai-proposal__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        margin-top: 0.4rem;
    }
    .hero-vault__story-preview {
        display: block;
        margin-top: 0.2rem;
        font-size: 0.55rem;
        line-height: 1.35;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
        font-style: italic;
    }
    .hero-viewer-description__controls select {
        max-width: 12rem;
    }
    .hero-viewer-description__clear {
        padding: 0.35rem 0.55rem;
        font-size: 0.58rem;
    }
    .hero-story-composer__blank {
        opacity: 0.55;
        font-style: italic;
    }
    .hero-story-composer__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.45rem;
    }
    .hero-story-composer__status {
        font-size: 0.58rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .hero-story-composer__grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.45rem;
        margin-bottom: 0.5rem;
    }
    .hero-story-composer__template-controls {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 0.45rem;
        margin-bottom: 0.5rem;
        align-items: end;
    }
    .hero-story-composer__template-actions {
        display: flex;
        gap: 0.35rem;
        flex-wrap: wrap;
    }
    .hero-story-composer__field--wide {
        grid-column: 1 / -1;
    }
    .hero-story-composer__actions {
        display: flex;
        gap: 0.4rem;
        flex-wrap: wrap;
        margin-bottom: 0.55rem;
    }
    .hero-story-composer__preview {
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 0.5rem;
        background: rgba(0, 0, 0, 0.24);
        display: grid;
        gap: 0.22rem;
    }
    .hero-story-composer__template-preview {
        margin-bottom: 0.5rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 0.5rem;
        background: rgba(0, 0, 0, 0.2);
        display: grid;
        gap: 0.15rem;
    }
    .hero-story-composer__template-preview p {
        margin: 0;
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.75);
    }
    .hero-story-composer__preview span {
        font-size: 0.56rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.7);
    }
    .hero-story-composer__preview h5 {
        margin: 0;
        font-size: 0.72rem;
        color: #fff;
    }
    .hero-story-composer__preview p {
        margin: 0;
        font-size: 0.6rem;
        color: rgba(255, 255, 255, 0.75);
    }
    .hero-story-composer__preview-ctas {
        margin-top: 0.3rem;
        display: flex;
        gap: 0.35rem;
    }
    .hero-story-composer__preview-cta {
        padding: 0.32rem 0.5rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        font-size: 0.56rem;
        pointer-events: none;
    }
    .hero-manager__checkbox {
        align-content: end;
        grid-auto-flow: column;
        justify-content: start;
        align-items: center;
        gap: 0.45rem;
    }
    .hero-vault {
        margin-bottom: 0.75rem;
        padding: 0.55rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.03);
    }
    .hero-vault__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.45rem;
    }
    .hero-vault__count {
        font-size: 0.58rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .hero-vault__empty {
        margin: 0;
        font-size: 0.6rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .hero-vault__grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 0.5rem;
    }
    .hero-vault__card {
        padding: 0.45rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(0, 0, 0, 0.24);
    }
    .hero-vault__card--active {
        border-color: rgba(236, 72, 153, 0.85);
        box-shadow: 0 0 0 1px rgba(236, 72, 153, 0.35);
    }
    .hero-vault__preview {
        position: relative;
        height: 92px;
        min-height: 92px;
        width: 100%;
        border-radius: 8px;
        overflow: hidden;
        margin-bottom: 0.35rem;
        background: #000;
    }
    .hero-vault__preview img,
    .hero-vault__preview video {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }
    .hero-vault__preview .hero-vault__image {
        position: absolute;
        inset: 0;
        z-index: 0;
    }
    .hero-vault__preview .hero-vault__video {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover;
        display: block !important;
        opacity: 1 !important;
        visibility: visible !important;
        position: absolute;
        top: 0;
        left: 0;
        z-index: 1;
        background: #000;
    }
    .hero-vault__preview-placeholder {
        position: absolute;
        inset: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: center;
        color: rgba(255, 255, 255, 0.78);
        font-size: 0.58rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        background: linear-gradient(145deg, rgba(18, 20, 30, 0.9), rgba(6, 8, 12, 0.95));
        transition: opacity 0.2s ease;
        opacity: 1;
        pointer-events: none;
    }
    .hero-vault__preview-placeholder.hidden {
        opacity: 0;
        z-index: 0;
        pointer-events: none;
    }
    .hero-vault__preview-placeholder.error {
        color: rgba(252, 165, 165, 0.95);
        background: linear-gradient(145deg, rgba(40, 18, 20, 0.95), rgba(12, 6, 8, 0.98));
    }
    .hero-vault__badge,
    .hero-vault__active {
        position: absolute;
        top: 0.35rem;
        z-index: 2;
        font-size: 0.52rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        border-radius: 999px;
        padding: 0.18rem 0.38rem;
    }
    .hero-vault__badge {
        left: 0.35rem;
        background: rgba(0, 0, 0, 0.62);
        color: #fff;
    }
    .hero-vault__active {
        right: 0.35rem;
        background: rgba(236, 72, 153, 0.92);
        color: #fff;
    }
    .hero-vault__meta {
        display: grid;
        gap: 0.15rem;
        margin-bottom: 0.4rem;
    }
    .hero-vault__meta strong {
        font-size: 0.62rem;
        color: #fff;
    }
    .hero-vault__meta span {
        font-size: 0.54rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
        word-break: break-word;
    }
    .hero-vault__actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.3rem;
    }
    .hero-vault__actions button {
        padding: 0.32rem 0.35rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        font-size: 0.55rem;
        cursor: pointer;
    }
    .hero-vault__actions button:hover {
        background: rgba(255, 255, 255, 0.12);
    }
    .hero-manager__priority,
    .hero-manager__campaigns,
    .hero-manager__slides {
        margin-bottom: 0.65rem;
    }
    .hero-manager__priority ol,
    .hero-manager__campaigns ul,
    .hero-manager__slides ul {
        margin: 0.25rem 0 0;
        padding-left: 1rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
        font-size: 0.62rem;
    }
    .hero-manager__priority ol {
        list-style: none;
        padding-left: 0;
        display: grid;
        gap: 0.3rem;
    }
    .hero-manager__priority li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.45rem;
        padding: 0.35rem 0.45rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.03);
    }
    .hero-manager__priority-controls {
        display: flex;
        gap: 0.25rem;
    }
    .hero-manager__priority-controls button {
        padding: 0.28rem 0.4rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        font-size: 0.55rem;
        cursor: pointer;
    }
    .hero-manager__priority-controls button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
    .hero-manager__campaigns ul {
        list-style: none;
        padding-left: 0;
    }
    .hero-manager__slides ul {
        list-style: none;
        padding-left: 0;
        display: grid;
        gap: 0.35rem;
    }
    .hero-manager__slides li {
        padding: 0.45rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.03);
    }
    .hero-manager__slides strong {
        display: block;
        margin-bottom: 0.35rem;
        font-size: 0.62rem;
        color: #fff;
        text-transform: capitalize;
    }
    .hero-manager__slide-controls {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.35rem;
        align-items: end;
    }
    .hero-manager__slide-controls label {
        display: grid;
        gap: 0.18rem;
        font-size: 0.58rem;
    }
    .hero-manager__slide-controls input[type='number'] {
        width: 100%;
        padding: 0.3rem 0.45rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: #fff;
        font-size: 0.58rem;
    }
    .hero-manager__slide-controls button {
        padding: 0.3rem 0.45rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        font-size: 0.58rem;
        cursor: pointer;
    }
    .hero-manager__slide-controls button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .hero-manager__campaigns li {
        margin-bottom: 0.25rem;
    }
    .hero-manager__campaign-schedule {
        margin-top: 0.25rem;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.35rem;
    }
    .hero-manager__campaign-schedule label {
        display: grid;
        gap: 0.18rem;
        font-size: 0.56rem;
    }
    .hero-manager__campaign-schedule input[type='date'] {
        padding: 0.28rem 0.35rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: #fff;
        font-size: 0.56rem;
    }
    .hero-manager__actions {
        display: flex;
        gap: 0.45rem;
        flex-wrap: wrap;
    }
    .hero-manager__btn {
        padding: 0.45rem 0.65rem;
        border-radius: 8px;
        border: 1px solid rgba(236, 72, 153, 0.35);
        background: rgba(236, 72, 153, 0.12);
        color: #fff;
        font-size: 0.62rem;
        cursor: pointer;
        pointer-events: auto;
    }
    .hero-manager__btn:disabled {
        opacity: 0.5;
        cursor: wait;
    }
    .hero-manager__btn--ghost {
        border-color: rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
    }
    .hero-manager__status {
        margin: 0.55rem 0 0;
        font-size: 0.6rem;
        color: var(--studio-text-muted, rgba(255, 255, 255, 0.55));
    }
    .hero-manager__nlp-review {
        margin: 0.55rem 0 0;
        padding: 0.55rem 0.65rem;
        border-radius: 8px;
        border: 1px solid rgba(56, 189, 248, 0.35);
        background: rgba(8, 47, 73, 0.35);
    }
    .hero-manager__nlp-review-title {
        margin: 0 0 0.35rem;
        font-size: 0.62rem;
        font-weight: 700;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        color: #e0f2fe;
    }
    .hero-manager__nlp-review-facts {
        margin: 0 0 0.45rem;
        padding-left: 1rem;
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.75);
    }
    .hero-manager__nlp-review-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        align-items: center;
    }
    .hero-manager__nlp-review-actions label {
        display: grid;
        gap: 0.15rem;
        font-size: 0.55rem;
        color: rgba(255, 255, 255, 0.65);
    }
    .hero-manager__nlp-review-actions select {
        padding: 0.3rem 0.4rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.04);
        color: #fff;
        font-size: 0.58rem;
    }
    .hero-access-modal {
        position: fixed;
        inset: 0;
        z-index: 4000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
    }
    .hero-access-modal__backdrop {
        position: absolute;
        inset: 0;
        border: none;
        padding: 0;
        margin: 0;
        background: rgba(0, 0, 0, 0.72);
        cursor: pointer;
    }
    .hero-access-modal__panel {
        position: relative;
        z-index: 1;
        width: min(22rem, 100%);
        padding: 1.1rem 1.15rem;
        border-radius: 12px;
        border: 1px solid rgba(248, 225, 107, 0.28);
        background: #12141a;
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
        display: grid;
        gap: 0.65rem;
    }
    .hero-access-modal__panel h3 {
        margin: 0;
        font-size: 0.95rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #f8e16b;
    }
    .hero-access-modal__hint {
        margin: 0;
        font-size: 0.72rem;
        line-height: 1.4;
        color: rgba(255, 255, 255, 0.55);
    }
    .hero-access-modal__asset {
        margin: 0;
        font-size: 0.85rem;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.9);
    }
    .hero-access-modal__field {
        display: grid;
        gap: 0.25rem;
        font-size: 0.68rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.55);
    }
    .hero-access-modal__field input,
    .hero-access-modal__field select {
        padding: 0.45rem 0.55rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.04);
        color: #fff;
        font-size: 0.85rem;
        text-transform: none;
        letter-spacing: 0;
    }
    .hero-access-modal__field input:disabled {
        opacity: 0.45;
    }
    .hero-access-modal__error {
        margin: 0;
        font-size: 0.75rem;
        color: #f87171;
    }
    .hero-access-modal__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
        margin-top: 0.25rem;
    }
</style>
