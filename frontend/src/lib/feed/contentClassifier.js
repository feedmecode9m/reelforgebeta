/**
 * Discovery/shelf content classifier — pure, Node-safe.
 *
 * Labels are presentation shelves (Trending / Romance / Cyber-Action / Suspense).
 * They are NOT series genre truth and must not write Series/catalog authority.
 *
 * Evidence precedence (deterministic):
 *   explicit category
 *   > durable existing metadata
 *   > strong title/description/tag signals
 *   > series/episode signals
 *   > filename signals (strong tokens only; never UUID/camera dumps)
 *   > Trending fallback
 *
 * NLP extension point: classifyContentSemantic() accepts an optional provider that
 * must return the same ContentClassification contract.
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

/**
 * Strong tokens — sufficient (alone or with another weak) to classify a shelf.
 * Weak tokens never classify a shelf by themselves.
 * @type {Readonly<Record<string, ReadonlySet<string>>>}
 */
export const STRONG_SHELF_KEYWORDS = Object.freeze({
    'Cyber-Action': Object.freeze(
        new Set([
            'cyber',
            'hack',
            'hacker',
            'combat',
            'espionage',
            'spy',
            'shootout',
            'explosion',
            'assassin',
            'mercenary',
            'battlefield',
            'gunfight',
            'martial'
        ])
    ),
    Romance: Object.freeze(
        new Set([
            'romance',
            'romantic',
            'love',
            'kiss',
            'soulmate',
            'wedding',
            'marriage',
            'dating',
            'couple',
            'affair',
            'passion',
            'sweetheart',
            'valentine'
        ])
    ),
    Suspense: Object.freeze(
        new Set([
            'suspense',
            'mystery',
            'horror',
            'haunted',
            'paranormal',
            'psychological',
            'cliffhanger',
            'thriller',
            'sinister',
            'ominous',
            'creepy',
            'whodunit'
        ])
    ),
    Trending: Object.freeze(
        new Set(['viral', 'trending', 'barbershop', 'barber', 'premiere', 'breaking'])
    )
});

/** Weak / ambiguous tokens — require a strong partner in the same shelf family. */
export const WEAK_SHELF_KEYWORDS = Object.freeze(
    new Set([
        'action',
        'fight',
        'chase',
        'shoot',
        'adventure',
        'secret',
        'agent',
        'mission',
        'gun',
        'weapon',
        'war',
        'battle',
        'revenge',
        'justice',
        'crime',
        'detective',
        'investigation',
        'danger',
        'heart',
        'relationship',
        'desire',
        'sweet',
        'tender',
        'emotional',
        'feelings',
        'together',
        'forever',
        'destiny',
        'chemistry',
        'attraction',
        'connection',
        'fear',
        'scary',
        'dark',
        'hidden',
        'unknown',
        'ghost',
        'twist',
        'tension',
        'anxiety',
        'dread',
        'hot',
        'latest',
        'new',
        'popular',
        'special',
        'exclusive',
        'micro',
        'stirred',
        'must watch'
    ])
);

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
 * @typedef {Object} ContentClassification
 * @property {string} primaryCategory
 * @property {string[]} categories
 * @property {number} confidence 0..1
 * @property {string[]} signals
 * @property {'metadata' | 'existing-category' | 'keyword' | 'fallback' | 'filename' | 'series' | 'nlp'} classificationSource
 */

/**
 * @typedef {Object} NormalizedClassificationMetadata
 * @property {string} title
 * @property {string} description
 * @property {string} fileName
 * @property {string} fileNameStem
 * @property {string} rawCategory
 * @property {string} normalizedCategory
 * @property {string} seriesTitle
 * @property {string} episodeTitle
 * @property {string[]} tags
 * @property {string} mediaKind
 * @property {boolean} fileNameIsGeneric
 * @property {boolean} titleIsGeneric
 */

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
 * @param {string} name
 * @returns {boolean}
 */
export function isGenericMediaLabel(name) {
    const raw = text(name);
    if (!raw) return true;
    const base = raw.split(/[/\\]/).pop() || raw;
    const stem = base.replace(/\.[a-z0-9]{2,5}$/i, '');
    // UUID-like asset / dump names
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stem)) {
        return true;
    }
    if (/^[0-9a-f]{32}$/i.test(stem)) return true;
    // Camera / export dumps
    if (/^(img|dsc|dcim|screenshot|screen\s*shot|photo|image|video|clip|untitled)[_-\s]?\d*/i.test(stem)) {
        return true;
    }
    if (/^img_\d+/i.test(stem)) return true;
    // Bare extension-looking or mostly numeric
    if (/^\d{6,}([_-]\d+)?$/i.test(stem)) return true;
    // UUID-looking mixed into display names like "94E28916-619A-...PNG"
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(stem)) return true;
    return false;
}

