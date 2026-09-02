<script context="module">
    import { writable, get } from 'svelte/store';
    import {
        episodeNavigationFlags,
        initPublishingProfile,
        syncReelshortActiveStore,
        theaterChromeFlags
    } from '../../lib/publishing/publishingProfileStore.js';
    import { logTheaterOpen } from '../../lib/theater/theaterDiagnostics.js';
    import { navigateToNextEpisode } from '../../lib/series/episodeNavigation.js';

    export { episodeNavigationFlags, theaterChromeFlags };

    export const reelshortActive = writable(false);
    export const feedCardProgress = writable({});
    export const feedActiveCardId = writable(null);
    export const theaterTimelinePct = writable(0);
    export const theaterCountdown = writable(0);

    let theaterCountdownTimer = null;
    let watchOnCompleteFn = () => {};
    let getTheaterVideoFn = () => null;

    /** @param {{ watchOnComplete?: (video: HTMLVideoElement) => void; getTheaterVideo?: () => HTMLVideoElement | null }} deps */
    export function configureReelshortExperience(deps = {}) {
        if (deps.watchOnComplete) watchOnCompleteFn = deps.watchOnComplete;
        if (deps.getTheaterVideo) getTheaterVideoFn = deps.getTheaterVideo;
    }

    let reelshortSyncUnsub = null;

    /** @param {{ setTimeout: (fn: () => void, ms: number) => number }} resourceManager @param {() => void} [onWatchContinue] */
    export function initReelshortProfile(resourceManager, onWatchContinue) {
        initPublishingProfile();
        if (!reelshortSyncUnsub) {
            reelshortSyncUnsub = syncReelshortActiveStore(reelshortActive);
        }
        onWatchContinue?.();
    }

    /** @param {HTMLElement} card */
    export function handleFeedCardActive(card) {
        const video = card.querySelector('video');
        if (!video) return;
        const reelId = card.dataset.reelId;
        feedActiveCardId.set(reelId);
        video.play().catch(() => {});
        const onTimeUpdate = () => {
            if (video.duration && Number.isFinite(video.duration)) {
                const pct = (video.currentTime / video.duration) * 100;
                feedCardProgress.update((m) => ({ ...m, [reelId]: pct }));
            }
        };
        video._feedTimeUpdate = onTimeUpdate;
        video.addEventListener('timeupdate', onTimeUpdate);
    }

    /** @param {HTMLElement} card */
    export function handleFeedCardInactive(card) {
        const video = card.querySelector('video');
        if (!video) return;
        video.pause();
        video.currentTime = 0;
        if (video._feedTimeUpdate) {
            video.removeEventListener('timeupdate', video._feedTimeUpdate);
            delete video._feedTimeUpdate;
        }
        const reelId = card.dataset.reelId;
        if (reelId === get(feedActiveCardId)) feedActiveCardId.set(null);
        feedCardProgress.update((m) => {
            const next = { ...m };
            delete next[reelId];
            return next;
        });
    }

    export function clearTheaterCountdown() {
        if (theaterCountdownTimer) {
            clearInterval(theaterCountdownTimer);
            theaterCountdownTimer = null;
        }
        theaterCountdown.set(0);
    }

    /** @deprecated Use navigateToNextEpisode — kept for module export compatibility. */
    export function triggerNextEpisodePlaceholder() {
        navigateToNextEpisode();
    }

    /** @param {Event} [e] */
    export function handleReelshortTheaterEnd(e) {
        if (!get(episodeNavigationFlags).showCountdown) return;
        const video = e?.currentTarget || getTheaterVideoFn();
        if (video) watchOnCompleteFn(video);
        clearTheaterCountdown();
        theaterCountdown.set(3);
        theaterCountdownTimer = setInterval(() => {
            theaterCountdown.update((n) => n - 1);
            if (get(theaterCountdown) <= 0) {
                clearTheaterCountdown();
                navigateToNextEpisode();
            }
        }, 1000);
    }

    /** @param {Event} e */
    export function handleTheaterTimeupdate(e) {
        if (!get(theaterChromeFlags).verticalTimeline) return;
        const v = e.currentTarget;
        if (v?.duration && Number.isFinite(v.duration)) {
            theaterTimelinePct.set((v.currentTime / v.duration) * 100);
        }
    }

    export function resetTheaterTimeline() {
        theaterTimelinePct.set(0);
    }
</script>

