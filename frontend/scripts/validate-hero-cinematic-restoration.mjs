#!/usr/bin/env node
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const REPORT_PATH = join(ROOT, 'hero-cinematic-restoration-report.json');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('[data-hero-intelligence]', { timeout: 20000 });
await page.waitForTimeout(1200);

const runtime = await page.evaluate(() => {
  const hero = document.querySelector('[data-hero-intelligence]');
  if (!hero) return { error: 'hero:not-found' };

  const heroRect = hero.getBoundingClientRect();
  const heroArea = Math.max(1, heroRect.width * heroRect.height);
  const viewportArea = (window.innerWidth || 1) * (window.innerHeight || 1);

  const selectors = [
    { component: 'Hero Video Asset Card', selector: '[data-hero-carousel-meta]' },
    { component: 'Cinematic Stage', selector: '[data-hero-split-layout]' },
    { component: 'Upcoming Events', selector: '[data-upcoming-events-module]' },
    { component: 'Featured Creator', selector: '[data-featured-creator-module]' }
  ];

  const overlapArea = (rect) => {
    const overlapW = Math.max(0, Math.min(rect.right, heroRect.right) - Math.max(rect.left, heroRect.left));
    const overlapH = Math.max(0, Math.min(rect.bottom, heroRect.bottom) - Math.max(rect.top, heroRect.top));
    return overlapW * overlapH;
  };

  const overlays = selectors.map((item) => {
    const el = hero.querySelector(item.selector);
    if (!el) {
      return {
        component: item.component,
        present: false
      };
    }
    const rect = el.getBoundingClientRect();
    const overlap = overlapArea(rect);
    return {
      component: item.component,
      present: true,
      widthPx: Number(rect.width.toFixed(3)),
      heightPx: Number(rect.height.toFixed(3)),
      widthPctOfHero: Number(((rect.width / heroRect.width) * 100).toFixed(3)),
      heightPctOfHero: Number(((rect.height / heroRect.height) * 100).toFixed(3)),
      overlayCoveragePct: Number(((overlap / heroArea) * 100).toFixed(3)),
      top: Number(rect.top.toFixed(3)),
      left: Number(rect.left.toFixed(3))
    };
  });

  const presentOverlays = overlays.filter((o) => o.present);
  const combinedOverlayCoveragePct = Number(
    presentOverlays.reduce((sum, row) => sum + row.overlayCoveragePct, 0).toFixed(3)
  );
  const largestOverlay = presentOverlays.reduce(
    (best, row) => (row.overlayCoveragePct > (best?.overlayCoveragePct || 0) ? row : best),
    null
  );

  const heroMedia =
    hero.querySelector('.hero-video, .hero-fallback-image, .hero-media') || null;
  const mediaVisible = Boolean(
    heroMedia &&
      getComputedStyle(heroMedia).display !== 'none' &&
      getComputedStyle(heroMedia).visibility !== 'hidden' &&
      Number(getComputedStyle(heroMedia).opacity) > 0
  );

  const heroCenterX = heroRect.left + heroRect.width / 2;
  const heroCenterY = heroRect.top + heroRect.height / 2;
  const heroCenterNode = document.elementFromPoint(heroCenterX, heroCenterY);
  const centerOwnedByHero = Boolean(heroCenterNode && hero.contains(heroCenterNode));

  const dimensionsOk = presentOverlays.every(
    (row) => row.widthPctOfHero <= 25 && row.heightPctOfHero <= 20
  );
  const coverageOk = combinedOverlayCoveragePct <= 30;

  const heroVisibilityScore = Math.max(
    0,
    Math.round(
      100 -
        combinedOverlayCoveragePct -
        (centerOwnedByHero ? 0 : 15) -
        (mediaVisible ? 0 : 25)
    )
  );

  return {
    hero: {
      widthPx: Number(heroRect.width.toFixed(3)),
      heightPx: Number(heroRect.height.toFixed(3)),
      viewportCoveragePct: Number(((heroArea / viewportArea) * 100).toFixed(3))
    },
    overlays,
    overlayMetrics: {
      combinedOverlayCoveragePct,
      largestOverlay,
      dimensionsOk,
      coverageOk
    },
    visibility: {
      mediaVisible,
      centerOwnedByHero,
      heroVisibilityScore
    }
  };
});

if (runtime.error) {
  await browser.close();
  throw new Error(runtime.error);
}

const complete =
  runtime.overlayMetrics.dimensionsOk &&
  runtime.overlayMetrics.coverageOk &&
  runtime.visibility.mediaVisible &&
  runtime.visibility.centerOwnedByHero;

writeFileSync(
  REPORT_PATH,
  `${JSON.stringify(
    {
      phase: 'PHASE 70.2B — HERO CINEMATIC RESTORATION',
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      viewportCoverage: runtime.hero.viewportCoveragePct,
      overlayCoverage: runtime.overlayMetrics.combinedOverlayCoveragePct,
      heroVisibilityScore: runtime.visibility.heroVisibilityScore,
      overlays: runtime.overlays,
      checks: {
        maxCombinedOverlayCoverage30Pct: runtime.overlayMetrics.coverageOk,
        maxIndividualOverlayWidth25Pct: runtime.overlayMetrics.dimensionsOk,
        maxIndividualOverlayHeight20Pct: runtime.overlayMetrics.dimensionsOk,
        heroMediaVisibleBehindOverlays: runtime.visibility.mediaVisible,
        heroCenterNotObstructed: runtime.visibility.centerOwnedByHero
      },
      completionToken: complete
        ? 'HERO_CINEMATIC_RESTORATION_COMPLETE=true'
        : 'HERO_CINEMATIC_RESTORATION_COMPLETE=false'
    },
    null,
    2
  )}\n`,
  'utf8'
);

await browser.close();
console.log(
  complete
    ? 'HERO_CINEMATIC_RESTORATION_COMPLETE=true'
    : 'HERO_CINEMATIC_RESTORATION_COMPLETE=false'
);
