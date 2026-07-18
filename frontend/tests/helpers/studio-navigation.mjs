/** Shared studio unlock + Content tab navigation for Hero automation (BG-AUTO-01). */
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Gaff1505!';

export async function unlockStudio(page, frontendUrl = '/') {
  await page.goto(frontendUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('.ghost-trigger', { timeout: 60_000 });
  await page.click('.ghost-trigger');
  const pw = page.locator('.admin-login-panel input[type="password"]').first();
  if (await pw.count()) {
    await pw.fill(ADMIN_PASSWORD);
    const btn = page.locator('.admin-login-panel .submit-btn').first();
    if (await btn.count()) await btn.click();
    else await pw.press('Enter');
  }
  await page.waitForSelector('[data-production-command-center], .control-center-container', {
    timeout: 60_000
  });
  await page.waitForTimeout(800);
}

export async function openContentTab(page) {
  const tabCandidates = [
    '#workspace-tab-content',
    '[data-workspace-tab-button="content"]',
    '[data-workspace-tab="content"]',
    '[role="tablist"][aria-label="Studio workspace"] [role="tab"]:has-text("Content")',
    'button[role="tab"]:has-text("Content")'
  ];

  for (const selector of tabCandidates) {
    const tab = page.locator(selector).first();
    if (await tab.count()) {
      await tab.click();
      break;
    }
  }

  await page.waitForTimeout(1500);
  await page.waitForSelector('[data-workspace-panel-content], .video-vault-drop, .hero-replace-section', {
    timeout: 60_000,
    state: 'visible'
  });
  await page.evaluate(() => {
    document.querySelector('.hero-replace-section')?.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(800);
}

export async function unlockStudioWithHeroSection(page, frontendUrl = '/') {
  await unlockStudio(page, frontendUrl);
  await openContentTab(page);
}

/** Opens Studio → Production tab (Episode Reel Attachment panel). */
export async function openProductionTab(page) {
  const tabCandidates = [
    '#workspace-tab-production',
    '[data-workspace-tab-button="production"]',
    '[data-workspace-tab="production"]',
    '[role="tablist"][aria-label="Studio workspace"] [role="tab"]:has-text("Production")',
    'button[role="tab"]:has-text("Production")'
  ];

  for (const selector of tabCandidates) {
    const tab = page.locator(selector).first();
    if (await tab.count()) {
      await tab.click();
      break;
    }
  }

  await page.waitForTimeout(1500);
  await page.waitForSelector('[data-testid="episode-reel-attach-panel"], [data-episode-reel-attach]', {
    timeout: 60_000,
    state: 'visible'
  });
  await page.evaluate(() => {
    document.querySelector('[data-testid="episode-reel-attach-panel"]')?.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);
}

export async function unlockStudioWithProductionPanel(page, frontendUrl = '/') {
  await unlockStudio(page, frontendUrl);
  await openProductionTab(page);
}

/** @param {import('@playwright/test').Page} page @param {string} episodeId */
export async function readEpisodeAttachment(page, episodeId) {
  return page.evaluate((epId) => {
    let reelId = null;
    let metaEntry = null;
    try {
      const meta = JSON.parse(localStorage.getItem('reelforge_series_metadata') || '{}');
      for (const [id, entry] of Object.entries(meta)) {
        if (entry && entry.episodeId === epId) {
          reelId = id;
          metaEntry = entry;
          break;
        }
      }
    } catch {
      /* ignore */
    }
    let heroReelId = null;
    try {
      const hero = JSON.parse(localStorage.getItem('reelforge_hero_reel') || 'null');
      heroReelId = hero?.id || null;
    } catch {
      heroReelId = null;
    }
    return { reelId, metaEntry, heroReelId };
  }, episodeId);
}

/** @param {import('@playwright/test').Page} page */
export async function listVaultReelIds(page) {
  return page.evaluate(() => {
    try {
      const vault = JSON.parse(localStorage.getItem('personal_video_vault') || '[]');
      return vault.map((v) => String(v.id || v.assetId || '')).filter(Boolean);
    } catch {
      return [];
    }
  });
}

export async function readHeroStorage(page) {
  return page.evaluate(() => {
    let reel = null;
    let mgr = null;
    try {
      reel = JSON.parse(localStorage.getItem('reelforge_hero_reel') || 'null');
    } catch {
      reel = null;
    }
    try {
      mgr = JSON.parse(localStorage.getItem('reelforge_hero_manager_config') || 'null');
    } catch {
      mgr = null;
    }
    return { reel, mgr };
  });
}
