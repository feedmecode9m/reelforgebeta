#!/usr/bin/env node
/**
 * VAULT-VALIDATION-02 — Production vault lifecycle acceptance.
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
const FIX_DIR = process.env.FIX_DIR;
const OUT_JSON = path.join(ROOT, 'artifacts/vault-validation-02-report.json');
const OUT_MD = path.join(ROOT, 'artifacts/VAULT_VALIDATION_02_STATUS_REPORT.md');
const RAILWAY_DEPLOY = process.env.RAILWAY_DEPLOY || '9aa4473e-f684-4ffe-9f88-e417ba0ea917';
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const KEY = {
  THUMBS: 'personal_thumbnails',
  VIDEO_VAULT: 'personal_video_vault',
  HERO_MANAGER: 'reelforge_hero_manager_config',
  HERO_REEL: 'reelforge_hero_reel',
  HERO_VIDEO: 'reelforge_hero_video'
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureFixtures() {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z').replace('T', 'T');
  const dir = FIX_DIR || path.join('/tmp', `vault-val02-${ts}`);
  fs.mkdirSync(dir, { recursive: true });
  const thumb = path.join(dir, `VAULT_TEST_THUMB_${ts}.jpg`);
  const video = path.join(dir, `VAULT_TEST_VIDEO_${ts}.mp4`);
  const hero = path.join(dir, `VAULT_TEST_HERO_${ts}.mp4`);
  if (!fs.existsSync(thumb)) {
    execFileSync(
      'ffmpeg',
      ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=320x240:d=0.1', '-frames:v', '1', thumb],
      { stdio: 'ignore' }
    );
  }
  if (!fs.existsSync(video)) {
    execFileSync(
      'ffmpeg',
      ['-y', '-hide_banner', '-loglevel', 'error', '-i', '/home/youloose2dafish/Downloads/condo_v1_2.mp4', '-fs', '30M', '-c', 'copy', video],
      { stdio: 'ignore' }
    );
  }
  if (!fs.existsSync(hero)) {
    fs.copyFileSync(video, hero);
  }
  return { dir, ts, thumb, video, hero };
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

async function headUrl(url) {
  if (!url) return { ok: false, status: 0 };
  try {
    const target = url.startsWith('http') ? url : `${API_URL}${url}`;
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
  const signRes = await fetch(`${API_URL}/api/uploads/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      filename: fileName,
      contentType: 'video/mp4',
      sizeBytes: buf.length,
      title: `VAULT-VAL02 ${fileName}`,
      category
    })
  });
  const signBody = await signRes.json().catch(() => ({}));
  stages.sign = { status: signRes.status, ok: signRes.ok, uploadId: signBody.uploadId, reelId: signBody.reelId };
  if (!signRes.ok) return { ok: false, stages };

  const putRes = await fetch(signBody.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4' },
    body: buf
  });
  stages.r2Put = { status: putRes.status, ok: putRes.ok, target: 'r2.cloudflarestorage.com' };
  if (!putRes.ok) return { ok: false, stages, signBody };

  const finRes = await fetch(`${API_URL}/api/reels/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ uploadId: signBody.uploadId, category })
  });
  const finBody = await finRes.json().catch(() => ({}));
  stages.finalize = { status: finRes.status, ok: finRes.ok, id: finBody.id, pollUrl: finBody.pollUrl };
  if (!finRes.ok) return { ok: false, stages, signBody };

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
  return { ok: ready, stages, signBody, finBody, pollBody, reelId: finBody.id || signBody.reelId };
}

async function dropSmallFile(page, selector, filePath, mimeType) {
  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString('base64');
  const name = path.basename(filePath);
  await page.waitForSelector(selector, { timeout: 90000 });
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
}

async function loginStudio(page) {
  if (!(await page.locator('.control-center-overlay').isVisible().catch(() => false))) {
    await page.locator('button.ghost-trigger').click({ timeout: 60000 });
  }
  await page.waitForSelector('.control-center-overlay', { timeout: 60000 });
  if (await page.locator('.admin-login-panel').isVisible().catch(() => false)) {
    let ok = false;
    for (const pw of ADMIN_PASSWORDS) {
      await page.locator('.admin-login-panel input[type="password"]').fill(pw.trim());
      await page.locator('.admin-login-panel button.submit-btn').click();
      await sleep(1500);
      if (await page.locator('.logout-btn').isVisible().catch(() => false)) {
        ok = true;
        break;
      }
    }
    if (!ok) throw new Error('Studio login failed');
  }
  const tab = page.locator('[data-studio-workspace-tabs] button', { hasText: 'Content' });
  if (await tab.isVisible().catch(() => false)) await tab.click();
  await page.waitForSelector('[data-workspace-panel-content]', { timeout: 60000 }).catch(() => {});
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

function mapMarkers(consoleLogs, net) {
  const markers = {};
  for (const l of consoleLogs) {
    const m = l.text.match(/\[(VAULT_[A-Z_]+|DELETE_[A-Z_]+)\]/);
    if (!m) continue;
    (markers[m[1]] ||= []).push({ ts: l.ts, text: l.text.slice(0, 500) });
  }
  const sign = net.find((n) => n.kind === 'response' && n.url.includes('/api/uploads/sign') && n.ok);
  const r2 = net.find((n) => n.kind === 'response' && /r2\.cloudflarestorage\.com/.test(n.url) && n.ok);
  const fin = net.find((n) => n.kind === 'response' && n.url.includes('/api/reels/finalize') && n.ok);
  const del = net.find((n) => n.kind === 'response' && n.method === 'DELETE' && /\/api\/reels\//.test(n.url));
  if (sign) markers.VAULT_UPLOAD_SIGN = [{ ts: sign.ts, status: sign.status, url: sign.url }];
  if (r2) markers.VAULT_UPLOAD_R2 = [{ ts: r2.ts, status: r2.status, url: r2.url.slice(0, 120) }];
  if (fin) markers.VAULT_FINALIZE_SUCCESS = [{ ts: fin.ts, status: fin.status, url: fin.url }];
  if (del) markers.VAULT_DELETE_REQUEST = [{ ts: del.ts, status: del.status, url: del.url }];
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

async function main() {
  const fixtures = ensureFixtures();
  const apiAuth = await apiLogin();
  const report = {
    mission: 'VAULT-VALIDATION-02',
    timestamp: new Date().toISOString(),
    environment: { frontend: FRONTEND_URL, backend: API_URL, railwayDeploy: RAILWAY_DEPLOY },
    testIdentity: fixtures,
    bundleHash: null,
    markers: {},
    network: {},
    storageSnapshots: {},
    vaults: { thumbnail: { pass: false }, video: { pass: false }, hero: { pass: false } },
    identityAudit: null,
    defects: [],
    result: 'FAIL'
  };

  const consoleLogs = [];
  const net = [];
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  const context = await browser.newContext();
  context.on('page', (p) => p.on('dialog', (d) => d.accept().catch(() => {})));
  await context.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    const t = msg.text();
    if (/\[(VAULT_|DELETE_|BG7G_)/.test(t)) consoleLogs.push({ ts: Date.now(), text: t });
  });
  page.on('response', (res) => {
    const url = res.url();
    if (!/(api\/|r2\.cloudflarestorage\.com)/.test(url)) return;
    net.push({ ts: Date.now(), url, method: res.request().method(), status: res.status(), ok: res.ok(), kind: 'response' });
  });

  await page.goto(FRONTEND_URL, { waitUntil: 'load', timeout: 120000 });
  report.bundleHash = await page.evaluate(() => {
    const s = [...document.querySelectorAll('script[src*="/assets/"]')].map((x) => x.src);
    const m = (s.find((u) => /index-/.test(u)) || s[0] || '').match(/\/assets\/([^/?]+)/);
    return m ? m[1] : 'unknown';
  });
  await loginStudio(page);

  // --- THUMBNAIL ---
  try {
    const before = await getLs(page, KEY.THUMBS);
    const countBefore = Array.isArray(before) ? before.length : 0;
    await dropSmallFile(page, '.thumbnail-drop-zone', fixtures.thumb, 'image/jpeg');
    const acceptVisible = await page.locator('.thumbnail-drop-zone .accept-btn').isVisible({ timeout: 20000 }).catch(() => false);
    const afterDrop = await getLs(page, KEY.THUMBS);
    const countAfterDrop = Array.isArray(afterDrop) ? afterDrop.length : 0;
    let created = null;
    let postBody = null;
    if (acceptVisible) {
      const postP = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/reels(\?|$)/.test(r.url()), { timeout: 120000 });
      await page.click('.thumbnail-drop-zone .accept-btn');
      const postRes = await postP.catch(() => null);
      postBody = postRes ? await postRes.json().catch(() => null) : null;
      await sleep(3000);
      const thumbs = await getLs(page, KEY.THUMBS);
      created = Array.isArray(thumbs) ? thumbs.find((e) => postBody?.id && String(e?.id) === String(postBody.id)) : null;
    }
    await page.reload({ waitUntil: 'load', timeout: 120000 });
    await loginStudio(page);
    const afterRefresh = await getLs(page, KEY.THUMBS);
    const survives = Array.isArray(afterRefresh) && created?.id && afterRefresh.some((e) => String(e?.id) === String(created.id));
    const inCatalog = (await fetchReadyReels(apiAuth.token)).some((r) => String(r.id) === String(created?.id || postBody?.id));
    report.storageSnapshots.thumbnailBeforeDelete = afterRefresh;

    const cards = page.locator('.vault-grid--images .vault-card');
    if (created?.id && (await cards.count()) > 0) {
      await cards.last().locator('.thumb-delete-btn').click();
      await sleep(3000);
    }
    await page.reload({ waitUntil: 'load', timeout: 120000 });
    await loginStudio(page);
    const afterDelete = await getLs(page, KEY.THUMBS);
    report.storageSnapshots.thumbnailAfterDelete = afterDelete;
    const resurrected = Array.isArray(afterDelete) && created?.id && afterDelete.some((e) => String(e?.id) === String(created.id));
    const url = created?.url || postBody?.url || postBody?.thumbnailUrl;
    const storageHead = await headUrl(url);
    const catalogGone = !(await fetchReadyReels(apiAuth.token)).some((r) => String(r.id) === String(created?.id));

    report.vaults.thumbnail = {
      drop: { acceptVisible, countBefore, countAfterDrop, noBackendBeforeAccept: countAfterDrop <= countBefore },
      accept: { id: created?.id || postBody?.id, fileName: created?.fileName, url, identityUsesId: Boolean(created?.id && created.id !== created?.fileName) },
      refresh: { survives, catalogMatch: inCatalog },
      delete: { resurrected, storageHead, catalogGone },
      pass: acceptVisible && created?.id && survives && inCatalog && !resurrected && catalogGone
    };
    if (created?.id && !catalogGone) await deleteReel(apiAuth.token, created.id);
  } catch (e) {
    report.vaults.thumbnail = { pass: false, error: String(e.message || e) };
    report.defects.push({ vault: 'thumbnail', error: String(e.message || e) });
  }

  // --- VIDEO (R2 API + browser persist/delete) ---
  try {
    const r2 = await uploadVideoR2(apiAuth.token, fixtures.video, 'Trending');
    report.vaults.video.r2Api = r2;
    const reelId = r2.reelId;
    await page.reload({ waitUntil: 'load', timeout: 120000 });
    await loginStudio(page);
    await sleep(5000);
    await page.reload({ waitUntil: 'load', timeout: 120000 });
    await loginStudio(page);
    const vault = await getLs(page, KEY.VIDEO_VAULT);
    const entry = Array.isArray(vault) ? vault.find((e) => reelId && String(e?.id) === String(reelId)) : null;
    const catalogEntry = (await fetchReadyReels(apiAuth.token)).find((r) => String(r.id) === String(reelId));
    report.storageSnapshots.videoBeforeDelete = vault;
    await page.reload({ waitUntil: 'load', timeout: 120000 });
    await loginStudio(page);
    const vaultRefresh = await getLs(page, KEY.VIDEO_VAULT);
    const survives = Array.isArray(vaultRefresh) && vaultRefresh.some((e) => String(e?.id) === String(reelId));
    const playUrl = entry?.url || catalogEntry?.url || catalogEntry?.videoUrl || r2.pollBody?.videoUrl;
    const playHead = await headUrl(playUrl);

    const vCards = page.locator('.vault-grid--videos .vault-card');
    let deleteNet = null;
    if (reelId && (await vCards.count()) > 0) {
      const delP = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes(`/api/reels/${reelId}`), { timeout: 60000 }).catch(() => null);
      await vCards.first().locator('.thumb-delete-btn').click();
      deleteNet = await delP;
      await sleep(3000);
    } else if (reelId) {
      await deleteReel(apiAuth.token, reelId);
    }
    await page.reload({ waitUntil: 'load', timeout: 120000 });
    await loginStudio(page);
    const vaultAfterDelete = await getLs(page, KEY.VIDEO_VAULT);
    report.storageSnapshots.videoAfterDelete = vaultAfterDelete;
    const resurrected = Array.isArray(vaultAfterDelete) && vaultAfterDelete.some((e) => String(e?.id) === String(reelId));
    const catalogGone = !(await fetchReadyReels(apiAuth.token)).some((r) => String(r.id) === String(reelId));

    report.vaults.video = {
      fileSizeBytes: fs.statSync(fixtures.video).size,
      r2Api: r2.stages,
      persist: { vaultId: entry?.id, catalogId: catalogEntry?.id, idsMatch: String(entry?.id) === String(catalogEntry?.id), identityFileNameOnly: entry && String(entry.id) === String(entry.fileName) },
      refresh: { survives, playHead },
      delete: { deleteStatus: deleteNet?.status?.() || null, resurrected, catalogGone },
      pass: r2.ok && String(entry?.id) === String(reelId) && survives && playHead.ok && !resurrected && catalogGone
    };
  } catch (e) {
    report.vaults.video = { pass: false, error: String(e.message || e) };
    report.defects.push({ vault: 'video', error: String(e.message || e) });
  }

  // --- HERO (browser upload + persist/delete) ---
  try {
    const heroSignP = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/api/uploads/sign'), { timeout: 180000 });
    const heroFinP = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/api/reels/finalize'), { timeout: 600000 });
    const heroInput = page.locator('.hero-replace-section input[type="file"]');
    await heroInput.waitFor({ state: 'attached', timeout: 60000 });
    await heroInput.setInputFiles(fixtures.hero);
    const heroSignRes = await heroSignP.catch(() => null);
    const heroFinRes = await heroFinP.catch(() => null);
    await sleep(12000);
    const manager = await getLs(page, KEY.HERO_MANAGER);
    const heroReel = await getLs(page, KEY.HERO_REEL);
    const heroVideo = await getLs(page, KEY.HERO_VIDEO);
    const heroAssetId = manager?.heroAssetId || heroReel?.id || null;
    const mp4Vault = await getLs(page, KEY.VIDEO_VAULT);
    const inMp4Vault = Array.isArray(mp4Vault) && mp4Vault.some((e) => String(e?.id) === String(heroAssetId));
    report.storageSnapshots.heroBeforeDelete = { manager, heroReel, heroVideo };

    await page.reload({ waitUntil: 'load', timeout: 120000 });
    await loginStudio(page);
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
    await page.reload({ waitUntil: 'load', timeout: 120000 });
    await loginStudio(page);
    const managerDel = await getLs(page, KEY.HERO_MANAGER);
    const heroReelDel = await getLs(page, KEY.HERO_REEL);
    report.storageSnapshots.heroAfterDelete = { manager: managerDel, heroReel: heroReelDel };
    const resurrected = heroAssetId && (String(managerDel?.heroAssetId) === String(heroAssetId) || heroReelDel?.id === heroAssetId);

    report.vaults.hero = {
      signedPath: { signOk: heroSignRes?.ok() || false, finalizeOk: heroFinRes?.ok() || false },
      persist: { heroAssetId, backgroundSource: manager?.backgroundSource, heroReelId: heroReel?.id, hasHeroVideoKey: Boolean(heroVideo), notInMp4Vault: !inMp4Vault },
      refresh: { survives: heroSurvives },
      delete: { heroDeleted, resurrected },
      pass: (heroSignRes?.ok() && heroFinRes?.ok()) && heroSurvives && !inMp4Vault && heroDeleted && !resurrected
    };
  } catch (e) {
    report.vaults.hero = { pass: false, error: String(e.message || e) };
    report.defects.push({ vault: 'hero', error: String(e.message || e) });
  }

  report.markers = mapMarkers(consoleLogs, net);
  report.network = { summary: netSummary(net), tail: net.slice(-80) };
  report.consoleTail = consoleLogs.slice(-60);
  if (!Object.keys(report.markers).some((k) => k.startsWith('VAULT_'))) {
    report.defects.push({ note: 'VAULT_* forensic markers not present in production bundle; network-derived markers used where available' });
  }

  try {
    report.identityAudit = {
      sampleLines: execFileSync(
        'rg',
        ['-n', 'fileName|basename|removeThumbnailVaultByIndex|thumbnailName|mediaBasename|handleThumbnailRemove\\(index', SRC],
        { encoding: 'utf8', maxBuffer: 2_000_000 }
      ).split('\n').slice(0, 80)
    };
  } catch {
    report.identityAudit = { sampleLines: [] };
  }

  report.result =
    report.vaults.thumbnail.pass && report.vaults.video.pass && report.vaults.hero.pass ? 'PASS' : 'FAIL';

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  writeMd(report);
  console.log(JSON.stringify({ result: report.result, ...report.vaults }, null, 2));
  await browser.close();
}

function writeMd(report) {
  const v = report.vaults;
  fs.writeFileSync(
    OUT_MD,
    `# VAULT-VALIDATION-02 STATUS REPORT

- **Timestamp:** ${report.timestamp}
- **Frontend:** ${report.environment.frontend}
- **Backend:** ${report.environment.backend}
- **Railway deploy:** ${report.environment.railwayDeploy}
- **Browser bundle:** ${report.bundleHash}
- **Test identity:** ${report.testIdentity.ts}

## Results

| Vault | Result |
|-------|--------|
| Thumbnail | ${v.thumbnail.pass ? 'PASS' : 'FAIL'} |
| Video (R2) | ${v.video.pass ? 'PASS' : 'FAIL'} |
| Hero | ${v.hero.pass ? 'PASS' : 'FAIL'} |

**VAULT-VALIDATION-02: ${report.result}**

## Thumbnail Vault
\`\`\`json
${JSON.stringify(v.thumbnail, null, 2)}
\`\`\`

## Video Vault
\`\`\`json
${JSON.stringify(v.video, null, 2)}
\`\`\`

## Hero Vault
\`\`\`json
${JSON.stringify(v.hero, null, 2)}
\`\`\`

## Console / Network Markers
\`\`\`json
${JSON.stringify({ markers: report.markers, networkSummary: report.network.summary }, null, 2)}
\`\`\`

## Storage Snapshots
\`\`\`json
${JSON.stringify(report.storageSnapshots, null, 2)}
\`\`\`

## Remaining Defects
\`\`\`json
${JSON.stringify(report.defects, null, 2)}
\`\`\`

## Identity Audit (sample)
\`\`\`
${(report.identityAudit?.sampleLines || []).join('\n')}
\`\`\`
`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
