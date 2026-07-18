#!/usr/bin/env node
/**
 * BG-7I — capture hydration / hero resolve console ordering.
 * Usage:
 *   FRONTEND_URL=http://127.0.0.1:5173/ node scripts/mission-bg-7i-hydration-trace.mjs
 *   FRONTEND_URL=http://127.0.0.1:4173/ OUT=/tmp/bg-7i-prod-build.json node scripts/mission-bg-7i-hydration-trace.mjs
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:5173/';
const OUT = process.env.OUT || '/tmp/bg-7i-hydration-trace-local.json';
const WAIT_MS = Number(process.env.WAIT_MS || 12000);
const CHROMIUM =
  process.env.CHROMIUM ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const TAGS = ['[BG7I_HYDRATION]', '[BG7I_HERO]'];

async function parseConsole(msg) {
  const parts = [];
  for (const arg of msg.args()) {
    try {
      parts.push(await arg.jsonValue());
    } catch {
      parts.push(arg.toString());
    }
  }
  const tag = parts.find((p) => typeof p === 'string' && TAGS.some((t) => p.startsWith(t)));
  const payload = parts.find((p) => p && typeof p === 'object' && !Array.isArray(p)) || null;
  return {
    tag: tag || null,
    payload,
    text: msg.text(),
    level: msg.type(),
    ts: new Date().toISOString(),
    wallMs: Date.now()
  };
}

function summarize(events) {
  const hydration = events.filter((e) => e.tag === '[BG7I_HYDRATION]' || e.text?.includes('[BG7I_HYDRATION]'));
  const hero = events.filter((e) => e.tag === '[BG7I_HERO]' || e.text?.includes('[BG7I_HERO]'));
  const firstHeroResolve = hero.find((e) => e.payload?.firstResolveHeroBackgroundAsset) || hero[0] || null;
  const hydrationComplete = hydration.find((e) => e.payload?.stage === 'hydration_complete') || null;
  const timeline = events.map((e) => ({
    tag: e.tag || (e.text?.includes('[BG7I_HERO]') ? '[BG7I_HERO]' : '[BG7I_HYDRATION]'),
    stage: e.payload?.stage || e.payload?.component || null,
    wallMs: e.wallMs,
    payload: e.payload
  }));
  return {
    hydrationCount: hydration.length,
    heroCount: hero.length,
    firstHeroResolve,
    hydrationComplete,
    timeline
  };
}

async function run() {
  const events = [];
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(CHROMIUM) ? CHROMIUM : undefined
  });
  const page = await browser.newPage();
  page.on('console', async (msg) => {
    const text = msg.text();
    if (!TAGS.some((t) => text.includes(t))) return;
    events.push(await parseConsole(msg));
  });

  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(WAIT_MS);

  const windowState = await page.evaluate(() => ({
    hydrationComplete: window.__BG7I_HYDRATION_COMPLETE === true,
    hydrationCompleteAt: window.__BG7I_HYDRATION_COMPLETE_AT || null,
    personalVideosCount: window.__BG7I_PERSONAL_VIDEOS_COUNT ?? null
  }));

  await browser.close();

  const report = {
    mission: 'BG-7I-HERO-HYDRATION-TRACE',
    url: FRONTEND_URL,
    capturedAt: new Date().toISOString(),
    waitMs: WAIT_MS,
    windowState,
    ...summarize(events),
    events
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out: OUT, ...summarize(events), windowState }, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
