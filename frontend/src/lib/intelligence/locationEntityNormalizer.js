/**
 * NLP location entity normalization — semantic metadata only.
 *
 * Creator titles remain untouched by this module (sourceRank 100 title governance
 * lives in contentIdentityGuard / heroTitleIntelligence). This normalizes extracted
 * place entities: LA / L.A. / LosAngeles → "Los Angeles".
 */

/**
 * @typedef {Object} LocationEntity
 * @property {string} canonical - Display / presentation form
 * @property {string[]} aliases - Match keys (lowercase)
 * @property {string[]} discoveryTags - Slugs for discovery indexing
 */

/**
 * @typedef {Object} NormalizedLocation
 * @property {string} canonical
 * @property {string[]} aliases
 * @property {'location-normalizer'} source
 */

/**
 * @typedef {Object} LocationExtraction
 * @property {string} canonical
 * @property {string[]} aliases
 * @property {string} matchedAlias
 * @property {string} input
 * @property {'location-normalizer'} source
 */

/** @type {readonly LocationEntity[]} */
export const LOCATION_ENTITY_MAP = Object.freeze([
    {
        canonical: 'Los Angeles',
        aliases: ['los angeles', 'los-angeles', 'losangeles', 'la', 'l.a.', 'l.a', 'l a', 'lax'],
        discoveryTags: ['los-angeles', 'la']
    },
    {
        canonical: 'New York',
        aliases: ['new york', 'new-york', 'newyork', 'ny', 'n.y.', 'n.y', 'nyc'],
        discoveryTags: ['new-york', 'ny', 'nyc']
    },
    {
        canonical: 'Miami Beach',
        aliases: ['miami beach', 'miami-beach', 'miamibeach'],
        discoveryTags: ['miami-beach', 'miami']
    },
    {
        canonical: 'Miami',
        aliases: ['miami'],
        discoveryTags: ['miami']
    },
    {
        canonical: 'Downtown Atlanta',
        aliases: ['downtown atlanta', 'downtown-atlanta'],
        discoveryTags: ['downtown-atlanta', 'atlanta']
    },
    {
        canonical: 'Atlanta',
        aliases: ['atlanta', 'atl'],
        discoveryTags: ['atlanta', 'atl']
    },
    {
        canonical: 'Chicago',
        aliases: ['chicago', 'chi-town', 'chitown'],
        discoveryTags: ['chicago']
    },
    {
        canonical: 'Houston',
        aliases: ['houston'],
        discoveryTags: ['houston']
    },
    {
        canonical: 'Dallas',
        aliases: ['dallas'],
        discoveryTags: ['dallas']
    },
    {
        canonical: 'Brooklyn',
        aliases: ['brooklyn'],
        discoveryTags: ['brooklyn']
    },
    {
        canonical: 'Harlem',
        aliases: ['harlem'],
        discoveryTags: ['harlem']
    },
    {
        canonical: 'Alabama',
        aliases: ['alabama', 'al'],
        discoveryTags: ['alabama']
    },
    {
        canonical: 'Georgia',
        aliases: ['georgia', 'ga'],
        discoveryTags: ['georgia']
    },
    {
        canonical: 'Florida',
        aliases: ['florida', 'fl'],
        discoveryTags: ['florida']
    },
    {
        canonical: 'California',
        aliases: ['california', 'ca', 'cali'],
        discoveryTags: ['california', 'ca']
    },
    {
        canonical: 'Texas',
        aliases: ['texas', 'tx'],
        discoveryTags: ['texas', 'tx']
    },
    {
        canonical: 'Paris',
        aliases: ['paris'],
        discoveryTags: ['paris']
    },
    {
        canonical: 'London',
        aliases: ['london'],
        discoveryTags: ['london']
    },
    {
        canonical: 'Tokyo',
        aliases: ['tokyo'],
        discoveryTags: ['tokyo']
    },
    {
        canonical: 'Lagos',
        aliases: ['lagos'],
        discoveryTags: ['lagos']
    },
    {
        canonical: 'Accra',
        aliases: ['accra'],
        discoveryTags: ['accra']
    },
    {
        canonical: 'Nairobi',
        aliases: ['nairobi'],
        discoveryTags: ['nairobi']
    },
    {
        canonical: 'Jamaica',
        aliases: ['jamaica'],
        discoveryTags: ['jamaica']
    },
    {
        canonical: 'Havana',
        aliases: ['havana'],
        discoveryTags: ['havana']
    }
]);

