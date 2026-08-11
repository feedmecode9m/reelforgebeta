#!/usr/bin/env node
/**
 * Hero poster / imageUrl contract — production double-prefix + inventory extensions.
 *
 * Covers the production failure:
 *   absolute thumb → resolveUserPosterUrl → `/thumbs/https://…/thumbs/{id}.jpg`
 *   then resolveHeroBackgroundAsset imageUrl / HERO_ROUTE diagnostics.
 *
 * Cases:
 *   A absolute PNG preserved
 *   B absolute JPG preserved
 *   C relative /thumbs/… preserved / browser-loadable
 *   D double-prefixed input repaired
 *   E R2 absolute MP4 unchanged
 *   F resolveUserPosterUrl is the catalog-path normalizer hero vault registry uses
 *   G real production asset 3894107e-ae44-43c5-af72-b3f5d5e0ad90
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');

const PROD_HOST = 'https://strong-lolly-a9fcb4.netlify.app';
/** Real production hero asset id from live HERO_ROUTE logs */
const HERO_ID = '3894107e-ae44-43c5-af72-b3f5d5e0ad90';
const PROD_JPG = `${PROD_HOST}/thumbs/${HERO_ID}.jpg`;
const PROD_PNG = `${PROD_HOST}/thumbs/e1f08f0f-954f-4c39-848b-9f3fc72b5d02.png`;
const R2_MP4 = `https://pub-cb178488b1d4413988778e56a7d51439.r2.dev/prod/${HERO_ID}.mp4`;
const CORRUPT_JPG = `/thumbs/${PROD_JPG}`;
const CORRUPT_PNG = `/thumbs/${PROD_PNG}`;

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const notes = [];

function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else notes.push(`ok: ${msg}`);
}

/** @param {string} url */
function isDoublePrefixed(url) {
    const s = String(url || '');
    return s.includes('/thumbs/http://') || s.includes('/thumbs/https://');
}

