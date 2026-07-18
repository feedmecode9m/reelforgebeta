#!/usr/bin/env node
/** BG-6C — Hero Accept Execution Trace (read-only production forensics) */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';

const FRONTEND = process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Gaff1505!';
const OUT = process.env.OUT || '/tmp/bg-6c-hero-accept-trace.json';
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const report = {
  generatedAt: new Date().toISOString(),
  frontend: FRONTEND,
  pathA: { name: 'drop_only', snapshots: [], network: [], console: [] },
  pathB: { name: 'drop_then_accept', snapshots: [], network: [], console: [] }
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureTestMp4() {
  const p = '/tmp/bg6c-test.mp4';
  if (!fs.existsSync(p)) {
    execSync(
      `ffmpeg -y -f lavfi -i color=c=blue:s=320x240:d=2 -c:v libx264 -pix_fmt yuv420p -movflags +faststart ${p}`,
      { stdio: 'ignore' }
    );
  }
  return p;
}

function filterConsole(entry) {
  const t = entry.text || '';
  const tags = [
    '[HERO_ACCEPT]',
    '[HERO_UPLOAD]',
    '[HERO_SAVE]',
    '[HERO_REEL_SAVE]',
    '[HERO_STORE_WRITE]',
    '[HERO_ROUTE]',
    '[HERO_UX_STATE_CHANGE]',
    '[HERO_FILE_SELECTED]',
    '[UPLOAD_',
    '[RENDER_GATE]',
    '[HERO_ASSET_ID_TRACE]',
    '[HERO_CLASSIFY]',
    'Failed to accept hero'
  ];
  return tags.some((tag) => t.includes(tag));
}

async function attachCapture(page, bucket) {
  page.on('console', async (msg) => {
    const text = msg.text();
    if (!filterConsole({ text })) return;
    const parts = [];
    for (const arg of msg.args()) {
      try {
        parts.push(await arg.jsonValue());
      } catch {
        parts.push(arg.toString());
      }
    }
    bucket.console.push({
      ts: new Date().toISOString(),
      level: msg.type(),
      text,
      parts
    });
  });

  page.on('request', (req) => {
    const url = req.url();
    if (req.method() === 'POST' && /\/api\/reels/.test(url)) {
      bucket.network.push({
        ts: new Date().toISOString(),
        phase: 'request',
        method: req.method(),
        url
      });
    }
  });

  page.on('response', async (res) => {
    const url = res.url();
    if (res.request().method() === 'POST' && /\/api\/reels/.test(url)) {
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      bucket.network.push({
        ts: new Date().toISOString(),
        phase: 'response',
        status: res.status(),
        url,
        body: body
          ? {
              id: body.id,
              status: body.status,
              url: body.url || body.videoUrl || body.video_url || null,
              thumbnailUrl: body.thumbnailUrl || body.thumbnail_url || null
            }
          : null
      });
    }
  });
}

async function unlockStudio(page) {
  await page.goto(FRONTEND, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.ghost-trigger', { timeout: 60000 });
  await page.click('.ghost-trigger');
  const pw = page.locator('.admin-login-panel input[type="password"]').first();
  if (await pw.count()) {
    await pw.fill(ADMIN_PASSWORD);
    const btn = page.locator('.admin-login-panel .submit-btn').first();
    if (await btn.count()) await btn.click();
    else await pw.press('Enter');
  }
  await page.waitForSelector('[data-production-command-center], .control-center-container', {
    timeout: 60000
  });
  const contentTab = page.locator('button[role="tab"]').filter({ hasText: 'Content' }).first();
  if (await contentTab.count()) {
    await contentTab.click();
    await sleep(1500);
  } else {
    await page.click('#workspace-tab-content').catch(() => {});
    await sleep(1500);
  }
  await page.waitForSelector('.video-vault-drop, .personal-media-grid, .control-center-container', {
    timeout: 60000
  });
  await page.evaluate(() => {
    const el = document.querySelector('.hero-replace-section');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await sleep(800);
  const heroCount = await page.locator('.hero-replace-section').count();
  if (!heroCount) {
    throw new Error('hero-replace-section not in DOM after Content tab');
  }
}

async function snapshot(page, label) {
  return page.evaluate((snapLabel) => {
    const mgrRaw = localStorage.getItem('reelforge_hero_manager_config');
    const reelRaw = localStorage.getItem('reelforge_hero_reel');
    let mgr = null;
    let reel = null;
    try {
      mgr = mgrRaw ? JSON.parse(mgrRaw) : null;
    } catch {
      mgr = { parseError: true, raw: mgrRaw?.slice(0, 200) };
    }
    try {
      reel = reelRaw ? JSON.parse(reelRaw) : null;
    } catch {
      reel = { parseError: true, raw: reelRaw?.slice(0, 200) };
    }

    const stageVideo =
      document.querySelector('.hero-stage .hero-video') ||
      document.querySelector('.hero-background video.hero-media') ||
      document.querySelector('.hero-video-container video');
    const previewVideo = document.querySelector('.hero-replace-section .hero-preview video');
    const acceptBtn = document.querySelector('.hero-replace-section .accept-btn');
    const dropZone = document.querySelector('.hero-replace-section .hero-drop-zone');
    const heroBg = document.querySelector('[data-hero-background-source]');

    const renderGateHero = [];
    // cannot read past console; DOM attrs only

    return {
      label: snapLabel,
      wallTime: new Date().toISOString(),
      localStorage: {
        reelforge_hero_reel: reel,
        reelforge_hero_manager_config: mgr
          ? {
              backgroundSource: mgr.backgroundSource,
              heroAssetId: mgr.heroAssetId,
              backgroundStyle: mgr.backgroundStyle,
              updatedAt: mgr.updatedAt
            }
          : null,
        reelforge_hero_video: localStorage.getItem('reelforge_hero_video'),
        reelforge_hero_image: localStorage.getItem('reelforge_hero_image')
      },
      dom: {
        stageVideoSrc: stageVideo?.currentSrc || stageVideo?.src || null,
        stageVideoReadyState: stageVideo?.readyState ?? null,
        previewVideoSrc: previewVideo?.currentSrc || previewVideo?.src || null,
        dataHeroBackgroundSource: heroBg?.getAttribute('data-hero-background-source') || null,
        dataHeroBackgroundAsset: heroBg?.getAttribute('data-hero-background-asset') || null,
        dataActiveHeroMediaMode:
          document.querySelector('[data-active-hero-media-mode]')?.getAttribute('data-active-hero-media-mode') ||
          null,
        acceptBtnVisible: acceptBtn ? Boolean(acceptBtn.offsetParent) : false,
        acceptBtnDisabled: acceptBtn?.disabled ?? null,
        acceptBtnText: acceptBtn?.textContent?.trim() || null,
        dropZoneHasPendingPreview: Boolean(document.querySelector('.hero-replace-section .hero-pending-preview')),
        processingIndicator: Boolean(
          document.querySelector('.hero-replace-section .hero-loading-indicator')
        )
      },
      uiState: {
        hasPendingPreview: Boolean(document.querySelector('.hero-replace-section .hero-pending-preview')),
        uploadStatusText:
          document.querySelector('.upload-status, [class*="upload-status"]')?.textContent?.trim()?.slice(0, 120) ||
          null
      }
    };
  }, label);
}

async function dropHeroMp4(page) {
  const mp4 = ensureTestMp4();
  const b64 = fs.readFileSync(mp4).toString('base64');
  const fileName = `bg6c-hero-${Date.now()}.mp4`;
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

function extractRenderGateLogs(consoleLogs) {
  return consoleLogs
    .filter((c) => c.text.includes('[RENDER_GATE]'))
    .map((c) => {
      const obj = c.parts?.find((p) => p && typeof p === 'object');
      return { ts: c.ts, payload: obj || c.text };
    });
}

function extractHeroAcceptLogs(consoleLogs) {
  return consoleLogs.filter((c) => c.text.includes('[HERO_ACCEPT]'));
}

function lastRenderGateHero(consoleLogs) {
  const gates = extractRenderGateLogs(consoleLogs).filter((g) => {
    const p = g.payload;
    return p && (p.backgroundSource !== undefined || p.heroRenderVideo !== undefined);
  });
  return gates.length ? gates[gates.length - 1] : null;
}

async function runPathA(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  attachCapture(page, report.pathA);

  await unlockStudio(page);
  report.pathA.snapshots.push(await snapshot(page, 'baseline_before_drop'));

  const fileName = await dropHeroMp4(page);
  report.pathA.fileName = fileName;
  await sleep(2500);

  report.pathA.snapshots.push(await snapshot(page, 'after_drop_no_accept'));
  report.pathA.renderGate = lastRenderGateHero(report.pathA.console);
  report.pathA.heroAcceptLogs = extractHeroAcceptLogs(report.pathA.console);
  report.pathA.postCount = report.pathA.network.filter((n) => n.phase === 'request').length;

  await context.close();
}

async function runPathB(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  attachCapture(page, report.pathB);

  await unlockStudio(page);
  report.pathB.snapshots.push(await snapshot(page, 'baseline_before_drop'));

  const fileName = await dropHeroMp4(page);
  report.pathB.fileName = fileName;
  await sleep(1500);
  report.pathB.snapshots.push(await snapshot(page, 'after_drop_before_accept'));

  const acceptBtn = page.locator('.hero-replace-section .accept-btn').first();
  const acceptCount = await acceptBtn.count();
  report.pathB.acceptButton = {
    found: acceptCount > 0,
    visible: acceptCount > 0 ? await acceptBtn.isVisible() : false,
    enabled: acceptCount > 0 ? await acceptBtn.isEnabled() : false,
    text: acceptCount > 0 ? (await acceptBtn.textContent())?.trim() : null
  };

  if (acceptCount === 0) {
    report.pathB.acceptExecuted = false;
    report.pathB.acceptError = 'accept-btn not found in DOM';
  } else {
    report.pathB.acceptExecuted = true;
    const consoleBefore = report.pathB.console.length;
    const netBefore = report.pathB.network.length;
    await acceptBtn.click({ force: true });
    report.pathB.acceptClickedAt = new Date().toISOString();

    // wait for upload + render (up to 90s)
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const hasPost = report.pathB.network.some((n) => n.phase === 'response' && n.status);
      const hasAcceptComplete = report.pathB.console.some(
        (c) => c.text.includes('[HERO_ACCEPT]') && c.text.includes('complete')
      );
      const hasUploadSuccess = report.pathB.console.some((c) => c.text.includes('[UPLOAD_SUCCESS]'));
      if (hasPost && (hasAcceptComplete || hasUploadSuccess)) break;
      await sleep(1000);
    }

    await sleep(3000);
    report.pathB.snapshots.push(await snapshot(page, 'after_accept'));
    report.pathB.consoleAfterAccept = report.pathB.console.length - consoleBefore;
    report.pathB.networkAfterAccept = report.pathB.network.length - netBefore;
  }

  report.pathB.renderGate = lastRenderGateHero(report.pathB.console);
  report.pathB.heroAcceptLogs = extractHeroAcceptLogs(report.pathB.console);
  report.pathB.renderGateAll = extractRenderGateLogs(report.pathB.console);
  report.pathB.postCount = report.pathB.network.filter((n) => n.phase === 'request').length;

  await context.close();
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROMIUM
  });

  try {
    await runPathA(browser);
    await runPathB(browser);

    // Analysis
    const aAfter = report.pathA.snapshots.find((s) => s.label === 'after_drop_no_accept');
    const bBefore = report.pathB.snapshots.find((s) => s.label === 'after_drop_before_accept');
    const bAfter = report.pathB.snapshots.find((s) => s.label === 'after_accept');

    report.analysis = {
      pathA: {
        acceptExecuted: false,
        postApiReels: report.pathA.postCount,
        heroReelSaved: Boolean(aAfter?.localStorage?.reelforge_hero_reel?.id),
        backgroundSource: aAfter?.localStorage?.reelforge_hero_manager_config?.backgroundSource,
        stageVideoSrc: aAfter?.dom?.stageVideoSrc,
        pendingPreview: aAfter?.dom?.dropZoneHasPendingPreview,
        acceptBtnVisible: aAfter?.dom?.acceptBtnVisible
      },
      pathB: {
        acceptExecuted: report.pathB.acceptExecuted,
        acceptButtonReachable: report.pathB.acceptButton?.found && report.pathB.acceptButton?.visible,
        postApiReels: report.pathB.postCount,
        uploadSucceeded: report.pathB.network.some((n) => n.phase === 'response' && n.status >= 200 && n.status < 300),
        heroReelSaved: Boolean(bAfter?.localStorage?.reelforge_hero_reel?.id),
        backgroundSourceAfter: bAfter?.localStorage?.reelforge_hero_manager_config?.backgroundSource,
        heroAssetIdAfter: bAfter?.localStorage?.reelforge_hero_manager_config?.heroAssetId,
        stageVideoSrcBefore: bBefore?.dom?.stageVideoSrc,
        stageVideoSrcAfter: bAfter?.dom?.stageVideoSrc,
        stageVideoChanged:
          bBefore?.dom?.stageVideoSrc !== bAfter?.dom?.stageVideoSrc &&
          Boolean(bAfter?.dom?.stageVideoSrc?.includes(bAfter?.localStorage?.reelforge_hero_reel?.id?.slice(0, 8))),
        renderGateAfter: report.pathB.renderGate?.payload || null
      }
    };

    // First divergence for path B chain
    const chain = [];
    if (report.pathB.acceptExecuted) chain.push('acceptHeroFile invoked (Accept click)');
    if (report.analysis.pathB.postApiReels > 0) chain.push('POST /api/reels fired');
    else if (report.pathB.acceptExecuted) chain.push('DIVERGE: no POST /api/reels');
    if (report.analysis.pathB.uploadSucceeded) chain.push('upload response 2xx');
    if (report.analysis.pathB.heroReelSaved) chain.push('saveHeroReel persisted');
    else if (report.pathB.acceptExecuted) chain.push('DIVERGE: reelforge_hero_reel not saved');
    if (report.analysis.pathB.backgroundSourceAfter === 'custom_video') chain.push('backgroundSource=custom_video');
    else if (report.pathB.acceptExecuted) chain.push(`DIVERGE: backgroundSource=${report.analysis.pathB.backgroundSourceAfter}`);
    const rg = report.pathB.renderGate?.payload;
    if (rg?.HERO_BACKGROUND_VIDEO && bAfter?.localStorage?.reelforge_hero_reel?.url) {
      const reelUrl = bAfter.localStorage.reelforge_hero_reel.url;
      const storeMatch = String(rg.HERO_BACKGROUND_VIDEO || '').includes(reelUrl.split('/').pop()?.replace('.mp4', '') || '___');
      chain.push(storeMatch ? 'HERO_BACKGROUND_VIDEO matches reel' : `DIVERGE: store=${rg.HERO_BACKGROUND_VIDEO}`);
    }
    if (rg?.prioritizedHeroVideo && bAfter?.localStorage?.reelforge_hero_reel?.url) {
      const pop = bAfter.localStorage.reelforge_hero_reel.url.split('/').pop();
      const priMatch = String(rg.prioritizedHeroVideo || '').includes(pop?.replace('.mp4', '') || '___');
      chain.push(priMatch ? 'prioritizedHeroVideo matches reel' : `DIVERGE: prioritized=${rg.prioritizedHeroVideo}`);
    }
    if (bAfter?.dom?.stageVideoSrc?.includes('hero-background')) {
      chain.push('DIVERGE: DOM still hero-background.mp4');
    } else if (bAfter?.dom?.stageVideoSrc) {
      chain.push('DOM stage video updated');
    }

    report.analysis.pathB.executionChain = chain;
    report.analysis.firstDivergence = chain.find((s) => s.startsWith('DIVERGE:')) || null;

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log('Wrote', OUT);
    console.log(JSON.stringify(report.analysis, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
