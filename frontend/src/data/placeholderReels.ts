import type { Reel } from '../types/reel';

/** Local fallback cards when the API is unreachable or returns an empty list. */
export const PLACEHOLDER_REELS: Reel[] = [
  {
    id: 'placeholder-1',
    title: 'Midnight Heist',
    description: 'A neon-lit thriller reel with quick cuts and a cliffhanger ending.',
    thumbnail_url: null,
    status: 'placeholder',
    created_at: new Date().toISOString(),
  },
  {
    id: 'placeholder-2',
    title: 'Coffee Shop Meet-Cute',
    description: 'Rom-com micro-drama optimized for vertical storytelling.',
    thumbnail_url: null,
    status: 'placeholder',
    created_at: new Date().toISOString(),
  },
  {
    id: 'placeholder-3',
    title: 'The Last Signal',
    description: 'Sci-fi suspense reel with AI-generated b-roll and voiceover.',
    thumbnail_url: null,
    status: 'placeholder',
    created_at: new Date().toISOString(),
  },
];
