#!/usr/bin/env node
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const REPORT_PATH = join(ROOT, 'guide-me-readability-report.json');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';

function extractBlurPx(value = '') {
  const match = String(value).match(/blur\(([\d.]+)px\)/i);
  return match ? Number(match[1]) : 0;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.addInitScript(() => {
  try {
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_admin_session_token', 'dev_local_session');
  } catch {
    /* ignore */
  }
});

await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('.ghost-trigger', { timeout: 30000 });
await page.dispatchEvent('.ghost-trigger', 'click');
if (!(await page.locator('.control-center-overlay').count())) {
  await page.click('.ghost-trigger', { force: true });
}
await page.waitForFunction(() => Boolean(document.querySelector('.control-center-overlay')), {
  timeout: 30000
});
await page.waitForFunction(() => Boolean(document.querySelector('[data-studio-guide-me]')), {
  timeout: 30000
});
await page.dispatchEvent('[data-studio-guide-me]', 'click');
await page.waitForSelector('[data-guide-me-coach-card]', { timeout: 30000 });
await page.waitForTimeout(300);

const runtime = await page.evaluate(() => {
  const mainEl = document.querySelector('main');
  const overlayEl = document.querySelector('.control-center-overlay');
  const studioHeader = document.querySelector('.control-center-header');
  const coachCard = document.querySelector('[data-guide-me-coach-card]');
  const coachText = coachCard?.querySelectorAll('h4, p') || [];
  const nextButton = coachCard?.querySelector('.studio-walkthrough__next');

  const mainStyle = mainEl ? getComputedStyle(mainEl) : null;
  const overlayStyle = overlayEl ? getComputedStyle(overlayEl) : null;
  const headerStyle = studioHeader ? getComputedStyle(studioHeader) : null;
  const cardStyle = coachCard ? getComputedStyle(coachCard) : null;

  const parsedText = Array.from(coachText).slice(0, 6).map((node) => {
    const style = getComputedStyle(node);
    return {
      tag: node.tagName.toLowerCase(),
      opacity: Number(style.opacity || '0'),
      filter: style.filter || 'none',
      color: style.color || '',
      lineHeight: style.lineHeight || ''
    };
  });

  const cardRect = coachCard?.getBoundingClientRect();
  const nextRect = nextButton?.getBoundingClientRect();
  const nextHitTarget =
    nextRect && nextRect.width > 0 && nextRect.height > 0
      ? document.elementFromPoint(nextRect.left + nextRect.width / 2, nextRect.top + nextRect.height / 2)
      : null;

  const bgColor = headerStyle?.backgroundColor || '';
  const alphaMatch = bgColor.match(/rgba?\(([^)]+)\)/i);
  let headerAlpha = 1;
  if (alphaMatch) {
    const parts = alphaMatch[1].split(',').map((part) => Number(part.trim()));
    if (parts.length === 4 && Number.isFinite(parts[3])) headerAlpha = parts[3];
  }

  const mainFilter = mainStyle?.filter || 'none';
  const overlayBackdrop = overlayStyle?.backdropFilter || 'none';
  const overlayWebkitBackdrop = overlayStyle?.webkitBackdropFilter || 'none';

  return {
    guideMeModeEnabled: document.documentElement.hasAttribute('data-guide-me-mode'),
    diagnostics: {
      guideMeBlurFixAppliedSeen: Boolean(window.__reelforgeGuideMeBlurFixApplied)
    },
    computed: {
      mainFilter,
      overlayBackdropFilter: overlayBackdrop,
      overlayWebkitBackdropFilter: overlayWebkitBackdrop,
      headerPosition: headerStyle?.position || '',
      headerBackgroundColor: bgColor,
      headerBackgroundAlpha: headerAlpha,
      containerGlowOpacity:
        getComputedStyle(document.querySelector('.control-center-container'), '::before')?.opacity || '',
      coachCardFilter: cardStyle?.filter || 'none',
      coachCardOpacity: Number(cardStyle?.opacity || '0'),
      coachCardOverflow: cardStyle?.overflow || '',
      coachCardRect: cardRect
        ? {
            top: Number(cardRect.top.toFixed(3)),
            left: Number(cardRect.left.toFixed(3)),
            width: Number(cardRect.width.toFixed(3)),
            height: Number(cardRect.height.toFixed(3)),
            bottom: Number(cardRect.bottom.toFixed(3))
          }
        : null,
      sampledText: parsedText
    },
    interactions: {
      nextButtonClickable: Boolean(
        nextButton &&
          nextHitTarget &&
          (nextHitTarget === nextButton || nextButton.contains(nextHitTarget))
      )
    }
  };
});

const mainBlurPx = extractBlurPx(runtime.computed.mainFilter);
const overlayBlurPx = Math.max(
  extractBlurPx(runtime.computed.overlayBackdropFilter),
  extractBlurPx(runtime.computed.overlayWebkitBackdropFilter)
);
const textReadable = runtime.computed.sampledText.every(
  (entry) => entry.opacity >= 0.95 && extractBlurPx(entry.filter) <= 0.1
);
const cardInsideViewport =
  runtime.computed.coachCardRect &&
  runtime.computed.coachCardRect.top >= 0 &&
  runtime.computed.coachCardRect.bottom <= 900;

const checks = {
  mainBlurRemoved: mainBlurPx <= 0.1,
  overlayBackdropBlurAdjusted: overlayBlurPx <= 0.1,
  headerBleedFixed:
    runtime.computed.headerPosition !== 'absolute' && runtime.computed.headerBackgroundAlpha >= 0.9,
  containerGlowNeutralized: Number(runtime.computed.containerGlowOpacity || '1') <= 0.05,
  textReadableNoClipping:
    Boolean(cardInsideViewport) &&
    runtime.computed.coachCardOpacity >= 0.99 &&
    extractBlurPx(runtime.computed.coachCardFilter) <= 0.1 &&
    textReadable,
  controlsClickable: runtime.interactions.nextButtonClickable
};

const completion = Object.values(checks).every(Boolean);

const report = {
  phase: 'REELFORGE PHASE 67.2',
  mode: 'SURGICAL HOTFIX',
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  ...runtime,
  checks,
  completionToken: completion
    ? 'GUIDE_ME_READABILITY_COMPLETE=true'
    : 'GUIDE_ME_READABILITY_COMPLETE=false'
};

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await browser.close();
console.log(report.completionToken);
