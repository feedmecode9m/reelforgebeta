#!/usr/bin/env node
import { writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORT_PATH = join(ROOT, 'batch-delete-direct-live-report.json');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const FALLBACK_CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (res.ok) return true;
    } catch {
      // retry
    }
    await sleep(800);
  }
  return false;
}

async function openThumbnailPanel(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('.ghost-trigger', { timeout: 15000 });
  await page.click('.ghost-trigger');
  const passwordInput = page.locator('.admin-login-panel input[type="password"]').first();
  if (await passwordInput.count()) {
    await passwordInput.fill(ADMIN_PASSWORD);
    const unlockButton = page.locator('.admin-login-panel .submit-btn').first();
    if (await unlockButton.count()) await unlockButton.click();
    else await passwordInput.press('Enter');
    await page.waitForTimeout(1000);
  }

  const systemTab = page.locator('button[role="tab"]').filter({ hasText: 'System' }).first();
  if (await systemTab.count()) {
    await systemTab.click();
    await page.waitForTimeout(600);
  }
  const contentTab = page.locator('button[role="tab"]').filter({ hasText: 'Content' }).first();
  if (await contentTab.count()) {
    await contentTab.click();
    await page.waitForTimeout(900);
  }

  const thumbSection = page.locator('.personal-media-grid').filter({ hasText: 'Your Thumbnails' }).first();
  await thumbSection.waitFor({ state: 'visible', timeout: 30000 });
  const checkboxes = thumbSection.locator('input[type="checkbox"]');
  await checkboxes.first().waitFor({ state: 'visible', timeout: 30000 });
  return { thumbSection, checkboxes };
}

async function runBatchCase(page, targetCount) {
  const { thumbSection, checkboxes } = await openThumbnailPanel(page);
  const beforeCount = await checkboxes.count();
  const selectedCount = Math.min(beforeCount, targetCount);
  if (selectedCount < targetCount) {
    return { ok: false, reason: `Need ${targetCount}, found ${beforeCount}` };
  }

  const startAt = Date.now();
  for (let i = 0; i < selectedCount; i += 1) {
    await checkboxes.nth(i).click({ force: true });
    await page.waitForTimeout(60);
  }

  page.once('dialog', (dialog) => dialog.accept().catch(() => {}));
  const deleteSelectedButton = thumbSection.locator('button:has-text("DELETE SELECTED")').first();
  await deleteSelectedButton.click({ timeout: 8000 });

  const expectedAfterMax = beforeCount - selectedCount;
  await page.waitForFunction(
    ({ maxCount }) => {
      const section = Array.from(document.querySelectorAll('.personal-media-grid')).find((node) =>
        node.textContent?.includes('Your Thumbnails')
      );
      if (!section) return false;
      const count = section.querySelectorAll('input[type="checkbox"]').length;
      return count <= maxCount;
    },
    { maxCount: expectedAfterMax },
    { timeout: 20000 }
  ).catch(() => {});

  await page.waitForTimeout(1200);
  const afterCount = await thumbSection.locator('input[type="checkbox"]').count();
  const logs = await page.evaluate(({ since }) => {
    const raw = Array.isArray(window.__batchLogs) ? window.__batchLogs : [];
    return raw.filter((entry) => Number(entry.at || 0) >= since);
  }, { since: startAt });

  const tags = logs.map((entry) => String(entry.args?.[0] || ''));
  const findPayload = (tag) => logs.find((entry) => String(entry.args?.[0] || '') === tag)?.args?.[1] || {};
  const iterationCount = logs.filter((entry) => String(entry.args?.[0] || '') === '[BATCH_DELETE_ITERATION]').length;
  const selectedIds = Array.isArray(findPayload('[BATCH_DELETE_START]')?.selectedIds)
    ? findPayload('[BATCH_DELETE_START]').selectedIds
    : [];

  return {
    ok: afterCount <= expectedAfterMax,
    targetCount,
    beforeCount,
    afterCount,
    selectedCount,
    selectedIds,
    chain: {
      batchSelect: tags.includes('[BATCH_SELECT]'),
      batchDeleteClick: tags.includes('[BATCH_DELETE_CLICK]'),
      batchDeleteConfirm: tags.includes('[BATCH_DELETE_CONFIRM]'),
      batchStoreUpdate: tags.includes('[BATCH_STORE_UPDATE]'),
      batchPersist: tags.includes('[BATCH_PERSIST]'),
      batchUiRefresh: tags.includes('[BATCH_UI_REFRESH]'),
      iterationCount
    },
    tailLogs: logs.slice(-16).map((entry) => ({
      tag: String(entry.args?.[0] || ''),
      payload: entry.args?.[1] && typeof entry.args[1] === 'object' ? entry.args[1] : null
    }))
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  cases: { delete3: null, delete10plus: null },
  persistence: { reloadRetainsDeletes: false, checkedIds: [], missingAfterReload: [] },
  completionToken: 'BATCH_DELETE_REPAIRED=false'
};

if (!(await waitForHttp(BASE_URL))) {
  report.error = `Frontend unavailable at ${BASE_URL}`;
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(report.completionToken);
  process.exit(1);
}

const launchOptions = { headless: true };
if (existsSync(FALLBACK_CHROMIUM)) launchOptions.executablePath = FALLBACK_CHROMIUM;
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage();

await page.addInitScript(() => {
  window.__batchLogs = [];
  const originalInfo = console.info.bind(console);
  console.info = (...args) => {
    try {
      if (String(args[0] || '').startsWith('[BATCH_')) {
        window.__batchLogs.push({ at: Date.now(), args });
      }
    } catch {
      // ignore
    }
    originalInfo(...args);
  };
});

report.cases.delete3 = await runBatchCase(page, 3);
report.cases.delete10plus = await runBatchCase(page, 10);

const checkedIds = Array.from(
  new Set([...(report.cases.delete3?.selectedIds || []), ...(report.cases.delete10plus?.selectedIds || [])])
)
  .map((id) => String(id || '').trim())
  .filter(Boolean);
report.persistence.checkedIds = checkedIds;

await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
const { thumbSection } = await openThumbnailPanel(page);
const namesAfterReload = await page.evaluate(() => {
  try {
    const parsed = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry || '').trim()) : [];
  } catch {
    return [];
  }
});
report.persistence.missingAfterReload = checkedIds.filter((id) => !namesAfterReload.includes(id));
report.persistence.reloadRetainsDeletes =
  checkedIds.length > 0 && report.persistence.missingAfterReload.length === checkedIds.length;
report.persistence.afterReloadCount = await thumbSection.locator('input[type="checkbox"]').count();

const success =
  Boolean(report.cases.delete3?.ok) &&
  Boolean(report.cases.delete10plus?.ok) &&
  (report.cases.delete3?.chain?.iterationCount || 0) >= 3 &&
  (report.cases.delete10plus?.chain?.iterationCount || 0) >= 10 &&
  report.persistence.reloadRetainsDeletes;

report.completionToken = success ? 'BATCH_DELETE_REPAIRED=true' : 'BATCH_DELETE_REPAIRED=false';

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await browser.close();
console.log(report.completionToken);
