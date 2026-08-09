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
    import {
        approveIdentityProposal,
        getPendingStoryProposal,
        ignoreIdentityProposal
    } from '../../lib/intelligence/contentIdentityGuard.js';
    import { buildHeroAssetRegistry, isVideoHeroAssetType } from '../../lib/hero/heroAssetBridge.js';
    import { deleteReelById, fetchReadyReels } from '../../lib/api/media.js';
    import { getAdminAuthHeaders } from '../../lib/api.js';
    import { applyCanonicalDeleteClientEffects } from '../../lib/deletionSync.js';
    import { vaultForensic } from '../../lib/diagnostics/vaultForensics.js';
    import {
        loadHeroReel,
        saveHeroReel,
        refreshHeroReelLegacyMirror
    } from '../../lib/hero/heroReelIdentity.js';
    import {
        loadHeroRecord,
        setHeroMode,
        updateHeroPresentation,
        projectHeroRecordToManagerPointer,
        mergeHeroRecordIntoManagerConfig,
        projectManagerConfigFromHeroRecord
    } from '../../lib/hero/heroRecord.js';
    import { enrichPresentationConfigFromLocalIdentity } from '../../lib/hero/heroPresentationSync.js';
    import {
        getEpisodeByReelId,
        updateEpisodeTitleForReel
    } from '../../lib/series/seriesStore.js';
    import { bridgeFeedReelsToCatalog } from '../../lib/series/episodeBridge.js';
    import { resolveContentIdentity } from '../../lib/content/contentIdentityResolver.js';
    import { syncHeroIdentityToEpisodeMetadata } from '../../lib/series/heroEpisodeSync.js';

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
                  mergeHeroRecordIntoManagerConfig(loadHeroManagerConfig(), loadHeroRecord())
              )
            : loadHeroManagerConfig();
    let statusMessage = '';
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
        config = /** @type {any} */ (mergeHeroRecordIntoManagerConfig(manager, loadHeroRecord()));
        storyScheduledFor = String(config.storyScheduledFor || storyScheduledFor || '');
        syncDescriptionModeFromConfig();
    }

    /**
     * Push identity/mode + display copy from a manager snapshot into HeroRecord.
     * Manager-only fields are not written here.
     * @param {Record<string, unknown>} snapshot
     * @param {string} reason
     */
    function syncHeroRecordFromManagerSnapshot(snapshot, reason = 'persist') {
        const bg = String(snapshot?.backgroundSource || '').trim();
        let current = loadHeroRecord();
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

        current = loadHeroRecord();
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
        return loadHeroRecord();
    }

    function readPersistentTitleMap() {
        try {
            const raw = JSON.parse(localStorage.getItem(TITLES_KEY()) || '{}');
            return raw && typeof raw === 'object' ? raw : {};
        } catch {
            return {};
        }
    }

    function writePersistentTitle(reelId, title) {
        if (!reelId || !title) return;
        if (persistentTitles?.saveTitle) {
            persistentTitles.saveTitle(reelId, { title, title_original: title });
            return;
        }
        const map = readPersistentTitleMap();
        map[reelId] = {
            title,
            title_original: title,
            savedAt: new Date().toISOString()
        };
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

    function applyTitleToRecord(entry, assetId, title) {
        if (!entry || typeof entry !== 'object') return entry;
        const id = String(entry.id || entry.assetId || entry.personal_video_id || '').trim();
        if (id !== assetId) return entry;
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
            defaultSubtitleStructure: 'A new chapter arrives on ReelForge.',
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
        const reels = await fetchReadyReels(authHeaders()).catch(() => []);
        const byId = reels.find((reel) => String(reel?.id || '').trim() === candidateId);
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
        return extras;
    }

    function refreshHeroAssetRegistry() {
        const vaultItems = loadHeroVaultItems(getLiveVaultExtras());
        const registry = buildHeroAssetRegistry(vaultItems, { storageSource: 'vault_pick' });
        heroAssetRegistry.set(registry);
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
                genre: Array.isArray(resolved.keywords) ? resolved.keywords[0] : '',
                source: resolved.source || source || 'creator'
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

            const publishBody = enrichPresentationConfigFromLocalIdentity({
                ...savedConfig,
                heroAssetId: config.heroAssetId || savedConfig.heroAssetId,
                mediaUrl: config.mediaUrl || managerPatch.mediaUrl || savedConfig.mediaUrl,
                posterUrl: config.posterUrl || managerPatch.posterUrl || savedConfig.posterUrl,
                heroTitle: config.heroTitle || savedConfig.heroTitle,
                heroSubtitle: config.heroSubtitle || savedConfig.heroSubtitle,
                heroDescription: config.heroDescription || savedConfig.heroDescription,
                heroLabel: config.heroLabel || savedConfig.heroLabel,
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
            statusMessage = `Hero background set · viewer title “${truthTitle}” (matches live landscape)`;
            // Awaitable site-wide publish with the saved manager config (keeps mediaUrl).
            confirmServerPresentation('asset_select', saved).then((ok) => {
                if (ok) {
                    statusMessage = `Hero published site-wide · “${truthTitle}” (visible on all devices after refresh)`;
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
            const pointer = projectHeroRecordToManagerPointer(loadHeroRecord());
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
            mediaUrl: String(item?.mediaUrl || ''),
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
        }
        console.info('[HERO_VAULT_VIDEO_ERROR]', {
            assetId,
            assetType: String(item?.assetType || ''),
            mediaUrl: String(item?.mediaUrl || ''),
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
        writePersistentTitle(assetId, durableTitle);

        if (personalVideos && typeof personalVideos.update === 'function') {
            personalVideos.update((videos) => {
                const list = Array.isArray(videos) ? videos : [];
                const next = list.map((entry) => applyTitleToRecord(entry, assetId, durableTitle));
                try {
                    persistPersonalVault(next);
                } catch {
                    /* ignore */
                }
                return next;
            });
        } else {
            patchJsonArrayStorage(VIDEO_VAULT_KEY(), (entry) => applyTitleToRecord(entry, assetId, durableTitle));
        }
        patchJsonArrayStorage(THUMB_VAULT_KEY(), (entry) => applyTitleToRecord(entry, assetId, durableTitle));

        if (feed && typeof feed.update === 'function') {
            feed.update((currentFeed) => {
                if (!currentFeed || typeof currentFeed !== 'object') return currentFeed;
                const next = { ...currentFeed };
                for (const cat of Object.keys(next)) {
                    if (!Array.isArray(next[cat])) continue;
                    next[cat] = next[cat].map((entry) => applyTitleToRecord(entry, assetId, durableTitle));
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
                source: 'creator'
            });
        } catch {
            /* ignore */
        }

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

        try {
            const reelsForBridge = Array.isArray(feedReels) ? feedReels : [];
            const withTitles = reelsForBridge.map((reel) =>
                String(reel?.id || '') === assetId
                    ? { ...reel, title: durableTitle, name: durableTitle, title_original: durableTitle }
                    : reel
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
            statusMessage = `Hero background · “${liveTitle}” · ${intel.category}/${intel.mood} story bound`;
            confirmServerPresentation('vault_card_select', saved).then((ok) => {
                if (ok) {
                    statusMessage = `Hero published site-wide · “${liveTitle}”`;
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
        const reelId = await findMatchingHeroReelId(item);
        if (reelId) {
            try {
                await deleteReelById(reelId, authHeaders());
                persistenceOk = true;
                applyCanonicalDeleteClientEffects(
                    {
                        ctx: {
                            feed,
                            personalVideos,
                            activeReel: writable(null),
                            actions: {
                                persistFeed: (nextFeed) =>
                                    storageSet(CONFIG?.FEED_STORAGE_KEY || 'reelforge_feed', nextFeed),
                                persistVault: persistPersonalVault
                            }
                        }
                    },
                    { reelId }
                );
                await syncFromVault(true);
            } catch (error) {
                console.warn('[HERO_VAULT_DELETE_BACKEND_FAILED]', {
                    itemId: String(item?.assetId || ''),
                    reelId,
                    error: error?.message || String(error),
                    timestamp: Date.now()
                });
            }
        }
        localStorage.removeItem(isVideo ? HERO_VIDEO_STORAGE_KEY : HERO_IMAGE_STORAGE_KEY);
        if (isVideo) {
            localStorage.removeItem(HERO_IMAGE_STORAGE_KEY);
        }
        if (String(config.heroAssetId || '') === String(item.assetId || '')) {
            config = {
                ...config,
                heroAssetId: '',
                backgroundSource: 'selection'
            };
            saveHeroManagerConfig({ heroAssetId: '', backgroundSource: 'selection' });
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
            success: persistenceOk || !reelId,
            reelId,
            timestamp: Date.now()
        });
        console.info('[DELETE_UI_REFRESH]', {
            vault: 'hero-vault',
            newCount: afterCount,
            timestamp: Date.now()
        });
        statusMessage = `Deleted ${displayName}`;
        console.info('[HERO_VAULT_DELETE]', {
            assetId: item.assetId
        });
        console.info('[DELETE_COMPLETE]', {
            itemId: String(item?.assetId || ''),
            mechanism: 'single',
            vault: 'hero-vault',
            timestamp: Date.now()
        });
        vaultForensic(persistenceOk || !reelId ? 'VAULT_DELETE_SUCCESS' : 'VAULT_DELETE_FAIL', {
            vaultType: 'hero',
            assetId: String(item?.assetId || ''),
            fileName: displayName,
            storageLocation: isVideo ? HERO_VIDEO_STORAGE_KEY : HERO_IMAGE_STORAGE_KEY,
            backendEndpoint: `${CONFIG?.API_BASE_URL || ''}/api/reels/${reelId || ''}`,
            result: persistenceOk ? 'delete_success' : reelId ? 'backend_delete_failed' : 'local_only_delete'
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
        window.addEventListener('reelforge:hero-manager-updated', handleManagerUpdate);
        reconcilePendingTitlePatches(authHeaders).catch(() => {});
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
                <input type="text" bind:value={config.heroLabel} placeholder="LOOK@ZAKANDA PRESENTS" on:change={handleFieldCommit} on:blur={handleFieldCommit} />
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
                <input type="text" bind:value={config.ctaPrimaryTarget} placeholder="/watch" on:change={handleFieldCommit} on:blur={handleFieldCommit} />
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
                    {@const displayTitle = getDisplayTitle(item)}
                    {@const storyIntel = getStoryPreviewIntel(item)}
                    {@const videoLoaded = Boolean(vaultVideoLoadedByAsset[item.assetId])}
                    {@const videoErrored = Boolean(vaultVideoErrorByAsset[item.assetId])}
                    <article
                        class="hero-vault__card"
                        class:hero-vault__card--active={isActive}
                        data-hero-vault-card
                        data-asset-id={item.assetId}
                    >
                        <div class="hero-vault__preview">
                            {#if isVideoHeroAssetType(item.assetType)}
                                <div
                                    class="hero-vault__preview-placeholder"
                                    class:hidden={videoLoaded && !videoErrored}
                                    aria-hidden={videoLoaded && !videoErrored}
                                >
                                    <span>Loading video preview...</span>
                                </div>
                                {#key `${item.assetId}:${item.mediaUrl}`}
                                    <video
                                        class="hero-vault__video vault-preview-video"
                                        src={item.mediaUrl}
                                        poster={item.thumbnailUrl || ''}
                                        autoplay
                                        loop
                                        muted
                                        playsinline
                                        preload="metadata"
                                        on:loadedmetadata={() => handleHeroVaultVideoMetadataLoad(item)}
                                        on:error={() => handleHeroVaultVideoError(item)}
                                    ></video>
                                {/key}
                            {:else}
                                <img
                                    class="hero-vault__image"
                                    src={item.thumbnailUrl || item.mediaUrl}
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
                            <strong>{displayTitle}</strong>
                            <span>{isVideoHeroAssetType(item.assetType) ? 'Video vault pick' : 'Image vault pick'}</span>
                            <span class="hero-vault__story-preview" data-hero-story-preview>
                                Suggested: {storyIntel.heroDescription}
                            </span>
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
                            <button type="button" on:click|stopPropagation={() => deleteHeroVaultAsset(item)}>Delete</button>
                        </div>
                    </article>
                {/each}
            </div>
        {/if}
    </section>

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
    }
    .hero-vault__preview-placeholder {
        position: absolute;
        inset: 0;
        z-index: 0;
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
    }
    .hero-vault__preview-placeholder.hidden {
        opacity: 0;
        pointer-events: none;
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
</style>
