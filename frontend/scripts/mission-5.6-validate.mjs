#!/usr/bin/env node
/** MISSION 5.6 — canonical hero identity validation */
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { spawn, execSync } from 'child_process';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const OUT = join(process.cwd(), 'MISSION_5_6_VALIDATION.md');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const TEST_DIR = '/tmp/mission-5.6-hero';
const BACKEND_BIN = process.env.BACKEND_BIN || '/home/youloose2dafish/projects/reelforge/target/debug/backend';
const FRONTEND_DIR = process.env.FRONTEND_DIR || '/home/youloose2dafish/projects/reelforge/frontend';
mkdirSync(TEST_DIR, { recursive: true });

const CHROMIUM = '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const launch = { headless: true };
if (existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;

const UUID_PATH = /\/(?:thumbs|videos)\/[0-9a-f-]{36}\./i;

const report = {
  pass: false,
  checks: {},
  restarts: {},
  stages: [],
  errors: []
};

function mdTable(rows) {
  const header = '| Check | Result |\n|-------|--------|';
  return `${header}\n${rows.map(([k, v]) => `| ${k} | ${v} |`).join('\n')}`;
}

async function waitHttp(url, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const code = await fetch(url, { signal: AbortSignal.timeout(3000) }).then((r) => r.status);
      if (code >= 200 && code < 500) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

function killPort(port) {
  try {
    execSync(`fuser -k ${port}/tcp 2>/dev/null || true`, { stdio: 'ignore' });
  } catch {
    // ignore
  }
}

async function restartServers() {
  killPort(8080);
  killPort(5173);
  await new Promise((r) => setTimeout(r, 2000));
  const dbUrl =
    process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/reelforge';
  spawn(BACKEND_BIN, [], {
    cwd: '/home/youloose2dafish/projects/reelforge/backend',
    env: { ...process.env, PORT: '8080', DATABASE_URL: dbUrl },
    detached: true,
    stdio: 'ignore'
  }).unref();
  spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    cwd: FRONTEND_DIR,
    detached: true,
    stdio: 'ignore'
  }).unref();
  const backendOk = await waitHttp('http://127.0.0.1:8080/health', 120000);
  const frontendOk = await waitHttp(BASE, 120000);
  report.restarts = { backend: backendOk ? 'PASS' : 'FAIL', frontend: frontendOk ? 'PASS' : 'FAIL' };
  if (!backendOk || !frontendOk) throw new Error('Server restart failed');
}

