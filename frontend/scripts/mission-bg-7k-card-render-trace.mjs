#!/usr/bin/env node
/**
 * BG-7K — capture feed card render pipeline logs.
 * Usage:
 *   FRONTEND_URL=http://127.0.0.1:5173/ OUT=/tmp/bg-7k-local.json node scripts/mission-bg-7k-card-render-trace.mjs
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:5173/';
const OUT = process.env.OUT || '/tmp/bg-7k-card-render-trace.json';
const WAIT_MS = Number(process.env.WAIT_MS || 15000);
const CHROMIUM =
  process.env.CHROMIUM ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const TAGS = [
  '[BG7K_CATALOG_RECEIVE]',
  '[BG7K_CARD_NORMALIZE]',
  '[BG7K_PLACEHOLDER_FALLBACK]',
  '[BG7K_CARD_RENDER]'
];

async function parseConsole(msg) {
  const parts = [];
  for (const arg of msg.args()) {
    try {
      parts.push(await arg.jsonValue());
    } catch {
      parts.push(arg.toString());
    }
  }
  const payload = parts.find((p) => p && typeof p === 'object' && !Array.isArray(p)) || null;
  const tag = TAGS.find((t) => msg.text().includes(t)) || null;
  return { tag, payload, text: msg.text(), wallMs: Date.now() };
}

function stageName(entry) {
  if (entry.tag === '[BG7K_CATALOG_RECEIVE]') return 'catalog_receive';
  if (entry.tag === '[BG7K_CARD_NORMALIZE]') return 'card_normalize';
  if (entry.tag === '[BG7K_PLACEHOLDER_FALLBACK]') return 'placeholder_fallback';
  if (entry.tag === '[BG7K_CARD_RENDER]') return 'card_render';
  return 'unknown';
}

async function fetchApiReels(baseUrl) {
  try {
    const origin = new URL(baseUrl).origin;
    const res = await fetch(`${origin}/api/reels?t=${Date.now()}`);
    if (!res.ok) return { ok: false, status: res.status, count: 0, sample: [] };
    const raw = await res.json();
    const arr = Array.isArray(raw) ? raw : [];
    return {
      ok: true,
      status: res.status,
      count: arr.length,
      sample: arr.slice(0, 3).map((r) => ({
        id: r?.id,
        url: r?.url || r?.video_url || r?.videoUrl || '',
        thumbnail: r?.thumbnailUrl || r?.thumbnail_url || '',
        category: r?.category,
        status: r?.status
      }))
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), count: 0, sample: [] };
  }
}

async function run() {
  const events = [];
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(CHROMIUM) ? CHROMIUM : undefined
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', async (msg) => {
    const text = msg.text();
    if (!TAGS.some((t) => text.includes(t))) return;
    events.push(await parseConsole(msg));
  });

  const apiReels = await fetchApiReels(FRONTEND_URL);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('.reel-card, .forge-loader', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(WAIT_MS);

  const domSnapshot = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.reel-card')].slice(0, 12);
    return cards.map((card) => {
      const id = card.getAttribute('data-reel-id') || '';
      const video = card.querySelector('video');
      const img = card.querySelector('img.card-visual, img[data-media-renderer]');
      const empty = card.querySelector('.vault-card-empty');
      const isGhost = card.classList.contains('is-ghost');
      return {
        id,
        isGhost,
        videoSrc: video?.currentSrc || video?.src || null,
        imgSrc: img?.src || null,
        empty: Boolean(empty),
        placeholderSvg: Boolean(img?.src?.includes('media-fallback') || img?.src?.includes('data:image/svg'))
      };
    });
  });

  await browser.close();

  const catalog = events.filter((e) => e.tag === '[BG7K_CATALOG_RECEIVE]');
  const normalize = events.filter((e) => e.tag === '[BG7K_CARD_NORMALIZE]');
  const fallback = events.filter((e) => e.tag === '[BG7K_PLACEHOLDER_FALLBACK]');
  const render = events.filter((e) => e.tag === '[BG7K_CARD_RENDER]');

  const report = {
    mission: 'BG-7K-CARD-RENDER-GATE-AUDIT',
    url: FRONTEND_URL,
    capturedAt: new Date().toISOString(),
    apiReels,
    catalogReceive: catalog.map((e) => e.payload),
    normalizeSample: normalize.slice(0, 15).map((e) => e.payload),
    normalizeEmptyUrl: normalize.filter((e) => !e.payload?.normalizedUrl),
    placeholderFallbacks: fallback.map((e) => e.payload),
    cardRenders: render.map((e) => e.payload),
    domSnapshot,
    timeline: events.map((e) => ({ stage: stageName(e), ...e.payload, wallMs: e.wallMs }))
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        out: OUT,
        apiCount: apiReels.count,
        catalogEvents: catalog.length,
        normalizeEvents: normalize.length,
        emptyNormalize: report.normalizeEmptyUrl.length,
        fallbackEvents: fallback.length,
        renderEvents: render.length,
        domCards: domSnapshot.length,
        domPlaceholderSvg: domSnapshot.filter((c) => c.placeholderSvg).length,
        domEmpty: domSnapshot.filter((c) => c.empty).length,
        domGhost: domSnapshot.filter((c) => c.isGhost).length
      },
      null,
      2
    )
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
