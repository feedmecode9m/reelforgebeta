/**
 * Mission BG-5C — render gate forensics (logging only).
 */

/**
 * @param {Record<string, unknown>} payload
 */
export function logRenderGate(tag, payload = {}) {
    console.info(`[RENDER_GATE]${tag}`, {
        timestamp: new Date().toISOString(),
        ...payload
    });
}

/**
 * @param {Record<string, unknown>} video
 * @param {Record<string, unknown>} reel
 * @param {number} index
 * @param {{ isVideo: (r: unknown) => boolean; isVideoReel: (r: unknown) => boolean }} checks
 */
export function logVaultRenderGate(video, reel, index, checks) {
    const isVideoResult = checks.isVideo(reel);
    const isVideoReelResult = checks.isVideoReel(reel);
    const hasUrl = Boolean(reel?.url);
    const branchSelected = isVideoResult && hasUrl ? 'media_renderer' : 'placeholder';
    logRenderGate('[VAULT]', {
        index,
        id: video?.id ?? reel?.id ?? null,
        name: video?.name ?? reel?.name ?? null,
        type: video?.type ?? reel?.type ?? null,
        mime: video?.type ?? reel?.type ?? null,
        url: reel?.url ?? video?.url ?? null,
        thumbnailPath: reel?.thumbnailUrl ?? video?.thumbnail ?? null,
        status: video?.status ?? reel?.status ?? null,
        'isVideo(reel)': isVideoResult,
        'isVideoReel(reel)': isVideoReelResult,
        'Boolean(reel.url)': hasUrl,
        'Boolean(reel.thumbnailPath)': Boolean(reel?.thumbnailUrl ?? video?.thumbnail),
        renderBranchSelected: branchSelected,
        videoRaw: video,
        reelResolved: reel
    });
    return branchSelected;
}

/**
 * @param {Record<string, unknown>} video
 * @param {Record<string, unknown>} reel
 * @param {number} index
 */
export function logVaultPlaceholderGate(video, reel, index) {
    logRenderGate('[VAULT][PLACEHOLDER]', {
        index,
        reelFull: reel,
        videoFull: video
    });
    return null;
}

/**
 * @param {Record<string, unknown>} ctx
 */
export function logHeroRenderGatePre(ctx) {
    logRenderGate('[HERO]', {
        heroManagerConfig: ctx.heroManagerConfig,
        heroManagerConfigPersisted: ctx.heroManagerConfigPersisted,
        heroUsesImageBackground: ctx.heroUsesImageBackground,
        backgroundSource: ctx.backgroundSource,
        heroRenderVideo: ctx.heroRenderVideo,
        activeHeroMediaMode: ctx.activeHeroMediaMode,
        HERO_BACKGROUND_VIDEO: ctx.HERO_BACKGROUND_VIDEO,
        pendingHero: ctx.pendingHero,
        heroUploadState: ctx.heroUploadState,
        heroUploadProcessing: ctx.heroUploadProcessing,
        prioritizedHeroVideo: ctx.prioritizedHeroVideo,
        heroBackgroundPresentationVideoUrl: ctx.heroBackgroundPresentationVideoUrl
    });
}

/**
 * @param {Record<string, unknown>} saved
 * @param {Record<string, unknown>} inMemory
 */
export function logHeroConfigSaveAudit(saved, inMemory) {
    logRenderGate('[HERO][CONFIG_SAVE]', {
        savedObject: saved,
        inMemoryBeforeRender: inMemory
    });
    const savedJson = JSON.stringify(saved ?? {});
    const memJson = JSON.stringify({
        backgroundSource: inMemory?.backgroundSource,
        heroAssetId: inMemory?.heroAssetId,
        backgroundStyle: inMemory?.backgroundStyle
    });
    const persisted = JSON.stringify({
        backgroundSource: saved?.backgroundSource,
        heroAssetId: saved?.heroAssetId,
        backgroundStyle: saved?.backgroundStyle
    });
    if (memJson !== persisted) {
        logRenderGate('[HERO][STALE CONFIG DETECTED]', {
            savedObject: saved,
            inMemoryObject: inMemory,
            message: 'in-memory heroManagerConfig differs from object just saved to localStorage'
        });
    }
}

/**
 * @param {string | null | undefined} oldValue
 * @param {string | null | undefined} newValue
 */
export function logHeroBackgroundVideoChange(oldValue, newValue) {
    logRenderGate('[HERO][STORE]', {
        store: 'HERO_BACKGROUND_VIDEO',
        oldValue: oldValue ?? null,
        newValue: newValue ?? null,
        stackTrace: new Error('[RENDER_GATE] HERO_BACKGROUND_VIDEO change').stack
    });
}

/**
 * @param {unknown[]} oldVault
 * @param {unknown[]} newVault
 */
export function logPersonalVideosChange(oldVault, newVault) {
    const oldIds = new Set((oldVault || []).map((v) => String(v?.id || '').trim()).filter(Boolean));
    const newIds = new Set((newVault || []).map((v) => String(v?.id || '').trim()).filter(Boolean));
    const idsAdded = [...newIds].filter((id) => !oldIds.has(id));
    const oldUrls = new Set((oldVault || []).map((v) => String(v?.url || '').trim()).filter(Boolean));
    const newUrls = new Set((newVault || []).map((v) => String(v?.url || '').trim()).filter(Boolean));
    const urlsAdded = [...newUrls].filter((u) => !oldUrls.has(u));
    logRenderGate('[VAULT][STORE]', {
        store: 'personalVideos',
        oldLength: (oldVault || []).length,
        newLength: (newVault || []).length,
        idsAdded,
        urlsAdded,
        stackTrace: new Error('[RENDER_GATE] personalVideos change').stack
    });
}

/**
 * @param {string} event
 * @param {HTMLVideoElement | null | undefined} video
 * @param {{ url?: string; resolvedSrc?: string; mediaType?: string }} ctx
 */
export function logMediaRendererEvent(event, video, ctx = {}) {
    logRenderGate('[MEDIA]', {
        event,
        mounted: event === 'mounted',
        src: ctx.url ?? null,
        resolvedSrc: ctx.resolvedSrc ?? null,
        mediaType: ctx.mediaType ?? null,
        loadedmetadata: event === 'loadedmetadata',
        loadeddata: event === 'loadeddata',
        error: event === 'error',
        readyState: video?.readyState ?? null,
        networkState: video?.networkState ?? null,
        videoWidth: video?.videoWidth ?? null,
        videoHeight: video?.videoHeight ?? null,
        currentSrc: video?.currentSrc ?? null,
        errorCode: video?.error?.code ?? null,
        errorMessage: video?.error?.message ?? null
    });
}
