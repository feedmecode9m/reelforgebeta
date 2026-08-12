/**
 * Phase 17 — creator catalog metadata authoring (read/write glue).
 *
 * Reuses existing durable stores keyed by reel/asset id:
 *   - reel_titles_persistent (Master Edit title authority) — PRIMARY for
 *     title/description/tags/category so series/Vic G sync cannot clobber catalog fields
 *   - reelforge_series_metadata — best-effort mirror for Studio series editor compatibility
 *   - optional PATCH /api/reels/{id}/category (existing category API)
 *
 * Does NOT create a second metadata authority or catalog identity.
 * Does NOT mutate series catalog / Vic G / Hero / Theater ownership.
 */

import {
    SERIES_METADATA_STORAGE_KEY,
    normalizeTags
} from '../series/seriesMetadataStorage.js';
import { REEL_TITLES_PERSISTENT_KEY } from '../content/contentIdentityResolver.js';
import {
    classifyContent,
    EXPLICIT_SHELF_CATEGORIES,
    SOFT_DEFAULT_CATEGORIES,
    normalizeDiscoveryShelf
} from './contentClassifier.js';

/** Canonical shelf options for creator category UX (matches Studio bulk). */
export const CREATOR_SHELF_OPTIONS = Object.freeze([
    'Trending',
    'Romance',
    'Suspense',
    'Cyber-Action'
]);

/**
 * @typedef {Object} CreatorCatalogMetadata
 * @property {string} title
 * @property {string} description
 * @property {string[]} tags
 * @property {string} category  empty or Trending = no hard override
 * @property {string} assetId
 * @property {number} [updatedAt]
 */

/**
 * @returns {{ getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem?: (k: string) => void }}
 */
function defaultStorage() {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
        return globalThis.localStorage;
    }
    /** @type {Map<string, string>} */
    const mem = new Map();
    return {
        getItem: (k) => (mem.has(k) ? mem.get(k) ?? null : null),
        setItem: (k, v) => {
            mem.set(k, String(v));
        },
        removeItem: (k) => {
            mem.delete(k);
        }
    };
}

/**
 * In-memory storage for Node validators.
 * @param {Record<string, string>} [seed]
 */
export function createMemoryStorage(seed = {}) {
    /** @type {Map<string, string>} */
    const mem = new Map(Object.entries(seed));
    return {
        getItem: (k) => (mem.has(k) ? mem.get(k) ?? null : null),
        setItem: (k, v) => {
            mem.set(k, String(v));
        },
        removeItem: (k) => {
            mem.delete(k);
        }
    };
}

/**
 * Deterministic tag normalization: trim, drop empties, case-insensitive dedupe.
 * Preserves first-seen human casing for display.
 * @param {string[] | string | undefined | null} tags
 * @returns {string[]}
 */
export function normalizeCreatorTags(tags) {
    return normalizeTags(tags);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * @param {string} category
 * @returns {string} explicit shelf or '' when soft/Trending
 */
export function normalizeCreatorCategory(category) {
    const raw = text(category);
    if (!raw || SOFT_DEFAULT_CATEGORIES.has(raw)) return '';
    const normalized = normalizeDiscoveryShelf(raw);
    if (EXPLICIT_SHELF_CATEGORIES.has(normalized)) return normalized;
    if (EXPLICIT_SHELF_CATEGORIES.has(raw)) return raw;
    return '';
}

/**
 * Series-mirror shelf fill-hole — promote ONLY already-explicit discovery shelves.
 * Narrative series.genre values (e.g. Drama, Action, Love) must NOT be aliased into
 * Romance / Cyber-Action via normalizeDiscoveryShelf; that collapses inventory into
 * the wrong rail. Love/Drama→Romance remains valid for authored API/upload category
 * fields via normalizeCreatorCategory, not for series narrative genre.
 *
 * @param {Record<string, unknown> | null | undefined} row
 * @returns {string}
 */
export function seriesMirrorShelfCategory(row) {
    if (!row || typeof row !== 'object') return '';
    for (const key of ['creatorCategory', 'category', 'shelfCategory', 'genre']) {
        const raw = text(row[key]);
        if (!raw || SOFT_DEFAULT_CATEGORIES.has(raw)) continue;
        // Explicit shelf label only — no Love/Drama/Action aliasing.
        if (EXPLICIT_SHELF_CATEGORIES.has(raw)) return raw;
    }
    return '';
}

/**
 * @param {{ storage?: ReturnType<typeof createMemoryStorage> }} [options]
 */
function resolveStorage(options = {}) {
    return options.storage || defaultStorage();
}

/**
 * @param {unknown} parsed
 * @returns {Record<string, Record<string, unknown>>}
 */
function asSeriesMap(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    if (Array.isArray(/** @type {{ catalog?: unknown }} */ (parsed).catalog)) {
        const map = /** @type {{ map?: Record<string, Record<string, unknown>> }} */ (parsed).map;
        return map && typeof map === 'object' ? map : {};
    }
    /** @type {Record<string, Record<string, unknown>>} */
    const out = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (key === 'catalog' || key === 'map' || key === 'cachedAt') continue;
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        out[key] = /** @type {Record<string, unknown>} */ (value);
    }
    return out;
}

