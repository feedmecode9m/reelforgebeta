import { createLocalReel } from './api/reelContract.js';

// Demo placeholder cards used when API returns no usable reels.
export function getDemoPlaceholders() {
    return [
        {
            id: 'demo-1',
            title: 'Neon Vengeance (Demo)',
            thumbnail: 'https://via.placeholder.com/480x270.png?text=Neon+Vengeance',
            series: 'series-neon-vengeance',
            readiness: 100
        },
        {
            id: 'demo-2',
            title: 'Vault Chronicles (Demo)',
            thumbnail: 'https://via.placeholder.com/480x270.png?text=Vault+Chronicles',
            series: 'series-vault-chronicles',
            readiness: 100
        },
        {
            id: 'demo-3',
            title: 'Trending Shorts (Demo)',
            thumbnail: 'https://via.placeholder.com/480x270.png?text=Trending+Shorts',
            series: 'series-trending-shorts',
            readiness: 100
        }
    ];
}

/** Build normalized demo reels for feed shelves when the backend catalog is empty. */
export function buildDemoFeedReels() {
    return getDemoPlaceholders().map((placeholder) =>
        createLocalReel({
            id: placeholder.id,
            name: placeholder.title,
            title: placeholder.title,
            url: placeholder.thumbnail,
            thumbnailUrl: placeholder.thumbnail,
            category: 'Trending',
            status: 'ready',
            readiness: 100,
            isPlaceholder: true
        })
    );
}

export default getDemoPlaceholders;
