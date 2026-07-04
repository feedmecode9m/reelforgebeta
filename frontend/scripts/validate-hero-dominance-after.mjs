#!/usr/bin/env node
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const REPORT_PATH = join(ROOT, 'hero-dominance-after.json');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';

const report = {
  phase: 'PHASE 70.2 — PLATFORM TRUTH LOCK',
  generatedAt: new Date().toISOString(),
  measurementContext: {
    url: `${BASE_URL}/`,
    viewport: { width: 1440, height: 900 },
    role: 'normal_user'
  },
  hero: {},
  competingModules: [],
  movedBelowHeroChecks: {},
  keptInsideHeroChecks: {},
  requirements: {},
  completionToken: 'HERO_DOMINANCE_RESTORED=false'
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('[data-hero-intelligence]', { timeout: 20000 });
await page.waitForTimeout(1200);

const runtime = await page.evaluate(() => {
  const hero = document.querySelector('[data-hero-intelligence]');
  const viewportW = window.innerWidth || 1;
  const viewportH = window.innerHeight || 1;
  const heroRect = hero?.getBoundingClientRect();
  const heroBottom = heroRect ? heroRect.bottom : 0;
  const heroCenterX = heroRect ? heroRect.left + heroRect.width / 2 : 0;
  const heroCenterY = heroRect ? heroRect.top + heroRect.height / 2 : 0;
  const centerEl = document.elementFromPoint(heroCenterX, heroCenterY);
  const mediaEl =
    hero?.querySelector('.hero-video, .hero-fallback-image, [data-hero-carousel], video, img') || null;

  const commandCenter = document.querySelector('[data-hero-command-center]');
  const commandRect = commandCenter?.getBoundingClientRect() || null;
  const cardEls = [...document.querySelectorAll('[data-hero-secondary-card]')];
  const cardLabels = cardEls.map((card) =>
    (card.querySelector('.hero-command-center__card-label')?.textContent || '').trim().toLowerCase()
  );

  const movedTargets = {
    productionReadiness: Boolean(
      commandCenter?.textContent?.toLowerCase().includes('production readiness')
    ),
    currentSeries: Boolean(commandCenter?.textContent?.toLowerCase().includes('current series')),
    openTasks: cardLabels.some((label) => label.includes('open') && label.includes('task')),
    assetCoverage: cardLabels.some((label) => label.includes('asset')),
    notificationsMetrics: cardLabels.some((label) => label.includes('task') || label.includes('notification')),
    teamActivityMetrics: cardLabels.some((label) => label.includes('team'))
  };

  const moduleSelectors = [
    { name: 'Discovery Feed', selector: '.discovery-feed, [data-discovery-feed], [data-discovery-feed-panel]' },
    { name: 'Creator Profile', selector: '.creator-profile, [data-creator-profile]' },
    { name: 'Monetization Hub', selector: '.monetization-hub, [data-monetization-hub]' },
    { name: 'Hero Command Center', selector: '[data-hero-command-center]' }
  ];

  const competingModules = moduleSelectors
    .map((entry) => {
      const el = document.querySelector(entry.selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const area = Math.max(0, rect.width) * Math.max(0, rect.height);
      const overlapH = Math.max(0, Math.min(rect.bottom, heroRect?.bottom || 0) - Math.max(rect.top, heroRect?.top || 0));
      const overlapW = Math.max(0, Math.min(rect.right, heroRect?.right || 0) - Math.max(rect.left, heroRect?.left || 0));
      return {
        module: entry.name,
        top: rect.top,
        area,
        overlapsHero: overlapH > 0 && overlapW > 0
      };
    })
    .filter(Boolean);

  const insideHero = {
    featuredCreator: Boolean(hero?.querySelector('[data-featured-creator-module]')),
    upcomingEvents: Boolean(hero?.querySelector('[data-upcoming-events-module]')),
    continueWatching: Boolean(
      hero?.textContent?.toLowerCase().includes('continue watching') ||
      hero?.querySelector('[data-continue-watching]')
    ),
    watchNow: Boolean(
      hero?.textContent?.toLowerCase().includes('watch now') ||
      [...(hero?.querySelectorAll('button,a') || [])].some((node) =>
        (node.textContent || '').toLowerCase().includes('watch now')
      )
    )
  };

  return {
    hero: {
      heightPx: heroRect?.height || 0,
      widthPx: heroRect?.width || 0,
      viewportCoverage: Number((((heroRect?.height || 0) * (heroRect?.width || 0)) / (viewportH * viewportW)).toFixed(4)),
      heightCoverage: Number(((heroRect?.height || 0) / viewportH).toFixed(4)),
      widthCoverage: Number(((heroRect?.width || 0) / viewportW).toFixed(4)),
      overlayCount: hero ? hero.querySelectorAll('.hero-overlay, .hero-video-overlay, .hero-motion-gradient, .hero-carousel-meta, .hero-countdown-overlay').length : 0,
      competingModulesInViewport: competingModules.filter((m) => m.top < viewportH).length
    },
    competingModules,
    movedTargets,
    insideHero,
    checks: {
      heroVisibleWithoutScroll: Boolean(heroRect && heroRect.top < viewportH && heroRect.bottom > 0),
      heroMediaVisible: Boolean(mediaEl && getComputedStyle(mediaEl).display !== 'none' && getComputedStyle(mediaEl).visibility !== 'hidden'),
      heroCenterOwnedByHero: Boolean(hero && centerEl && hero.contains(centerEl)),
      commandCenterBelowHero: Boolean(commandRect && commandRect.top >= heroBottom - 1)
    }
  };
});

report.hero = runtime.hero;
report.competingModules = runtime.competingModules;
report.movedBelowHeroChecks = {
  ...runtime.movedTargets,
  commandCenterBelowHero: runtime.checks.commandCenterBelowHero
};
report.keptInsideHeroChecks = runtime.insideHero;
report.requirements = {
  heroVisibleWithoutScrolling: runtime.checks.heroVisibleWithoutScroll,
  heroVideoImageAlwaysVisible: runtime.checks.heroMediaVisible,
  heroCarouselNeverCovered: runtime.checks.heroCenterOwnedByHero
};

const movedChecksOk =
  Object.values(report.movedBelowHeroChecks).every(Boolean);
const insideChecksOk =
  report.keptInsideHeroChecks.featuredCreator &&
  report.keptInsideHeroChecks.upcomingEvents &&
  report.keptInsideHeroChecks.continueWatching &&
  report.keptInsideHeroChecks.watchNow;
const requirementsOk = Object.values(report.requirements).every(Boolean);

report.completionToken =
  movedChecksOk && insideChecksOk && requirementsOk
    ? 'HERO_DOMINANCE_RESTORED=true'
    : 'HERO_DOMINANCE_RESTORED=false';

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await browser.close();
console.log(report.completionToken);
