#!/usr/bin/env node
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const VIEWPORT_REPORT = join(ROOT, 'hero-viewport-children.json');
const OBSTRUCTION_REPORT = join(ROOT, 'hero-obstruction-report.json');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('[data-hero-intelligence]', { timeout: 20000 });
await page.waitForTimeout(1200);

const runtime = await page.evaluate(() => {
  const hero = document.querySelector('[data-hero-intelligence]');
  if (!hero) {
    return {
      error: 'hero:not-found'
    };
  }

  const heroRect = hero.getBoundingClientRect();
  const heroArea = Math.max(1, heroRect.width * heroRect.height);
  const viewportW = window.innerWidth || 1;
  const viewportH = window.innerHeight || 1;
  const viewportArea = viewportW * viewportH;

  const normalizeRect = (rect) => ({
    top: Number(rect.top.toFixed(3)),
    left: Number(rect.left.toFixed(3)),
    width: Number(rect.width.toFixed(3)),
    height: Number(rect.height.toFixed(3)),
    right: Number(rect.right.toFixed(3)),
    bottom: Number(rect.bottom.toFixed(3))
  });

  const overlapAreaWithHero = (rect) => {
    const overlapW = Math.max(0, Math.min(rect.right, heroRect.right) - Math.max(rect.left, heroRect.left));
    const overlapH = Math.max(0, Math.min(rect.bottom, heroRect.bottom) - Math.max(rect.top, heroRect.top));
    return overlapW * overlapH;
  };

  const componentNameFor = (node) => {
    if (node.matches('[data-hero-carousel-meta]')) return 'Hero Video Asset Card';
    if (node.matches('[data-hero-split-layout]')) return 'Cinematic Stage Card';
    if (node.matches('[data-upcoming-events-module]')) return 'Upcoming Events Panel';
    if (node.matches('[data-featured-creator-module]')) return 'Featured Creator Panel';
    if (node.matches('[data-hero-command-center]')) return 'Hero Command Center';
    if (node.matches('[data-hero-carousel-timeline]')) return 'Hero Carousel Timeline';
    if (node.matches('[data-hero-carousel-actions]')) return 'Hero Action Group';
    return node.getAttribute('data-component') || node.className || node.tagName.toLowerCase();
  };

  const monitoredSelectors = [
    '[data-hero-carousel-meta]',
    '[data-hero-split-layout]',
    '[data-upcoming-events-module]',
    '[data-featured-creator-module]',
    '[data-hero-command-center]',
    '[data-hero-carousel-timeline]',
    '.hero-wrap',
    '.hero-video-overlay',
    '.hero-motion-gradient',
    '.hero-event-card'
  ];

  const seen = new Set();
  const childRows = [];
  for (const selector of monitoredSelectors) {
    for (const node of hero.querySelectorAll(selector)) {
      if (seen.has(node)) continue;
      seen.add(node);
      const rect = node.getBoundingClientRect();
      const area = Math.max(0, rect.width * rect.height);
      const overlap = overlapAreaWithHero(rect);
      const style = window.getComputedStyle(node);
      childRows.push({
        component: componentNameFor(node),
        selector,
        height: Number(rect.height.toFixed(3)),
        width: Number(rect.width.toFixed(3)),
        position: style.position,
        zIndex: style.zIndex === 'auto' ? 'auto' : Number(style.zIndex),
        overlayCoveragePct: Number(((overlap / heroArea) * 100).toFixed(3)),
        viewportCoveragePct: Number(((area / viewportArea) * 100).toFixed(3)),
        bounds: normalizeRect(rect)
      });
    }
  }

  const obstructionTargets = childRows.filter((row) =>
    [
      'Hero Video Asset Card',
      'Cinematic Stage Card',
      'Upcoming Events Panel',
      'Featured Creator Panel'
    ].includes(row.component)
  );

  const largest = obstructionTargets.reduce(
    (best, row) => (row.overlayCoveragePct > (best?.overlayCoveragePct || 0) ? row : best),
    null
  );
  const combined = obstructionTargets.reduce((sum, row) => sum + row.overlayCoveragePct, 0);

  return {
    hero: {
      bounds: normalizeRect(heroRect),
      viewportCoveragePct: Number(((heroArea / viewportArea) * 100).toFixed(3))
    },
    children: childRows,
    obstruction: {
      targets: obstructionTargets,
      totalObstructionPct: Number(combined.toFixed(3)),
      largestObstruction: largest
        ? {
            component: largest.component,
            overlayCoveragePct: largest.overlayCoveragePct,
            width: largest.width,
            height: largest.height
          }
        : null,
      combinedObstructionPct: Number(combined.toFixed(3))
    }
  };
});

if (runtime.error) {
  await browser.close();
  throw new Error(runtime.error);
}

writeFileSync(
  VIEWPORT_REPORT,
  `${JSON.stringify(
    {
      phase: 'PHASE 70.2B — HERO CINEMATIC RESTORATION',
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      hero: runtime.hero,
      HERO_VIEWPORT_CHILDREN: runtime.children
    },
    null,
    2
  )}\n`,
  'utf8'
);

writeFileSync(
  OBSTRUCTION_REPORT,
  `${JSON.stringify(
    {
      phase: 'PHASE 70.2B — HERO CINEMATIC RESTORATION',
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      obstructionTargets: runtime.obstruction.targets,
      totalObstructionPct: runtime.obstruction.totalObstructionPct,
      largestObstruction: runtime.obstruction.largestObstruction,
      combinedObstructionPct: runtime.obstruction.combinedObstructionPct
    },
    null,
    2
  )}\n`,
  'utf8'
);

await browser.close();
console.log('HERO_VIEWPORT_AUDIT_COMPLETE=true');
