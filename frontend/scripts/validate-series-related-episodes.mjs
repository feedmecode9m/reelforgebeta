#!/usr/bin/env node
/**
 * Series Identity Graph — Phase 1: resolveRelatedEpisodes contract.
 * Uses Vite SSR for modules that need import.meta.env.
 *
 * Fixtures: Vic G family + STIRRED regression + entry-point symmetry.
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
        const {
            parseHighConfidenceEpisodeTitle
        } = await server.ssrLoadModule('/src/lib/series/vaultSeriesInference.js');
        const {
            resolveRelatedEpisodes,
            buildSeriesViewFromRelated,
            identityTokens,
            sharesEntityTokenPrefix,
            stripEpisodeDecorFromTitle
        } = await server.ssrLoadModule('/src/lib/series/resolveRelatedEpisodes.js');

        const pilotId = '11111111-1111-4111-8111-111111111111';
        const ep2Id = '22222222-2222-4222-8222-222222222222';

        const pilot = {
            id: pilotId,
            name: 'Vic G LA Story',
            title: 'Vic G LA Story',
            url: 'https://cdn.example/videos/vic-g-la-story.mp4',
            type: 'video',
            status: 'ready'
        };

        const ep2 = {
            id: ep2Id,
            name: 'Vic G EPISODE 2 - POOM POOM TUESDAY',
            title: 'Vic G EPISODE 2 - POOM POOM TUESDAY',
            url: 'https://cdn.example/videos/vic-g-ep2.mp4',
            type: 'video',
            status: 'ready'
        };

        const readyVault = [pilot, ep2];

        // Parser improvement
        const parsedEp2 = parseHighConfidenceEpisodeTitle(ep2.name);
        assert(Boolean(parsedEp2), 'EPISODE 2 + subtitle parses');
        assert(parsedEp2?.episodeNumber === 2, 'EPISODE 2 number is 2');
        assert(
            stripEpisodeDecorFromTitle(ep2.name).toLowerCase().includes('vic'),
            'strip episode decor leaves Vic root'
        );

        const tokensPilot = identityTokens(pilot.name);
        const tokensEp2 = identityTokens(ep2.name);
        assert(
            sharesEntityTokenPrefix(tokensPilot, tokensEp2),
            'Vic G pilot + EP2 share entity token prefix'
        );

        // --- Fixture A: seed pilot ---
        const fromPilot = resolveRelatedEpisodes(pilot, {
            readyAssets: readyVault,
            items: readyVault
        });
        assert(fromPilot.members.length >= 2, 'Fixture A: pilot seed → members >= 2');
        assert(
            /vic g la story/i.test(fromPilot.seriesTitle),
            `Fixture A: series title prefers franchise (${fromPilot.seriesTitle})`
        );
        const pilotTitles = fromPilot.members.map((m) => m.title);
        assert(
            pilotTitles.some((t) => /vic g la story/i.test(t)),
            'Fixture A: includes Vic G LA Story'
        );
        assert(
            pilotTitles.some((t) => /episode 2|poom/i.test(t)),
            'Fixture A: includes EPISODE 2 title'
        );

        // --- Fixture B: seed episode 2 ---
        const fromEp2 = resolveRelatedEpisodes(ep2, {
            readyAssets: readyVault,
            items: readyVault
        });
        assert(fromEp2.members.length >= 2, 'Fixture B: EP2 seed → members >= 2');
        assert(
            normalizeTitle(fromEp2.seriesTitle) === normalizeTitle(fromPilot.seriesTitle) ||
                sharesEntityTokenPrefix(
                    identityTokens(fromEp2.seriesTitle),
                    identityTokens(fromPilot.seriesTitle)
                ),
            `Fixture B: same series identity (${fromEp2.seriesTitle} vs ${fromPilot.seriesTitle})`
        );

        // --- Fixture C: Theater drawer simulation ---
        const drawerRelated = {
            ...fromEp2,
            members: (fromEp2.members || []).map((m) => ({ ...m, status: 'published' }))
        };
        const drawerView = buildSeriesViewFromRelated(drawerRelated, null);
        const drawerTitles = (drawerView?.seasons || [])
            .flatMap((s) => s.episodes || [])
            .map((e) => e.title);
        assert(Boolean(drawerView), 'Fixture C: drawer series view builds');
        assert(
            drawerTitles.some((t) => /vic g la story/i.test(t)) &&
                drawerTitles.some((t) => /episode 2|poom/i.test(t)),
            `Fixture C: All Episodes lists both Vic G titles (${drawerTitles.join(' | ')})`
        );
        assert(
            drawerTitles.length >= 2,
            `Fixture C: drawer episode count >= 2 (got ${drawerTitles.length})`
        );

        // --- Fixture D: STIRRED regression ---
        const stirred1 = {
            id: '33333333-3333-4333-8333-333333333333',
            name: 'STIRRED 1',
            url: 'https://cdn.example/videos/stirred-1.mp4',
            type: 'video',
            status: 'ready'
        };
        const stirred2 = {
            id: '44444444-4444-4444-8444-444444444444',
            name: 'STIRRED 2 Motherland',
            url: 'https://cdn.example/videos/stirred-2.mp4',
            type: 'video',
            status: 'ready'
        };
        const stirredPool = [stirred1, stirred2];
        const stirredParse1 = parseHighConfidenceEpisodeTitle(stirred1.name);
        const stirredParse2 = parseHighConfidenceEpisodeTitle(stirred2.name);
        assert(stirredParse1?.episodeNumber === 1, 'Fixture D: STIRRED 1 episode number');
        assert(
            stirredParse2 && /stirred/i.test(String(stirredParse2.seriesTitle || '')),
            'Fixture D: STIRRED franchise parse still works'
        );
        const fromStirred = resolveRelatedEpisodes(stirred1, { readyAssets: stirredPool });
        assert(
            fromStirred.members.length >= 2 ||
                fromStirred.members.some((m) => /stirred/i.test(m.title)),
            'Fixture D: STIRRED related members resolve'
        );

        // --- Fixture E: entry-point symmetry ---
        const titlesA = new Set(fromPilot.members.map((m) => normalizeTitle(m.title)));
        const titlesB = new Set(fromEp2.members.map((m) => normalizeTitle(m.title)));
        const sameSet =
            titlesA.size === titlesB.size && [...titlesA].every((t) => titlesB.has(t));
        assert(sameSet, 'Fixture E: same ready vault snapshot → identical member title set');

        // --- Wiring guards ---
        const theater = read('src/components/theater/TheaterExperience.svelte');
        assert(/resolveRelatedEpisodes/.test(theater), 'TheaterExperience wires resolveRelatedEpisodes');
        assert(/drawerSeriesView|seriesView/.test(theater), 'Theater passes drawer series view');

        const drawer = read('src/components/series/SeriesDrawer.svelte');
        assert(
            /buildSeriesViewFromRelated|resolveRelatedEpisodes/.test(drawer),
            'SeriesDrawer uses related union'
        );
        assert(/export let seedAsset/.test(drawer), 'SeriesDrawer accepts seedAsset');

        const resolverSrc = read('src/lib/series/resolveRelatedEpisodes.js');
        assert(/export function resolveRelatedEpisodes/.test(resolverSrc), 'resolver export present');
        assert(
            /export function buildSeriesViewFromRelated/.test(resolverSrc),
            'buildSeriesViewFromRelated export'
        );

        const heroBridge = read('src/lib/hero/heroAssetBridge.js');
        assert(
            !/resolveRelatedEpisodes/.test(heroBridge),
            'Hero Vault bridge does not call resolveRelatedEpisodes'
        );
        const theaterPlayback = read('src/lib/media/theaterPlayback.js');
        assert(
            !/resolveRelatedEpisodes/.test(theaterPlayback),
            'playback path not coupled to series resolver'
        );

        const build = spawnSync('npm', ['run', 'build'], {
            cwd: frontendRoot,
            encoding: 'utf8',
            env: process.env,
            maxBuffer: 10 * 1024 * 1024
        });
        assert(build.status === 0, 'npm run build passes');
        if (build.status !== 0) {
            failures.push(`build: ${(build.stderr || build.stdout || '').slice(-500)}`);
        }

        if (failures.length) {
            console.error('FAIL validate-series-related-episodes');
            for (const f of failures) console.error('  -', f);
            console.error('\nDebug Fixture A:', JSON.stringify(fromPilot, null, 2));
            console.error('Debug Fixture B:', JSON.stringify(fromEp2, null, 2));
            process.exitCode = 1;
            return;
        }

        console.log('PASS validate-series-related-episodes');
        for (const n of notes) console.log(' ', n);
        console.log('\nVic G from pilot:', {
            seriesTitle: fromPilot.seriesTitle,
            identity: fromPilot.identity,
            members: fromPilot.members.map((m) => `${m.episodeNumber}. ${m.title}`)
        });
        console.log('Vic G from ep2:', {
            seriesTitle: fromEp2.seriesTitle,
            identity: fromEp2.identity,
            members: fromEp2.members.map((m) => `${m.episodeNumber}. ${m.title}`)
        });
    } finally {
        await server.close();
    }
}

main().catch((err) => {
    console.error('FAIL validate-series-related-episodes', err);
    process.exit(1);
});
