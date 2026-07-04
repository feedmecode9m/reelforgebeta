#!/usr/bin/env node
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const REPORT_PATH = join(ROOT, 'hero-ui-leak-report.json');

const definitions = [
  {
    textPattern: 'Hero Video Active',
    sourceVariable: "activeHeroSlide?.type === 'video'",
    component: 'HeroExperience',
    purpose: 'Runtime media-status indicator in hero meta pill',
    classification: 'ADMIN_ONLY'
  },
  {
    textPattern: 'Hero Image Active',
    sourceVariable: "activeHeroSlide?.type !== 'video'",
    component: 'HeroExperience',
    purpose: 'Runtime media-status indicator in hero meta pill',
    classification: 'ADMIN_ONLY'
  },
  {
    textPattern: 'Cinematic Stage',
    sourceVariable: "activeHeroSlide?.type === 'video' && activeHeroSlide?.imageUrl && activeHeroSlide?.videoUrl",
    component: 'HeroExperience',
    purpose: 'Technical dual-media mode label',
    classification: 'ADMIN_ONLY'
  },
  {
    textPattern: 'Image + Video',
    sourceVariable: 'static string in hero-split-layout',
    component: 'HeroExperience',
    purpose: 'Media type disclosure',
    classification: 'ADMIN_ONLY'
  },
  {
    textPattern: 'Upcoming Events',
    sourceVariable: 'eventsRegistry',
    component: 'HeroExperience',
    purpose: 'Viewer-facing content navigation',
    classification: 'VIEWER_SAFE'
  },
  {
    textPattern: 'Follow',
    sourceVariable: 'followedCreatorIds',
    component: 'HeroExperience',
    purpose: 'Viewer-facing creator engagement action',
    classification: 'VIEWER_SAFE'
  },
  {
    textPattern: 'Continue Watching',
    sourceVariable: 'hero carousel action controls',
    component: 'HeroExperience',
    purpose: 'Viewer-facing playback action',
    classification: 'VIEWER_SAFE'
  },
  {
    textPattern: 'Watch Now',
    sourceVariable: 'hero carousel action controls',
    component: 'HeroExperience',
    purpose: 'Viewer-facing playback action',
    classification: 'VIEWER_SAFE'
  },
  {
    textPattern: 'Manage in Vault',
    sourceVariable: 'openHeroVaultManager() action button',
    component: 'HeroExperience',
    purpose: 'Navigation to administrative vault controls',
    classification: 'ADMIN_ONLY'
  },
  {
    textPattern: 'Current Series',
    sourceVariable: 'brief.primary.seriesTitle',
    component: 'HeroCommandCenter',
    purpose: 'Studio/production briefing header',
    classification: 'ADMIN_ONLY'
  },
  {
    textPattern: 'Production Readiness',
    sourceVariable: 'brief.primary.readinessPercent',
    component: 'HeroCommandCenter',
    purpose: 'Operational production metric',
    classification: 'ADMIN_ONLY'
  },
  {
    textPattern: 'Biggest Blocker',
    sourceVariable: 'brief.primary.biggestBlocker',
    component: 'HeroCommandCenter',
    purpose: 'Operational blocker telemetry',
    classification: 'ADMIN_ONLY'
  }
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('[data-hero-intelligence]', { timeout: 20000 });
await page.waitForTimeout(1200);

const visibleText = await page.evaluate(() => {
  const hero = document.querySelector('[data-hero-intelligence]');
  const command = document.querySelector('[data-hero-command-center]');
  const containers = [hero, command].filter(Boolean);
  const isVisible = (el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity || '1') > 0 &&
      rect.width > 0 &&
      rect.height > 0
    );
  };
  const textRows = [];
  for (const root of containers) {
    for (const node of root.querySelectorAll('*')) {
      if (!isVisible(node)) continue;
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      textRows.push(text);
    }
  }
  return Array.from(new Set(textRows));
});

const findings = definitions.map((def) => ({
  ...def,
  visible: visibleText.some((line) => line.includes(def.textPattern))
}));

const summary = {
  viewerSafeVisible: findings.filter((f) => f.visible && f.classification === 'VIEWER_SAFE').length,
  adminOnlyVisible: findings.filter((f) => f.visible && f.classification === 'ADMIN_ONLY').length,
  debugOnlyVisible: findings.filter((f) => f.visible && f.classification === 'DEBUG_ONLY').length
};

writeFileSync(
  REPORT_PATH,
  `${JSON.stringify(
    {
      phase: 'PHASE 70.3 — HERO EXPERIENCE SANITIZATION',
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      findings,
      summary
    },
    null,
    2
  )}\n`,
  'utf8'
);

await browser.close();
console.log('HERO_UI_LEAK_AUDIT_COMPLETE=true');
