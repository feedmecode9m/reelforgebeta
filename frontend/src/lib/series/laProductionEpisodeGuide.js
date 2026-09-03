/**
 * Vic G / Los Angeles Production — viewer editorial overlay for All Episodes.
 *
 * Source: LA_Episode_Guide.pdf (titles + descriptions for platform presentation).
 * Presentation only — does not mutate vault storage, catalog authority, or playback.
 * Family heading is Vic G. Motherland / STIRRED are a different project.
 */

import { VIC_G_SERIES_TITLE } from './vicGSeriesPackage.js';

/**
 * @typedef {Object} LaGuideEpisode
 * @property {number} episodeNumber
 * @property {string} title
 * @property {string} description
 */

/**
 * @typedef {Object} LaGuideSeriesPresentation
 * @property {boolean} active
 * @property {string} seriesTitle
 * @property {string} synopsis
 * @property {string[]} badges
 * @property {number} guideEpisodeCount
 */

export const LA_PRODUCTION_SERIES_TITLE = VIC_G_SERIES_TITLE;

export const LA_PRODUCTION_SYNOPSIS =
    'Vic-G and the team arrive in Los Angeles for the music video — from first days in the city through the club, the soundstage, and the community around the project.';

/** @type {LaGuideEpisode[]} */
export const LA_PRODUCTION_EPISODES = [
    {
        episodeNumber: 1,
        title: 'The Project',
        description:
            'Who are the main players behind the sound and production of Dat Boi and Zakanda? This episode introduces Zarian, Vic-G, and the team as the project in Los Angeles begins to take shape.'
    },
    {
        episodeNumber: 2,
        title: 'Arrival in LA',
        description:
            'Vic-G and the team arrive in Los Angeles, setting the stage for production and introducing the city, momentum, and early movement around the project.'
    },
    {
        episodeNumber: 3,
        title: 'Club Poom Poom',
        description:
            'The first official shoot day begins at Poom Poom Tuesday in Los Angeles, where the nightlife scenes establish the energy and visual tone for what comes next.'
    },
    {
        episodeNumber: 4,
        title: 'Set Shooting Pt 1',
        description:
            "Production moves to the soundstage as the studio shoot gets underway and the team's performance, camera, and lighting work start coming together."
    },
    {
        episodeNumber: 5,
        title: 'Set Shooting Pt 2',
        description:
            'The soundstage session continues with additional performance and production sequences as the final major scenes are completed.'
    },
    {
        episodeNumber: 6,
        title: 'Condo Wind Down',
        description:
            'After the shoot days, the team winds down at the condo with candid off-set moments and reflections from the production run.'
    }
];

const GUIDE_BY_NUMBER = new Map(LA_PRODUCTION_EPISODES.map((ep) => [ep.episodeNumber, ep]));

/**
 * Distinctive production tokens — "arrival" alone is not enough (other series use it).
 * @type {Array<{ id: string, re: RegExp }>}
 */
const FAMILY_TOKENS = [
    { id: 'losangeles', re: /los\s*angeles|la[\s_-]*production/i },
    { id: 'poom', re: /poom\s*poom/i },
    { id: 'vicg', re: /\bvic[\s_-]?g\b/i },
    { id: 'setshoot', re: /set[\s_-]*shooting/i },
    { id: 'soundstage', re: /soundstage\s+shoot/i },
    { id: 'condo', re: /condo\s+wind/i },
    { id: 'society', re: /my\s*society/i }
];

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

/**
 * @param {unknown} item
 * @returns {string}
 */
export function episodeGuideSearchText(item) {
    if (item == null) return '';
    if (typeof item === 'string') return text(item);
    if (typeof item !== 'object') return '';
    const rec = /** @type {Record<string, unknown>} */ (item);
    const url = text(rec.mediaUrl || rec.url || rec.fileName || rec.file_name || '');
    const base = url.split(/[\\/]/).pop() || '';
    return [
        rec.title,
        rec.name,
        rec.fileName,
        rec.file_name,
        rec.seriesLabel,
        rec.episodeTitle,
        base
    ]
        .map(text)
        .filter(Boolean)
        .join(' ');
}

/**
 * @param {unknown[]} items
 * @returns {string}
 */
function haystackFrom(items) {
    return (Array.isArray(items) ? items : []).map(episodeGuideSearchText).filter(Boolean).join(' \n ');
}

/**
 * @param {string} blob
 * @returns {Set<string>}
 */
function familyTokenIds(blob) {
    const ids = new Set();
    for (const token of FAMILY_TOKENS) {
        if (token.re.test(blob)) ids.add(token.id);
    }
    return ids;
}

/**
 * Distinctive production filenames — enough to overlay a single vault MP4
 * without waiting for a 2+ sibling family. Bare "Arrival" is not distinctive.
 * @param {string} blob
 * @returns {boolean}
 */
