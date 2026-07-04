/**
 * Mock series catalog — local metadata only (Phase 1).
 * `reelId` values are placeholders that can map to existing feed reels in later phases.
 */

/** @type {import('./seriesTypes.js').Series[]} */
export const MOCK_SERIES_CATALOG = [
    {
        id: 'series-neon-vengeance',
        title: 'Neon Vengeance',
        description: 'The code was his legacy. The betrayal was his rebirth.',
        genre: 'Cyber-Action',
        releaseYear: 2024,
        poster: '/thumbs/IMG_0113.JPEG',
        seasons: [
            {
                seasonId: 'season-neon-vengeance-1',
                seasonNumber: 1,
                title: 'Season 1 — Awakening',
                episodes: [
                    {
                        episodeId: 'ep-neon-s01e01',
                        episodeNumber: 1,
                        title: 'Ghost in the Grid',
                        description: 'A hacker discovers encrypted memories buried in corporate servers.',
                        runtime: 312,
                        status: 'published',
                        reelId: 'reel-neon-s01e01'
                    },
                    {
                        episodeId: 'ep-neon-s01e02',
                        episodeNumber: 2,
                        title: 'Blood Protocol',
                        description: 'Old allies resurface with a price on his identity.',
                        runtime: 298,
                        status: 'published',
                        reelId: 'reel-neon-s01e02'
                    },
                    {
                        episodeId: 'ep-neon-s01e03',
                        episodeNumber: 3,
                        title: 'Midnight Firewall',
                        description: 'The syndicate closes in as the city burns neon.',
                        runtime: 305,
                        status: 'ready',
                        reelId: 'reel-neon-s01e03'
                    },
                    {
                        episodeId: 'ep-neon-s01e04',
                        episodeNumber: 4,
                        title: 'Zero Day',
                        description: 'Finale — one exploit left to expose the truth.',
                        runtime: 340,
                        status: 'draft',
                        reelId: null
                    }
                ]
            },
            {
                seasonId: 'season-neon-vengeance-2',
                seasonNumber: 2,
                title: 'Season 2 — Reckoning',
                episodes: [
                    {
                        episodeId: 'ep-neon-s02e01',
                        episodeNumber: 1,
                        title: 'After the Breach',
                        description: 'Six months later, the grid remembers everything.',
                        runtime: 318,
                        status: 'published',
                        reelId: 'reel-neon-s02e01'
                    },
                    {
                        episodeId: 'ep-neon-s02e02',
                        episodeNumber: 2,
                        title: 'Corporate Eclipse',
                        description: 'A hostile takeover threatens the underground network.',
                        runtime: 290,
                        status: 'published',
                        reelId: 'reel-neon-s02e02'
                    }
                ]
            }
        ]
    },
    {
        id: 'series-vault-chronicles',
        title: 'Vault Chronicles',
        description: 'Micro-dramas pulled from the personal video vault.',
        releaseYear: 2025,
        poster: '/thumbs/IMG_0113.JPEG',
        seasons: [
            {
                seasonId: 'season-vault-chronicles-1',
                seasonNumber: 1,
                title: 'Season 1',
                episodes: [
                    {
                        episodeId: 'ep-vault-s01e01',
                        episodeNumber: 1,
                        title: 'First Cut',
                        description: 'An unlisted vault clip becomes episode one.',
                        runtime: 180,
                        status: 'published',
                        reelId: 'reel-vault-s01e01'
                    },
                    {
                        episodeId: 'ep-vault-s01e02',
                        episodeNumber: 2,
                        title: 'Second Take',
                        description: 'Behind-the-scenes energy from the creator vault.',
                        runtime: 165,
                        status: 'published',
                        reelId: 'reel-vault-s01e02'
                    },
                    {
                        episodeId: 'ep-vault-s01e03',
                        episodeNumber: 3,
                        title: 'Locked Draft',
                        description: 'Episode metadata exists; reel attach pending.',
                        runtime: 0,
                        status: 'draft',
                        reelId: null
                    }
                ]
            }
        ]
    },
    {
        id: 'series-trending-shorts',
        title: 'Trending Shorts',
        description: 'Curated vertical shorts packaged as a bingeable mini-series.',
        releaseYear: 2025,
        poster: '/thumbs/IMG_0113.JPEG',
        seasons: [
            {
                seasonId: 'season-trending-shorts-1',
                seasonNumber: 1,
                episodes: [
                    {
                        episodeId: 'ep-trending-s01e01',
                        episodeNumber: 1,
                        title: 'Hook — 15s',
                        description: 'Cold open optimized for feed autoplay.',
                        runtime: 15,
                        status: 'published',
                        reelId: 'reel-trending-s01e01'
                    },
                    {
                        episodeId: 'ep-trending-s01e02',
                        episodeNumber: 2,
                        title: 'Pulse',
                        description: 'High-energy vertical beat.',
                        runtime: 22,
                        status: 'published',
                        reelId: 'reel-trending-s01e02'
                    },
                    {
                        episodeId: 'ep-trending-s01e03',
                        episodeNumber: 3,
                        title: 'Cliffhanger',
                        description: 'Swipe-up target for theater chaining.',
                        runtime: 28,
                        status: 'ready',
                        reelId: 'reel-trending-s01e03'
                    }
                ]
            }
        ]
    }
];
