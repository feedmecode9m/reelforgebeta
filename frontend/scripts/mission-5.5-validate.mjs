#!/usr/bin/env node
/** MISSION 5.5 — canonical thumbnail identity validation */
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { spawn, execSync } from 'child_process';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const OUT = join(process.cwd(), 'MISSION_5_5_VALIDATION.md');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const TEST_DIR = '/tmp/mission-5.5-thumbs';
const BACKEND_BIN = process.env.BACKEND_BIN || '/home/youloose2dafish/projects/reelforge/target/debug/backend';
const FRONTEND_DIR = process.env.FRONTEND_DIR || '/home/youloose2dafish/projects/reelforge/frontend';
mkdirSync(TEST_DIR, { recursive: true });

const CHROMIUM = '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
const launch = { headless: true };
if (existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;

const UUID_THUMB = /\/thumbs\/[0-9a-f-]{36}\.(png|jpe?g|webp)$/i;
const DISPLAY_THUMB = /\/thumbs\/mission-55/i;

const report = {
  pass: false,
  checks: {},
  restarts: {},
  network: { displayNameRequests: [], thumb404: [], ignored404: [] },
  stages: [],
  pipelineTrace: [],
  errors: []
};

function mdTable(rows) {
  const header = '| Check | Result |\n|-------|--------|';
  const body = rows.map(([k, v]) => `| ${k} | ${v} |`).join('\n');
  return `${header}\n${body}`;
}

function isVaultThumbUrl(u) {
  try {
    const path = new URL(u).pathname;
    return UUID_THUMB.test(path) || DISPLAY_THUMB.test(path);
  } catch {
    return false;
  }
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

  const backend = spawn(BACKEND_BIN, [], {
    cwd: '/home/youloose2dafish/projects/reelforge/backend',
    env: { ...process.env, PORT: '8080' },
    detached: true,
    stdio: 'ignore'
  });
  backend.unref();

  const frontend = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    cwd: FRONTEND_DIR,
    detached: true,
    stdio: 'ignore'
  });
  frontend.unref();

  const backendOk = await waitHttp('http://127.0.0.1:8080/health');
  const frontendOk = await waitHttp(BASE);
  report.restarts = {
    backend: backendOk ? 'PASS' : 'FAIL',
    frontend: frontendOk ? 'PASS' : 'FAIL'
  };
  if (!backendOk || !frontendOk) {
    throw new Error(`Server restart failed (backend=${backendOk}, frontend=${frontendOk})`);
  }
}

async function openVault(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.click('.ghost-trigger').catch(() => {});
  await page.waitForSelector('.control-center-container', { timeout: 15000 });
  await page.click('#command-center-section-tab-content').catch(() => {});
  await page.click('button[role="tab"]:has-text("Content")').catch(() => {});
  await page.waitForTimeout(500);
  await page.waitForSelector('.thumbnail-drop-zone', { timeout: 15000 });
}

async function dropAccept(page, fileName) {
  const b64 = PNG.toString('base64');
  await page.evaluate(async ({ name, b64 }) => {
    const target = document.querySelector('.thumbnail-drop-zone');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], name, { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  }, { name: fileName, b64 });
  await page.waitForSelector('.accept-btn', { timeout: 10000 });
  await page.click('.accept-btn');
  await page.waitForTimeout(4000);
}

async function snapshot(page, label) {
  return page.evaluate((label) => {
    const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    const index = JSON.parse(localStorage.getItem('personal_thumbnail_index') || '[]');
    const cards = [...document.querySelectorAll('.vault-grid--images .vault-card')];
    const mission = thumbs.filter((t) => String(t?.name || '').includes('mission-55'));
    return {
      label,
      thumbCount: thumbs.length,
      indexCount: index.length,
      metadata: mission.slice(0, 5).map((t) => ({
        id: t?.id ?? null,
        name: t?.name ?? null,
        fileName: t?.fileName ?? null,
        url: t?.url ?? null,
        thumbnail: t?.thumbnail ?? null,
        thumbnailUrl: t?.thumbnailUrl ?? null
      })),
      indexSample: index.slice(0, 5),
      cards: cards.map((card, i) => {
        const img = card.querySelector('img');
        return {
          i,
          nw: img?.naturalWidth || 0,
          src: img?.currentSrc || img?.src || ''
        };
      })
    };
  }, label);
}

