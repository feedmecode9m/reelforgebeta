/**
 * Canonical catalog metadata read model — pure, Node-safe.
 *
 * Resolves title/description/tags/category with provenance.
 * Does NOT invent fake titles from UUID/camera dumps.
 * Does NOT write Series/catalog authority.
 * Classification remains in contentClassifier.js (shared taxonomy).
 */

import {
    isGenericMediaLabel,
    normalizeDiscoveryShelf,
    EXPLICIT_SHELF_CATEGORIES,
    SOFT_DEFAULT_CATEGORIES,
    STRONG_SHELF_KEYWORDS,
    WEAK_SHELF_KEYWORDS,
    DISCOVERY_SHELF_KEYWORDS,
    DISCOVERY_SHELVES
} from './contentClassifier.js';

/**
 * @typedef {'creator' | 'studio' | 'upload' | 'existing-category' | 'filename' | 'derived' | 'classifier' | 'unknown'} MetadataSource
 */

/**
 * @typedef {Object} CatalogMetadata
 * @property {string} title
 * @property {string} description
 * @property {string[]} tags
 * @property {string} explicitCategory
 * @property {string[]} categories
 * @property {string} mediaKind
 * @property {string} posterUrl
 * @property {string} thumbnailUrl
 * @property {string} fileName
 * @property {MetadataSource} metadataSource
 * @property {number} metadataConfidence
 * @property {MetadataSource} titleSource
 * @property {string[]} evidenceSignals
 * @property {Array<{ category: string; score: number; strong: string[]; weak: string[] }>} candidateCategories
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
 * Meaningful human title — rejects UUID/camera/hash dumps.
 * @param {string} value
 * @returns {boolean}
 */
export function isMeaningfulTitle(value) {
    const raw = text(value);
    if (!raw) return false;
    if (isGenericMediaLabel(raw)) return false;
    // Timestamp / VID dumps
    if (/^(vid|img|dsc|clip|camera|photo|video|untitled)[_-]?\d{2,}/i.test(raw)) return false;
    if (/^\d{8}[_-]?\d{4,}/.test(raw)) return false;
    // Must contain at least one letter
    if (!/[a-zA-Z]/.test(raw)) return false;
    // Too short / numeric-heavy
    const letters = (raw.match(/[a-zA-Z]/g) || []).length;
    if (letters < 3) return false;
    return true;
}

/**
 * Meaningful filename stem usable as weak title evidence (never equal to creator title).
 * @param {string} fileName
 * @returns {boolean}
 */
export function isMeaningfulFileName(fileName) {
    const raw = text(fileName);
    if (!raw) return false;
    const stem = (raw.split(/[/\\]/).pop() || raw).replace(/\.[a-z0-9]{2,5}$/i, '');
    return isMeaningfulTitle(stem);
}

/**
 * Humanize a meaningful filename stem without inventing semantics.
 * @param {string} fileName
 * @returns {string}
 */
