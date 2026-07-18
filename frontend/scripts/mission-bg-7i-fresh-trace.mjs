#!/usr/bin/env node
/** BG-7I fresh-session trace (cleared localStorage). */
import fs from 'node:fs';
import { chromium } from 'playwright';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:4173/';
const OUT = process.env.OUT || '/tmp/bg-7i-hydration-trace-fresh.json';
const WAIT_MS = Number(process.env.WAIT_MS || 12000);
const CHROMIUM =
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
  const payload = parts.find((p) => p && typeof p === 'object' && !Array.isArray(p)) || null;
  return { payload, text: msg.text(), wallMs: Date.now() };
}

async function run() {
  const events = [];
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(CHROMIUM) ? CHROMIUM : undefined
  });
  const context = await browser.newContext();
  await context.clearCookies();
  const page = await context.newPage();
  page.on('console', async (msg) => {
    const text = msg.text();
    if (!TAGS.some((t) => text.includes(t))) return;
    events.push(await parseConsole(msg));
  });
  await page.addInitScript(() => localStorage.clear());
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(WAIT_MS);
  const windowState = await page.evaluate(() => ({
    hydrationComplete: window.__BG7I_HYDRATION_COMPLETE === true,
    personalVideosCount: window.__BG7I_PERSONAL_VIDEOS_COUNT ?? null,
    heroReel: localStorage.getItem('reelforge_hero_reel'),
    heroManager: localStorage.getItem('reelforge_hero_manager_config'),
    vaultCount: JSON.parse(localStorage.getItem('personal_video_vault') || '[]').length
  }));
  await browser.close();
  const firstHero = events.find((e) => e.payload?.firstResolveHeroBackgroundAsset) || events.find((e) => e.payload?.component === 'resolveHeroBackgroundAsset');
  const hydrationComplete = events.find((e) => e.payload?.stage === 'hydration_complete');
  const fetchResponse = events.find((e) => e.payload?.stage === 'fetch_reels_response');
  fs.writeFileSync(
    OUT,
    JSON.stringify({ url: FRONTEND_URL, windowState, firstHero, fetchResponse, hydrationComplete, events }, null, 2)
  );
  console.log(JSON.stringify({ out: OUT, windowState, firstHero: firstHero?.payload, fetchResponse: fetchResponse?.payload, hydrationComplete: hydrationComplete?.payload }, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
