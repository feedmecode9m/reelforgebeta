#!/usr/bin/env node
/**
 * Creator experience polish acceptance.
 *
 * Verifies creator can identify STIRRED S/E without parser language,
 * missing package fields are explicit, Ready gate enforced, publish
 * remains separate, viewer receives enrichment — no authority crossover.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const failures = [];
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

const R2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa22';

async function main() {
    const server = await createServer({
        root: frontendRoot,
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error'
    });

    try {
        const polish = await server.ssrLoadModule('/src/lib/series/creatorExperiencePresentation.js');
        const idConf = await server.ssrLoadModule('/src/lib/series/vaultIdentityConfirmation.js');
        const enrichMod = await server.ssrLoadModule('/src/lib/series/vaultEpisodeEnrichment.js');
        const infer = await server.ssrLoadModule('/src/lib/series/vaultSeriesInference.js');
        const assembly = await server.ssrLoadModule('/src/lib/series/seriesAssemblyWorkflow.js');
        const store = await server.ssrLoadModule('/src/lib/series/seriesStore.js');
        const life = await server.ssrLoadModule('/src/lib/series/publishingLifecycle.js');
        const { reelToVaultEntry } = await server.ssrLoadModule('/src/lib/api/reelContract.js');
        const {
            resolveRelatedEpisodes,
            buildSeriesViewFromRelated
        } = await server.ssrLoadModule('/src/lib/series/resolveRelatedEpisodes.js');

        // Structural wiring
        const vaultExp = read('src/components/experiences/VaultExperience.svelte');
        const card = read('src/components/series/VaultEpisodeCreatorStatus.svelte');
        const assemblyUi = read('src/components/series/CreatorSeriesAssembly.svelte');
        const chip = read('src/components/series/EpisodeChip.svelte');
        const drawer = read('src/components/series/SeriesDrawer.svelte');

        assert(
            vaultExp.includes('VaultEpisodeCreatorStatus') &&
                vaultExp.includes('confirmVaultVideoIdentity') &&
                vaultExp.includes('saveVaultEpisodeEnrichment'),
            'Hero Vault mounts unified creator completeness card'
        );
        assert(
            card.includes('data-vault-creator-completeness') &&
                card.includes('data-series-value') &&
                card.includes('data-season-value') &&
                card.includes('data-episode-value'),
            'creator card exposes Series/Season/Episode values'
        );
        assert(
            !/parseConfidence|confidence score|validator|inference/i.test(card),
            'creator card has no parser/confidence/validator language'
        );
        assert(
            assemblyUi.includes('polishAssemblyRowMarks') &&
                assemblyUi.includes('data-package-checks'),
            'assembly surfaces package completeness checks'
        );
        assert(
            /viewerIdentityLine/.test(chip) && /episode-card__title/.test(chip),
            'Theater chip shows identity line + episode title'
        );
        assert(/All Episodes/.test(drawer), 'Theater drawer All Episodes present');

        // --- Creator can identify STIRRED_S01E02.mp4 ---
        let asset = infer.sealVaultSeriesIdentityForStorage(
            reelToVaultEntry({
                id: R2,
                name: 'STIRRED_S01E02.mp4',
                fileName: 'STIRRED_S01E02.mp4',
                url: `https://cdn.example/videos/${R2}.mp4`,
                thumbnailUrl: 'https://cdn.example/thumbs/e2.jpg',
                type: 'video'
            })
        );
        const completeness = polish.presentVaultEpisodeCompleteness(asset);
        assert(completeness.seriesDisplay === 'STIRRED', `Series value STIRRED (got ${completeness.seriesDisplay})`);
        assert(completeness.season === 1 && completeness.seasonDisplay === '1', `Season value 1 (got ${completeness.seasonDisplay})`);
        assert(completeness.episode === 2 && completeness.episodeDisplay === '2', `Episode value 2 (got ${completeness.episodeDisplay})`);
        assert(completeness.identity.ready === true, 'identity ready after seal');
        assert(
            polish.isCreatorExperienceCopySafe([
                completeness.seriesDisplay,
                completeness.seasonDisplay,
                completeness.episodeDisplay,
                completeness.identity.statusLabel
            ]),
            'identity presentation free of internal language'
        );

        // --- Missing package states ---
        assert(completeness.presentation.ready === false, 'package incomplete without enrichment');
        assert(completeness.presentation.marks.title === false, 'title missing mark');
        assert(completeness.presentation.marks.description === false, 'description missing mark');
        assert(completeness.presentation.marks.artwork === false, 'artwork missing mark');
        assert(
            completeness.missing.includes('title') &&
                completeness.missing.includes('description') &&
                completeness.missing.includes('artwork'),
            `missing list includes package fields (${completeness.missing.join(',')})`
        );
        assert(completeness.media.state === 'available', 'media available from playback url');
        assert(completeness.publishing.status === 'draft', 'default publishing draft unbound/catalog');

        // Complete package
        asset = idConf.applyCreatorVaultIdentityConfirmation(asset, {
            seriesLabel: 'STIRRED',
            seasonNumber: 1,
            episodeNumber: 2
        });
        asset = enrichMod.applyCreatorVaultEpisodeEnrichment(asset, {
            title: 'The Beginning',
            description: 'First encounter...',
            artworkUrl: 'https://cdn.example/art/poster-e2.jpg'
        });
        const full = polish.presentVaultEpisodeCompleteness(asset);
        assert(full.presentation.ready === true, 'presentation complete after package');
        assert(full.complete === true || full.missing.length === 0, 'card complete when identity+package+media present');
        assert(full.series === 'STIRRED' && full.season === 1 && full.episode === 2, 'identity unchanged after package');
        assert(
            full.presentation.title === 'The Beginning' &&
                full.presentation.artworkUrl.includes('poster-e2'),
            'package fields surface for creator'
        );

        // --- Ready gate remains enforced / publish separate ---
        bag.clear();
        store.resetSeriesCatalogEmpty?.();
        const seriesId = 'series-polish';
        const incompleteAsset = { ...asset };
        delete incompleteAsset.episodeEnrichment;
        store.seriesCatalog.set([
            {
                id: seriesId,
                title: 'STIRRED',
                description: '',
                poster: '',
                seasons: [
                    {
                        seasonId: 's1',
                        seasonNumber: 1,
                        title: 'Season 1',
                        episodes: [
                            {
                                episodeId: 'ep2',
                                episodeNumber: 2,
                                title: 'STIRRED S01E02',
                                status: 'draft',
                                reelId: R2,
                                mediaAssetId: R2
                            }
                        ]
                    }
                ]
            }
        ]);
        const blocked = assembly.attemptMarkEpisodeReady('ep2', {
            vaultAssets: [incompleteAsset]
        });
        assert(blocked.ok === false, 'incomplete package cannot Ready');
        assert(store.getEpisodeById('ep2')?.episode?.status === 'draft', 'status remains draft');

        const allowed = assembly.attemptMarkEpisodeReady('ep2', { vaultAssets: [asset] });
        assert(allowed.ok === true, 'complete package can Ready');
        assert(store.getEpisodeById('ep2')?.episode?.status === 'ready', 'status becomes ready');
        assert(
            life.episodeIsViewerDiscoverable(store.getEpisodeById('ep2')?.episode) === false,
            'Ready does not publish/discover'
        );

        // Publishing does not touch vault identity
        const idBefore = JSON.stringify(asset.seriesIdentity);
        store.setEpisodeStatus('ep2', 'published');
        assert(JSON.stringify(asset.seriesIdentity) === idBefore, 'publish does not mutate vault identity object');
        assert(asset.seriesIdentity?.episodeNumber === 2, 'S/E still E2');

        // Reorder never changes S/E — polish check via assembly overview
        store.seriesCatalog.set([
            {
                id: seriesId,
                title: 'STIRRED',
                seasons: [
                    {
                        seasonNumber: 1,
                        episodes: [
                            {
                                episodeId: 'ep1',
                                episodeNumber: 1,
                                title: 'E1',
                                status: 'published',
                                reelId: 'r1',
                                mediaAssetId: 'r1',
                                displayOrder: 1
                            },
                            {
                                episodeId: 'ep2',
                                episodeNumber: 2,
                                title: 'E2',
                                status: 'published',
                                reelId: R2,
                                mediaAssetId: R2,
                                displayOrder: 0
                            }
                        ]
                    }
                ]
            }
        ]);
        store.reorderEpisodesInSeason(seriesId, 1, ['ep2', 'ep1']);
        const reordered = store.getSeriesById(seriesId)?.seasons?.[0]?.episodes || [];
        assert(
            reordered.map((e) => e.episodeNumber).join(',') === '2,1',
            'displayOrder reorder preserves S/E numbers'
        );
        assert(
            reordered.find((e) => e.episodeId === 'ep2')?.episodeNumber === 2,
            'ep2 remains episodeNumber 2 after reorder'
        );

        // --- Viewer receives enrichment ---
        const related = resolveRelatedEpisodes(asset, { readyAssets: [asset] });
        const m = (related.members || []).find((x) => String(x.reelId || x.assetId) === R2);
        assert(m?.title === 'The Beginning', `viewer title (${m?.title})`);
        assert(m?.description === 'First encounter...', 'viewer description');
        assert(String(m?.thumbnailUrl || '').includes('poster'), 'viewer artwork');
        assert(Number(m?.episodeNumber) === 2, 'viewer S/E identity E2');
        assert(String(m?.seriesLabel || 'STIRRED').toUpperCase() === 'STIRRED', 'viewer series label');

        const view = buildSeriesViewFromRelated(
            { ...related, members: (related.members || []).map((x) => ({ ...x, status: 'published' })) },
            null
        );
        const shelfEp = (view?.seasons?.[0]?.episodes || []).find((e) => Number(e.episodeNumber) === 2);
        assert(shelfEp?.title === 'The Beginning', 'Theater shelf title from enrichment');
        assert(
            String(shelfEp?.seriesLabel || 'STIRRED').toUpperCase() === 'STIRRED',
            'Theater identity seriesLabel'
        );

        // No authority crossover: enrichment fields never written into seriesIdentity
        assert(
            !('title' in (asset.seriesIdentity || {})) &&
                !('artworkUrl' in (asset.seriesIdentity || {})),
            'seriesIdentity has no enrichment fields'
        );
        assert(
            asset.episodeEnrichment?.title === 'The Beginning',
            'enrichment stays in episodeEnrichment'
        );

        if (failures.length) {
            console.error(
                'FAIL validate-creator-experience-polish\n' +
                    failures.map((f) => `  - ${f}`).join('\n')
            );
            process.exitCode = 1;
        } else {
            console.log('PASS validate-creator-experience-polish');
            for (const n of notes) console.log(`  ${n}`);
        }
    } finally {
        await server.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
