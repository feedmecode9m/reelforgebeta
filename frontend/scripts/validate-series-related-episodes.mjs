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
            stripEpisodeDecorFromTitle,
            looksLikeEpisodeFacingTitle,
            resolveFamilySeriesTitle
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
            /vic g/i.test(fromPilot.seriesTitle) && !looksLikeEpisodeFacingTitle(fromPilot.seriesTitle),
            `Fixture A: series title prefers family name (${fromPilot.seriesTitle})`
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
                ) ||
                (/vic g/i.test(fromEp2.seriesTitle) && /vic g/i.test(fromPilot.seriesTitle)),
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

        const arrivalId = '03ef898a-989f-42c3-bdbb-67f37338df65';
        const arrivalCatalog = {
            id: arrivalId,
            name: '01 ARRIVAL OPEN v1',
            title: '01 ARRIVAL OPEN v1',
            url: `https://pub.example.r2.dev/prod/${arrivalId}.mp4`,
            type: 'video',
            status: 'ready'
        };
        const arrivalAlias = {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            name: 'Vic G 01_ARRIVAL_OPEN_v1',
            title: 'Vic G 01_ARRIVAL_OPEN_v1',
            url: `https://pub.example.r2.dev/prod/${arrivalId}.mp4`,
            type: 'video',
            status: 'ready'
        };
        const vibesId = '3894107e-ae44-43c5-af72-b3f5d5e0ad90';
        const vibes = {
            id: vibesId,
            name: 'VIC G VIBES',
            title: 'VIC G VIBES',
            url: `https://pub.example.r2.dev/prod/${vibesId}.mp4`,
            type: 'video',
            status: 'ready'
        };
        const vibesStill = {
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            name: 'VIC G VIBES',
            title: 'VIC G VIBES',
            url: `https://cdn.example/thumbs/${vibesId}.jpg`,
            type: 'image',
            status: 'ready'
        };
        const dupReady = [arrivalCatalog, arrivalAlias, vibes, vibesStill];
        const dupRelated = resolveRelatedEpisodes(arrivalCatalog, { readyAssets: dupReady });
        const dupTitles = (dupRelated.members || []).map((m) => String(m.title || ''));
        const arrivalHits = dupTitles.filter((t) => /arrival/i.test(t)).length;
        const vibesHits = dupTitles.filter((t) => /vibes/i.test(t)).length;
        assert(arrivalHits === 1, `Arrival Open listed once (got ${arrivalHits}: ${dupTitles.join(' | ')})`);
        assert(vibesHits <= 1, `VIC G VIBES listed at most once (got ${vibesHits}: ${dupTitles.join(' | ')})`);
        const { buildVicGSeriesPackage } = await server.ssrLoadModule(
            '/src/lib/series/vicGSeriesPackage.js'
        );
        const packageRelated = {
            seriesId: 'series-vic-g',
            seriesTitle: 'Vic G',
            members: [
                {
                    assetId: arrivalAlias.id,
                    reelId: arrivalAlias.id,
                    title: 'Vic G 01_ARRIVAL_OPEN_v1',
                    episodeNumber: 1,
                    seasonNumber: 1,
                    mediaUrl: arrivalAlias.url,
                    thumbnailUrl: '',
                    source: 'vault',
                    fromVault: true
                },
                {
                    assetId: vibes.id,
                    reelId: vibes.id,
                    title: 'VIC G VIBES',
                    episodeNumber: 3,
                    seasonNumber: 1,
                    mediaUrl: vibes.url,
                    thumbnailUrl: '',
                    source: 'vault',
                    fromVault: true
                }
            ]
        };
        const packageView = buildSeriesViewFromRelated(packageRelated, buildVicGSeriesPackage());
        const packageTitles = (packageView?.seasons || [])
            .flatMap((s) => s.episodes || [])
            .map((e) => String(e.title || ''));
        const pkgArrival = packageTitles.filter((t) => /arrival/i.test(t)).length;
        const pkgVibes = packageTitles.filter((t) => /vibes/i.test(t)).length;
        assert(
            pkgArrival === 1,
            `Drawer+Vic G package: Arrival once (got ${pkgArrival}: ${packageTitles.join(' | ')})`
        );
        assert(
            pkgVibes === 1,
            `Drawer+Vic G package: VIBES once (got ${pkgVibes}: ${packageTitles.join(' | ')})`
        );
        assert(
            normalizeTitle(packageView?.title) === 'vic g',
            `Drawer+Vic G package heading is Family name (got ${packageView?.title})`
        );
        const arrivalFacing = resolveFamilySeriesTitle({
            relatedTitle: 'Vic G 01_ARRIVAL_OPEN_v1',
            catalogTitle: 'Vic G',
            familyLabels: ['Vic G'],
            creatorConfirmedCatalog: true
        });
        assert(
            arrivalFacing === 'Vic G',
            `Family title rejects episode Master Edit heading (got ${arrivalFacing})`
        );
        const {
            isUnsafeHeroFilenameTitle
        } = await server.ssrLoadModule('/src/lib/hero/heroTitleIntelligence.js');
        const {
            isUnsafeViewerCardTitle
        } = await server.ssrLoadModule('/src/lib/feed/viewerMediaIdentity.js');
        const copyName = 'copy D737BE01-CAEC-4CBC-B9A1-01EAB6157BCF';
        assert(isUnsafeHeroFilenameTitle(copyName), 'copy UUID upload stem is unsafe hero title');
        assert(isUnsafeViewerCardTitle(copyName), 'copy UUID upload stem is unsafe viewer title');
        assert(
            looksLikeEpisodeFacingTitle(copyName),
            'copy UUID must not become All Episodes family heading'
        );
        const copyFamily = resolveFamilySeriesTitle({
            relatedTitle: copyName,
            catalogTitle: 'Vic G',
            familyLabels: ['Vic G'],
            seedTitle: copyName,
            creatorConfirmedCatalog: true
        });
        assert(
            copyFamily === 'Vic G',
            `Family heading ignores copy UUID seed (got ${copyFamily})`
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
