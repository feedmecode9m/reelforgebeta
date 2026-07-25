#!/usr/bin/env node
/**
 * BG-7M — validate buildHomeFeed rules against live production catalog (standalone, no Vite).
 */
const API_URL =
    process.env.API_URL || 'https://reelforge-deploy-production.up.railway.app/api/reels';
const OUT = process.env.OUT || '/tmp/bg-7m-build-home-feed-proof.json';

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
    const category = String(reel?.category || '').trim().toUpperCase();
    return category === 'HERO';
}

function isDeletedReel(reel) {
    return String(reel?.status || '').trim().toLowerCase() === 'deleted' || reel?.deleted === true;
}

function evaluateFeedEligibility(reel, personalThumbnailReelIds = new Set()) {
    if (isDeletedReel(reel)) return { eligible: false, rejectionReason: 'deleted' };
    if (isImageReel(reel)) {
        const reelId = String(reel?.id || '').trim();
        if (!reelId || !personalThumbnailReelIds.has(reelId)) {
            return { eligible: false, rejectionReason: 'catalog_image_no_vault_ownership' };
        }
        return { eligible: true, rejectionReason: 'thumbnail_card' };
    }
    if (isVideoReel(reel)) {
        return {
            eligible: true,
            rejectionReason: isHeroAsset(reel) ? 'hero_video_card' : 'video_card'
        };
    }
    return { eligible: false, rejectionReason: 'unknown_media_type' };
}

function buildHomeFeed(catalog, personalThumbnailReelIds = new Set()) {
    const seen = new Set();
    const decisions = [];
    let cardCount = 0;
    for (const reel of catalog) {
        const mediaType = isVideoReel(reel) ? 'video' : isImageReel(reel) ? 'image' : 'unknown';
        const eligibility = evaluateFeedEligibility(reel, personalThumbnailReelIds);
        let eligible = eligibility.eligible;
        let rejectionReason = eligibility.rejectionReason;
        if (eligible && mediaType === 'video') {
            const key = String(reel.url || '').trim();
            if (!key) {
                eligible = false;
                rejectionReason = 'missing_video_url';
            } else if (seen.has(key)) {
                eligible = false;
                rejectionReason = 'duplicate_video_url';
            } else {
                seen.add(key);
            }
        }
        if (eligible) cardCount += 1;
        decisions.push({
            reelId: reel.id,
            category: reel.category,
            mediaType,
            eligible,
            rejectionReason,
            gate:
                rejectionReason === 'catalog_image_no_vault_ownership'
                    ? 'buildHomeFeed:catalogImageVaultMembership'
                    : 'buildHomeFeed'
        });
    }
    return { cardCount, decisions };
}

async function main() {
    const res = await fetch(`${API_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`API ${res.status}`);
    const catalog = await res.json();
    const freshSession = buildHomeFeed(catalog, new Set());
    const { cardCount, decisions } = freshSession;
    const imageRejected = decisions.filter(
        (d) => d.rejectionReason === 'catalog_image_no_vault_ownership'
    ).length;
    const summary = {
        mission: 'BG-7I-C',
        backendCatalogCount: catalog.length,
        heroVideoCount: decisions.filter((d) => d.rejectionReason === 'hero_video_card').length,
        imageCount: decisions.filter((d) => d.mediaType === 'image').length,
        catalogImagesRejectedNoVaultOwnership: imageRejected,
        eligibleVideoCount: decisions.filter((d) => d.mediaType === 'video' && d.eligible).length,
        eligibleImageCount: decisions.filter((d) => d.mediaType === 'image' && d.eligible).length,
        buildHomeFeedCardCount: cardCount,
        finalFeedCardCount: cardCount,
        placeholderCount: cardCount === 0 ? 3 : 0,
        placeholdersInjected: cardCount === 0,
        freshSessionMembership: 'empty personal_thumbnail_reel_ids'
    };
    for (const d of decisions) console.info('[BG7L_FEED_DECISION]', d);
    console.info('[BG7M_BUILD_HOME_FEED]', summary);
    console.info('[BG7I-C_FEED_ELIGIBILITY]', {
        gate: 'buildHomeFeed:catalogImageVaultMembership',
        catalogImagesBlocked: imageRejected,
        feedCardsAfterGate: cardCount,
        expectedFreshSession: 'no isCatalogImage cards without vault membership'
    });
    await import('node:fs').then((fs) =>
        fs.writeFileSync(OUT, JSON.stringify({ mission: 'BG-7I-C', summary, decisions }, null, 2))
    );
    console.log(`Wrote ${OUT}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