/**
 * Pure metadata normalization for classification (does not touch identity).
 * @param {Record<string, unknown> | null | undefined} content
 * @returns {NormalizedClassificationMetadata}
 */
export function normalizeClassificationMetadata(content) {
    const row = content && typeof content === 'object' ? content : {};
    const title = text(row.title || row.name || row.heroTitle || row.displayTitle || '');
    const description = text(row.description || row.heroDescription || '');
    const fileName = text(row.fileName || row.file_name || '');
    const fileNameStem = (fileName.split(/[/\\]/).pop() || fileName).replace(/\.[a-z0-9]{2,5}$/i, '');
    const rawCategory = text(row.category || row.shelfCategory || '');
    const seriesTitle = text(row.seriesName || row.seriesTitle || '');
    const episodeTitle = text(row.episodeTitle || '');
    const tags = [
        ...asStringList(row.tags),
        ...asStringList(row.ai_tags),
        ...asStringList(row.keywords),
        ...asStringList(row.discoveryTags)
    ];
    const mediaKind = text(row.mediaKind || row.type || row.primaryMediaType).toLowerCase() || 'unknown';

    return {
        title,
        description,
        fileName,
        fileNameStem,
        rawCategory,
        normalizedCategory: normalizeDiscoveryShelf(rawCategory),
        seriesTitle,
        episodeTitle,
        tags,
        mediaKind,
        fileNameIsGeneric: isGenericMediaLabel(fileName || fileNameStem),
        titleIsGeneric: isGenericMediaLabel(title)
    };
}

/**
 * Tokenize for keyword matching — lowercase alphanumerics + keep multiword phrases via includes.
 * @param {string} value
 * @returns {string}
 */
function hay(value) {
    return text(value).toLowerCase();
}

/**
 * @param {string} fieldHaystack
 * @param {string} fieldLabel
 * @returns {{ scores: Record<string, number>; strong: Record<string, string[]>; weak: Record<string, string[]>; signals: string[] }}
 */
function scoreField(fieldHaystack, fieldLabel) {
    /** @type {Record<string, number>} */
    const scores = { Trending: 0, Romance: 0, 'Cyber-Action': 0, Suspense: 0 };
    /** @type {Record<string, string[]>} */
    const strong = { Trending: [], Romance: [], 'Cyber-Action': [], Suspense: [] };
    /** @type {Record<string, string[]>} */
    const weak = { Trending: [], Romance: [], 'Cyber-Action': [], Suspense: [] };
    /** @type {string[]} */
    const signals = [];
    if (!fieldHaystack) return { scores, strong, weak, signals };

    for (const shelf of /** @type {string[]} */ (['Romance', 'Cyber-Action', 'Suspense', 'Trending'])) {
        for (const kw of STRONG_SHELF_KEYWORDS[shelf] || []) {
            if (fieldHaystack.includes(kw)) {
                scores[shelf] += 3;
                strong[shelf].push(kw);
                signals.push(`${fieldLabel}:strong:${kw}`);
            }
        }
        for (const kw of DISCOVERY_SHELF_KEYWORDS[shelf] || []) {
            const k = String(kw).toLowerCase();
            if (STRONG_SHELF_KEYWORDS[shelf]?.has(k)) continue;
            if (!WEAK_SHELF_KEYWORDS.has(k)) continue;
            if (fieldHaystack.includes(k)) {
                scores[shelf] += 1;
                weak[shelf].push(k);
                signals.push(`${fieldLabel}:weak:${k}`);
            }
        }
    }
    return { scores, strong, weak, signals };
}

/**
 * @param {Record<string, number>} scores
 * @param {Record<string, string[]>} strong
 * @param {Record<string, string[]>} weak
 * @returns {{ category: string; eligible: boolean; strongCount: number; weakCount: number }}
 */
