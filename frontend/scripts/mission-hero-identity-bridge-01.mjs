#!/usr/bin/env node
/**
 * HERO-IDENTITY-BRIDGE-01 — offline regression for selection vs custom hero identity paths.
 */
const OUT = process.env.OUT || '/tmp/hero-identity-bridge-01.json';

const EPISODE_ID = 'ep-neon-s01e02';
const SYNTHETIC_REEL_ID = 'reel-neon-s01e02';
const CANONICAL_REEL_ID = 'dff70497-d198-4ff5-84a4-1b7265d2f8eb';
const CUSTOM_HERO_ID = 'c337add5-cf14-4388-931e-1f2e843171e2';

/** @param {Record<string, unknown>[]} feedReels @param {string | null | undefined} reelId */
function findReelInFeedList(feedReels, reelId) {
    if (!reelId) return null;
    return (
        feedReels.find(
            (reel) =>
                reel?.id === reelId ||
                reel?.reelId === reelId ||
                String(reel?.id || '') === String(reelId)
        ) || null
    );
}

function titlesMatch(a, b) {
    const norm = (s) =>
        String(s || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    const na = norm(a);
    const nb = norm(b);
    if (!na || !nb) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Mirrors episodeBridge.resolveReelForEpisode with injectable episode context.
 * @param {string} episodeId
 * @param {(reelId: string) => Record<string, unknown> | null | undefined} findReelInFeed
 * @param {() => Record<string, unknown>[]} getAllFeedReels
 * @param {{ episode: { episodeId: string; title: string; reelId?: string | null } } | null} episodeCtx
 * @param {Record<string, { episodeId?: string }>} metaMap
 */
function resolveReelForEpisode(episodeId, findReelInFeed, getAllFeedReels, episodeCtx, metaMap = {}) {
    if (!episodeId || !episodeCtx) return null;
    const tryIds = new Set();
    if (episodeCtx.episode.reelId) tryIds.add(String(episodeCtx.episode.reelId));
    for (const [reelId, meta] of Object.entries(metaMap)) {
        if (meta.episodeId === episodeId) tryIds.add(reelId);
    }
    for (const reelId of tryIds) {
        const reel = findReelInFeed(reelId);
        if (reel) return reel;
    }
    const feedReels = getAllFeedReels();
    for (const reel of feedReels) {
        if (!reel?.id) continue;
        const linkedEpisodeId = reel.episodeId || reel.episode_id;
        if (linkedEpisodeId && String(linkedEpisodeId) === episodeId) return reel;
    }
    const episodeTitle = episodeCtx.episode.title;
    for (const reel of feedReels) {
        if (!reel?.id) continue;
        if (titlesMatch(String(reel.name || reel.title || ''), episodeTitle)) return reel;
    }
    return null;
}

function resolveReelMedia(reel) {
    return {
        videoUrl: String(reel?.url || reel?.video_url || '').trim(),
        posterUrl: String(reel?.thumbnailUrl || reel?.thumbnail || '').trim()
    };
}

function candidateFromEpisode(episodeId, feedReels, episodeCtx, metaMap = {}) {
    if (!episodeCtx) return null;
    const reel = resolveReelForEpisode(
        episodeId,
        (reelId) => findReelInFeedList(feedReels, reelId),
        () => feedReels,
        episodeCtx,
        metaMap
    );
    const media = resolveReelMedia(reel);
    const resolvedReelId = reel?.id ? String(reel.id) : '';
    const bridge = {
        episodeId,
        resolvedReelId,
        foundInFeed: Boolean(reel?.id),
        hasVideoUrl: Boolean(media.videoUrl),
        source: 'candidateFromEpisode'
    };
    console.info('[HERO_IDENTITY_BRIDGE]', bridge);
    return {
        episodeId,
        reelId: resolvedReelId || undefined,
        videoUrl: media.videoUrl || undefined,
        posterUrl: media.posterUrl || undefined,
        meta: {
            resolvedReel: reel
                ? {
                      id: resolvedReelId,
                      videoUrl: media.videoUrl || '',
                      thumbnailUrl: media.posterUrl || '',
                      mediaUrl: media.videoUrl || media.posterUrl || ''
                  }
                : undefined
        },
        bridge
    };
}

function resolveSelectionPresentation(config, selection) {
    const reelId = String(selection?.reelId || '').trim();
    const videoUrl = String(selection?.videoUrl || '').trim();
    const mediaUrl = videoUrl;
    const route = {
        stage: 'resolveHeroBackgroundPresentation:selection',
        heroAssetId: config.heroAssetId || '',
        resolvedAssetId: reelId,
        assetType: mediaUrl.includes('.mp4') ? 'mp4' : 'unknown',
        mediaUrl,
        vaultMatch: false
    };
    console.info('[HERO_ROUTE]', route);
    return route;
}

function resolveCustomPresentation(config, vaultItems) {
    const heroAssetId = String(config.heroAssetId || '').trim();
    const item = vaultItems.find((entry) => String(entry.id) === heroAssetId);
    const mediaUrl = String(item?.url || '').trim();
    const route = {
        stage: 'resolveHeroBackgroundAsset:resolved',
        heroAssetId,
        resolvedAssetId: item?.id || '',
        assetType: mediaUrl.includes('.mp4') ? 'mp4' : 'unknown',
        mediaUrl,
        vaultMatch: Boolean(item)
    };
    console.info('[HERO_ROUTE]', route);
    return route;
}

function assert(name, ok, detail = null) {
    const status = ok ? 'PASS' : 'FAIL';
    console.info(`[HERO_IDENTITY_BRIDGE_ASSERT] ${status} ${name}`, detail || '');
    if (!ok) failures.push(name);
}

const failures = [];

const feedReels = [
    {
        id: CANONICAL_REEL_ID,
        episodeId: EPISODE_ID,
        episode_id: EPISODE_ID,
        title: 'Blood Protocol',
        name: 'Blood Protocol',
        url: `/videos/${CANONICAL_REEL_ID}.mp4`,
        type: 'video/mp4'
    }
];

const episodeCtx = {
    episode: {
        episodeId: EPISODE_ID,
        title: 'Blood Protocol',
        reelId: SYNTHETIC_REEL_ID,
        status: 'published'
    }
};

const legacyMiss = findReelInFeedList(feedReels, SYNTHETIC_REEL_ID);
assert('legacy_synthetic_reel_lookup_misses', legacyMiss === null, { synthetic: SYNTHETIC_REEL_ID });

const candidate = candidateFromEpisode(EPISODE_ID, feedReels, episodeCtx);
console.info('[HERO_SELECTION]', {
    mode: 'TRENDING',
    source: 'creator_spotlight',
    episodeId: candidate?.episodeId,
    reelId: candidate?.reelId,
    score: 24
});

assert('selection_episode_resolves_canonical_uuid', candidate?.reelId === CANONICAL_REEL_ID, {
    expected: CANONICAL_REEL_ID,
    actual: candidate?.reelId
});
assert('selection_candidate_has_video_url', Boolean(candidate?.videoUrl), {
    videoUrl: candidate?.videoUrl
});
assert('selection_bridge_found_in_feed', candidate?.bridge?.foundInFeed === true);

const selectionConfig = { backgroundSource: 'selection', heroAssetId: '' };
const selectionRoute = resolveSelectionPresentation(selectionConfig, candidate);
assert('selection_mode_hero_asset_id_may_be_empty', selectionRoute.heroAssetId === '');
assert('selection_mode_resolved_asset_is_uuid', selectionRoute.resolvedAssetId === CANONICAL_REEL_ID);
assert('selection_mode_media_url_present', Boolean(selectionRoute.mediaUrl));
assert('selection_mode_no_vault_required', selectionRoute.vaultMatch === false);

const customConfig = { backgroundSource: 'custom_video', heroAssetId: CUSTOM_HERO_ID };
const vaultItems = [
    {
        id: CUSTOM_HERO_ID,
        url: `/videos/${CUSTOM_HERO_ID}.mp4`,
        type: 'video/mp4'
    }
];
const customRoute = resolveCustomPresentation(customConfig, vaultItems);
assert('custom_mode_uses_hero_asset_id', customRoute.heroAssetId === CUSTOM_HERO_ID);
assert('custom_mode_vault_match', customRoute.vaultMatch === true);
assert('custom_mode_media_url_present', Boolean(customRoute.mediaUrl));
assert('custom_path_separate_from_selection', customRoute.resolvedAssetId !== selectionRoute.resolvedAssetId);

const summary = {
    mission: 'HERO-IDENTITY-BRIDGE-01',
    allPass: failures.length === 0,
    failures,
    selection: {
        episodeId: EPISODE_ID,
        resolvedReelId: candidate?.reelId,
        mediaUrl: selectionRoute.mediaUrl,
        heroAssetId: selectionRoute.heroAssetId
    },
    custom: {
        heroAssetId: customRoute.heroAssetId,
        resolvedAssetId: customRoute.resolvedAssetId,
        mediaUrl: customRoute.mediaUrl,
        vaultMatch: customRoute.vaultMatch
    }
};

console.info('[HERO_IDENTITY_BRIDGE_SUMMARY]', summary);
await import('node:fs').then((fs) => fs.writeFileSync(OUT, JSON.stringify(summary, null, 2)));
console.log(`Wrote ${OUT}`);

if (failures.length) {
    process.exit(1);
}