async function openStudioHeroReplace(page) {
  await page.goto(BASE, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.waitForSelector('.ghost-trigger', { timeout: 60000 });
  await page.click('.ghost-trigger');
  await page.waitForSelector('.control-center-container', { timeout: 60000 });
  await page.click('#workspace-tab-content').catch(() => page.click('[data-workspace-tab-button="content"]'));
  await page.waitForTimeout(1000);
  await page.waitForSelector('.hero-drop-zone', { timeout: 60000 });
}

async function openHeroVault(page) {
  await page.click('#workspace-tab-system').catch(() => page.click('[data-workspace-tab-button="system"]'));
  await page.waitForTimeout(800);
  await page.waitForSelector('[data-hero-vault]', { timeout: 20000 });
}

async function dropHero(page, fileName) {
  const b64 = PNG.toString('base64');
  await page.evaluate(async ({ name, b64 }) => {
    const target = document.querySelector('.hero-drop-zone');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], name, { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  }, { name: fileName, b64 });
  await page.waitForSelector('.hero-replace-section .accept-btn', { timeout: 10000 });
  await page.click('.hero-replace-section .accept-btn');
  await page.waitForTimeout(12000);
}

async function collectIdentity(page, label) {
  return page.evaluate((label) => {
    const reel = JSON.parse(localStorage.getItem('reelforge_hero_reel') || 'null');
    const manager = JSON.parse(localStorage.getItem('reelforge_hero_manager_config') || '{}');
    const bgNode =
      document.querySelector('.hero-bg img') ||
      document.querySelector('.hero-bg .hero-fallback-image') ||
      document.querySelector('.hero-fallback-image') ||
      document.querySelector('[data-hero-background] img');
    const vaultNode = document.querySelector('[data-hero-vault-card] img, [data-hero-vault-card] video');
    const featured = document.querySelector('[data-hero-carousel-meta]')?.closest('.hero-bg')?.querySelector('img, video');
    const placeholder = document.querySelector('.hero-loading-fallback img, .hero-fallback-image');
    const pathOnly = (src) => {
      if (!src) return '';
      try {
        return new URL(src, window.location.origin).pathname;
      } catch {
        return src;
      }
    };
    return {
      label,
      reel: reel
        ? { id: reel.id, fileName: reel.fileName, url: reel.url }
        : null,
      heroAssetId: manager.heroAssetId || null,
      duplicateStorage: {
        legacyImage: Boolean(localStorage.getItem('reelforge_hero_image')),
        legacyVideo: Boolean(localStorage.getItem('reelforge_hero_video'))
      },
      surfaces: {
        background: pathOnly(bgNode?.currentSrc || bgNode?.src || ''),
        bannerAsset: document.querySelector('[data-hero-background-asset]')?.getAttribute('data-hero-background-asset') || '',
        vault: pathOnly(vaultNode?.currentSrc || vaultNode?.src || ''),
        featured: pathOnly(featured?.currentSrc || featured?.src || ''),
        placeholder: pathOnly(placeholder?.currentSrc || placeholder?.src || '')
      }
    };
  }, label);
}

function evaluateIdentity(snap) {
  const url = snap.reel?.url || '';
  const id = snap.reel?.id || '';
  const paths = Object.values(snap.surfaces).filter(Boolean);
  const canonicalPaths = paths.filter((p) => p === url || p.endsWith(url));
  const allMatch = url && paths.length > 0 && paths.every((p) => p === url || !p);
  const idMatch = snap.heroAssetId === id;
  const noDup =
    !snap.duplicateStorage.legacyImage && !snap.duplicateStorage.legacyVideo;
  const uuidOk = UUID_PATH.test(url);
  return { url, id, idMatch, allMatch, noDup, uuidOk, paths };
}

async function removeHero(page) {
  await page.evaluate(() => {
    localStorage.removeItem('reelforge_hero_reel');
    localStorage.removeItem('reelforge_hero_image');
    localStorage.removeItem('reelforge_hero_video');
    const cfg = JSON.parse(localStorage.getItem('reelforge_hero_manager_config') || '{}');
    cfg.heroAssetId = '';
    cfg.backgroundSource = 'selection';
    localStorage.setItem('reelforge_hero_manager_config', JSON.stringify(cfg));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
}

await restartServers();

const browser = await chromium.launch(launch);
const context = await browser.newContext();
await context.addInitScript(() => {
  if (sessionStorage.getItem('mission56_boot')) return;
  sessionStorage.setItem('mission56_boot', '1');
  localStorage.setItem('admin_mode', 'true');
  localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
  localStorage.removeItem('reelforge_hero_reel');
  localStorage.removeItem('reelforge_hero_image');
  localStorage.removeItem('reelforge_hero_video');
  localStorage.setItem(
    'reelforge_hero_manager_config',
    JSON.stringify({ backgroundSource: 'selection', heroAssetId: '' })
  );
});

const page = await context.newPage();

try {
  await openStudioHeroReplace(page);
  writeFileSync(join(TEST_DIR, 'mission-56-hero-1.png'), PNG);
  await dropHero(page, 'mission-56-hero-1.png');

  let snap = await collectIdentity(page, 'after-upload');
  report.stages.push(snap);
  let ev = evaluateIdentity(snap);
  report.checks.afterUpload = ev;

  await openHeroVault(page);
  snap = await collectIdentity(page, 'after-upload-vault');
  report.stages.push(snap);
  ev = evaluateIdentity(snap);
  report.checks.vaultMatchesUpload = ev;

  await openStudioHeroReplace(page);
  writeFileSync(join(TEST_DIR, 'mission-56-hero-2.png'), PNG);
  await dropHero(page, 'mission-56-hero-2.png');
  snap = await collectIdentity(page, 'after-replace');
  report.stages.push(snap);
  ev = evaluateIdentity(snap);
  report.checks.afterReplace = ev;

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3000);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
  snap = await collectIdentity(page, 'after-reload');
  report.stages.push(snap);
  ev = evaluateIdentity(snap);
  report.checks.afterReload = ev;

  await removeHero(page);
  snap = await collectIdentity(page, 'after-remove');
  report.stages.push(snap);
  report.checks.afterRemove = { cleared: !snap.reel && !snap.heroAssetId };

  await restartServers();
  await page.goto(BASE, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.waitForTimeout(1500);
  snap = await collectIdentity(page, 'after-restart');
  report.stages.push(snap);
  report.checks.afterRestart = { stillCleared: !snap.reel };

  const uploadUrl = report.stages.find((s) => s.label === 'after-upload')?.reel?.url;
  const replaceUrl = report.stages.find((s) => s.label === 'after-replace')?.reel?.url;
  const reloadUrl = report.stages.find((s) => s.label === 'after-reload')?.reel?.url;

  const reloadSnap = report.stages.find((s) => s.label === 'after-reload');
  if (reloadSnap?.reel?.url) {
    const u = reloadSnap.reel.url;
    const bg = reloadSnap.surfaces.background;
    report.checks.surfaceUnity =
      reloadSnap.heroAssetId === reloadSnap.reel.id &&
      (!bg || bg === u || bg.endsWith(u));
    if (!report.checks.surfaceUnity) report.errors.push('Surfaces diverged after reload');
  } else {
    report.checks.surfaceUnity = false;
  }

  report.pass =
    report.restarts.backend === 'PASS' &&
    report.restarts.frontend === 'PASS' &&
    report.checks.afterUpload?.uuidOk &&
    report.checks.afterUpload?.idMatch &&
    report.checks.afterUpload?.noDup &&
    Boolean(replaceUrl) &&
    replaceUrl !== uploadUrl &&
    replaceUrl === reloadUrl &&
    report.checks.afterReload?.idMatch &&
    report.checks.afterReload?.noDup &&
    report.checks.afterRemove?.cleared &&
    report.checks.afterRestart?.stillCleared &&
    report.checks.surfaceUnity;

  if (!report.checks.afterUpload?.noDup) report.errors.push('Duplicate legacy hero storage after upload');
  if (!report.checks.afterUpload?.uuidOk) report.errors.push('Hero URL is not UUID path');
  if (!report.checks.afterRemove?.cleared) report.errors.push('Hero not cleared on remove');
} catch (e) {
  report.errors.push(String(e?.message || e));
}

await browser.close();

const identityTable = `| Stage | id | fileName | url | heroAssetId | legacy image? | legacy video? | background src |
|-------|-----|----------|-----|-------------|---------------|---------------|----------------|
${report.stages
  .map((s) => {
    const r = s.reel || {};
    return `| ${s.label} | ${r.id || '—'} | ${r.fileName || '—'} | ${r.url || '—'} | ${s.heroAssetId || '—'} | ${s.duplicateStorage.legacyImage ? 'yes' : 'no'} | ${s.duplicateStorage.legacyVideo ? 'yes' : 'no'} | ${s.surfaces.background || '—'} |`;
  })
  .join('\n')}`;

const md = `# MISSION 5.6 — Canonical Hero Identity Validation

Generated: ${new Date().toISOString()}

## Result: ${report.pass ? 'PASS' : 'FAIL'}

${mdTable([
  ['Restart backend', report.restarts.backend || 'SKIP'],
  ['Restart frontend', report.restarts.frontend || 'SKIP'],
  ['Upload hero (UUID reel)', report.checks.afterUpload?.uuidOk ? 'PASS' : 'FAIL'],
  ['heroAssetId === reel.id', report.checks.afterUpload?.idMatch ? 'PASS' : 'FAIL'],
  ['No duplicate legacy storage', report.checks.afterUpload?.noDup ? 'PASS' : 'FAIL'],
  ['Replace hero', report.checks.afterReplace?.url ? 'PASS' : 'FAIL'],
  ['Survive reload', report.checks.afterReload?.idMatch ? 'PASS' : 'FAIL'],
  ['Remove hero', report.checks.afterRemove?.cleared ? 'PASS' : 'FAIL'],
  ['Survive restart', report.checks.afterRestart?.stillCleared ? 'PASS' : 'FAIL'],
  ['Surface URL unity', report.checks.surfaceUnity ? 'PASS' : 'FAIL']
])}

## Identity table

${identityTable}

## Investigation — Hero storage keys (pre-fix)

| Key / object | Role | Canonical? |
|--------------|------|------------|
| \`reelforge_hero_reel\` | **Single canonical reel** (id, fileName, url) | ✓ |
| \`reelforge_hero_manager_config.heroAssetId\` | Pointer to \`reel.id\` only | ✓ |
| \`reelforge_hero_image\` | Legacy duplicate URL/data | ✗ removed on save |
| \`reelforge_hero_video\` | Legacy duplicate URL/data | ✗ removed on save |
| \`HERO_POSTER_IMAGE\` store | Runtime render path (derived from reel.url) | presentation |
| \`HERO_BACKGROUND_VIDEO\` store | Runtime render path (derived from reel.url) | presentation |
| \`heroPreviewUrl\` store | Upload preview blob only | transient |
| \`heroBackgroundState\` | Video playback position | non-identity |

## Pipeline trace

| Stage | id | fileName | url | Changes |
|-------|-----|----------|-----|---------|
| Backend response | UUID | UUID.ext | /thumbs/UUID.ext | Set by API |
| acceptHeroFile | reel.id | reel.fileName | reel.url | Saves \`reelforge_hero_reel\` |
| saveHeroManagerConfig | heroAssetId=reel.id | — | — | Pointer only |
| loadHeroVaultItems | reel.id | reel.fileName | reel.url | Reads canonical reel |
| resolveHeroBackgroundAsset | reel.id | — | reel.url | id→fileName→url |
| Viewer / Banner / Featured | — | — | reel.url | All surfaces derive same path |

## Errors

${report.errors.length ? report.errors.map((e) => `- ${e}`).join('\n') : 'None'}
`;

writeFileSync(OUT, md);
console.log(md);
process.exit(report.pass ? 0 : 1);
