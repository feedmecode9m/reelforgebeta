#!/usr/bin/env node
/**
 * Public series cold-viewer media resolve for catalog-bound published reels.
 *
 * Proves: published episode with reelId can resolve against /api/reels-shaped
 * ready assets when personal Hero Vault is empty — the condition that produced
 * "ASSET UNAVAILABLE" on the episode guide while shelf still said 1 playable.
 *
 * Does not mutate Phase 1/2 membership or catalog seed.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
}

const bag = new Map();
globalThis.localStorage = {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => bag.set(String(k), String(v)),
    removeItem: (k) => bag.delete(k),
    clear: () => bag.clear()
};
globalThis.window = {
    localStorage: globalThis.localStorage,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true
};

const REEL = '615e0eae-47b4-468a-b6dd-a6846b464846';

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});

try {
    const binding = await vite.ssrLoadModule('/src/lib/series/episodeVaultBindingResolver.js');
    const types = await vite.ssrLoadModule('/src/lib/series/seriesTypes.js');

    const episode = {
        episodeId: 'ep-series-stirred-gate-s1e4',
        episodeNumber: 1,
        title: 'MICROS STIRRED V1',
        status: 'published',
        reelId: REEL,
        mediaAssetId: null
    };

    // Empty vault → guide would show ASSET UNAVAILABLE
    const empty = binding.resolveEpisodeMedia({ episode, readyVaultAssets: [] });
    const emptyChip = binding.episodeChipPresentation(episode, empty);
    assert(empty.matched === false, 'empty vault unmatched');
    assert(empty.bindingLabel === 'Asset unavailable', 'empty vault label');
    assert(emptyChip.playable === false, 'empty vault chip not playable');
    assert(
        types.episodeIsPubliclyPlayable(episode) === true,
        'catalog still publicly playable with reelId'
    );

    // Public API reel mapped as ready asset (SeriesPublicPage merge path)
    const apiReady = [
        {
            id: REEL,
            mediaAssetId: REEL,
            name: 'MICROS STIRRED V1',
            title: 'MICROS STIRRED V1',
            url: 'https://example.r2.dev/prod/615e0eae.mp4',
            videoUrl: 'https://example.r2.dev/prod/615e0eae.mp4',
            thumbnailUrl: 'https://example.test/thumbs/615e0eae.jpg',
            status: 'ready',
            type: 'image',
            validated: true
        }
    ];
    const hit = binding.resolveEpisodeMedia({ episode, readyVaultAssets: apiReady });
    const hitChip = binding.episodeChipPresentation(episode, hit);
    assert(hit.matched === true, 'bound reelId matches API ready asset');
    assert(hit.assetId === REEL, `assetId is reel id (got ${hit.assetId})`);
    assert(hit.mediaUrl.includes('615e0eae') || hit.mediaUrl.includes('mp4'), 'mediaUrl from reel.url');
    assert(hitChip.playable === true, 'chip playable after public reel merge');
    assert(
        hitChip.bindingLabel !== 'Asset unavailable',
        `bindingLabel not ASSET UNAVAILABLE (got ${hitChip.bindingLabel})`
    );

    // Shelf-style fallback without resolver match
    const shelfPlayable = emptyChip.playable || Boolean(episode.mediaAssetId || episode.reelId);
    assert(shelfPlayable === true, 'shelf playable or reelId fallback');

    const guidePlayable = hitChip.playable || types.episodeIsPubliclyPlayable(episode);
    assert(guidePlayable === true, 'guide playable with merge + public catalog');

    if (failures.length) {
        console.error('FAIL validate-public-series-catalog-reel-media');
        for (const f of failures) console.error(' -', f);
        process.exit(1);
    }
    console.log('PASS validate-public-series-catalog-reel-media');
} finally {
    await vite.close();
}
