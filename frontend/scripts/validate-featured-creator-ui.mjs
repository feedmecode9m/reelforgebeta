#!/usr/bin/env node
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const REPORT_PATH = join(ROOT, 'featured-creator-ui-report.json');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';

const report = {
  phase: 'REELFORGE PHASE 69 — FEATURED CREATOR MODULE IMPLEMENTATION',
  generatedAt: new Date().toISOString(),
  checks: {
    creatorRegistryLoadsAndRenders: false,
    viewProfileEmitsDiagnostic: false,
    followEmitsDiagnostic: false
  },
  evidence: {},
  diagnostics: {
    render: [],
    profile: [],
    follow: []
  },
  completeToken: 'FEATURED_CREATOR_UI_COMPLETE=false'
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('console', (msg) => {
  const text = msg.text();
  if (text.includes('[FEATURED_CREATOR_RENDER]')) report.diagnostics.render.push(text);
  if (text.includes('[CREATOR_PROFILE_VIEW]')) report.diagnostics.profile.push(text);
  if (text.includes('[CREATOR_FOLLOW_ACTION]')) report.diagnostics.follow.push(text);
});

await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('[data-featured-creator-module]', { timeout: 15000 });
await page.waitForTimeout(1000);

const baseline = await page.evaluate(() => {
  const card = document.querySelector('[data-featured-creator-card]');
  const thumb = document.querySelector('[data-featured-creator-thumbnail]');
  return {
    hasCard: Boolean(card),
    creatorId: card?.getAttribute('data-creator-id') || '',
    hasThumbnail: Boolean(thumb)
  };
});
report.evidence.baseline = baseline;
report.checks.creatorRegistryLoadsAndRenders =
  baseline.hasCard && Boolean(baseline.creatorId) && baseline.hasThumbnail && report.diagnostics.render.length > 0;

const profileBtn = page.locator('[data-featured-creator-view-profile]').first();
if (await profileBtn.count()) {
  await profileBtn.click({ timeout: 3000 });
  await page.waitForTimeout(250);
}
report.checks.viewProfileEmitsDiagnostic = report.diagnostics.profile.length > 0;

const followBtn = page.locator('[data-featured-creator-follow]').first();
if (await followBtn.count()) {
  await followBtn.click({ timeout: 3000 });
  await page.waitForTimeout(250);
}
report.checks.followEmitsDiagnostic = report.diagnostics.follow.length > 0;

report.evidence.afterActions = await page.evaluate(() => ({
  profileViewed: Boolean(document.querySelector('[data-featured-creator-card] small')),
  followLabel: document.querySelector('[data-featured-creator-follow]')?.textContent?.trim() || ''
}));

const success = Object.values(report.checks).every(Boolean);
report.completeToken = success ? 'FEATURED_CREATOR_UI_COMPLETE=true' : 'FEATURED_CREATOR_UI_COMPLETE=false';

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await browser.close();
console.log(report.completeToken);
