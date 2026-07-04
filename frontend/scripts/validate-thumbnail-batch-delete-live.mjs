#!/usr/bin/env node
import { writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORT_PATH = join(ROOT, 'thumbnail-batch-delete-live-report.json');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Gaff1505!';
const FALLBACK_CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  cases: {
    delete3: null,
    delete10plus: null
  },
  persistence: {
    reloadRetainsDeletes: false,
    deletedIdsMissingAfterReload: []
  },
  logs: [],
  completionToken: 'BATCH_DELETE_REPAIRED=false'
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      // retry
    }
    await sleep(1000);
  }
  return false;
}

function normalizeBatchEntry(entry) {
  const first = String(entry?.args?.[0] || '');
  const payload = entry?.args?.[1] && typeof entry.args[1] === 'object' ? entry.args[1] : {};
  return {
    tag: first,
    payload,
    at: Number(entry?.at || Date.now())
  };
}

async function openStudio(page) {
  const existingGrid = page.locator('.vault-grid--images input[type="checkbox"]').first();
  if (await existingGrid.count()) {
    return;
  }
  await page.waitForSelector('.ghost-trigger', { timeout: 15000 });
  await page.click('.ghost-trigger').catch(() => {});

  const passwordInput = page.locator('.admin-login-panel input[type="password"]').first();
  if (await passwordInput.count()) {
    const unlock = page.locator('.admin-login-panel .submit-btn').first();
    const passwords = [ADMIN_PASSWORD, 'admin123', 'SMART_PRODUCTION', 'Gaff1505!'];
    for (const pwd of passwords) {
      await passwordInput.fill(pwd);
      if (await unlock.count()) await unlock.click();
      else await passwordInput.press('Enter');
      await page.waitForTimeout(700);
      if (!(await passwordInput.count())) break;
    }
  }

  const systemTab = page.locator('button[role="tab"]:has-text("System"), button:has-text("System")').first();
  if (await systemTab.count()) {
    await systemTab.click().catch(() => {});
    await page.waitForTimeout(700);
  }
  const contentTab = page.locator('button[role="tab"]:has-text("Content"), button:has-text("Content")').first();
  if (await contentTab.count()) {
    await contentTab.click().catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.waitForSelector('.vault-grid--images input[type="checkbox"]', { timeout: 45000 });
}

async function ensureThumbnailInventory(page, minimum = 20) {
  await page.evaluate(async ({ minimum }) => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_admin_session_token', 'dev_local_session');
    const auth = { Authorization: `Bearer ${localStorage.getItem('reelforge_admin_session_token') || 'dev_local_session'}` };
    const listReels = async () => {
      const response = await fetch('/api/reels', { headers: auth });
      return response.ok ? await response.json() : [];
    };
    let reels = await listReels();
    const names = [];
    const collectNames = (items) => {
      const output = [];
      for (const reel of Array.isArray(items) ? items : []) {
        const type = String(reel?.type || '').toLowerCase();
        const url = String(reel?.url || '');
        if (!(type === 'image' || url.includes('/thumbs/'))) continue;
        const fromThumb = String(reel?.thumbnailUrl || reel?.thumbnail_url || reel?.url || '').split('/').pop();
        const fromFile = String(reel?.fileName || reel?.file_name || '').trim();
        const candidate = String(fromThumb || fromFile || '').trim();
        if (candidate) output.push(candidate);
      }
      return output;
    };
    names.push(...collectNames(reels));
    if (names.length < minimum) {
      const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z6WQAAAAASUVORK5CYII=';
      const bytes = Uint8Array.from(atob(pngBase64), (ch) => ch.charCodeAt(0));
      for (let i = names.length; i < minimum; i += 1) {
        const form = new FormData();
        const filename = `batch-seed-${Date.now()}-${i}.png`;
        form.append('thumbnail', new File([bytes], filename, { type: 'image/png' }));
        form.append('title', `Batch Seed ${i}`);
        form.append('category', 'Trending');
        await fetch('/api/reels', { method: 'POST', headers: auth, body: form }).catch(() => null);
      }
      reels = await listReels();
      names.splice(0, names.length, ...collectNames(reels));
    }
    const deduped = Array.from(new Set(names));
    const next = deduped.slice(0, Math.max(minimum, deduped.length));
    localStorage.setItem('personal_thumbnails', JSON.stringify(next));
  }, { minimum });
}