function buildPipelineTrace(stages) {
  const fields = ['id', 'name', 'fileName', 'url', 'thumbnail', 'thumbnailUrl'];
  const rows = [];
  const prev = {};
  for (const stage of stages) {
    const sample = stage.metadata?.[0] || {};
    const changes = {};
    for (const f of fields) {
      const cur = sample[f] ?? null;
      const was = prev[f] ?? null;
      changes[f] = was === null ? (cur === null ? '—' : 'set') : cur === was ? 'same' : 'changed';
      prev[f] = cur;
    }
    rows.push({
      stage: stage.label,
      ...Object.fromEntries(fields.map((f) => [f, sample[f] ?? null])),
      changes
    });
  }
  return rows;
}

function evaluateSnap(snap) {
  const missionCards = snap.cards.filter((c) => UUID_THUMB.test(c.src));
  const visible = snap.cards.filter((c) => c.nw > 0 && c.src);
  return {
    missionUuidVisible: missionCards.length,
    totalVisible: visible.length,
    allNwPositive: visible.length > 0 && visible.every((c) => c.nw > 0)
  };
}

await restartServers();

const browser = await chromium.launch(launch);
const context = await browser.newContext();
await context.addInitScript(() => {
  if (sessionStorage.getItem('mission55_boot')) return;
  sessionStorage.setItem('mission55_boot', '1');
  localStorage.setItem('admin_mode', 'true');
  localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
  localStorage.setItem('personal_thumbnails', '[]');
  localStorage.setItem('personal_thumbnail_index', '[]');
  localStorage.removeItem('reelforge_hero_image');
  localStorage.setItem(
    'reelforge_feed',
    JSON.stringify({ Trending: [], Romance: [], 'Cyber-Action': [], Suspense: [] })
  );
});

const page = await context.newPage();
const badRequests = [];
const ignored404 = [];
let monitoring = false;
page.on('request', (req) => {
  if (!monitoring) return;
  const u = req.url();
  if (u.includes('/thumbs/') && DISPLAY_THUMB.test(u)) badRequests.push(u);
});
page.on('response', async (res) => {
  if (!monitoring) return;
  const u = res.url();
  if (!u.includes('/thumbs/') || res.status() !== 404) return;
  if (isVaultThumbUrl(u)) badRequests.push(`404:${u}`);
  else ignored404.push(`404:${u}`);
});

try {
  await openVault(page);
  await page.evaluate(() => {
    localStorage.setItem('personal_thumbnails', '[]');
    localStorage.setItem('personal_thumbnail_index', '[]');
    localStorage.setItem(
      'reelforge_feed',
      JSON.stringify({ Trending: [], Romance: [], 'Cyber-Action': [], Suspense: [] })
    );
  });

  monitoring = true;
  for (let i = 1; i <= 5; i += 1) {
    const fileName = `mission-55-thumb-${i}.png`;
    writeFileSync(join(TEST_DIR, fileName), PNG);
    await dropAccept(page, fileName);
  }

  let snap = await snapshot(page, 'after-upload');
  report.stages.push(snap);
  report.checks.afterUpload = evaluateSnap(snap);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.click('.ghost-trigger').catch(() => {});
  await page.waitForSelector('.control-center-container', { timeout: 15000 });
  await page.click('#command-center-section-tab-content').catch(() => {});
  await page.click('button[role="tab"]:has-text("Content")').catch(() => {});
  await page.waitForTimeout(2500);

  snap = await snapshot(page, 'after-reload');
  report.stages.push(snap);
  report.checks.afterReload = evaluateSnap(snap);

  await page.waitForTimeout(2000);
  snap = await snapshot(page, 'after-sync');
  report.stages.push(snap);
  report.checks.afterSync = evaluateSnap(snap);

  report.network.displayNameRequests = badRequests.filter((u) => !u.startsWith('404:'));
  report.network.thumb404 = badRequests.filter((u) => u.startsWith('404:'));
  report.network.ignored404 = ignored404;
  report.pipelineTrace = buildPipelineTrace(report.stages);

  const last = report.stages[report.stages.length - 1];
  const missionMeta = (last.metadata || []).filter((t) =>
    String(t?.name || t?.title || '').includes('mission-55')
  );
  const metaOk =
    missionMeta.length >= 5 &&
    missionMeta.every((t) => t.id && t.fileName && t.url && t.url.includes(t.fileName));

  report.pass =
    report.restarts.backend === 'PASS' &&
    report.restarts.frontend === 'PASS' &&
    report.checks.afterUpload.missionUuidVisible >= 5 &&
    report.checks.afterReload.missionUuidVisible >= 5 &&
    report.checks.afterSync.missionUuidVisible >= 5 &&
    report.checks.afterReload.allNwPositive &&
    metaOk &&
    report.network.displayNameRequests.length === 0 &&
    report.network.thumb404.length === 0;

  if (!metaOk) report.errors.push('Metadata missing id/fileName/url canonical triple');
  if (report.checks.afterUpload.missionUuidVisible < 5) {
    report.errors.push(`After upload: ${report.checks.afterUpload.missionUuidVisible}/5 UUID thumbs visible`);
  }
  if (report.checks.afterReload.missionUuidVisible < 5) {
    report.errors.push(`After reload: ${report.checks.afterReload.missionUuidVisible}/5 UUID thumbs visible`);
  }
  if (report.network.displayNameRequests.length) {
    report.errors.push(`Display-name thumb requests: ${report.network.displayNameRequests.length}`);
  }
  if (report.network.thumb404.length) {
    report.errors.push(`Vault thumb 404s: ${report.network.thumb404.length}`);
  }
} catch (e) {
  report.errors.push(String(e?.message || e));
}

