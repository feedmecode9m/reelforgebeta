#!/usr/bin/env node
/**
 * Integration hardening — playback derivative + related episodes (no new architecture).
 * Verifies Theater flow contracts compose cleanly with existing ownership / poster-first rules.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
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

function runNpm(script) {
    return spawnSync('npm', ['run', script], {
        cwd: frontendRoot,
        encoding: 'utf8',
        env: process.env,
        maxBuffer: 10 * 1024 * 1024
    });
}

function normalizeTitle(t) {
    return String(t || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

async function main() {
    const server = await createServer({
        root: frontendRoot,
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error'
    });

    try {
        const { resolvePlayableMediaUrl } = await server.ssrLoadModule(
            '/src/lib/media/resolvePlayableMediaUrl.js'
        );
        const { resolveRelatedEpisodes, buildSeriesViewFromRelated } = await server.ssrLoadModule(
            '/src/lib/series/resolveRelatedEpisodes.js'
        );
        const { resolveEpisodeMedia, episodeChipPresentation } = await server.ssrLoadModule(
            '/src/lib/series/episodeVaultBindingResolver.js'
        );

        const pilotId = '11111111-1111-4111-8111-111111111111';
        const ep2Id = '22222222-2222-4222-8222-222222222222';

        const pilot = {
            id: pilotId,
            name: 'Vic G LA Story',
            title: 'Vic G LA Story',
            url: 'https://cdn.example/videos/vic-g-master.mp4',
            playbackUrl: 'https://cdn.example/videos/vic-g.playback.mp4',
            playbackStatus: 'ready',
            type: 'video',
            status: 'ready'
        };
        const ep2 = {
            id: ep2Id,
            name: 'Vic G EPISODE 2 - POOM POOM TUESDAY',
            title: 'Vic G EPISODE 2 - POOM POOM TUESDAY',
            url: 'https://cdn.example/videos/vic-g-ep2-master.mp4',
            playbackUrl: null,
            playbackStatus: 'failed',
            type: 'video',
            status: 'ready'
        };
        const readyVault = [pilot, ep2];

        // --- Vic G both directions ---
        const fromPilot = resolveRelatedEpisodes(pilot, { readyAssets: readyVault });
        const fromEp2 = resolveRelatedEpisodes(ep2, { readyAssets: readyVault });
        assert(fromPilot.members.length >= 2, 'Vic G pilot → family size >= 2');
        assert(fromEp2.members.length >= 2, 'Vic G EP2 → family size >= 2');
        assert(
            normalizeTitle(fromPilot.seriesTitle) === normalizeTitle(fromEp2.seriesTitle),
            `same series identity both directions (${fromPilot.seriesTitle})`
        );
        const viewFromPilot = buildSeriesViewFromRelated(fromPilot, null);
        const drawerTitles = (viewFromPilot?.seasons || [])
            .flatMap((s) => s.episodes || [])
            .map((e) => e.title);
        assert(
            drawerTitles.some((t) => /vic g la story/i.test(t)) &&
                drawerTitles.some((t) => /poom|episode 2/i.test(t)),
            'All Episodes drawer view lists both Vic G titles'
        );

        // Catalog preferred: incomplete catalog gains vault sibling
        const incompleteCatalog = {
            id: 'series-vic-g-la-story',
            title: 'Vic G LA Story',
            seasons: [
                {
                    seasonNumber: 1,
                    episodes: [
                        {
                            episodeId: 'ep-catalog-only-ep2',
                            episodeNumber: 2,
                            title: 'Vic G EPISODE 2 - POOM POOM TUESDAY',
                            status: 'published',
                            reelId: ep2Id,
                            mediaAssetId: ep2Id
                        }
                    ]
                }
            ]
        };
        const unioned = buildSeriesViewFromRelated(fromEp2, incompleteCatalog);
        const unionTitles = (unioned?.seasons || [])
            .flatMap((s) => s.episodes || [])
            .map((e) => String(e.title));
        assert(
            unionTitles.some((t) => /vic g la story/i.test(t)) &&
                unionTitles.some((t) => /episode 2|poom/i.test(t)),
            'catalog incomplete → vault sibling union fills pilot'
        );
        assert(
            (unioned?.seasons?.[0]?.episodes || []).some((e) => e.episodeId === 'ep-catalog-only-ep2'),
            'catalog episode row preferred / retained by id'
        );

        // Chip playability for vault-only related bind (mediaAssetId id lookup)
        for (const ep of unioned.seasons.flatMap((s) => s.episodes)) {
            const media = resolveEpisodeMedia({ episode: ep, readyVaultAssets: readyVault });
            const chip = episodeChipPresentation(ep, media);
            assert(
                chip.playable === true,
                `related/catalog episode playable in drawer: ${ep.title}`
            );
            assert(Boolean(chip.mediaAssetId), `chip mediaAssetId set for ${ep.title}`);
        }

        // Select vault-only → reel id resolvable without new store
        const pilotEpisode = unioned.seasons
            .flatMap((s) => s.episodes)
            .find((e) => /vic g la story/i.test(e.title));
        assert(
            String(pilotEpisode?.reelId || pilotEpisode?.mediaAssetId) === pilotId,
            'select related vault-only pilot resolves to pilot reel id'
        );

        // --- Playback compose: theater uses derivative when ready ---
        assert(
            resolvePlayableMediaUrl(pilot, 'theater', { silent: true }) === pilot.playbackUrl,
            'Theater prefers ready playbackUrl on pilot'
        );
        assert(
            resolvePlayableMediaUrl(ep2, 'theater', { silent: true }) === ep2.url,
            'Theater falls back to master when derivative failed'
        );
        assert(
            resolvePlayableMediaUrl(pilot, 'hero', { silent: true }) === pilot.playbackUrl,
            'Hero prefers ready derivative'
        );
        assert(
            resolvePlayableMediaUrl(pilot, 'download', { silent: true }) === pilot.url,
            'download stays on master'
        );

        // Related open then play: no second ownership layer in playbackOwnership / resolver
        const ownership = read('src/lib/media/playbackOwnership.js');
        assert(
            !/resolveRelatedEpisodes|resolvePlayableMediaUrl/.test(ownership),
            'playback ownership remains independent of series/playback URL resolvers'
        );

        // --- Performance / media load boundaries (static) ---
        const drawer = read('src/components/series/SeriesDrawer.svelte');
        assert(!/MediaRenderer|type="video"/.test(drawer), 'SeriesDrawer does not mount video');
        assert(
            /if \(seriesView\) return null/.test(drawer) || /seriesView\) return null/.test(drawer),
            'SeriesDrawer skips re-resolve when parent supplies seriesView'
        );

        const theater = read('src/components/theater/TheaterExperience.svelte');
        assert(
            /resolvePlayableMediaUrl\(\$activeReel,\s*['"]theater['"]\)/.test(theater),
            'Theater primary uses resolvePlayableMediaUrl theater context'
        );
        assert(
            /resolveRelatedEpisodes|drawerSeriesView/.test(theater),
            'Theater All Episodes uses related resolver / view'
        );
        assert(
            (theater.match(/dataTheaterVideo=\{true\}/g) || []).length === 1,
            'exactly one Theater primary video mount'
        );
        assert(/preload="metadata"/.test(theater), 'Theater primary uses preload metadata only');

        const accordion = read('src/components/series/SeasonAccordion.svelte');
        assert(!/MediaRenderer|type="video"/.test(accordion), 'SeasonAccordion does not mount video');
        const chip = read('src/components/series/EpisodeChip.svelte');
        assert(!/MediaRenderer|<video/.test(chip), 'EpisodeChip uses poster/img only (no video element)');
        assert(/loading="lazy"/.test(chip), 'EpisodeChip thumbnails are lazy');

        const vault = read('src/components/experiences/VaultExperience.svelte');
        assert(/vault-poster-first|previewActive/.test(vault), 'Content vault remains poster-first');
        assert(
            /vaultPreviewPlayUrl|resolvePlayableMediaUrl\(reel,\s*['"]vault_preview['"]\)/.test(vault),
            'vault hover preview may use derivative only when active'
        );

        const heroMgr = read('src/components/studio/HeroManagerPanel.svelte');
        assert(
            /vaultPreviewActive|activeHeroVaultPreviewId/.test(heroMgr),
            'Hero vault previews remain gated (no grid autoplay-all)'
        );

        const mediaRenderer = read('src/components/media/MediaRenderer.svelte');
        assert(/export let autoplay = false/.test(mediaRenderer), 'MediaRenderer autoplay default false');

        // Boundaries
        assert(!/hls\.js|application\/vnd\.apple\.mpegurl/i.test(theater), 'no HLS in Theater path');
        assert(
            !/rewrite catalog|seriesCatalog\.set/.test(read('src/lib/series/resolveRelatedEpisodes.js')),
            'related resolver does not rewrite catalog storage'
        );

        // Nested validators
        for (const script of [
            'validate:series-related-episodes',
            'validate:playback-selection',
            'validate:playback-stability',
            'validate:theater-playback'
        ]) {
            // playback-selection already runs build; series-related-episodes also builds — sequential is heavy
            // Skip nested build-heavy by only running light ones + one build at end for series/playback packages
            if (script === 'validate:playback-selection' || script === 'validate:series-related-episodes') {
                continue;
            }
            const r = runNpm(script);
            assert(r.status === 0, `${script} PASS`);
            if (r.status !== 0) failures.push((r.stderr || r.stdout || '').slice(-300));
        }

        // Full package: series + playback selection (each includes build) — use series only + selection light?
        const seriesVal = runNpm('validate:series-related-episodes');
        assert(seriesVal.status === 0, 'validate:series-related-episodes PASS');
        if (seriesVal.status !== 0) {
            failures.push((seriesVal.stderr || seriesVal.stdout || '').slice(-400));
        }

        // playback selection re-builds — still required for acceptance
        const playVal = runNpm('validate:playback-selection');
        assert(playVal.status === 0, 'validate:playback-selection PASS');
        if (playVal.status !== 0) {
            failures.push((playVal.stderr || playVal.stdout || '').slice(-400));
        }

        if (failures.length) {
            console.error('FAIL validate-integration-hardening');
            for (const f of failures) console.error('  -', f);
            process.exitCode = 1;
            return;
        }

        console.log('PASS validate-integration-hardening');
        for (const n of notes) console.log(' ', n);
        console.log('\nVic G family:', {
            seriesTitle: fromPilot.seriesTitle,
            identity: fromPilot.identity,
            fromPilot: fromPilot.members.map((m) => `${m.episodeNumber}. ${m.title}`),
            fromEp2: fromEp2.members.map((m) => `${m.episodeNumber}. ${m.title}`)
        });
        console.log('Playback:', {
            pilotTheater: resolvePlayableMediaUrl(pilot, 'theater', { silent: true }),
            ep2Theater: resolvePlayableMediaUrl(ep2, 'theater', { silent: true })
        });
    } finally {
        await server.close();
    }
}

main().catch((err) => {
    console.error('FAIL validate-integration-hardening', err);
    process.exit(1);
});
