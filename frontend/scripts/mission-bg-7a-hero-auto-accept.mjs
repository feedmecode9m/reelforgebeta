#!/usr/bin/env node
/** BG-7A — Hero auto-accept automation (Drop → Auto Upload → Persist) */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { unlockStudioWithHeroSection, readHeroStorage as readHeroStorageHelper } from '../tests/helpers/studio-navigation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app';
const OUT = path.join(__dirname, '..', 'artifacts', 'bg-7a-hero-auto-accept.json');
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const report = {
  generatedAt: new Date().toISOString(),
  frontend: FRONTEND,
  mission: 'BG-7A',
  steps: [],
  network: [],
  pass: false
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function step(name, ok, detail = {}) {
  report.steps.push({ name, ok, ...detail, ts: new Date().toISOString() });
  return ok;
}

function ensureTestMp4() {
  const p = '/tmp/bg-7a-hero.mp4';
  if (!fs.existsSync(p)) {
    execSync(
      `ffmpeg -y -f lavfi -i color=c=purple:s=320x240:d=2 -c:v libx264 -pix_fmt yuv420p -movflags +faststart ${p}`,
      { stdio: 'ignore' }
    );
  }
  return p;
}

async function dropHeroMp4(page) {
  const mp4 = ensureTestMp4();
  const b64 = fs.readFileSync(mp4).toString('base64');
  const fileName = `bg-7a-hero-${Date.now()}.mp4`;
  await page.evaluate(
    async ({ mp4B64, name }) => {
      const target =
        document.querySelector('.hero-replace-section .hero-drop-zone') ||
        document.querySelector('.hero-replace-section');
      if (!target) throw new Error('Missing hero drop target');
      const bytes = Uint8Array.from(atob(mp4B64), (c) => c.charCodeAt(0));
      const file = new File([bytes], name, { type: 'video/mp4' });
      const dt = new DataTransfer();
      dt.items.add(file);
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    },
    { mp4B64: b64, name: fileName }
  );
  return fileName;
}

async function readHeroStorage(page) {
  const { reel, mgr } = await readHeroStorageHelper(page);
  return {
    reelforge_hero_reel: reel,
    reelforge_hero_manager_config: mgr
      ? {
          backgroundSource: mgr.backgroundSource,
          heroAssetId: mgr.heroAssetId
        }
      : null
  };
}

async function readStageHeroVideo(page) {
  return page.evaluate(() => {
    const v =
      document.querySelector('.hero-stage .hero-video') ||
      document.querySelector('.hero-background video.hero-media') ||
      document.querySelector('.hero-video-container video');
    return v
      ? { src: v.currentSrc || v.src || '', readyState: v.readyState }
      : null;
  });
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  ensureTestMp4();

  const launch = { headless: true };
  if (fs.existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;

  const browser = await chromium.launch(launch);
  const context = await browser.newContext();
  const page = await context.newPage();

  const postRequests = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/api\/reels/.test(req.url())) {
      postRequests.push({ ts: new Date().toISOString(), url: req.url() });
      report.network.push({ phase: 'request', method: 'POST', url: req.url() });
    }
  });
  page.on('response', async (res) => {
    if (res.request().method() === 'POST' && /\/api\/reels/.test(res.url())) {
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      report.network.push({
        phase: 'response',
        status: res.status(),
        id: body?.id || null,
        url: body?.url || null
      });
    }
  });

  try {
    await unlockStudioWithHeroSection(page, FRONTEND);
    step('studio_unlocked', true);

    const postsBeforeDrop = postRequests.length;
    await dropHeroMp4(page);

    const uploadStartedDeadline = Date.now() + 15000;
    while (Date.now() < uploadStartedDeadline && postRequests.length === postsBeforeDrop) {
      await sleep(250);
    }

    const uxPhase = await page.locator('.hero-replace-section').getAttribute('data-hero-replace-ux-phase');
    step('upload_starts_after_drop', postRequests.length > postsBeforeDrop, {
      postCount: postRequests.length - postsBeforeDrop,
      uxPhase
    });

    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const ls = await readHeroStorage(page);
      if (ls.reelforge_hero_reel?.id && postRequests.length > postsBeforeDrop) break;
      await sleep(1000);
    }
    await sleep(2000);

    const lsAfterUpload = await readHeroStorage(page);
    report.afterUpload = { localStorage: lsAfterUpload };
    const reelId = lsAfterUpload.reelforge_hero_reel?.id || '';
    step('post_api_reels_after_drop', postRequests.length > postsBeforeDrop, {
      postCount: postRequests.length - postsBeforeDrop
    });
    step('canonical_reel_saved', Boolean(reelId), { reelId });
    step('manager_custom_video', lsAfterUpload.reelforge_hero_manager_config?.backgroundSource === 'custom_video', {
      config: lsAfterUpload.reelforge_hero_manager_config
    });
    step('hero_asset_id_matches_reel', lsAfterUpload.reelforge_hero_manager_config?.heroAssetId === reelId, {
      heroAssetId: lsAfterUpload.reelforge_hero_manager_config?.heroAssetId,
      reelId
    });

    const stageVideo = await readStageHeroVideo(page);
    report.afterUpload.stageVideo = stageVideo;
    step('stage_video_updated', Boolean(stageVideo?.src?.includes(reelId.slice(0, 8))), {
      stageVideoSrc: stageVideo?.src
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(3000);
    const lsAfterReload = await readHeroStorage(page);
    report.afterReload = { localStorage: lsAfterReload };
    step('persistence_after_reload', lsAfterReload.reelforge_hero_reel?.id === reelId, {
      reelIdBefore: reelId,
      reelIdAfter: lsAfterReload.reelforge_hero_reel?.id
    });

    report.pass = report.steps.every((s) => s.ok);
  } catch (error) {
    report.error = error?.message || String(error);
    report.pass = false;
  } finally {
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    await browser.close();
  }

  console.log(JSON.stringify({ mission: 'BG-7A', pass: report.pass, artifact: OUT }, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
