#!/usr/bin/env node
/**
 * Hero Vault → Viewer Series Identity acceptance.
 *
 * Proves: upload/label STIRRED S01E01–E03 (durable vault records)
 *       → resolveRelatedEpisodes + Theater All Episodes shelf
 *       → ordered STIRRED S1 E1..E3, E2 selection maps to correct mediaAssetId
 *       → existing playback resolver, no admin wording in viewer shelf
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

function orderedEps(view) {
    return (view?.seasons || [])
        .slice()
        .sort((a, b) => a.seasonNumber - b.seasonNumber)
        .flatMap((s) =>
            [...(s.episodes || [])]
                .sort((a, b) => a.episodeNumber - b.episodeNumber)
                .map((e) => ({
                    n: e.episodeNumber,
                    label: e.seriesLabel,
                    id: e.mediaAssetId || e.reelId,
                    title: e.title
                }))
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
            buildSeriesViewFromRelated
        } = await server.ssrLoadModule('/src/lib/series/resolveRelatedEpisodes.js');
        const { reelToVaultEntry } = await server.ssrLoadModule('/src/lib/api/reelContract.js');
        const { resolvePlayableMediaUrl } = await server.ssrLoadModule(
            '/src/lib/media/resolvePlayableMediaUrl.js'
        );

        // --- Upload/label path: MP4 file names become durable vault identity ---
        const uploads = [
            {
                id: '11111111-1111-4111-8111-111111111101',
                name: 'STIRRED S01E01.mp4',
                fileName: 'STIRRED S01E01.mp4',
                url: 'https://cdn.example/videos/11111111-1111-4111-8111-111111111101.mp4',
                thumbnailUrl: 'https://cdn.example/thumbs/e1.jpg',
                type: 'video',
                createdAt: '2026-01-01T00:00:00.000Z'
            },
            {
                id: '11111111-1111-4111-8111-111111111102',
                name: 'STIRRED S01E02.mp4',
                fileName: 'STIRRED S01E02.mp4',
                url: 'https://cdn.example/videos/11111111-1111-4111-8111-111111111102.mp4',
                thumbnailUrl: 'https://cdn.example/thumbs/e2.jpg',
                type: 'video',
                createdAt: '2026-01-02T00:00:00.000Z'
            },
            {
                id: '11111111-1111-4111-8111-111111111103',
                name: 'STIRRED S01E03.mp4',
                fileName: 'STIRRED S01E03.mp4',
                url: 'https://cdn.example/videos/11111111-1111-4111-8111-111111111103.mp4',
                thumbnailUrl: 'https://cdn.example/thumbs/e3.jpg',
                type: 'video',
                createdAt: '2026-01-03T00:00:00.000Z'
            }
        ];

        const vaultRecords = uploads.map((reel) => {
            const entry = reelToVaultEntry(reel);
            const sealed = infer.sealVaultSeriesIdentityForStorage(entry) || entry;
            return sealed;
        });

        for (let i = 0; i < vaultRecords.length; i++) {
            const v = vaultRecords[i];
            const expectedEp = i + 1;
            assert(
                v.seriesIdentity &&
                    v.seriesIdentity.seriesLabel?.toUpperCase() === 'STIRRED' &&
                    v.seriesIdentity.seasonNumber === 1 &&
                    v.seriesIdentity.episodeNumber === expectedEp,
                `durable vault identity E${expectedEp}: ${JSON.stringify(v.seriesIdentity)}`
            );
            assert(
                !('confidence' in (v.seriesIdentity || {})),
                `durable identity omits confidence field (E${expectedEp})`
            );
            assert(
                !('parseConfidence' in (v.seriesIdentity || {})),
                `durable identity omits parser field (E${expectedEp})`
            );
        }

        // Simulates localStorage round-trip minimal fields
        const minimalFields = [
            'id',
            'name',
            'title',
            'fileName',
            'type',
            'size',
            'addedAt',
            'thumbnail',
            'seriesIdentity',
            'seriesLabel',
            'seasonNumber',
            'episodeNumber'
        ];
        const rehydrated = vaultRecords.map((item) => {
            const kept = {};
            for (const f of minimalFields) {
                if (item?.[f] !== undefined) kept[f] = item[f];
            }
            if (item?.url) kept.url = item.url;
            return kept;
        });
        assert(
            rehydrated.every(
                (r) =>
                    r.seriesIdentity?.seriesLabel?.toUpperCase() === 'STIRRED' &&
                    Number(r.seriesIdentity?.episodeNumber) >= 1
            ),
            'identity survives vault minimalFields persistence shape'
        );

        // --- Viewer theater path ---
        const seed = rehydrated[0];
        const related = resolveRelatedEpisodes(seed, { readyAssets: rehydrated });
        assert(related.members.length >= 3, `related members ≥ 3 (got ${related.members.length})`);
        assert(/stirred/i.test(related.seriesTitle), `viewer series title STIRRED (got ${related.seriesTitle})`);

        // Explicit publish: vault identity alone is never published status
        const relatedPublished = {
            ...related,
            members: (related.members || []).map((m) => ({ ...m, status: 'published' }))
        };
        const view = buildSeriesViewFromRelated(relatedPublished, null);
        assert(/stirred/i.test(String(view?.title || '')), 'All Episodes shelf title STIRRED');
        const eps = orderedEps(view);
        assert(
            eps.map((e) => e.n).join(',') === '1,2,3',
            `S1 order E1 E2 E3 (got ${eps.map((e) => e.n).join(',')})`
        );

        const e2 = eps.find((e) => e.n === 2);
        assert(
            e2 && String(e2.id) === uploads[1].id,
            `selecting E2 maps to mediaAssetId ${uploads[1].id} (got ${e2?.id})`
        );

        // Existing playback resolver (no series rewrite)
        const playbackUrl = resolvePlayableMediaUrl(
            {
                id: uploads[1].id,
                url: uploads[1].url,
                name: uploads[1].name,
                type: 'video',
                playbackUrl: 'https://cdn.example/videos/e2.playback.mp4',
                playbackStatus: 'ready'
            },
            'theater'
        );
        assert(
            /playback/.test(String(playbackUrl || '')),
            `existing playback resolver selects derivative when ready (got ${playbackUrl})`
        );

        // Viewer-safe chrome (source contracts)
        const drawer = read('src/components/series/SeriesDrawer.svelte');
        const chip = read('src/components/series/EpisodeChip.svelte');
        assert(/All Episodes/.test(drawer), 'viewer drawer eyebrow All Episodes');
        assert(/Episodes/.test(drawer) && /data-series-episodes-heading/.test(drawer), 'viewer Episodes section');
        assert(!/Vault-inferred series|Vault inferred/i.test(drawer + chip), 'no vault-inferred wording for viewers');
        assert(
            !/parseConfidence/.test(chip) && !/data-confidence/.test(chip),
            'chip UI does not surface parser confidence'
        );
        assert(
            /viewerIdentityLine/.test(chip) && /• S\$\{seasonNumber\} • E\$\{episodeNumber\}/.test(chip),
            'viewer identity line format STIRRED • S# • E#'
        );
        assert(!/<video/.test(drawer + chip), 'shelf remains video-free');

        const persistSrc = read('src/viewer/viewerContext.js');
        assert(/seriesIdentity/.test(persistSrc), 'persistPersonalVault keeps seriesIdentity fields');
        assert(/sealVaultAssetsSeriesIdentity/.test(persistSrc), 'vault persist seals durable identity');

        const vaultExp = read('src/components/experiences/VaultExperience.svelte');
        assert(
            /sealVaultSeriesIdentityForStorage/.test(vaultExp),
            'Hero Vault MP4 insert seals series identity'
        );

        if (failures.length) {
            console.error(
                'FAIL validate-hero-vault-series-identity\n' + failures.map((f) => `  - ${f}`).join('\n')
            );
            process.exitCode = 1;
        } else {
            console.log('PASS validate-hero-vault-series-identity');
            for (const n of notes) console.log(`  ${n}`);
            console.log('\nViewer shelf model:', {
                title: view?.title,
                episodes: eps.map(
                    (e) =>
                        `${String(e.n).padStart(2, '0')}  ${e.label || 'STIRRED'} • S1 • E${e.n}`
                ),
                e2Media: e2?.id
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
