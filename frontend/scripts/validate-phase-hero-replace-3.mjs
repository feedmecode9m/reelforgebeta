#!/usr/bin/env node
/**
 * PHASE-HERO-REPLACE-3 — late-commit guard after watchdog timeout.
 * Local browser validation only. Does not deploy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { unlockStudioWithHeroSection } from '../tests/helpers/studio-navigation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const FRONTEND = process.env.BASE_URL || 'http://127.0.0.1:5173';
const HERO_MP4 = '/tmp/hero-replace-2-hero.mp4';
const VAULT_MP4 = '/tmp/hero-replace-2-vault.mp4';
const OUT = path.join(ROOT, 'artifacts', 'PHASE-HERO-REPLACE-3-VALIDATION.json');
const LATE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readHero(page) {
  return page.evaluate(() => {
    const parse = (k) => {
      try {
        return JSON.parse(localStorage.getItem(k) || 'null');
      } catch {
        return null;
      }
    };
    const record = parse('reelforge_hero_record');
    const manager = parse('reelforge_hero_manager_config');
    const panel = document.querySelector('.hero-replace-state-panel');
    const phaseEl = document.querySelector('[data-hero-replace-ux-phase]');
    return {
      assetId: record?.assetId || manager?.heroAssetId || null,
      mode: record?.mode || null,
      backgroundSource: manager?.backgroundSource || null,
      phase: phaseEl?.getAttribute('data-hero-replace-ux-phase') || null,
      title: panel?.querySelector('.hero-replace-state-title')?.textContent?.trim() || null
    };
  });
}

const report = {
  mission: 'PHASE-HERO-REPLACE-3',
  ts: new Date().toISOString(),
  frontend: FRONTEND,
  verdict: 'INCOMPLETE',
  checks: {},
  findings: [],
  consoleHits: []
};

function assert(id, cond, detail) {
  report.checks[id] = { pass: Boolean(cond), detail };
  if (!cond) report.findings.push({ id, detail });
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${id}: ${detail}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (msg) => {
  const t = msg.text();
  if (/HERO_ACCEPT|HERO_ACCEPT_STALE_DISCARD|HERO_ACCEPT_TIMEOUT|HERO_IDENTITY_COMMIT|HERO_UX_STATE/i.test(t)) {
    report.consoleHits.push({ at: new Date().toISOString(), text: t.slice(0, 400) });
  }
});

try {
  await unlockStudioWithHeroSection(page, FRONTEND);
  const start = await readHero(page);

  // 1) Normal replace
  const beforeReplace = String(start.assetId || '');
  const fileInput = page.locator('.hero-replace-section input[type="file"]').first();
  await fileInput.setInputFiles(HERO_MP4);
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    const h = await readHero(page);
    if (h.phase === 'committed' && h.assetId && h.assetId !== beforeReplace) break;
  }
  const afterReplace = await readHero(page);
  assert(
    'normal_replace',
    afterReplace.assetId && afterReplace.assetId !== beforeReplace && afterReplace.phase === 'committed',
    `${beforeReplace} → ${afterReplace.assetId} phase=${afterReplace.phase}`
  );
  const committedHero = String(afterReplace.assetId || '');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3000);
  const afterRefresh = await readHero(page);
  assert(
    'refresh_keeps_replace',
    String(afterRefresh.assetId || '') === committedHero,
    `after refresh ${afterRefresh.assetId}`
  );

  // 2+3) Timeout then late 200 must not commit
  await unlockStudioWithHeroSection(page, FRONTEND);
  const baseline = String((await readHero(page)).assetId || '');
  await page.route('**/api/reels', async (route) => {
    if (route.request().method() === 'POST') {
      await sleep(48000);
      try {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: LATE_ID,
            url: `http://127.0.0.1:8080/videos/${LATE_ID}.mp4`,
            name: 'Late Commit Probe',
            type: 'video'
          })
        });
      } catch {
        /* already handled */
      }
      return;
    }
    await route.continue();
  });
  await page.locator('.hero-replace-section input[type="file"]').first().setInputFiles(HERO_MP4);
  let sawProcessing = false;
  let sawAttention = false;
  for (let i = 0; i < 80; i++) {
    await sleep(1000);
    const h = await readHero(page);
    if (h.phase === 'processing') sawProcessing = true;
    if (h.phase === 'preview_pending' || h.title === 'Upload Needs Attention') sawAttention = true;
    if (sawProcessing && sawAttention) break;
  }
  await sleep(20000);
  const afterLate = await readHero(page);
  const staleLog = report.consoleHits.some((c) => /HERO_ACCEPT_STALE_DISCARD/.test(c.text));
  const timeoutLog = report.consoleHits.some((c) => /HERO_ACCEPT_TIMEOUT/.test(c.text));
  assert(
    'timeout_keeps_old_hero',
    String(afterLate.assetId || '') === baseline && afterLate.assetId !== LATE_ID,
    `asset=${afterLate.assetId} phase=${afterLate.phase}`
  );
  assert(
    'late_response_ignored',
    staleLog && timeoutLog && afterLate.assetId !== LATE_ID && afterLate.phase !== 'committed',
    `staleLog=${staleLog} timeoutLog=${timeoutLog} phase=${afterLate.phase}`
  );
  await page.unroute('**/api/reels').catch(() => {});

  // 4) Retry after timeout
  const rejectBtn = page.locator('.hero-replace-section .reject-btn').first();
  if (await rejectBtn.isVisible().catch(() => false)) await rejectBtn.click();
  await sleep(800);
  await page.locator('.hero-replace-section input[type="file"]').first().setInputFiles(HERO_MP4);
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    const h = await readHero(page);
    if (h.phase === 'committed' && h.assetId && h.assetId !== baseline) break;
  }
  const afterRetry = await readHero(page);
  assert(
    'retry_replace_works',
    afterRetry.assetId && afterRetry.assetId !== baseline && afterRetry.phase === 'committed',
    `${baseline} → ${afterRetry.assetId}`
  );
  const retryHero = String(afterRetry.assetId || '');

  // 5) Vault MP4 does not change Hero
  await unlockStudioWithHeroSection(page, FRONTEND);
  const vaultInput = page.locator('.video-vault-drop--upload input[type="file"]').first();
  await vaultInput.setInputFiles(VAULT_MP4);
  await sleep(800);
  const vaultAccept = page.locator('.video-vault-drop--upload .accept-btn').first();
  if (await vaultAccept.isVisible().catch(() => false)) await vaultAccept.click();
  await sleep(8000);
  const afterVault = await readHero(page);
  assert(
    'vault_does_not_change_hero',
    String(afterVault.assetId || '') === retryHero,
    `hero after vault ${afterVault.assetId} expected ${retryHero}`
  );

  const allPass = Object.values(report.checks).every((c) => c.pass);
  report.verdict = allPass ? 'PHASE-HERO-REPLACE-3 LOCAL PASS' : 'PHASE-HERO-REPLACE-3 LOCAL FAIL';
} catch (err) {
  report.verdict = 'PHASE-HERO-REPLACE-3 ERROR';
  report.error = err?.stack || err?.message || String(err);
} finally {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  await browser.close();
}

console.log('\nVERDICT:', report.verdict);
console.log('Wrote', OUT);
if (report.verdict !== 'PHASE-HERO-REPLACE-3 LOCAL PASS') process.exitCode = 2;
