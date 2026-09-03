/**
 * Vic G creator series package — structural catalog identity only.
 *
 * Series title: "Vic G"
 * Episode media identity: stable reelId / mediaAssetId
 * Episode display titles: reel_titles_persistent → resolveLinkedAssetDisplayTitle
 *   (package episode.title stays empty so package text is never a second title authority)
 *
 * Not a demo fixture. Not derived from title similarity.
 */

/** @type {string} */
export const VIC_G_SERIES_ID = 'series-vic-g';

/** @type {string} */
export const VIC_G_SERIES_TITLE = 'Vic G';

/**
 * Stable production reel identities (episode order).
 * @type {readonly {
 *   episodeNumber: number;
 *   reelId: string;
 *   episodeId: string;
 * }[]}
 */
export const VIC_G_EPISODE_BINDINGS = Object.freeze([
    {
        episodeNumber: 1,
        reelId: '03ef898a-989f-42c3-bdbb-67f37338df65',
        episodeId: 'ep-vic-g-s01e01'
    },
    {
        episodeNumber: 2,
        reelId: 'cadfcabc-1947-4341-86a3-f82a08e78669',
        episodeId: 'ep-vic-g-s01e02'
    },
    {
        episodeNumber: 3,
        reelId: '3894107e-ae44-43c5-af72-b3f5d5e0ad90',
        episodeId: 'ep-vic-g-s01e03'
    },
    {
        episodeNumber: 4,
        reelId: 'b3a87c96-6ea0-4854-a0bc-6b0f2442f9a1',
        episodeId: 'ep-vic-g-s01e04'
    },
    {
        episodeNumber: 5,
        reelId: 'efb01cee-9477-4477-982a-7611cfc08fcc',
        episodeId: 'ep-vic-g-s01e05'
    },
    {
        episodeNumber: 6,
        reelId: '5cc786f0-8fbe-4f96-a59d-02014b0cc56f',
        episodeId: 'ep-vic-g-s01e06'
    }
]);

/** @type {ReadonlySet<string>} */
export const VIC_G_REEL_IDS = Object.freeze(
    new Set(VIC_G_EPISODE_BINDINGS.map((b) => b.reelId))
);

/**
 * @returns {import('./seriesTypes.js').Series}
 */
export function buildVicGSeriesPackage() {
    return {
        id: VIC_G_SERIES_ID,
        title: VIC_G_SERIES_TITLE,
        // Poster remains catalog/Hero-Vault supplied; package should not hardcode a viewer file path.
        poster: '',
        description: '',
        tags: ['creator-package', 'creator-confirmed'],
        confirmedByCreator: true,
        seasons: [
            {
                seasonId: 'season-vic-g-1',
                seasonNumber: 1,
                title: 'Season 1',
                description: '',
                episodes: VIC_G_EPISODE_BINDINGS.map((b, index) => ({
                    episodeId: b.episodeId,
                    episodeNumber: b.episodeNumber,
                    displayOrder: index,
                    // Empty: viewer title is canonical reel title, not package marketing copy.
                    title: '',
                    description: '',
                    status: /** @type {const} */ ('published'),
                    reelId: b.reelId,
                    mediaAssetId: b.reelId,
                    heroVaultAssetId: b.reelId,
                    heroVaultBindingMode: /** @type {const} */ ('manual'),
                    bindingAuthority: 'creator',
                    confirmedByCreator: true,
                    identitySource: 'creator'
                }))
            }
        ]
    };
}

/**
 * Pure merge: ensure Vic G package is present with exact reel bindings.
 * Detaches these reelIds from any other series (structural exclusivity).
 *
 * @param {import('./seriesTypes.js').Series[] | null | undefined} catalogItems
 * @returns {import('./seriesTypes.js').Series[]}
 */
/**
 * All reel/media ids exclusively owned by Vic G (package + any live catalog rows).
 *
 * @param {import('./seriesTypes.js').Series[] | null | undefined} catalogItems
 * @param {import('./seriesTypes.js').Series | null | undefined} vicSeries
 * @returns {Set<string>}
 */
function collectVicGExclusiveReelIds(catalogItems, vicSeries) {
    /** @type {Set<string>} */
    const ids = new Set(VIC_G_EPISODE_BINDINGS.map((b) => b.reelId).filter(Boolean));
    const vic =
        vicSeries ||
        (Array.isArray(catalogItems)
            ? catalogItems.find((series) => series?.id === VIC_G_SERIES_ID)
            : null);
    if (!vic) return ids;
    for (const season of vic.seasons || []) {
        for (const episode of season.episodes || []) {
            for (const key of ['reelId', 'mediaAssetId', 'heroVaultAssetId']) {
                const value =
                    episode?.[key] != null ? String(/** @type {Record<string, unknown>} */ (episode)[key]).trim() : '';
                if (value) ids.add(value);
            }
        }
    }
    return ids;
}

export function mergeVicGSeriesIntoCatalog(catalogItems) {
    const list = Array.isArray(catalogItems) ? catalogItems.slice() : [];
    const existingVicSeries = list.find((series) => series?.id === VIC_G_SERIES_ID) || null;
    const pkg = existingVicSeries || buildVicGSeriesPackage();
    const reelIds = collectVicGExclusiveReelIds(list, pkg);

    /** @param {import('./seriesTypes.js').Series} series */
    const stripReels = (series) => {
        if (!series || series.id === VIC_G_SERIES_ID) return series;
        let changed = false;
        const seasons = (series.seasons || []).map((season) => {
            const episodes = (season.episodes || []).map((ep) => {
                const rid = ep?.reelId != null ? String(ep.reelId).trim() : '';
                const media =
                    ep?.mediaAssetId != null ? String(ep.mediaAssetId).trim() : '';
                const hero =
                    ep?.heroVaultAssetId != null ? String(ep.heroVaultAssetId).trim() : '';
                if (rid && reelIds.has(rid)) {
                    changed = true;
                    return {
                        ...ep,
                        reelId: null,
                        mediaAssetId: media && reelIds.has(media) ? null : ep.mediaAssetId || null,
                        heroVaultAssetId: hero && reelIds.has(hero) ? null : ep.heroVaultAssetId || null
                    };
                }
                if (media && reelIds.has(media)) {
                    changed = true;
                    return {
                        ...ep,
                        mediaAssetId: null,
                        heroVaultAssetId: hero && reelIds.has(hero) ? null : ep.heroVaultAssetId || null
                    };
                }
                return ep;
            });
            return { ...season, episodes };
        });
        return changed ? { ...series, seasons } : series;
    };

    const stripped = list.map(stripReels).filter((s) => s && s.id !== VIC_G_SERIES_ID);
    return [...stripped, pkg];
}

/**
 * @param {string} reelId
 * @returns {{ episodeNumber: number; episodeId: string; seriesId: string } | null}
 */
export function lookupVicGEpisodeBinding(reelId) {
    const id = String(reelId || '').trim();
    if (!id || !VIC_G_REEL_IDS.has(id)) return null;
    const row = VIC_G_EPISODE_BINDINGS.find((b) => b.reelId === id);
    if (!row) return null;
    return {
        episodeNumber: row.episodeNumber,
        episodeId: row.episodeId,
        seriesId: VIC_G_SERIES_ID
    };
}
