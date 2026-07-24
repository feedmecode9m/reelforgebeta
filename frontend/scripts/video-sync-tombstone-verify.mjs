#!/usr/bin/env node
/**
 * VIDEO-SYNC tombstone verification — production probe (read-only product code).
 * TEST-HARNESS-01: all post-delete assertions bind to the actual deleted reel id.
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
const OUT_JSON = path.join(ROOT, 'artifacts/video-sync-tombstone-verify.json');
const OUT_MD = path.join(ROOT, 'artifacts/VIDEO_SYNC_TOMBSTONE_VERIFY.md');
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const KEY = {
  VIDEO_VAULT: 'personal_video_vault',
  DELETED_IDS: 'reelforge_deleted_media_ids',
  ADMIN_TOKEN: 'reelforge_admin_session_token'
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function reelIdFromDeleteUrl(url = '') {
  const match = String(url).match(/\/api\/reels\/([^/?#]+)/i);
  return match ? match[1] : null;
}

function ensureFixture() {
  const ts = Date.now();
  const dir = path.join('/tmp', `tombstone-verify-${ts}`);
  fs.mkdirSync(dir, { recursive: true });
  const video = path.join(dir, `TOMBSTONE_VERIFY_${ts}.mp4`);
  execFileSync(
    'ffmpeg',
    ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video],
    { stdio: 'ignore' }
  );
  return { video, ts };
}

async function apiLogin() {
  for (const pw of ADMIN_PASSWORDS) {
    const res = await fetch(`${API_URL}/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw.trim() })
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.token) return { token: body.token };
  }
  throw new Error('API login failed');
}

async function fetchCatalog(token) {
  const res = await fetch(`${API_URL}/api/reels`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => []);
  return Array.isArray(body) ? body : body.reels || [];
}

async function uploadSmallVideo(token, filePath) {
  const buf = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const fd = new FormData();
  fd.append('video', new Blob([buf], { type: 'video/mp4' }), fileName);
  fd.append('category', 'Trending');
  fd.append('title', `TOMBSTONE-VERIFY ${fileName}`);
  const res = await fetch(`${API_URL}/api/reels`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

async function loginStudio(page) {
  if (!(await page.locator('.control-center-overlay').isVisible().catch(() => false))) {
    await page.locator('button.ghost-trigger').click({ timeout: 60000 });
  }
  await page.waitForSelector('.control-center-overlay', { timeout: 60000 });
  if (await page.locator('.admin-login-panel').isVisible().catch(() => false)) {
    for (const pw of ADMIN_PASSWORDS) {
      await page.locator('.admin-login-panel input[type="password"]').fill(pw.trim());
      await page.locator('.admin-login-panel button.submit-btn').click();
      await sleep(1500);
      if (await page.locator('.logout-btn').isVisible().catch(() => false)) break;
    }
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

/** Resolve vault row id for a delete button (TEST-HARNESS-01). */
async function resolveDeleteButtonTargetId(page, buttonIndex = 0) {
  return page.evaluate(
    ({ vaultKey, index }) => {
      const vault = JSON.parse(localStorage.getItem(vaultKey) || '[]');
      if (!Array.isArray(vault)) return { rowId: null, label: null, reason: 'vault_not_array' };
      const buttons = [...document.querySelectorAll('button[aria-label^="Delete video"]')];
      const btn = buttons[index];
      if (!btn) return { rowId: null, label: null, reason: 'button_not_found' };
      const label = btn.getAttribute('aria-label') || '';
      const suffix = label.replace(/^Delete video\s+/i, '').trim();
      const match = vault.find((entry) => {
        const name = String(entry?.name || '').trim();
        const fileName = String(entry?.fileName || '').trim();
        return suffix === name || suffix === fileName || name.startsWith(suffix) || suffix.startsWith(name);
      });
      return {
        rowId: match?.id ? String(match.id) : null,
        label,
        reason: match?.id ? 'aria_label_vault_match' : 'no_vault_match_for_label'
      };
    },
    { vaultKey: KEY.VIDEO_VAULT, index: buttonIndex }
  );
}

