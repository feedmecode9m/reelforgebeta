import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:5173/';
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8080';
const OUT_DIR = process.env.OUT_DIR || path.resolve(process.cwd());

const TESTS = [
  { id: 'A', label: 'jpg', file: '/tmp/vault-tests/test-a.jpg', mime: 'image/jpeg', selector: '.thumbnail-drop-zone', accept: true },
  { id: 'B', label: 'png', file: '/tmp/vault-tests/test-b.png', mime: 'image/png', selector: '.thumbnail-drop-zone', accept: true },
  { id: 'C', label: 'webp', file: '/tmp/vault-tests/test-c.webp', mime: 'image/webp', selector: '.thumbnail-drop-zone', accept: true },
  { id: 'D', label: 'mp4', file: '/tmp/vault-tests/test-d.mp4', mime: 'video/mp4', selector: '.video-vault-drop', accept: false }
];

function parseMediaPath(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url, API_BASE);
    if (u.pathname.startsWith('/thumbs/') || u.pathname.startsWith('/videos/')) return u.pathname;
    return null;
  } catch {
    if (url.startsWith('/thumbs/') || url.startsWith('/videos/')) return url;
    return null;
  }
}

function getStoreSnapshot(localStorageDump) {
  const thumbs = JSON.parse(localStorageDump.personal_thumbnails || '[]');
  const videos = JSON.parse(localStorageDump.personal_video_vault || '[]');
  const feed = JSON.parse(localStorageDump.reelforge_feed || '{}');
  const feedCount = Object.values(feed).flat().length;
  return {
    personalThumbnailCollection: Array.isArray(thumbs) ? thumbs.length : 0,
    personalVideos: Array.isArray(videos) ? videos.length : 0,
    personalVault: Array.isArray(videos) ? videos.length : 0,
    feed: feedCount
  };
}

async function dumpLocalStorage(page) {
  return page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      out[key] = localStorage.getItem(key);
    }
    return out;
  });
}

async function dropFile(page, selector, filePath, fileName, mimeType) {
  const data = fs.readFileSync(filePath).toString('base64');
  await page.evaluate(
    async ({ targetSelector, b64, name, type }) => {
      const target = document.querySelector(targetSelector);
      if (!target) throw new Error(`Missing drop target: ${targetSelector}`);
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], name, { type });
      const dt = new DataTransfer();
      dt.items.add(file);
      target.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
      target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    { targetSelector: selector, b64: data, name: fileName, type: mimeType }
  );
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
  });
  const page = await context.newPage();
  const diagnostics = [];

  page.on('console', (msg) => {
    const text = msg.text();
    if (
      /\[(DROP_RECEIVED|UPLOAD_STARTED|UPLOAD_SUCCESS|UPLOAD_FAILED|STORE_WRITE|STORE_UPDATE|VAULT_RENDER|VAULT_ITEM_COUNT|VIDEO_RENDER|IMAGE_RENDER)\]/.test(
        text
      )
    ) {
      diagnostics.push({ ts: new Date().toISOString(), level: msg.type(), text });
    }
  });

  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.click('.ghost-trigger').catch(() => {});
  await page.waitForSelector('.control-center-container', { timeout: 15000 });
  await page.click('#command-center-section-tab-content').catch(() => {});
  await page.click('button[role="tab"]:has-text("Content")').catch(() => {});
  await page.waitForTimeout(500);
  await page.waitForSelector('.thumbnail-drop-zone', { timeout: 15000 });
  await page.waitForSelector('.video-vault-drop', { timeout: 15000 });

  const beforeLs = await dumpLocalStorage(page);
  const storeAudit = {
    beforeUpload: getStoreSnapshot(beforeLs),
    afterUpload: null,
    afterRefresh: null
  };

  const testResults = [];
  const createdIds = [];
  for (const test of TESTS) {
    const startDiagIndex = diagnostics.length;
    await dropFile(page, test.selector, test.file, path.basename(test.file), test.mime);
    if (test.accept) {
      await page.waitForSelector('.accept-btn', { timeout: 10000 });
      await page.click('.accept-btn');
    }
    await page.waitForTimeout(3500);
    const reelsRes = await fetch(`${API_BASE}/api/reels`);
    const reels = reelsRes.ok ? await reelsRes.json() : [];
    const newest = Array.isArray(reels) && reels.length > 0 ? reels[0] : null;
    const mediaPath = parseMediaPath(newest?.url);
    const thumbPath = parseMediaPath(newest?.thumbnailUrl || newest?.thumbnail_path);
    if (newest?.id) createdIds.push(newest.id);
    testResults.push({
      testId: test.id,
      file: path.basename(test.file),
      mime: test.mime,
      diagnostics: diagnostics.slice(startDiagIndex),
      apiNewest: newest
        ? {
            id: newest.id,
            type: newest.type,
            url: newest.url,
            thumbnailUrl: newest.thumbnailUrl || newest.thumbnail_path,
            status: newest.status
          }
        : null,
      diskCheck: {
        mediaPath,
        thumbPath,
        mediaExists: mediaPath ? fs.existsSync(path.resolve('/home/youloose2dafish/projects/reelforge/backend/public', `.${mediaPath}`)) : false,
        thumbExists: thumbPath ? fs.existsSync(path.resolve('/home/youloose2dafish/projects/reelforge/backend/public', `.${thumbPath}`)) : false
      }
    });
  }

  const afterLs = await dumpLocalStorage(page);
  storeAudit.afterUpload = getStoreSnapshot(afterLs);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.click('.ghost-trigger').catch(() => {});
  await page.waitForSelector('.control-center-container', { timeout: 15000 });
  await page.click('#command-center-section-tab-content').catch(() => {});
  await page.click('button[role="tab"]:has-text("Content")').catch(() => {});
  await page.waitForSelector('.thumbnail-drop-zone', { timeout: 15000 });
  const afterRefreshLs = await dumpLocalStorage(page);
  storeAudit.afterRefresh = getStoreSnapshot(afterRefreshLs);

  const certification = {
    imageCards: await page.locator('.vault-grid--images .vault-card').count(),
    videoCards: await page.locator('.vault-grid--videos .vault-card').count()
  };

  await browser.close();

  const pipelineReport = {
    generatedAt: new Date().toISOString(),
    frontendUrl: FRONTEND_URL,
    apiBase: API_BASE,
    tests: testResults,
    diagnostics,
    storeAudit,
    certification
  };

  fs.writeFileSync(path.join(OUT_DIR, 'vault-pipeline-report.json'), JSON.stringify(pipelineReport, null, 2));

  const regressionReport = {
    generatedAt: new Date().toISOString(),
    observations: [
      'Backend process had previously terminated (exit 137) and later failed startup due database unavailable.',
      'During outage, frontend could not complete upload/sync pipeline and vault would not refresh from backend.',
      'Git history for suspect files is unavailable in HEAD because paths are currently untracked in this working tree; regression pinpoint relies on runtime evidence.'
    ]
  };
  fs.writeFileSync(path.join(OUT_DIR, 'vault-regression-report.json'), JSON.stringify(regressionReport, null, 2));

  const repairReport = {
    generatedAt: new Date().toISOString(),
    applied: [
      'Added forensic diagnostics across drop/upload/store/render pipeline.',
      'Recovered backend dependencies by starting Postgres and backend runtime.'
    ]
  };
  fs.writeFileSync(path.join(OUT_DIR, 'vault-repair-report.json'), JSON.stringify(repairReport, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