await browser.close();

const traceHeader =
  '| Stage | id | name | fileName | url | thumbnail | thumbnailUrl | Field changes |\n|-------|-----|------|----------|-----|-----------|--------------|---------------|';
const traceBody = report.pipelineTrace
  .map((r) => {
    const ch = Object.entries(r.changes || {})
      .filter(([, v]) => v !== 'same' && v !== '—')
      .map(([k, v]) => `${k}:${v}`)
      .join(', ') || 'stable';
    return `| ${r.stage} | ${r.id || '—'} | ${r.name || '—'} | ${r.fileName || '—'} | ${r.url || '—'} | ${r.thumbnail || '—'} | ${r.thumbnailUrl || '—'} | ${ch} |`;
  })
  .join('\n');

const md = `# MISSION 5.5 — Canonical Thumbnail Identity Validation

Generated: ${new Date().toISOString()}

## Result: ${report.pass ? 'PASS' : 'FAIL'}

${mdTable([
  ['Restart backend', report.restarts.backend || 'SKIP'],
  ['Restart frontend', report.restarts.frontend || 'SKIP'],
  ['Upload 5 UUID thumbnails visible', report.checks.afterUpload?.missionUuidVisible >= 5 ? 'PASS' : 'FAIL'],
  ['Survive reload', report.checks.afterReload?.missionUuidVisible >= 5 ? 'PASS' : 'FAIL'],
  ['Survive sync', report.checks.afterSync?.missionUuidVisible >= 5 ? 'PASS' : 'FAIL'],
  ['naturalWidth > 0', report.checks.afterReload?.allNwPositive ? 'PASS' : 'FAIL'],
  ['Canonical metadata (id/fileName/url)', report.pipelineTrace.length && report.errors.every((e) => !e.includes('canonical')) ? 'PASS' : (report.errors.some((e) => e.includes('canonical')) ? 'FAIL' : 'PASS')],
  ['No /thumbs/display-name requests', report.network.displayNameRequests.length === 0 ? 'PASS' : 'FAIL'],
  ['Zero vault thumb 404s', report.network.thumb404.length === 0 ? 'PASS' : 'FAIL']
])}

## Pipeline trace (first mission-55 entry per stage)

Lookup order enforced: **id → fileName → url** (never name).

${traceHeader}
${traceBody || '| — | — | — | — | — | — | — | — |'}

## Metadata sample (after sync)

\`\`\`json
${JSON.stringify(report.stages[report.stages.length - 1]?.metadata || [], null, 2)}
\`\`\`

## Card sources (after reload)

\`\`\`json
${JSON.stringify(report.stages.find((s) => s.label === 'after-reload')?.cards?.slice(0, 5) || [], null, 2)}
\`\`\`

## Errors

${report.errors.length ? report.errors.map((e) => `- ${e}`).join('\n') : 'None'}

## Network violations (vault scope)

${[...report.network.displayNameRequests, ...report.network.thumb404].length
  ? [...report.network.displayNameRequests, ...report.network.thumb404].map((u) => `- ${u}`).join('\n')
  : 'None'}

## Ignored out-of-scope 404s (hero legacy, not thumbnail vault)

${report.network.ignored404.length ? report.network.ignored404.map((u) => `- ${u}`).join('\n') : 'None'}
`;

writeFileSync(OUT, md);
console.log(md);
process.exit(report.pass ? 0 : 1);