export function humanizeMeaningfulFileName(fileName) {
    if (!isMeaningfulFileName(fileName)) return '';
    const stem = (text(fileName).split(/[/\\]/).pop() || '').replace(/\.[a-z0-9]{2,5}$/i, '');
    return stem
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Resolve display title with provenance.
 * Order: creator/studio → durable existing → meaningful filename → derived → keep existing generic.
 *
 * @param {Record<string, unknown>} item
 * @returns {{ title: string; titleSource: MetadataSource }}
 */
export function resolveCatalogTitle(item) {
    const row = item && typeof item === 'object' ? item : {};
    const creatorTitle = text(
        row.creatorTitle || row.studioTitle || row.persistentTitle || row.enrichmentTitle
    );
    if (isMeaningfulTitle(creatorTitle)) {
        return { title: creatorTitle, titleSource: 'creator' };
    }

    const durableTitle = text(row.title);
    if (isMeaningfulTitle(durableTitle)) {
        const src = text(row.titleSource || row.metadataSource);
        if (src === 'creator' || src === 'studio') {
            return { title: durableTitle, titleSource: /** @type {MetadataSource} */ (src) };
        }
        return { title: durableTitle, titleSource: 'upload' };
    }

    const name = text(row.name);
    if (isMeaningfulTitle(name)) {
        return { title: name, titleSource: 'upload' };
    }

    const fileName = text(row.fileName || row.file_name);
    if (isMeaningfulFileName(fileName)) {
        return { title: humanizeMeaningfulFileName(fileName), titleSource: 'filename' };
    }

    const displayTitle = text(row.displayTitle || row.heroTitle);
    if (isMeaningfulTitle(displayTitle)) {
        return { title: displayTitle, titleSource: 'derived' };
    }

    // Keep existing label rather than manufacturing a polished fake title.
    const fallback = durableTitle || name || displayTitle || '';
    return { title: fallback, titleSource: fallback ? 'upload' : 'unknown' };
}

/**
 * @param {Record<string, unknown>} item
 * @returns {{ category: string; source: MetadataSource }}
 */
export function resolveExplicitCategory(item) {
    const row = item && typeof item === 'object' ? item : {};
    const raw = text(
        row.creatorCategory ||
            row.studioCategory ||
            row.explicitCategory ||
            row.category ||
            row.shelfCategory ||
            ''
    );
    const normalized = normalizeDiscoveryShelf(raw);
    if (!raw || SOFT_DEFAULT_CATEGORIES.has(raw)) {
        return { category: '', source: 'unknown' };
    }
    if (EXPLICIT_SHELF_CATEGORIES.has(raw) || EXPLICIT_SHELF_CATEGORIES.has(normalized)) {
        const src =
            text(row.creatorCategory) || text(row.studioCategory)
                ? text(row.creatorCategory)
                    ? 'creator'
                    : 'studio'
                : text(row.categorySource) === 'creator' || text(row.categorySource) === 'studio'
                  ? /** @type {MetadataSource} */ (text(row.categorySource))
                  : 'existing-category';
        return { category: normalized, source: src };
    }
    return { category: '', source: 'unknown' };
}

/**
 * Derive lightweight evidence candidates from text fields (classifier still decides).
 * @param {{ title?: string; description?: string; tags?: string[]; fileName?: string; titleSource?: MetadataSource }} fields
 */
export function deriveMetadataEvidence(fields) {
    /** @type {Record<string, { score: number; strong: string[]; weak: string[] }>} */
    const byCat = {
        Trending: { score: 0, strong: [], weak: [] },
        Romance: { score: 0, strong: [], weak: [] },
        'Cyber-Action': { score: 0, strong: [], weak: [] },
        Suspense: { score: 0, strong: [], weak: [] }
    };
    /** @type {string[]} */
    const signals = [];

    /** @type {Array<{ label: string; text: string; weight: number }>} */
    const layers = [
        { label: 'title', text: text(fields.title), weight: 1 },
        { label: 'description', text: text(fields.description), weight: 1 },
        { label: 'tags', text: (fields.tags || []).join(' '), weight: 1.1 },
        {
            label: 'filename',
            text:
                fields.titleSource === 'filename'
                    ? ''
                    : isMeaningfulFileName(text(fields.fileName))
                      ? text(fields.fileName)
                      : '',
            weight: 0.45
        }
    ];

    for (const layer of layers) {
        const hay = layer.text.toLowerCase();
        if (!hay) continue;
        for (const shelf of /** @type {string[]} */ ([
            'Romance',
            'Cyber-Action',
            'Suspense',
            'Trending'
        ])) {
            for (const kw of STRONG_SHELF_KEYWORDS[shelf] || []) {
                if (hay.includes(kw)) {
                    byCat[shelf].score += 3 * layer.weight;
                    byCat[shelf].strong.push(kw);
                    signals.push(`${layer.label}:strong:${kw}`);
                }
            }
            for (const kw of DISCOVERY_SHELF_KEYWORDS[shelf] || []) {
                const k = String(kw).toLowerCase();
                if (STRONG_SHELF_KEYWORDS[shelf]?.has(k)) continue;
                if (!WEAK_SHELF_KEYWORDS.has(k)) continue;
                if (hay.includes(k)) {
                    byCat[shelf].score += 1 * layer.weight;
                    byCat[shelf].weak.push(k);
                    signals.push(`${layer.label}:weak:${k}`);
                }
            }
        }
    }

    const candidates = DISCOVERY_SHELVES.map((category) => ({
        category,
        score: byCat[category].score,
        strong: [...new Set(byCat[category].strong)],
        weak: [...new Set(byCat[category].weak)]
    })).sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.strong.length !== a.strong.length) return b.strong.length - a.strong.length;
        return DISCOVERY_SHELVES.indexOf(a.category) - DISCOVERY_SHELVES.indexOf(b.category);
    });

    return {
        candidateCategories: candidates.filter((c) => c.strong.length > 0 || c.score > 0),
        evidenceSignals: [...new Set(signals)]
    };
}