<script>
    import { afterUpdate, onMount } from 'svelte';
    import MediaRenderer from '../media/MediaRenderer.svelte';
    import MediaThumbnail from '../media/MediaThumbnail.svelte';
    import MediaPoster from '../media/MediaPoster.svelte';
    import { prefersHoverPreview } from '../../lib/vertical/feedCardAutoplay.js';
    import {
        claimPlaybackOwner,
        releasePlaybackOwner,
        canStartPlayback,
        getPlaybackOwner
    } from '../../lib/media/playbackOwnership.js';
    import { logBg7kCardRender, logBg7kPlaceholderFallback } from '../../lib/diagnostics/bg7kCardRenderTrace.js';
    import {
        logBg7nStage,
        logBg7nDomStage,
        noteBg7nMediaRendererCard,
        flushBg7nMediaRendererStage,
        resetBg7nMediaRendererCards
    } from '../../lib/diagnostics/bg7nPipelineTrace.js';
    import { logBg7pShelfDistribution } from '../../lib/diagnostics/bg7pShelfDistribution.js';
    import { resolveDurableViewerPoster } from '../../lib/viewer/vaultUtils.js';
    import { resolveVaultCardProjection } from '../../lib/content/vaultCardProjection.js';
    import { logMobilePlayTrace } from '../../lib/device/mobileExperienceDiagnostics.js';
    import { detectMobilePresentation } from '../../lib/device/mobilePresentation.js';
    import ViewerSemanticCard from '../viewer/ViewerSemanticCard.svelte';
    import {
        buildViewerSemanticShell,
        collectIdentityDedupedFeedMap,
        collectRealViewerReels
    } from '../../lib/feed/viewerSemanticShell.js';
    import { composeViewerShelfLayouts } from '../../lib/feed/viewerShelfComposition.js';
    import { categoryAliasStore, listViewerPrimaryRailTabs } from '../../lib/feed/discoveryTaxonomy.js';
    import { resolveViewerAssetId } from '../../lib/feed/viewerIdentityDedupe.js';
    import { logViewerMediaIdentityDiagnostics } from '../../lib/feed/viewerMediaIdentity.js';
    import { seriesCatalog } from '../../lib/series/seriesStore.js';
    import { getReadyHeroVaultAssets } from '../../lib/series/heroVaultAssetSource.js';
    import { buildViewerSeriesBrowseCatalog } from '../../lib/series/viewerSeriesBrowseCatalog.js';
    import { listContinueWatching, formatRemainingLabel } from '../../lib/series/seriesWatchProgress.js';
    import SeriesBrowsePosterCard from '../series/SeriesBrowsePosterCard.svelte';
    import ContinueWatchingBadge from '../series/ContinueWatchingBadge.svelte';
    import '../../viewer/cinematicCardTokens.css';

    /** @type {'feed' | 'theater-ambient' | 'theater-chrome'} */
    export let section = 'feed';

    /** @type {import('svelte/store').Writable<Record<string, unknown[]>>} */
    export let feed;
    /** @type {import('svelte/store').Readable<Record<string, unknown[]>>} */
    export let normalizedFeed;
    /** @type {import('svelte/store').Writable<boolean>} */
    export let adminMode;
    /** @type {import('svelte/store').Writable<Set<string>>} */
    export let feedCardVideoFallbacks;
    /** @type {import('svelte/store').Writable<Record<string, string>>} */
    export let feedCardImageFallbacks;
    /** @type {Record<string, unknown>} */
    export let UIAgent = {};
    /** @type {{ getName: (name: string) => string }} */
    export let categoryNames = { getName: (n) => n };

    /** @type {(reel: unknown) => boolean} */
    export let hasPlayableVideo = () => false;
    /** @type {(reel: unknown, category: string, i: number) => string} */
    export let getImg = () => '';
    /** @type {(reel: unknown) => void} */
    export let onOpenTheater = () => {};
    /** @type {(reelId: string) => void} */
    export let onRecordAccess = () => {};
    /** @type {(event: Event, reel: unknown) => void} */
    export let onCardVideoError = () => {};
    /** @type {(img: HTMLImageElement, reel: unknown, category: string, i: number) => void} */
    export let onImageError = () => {};
    /** @type {(img: HTMLImageElement, src: string) => void} */
    export let logVaultImageError = () => {};

    /** Theater ambient — active reel + playback */
    export let theaterVideoSrc = '';
    /** @type {unknown} */
    export let activeReel = null;
    /** @type {{ poster?: string } | null} */
    export let theaterPlayback = null;

    /** @type {HTMLElement | null} */
    let feedSectionRoot = null;
    /** Primary rail: home | new-releases | trending | suspense — chrome only; cards unchanged. */
    let activeViewerRailKey = 'home';
    let discoverySearchOpen = false;
    let discoverySearchQuery = '';

    $: viewerRailTabs = listViewerPrimaryRailTabs($categoryAliasStore);

    /**
     * @param {string} key
     */
    function selectViewerRailTab(key) {
        activeViewerRailKey = String(key || 'home');
        discoverySearchOpen = false;
    }

    function toggleDiscoverySearch() {
        discoverySearchOpen = !discoverySearchOpen;
        if (!discoverySearchOpen) discoverySearchQuery = '';
    }

    /**
     * @param {{ title?: string }} item
     */
    function matchesProductionSearch(item) {
        const q = String(discoverySearchQuery || '')
            .trim()
            .toLowerCase();
        if (!q) return true;
        return String(item?.title || '')
            .toLowerCase()
            .includes(q);
    }

    $: if (section === 'feed') {
        logBg7nStage('ReelshortExperience:props:feed', $feed);
        logBg7nStage('ReelshortExperience:props:normalizedFeed', $normalizedFeed);
        logBg7pShelfDistribution('ReelshortExperience:shelfRender', $feed);
    }

    afterUpdate(() => {
        if (section !== 'feed') return;
        flushBg7nMediaRendererStage();
        logBg7nDomStage(feedSectionRoot);
        resetBg7nMediaRendererCards();
        const productionDomCards =
            feedSectionRoot?.querySelectorAll('[data-series-id]').length || 0;
        console.info('[VIEWER_PRODUCTION_LIBRARY_DOM]', {
            stage: 'ReelshortExperience:dom',
            productionDomCards,
            rail: activeViewerRailKey,
            timestamp: new Date().toISOString()
        });
    });

    /** Real feed cards → sorted real-only → presentation padding (BG-7S). */

    /** @type {string} */
    let feedHoverPreviewId = '';

    /**
     * @param {string} reelId
     */
    function startFeedCardPreview(reelId) {
        if (!prefersHoverPreview()) return;
        const id = String(reelId || '').trim();
        if (!id) return;
        if (getPlaybackOwner() === 'theater') return;
        if (!canStartPlayback('preview') && getPlaybackOwner() !== 'preview') return;
        feedHoverPreviewId = id;
        claimPlaybackOwner('preview', `feed-card:${id}`);
    }

    /**
     * @param {string} reelId
     */
    function stopFeedCardPreview(reelId) {
        const id = String(reelId || '').trim();
        if (id && feedHoverPreviewId && id !== feedHoverPreviewId) return;
        feedHoverPreviewId = '';
        if (getPlaybackOwner() === 'preview') {
            releasePlaybackOwner('preview', 'feed-card-leave');
            claimPlaybackOwner('hero', 'feed-return');
        }
    }
    /**
     * @param {Record<string, unknown>} reel
     * @param {string} category
     */
    function resolveCardMedia(reel, category) {
        const id = resolveViewerAssetId(reel);
        const fromMap = id ? identityResolvedById.get(id) : null;
        if (fromMap && !(hasPlayableVideo(reel) && fromMap.mediaSource === 'image')) {
            const poster =
                String(fromMap.poster || '').trim() || resolveDurableViewerPoster(reel, reel) || '';
            return poster && poster !== fromMap.poster ? { ...fromMap, poster } : fromMap;
        }
        const projection = resolveVaultCardProjection(String(reel?.id || ''), { reel });
        return {
            mediaSource: hasPlayableVideo(reel) ? 'video' : 'image',
            poster:
                projection.posterUrl ||
                reel.thumbnailUrl ||
                resolveDurableViewerPoster(reel, reel) ||
                '',
            title: projection.title || reel.title || reel.name || '',
            shelf: category,
            themes: [],
            metadata: { invented: false }
        };
    }

    /**
     * Real still first; never wait on random/personal thumbs after Processing.
     * @param {Record<string, unknown>} reel
     * @param {Record<string, unknown> | null | undefined} resolved
     * @param {Record<string, unknown> | null | undefined} projection
     * @param {string} category
     * @param {number} [index]
     */
    function resolveShelfPoster(reel, resolved, projection, category, index = 0) {
        return (
            String(resolved?.poster || '').trim() ||
            String(projection?.posterUrl || '').trim() ||
            String(reel?.thumbnailUrl || '').trim() ||
            resolveDurableViewerPoster(reel, reel) ||
            getImg(reel, category, index) ||
            ''
        );
    }

    /** Phase 6.4/6.5 — identity-first card resolution (video canonical; thumb → poster). */
    /** Phase 6.6 — Featured promo remount OK; Browse = residual identities only. */
    /** @type {Record<string, unknown[]>} */
    let identityFeedMap = {};
    /** @type {Map<string, Record<string, unknown>>} */
    let identityResolvedById = new Map();
    $: identityDedupe = collectIdentityDedupedFeedMap($normalizedFeed || $feed || {});
    $: identityFeedMap = identityDedupe.feedMap;
    $: identityResolvedById = identityDedupe.resolvedById;
    $: realViewerItems = collectRealViewerReels($normalizedFeed || $feed || {});
    $: shelfComposition = composeViewerShelfLayouts($normalizedFeed || $feed || {}, {
        uniqueItems: realViewerItems,
        identityFeedMap
    });
    $: featuredItem = shelfComposition.featuredItem || null;
    $: readyBrowseAssets = getReadyHeroVaultAssets();
    $: productionBrowseCatalog = buildViewerSeriesBrowseCatalog($seriesCatalog, {
        readyVaultAssets: readyBrowseAssets,
        sectionLimit: 12
    });
    $: originalProductions = productionBrowseCatalog.sections.original;
    $: trendingProductions = productionBrowseCatalog.sections.trending;
    $: newProductions = productionBrowseCatalog.sections.newest;
    $: hasSeriesRail = activeViewerRailKey === 'new-releases' || activeViewerRailKey === 'trending' || activeViewerRailKey === 'suspense';
    $: activeProductionSections =
        activeViewerRailKey === 'home'
            ? [
                { key: 'original', title: 'Original Productions', items: originalProductions },
                { key: 'trending', title: 'Trending Productions', items: trendingProductions },
                { key: 'new', title: 'New Productions', items: newProductions }
            ].filter((section) => section.items.filter((item) => matchesProductionSearch(item)).length > 0)
            : activeViewerRailKey === 'trending'
              ? [{ key: 'trending', title: 'Trending Productions', items: trendingProductions }].filter(
                    (section) => section.items.filter((item) => matchesProductionSearch(item)).length > 0
                )
              : activeViewerRailKey === 'new-releases'
                ? [{ key: 'new', title: 'New Productions', items: newProductions }].filter(
                      (section) => section.items.filter((item) => matchesProductionSearch(item)).length > 0
                  )
                : [];

    let continueWatchingRefreshTick = 0;
    onMount(() => {
        if (typeof window === 'undefined') return;
        const refresh = () => {
            continueWatchingRefreshTick += 1;
        };
        window.addEventListener('reelforge:sync-schedule', refresh);
        window.addEventListener('storage', refresh);
        return () => {
            window.removeEventListener('reelforge:sync-schedule', refresh);
            window.removeEventListener('storage', refresh);
        };
    });

    $: continueWatchingRefreshTick;
    $: viewerFeedRows = Object.values($normalizedFeed || $feed || {})
        .flat()
        .filter((row) => row && typeof row === 'object' && !row.isPlaceholder && !row.isPresentationOnly);
    $: viewerFeedReelById = new Map(
        viewerFeedRows.map((reel) => [String(reel?.id || ''), reel]).filter(([id]) => id)
    );
    $: continueWatchingRows = listContinueWatching({ limit: 8 })
        .map((row) => {
            const reel = viewerFeedReelById.get(String(row.reelId || ''));
            if (!reel || !reel.url) return null;
            const projection = resolveVaultCardProjection(String(reel.id || ''), { reel });
            const title = String(projection.title || reel.title || reel.name || row.reelId || 'Episode').trim();
            return {
                row,
                reel,
                title,
                poster: resolveShelfPoster(reel, null, projection, 'Continue Watching', 0)
            };
        })
        .filter(Boolean);

    $: if (section === 'feed') {
        const flat = Object.values($normalizedFeed || $feed || {})
            .flat()
            .filter((r) => r && !r.isPresentationOnly && !r.isPlaceholder);
        logViewerMediaIdentityDiagnostics(
            /** @type {Record<string, unknown>[]} */ (flat),
            'ReelshortExperience:feed'
        );
        if (import.meta.env.DEV) {
            console.info('[VIEWER_SHELF_COMPOSITION]', shelfComposition.diagnostics);
        }
    }

    function activateReel(reel, category) {
        const assetId = String(reel?.id || '').trim();
        const mediaUrl = String(
            reel?.url || reel?.playbackUrl || reel?.mediaUrl || reel?.videoUrl || ''
        ).trim();
        // Log before diagnostics — logTheaterOpen used to throw on iOS LAN HTTP (randomUUID).
        logMobilePlayTrace('ACTIVATE_REEL', {
            assetId,
            title: String(reel?.title || reel?.name || '').trim(),
            mediaUrl,
            resolver: 'ReelshortExperience.activateReel',
            source: 'feed-card-click',
            category: String(category || ''),
            playCalled: false
        });
        try {
            logTheaterOpen(reel, { source: 'feed-card-click', category });
        } catch (err) {
            const message =
                err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
            logMobilePlayTrace('HANDOFF_ERROR', {
                assetId,
                resolver: 'logTheaterOpen',
                source: 'feed-card-click',
                reason: message.slice(0, 180),
                playCalled: false
            });
        }
        try {
            onRecordAccess(reel.id);
        } catch {
            /* access analytics must not block Theater */
        }
        onOpenTheater(reel);
        logMobilePlayTrace('HANDOFF_ON_OPEN_THEATER', {
            assetId,
            title: String(reel?.title || reel?.name || '').trim(),
            mediaUrl,
            resolver: 'ReelshortExperience.onOpenTheater',
            source: 'feed-card-click',
            category: String(category || '')
        });
    }

    function traceFeedCardRender(reel, category, branch, mediaSrc) {
        noteBg7nMediaRendererCard(reel?.id);
        if (reel?.isPlaceholder) {
            logBg7kPlaceholderFallback(String(reel?.id || ''), 'ghost_placeholder_card', {
                category,
                branch
            });
        }
        if (branch === 'empty') {
            logBg7kPlaceholderFallback(String(reel?.id || ''), 'no_media_url', { category });
        }
        logBg7kCardRender(String(reel?.id || ''), mediaSrc || '', {
            category,
            branch,
            isPlaceholder: Boolean(reel?.isPlaceholder)
        });
        return '';
    }

