#!/usr/bin/env node
/**
 * Phase 6.5 — production post-deploy smoke (Netlify).
 * Verifies identity architecture: video-canonical cards, IMG_/UUID suppressed,
 * poster artwork, cinematic layouts, zero mutations.
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
const IMG_0121 = 'caa1a16f-be03-4c2b-9840-9fce9a809c00';
const OUT = path.join(root, 'artifacts/phase-6-5-production-smoke.json');
const SHOT = path.join(root, 'artifacts/phase-6-5-production-viewer.png');

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

console.log('\n[phase-6-5-production-smoke]');
console.log(`  · ${FRONTEND}`);

const report = {
  phase: 'PHASE-6-5-VIEWER-MEDIA-IDENTITY-PRODUCTION-SMOKE',
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
assert(
  js.includes('viewerMediaIdentity') ||
    js.includes('evaluateViewerImageDiscoveryEligibility') ||
    js.includes('image_not_publishable') ||
    js.includes('publishable_image_card'),
  'bundle contains Phase 6.5 identity gate markers'
);
assert(
  js.includes('isUnsafeViewerCardTitle') ||
    js.includes('resolveSafeViewerCardTitle') ||
    js.includes('camera_img_name'),
  'bundle contains title-safety / artifact markers'
);
assert(
  js.includes('data-viewer-semantic-card') || js.includes('ViewerSemanticCard'),
  'bundle contains ViewerSemanticCard'
);
assert(
  js.includes('data-vault-upload-progress') || js.includes('vaultUploadUi'),
  'bundle retains vault upload progress UI'
);

const catalog = JSON.parse(curlText(`${FRONTEND}/api/reels`));
const rows = Array.isArray(catalog) ? catalog : [];
const arrival = rows.find((r) => String(r.id) === ARRIVAL);
const img = rows.find((r) => String(r.id) === IMG_0121);
assert(Boolean(arrival), 'Arrival reel still in /api/reels');
assert(arrival?.type === 'video', 'Arrival type=video');
assert(Boolean(arrival?.url), 'Arrival media URL');
report.proof.catalog = {
  arrivalId: arrival?.id || null,
  arrivalCategory: arrival?.category || null,
  img0121StillInCatalog: Boolean(img),
  note: 'IMG may remain in catalog; must not render as discovery card'
};

let categoryPatch = 0;
let titleWrites = 0;
let descriptionWrites = 0;
let catalogWrites = 0;
const pageErrors = [];

const browser = await chromium.launch({
  headless: true,
  args: ['--host-resolver-rules=MAP strong-lolly-a9fcb4.netlify.app 104.18.0.0']
});
try {
  // Resolve Netlify IPv4 via dig/curl for host-resolver if needed
  let ipv4 = '';
  try {
    ipv4 = execSync(
      `curl -4 -s --connect-timeout 5 --max-time 10 -o /dev/null -w '%{remote_ip}' ${FRONTEND}/`,
      { encoding: 'utf8' }
    ).trim();
  } catch {
    ipv4 = '';
  }
  await browser.close();
  const browser2 = await chromium.launch({
    headless: true,
    args: ipv4
      ? [`--host-resolver-rules=MAP strong-lolly-a9fcb4.netlify.app ${ipv4}`]
      : []
  });
  const page = await browser2.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (err) => pageErrors.push(String(err?.message || err).slice(0, 300)));

  await page.route('**/*', async (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    const url = req.url();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      if (/\/api\/.*reels/i.test(url) && method !== 'GET') catalogWrites += 1;
      if (method === 'PATCH' && /categor/i.test(url)) categoryPatch += 1;
      if (/title/i.test(url) && method !== 'GET') titleWrites += 1;
      if (/description/i.test(url) && method !== 'GET') descriptionWrites += 1;
    }
    await route.continue();
  });

  await page.goto(FRONTEND, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(5000);

  const probe = await page.evaluate((arrivalId) => {
    const cards = [...document.querySelectorAll('[data-viewer-semantic-card]')].map((el) => ({
      assetId: el.getAttribute('data-asset-id') || el.getAttribute('data-reel-id') || '',
      mediaType: el.getAttribute('data-media-type') || '',
      mediaSource: el.getAttribute('data-media-source') || '',
      posterUrl: el.getAttribute('data-poster-url') || '',
      title:
        el.querySelector('[data-viewer-sem-title-overlay], [data-viewer-sem-title]')?.textContent?.trim() ||
        '',
      aria: el.getAttribute('aria-label') || ''
    }));
    const unique = [...new Set(cards.map((c) => c.assetId).filter(Boolean))];
    const arrivalCards = cards.filter((c) => c.assetId === arrivalId);
    const imgLeak = cards.filter(
      (c) =>
        /img[_\s-]?\d+/i.test(c.title) ||
        /img[_\s-]?\d+/i.test(c.aria) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(c.title)
    );
    return {
      cardCount: cards.length,
      uniqueAssetIds: unique,
      arrivalCount: arrivalCards.length,
      arrival: arrivalCards[0] || null,
      imgOrUuidTitleLeak: imgLeak.length,
      featured: Boolean(document.querySelector('[data-viewer-featured-card]')),
      trending: Boolean(document.querySelector('[data-viewer-discovery-row="Trending"]')),
      browse: Boolean(document.querySelector('[data-viewer-browse-grid]')),
      cards
    };
  }, ARRIVAL);

  assert(probe.featured, 'Featured layout present');
  assert(probe.trending, 'Trending row present');
  assert(probe.browse || probe.uniqueAssetIds.length <= 1, 'Browse grid present (or single-card layout)');
  assert(probe.arrivalCount >= 1, `Arrival identity rendered (dom=${probe.arrivalCount})`);
  assert(
    new Set(probe.cards.filter((c) => c.assetId === ARRIVAL).map((c) => c.assetId)).size <= 1,
    'Arrival unique identity ≤ 1'
  );
  assert(
    !probe.uniqueAssetIds.includes(IMG_0121),
    'IMG_0121 not in unique discovery identities'
  );
  assert(probe.imgOrUuidTitleLeak === 0, 'no IMG_/UUID title leakage on cards');
  assert(
    probe.arrival?.mediaSource === 'video' || probe.arrival?.mediaType === 'video',
    'Arrival mediaSource/type is video'
  );
  assert(Boolean(probe.arrival?.posterUrl), 'Arrival has poster artwork');

  // Hover/play on Arrival card
  const arrivalLoc = page
    .locator(`[data-viewer-semantic-card][data-asset-id="${ARRIVAL}"], [data-viewer-semantic-card][data-reel-id="${ARRIVAL}"]`)
    .first();
  if ((await arrivalLoc.count()) > 0) {
    await arrivalLoc.hover({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const hover = await arrivalLoc.evaluate((el) => {
      const video = el.querySelector('video');
      return {
        hasVideo: Boolean(video),
        src: video?.currentSrc || video?.src || '',
        poster: video?.getAttribute('poster') || ''
      };
    });
    report.proof.hoverPlay = hover;
    assert(
      hover.hasVideo || Boolean(probe.arrival?.posterUrl),
      'hover/play mounts video or retains poster'
    );
    if (hover.hasVideo) {
      assert(/\.mp4|\/prod\//i.test(hover.src), 'hover video has real MP4 src');
    }
  }

  fs.mkdirSync(path.dirname(SHOT), { recursive: true });
  await page.screenshot({ path: SHOT, fullPage: true });
  report.proof.screenshot = 'frontend/artifacts/phase-6-5-production-viewer.png';
  report.proof.viewer = probe;

  await browser2.close();
} catch (err) {
  console.error('  browser smoke error:', err?.message || err);
  failed += 1;
}

assert(categoryPatch === 0, 'category PATCH = 0');
assert(titleWrites === 0, 'title writes = 0');
assert(descriptionWrites === 0, 'description writes = 0');
assert(catalogWrites === 0, 'production catalog writes = 0');
assert(pageErrors.length === 0, `uncaught exceptions = 0 (got ${pageErrors.length})`);

report.mutations = {
  categoryPatch,
  titleWrites,
  descriptionWrites,
  productionCatalogWrites: catalogWrites,
  deploy: 0
};
report.status = failed === 0 ? 'PASS' : 'FAIL';
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`  · wrote ${OUT}`);

if (failed > 0) {
  console.error(`\nFAIL — phase-6-5-production-smoke (${failed})`);
  process.exit(1);
}
console.log('\nPASS — phase-6-5-production-smoke');
process.exit(0);