async function main() {
    const server = await createServer({
        root: frontendRoot,
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error'
    });

    try {
        const { resolveUserPosterUrl } = await server.ssrLoadModule('/src/lib/vaultMedia.js');
        const { resolveHeroPlaybackUrl, pickHeroBackgroundMediaUrl } = await server.ssrLoadModule(
            '/src/lib/hero/heroPlaybackUrl.js'
        );
        const {
            normalizeHeroAssetRecord,
            resolveHeroAssetById
        } = await server.ssrLoadModule('/src/lib/hero/heroAssetBridge.js');
        const { resolveHeroBackgroundAsset } = await server.ssrLoadModule(
            '/src/lib/hero/heroIntelligence.js'
        );

        // ========== A / B: absolute PNG / JPG via resolveUserPosterUrl ==========
        const posterPng = resolveUserPosterUrl(PROD_PNG);
        assert(posterPng === PROD_PNG, `A: absolute PNG preserved (got ${posterPng})`);
        assert(!isDoublePrefixed(posterPng || ''), 'A: no double-prefix for PNG');

        const posterJpg = resolveUserPosterUrl(PROD_JPG);
        assert(posterJpg === PROD_JPG, `B: absolute JPG preserved (got ${posterJpg})`);
        assert(!isDoublePrefixed(posterJpg || ''), 'B: no double-prefix for JPG');

        // ========== C: relative thumbs ==========
        const rel = `/thumbs/${HERO_ID}.jpg`;
        const posterRel = resolveUserPosterUrl(rel);
        assert(posterRel === rel, `C: relative /thumbs/ preserved (got ${posterRel})`);
        assert(!isDoublePrefixed(posterRel || ''), 'C: relative not double-prefixed');

        // ========== D: double-prefix repair ==========
        const repairedJpg = resolveUserPosterUrl(CORRUPT_JPG);
        assert(
            repairedJpg === PROD_JPG,
            `D: corrupt JPG peels to absolute (got ${repairedJpg})`
        );
        assert(!isDoublePrefixed(repairedJpg || ''), 'D: repaired JPG clean');

        const repairedPng = resolveUserPosterUrl(CORRUPT_PNG);
        assert(
            repairedPng === PROD_PNG,
            `D: corrupt PNG peels to absolute (got ${repairedPng})`
        );

        const playbackRepair = resolveHeroPlaybackUrl(CORRUPT_JPG, {
            backendOrigin: PROD_HOST,
            silent: true
        });
        assert(
            playbackRepair === PROD_JPG,
            `D: resolveHeroPlaybackUrl repairs corrupt (got ${playbackRepair})`
        );
        assert(!isDoublePrefixed(playbackRepair), 'D: playback repair not double-prefixed');

        // ========== E: R2 absolute MP4 unchanged ==========
        const picked = pickHeroBackgroundMediaUrl({
            serverMediaUrl: R2_MP4,
            catalogMediaUrl: `/videos/${HERO_ID}.mp4`
        });
        assert(picked.mediaUrl === R2_MP4, `E: pick prefers R2 absolute (got ${picked.mediaUrl})`);
        const playMp4 = resolveHeroPlaybackUrl(R2_MP4, { silent: true });
        assert(playMp4 === R2_MP4, `E: playback leaves R2 MP4 absolute (got ${playMp4})`);

        // ========== F / G: hero asset bridge + background asset resolution ==========
        const vaultRow = {
            id: HERO_ID,
            type: 'video/mp4',
            url: R2_MP4,
            thumbnailUrl: PROD_JPG,
            title: 'Hero prod fixture'
        };
        const normalized = normalizeHeroAssetRecord(vaultRow);
        assert(Boolean(normalized), 'F: normalizeHeroAssetRecord accepts production row');
        assert(
            normalized?.thumbnailUrl === PROD_JPG,
            `F: registry thumbnailUrl absolute not double-prefixed (got ${normalized?.thumbnailUrl})`
        );
        assert(
            !isDoublePrefixed(normalized?.thumbnailUrl || ''),
            'F: registry thumbnail clean'
        );
        assert(normalized?.mediaUrl === R2_MP4, `F: mediaUrl R2 absolute (got ${normalized?.mediaUrl})`);

        const byId = resolveHeroAssetById(HERO_ID, [vaultRow]);
        assert(byId?.assetId === HERO_ID, 'G: resolveHeroAssetById finds production id');
        assert(
            byId?.thumbnailUrl === PROD_JPG,
            `G: byId thumbnailUrl correct (got ${byId?.thumbnailUrl})`
        );

        // resolveHeroBackgroundAsset: server presentation media + absolute poster inventory
        const resolved = resolveHeroBackgroundAsset(
            {
                heroAssetId: HERO_ID,
                backgroundSource: 'custom_video',
                mediaUrl: R2_MP4,
                posterUrl: PROD_JPG
            },
            [vaultRow],
            { log: false }
        );
        assert(
            resolved.mediaUrl === R2_MP4 || resolved.videoUrl === R2_MP4,
            `G: hero media/video absolute R2 (media=${resolved.mediaUrl} video=${resolved.videoUrl})`
        );
        assert(
            resolved.imageUrl === PROD_JPG,
            `G: imageUrl absolute JPG not double-prefixed (got ${resolved.imageUrl})`
        );
        assert(!isDoublePrefixed(resolved.imageUrl || ''), 'G: HERO_ROUTE imageUrl clean');
        assert(!isDoublePrefixed(resolved.mediaUrl || ''), 'G: mediaUrl clean');

        // Corrupt poster hint healed through finalize (playback peel)
        const healed = resolveHeroBackgroundAsset(
            {
                heroAssetId: HERO_ID,
                backgroundSource: 'custom_video',
                mediaUrl: R2_MP4,
                posterUrl: CORRUPT_JPG
            },
            [],
            { log: false }
        );
        assert(
            healed.imageUrl === PROD_JPG,
            `G: corrupt posterUrl healed (got ${healed.imageUrl})`
        );
        assert(!isDoublePrefixed(healed.imageUrl || ''), 'G: healed imageUrl clean');

        // PNG inventory must not become invent .jpg when absolute PNG provided
        const pngRow = {
            id: HERO_ID,
            type: 'video/mp4',
            url: R2_MP4,
            thumbnailUrl: PROD_PNG
        };
        const pngNorm = normalizeHeroAssetRecord(pngRow);
        assert(
            pngNorm?.thumbnailUrl === PROD_PNG && !String(pngNorm?.thumbnailUrl).includes(`${HERO_ID}.jpg`),
            `PNG inventory preserved (got ${pngNorm?.thumbnailUrl})`
        );

        if (failures.length) {
            console.error('FAIL validate-hero-poster-url');
            for (const f of failures) console.error('  -', f);
            process.exitCode = 1;
            return;
        }

        console.log('PASS validate-hero-poster-url');
        for (const n of notes) console.log(' ', n);
        console.log('\nCorrected production sample:', {
            heroAssetId: HERO_ID,
            mediaUrl: resolved.mediaUrl,
            videoUrl: resolved.videoUrl,
            imageUrl: resolved.imageUrl
        });
    } finally {
        await server.close();
    }
}

main().catch((err) => {
    console.error('FAIL validate-hero-poster-url', err);
    process.exitCode = 1;
});
