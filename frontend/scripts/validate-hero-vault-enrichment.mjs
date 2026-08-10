#!/usr/bin/env node
/**
 * Hero Vault creator episode enrichment (presentation package).
 *
 * Proves: confirmed identity + title/description/artwork persist after reload
 *         → catalog displayOrder / publish unchanged
 *         → Theater resolution still groups by vault seriesIdentity
 *         → viewer surfaces consume enrichment title/poster when present
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
                    title: e.title,
                    description: e.description,
                    thumbnailUrl: e.thumbnailUrl
                }))
        );
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
        value: { randomUUID: () => '00000000-0000-4000-8000-0000000000ef' },
        configurable: true
    });
}

const R1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';
const R2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddd02';
const R3 = 'dddddddd-dddd-4ddd-8ddd-dddddddddd03';

async function main() {
    const server = await createServer({
        root: frontendRoot,
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error'
    });

    try {
        const infer = await server.ssrLoadModule('/src/lib/series/vaultSeriesInference.js');
        const idConf = await server.ssrLoadModule('/src/lib/series/vaultIdentityConfirmation.js');
        const enrichMod = await server.ssrLoadModule('/src/lib/series/vaultEpisodeEnrichment.js');
        const {
            resolveRelatedEpisodes,
            buildSeriesViewFromRelated
        } = await server.ssrLoadModule('/src/lib/series/resolveRelatedEpisodes.js');
        const { reelToVaultEntry } = await server.ssrLoadModule('/src/lib/api/reelContract.js');
        const store = await server.ssrLoadModule('/src/lib/series/seriesStore.js');

        // --- Structural wiring ---
        const vaultExp = read('src/components/experiences/VaultExperience.svelte');
        const cardSrc = read('src/components/series/VaultEpisodeEnrichment.svelte');
        const enrichSrc = read('src/lib/series/vaultEpisodeEnrichment.js');
        const viewerCtx = read('src/viewer/viewerContext.js');

        assert(
            (vaultExp.includes('VaultEpisodeCreatorStatus') ||
                vaultExp.includes('VaultEpisodeEnrichment')) &&
                vaultExp.includes('saveVaultEpisodeEnrichment') &&
                vaultExp.includes('applyCreatorVaultEpisodeEnrichment'),
            'VaultExperience wires episode enrichment'
        );
        assert(
            cardSrc.includes('presentVaultEpisodeEnrichmentForCreator'),
            'enrichment card uses presentation module'
        );
        assert(
            !/parseConfidence|confidence score|validator wording/i.test(cardSrc),
            'enrichment card has no admin/parser wording'
        );
        assert(
            viewerCtx.includes('sealVaultAssetsWithEnrichment'),
            'vault persist/rehydrate seals enrichment'
        );
        assert(
            enrichSrc.includes('episodeEnrichment') && enrichSrc.includes('artworkUrl'),
            'durable enrichment stores title/description/artwork'
        );

        // --- Identity confirm then enrich ---
        const rawUpload = {
            id: R2,
            name: 'STIRRED_S01E02.mp4',
            fileName: 'STIRRED_S01E02.mp4',
            url: `https://cdn.example/videos/${R2}.mp4`,
            thumbnailUrl: 'https://cdn.example/thumbs/e2-default.jpg',
            type: 'video',
            createdAt: '2026-01-02T00:00:00.000Z'
        };
        let asset = /** @type {Record<string, unknown>} */ (
            infer.sealVaultSeriesIdentityForStorage(reelToVaultEntry(rawUpload)) ||
                reelToVaultEntry(rawUpload)
        );
        asset = idConf.applyCreatorVaultIdentityConfirmation(asset, {
            seriesLabel: 'STIRRED',
            seasonNumber: 1,
            episodeNumber: 2
        });
        assert(
            asset.seriesIdentity?.seriesLabel === 'STIRRED' &&
                asset.seriesIdentity?.episodeNumber === 2 &&
                asset.seriesIdentity?.confirmedByCreator === true,
            'confirmed identity remains before enrichment'
        );
        assert(String(asset.id) === R2, 'mediaAssetId preserved pre-enrich');
        assert(String(asset.url || '').includes(R2), 'playback URL preserved pre-enrich');

        const presentationBefore = enrichMod.presentVaultEpisodeEnrichmentForCreator(asset);
        assert(presentationBefore.identityConfirmed === true, 'enrichment UI only for confirmed identity');
        assert(
            presentationBefore.episodeLine === 'STIRRED • S1 • E2',
            `episode line: ${presentationBefore.episodeLine}`
        );

        asset = enrichMod.applyCreatorVaultEpisodeEnrichment(asset, {
            title: 'Motherland',
            description: 'Stirred begins in the docks.',
            artworkUrl: 'https://cdn.example/art/stirred-s01e02.jpg'
        });

        assert(String(asset.id) === R2, 'mediaAssetId preserved after enrichment');
        assert(String(asset.url || '').includes(R2), 'playback URL preserved after enrichment');
        assert(
            asset.seriesIdentity?.seriesLabel === 'STIRRED' &&
                asset.seriesIdentity?.seasonNumber === 1 &&
                asset.seriesIdentity?.episodeNumber === 2 &&
                asset.seriesIdentity?.confirmedByCreator === true,
            'confirmed identity remains after enrichment'
        );
        assert(
            asset.episodeEnrichment?.title === 'Motherland' &&
                asset.episodeEnrichment?.description === 'Stirred begins in the docks.' &&
                asset.episodeEnrichment?.artworkUrl === 'https://cdn.example/art/stirred-s01e02.jpg',
            `enrichment sealed: ${JSON.stringify(asset.episodeEnrichment)}`
        );
        assert(
            !('confidence' in (asset.seriesIdentity || {})) &&
                !('parseConfidence' in (asset.seriesIdentity || {})),
            'no parser fields on sealed identity'
        );

        // --- Catalog fixture (must stay unchanged) ---
        bag.clear();
        store.resetSeriesCatalogEmpty?.();
        const seriesId = 'series-stirred-enrich';
        store.seriesCatalog.set([
            {
                id: seriesId,
                title: 'STIRRED',
                description: '',
                poster: '',
                tags: [],
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
                                status: 'published',
                                reelId: R1,
                                mediaAssetId: R1
                            },
                            {
                                episodeId: 'ep-s01e02',
                                episodeNumber: 2,
                                title: 'STIRRED S01E02',
                                status: 'ready',
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
        store.reorderEpisodesInSeason(seriesId, 1, ['ep-s01e03', 'ep-s01e01', 'ep-s01e02']);
        store.setEpisodeStatus('ep-s01e01', 'published');
        store.setEpisodeStatus('ep-s01e02', 'ready');
        store.setEpisodeStatus('ep-s01e03', 'draft');

        const snapCatalog = () => {
            const live = store.getSeriesById(seriesId);
            const eps = live?.seasons?.[0]?.episodes || [];
            return JSON.stringify(
                eps.map((e) => ({
                    id: e.episodeId,
                    episodeNumber: e.episodeNumber,
                    status: e.status,
                    displayOrder: e.displayOrder,
                    reelId: e.reelId
                }))
            );
        };
        const catalogBefore = snapCatalog();

        // Identity still present + enrichment re-apply does not mutate catalog
        asset = enrichMod.applyCreatorVaultEpisodeEnrichment(asset, {
            title: 'Motherland',
            description: 'Stirred begins in the docks.',
            artworkUrl: 'https://cdn.example/art/stirred-s01e02.jpg'
        });
        assert(snapCatalog() === catalogBefore, 'catalog displayOrder/order unchanged');
        const e2 = store.getEpisodeById('ep-s01e02')?.episode;
        assert(String(e2?.status) === 'ready', `publishing status unchanged (got ${e2?.status})`);
        assert(Number(e2?.episodeNumber) === 2, 'catalog episodeNumber unchanged');

        // --- Persist / rehydrate (refresh simulation) ---
        const vaultKey = 'personal_video_vault';
        const siblings = enrichMod.sealVaultAssetsWithEnrichment([
            infer.sealVaultSeriesIdentityForStorage(
                reelToVaultEntry({
                    id: R1,
                    name: 'STIRRED_S01E01.mp4',
                    fileName: 'STIRRED_S01E01.mp4',
                    url: `https://cdn.example/videos/${R1}.mp4`,
                    type: 'video'
                })
            ),
            asset,
            infer.sealVaultSeriesIdentityForStorage(
                reelToVaultEntry({
                    id: R3,
                    name: 'STIRRED_S01E03.mp4',
                    fileName: 'STIRRED_S01E03.mp4',
                    url: `https://cdn.example/videos/${R3}.mp4`,
                    type: 'video'
                })
            )
        ]);
        localStorage.setItem(vaultKey, JSON.stringify(siblings));
        const reloaded = enrichMod.sealVaultAssetsWithEnrichment(
            JSON.parse(localStorage.getItem(vaultKey) || '[]')
        );
        const reE2 = reloaded.find((v) => String(v?.id) === R2);
        assert(
            reE2?.seriesIdentity?.seriesLabel === 'STIRRED' &&
                reE2?.seriesIdentity?.episodeNumber === 2 &&
                reE2?.seriesIdentity?.confirmedByCreator === true,
            'identity persists after reload'
        );
        assert(reE2?.episodeEnrichment?.title === 'Motherland', 'title persists after reload');
        assert(
            reE2?.episodeEnrichment?.description === 'Stirred begins in the docks.',
            'description persists after reload'
        );
        assert(
            reE2?.episodeEnrichment?.artworkUrl === 'https://cdn.example/art/stirred-s01e02.jpg',
            'artwork persists after reload'
        );
        assert(String(reE2?.url || '').includes(R2), 'playback URL persists after reload');
        assert(snapCatalog() === catalogBefore, 'catalog still unchanged after vault reload');

        // --- Theater resolution unchanged for S/E membership; consumes enrichment ---
        const related = resolveRelatedEpisodes(reE2, { readyAssets: reloaded });
        assert(related.members.length >= 3, `related members ≥ 3 (got ${related.members.length})`);
        assert(/stirred/i.test(related.seriesTitle), `series title STIRRED (got ${related.seriesTitle})`);

        const m2 = (related.members || []).find(
            (m) => String(m.assetId || m.reelId) === R2 || String(m.reelId) === R2
        );
        assert(m2?.title === 'Motherland', `viewer consumes enrichment title (got ${m2?.title})`);
        assert(
            m2?.description === 'Stirred begins in the docks.',
            `viewer consumes description (got ${m2?.description})`
        );
        assert(
            m2?.thumbnailUrl === 'https://cdn.example/art/stirred-s01e02.jpg',
            `viewer consumes artwork (got ${m2?.thumbnailUrl})`
        );
        assert(Number(m2?.episodeNumber) === 2 && Number(m2?.seasonNumber) === 1, 'S/E identity still vault-authoritative');

        const relatedPublished = {
            ...related,
            members: (related.members || []).map((m) => ({ ...m, status: 'published' }))
        };
        const view = buildSeriesViewFromRelated(relatedPublished, null);
        const eps = orderedEps(view);
        assert(
            eps.map((e) => e.n).join(',') === '1,2,3',
            `Theater order E1 E2 E3 (got ${eps.map((e) => e.n).join(',')})`
        );
        const shelfE2 = eps.find((e) => e.n === 2);
        assert(shelfE2 && String(shelfE2.id) === R2, 'Theater still maps E2 mediaAssetId');
        assert(shelfE2.title === 'Motherland', `shelf uses enrichment title (got ${shelfE2.title})`);
        assert(
            shelfE2.description === 'Stirred begins in the docks.',
            `shelf carries description (got ${shelfE2.description})`
        );
        assert(
            shelfE2.thumbnailUrl === 'https://cdn.example/art/stirred-s01e02.jpg',
            `shelf carries artwork (got ${shelfE2.thumbnailUrl})`
        );

        // Authority split still holds after viewer handoff
        assert(String(e2?.status) === 'ready', 'publishing still ready after viewer resolve');
        assert(snapCatalog() === catalogBefore, 'catalog displayOrder still unchanged after resolve');

        if (failures.length) {
            console.error(
                'FAIL validate-hero-vault-enrichment\n' +
                    failures.map((f) => `  - ${f}`).join('\n')
            );
            process.exitCode = 1;
        } else {
            console.log('PASS validate-hero-vault-enrichment');
            for (const n of notes) console.log(`  ${n}`);
            console.log('\nEnrichment handoff:', {
                identity: reE2.seriesIdentity,
                package: reE2.episodeEnrichment,
                theaterE2: { id: shelfE2.id, title: shelfE2.title }
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
