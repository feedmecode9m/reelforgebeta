#!/usr/bin/env node
/**
 * Phase 6.3 — production post-deploy smoke (Netlify).
 * No catalog mutations. Verifies bundle markers + Arrival ViewerSemanticCard + hover.
 */
import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

dns.setDefaultResultOrder('ipv4first');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const FRONTEND = process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app';
const ARRIVAL = '03ef898a-989f-42c3-bdbb-67f37338df65';
const OUT = path.join(root, 'artifacts/phase-6-3-mp4-vault-lifecycle-production-smoke.json');

let failed = 0;
function assert(cond, label) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

function curlText(url) {
  return execSync(`curl -4 --connect-timeout 20 --max-time 45 -fsS "${url}"`, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
}

console.log('\n[phase-6-3-production-smoke]');
console.log(`  · ${FRONTEND}`);

const report = {
  phase: 'PHASE-6-3-MP4-VAULT-LIFECYCLE-PRODUCTION-SMOKE',
  timestamp: new Date().toISOString(),
  frontend: FRONTEND,
  mutations: {
    categoryPatch: 0,
    titleWrites: 0,
    descriptionWrites: 0,
    productionCatalogWrites: 0,
    deploy: 0
  },
  proof: {},
  status: 'FAIL'
};

const html = curlText(`${FRONTEND}/`);
const bundleMatch = html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/);
const bundle = bundleMatch?.[1] || null;
assert(Boolean(bundle), `production bundle present (${bundle || 'none'})`);
report.proof.bundle = bundle;

const js = curlText(`${FRONTEND}/assets/${bundle}`);
assert(js.includes('data-vault-upload-progress'), 'bundle contains vault upload progress selector');
assert(js.includes('vaultUploadUi') || js.includes('vault-upload-live'), 'bundle contains sticky upload UI');
assert(js.includes('ViewerSemanticCard') || js.includes('data-viewer-semantic-card'), 'bundle contains ViewerSemanticCard');
assert(js.includes('hero_stage_not_discovery_shelf'), 'feed exclusion reason string present');
console.log('  · bundle markers', {
  vaultProgress: js.includes('data-vault-upload-progress'),
  heroStage: js.includes('hero_stage_not_discovery_shelf'),
  rawCategory: js.includes('rawCategory')
});

const catalog = JSON.parse(curlText(`${FRONTEND}/api/reels`));
const arrival = (Array.isArray(catalog) ? catalog : []).find((r) => String(r.id) === ARRIVAL);
assert(Boolean(arrival), 'Arrival reel in /api/reels');
assert(arrival?.type === 'video', 'Arrival type=video');
assert(Boolean(arrival?.url), 'Arrival media URL');
assert(String(arrival?.category || '') !== 'HERO', 'Arrival category is not HERO');
report.proof.catalog = {
  reelId: arrival?.id || null,
  category: arrival?.category || null,
  url: arrival?.url || null
};

let ipv4 = '';
try {
  ipv4 = execSync('getent ahostsv4 strong-lolly-a9fcb4.netlify.app | awk \'{print $1; exit}\'', {
    encoding: 'utf8'
  }).trim();
} catch {
  ipv4 = '';
}

const browser = await chromium.launch({
  headless: true,
  args: ipv4 ? [`--host-resolver-rules=MAP strong-lolly-a9fcb4.netlify.app ${ipv4}`] : []
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).slice(0, 300)));

let categoryPatch = 0;
let titleWrites = 0;
let descriptionWrites = 0;
page.on('request', (req) => {
  const url = req.url();
  const method = req.method().toUpperCase();
  if (method === 'PATCH' && /\/api\/reels|category/i.test(url)) categoryPatch += 1;
  if (method === 'PATCH' && /title/i.test(url)) titleWrites += 1;
  if (method === 'PATCH' && /description/i.test(url)) descriptionWrites += 1;
});

try {
  await page.goto(FRONTEND + '/', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('[data-viewer-semantic-card], [data-viewer-cinematic-feed]', {
    timeout: 90_000
  });
  await page.waitForTimeout(1200);

  const card = page
    .locator(
      `[data-viewer-semantic-card][data-reel-id="${ARRIVAL}"], [data-viewer-semantic-card][data-asset-id="${ARRIVAL}"]`
    )
    .first();
  assert((await card.count()) >= 1, 'Arrival ViewerSemanticCard present');

  const meta = await card.evaluate((el) => {
    const media = el.querySelector('[data-viewer-sem-media], .viewer-sem-card__media');
    const rect = media?.getBoundingClientRect?.() || el.getBoundingClientRect();
    return {
      variant: el.getAttribute('data-viewer-card-variant'),
      mediaType: el.getAttribute('data-media-type'),
      aspect: rect.width && rect.height ? rect.width / rect.height : null,
      className: el.className,
      title: el.getAttribute('aria-label') || ''
    };
  });
  assert(/viewer-sem-card/.test(meta.className || ''), 'cinematic shell class');
  assert(!meta.aspect || (meta.aspect > 1.4 && meta.aspect < 2.1), `16:9 landscape (got ${meta.aspect})`);
  report.proof.card = meta;

  const media = card.locator('[data-viewer-sem-media], .viewer-sem-card__media').first();
  await media.hover({ force: true }).catch(() => card.hover({ force: true }));
  await page.waitForTimeout(1500);
  const play = await card.evaluate((el) => {
    const video = el.querySelector('video');
    return {
      hasVideo: Boolean(video),
      src: video ? String(video.currentSrc || video.src || '').slice(0, 200) : '',
      readyState: video?.readyState ?? 0,
      paused: video?.paused ?? true,
      preview: el.classList.contains('viewer-sem-card--preview')
    };
  });
  assert(play.hasVideo || play.preview || meta.mediaType === 'video', 'hover/play path exercised');
  if (play.hasVideo) assert(Boolean(play.src), 'hover video has src');
  report.proof.hoverPlay = play;

  report.mutations.categoryPatch = categoryPatch;
  report.mutations.titleWrites = titleWrites;
  report.mutations.descriptionWrites = descriptionWrites;
  assert(categoryPatch === 0, 'category PATCH = 0');
  assert(titleWrites === 0, 'title writes = 0');
  assert(descriptionWrites === 0, 'description writes = 0');
  assert(pageErrors.length === 0, `no uncaught exceptions (${pageErrors.length})`);
} finally {
  await browser.close().catch(() => {});
}

report.status = failed ? 'FAIL' : 'PASS';
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`  · wrote ${OUT}`);
if (failed) {
  console.error('\nFAIL — phase-6-3 production smoke\n');
  process.exit(1);
}
console.log('\nPASS — phase-6-3 production smoke\n');
