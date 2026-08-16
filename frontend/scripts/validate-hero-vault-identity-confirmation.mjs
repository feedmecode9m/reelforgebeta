#!/usr/bin/env node
/**
 * Hero Vault creator identity confirmation.
 *
 * Proves: MP4 seal → creator-facing card → edit identity → seal + persist
 *         → catalog order / publishing unchanged → Theater shelf still resolves
 *         → no admin/internal language in creator presentation.
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
        value: { randomUUID: () => '00000000-0000-4000-8000-0000000000cd' },
        configurable: true
    });
}

const R1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01';
const R2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02';
const R3 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb03';

async function main() {
    const server = await createServer({
        root: frontendRoot,
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error'
    });

    try {
        const infer = await server.ssrLoadModule('/src/lib/series/vaultSeriesInference.js');
        const conf = await server.ssrLoadModule('/src/lib/series/vaultIdentityConfirmation.js');
        const {
            resolveRelatedEpisodes,
            buildSeriesViewFromRelated
        } = await server.ssrLoadModule('/src/lib/series/resolveRelatedEpisodes.js');
        const { reelToVaultEntry } = await server.ssrLoadModule('/src/lib/api/reelContract.js');
        const store = await server.ssrLoadModule('/src/lib/series/seriesStore.js');
        const familyLink = await server.ssrLoadModule('/src/lib/series/vaultTheaterFamilyLink.js');

        // --- Structural wiring ---
        const vaultExp = read('src/components/experiences/VaultExperience.svelte');
        const cardSrc = read('src/components/series/VaultIdentityConfirmation.svelte');
        const confSrc = read('src/lib/series/vaultIdentityConfirmation.js');
        assert(
            vaultExp.includes('VaultEpisodeCreatorStatus') ||
                (vaultExp.includes('VaultIdentityConfirmation') &&
                    vaultExp.includes('confirmVaultVideoIdentity')),
            'VaultExperience wires creator identity confirmation'
        );
        assert(
            cardSrc.includes('presentVaultIdentityForCreator'),
            'identity card uses creator presentation module'
        );
        assert(
            /Confirmed from filename\/title/.test(confSrc) &&
                /Needs confirmation/.test(confSrc),
            'status copy: Confirmed from filename/title | Needs confirmation'
        );
        assert(
            !/parseConfidence|confidence score|validator wording|admin metadata/i.test(cardSrc),
            'identity card source has no admin/internal wording'
        );
        assert(
            !cardSrc.toLowerCase().includes('parseconfidence') &&
                !cardSrc.toLowerCase().includes('admin'),
            'identity card omits parser/admin terms'
        );

        const statusCard = read('src/components/series/VaultEpisodeCreatorStatus.svelte');
        assert(
            statusCard.includes('data-theater-family-link') &&
                statusCard.includes('Link selected for Theater') &&
                statusCard.includes('Leave unlinked') &&
                statusCard.includes('siblingIds'),
            'Video Vault edit menu exposes Theater family linker'
        );
        assert(
            vaultExp.includes('applyVaultTheaterFamilyLink') && vaultExp.includes('siblingIds'),
            'VaultExperience persists Theater family siblings'
        );

        {
            const a = {
                id: R1,
                title: 'Motherland 1',
                url: `https://cdn.example/videos/${R1}.mp4`,
                type: 'video'
            };
            const b = {
                id: R2,
                title: 'Motherland 2',
                url: `https://cdn.example/videos/${R2}.mp4`,
                type: 'video'
            };
            const c = {
                id: R3,
                title: 'Unrelated Club Mix',
                url: `https://cdn.example/videos/${R3}.mp4`,
                type: 'video'
            };
            const cands = familyLink.listVaultTheaterLinkCandidates([a, b, c], R1, 'Motherland 1');
            assert(cands.some((row) => row.id === R2 && row.suggested), 'matching title is suggested');
            assert(cands.some((row) => row.id === R3 && !row.suggested), 'unrelated title is not forced');
            const linked = familyLink.applyVaultTheaterFamilyLink([a, b, c], {
                primaryId: R1,
                siblingIds: [R2],
                seriesLabel: 'Motherland',
                seasonNumber: 1
            });
            assert(linked.mutated, 'family link mutates selected rows');
            assert(linked.allowedIds.includes(R1) && linked.allowedIds.includes(R2), 'allowed ids are family members');
            const motherland = linked.list.filter((row) =>
                String(row.seriesLabel || row.seriesIdentity?.seriesLabel || '') === 'Motherland'
            );
            assert(motherland.length === 2, 'two vault rows share Motherland');
            assert(
                String(linked.list.find((row) => row.id === R3)?.seriesLabel || '') === '',
                'unselected row stays unlinked'
            );
            const related = resolveRelatedEpisodes(linked.list.find((row) => row.id === R1), {
                readyAssets: linked.list
            });
            assert(
                (related?.members?.length || 0) >= 2,
                'Theater related resolver sees linked family'
            );
            const drawer = buildSeriesViewFromRelated(related, null);
            const drawerEps = (drawer?.seasons || []).flatMap((s) => s.episodes || []);
            assert(
                drawerEps.length >= 2,
                `All Episodes paints linked vault rows without catalog publish (got ${drawerEps.length})`
            );

            const viaAlias = familyLink.applyVaultTheaterFamilyLink(
                [
                    {
                        id: R1,
                        title: 'MICROS Motherland V1(1)',
                        url: `https://cdn.example/videos/${R1}.mp4`,
                        type: 'video'
                    },
                    {
                        id: R2,
                        assetId: 'arrival-alias',
                        title: '02 ARRIVAL OPEN v1',
                        url: `https://cdn.example/videos/${R2}.mp4`,
                        type: 'video'
                    }
                ],
                {
                    primaryId: R1,
                    siblingIds: ['arrival-alias'],
                    seriesLabel: 'Motherland',
                    seasonNumber: 1
                }
            );
            assert(
                String(viaAlias.list.find((row) => row.id === R2)?.seriesLabel || '') === 'Motherland',
                'checkbox alias id still links 02 Arrival'
            );
            const marked = familyLink.markSameTheaterFamily(
                familyLink.listVaultTheaterLinkCandidates(viaAlias.list, R1, 'MICROS Motherland'),
                'motherland',
                { seedTitle: 'MICROS Motherland V1(1)', seedConfirmed: true }
            );
            assert(
                !marked.some((row) => row.id === R2 && row.sameFamily),
                'Arrival Open is not pre-checked on Motherland after unrelated stamp'
            );
            const theaterSiblings = familyLink.theaterLinkedSiblingIds(viaAlias.list, R1);
            assert(!theaterSiblings.includes(R2), 'unrelated Arrival is not a Theater sibling of Motherland');
            const viaRelated = resolveRelatedEpisodes(viaAlias.list.find((row) => row.id === R1), {
                readyAssets: viaAlias.list
            });
            const viaTitles = (viaRelated?.members || []).map((m) => String(m.title || ''));
            assert(
                !viaTitles.some((t) => /arrival/i.test(t)),
                'Theater All Episodes does not attach Arrival Open to Motherland'
            );

            const unrelated = [
                {
                    id: R1,
                    title: 'MICROS Motherland V1(1)',
                    url: `https://cdn.example/videos/${R1}.mp4`,
                    type: 'video'
                },
                {
                    id: R2,
                    title: '01 ARRIVAL OPEN v1',
                    url: `https://cdn.example/videos/${R2}.mp4`,
                    type: 'video',
                    seriesLabel: '01 Arrival',
                    seriesIdentity: { seriesLabel: '01 Arrival', seasonNumber: 1, episodeNumber: 1 }
                }
            ];
            const unrelatedMarked = familyLink.markSameTheaterFamily(
                familyLink.listVaultTheaterLinkCandidates(unrelated, R1, 'MICROS Motherland V1(1)'),
                familyLink.defaultTheaterFamilyLabel(unrelated[0], 'MICROS Motherland V1(1)')
            );
            assert(
                !unrelatedMarked.some((row) => row.id === R2 && row.sameFamily),
                'MICROS Motherland does not pre-check 01 Arrival Open'
            );
            assert(
                !familyLink.theaterLinkedSiblingIds(unrelated, R1).includes(R2),
                'unrelated Arrival is not a Theater sibling of Motherland'
            );
            assert(
                !familyLink.titlesSuggestTheaterMatch('MICROS Motherland V1(1)', '01 ARRIVAL OPEN v1'),
                'Motherland title does not suggest Arrival Open'
            );

            store.resetSeriesCatalogEmpty?.();
            store.seriesCatalog.set([
                {
                    id: 'series-01-arrival',
                    title: '01 Arrival',
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
                                    episodeId: 'ep-motherland',
                                    episodeNumber: 2,
                                    title: 'MICROS Motherland V1(1)',
                                    status: 'published',
                                    reelId: 'feed-motherland-reel',
                                    mediaAssetId: R1
                                },
                                {
                                    episodeId: 'ep-arrival',
                                    episodeNumber: 1,
                                    title: '01 ARRIVAL OPEN v1',
                                    status: 'published',
                                    reelId: 'feed-arrival-reel',
                                    mediaAssetId: R2
                                }
                            ]
                        }
                    ]
                }
            ]);
            const afterReset = [
                {
                    id: R1,
                    title: 'MICROS Motherland V1(1)',
                    url: `https://cdn.example/videos/${R1}.mp4`,
                    type: 'video'
                },
                {
                    id: R2,
                    title: '01 ARRIVAL OPEN v1',
                    url: `https://cdn.example/videos/${R2}.mp4`,
                    type: 'video'
                }
            ];
            const resetSiblings = familyLink.theaterLinkedSiblingIds(afterReset, R1);
            assert(
                !resetSiblings.includes(R2),
                'catalog co-membership does not force Arrival checkbox after reset'
            );
            store.resetSeriesCatalogEmpty?.();

            const untitledA = {
                id: R1,
                name: '',
                title: '',
                url: `https://cdn.example/videos/${R1}.mp4`,
                type: 'video',
                seriesIdentity: {
                    seriesLabel: 'Motherland',
                    seasonNumber: 1,
                    episodeNumber: 1,
                    confirmedByCreator: true
                },
                seriesLabel: 'Motherland',
                seasonNumber: 1,
                episodeNumber: 1
            };
            const untitledB = {
                id: R2,
                name: '',
                title: '',
                url: `https://cdn.example/videos/${R2}.mp4`,
                type: 'video',
                seriesIdentity: {
                    seriesLabel: 'Motherland',
                    seasonNumber: 1,
                    episodeNumber: 2,
                    confirmedByCreator: true
                },
                seriesLabel: 'Motherland',
                seasonNumber: 1,
                episodeNumber: 2
            };
            const untitledRelated = resolveRelatedEpisodes(untitledA, {
                readyAssets: [untitledA, untitledB]
            });
            assert(
                (untitledRelated?.members?.length || 0) >= 2,
                'creator-linked family groups even when vault titles are blank'
            );
            const untitledDrawer = buildSeriesViewFromRelated(untitledRelated, null);
            assert(
                ((untitledDrawer?.seasons || []).flatMap((s) => s.episodes || [])).length >= 2,
                'All Episodes paints blank-title linked family'
            );
        }

        // --- Phase 1: Upload MP4 STIRRED_S01E02 → seal + presentation ---
        const rawUpload = {
            id: R2,
            name: 'STIRRED_S01E02.mp4',
            fileName: 'STIRRED_S01E02.mp4',
            url: `https://cdn.example/videos/${R2}.mp4`,
            thumbnailUrl: 'https://cdn.example/thumbs/e2.jpg',
            type: 'video',
            createdAt: '2026-01-02T00:00:00.000Z'
        };
        const vaultEntry = reelToVaultEntry(rawUpload);
        const sealed = infer.sealVaultSeriesIdentityForStorage({
            ...vaultEntry,
            size: 12_000_000,
            type: 'video/mp4',
            addedAt: rawUpload.createdAt
        }) || vaultEntry;

        assert(
            sealed.seriesIdentity?.seriesLabel?.toUpperCase() === 'STIRRED' &&
                sealed.seriesIdentity?.seasonNumber === 1 &&
                sealed.seriesIdentity?.episodeNumber === 2,
            `parser recognizes STIRRED S1 E2 (${JSON.stringify(sealed.seriesIdentity)})`
        );
        assert(!('confidence' in (sealed.seriesIdentity || {})), 'sealed identity omits confidence');
        assert(
            !('parseConfidence' in (sealed.seriesIdentity || {})),
            'sealed identity omits parseConfidence'
        );
        assert(String(sealed.id) === R2, 'upload preserves mediaAssetId');

        const presentation = conf.presentVaultIdentityForCreator(sealed);
        assert(
            presentation.statusLabel === conf.CREATOR_IDENTITY_STATUS.CONFIRMED_FROM_FILENAME,
            `creator sees confirmation: ${presentation.statusLabel}`
        );
        assert(presentation.seriesDisplay === 'STIRRED', 'Series: STIRRED');
        assert(presentation.seasonDisplay === 'Season 1', 'Season: Season 1');
        assert(presentation.episodeDisplay === 'Episode 2', 'Episode: Episode 2');
        assert(
            conf.isCreatorIdentityCopySafe(presentation),
            'presentation copy is creator-safe (no banned terms)'
        );
        assert(presentation.mediaAssetId === R2, 'presentation carries mediaAssetId');
        assert(
            !JSON.stringify(presentation).toLowerCase().includes('confidence'),
            'presentation JSON has no confidence field'
        );

        // Needs confirmation path
        const bare = infer.sealVaultSeriesIdentityForStorage({
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc09',
            name: 'home-video-clip.mp4',
            fileName: 'home-video-clip.mp4',
            url: 'https://cdn.example/videos/bare.mp4',
            type: 'video'
        });
        const needs = conf.presentVaultIdentityForCreator(bare);
        assert(
            needs.statusLabel === conf.CREATOR_IDENTITY_STATUS.NEEDS_CONFIRMATION,
            `unrecognized file needs confirmation: ${needs.statusLabel}`
        );
        assert(conf.isCreatorIdentityCopySafe(needs), 'needs-confirmation copy is safe');

        // --- Catalog fixture (order + publish must not change on identity edit) ---
        bag.clear();
        store.resetSeriesCatalogEmpty?.();
        const seriesId = 'series-stirred-identity-confirm';
        /** @type {any} */
        const series = {
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
        };
        store.seriesCatalog.set([series]);
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

        // --- Phase 2: Creator confirms / corrects identity (vault only) ---
        const confirmed = conf.applyCreatorVaultIdentityConfirmation(sealed, {
            seriesLabel: 'STIRRED',
            seasonNumber: 1,
            episodeNumber: 2
        });
        assert(String(confirmed.id) === R2, 'mediaAssetId preserved after confirm');
        assert(
            String(confirmed.url || '').includes(R2) || String(confirmed.url || '').includes('/videos/'),
            'playback url reference preserved'
        );
        assert(
            confirmed.seriesIdentity?.seriesLabel === 'STIRRED' &&
                confirmed.seriesIdentity?.seasonNumber === 1 &&
                confirmed.seriesIdentity?.episodeNumber === 2 &&
                confirmed.seriesIdentity?.confirmedByCreator === true,
            'sealed identity after creator save'
        );
        assert(
            !('confidence' in (confirmed.seriesIdentity || {})),
            'post-edit seal still omits confidence'
        );

        const afterPresent = conf.presentVaultIdentityForCreator(confirmed);
        assert(
            afterPresent.statusLabel === conf.CREATOR_IDENTITY_STATUS.CONFIRMED,
            `after save status: ${afterPresent.statusLabel}`
        );
        assert(conf.isCreatorIdentityCopySafe(afterPresent), 'post-edit presentation copy safe');

        // Creator can correct numbers without clobbering media id
        const renumbered = conf.applyCreatorVaultIdentityConfirmation(confirmed, {
            seriesLabel: 'STIRRED',
            seasonNumber: 1,
            episodeNumber: 5
        });
        assert(String(renumbered.id) === R2, 'renumber keeps mediaAssetId');
        assert(renumbered.seriesIdentity?.episodeNumber === 5, 'creator episode correction applied');
        // restore for shelf
        const finalConfirmed = conf.applyCreatorVaultIdentityConfirmation(renumbered, {
            seriesLabel: 'STIRRED',
            seasonNumber: 1,
            episodeNumber: 2
        });

        // Catalog authority unchanged
        assert(snapCatalog() === catalogBefore, 'catalog order/status unchanged by vault identity edit');
        const e2wrap = store.getEpisodeById('ep-s01e02');
        const e2cat = e2wrap?.episode;
        assert(String(e2cat?.status) === 'ready', `publishing state unchanged (ready got ${e2cat?.status})`);
        assert(Number(e2cat?.episodeNumber) === 2, `catalog episodeNumber not rewritten (got ${e2cat?.episodeNumber})`);

        // --- Phase 3: Persistence (refresh / logout-login simulation) ---
        const vaultKey = 'personal_video_vault';
        const siblings = [
            infer.sealVaultSeriesIdentityForStorage(
                reelToVaultEntry({
                    id: R1,
                    name: 'STIRRED_S01E01.mp4',
                    fileName: 'STIRRED_S01E01.mp4',
                    url: `https://cdn.example/videos/${R1}.mp4`,
                    type: 'video'
                })
            ),
            finalConfirmed,
            infer.sealVaultSeriesIdentityForStorage(
                reelToVaultEntry({
                    id: R3,
                    name: 'STIRRED_S01E03.mp4',
                    fileName: 'STIRRED_S01E03.mp4',
                    url: `https://cdn.example/videos/${R3}.mp4`,
                    type: 'video'
                })
            )
        ].filter(Boolean);

        localStorage.setItem(vaultKey, JSON.stringify(siblings));
        // Simulate new session: wipe in-memory bag-independent parse
        const reloadedRaw = JSON.parse(localStorage.getItem(vaultKey) || '[]');
        const reloaded = reloadedRaw.map((item) =>
            infer.sealVaultSeriesIdentityForStorage(item)
        );
        const reE2 = reloaded.find((v) => String(v?.id) === R2);
        assert(
            reE2?.seriesIdentity?.seriesLabel === 'STIRRED' &&
                reE2?.seriesIdentity?.seasonNumber === 1 &&
                reE2?.seriesIdentity?.episodeNumber === 2 &&
                reE2?.seriesIdentity?.confirmedByCreator === true,
            'identity persists after reload serialization'
        );
        assert(snapCatalog() === catalogBefore, 'catalog still unchanged after vault reload sim');

        // --- Phase 4: Viewer / Theater shelf ---
        const related = resolveRelatedEpisodes(reE2, { readyAssets: reloaded });
        assert(related.members.length >= 3, `related members ≥ 3 (got ${related.members.length})`);
        assert(/stirred/i.test(related.seriesTitle), `viewer series title STIRRED (got ${related.seriesTitle})`);

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
        const e2 = eps.find((e) => e.n === 2);
        assert(e2 && String(e2.id) === R2, `E2 maps to mediaAssetId ${R2}`);
        assert(
            eps.every((e) => String(e.label || 'STIRRED').toUpperCase() === 'STIRRED'),
            'shelf labels STIRRED on all episodes'
        );

        // UI wiring copy-safety sample lines
        const shelfLines = eps.map(
            (e) => `${String(e.n).padStart(2, '0')} ${e.label || 'STIRRED'} • S1 • E${e.n}`
        );
        assert(
            shelfLines.join('|') === '01 STIRRED • S1 • E1|02 STIRRED • S1 • E2|03 STIRRED • S1 • E3',
            `Theater lines: ${shelfLines.join(' | ')}`
        );
        assert(
            conf.isCreatorIdentityCopySafe(presentation, shelfLines),
            'no admin/internal language appears in confirmed copy surface'
        );

        if (failures.length) {
            console.error(
                'FAIL validate-hero-vault-identity-confirmation\n' +
                    failures.map((f) => `  - ${f}`).join('\n')
            );
            process.exitCode = 1;
        } else {
            console.log('PASS validate-hero-vault-identity-confirmation');
            for (const n of notes) console.log(`  ${n}`);
            console.log('\nTheater shelf model:', {
                title: view?.title,
                episodes: shelfLines,
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
