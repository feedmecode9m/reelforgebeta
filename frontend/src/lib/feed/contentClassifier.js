/**
 * Discovery/shelf content classifier — pure, Node-safe.
 *
 * Labels are presentation shelves (Trending / Romance / Cyber-Action / Suspense).
 * They are NOT series genre truth and must not write Series/catalog authority.
 *
 * NLP extension point: swap/enhance classifyContent() while keeping the same return shape.
 */

/** @type {Readonly<Record<string, readonly string[]>>} */
export const DISCOVERY_SHELF_KEYWORDS = Object.freeze({
    'Cyber-Action': Object.freeze([
        'cyber',
        'hack',
        'action',
        'fight',
        'chase',
        'shoot',
        'explosion',
        'thriller',
        'adventure',
        'secret',
        'agent',
        'mission',
        'combat',
        'gun',
        'weapon',
        'war',
        'battle',
        'revenge',
        'justice',
        'crime',
        'detective',
        'investigation',
        'spy',
        'espionage',
        'danger'
    ]),
    Romance: Object.freeze([
        'love',
        'romance',
        'heart',
        'kiss',
        'relationship',
        'dating',
        'couple',
        'marriage',
        'wedding',
        'passion',
        'desire',
        'affair',
        'sweet',
        'tender',
        'emotional',
        'feelings',
        'together',
        'forever',
        'soulmate',
        'destiny',
        'chemistry',
        'attraction',
        'connection'
    ]),
    Suspense: Object.freeze([
        'suspense',
        'mystery',
        'thriller',
        'horror',
        'fear',
        'scary',
        'dark',
        'secret',
        'hidden',
        'danger',
        'unknown',
        'haunted',
        'ghost',
        'paranormal',
        'psychological',
        'twist',
        'cliffhanger',
        'tension',
        'anxiety',
        'dread',
        'ominous',
        'sinister',
        'creepy'
    ]),
    Trending: Object.freeze([
        'viral',
        'trending',
        'popular',
        'hot',
        'latest',
        'new',
        'must watch',
        'breaking',
        'exclusive',
        'premiere',
        'special',
        'barbershop',
        'barber',
        'haircut',
        'micro',
        'stirred'
    ])
});

export const DISCOVERY_SHELVES = Object.freeze([
    'Trending',
    'Romance',
    'Cyber-Action',
    'Suspense'
]);

/** Explicit Studio shelf picks — do not soft-reclassify away. */
export const EXPLICIT_SHELF_CATEGORIES = Object.freeze(
    new Set(['Romance', 'Cyber-Action', 'Suspense'])
);

/** Soft defaults that may be reclassified from text signals. */
export const SOFT_DEFAULT_CATEGORIES = Object.freeze(
    new Set(['Trending', 'HERO', 'Network', 'Auto-Detect', ''])
);

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map((v) => text(v)).filter(Boolean);
    if (typeof value === 'string') {
        return value
            .split(/[,|]/)
            .map((v) => v.trim())
            .filter(Boolean);
    }
    return [];
}

/**
 * Normalize aliases into FEED_SHELVES labels.
 * @param {string} category
 * @returns {string}
 */
export function normalizeDiscoveryShelf(category) {
    const cat = text(category);
    if (cat === 'Network') return 'Trending';
    if (cat === 'Love' || cat === 'Drama') return 'Romance';
    if (cat === 'Action') return 'Cyber-Action';
    if (cat === 'HERO' || cat === 'Auto-Detect') return 'Trending';
    if (DISCOVERY_SHELVES.includes(cat)) return cat;
    return 'Trending';
}

/**
 * Title-only keyword detect (upload Auto-Detect compatible).
 * @param {string} title
 * @returns {string}
 */
export function detectShelfFromTitle(title) {
    if (!title) return 'Trending';
    const titleLower = String(title).toLowerCase();
    if (
        titleLower.includes('barbershop') ||
        titleLower.includes('barber') ||
        titleLower.includes('haircut')
    ) {
        return 'Trending';
    }
    if (
        titleLower.includes('viral') ||
        titleLower.includes('trending') ||
        titleLower.includes('popular') ||
        titleLower.includes('hot') ||
        titleLower.includes('latest') ||
        titleLower.includes('breaking')
    ) {
        return 'Trending';
    }

    /** @type {Record<string, number>} */
    const scores = {};
    for (const category of Object.keys(DISCOVERY_SHELF_KEYWORDS)) {
        scores[category] = DISCOVERY_SHELF_KEYWORDS[category].filter((kw) =>
            titleLower.includes(kw.toLowerCase())
        ).length;
    }
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [topCat, topScore] = ranked[0] || ['Trending', 0];
    if (topScore > 1) return topCat;
    return assistShelfFromTitle(titleLower);
}

