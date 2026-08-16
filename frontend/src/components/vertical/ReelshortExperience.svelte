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
    import { afterUpdate } from 'svelte';
    import MediaRenderer from '../media/MediaRenderer.svelte';
    import MediaThumbnail from '../media/MediaThumbnail.svelte';
    import MediaPoster from '../media/MediaPoster.svelte';
    import { prefersHoverPreview } from '../../lib/vertical/feedCardAutoplay.js';
    import { videoMimeForPath } from '../../lib/config.js';
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
    import { logBg7pShelfDistribution, shelfCountsFromFeed } from '../../lib/diagnostics/bg7pShelfDistribution.js';
    import { fillShelfPresentation, isRealShelfCard, isPlayableShelfVideo, pickFirstListWithRealCards, collectPlayableVideosFromFeedMap, mergeMissingVaultImageCards, mergeMissingPlayableVideos } from '../../lib/feed/fillShelfPresentation.js';
    import { durableImageVaultUrl } from '../../lib/viewer/vaultUtils.js';
    import { LEGACY_HERO_REEL_KEY } from '../../lib/hero/heroRecord.js';
    import { resolveVaultCardProjection } from '../../lib/content/vaultCardProjection.js';
    import ViewerSemanticCard from '../viewer/ViewerSemanticCard.svelte';
    import {
        buildViewerSemanticShell,
        collectIdentityDedupedFeedMap,
        collectRealViewerReels
    } from '../../lib/feed/viewerSemanticShell.js';
    import { composeViewerShelfLayouts } from '../../lib/feed/viewerShelfComposition.js';
    import { categoryAliasStore, displayDiscoveryShelf } from '../../lib/feed/discoveryTaxonomy.js';
    import { resolveViewerAssetId } from '../../lib/feed/viewerIdentityDedupe.js';
    import { logViewerMediaIdentityDiagnostics } from '../../lib/feed/viewerMediaIdentity.js';
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

    /** @type {Record<string, HTMLDivElement | null>} */
    let rowRefs = {};
    /** @type {HTMLElement | null} */
    let feedSectionRoot = null;

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
        const shelfDomCounts = {};
        const shelfRealDomCounts = {};
        for (const cat of Object.keys($feed || {}).filter((c) => c !== 'Auto-Detect')) {
            const row = feedSectionRoot?.querySelector(`[aria-label="${cat} content row"]`);
            shelfDomCounts[cat] = row
                ? row.querySelectorAll('.reel-card, [data-viewer-semantic-card]').length
                : 0;
            shelfRealDomCounts[cat] = row
                ? row.querySelectorAll(
                      '.reel-card:not(.presentation-slot), [data-viewer-semantic-card]'
                  ).length
                : 0;
        }
        console.info('[BG7P_SHELF_DOM]', {
            stage: 'ReelshortExperience:domPerShelf',
            shelfDomCounts,
            shelfRealDomCounts,
            feedShelfCounts: shelfCountsFromFeed($feed),
            timestamp: new Date().toISOString()
        });
        console.info('[BG7S_SHELF_DOM]', {
            stage: 'ReelshortExperience:domPerShelf',
            shelfRealDomCounts,
            shelfDisplayDomCounts: shelfDomCounts,
            feedShelfCounts: shelfCountsFromFeed($feed),
            timestamp: new Date().toISOString()
        });
        const trendingRow = feedSectionRoot?.querySelector('[data-viewer-discovery-row="Trending"]');
        const trendingDom = trendingRow
            ? trendingRow.querySelectorAll('[data-viewer-semantic-card], .reel-card:not(.presentation-slot)')
                  .length
            : 0;
        console.info('[TRENDING_RENDER_TRACE]', {
            stage: 'dom',
            finalDomCardCount: trendingDom,
            shouldRenderShelf: shouldRenderShelf('Trending'),
            displayShelfCount: getShelfDisplayItems('Trending').length,
            ts: new Date().toISOString()
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
    function countGlobalRealFeedCards() {
        const map = identityFeedMap || $normalizedFeed || $feed || {};
        return Object.values(map)
            .flat()
            .filter((item) => isRealShelfCard(item)).length;
    }

    function localVaultStillCards() {
        if (typeof localStorage === 'undefined') return [];
        try {
            const stored = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
            if (!Array.isArray(stored)) return [];
            return stored
                .map((thumb, index) => {
                    const row =
                        thumb && typeof thumb === 'object'
                            ? thumb
                            : { fileName: String(thumb || ''), url: '' };
                    const url = durableImageVaultUrl(row, row);
                    if (!url) return null;
                    const rawId = String(row.id || '').trim();
                    const id = rawId
                        ? `personal-thumb-vault-${rawId}`
                        : `personal-thumb-vault-${index}`;
                    return {
                        id,
                        type: 'image',
                        url,
                        thumbnailUrl: url,
                        posterUrl: url,
                        isPersonalThumbnail: true,
                        publishableImage: true,
                        category: 'Trending',
                        isPlaceholder: false
                    };
                })
                .filter(Boolean);
        } catch {
            return [];
        }
    }

    function localVaultVideoCards() {
        if (typeof localStorage === 'undefined') return [];
        try {
            const stored = JSON.parse(localStorage.getItem('personal_video_vault') || '[]');
            if (!Array.isArray(stored)) return [];
            return stored
                .map((row) => {
                    if (!row || typeof row !== 'object') return null;
                    const state = String(row.uploadState || '').toLowerCase();
                    if (
                        state === 'failed' ||
                        state === 'interrupted' ||
                        state === 'pending_accept' ||
                        state === 'uploading' ||
                        row.deleted === true
                    ) {
                        return null;
                    }
                    const card = {
                        ...row,
                        type: row.type || 'video',
                        isPersonalVideo: true,
                        category: 'Trending',
                        isPlaceholder: false
                    };
                    return isPlayableShelfVideo(card) ? card : null;
                })
                .filter(Boolean);
        } catch {
            return [];
        }
    }

    function localHeroReelCard() {
        if (typeof localStorage === 'undefined') return null;
        try {
            const raw = JSON.parse(localStorage.getItem(LEGACY_HERO_REEL_KEY) || 'null');
            if (!raw || typeof raw !== 'object') return null;
            const card = {
                ...raw,
                type: raw.type || 'video',
                isPersonalVideo: true,
                category: 'Trending',
                isPlaceholder: false
            };
            return isPlayableShelfVideo(card) ? card : null;
        } catch {
            return null;
        }
    }

    function getShelfSource(category) {
        const identity = identityFeedMap?.[category];
        const normalized = $normalizedFeed?.[category];
        const raw = $feed?.[category];
        const picked = pickFirstListWithRealCards([identity, normalized, raw]);
        const extras = [raw, normalized, identity];
        if (category === 'Trending') extras.push(localVaultStillCards());
        let merged = mergeMissingVaultImageCards(picked, extras);
        if (category === 'Trending') {
            merged = mergeMissingPlayableVideos(merged, [
                collectPlayableVideosFromFeedMap($normalizedFeed || $feed || {}),
                localVaultVideoCards(),
                [localHeroReelCard()].filter(Boolean),
                identity,
                normalized,
                raw
            ]);
        }
        if (merged.length > 0) return merged;
        if (category === 'Trending') {
            return collectPlayableVideosFromFeedMap($normalizedFeed || $feed || {});
        }
        return Array.isArray(identity) ? identity : Array.isArray(raw) ? raw : [];
    }

    function getShelfDisplayItems(category) {
        const source = getShelfSource(category);
        const hydrated = UIAgent.fillLandscape ? UIAgent.fillLandscape(source, category) : source;
        const filteredReal = (hydrated || []).filter(isRealShelfCard);
        const display = fillShelfPresentation(hydrated, category, undefined, {
            globalRealCount: countGlobalRealFeedCards()
        });
        if (category === 'Trending' && typeof window !== 'undefined') {
            console.info('[TRENDING_RENDER_TRACE]', {
                rawTrendingInputCount: Array.isArray($feed?.Trending) ? $feed.Trending.length : 0,
                normalizedTrendingCount: Array.isArray($normalizedFeed?.Trending)
                    ? $normalizedFeed.Trending.length
                    : 0,
                identityTrendingCount: Array.isArray(identityFeedMap?.Trending)
                    ? identityFeedMap.Trending.length
                    : 0,
                hydratedReelCount: Array.isArray(hydrated) ? hydrated.length : 0,
                filteredCount: filteredReal.length,
                displayShelfCount: Array.isArray(display) ? display.length : 0,
                failure:
                    display.length > 0
                        ? null
                        : filteredReal.length === 0 &&
                            (Array.isArray($feed?.Trending) ? $feed.Trending.length : 0) === 0
                          ? 'A_or_hydration'
                          : filteredReal.length === 0
                            ? 'B_filtering'
                            : display.length === 0
                              ? 'C_shelf_filler'
                              : 'D_render_condition',
                ts: new Date().toISOString()
            });
        }
        return display;
    }

    /**
     * @param {Record<string, unknown>} reel
     * @param {string} category
     */
    function resolveCardMedia(reel, category) {
        const id = resolveViewerAssetId(reel);
        const fromMap = id ? identityResolvedById.get(id) : null;
        if (fromMap && !(hasPlayableVideo(reel) && fromMap.mediaSource === 'image')) {
            return fromMap;
        }
        const projection = resolveVaultCardProjection(String(reel?.id || ''), { reel });
        return {
            mediaSource: hasPlayableVideo(reel) ? 'video' : 'image',
            poster: projection.posterUrl || reel.thumbnailUrl || '',
            title: projection.title || reel.title || reel.name || '',
            shelf: category,
            themes: [],
            metadata: { invented: false }
        };
    }

    function shouldRenderShelf(category) {
        return getShelfDisplayItems(category).length > 0;
    }

    function getRowStep(row) {
        if (!row) return 360;
        const firstCard = row.querySelector('.reel-card, [data-viewer-semantic-card]');
        const cardWidth = firstCard?.getBoundingClientRect?.().width || 320;
        const styles = window.getComputedStyle(row);
        const gap = Number.parseFloat(styles.columnGap || styles.gap || '16') || 16;
        return cardWidth + gap;
    }

    function scrollRow(category, direction = 1) {
        const row = rowRefs[category];
        if (!row) return;
        const step = getRowStep(row) * 1.35;
        row.scrollBy({
            left: direction * step,
            behavior: 'smooth'
        });
    }

    function handleRowWheel(event, category) {
        const row = rowRefs[category];
        if (!row) return;
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        event.preventDefault();
        row.scrollBy({
            left: event.deltaY,
            behavior: 'auto'
        });
    }

    function reelListKey(reel, category, index) {
        return [
            category,
            reel?.id || 'no-id',
            String(index)
        ].join('::');
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
    $: browseItems = shelfComposition.browseItems || [];
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
        logTheaterOpen(reel, { source: 'feed-card-click', category });
        onRecordAccess(reel.id);
        onOpenTheater(reel);
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
                description: featuredProjection.description
            },
            featuredResolved
        )}
        <section class="viewer-featured" data-viewer-featured-card aria-label="Featured">
            <h2 class="viewer-featured__heading">Featured</h2>
            <ViewerSemanticCard
                reel={/** @type {Record<string, unknown>} */ (featuredReel)}
                shell={featuredShell}
                resolvedMedia={featuredResolved}
                variant="featured"
                previewActive={String(feedHoverPreviewId) === String(featuredReel.id)}
                onActivate={(r) => activateReel(r, featuredCategory)}
                onMediaPointerEnter={() => {
                    if (hasPlayableVideo(featuredReel) && featuredReel.url && !$feedCardVideoFallbacks.has(featuredReel.id)) {
                        startFeedCardPreview(featuredReel.id);
                    }
                }}
                onMediaPointerLeave={() => stopFeedCardPreview(featuredReel.id)}
            >
                <svelte:fragment slot="media">
                    {#if hasPlayableVideo(featuredReel) && featuredReel.url}
                        {#if $feedCardVideoFallbacks.has(featuredReel.id)}
                            {traceFeedCardRender(featuredReel, featuredCategory, 'video_fallback_thumbnail', featuredResolved.poster || featuredProjection.posterUrl || featuredReel.thumbnailUrl || getImg(featuredReel, featuredCategory, 0))}
                            <MediaThumbnail
                                url={featuredResolved.poster || featuredProjection.posterUrl || featuredReel.thumbnailUrl || getImg(featuredReel, featuredCategory, 0)}
                                alt={featuredProjection.title || 'Video'}
                                lazyLoad
                                className="card-visual card-video-fallback"
                            />
                        {:else if prefersHoverPreview() && String(feedHoverPreviewId) === String(featuredReel.id)}
                            {traceFeedCardRender(featuredReel, featuredCategory, 'video', featuredReel.url)}
                            <MediaRenderer
                                type="video"
                                url={featuredReel.url}
                                poster={featuredResolved.poster || featuredProjection.posterUrl || featuredReel.thumbnailUrl || getImg(featuredReel, featuredCategory, 0)}
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
                            {traceFeedCardRender(featuredReel, featuredCategory, 'video_poster', featuredResolved.poster || featuredProjection.posterUrl || featuredReel.thumbnailUrl || getImg(featuredReel, featuredCategory, 0))}
                            <MediaThumbnail
                                url={featuredResolved.poster || featuredProjection.posterUrl || featuredReel.thumbnailUrl || getImg(featuredReel, featuredCategory, 0)}
                                alt={featuredProjection.title || 'Video'}
                                lazyLoad
                                className="card-visual card-video-poster"
                            />
                        {/if}
                    {:else if featuredReel.url}
                        <MediaThumbnail
                            url={$feedCardImageFallbacks[featuredReel.id] || featuredResolved.poster || featuredProjection.posterUrl || featuredReel.url}
                            alt={featuredProjection.title || 'Image'}
                            lazyLoad
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

    {#each Object.keys($feed).filter((cat) => cat !== 'Auto-Detect') as category}
        {@const config = UIAgent.getStudioConfigs(category)}
        {@const displayName = displayDiscoveryShelf(category, $categoryAliasStore)}
        {@const headingLabel = String(displayName || config.label || category)}
        {#if shouldRenderShelf(category)}
        <section class="shelf" data-viewer-discovery-row={category}>
            <h2 style="border-left: 4px solid {config.color}; color: {config.color};">{headingLabel}</h2>
            <div class="row-shell">
                <button
                    type="button"
                    class="row-nav row-nav--left"
                    aria-label="Scroll row left"
                    on:click={() => scrollRow(category, -1)}
                >‹</button>
                <div
                    class="row"
                    role="region"
                    aria-label="{category} content row"
                    bind:this={rowRefs[category]}
                    on:mouseenter={UIAgent.startScroll}
                    on:mouseleave={UIAgent.stopScroll}
                    on:wheel={(event) => handleRowWheel(event, category)}
                >
                    {#each getShelfDisplayItems(category) as reel, i (reelListKey(reel, category, i))}
                        {#if reel.isPresentationOnly}
                            <div
                                class="reel-card presentation-slot viewer-sem-card--row"
                                data-reel-id={reel.id}
                                role="presentation"
                                aria-hidden="true"
                            >
                                <div class="card-inner vault-card presentation-card-inner viewer-presentation-shell">
                                    <div class="presentation-frame" style="--shelf-accent: {config.color}">
                                        <span class="presentation-badge">{headingLabel}</span>
                                        <span class="presentation-lock" aria-hidden="true">🔒</span>
                                        <p class="presentation-copy">Coming Soon</p>
                                    </div>
                                </div>
                                <h3 class="reel-title presentation-title-label">Coming Soon</h3>
                            </div>
                        {:else}
                        {@const cardProjection = resolveVaultCardProjection(String(reel?.id || ''), {
                            reel: /** @type {Record<string, unknown>} */ (reel)
                        })}
                        {@const cardResolved = resolveCardMedia(
                            /** @type {Record<string, unknown>} */ (reel),
                            category
                        )}
                        {@const rowShell = buildViewerSemanticShell(
                            /** @type {Record<string, unknown>} */ (reel),
                            {
                                title: cardProjection.title,
                                category,
                                posterUrl: cardResolved.poster || cardProjection.posterUrl,
                                description: cardProjection.description
                            },
                            cardResolved
                        )}
                        <ViewerSemanticCard
                            reel={/** @type {Record<string, unknown>} */ (reel)}
                            shell={rowShell}
                            resolvedMedia={cardResolved}
                            variant="row"
                            previewActive={String(feedHoverPreviewId) === String(reel.id)}
                            onActivate={(r) => activateReel(r, category)}
                            onMediaPointerEnter={() => {
                                if (hasPlayableVideo(reel) && reel.url && !$feedCardVideoFallbacks.has(reel.id)) {
                                    startFeedCardPreview(reel.id);
                                }
                            }}
                            onMediaPointerLeave={() => stopFeedCardPreview(reel.id)}
                        >
                            <svelte:fragment slot="media">
                                {#if hasPlayableVideo(reel) && reel.url}
                                    {#if $feedCardVideoFallbacks.has(reel.id)}
                                        {traceFeedCardRender(reel, category, 'video_fallback_thumbnail', cardResolved.poster || cardProjection.posterUrl || reel.thumbnailUrl || getImg(reel, category, i))}
                                        <MediaThumbnail
                                            url={cardResolved.poster || cardProjection.posterUrl || reel.thumbnailUrl || getImg(reel, category, i)}
                                            alt={cardProjection.title || 'Video'}
                                            lazyLoad
                                            className="card-visual card-video-fallback"
                                        />
                                    {:else if prefersHoverPreview() && String(feedHoverPreviewId) === String(reel.id)}
                                        {traceFeedCardRender(reel, category, 'video', reel.url)}
                                        <MediaRenderer
                                            type="video"
                                            url={reel.url}
                                            poster={cardResolved.poster || cardProjection.posterUrl || reel.thumbnailUrl || getImg(reel, category, i)}
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
                                            on:loadeddata={() => console.log('✅ Video loaded:', reel.url, videoMimeForPath(reel.url))}
                                            on:error={(e) => onCardVideoError(e, reel)}
                                        />
                                    {:else}
                                        {traceFeedCardRender(reel, category, 'video_poster', cardResolved.poster || cardProjection.posterUrl || reel.thumbnailUrl || getImg(reel, category, i))}
                                        <MediaThumbnail
                                            url={cardResolved.poster || cardProjection.posterUrl || reel.thumbnailUrl || getImg(reel, category, i)}
                                            alt={cardProjection.title || 'Video'}
                                            lazyLoad
                                            className="card-visual card-video-poster"
                                        />
                                    {/if}
                                {:else if reel.url}
                                    {traceFeedCardRender(reel, category, 'image', $feedCardImageFallbacks[reel.id] || reel.url)}
                                    <MediaThumbnail
                                        url={$feedCardImageFallbacks[reel.id] || cardResolved.poster || cardProjection.posterUrl || reel.url}
                                        alt={cardProjection.title || 'Image'}
                                        lazyLoad
                                        className="card-visual"
                                        raw={Boolean($feedCardImageFallbacks[reel.id])}
                                        on:error={(e) => { logVaultImageError(e.currentTarget, reel.url); onImageError(e.currentTarget, reel, category, i); }}
                                    />
                                {:else}
                                    {traceFeedCardRender(reel, category, 'empty', '')}
                                    <div class="vault-card-empty" aria-label="Media unavailable">⚠️</div>
                                {/if}
                            </svelte:fragment>
                        </ViewerSemanticCard>
                        {/if}
                    {/each}
                </div>
                <button
                    type="button"
                    class="row-nav row-nav--right"
                    aria-label="Scroll row right"
                    on:click={() => scrollRow(category, 1)}
                >›</button>
            </div>
        </section>
        {/if}
    {/each}

    {#if browseItems.length > 0}
        <section class="viewer-browse" data-viewer-browse-grid aria-label="Browse">
            <h2 class="viewer-browse__heading">Browse</h2>
            <div class="viewer-browse__grid">
                {#each browseItems as item (item.reel.id)}
                    {@const gridReel = item.reel}
                    {@const gridCategory = item.shelf}
                    {@const gridResolved = item.resolvedMedia || resolveCardMedia(
                        /** @type {Record<string, unknown>} */ (gridReel),
                        gridCategory
                    )}
                    {@const gridProjection = resolveVaultCardProjection(String(gridReel?.id || ''), {
                        reel: /** @type {Record<string, unknown>} */ (gridReel)
                    })}
                    {@const gridShell = buildViewerSemanticShell(
                        /** @type {Record<string, unknown>} */ (gridReel),
                        {
                            title: gridProjection.title,
                            category: gridCategory,
                            posterUrl: gridResolved.poster || gridProjection.posterUrl,
                            description: gridProjection.description
                        },
                        gridResolved
                    )}
                    <ViewerSemanticCard
                        reel={/** @type {Record<string, unknown>} */ (gridReel)}
                        shell={gridShell}
                        resolvedMedia={gridResolved}
                        variant="grid"
                        previewActive={String(feedHoverPreviewId) === String(gridReel.id)}
                        onActivate={(r) => activateReel(r, gridCategory)}
                        onMediaPointerEnter={() => {
                            if (hasPlayableVideo(gridReel) && gridReel.url && !$feedCardVideoFallbacks.has(gridReel.id)) {
                                startFeedCardPreview(gridReel.id);
                            }
                        }}
                        onMediaPointerLeave={() => stopFeedCardPreview(gridReel.id)}
                    >
                        <svelte:fragment slot="media">
                            {#if hasPlayableVideo(gridReel) && gridReel.url}
                                {#if $feedCardVideoFallbacks.has(gridReel.id)}
                                    <MediaThumbnail
                                        url={gridResolved.poster || gridProjection.posterUrl || gridReel.thumbnailUrl || getImg(gridReel, gridCategory, 0)}
                                        alt={gridProjection.title || 'Video'}
                                        lazyLoad
                                        className="card-visual card-video-fallback"
                                    />
                                {:else if prefersHoverPreview() && String(feedHoverPreviewId) === String(gridReel.id)}
                                    <MediaRenderer
                                        type="video"
                                        url={gridReel.url}
                                        poster={gridResolved.poster || gridProjection.posterUrl || gridReel.thumbnailUrl || getImg(gridReel, gridCategory, 0)}
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
                                        on:error={(e) => onCardVideoError(e, gridReel)}
                                    />
                                {:else}
                                    <MediaThumbnail
                                        url={gridResolved.poster || gridProjection.posterUrl || gridReel.thumbnailUrl || getImg(gridReel, gridCategory, 0)}
                                        alt={gridProjection.title || 'Video'}
                                        lazyLoad
                                        className="card-visual card-video-poster"
                                    />
                                {/if}
                            {:else if gridReel.url}
                                <MediaThumbnail
                                    url={$feedCardImageFallbacks[gridReel.id] || gridResolved.poster || gridProjection.posterUrl || gridReel.url}
                                    alt={gridProjection.title || 'Image'}
                                    lazyLoad
                                    className="card-visual"
                                    raw={Boolean($feedCardImageFallbacks[gridReel.id])}
                                />
                            {:else}
                                <div class="vault-card-empty" aria-label="Media unavailable">⚠️</div>
                            {/if}
                        </svelte:fragment>
                    </ViewerSemanticCard>
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
    .viewer-featured__heading,
    .viewer-browse__heading {
        margin: 0 0 0.85rem;
        font-size: 0.78rem;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba(244, 241, 234, 0.72);
    }
    .viewer-browse {
        padding: 0.5rem 2rem 3rem;
    }
    .viewer-browse__grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 1.1rem;
    }
    .viewer-presentation-shell {
        border-radius: var(--rf-cine-radius, 28px) !important;
        box-shadow: var(--rf-cine-shadow, 0 22px 48px rgba(0, 0, 0, 0.45));
    }
    .shelf h2 {
        font-size: 1rem;
        text-transform: uppercase;
        letter-spacing: 2px;
        margin-bottom: 1rem;
        padding-left: 1rem;
    }
    .row {
        display: flex;
        gap: 1.1rem;
        overflow-x: auto;
        padding: 1rem 0;
        scroll-snap-type: x proximity;
        scroll-padding-inline: 0.25rem;
        scroll-behavior: smooth;
        overscroll-behavior-x: contain;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
    }
    .row-shell {
        position: relative;
    }
    .row-nav {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        z-index: 6;
        width: 2.25rem;
        height: 2.25rem;
        border: 1px solid rgba(255, 255, 255, 0.28);
        border-radius: 999px;
        background: rgba(8, 10, 16, 0.72);
        color: #fff;
        font-size: 1.35rem;
        line-height: 1;
        display: grid;
        place-items: center;
        cursor: pointer;
        backdrop-filter: blur(6px);
    }
    .row-nav:hover {
        border-color: rgba(0, 242, 255, 0.72);
        color: var(--neon-cyan);
    }
    .row-nav--left {
        left: -0.3rem;
    }
    .row-nav--right {
        right: -0.3rem;
    }
    .row::-webkit-scrollbar {
        height: 6px;
    }
    .row::-webkit-scrollbar-track {
        background: transparent;
    }
    .row::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 3px;
    }
    .reel-card {
        flex: 0 0 clamp(280px, 28vw, 380px);
        scroll-snap-align: start;
        transition: transform 0.22s ease;
        background: none;
        border: none;
        padding: 0;
        text-align: left;
        transform-origin: center center;
        will-change: transform;
    }
    button.reel-card {
        cursor: pointer;
        color: #f4f4f5;
    }
    .reel-card.presentation-slot {
        cursor: default;
        pointer-events: none;
        user-select: none;
    }
    .presentation-card-inner {
        aspect-ratio: 16 / 9;
        min-height: 160px;
        border-radius: var(--rf-cine-radius, 28px);
        background: linear-gradient(145deg, rgba(12, 14, 22, 0.96), rgba(24, 26, 36, 0.88));
        border: 1px solid rgba(255, 255, 255, 0.08);
        overflow: hidden;
    }
    .presentation-frame {
        width: 100%;
        height: 100%;
        min-height: 160px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 1rem;
        background:
            radial-gradient(circle at 20% 20%, color-mix(in srgb, var(--shelf-accent, #666) 18%, transparent), transparent 55%),
            linear-gradient(160deg, rgba(255, 255, 255, 0.03), rgba(0, 0, 0, 0.35));
    }
    .presentation-badge {
        font-size: 0.65rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        padding: 0.25rem 0.55rem;
        border: 1px solid color-mix(in srgb, var(--shelf-accent, #666) 55%, transparent);
        border-radius: 999px;
        color: var(--shelf-accent, #aaa);
    }
    .presentation-lock {
        font-size: 1.1rem;
        opacity: 0.55;
    }
    .presentation-copy {
        margin: 0;
        font-size: 0.95rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.72);
    }
    .presentation-title-label {
        color: rgba(255, 255, 255, 0.45);
        font-weight: 500;
    }
    @media (hover: hover) and (pointer: fine) {
        button.reel-card:hover {
            transform: scale(1.04);
            z-index: 10;
        }
    }
    @media (max-width: 900px) {
        .row-nav {
            display: none;
        }
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
            max-height: 100vh;
            /* Keep framing/menu + volume chrome from being clipped on mobile. */
            overflow-x: hidden;
            overflow-y: auto;
        }
    }

    @media (max-width: 640px), (hover: none) and (pointer: coarse) {
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
