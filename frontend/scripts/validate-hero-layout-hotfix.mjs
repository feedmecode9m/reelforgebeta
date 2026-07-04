#!/usr/bin/env node
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const REPORT_PATH = join(ROOT, 'hero-layout-hotfix-report.json');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('[data-hero-intelligence]', { timeout: 20000 });
await page.waitForTimeout(1200);

const runtime = await page.evaluate(() => {
  const round = (value) => Number(Number(value || 0).toFixed(3));
  const viewport = { width: window.innerWidth || 0, height: window.innerHeight || 0 };

  const hero = document.querySelector('[data-hero-intelligence]');
  const mediaContainer = document.querySelector('.hero-video-container');
  const mediaCandidates = mediaContainer
    ? Array.from(
        mediaContainer.querySelectorAll('video.hero-media, .hero-fallback-image.hero-media, .hero-media, video, img')
      )
    : [];
  const mediaNode = mediaCandidates.reduce((largest, candidate) => {
    const rect = candidate.getBoundingClientRect();
    const area = rect.width * rect.height;
    const largestRect = largest ? largest.getBoundingClientRect() : null;
    const largestArea = largestRect ? largestRect.width * largestRect.height : 0;
    return area > largestArea ? candidate : largest;
  }, null);
  const title = document.querySelector('[data-hero-title]');
  const cta = document.querySelector('[data-hero-watch-now]');

  const heroRect = hero?.getBoundingClientRect() || null;
  const containerRect = mediaContainer?.getBoundingClientRect() || null;
  const mediaRect = mediaNode?.getBoundingClientRect() || null;

  const heroStyle = hero ? getComputedStyle(hero) : null;
  const containerStyle = mediaContainer ? getComputedStyle(mediaContainer) : null;
  const mediaStyle = mediaNode ? getComputedStyle(mediaNode) : null;
  const titleStyle = title ? getComputedStyle(title) : null;
  const ctaStyle = cta ? getComputedStyle(cta) : null;

  const mediaCoverageWidth = heroRect && mediaRect ? round((mediaRect.width / Math.max(1, heroRect.width)) * 100) : 0;
  const mediaCoverageHeight = heroRect && mediaRect ? round((mediaRect.height / Math.max(1, heroRect.height)) * 100) : 0;
  const containerCoverageWidth = heroRect && containerRect ? round((containerRect.width / Math.max(1, heroRect.width)) * 100) : 0;
  const containerCoverageHeight = heroRect && containerRect ? round((containerRect.height / Math.max(1, heroRect.height)) * 100) : 0;

  const mediaFillPass =
    containerCoverageWidth >= 99.5 &&
    containerCoverageHeight >= 99.5 &&
    mediaCoverageWidth >= 99.5 &&
    mediaCoverageHeight >= 99.5;

  const mediaObjectFitPass =
    String(mediaStyle?.objectFit || '') === 'cover' ||
    String(mediaStyle?.backgroundSize || '') === 'cover';
  const mediaNodeSizedPass = String(mediaStyle?.width || '').includes('%') || round(mediaRect?.width) >= round(heroRect?.width);
  const typographyPass =
    parseFloat(titleStyle?.fontSize || '0') >= 48 &&
    parseFloat(ctaStyle?.fontSize || '0') >= 16 &&
    parseFloat(ctaStyle?.minHeight || '0') >= 52;

  const hotfixDiagnosticSeen = Boolean(
    window.__reelforgeHeroLayoutHotfixApplied ||
    false
  );

  return {
    viewport,
    hero: {
      widthPx: round(heroRect?.width),
      heightPx: round(heroRect?.height),
      widthCoveragePct: round(((heroRect?.width || 0) / Math.max(1, viewport.width)) * 100),
      heightCoveragePct: round(((heroRect?.height || 0) / Math.max(1, viewport.height)) * 100),
      display: heroStyle?.display || '',
      overflow: heroStyle?.overflow || ''
    },
    mediaContainer: {
      widthPx: round(containerRect?.width),
      heightPx: round(containerRect?.height),
      zIndex: containerStyle?.zIndex || '',
      position: containerStyle?.position || '',
      widthVsHeroPct: containerCoverageWidth,
      heightVsHeroPct: containerCoverageHeight
    },
    mediaNode: {
      widthPx: round(mediaRect?.width),
      heightPx: round(mediaRect?.height),
      objectFit: mediaStyle?.objectFit || '',
      zIndex: mediaStyle?.zIndex || '',
      position: mediaStyle?.position || '',
      widthVsHeroPct: mediaCoverageWidth,
      heightVsHeroPct: mediaCoverageHeight
    },
    typography: {
      heroTitleFontSizePx: round(parseFloat(titleStyle?.fontSize || '0')),
      heroTitleLineHeightPx: round(parseFloat(titleStyle?.lineHeight || '0')),
      ctaFontSizePx: round(parseFloat(ctaStyle?.fontSize || '0')),
      ctaMinHeightPx: round(parseFloat(ctaStyle?.minHeight || '0')),
      ctaPadding: ctaStyle?.padding || ''
    },
    checks: {
      mediaContainerFillsHero: mediaFillPass,
      mediaObjectFitCover: mediaObjectFitPass,
      mediaNoBlackSplitConstraint: mediaNodeSizedPass,
      typographyScaledAndLegible: typographyPass
    },
    diagnostics: {
      HERO_LAYOUT_HOTFIX_APPLIED_seen: hotfixDiagnosticSeen
    }
  };
});

const completion =
  runtime.checks.mediaContainerFillsHero &&
  runtime.checks.mediaObjectFitCover &&
  runtime.checks.mediaNoBlackSplitConstraint &&
  runtime.checks.typographyScaledAndLegible;

const report = {
  phase: 'REELFORGE PHASE 67.1',
  mode: 'SURGICAL HOTFIX',
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  ...runtime,
  completionToken: completion ? 'HERO_LAYOUT_HOTFIX_COMPLETE=true' : 'HERO_LAYOUT_HOTFIX_COMPLETE=false'
};

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await browser.close();
console.log(report.completionToken);
