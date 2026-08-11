#!/usr/bin/env node
/**
 * Vic G series package — real catalog bindings (not title fuzzy matching).
 *
 * Proves A–J: same series, 1:1 reel↔episode, order, family from any seed reel,
 * title isolation via reel_titles_persistent, no non-Vic contamination.
 */
import { createServer } from 'vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

let failed = 0;
/** @param {boolean} cond @param {string} label */
function assert(cond, label) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}`);
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

const R1 = '03ef898a-989f-42c3-bdbb-67f37338df65';
const R2 = 'd2aafde7-d7ba-492c-a860-20b51f7f4033';
const R3 = '3894107e-ae44-43c5-af72-b3f5d5e0ad90';
const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

async function main() {
    console.log('\n[vic-g-series-package — catalog bindings]');

    const server = await createServer({
        root,
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error'
    });

    try {
        const pkg = await server.ssrLoadModule('/src/lib/series/vicGSeriesPackage.js');
        const store = await server.ssrLoadModule('/src/lib/series/seriesStore.js');
        const related = await server.ssrLoadModule('/src/lib/series/resolveRelatedEpisodes.js');
        const titleIntel = await server.ssrLoadModule('/src/lib/hero/heroTitleIntelligence.js');

        assert(pkg.VIC_G_SERIES_ID === 'series-vic-g', 'series id series-vic-g');
        assert(pkg.VIC_G_SERIES_TITLE === 'Vic G', 'series structural title Vic G');
        assert(pkg.VIC_G_EPISODE_BINDINGS.length === 3, 'exactly 3 episode bindings');

        // A / B / C pure package
        const built = pkg.buildVicGSeriesPackage();
        const eps = built.seasons?.[0]?.episodes || [];
        assert(eps.length === 3, 'A: package has 3 episodes');
        assert(
            eps.every((e, i) => e.episodeNumber === i + 1 && e.displayOrder === i),
            'C: deterministic season/episode order 1..3'
        );
        assert(
            new Set(eps.map((e) => e.reelId)).size === 3,
            'B: each reel maps to one episode (unique reelIds)'
        );
        assert(
            eps[0].reelId === R1 && eps[1].reelId === R2 && eps[2].reelId === R3,
            'B: reelIds match production Vic G assets in order E1/E2/E3'
        );
        assert(
            eps.every((e) => e.mediaAssetId === e.reelId && e.title === ''),
            'display titles not package-authored (empty package title)'
        );

        // Merge exclusivity
        const polluted = pkg.mergeVicGSeriesIntoCatalog([
            {
                id: 'series-other',
                title: 'Other',
                seasons: [
                    {
                        seasonNumber: 1,
                        episodes: [
                            {
                                episodeId: 'ep-other-1',
                                episodeNumber: 1,
                                title: 'Keep me',
                                status: 'published',
                                reelId: OTHER
                            },
                            {
                                episodeId: 'ep-steal',
                                episodeNumber: 2,
                                title: 'Stolen Vic',
                                status: 'published',
                                reelId: R1
                            }
                        ]
                    }
                ]
            }
        ]);
        const other = polluted.find((s) => s.id === 'series-other');
        const stolen = other?.seasons?.[0]?.episodes?.find((e) => e.episodeId === 'ep-steal');
        assert(stolen?.reelId == null, 'I: Vic G reel detached from foreign series');
        assert(
            other?.seasons?.[0]?.episodes?.find((e) => e.episodeId === 'ep-other-1')?.reelId ===
                OTHER,
            'I: non-Vic reel remains on foreign series'
        );
        assert(
            polluted.some((s) => s.id === pkg.VIC_G_SERIES_ID),
            'package present after merge'
        );

        // Live store
        bag.clear();
        store.applyAuthoritativeApiCatalog([
            {
                id: 'series-noise',
                title: 'Noise Show',
                seasons: [
                    {
                        seasonNumber: 1,
                        episodes: [
                            {
                                episodeId: 'ep-noise',
                                episodeNumber: 1,
                                title: 'Noise',
                                status: 'published',
                                reelId: OTHER
                            }
                        ]
                    }
                ]
            }
        ]);

        const vic = store.getSeriesById(pkg.VIC_G_SERIES_ID);
        assert(Boolean(vic), 'A: live catalog has series-vic-g after API apply');
        assert(String(vic?.title || '') === 'Vic G', 'series structural title retained');

        const ctx1 = store.getEpisodeByReelId(R1);
        const ctx2 = store.getEpisodeByReelId(R2);
        const ctx3 = store.getEpisodeByReelId(R3);
        assert(ctx1?.series?.id === pkg.VIC_G_SERIES_ID, 'A: R1 belongs to Vic G');
        assert(ctx2?.series?.id === pkg.VIC_G_SERIES_ID, 'A: R2 belongs to Vic G');
        assert(ctx3?.series?.id === pkg.VIC_G_SERIES_ID, 'A: R3 belongs to Vic G');
        assert(ctx1?.episode?.episodeNumber === 1, 'B/C: R1 → E1');
        assert(ctx2?.episode?.episodeNumber === 2, 'B/C: R2 → E2');
        assert(ctx3?.episode?.episodeNumber === 3, 'B/C: R3 → E3');

        // D / F — family from ANY seed using only catalog bindings + API titles (no Vic fuzzy needed)
        const ready = [
            {
                id: R1,
                name: '01 ARRIVAL OPEN v1',
                title: '01 ARRIVAL OPEN v1',
                url: 'https://cdn.example/a.mp4',
                status: 'ready',
                type: 'video'
            },
            {
                id: R2,
                name: '03 CLUB POOM POOM V1',
                title: '03 CLUB POOM POOM V1',
                url: 'https://cdn.example/b.mp4',
                status: 'ready',
                type: 'video'
            },
            {
                id: R3,
                name: 'condo v1 2',
                title: 'condo v1 2',
                url: 'https://cdn.example/c.mp4',
                status: 'ready',
                type: 'video'
            },
            {
                id: OTHER,
                name: 'Unrelated Short',
                title: 'Unrelated Short',
                url: 'https://cdn.example/x.mp4',
                status: 'ready',
                type: 'video'
            }
        ];

        for (const seed of ready.slice(0, 3)) {
            const family = related.resolveRelatedEpisodes(seed, { readyAssets: ready });
            const reelSet = new Set(
                (family.members || []).map((m) => String(m.reelId || m.assetId || ''))
            );
            assert(
                family.seriesId === pkg.VIC_G_SERIES_ID ||
                    (family.members || []).filter((m) =>
                        [R1, R2, R3].includes(String(m.reelId || ''))
                    ).length >= 3,
                `D: seed ${seed.id.slice(0, 8)}… resolves Vic G family (seriesId=${family.seriesId})`
            );
            assert(reelSet.has(R1) && reelSet.has(R2) && reelSet.has(R3), 'F: all 3 Vic reels in members');
            assert(!reelSet.has(OTHER), 'I: unrelated reel not in Vic G family');
            assert(
                (family.members || []).filter((m) =>
                    [R1, R2, R3].includes(String(m.reelId || ''))
                ).length === 3,
                'D: exactly the three Vic members (no duplicates invent)'
            );
        }

        // E — selected reel is active episode context
        const asCtx = store.resolveSeriesContextForReel({ id: R2, name: 'stale' });
        assert(asCtx?.episode?.reelId === R2, 'E: active reel id is seed');
        assert(asCtx?.episode?.episodeNumber === 2, 'E: current episode is E2 for R2');
        assert(asCtx?.series?.id === pkg.VIC_G_SERIES_ID, 'E: series context is Vic G');

        // G / H — persistent title isolation
        const PERSIST = titleIntel.REEL_TITLES_PERSISTENT_KEY;
        const map = {
            [R1]: { title: 'Vic G Night Run', title_original: 'Vic G Night Run' },
            [R2]: { title: 'Vic G POOM', title_original: 'Vic G POOM' },
            [R3]: { title: 'Vic G condo cut', title_original: 'Vic G condo cut' }
        };
        localStorage.setItem(PERSIST, JSON.stringify(map));

        const t1 = titleIntel.resolveLinkedAssetDisplayTitle(R1, {
            assetTitle: '01 ARRIVAL OPEN v1',
            episodeTitle: asCtx?.episode?.title || ''
        });
        const t2 = titleIntel.resolveLinkedAssetDisplayTitle(R2, {
            assetTitle: '03 CLUB POOM POOM V1'
        });
        const t3 = titleIntel.resolveLinkedAssetDisplayTitle(R3, {
            assetTitle: 'condo v1 2'
        });
        assert(t1 === 'Vic G Night Run', 'G: R1 uses persistent title');
        assert(t2 === 'Vic G POOM', 'G: R2 uses persistent title');
        assert(t3 === 'Vic G condo cut', 'G: R3 uses persistent title');

        map[R1] = { title: 'Vic G Night Run EDIT', title_original: 'Vic G Night Run EDIT' };
        localStorage.setItem(PERSIST, JSON.stringify(map));
        const t1b = titleIntel.resolveLinkedAssetDisplayTitle(R1, {
            assetTitle: '01 ARRIVAL OPEN v1'
        });
        const t2b = titleIntel.resolveLinkedAssetDisplayTitle(R2, {
            assetTitle: '03 CLUB POOM POOM V1'
        });
        assert(t1b === 'Vic G Night Run EDIT', 'H: renames E1 title');
        assert(t2b === 'Vic G POOM', 'H: renames E1 does not change E2');

        // J — wiring: no fuzzy dependency required
        const packageSrc = readFileSync(join(root, 'src/lib/series/vicGSeriesPackage.js'), 'utf8');
        assert(
            packageSrc.includes(R1) && packageSrc.includes(R2) && packageSrc.includes(R3),
            'J: package hard-binds production reel UUIDs'
        );
        assert(
            !packageSrc.includes('sharesEntityTokenPrefix') &&
                !packageSrc.includes('titlesRelated'),
            'J: package module does not use title fuzzy matching'
        );
        const storeSrc = readFileSync(join(root, 'src/lib/series/seriesStore.js'), 'utf8');
        assert(
            storeSrc.includes('mergeVicGSeriesIntoCatalog') &&
                storeSrc.includes('ensureVicGSeriesPackage'),
            'store hydrates Vic G package on catalog apply'
        );

        // drawer view
        const fromR1 = related.resolveRelatedEpisodes(ready[0], { readyAssets: ready });
        const view = related.buildSeriesViewFromRelated(
            {
                ...fromR1,
                members: (fromR1.members || []).map((m) => ({ ...m, status: 'published' }))
            },
            store.getSeriesById(pkg.VIC_G_SERIES_ID)
        );
        const viewReels = (view?.seasons || [])
            .flatMap((s) => s.episodes || [])
            .map((e) => String(e.reelId || e.mediaAssetId || ''));
        assert(
            viewReels.includes(R1) && viewReels.includes(R2) && viewReels.includes(R3),
            'F: Series drawer view contains all three reels'
        );
        assert(
            (view?.seasons || []).some((s) => (s.episodes || []).length >= 3) ||
                viewReels.length >= 3,
            'hasSeriesDrawer family size ≥ 3'
        );
    } finally {
        await server.close();
    }

    if (failed) {
        console.error(`\n✗ vic-g series package failed (${failed})\n`);
        process.exit(1);
    }
    console.log('\n✓ vic-g series package acceptance passed\n');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