export function isDistinctiveLaProductionAsset(blob) {
    const raw = text(blob);
    if (!raw) return false;
    return (
        /poom\s*poom/i.test(raw) ||
        /set[\s_-]*shooting/i.test(raw) ||
        /soundstage\s+shoot/i.test(raw) ||
        /condo/i.test(raw) ||
        /my\s*society/i.test(raw) ||
        /\bvic[\s_-]?g\b/i.test(raw) ||
        /los\s*angeles|la[\s_-]*production/i.test(raw)
    );
}
export function matchLaProductionEpisodeNumber(blob) {
    const raw = text(blob);
    if (!raw) return null;
    if (/project|intro/i.test(raw)) return 1;
    if (/arrival/i.test(raw)) return 2;
    if (/poom\s*poom/i.test(raw)) return 3;
    if (
        /soundstage.*(?:part|pt)[\s._:-]*(?:two|2)(?!\d)/i.test(raw) ||
        /set[\s_-]*shooting.*(?:part|pt)[\s._:-]*2(?!\d)/i.test(raw)
    ) {
        return 5;
    }
    if (
        /soundstage.*(?:part|pt)[\s._:-]*(?:one|1)(?!\d)/i.test(raw) ||
        /set[\s_-]*shooting.*(?:part|pt)[\s._:-]*1(?!\d)/i.test(raw)
    ) {
        return 4;
    }
    if (/condo/i.test(raw)) return 6;
    if (/my\s*society|\bamp\b/i.test(raw)) return null;
    if (/\barrival\b/i.test(raw)) return 2;
    return null;
}

/**
 * True when this All Episodes family is the Los Angeles Production set.
 * Requires distinctive tokens, not a lone "Arrival" title from another series.
 *
 * @param {unknown[] | string} itemsOrHaystack
 * @returns {boolean}
 */
export function isLosAngelesProductionFamily(itemsOrHaystack) {
    const blob =
        typeof itemsOrHaystack === 'string' ? itemsOrHaystack : haystackFrom(itemsOrHaystack);
    const tokens = familyTokenIds(blob);
    if (tokens.size >= 2) return true;
    if (tokens.size === 0) return false;
    const parts = blob.split(/\n/).map(text).filter(Boolean);
    const matched = parts.filter((line) => matchLaProductionEpisodeNumber(line) != null).length;
    return matched >= 2;
}

/**
 * @param {number} episodeNumber
 * @returns {LaGuideEpisode | null}
 */
export function getLaProductionEpisodeByNumber(episodeNumber) {
    const n = Number(episodeNumber);
    if (!Number.isFinite(n) || n < 1) return null;
    return GUIDE_BY_NUMBER.get(n) || null;
}

/**
 * Exact viewer title match (e.g. "Arrival") — not filename stems like 01 ARRIVAL OPEN.
 * @param {unknown} value
 * @returns {LaGuideEpisode | null}
 */
export function matchLaProductionEpisodeByViewerTitle(value) {
    const n = text(value).toLowerCase();
    if (!n) return null;
    return LA_PRODUCTION_EPISODES.find((ep) => ep.title.toLowerCase() === n) || null;
}

/**
 * Vault / filename titles that should yield to the editorial guide in All Episodes.
 * Creator Master Edit titles (plain language) stay.
 *
 * @param {string} currentTitle
 * @returns {boolean}
 */
export function shouldPreferLaGuideTitle(currentTitle) {
    const t = text(currentTitle);
    if (!t) return true;
    if (/^\d{1,2}[\s._-]/i.test(t)) return true;
    if (/_V\d+/i.test(t)) return true;
    if (/set[\s_-]*shooting/i.test(t)) return true;
    if (/\.(mp4|mov|m4v)$/i.test(t)) return true;
    if (/copy\s+[0-9a-f-]{8}/i.test(t)) return true;
    if (/^(vic[\s_-]?g|motherland)$/i.test(t)) return true;
    return false;
}

/**
 * @param {{
 *   familyItems?: unknown[];
 *   seriesTitle?: string;
 *   episode?: unknown;
 *   episodeNumber?: number;
 *   title?: string;
 *   fileName?: string;
 *   currentTitle?: string;
 *   currentDescription?: string;
 * }} input
 */
