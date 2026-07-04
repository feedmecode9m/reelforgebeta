#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';

const EXPERIENCE_FILES = [
  'components/experiences/HeroExperience.svelte',
  'components/experiences/FeedExperience.svelte',
  'components/experiences/VaultExperience.svelte',
  'components/experiences/StudioExperience.svelte'
];

const BRIDGE_FILES = [
  'components/viewer/FeedExperienceBridge.svelte',
  'components/viewer/TheaterExperienceBridge.svelte',
  'components/viewer/HeroExperienceBridge.svelte',
  'components/viewer/StudioLauncher.svelte',
  'components/viewer/NotificationBridge.svelte',
  'components/viewer/ObservabilityBridge.svelte'
];

const RUNTIME_FILES = [
  'viewer/viewerContext.js',
  'viewer/viewer.css'
];

function countLines(path) {
  return readFileSync(path, 'utf8').split('\n').length;
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function pass(msg) {
  console.log(`PASS: ${msg}`);
}

// --- Static checks ---
const viewerPath = join(SRC, 'Viewer.svelte');
if (!existsSync(viewerPath)) fail('Viewer.svelte not found');

const viewerLines = countLines(viewerPath);
console.log(`Viewer.svelte line count: ${viewerLines}`);
if (viewerLines >= 1000) {
  fail(`Viewer.svelte has ${viewerLines} lines (must be < 1000)`);
}
pass(`Viewer.svelte under 1000 lines (${viewerLines})`);

for (const rel of EXPERIENCE_FILES) {
  const full = join(SRC, rel);
  if (!existsSync(full)) fail(`Missing experience component: ${rel}`);
  pass(`Experience component exists: ${rel} (${countLines(full)} lines)`);
}

for (const rel of BRIDGE_FILES) {
  const full = join(SRC, rel);
  if (!existsSync(full)) fail(`Missing bridge component: ${rel}`);
  pass(`Bridge component exists: ${rel} (${countLines(full)} lines)`);
}

for (const rel of RUNTIME_FILES) {
  const full = join(SRC, rel);
  if (!existsSync(full)) fail(`Missing runtime file: ${rel}`);
  pass(`Runtime file exists: ${rel} (${countLines(full)} lines)`);
}

// --- Start preview server if needed ---
async function ensureServer() {
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      pass(`Server already running at ${BASE}`);
      return null;
    }
  } catch {
    /* start server */
  }

  console.log(`Starting preview server on ${BASE}...`);
  const proc = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4190'], {
    cwd: ROOT,
    stdio: 'pipe',
    detached: false
  });

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        pass(`Preview server started at ${BASE}`);
        return proc;
      }
    } catch {
      /* retry */
    }
  }
  proc.kill();
  fail('Could not start preview server');
}

// --- Playwright checks ---
async function runPlaywright() {
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage();

  try {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
    pass('Page loads');

    const heroStage = page.locator('.hero-stage');
    await heroStage.waitFor({ state: 'visible', timeout: 10000 });
    pass('Hero stage renders');

    const feedOrLoader = page.locator('.debug-info, .forge-loader, .reelshort-experience, [class*="shelf"]');
    await feedOrLoader.first().waitFor({ state: 'attached', timeout: 15000 });
    pass('Feed section renders');

    const ghostTrigger = page.locator('.ghost-trigger');
    await ghostTrigger.waitFor({ state: 'visible', timeout: 5000 });
    await ghostTrigger.click();
    await page.waitForTimeout(500);

    const studioOverlay = page.locator('.control-center-overlay, .control-center-container, .admin-login-panel');
    await studioOverlay.first().waitFor({ state: 'visible', timeout: 5000 });
    pass('Ghost trigger opens studio');
  } finally {
    await browser.close();
  }
}

const serverProc = await ensureServer();
try {
  await runPlaywright();
} finally {
  if (serverProc) serverProc.kill();
}

console.log('\nVIEWER_DECOMPOSITION_COMPLETE=true');