</script>

{#if section === 'feed'}
    <div class="reelshort-feed-root" bind:this={feedSectionRoot} data-viewer-cinematic-feed>
    {#if featuredItem}
        {@const featuredReel = featuredItem.reel}
        {@const featuredCategory = featuredItem.shelf}
        {@const featuredResolved = featuredItem.resolvedMedia || resolveCardMedia(
            /** @type {Record<string, unknown>} */ (featuredReel),
            featuredCategory
        )}
        {@const featuredProjection = resolveVaultCardProjection(String(featuredReel?.id || ''), {
            reel: /** @type {Record<string, unknown>} */ (featuredReel)
        })}
        {@const featuredShell = buildViewerSemanticShell(
            /** @type {Record<string, unknown>} */ (featuredReel),
            {
                title: featuredProjection.title,
                category: featuredCategory,
                posterUrl: featuredResolved.poster || featuredProjection.posterUrl,
                description: featuredProjection.description,
                seriesLine: featuredProjection.seriesLine,
                seasonNumber: /** @type {any} */ (featuredReel)?.seasonNumber,
                episodeNumber: /** @type {any} */ (featuredReel)?.episodeNumber,
                seriesLabel:
                    /** @type {any} */ (featuredReel)?.seriesLabel ||
                    /** @type {any} */ (featuredReel)?.seriesName ||
                    /** @type {any} */ (featuredReel)?.seriesTitle
            },
            featuredResolved
        )}
        <section class="viewer-featured" data-viewer-featured-card aria-label="Featured">
            <h2 class="viewer-featured__heading">Featured</h2>
            <ViewerSemanticCard
                reel={/** @type {Record<string, unknown>} */ (featuredReel)}
                projection={featuredProjection}
                shell={featuredShell}
                resolvedMedia={featuredResolved}
                variant="featured"
                previewActive={String(feedHoverPreviewId) === String(featuredReel.id)}
                onActivate={(r) => activateReel(r, featuredCategory)}
                onMediaPointerEnter={() => {
                    if (detectMobilePresentation() || !prefersHoverPreview()) return;
                    if (hasPlayableVideo(featuredReel) && featuredReel.url && !$feedCardVideoFallbacks.has(featuredReel.id)) {
                        startFeedCardPreview(featuredReel.id);
                    }
                }}
                onMediaPointerLeave={() => stopFeedCardPreview(featuredReel.id)}
            >
                <svelte:fragment slot="media">
                    {#if hasPlayableVideo(featuredReel) && featuredReel.url}
                        {#if $feedCardVideoFallbacks.has(featuredReel.id)}
                            {traceFeedCardRender(featuredReel, featuredCategory, 'video_fallback_thumbnail', resolveShelfPoster(featuredReel, featuredResolved, featuredProjection, featuredCategory, 0))}
                            <MediaThumbnail
                                url={resolveShelfPoster(featuredReel, featuredResolved, featuredProjection, featuredCategory, 0)}
                                alt={featuredProjection.title || 'Video'}
                                lazyLoad={false}
                                className="card-visual card-video-fallback"
                            />
                        {:else if prefersHoverPreview() && String(feedHoverPreviewId) === String(featuredReel.id)}
                            {traceFeedCardRender(featuredReel, featuredCategory, 'video', featuredReel.url)}
                            <MediaRenderer
                                type="video"
                                url={featuredReel.url}
                                poster={resolveShelfPoster(featuredReel, featuredResolved, featuredProjection, featuredCategory, 0)}
                                validateVideo={true}
                                useSourceElement={true}
                                captionsTrack={true}
                                muted
                                playsinline
                                loop
                                autoplay={true}
                                preload="metadata"
                                playbackRole="preview"
                                className="card-visual"
                                on:error={(e) => onCardVideoError(e, featuredReel)}
                            />
                        {:else}
                            {traceFeedCardRender(featuredReel, featuredCategory, 'video_poster', resolveShelfPoster(featuredReel, featuredResolved, featuredProjection, featuredCategory, 0))}
                            <MediaThumbnail
                                url={resolveShelfPoster(featuredReel, featuredResolved, featuredProjection, featuredCategory, 0)}
                                alt={featuredProjection.title || 'Video'}
                                lazyLoad={false}
                                className="card-visual card-video-poster"
                            />
                        {/if}
                    {:else if featuredReel.url}
                        <MediaThumbnail
                            url={$feedCardImageFallbacks[featuredReel.id] || resolveShelfPoster(featuredReel, featuredResolved, featuredProjection, featuredCategory, 0) || featuredReel.url}
                            alt={featuredProjection.title || 'Image'}
                            lazyLoad={false}
                            className="card-visual"
                            raw={Boolean($feedCardImageFallbacks[featuredReel.id])}
                        />
                    {:else}
                        <div class="vault-card-empty" aria-label="Media unavailable">⚠️</div>
                    {/if}
                </svelte:fragment>
            </ViewerSemanticCard>
        </section>
    {/if}

    <nav class="viewer-discovery-rail" data-viewer-discovery-rail aria-label="Discovery shelves">
        <div class="viewer-discovery-rail__tabs" role="tablist">
            {#each viewerRailTabs as tab (tab.key)}
                <button
                    type="button"
                    role="tab"
                    class="viewer-discovery-rail__tab"
                    class:is-active={activeViewerRailKey === tab.key}
                    aria-selected={activeViewerRailKey === tab.key}
                    data-rail-key={tab.key}
                    data-rail-shelf={tab.shelfId || 'home'}
                    on:click={() => selectViewerRailTab(tab.key)}
                >{tab.label}</button>
            {/each}
        </div>
        <button
            type="button"
            class="viewer-discovery-rail__search"
            aria-label={discoverySearchOpen ? 'Close search' : 'Search catalog'}
            aria-pressed={discoverySearchOpen}
            on:click={toggleDiscoverySearch}
        >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" stroke-linecap="round" />
            </svg>
        </button>
    </nav>
    {#if discoverySearchOpen}
        <div class="viewer-discovery-search">
            <label class="viewer-discovery-search__label" for="viewer-discovery-search-input">Search</label>
            <input
                id="viewer-discovery-search-input"
                class="viewer-discovery-search__input"
                type="search"
                placeholder="Search titles…"
                bind:value={discoverySearchQuery}
                autocomplete="off"
            />
        </div>
    {/if}

    <section class="viewer-production-library" aria-label="Production library">
        {#if activeProductionSections.length === 0}
            {#if hasSeriesRail}
                <p class="viewer-production-library__empty" data-series-rail-empty>
                    No productions available in this rail yet.
                </p>
            {/if}
        {:else}
            {#each activeProductionSections as sectionData (sectionData.key)}
                <div class="viewer-production-library__section" data-series-rail={sectionData.key}>
                    <h2 class="viewer-production-library__heading">{sectionData.title}</h2>
                    <div class="viewer-production-library__grid" data-viewer-browse-grid>
                        {#each sectionData.items.filter((item) => matchesProductionSearch(item)) as item (item.seriesId)}
                            <SeriesBrowsePosterCard {item} sectionLabel={sectionData.key} />
                        {/each}
                    </div>
                </div>
            {/each}
        {/if}
    </section>

    {#if activeViewerRailKey === 'home' && continueWatchingRows.length > 0}
        <section class="viewer-continue" aria-label="Continue watching" data-viewer-continue-watching>
            <h2 class="viewer-continue__heading">Continue Watching</h2>
            <div class="viewer-continue__row">
                {#each continueWatchingRows as item (item.row.reelId)}
                    <button
                        type="button"
                        class="viewer-continue__card"
                        data-continue-reel-id={item.row.reelId}
                        on:click={() => activateReel(item.reel, 'Continue Watching')}
                    >
                        <div class="viewer-continue__poster-wrap">
                            <MediaThumbnail
                                url={item.poster}
                                alt=""
                                lazyLoad
                                className="viewer-continue__poster"
                            />
                        </div>
                        <div class="viewer-continue__copy">
                            <h3 class="viewer-continue__title">{item.title}</h3>
                            <p class="viewer-continue__meta">{formatRemainingLabel(item.row.position, item.row.duration)}</p>
                            <ContinueWatchingBadge percent={item.row.percent} />
                        </div>
                    </button>
                {/each}
            </div>
        </section>
    {/if}
    </div>
{:else if section === 'theater-ambient' && $theaterChromeFlags.ambientBlur && theaterVideoSrc}
    <MediaPoster
        url={activeReel?.thumbnailUrl || theaterPlayback?.poster || ''}
        className="theater-ambient-bg"
        aria-hidden="true"
    />
{:else if section === 'theater-chrome' && ($theaterChromeFlags.progressRing || $theaterChromeFlags.verticalTimeline || $episodeNavigationFlags.showCountdown)}
    {#if $theaterChromeFlags.progressRing}
        <svg class="theater-progress-ring" viewBox="0 0 36 36" aria-hidden="true">
            <circle class="ring-bg" cx="18" cy="18" r="15.5" />
            <circle class="ring-fill" cx="18" cy="18" r="15.5" pathLength="100" style="stroke-dashoffset: {100 - $theaterTimelinePct}" />
        </svg>
    {/if}
    {#if $theaterChromeFlags.verticalTimeline}
        <div class="vertical-timeline" aria-hidden="true">
            <div class="vertical-timeline-track">
                <div class="vertical-timeline-progress" style="width: {$theaterTimelinePct}%"></div>
                <span class="chapter-dot" style="left: 25%"></span>
                <span class="chapter-dot" style="left: 50%"></span>
                <span class="chapter-dot" style="left: 75%"></span>
            </div>
        </div>
    {/if}
    {#if $episodeNavigationFlags.showCountdown && $theaterCountdown > 0}
        <div class="next-episode-countdown" role="status">Next in {$theaterCountdown}...</div>
    {/if}
{/if}

<style>
    .shelf {
        margin-bottom: 3rem;
        padding: 0 2rem;
    }
    .viewer-featured {
        padding: 1.25rem 2rem 0.5rem;
        margin-bottom: 1.5rem;
    }
    .viewer-discovery-rail {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.35rem 1.25rem 0.65rem;
        margin: 0 0 0.35rem;
        position: sticky;
        top: 0;
        z-index: 8;
        background: linear-gradient(180deg, rgba(5, 6, 10, 0.96) 0%, rgba(5, 6, 10, 0.88) 70%, rgba(5, 6, 10, 0) 100%);
        /* Sticky chrome must not steal taps from cards underneath the fade zone. */
        pointer-events: none;
    }
    .viewer-discovery-rail__tabs,
    .viewer-discovery-rail__search {
        pointer-events: auto;
    }
    .viewer-discovery-rail__tabs {
        display: flex;
        align-items: center;
        gap: 1.15rem;
        flex: 1;
        min-width: 0;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
    }
    .viewer-discovery-rail__tabs::-webkit-scrollbar {
        display: none;
    }
    .viewer-discovery-rail__tab {
        flex-shrink: 0;
        border: 0;
        background: transparent;
        color: rgba(244, 241, 234, 0.55);
        font-size: 0.95rem;
        font-weight: 600;
        letter-spacing: 0.01em;
        padding: 0.45rem 0.1rem 0.55rem;
        min-height: 44px;
        cursor: pointer;
        touch-action: manipulation;
        position: relative;
        white-space: nowrap;
    }
    .viewer-discovery-rail__tab.is-active {
        color: #fff;
    }
    .viewer-discovery-rail__tab.is-active::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0.15rem;
        height: 3px;
        border-radius: 2px;
        background: #ffcc00;
    }
    .viewer-discovery-rail__search {
        flex-shrink: 0;
        width: 2.75rem;
        height: 2.75rem;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: #fff;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        touch-action: manipulation;
    }
    .viewer-discovery-search {
        padding: 0 1.25rem 0.85rem;
    }
    .viewer-discovery-search__label {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
    }
    .viewer-discovery-search__input {
        width: 100%;
        min-height: 2.75rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        padding: 0.55rem 1rem;
        font-size: 0.95rem;
    }
    .viewer-featured__heading {
        margin: 0 0 0.85rem;
        font-size: 0.78rem;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba(244, 241, 234, 0.72);
    }
    .viewer-production-library {
        padding: 0.65rem 1.25rem 2.8rem;
        display: grid;
        gap: 1.35rem;
    }
    .viewer-production-library__section {
        display: grid;
        gap: 0.75rem;
    }
    .viewer-production-library__heading {
        margin: 0;
        font-size: 0.8rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: rgba(244, 241, 234, 0.72);
    }
    .viewer-production-library__grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.85rem 0.75rem;
    }
    @media (min-width: 700px) {
        .viewer-production-library__grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
        }
    }
    @media (min-width: 980px) {
        .viewer-production-library__grid {
            grid-template-columns: repeat(6, minmax(0, 1fr));
            gap: 1rem 0.85rem;
        }
    }
    @media (min-width: 1400px) {
        .viewer-production-library__grid {
            grid-template-columns: repeat(8, minmax(0, 1fr));
        }
    }
    .viewer-production-library__empty {
        margin: 0;
        color: rgba(244, 241, 234, 0.58);
        font-size: 0.86rem;
    }
    .viewer-continue {
        padding: 0 1.25rem 2rem;
    }
    .viewer-continue__heading {
        margin: 0 0 0.75rem;
        font-size: 0.8rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: rgba(244, 241, 234, 0.72);
    }
    .viewer-continue__row {
        display: grid;
        gap: 0.65rem;
    }
    .viewer-continue__card {
        display: grid;
        grid-template-columns: 96px minmax(0, 1fr);
        gap: 0.7rem;
        align-items: center;
        width: 100%;
        padding: 0.45rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: inherit;
        text-align: left;
        cursor: pointer;
    }
    .viewer-continue__poster-wrap {
        border-radius: 8px;
        overflow: hidden;
        aspect-ratio: 16 / 9;
        background: rgba(255, 255, 255, 0.06);
    }
    .viewer-continue__poster {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }
    .viewer-continue__copy {
        min-width: 0;
        display: grid;
        gap: 0.35rem;
    }
    .viewer-continue__title {
        margin: 0;
        font-size: 0.9rem;
        color: #fff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .viewer-continue__meta {
        margin: 0;
        font-size: 0.74rem;
        color: rgba(244, 241, 234, 0.66);
    }
    .viewer-continue__card:focus-visible {
        outline: 2px solid rgba(0, 242, 255, 0.65);
        outline-offset: 2px;
    }
    .card-inner.vault-card {
        min-width: 120px;
        min-height: 120px;
        background: #1a1a1a;
    }
    .card-inner.vault-card :global(img),
    .card-inner.vault-card :global(video),
    .card-inner.vault-card :global(.card-video-fallback) {
        object-fit: cover;
        width: 100%;
        height: 100%;
        min-height: 120px;
        background: #1a1a1a;
        display: block;
        pointer-events: none;
    }
    .vault-card-empty {
        width: 100%;
        height: 100%;
        min-height: 120px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #1a1a1a;
        color: rgba(255, 255, 255, 0.5);
        font-size: 2rem;
    }
    .card-inner {
        position: relative;
        aspect-ratio: 16 / 9;
        border-radius: 8px;
        overflow: hidden;
        background: #1a1a1a;
        min-height: 168px;
    }
    :global(.card-visual) {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
        min-height: 120px;
        background: #1a1a1a;
        max-width: 100%;
        max-height: 100%;
    }
    .savvy-hover {
        position: absolute;
        inset: 0;
        background: linear-gradient(transparent 40%, rgba(0, 0, 0, 0.9));
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        padding: 1rem;
        opacity: 0;
        transition: opacity 0.3s ease;
        pointer-events: none;
    }
    .reel-card:hover .savvy-hover {
        opacity: 1;
    }
    .play-btn {
        width: 50px;
        height: 50px;
        background: var(--neon-cyan);
        border-radius: 50%;
        display: grid;
        place-items: center;
        font-size: 1.25rem;
        margin-bottom: 0.5rem;
        color: #000;
    }
    .stats {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.8);
        margin-bottom: 0.25rem;
    }
    .face-count,
    .black-stories-badge,
    .ai-tags,
    .user-image-badge,
    .ai-generated-badge,
    .personal-thumbnail-badge,
    .personal-video-badge,
    .auto-detected-badge {
        font-size: 0.65rem;
        padding: 0.25rem 0.5rem;
        background: rgba(0, 0, 0, 0.6);
        border-radius: 4px;
        margin-top: 0.25rem;
        display: inline-block;
    }
    .reel-title {
        font-size: 0.85rem;
        margin: 0.4rem 0 0;
        color: inherit;
        font-weight: 600;
        line-height: 1.25;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .reel-series-line {
        font-size: 0.72rem;
        margin: 0.2rem 0 0;
        opacity: 0.75;
        line-height: 1.2;
    }
    .reel-description {
        font-size: 0.72rem;
        margin: 0.25rem 0 0;
        opacity: 0.8;
        line-height: 1.3;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .reel-meta {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.5);
    }
    .is-ghost {
        opacity: 0.7;
    }
    .is-personal {
        border: 2px solid var(--neon-gold);
    }

    /* ── REELSHORT theater-only immersive profile ── */
    :global(:root) {
        --reelshort-aspect: 9 / 16;
        --reelshort-theater-max-width: 450px;
    }
    .theater-progress-ring {
        position: absolute;
        top: 10px;
        left: 10px;
        z-index: 4;
        width: 36px;
        height: 36px;
        pointer-events: none;
    }
    .theater-progress-ring .ring-bg {
        fill: none;
        stroke: rgba(255, 255, 255, 0.25);
        stroke-width: 2;
    }
    .theater-progress-ring .ring-fill {
        fill: none;
        stroke: var(--neon-cyan);
        stroke-width: 2.5;
        stroke-linecap: round;
        transform: rotate(-90deg);
        transform-origin: 50% 50%;
        stroke-dasharray: 100;
        transition: stroke-dashoffset 0.15s linear;
    }
    :global(.reelshort-theater) {
        max-width: var(--reelshort-theater-max-width) !important;
        aspect-ratio: var(--reelshort-aspect);
        margin: 0 auto;
        overflow: hidden;
        position: relative;
    }
    :global(.reelshort-theater .theater-header) {
        position: relative;
        z-index: 3;
    }
    :global(.reelshort-theater .theater-meta),
    :global(.reelshort-theater .theater-close-btn-bottom),
    :global(.publishing-immersive .theater-meta),
    :global(.publishing-immersive .theater-close-btn-bottom) {
        display: none;
    }
    :global(.theater-ambient-bg) {
        position: absolute;
        inset: -10%;
        background-size: cover;
        background-position: center;
        filter: blur(24px);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        transform: scale(1.1);
        opacity: 0.45;
        z-index: 0;
        pointer-events: none;
    }
    :global(.reelshort-video-wrap) {
        position: relative;
        z-index: 2;
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }
    .vertical-timeline {
        height: 60px;
        background: rgba(0, 0, 0, 0.8);
        padding: 0.75rem 1rem;
        position: relative;
        z-index: 3;
        flex-shrink: 0;
    }
    .vertical-timeline-track {
        position: relative;
        height: 6px;
        background: rgba(255, 255, 255, 0.15);
        border-radius: 999px;
        overflow: visible;
    }
    .vertical-timeline-progress {
        height: 100%;
        background: linear-gradient(90deg, var(--neon-cyan), var(--neon-pink));
        border-radius: 999px;
        transition: width 0.15s linear;
    }
    .chapter-dot {
        position: absolute;
        top: 50%;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.55);
        transform: translate(-50%, -50%);
        pointer-events: none;
    }
    .next-episode-countdown {
        position: absolute;
        bottom: 72px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 4;
        padding: 0.5rem 1rem;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.75);
        border: 1px solid rgba(255, 0, 255, 0.45);
        color: #fff;
        font-size: 0.8rem;
        letter-spacing: 0.05em;
        pointer-events: none;
    }
    :global(.theater-swipe-pulse) {
        animation: theaterSwipePulse 0.3s ease;
    }
    @keyframes theaterSwipePulse {
        0% {
            transform: scale(1);
        }
        50% {
            transform: scale(0.98);
        }
        100% {
            transform: scale(1);
        }
    }
    @media (orientation: portrait) and (max-width: 640px) {
        :global(.reelshort-theater) {
            max-width: none !important;
            max-height: 100dvh;
            width: 100%;
            aspect-ratio: auto;
            overflow: hidden;
        }
    }

    @media (max-width: 640px), (hover: none) and (pointer: coarse) {
        :global(.reelshort-theater) {
            max-width: none !important;
            width: 100% !important;
            height: 100% !important;
            max-height: 100dvh !important;
            aspect-ratio: auto;
            margin: 0;
            overflow: hidden;
        }
        :global(.reelshort-theater .theater-header) {
            position: sticky;
            top: 0;
            z-index: 40;
            pointer-events: auto;
        }
        :global(.reelshort-theater .theater-header-actions) {
            pointer-events: auto;
            z-index: 41;
        }
        :global(.reelshort-video-wrap) {
            overflow: visible;
        }
        /* Progress ring stays non-interactive and above video without blocking volume bar. */
        .theater-progress-ring {
            z-index: 5;
            pointer-events: none;
        }
        .vertical-timeline {
            position: relative;
            z-index: 6;
            pointer-events: none;
        }
        .next-episode-countdown {
            bottom: 5.5rem;
            pointer-events: none;
        }
    }
</style>
