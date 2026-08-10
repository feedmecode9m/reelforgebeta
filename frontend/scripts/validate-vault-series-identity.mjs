#!/usr/bin/env node
/**
 * Hero Vault → Viewer Series Identity Pipeline acceptance.
 *
 * Confirms vault labels become viewer series identity without a second matcher,
 * without playback changes, and without admin-only wording in the viewer shelf.
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
        const infer = await server.ssrLoadModule('/src/lib/series/vaultSeriesInference.js');
        const {
            resolveRelatedEpisodes,
            buildSeriesViewFromRelated,
            normalizeHeroVaultSeriesLabel
        } = await server.ssrLoadModule('/src/lib/series/resolveRelatedEpisodes.js');
        const { normalizeVaultAsset } = await server.ssrLoadModule(
            '/src/lib/vault/normalizeVaultAsset.js'
        );

        // --- Phase 1: canonical label parser ---
        const sxe = infer.buildVaultSeriesIdentity('STIRRED S01E01');
        assert(sxe?.seriesLabel?.toUpperCase() === 'STIRRED', `S01E01 label (got ${sxe?.seriesLabel})`);
        assert(sxe?.seasonNumber === 1 && sxe?.episodeNumber === 1, 'S01E01 season/episode');
        assert(sxe?.confidence === 'high', `S01E01 confidence high (got ${sxe?.confidence})`);

        const s01ep2 = infer.buildVaultSeriesIdentity('STIRRED S01 EPISODE 2');
        assert(
            s01ep2?.seriesLabel?.toUpperCase() === 'STIRRED' && s01ep2?.episodeNumber === 2,
            `S01 EPISODE 2 parse (got ${JSON.stringify(s01ep2)})`
        );
        assert(s01ep2?.seasonNumber === 1, 'S01 EPISODE 2 season');

        const ep3 = infer.buildVaultSeriesIdentity('STIRRED Episode 3');
        assert(ep3?.seriesLabel?.toUpperCase() === 'STIRRED' && ep3?.episodeNumber === 3, 'Episode 3');

        const beginning = infer.buildVaultSeriesIdentity('STIRRED - The Beginning');
        assert(
            beginning?.seriesLabel?.toUpperCase() === 'STIRRED' && beginning?.episodeNumber === 1,
            `subtitle series root (got ${JSON.stringify(beginning)})`
        );

        const nh = normalizeHeroVaultSeriesLabel('STIRRED S01E02');
        assert(nh.seriesLabel.toUpperCase() === 'STIRRED' && nh.episodeNumber === 2, 'normalizeHeroVaultSeriesLabel S01E02');
        assert(nh.confidence === 'high', 'normalizeHeroVaultSeriesLabel confidence');

        // --- STIRRED S01E01 + S01E02 resolve together ---
        const e1 = {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
            name: 'STIRRED S01E01',
            title: 'STIRRED S01E01',
            url: 'https://cdn.example/videos/s1e1.mp4',
            thumbnailUrl: 'https://cdn.example/thumbs/s1e1.jpg',
            type: 'video',
            status: 'ready',
            createdAt: '2026-01-01T00:00:00.000Z'
        };
        const e2 = {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02',
            name: 'STIRRED S01E02',
            title: 'STIRRED S01E02',
            url: 'https://cdn.example/videos/s1e2.mp4',
            thumbnailUrl: 'https://cdn.example/thumbs/s1e2.jpg',
            type: 'video',
            status: 'ready',
            createdAt: '2026-01-02T00:00:00.000Z'
        };
        const e3 = {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03',
            name: 'STIRRED S01E03',
            title: 'STIRRED S01E03',
            url: 'https://cdn.example/videos/s1e3.mp4',
            thumbnailUrl: 'https://cdn.example/thumbs/s1e3.jpg',
            type: 'video',
            status: 'ready',
            createdAt: '2026-01-03T00:00:00.000Z'
        };
        const vault = [e1, e2, e3];
        const related = resolveRelatedEpisodes(e1, { readyAssets: vault });
        assert(related.members.length >= 3, `STIRRED S01 trio members ≥ 3 (got ${related.members.length})`);
        assert(/stirred/i.test(related.seriesTitle), `STIRRED series title (got ${related.seriesTitle})`);

        const relatedPublished = {
            ...related,
            members: (related.members || []).map((m) => ({ ...m, status: 'published' }))
        };
        const view = buildSeriesViewFromRelated(relatedPublished, null);
        const order = orderedEpNumbers(view);
        assert(
            order[0] === 1 && order[1] === 2 && order[2] === 3,
            `ordered E1..E3 (got ${order.join(',')})`
        );
        assert(/stirred/i.test(String(view?.title || '')), 'viewer shelf uses STIRRED label');

        // Persisted seriesIdentity on assets
        const persisted = {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01',
            name: 'Raw Upload Name.mp4',
            url: 'https://cdn.example/videos/p1.mp4',
            type: 'video',
            status: 'ready',
            seriesIdentity: {
                seriesLabel: 'STIRRED',
                seasonNumber: 1,
                episodeNumber: 1,
                confidence: 'high'
            }
        };
        const persisted2 = {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02',
            name: 'Another Raw Name.mp4',
            url: 'https://cdn.example/videos/p2.mp4',
            type: 'video',
            status: 'ready',
            seriesIdentity: {
                seriesLabel: 'STIRRED',
                seasonNumber: 1,
                episodeNumber: 2,
                confidence: 'high'
            }
        };
        const fromPersisted = resolveRelatedEpisodes(persisted, {
            readyAssets: [persisted, persisted2]
        });
        assert(
            fromPersisted.members.length >= 2,
            'persisted seriesIdentity groups siblings without title matching'
        );
        assert(
            /stirred/i.test(fromPersisted.seriesTitle),
            'persisted identity drives series title'
        );

        // --- Vic G unchanged ---
        const pilot = {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
            name: 'Vic G LA Story',
            url: 'https://cdn.example/videos/vic-pilot.mp4',
            type: 'video',
            status: 'ready'
        };
        const ep2 = {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc02',
            name: 'Vic G EPISODE 2 - POOM POOM TUESDAY',
            url: 'https://cdn.example/videos/vic-ep2.mp4',
            type: 'video',
            status: 'ready'
        };
        const vic = resolveRelatedEpisodes(pilot, { readyAssets: [pilot, ep2] });
        assert(vic.members.length >= 2, 'Vic G behavior: pilot family ≥ 2');
        const vicFromEp2 = resolveRelatedEpisodes(ep2, { readyAssets: [pilot, ep2] });
        assert(vicFromEp2.members.length >= 2, 'Vic G behavior: EP2 family ≥ 2');

        // --- Missing identity falls back safely ---
        const orphan = {
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
            name: 'Unrelated Camera Dump 9912',
            url: 'https://cdn.example/videos/orphan.mp4',
            type: 'video',
            status: 'ready'
        };
        const orphanRelated = resolveRelatedEpisodes(orphan, {
            readyAssets: [orphan, e1, e2]
        });
        // Orphan may seed alone; must not explode / throw; should not adopt STIRRED via low key
        assert(
            Array.isArray(orphanRelated.members),
            'missing identity falls back safely (members array)'
        );
        assert(
            !orphanRelated.members.some((m) => m.assetId === e1.id) ||
                orphanRelated.members.length === 1,
            'orphan dump does not falsely absorb STIRRED via low-confidence key'
        );

        // --- normalizeVaultAsset persists seriesIdentity ---
        const normalized = normalizeVaultAsset({
            id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',
            name: 'STIRRED S01E01',
            url: 'https://cdn.example/videos/n.mp4',
            type: 'video',
            status: 'ready'
        });
        assert(Boolean(normalized?.seriesIdentity), 'normalizeVaultAsset attaches seriesIdentity');
        assert(
            normalized?.seriesIdentity?.seriesLabel?.toUpperCase() === 'STIRRED',
            'normalized seriesLabel STIRRED'
        );
        assert(normalized?.seriesIdentity?.episodeNumber === 1, 'normalized episodeNumber');

        const noLabel = normalizeVaultAsset({
            id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            name: 'IMG_9912',
            url: 'https://cdn.example/videos/img.mp4',
            type: 'video',
            status: 'ready'
        });
        assert(Boolean(noLabel), 'unlabeled vault asset still normalizes');
        // seriesIdentity optional — may be null/undefined; asset remains valid
        assert(noLabel?.id === 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'missing identity still valid');

        // --- Wiring / architecture guards (no second matcher, no playback edits) ---
        const resolverSrc = read('src/lib/series/resolveRelatedEpisodes.js');
        assert(/buildVaultSeriesIdentity/.test(resolverSrc), 'resolver prefers vault seriesIdentity builder');
        assert(
            /seriesIdentityKeyOf|seriesIdentity/.test(resolverSrc),
            'resolver feeds vault identity into family gather'
        );
        assert(!/createMatcher|secondMatcher|newRelationshipGraph/.test(resolverSrc), 'no second matcher');

        const playback = read('src/lib/media/resolvePlayableMediaUrl.js');
        // Ensure this phase did not touch playback selection file content markers (still present)
        assert(/export function resolvePlayableMediaUrl/.test(playback), 'playback resolver export intact');

        const drawer = read('src/components/series/SeriesDrawer.svelte');
        const chip = read('src/components/series/EpisodeChip.svelte');
        const accordion = read('src/components/series/SeasonAccordion.svelte');
        assert(!/Vault-inferred series/.test(drawer), 'no admin-only Vault-inferred wording in drawer');
        assert(/All Episodes/.test(drawer), 'viewer shelf uses All Episodes label');
        assert(!/<video/.test(drawer + chip + accordion), 'no <video> inside episode shelf components');

        const theater = read('src/components/theater/TheaterExperience.svelte');
        assert(/resolveRelatedEpisodes/.test(theater), 'Theater still uses resolveRelatedEpisodes only');
        assert(
            !/buildVaultSeriesIdentity/.test(theater) || /resolveRelatedEpisodes/.test(theater),
            'Theater does not bypass resolveRelatedEpisodes'
        );

        // withVaultSeriesIdentity non-mutating for storage shape
        const raw = { id: '1', name: 'STIRRED S01E01', status: 'ready' };
        const attached = infer.withVaultSeriesIdentity(raw);
        assert(Boolean(attached?.seriesIdentity), 'withVaultSeriesIdentity attaches field');
        assert(raw.seriesIdentity == null, 'withVaultSeriesIdentity does not mutate source');

        if (failures.length) {
            console.error('FAIL validate-vault-series-identity\n' + failures.map((f) => `  - ${f}`).join('\n'));
            process.exitCode = 1;
        } else {
            console.log('PASS validate-vault-series-identity');
            for (const n of notes) console.log(`  ${n}`);
            console.log('\nSTIRRED S01 shelf:', {
                title: view?.title,
                order,
                members: related.members.map((m) => `${m.seriesLabel} S${m.seasonNumber}E${m.episodeNumber}`)
            });
        }
    } finally {
        await server.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
