#!/usr/bin/env node
/** PRODUCT-03 — Episode reel attachment mission runner */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  unlockStudio,
  openContentTab,
  openProductionTab,
  readEpisodeAttachment,
  listVaultReelIds
} from '../tests/helpers/studio-navigation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = process.env.FRONTEND_URL || process.env.BASE_URL || 'https://strong-lolly-a9fcb4.netlify.app';
const TARGET_EPISODE_ID = 'ep-neon-s01e04';
const OUT = path.join(__dirname, '..', 'artifacts', 'product-03-episode-attach.json');
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const report = {
  generatedAt: new Date().toISOString(),
  frontend: FRONTEND,
  mission: 'PRODUCT-03',
  targetEpisodeId: TARGET_EPISODE_ID,
  steps: [],
  pass: false
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function step(name, ok, detail = {}) {
  report.steps.push({ name, ok, ...detail, ts: new Date().toISOString() });
  return ok;
}

function ensureTestMp4() {
  const p = '/tmp/product-03-vault.mp4';
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
      if (!target) throw new Error('Missing vault drop zone');
      const bytes = Uint8Array.from(atob(mp4B64), (c) => c.charCodeAt(0));
      const file = new File([bytes], name, { type: 'video/mp4' });
      const dt = new DataTransfer();
      dt.items.add(file);
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    },
    { mp4B64: b64, name: fileName }
  );
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  ensureTestMp4();

  const launch = { headless: true };
  if (fs.existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;

  const browser = await chromium.launch(launch);
  const page = await browser.newPage();

  try {
    await unlockStudio(page, FRONTEND);
    step('studio_unlocked', true);

    await openProductionTab(page);
    step('production_panel_visible', await page.locator('[data-testid="episode-reel-attach-panel"]').count() > 0);

    let reelId = null;
    let vaultCount = await page.locator('[data-testid="vault-reel-option"]').count();
    if (vaultCount === 0) {
      await openContentTab(page);
      await page.waitForSelector('.video-vault-drop', { timeout: 60000 });
      await dropVaultMp4(page);
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        const ids = await listVaultReelIds(page);
        if (ids.length) {
          reelId = ids[ids.length - 1];
          break;
        }
        await sleep(1000);
      }
      await openProductionTab(page);
      vaultCount = await page.locator('[data-testid="vault-reel-option"]').count();
    } else {
      reelId = await page.locator('[data-testid="vault-reel-option"]').first().getAttribute('data-reel-id');
    }

    step('vault_reels_available', vaultCount > 0 && Boolean(reelId), { vaultCount, reelId });

    const episodeOptions = await page.locator('[data-testid="episode-reel-select"] option').count();
    step('episode_dropdown_populated', episodeOptions > 1, { episodeOptions });

    await page.locator('[data-testid="episode-reel-select"]').selectOption(TARGET_EPISODE_ID);
    await page.locator(`[data-testid="vault-reel-option"][data-reel-id="${reelId}"]`).click();
    await page.locator('[data-testid="attach-reel-to-episode"]').click();

    if (await page.locator('[data-testid="attach-reel-replace"]').isVisible().catch(() => false)) {
      await page.locator('[data-testid="attach-reel-replace"]').click();
    }

    await sleep(1500);
    const successVisible = await page.locator('[data-testid="attach-reel-success"]').isVisible().catch(() => false);
    const attached = await readEpisodeAttachment(page, TARGET_EPISODE_ID);
    step('attach_success_ui', successVisible, { successVisible });
    step('episode_metadata_updated', attached.reelId === reelId, {
      reelId,
      attachedReelId: attached.reelId
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(2500);
    await unlockStudio(page, FRONTEND);
    await openProductionTab(page);
    const afterReload = await readEpisodeAttachment(page, TARGET_EPISODE_ID);
    report.afterReload = afterReload;
    step('persistence_after_reload', afterReload.reelId === reelId, {
      reelIdBefore: reelId,
      reelIdAfter: afterReload.reelId
    });

    report.pass = report.steps.every((s) => s.ok);
  } catch (e) {
    report.fatalError = String(e.stack || e);
    report.pass = false;
  } finally {
    await browser.close();
  }

  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${OUT}`);
  console.log(JSON.stringify({ pass: report.pass, steps: report.steps.map((s) => ({ name: s.name, ok: s.ok })) }, null, 2));
  if (!report.pass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
