#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORT_PATH = join(ROOT, 'hero-replace-processing-report.json');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  steps: {
    openedApp: false,
    openedStudioSystemTab: false,
    selectedFile: false,
    clickedAccept: false,
    processingCleared: false,
    heroConfigUpdated: false,
    heroMediaPersisted: false
  },
  checks: {
    processingStuck: true
  },
  heroState: {},
  heroLogs: [],
  errors: []
};

function pushError(error) {
  report.errors.push(error?.message || String(error));
}

function samplePngBuffer() {
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z6WQAAAAASUVORK5CYII=';
  return Buffer.from(b64, 'base64');
}

async function clickIf(page, selector, timeout = 3000) {
  const target = page.locator(selector).first();
  if (!(await target.count())) return false;
  try {
    await target.click({ timeout });
    return true;
  } catch {
    return false;
  }
}

async function openSystemTab(page) {
  await page.evaluate(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_admin_session_token', 'dev_local_session');
    localStorage.setItem('reelforge_studio_workspace_tab', 'system');
    window.dispatchEvent(
      new CustomEvent('reelforge:search-navigate', {
        detail: { workspaceTab: 'system' }
      })
    );
  });
  await clickIf(page, '.ghost-trigger', 2000);
  const passwordInput = page.locator('input[type="password"]').first();
  if (await passwordInput.count()) {
    await passwordInput.fill('Gaff1505!');
    await clickIf(page, 'button:has-text("UNLOCK STUDIO")', 3000);
    await page.waitForTimeout(600);
  }
  await clickIf(page, 'button[role="tab"]:has-text("System")', 3000);
  await page.waitForSelector('.hero-replace-section, .hero-drop-zone', { timeout: 15000 });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('console', (msg) => {
  const text = msg.text();
  if (
    text.includes('[HERO_') ||
    text.includes('Processing hero asset') ||
    text.includes('hero-file-select') ||
    text.includes('HERO_ACCEPT')
  ) {
    report.heroLogs.push({
      at: Date.now(),
      type: msg.type(),
      text
    });
  }
});

try {
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  report.steps.openedApp = true;

  await openSystemTab(page);
  report.steps.openedStudioSystemTab = true;

  const fileInput = page.locator('.hero-replace-section input[type="file"]').first();
  await fileInput.setInputFiles({
    name: `hero_processing_probe_${Date.now()}.png`,
    mimeType: 'image/png',
    buffer: samplePngBuffer()
  });
  report.steps.selectedFile = true;

  const acceptBtn = page.locator('.hero-replace-section .accept-btn').first();
  await acceptBtn.waitFor({ state: 'visible', timeout: 7000 });
  await acceptBtn.click({ timeout: 3000 });
  report.steps.clickedAccept = true;

  const processingNode = page.locator('.hero-replace-section .hero-loading-indicator:has-text("Processing hero asset")');
  try {
    await processingNode.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    // processing can resolve quickly and skip visible wait.
  }
  await processingNode.waitFor({ state: 'hidden', timeout: 30000 });
  report.steps.processingCleared = true;
  report.checks.processingStuck = false;

  const heroState = await page.evaluate(() => {
    const cfgRaw = localStorage.getItem('reelforge_hero_manager_config') || '';
    let cfg = {};
    try {
      cfg = cfgRaw ? JSON.parse(cfgRaw) : {};
    } catch {
      cfg = {};
    }
    const imageRaw = localStorage.getItem('reelforge_hero_image') || '';
    const videoRaw = localStorage.getItem('reelforge_hero_video') || '';
    return {
      heroAssetId: String(cfg.heroAssetId || ''),
      backgroundSource: String(cfg.backgroundSource || ''),
      heroLabel: String(cfg.heroLabel || ''),
      heroTitle: String(cfg.heroTitle || ''),
      heroSubtitle: String(cfg.heroSubtitle || ''),
      hasHeroImage: imageRaw.length > 0,
      hasHeroVideo: videoRaw.length > 0,
      heroImageLength: imageRaw.length,
      heroVideoLength: videoRaw.length
    };
  });
  report.heroState = heroState;
  report.steps.heroConfigUpdated = Boolean(heroState.heroAssetId && heroState.backgroundSource);
  report.steps.heroMediaPersisted = Boolean(heroState.hasHeroImage || heroState.hasHeroVideo);
} catch (error) {
  pushError(error);
} finally {
  await browser.close();
}

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const success =
  report.steps.openedApp &&
  report.steps.openedStudioSystemTab &&
  report.steps.selectedFile &&
  report.steps.clickedAccept &&
  report.steps.processingCleared &&
  report.steps.heroConfigUpdated &&
  report.steps.heroMediaPersisted &&
  !report.checks.processingStuck;

console.log(success ? 'HERO_REPLACE_PROCESSING_VALIDATED=true' : 'HERO_REPLACE_PROCESSING_VALIDATED=false');