/**
 * @param {string} assetId
 * @param {{ storage?: ReturnType<typeof createMemoryStorage> }} [options]
 * @returns {CreatorCatalogMetadata}
 */
export function loadCreatorCatalogMetadata(assetId, options = {}) {
    const id = text(assetId);
    /** @type {CreatorCatalogMetadata & {
     *   primaryTitleAuthority?: boolean;
     *   primaryDescriptionAuthority?: boolean;
     *   primaryTagsAuthority?: boolean;
     *   primaryCategoryAuthority?: boolean;
     * }} */
    const empty = {
        assetId: id,
        title: '',
        description: '',
        tags: [],
        category: '',
        primaryTitleAuthority: false,
        primaryDescriptionAuthority: false,
        primaryTagsAuthority: false,
        primaryCategoryAuthority: false
    };
    if (!id) return empty;
    const storage = resolveStorage(options);

    let title = '';
    let description = '';
    /** @type {string[]} */
    let tags = [];
    let category = '';
    let updatedAt;
    /** Primary titles map authored keys (incl. empty clear) — do not revive from series. */
    let primaryCategoryAuthority = false;
    let primaryDescriptionAuthority = false;
    let primaryTagsAuthority = false;
    let primaryTitleAuthority = false;

    // PRIMARY: reel_titles_persistent (survives series/Vic G metadata sync)
    try {
        const titlesRaw = storage.getItem(REEL_TITLES_PERSISTENT_KEY);
        const titles = titlesRaw ? JSON.parse(titlesRaw) : {};
        const entry = titles && typeof titles === 'object' ? titles[id] : null;
        if (entry && typeof entry === 'object') {
            primaryTitleAuthority =
                Object.prototype.hasOwnProperty.call(entry, 'title') ||
                Object.prototype.hasOwnProperty.call(entry, 'title_original');
            primaryDescriptionAuthority = Object.prototype.hasOwnProperty.call(entry, 'description');
            primaryTagsAuthority = Object.prototype.hasOwnProperty.call(entry, 'tags');
            title = text(entry.title || entry.title_original);
            description = text(entry.description);
            tags = normalizeCreatorTags(/** @type {string[] | string} */ (entry.tags));
            primaryCategoryAuthority =
                Object.prototype.hasOwnProperty.call(entry, 'category') ||
                Object.prototype.hasOwnProperty.call(entry, 'creatorCategory');
            // Shelf authority from authored category fields only — not narrative genre.
            category = normalizeCreatorCategory(
                text(entry.category) || text(entry.creatorCategory)
            );
            if (entry.savedAt != null) updatedAt = Number(entry.savedAt) || undefined;
        }
    } catch {
        /* ignore */
    }

    // FALLBACK / fill holes from series metadata (Studio editor path)
    try {
        const metaRaw = storage.getItem(SERIES_METADATA_STORAGE_KEY);
        const map = asSeriesMap(metaRaw ? JSON.parse(metaRaw) : {});
        const row = map[id];
        if (row) {
            if (!title && !primaryTitleAuthority) title = text(row.episodeTitle);
            // Phase 19: cleared primary description/tags stay absent — series must not revive them.
            if (!description && !primaryDescriptionAuthority) description = text(row.description);
            if (!tags.length && !primaryTagsAuthority) {
                tags = normalizeCreatorTags(/** @type {string[] | string} */ (row.tags));
            }
            // Phase 18: cleared primary category stays absent — series mirror must not revive it.
            // Only promote already-explicit shelves from the mirror (never Drama→Romance alias).
            if (!category && !primaryCategoryAuthority) {
                category = seriesMirrorShelfCategory(row);
            }
            if (updatedAt == null && row.updatedAt != null) {
                updatedAt = Number(row.updatedAt) || undefined;
            }
        }
    } catch {
        /* ignore */
    }

    return {
        assetId: id,
        title,
        description,
        tags,
        category,
        updatedAt,
        /** @type {boolean} */
        primaryTitleAuthority,
        /** @type {boolean} */
        primaryDescriptionAuthority,
        /** @type {boolean} */
        primaryTagsAuthority,
        /** @type {boolean} */
        primaryCategoryAuthority
    };
}