export function presentLaProductionEpisode(input) {
    const search = [
        episodeGuideSearchText(input?.episode),
        input?.title,
        input?.fileName,
        input?.currentTitle
    ]
        .map(text)
        .filter(Boolean)
        .join(' ');
    const familyItems = [
        ...(Array.isArray(input?.familyItems) ? input.familyItems : []),
        input?.seriesTitle,
        input?.episode
    ];
    const family = isLosAngelesProductionFamily(familyItems);
    const distinctive = isDistinctiveLaProductionAsset(search);
    const exact =
        matchLaProductionEpisodeByViewerTitle(input?.currentTitle) ||
        matchLaProductionEpisodeByViewerTitle(input?.title);
    if (!family && !distinctive && !exact) {
        return { active: false, title: '', description: '', episodeNumber: null };
    }
    const fromPattern = matchLaProductionEpisodeNumber(search);
    const fromNumber = Number(input?.episodeNumber);
    const numberedFallback =
        !fromPattern &&
        !exact &&
        shouldPreferLaGuideTitle(search || text(input?.currentTitle)) &&
        Number.isFinite(fromNumber) &&
        fromNumber >= 1 &&
        fromNumber <= 6
            ? fromNumber
            : null;
    const n = fromPattern || exact?.episodeNumber || numberedFallback;
    const guide = n ? getLaProductionEpisodeByNumber(n) : exact;
    if (!guide) {
        return { active: true, title: '', description: '', episodeNumber: n };
    }
    const currentTitle = text(input?.currentTitle);
    const currentDescription = text(input?.currentDescription);
    const fileHint = text(input?.fileName) || text(input?.title);
    const preferGuide =
        !currentTitle ||
        shouldPreferLaGuideTitle(currentTitle) ||
        (fromPattern &&
            shouldPreferLaGuideTitle(fileHint) &&
            matchLaProductionEpisodeNumber(currentTitle) == null &&
            currentTitle.split(/\s+/).length <= 2);
    return {
        active: true,
        episodeNumber: guide.episodeNumber,
        title: preferGuide ? guide.title : currentTitle,
        description: currentDescription || guide.description
    };
}

/**
 * Series chrome for All Episodes when the family matches.
 *
 * @param {{ familyItems?: unknown[]; seriesTitle?: string; episodeCount?: number }} input
 * @returns {LaGuideSeriesPresentation}
 */
export function presentLaProductionSeries(input) {
    const items = [...(Array.isArray(input?.familyItems) ? input.familyItems : []), input?.seriesTitle];
    const active = isLosAngelesProductionFamily(items);
    if (!active) {
        return {
            active: false,
            seriesTitle: text(input?.seriesTitle),
            synopsis: '',
            badges: [],
            guideEpisodeCount: LA_PRODUCTION_EPISODES.length
        };
    }
    const count = Number(input?.episodeCount);
    const countLabel =
        Number.isFinite(count) && count > 0
            ? `${count} episode${count === 1 ? '' : 's'}`
            : `${LA_PRODUCTION_EPISODES.length} episodes`;
    return {
        active: true,
        seriesTitle: LA_PRODUCTION_SERIES_TITLE,
        synopsis: LA_PRODUCTION_SYNOPSIS,
        badges: ['Los Angeles', 'Behind the scenes', countLabel],
        guideEpisodeCount: LA_PRODUCTION_EPISODES.length
    };
}

/**
 * All Episodes header under the poster: title, count, then description.
 * Single matched vault MP4 uses that episode's guide title + blurb.
 *
 * @param {{
 *   familyItems?: unknown[];
 *   seriesTitle?: string;
 *   episodeCount?: number;
 *   selectedEpisode?: unknown;
 *   selectedTitle?: string;
 *   selectedFileName?: string;
 *   episodeNumber?: number | string;
 * }} input
 */
export function presentLaProductionHeader(input) {
    const count = Number(input?.episodeCount);
    const countLine =
        Number.isFinite(count) && count > 0
            ? `${count} episode${count === 1 ? '' : 's'}`
            : '';
    const selected = presentLaProductionEpisode({
        familyItems: input?.familyItems,
        seriesTitle: input?.seriesTitle,
        episode: input?.selectedEpisode,
        title: input?.selectedTitle,
        fileName: input?.selectedFileName,
        currentTitle: input?.selectedTitle,
        episodeNumber: input?.episodeNumber
    });
    const fromShelfTitle = presentLaProductionEpisode({
        familyItems: input?.familyItems,
        seriesTitle: input?.seriesTitle,
        title: input?.seriesTitle,
        currentTitle: input?.seriesTitle
    });
    const episode =
        selected.active && selected.description
            ? selected
            : fromShelfTitle.active && fromShelfTitle.description
              ? fromShelfTitle
              : selected.active
                ? selected
                : fromShelfTitle;
    const series = presentLaProductionSeries({
        familyItems: input?.familyItems,
        seriesTitle: input?.seriesTitle,
        episodeCount: count
    });
    if (!episode.active && !series.active) {
        return {
            active: false,
            headingTitle: text(input?.seriesTitle),
            countLine,
            description: ''
        };
    }
    return {
        active: true,
        headingTitle: episode.title || text(input?.seriesTitle),
        countLine,
        description: episode.description || ''
    };
}
