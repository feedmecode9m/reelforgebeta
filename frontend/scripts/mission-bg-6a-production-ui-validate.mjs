#!/usr/bin/env node
/** BG-6A — Production UI Validation (forensics only, no fixes) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { openContentTab as openContentTabHelper } from '../tests/helpers/studio-navigation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app';
const BACKEND = process.env.BACKEND_URL || 'https://reelforge-deploy-production.up.railway.app';
const KNOWN_REEL = '03f66631-6038-4ff3-8374-444f4c21eaf6';
const LEGACY_REELS = [
  '66598368-3fba-41bf-847c-68dd8f41be86',
  'e5bf7c03-8495-4138-81e4-15a974d55d60'
];
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Gaff1505!';
const OUT = path.join(__dirname, '..', 'artifacts', 'bg-6a-production-ui.json');
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const report = {
  generatedAt: new Date().toISOString(),
  frontend: FRONTEND,
  backend: BACKEND,
  knownReel: KNOWN_REEL,
  phases: {},
  network: [],
  console: [],
  classification: {}
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureTestMp4() {
  const p = '/tmp/bg6a-test.mp4';
  if (!fs.existsSync(p)) {
    execSync(
      `ffmpeg -y -f lavfi -i color=c=green:s=320x240:d=2 -c:v libx264 -pix_fmt yuv420p -movflags +faststart ${p}`,
      { stdio: 'ignore' }
    );
  }
  return p;
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function headStatus(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    return res.status;
  } catch {
    return 0;
  }
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
  await sleep(800);
}

async function openContentTab(page) {
  await openContentTabHelper(page);
}

async function dropMp4(page, selector, label) {
  const mp4 = ensureTestMp4();
  const b64 = fs.readFileSync(mp4).toString('base64');
  const fileName = `${label}-${Date.now()}.mp4`;
  await page.evaluate(
    async ({ sel, mp4B64, name }) => {
      const target = document.querySelector(sel);
      if (!target) throw new Error(`Missing ${sel}`);
      const bytes = Uint8Array.from(atob(mp4B64), (c) => c.charCodeAt(0));
      const file = new File([bytes], name, { type: 'video/mp4' });
      const dt = new DataTransfer();
      dt.items.add(file);
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    },
    { sel: selector, mp4B64: b64, name: fileName }
  );
  return fileName;
}

async function readLocalStorage(page) {
  return page.evaluate(() => {
    let heroReel = null;
    let heroManager = null;
    try {
      heroReel = JSON.parse(localStorage.getItem('reelforge_hero_reel') || 'null');
    } catch {
      heroReel = null;
    }
    try {
      heroManager = JSON.parse(localStorage.getItem('reelforge_hero_manager_config') || 'null');
    } catch {
      heroManager = null;
    }
    return {
      personal_video_vault: JSON.parse(localStorage.getItem('personal_video_vault') || '[]'),
      reel_vault: JSON.parse(localStorage.getItem('reel_vault') || '[]'),
      personal_thumbnails: JSON.parse(localStorage.getItem('personal_thumbnails') || '[]'),
      hero_video: localStorage.getItem('reelforge_hero_video'),
      hero_image: localStorage.getItem('reelforge_hero_image'),
      hero_reel: heroReel,
      hero_manager_config: heroManager
        ? {
            backgroundSource: heroManager.backgroundSource,
            heroAssetId: heroManager.heroAssetId
          }
        : null
    };
  });
}

async function phase1Feed(page) {
  const phase = { name: 'feed', checks: {} };
  const apiReels = await fetchJson(`${FRONTEND}/api/reels`);
  phase.apiReels = { status: apiReels.status, count: Array.isArray(apiReels.body) ? apiReels.body.length : 0 };
  phase.knownReelInApi = Array.isArray(apiReels.body)
    ? apiReels.body.some((r) => r.id === KNOWN_REEL)
    : false;

  await page.goto(FRONTEND, { waitUntil: 'networkidle', timeout: 120000 }).catch(() =>
    page.goto(FRONTEND, { waitUntil: 'domcontentloaded', timeout: 120000 })
  );
  await sleep(3000);

  const dom = await page.evaluate(
    ({ knownReel, legacyReels }) => {
      const html = document.body?.innerHTML || '';
      const imgs = [...document.querySelectorAll('img')].map((i) => ({
        src: i.src,
        alt: i.alt,
        naturalWidth: i.naturalWidth,
        complete: i.complete
      }));
      const videos = [...document.querySelectorAll('video')].map((v) => ({
        src: v.currentSrc || v.src,
        readyState: v.readyState
      }));
      const placeholders = document.querySelectorAll(
        '.video-placeholder, .thumbnail-placeholder, .placeholder'
      ).length;
      return {
        knownReelInDom: html.includes(knownReel),
        legacyInDom: legacyReels.filter((id) => html.includes(id)),
        imgCount: imgs.length,
        imgsMatchingKnown: imgs.filter((i) => i.src.includes(knownReel)),
        videoCount: videos.length,
        videosMatchingKnown: videos.filter((v) => v.src.includes(knownReel)),
        placeholderCount: placeholders,
        titleMatches: [...document.querySelectorAll('*')]
          .filter((el) => el.childNodes.length === 1 && el.textContent?.includes('BG-5L'))
          .slice(0, 3)
          .map((el) => ({ tag: el.tagName, class: el.className }))
      };
    },
    { knownReel: KNOWN_REEL, legacyReels: LEGACY_REELS }
  );
  phase.dom = dom;

  phase.mediaHead = {
    knownVideo: await headStatus(`${FRONTEND}/videos/${KNOWN_REEL}.mp4`),
    knownThumb: await headStatus(`${FRONTEND}/thumbs/${KNOWN_REEL}.jpg`)
  };

  phase.checks.cardInApi = phase.knownReelInApi;
  phase.checks.knownReelInDom = dom.knownReelInDom || dom.titleMatches.length > 0;
  phase.checks.thumbLoads =
    phase.mediaHead.knownThumb === 200 &&
    (dom.imgsMatchingKnown.length > 0
      ? dom.imgsMatchingKnown.some((i) => i.complete && i.naturalWidth > 0)
      : phase.mediaHead.knownThumb === 200);
  phase.checks.noPlaceholderOnly = dom.placeholderCount === 0 || dom.imgsMatchingKnown.length > 0;
  phase.checks.videoReachable = phase.mediaHead.knownVideo === 200;
  phase.pass = phase.checks.cardInApi && phase.checks.videoReachable;

  report.phases.feed = phase;
}

async function phase2Vault(page, networkLog) {
  const phase = { name: 'vault', checks: {}, uploads: [] };
  await unlockStudio(page);
  await openContentTab(page);

  const beforeLs = await readLocalStorage(page);
  const beforeApi = await fetchJson(`${FRONTEND}/api/reels`);
  phase.before = { localStorageVideoCount: beforeLs.personal_video_vault.length, apiCount: beforeApi.body?.length };

  const uploadName = await dropMp4(page, '.video-vault-drop', 'bg6a-vault');
  phase.uploadFileName = uploadName;
  await sleep(8000);

  const afterUploadLs = await readLocalStorage(page);
  const afterUploadApi = await fetchJson(`${FRONTEND}/api/reels`);
  const newReels = (afterUploadApi.body || []).filter(
    (r) => !(beforeApi.body || []).some((b) => b.id === r.id)
  );
  phase.afterUpload = {
    localStorageVideoCount: afterUploadLs.personal_video_vault.length,
    apiCount: afterUploadApi.body?.length,
    newReelIds: newReels.map((r) => r.id),
    vaultEntries: afterUploadLs.personal_video_vault.slice(-3)
  };

  const newId = newReels[0]?.id;
  if (newId) {
    phase.newReelId = newId;
    phase.mediaHead = {
      video: await headStatus(`${FRONTEND}/videos/${newId}.mp4`),
      thumb: await headStatus(`${FRONTEND}/thumbs/${newId}.jpg`)
    };
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(4000);
  const afterReloadLs = await readLocalStorage(page);
  const afterReloadDom = await page.evaluate((id) => ({
    inDom: id ? document.body.innerHTML.includes(id) : false,
    vaultCount: document.querySelectorAll('.vault-grid-card, .media-card, [data-reel-id]').length
  }), newId || '');
  phase.afterReload = {
    localStorageVideoCount: afterReloadLs.personal_video_vault.length,
    newReelStillInLs: newId
      ? afterReloadLs.personal_video_vault.some((v) => String(v.id || v.assetId || '').includes(newId.slice(0, 8)))
      : false,
    dom: afterReloadDom
  };

  phase.checks.appearsAfterUpload = Boolean(newId);
  phase.checks.survivesReload =
    phase.afterReload.newReelStillInLs || (newId && afterReloadDom.inDom);
  phase.checks.apiBacked = newReels.length > 0;
  phase.pass = phase.checks.appearsAfterUpload && phase.checks.apiBacked;
  report.phases.vault = phase;
  return newId;
}

async function phase3Hero(page) {
  const phase = { name: 'hero', checks: {} };
  const heroPostRequests = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/reels')) {
      heroPostRequests.push({ url: req.url(), ts: Date.now() });
    }
  });

  await unlockStudio(page);
  await openContentTab(page);
  await page.evaluate(() => {
    const el = document.querySelector('.hero-replace-section');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await sleep(500);

  const hasHeroSection = (await page.locator('.hero-replace-section').count()) > 0;
  phase.hasHeroSection = hasHeroSection;

  if (hasHeroSection) {
    try {
      const postsBeforeDrop = heroPostRequests.length;
      await dropMp4(page, '.hero-replace-section .hero-drop-zone, .hero-replace-section', 'bg6a-hero');
      await sleep(1500);

      phase.afterDrop = {
        previewVisible: (await page.locator('[data-hero-preview-pending], .hero-pending-preview').count()) > 0,
        acceptVisible: await page.locator('.hero-replace-section .accept-btn').isVisible(),
        postCount: heroPostRequests.length - postsBeforeDrop
      };
      phase.checks.previewAfterDrop = phase.afterDrop.previewVisible;
      phase.checks.noUploadBeforeAccept = phase.afterDrop.postCount === 0;

      const lsAfterDrop = await readLocalStorage(page);
      phase.localStorageAfterDrop = {
        hero_reel: lsAfterDrop.hero_reel,
        hero_manager_config: lsAfterDrop.hero_manager_config
      };
      phase.checks.noReelBeforeAccept = !lsAfterDrop.hero_reel?.id;

      const acceptBtn = page.locator('.hero-replace-section .accept-btn').first();
      if (await acceptBtn.count()) {
        await acceptBtn.click({ force: true });
        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
          const ls = await readLocalStorage(page);
          if (ls.hero_reel?.id && heroPostRequests.length > postsBeforeDrop) break;
          await sleep(1000);
        }
        await sleep(2000);
      } else {
        phase.acceptError = 'accept-btn not found';
      }
    } catch (e) {
      phase.heroDropError = String(e.message || e);
    }
  }

  const ls = await readLocalStorage(page);
  phase.localStorage = {
    hero_video: ls.hero_video,
    hero_reel: ls.hero_reel,
    hero_image: ls.hero_image,
    hero_manager_config: ls.hero_manager_config
  };
  phase.savedReelId = ls.hero_reel?.id || null;

  const heroVideoEl = await page.evaluate(() => {
    const v = document.querySelector('.hero-video, .hero-background video, video.hero-media');
    return v
      ? { src: v.currentSrc || v.src, readyState: v.readyState }
      : null;
  });
  phase.heroVideoEl = heroVideoEl;

  if (phase.savedReelId) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(2500);
    const lsReload = await readLocalStorage(page);
    phase.afterReload = {
      hero_reel_id: lsReload.hero_reel?.id || null,
      hero_manager_config: lsReload.hero_manager_config
    };
    phase.checks.survivesReload = lsReload.hero_reel?.id === phase.savedReelId;
  } else {
    phase.checks.survivesReload = false;
  }

  phase.checks.heroStorageSet = Boolean(ls.hero_reel?.id);
  phase.checks.heroConfigCustomVideo = ls.hero_manager_config?.backgroundSource === 'custom_video';
  phase.checks.heroAssetIdMatchesReel =
    ls.hero_reel?.id && ls.hero_manager_config?.heroAssetId === ls.hero_reel.id;
  phase.checks.uploadAfterAccept = heroPostRequests.length > 0;
  phase.checks.heroVideoInDom = Boolean(heroVideoEl?.src);
  phase.checks.heroVideoMatchesReel =
    Boolean(phase.savedReelId) && Boolean(heroVideoEl?.src?.includes(String(phase.savedReelId).slice(0, 8)));

  phase.pass =
    phase.checks.previewAfterDrop &&
    phase.checks.noUploadBeforeAccept &&
    phase.checks.heroStorageSet &&
    phase.checks.uploadAfterAccept &&
    phase.checks.survivesReload;
  report.phases.hero = phase;
}

async function phase4BatchDelete(page) {
  const phase = { name: 'batchDelete', checks: {}, cases: {} };
  await unlockStudio(page);
  await openContentTab(page);

  for (let i = 0; i < 3; i++) {
    await dropMp4(page, '.video-vault-drop', `bg6a-del-${i}`);
    await sleep(5000);
  }

  const apiBefore = await fetchJson(`${FRONTEND}/api/reels`);
  phase.apiCountBeforeDelete = apiBefore.body?.length;

  const vaultSection = page.locator('.personal-media-grid').filter({ hasText: /MP4|Video Vault/i }).first();
  const checkboxes = vaultSection.locator('input[type="checkbox"]');
  const cbCount = await checkboxes.count();
  phase.checkboxCount = cbCount;

  const deleteRequests = [];
  page.on('request', (req) => {
    if (req.method() === 'DELETE' && (req.url().includes('/api/reels') || req.url().includes('/api/media/storage'))) {
      deleteRequests.push({ url: req.url(), method: req.method() });
    }
  });

  if (cbCount >= 2) {
    await checkboxes.nth(0).click({ force: true });
    await checkboxes.nth(1).click({ force: true });
    page.once('dialog', (d) => d.accept().catch(() => {}));
    const delSel = vaultSection.locator('button').filter({ hasText: /DELETE SELECTED/i }).first();
    if (await delSel.count()) {
      await delSel.click({ timeout: 8000 }).catch((e) => {
        phase.deleteSelectedError = String(e.message);
      });
      await sleep(3000);
    }
  }
  phase.deleteSelectedRequests = [...deleteRequests];

  const apiMid = await fetchJson(`${FRONTEND}/api/reels`);
  phase.apiCountAfterSelected = apiMid.body?.length;

  page.once('dialog', (d) => d.accept().catch(() => {}));
  const delAll = vaultSection.locator('button').filter({ hasText: /DELETE ALL/i }).first();
  if (await delAll.count()) {
    await delAll.click({ timeout: 8000 }).catch((e) => {
      phase.deleteAllError = String(e.message);
    });
    await sleep(4000);
  }
  phase.deleteAllRequests = deleteRequests.filter(
    (r) => !phase.deleteSelectedRequests.includes(r)
  );

  const apiAfter = await fetchJson(`${FRONTEND}/api/reels`);
  phase.apiCountAfterAll = apiAfter.body?.length;

  phase.checks.deleteSelectedFired = phase.deleteSelectedRequests.length > 0 || phase.deleteSelectedError;
  phase.checks.apiCountChanged =
    phase.apiCountAfterSelected !== phase.apiCountBeforeDelete ||
    phase.apiCountAfterAll !== phase.apiCountBeforeDelete;
  phase.pass = phase.checkboxCount >= 2;
  report.phases.batchDelete = phase;
}

async function phase5SplitBrain(page) {
  const phase = { name: 'splitBrain', legacy: {} };
  const diag = await fetchJson(`${BACKEND}/api/media/storage/diagnostics`);
  phase.diagnostics = {
    split_brain_detected: diag.body?.split_brain_detected,
    missing: diag.body?.db_videos_missing_files
  };

  await page.goto(FRONTEND, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(2000);
  const domLegacy = await page.evaluate((legacyReels) => {
    const html = document.body?.innerHTML || '';
    return legacyReels.map((id) => ({
      id,
      inDom: html.includes(id),
      imgBroken: [...document.querySelectorAll(`img[src*="${id}"]`)].map((i) => ({
        src: i.src,
        naturalWidth: i.naturalWidth
      }))
    }));
  }, LEGACY_REELS);
  phase.domLegacy = domLegacy;

  for (const id of LEGACY_REELS) {
    phase.legacy[id] = {
      videoMp4: await headStatus(`${FRONTEND}/videos/${id}.mp4`),
      videoPng: await headStatus(`${FRONTEND}/videos/${id}.png`),
      thumbJpg: await headStatus(`${FRONTEND}/thumbs/${id}.jpg`),
      thumbPng: await headStatus(`${FRONTEND}/thumbs/${id}.png`)
    };
  }

  const api = await fetchJson(`${FRONTEND}/api/reels`);
  phase.legacyInApi = (api.body || [])
    .filter((r) => LEGACY_REELS.includes(r.id))
    .map((r) => ({ id: r.id, name: r.name, url: r.url, thumbnailUrl: r.thumbnailUrl }));

  phase.pass = true;
  report.phases.splitBrain = phase;
}

function classify(report) {
  const f = report.phases.feed || {};
  const v = report.phases.vault || {};
  const h = report.phases.hero || {};
  const b = report.phases.batchDelete || {};

  report.classification = {
    Feed: {
      pass: f.pass,
      fail: !f.pass,
      rootCause: f.pass
        ? 'Known reel in API; media proxied HTTP 200 via Netlify'
        : !f.checks?.cardInApi
          ? 'Reel absent from GET /api/reels feed source'
          : !f.checks?.videoReachable
            ? 'Media URL not reachable through Netlify proxy'
            : 'Reel in API but not rendered in public DOM (feed engine / render gate)'
    },
    'Vault Upload': {
      pass: v.checks?.appearsAfterUpload,
      fail: !v.checks?.appearsAfterUpload,
      rootCause: v.checks?.appearsAfterUpload
        ? 'POST /api/reels via vault drop succeeded'
        : 'Upload did not create new reel in API within timeout'
    },
    'Vault Persistence': {
      pass: v.checks?.survivesReload,
      fail: v.checks?.appearsAfterUpload && !v.checks?.survivesReload,
      rootCause: v.checks?.survivesReload
        ? 'Vault state restored from API/localStorage after reload'
        : v.checks?.appearsAfterUpload
          ? 'Reload lost vault entry — localStorage/API sync issue'
          : 'Not tested (upload failed)'
    },
    'Hero Upload': {
      pass: h.pass,
      fail: h.hasHeroSection && !h.pass,
      rootCause: h.pass
        ? 'Drop → preview → Accept & Replace Hero → canonical reel saved'
        : !h.hasHeroSection
          ? 'Hero replace section not found in studio UI'
          : !h.checks?.previewAfterDrop
            ? 'Preview did not appear after drop'
            : !h.checks?.noUploadBeforeAccept
              ? 'Upload started before Accept (regression)'
              : !h.checks?.heroStorageSet
                ? 'Accept did not persist reelforge_hero_reel'
                : 'Hero accept flow incomplete'
    },
    'Hero Persistence': {
      pass: h.checks?.survivesReload,
      fail: h.checks?.heroStorageSet && !h.checks?.survivesReload,
      rootCause: h.checks?.survivesReload
        ? 'reelforge_hero_reel survives browser reload'
        : h.checks?.heroStorageSet
          ? 'Reload lost canonical hero reel'
          : 'Not tested (accept flow failed)'
    },
    'Delete Selected': {
      pass: b.checks?.deleteSelectedFired && b.apiCountAfterSelected < b.apiCountBeforeDelete,
      fail: b.checkboxCount >= 2 && !(b.checks?.deleteSelectedFired && b.apiCountAfterSelected < b.apiCountBeforeDelete),
      rootCause:
        b.deleteSelectedRequests?.length > 0
          ? `DELETE calls: ${b.deleteSelectedRequests.map((r) => r.url).join(', ')}`
          : b.deleteSelectedError || 'Delete Selected button not clicked or no DELETE requests'
    },
    'Delete All': {
      pass: b.apiCountAfterAll < b.apiCountBeforeDelete,
      fail: b.checkboxCount >= 2 && b.apiCountAfterAll >= b.apiCountBeforeDelete,
      rootCause:
        b.apiCountAfterAll < b.apiCountBeforeDelete
          ? 'API reel count decreased after Delete All'
          : b.deleteAllError || 'Delete All did not reduce API catalog'
    }
  };
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  ensureTestMp4();

  const launch = { headless: true };
  if (fs.existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;

  const browser = await chromium.launch(launch);
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('[RENDER_GATE]') || t.includes('[syncFromVault]') || t.includes('[BATCH_') || t.includes('[HOME_FEED]')) {
      report.console.push({ level: msg.type(), text: t.slice(0, 500) });
    }
  });
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('/api/reels') || url.includes('/videos/') || url.includes('/thumbs/')) {
      report.network.push({ url: url.slice(0, 200), status: res.status() });
    }
  });

  try {
    await phase1Feed(page);
    await phase2Vault(page);
    await phase3Hero(page);
    await phase4BatchDelete(page);
    await phase5SplitBrain(page);
    classify(report);
  } catch (e) {
    report.fatalError = String(e.stack || e);
  } finally {
    await browser.close();
  }

  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${OUT}`);
  console.log(JSON.stringify(report.classification, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