/**
 * @param {string} tag
 * @param {Record<string, unknown>} detail
 */
function logLocationNormalization(tag, detail) {
    console.info(
        `[${tag}]`,
        JSON.stringify({
            ...detail,
            source: detail.source || 'location-normalizer',
            timestamp: Date.now()
        })
    );
}

/**
 * Collapse punctuation / case for compact alias compare (LosAngeles → losangeles).
 * @param {string} value
 */
export function compactLocationKey(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

/**
 * Soft lowercase alias key (keeps spaces).
 * @param {string} value
 */
export function softLocationKey(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\./g, '')
        .trim();
}

/**
 * Escape RegExp special characters.
 * @param {string} value
 */
function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether `text` contains alias as a location token (bounded for short codes).
 * Prevents "la" matching inside "Atlanta".
 * @param {string} text
 * @param {string} alias
 */
export function textContainsLocationAlias(text, alias) {
    const raw = String(text || '');
    if (!raw || !alias) return false;

    const a = String(alias).toLowerCase().trim();
    if (!a) return false;

    // Compact compound (LosAngeles vs Los Angeles) — require 4+ alnum chars to avoid "la" in "atlanta"
    const compactText = compactLocationKey(raw);
    const compactAlias = compactLocationKey(a);
    if (compactAlias.length >= 4 && compactText.includes(compactAlias)) {
        return true;
    }

    // Multi-word place names (soft substring after normalization)
    if (a.includes(' ') || a.includes('-')) {
        const soft = softLocationKey(raw);
        const softAlias = softLocationKey(a);
        if (softAlias.length >= 3 && soft.includes(softAlias)) return true;
    }

    // Short codes and dotted codes (la, l.a., ny): require token boundaries
    return buildShortAliasPattern(a).test(raw);
}

/**
 * @param {string} aliasLower
 */
function buildShortAliasPattern(aliasLower) {
    // "l.a." → l\.?a\.? ; "la" → la ; "nyc" → nyc
    const body = aliasLower
        .split('')
        .map((ch) => {
            if (ch === '.') return '\\.?';
            if (ch === ' ') return '[\\s._-]*';
            return escapeRegExp(ch);
        })
        .join('');
    return new RegExp(`(?:^|[^a-z0-9])${body}(?:[^a-z0-9]|$)`, 'i');
}

/**
 * Find map entity from a free-form location string or raw token.
 * @param {string} input
 * @returns {LocationEntity | null}
 */
function findEntityForInput(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;

    const soft = softLocationKey(raw);
    const compact = compactLocationKey(raw);

    /** Prefer longer alias hits */
    /** @type {{ entity: LocationEntity; aliasLen: number } | null} */
    let best = null;

    for (const entity of LOCATION_ENTITY_MAP) {
        for (const alias of entity.aliases) {
            const aSoft = softLocationKey(alias);
            const aCompact = compactLocationKey(alias);
            const exact =
                soft === aSoft ||
                compact === aCompact ||
                soft === softLocationKey(entity.canonical) ||
                compact === compactLocationKey(entity.canonical);
            if (!exact) continue;
            const len = Math.max(aSoft.length, aCompact.length);
            if (!best || len > best.aliasLen) {
                best = { entity, aliasLen: len };
            }
        }
    }
    return best?.entity || null;
}

/**
 * Normalize a location token/phrase to a canonical entity.
 *
 * @param {string} input
 * @param {{ log?: boolean }} [options]
 * @returns {NormalizedLocation | null}
 *
 * @example
 * normalizeLocationEntity("LA")
 * // → { canonical: "Los Angeles", aliases: ["la", "los-angeles"], source: "location-normalizer" }
 */
