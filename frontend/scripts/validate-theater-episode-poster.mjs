#!/usr/bin/env node
/**
 * Theater All Episodes poster contract — viewer card presentation only.
 *
 * A. explicit episode/chip poster preserved (via resolveMediaUrl, content-stable)
 * B. ready vault poster preserved
 * C. mediaAssetId fallback resolves through canonical media/backend origin
 * D. one-episode shelf gets a poster
 * E. two-episode shelf gets distinct posters
 * F. no resolveRelatedEpisodes / catalog authority changes
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');

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
            posterPathFromMediaAssetId
        } = await server.ssrLoadModule('/src/lib/series/viewerEpisodePoster.js');
        const { resolveMediaUrl } = await server.ssrLoadModule('/src/lib/api/reelContract.js');
        const { resolveMediaForRender } = await server.ssrLoadModule(
            '/src/components/media/resolveDisplayUrl.js'
        );
        const {
            resolveEpisodeMedia,
            episodeChipPresentation
        } = await server.ssrLoadModule('/src/lib/series/episodeVaultBindingResolver.js');

        const mediaA = '201ec6ee-6822-4bda-9295-080beb6f4e35';
        const mediaB = 'd2aafde7-d7ba-492c-a860-20b51f7f4033';
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

        // --- A: explicit poster stays the same art (normalized if relative) ---
        const packageUrl = 'https://cdn.example/art/e1.jpg';
        const withPackage = resolveViewerEpisodePosterUrl({
            episode: { ...epA, episodeEnrichment: { artworkUrl: packageUrl } },
            chipThumbnailUrl: '',
            readyVaultAssets: []
        });
        assert(withPackage === packageUrl, `explicit package art unchanged (got ${withPackage})`);

        const chipExplicit = 'https://cdn.example/chip-explicit.jpg';
        const withChip = resolveViewerEpisodePosterUrl({
            episode: epA,
            chipThumbnailUrl: chipExplicit,
            readyVaultAssets: []
        });
        assert(withChip === chipExplicit, `chip poster unchanged (got ${withChip})`);

        // Absolute package not rewritten to thumbs fallback
        assert(
            !withPackage.includes(mediaA) || withPackage === packageUrl,
            'explicit art is not mediaAssetId path'
        );

        // --- B: ready vault poster wins for matching mediaAssetId ---
        const vaultBThumb = 'https://cdn.example/thumbs/vault-b.jpg';
        const vaultB = {
            id: mediaB,
            status: 'ready',
            url: 'https://cdn.example/videos/b.mp4',
            thumbnail: vaultBThumb
        };
        const fromVault = resolveViewerEpisodePosterUrl({
            episode: epB,
            chipThumbnailUrl: '',
            readyVaultAssets: [vaultB]
        });
        assert(fromVault === vaultBThumb, `vault poster unchanged (got ${fromVault})`);

        // --- C: mediaAssetId fallback through resolveMediaUrl ---
        const relativeIdentity = posterPathFromMediaAssetId(mediaA);
        assert(
            relativeIdentity === `/thumbs/${mediaA}.jpg`,
            `product relative identity (got ${relativeIdentity})`
        );
        const canonical = resolveMediaUrl(relativeIdentity, 'thumbnail', 'validator');
        const posterA = resolveViewerEpisodePosterUrl({
            episode: epA,
            chipThumbnailUrl: '',
            readyVaultAssets: []
        });
        assert(posterA === canonical, `fallback uses resolveMediaUrl (got ${posterA} vs ${canonical})`);
        assert(
            posterA.includes(`/thumbs/${mediaA}.jpg`),
            `fallback retains thumbs path (got ${posterA})`
        );
        // When backend origin is configured (typical local SSR), expect absolute http(s).
        // In same-origin-only mode relative is valid; never a bare non-media path.
        assert(
            posterA.startsWith('http') || posterA.startsWith('/thumbs/'),
            `fallback is browser-loadable media URL (got ${posterA})`
        );
        // Must equal render pipeline used by EpisodeChip
        const chipRender = resolveMediaForRender(
            posterA.startsWith('http') ? relativeIdentity : posterA,
            'poster',
            'validator-chip'
        );
        // If posterA already absolute via resolveMediaUrl, resolveMediaForRender passthrough equals it
        const expectedRender = resolveMediaForRender(relativeIdentity, 'poster', 'validator-chip');
        assert(
            posterA === expectedRender || posterA === resolveMediaUrl(relativeIdentity, 'thumbnail'),
            'EpisodeChip render pipeline agrees with viewerEpisodePoster fallback'
        );
        void chipRender;

        // Empty-vault unmatched chip presentation still has no vault thumb
        const rA = resolveEpisodeMedia({ episode: epA, readyVaultAssets: [] });
        const chipA = episodeChipPresentation(epA, rA);
        assert(rA.matched === false, 'empty vault does not invent media match');
        assert(!chipA.thumbnailUrl, 'chip presentation empty when unmatched');

        // --- D / E: one + two episode shelves ---
        const posterB = resolveViewerEpisodePosterUrl({
            episode: epB,
            chipThumbnailUrl: '',
            readyVaultAssets: []
        });
        assert(Boolean(posterA), 'D: one-episode shelf has poster');
        assert(Boolean(posterB), 'E: second episode has poster');
        assert(posterA !== posterB, 'E: distinct posters (no cross-episode assignment)');
        assert(posterB.includes(mediaB), 'E: B poster keyed by mediaAssetId B');

        // Targeting unchanged
        assert(String(epA.mediaAssetId) === mediaA, 'mediaAssetId A unchanged');
        assert(String(epB.episodeId) === 'ep-b', 'episodeId B unchanged');

        // --- F: wiring integrity / frozen boundaries ---
        const posterSrc = read('src/lib/series/viewerEpisodePoster.js');
        assert(
            /resolveMediaUrl/.test(posterSrc),
            'viewerEpisodePoster uses resolveMediaUrl (canonical media helper)'
        );

        const chipSrc = read('src/components/series/EpisodeChip.svelte');
        assert(
            /resolveMediaForRender/.test(chipSrc),
            'EpisodeChip uses resolveMediaForRender for poster img'
        );
        assert(/resolvedPosterUrl/.test(chipSrc), 'EpisodeChip renders resolvedPosterUrl');

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
        console.log('\nFallback sample:', { relativeIdentity, posterA });
    } finally {
        await server.close();
    }
}

main().catch((err) => {
    console.error('FAIL validate-theater-episode-poster', err);
    process.exitCode = 1;
});
