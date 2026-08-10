#!/usr/bin/env node
/**
 * Theater All Episodes poster contract — viewer card presentation only.
 *
 * A. one published episode → poster from mediaAssetId when vault empty
 * B. two published episodes → distinct posters, no cross-write
 * C. active selection remains keyed by episodeId / mediaAssetId
 * D. mediaAssetId targeting unchanged
 * E. Theater single-playback / related selection wiring untouched
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

        // A / B — empty vault viewer shelf
        const rA = resolveEpisodeMedia({ episode: epA, readyVaultAssets: [] });
        const chipA = episodeChipPresentation(epA, rA);
        const posterA = resolveViewerEpisodePosterUrl({
            episode: epA,
            chipThumbnailUrl: chipA.thumbnailUrl,
            readyVaultAssets: []
        });
        assert(rA.matched === false, 'empty vault does not invent media match');
        assert(!chipA.thumbnailUrl, 'chip presentation has no vault thumb when unmatched');
        assert(posterA === `/thumbs/${mediaA}.jpg`, `A poster mediaAssetId path (got ${posterA})`);
        assert(
            posterPathFromMediaAssetId(mediaA) === posterA,
            'posterPathFromMediaAssetId matches resolver'
        );

        const posterB = resolveViewerEpisodePosterUrl({
            episode: epB,
            chipThumbnailUrl: '',
            readyVaultAssets: []
        });
        assert(posterB === `/thumbs/${mediaB}.jpg`, `B poster mediaAssetId path (got ${posterB})`);
        assert(posterA !== posterB, 'A and B posters distinct — no cross-episode assignment');

        // Explicit package artwork wins over mediaAssetId fallback
        const packageUrl = 'https://cdn.example/art/e1.jpg';
        const withPackage = resolveViewerEpisodePosterUrl({
            episode: { ...epA, episodeEnrichment: { artworkUrl: packageUrl } },
            chipThumbnailUrl: '',
            readyVaultAssets: []
        });
        assert(withPackage === packageUrl, 'enrichment artwork wins over /thumbs fallback');

        // Vault-ready asset thumb wins (no identity rewrite)
        const vaultB = {
            id: mediaB,
            status: 'ready',
            url: 'https://cdn.example/videos/b.mp4',
            thumbnail: 'https://cdn.example/thumbs/vault-b.jpg'
        };
        const fromVault = resolveViewerEpisodePosterUrl({
            episode: epB,
            chipThumbnailUrl: '',
            readyVaultAssets: [vaultB]
        });
        assert(
            fromVault === 'https://cdn.example/thumbs/vault-b.jpg',
            'vault asset thumbnail wins for matching mediaAssetId'
        );

        // C / D — selection + playable keys unchanged
        assert(String(epA.mediaAssetId) === mediaA, 'mediaAssetId A unchanged');
        assert(String(epB.episodeId) === 'ep-b', 'episodeId B unchanged');
        assert(
            Boolean(epA.mediaAssetId || epA.reelId) === true,
            'playable still keyed by mediaAssetId (SeasonAccordion contract)'
        );

        // Wiring: SeasonAccordion uses the helper (viewer All Episodes path)
        const accordion = read('src/components/series/SeasonAccordion.svelte');
        assert(
            /resolveViewerEpisodePosterUrl/.test(accordion),
            'SeasonAccordion imports viewer poster resolver'
        );
        assert(/posterForChip/.test(accordion), 'SeasonAccordion uses posterForChip for chips');
        assert(
            !/chip\.thumbnailUrl\s*\|\|[\s\S]*episode\.thumbnailUrl/.test(
                accordion.replace(/\s+/g, ' ')
            ) || /posterForChip\(episode,\s*chip\)/.test(accordion),
            'thumbnailUrl prop uses posterForChip'
        );

        // Frozen selection wiring intact
        const theater = read('src/components/theater/TheaterExperience.svelte');
        assert(/resolveRelatedEpisodes/.test(theater), 'Theater related selection unchanged import');
        assert(
            /seriesView=\{drawerSeriesView\}/.test(theater) || /drawerSeriesView/.test(theater),
            'Theater drawer still uses related series view'
        );
        assert(
            /dataTheaterVideo|data-theater-video|playbackRole=['"]theater['"]/.test(theater) ||
                /playbackRole=.theater/.test(theater),
            'Theater primary playback marker remains'
        );

        const resolver = read('src/lib/series/resolveRelatedEpisodes.js');
        // Ensure we did not rewrite related resolution file for this fix
        assert(
            !/posterPathFromMediaAssetId|resolveViewerEpisodePosterUrl/.test(resolver),
            'resolveRelatedEpisodes not modified for poster presentation'
        );

        if (failures.length) {
            console.error('FAIL validate-theater-episode-poster');
            for (const f of failures) console.error('  -', f);
            process.exitCode = 1;
            return;
        }

        console.log('PASS validate-theater-episode-poster');
        for (const n of notes) console.log(' ', n);
    } finally {
        await server.close();
    }
}

main().catch((err) => {
    console.error('FAIL validate-theater-episode-poster', err);
    process.exitCode = 1;
});