export function normalizeLocationEntity(input, options = {}) {
    const shouldLog = options.log !== false;
    const raw = String(input || '').trim();
    if (!raw) return null;

    const entity = findEntityForInput(raw);
    if (!entity) {
        if (shouldLog && raw.length >= 2) {
            logLocationNormalization('NLP_LOCATION_NORMALIZATION', {
                input: raw,
                canonical: null,
                aliases: [],
                matched: false,
                source: 'location-normalizer'
            });
        }
        return null;
    }

    const aliases = Array.from(
        new Set([...(entity.discoveryTags || []), ...entity.aliases.map((a) => softLocationKey(a)).filter(Boolean)])
    ).filter((a) => a.length > 0);

    // Prefer discovery slug form first for discovery surfaces
    const discoveryPreferred = [
        ...(entity.discoveryTags || []),
        ...entity.aliases
            .map((a) => softLocationKey(a).replace(/\s+/g, '-'))
            .filter((a) => a && a !== softLocationKey(entity.canonical).replace(/\s+/g, '-'))
    ];
    const aliasOut = Array.from(new Set(discoveryPreferred.length ? discoveryPreferred : aliases));

    const result = {
        canonical: entity.canonical,
        aliases: aliasOut,
        source: /** @type {const} */ ('location-normalizer')
    };

    if (shouldLog) {
        logLocationNormalization('NLP_LOCATION_NORMALIZATION', {
            input: raw,
            canonical: result.canonical,
            aliases: result.aliases,
            matched: true,
            source: 'location-normalizer'
        });
    }

    return result;
}

/**
 * Scan free text (title/description) for the best location entity (longest match wins).
 *
 * @param {string} text
 * @param {{ log?: boolean }} [options]
 * @returns {LocationExtraction | null}
 */
export function extractLocationFromText(text, options = {}) {
    const raw = String(text || '').trim();
    if (!raw) return null;

    /** @type {{ entity: LocationEntity; alias: string; score: number } | null} */
    let best = null;

    for (const entity of LOCATION_ENTITY_MAP) {
        // Longer aliases first within entity
        const aliases = [...entity.aliases].sort((a, b) => b.length - a.length);
        for (const alias of aliases) {
            if (!textContainsLocationAlias(raw, alias)) continue;
            // Score: prefer multi-word / longer aliases; demote 2-letter codes slightly when longer hits exist
            const score = compactLocationKey(alias).length * 10 + (alias.includes(' ') ? 5 : 0);
            if (!best || score > best.score) {
                best = { entity, alias, score };
            }
            break; // best alias for this entity already (sorted)
        }
    }

    if (!best) return null;

    const normalized = normalizeLocationEntity(best.entity.canonical, { log: options.log !== false });
    if (!normalized) return null;

    // Log extract path with the matched surface form as input
    if (options.log !== false && softLocationKey(best.alias) !== softLocationKey(best.entity.canonical)) {
        logLocationNormalization('NLP_LOCATION_NORMALIZATION', {
            input: best.alias,
            canonical: normalized.canonical,
            aliases: normalized.aliases,
            matchedFromTitle: raw.slice(0, 80),
            matched: true,
            source: 'location-normalizer'
        });
    }

    return {
        canonical: normalized.canonical,
        aliases: normalized.aliases,
        matchedAlias: best.alias,
        input: raw,
        source: 'location-normalizer'
    };
}

/**
 * Build discovery tag list that always includes location slugs + short aliases.
 * @param {string | null | undefined} locationCanonical
 * @param {string[]} [aliases]
 * @returns {string[]}
 */
export function locationDiscoveryTags(locationCanonical, aliases = []) {
    if (!locationCanonical && !aliases.length) return [];
    const entity = findEntityForInput(locationCanonical || aliases[0] || '');
    if (entity) {
        return Array.from(new Set([...(entity.discoveryTags || []), ...aliases.map((a) => softLocationKey(a))]));
    }
    const slug = softLocationKey(locationCanonical).replace(/\s+/g, '-');
    return Array.from(new Set([slug, ...aliases.map((a) => softLocationKey(a))].filter(Boolean)));
}
