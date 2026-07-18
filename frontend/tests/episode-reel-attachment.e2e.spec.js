/**
 * PRODUCT-03 — Vault → Episode attach end-to-end (Playwright)
 * Requires studio admin unlock; uses BASE_URL or production Netlify.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  unlockStudio,
  openContentTab,
  openProductionTab,
  unlockStudioWithProductionPanel,
  readEpisodeAttachment,
  listVaultReelIds
} from './helpers/studio-navigation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Catalog episode with no default reel in mock data (Zero Day). */
const TARGET_EPISODE_ID = 'ep-neon-s01e04';

function ensureTestMp4() {
  const p = path.join(__dirname, 'tmp', 'episode-attach.mp4');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (!fs.existsSync(p)) {
    execSync(
      `ffmpeg -y -f lavfi -i color=c=orange:s=320x240:d=2 -c:v libx264 -pix_fmt yuv420p -movflags +faststart ${p}`,
      { stdio: 'ignore' }
    );
  }
  return p;
}

async function dropVaultMp4(page) {
  const mp4 = ensureTestMp4();
  const b64 = fs.readFileSync(mp4).toString('base64');
  const fileName = `product-03-vault-${Date.now()}.mp4`;
  await page.evaluate(
    async ({ mp4B64, name }) => {
      const target = document.querySelector('.video-vault-drop');
      if (!target) throw new Error('Missing .video-vault-drop');
      const bytes = Uint8Array.from(atob(mp4B64), (c) => c.charCodeAt(0));
      const file = new File([bytes], name, { type: 'video/mp4' });
      const dt = new DataTransfer();
      dt.items.add(file);
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    },
    { mp4B64: b64, name: fileName }
  );
  return fileName;
}

async function ensureVaultReelAvailable(page) {
  await openProductionTab(page);
  let optionCount = await page.locator('[data-testid="vault-reel-option"]').count();
  if (optionCount > 0) {
    return page.locator('[data-testid="vault-reel-option"]').first().getAttribute('data-reel-id');
  }

  await openContentTab(page);
  await page.waitForSelector('.video-vault-drop', { timeout: 60_000, state: 'visible' });
  const postsBefore = [];
  const handler = (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/reels')) postsBefore.push(req.url());
  };
  page.on('request', handler);
  await dropVaultMp4(page);

  await expect
    .poll(async () => (await listVaultReelIds(page)).length, { timeout: 90_000 })
    .toBeGreaterThan(0);

  page.off('request', handler);
  await openProductionTab(page);
  optionCount = await page.locator('[data-testid="vault-reel-option"]').count();
  expect(optionCount).toBeGreaterThan(0);
  return page.locator('[data-testid="vault-reel-option"]').first().getAttribute('data-reel-id');
}

test.describe('PRODUCT-03 Episode reel attachment', () => {
  test('vault select attach persist', async ({ page }) => {
    await unlockStudio(page);

    const reelId = await ensureVaultReelAvailable(page);
    expect(reelId).toBeTruthy();

    await expect(page.getByTestId('episode-reel-attach-panel')).toBeVisible();

    const episodeSelect = page.getByTestId('episode-reel-select');
    await expect(episodeSelect).toBeVisible();
    const optionCount = await episodeSelect.locator('option').count();
    expect(optionCount).toBeGreaterThan(1);

    await episodeSelect.selectOption(TARGET_EPISODE_ID);
    await expect(episodeSelect).toHaveValue(TARGET_EPISODE_ID);

    const heroBefore = await readEpisodeAttachment(page, TARGET_EPISODE_ID);
    const vaultOptions = page.locator('[data-testid="vault-reel-option"]');
    await expect(vaultOptions.first()).toBeVisible();
    if (heroBefore.heroReelId) {
      await expect(
        page.locator(`[data-testid="vault-reel-option"][data-reel-id="${heroBefore.heroReelId}"]`)
      ).toHaveCount(0);
    }

    await page.locator(`[data-testid="vault-reel-option"][data-reel-id="${reelId}"]`).click();

    const attachBtn = page.getByTestId('attach-reel-to-episode');
    await expect(attachBtn).toBeEnabled();
    await attachBtn.click();

    const replaceBtn = page.getByTestId('attach-reel-replace');
    if (await replaceBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await replaceBtn.click();
    }

    await expect(page.getByTestId('attach-reel-success')).toBeVisible({ timeout: 15_000 });

    await expect
      .poll(async () => {
        const att = await readEpisodeAttachment(page, TARGET_EPISODE_ID);
        return att.reelId || '';
      }, { timeout: 15_000 })
      .toBe(String(reelId));

    const attached = await readEpisodeAttachment(page, TARGET_EPISODE_ID);
    expect(attached.metaEntry?.episodeId).toBe(TARGET_EPISODE_ID);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await unlockStudioWithProductionPanel(page);
    await episodeSelect.selectOption(TARGET_EPISODE_ID);
    const selectedLabel = await episodeSelect.locator(`option[value="${TARGET_EPISODE_ID}"]`).textContent();
    expect(selectedLabel || '').toContain('has reel');

    const afterReload = await readEpisodeAttachment(page, TARGET_EPISODE_ID);
    expect(afterReload.reelId).toBe(String(reelId));
  });
});
