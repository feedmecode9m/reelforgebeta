const SERIES_STRING_FIELDS = [
  'seriesTitle',
  'seriesDescription',
  'seriesCoverImage',
  'seriesTrailer',
  'creatorName',
  'productionCompany',
  'genre',
  'releaseYear',
  'rating',
  'communityRepresented',
  'historicalSignificance'
];

const EPISODE_STRING_FIELDS = [
  'episodeNumber',
  'episodeTitle',
  'episodeDescription',
  'runtime',
  'releaseDate',
  'location',
  'language',
  'closedCaptions',
  'maturityRating'
];

const COMMUNITY_STRING_FIELDS = [
  'communityRepresented',
  'communityDescription',
  'culturalRegion',
  'historicalPeriod'
];

const EDUCATIONAL_STRING_FIELDS = [
  'recommendedAudience',
  'curriculumAlignment'
];

const RIGHTS_STRING_FIELDS = [
  'copyrightOwner',
  'rightsHolder',
  'licensingStatus',
  'licensingContact'
];

const DISCOVERY_ARRAY_FIELDS = [
  'mood',
  'topics',
  'audienceInterests',
  'searchKeywords',
  'sponsorshipCategories',
  'collectionCategories'
];

export const SERIES_METADATA_FIELDS = /** @type {const} */ ([
  ...SERIES_STRING_FIELDS,
  'tags',
  'educationalThemes'
]);

export const EPISODE_METADATA_FIELDS = /** @type {const} */ ([
  ...EPISODE_STRING_FIELDS,
  'featuredPeople',
  'keywords'
]);

export const COMMUNITY_METADATA_FIELDS = /** @type {const} */ ([
  ...COMMUNITY_STRING_FIELDS,
  'culturalTopics'
]);

export const EDUCATIONAL_METADATA_FIELDS = /** @type {const} */ ([
  'educationalThemes',
  'learningObjectives',
  'discussionQuestions',
  ...EDUCATIONAL_STRING_FIELDS
]);

export const RIGHTS_METADATA_FIELDS = /** @type {const} */ ([
  ...RIGHTS_STRING_FIELDS,
  'musicRightsCleared',
  'talentReleasesObtained',
  'locationReleasesObtained'
]);

