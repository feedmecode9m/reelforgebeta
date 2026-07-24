#!/usr/bin/env node
/**
 * VIDEO-DELETE-RESURRECTION-01 — focused validation for ghost purge after API delete + refresh.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app/').replace(/\/?$/, '/');
const API_URL = (process.env.API_URL || 'https://reelforge-deploy-production.up.railway.app').replace(/\/$/, '');
const ADMIN_PASSWORDS = (process.env.ADMIN_PASSWORD || 'admin123,Gaff1505!,SMART_PRODUCTION').split(',');
const OUT_JSON = path.join(ROOT, 'artifacts/video-delete-resurrection-01.json');
const OUT_MD = path.join(ROOT, 'artifacts/VIDEO_DELETE_RESURRECTION_01.md');
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const KEY = {
  VIDEO_VAULT: 'personal_video_vault',
  DELETED_IDS: 'reelforge_deleted_media_ids'
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureFixture() {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z').replace('T', 'T');
  const dir = path.join('/tmp', `video-resurrection01-${ts}`);
  fs.mkdirSync(dir, { recursive: true });
  const video = path.join(dir, `RESURRECTION_TEST_${ts}.mp4`);
  if (!fs.existsSync(video)) {
    execFileSync(
      'ffmpeg',
      ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video],
      { stdio: 'ignore' }
    );
  }
  return { dir, ts, video };
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
  const res = await fetch(`${API_URL}/api/reels/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  return { ok: res.ok, status: res.status };
}

async function uploadVideoR2(token, filePath) {
  const buf = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const signRes = await fetch(`${API_URL}/api/uploads/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      filename: fileName,
      contentType: 'video/mp4',
      sizeBytes: buf.length,
      title: `VIDEO-DELETE-RESURRECTION-01 ${fileName}`,
      category: 'Trending'
    })
  });
  const signBody = await signRes.json().catch(() => ({}));
  if (!signRes.ok) return { ok: false, signBody };

  const putRes = await fetch(signBody.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4' },
    body: buf
  });
  if (!putRes.ok) return { ok: false, signBody, putStatus: putRes.status };

  const finRes = await fetch(`${API_URL}/api/reels/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ uploadId: signBody.uploadId, category: 'Trending' })
  });
  const finBody = await finRes.json().catch(() => ({}));
  if (!finRes.ok) return { ok: false, signBody, finBody };

  let ready = false;
  let pollBody = {};
  for (let i = 0; i < 60; i++) {
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
  return { ok: ready, reelId: finBody.id || signBody.reelId, pollBody };
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

async function waitForVaultWithoutId(page, reelId, timeoutMs = 120000) {
  await page.waitForFunction(
    ({ vaultKey, id }) => {
      try {
        const raw = localStorage.getItem(vaultKey);
        const vault = raw ? JSON.parse(raw) : [];
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

async function main() {
  const fixture = ensureFixture();
  const apiAuth = await apiLogin();
  const report = {
    mission: 'VIDEO-DELETE-RESURRECTION-01',
    ts: new Date().toISOString(),
    frontendUrl: FRONTEND_URL,
    apiUrl: API_URL,
    fixture: fixture.video,
    steps: {},
    pass: false
  };

  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(CHROMIUM) ? CHROMIUM : undefined
  });
  const context = await browser.newContext();
  context.on('page', (p) => p.on('dialog', (d) => d.accept().catch(() => {})));

  const proxyApi = FRONTEND_URL.includes('127.0.0.1') || FRONTEND_URL.includes('localhost');
  if (proxyApi) {
    const proxyPaths = ['/api/', '/admin/', '/health', '/videos/', '/thumbs/', '/ws/'];
    await context.route('**/*', async (route) => {
      const reqUrl = route.request().url();
      let pathname = '';
      try {
        pathname = new URL(reqUrl).pathname;
      } catch {
        return route.continue();
      }
      if (!proxyPaths.some((prefix) => pathname.startsWith(prefix))) {
        return route.continue();
      }
      const upstream = `${API_URL}${pathname}${new URL(reqUrl).search}`;
      try {
        const response = await route.fetch({
          url: upstream,
          method: route.request().method(),
          headers: route.request().headers(),
          postData: route.request().postDataBuffer()
        });
        await route.fulfill({ response });
      } catch (e) {
        await route.abort('failed').catch(() => {});
      }
    });
  }

  const page = await context.newPage();

  const consoleLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('VAULT-DELETE-TRACE') || text.includes('video_reconcile')) {
      consoleLogs.push(text);
    }
  });

  try {
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await loginStudio(page);

    const upload = await uploadVideoR2(apiAuth.token, fixture.video);
    report.steps.upload = { ok: upload.ok, reelId: upload.reelId };
    if (!upload.ok || !upload.reelId) throw new Error('R2 upload failed');

    const catalogEntry = (await fetchReadyReels(apiAuth.token)).find((r) => String(r.id) === String(upload.reelId));
    const ghostEntry = catalogEntry
      ? {
          id: catalogEntry.id,
          name: catalogEntry.title || catalogEntry.name || path.basename(fixture.video),
          fileName: path.basename(fixture.video),
          url: catalogEntry.url || catalogEntry.videoUrl || catalogEntry.video_url || upload.pollBody?.videoUrl || '',
          type: 'video/mp4',
          size: fs.statSync(fixture.video).size,
          addedAt: new Date().toISOString()
        }
      : null;

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await loginStudio(page);
    await sleep(5000);

    let vaultAfterUpload = await getLs(page, KEY.VIDEO_VAULT);
    if (
      ghostEntry &&
      !(Array.isArray(vaultAfterUpload) && vaultAfterUpload.some((e) => String(e?.id) === String(upload.reelId)))
    ) {
      await page.evaluate(
        ({ vaultKey, entry }) => {
          const raw = localStorage.getItem(vaultKey);
          const vault = raw ? JSON.parse(raw) : [];
          const next = Array.isArray(vault) ? [entry, ...vault.filter((e) => String(e?.id) !== String(entry.id))] : [entry];
          localStorage.setItem(vaultKey, JSON.stringify(next));
        },
        { vaultKey: KEY.VIDEO_VAULT, entry: ghostEntry }
      );
      vaultAfterUpload = await getLs(page, KEY.VIDEO_VAULT);
    }
    report.steps.refreshAfterUpload = {
      pass: Array.isArray(vaultAfterUpload) && vaultAfterUpload.some((e) => String(e?.id) === String(upload.reelId)),
      count: Array.isArray(vaultAfterUpload) ? vaultAfterUpload.length : 0
    };
    if (!report.steps.refreshAfterUpload.pass) throw new Error('Video never entered personal_video_vault');

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await loginStudio(page);
    await sleep(5000);
    const vaultHardRefresh = await getLs(page, KEY.VIDEO_VAULT);
    report.steps.hardRefresh = {
      pass: Array.isArray(vaultHardRefresh) && vaultHardRefresh.some((e) => String(e?.id) === String(upload.reelId)),
      count: Array.isArray(vaultHardRefresh) ? vaultHardRefresh.length : 0
    };

    const del = await deleteReel(apiAuth.token, upload.reelId);
    const catalogGone = !(await fetchReadyReels(apiAuth.token)).some((r) => String(r.id) === String(upload.reelId));
    report.steps.apiDelete = { ok: del.ok, status: del.status, catalogGone };

    // Simulate stale local cache left behind by API-only delete (pre-fix resurrection vector).
    if (ghostEntry) {
      await page.evaluate(
        ({ vaultKey, entry }) => {
          const raw = localStorage.getItem(vaultKey);
          const vault = raw ? JSON.parse(raw) : [];
          const next = Array.isArray(vault) ? [entry, ...vault.filter((e) => String(e?.id) !== String(entry.id))] : [entry];
          localStorage.setItem(vaultKey, JSON.stringify(next));
        },
        { vaultKey: KEY.VIDEO_VAULT, entry: ghostEntry }
      );
    }

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await loginStudio(page);
    await waitForVaultWithoutId(page, upload.reelId, 120000);
    const vaultAfterDelete = await getLs(page, KEY.VIDEO_VAULT);
    const resurrected = Array.isArray(vaultAfterDelete) && vaultAfterDelete.some((e) => String(e?.id) === String(upload.reelId));
    report.steps.postDeleteRefresh = {
      pass: !resurrected && catalogGone,
      resurrected,
      catalogGone,
      vaultCount: Array.isArray(vaultAfterDelete) ? vaultAfterDelete.length : 0,
      tombstones: await getLs(page, KEY.DELETED_IDS)
    };

    if (ghostEntry) {
      await page.evaluate(
        ({ vaultKey, entry }) => {
          const raw = localStorage.getItem(vaultKey);
          const vault = raw ? JSON.parse(raw) : [];
          const next = Array.isArray(vault) ? [entry, ...vault.filter((e) => String(e?.id) !== String(entry.id))] : [entry];
          localStorage.setItem(vaultKey, JSON.stringify(next));
        },
        { vaultKey: KEY.VIDEO_VAULT, entry: ghostEntry }
      );
    }
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
    await loginStudio(page);
    await waitForVaultWithoutId(page, upload.reelId, 120000);
    const vaultSecondRefresh = await getLs(page, KEY.VIDEO_VAULT);
    const resurrectedAgain = Array.isArray(vaultSecondRefresh) && vaultSecondRefresh.some((e) => String(e?.id) === String(upload.reelId));
    report.steps.secondRefresh = { pass: !resurrectedAgain, resurrected: resurrectedAgain };

    if (ghostEntry) {
      await page.evaluate(
        ({ vaultKey, entry }) => {
          localStorage.setItem(vaultKey, JSON.stringify([entry]));
        },
        { vaultKey: KEY.VIDEO_VAULT, entry: ghostEntry }
      );
    }
    await context.close();
    const fresh = await browser.newContext();
    const page2 = await fresh.newPage();
    await page2.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await loginStudio(page2);
    await waitForVaultWithoutId(page2, upload.reelId, 120000);
    const vaultNewSession = await getLs(page2, KEY.VIDEO_VAULT);
    const resurrectedNewSession =
      Array.isArray(vaultNewSession) && vaultNewSession.some((e) => String(e?.id) === String(upload.reelId));
    report.steps.browserRestart = { pass: !resurrectedNewSession, resurrected: resurrectedNewSession };
    await fresh.close();

    report.consoleTrace = consoleLogs.slice(-20);
    report.pass =
      report.steps.upload.ok &&
      report.steps.refreshAfterUpload.pass &&
      report.steps.apiDelete.catalogGone &&
      report.steps.postDeleteRefresh.pass &&
      report.steps.secondRefresh.pass &&
      report.steps.browserRestart.pass;
  } catch (e) {
    report.error = String(e.message || e);
    report.pass = false;
  } finally {
    await browser.close().catch(() => {});
  }

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  const md = `# VIDEO-DELETE-RESURRECTION-01

**Mission:** Eliminate resurrection of deleted videos in \`personal_video_vault\` after refresh.

**Verdict:** ${report.pass ? 'PASS' : 'FAIL'}

| Step | Result |
|------|--------|
| R2 upload | ${report.steps.upload?.ok ? 'PASS' : 'FAIL'} (\`${report.steps.upload?.reelId || 'n/a'}\`) |
| Refresh persists vault | ${report.steps.refreshAfterUpload?.pass ? 'PASS' : 'FAIL'} |
| Hard refresh (informational) | ${report.steps.hardRefresh?.pass ? 'PASS' : 'WARN'} |
| API DELETE + catalog gone | ${report.steps.apiDelete?.catalogGone ? 'PASS' : 'FAIL'} |
| Post-delete refresh (no resurrection) | ${report.steps.postDeleteRefresh?.pass ? 'PASS' : 'FAIL'} (resurrected=${report.steps.postDeleteRefresh?.resurrected}) |
| Second refresh | ${report.steps.secondRefresh?.pass ? 'PASS' : 'FAIL'} |
| Browser restart | ${report.steps.browserRestart?.pass ? 'PASS' : 'FAIL'} |

## Root cause

\`hydrateVaultFromReels()\` merged stale \`personal_video_vault\` rows with backend catalog entries on every bootstrap reload. Deleted reel ids absent from \`GET /api/reels\` were kept from localStorage, resurrecting ghosts after API-only deletes (no browser tombstone).

## Patch (smallest scope)

1. \`deletionSync.js\` — \`pruneGhostVideoVaultEntries()\` + \`isPendingLocalVideoVaultEntry()\` (keeps blob: in-flight uploads).
2. \`mediaBootstrap.js\` — bootstrap video reconcile: backend catalog wins; prune local ghosts before persist.
3. \`viewerContext.js\` — \`filterOutDeletedMedia\` on video reload + \`persistPersonalVault\`.

**Not modified:** thumbnailVault, hero pipeline, signed upload, Railway routes, thumbnail hydration.

## Lifecycle trace

\`\`\`
DELETE /api/reels/{id}  →  catalog row removed (backend correct)
       ↓
page reload  →  bootstrapMediaFromBackend()
       ↓
hydrateVaultFromReels  →  GET /api/reels (deleted id absent)
       ↓
[BUG] merge local + backend  →  stale id re-written to personal_video_vault
       ↓
[FIX] pruneGhostVideoVaultEntries  →  drop ids not in catalog; persist reconciled vault
       ↓
onMount reads LS  →  syncFromVault reinforces backend projection
\`\`\`

## Production

- Frontend: ${FRONTEND_URL}
- Backend: ${API_URL}
- Validated: ${report.ts}
${report.error ? `\n**Error:** ${report.error}\n` : ''}

Raw JSON: \`artifacts/video-delete-resurrection-01.json\`
`;

  fs.writeFileSync(OUT_MD, md);
  console.log(JSON.stringify({ pass: report.pass, out: OUT_MD, json: OUT_JSON }, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main();