async function runCase(page, targetCount) {
  await openStudio(page);
  const checkboxes = page.locator('.vault-grid--images input[type="checkbox"]');
  const beforeCount = await checkboxes.count();
  const selectedCount = Math.min(targetCount, beforeCount);
  if (selectedCount < targetCount) {
    return {
      ok: false,
      reason: `Only ${beforeCount} thumbnails available for target ${targetCount}`
    };
  }

  const startAt = Date.now();
  for (let i = 0; i < selectedCount; i += 1) {
    await checkboxes.nth(i).click();
    await page.waitForTimeout(80);
  }

  const confirmPromise = page.waitForEvent('dialog', { timeout: 5000 }).then((d) => d.accept()).catch(() => {});
  await page.click('button:has-text("DELETE SELECTED")');
  await confirmPromise;

  await page.waitForFunction(
    (expected) => {
      const nodes = document.querySelectorAll('.vault-grid--images input[type="checkbox"]');
      return nodes.length <= expected;
    },
    beforeCount - selectedCount,
    { timeout: 20000 }
  ).catch(() => {});

  await page.waitForTimeout(1500);
  const endAt = Date.now();
  const afterCount = await page.locator('.vault-grid--images input[type="checkbox"]').count();
  const allBatchLogs = await page.evaluate(() => window.__batchLogs || []);
  const entries = allBatchLogs
    .map(normalizeBatchEntry)
    .filter((entry) => entry.at >= startAt && entry.at <= endAt + 5000);

  const startLog = entries.find((e) => e.tag === '[BATCH_DELETE_START]');
  const selectedIds = Array.isArray(startLog?.payload?.selectedIds) ? startLog.payload.selectedIds : [];
  const iterationCount = entries.filter((e) => e.tag === '[BATCH_DELETE_ITERATION]').length;
  const storeUpdate = entries.find((e) => e.tag === '[BATCH_STORE_UPDATE]')?.payload || {};
  const persist = entries.find((e) => e.tag === '[BATCH_PERSIST]')?.payload || {};
  const uiRefresh = entries.find((e) => e.tag === '[BATCH_UI_REFRESH]')?.payload || {};

  report.logs.push(...entries);

  return {
    ok: afterCount <= beforeCount - selectedCount,
    targetCount,
    beforeCount,
    afterCount,
    selectedCount,
    selectedIds,
    chain: {
      batchSelectSeen: entries.some((e) => e.tag === '[BATCH_SELECT]'),
      batchDeleteClickSeen: entries.some((e) => e.tag === '[BATCH_DELETE_CLICK]'),
      batchDeleteConfirmSeen: entries.some((e) => e.tag === '[BATCH_DELETE_CONFIRM]'),
      iterationCount,
      batchStoreUpdateSeen: entries.some((e) => e.tag === '[BATCH_STORE_UPDATE]'),
      batchPersistSeen: entries.some((e) => e.tag === '[BATCH_PERSIST]'),
      batchUiRefreshSeen: entries.some((e) => e.tag === '[BATCH_UI_REFRESH]')
    },
    storeUpdate,
    persist,
    uiRefresh
  };
}

const frontendReady = await waitForHttp(`${BASE_URL}/`);
if (!frontendReady) {
  report.error = `Frontend not reachable at ${BASE_URL}`;
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(report.completionToken);
  process.exit(1);
}

const launchOptions = { headless: true };
if (existsSync(FALLBACK_CHROMIUM)) {
  launchOptions.executablePath = FALLBACK_CHROMIUM;
}
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage();

await page.addInitScript(() => {
  window.__batchLogs = [];
  const originalInfo = console.info.bind(console);
  console.info = (...args) => {
    try {
      const first = String(args[0] || '');
      if (first.startsWith('[BATCH_')) {
        window.__batchLogs.push({ at: Date.now(), args });
      }
    } catch {
      // ignore
    }
    originalInfo(...args);
  };
});

await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await ensureThumbnailInventory(page, 20);
await page.reload({ waitUntil: 'domcontentloaded' });

const case3 = await runCase(page, 3);
report.cases.delete3 = case3;

const case10 = await runCase(page, 10);
report.cases.delete10plus = case10;

const deletedIds = Array.from(new Set([...(case3?.selectedIds || []), ...(case10?.selectedIds || [])]))
  .map((id) => String(id || '').trim())
  .filter(Boolean);

await page.reload({ waitUntil: 'domcontentloaded' });
await openStudio(page);
const thumbsAfterReload = await page.evaluate(() => {
  try {
    const parsed = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    return Array.isArray(parsed) ? parsed.map((x) => String(x || '').trim()) : [];
  } catch {
    return [];
  }
});

report.persistence.deletedIdsMissingAfterReload = deletedIds.filter((id) => !thumbsAfterReload.includes(id));
report.persistence.reloadRetainsDeletes =
  deletedIds.length > 0 && report.persistence.deletedIdsMissingAfterReload.length === deletedIds.length;

const success =
  Boolean(case3?.ok) &&
  Boolean(case10?.ok) &&
  case3?.chain?.iterationCount >= 3 &&
  case10?.chain?.iterationCount >= 10 &&
  report.persistence.reloadRetainsDeletes;

report.completionToken = success ? 'BATCH_DELETE_REPAIRED=true' : 'BATCH_DELETE_REPAIRED=false';

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await browser.close();
console.log(report.completionToken);
