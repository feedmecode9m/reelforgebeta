/** Shared studio unlock + Content tab navigation for Hero automation (BG-AUTO-01). */
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Gaff1505!';

/**
 * Cold-start Studio unlock.
 * Seeds an admin session via POST /admin/auth (ghost-trigger only mounts with a session),
 * then opens the control center and completes adminMode via the login panel when needed.
 * @param {import('@playwright/test').Page} page
 * @param {string} [frontendUrl]
 * @param {string} [password]
 */
export async function unlockStudio(page, frontendUrl = '/', password = ADMIN_PASSWORD) {
  const base = String(frontendUrl || '/').replace(/\/$/, '') || '';
  const pw = String(password || ADMIN_PASSWORD || '').trim() || ADMIN_PASSWORD;
  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 120_000 });

  const token = await page.evaluate(async (authPassword) => {
    try {
      const res = await fetch('/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: authPassword })
      });
      if (!res.ok) return null;
      const body = await res.json();
      const t = String(body?.token || '').trim();
      return t && t !== 'backend_token' ? t : null;
    } catch {
      return null;
    }
  }, pw);

  if (token) {
    await page.evaluate((t) => {
      localStorage.setItem('reelforge_admin_session_token', t);
    }, token);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  } else {
    // Offline/local fallback: password unlock page.
    await page.goto(base + '/studio', { waitUntil: 'domcontentloaded', timeout: 120_000 });
    const unlockPw = page
      .locator('.studio-unlock input[type="password"], .admin-login-panel input[type="password"]')
      .first();
    if (await unlockPw.count()) {
      await unlockPw.fill(pw);
      const btn = page
        .locator('.studio-unlock button[type="submit"], .studio-unlock .submit-btn, .admin-login-panel .submit-btn')
        .first();
      if (await btn.count()) await btn.click();
      else await unlockPw.press('Enter');
      await page.waitForTimeout(1000);
      await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 120_000 }).catch(() => {});
    }
  }

  await page.waitForSelector('.ghost-trigger', { timeout: 60_000 });
  await page.click('.ghost-trigger');
  const loginPw = page.locator('.admin-login-panel input[type="password"]').first();
  if ((await loginPw.count()) > 0 && (await loginPw.isVisible().catch(() => false))) {
    await loginPw.fill(pw);
    const btn = page.locator('.admin-login-panel .submit-btn').first();
    if (await btn.count()) await btn.click();
    else await loginPw.press('Enter');
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