/**
 * @param {string} titleLower
 * @returns {string}
 */
function assistShelfFromTitle(titleLower) {
    if (titleLower.length < 20) return 'Trending';
    const words = titleLower.split(/\s+/);
    if (words.length > 8) return 'Suspense';
    const emotionalWords = ['heart', 'soul', 'tears', 'pain', 'joy', 'fear'];
    if (emotionalWords.some((w) => titleLower.includes(w))) return 'Romance';
    const actionWords = ['run', 'fight', 'chase', 'escape', 'survive'];
    if (actionWords.some((w) => titleLower.includes(w))) return 'Cyber-Action';
    return 'Trending';
}

/**
 * @param {string} haystack
 * @returns {{ category: string; score: number; signals: string[] }}
 */
function scoreHaystack(haystack) {
    const lower = haystack.toLowerCase();
    /** @type {Record<string, { score: number; signals: string[] }>} */
    const byCat = {};
    for (const [category, keywords] of Object.entries(DISCOVERY_SHELF_KEYWORDS)) {
        const hits = keywords.filter((kw) => lower.includes(kw.toLowerCase()));
        byCat[category] = { score: hits.length, signals: hits };
    }
    const ranked = Object.entries(byCat).sort((a, b) => b[1].score - a[1].score);
    const [category, row] = ranked[0] || ['Trending', { score: 0, signals: [] }];
    return { category, score: row.score, signals: row.signals };
}

/**
 * @typedef {Object} ContentClassification
 * @property {string} primaryCategory
 * @property {string[]} categories
 * @property {number} confidence 0..1
 * @property {string[]} signals
 * @property {'metadata' | 'existing-category' | 'keyword' | 'fallback'} classificationSource
 */

/**
 * Classify content for discovery shelves only.
 *
 * @param {Record<string, unknown> | null | undefined} content
 * @returns {ContentClassification}
 */
export function classifyContent(content) {
    const row = content && typeof content === 'object' ? content : {};
    const rawCategory = text(row.category || row.shelfCategory || '');
    const normalizedExisting = normalizeDiscoveryShelf(rawCategory);
    const isExplicit =
        EXPLICIT_SHELF_CATEGORIES.has(rawCategory) ||
        (EXPLICIT_SHELF_CATEGORIES.has(normalizedExisting) &&
            !SOFT_DEFAULT_CATEGORIES.has(rawCategory));

    if (isExplicit) {
        return {
            primaryCategory: normalizedExisting,
            categories: [normalizedExisting],
            confidence: 1,
            signals: [`existing:${rawCategory || normalizedExisting}`],
            classificationSource: 'metadata'
        };
    }

    const title = text(row.title || row.name || row.heroTitle || row.displayTitle || '');
    const description = text(row.description || row.heroDescription || '');
    const fileName = text(row.fileName || row.file_name || '');
    const seriesTitle = text(row.seriesName || row.seriesTitle || '');
    const episodeTitle = text(row.episodeTitle || '');
    const tags = [
        ...asStringList(row.tags),
        ...asStringList(row.ai_tags),
        ...asStringList(row.keywords),
        ...asStringList(row.discoveryTags)
    ];
    const haystack = [title, description, fileName, seriesTitle, episodeTitle, ...tags]
        .filter(Boolean)
        .join(' ');

    if (!haystack) {
        return {
            primaryCategory: 'Trending',
            categories: ['Trending'],
            confidence: 0.15,
            signals: [],
            classificationSource: 'fallback'
        };
    }

    const scored = scoreHaystack(haystack);
    if (scored.score > 1) {
        const confidence = Math.min(0.95, 0.45 + scored.score * 0.12);
        /** @type {string[]} */
        const categories = [scored.category];
        if (scored.category !== 'Trending') categories.push('Trending');
        return {
            primaryCategory: scored.category,
            categories,
            confidence,
            signals: scored.signals,
            classificationSource: 'keyword'
        };
    }

    const assisted = detectShelfFromTitle(title || haystack.slice(0, 80));
    if (assisted !== 'Trending') {
        return {
            primaryCategory: assisted,
            categories: [assisted, 'Trending'],
            confidence: 0.4,
            signals: [`assist:${assisted}`],
            classificationSource: 'keyword'
        };
    }

    if (normalizedExisting && !SOFT_DEFAULT_CATEGORIES.has(rawCategory)) {
        return {
            primaryCategory: normalizedExisting,
            categories: [normalizedExisting],
            confidence: 0.55,
            signals: [`existing:${rawCategory}`],
            classificationSource: 'existing-category'
        };
    }

    return {
        primaryCategory: 'Trending',
        categories: ['Trending'],
        confidence: 0.25,
        signals: scored.signals.slice(0, 3),
        classificationSource: 'fallback'
    };
}