function pickEligibleShelf(scores, strong, weak) {
    /** @type {Array<{ category: string; score: number; strongCount: number; weakCount: number }>} */
    const ranked = ['Romance', 'Cyber-Action', 'Suspense', 'Trending']
        .map((category) => ({
            category,
            score: scores[category] || 0,
            strongCount: (strong[category] || []).length,
            weakCount: (weak[category] || []).length
        }))
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (b.strongCount !== a.strongCount) return b.strongCount - a.strongCount;
            // Deterministic tie-break by canonical shelf order
            return DISCOVERY_SHELVES.indexOf(a.category) - DISCOVERY_SHELVES.indexOf(b.category);
        });

    const top = ranked[0] || { category: 'Trending', score: 0, strongCount: 0, weakCount: 0 };
    // Never classify from weak generic words alone — genre shelves need ≥1 strong token.
    const eligible = top.strongCount >= 1;
    return {
        category: eligible ? top.category : 'Trending',
        eligible,
        strongCount: top.strongCount,
        weakCount: top.weakCount
    };
}

/**
 * Combine field scores with evidence weights.
 * @param {NormalizedClassificationMetadata} meta
 */
function scoreEvidenceLayers(meta) {
    /** @type {Record<string, number>} */
    const scores = { Trending: 0, Romance: 0, 'Cyber-Action': 0, Suspense: 0 };
    /** @type {Record<string, string[]>} */
    const strong = { Trending: [], Romance: [], 'Cyber-Action': [], Suspense: [] };
    /** @type {Record<string, string[]>} */
    const weak = { Trending: [], Romance: [], 'Cyber-Action': [], Suspense: [] };
    /** @type {string[]} */
    const signals = [];

    /** @type {Array<{ label: string; text: string; weight: number; skipIfGeneric?: boolean; generic?: boolean }>} */
    const layers = [
        {
            label: 'title',
            text: meta.titleIsGeneric ? '' : meta.title,
            weight: 1.0,
            skipIfGeneric: true,
            generic: meta.titleIsGeneric
        },
        { label: 'description', text: meta.description, weight: 1.0 },
        { label: 'tags', text: meta.tags.join(' '), weight: 1.1 },
        { label: 'series', text: meta.seriesTitle, weight: 0.85 },
        { label: 'episode', text: meta.episodeTitle, weight: 0.85 },
        {
            label: 'filename',
            text: meta.fileNameIsGeneric ? '' : `${meta.fileNameStem} ${meta.fileName}`,
            weight: 0.55,
            skipIfGeneric: true,
            generic: meta.fileNameIsGeneric
        }
    ];

    /** @type {'keyword' | 'filename' | 'series' | null} */
    let bestSource = null;

    for (const layer of layers) {
        if (layer.skipIfGeneric && layer.generic) continue;
        const field = scoreField(hay(layer.text), layer.label);
        for (const shelf of Object.keys(scores)) {
            scores[shelf] += field.scores[shelf] * layer.weight;
            strong[shelf].push(...field.strong[shelf]);
            weak[shelf].push(...field.weak[shelf]);
        }
        if (field.signals.length) {
            signals.push(...field.signals);
            if (layer.label === 'filename' && !bestSource) bestSource = 'filename';
            else if ((layer.label === 'series' || layer.label === 'episode') && !bestSource) {
                bestSource = 'series';
            } else if (
                (layer.label === 'title' || layer.label === 'description' || layer.label === 'tags') &&
                !bestSource
            ) {
                bestSource = 'keyword';
            }
        }
    }

    // Deduplicate signal lists / strong-weak token lists
    for (const shelf of Object.keys(strong)) {
        strong[shelf] = [...new Set(strong[shelf])];
        weak[shelf] = [...new Set(weak[shelf])];
    }

    return { scores, strong, weak, signals: [...new Set(signals)], bestSource };
}

/**
 * Title-only keyword detect (upload Auto-Detect compatible) — strong evidence only.
 * @param {string} title
 * @returns {string}
 */
export function detectShelfFromTitle(title) {
    if (!title) return 'Trending';
    if (isGenericMediaLabel(title)) return 'Trending';
    const meta = normalizeClassificationMetadata({ title, category: 'Trending' });
    const scored = scoreEvidenceLayers(meta);
    const pick = pickEligibleShelf(scored.scores, scored.strong, scored.weak);
    if (!pick.eligible || pick.category === 'Trending') {
        // Preserve barbershop / viral trending strong titles
        const lower = title.toLowerCase();
        if (
            lower.includes('barbershop') ||
            lower.includes('barber') ||
            lower.includes('viral') ||
            lower.includes('trending')
        ) {
            return 'Trending';
        }
        return 'Trending';
    }
    return pick.category;
}

