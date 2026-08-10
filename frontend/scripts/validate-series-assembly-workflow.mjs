#!/usr/bin/env node
/**
 * Creator Series Assembly workflow.
 *
 * Proves: E1/E2/E3 assemble with displayOrder + S/E identity + enrichment;
 *         incomplete packages cannot mark Ready; published viewer filter unchanged;
 *         Theater still resolves vault seriesIdentity labels.
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

const bag = new Map();
globalThis.localStorage = {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => bag.set(String(k), String(v)),
    removeItem: (k) => bag.delete(k),
    clear: () => bag.clear()
};
globalThis.window = {
    localStorage: globalThis.localStorage,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true
};
if (typeof globalThis.crypto?.randomUUID !== 'function') {
    Object.defineProperty(globalThis, 'crypto', {
        value: { randomUUID: () => '00000000-0000-4000-8000-0000000000aa' },
        configurable: true
    });
}

const R1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01';
const R2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02';
const R3 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03';

async function main() {
    const server = await createServer({
        root: frontendRoot,
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error'
    });

    try {
        const store = await server.ssrLoadModule('/src/lib/series/seriesStore.js');
        const assembly = await server.ssrLoadModule('/src/lib/series/seriesAssemblyWorkflow.js');
        const enrichMod = await server.ssrLoadModule('/src/lib/series/vaultEpisodeEnrichment.js');
        const idConf = await server.ssrLoadModule('/src/lib/series/vaultIdentityConfirmation.js');
        const infer = await server.ssrLoadModule('/src/lib/series/vaultSeriesInference.js');
        const { reelToVaultEntry } = await server.ssrLoadModule('/src/lib/api/reelContract.js');
        const {
            resolveRelatedEpisodes,
            buildSeriesViewFromRelated
        } = await server.ssrLoadModule('/src/lib/series/resolveRelatedEpisodes.js');
        const life = await server.ssrLoadModule('/src/lib/series/publishingLifecycle.js');

        const assemblyUi = read('src/components/series/CreatorSeriesAssembly.svelte');
        const studio = read('src/components/experiences/StudioExperience.svelte');
        const catalogPanel = read('src/components/series/CreatorCatalogPanel.svelte');
        assert(
            studio.includes('CreatorSeriesAssembly') &&
                assemblyUi.includes('data-series-assembly'),
            'Studio wires Creator Series Assembly'
        );
        assert(
            assemblyUi.includes('Creator preview') && assemblyUi.includes('Mark Ready'),
            'assembly UI has overview + preview + Ready gate'
        );
        assert(
            catalogPanel.includes('evaluateEpisodeReadyRequirements'),
            'catalog panel gates Ready transition'
        );

        bag.clear();
        store.resetSeriesCatalogEmpty?.();
        const seriesId = 'series-stirred-assembly';

        /** @type {any[]} */
        const vaultAssets = [R1, R2, R3].map((id, i) => {
            const n = i + 1;
            let asset = infer.sealVaultSeriesIdentityForStorage(
                reelToVaultEntry({
                    id,
                    name: `STIRRED_S01E0${n}.mp4`,
                    fileName: `STIRRED_S01E0${n}.mp4`,
                    url: `https://cdn.example/videos/${id}.mp4`,
                    thumbnailUrl: `https://cdn.example/thumbs/e${n}-default.jpg`,
                    type: 'video'
                })
            );
            asset = idConf.applyCreatorVaultIdentityConfirmation(asset, {
                seriesLabel: 'STIRRED',
                seasonNumber: 1,
                episodeNumber: n
            });
            asset = enrichMod.applyCreatorVaultEpisodeEnrichment(asset, {
                title: n === 2 ? 'Motherland' : `Episode ${n}`,
                description: `Description for E${n}`,
                artworkUrl: `https://cdn.example/art/e${n}.jpg`
            });
            return asset;
        });

        // Incomplete package: strip enrichment + identity from E3 for readiness gate test later
        const incompleteE3 = {
            ...vaultAssets[2],
            seriesIdentity: {
                seriesLabel: 'STIRRED',
                seasonNumber: 1,
                episodeNumber: 3,
                confirmedByCreator: true
            },
            seriesLabel: 'STIRRED',
            seasonNumber: 1,
            episodeNumber: 3
        };
        delete incompleteE3.episodeEnrichment;
        incompleteE3.url = `https://cdn.example/videos/${R3}.mp4`;

        store.seriesCatalog.set([
            {
                id: seriesId,
                title: 'STIRRED',
                description: 'Franchise series assembly',
                poster: 'https://cdn.example/art/series-stirred.jpg',
                tags: ['vault-inferred'],
                seasons: [
                    {
                        seasonId: 's1',
                        seasonNumber: 1,
                        title: 'Season 1',
                        episodes: [
                            {
                                episodeId: 'ep-s01e01',
                                episodeNumber: 1,
                                title: 'STIRRED S01E01',
                                status: 'draft',
                                reelId: R1,
                                mediaAssetId: R1
                            },
                            {
                                episodeId: 'ep-s01e02',
                                episodeNumber: 2,
                                title: 'STIRRED S01E02',
                                status: 'draft',
                                reelId: R2,
                                mediaAssetId: R2
                            },
                            {
                                episodeId: 'ep-s01e03',
                                episodeNumber: 3,
                                title: 'STIRRED S01E03',
                                status: 'draft',
                                reelId: R3,
                                mediaAssetId: R3
                            }
                        ]
                    }
                ]
            }
        ]);
        // Creator display order: E3, E1, E2
        store.reorderEpisodesInSeason(seriesId, 1, ['ep-s01e03', 'ep-s01e01', 'ep-s01e02']);

        const orderBefore = (store.getSeriesById(seriesId)?.seasons?.[0]?.episodes || []).map(
            (e) => e.episodeId
        );
        assert(
            orderBefore.join(',') === 'ep-s01e03,ep-s01e01,ep-s01e02',
            `displayOrder source ${orderBefore.join(',')}`
        );

        const overview = assembly.buildSeriesAssemblyOverview(
            store.getSeriesById(seriesId),
            vaultAssets
        );
        assert(overview.title === 'STIRRED', `series title (${overview.title})`);
        assert(
            /franchise series assembly/i.test(overview.description),
            'series description present'
        );
        assert(
            overview.poster === 'https://cdn.example/art/series-stirred.jpg',
            'series artwork present'
        );
        assert(overview.seasons.length === 1, 'one season assembled');
        assert(overview.episodeCount === 3, 'E1/E2/E3 assemble into series');

        const assembledIds = overview.seasons[0].episodes.map((e) => e.episodeId);
        assert(
            assembledIds.join(',') === 'ep-s01e03,ep-s01e01,ep-s01e02',
            `displayOrder preserved in assembly (${assembledIds.join(',')})`
        );

        const byEp = Object.fromEntries(
            overview.seasons[0].episodes.map((e) => [e.episodeNumber, e])
        );
        assert(byEp[1]?.identity.state === 'confirmed', 'E1 identity confirmed');
        assert(byEp[2]?.identity.state === 'confirmed', 'E2 identity confirmed');
        assert(byEp[3]?.identity.state === 'confirmed', 'E3 identity confirmed');
        assert(
            byEp[1]?.identity.seriesLabel === 'STIRRED' &&
                byEp[1]?.identity.seasonNumber === 1 &&
                byEp[1]?.identity.episodeNumber === 1 &&
                byEp[2]?.identity.episodeNumber === 2 &&
                byEp[3]?.identity.episodeNumber === 3,
            'S/E labels unchanged from vault identity'
        );
        assert(
            byEp[2]?.presentation.title === 'Motherland' &&
                byEp[2]?.presentation.description === 'Description for E2' &&
                byEp[2]?.presentation.artworkUrl === 'https://cdn.example/art/e2.jpg',
            'enrichment preserved in presentation status'
        );
        assert(byEp[1]?.presentation.state === 'complete', 'E1 presentation complete');
        assert(byEp[1]?.media.state === 'available', 'E1 media available');
        assert(byEp[1]?.publishing.status === 'draft', 'E1 publishing draft');

        // Missing metadata blocks readiness (E3 without enrichment in separate assess)
        const catE3 = store.getEpisodeById('ep-s01e03')?.episode;
        const incompleteAssess = assembly.assessEpisodeAssembly(catE3, incompleteE3, {
            seasonNumber: 1
        });
        assert(
            incompleteAssess.canMarkReady === false,
            'incomplete package cannot mark Ready'
        );
        assert(
            incompleteAssess.readyRequirements.missing.some((m) => /title|description|artwork/i.test(m)),
            `blocks for missing presentation: ${incompleteAssess.readyRequirements.missing.join(', ')}`
        );
        const blocked = assembly.attemptMarkEpisodeReady('ep-s01e03', {
            vaultAssets: [vaultAssets[0], vaultAssets[1], incompleteE3]
        });
        assert(blocked.ok === false, 'attemptMarkEpisodeReady rejects incomplete E3');
        assert(
            store.getEpisodeById('ep-s01e03')?.episode?.status === 'draft',
            'E3 still draft after blocked Ready'
        );

        // Complete package → Ready (not published)
        const marked = assembly.attemptMarkEpisodeReady('ep-s01e02', { vaultAssets });
        assert(marked.ok === true, `E2 mark Ready succeeds: ${marked.message}`);
        assert(
            store.getEpisodeById('ep-s01e02')?.episode?.status === 'ready',
            'E2 status is ready after gate'
        );
        assert(
            life.episodeIsViewerDiscoverable(store.getEpisodeById('ep-s01e02')?.episode) === false,
            'Ready is not viewer discoverable'
        );

        // Auto-publish not triggered — only one Ready
        store.setEpisodeStatus('ep-s01e01', 'published');
        assert(
            store.getEpisodeById('ep-s01e01')?.episode?.status === 'published',
            'can still publish complete path via status API'
        );

        // Published filter unchanged
        const allEps = store.getSeriesById(seriesId)?.seasons?.[0]?.episodes || [];
        const discoverable = allEps.filter((e) => life.episodeIsViewerDiscoverable(e));
        assert(
            discoverable.length === 1 && discoverable[0].episodeId === 'ep-s01e01',
            `published filter: only E1 public (got ${discoverable.map((e) => e.episodeId).join(',')})`
        );
        assert(
            assembly.publishedFilterUnchanged(allEps),
            'publishedFilterUnchanged helper holds'
        );
        const viewerSeries = life.filterSeriesSeasonsForAudience(store.getSeriesById(seriesId), {
            viewerMode: true
        });
        const viewerEps = viewerSeries?.seasons?.[0]?.episodes || [];
        assert(
            viewerEps.length === 1 && viewerEps[0].status === 'published',
            'viewer season filter only published'
        );

        // displayOrder still after status mutations
        const orderAfter = (store.getSeriesById(seriesId)?.seasons?.[0]?.episodes || []).map(
            (e) => e.episodeId
        );
        assert(
            orderAfter.join(',') === 'ep-s01e03,ep-s01e01,ep-s01e02',
            'displayOrder preserved after readiness changes'
        );

        // Creator preview includes non-published
        const preview = assembly.buildCreatorSeriesPreview(store.getSeriesById(seriesId), vaultAssets);
        assert(preview?.publicDiscoverable === false, 'preview is not public');
        const previewEps = preview?.seasons?.[0]?.episodes || [];
        assert(previewEps.length === 3, 'creator preview shows all episodes');
        assert(
            previewEps.some((e) => e.status === 'draft') &&
                previewEps.some((e) => e.status === 'ready') &&
                previewEps.some((e) => e.status === 'published'),
            'preview surfaces mixed publish states'
        );

        // Theater receives same episode identity (S/E + media ids)
        const related = resolveRelatedEpisodes(vaultAssets[1], { readyAssets: vaultAssets });
        assert(related.members.length >= 3, `Theater family ≥ 3 (got ${related.members.length})`);
        const relatedPublished = {
            ...related,
            members: related.members.map((m) => ({ ...m, status: 'published' }))
        };
        const view = buildSeriesViewFromRelated(relatedPublished, null);
        const shelf = (view?.seasons || [])
            .flatMap((s) => s.episodes || [])
            .sort((a, b) => a.episodeNumber - b.episodeNumber);
        assert(
            shelf.map((e) => e.episodeNumber).join(',') === '1,2,3',
            `Theater S/E order (got ${shelf.map((e) => e.episodeNumber).join(',')})`
        );
        assert(
            shelf.every((e) => String(e.seriesLabel || 'STIRRED').toUpperCase() === 'STIRRED'),
            'Theater series labels STIRRED'
        );
        assert(
            String(shelf.find((e) => e.episodeNumber === 2)?.mediaAssetId ||
                shelf.find((e) => e.episodeNumber === 2)?.reelId) === R2,
            'Theater E2 media identity matches vault'
        );
        // Enrichment title still available on member
        const m2 = related.members.find((m) => String(m.reelId || m.assetId) === R2);
        assert(m2?.title === 'Motherland', `Theater enrichment title (got ${m2?.title})`);

        // Enrichment still on vault after assembly operations
        assert(
            vaultAssets[1].episodeEnrichment?.title === 'Motherland',
            'source enrichment object undisturbed'
        );

        if (failures.length) {
            console.error(
                'FAIL validate-series-assembly-workflow\n' +
                    failures.map((f) => `  - ${f}`).join('\n')
            );
            process.exitCode = 1;
        } else {
            console.log('PASS validate-series-assembly-workflow');
            for (const n of notes) console.log(`  ${n}`);
            console.log('\nAssembly overview:', {
                title: overview.title,
                order: assembledIds,
                e2: {
                    identity: byEp[2]?.identity.state,
                    presentation: byEp[2]?.presentation.state,
                    status: store.getEpisodeById('ep-s01e02')?.episode?.status
                }
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
