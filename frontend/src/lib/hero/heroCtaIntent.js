/**
 * Homepage hero Watch Now / Learn More intent (no Vite/runtime imports).
 *
 * `/series/neon-vengeance` and the old collection/category titles (Black Agriculture, …)
 * were hardcoded demo copy — never treat them as campaign destinations or story identity.
 */

import { DEFAULT_COLLECTION_TITLES } from '../collections/collectionIntelligence.js';
import { DEMO_EPISODE_TITLES, DEMO_SERIES_IDS } from '../series/seriesCatalogTruth.js';

/** @param {unknown} value */
function slugify(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

const LEGACY_DEMO_SERIES_SLUGS = new Set(
    DEMO_SERIES_IDS.flatMap((id) => {
        const slug = slugify(id);
        const bare = slug.replace(/^series-/, '');
        return [slug, bare, `series-${bare}`];
    })
);

const LEGACY_CATEGORY_TITLE_SLUGS = new Set(
    DEFAULT_COLLECTION_TITLES.map((title) => slugify(title)).filter(Boolean)
);

const LEGACY_DEMO_TITLES = new Set(
    ['Neon Vengeance', ...DEMO_EPISODE_TITLES, ...DEFAULT_COLLECTION_TITLES].map((t) =>
        String(t).trim().toLowerCase()
    )
);

/**
 * Old hardcoded category / demo series labels that were reused as titles and descriptions.
 * @param {unknown} value
 */
export function isLegacyHeroDemoCopy(value) {
    const text = String(value || '').trim();
    if (!text) return false;
    const lower = text.toLowerCase().replace(/\s+/g, ' ');
    if (LEGACY_DEMO_TITLES.has(lower)) return true;
    if (/neon[\s_-]*vengeance/i.test(text)) return true;
    if (/stories curated for/i.test(text)) return true;
    if (/documentary collection\.?$/i.test(text)) return true;
    if (/the code was his legacy/i.test(text)) return true;
    return false;
}

/**
 * Strip leftover demo/category CTA paths. Explicit non-demo paths are preserved.
 * @param {unknown} raw
 * @returns {string}
 */
export function sanitizeHeroCtaTarget(raw) {
    const resolved = String(raw || '').trim();
    if (!resolved) return '';
    if (isLegacyHeroDemoCopy(resolved)) return '';
    const withoutOrigin = resolved.replace(/^https?:\/\/[^/]+/i, '');
    const normalized = withoutOrigin.replace(/\/+$/, '') || '/';
    const seriesMatch = normalized.match(/^\/series\/([^/?#]+)/i);
    if (seriesMatch) {
        const slug = slugify(seriesMatch[1]);
        if (LEGACY_DEMO_SERIES_SLUGS.has(slug) || LEGACY_CATEGORY_TITLE_SLUGS.has(slug)) {
            return '';
        }
    }
    if (/neon[\s/_-]*vengeance/i.test(normalized)) return '';
    const path = (normalized.split('?')[0].split('#')[0] || '/').toLowerCase();
    // Hero Manager placeholder `/watch` and `/` reload the SPA homepage — not a campaign.
    if (path === '/' || path === '/watch' || path === '/index.html') return '';
    return resolved;
}

/**
 * @param {{
 *   kind: 'watch' | 'learn';
 *   campaignTarget?: string;
 *   featuredReel?: unknown;
 *   relatedMemberCount?: number;
 * }} input
 * @returns {{ action: 'navigate' | 'theater' | 'episodes' | 'expand' | 'none'; target?: string; reel?: unknown }}
 */
export function resolveHeroCtaIntent(input) {
    const target = sanitizeHeroCtaTarget(input?.campaignTarget);
    const reel = input?.featuredReel || null;
    if (input?.kind === 'learn') {
        if (target) {
            return { action: 'navigate', target, reel };
        }
        const related = Number(input?.relatedMemberCount) || 0;
        if (reel && related >= 2) {
            return { action: 'episodes', reel };
        }
        return { action: 'expand', reel };
    }
    // Watch Now always plays the featured MP4. Leftover `/watch` used to reload the homepage.
    if (reel) return { action: 'theater', reel };
    if (target) return { action: 'navigate', target };
    return { action: 'none' };
}
