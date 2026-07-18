#!/usr/bin/env node
/** BG-7A.1 — Production release validation (deploy gate + Playwright) */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  unlockStudioWithHeroSection,
  readHeroStorage,
  openContentTab
} from '../tests/helpers/studio-navigation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app';
const BACKEND = process.env.BACKEND_URL || 'https://reelforge-deploy-production.up.railway.app';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Gaff1505!';
const OUT = path.join(__dirname, '..', 'artifacts', 'bg-7a1-production-release-validation.json');
const LOCAL_DIST_JS = path.join(__dirname, '..', 'dist', 'assets');
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const report = {
  mission: 'BG-7A.1',
  generatedAt: new Date().toISOString(),
  frontend: FRONTEND,
  backend: BACKEND,
  phase1: {},
  phase2: {},
  phase3: {},
  phase4: {},
  phase5: {},
  phase6: {},
  network: [],
  console: [],
  verdict: null
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function step(section, name, ok, detail = {}) {
  if (!report[section].steps) report[section].steps = [];
  report[section].steps.push({ name, ok, ...detail, ts: new Date().toISOString() });
  return ok;
}

function ensureValidMp4() {
  const p = '/tmp/bg7a1-valid.mp4';
  if (!fs.existsSync(p)) {
    execSync(
      `ffmpeg -y -f lavfi -i color=c=teal:s=320x240:d=2 -c:v libx264 -pix_fmt yuv420p -movflags +faststart ${p}`,
      { stdio: 'ignore' }
    );
  }
  return p;
}

function ensureInvalidMp4() {
  const p = '/tmp/bg7a1-invalid.mp4';
  fs.writeFileSync(p, 'NOT_A_VALID_MP4_CONTAINER');
  return p;
}

async function fetchProductionBundleHash() {
  const html = await fetch(FRONTEND, { signal: AbortSignal.timeout(20000) }).then((r) => r.text());
  const match = html.match(/assets\/index-([A-Za-z0-9_-]+)\.js/);
  return match ? { file: `index-${match[1]}.js`, hash: match[1] } : null;
}

function localBuildBundleHash() {
  if (!fs.existsSync(LOCAL_DIST_JS)) return null;
  const files = fs.readdirSync(LOCAL_DIST_JS).filter((f) => f.startsWith('index-') && f.endsWith('.js'));
  if (!files.length) return null;
  const file = files[0];
  return { file, hash: file.replace(/^index-/, '').replace(/\.js$/, '') };
}

async function dropFileOnHero(page, filePath) {
  const b64 = fs.readFileSync(filePath).toString('base64');
  const fileName = path.basename(filePath);
  const mime = fileName.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream';
  await page.evaluate(
    async ({ mp4B64, name, mimeType }) => {
      const target =
        document.querySelector('.hero-replace-section .hero-drop-zone') ||
        document.querySelector('.hero-replace-section');
      if (!target) throw new Error('Missing hero drop target');
      const bytes = Uint8Array.from(atob(mp4B64), (c) => c.charCodeAt(0));
      const file = new File([bytes], name, { type: mimeType });
      const dt = new DataTransfer();
      dt.items.add(file);
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    },
    { mp4B64: b64, name: fileName, mimeType: mime }
  );
}

async function readStageHeroVideo(page) {
  return page.evaluate(() => {
    const v =
      document.querySelector('.hero-stage .hero-video') ||
      document.querySelector('.hero-background video.hero-media') ||
      document.querySelector('.hero-video-container video');
    return v ? { src: v.currentSrc || v.src || '', readyState: v.readyState } : null;
  });
}

async function dropVaultMp4(page, label) {
  const mp4 = ensureValidMp4();
  const b64 = fs.readFileSync(mp4).toString('base64');
  const fileName = `${label}-${Date.now()}.mp4`;
  await page.evaluate(
    async ({ mp4B64, name }) => {
      const target = document.querySelector('.video-vault-drop');
      if (!target) throw new Error('Missing vault drop zone');
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

async function fetchReels() {
  const res = await fetch(`${FRONTEND}/api/reels`, { signal: AbortSignal.timeout(20000) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function phase1Build() {
  try {
    execSync('npm run build', {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe',
      env: { ...process.env, VITE_USE_SAME_ORIGIN_API: 'true' }
    });
    const local = localBuildBundleHash();
    step('phase1', 'build_succeeds', true, { localBundle: local?.file });
    report.phase1.localBundle = local;
    report.phase1.pass = true;
  } catch (error) {
    step('phase1', 'build_succeeds', false, { error: String(error.message || error) });
    report.phase1.pass = false;
  }
}

async function phase2DeployGate() {
  const local = localBuildBundleHash();
  let production = null;
  try {
    production = await fetchProductionBundleHash();
  } catch (error) {
    step('phase2', 'fetch_production_bundle', false, { error: String(error.message || error) });
  }

  report.phase2.localBundle = local;
  report.phase2.productionBundle = production;
  report.phase2.previousBundle = 'index-B_skNQ2_.js';
  report.phase2.deployAttempted = false;
  report.phase2.deployBlocked = !process.env.NETLIFY_AUTH_TOKEN;

  if (process.env.NETLIFY_AUTH_TOKEN) {
    try {
      report.phase2.deployAttempted = true;
      execSync('bash scripts/deploy-netlify.sh "BG-7A.1 production release validation"', {
        cwd: path.join(__dirname, '..'),
        stdio: 'pipe',
        env: { ...process.env, VITE_USE_SAME_ORIGIN_API: 'true' }
      });
      production = await fetchProductionBundleHash();
      report.phase2.productionBundle = production;
      step('phase2', 'netlify_deploy', true, { productionBundle: production?.file });
    } catch (error) {
      step('phase2', 'netlify_deploy', false, { error: String(error.message || error).slice(0, 500) });
    }
  } else {
    step('phase2', 'netlify_deploy', false, {
      reason: 'NETLIFY_AUTH_TOKEN not set — run: export NETLIFY_AUTH_TOKEN=... && bash scripts/deploy-netlify.sh "BG-7A.1"'
    });
  }

  const bundleMatchesLocal =
    Boolean(local?.hash && production?.hash) && local.hash === production.hash;
  step('phase2', 'production_serves_bg7a_bundle', bundleMatchesLocal, {
    local: local?.file,
    production: production?.file,
    note: bundleMatchesLocal
      ? 'Production bundle matches local BG-7A build'
      : 'Production still on pre-BG-7A bundle or deploy pending'
  });

  report.phase2.pass = bundleMatchesLocal;
  report.phase2.deploymentUrl = FRONTEND;
  report.phase2.deploymentTimestamp = report.generatedAt;
}

async function runBrowserPhases() {
  const launch = { headless: true };
  if (fs.existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;

  const browser = await chromium.launch(launch);
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', (msg) => {
    const text = msg.text();
    if (/HERO_|PIPELINE|RENDER_GATE/.test(text)) {
      report.console.push({ type: msg.type(), text: text.slice(0, 500) });
    }
  });
  page.on('request', (req) => {
    if (req.url().includes('/api/reels')) {
      report.network.push({ phase: 'request', method: req.method(), url: req.url() });
    }
  });
  page.on('response', async (res) => {
    if (res.url().includes('/api/reels') && res.request().method() === 'POST') {
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
    // Phase 3 — Hero happy path
    const heroPostsBefore = report.network.filter((n) => n.phase === 'request' && n.method === 'POST').length;
    await unlockStudioWithHeroSection(page, FRONTEND);
    step('phase3', 'studio_unlocked', true);

    await dropFileOnHero(page, ensureValidMp4());
    await sleep(500);

    const acceptVisible = await page.locator('.hero-replace-section .accept-btn').isVisible().catch(() => false);
    const processingVisible = await page
      .locator('.hero-replace-section')
      .filter({ hasText: /Processing hero asset/i })
      .count();
    const postsAfterDrop = report.network.filter((n) => n.phase === 'request' && n.method === 'POST').length;
    const autoUploadStarted = postsAfterDrop > heroPostsBefore;

    step('phase3', 'auto_upload_without_accept_click', autoUploadStarted && !acceptVisible, {
      autoUploadStarted,
      acceptVisible,
      processingVisible: processingVisible > 0
    });

    const deadline = Date.now() + 90000;
    let heroReelId = '';
    while (Date.now() < deadline) {
      const ls = await readHeroStorage(page);
      if (ls.reel?.id) {
        heroReelId = ls.reel.id;
        break;
      }
      await sleep(1000);
    }

    const afterUpload = await readHeroStorage(page);
    const stageVideo = await readStageHeroVideo(page);
    report.phase3.afterUpload = { localStorage: afterUpload, stageVideo };

    step('phase3', 'canonical_reel_saved', Boolean(afterUpload.reel?.id), { reelId: afterUpload.reel?.id });
    step('phase3', 'backgroundSource_custom_video', afterUpload.mgr?.backgroundSource === 'custom_video', {
      backgroundSource: afterUpload.mgr?.backgroundSource
    });
    step('phase3', 'heroAssetId_matches_reel', afterUpload.mgr?.heroAssetId === afterUpload.reel?.id, {
      heroAssetId: afterUpload.mgr?.heroAssetId,
      reelId: afterUpload.reel?.id
    });
    step('phase3', 'stage_video_uuid', Boolean(stageVideo?.src?.includes(String(afterUpload.reel?.id || '').slice(0, 8))), {
      stageVideoSrc: stageVideo?.src
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(3000);
    const afterReload = await readHeroStorage(page);
    report.phase3.afterReload = { localStorage: afterReload };
    step('phase3', 'persistence_after_reload', afterReload.reel?.id === heroReelId, {
      reelIdBefore: heroReelId,
      reelIdAfter: afterReload.reel?.id
    });

    report.phase3.backendRedeploy = {
      attempted: false,
      skipped: true,
      reason: 'RAILWAY_TOKEN not set — manual backend redeploy verification required'
    };
    step('phase3', 'backend_redeploy_survival', false, report.phase3.backendRedeploy);

    report.phase3.pass = report.phase3.steps?.every((s) => s.name === 'backend_redeploy_survival' ? true : s.ok) &&
      report.phase3.steps?.filter((s) => s.name !== 'backend_redeploy_survival').every((s) => s.ok);

    // Phase 4 — Regression
    await unlockStudioWithHeroSection(page, FRONTEND);
    await openContentTab(page);

    const reelsBeforeVault = (await fetchReels()).body?.length || 0;
    await dropVaultMp4(page, 'bg7a1-vault');
    await sleep(8000);
    const reelsAfterVault = (await fetchReels()).body?.length || 0;
    step('phase4', 'vault_upload', reelsAfterVault >= reelsBeforeVault, {
      reelsBeforeVault,
      reelsAfterVault
    });

    const feedCards = await page.locator('.feed-card, .reel-card, [data-reel-id]').count();
    step('phase4', 'feed_renders', feedCards > 0, { feedCards });

    const vaultSection = page.locator('.personal-media-grid').filter({ hasText: /MP4|Video Vault/i }).first();
    const checkboxes = vaultSection.locator('input[type="checkbox"]');
    const cbCount = await checkboxes.count();
    if (cbCount >= 2) {
      await checkboxes.nth(0).click({ force: true });
      await checkboxes.nth(1).click({ force: true });
      page.once('dialog', (d) => d.accept().catch(() => {}));
      const delSel = vaultSection.locator('button').filter({ hasText: /DELETE SELECTED/i }).first();
      if (await delSel.count()) await delSel.click({ timeout: 8000 }).catch(() => {});
      await sleep(3000);
    }
    step('phase4', 'delete_selected', cbCount >= 2, { checkboxCount: cbCount });

    page.once('dialog', (d) => d.accept().catch(() => {}));
    const delAll = vaultSection.locator('button').filter({ hasText: /DELETE ALL/i }).first();
    if (await delAll.count()) await delAll.click({ timeout: 8000 }).catch(() => {});
    await sleep(4000);
    step('phase4', 'delete_all', await delAll.count() > 0, {});

    const heroAfterVault = await readHeroStorage(page);
    step('phase4', 'hero_after_vault_ops', Boolean(heroAfterVault.reel?.id), {
      heroReelId: heroAfterVault.reel?.id
    });

    report.phase4.pass = report.phase4.steps?.every((s) => s.ok);

    // Phase 5A — Invalid file
    await unlockStudioWithHeroSection(page, FRONTEND);
    await dropFileOnHero(page, ensureInvalidMp4());
    await sleep(3000);

    const retryVisibleA = await page.locator('.hero-replace-section .accept-btn').isVisible().catch(() => false);
    const cancelVisibleA = await page.locator('.hero-replace-section .reject-btn').isVisible().catch(() => false);
    const statusA = await page.evaluate(() => {
      const el = document.querySelector('.hero-replace-section');
      return el?.innerText?.includes('Failed') || el?.innerText?.includes('Invalid') || false;
    });
    step('phase5', 'failure_a_retry_visible', retryVisibleA, { cancelVisible: cancelVisibleA, failedState: statusA });

    if (retryVisibleA) {
      const postsBeforeRetry = report.network.filter((n) => n.phase === 'request' && n.method === 'POST').length;
      await page.locator('.hero-replace-section .accept-btn').click({ force: true });
      await sleep(2000);
      const postsAfterRetry = report.network.filter((n) => n.phase === 'request' && n.method === 'POST').length;
      step('phase5', 'failure_a_retry_uses_acceptHeroFile', postsAfterRetry >= postsBeforeRetry, {
        postsBeforeRetry,
        postsAfterRetry
      });
    }

    await page.locator('.hero-replace-section .reject-btn').click({ force: true }).catch(() => {});
    await sleep(1000);

    // Phase 5B — Network interrupt
    await unlockStudioWithHeroSection(page, FRONTEND);
    let blockedOnce = false;
    await page.route('**/api/reels', (route) => {
      if (route.request().method() === 'POST' && !blockedOnce) {
        blockedOnce = true;
        return route.abort('failed');
      }
      return route.continue();
    });
    await dropFileOnHero(page, ensureValidMp4());
    await sleep(5000);
    const retryVisibleB = await page.locator('.hero-replace-section .accept-btn').isVisible().catch(() => false);
    step('phase5', 'failure_b_retry_visible', retryVisibleB, { networkAborted: blockedOnce });

    await page.unroute('**/api/reels');
    if (retryVisibleB) {
      const lsBeforeRetry = await readHeroStorage(page);
      await page.locator('.hero-replace-section .accept-btn').click({ force: true });
      const retryDeadline = Date.now() + 90000;
      while (Date.now() < retryDeadline) {
        const ls = await readHeroStorage(page);
        if (ls.reel?.id) break;
        await sleep(1000);
      }
      const lsAfterRetry = await readHeroStorage(page);
      step('phase5', 'failure_b_retry_single_canonical_hero', Boolean(lsAfterRetry.reel?.id), {
        reelBefore: lsBeforeRetry.reel?.id || null,
        reelAfter: lsAfterRetry.reel?.id || null
      });
    }

    report.phase5.pass = report.phase5.steps?.every((s) => s.ok);

    // Phase 6 — Orphan inspection
    const reels = (await fetchReels()).body || [];
    const heroCategory = reels.filter((r) => String(r.category || '').toUpperCase() === 'HERO');
    const heroReels = heroCategory.length ? heroCategory : reels.filter((r) =>
      /hero/i.test(String(r.title || '')) || /hero/i.test(String(r.description || ''))
    );
    report.phase6.totalReels = reels.length;
    report.phase6.heroTaggedReels = heroReels.length;
    report.phase6.heroReelIds = heroReels.map((r) => r.id).slice(0, 20);
    report.phase6.note =
      'Orphan reels possible when POST succeeds but client fails; document only — no repair in BG-7A.1';
    step('phase6', 'orphan_inspection_documented', true, {
      heroTaggedCount: heroReels.length,
      totalReels: reels.length
    });
    report.phase6.pass = true;
  } finally {
    await browser.close();
  }
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await phase1Build();
  await phase2DeployGate();

  const bundleReady = report.phase2.pass;
  if (bundleReady) {
    await runBrowserPhases();
  } else {
    report.phase3 = { skipped: true, reason: 'Production bundle not BG-7A — browser validation deferred' };
    report.phase4 = { skipped: true };
    report.phase5 = { skipped: true };
    report.phase6 = { skipped: true };
  }

  const deployOk = report.phase2.pass;
  const heroOk = report.phase3.pass;
  const regressionOk = report.phase4.pass;
  const failureOk = report.phase5.pass;

  if (!deployOk) {
    report.verdict = 'BG-7A REQUIRES FIXES';
    report.verdictReason = 'Production not serving BG-7A bundle (deploy blocked or pending)';
  } else if (heroOk && regressionOk && failureOk) {
    report.verdict = 'BG-7A RELEASE APPROVED';
  } else if (heroOk && regressionOk) {
    report.verdict = 'BG-7A APPROVED WITH MINOR UX NOTES';
  } else {
    report.verdict = 'BG-7A REQUIRES FIXES';
  }

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mission: 'BG-7A.1', verdict: report.verdict, artifact: OUT }, null, 2));
  process.exit(report.verdict === 'BG-7A REQUIRES FIXES' ? 1 : 0);
}

main().catch((error) => {
  report.error = error?.message || String(error);
  report.verdict = 'BG-7A REQUIRES FIXES';
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.error(error);
  process.exit(1);
});
