#!/usr/bin/env node
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const RUNTIME_REPORT_PATH = join(ROOT, 'hero-media-domain-runtime.json');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';

const report = {
  phase: 'REELFORGE PHASE 69.5 — HERO MEDIA DOMAIN SEPARATION',
  generatedAt: new Date().toISOString(),
  checks: {
    heroVaultIncreases: false,
    videoVaultUnchanged: false,
    feedUnchanged: false,
    placeholderUnchanged: false,
    discoveryUnchanged: false,
    reloadSurvives: false
  },
  evidence: {
    baseline: null,
    postAccept: null,
    postReload: null,
    guardProbe: null
  },
  completeToken: 'HERO_MEDIA_DOMAIN_SEPARATION_COMPLETE=false'
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

function readCountsScript() {
  return `
    (async () => {
      const { loadHeroVaultItems } = await import('/src/lib/hero/heroIntelligence.js');
      const { isHeroAsset } = await import('/src/lib/hero/heroDomainGuard.js');
      const feedRaw = JSON.parse(localStorage.getItem('reelforge_feed') || '{}');
      const feedRows = Object.values(feedRaw || {}).flat().filter(Boolean);
      const videoVaultRaw = JSON.parse(localStorage.getItem('personal_video_vault') || '[]');
      const thumbVaultRaw = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
      const discoveryRaw = JSON.parse(localStorage.getItem('reelforge_discovery_index') || '{"docs":[]}');
      const discoveryDocs = Array.isArray(discoveryRaw?.docs) ? discoveryRaw.docs : [];
      return {
        heroVaultCount: loadHeroVaultItems().length,
        videoVaultCount: videoVaultRaw.filter((row) => !isHeroAsset(row)).length,
        thumbnailVaultCount: thumbVaultRaw.filter((row) => !isHeroAsset(row)).length,
        feedCount: feedRows.filter((row) => !row?.isPlaceholder).length,
        placeholderCount: feedRows.filter((row) => Boolean(row?.isPlaceholder)).length,
        discoveryCount: discoveryDocs.length
      };
    })();
  `;
}

await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(2500);
await page.evaluate(async () => {
  const { indexPlatformData } = await import('/src/lib/discovery/discoveryEngine.js');
  indexPlatformData();
});
await page.waitForTimeout(250);

report.evidence.baseline = await page.evaluate(readCountsScript());

report.evidence.postAccept = await page.evaluate(async () => {
  const { saveHeroManagerConfig, loadHeroVaultItems } = await import('/src/lib/hero/heroIntelligence.js');
  const { reelsToVideoVaultEntries } = await import('/src/lib/mediaBootstrap.js');

  const nextAssetId = `hero-domain-${Date.now()}`;
  localStorage.setItem('reelforge_hero_video', '/videos/hero-background.mp4');
  localStorage.setItem('reelforge_hero_image', '/thumbs/hero-domain-poster.jpg');
  saveHeroManagerConfig({
    backgroundSource: 'custom_video',
    heroAssetId: nextAssetId,
    backgroundVideo: '/videos/hero-background.mp4',
    backgroundImage: '/thumbs/hero-domain-poster.jpg'
  });

  const blockedByBootstrap = reelsToVideoVaultEntries([
    {
      id: nextAssetId,
      name: 'hero-background.mp4',
      url: '/videos/hero-background.mp4',
      type: 'video/mp4'
    }
  ]);

  await new Promise((resolve) => setTimeout(resolve, 300));
  return {
    heroVaultCount: loadHeroVaultItems().length,
    blockedByBootstrapCount: blockedByBootstrap.length
  };
});

const postAcceptCounts = await page.evaluate(readCountsScript());
report.evidence.postAccept = { ...postAcceptCounts, ...report.evidence.postAccept };

await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  const { indexPlatformData } = await import('/src/lib/discovery/discoveryEngine.js');
  indexPlatformData();
});
await page.waitForTimeout(250);
report.evidence.postReload = await page.evaluate(readCountsScript());

const b = report.evidence.baseline;
const a = report.evidence.postAccept;
const r = report.evidence.postReload;

report.checks.heroVaultIncreases = a.heroVaultCount > b.heroVaultCount;
report.checks.videoVaultUnchanged = a.videoVaultCount === b.videoVaultCount;
report.checks.feedUnchanged = a.feedCount === b.feedCount;
report.checks.placeholderUnchanged = a.placeholderCount === b.placeholderCount;
report.checks.discoveryUnchanged = a.discoveryCount === b.discoveryCount;
report.checks.reloadSurvives = r.heroVaultCount === a.heroVaultCount;
report.evidence.guardProbe = {
  reelsToVideoVaultEntriesHeroResultCount: a.blockedByBootstrapCount
};

const success = Object.values(report.checks).every(Boolean) && a.blockedByBootstrapCount === 0;
report.completeToken = success
  ? 'HERO_MEDIA_DOMAIN_SEPARATION_COMPLETE=true'
  : 'HERO_MEDIA_DOMAIN_SEPARATION_COMPLETE=false';

writeFileSync(RUNTIME_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await browser.close();
console.log(report.completeToken);
