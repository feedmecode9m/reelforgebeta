#!/usr/bin/env node
/**
 * Theater All Episodes poster contract — viewer card presentation only.
 *
 * Production last-mile cases (REAL asset IDs):
 *   A. absolute https://…/thumbs/{id}.png preserved byte-for-byte
 *   B. inventory .png wins — never invent .jpg over real PNG art
 *   C. "/thumbs/https://…/thumbs/{id}.png" repaired (no double-prefix)
 *   D. UUID-only cold fallback "/thumbs/{id}.jpg" when no inventory
 *   E. EpisodeChip resolveMediaForRender yields the same browser-loadable URL
 *
 * Also covers: package art passthrough, multi-episode identity, frozen boundaries.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');

/** Real production assets (Netlify /api/reels). */
const PROD_PNG_ID = 'e1f08f0f-954f-4c39-848b-9f3fc72b5d02';
const PROD_PNG_ABS = `https://strong-lolly-a9fcb4.netlify.app/thumbs/${PROD_PNG_ID}.png`;
const PROD_JPG_ID = '201ec6ee-6822-4bda-9295-080beb6f4e35';
const PROD_JPG_ABS = `https://strong-lolly-a9fcb4.netlify.app/thumbs/${PROD_JPG_ID}.jpg`;
const PROD_JPG_B = 'd2aafde7-d7ba-492c-a860-20b51f7f4033';

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const notes = [];

function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else notes.push(`ok: ${msg}`);
}

function read(rel) {
    return fs.readFileSync(path.join(frontendRoot, rel), 'utf8');
}

/** @param {string} url */
function isBrowserLoadablePoster(url) {
    const s = String(url || '');
    if (!s) return false;
    if (s.includes('/thumbs/http://') || s.includes('/thumbs/https://')) return false;
    return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('/thumbs/');
}

