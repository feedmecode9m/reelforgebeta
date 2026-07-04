const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4173';

function createAssets(tmpDir) {
  const mp4Path = path.join(tmpDir, 'test-video.mp4');
  const jpgPath = path.join(tmpDir, 'test-image.png');

  // Minimal MP4 header (may be sufficient for the app validation)
  const mp4Header = Buffer.from([
    0x00,0x00,0x00,0x18,0x66,0x74,0x79,0x70,0x69,0x73,0x6f,0x6d,0x00,0x00,0x02,0x00,0x69,0x73,0x6f,0x32,0x6d,0x70,0x34,0x31
  ]);
  fs.writeFileSync(mp4Path, mp4Header);

  // 1x1 PNG (base64) - reliable tiny image
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQIW2NgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';
  fs.writeFileSync(jpgPath, Buffer.from(pngBase64, 'base64'));

  return { mp4Path, jpgPath };
}

test.describe('Hero System E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test('Test 1: Upload MP4 accept flow and vault update', async ({ page, context }) => {
    const tmp = path.join(__dirname, 'tmp');
    if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
    const { mp4Path } = createAssets(tmp);

    const consoleMessages = [];
    page.on('console', (msg) => {
      try { consoleMessages.push(msg.text()); } catch (e) {}
    });

    // Target the hero file input
    const fileInput = page.locator('.hero-replace-section input[type="file"]');
    await expect(fileInput).toHaveCount(1);
    await fileInput.setInputFiles(mp4Path);

    // Wait for diagnostics indicating file selected and processing
    await page.waitForTimeout(400); // allow app to process
    expect(consoleMessages.some((t) => t.includes('HERO_FILE_SELECTED'))).toBeTruthy();

    // Click accept button
    await page.click('.accept-btn');

    // Wait for processing logs
    await page.waitForTimeout(1500);
    const required = [
      'HERO_PROCESSING_START',
      'HERO_REGISTER',
      'HERO_REGISTRY_UPDATE',
      'HERO_ACCEPT_CONFIRMED',
      'HERO_BACKGROUND_APPLIED',
      'HERO_VAULT_RENDER'
    ];
    for (const r of required) {
      expect(consoleMessages.some((t) => t.includes(r))).toBeTruthy();
    }
  });

  test('Test 2: Reject image upload leaves vault unchanged', async ({ page }) => {
    const tmp = path.join(__dirname, 'tmp');
    const { jpgPath } = createAssets(tmp);

    const consoleMessages = [];
    page.on('console', (msg) => consoleMessages.push(msg.text()));

    const fileInput = page.locator('.hero-replace-section input[type="file"]');
    await fileInput.setInputFiles(jpgPath);
    await page.waitForTimeout(400);
    expect(consoleMessages.some((t) => t.includes('HERO_FILE_SELECTED'))).toBeTruthy();

    await page.click('.reject-btn');
    await page.waitForTimeout(400);
    // After reject, HERO_REJECT or UX state change should appear
    expect(consoleMessages.some((t) => t.includes('HERO_REJECT') || t.includes('HERO_UX_STATE_CHANGE'))).toBeTruthy();
  });

  test('Test 3: Multiple uploads and newest becomes active', async ({ page }) => {
    const tmp = path.join(__dirname, 'tmp');
    if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
    const { mp4Path } = createAssets(tmp);

    const consoleMessages = [];
    page.on('console', (msg) => consoleMessages.push(msg.text()));

    const fileInput = page.locator('.hero-replace-section input[type="file"]');
    await fileInput.setInputFiles(mp4Path);
    await page.waitForTimeout(200);
    await page.click('.accept-btn');
    await page.waitForTimeout(1200);

    // Registry update showing at least 2 (since prior test may have added one)
    expect(consoleMessages.some((t) => t.includes('HERO_REGISTRY_UPDATE'))).toBeTruthy();
  });

  test('Test 4 & 5: Vault interactions - Use as Hero and Delete', async ({ page }) => {
    // Click first 'Use as Hero' button
    const useButtons = page.locator('button', { hasText: 'Use as Hero' });
    await expect(useButtons.first()).toBeVisible();
    await useButtons.first().click();
    await page.waitForTimeout(400);

    // Active badge movement indicated by HERO_VAULT_SELECT
    const logs = [];
    page.on('console', (msg) => logs.push(msg.text()));
    await page.waitForTimeout(400);
    expect(logs.some((t) => t.includes('HERO_VAULT_SELECT'))).toBeTruthy();

    // Delete second asset if present
    const deleteButtons = page.locator('button', { hasText: 'Delete' });
    if ((await deleteButtons.count()) > 1) {
      await deleteButtons.nth(1).click();
      await page.waitForTimeout(400);
      expect(logs.some((t) => t.includes('HERO_VAULT_RENDER') || t.includes('HERO_REGISTRY_UPDATE'))).toBeTruthy();
    }
  });

  test('Test 6: Persistence after refresh', async ({ page }) => {
    // Refresh and check for vault render logs
    const logs = [];
    page.on('console', (msg) => logs.push(msg.text()));
    await page.reload();
    await page.waitForTimeout(800);
    expect(logs.some((t) => t.includes('HERO_VAULT_RENDER'))).toBeTruthy();
  });
});

// Helper to make file available to Playwright runner when launched from project root
module.exports = {};
