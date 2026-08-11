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
        reelId: 'd2aafde7-d7ba-492c-a860-20b51f7f4033',
        episodeId: 'ep-vic-g-s01e02'
    },
    {
        episodeNumber: 3,
        reelId: '3894107e-ae44-43c5-af72-b3f5d5e0ad90',
        episodeId: 'ep-vic-g-s01e03'
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
export function mergeVicGSeriesIntoCatalog(catalogItems) {
    const list = Array.isArray(catalogItems) ? catalogItems.slice() : [];
    const pkg = buildVicGSeriesPackage();
    const reelIds = VIC_G_REEL_IDS;

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
