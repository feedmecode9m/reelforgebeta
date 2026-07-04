#!/usr/bin/env node
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const REPORT_PATH = join(ROOT, 'search-intelligence-report.json');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SEARCH_COMPONENT_PATH = join(
  ROOT,
  'frontend',
  'src',
  'components',
  'search',
  'GlobalSearchBar.svelte'
);

const seededDraft = {
  series: {
    seriesId: 'series-neon-vengeance',
    title: 'Black Farmers Legacy',
    subtitle: 'A multi-generational land story',
    creator: 'Studio Creator',
    productionCompany: 'ReelForge Studios',
    genre: 'Documentary',
    subgenre: 'Historical',
    releaseYear: '2026',
    country: 'US',
    language: 'English',
    rating: 'TV-14',
    tags: ['agriculture', 'heritage'],
    keywords: ['Food Justice', 'Land Ownership'],
    communityRepresented: 'Gullah Geechee',
    educationalThemes: 'Land Ownership',
    historicalSignificance: 'Rural land preservation',
    coverArt: '/thumbs/IMG_0113.JPEG',
    trailer: '/videos/hero-background.mp4',
    rightsStatus: 'cleared'
  },
  episode: {
    episodeId: 'ep-001',
    seriesId: 'series-neon-vengeance',
    episodeNumber: '1',
    episodeTitle: 'Black Farmers of Alabama',
    description: 'Families preserving farms and cultural memory.',
    runtime: '1800',
    thumbnail: '/thumbs/IMG_0113.JPEG',
    releaseDate: '2026-06-17',
    location: 'Alabama',
    featuredPeople: ['Asha Carter'],
    keywords: ['Food Justice', 'Land Ownership'],
    topics: ['Land Ownership', 'Food Justice'],
    callToAction: 'Watch Now',
    language: 'English',
    captions: 'en-US'
  }
};

const report = {
  phase: 'PHASE 72 — ADVANCED SEARCH ENGINE',
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  checks: {
    metadataQueriesReturnResults: false,
    priorityOrderingValid: false,
    userSeesSearchOnly: false,
    adminSeesSearchAnalytics: false
  },
  evidence: {},
  completionToken: 'ADVANCED_SEARCH_COMPLETE=false'
};

async function openStudioWithOptionalLogin(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.ghost-trigger', { timeout: 20000 });
  await page.click('.ghost-trigger');
  const passwordField = page.locator('.admin-login-panel input[type="password"]');
  if (await passwordField.count()) {
    await passwordField.fill('SMART_PRODUCTION');
    await page.click('.admin-login-panel .submit-btn');
  }
  await page.waitForSelector('[data-production-command-center]', { timeout: 20000 });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.addInitScript((draft) => {
  localStorage.setItem('reelforge_content_intelligence_draft', JSON.stringify(draft));
}, seededDraft);

await openStudioWithOptionalLogin(page, BASE_URL);
await page.waitForSelector('[data-global-search-open]', { timeout: 20000 });
await page.waitForTimeout(500);

const queryChecks = await page.evaluate(() => {
  const engine = window.__reelforgeGlobalSearchEngine;
  if (!engine) return { error: 'engine:not-found' };
  const queries = [
    'Black Farmers',
    'Alabama',
    'Gullah Geechee',
    'Land Ownership',
    'Food Justice'
  ];
  const results = {};
  for (const query of queries) {
    const response = engine.searchGlobalCommands(query, { limit: 5 });
    results[query] = {
      total: response.total,
      topTitle: response.results?.[0]?.title || '',
      topField: response.results?.[0]?.matchedField || ''
    };
  }
  return results;
});

if (queryChecks.error) {
  await browser.close();
  throw new Error(queryChecks.error);
}

report.evidence.queryChecks = queryChecks;
report.checks.metadataQueriesReturnResults = Object.values(queryChecks).every((row) => row.total > 0);
report.checks.priorityOrderingValid =
  queryChecks['Black Farmers']?.topField === 'title' &&
  ['episodeTitle', 'location'].includes(queryChecks['Alabama']?.topField) &&
  queryChecks['Gullah Geechee']?.topField === 'communityRepresented';

const pageAdmin = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await pageAdmin.addInitScript((draft) => {
  localStorage.setItem('reelforge_content_intelligence_draft', JSON.stringify(draft));
  localStorage.setItem('admin_mode', 'true');
}, seededDraft);
await openStudioWithOptionalLogin(pageAdmin, BASE_URL);
await pageAdmin.waitForSelector('[data-global-search-open]', { timeout: 20000 });
await pageAdmin.click('[data-global-search-open]');
await pageAdmin.waitForSelector('[data-global-search-panel]', { timeout: 6000 });
const adminAnalyticsVisible = await pageAdmin.locator('[data-global-search-analytics]').count();
report.checks.adminSeesSearchAnalytics = adminAnalyticsVisible > 0;

const componentSource = await page.evaluate(async (path) => {
  const resp = await fetch(`/src/components/search/GlobalSearchBar.svelte`);
  if (!resp.ok) return '';
  return await resp.text();
}, SEARCH_COMPONENT_PATH);
report.checks.userSeesSearchOnly =
  componentSource.includes('{#if adminMode}') &&
  componentSource.includes('data-global-search-analytics');

report.evidence.analyticsVisibility = {
  userGuardedByAdminFlag: report.checks.userSeesSearchOnly,
  adminAnalyticsVisible
};

const success = Object.values(report.checks).every(Boolean);
report.completionToken = success ? 'ADVANCED_SEARCH_COMPLETE=true' : 'ADVANCED_SEARCH_COMPLETE=false';

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await pageAdmin.close();
await browser.close();
console.log(report.completionToken);