/**
 * @param {string} primary
 * @param {number} confidence
 * @param {string[]} signals
 * @param {ContentClassification['classificationSource']} source
 * @returns {ContentClassification}
 */
function result(primary, confidence, signals, source) {
    /** @type {string[]} */
    const categories = [primary];
    if (primary !== 'Trending') categories.push('Trending');
    return {
        primaryCategory: primary,
        categories,
        confidence,
        signals,
        classificationSource: source
    };
}

/**
 * Classify content for discovery shelves only (deterministic, no NLP dependency).
 *
 * @param {Record<string, unknown> | null | undefined} content
 * @returns {ContentClassification}
 */
export function classifyContent(content) {
    const meta = normalizeClassificationMetadata(content);
    const rawCategory = meta.rawCategory;
    const normalizedExisting = meta.normalizedCategory;

    const isExplicit =
        EXPLICIT_SHELF_CATEGORIES.has(rawCategory) ||
        (EXPLICIT_SHELF_CATEGORIES.has(normalizedExisting) &&
            !SOFT_DEFAULT_CATEGORIES.has(rawCategory));

    if (isExplicit) {
        return result(normalizedExisting, 1, [`existing:${rawCategory || normalizedExisting}`], 'metadata');
    }

    // Durable existing metadata: non-soft aliases already normalized (e.g. Love→Romance handled above).
    // Soft defaults fall through to signal scoring.
    if (rawCategory && !SOFT_DEFAULT_CATEGORIES.has(rawCategory) && EXPLICIT_SHELF_CATEGORIES.has(normalizedExisting)) {
        return result(normalizedExisting, 0.92, [`existing:${rawCategory}`], 'existing-category');
    }

    const scored = scoreEvidenceLayers(meta);
    const pick = pickEligibleShelf(scored.scores, scored.strong, scored.weak);

    if (pick.eligible && pick.category !== 'Trending') {
        const confidence = Math.min(
            0.95,
            0.5 + pick.strongCount * 0.14 + Math.min(pick.weakCount, 3) * 0.04
        );
        const source =
            scored.bestSource === 'filename'
                ? 'filename'
                : scored.bestSource === 'series'
                  ? 'series'
                  : 'keyword';
        return result(pick.category, confidence, scored.signals.slice(0, 12), source);
    }

    if (pick.eligible && pick.category === 'Trending' && pick.strongCount >= 1) {
        return result('Trending', 0.7, scored.signals.slice(0, 8), 'keyword');
    }

    if (normalizedExisting && !SOFT_DEFAULT_CATEGORIES.has(rawCategory)) {
        return result(normalizedExisting, 0.55, [`existing:${rawCategory}`], 'existing-category');
    }

    return result('Trending', 0.2, scored.signals.slice(0, 3), 'fallback');
}

/**
 * NLP-ready wrapper — same contract as classifyContent.
 * Pass `nlpProvider` later to swap in a semantic model without changing callers.
 *
 * @param {Record<string, unknown> | null | undefined} content
 * @param {{
 *   nlpProvider?: (meta: NormalizedClassificationMetadata, content: Record<string, unknown>) =>
 *     ContentClassification | Promise<ContentClassification>
 * }} [options]
 * @returns {Promise<ContentClassification>}
 */
export async function classifyContentSemantic(content, options = {}) {
    const row = content && typeof content === 'object' ? content : {};
    const meta = normalizeClassificationMetadata(row);
    if (typeof options.nlpProvider === 'function') {
        const out = await options.nlpProvider(meta, /** @type {Record<string, unknown>} */ (row));
        if (
            out &&
            typeof out === 'object' &&
            typeof out.primaryCategory === 'string' &&
            Array.isArray(out.categories) &&
            typeof out.confidence === 'number' &&
            Array.isArray(out.signals) &&
            typeof out.classificationSource === 'string'
        ) {
            return {
                primaryCategory: normalizeDiscoveryShelf(out.primaryCategory),
                categories: out.categories.map((c) => normalizeDiscoveryShelf(String(c))),
                confidence: Math.max(0, Math.min(1, Number(out.confidence) || 0)),
                signals: out.signals.map(String),
                classificationSource: /** @type {ContentClassification['classificationSource']} */ (
                    out.classificationSource === 'nlp' ? 'nlp' : out.classificationSource
                )
            };
        }
    }
    return classifyContent(row);
}
