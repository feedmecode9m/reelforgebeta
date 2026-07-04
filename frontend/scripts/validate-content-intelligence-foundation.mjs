#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  SERIES_METADATA_FIELDS,
  EPISODE_METADATA_FIELDS,
  RIGHTS_METADATA_FIELDS,
  validateContentIntelligencePayload
} from '../src/lib/content/contentIntelligenceModels.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const REPORT_PATH = join(ROOT, 'content-intelligence-report.json');
const STUDIO_EXPERIENCE_PATH = join(ROOT, 'frontend', 'src', 'components', 'experiences', 'StudioExperience.svelte');

const seriesSample = {
  seriesId: 'series-neon-vengeance',
  title: 'Neon Vengeance',
  subtitle: 'The city that betrayed him will remember his name.',
  creator: 'Studio Creator',
  productionCompany: 'ReelForge Studios',
  genre: 'Thriller',
  subgenre: 'Neo-noir',
  releaseYear: '2026',
  country: 'US',
  language: 'English',
  rating: 'TV-14',
  tags: ['neon', 'revenge'],
  keywords: ['cyberpunk', 'vigilante'],
  communityRepresented: 'Urban youth creators',
  educationalThemes: 'Digital ethics',
  historicalSignificance: 'Independent creator storytelling wave',
  coverArt: '/thumbs/IMG_0113.JPEG',
  trailer: '/videos/hero-background.mp4',
  rightsStatus: 'cleared'
};

const episodeSample = {
  episodeId: 'ep-001',
  seriesId: 'series-neon-vengeance',
  episodeNumber: '1',
  episodeTitle: 'Ghost Signal',
  description: 'A launch episode introducing the conflict.',
  runtime: '1800',
  thumbnail: '/thumbs/IMG_0113.JPEG',
  releaseDate: '2026-06-17',
  location: 'Los Angeles',
  featuredPeople: ['Lead Actor'],
  keywords: ['betrayal', 'signal'],
  topics: ['identity', 'memory'],
  callToAction: 'Watch now',
  language: 'English',
  captions: 'en-US'
};

const rightsSample = {
  copyrightOwner: 'ReelForge Studios',
  musicRightsConfirmed: true,
  talentReleasesConfirmed: true,
  locationReleasesConfirmed: true,
  distributionRights: 'global streaming',
  expirationDate: '2030-12-31'
};

const payloadValidation = validateContentIntelligencePayload({
  series: seriesSample,
  episode: episodeSample,
  rights: rightsSample
});

const studioExperienceSource = readFileSync(STUDIO_EXPERIENCE_PATH, 'utf8');
const assetsIndex = studioExperienceSource.indexOf('data-content-panel="assets"');
const intelligenceIndex = studioExperienceSource.indexOf('<ContentIntelligencePanel />');
const collectionsIndex = studioExperienceSource.indexOf('data-content-panel="collections"');

const panelPlacementValid =
  assetsIndex >= 0 &&
  intelligenceIndex >= 0 &&
  collectionsIndex >= 0 &&
  assetsIndex < intelligenceIndex &&
  intelligenceIndex < collectionsIndex;

const report = {
  phase: 'PHASE 71 — CONTENT INTELLIGENCE FOUNDATION',
  generatedAt: new Date().toISOString(),
  models: {
    seriesMetadataFields: SERIES_METADATA_FIELDS,
    episodeMetadataFields: EPISODE_METADATA_FIELDS,
    rightsMetadataFields: RIGHTS_METADATA_FIELDS
  },
  validation: {
    seriesModelValid: payloadValidation.seriesValidation.valid,
    episodeModelValid: payloadValidation.episodeValidation.valid,
    rightsModelValid: payloadValidation.rightsValidation.valid,
    missingSeriesFields: payloadValidation.seriesValidation.missingFields,
    missingEpisodeFields: payloadValidation.episodeValidation.missingFields,
    missingRightsFields: payloadValidation.rightsValidation.missingFields
  },
  studioPlacement: {
    panel: 'Content Intelligence',
    location: 'Smart Production Studio',
    between: ['Assets', 'Collections'],
    placementValid: panelPlacementValid
  },
  adminOnly: true,
  completionToken:
    payloadValidation.valid && panelPlacementValid
      ? 'CONTENT_INTELLIGENCE_FOUNDATION_COMPLETE=true'
      : 'CONTENT_INTELLIGENCE_FOUNDATION_COMPLETE=false'
};

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(report.completionToken);
