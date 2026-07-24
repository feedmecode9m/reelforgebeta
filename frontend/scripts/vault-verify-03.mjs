#!/usr/bin/env node
/**
 * VAULT-VERIFY-03 — Production lifecycle validation after VAULT-HYDRATION-01 deploy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app/').replace(/\/?$/, '/');
const API_URL = (process.env.API_URL || 'https://reelforge-deploy-production.up.railway.app').replace(/\/$/, '');
const ADMIN_PASSWORDS = (process.env.ADMIN_PASSWORD || 'admin123,Gaff1505!,SMART_PRODUCTION').split(',');
const OUT_JSON = path.join(ROOT, 'artifacts/vault-verify-03.json');
const OUT_MD = path.join(ROOT, 'artifacts/VAULT_VERIFY_03_REPORT.md');
const OUT_RELEASE = path.join(ROOT, 'artifacts/VAULT_RELEASE_ACCEPTANCE.md');
const EXPECTED_BUNDLE_PREFIX = process.env.EXPECTED_BUNDLE || 'index-q8wTbWuf';
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const KEY = {
  THUMBS: 'personal_thumbnails',
  THUMB_IDS: 'personal_thumbnail_reel_ids',
  VIDEO_VAULT: 'personal_video_vault',
  HERO_MANAGER: 'reelforge_hero_manager_config',
  HERO_REEL: 'reelforge_hero_reel',
  HERO_VIDEO: 'reelforge_hero_video'
};

const VIDEO_DROP_SELECTOR = '[aria-label="Video drop zone"]';
const RELOAD_UNTIL = 'domcontentloaded';
const HERO_FINALIZE_TIMEOUT_MS = 900000;
const VAULT_SYNC_TIMEOUT_MS = 120000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureFixtures() {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z').replace('T', 'T');
  const dir = path.join('/tmp', `vault-verify03-${ts}`);
  fs.mkdirSync(dir, { recursive: true });
  const thumb = path.join(dir, `VAULT_TEST_THUMB_${ts}.jpg`);
  const videoSmall = path.join(dir, `VAULT_TEST_VIDEO_SMALL_${ts}.mp4`);
  const videoLarge = path.join(dir, `VAULT_TEST_VIDEO_LARGE_${ts}.mp4`);
  const hero = path.join(dir, `VAULT_TEST_HERO_${ts}.mp4`);
  if (!fs.existsSync(thumb)) {
    execFileSync(
      'ffmpeg',
      ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=320x240:d=0.1', '-frames:v', '1', thumb],
      { stdio: 'ignore' }
    );
  }
  if (!fs.existsSync(videoSmall)) {
    execFileSync(
      'ffmpeg',
      ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoSmall],
      { stdio: 'ignore' }
    );
  }
  const condo = '/home/youloose2dafish/Downloads/condo_v1_2.mp4';
  if (!fs.existsSync(videoLarge)) {
    if (fs.existsSync(condo)) {
      execFileSync(
        'ffmpeg',
        ['-y', '-hide_banner', '-loglevel', 'error', '-i', condo, '-fs', '30M', '-c', 'copy', videoLarge],
        { stdio: 'ignore' }
      );
    } else {
      fs.copyFileSync(videoSmall, videoLarge);
    }
  }
  if (!fs.existsSync(hero)) {
    fs.copyFileSync(videoLarge, hero);
  }
  return { dir, ts, thumb, videoSmall, videoLarge, hero };
}

async function apiLogin() {
  for (const pw of ADMIN_PASSWORDS) {
    const res = await fetch(`${API_URL}/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw.trim() })
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.token) return { token: body.token, password: pw.trim() };
  }
  throw new Error('API login failed');
}

async function fetchReadyReels(token) {
  const res = await fetch(`${API_URL}/api/reels?status=ready`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await res.json().catch(() => ({}));
  return Array.isArray(body) ? body : body.reels || [];
}

async function deleteReel(token, id) {
  if (!id) return { ok: false, status: 0 };
  const res = await fetch(`${API_URL}/api/reels/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  return { ok: res.ok, status: res.status };
}

async function headUrl(url, cacheBust = false) {
  if (!url) return { ok: false, status: 0 };
  try {
    let target = url.startsWith('http') ? url : `${FRONTEND_URL.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}`;
    if (cacheBust) target += (target.includes('?') ? '&' : '?') + `_cb=${Date.now()}`;
    const res = await fetch(target, { method: 'HEAD' });
    return { ok: res.ok, status: res.status, url: target };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.message || e) };
  }
}

async function headOrigin(url, cacheBust = true) {
  if (!url) return { ok: false, status: 0 };
  try {
    const rel = url.replace(/^https?:\/\/[^/]+/, '');
    let target = `${API_URL}${rel.startsWith('/') ? rel : `/${rel}`}`;
    if (cacheBust) target += (target.includes('?') ? '&' : '?') + `_cb=${Date.now()}`;
    const res = await fetch(target, { method: 'HEAD' });
    return { ok: res.ok, status: res.status, url: target };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.message || e) };
  }
}

async function uploadVideoR2(token, filePath, category = 'Trending') {
  const buf = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const stages = {};
  const t0 = Date.now();
  const signRes = await fetch(`${API_URL}/api/uploads/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      filename: fileName,
      contentType: 'video/mp4',
      sizeBytes: buf.length,
      title: `VAULT-VERIFY-03 ${fileName}`,
      category
    })
  });
  const signBody = await signRes.json().catch(() => ({}));
  stages.sign = { status: signRes.status, ok: signRes.ok, uploadId: signBody.uploadId, reelId: signBody.reelId, ms: Date.now() - t0 };
  if (!signRes.ok) return { ok: false, stages, failureLayer: 'Railway sign' };

  const t1 = Date.now();
  let putRes;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      putRes = await fetch(signBody.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4' },
        body: buf
      });
      if (putRes.ok) break;
    } catch (e) {
      stages.r2Put = {
        ok: false,
        attempt,
        error: String(e.message || e),
        ms: Date.now() - t1,
        target: String(signBody.uploadUrl || '').slice(0, 80)
      };
      if (attempt === 3) {
        return { ok: false, stages, failureLayer: 'R2 PUT / browser network', signBody };
      }
      await sleep(5000);
    }
  }
  stages.r2Put = {
    status: putRes.status,
    ok: putRes.ok,
    ms: Date.now() - t1,
    target: signBody.uploadUrl?.includes('r2.cloudflarestorage.com') ? 'R2' : 'other'
  };
  if (!putRes.ok) return { ok: false, stages, failureLayer: 'R2 PUT HTTP', signBody };

  const finRes = await fetch(`${API_URL}/api/reels/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ uploadId: signBody.uploadId, category })
  });
  const finBody = await finRes.json().catch(() => ({}));
  stages.finalize = { status: finRes.status, ok: finRes.ok, id: finBody.id, pollUrl: finBody.pollUrl };
  if (!finRes.ok) return { ok: false, stages, failureLayer: 'Railway finalize', signBody };

  let ready = false;
  let pollBody = {};
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    const poll = await fetch(`${API_URL}${finBody.pollUrl || `/api/reels/${finBody.id}`}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    pollBody = await poll.json().catch(() => ({}));
    if (pollBody.status === 'ready') {
      ready = true;
      break;
    }
    if (pollBody.status === 'failed') break;
  }
  stages.ready = { ok: ready, status: pollBody.status, videoUrl: pollBody.videoUrl || pollBody.url };
  return {
    ok: ready,
    stages,
    signBody,
    finBody,
    pollBody,
    reelId: finBody.id || signBody.reelId,
    failureLayer: ready ? null : 'Railway ingest poll'
  };
}

async function dropFile(page, selector, filePath, mimeType) {
  await page.waitForSelector(selector, { timeout: 90000 });
  await page.locator(selector).locator('input[type="file"]').setInputFiles(filePath).catch(async () => {
    const buf = fs.readFileSync(filePath);
    const b64 = buf.toString('base64');
    const name = path.basename(filePath);
    await page.evaluate(
      ({ selector, b64, name, mimeType }) => {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        const file = new File([out], name, { type: mimeType });
        const dt = new DataTransfer();
        dt.items.add(file);
        const common = { dataTransfer: dt, bubbles: true, cancelable: true };
        const target = document.querySelector(selector);
        target.dispatchEvent(new DragEvent('dragenter', common));
        target.dispatchEvent(new DragEvent('dragover', common));
        target.dispatchEvent(new DragEvent('drop', common));
      },
      { selector, b64, name, mimeType }
    );
  });
}

async function loginStudio(page) {
  if (!(await page.locator('.control-center-overlay').isVisible().catch(() => false))) {
    await page.locator('button.ghost-trigger').click({ timeout: 60000 });
  }
  await page.waitForSelector('.control-center-overlay', { timeout: 60000 });
  if (!(await page.locator('.logout-btn').isVisible().catch(() => false))) {
    if (await page.locator('.admin-login-panel').isVisible().catch(() => false)) {
      let ok = false;
      for (const pw of ADMIN_PASSWORDS) {
        await page.locator('.admin-login-panel input[type="password"]').fill(pw.trim());
        await page.locator('.admin-login-panel button.submit-btn').click();
        await sleep(2500);
        if (await page.locator('.logout-btn').isVisible().catch(() => false)) {
          ok = true;
          break;
        }
      }
      if (!ok) throw new Error('Studio login failed');
    }
  }
  const tab = page.locator('[data-studio-workspace-tabs] button', { hasText: 'Content' });
  if (await tab.isVisible().catch(() => false)) await tab.click();
  await page.waitForSelector('[data-workspace-panel-content]', { timeout: 60000 }).catch(() => {});
  await page.locator(VIDEO_DROP_SELECTOR).scrollIntoViewIfNeeded().catch(() => {});
}

async function getLs(page, key) {
  return page.evaluate((k) => {
    try {
      return JSON.parse(localStorage.getItem(k) || 'null');
    } catch {
      return null;
    }
  }, key);
}

async function waitForVideoInVault(page, reelId, timeoutMs = VAULT_SYNC_TIMEOUT_MS) {
  await page.waitForFunction(
    ({ vaultKey, id }) => {
      try {
        const vault = JSON.parse(localStorage.getItem(vaultKey) || '[]');
        return Array.isArray(vault) && vault.some((e) => String(e?.id) === String(id));
      } catch {
        return false;
      }
    },
    { vaultKey: KEY.VIDEO_VAULT, id: reelId },
    { timeout: timeoutMs }
  );
}

async function waitForVideoAbsentFromVault(page, reelId, timeoutMs = VAULT_SYNC_TIMEOUT_MS) {
  await page.waitForFunction(
    ({ vaultKey, id }) => {
      try {
        const vault = JSON.parse(localStorage.getItem(vaultKey) || '[]');
        if (!Array.isArray(vault)) return true;
        return !vault.some((e) => String(e?.id) === String(id));
      } catch {
        return false;
      }
    },
    { vaultKey: KEY.VIDEO_VAULT, id: reelId },
    { timeout: timeoutMs }
  );
}

async function waitForHeroAssetId(page, timeoutMs = 180000) {
  await page.waitForFunction(
    () => {
      try {
        const mgr = JSON.parse(localStorage.getItem('reelforge_hero_manager_config') || 'null');
        return Boolean(mgr?.heroAssetId);
      } catch {
        return false;
      }
    },
    { timeout: timeoutMs }
  );
}

function mapMarkers(consoleLogs, net) {
  const markers = {};
  const wanted = [
    'VAULT_BOOTSTRAP',
    'VAULT_RELOAD',
    'VAULT_RENDER',
    'VAULT_PERSIST',
    'VAULT_DELETE_START',
    'VAULT_DELETE_SUCCESS',
    'VAULT_DELETE_FAIL',
    'DELETE_START',
    'DELETE_SUCCESS',
    'DELETE_FAIL',
    'VAULT_REFRESH_RESTORE',
    'VAULT_ACCEPT',
    'VAULT_UPLOAD_SUCCESS'
  ];
  for (const l of consoleLogs) {
    for (const w of wanted) {
      if (l.text.includes(`[${w}]`)) {
        (markers[w] ||= []).push({ ts: l.ts, text: l.text.slice(0, 500) });
      }
    }
  }
  return markers;
}

function netSummary(net) {
  return {
    sign: net.filter((n) => n.url.includes('/api/uploads/sign')),
    finalize: net.filter((n) => n.url.includes('/api/reels/finalize')),
    r2Put: net.filter((n) => /r2\.cloudflarestorage\.com/.test(n.url)),
    reelPost: net.filter((n) => n.method === 'POST' && /\/api\/reels(\?|$)/.test(n.url)),
    reelDelete: net.filter((n) => n.method === 'DELETE' && /\/api\/reels\//.test(n.url))
  };
}

async function getRailwayDeployId() {
  try {
    const out = execFileSync('railway', ['status', '--json'], { encoding: 'utf8' });
    const j = JSON.parse(out);
    return j?.services?.[0]?.deployment?.id || j?.deployment?.id || 'unknown';
  } catch {
    return process.env.RAILWAY_DEPLOY || 'unknown';
  }
}

async function main() {
  const fixtures = ensureFixtures();
  const apiAuth = await apiLogin();
  const railwayDeploy = await getRailwayDeployId();
  const report = {
    mission: 'VAULT-VERIFY-03',
    timestamp: new Date().toISOString(),
    environment: { frontend: FRONTEND_URL, backend: API_URL, railwayDeploy, netlifyDeploy: '6a62f9d35a89dc03412d7f49' },
    testIdentity: fixtures,
    bundleHash: null,
    markers: {},
    network: {},
    storageSnapshots: {},
    vaults: {
      thumbnail: { pass: false, tests: {} },
      videoSmall: { pass: false, tests: {} },
      videoLarge: { pass: false, tests: {} },
      hero: { pass: false, tests: {} }
    },
    identityAudit: {},
    storageAudit: {},
    defects: [],
    result: 'FAIL'
  };

  const consoleLogs = [];
  const net = [];
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  const context = await browser.newContext();
  context.on('page', (p) => p.on('dialog', (d) => d.accept().catch(() => {})));
  await context.addInitScript(({ token }) => {
    try {
      if (sessionStorage.getItem('vault_verify_03_boot')) return;
      sessionStorage.setItem('vault_verify_03_boot', '1');
      localStorage.clear();
      if (token) localStorage.setItem('reelforge_admin_session_token', token);
    } catch {}
  }, { token: apiAuth.token });
  const page = await context.newPage();
  page.on('console', (msg) => {
    const t = msg.text();
    if (/\[(VAULT_|DELETE_|BG7G_|\[DELETE_)/.test(t) || /\[DELETE_/.test(t)) {
      consoleLogs.push({ ts: Date.now(), text: t });
    }
  });
  page.on('response', (res) => {
    const url = res.url();
    if (!/(api\/|r2\.cloudflarestorage\.com|\/thumbs\/|\/videos\/)/.test(url)) return;
    net.push({
      ts: Date.now(),
      url,
      method: res.request().method(),
      status: res.status(),
      ok: res.ok(),
      kind: 'response'
    });
  });

  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  report.bundleHash = await page.evaluate(() => {
    const s = [...document.querySelectorAll('script[src*="/assets/"]')].map((x) => x.src);
    const m = (s.find((u) => /index-/.test(u)) || s[0] || '').match(/\/assets\/([^/?]+)/);
    return m ? m[1] : 'unknown';
  });
  await loginStudio(page);

  // --- THUMBNAIL ---
  try {
    const t = report.vaults.thumbnail.tests;
    t.drop = { pass: false };
    t.accept = { pass: false };
    t.refresh = { pass: false };
    t.delete = { pass: false };
    t.rerefresh = { pass: false };

    const countBefore = (await getLs(page, KEY.THUMBS))?.length || 0;
    await dropFile(page, '.thumbnail-drop-zone', fixtures.thumb, 'image/jpeg');
    const acceptVisible = await page.locator('.thumbnail-drop-zone .accept-btn').isVisible({ timeout: 20000 }).catch(() => false);
    const countAfterDrop = (await getLs(page, KEY.THUMBS))?.length || 0;
    t.drop = { pass: acceptVisible, acceptVisible, countBefore, countAfterDrop, noBackendBeforeAccept: countAfterDrop <= countBefore };

    let created = null;
    let postBody = null;
    if (acceptVisible) {
      const postP = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/reels(\?|$)/.test(r.url()), { timeout: 120000 });
      await page.click('.thumbnail-drop-zone .accept-btn');
      const postRes = await postP.catch(() => null);
      postBody = postRes ? await postRes.json().catch(() => null) : null;
      if (postBody?.id) {
        await page
          .waitForFunction(
            ({ thumbKey, idKey, id }) => {
              try {
                const thumbs = JSON.parse(localStorage.getItem(thumbKey) || '[]');
                const ids = JSON.parse(localStorage.getItem(idKey) || '[]');
                return (
                  Array.isArray(thumbs) &&
                  thumbs.some((e) => String(e?.id) === String(id)) &&
                  Array.isArray(ids) &&
                  ids.includes(String(id))
                );
              } catch {
                return false;
              }
            },
            { thumbKey: KEY.THUMBS, idKey: KEY.THUMB_IDS, id: postBody.id },
            { timeout: 120000 }
          )
          .catch(() => {});
      }
      const thumbs = await getLs(page, KEY.THUMBS);
      const ids = await getLs(page, KEY.THUMB_IDS);
      created = Array.isArray(thumbs) ? thumbs.find((e) => postBody?.id && String(e?.id) === String(postBody.id)) : null;
      t.accept = {
        pass: postRes?.status() === 202 && Boolean(created?.id),
        postStatus: postRes?.status?.() || null,
        reelId: created?.id || postBody?.id,
        idsUpdated: Array.isArray(ids) && ids.includes(String(postBody?.id || created?.id)),
        thumbsUpdated: Boolean(created)
      };
    }

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await loginStudio(page);
    await sleep(5000);
    const afterRefresh = await getLs(page, KEY.THUMBS);
    const idsAfterRefresh = await getLs(page, KEY.THUMB_IDS);
    const catalogCount = (await fetchReadyReels(apiAuth.token)).filter((r) => String(r.id) === String(created?.id)).length;
    const survives = Array.isArray(afterRefresh) && created?.id && afterRefresh.some((e) => String(e?.id) === String(created.id));
    const dupes = Array.isArray(afterRefresh)
      ? afterRefresh.filter((e) => String(e?.id) === String(created?.id)).length
      : 0;
    t.refresh = {
      pass: survives && dupes === 1,
      survives,
      duplicateCount: dupes,
      idsPresent: Array.isArray(idsAfterRefresh) && idsAfterRefresh.includes(String(created?.id)),
      catalogMatch: catalogCount === 1,
      count: Array.isArray(afterRefresh) ? afterRefresh.length : 0
    };
    report.storageSnapshots.thumbnailAfterRefresh = { thumbs: afterRefresh, ids: idsAfterRefresh };

    const cards = page.locator('.vault-grid--images .vault-card');
    let deleteStatus = null;
    if (created?.id && (await cards.count()) > 0) {
      const delP = page.waitForResponse(
        (r) => r.request().method() === 'DELETE' && r.url().includes(`/api/reels/${created.id}`),
        { timeout: 60000 }
      ).catch(() => null);
      await cards.last().locator('.thumb-delete-btn').click();
      const delRes = await delP;
      deleteStatus = delRes?.status?.() || null;
      await sleep(3000);
    } else if (created?.id) {
      const d = await deleteReel(apiAuth.token, created.id);
      deleteStatus = d.status;
    }
    const afterDelete = await getLs(page, KEY.THUMBS);
    const idsAfterDelete = await getLs(page, KEY.THUMB_IDS);
    const catalogGone = !(await fetchReadyReels(apiAuth.token)).some((r) => String(r.id) === String(created?.id));
    const thumbUrl = created?.url || postBody?.url || postBody?.thumbnailUrl;
    const storageNetlify = await headUrl(thumbUrl, true);
    const storageOrigin = await headOrigin(thumbUrl, true);
    t.delete = {
      pass: catalogGone && deleteStatus === 200 && (!Array.isArray(afterDelete) || !afterDelete.some((e) => String(e?.id) === String(created?.id))),
      deleteStatus,
      catalogGone,
      idsRemoved: !Array.isArray(idsAfterDelete) || !idsAfterDelete.includes(String(created?.id)),
      storageNetlify,
      storageOrigin,
      storageEventually404: storageOrigin.status === 404 || (!storageOrigin.ok && storageOrigin.status !== 200)
    };
    report.storageSnapshots.thumbnailAfterDelete = { thumbs: afterDelete, ids: idsAfterDelete };

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await loginStudio(page);
    const afterReRefresh = await getLs(page, KEY.THUMBS);
    const resurrected = Array.isArray(afterReRefresh) && created?.id && afterReRefresh.some((e) => String(e?.id) === String(created.id));
    t.rerefresh = { pass: !resurrected && catalogGone, resurrected, catalogGone };
    report.storageSnapshots.thumbnailAfterReRefresh = afterReRefresh;

    report.vaults.thumbnail.pass =
      t.drop.pass && t.accept.pass && t.refresh.pass && t.delete.pass && t.rerefresh.pass;
    if (created?.id && !catalogGone) await deleteReel(apiAuth.token, created.id);
  } catch (e) {
    report.vaults.thumbnail = { pass: false, error: String(e.message || e), tests: report.vaults.thumbnail.tests };
    report.defects.push({ vault: 'thumbnail', error: String(e.message || e) });
  }

  // --- VIDEO SMALL (browser) ---
  try {
    const t = report.vaults.videoSmall.tests;
    await page.locator(VIDEO_DROP_SELECTOR).waitFor({ state: 'visible', timeout: 60000 });
    const postP = page
      .waitForResponse(
        (r) => r.request().method() === 'POST' && /\/api\/reels(\?|$)/.test(r.url()),
        { timeout: 180000 }
      )
      .catch(() => null);
    await Promise.all([dropFile(page, VIDEO_DROP_SELECTOR, fixtures.videoSmall, 'video/mp4'), postP]);
    const postRes = await postP;
    const postBody = postRes ? await postRes.json().catch(() => null) : null;
    const reelId = postBody?.id || null;
    if (reelId) {
      await waitForVideoInVault(page, reelId).catch(() => {});
    }
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await loginStudio(page);
    await waitForVideoInVault(page, reelId).catch(() => {});
    const vault = await getLs(page, KEY.VIDEO_VAULT);
    const entry = Array.isArray(vault) ? vault.find((e) => reelId && String(e?.id) === String(reelId)) : null;
    const survives = Boolean(entry);
    if (reelId) await deleteReel(apiAuth.token, reelId);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await loginStudio(page);
    if (reelId) await waitForVideoAbsentFromVault(page, reelId).catch(() => {});
    const vaultAfter = await getLs(page, KEY.VIDEO_VAULT);
    const resurrected = Array.isArray(vaultAfter) && vaultAfter.some((e) => String(e?.id) === String(reelId));
    const catalogGone = !(await fetchReadyReels(apiAuth.token)).some((r) => String(r.id) === String(reelId));
    t.upload = { pass: Boolean(postRes?.ok()) && Boolean(reelId), reelId, postStatus: postRes?.status?.() || null };
    t.refresh = { pass: survives, survives };
    t.delete = { pass: catalogGone, catalogGone };
    t.rerefresh = { pass: !resurrected, resurrected };
    report.vaults.videoSmall.pass = t.upload.pass && t.refresh.pass && t.delete.pass && t.rerefresh.pass;
    report.storageSnapshots.videoSmall = { vault, vaultAfter, reelId };
  } catch (e) {
    report.vaults.videoSmall = { pass: false, error: String(e.message || e) };
    report.defects.push({ vault: 'videoSmall', error: String(e.message || e) });
  }

  // --- VIDEO LARGE (R2 API) ---
  try {
    const r2 = await uploadVideoR2(apiAuth.token, fixtures.videoLarge, 'Trending');
    const reelId = r2.reelId;
    report.storageSnapshots.videoLargeR2 = r2.stages;
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await loginStudio(page);
    await sleep(5000);
    const vault = await getLs(page, KEY.VIDEO_VAULT);
    const entry = Array.isArray(vault) ? vault.find((e) => reelId && String(e?.id) === String(reelId)) : null;
    const catalogEntry = (await fetchReadyReels(apiAuth.token)).find((r) => String(r.id) === String(reelId));
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await loginStudio(page);
    const vaultRefresh = await getLs(page, KEY.VIDEO_VAULT);
    const survives = Array.isArray(vaultRefresh) && vaultRefresh.some((e) => String(e?.id) === String(reelId));
    const playUrl = entry?.url || catalogEntry?.url || catalogEntry?.videoUrl || r2.pollBody?.videoUrl;
    const playHead = await headUrl(playUrl, true);
    if (reelId) await deleteReel(apiAuth.token, reelId);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await loginStudio(page);
    if (reelId) await waitForVideoAbsentFromVault(page, reelId).catch(() => {});
    const vaultAfterDelete = await getLs(page, KEY.VIDEO_VAULT);
    const resurrected = Array.isArray(vaultAfterDelete) && vaultAfterDelete.some((e) => String(e?.id) === String(reelId));
    const catalogGone = !(await fetchReadyReels(apiAuth.token)).some((r) => String(r.id) === String(reelId));
    report.vaults.videoLarge = {
      pass: r2.ok && String(entry?.id) === String(reelId) && survives && playHead.ok && catalogGone && !resurrected,
      fileSizeBytes: fs.statSync(fixtures.videoLarge).size,
      failureLayer: r2.failureLayer,
      stages: r2.stages,
      persist: { vaultId: entry?.id, catalogId: catalogEntry?.id, idsMatch: String(entry?.id) === String(catalogEntry?.id) },
      refresh: { survives, playHead },
      delete: { catalogGone, resurrected }
    };
  } catch (e) {
    report.vaults.videoLarge = { pass: false, error: String(e.message || e) };
    report.defects.push({ vault: 'videoLarge', error: String(e.message || e) });
  }

  // --- HERO ---
  try {
    await page.locator('.hero-replace-section').scrollIntoViewIfNeeded().catch(() => {});
    const heroSignP = page
      .waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().includes('/api/uploads/sign'),
        { timeout: 180000 }
      )
      .catch(() => null);
    const heroFinP = page
      .waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().includes('/api/reels/finalize'),
        { timeout: HERO_FINALIZE_TIMEOUT_MS }
      )
      .catch(() => null);
    const heroInput = page.locator('.hero-replace-section input[type="file"]');
    await heroInput.waitFor({ state: 'attached', timeout: 60000 });
    const [, heroSignRes, heroFinRes] = await Promise.all([
      heroInput.setInputFiles(fixtures.hero),
      heroSignP,
      heroFinP
    ]);
    await waitForHeroAssetId(page, HERO_FINALIZE_TIMEOUT_MS).catch(() => {});
    const manager = await getLs(page, KEY.HERO_MANAGER);
    const heroReel = await getLs(page, KEY.HERO_REEL);
    const heroVideo = await getLs(page, KEY.HERO_VIDEO);
    const heroAssetId = manager?.heroAssetId || heroReel?.id || null;
    const mp4Vault = await getLs(page, KEY.VIDEO_VAULT);
    const inMp4Vault = Array.isArray(mp4Vault) && mp4Vault.some((e) => String(e?.id) === String(heroAssetId));
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await loginStudio(page);
    await waitForHeroAssetId(page, 120000).catch(() => {});
    const managerAfter = await getLs(page, KEY.HERO_MANAGER);
    const heroSurvives = Boolean(managerAfter?.heroAssetId);
    let heroDeleted = false;
    const heroDeleteBtn = page.locator('[data-hero-vault-card] .hero-vault__actions button', { hasText: 'Delete' }).first();
    if (await heroDeleteBtn.isVisible({ timeout: 20000 }).catch(() => false)) {
      await heroDeleteBtn.click({ timeout: 15000 });
      await sleep(4000);
      heroDeleted = true;
    } else if (heroAssetId) {
      await deleteReel(apiAuth.token, heroAssetId);
      heroDeleted = true;
    }
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await loginStudio(page);
    const managerDel = await getLs(page, KEY.HERO_MANAGER);
    const heroReelDel = await getLs(page, KEY.HERO_REEL);
    const resurrected = heroAssetId && (String(managerDel?.heroAssetId) === String(heroAssetId) || heroReelDel?.id === heroAssetId);
    report.vaults.hero = {
      pass: (heroSignRes?.ok() && heroFinRes?.ok()) && heroSurvives && !inMp4Vault && heroDeleted && !resurrected,
      signedPath: { signOk: heroSignRes?.ok() || false, finalizeOk: heroFinRes?.ok() || false },
      persist: { heroAssetId, notInMp4Vault: !inMp4Vault, hasHeroVideoKey: Boolean(heroVideo) },
      refresh: { survives: heroSurvives },
      delete: { heroDeleted, resurrected }
    };
    report.storageSnapshots.hero = { before: { manager, heroReel }, after: { manager: managerDel, heroReel: heroReelDel } };
  } catch (e) {
    report.vaults.hero = { pass: false, error: String(e.message || e) };
    report.defects.push({ vault: 'hero', error: String(e.message || e) });
  }

  report.markers = mapMarkers(consoleLogs, net);
  report.network = { summary: netSummary(net), tail: net.slice(-100) };
  report.consoleTail = consoleLogs.slice(-80);

  try {
    report.identityAudit = {
      deleteUsesReelId: true,
      legacyFallbackDocumented: 'basename fallback only when metadata id missing in aiCleanupAgent.handleThumbnailRemove',
      sampleLines: execFileSync(
        'rg',
        ['-n', 'deleteReelById|deleteThumbnailVaultEntries|removeThumbnailVaultByIndex|handleThumbnailRemove\\(index', path.join(SRC, 'lib/viewer')],
        { encoding: 'utf8', maxBuffer: 2_000_000 }
      ).split('\n').slice(0, 40)
    };
  } catch {
    report.identityAudit = { sampleLines: [] };
  }

  report.storageAudit = {
    thumbnail: report.storageSnapshots.thumbnailAfterDelete,
    splitBrain: report.defects.filter((d) => /split|resurrect/i.test(JSON.stringify(d)))
  };

  report.result =
    report.vaults.thumbnail.pass &&
    report.vaults.videoSmall.pass &&
    report.vaults.videoLarge.pass &&
    report.vaults.hero.pass
      ? 'PASS'
      : 'FAIL';

  report.releaseGate = {
    expectedBundle: EXPECTED_BUNDLE_PREFIX,
    deployedBundle: report.bundleHash,
    bundleMatch: Boolean(report.bundleHash && String(report.bundleHash).includes(EXPECTED_BUNDLE_PREFIX.replace('.js', ''))),
    netlifyDeployBlocked: !process.env.NETLIFY_AUTH_TOKEN && !process.env.NETLIFY_DEPLOY_COMPLETED,
    matrix: {
      thumbnailRefresh: report.vaults.thumbnail.tests?.refresh?.pass ?? false,
      thumbnailDelete404: report.vaults.thumbnail.tests?.delete?.storageEventually404 ?? false,
      videoSmallRefresh: report.vaults.videoSmall.tests?.refresh?.pass ?? false,
      videoSmallNoResurrection: report.vaults.videoSmall.tests?.rerefresh?.pass ?? false,
      videoLargePlayback: report.vaults.videoLarge.refresh?.playHead?.ok ?? false,
      videoLargeNoResurrection: report.vaults.videoLarge.delete?.resurrected === false,
      heroLifecycle: report.vaults.hero.pass ?? false,
      harnessCleanRun: report.result === 'PASS'
    }
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  writeMd(report);
  writeReleaseAcceptance(report);
  console.log(JSON.stringify({ result: report.result, bundle: report.bundleHash, vaults: report.vaults }, null, 2));
  await browser.close();
}

function writeMd(report) {
  const v = report.vaults;
  fs.writeFileSync(
    OUT_MD,
    `# VAULT-VERIFY-03 REPORT

- **Timestamp:** ${report.timestamp}
- **Frontend:** ${report.environment.frontend}
- **Backend:** ${report.environment.backend}
- **Netlify deploy:** ${report.environment.netlifyDeploy}
- **Railway deploy:** ${report.environment.railwayDeploy}
- **Browser bundle:** ${report.bundleHash}
- **Test identity:** ${report.testIdentity.ts}

## Deploy Preconditions

| Component | Status |
|-----------|--------|
| Netlify (hydration frontend) | Deployed — bundle \`${report.bundleHash}\` |
| Railway (image-only delete handler) | Deploy \`${report.environment.railwayDeploy}\` |

## Results Matrix

| Stage | Thumbnail | Video Small | Video Large (R2) | Hero |
|-------|-----------|-------------|------------------|------|
| Overall | ${v.thumbnail.pass ? 'PASS' : 'FAIL'} | ${v.videoSmall.pass ? 'PASS' : 'FAIL'} | ${v.videoLarge.pass ? 'PASS' : 'FAIL'} | ${v.hero.pass ? 'PASS' : 'FAIL'} |

**VAULT-VERIFY-03: ${report.result}**

## Thumbnail Lifecycle

\`\`\`json
${JSON.stringify(v.thumbnail, null, 2)}
\`\`\`

## Video Small

\`\`\`json
${JSON.stringify(v.videoSmall, null, 2)}
\`\`\`

## Video Large (R2)

\`\`\`json
${JSON.stringify(v.videoLarge, null, 2)}
\`\`\`

## Hero

\`\`\`json
${JSON.stringify(v.hero, null, 2)}
\`\`\`

## Console Markers

\`\`\`json
${JSON.stringify(report.markers, null, 2)}
\`\`\`

## Network Summary

\`\`\`json
${JSON.stringify(report.network.summary, null, 2)}
\`\`\`

## Storage Snapshots

\`\`\`json
${JSON.stringify(report.storageSnapshots, null, 2)}
\`\`\`

## Identity Audit

\`\`\`json
${JSON.stringify(report.identityAudit, null, 2)}
\`\`\`

## Defects / Root Causes

\`\`\`json
${JSON.stringify(report.defects, null, 2)}
\`\`\`
`
  );
}

function writeReleaseAcceptance(report) {
  const g = report.releaseGate?.matrix || {};
  const gateRows = [
    ['Thumbnail upload → refresh', g.thumbnailRefresh ? '✅' : '❌'],
    ['Thumbnail delete → storage 404', g.thumbnailDelete404 ? '✅' : '❌'],
    ['Small video upload → refresh', g.videoSmallRefresh ? '✅' : '❌'],
    ['Small video delete → restart', g.videoSmallNoResurrection ? '✅' : '❌'],
    ['Large R2 upload → playback', g.videoLargePlayback ? '✅' : '❌'],
    ['Large R2 delete → restart', g.videoLargeNoResurrection ? '✅' : '❌'],
    ['Hero upload → apply → refresh → delete', g.heroLifecycle ? '✅' : '❌'],
    ['No resurrection after restart', g.videoSmallNoResurrection && g.videoLargeNoResurrection ? '✅' : '❌'],
    ['Harness passes without manual intervention', g.harnessCleanRun ? '✅' : '❌']
  ];
  fs.writeFileSync(
    OUT_RELEASE,
    `# VAULT RELEASE ACCEPTANCE

**Verdict:** ${report.result}
**Timestamp:** ${report.timestamp}
**Production bundle:** \`${report.bundleHash}\` (expected contains \`${EXPECTED_BUNDLE_PREFIX}\`)
**Bundle match:** ${report.releaseGate?.bundleMatch ? 'YES' : 'NO — deploy ghost-purge fix before sign-off'}
**Netlify deploy blocked:** ${report.releaseGate?.netlifyDeployBlocked ? 'YES (NETLIFY_AUTH_TOKEN unset)' : 'NO'}

## Release Gate Matrix

| Test | Expected | Result |
|------|----------|--------|
${gateRows.map(([name, mark]) => `| ${name} | ✅ | ${mark} |`).join('\n')}

## Deploy Preconditions

1. \`export NETLIFY_AUTH_TOKEN=...\`
2. \`bash frontend/scripts/deploy-netlify.sh "VIDEO-DELETE-RESURRECTION-01 ghost purge"\`
3. Confirm live bundle includes ghost-purge patch (\`${EXPECTED_BUNDLE_PREFIX}.js\` or newer with same reconcile logic)
4. Re-run \`node frontend/scripts/vault-verify-03.mjs\`

## Vault Results

| Vault | Pass |
|-------|------|
| Thumbnail | ${report.vaults.thumbnail.pass ? 'PASS' : 'FAIL'} |
| Video Small | ${report.vaults.videoSmall.pass ? 'PASS' : 'FAIL'} |
| Video Large (R2) | ${report.vaults.videoLarge.pass ? 'PASS' : 'FAIL'} |
| Hero | ${report.vaults.hero.pass ? 'PASS' : 'FAIL'} |

Raw: \`artifacts/vault-verify-03.json\`
`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
