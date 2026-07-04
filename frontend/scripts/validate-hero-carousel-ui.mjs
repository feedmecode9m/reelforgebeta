#!/usr/bin/env node
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const REPORT_PATH = join(ROOT, 'hero-carousel-ui-report.json');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';

const report = {
  phase: 'REELFORGE PHASE 67 — HERO CAROUSEL EXPERIENCE IMPLEMENTATION',
  generatedAt: new Date().toISOString(),
  checks: {
    activeAssetLoads: false,
    reloadKeepsPrimaryFocus: false,
    mediaPlaybackStateValid: false,
    navigationDiagnosticsEmit: false
  },
  evidence: {},
  diagnostics: {
    render: [],
    navigate: [],
    mediaState: []
  },
  completeToken: 'HERO_CAROUSEL_UI_COMPLETE=false'
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('console', (msg) => {
  const text = msg.text();
  if (text.includes('[HERO_CAROUSEL_RENDER]')) report.diagnostics.render.push(text);
  if (text.includes('[HERO_CAROUSEL_NAVIGATE]')) report.diagnostics.navigate.push(text);
  if (text.includes('[HERO_CAROUSEL_MEDIA_STATE]')) report.diagnostics.mediaState.push(text);
});

async function readStage(label) {
  return page.evaluate(({ label }) => {
    const stage = document.querySelector('[data-hero-carousel]');
    const activeId = stage?.getAttribute('data-hero-carousel-active-id') || '';
    const video = stage?.querySelector('.hero-video');
    const img = stage?.querySelector('.hero-fallback-image img, .hero-fallback-image');
    const nextBtn = stage?.querySelector('[data-hero-carousel-next]');
    return {
      label,
      activeId,
      hasStage: Boolean(stage),
      hasVideoNode: Boolean(video),
      hasImageNode: Boolean(img),
      videoPaused: video ? Boolean(video.paused) : null,
      videoMuted: video ? Boolean(video.muted) : null,
      hasNextControl: Boolean(nextBtn)
    };
  }, { label });
}

async function setHeroAsset(kind, assetId, payload) {
  await page.evaluate(async ({ kind, assetId, payload }) => {
    const hero = await import('/src/lib/hero/heroIntelligence.js');
    if (kind === 'image') {
      localStorage.setItem('reelforge_hero_image', payload);
      hero.saveHeroManagerConfig({
        backgroundSource: 'custom_image',
        backgroundStyle: 'image',
        heroAssetId: assetId
      });
      return;
    }
    localStorage.setItem('reelforge_hero_video', payload);
    hero.saveHeroManagerConfig({
      backgroundSource: 'custom_video',
      backgroundStyle: 'video',
      heroAssetId: assetId
    });
  }, { kind, assetId, payload });
}

await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('[data-hero-carousel]', { timeout: 15000 });

await page.evaluate(() => {
  localStorage.removeItem('reelforge_hero_image');
  localStorage.removeItem('reelforge_hero_video');
  localStorage.removeItem('reelforge_hero_manager_config');
});

const imageAssetId = `hero-carousel-image-${Date.now()}`;
await setHeroAsset(
  'image',
  imageAssetId,
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z6WQAAAAASUVORK5CYII='
);
await page.waitForTimeout(800);
const afterImage = await readStage('after-image');
report.evidence.afterImage = afterImage;
report.checks.activeAssetLoads = afterImage.activeId === imageAssetId && afterImage.hasImageNode;

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-hero-carousel]', { timeout: 15000 });
await page.waitForTimeout(600);
const afterReload = await readStage('after-reload');
report.evidence.afterReload = afterReload;
report.checks.reloadKeepsPrimaryFocus = afterReload.activeId === imageAssetId;

const videoAssetId = `hero-carousel-video-${Date.now()}`;
await setHeroAsset(
  'video',
  videoAssetId,
  'data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29t'
);
await page.waitForTimeout(1200);
const afterVideo = await readStage('after-video');
report.evidence.afterVideo = afterVideo;
report.checks.mediaPlaybackStateValid =
  afterVideo.activeId === videoAssetId &&
  afterVideo.hasVideoNode &&
  afterVideo.videoMuted === true &&
  (afterVideo.videoPaused === false || report.diagnostics.mediaState.length > 0);

const navBefore = report.diagnostics.navigate.length;
await page.evaluate(() => {
  const btn = document.querySelector('[data-hero-carousel-next]');
  if (btn instanceof HTMLElement) btn.click();
});
await page.waitForTimeout(400);
const afterNav = await readStage('after-navigation');
report.evidence.afterNavigation = afterNav;
report.checks.navigationDiagnosticsEmit = report.diagnostics.navigate.length > navBefore && afterNav.hasNextControl;

const success = Object.values(report.checks).every(Boolean);
report.completeToken = success ? 'HERO_CAROUSEL_UI_COMPLETE=true' : 'HERO_CAROUSEL_UI_COMPLETE=false';

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await browser.close();
console.log(report.completeToken);
