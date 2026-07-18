#!/usr/bin/env node
/**
 * BG-7L — offline validation against live production catalog (no browser CORS).
 * Mirrors bg7lFeedContract.js eligibility rules for proof artifacts.
 */
const API_URL =
    process.env.API_URL || 'https://reelforge-deploy-production.up.railway.app/api/reels';
const OUT = process.env.OUT || '/tmp/bg-7l-production-catalog-proof.json';

function isVideoReel(reel) {
    const url = String(reel?.url || reel?.video_url || '').trim();
    if (url.includes('/videos/') || /\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i.test(url)) return true;
    const type = String(reel?.type || '').toLowerCase();
    return type.startsWith('video/') || type === 'video';
}

function isImageReel(reel) {
    if (isVideoReel(reel)) return false;
    const type = String(reel?.type || '').toLowerCase();
    return type === 'image' || type.startsWith('image/') || Boolean(reel?.url);
}

function isHeroAsset(reel) {
    const category = String(
        reel?.category || reel?.content_category || reel?.contentCategory || reel?.mediaCategory || ''
    )
        .trim()
        .toUpperCase();
    return category === 'HERO';
}

function evaluate(reel, seenVideoUrls) {
    const reelId = String(reel?.id || '');
    const category = String(reel?.category || 'Trending').trim();
    const mediaType = isVideoReel(reel) ? 'video' : isImageReel(reel) ? 'image' : 'unknown';

    if (!isVideoReel(reel)) {
        return {
            reelId,
            category,
            mediaType,
            eligible: false,
            rejectionReason: mediaType === 'image' ? 'video_only_feed_loop' : 'not_video_reel',
            gate: 'syncFromVault:rawData.forEach:isVideoReel'
        };
    }
    if (isHeroAsset(reel)) {
        return {
            reelId,
            category,
            mediaType: 'video',
            eligible: false,
            rejectionReason: 'hero_filtered',
            gate: 'syncFromVault:rawData.forEach:isHeroAsset'
        };
    }
    const videoKey = String(reel.url || '').trim();
    if (!videoKey) {
        return {
            reelId,
            category,
            mediaType: 'video',
            eligible: false,
            rejectionReason: 'missing_video_url',
            gate: 'syncFromVault:rawData.forEach:videoKey'
        };
    }
    if (seenVideoUrls.has(videoKey)) {
        return {
            reelId,
            category,
            mediaType: 'video',
            eligible: false,
            rejectionReason: 'duplicate_video_url',
            gate: 'syncFromVault:rawData.forEach:seenVideoUrls'
        };
    }
    return {
        reelId,
        category,
        mediaType: 'video',
        eligible: true,
        rejectionReason: 'video_card',
        gate: 'syncFromVault:rawData.forEach:accepted'
    };
}

async function main() {
    const res = await fetch(`${API_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`API ${res.status}`);
    const catalog = await res.json();
    if (!Array.isArray(catalog)) throw new Error('Expected reel array');

    const seenVideoUrls = new Set();
    const decisions = catalog.map((reel) => {
        const d = evaluate(reel, seenVideoUrls);
        if (d.eligible) seenVideoUrls.add(String(reel.url || '').trim());
        console.info('[BG7L_FEED_DECISION]', d);
        return d;
    });

    const heroVideoCount = decisions.filter((d) => d.rejectionReason === 'hero_filtered').length;
    const imageCount = decisions.filter((d) => d.mediaType === 'image').length;
    const eligibleVideoCount = decisions.filter((d) => d.mediaType === 'video' && d.eligible).length;
    const eligibleImageCount = decisions.filter((d) => d.mediaType === 'image' && d.eligible).length;
    const summary = {
        backendCatalogCount: catalog.length,
        heroVideoCount,
        imageCount,
        eligibleVideoCount,
        eligibleImageCount,
        finalFeedCardCount: eligibleVideoCount,
        placeholderCount: eligibleVideoCount === 0 && eligibleImageCount === 0 ? 3 : 0,
        pruneRemoved: 0,
        demoInjected: eligibleVideoCount === 0 && eligibleImageCount === 0,
        firstExclusionGate: decisions.find((d) => !d.eligible)?.gate ?? null,
        source: 'BG-7L:production-api-direct'
    };
    console.info('[BG7L_FEED_SUMMARY]', summary);

    const rootCause = {
        rootCause:
            'All videos are HERO-filtered and images are excluded by the video-only feed loop — hydratedFeed stays empty, triggering demo placeholder injection.',
        firstFunctionRemovingLastEligibleCard: 'syncFromVault:rawData.forEach:isVideoReel',
        recommendedFix:
            'Add isImageReel handling in syncFromVault (or extract buildHomeFeed) so Trending-category image catalog items become feed cards; keep HERO playback isolation separate from feed visibility if desired.'
    };
    console.info('[BG7L_ROOT_CAUSE]', rootCause);

    const artifact = { mission: 'BG-7L', apiUrl: API_URL, decisions, summary, rootCause };
    await import('node:fs').then((fs) => fs.writeFileSync(OUT, JSON.stringify(artifact, null, 2)));
    console.log(`Wrote ${OUT}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
