/**
 * BG-7A — Hero auto-accept journey (Drop → Auto Upload → Persist)
 * Requires studio admin unlock; uses production or BASE_URL.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unlockStudioWithHeroSection, readHeroStorage } from './helpers/studio-navigation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function ensureTestMp4() {
  const p = path.join(__dirname, 'tmp', 'hero-confirmation.mp4');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (!fs.existsSync(p)) {
    execSync(
      `ffmpeg -y -f lavfi -i color=c=teal:s=320x240:d=2 -c:v libx264 -pix_fmt yuv420p -movflags +faststart ${p}`,
      { stdio: 'ignore' }
    );
  }
  return p;
}

test.describe('BG-7A Hero auto-accept', () => {
  test('drop auto upload persist', async ({ page }) => {
    const postUrls = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/reels')) {
        postUrls.push(req.url());
      }
    });

    await unlockStudioWithHeroSection(page);
    await expect(page.locator('.hero-replace-section')).toHaveCount(1);

    const before = await readHeroStorage(page);
    expect(before.reel?.id).toBeFalsy();

    const mp4 = ensureTestMp4();
    const fileInput = page.locator('.hero-replace-section input[type="file"]');
    await fileInput.setInputFiles(mp4);

    await expect
      .poll(() => postUrls.length, { timeout: 15_000 })
      .toBeGreaterThan(0);

    await expect
      .poll(async () => {
        const ls = await readHeroStorage(page);
        return ls.reel?.id || '';
      }, { timeout: 90_000 })
      .not.toBe('');

    const after = await readHeroStorage(page);
    expect(after.mgr?.backgroundSource).toBe('custom_video');
    expect(after.mgr?.heroAssetId).toBe(after.reel.id);

    const reelId = after.reel.id;
    await page.reload();
    await page.waitForTimeout(2000);
    const reloaded = await readHeroStorage(page);
    expect(reloaded.reel?.id).toBe(reelId);
  });
});
