const COLLECTIONS_STORAGE_KEY = 'reelforge_documentary_collections';
const CONTENT_INTELLIGENCE_STORAGE_KEY = 'reelforge_content_intelligence_draft';

export const COLLECTION_TYPES = /** @type {const} */ ([
  'documentary',
  'community',
  'educational',
  'campaign',
  'sponsored',
  'archive'
]);

export const DEFAULT_COLLECTION_TITLES = /** @type {const} */ ([
  'Black Agriculture',
  'Civil Rights',
  'Land Ownership',
  'Entrepreneurship',
  'Food Justice',
  'Diaspora Stories',
  'Community Builders',
  'Black Innovation',
  'Cultural Preservation',
  'Environmental Stewardship'
]);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeString(item))
    .filter((item, index, list) => item.length > 0 && list.indexOf(item) === index);
}

function toCollectionId(title) {
  const slug = normalizeString(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug ? `collection-${slug}` : `collection-${Date.now()}`;
}

export function createEmptyCollectionMetadata() {
  return {
    collectionId: '',
    collectionTitle: '',
    collectionDescription: '',
    collectionCoverImage: '',
    collectionTrailer: '',
    collectionType: 'documentary',
    communityRepresented: [],
    educationalThemes: [],
    featuredSeries: [],
    featuredEpisodes: [],
    sponsorshipCategories: [],
    searchKeywords: [],
    collectionPriority: 50
  };
}

export function normalizeCollectionMetadata(input) {
  const base = createEmptyCollectionMetadata();
  const merged = { ...base, ...(input || {}) };
  const title = normalizeString(merged.collectionTitle);
  const collectionId = normalizeString(merged.collectionId) || toCollectionId(title || 'collection');
  return {
    ...merged,
    collectionId,
    collectionTitle: title,
    collectionDescription: normalizeString(merged.collectionDescription),
    collectionCoverImage: normalizeString(merged.collectionCoverImage),
    collectionTrailer: normalizeString(merged.collectionTrailer),
    collectionType: COLLECTION_TYPES.includes(merged.collectionType) ? merged.collectionType : 'documentary',
    communityRepresented: normalizeStringArray(merged.communityRepresented),
    educationalThemes: normalizeStringArray(merged.educationalThemes),
    featuredSeries: normalizeStringArray(merged.featuredSeries),
    featuredEpisodes: normalizeStringArray(merged.featuredEpisodes),
    sponsorshipCategories: normalizeStringArray(merged.sponsorshipCategories),
    searchKeywords: normalizeStringArray(merged.searchKeywords),
    collectionPriority: Number.isFinite(Number(merged.collectionPriority))
      ? Math.max(0, Math.min(100, Number(merged.collectionPriority)))
      : 50
  };
}

export function validateCollectionMetadata(input) {
  const normalized = normalizeCollectionMetadata(input);
  const missingFields = [];
  if (!normalized.collectionId) missingFields.push('collectionId');
  if (!normalized.collectionTitle) missingFields.push('collectionTitle');
  if (!normalized.collectionDescription) missingFields.push('collectionDescription');
  if (!normalized.collectionType) missingFields.push('collectionType');
  return {
    valid: missingFields.length === 0,
    missingFields,
    normalized
  };
}

export function buildDefaultCollections() {
  return DEFAULT_COLLECTION_TITLES.map((title, index) =>
    normalizeCollectionMetadata({
      collectionId: toCollectionId(title),
      collectionTitle: title,
      collectionDescription: `${title} stories curated for documentary discovery.`,
      collectionType: 'documentary',
      collectionPriority: 100 - index * 5
    })
  );
}

function safeParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function loadCollections() {
  if (typeof window === 'undefined') return buildDefaultCollections();
  const raw = localStorage.getItem(COLLECTIONS_STORAGE_KEY);
  if (!raw) return buildDefaultCollections();
  const parsed = safeParse(raw, []);
  if (!Array.isArray(parsed) || parsed.length === 0) return buildDefaultCollections();
  return parsed.map((item) => normalizeCollectionMetadata(item));
}

export function persistCollections(collections) {
  const normalized = (Array.isArray(collections) ? collections : []).map((item) =>
    normalizeCollectionMetadata(item)
  );
  if (typeof window !== 'undefined') {
    localStorage.setItem(COLLECTIONS_STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(
      new CustomEvent('reelforge:collections-updated', {
        detail: {
          collections: normalized,
          count: normalized.length,
          timestamp: Date.now()
        }
      })
    );
  }
  return normalized;
}

export function createCollectionFromTitle(title) {
  const normalizedTitle = normalizeString(title) || `Collection ${Date.now()}`;
  return normalizeCollectionMetadata({
    collectionTitle: normalizedTitle,
    collectionDescription: `${normalizedTitle} documentary collection.`,
    collectionType: 'documentary',
    collectionPriority: 50
  });
}

function loadContentIntelligenceDraft() {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem(CONTENT_INTELLIGENCE_STORAGE_KEY);
  return raw ? safeParse(raw, {}) : {};
}

export function buildCollectionDiscoveryLayer(collections) {
  const draft = loadContentIntelligenceDraft();
  const series = draft?.series || {};
  const episode = draft?.episode || {};
  const community = draft?.community || {};
  const educational = draft?.educational || {};
  const discovery = draft?.discovery || {};

  return (Array.isArray(collections) ? collections : []).map((collection) => {
    const normalized = normalizeCollectionMetadata(collection);
    const connectionTags = [];
    if (normalized.featuredSeries.length > 0 || normalizeString(series.seriesTitle)) {
      connectionTags.push('Series Metadata');
    }
    if (normalized.featuredEpisodes.length > 0 || normalizeString(episode.episodeTitle)) {
      connectionTags.push('Episode Metadata');
    }
    if (normalized.communityRepresented.length > 0 || normalizeString(community.communityRepresented)) {
      connectionTags.push('Community Metadata');
    }
    if (normalized.educationalThemes.length > 0 || (Array.isArray(educational.educationalThemes) && educational.educationalThemes.length > 0)) {
      connectionTags.push('Educational Metadata');
    }
    if (
      normalized.searchKeywords.length > 0 ||
      (Array.isArray(discovery.searchKeywords) && discovery.searchKeywords.length > 0)
    ) {
      connectionTags.push('Discovery Metadata');
    }
    return {
      collectionId: normalized.collectionId,
      collectionTitle: normalized.collectionTitle,
      discoveryConnections: connectionTags
    };
  });
}

export function selectFeaturedCollection(collections) {
  const sorted = [...(Array.isArray(collections) ? collections : [])]
    .map((item) => normalizeCollectionMetadata(item))
    .sort((a, b) => b.collectionPriority - a.collectionPriority || a.collectionTitle.localeCompare(b.collectionTitle));
  return sorted[0] || null;
}

export {
  COLLECTIONS_STORAGE_KEY
};