/**
 * Resolve canonical catalog metadata for an inventory item.
 * @param {Record<string, unknown> | null | undefined} item
 * @returns {CatalogMetadata}
 */
export function resolveCatalogMetadata(item) {
    const row = item && typeof item === 'object' ? /** @type {Record<string, unknown>} */ (item) : {};
    const { title, titleSource } = resolveCatalogTitle(row);
    const description = text(
        row.description || row.enrichmentDescription || row.heroDescription || row.episodeDescription
    );
    const tags = [
        ...asStringList(row.tags),
        ...asStringList(row.ai_tags),
        ...asStringList(row.keywords),
        ...asStringList(row.discoveryTags)
    ];
    const fileName = text(row.fileName || row.file_name);
    const explicit = resolveExplicitCategory(row);
    const mediaKind = text(row.mediaKind || row.type || row.primaryMediaType).toLowerCase() || 'unknown';
    const posterUrl = text(row.posterUrl || row.thumbnailUrl || row.thumbnail_url);
    const thumbnailUrl = text(row.thumbnailUrl || row.thumbnail_url || row.posterUrl);

    const derived = deriveMetadataEvidence({
        title: isMeaningfulTitle(title) ? title : '',
        description,
        tags,
        fileName,
        titleSource
    });

    /** @type {MetadataSource} */
    let metadataSource = 'unknown';
    let metadataConfidence = 0.2;
    if (explicit.category) {
        metadataSource = explicit.source;
        metadataConfidence = 1;
    } else if (description || tags.length) {
        metadataSource = text(row.metadataSource) === 'creator' ? 'creator' : 'upload';
        metadataConfidence = 0.75;
    } else if (isMeaningfulTitle(title) && titleSource === 'creator') {
        metadataSource = 'creator';
        metadataConfidence = 0.85;
    } else if (isMeaningfulTitle(title)) {
        metadataSource = titleSource;
        metadataConfidence = titleSource === 'filename' ? 0.35 : 0.65;
    } else if (titleSource === 'filename') {
        metadataSource = 'filename';
        metadataConfidence = 0.25;
    }

    /** @type {string[]} */
    const categories = [];
    if (explicit.category) categories.push(explicit.category);
    for (const c of derived.candidateCategories) {
        if (c.strong.length > 0 && !categories.includes(c.category)) categories.push(c.category);
    }
    if (!categories.includes('Trending')) categories.push('Trending');

    return {
        title,
        description,
        tags,
        explicitCategory: explicit.category,
        categories,
        mediaKind,
        posterUrl,
        thumbnailUrl,
        fileName,
        metadataSource,
        metadataConfidence,
        titleSource,
        evidenceSignals: derived.evidenceSignals,
        candidateCategories: derived.candidateCategories
    };
}

/**
 * Apply resolved metadata onto a catalog item for classification/projection.
 * Does not change durable identity fields.
 *
 * @param {Record<string, unknown>} item
 * @param {CatalogMetadata} [meta]
 * @returns {Record<string, unknown>}
 */
export function applyCatalogMetadata(item, meta) {
    const row = item && typeof item === 'object' ? { ...item } : {};
    const resolved = meta || resolveCatalogMetadata(row);

    // Prefer meaningful resolved title; never replace a meaningful creator title with filename.
    if (isMeaningfulTitle(resolved.title)) {
        row.title = resolved.title;
        if (!isMeaningfulTitle(text(row.name)) || text(row.name) === text(row.fileName)) {
            row.name = resolved.title;
        }
    }

    if (resolved.description) row.description = resolved.description;
    if (resolved.tags.length) {
        row.tags = resolved.tags;
    }
    if (resolved.explicitCategory) {
        row.category = resolved.explicitCategory;
        row.explicitCategory = resolved.explicitCategory;
        row.categorySource = resolved.metadataSource;
    }
    if (resolved.posterUrl && !text(row.posterUrl)) row.posterUrl = resolved.posterUrl;
    if (resolved.thumbnailUrl && !text(row.thumbnailUrl)) row.thumbnailUrl = resolved.thumbnailUrl;

    row.metadataSource = resolved.metadataSource;
    row.metadataConfidence = resolved.metadataConfidence;
    row.titleSource = resolved.titleSource;
    row.catalogMetadataSignals = resolved.evidenceSignals;
    row.candidateCategories = resolved.candidateCategories.map((c) => c.category);

    return row;
}
