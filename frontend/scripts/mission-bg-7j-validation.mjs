#!/usr/bin/env node
/** BG-7J validation — capture gate ordering on fresh session. */
import fs from 'node:fs';
import { chromium } from 'playwright';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:4173/';
const OUT = process.env.OUT || '/tmp/bg-7j-validation.json';
const WAIT_MS = Number(process.env.WAIT_MS || 12000);
const CHROMIUM =
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const TAGS = ['[BG7J_HERO_GATE]', '[BG7J_HYDRATION_READY]', '[BG7J_HERO_RESTORE]', '[HERO_CLASSIFY]'];

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
  await browser.close();

  const gate = events.filter((e) => e.text.includes('[BG7J_HERO_GATE]'));
  const ready = events.find((e) => e.text.includes('[BG7J_HYDRATION_READY]'));
  const firstClassify = events.find((e) => e.text.includes('[HERO_CLASSIFY]'));
  const report = {
    url: FRONTEND_URL,
    gateEvents: gate.map((e) => e.payload),
    hydrationReady: ready?.payload || null,
    firstHeroClassify: firstClassify?.payload || null,
    orderOk:
      gate.some((e) => e.payload?.action === 'waiting') &&
      ready?.payload?.ready === true &&
      gate.some((e) => e.payload?.action === 'resolved') &&
      (!firstClassify ||
        (ready && firstClassify && firstClassify.wallMs >= ready.wallMs))
  };
  fs.writeFileSync(OUT, JSON.stringify({ report, events }, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
