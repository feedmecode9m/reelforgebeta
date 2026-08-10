#!/usr/bin/env node
/**
 * Phase 2 — Theater Viewer Series Experience acceptance.
 *
 * Viewer opens Theater → All Episodes → vault-inferred family, ordered.
 * Catalog enriches but never gates vault completeness.
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

function titlesOf(view) {
    return (view?.seasons || [])
        .flatMap((s) => s.episodes || [])
        .map((e) => String(e.title || ''));
}

function orderedEpNumbers(view) {
    return (view?.seasons || [])
        .slice()
        .sort((a, b) => a.seasonNumber - b.seasonNumber)
        .flatMap((s) =>
            [...(s.episodes || [])]
                .sort((a, b) => a.episodeNumber - b.episodeNumber)
                .map((e) => e.episodeNumber)
        );
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
            resolveRelatedEpisodes,
            buildSeriesViewFromRelated,
            normalizeHeroVaultSeriesLabel
        } = await server.ssrLoadModule('/src/lib/series/resolveRelatedEpisodes.js');

        // --- Label normalization ---
        const sxe = normalizeHeroVaultSeriesLabel('STIRRED S01E01');
        assert(sxe.seriesLabel.toUpperCase() === 'STIRRED', `S01E01 seriesLabel (got ${sxe.seriesLabel})`);
        assert(sxe.seasonNumber === 1, 'S01E01 seasonNumber');
        assert(sxe.episodeNumber === 1, 'S01E01 episodeNumber');

        const stirred2Label = normalizeHeroVaultSeriesLabel({
            id: 'a',
            name: 'STIRRED 2 Motherland',
            status: 'ready'
        });
        assert(/stirred/i.test(stirred2Label.seriesLabel), 'STIRRED 2 label series');
        assert(stirred2Label.episodeNumber === 2, 'STIRRED 2 episode number');

        // --- Fixture: STIRRED S1E1 / S1E2 ---
        const stirredE1 = {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
            name: 'STIRRED 1',
            title: 'STIRRED 1',
            url: 'https://cdn.example/videos/stirred-1.mp4',
            thumbnailUrl: 'https://cdn.example/thumbs/stirred-1.jpg',
            type: 'video',
            status: 'ready',
            createdAt: '2026-01-01T00:00:00.000Z'
        };
        const stirredE2 = {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
            name: 'STIRRED 2 Motherland',
            title: 'STIRRED 2 Motherland',
            url: 'https://cdn.example/videos/stirred-2.mp4',
            thumbnailUrl: 'https://cdn.example/thumbs/stirred-2.jpg',
            type: 'video',
            status: 'ready',
            createdAt: '2026-01-02T00:00:00.000Z'
        };
        const stirredVault = [stirredE1, stirredE2];
        const stirredRelated = resolveRelatedEpisodes(stirredE1, {
            readyAssets: stirredVault
        });
        assert(stirredRelated.members.length >= 2, 'STIRRED: related members ≥ 2');
        assert(/stirred/i.test(stirredRelated.seriesTitle), 'STIRRED: series title from vault labels');

        const stirredView = buildSeriesViewFromRelated(stirredRelated, null);
        assert(Boolean(stirredView), 'STIRRED: drawer series view');
        assert(/stirred/i.test(String(stirredView?.title || '')), 'STIRRED: series title visible');
        assert(
            (stirredView?.seasons || []).some((s) => s.seasonNumber === 1),
            'STIRRED: season 1 visible'
        );
        const stirredOrder = orderedEpNumbers(stirredView);
        assert(
            stirredOrder[0] === 1 && stirredOrder.includes(2),
            `STIRRED: E1 first then E2 (order ${stirredOrder.join(',')})`
        );
        const stirredTitles = titlesOf(stirredView);
        assert(
            stirredTitles.some((t) => /stirred 1/i.test(t)) &&
                stirredTitles.some((t) => /stirred 2|motherland/i.test(t)),
            `STIRRED: both episodes in drawer (${stirredTitles.join(' | ')})`
        );

        // Selecting E2 yields correct reel id from view
        const e2Ep = (stirredView?.seasons || [])
            .flatMap((s) => s.episodes || [])
            .find((e) => e.episodeNumber === 2);
        assert(
            e2Ep && (String(e2Ep.reelId) === stirredE2.id || String(e2Ep.mediaAssetId) === stirredE2.id),
            'STIRRED: E2 maps to correct reel/media asset'
        );
        assert(
            (stirredView?.tags || []).some((t) => /vault/i.test(String(t))),
            'STIRRED: view tagged vault-inferred'
        );

        // --- Fixture: Vic G pilot / EP2 ---
        const pilot = {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
            name: 'Vic G LA Story',
            url: 'https://cdn.example/videos/vic-pilot.mp4',
            type: 'video',
            status: 'ready'
        };
        const ep2 = {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
            name: 'Vic G EPISODE 2 - POOM POOM TUESDAY',
            url: 'https://cdn.example/videos/vic-ep2.mp4',
            type: 'video',
            status: 'ready'
        };
        const vicVault = [pilot, ep2];
        const fromPilot = resolveRelatedEpisodes(pilot, { readyAssets: vicVault });
        const fromEp2 = resolveRelatedEpisodes(ep2, { readyAssets: vicVault });
        assert(fromPilot.members.length >= 2, 'Vic G: pilot seed family ≥ 2');
        assert(fromEp2.members.length >= 2, 'Vic G: EP2 seed family ≥ 2');
        const vicView = buildSeriesViewFromRelated(fromPilot, null);
        const vicTitles = titlesOf(vicView);
        assert(
            vicTitles.some((t) => /vic g la story/i.test(t)) &&
                vicTitles.some((t) => /episode 2|poom/i.test(t)),
            `Vic G: both titles in viewer drawer (${vicTitles.join(' | ')})`
        );
        const vicOrder = orderedEpNumbers(vicView);
        assert(vicOrder[0] === 1, `Vic G: E1 (pilot) first (order ${vicOrder.join(',')})`);

        // --- Catalog incomplete + vault complete ---
        const incompleteCatalog = {
            id: 'series-stirred-catalog',
            title: 'STIRRED (Catalog Incomplete)',
            seasons: [
                {
                    seasonId: 's1',
                    seasonNumber: 1,
                    title: 'Season 1',
                    episodes: [
                        {
                            episodeId: 'cat-only-e1',
                            episodeNumber: 1,
                            title: 'STIRRED 1',
                            status: 'published',
                            // catalog knows only E1 and lacks media
                            reelId: null,
                            mediaAssetId: null
                        }
                    ]
                }
            ]
        };
        const unionView = buildSeriesViewFromRelated(stirredRelated, incompleteCatalog);
        const unionTitles = titlesOf(unionView);
        assert(
            unionTitles.some((t) => /stirred 1/i.test(t)) &&
                unionTitles.some((t) => /stirred 2|motherland/i.test(t)),
            `catalog incomplete cannot hide vault E2 (${unionTitles.join(' | ')})`
        );
        const e2AfterUnion = (unionView?.seasons || [])
            .flatMap((s) => s.episodes || [])
            .find((e) => e.episodeNumber === 2);
        assert(
            e2AfterUnion &&
                (String(e2AfterUnion.mediaAssetId) === stirredE2.id ||
                    String(e2AfterUnion.reelId) === stirredE2.id),
            'vault E2 reel survives catalog incomplete enrich'
        );

        // --- Wiring: Theater / drawer viewer path ---
        const theater = read('src/components/theater/TheaterExperience.svelte');
        assert(/resolveRelatedEpisodes/.test(theater), 'Theater uses resolveRelatedEpisodes');
        assert(/buildSeriesViewFromRelated/.test(theater), 'Theater builds series view from related');
        assert(/viewerMode=\{true\}/.test(theater), 'Theater drawer viewerMode');
        assert(/seriesDrawerDocked|docked=\{seriesDrawerDocked\}/.test(theater), 'Landscape dock wiring');
        assert(
            /resolvePlayableMediaUrl\(\$activeReel,\s*['"]theater['"]\)/.test(theater),
            'playbackUrl selection preserved on theater video'
        );
        assert(
            !/heroManager|HeroManagerPanel/.test(theater),
            'Theater series path does not import Hero Manager'
        );

        const drawer = read('src/components/series/SeriesDrawer.svelte');
        assert(/viewerMode/.test(drawer), 'SeriesDrawer supports viewerMode');
        assert(/docked/.test(drawer), 'SeriesDrawer supports docked landscape');
        assert(/All Episodes/.test(drawer), 'Drawer uses viewer-facing All Episodes label');
        assert(
            !/Vault-inferred series/.test(drawer),
            'Drawer does not expose internal vault-inferred wording to viewers'
        );
        assert(/data-theater-series-drawer/.test(drawer), 'Drawer has theater series marker');
        assert(/series-shelf|episodeCount|hasViewerBody/.test(drawer), 'Viewer shelf collapses empty chrome');

        const chip = read('src/components/series/EpisodeChip.svelte');
        assert(/viewerMode/.test(chip), 'EpisodeChip viewerMode');
        assert(/episode-card|Now playing|seBadge/.test(chip), 'Viewer episode card with S/E + active');
        assert(!/<video/.test(chip), 'Episode chips never mount <video>');

        const accordion = read('src/components/series/SeasonAccordion.svelte');
        assert(/viewerMode/.test(accordion), 'SeasonAccordion passes viewerMode');
        assert(/flat/.test(accordion), 'SeasonAccordion supports flat single-season shelf');
        assert(!/<video/.test(accordion), 'Season list never mounts <video>');

        const resolverSrc = read('src/lib/series/resolveRelatedEpisodes.js');
        assert(
            /export function normalizeHeroVaultSeriesLabel/.test(resolverSrc),
            'normalizeHeroVaultSeriesLabel exported'
        );
        assert(
            /Vault members first|related members first|Hero Vault \/ related members are the spine/i.test(
                resolverSrc
            ) || /vault-related/.test(resolverSrc),
            'buildSeriesView prioritizes vault/related members'
        );

        // Hero Admin must not be required for this contract
        const heroManager = read('src/components/studio/HeroManagerPanel.svelte');
        assert(
            !/validate-theater-series-viewer|viewerMode=\{true\}/.test(heroManager),
            'Hero Manager not required for viewer series path'
        );

        const relatedVal = spawnSync('npm', ['run', 'validate:series-related-episodes'], {
            cwd: frontendRoot,
            encoding: 'utf8',
            env: process.env,
            maxBuffer: 10 * 1024 * 1024
        });
        assert(relatedVal.status === 0, 'validate:series-related-episodes remains PASS');
        if (relatedVal.status !== 0) {
            failures.push(
                `related-episodes: ${(relatedVal.stderr || relatedVal.stdout || '').slice(-500)}`
            );
        }

        if (failures.length) {
            console.error('FAIL validate-theater-series-viewer');
            for (const f of failures) console.error('  -', f);
            process.exitCode = 1;
            return;
        }

        console.log('PASS validate-theater-series-viewer');
        for (const n of notes) console.log(' ', n);
        console.log('\nSTIRRED drawer:', {
            title: stirredView?.title,
            order: stirredOrder,
            episodes: titlesOf(stirredView)
        });
    } finally {
        await server.close();
    }
}

main().catch((err) => {
    console.error('FAIL validate-theater-series-viewer', err);
    process.exit(1);
});