async function main() {
    const server = await createServer({
        root: frontendRoot,
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error'
    });

    try {
        const {
            resolveViewerEpisodePosterUrl,
            posterPathFromMediaAssetId,
            repairDoublePrefixedMediaUrl
        } = await server.ssrLoadModule('/src/lib/series/viewerEpisodePoster.js');
        const { resolveMediaUrl } = await server.ssrLoadModule('/src/lib/api/reelContract.js');
        const { resolveMediaForRender, toRelativePosterPath } = await server.ssrLoadModule(
            '/src/components/media/resolveDisplayUrl.js'
        );
        const {
            resolveEpisodeMedia,
            episodeChipPresentation
        } = await server.ssrLoadModule('/src/lib/series/episodeVaultBindingResolver.js');

        const mediaA = PROD_JPG_ID;
        const mediaB = PROD_JPG_B;
        const epA = {
            episodeId: 'ep-a',
            title: 'GATE_TITLE_A',
            episodeNumber: 1,
            mediaAssetId: mediaA,
            reelId: mediaA,
            status: 'published'
        };
        const epB = {
            episodeId: 'ep-b',
            title: 'GATE_TITLE_B',
            episodeNumber: 2,
            mediaAssetId: mediaB,
            reelId: mediaB,
            status: 'published'
        };
        const pngEp = {
            episodeId: 'ep-png',
            title: 'PNG Asset',
            episodeNumber: 1,
            mediaAssetId: PROD_PNG_ID,
            reelId: PROD_PNG_ID,
            status: 'published'
        };

        // ========== A: absolute .png must remain the same absolute URL ==========
        const absolutePng = resolveViewerEpisodePosterUrl({
            episode: { ...pngEp, thumbnailUrl: PROD_PNG_ABS },
            chipThumbnailUrl: '',
            readyVaultAssets: []
        });
        assert(absolutePng === PROD_PNG_ABS, `A: absolute PNG preserved (got ${absolutePng})`);

        const absolutePngChip = resolveMediaForRender(
            absolutePng,
            'poster',
            'EpisodeChip:viewerPoster'
        );
        assert(
            absolutePngChip === PROD_PNG_ABS,
            `A/E: EpisodeChip keeps absolute PNG (got ${absolutePngChip})`
        );

        const absoluteJpg = resolveViewerEpisodePosterUrl({
            episode: { ...epA, thumbnailUrl: PROD_JPG_ABS },
            chipThumbnailUrl: '',
            readyVaultAssets: []
        });
        assert(absoluteJpg === PROD_JPG_ABS, `A: absolute JPG preserved (got ${absoluteJpg})`);
        assert(
            toRelativePosterPath(PROD_PNG_ABS) === PROD_PNG_ABS,
            `A: toRelativePosterPath keeps absolute PNG (got ${toRelativePosterPath(PROD_PNG_ABS)})`
        );
        assert(
            toRelativePosterPath(PROD_JPG_ABS) === PROD_JPG_ABS,
            `A: toRelativePosterPath keeps absolute JPG (got ${toRelativePosterPath(PROD_JPG_ABS)})`
        );
        assert(
            !String(toRelativePosterPath(PROD_PNG_ABS)).startsWith('/thumbs/http'),
            'A: toRelativePosterPath never emits /thumbs/http…'
        );

        // ========== B: inventory .png — never invent .jpg ==========
        const pngInventory = {
            id: PROD_PNG_ID,
            status: 'ready',
            type: 'image',
            url: PROD_PNG_ABS,
            thumbnailUrl: PROD_PNG_ABS,
            thumbnailPath: `/thumbs/${PROD_PNG_ID}.png`
        };
        const fromPngVault = resolveViewerEpisodePosterUrl({
            episode: pngEp,
            chipThumbnailUrl: '',
            readyVaultAssets: [pngInventory]
        });
        assert(
            fromPngVault === PROD_PNG_ABS,
            `B: PNG inventory keeps absolute (got ${fromPngVault})`
        );
        assert(
            !String(fromPngVault).includes(`${PROD_PNG_ID}.jpg`),
            `B: must not invent .jpg when inventory is .png (got ${fromPngVault})`
        );

        const pathOnly = resolveViewerEpisodePosterUrl({
            episode: pngEp,
            chipThumbnailUrl: '',
            readyVaultAssets: [
                {
                    id: PROD_PNG_ID,
                    status: 'ready',
                    thumbnailPath: `/thumbs/${PROD_PNG_ID}.png`
                }
            ]
        });
        assert(
            String(pathOnly).includes(`${PROD_PNG_ID}.png`) &&
                !String(pathOnly).includes(`${PROD_PNG_ID}.jpg`),
            `B: thumbnailPath inventory prefers .png (got ${pathOnly})`
        );

        // ========== C: double-prefix repair ==========
        const corruptPng = `/thumbs/${PROD_PNG_ABS}`;
        assert(
            repairDoublePrefixedMediaUrl(corruptPng) === PROD_PNG_ABS,
            `C: repair strips /thumbs/ + absolute PNG (got ${repairDoublePrefixedMediaUrl(corruptPng)})`
        );
        const repairedFromCorrupt = resolveViewerEpisodePosterUrl({
            episode: pngEp,
            chipThumbnailUrl: corruptPng,
            readyVaultAssets: []
        });
        assert(
            repairedFromCorrupt === PROD_PNG_ABS,
            `C: corrupt chip normalizes to absolute PNG (got ${repairedFromCorrupt})`
        );
        assert(
            !String(repairedFromCorrupt).includes('/thumbs/https://') &&
                !String(repairedFromCorrupt).includes('/thumbs/http://'),
            `C: no double-prefix remains (got ${repairedFromCorrupt})`
        );

        const corruptJpg = `/thumbs/${PROD_JPG_ABS}`;
        const repairedJpg = resolveViewerEpisodePosterUrl({
            episode: epA,
            chipThumbnailUrl: corruptJpg,
            readyVaultAssets: []
        });
        assert(
            repairedJpg === PROD_JPG_ABS,
            `C: corrupt JPG chip repairs to absolute (got ${repairedJpg})`
        );

        // ========== D: UUID-only cold fallback ==========
        const relativeIdentity = posterPathFromMediaAssetId(mediaA);
        assert(
            relativeIdentity === `/thumbs/${mediaA}.jpg`,
            `D: UUID-only identity path (got ${relativeIdentity})`
        );
        const posterA = resolveViewerEpisodePosterUrl({
            episode: epA,
            chipThumbnailUrl: '',
            readyVaultAssets: []
        });
        const canonical = resolveMediaUrl(relativeIdentity, 'thumbnail', 'validator');
        assert(posterA === canonical, `D: cold fallback uses resolveMediaUrl (got ${posterA})`);
        assert(
            posterA.includes(`/thumbs/${mediaA}.jpg`),
            `D: cold fallback is /thumbs/{id}.jpg (got ${posterA})`
        );
        assert(isBrowserLoadablePoster(posterA), `D: cold fallback browser-loadable (got ${posterA})`);

        // Empty-vault chip presentation still unmatched
        const rA = resolveEpisodeMedia({ episode: epA, readyVaultAssets: [] });
        const chipA = episodeChipPresentation(epA, rA);
        assert(rA.matched === false, 'empty vault does not invent media match');
        assert(!chipA.thumbnailUrl, 'chip presentation empty when unmatched');

        // ========== E: EpisodeChip final URL matches repaired/resolved poster ==========
        const expectedRenderFallback = resolveMediaForRender(
            relativeIdentity,
            'poster',
            'EpisodeChip:viewerPoster'
        );
        assert(
            posterA === expectedRenderFallback,
            `E: EpisodeChip final === cold poster (got ${expectedRenderFallback} vs ${posterA})`
        );

        const repairedChip = resolveMediaForRender(
            repairedFromCorrupt,
            'poster',
            'EpisodeChip:viewerPoster'
        );
        assert(
            repairedChip === PROD_PNG_ABS,
            `E: EpisodeChip renders repaired absolute PNG (got ${repairedChip})`
        );
        assert(
            isBrowserLoadablePoster(repairedChip),
            `E: EpisodeChip URL is browser-loadable (got ${repairedChip})`
        );

        // Package / vault explicit art
        const packageUrl = 'https://cdn.example/art/e1.jpg';
        const withPackage = resolveViewerEpisodePosterUrl({
            episode: { ...epA, episodeEnrichment: { artworkUrl: packageUrl } },
            chipThumbnailUrl: '',
            readyVaultAssets: []
        });
        assert(withPackage === packageUrl, `explicit package art unchanged (got ${withPackage})`);

        const chipExplicit = 'https://cdn.example/chip-explicit.jpg';
        assert(
            resolveViewerEpisodePosterUrl({
                episode: epA,
                chipThumbnailUrl: chipExplicit,
                readyVaultAssets: []
            }) === chipExplicit,
            'chip poster unchanged'
        );

        const mp4AsChip = `https://cdn.example/videos/${mediaA}.mp4`;
        const skippedVideoPoster = resolveViewerEpisodePosterUrl({
            episode: epA,
            chipThumbnailUrl: mp4AsChip,
            readyVaultAssets: []
        });
        assert(
            skippedVideoPoster.includes(`/thumbs/${mediaA}.jpg`),
            `MP4 chip thumb is not used as <img> (got ${skippedVideoPoster})`
        );

        const pngPeer = `https://cdn.example/thumbs/${mediaA}.png`;
        const fromImagePeer = resolveViewerEpisodePosterUrl({
            episode: { mediaAssetId: mediaA },
            chipThumbnailUrl: mp4AsChip,
            readyVaultAssets: [
                {
                    id: mediaA,
                    type: 'video',
                    url: mp4AsChip
                },
                {
                    id: `${mediaA}-still`,
                    type: 'image',
                    url: pngPeer,
                    personal_video_id: mediaA
                }
            ]
        });
        assert(fromImagePeer === pngPeer, `vault JPEG/PNG peer wins over MP4 (got ${fromImagePeer})`);

        const catalogUuid = '03ef898a-989f-42c3-bdbb-67f37338df65';
        const vaultPersonalId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
        const catalogThumb = `https://strong-lolly-a9fcb4.netlify.app/thumbs/${catalogUuid}.jpg`;
        const r2Mp4 = `https://pub.example.r2.dev/prod/${catalogUuid}.mp4`;
        const fromPlaybackAlias = resolveViewerEpisodePosterUrl({
            episode: {
                episodeId: 'ep-arrival',
                title: 'Vic G Arrival',
                episodeNumber: 1,
                mediaAssetId: vaultPersonalId,
                reelId: vaultPersonalId,
                mediaUrl: r2Mp4,
                status: 'published'
            },
            chipThumbnailUrl: '',
            readyVaultAssets: [
                {
                    id: vaultPersonalId,
                    type: 'video',
                    status: 'ready',
                    url: r2Mp4
                },
                {
                    id: catalogUuid,
                    type: 'video',
                    status: 'ready',
                    url: r2Mp4,
                    thumbnailUrl: catalogThumb
                }
            ]
        });
        assert(
            fromPlaybackAlias === catalogThumb,
            `R2 /prod UUID donates catalog still to vault-personal MP4 (got ${fromPlaybackAlias})`
        );
        const inventedFromR2 = resolveViewerEpisodePosterUrl({
            episode: {
                episodeId: 'ep-r2-only',
                title: 'Club Poom',
                episodeNumber: 2,
                mediaAssetId: vaultPersonalId,
                reelId: vaultPersonalId,
                mediaUrl: r2Mp4,
                status: 'published'
            },
            chipThumbnailUrl: '',
            readyVaultAssets: [
                {
                    id: vaultPersonalId,
                    type: 'video',
                    status: 'ready',
                    url: r2Mp4
                }
            ]
        });
        assert(
            inventedFromR2.includes(`/thumbs/${catalogUuid}.jpg`),
            `invent poster uses R2 playback UUID not vault id (got ${inventedFromR2})`
        );

        const vaultBThumb = 'https://cdn.example/thumbs/vault-b.jpg';
        const fromVault = resolveViewerEpisodePosterUrl({
            episode: epB,
            chipThumbnailUrl: '',
            readyVaultAssets: [
                {
                    id: mediaB,
                    status: 'ready',
                    url: 'https://cdn.example/videos/b.mp4',
                    thumbnail: vaultBThumb
                }
            ]
        });
        assert(fromVault === vaultBThumb, `vault poster unchanged (got ${fromVault})`);

        // Multi-episode identity
        const posterB = resolveViewerEpisodePosterUrl({
            episode: epB,
            chipThumbnailUrl: '',
            readyVaultAssets: []
        });
        assert(Boolean(posterA) && Boolean(posterB), 'one + two episode shelves have posters');
        assert(posterA !== posterB, 'distinct posters (no cross-episode assignment)');
        assert(posterB.includes(mediaB), 'B poster keyed by mediaAssetId B');
        assert(String(epA.mediaAssetId) === mediaA, 'mediaAssetId A unchanged');
        assert(String(epB.episodeId) === 'ep-b', 'episodeId B unchanged');

        // Frozen boundaries
        const posterSrc = read('src/lib/series/viewerEpisodePoster.js');
        assert(/resolveMediaUrl/.test(posterSrc), 'viewerEpisodePoster uses resolveMediaUrl');
        assert(
            /repairDoublePrefixedMediaUrl/.test(posterSrc),
            'viewerEpisodePoster exports double-prefix repair'
        );

        const chipSrc = read('src/components/series/EpisodeChip.svelte');
        assert(
            /resolveMediaForRender/.test(chipSrc),
            'EpisodeChip uses resolveMediaForRender for poster img'
        );
        assert(/resolvedPosterUrl/.test(chipSrc), 'EpisodeChip renders resolvedPosterUrl');
        assert(
            /loading="eager"/.test(chipSrc) && /handlePosterError/.test(chipSrc),
            'viewer All Episodes posters load eagerly with jpg/png fallback'
        );
        assert(
            /isVaultVideoMediaUrl/.test(chipSrc),
            'EpisodeChip rejects MP4 URLs as poster images'
        );

        const accordion = read('src/components/series/SeasonAccordion.svelte');
        assert(/resolveViewerEpisodePosterUrl/.test(accordion), 'SeasonAccordion uses viewer poster');

        const resolver = read('src/lib/series/resolveRelatedEpisodes.js');
        assert(
            !/resolveViewerEpisodePosterUrl|posterPathFromMediaAssetId/.test(resolver),
            'resolveRelatedEpisodes not modified for poster presentation'
        );

        const theater = read('src/components/theater/TheaterExperience.svelte');
        assert(/resolveRelatedEpisodes/.test(theater), 'Theater related selection wiring intact');

        if (failures.length) {
            console.error('FAIL validate-theater-episode-poster');
            for (const f of failures) console.error('  -', f);
            process.exitCode = 1;
            return;
        }

        console.log('PASS validate-theater-episode-poster');
        for (const n of notes) console.log(' ', n);
        console.log('\nSamples:', {
            absolutePng,
            fromPngVault,
            repairedFromCorrupt,
            posterA,
            repairedChip
        });
    } finally {
        await server.close();
    }
}

main().catch((err) => {
    console.error('FAIL validate-theater-episode-poster', err);
    process.exitCode = 1;
});
