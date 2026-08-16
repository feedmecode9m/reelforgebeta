#!/usr/bin/env node
/**
 * PHASE-THUMBNAIL-REPAIR-1 — local poster integrity for viewer cards.
 * Does not change ViewerSemanticCard / feed / Hero.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import fs from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPO = join(ROOT, '..');
const ARTIFACTS = join(ROOT, 'artifacts');
const REPORT = join(ARTIFACTS, 'PHASE-THUMBNAIL-REPAIR-1-REPORT.json');
const VIEWER = join(ARTIFACTS, 'PHASE-THUMBNAIL-REPAIR-1-VIEWER.json');

const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const failures = [];

function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

if (!existsSync(REPORT)) {
  console.error('FAIL — missing', REPORT);
  process.exit(1);
}

const report = JSON.parse(readFileSync(REPORT, 'utf8'));
assert(report.phase === 'PHASE-THUMBNAIL-REPAIR-1', 'repair report phase');
assert(Array.isArray(report.valid), 'valid bucket');
assert(Array.isArray(report.missing), 'missing bucket');
assert(Array.isArray(report.invalid_tiny), 'invalid/tiny bucket');
assert(Array.isArray(report.needs_regeneration) || Array.isArray(report.regenerated), 'regen bucket');

const launch = {
  headless: true,
  ...(fs.existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {})
};

const browser = await chromium.launch(launch);
const page = await browser.newPage();
const jpg = [];
page.on('response', (res) => {
  const u = res.url();
  if (/\/thumbs\//i.test(u) || /\.jpe?g(\?|$)/i.test(u) || /media-fallback/i.test(u)) {
    jpg.push({ url: u, status: res.status() });
  }
});
await page.goto(process.env.FRONTEND_URL || 'http://127.0.0.1:5173/', {
  waitUntil: 'domcontentloaded',
  timeout: 45000
});
try {
  await page.waitForSelector('[data-poster-url]', { timeout: 20000 });
} catch {
  failures.push('no viewer cards with data-poster-url');
}
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  const row = document.querySelector('[data-viewer-discovery-row] .row, .row');
  if (row) row.scrollLeft = row.scrollWidth;
  for (const img of document.querySelectorAll('[data-viewer-semantic-card] img')) {
    img.loading = 'eager';
    img.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    try {
      if (typeof img.decode === 'function') await img.decode();
    } catch {
      /* counted below */
    }
  }
});
await page.waitForTimeout(1500);

const snap = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-poster-url]')].map((el) => ({
    poster: el.getAttribute('data-poster-url') || '',
    assetId: el.getAttribute('data-asset-id') || '',
    title: (el.querySelector('[data-viewer-sem-title]') || {}).textContent?.trim() || ''
  }));
  const imgs = [...document.querySelectorAll('[data-viewer-semantic-card] img')].map((i) => {
    const cs = getComputedStyle(i);
    return {
      src: i.src,
      width: i.naturalWidth,
      height: i.naturalHeight,
      complete: i.complete,
      display: cs.display,
      opacity: cs.opacity,
      fallback: /media-fallback/i.test(i.src)
    };
  });
  return { cards, imgs };
});
await browser.close();

assert(snap.cards.length > 0, 'viewer has cards');
assert(
  snap.cards.every((c) => Boolean(c.poster)),
  'every card has data-poster-url'
);
assert(
  snap.imgs.every((i) => !i.fallback),
  'no media-fallback.svg from missing thumbs'
);
assert(
  snap.imgs.every((i) => i.display === 'block' && i.opacity !== '0'),
  'poster imgs visible'
);
assert(
  snap.imgs.every((i) => i.width > 0 && i.height > 0),
  'poster imgs decoded (naturalWidth>0)'
);
const thumb404 = jpg.filter((r) => r.status === 404 && /\/thumbs\//.test(r.url));
assert(thumb404.length === 0, `no 404 thumbs (${thumb404.map((r) => r.url).join(', ')})`);

writeFileSync(
  VIEWER,
  JSON.stringify(
    {
      phase: 'PHASE-THUMBNAIL-REPAIR-1',
      cardCount: snap.cards.length,
      emptyPoster: snap.cards.filter((c) => !c.poster).length,
      fallbackCount: snap.imgs.filter((i) => i.fallback).length,
      decoded: snap.imgs.filter((i) => i.width > 0).length,
      thumb404,
      cards: snap.cards,
      imgs: snap.imgs,
      repairVerdict: report.verdict,
      failures
    },
    null,
    2
  )
);

if (failures.length) {
  console.error('FAIL — PHASE-THUMBNAIL-REPAIR-1');
  for (const f of failures) console.error('  -', f);
  process.exit(1);
}

console.log('PASS — PHASE-THUMBNAIL-REPAIR-1');
console.log(`  catalog valid=${report.valid.length} missing=${report.missing.length} tiny=${report.invalid_tiny.length} unrepairable=${(report.unrepairable || []).length}`);
console.log(`  viewer cards=${snap.cards.length} decoded=${snap.imgs.filter((i) => i.width > 0).length}`);