/**
 * Persist creator metadata into reel_titles_persistent (primary) + series-metadata mirror.
 *
 * @param {string} assetId
 * @param {{ title?: string; description?: string; tags?: string[] | string; category?: string }} fields
 * @param {{ storage?: ReturnType<typeof createMemoryStorage>; patchCategory?: boolean }} [options]
 * @returns {CreatorCatalogMetadata | null}
 */
export function saveCreatorCatalogMetadata(assetId, fields = {}, options = {}) {
    const id = text(assetId);
    if (!id) return null;
    const storage = resolveStorage(options);
    const prev = loadCreatorCatalogMetadata(id, { storage });

    const title =
        fields.title !== undefined ? text(fields.title).slice(0, 200) : prev.title;
    const description =
        fields.description !== undefined
            ? text(fields.description).slice(0, 4000)
            : prev.description;
    const tags =
        fields.tags !== undefined ? normalizeCreatorTags(fields.tags) : prev.tags;
    const category =
        fields.category !== undefined
            ? normalizeCreatorCategory(fields.category)
            : prev.category;
    const updatedAt = Date.now();

    // PRIMARY — extend Master Edit title map (same key, same durable id)
    try {
        const titlesRaw = storage.getItem(REEL_TITLES_PERSISTENT_KEY);
        /** @type {Record<string, Record<string, unknown>>} */
        const titles = titlesRaw ? JSON.parse(titlesRaw) || {} : {};
        const prior = titles[id] && typeof titles[id] === 'object' ? titles[id] : {};
        titles[id] = {
            ...prior,
            title: title || text(prior.title),
            title_original: title || text(prior.title_original) || text(prior.title),
            description,
            tags,
            category: category || '',
            creatorCategory: category || '',
            savedAt: updatedAt
        };
        storage.setItem(REEL_TITLES_PERSISTENT_KEY, JSON.stringify(titles));
    } catch (err) {
        console.warn('[creatorCatalogMetadata] title-map persist failed', err);
    }

    // BEST-EFFORT mirror into series metadata without wiping series/Vic G structural fields.
    try {
        const metaRaw = storage.getItem(SERIES_METADATA_STORAGE_KEY);
        const map = asSeriesMap(metaRaw ? JSON.parse(metaRaw) : {});
        const prior = map[id] && typeof map[id] === 'object' ? map[id] : {};
        map[id] = {
            ...prior,
            reelId: id,
            seasonNumber: Number(prior.seasonNumber ?? 1) || 1,
            episodeNumber: Number(prior.episodeNumber ?? 1) || 1,
            seriesName: text(prior.seriesName),
            episodeTitle: title || text(prior.episodeTitle),
            // Phase 19: explicit empty description/tags clear the mirror (same authority as category).
            description,
            tags,
            // Phase 18: cleared category must clear mirror genre — never preserve stale shelf.
            genre: category || '',
            creatorCategory: category || '',
            updatedAt
        };
        storage.setItem(SERIES_METADATA_STORAGE_KEY, JSON.stringify(map));
    } catch (err) {
        console.warn('[creatorCatalogMetadata] series-meta mirror failed', err);
    }

    const saved = { assetId: id, title, description, tags, category, updatedAt };

    if (options.patchCategory !== false && typeof fetch === 'function' && typeof window !== 'undefined') {
        const apiCategory = category || 'Trending';
        void import('../api/media.js')
            .then((mod) => mod.patchReelCategory?.(id, apiCategory))
            .catch((err) => {
                console.warn('[creatorCatalogMetadata] category PATCH deferred/local-only', err);
            });
    }

    return saved;
}

/**
 * Stamp creator-authored fields onto a catalog/inventory row before classification.
 * Same durable id — no merge by filename.
 *
 * Phase 18/19: authored-empty primary fields are authoritative clears — they must
 * erase previously projected live evidence (not skip as "no update").
 *
 * @param {Record<string, unknown> | null | undefined} item
 * @param {{ storage?: ReturnType<typeof createMemoryStorage> }} [options]
 * @returns {Record<string, unknown>}
 */