export const DISCOVERY_METADATA_FIELDS = /** @type {const} */ ([
  ...DISCOVERY_ARRAY_FIELDS
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

function normalizeBoolean(value) {
  return value === true;
}

function missingStringFields(model, fields) {
  return fields.filter((field) => normalizeString(model?.[field]).length === 0);
}

function hasNonEmptyArray(value) {
  return Array.isArray(value) && value.some((item) => normalizeString(item).length > 0);
}

/**
 * @returns {Record<string, unknown>}
 */
export function createEmptySeriesMetadata() {
  return {
    seriesTitle: '',
    seriesDescription: '',
    seriesCoverImage: '',
    seriesTrailer: '',
    creatorName: '',
    productionCompany: '',
    genre: '',
    releaseYear: '',
    rating: '',
    tags: [],
    communityRepresented: '',
    historicalSignificance: '',
    educationalThemes: []
  };
}

/**
 * @returns {Record<string, unknown>}
 */
export function createEmptyEpisodeMetadata() {
  return {
    episodeNumber: '',
    episodeTitle: '',
    episodeDescription: '',
    runtime: '',
    releaseDate: '',
    location: '',
    featuredPeople: [],
    keywords: [],
    language: '',
    closedCaptions: '',
    maturityRating: ''
  };
}

/**
 * @returns {Record<string, unknown>}
 */
export function createEmptyCommunityMetadata() {
  return {
    communityRepresented: '',
    communityDescription: '',
    culturalRegion: '',
    historicalPeriod: '',
    culturalTopics: []
  };
}

/**
 * @returns {Record<string, unknown>}
 */
export function createEmptyEducationalMetadata() {
  return {
    educationalThemes: [],
    learningObjectives: [],
    discussionQuestions: [],
    recommendedAudience: '',
    curriculumAlignment: ''
  };
}

/**
 * @returns {Record<string, unknown>}
 */
export function createEmptyRightsMetadata() {
  return {
    copyrightOwner: '',
    rightsHolder: '',
    musicRightsCleared: false,
    talentReleasesObtained: false,
    locationReleasesObtained: false,
    licensingStatus: '',
    licensingContact: ''
  };
}

/**
 * @returns {Record<string, unknown>}
 */
export function createEmptyDiscoveryMetadata() {
  return {
    mood: [],
    topics: [],
    audienceInterests: [],
    searchKeywords: [],
    sponsorshipCategories: [],
    collectionCategories: []
  };
}

/**
 * @param {Record<string, unknown>} model
 */
export function validateSeriesMetadataModel(model) {
  const normalized = {
    ...createEmptySeriesMetadata(),
    ...model,
    tags: normalizeStringArray(model?.tags),
    educationalThemes: normalizeStringArray(model?.educationalThemes)
  };
  const missing = [
    ...missingStringFields(normalized, SERIES_STRING_FIELDS),
    ...(hasNonEmptyArray(normalized.tags) ? [] : ['tags']),
    ...(hasNonEmptyArray(normalized.educationalThemes) ? [] : ['educationalThemes'])
  ];
  return {
    valid: missing.length === 0,
    missingFields: missing,
    normalized
  };
}

/**
 * @param {Record<string, unknown>} model
 */
export function validateEpisodeMetadataModel(model) {
  const normalized = {
    ...createEmptyEpisodeMetadata(),
    ...model,
    featuredPeople: normalizeStringArray(model?.featuredPeople),
    keywords: normalizeStringArray(model?.keywords)
  };
  const missing = [
    ...missingStringFields(normalized, EPISODE_STRING_FIELDS),
    ...(hasNonEmptyArray(normalized.featuredPeople) ? [] : ['featuredPeople']),
    ...(hasNonEmptyArray(normalized.keywords) ? [] : ['keywords'])
  ];
  return {
    valid: missing.length === 0,
    missingFields: missing,
    normalized
  };
}

/**
 * @param {Record<string, unknown>} model
 */
export function validateCommunityMetadataModel(model) {
  const normalized = {
    ...createEmptyCommunityMetadata(),
    ...model,
    culturalTopics: normalizeStringArray(model?.culturalTopics)
  };
  const missing = [
    ...missingStringFields(normalized, COMMUNITY_STRING_FIELDS),
    ...(hasNonEmptyArray(normalized.culturalTopics) ? [] : ['culturalTopics'])
  ];
  return {
    valid: missing.length === 0,
    missingFields: missing,
    normalized
  };
}

/**
 * @param {Record<string, unknown>} model
 */
export function validateEducationalMetadataModel(model) {
  const normalized = {
    ...createEmptyEducationalMetadata(),
    ...model,
    educationalThemes: normalizeStringArray(model?.educationalThemes),
    learningObjectives: normalizeStringArray(model?.learningObjectives),
    discussionQuestions: normalizeStringArray(model?.discussionQuestions)
  };
  const missing = [
    ...missingStringFields(normalized, EDUCATIONAL_STRING_FIELDS),
    ...(hasNonEmptyArray(normalized.educationalThemes) ? [] : ['educationalThemes']),
    ...(hasNonEmptyArray(normalized.learningObjectives) ? [] : ['learningObjectives']),
    ...(hasNonEmptyArray(normalized.discussionQuestions) ? [] : ['discussionQuestions'])
  ];
  return {
    valid: missing.length === 0,
    missingFields: missing,
    normalized
  };
}

/**
 * @param {Record<string, unknown>} model
 */
export function validateRightsMetadataModel(model) {
  const normalized = {
    ...createEmptyRightsMetadata(),
    ...model,
    musicRightsCleared: normalizeBoolean(model?.musicRightsCleared),
    talentReleasesObtained: normalizeBoolean(model?.talentReleasesObtained),
    locationReleasesObtained: normalizeBoolean(model?.locationReleasesObtained)
  };
  const missing = [
    ...missingStringFields(normalized, RIGHTS_STRING_FIELDS),
    ...(normalized.musicRightsCleared ? [] : ['musicRightsCleared']),
    ...(normalized.talentReleasesObtained ? [] : ['talentReleasesObtained']),
    ...(normalized.locationReleasesObtained ? [] : ['locationReleasesObtained'])
  ];
  return {
    valid: missing.length === 0,
    missingFields: missing,
    normalized
  };
}

/**
 * @param {Record<string, unknown>} model
 */
export function validateDiscoveryMetadataModel(model) {
  const normalized = {
    ...createEmptyDiscoveryMetadata(),
    ...model,
    mood: normalizeStringArray(model?.mood),
    topics: normalizeStringArray(model?.topics),
    audienceInterests: normalizeStringArray(model?.audienceInterests),
    searchKeywords: normalizeStringArray(model?.searchKeywords),
    sponsorshipCategories: normalizeStringArray(model?.sponsorshipCategories),
    collectionCategories: normalizeStringArray(model?.collectionCategories)
  };
  const missing = [
    ...(hasNonEmptyArray(normalized.mood) ? [] : ['mood']),
    ...(hasNonEmptyArray(normalized.topics) ? [] : ['topics']),
    ...(hasNonEmptyArray(normalized.audienceInterests) ? [] : ['audienceInterests']),
    ...(hasNonEmptyArray(normalized.searchKeywords) ? [] : ['searchKeywords']),
    ...(hasNonEmptyArray(normalized.sponsorshipCategories) ? [] : ['sponsorshipCategories']),
    ...(hasNonEmptyArray(normalized.collectionCategories) ? [] : ['collectionCategories'])
  ];
  return {
    valid: missing.length === 0,
    missingFields: missing,
    normalized
  };
}

/**
 * @param {{
 *   series: Record<string, unknown>;
 *   episode: Record<string, unknown>;
 *   community: Record<string, unknown>;
 *   educational: Record<string, unknown>;
 *   rights: Record<string, unknown>;
 *   discovery: Record<string, unknown>;
 * }} payload
 */
export function validateContentIntelligencePayload(payload) {
  const seriesValidation = validateSeriesMetadataModel(payload?.series || {});
  const episodeValidation = validateEpisodeMetadataModel(payload?.episode || {});
  const communityValidation = validateCommunityMetadataModel(payload?.community || {});
  const educationalValidation = validateEducationalMetadataModel(payload?.educational || {});
  const rightsValidation = validateRightsMetadataModel(payload?.rights || {});
  const discoveryValidation = validateDiscoveryMetadataModel(payload?.discovery || {});
  return {
    valid:
      seriesValidation.valid &&
      episodeValidation.valid &&
      communityValidation.valid &&
      educationalValidation.valid &&
      rightsValidation.valid &&
      discoveryValidation.valid,
    seriesValidation,
    episodeValidation,
    communityValidation,
    educationalValidation,
    rightsValidation,
    discoveryValidation
  };
}