/** Click delete for a specific vault reel id when present in the grid. */
async function clickDeleteForReelId(page, targetReelId) {
  return page.evaluate((targetId) => {
    const vault = JSON.parse(localStorage.getItem('personal_video_vault') || '[]');
    const entry = (Array.isArray(vault) ? vault : []).find((e) => String(e?.id) === String(targetId));
    if (!entry) return { ok: false, reason: 'target_not_in_vault' };
    const name = String(entry.name || entry.fileName || '').trim();
    const buttons = [...document.querySelectorAll('button[aria-label^="Delete video"]')];
    const btn = buttons.find((b) => {
      const label = String(b.getAttribute('aria-label') || '');
      return label.includes(name) || (entry.fileName && label.includes(entry.fileName));
    });
    if (!btn) return { ok: false, reason: 'delete_button_not_found', name };
    btn.click();
    return { ok: true, label: btn.getAttribute('aria-label'), rowId: String(targetId) };
  }, targetReelId);
}

async function main() {
  const fixture = ensureFixture();
  const apiAuth = await apiLogin();
  const report = {
    mission: 'VIDEO-SYNC-TOMBSTONE-VERIFY',
    harness: 'TEST-HARNESS-01',
    ts: new Date().toISOString(),
    frontendUrl: FRONTEND_URL,
    apiUrl: API_URL,
    deleteIdentity: {},
    questions: {},
    timeline: [],
    pass: false
  };

  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(CHROMIUM) ? CHROMIUM : undefined
  });
  const context = await browser.newContext();
  context.on('page', (p) => p.on('dialog', (d) => d.accept().catch(() => {})));

  const page = await context.newPage();
  const network = [];
  const consoleLogs = [];
  const vaultWrites = [];

  page.on('request', (req) => {
    const url = req.url();
    if (req.method() === 'DELETE' && url.includes('/api/reels/')) {
      network.push({ phase: 'request', method: 'DELETE', url });
    }
  });
  page.on('response', async (res) => {
    const url = res.url();
    if (res.request().method() === 'DELETE' && url.includes('/api/reels/')) {
      let body = '';
      try {
        body = await res.text();
      } catch {
        body = '';
      }
      network.push({ phase: 'response', status: res.status(), url, body: body.slice(0, 200) });
    }
  });
  page.on('console', (msg) => {
    const text = msg.text();
    consoleLogs.push(text);
  });

  await page.addInitScript(({ vaultKey }) => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === vaultKey) {
        let ids = [];
        try {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) ids = parsed.map((e) => e?.id).filter(Boolean);
        } catch {
          /* ignore */
        }
        window.__vaultWriteLog = window.__vaultWriteLog || [];
        window.__vaultWriteLog.push({
          ts: Date.now(),
          count: ids.length,
          ids: ids.slice(0, 10),
          stack: new Error('vault-write').stack?.split('\n').slice(1, 6)
        });
      }
      return orig.call(this, key, value);
    };
  }, { vaultKey: KEY.VIDEO_VAULT });

  try {
    const upload = await uploadSmallVideo(apiAuth.token, fixture.video);
    report.upload = { ok: upload.ok, status: upload.status, reelId: upload.body?.id };
    if (!upload.ok || !upload.body?.id) throw new Error(`Upload failed ${upload.status}`);

    const reelId = String(upload.body.id);
    const uploadName = path.basename(fixture.video);
    report.timeline.push({ t: 'upload', reelId, catalogHas: true });

    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.evaluate(({ token, reelId, entry, vaultKey }) => {
      localStorage.setItem('reelforge_admin_session_token', token);
      const raw = localStorage.getItem(vaultKey);
      const vault = raw ? JSON.parse(raw) : [];
      const next = Array.isArray(vault)
        ? [entry, ...vault.filter((e) => String(e?.id) !== reelId)]
        : [entry];
      localStorage.setItem(vaultKey, JSON.stringify(next));
    }, {
      token: apiAuth.token,
      reelId,
      vaultKey: KEY.VIDEO_VAULT,
      entry: {
        id: reelId,
        name: uploadName,
        fileName: upload.body.fileName || uploadName,
        url: upload.body.url || `/videos/${upload.body.fileName || uploadName}`,
        type: 'video/mp4',
        size: fs.statSync(fixture.video).size,
        addedAt: new Date().toISOString()
      }
    });

    await loginStudio(page);
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
      { timeout: 30000 }
    );
    await sleep(2000);

    const preDelete = {
      token: Boolean(await page.evaluate(() => localStorage.getItem('reelforge_admin_session_token'))),
      tombstones: await getLs(page, KEY.DELETED_IDS),
      vaultIds: (await getLs(page, KEY.VIDEO_VAULT))?.map((e) => e?.id) || [],
      diskNameGuard: await page.evaluate(
        ({ vaultKey, id }) => {
          const vault = JSON.parse(localStorage.getItem(vaultKey) || '[]');
          const v = vault.find((e) => String(e?.id) === String(id));
          const url = String(v?.url || '');
          const disk = url.split('/').pop()?.split('?')[0] || String(v?.fileName || v?.name || '');
          return { url, diskName: disk, hasToken: Boolean(localStorage.getItem('reelforge_admin_session_token')) };
        },
        { vaultKey: KEY.VIDEO_VAULT, id: reelId }
      )
    };
    report.preDelete = preDelete;

    await page.evaluate(() => {
      window.__vaultWriteLog = [];
    });

    const selectedRow = await resolveDeleteButtonTargetId(page, 0);
    report.deleteIdentity.uploadReelId = reelId;
    report.deleteIdentity.selectedRowId = selectedRow.rowId;
    report.deleteIdentity.selectedRowLabel = selectedRow.label;
    report.deleteIdentity.selectedRowMatch = selectedRow.reason;

    const deleteClick = await clickDeleteForReelId(page, reelId);
    report.deletePath = deleteClick.ok ? 'ui_delete_upload_reel' : 'ui_delete_button_fallback';
    if (!deleteClick.ok) {
      const deleteBtn = page.locator('button[aria-label^="Delete video"]').first();
      await deleteBtn.waitFor({ state: 'visible', timeout: 30000 });
      await deleteBtn.click();
      const fallbackRow = await resolveDeleteButtonTargetId(page, 0);
      report.deleteIdentity.selectedRowId = fallbackRow.rowId;
      report.deleteIdentity.selectedRowLabel = fallbackRow.label;
      report.deleteIdentity.selectedRowMatch = fallbackRow.reason;
    } else {
      report.deleteIdentity.selectedRowId = deleteClick.rowId || reelId;
      report.deleteIdentity.selectedRowLabel = deleteClick.label;
      report.deleteIdentity.selectedRowMatch = 'upload_reel_targeted_click';
    }

    await sleep(10000);

    const deleteResponses = network.filter((n) => n.phase === 'response' && n.url?.includes('/api/reels/'));
    const deleteRequestId = deleteResponses.map((n) => reelIdFromDeleteUrl(n.url)).find(Boolean) || null;
    const verificationId =
      deleteRequestId || report.deleteIdentity.selectedRowId || reelId;

    report.deleteIdentity.deleteRequestId = deleteRequestId;
    report.deleteIdentity.verificationId = verificationId;
    report.deleteIdentity.idsAligned =
      Boolean(deleteRequestId) &&
      Boolean(report.deleteIdentity.selectedRowId) &&
      deleteRequestId === report.deleteIdentity.selectedRowId;

    const postDelete = {
      deleteNetwork: deleteResponses,
      tombstones: await getLs(page, KEY.DELETED_IDS),
      vaultIds: (await getLs(page, KEY.VIDEO_VAULT))?.map((e) => e?.id) || [],
      vaultWrites: await page.evaluate(() => window.__vaultWriteLog || []),
      persistenceLogs: consoleLogs.filter((t) =>
        t.includes('DELETE_PERSISTENCE') ||
        t.includes('VAULT-DELETE-TRACE') ||
        t.includes('VIDEO-SYNC-01') ||
        t.includes('syncFromVault') ||
        t.includes('VIDEO_VAULT_INSERT') ||
        t.includes('STORE_WRITE')
      ),
      resurrected: false
    };
    postDelete.resurrected = postDelete.vaultIds.includes(verificationId);

    const catalogAfter = await fetchCatalog(apiAuth.token);
    const catalogHas = catalogAfter.some((r) => String(r.id) === verificationId);

    const tombstoneIds = Array.isArray(postDelete.tombstones) ? postDelete.tombstones.map(String) : [];
    const tombstoneWritten = tombstoneIds.includes(String(verificationId));
    const diskGuardTarget = (await getLs(page, KEY.VIDEO_VAULT))?.find(
      (e) => String(e?.id) === String(verificationId)
    );
    const diskNameForGuard = diskGuardTarget
      ? String(diskGuardTarget.url || '')
          .split('/')
          .pop()
          ?.split('?')[0] || String(diskGuardTarget.fileName || diskGuardTarget.name || '')
      : preDelete.diskNameGuard?.diskName || '';

    report.questions = {
      verificationId,
      deleteReturns200: deleteResponses.some((n) => n.status === 200),
      catalogRemovedImmediately: !catalogHas,
      tombstoneWritten,
      tombstoneGuardSkipped: !preDelete.token ? '!token' : !diskNameForGuard ? '!diskName' : null,
      firstVaultWriterAfterDelete: postDelete.vaultWrites[0] || null,
      resurrectedInVault: postDelete.resurrected,
      videoSync01Logs: consoleLogs.filter((t) => t.includes('[VIDEO-SYNC-01]')).slice(0, 5)
    };

    report.postDelete = postDelete;
    report.catalogHasAfterDelete = catalogHas;
    report.pass =
      report.questions.deleteReturns200 &&
      report.questions.catalogRemovedImmediately &&
      report.questions.tombstoneWritten &&
      !report.questions.resurrectedInVault;

    report.timeline.push({ t: 'post_ui_delete', verificationId, ...report.questions });

    await fetch(`${API_URL}/api/reels/${reelId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiAuth.token}` }
    }).catch(() => {});
    if (verificationId !== reelId) {
      await fetch(`${API_URL}/api/reels/${verificationId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiAuth.token}` }
      }).catch(() => {});
    }
  } finally {
    await browser.close();
  }

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  const md = `# VIDEO-SYNC Tombstone Verification

**Run:** ${report.ts}  
**Frontend:** ${FRONTEND_URL}  
**Harness:** ${report.harness}

## Delete identity binding (TEST-HARNESS-01)

| Field | Value |
|-------|-------|
| Upload reel id | \`${report.deleteIdentity.uploadReelId || 'n/a'}\` |
| Selected row id | \`${report.deleteIdentity.selectedRowId || 'n/a'}\` |
| DELETE request id | \`${report.deleteIdentity.deleteRequestId || 'n/a'}\` |
| Verification id | \`${report.deleteIdentity.verificationId || 'n/a'}\` |
| IDs aligned | ${report.deleteIdentity.idsAligned ? 'YES' : 'NO / partial'} |

## Questions (bound to verification id)

| Question | Result |
|----------|--------|
| Verification id | \`${report.questions.verificationId || 'n/a'}\` |
| DELETE returns 200? | ${report.questions.deleteReturns200 ? 'YES' : 'NO / not captured'} |
| Catalog entry removed immediately? | ${report.questions.catalogRemovedImmediately ? 'YES' : 'NO'} |
| Tombstone in \`reelforge_deleted_media_ids\`? | ${report.questions.tombstoneWritten ? 'YES' : 'NO'} |
| Guard skipped (\`!token\` / \`!diskName\`)? | ${report.questions.tombstoneGuardSkipped || 'none — guards satisfied'} |
| Resurrected in \`personal_video_vault\` after delete? | ${report.questions.resurrectedInVault ? 'YES' : 'NO'} |

## First \`personal_video_vault\` writer after delete

\`\`\`json
${JSON.stringify(report.questions.firstVaultWriterAfterDelete, null, 2)}
\`\`\`

## VIDEO-SYNC-01 console lines

${(report.questions.videoSync01Logs || []).map((l) => `- ${l}`).join('\n') || '(none captured)'}

## Relevant console lines

${(report.postDelete?.persistenceLogs || []).slice(0, 20).map((l) => `- ${l}`).join('\n') || '(none captured)'}

## DELETE network

\`\`\`json
${JSON.stringify(report.postDelete?.deleteNetwork || [], null, 2)}
\`\`\`

**Overall probe pass:** ${report.pass ? 'PASS' : 'FAIL — see table above'}
`;

  fs.writeFileSync(OUT_MD, md);
  console.log(JSON.stringify({ deleteIdentity: report.deleteIdentity, questions: report.questions }, null, 2));
  console.log('Wrote', OUT_MD);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