export function hydrateCatalogItemWithCreatorMetadata(item, options = {}) {
    const row = item && typeof item === 'object' ? { ...item } : {};
    const id = text(row.id || row.mediaAssetId || row.assetId || row.reelId);
    if (!id) return row;

    const meta = loadCreatorCatalogMetadata(id, options);
    const hasPrimaryClear =
        Boolean(meta.primaryDescriptionAuthority && !meta.description) ||
        Boolean(meta.primaryTagsAuthority && !meta.tags.length) ||
        Boolean(meta.primaryCategoryAuthority && !meta.category);
    if (
        !meta.title &&
        !meta.description &&
        !meta.tags.length &&
        !meta.category &&
        !hasPrimaryClear
    ) {
        return row;
    }

    if (meta.title) {
        row.persistentTitle = meta.title;
        row.creatorTitle = meta.title;
        row.title = meta.title;
        if (!text(row.name) || text(row.name) === text(row.fileName)) {
            row.name = meta.title;
        }
        row.titleSource = 'creator';
    }
    if (meta.description) {
        row.description = meta.description;
        row.enrichmentDescription = meta.description;
    } else if (meta.primaryDescriptionAuthority) {
        // Phase 19: authored-empty description clears stale live projection evidence.
        row.description = '';
        if ('enrichmentDescription' in row) delete row.enrichmentDescription;
        if ('heroDescription' in row) delete row.heroDescription;
        if ('episodeDescription' in row) delete row.episodeDescription;
    }
    if (meta.tags.length) {
        row.tags = meta.tags;
    } else if (meta.primaryTagsAuthority) {
        // Phase 19: authored-empty tags clear stale live projection evidence.
        row.tags = [];
        // Classifier also reads these bags — drop only when primary tags were cleared,
        // so prior creator stamps cannot keep scoring shelves.
        if ('ai_tags' in row) delete row.ai_tags;
        if ('keywords' in row) delete row.keywords;
        if ('discoveryTags' in row) delete row.discoveryTags;
    }
    if (meta.category) {
        row.creatorCategory = meta.category;
        row.categorySource = 'creator';
        if (!text(row.studioCategory)) {
            row.category = meta.category;
        }
    } else {
        // Phase 18: absence of explicit creator category must clear stale projection fields
        // so classifyContent re-evaluates remaining metadata (not old Romance/etc.).
        if ('creatorCategory' in row) delete row.creatorCategory;
        if ('explicitCategory' in row) delete row.explicitCategory;
        if (text(row.categorySource) === 'creator' || text(row.categorySource) === 'existing-category') {
            delete row.categorySource;
        }
        if (!text(row.studioCategory)) {
            const existing = normalizeDiscoveryShelf(text(row.category) || text(row.shelfCategory));
            if (EXPLICIT_SHELF_CATEGORIES.has(existing)) {
                row.category = 'Trending';
                if ('shelfCategory' in row) delete row.shelfCategory;
            }
        }
    }
    // After authored-empty description/tags clear, soft-reset prior classifier shelf
    // so existing-category cannot keep Suspense/Romance from the cleared evidence.
    if (
        (meta.primaryDescriptionAuthority && !meta.description) ||
        (meta.primaryTagsAuthority && !meta.tags.length)
    ) {
        if ('explicitCategory' in row) delete row.explicitCategory;
        if (!meta.category && !text(row.studioCategory)) {
            const existing = normalizeDiscoveryShelf(text(row.category) || text(row.shelfCategory));
            if (EXPLICIT_SHELF_CATEGORIES.has(existing)) {
                row.category = 'Trending';
                if ('shelfCategory' in row) delete row.shelfCategory;
            }
        }
    }
    row.metadataSource = 'creator';
    return row;
}

/**
 * Classifier preview for creator UX (deterministic; no NLP).
 *
 * @param {{ title?: string; description?: string; tags?: string[] | string; category?: string; fileName?: string }} fields
 * @returns {{ primaryCategory: string; confidence: number; confidenceLabel: string; source: string; signals: string[]; explicit: boolean }}
 */
export function previewCreatorShelfClassification(fields = {}) {
    const explicit = normalizeCreatorCategory(fields.category);
    const row = {
        title: text(fields.title),
        description: text(fields.description),
        tags: normalizeCreatorTags(fields.tags),
        fileName: text(fields.fileName),
        ...(explicit
            ? { creatorCategory: explicit, categorySource: 'creator', category: explicit }
            : { category: 'Trending' })
    };
    const c = classifyContent(row);
    const confidence = Number(c.confidence) || 0;
    const confidenceLabel =
        confidence >= 0.85 ? 'High confidence' : confidence >= 0.5 ? 'Medium confidence' : 'Low confidence';
    return {
        primaryCategory: c.primaryCategory,
        confidence,
        confidenceLabel,
        source: c.classificationSource,
        signals: c.signals || [],
        explicit: Boolean(explicit)
    };
}
