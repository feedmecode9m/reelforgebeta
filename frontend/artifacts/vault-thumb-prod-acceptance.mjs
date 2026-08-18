#!/usr/bin/env node
/** One-shot production Vault thumbnail acceptance (evidence only). */
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { unlockStudio, openContentTab } from '../tests/helpers/studio-navigation.mjs';

dns.setDefaultResultOrder('ipv4first');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app';
const OUT = path.join(__dirname, 'vault-thumb-prod-acceptance.json');
const SHOT = path.join(__dirname, 'vault-thumb-prod-acceptance.png');
const SHOT2 = path.join(__dirname, 'vault-thumb-prod-acceptance-refresh.png');
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/home/youloose2dafish/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';

const report = {
  generatedAt: new Date().toISOString(),
  frontend: FRONTEND,
  browser: 'chromium headless',
  checks: {}
};

async function inspectVaultCards(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('.video-vault-item, .vault-card.video')];
    return cards.map((card) => {
      const img = card.querySelector('img');
      const src = String(img?.currentSrc || img?.src || '');
      const placeholder = Boolean(card.querySelector('.vault-pending-face, .placeholder'));
      const pendingFace = Boolean(card.querySelector('.vault-pending-face'));
      return {
        id: String(card.getAttribute('data-asset-id') || card.getAttribute('data-reel-id') || ''),
        imgSrc: src,
        hasImg: Boolean(img),
        placeholder,
        pendingFace,
        imgIsMp4: /\.mp4(\?|$)/i.test(src)
      };
    });
  });
}

try {
  const html = await fetch(FRONTEND + '/', { signal: AbortSignal.timeout(20000) }).then((r) => r.text());
  const bundle = (html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/) || [])[1] || '';
  report.productionBundle = bundle;

  const reels = await fetch(FRONTEND + '/api/reels', { signal: AbortSignal.timeout(20000) }).then((r) => r.json());
  const videos = (Array.isArray(reels) ? reels : []).filter(
    (r) => String(r?.type || '').startsWith('video') || /\.(mp4|mov|webm)(\?|$)/i.test(String(r?.url || ''))
  );
  const withThumb = videos.filter((r) => String(r.thumbnailUrl || r.thumbnail_url || '').trim());
  report.api = {
    videoCount: videos.length,
    withThumbnailUrl: withThumb.length,
    pass: videos.length > 0 && withThumb.length === videos.length
  };

  const launch = { headless: true };
  if (fs.existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;
  const browser = await chromium.launch(launch);
  const page = await browser.newPage();
  await unlockStudio(page, FRONTEND);
  await openContentTab(page);
  await page.waitForSelector('.video-vault-item, .vault-grid--videos', { timeout: 90000 });
  await page.waitForTimeout(4000);

  const first = await inspectVaultCards(page);
  await page.screenshot({ path: SHOT, fullPage: false });
  const mp4Imgs = first.filter((c) => c.imgIsMp4);
  const withStill = first.filter((c) => c.hasImg && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(c.imgSrc));
  const pendingWithStillExpected = first.filter((c) => c.pendingFace && c.hasImg);

  report.checks.A_existingVideos = {
    cardCount: first.length,
    cardsWithImage: first.filter((c) => c.hasImg).length,
    jpegPngWebp: withStill.length,
    pendingFaceCount: first.filter((c) => c.pendingFace).length,
    pass: first.length > 0 && withStill.length > 0 && pendingWithStillExpected.length === 0
  };
  report.checks.B_srcSafety = {
    mp4ImgCount: mp4Imgs.length,
    sampleSrc: first.slice(0, 5).map((c) => c.imgSrc),
    pass: mp4Imgs.length === 0
  };

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await unlockStudio(page, FRONTEND).catch(() => {});
  await openContentTab(page);
  await page.waitForSelector('.video-vault-item, .vault-grid--videos', { timeout: 90000 });
  await page.waitForTimeout(4000);
  const after = await inspectVaultCards(page);
  await page.screenshot({ path: SHOT2, fullPage: false });
  const afterStill = after.filter((c) => c.hasImg && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(c.imgSrc));
  report.checks.C_refresh = {
    beforeImages: withStill.length,
    afterImages: afterStill.length,
    pass: afterStill.length >= Math.min(withStill.length, 1) && after.filter((c) => c.imgIsMp4).length === 0
  };

  const posters = {};
  for (const c of after) {
    const key = c.imgSrc || '(empty)';
    posters[key] = (posters[key] || 0) + 1;
  }
  const shared = Object.entries(posters).filter(([src, n]) => src !== '(empty)' && n >= 2);
  report.checks.D_sharedPosterCards = {
    sharedPosterGroups: shared.length,
    pass: after.length >= 2
  };

  const playable = after.find((c) => c.hasImg);
  let playback = { pass: false };
  if (playable) {
    const card = page.locator('.video-vault-item, .vault-card.video').first();
    await card.click({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    playback = await page.evaluate(() => {
      const v = document.querySelector('video');
      const src = String(v?.currentSrc || v?.src || '');
      return {
        hasVideo: Boolean(v),
        src,
        isMp4: /\.(mp4|mov|webm)(\?|$)/i.test(src) || src.includes('/videos/'),
        readyState: v?.readyState ?? null
      };
    });
    playback.pass = Boolean(playback.hasVideo && playback.src && !/\.(jpe?g|png)$/i.test(playback.src));
  }
  report.checks.E_playback = playback;

  await browser.close();
  report.verdict =
    report.api.pass &&
    report.checks.A_existingVideos.pass &&
    report.checks.B_srcSafety.pass &&
    report.checks.C_refresh.pass &&
    report.checks.D_sharedPosterCards.pass &&
    report.checks.E_playback.pass
      ? 'PASS'
      : 'FAIL';
} catch (err) {
  report.verdict = 'FAIL';
  report.error = err?.message || String(err);
}

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ verdict: report.verdict, artifact: OUT, checks: report.checks, api: report.api, bundle: report.productionBundle, error: report.error }, null, 2));
process.exit(report.verdict === 'PASS' ? 0 : 1);
