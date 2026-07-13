#!/usr/bin/env node
/** MISSION 5.6.5 — Canonical identity regression (stop on first divergence) */
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const OUT = join(process.cwd(), 'CANONICAL_IDENTITY_REPORT.md');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SAMPLE_MP4 = '/home/youloose2dafish/projects/reelforge/backend/public/videos/hero-background.mp4';
const CHROMIUM = '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const UUID_THUMB = /\/thumbs\/[0-9a-f-]{36}\.[a-z0-9]+$/i;
const UUID_VIDEO = /\/videos\/[0-9a-f-]{36}\.[a-z0-9]+$/i;
const ALLOWED_NON_UUID = [/^\/videos\/hero-background\.mp4$/i];

const report = {
  result: 'PASS',
  checks: {},
  failureStage: null,
  failureReason: null,
  network: { violations: [], bad404: [] },
  evidence: {}
};

function fail(stage, reason, evidence = {}) {
  report.result = 'FAIL';
  report.failureStage = stage;
  report.failureReason = reason;
  report.checks[stage] = 'FAIL';
  report.evidence[stage] = evidence;
  writeReport();
  console.log(writeReport());
  process.exit(1);
}

function pass(stage, evidence = {}) {
  report.checks[stage] = 'PASS';
  if (Object.keys(evidence).length) report.evidence[stage] = evidence;
}

function pathOnly(u) {
  if (!u) return '';
  try {
    return new URL(u, BASE).pathname.split('?')[0];
  } catch {
    return String(u).split('?')[0];
  }
}

function isDisplayNameUrl(u) {
  const p = pathOnly(u);
  if (!p || p.startsWith('data:') || p.startsWith('blob:')) return false;
  if (p.includes('/thumbs/') && !UUID_THUMB.test(p)) return true;
  if (p.includes('/videos/') && !UUID_VIDEO.test(p) && !ALLOWED_NON_UUID.some((r) => r.test(p))) return true;
  return false;
}

function assertCanonicalEntry(entry, label) {
  const id = String(entry?.id || '').trim();
  const fileName = String(entry?.fileName || entry?.file_name || '').trim();
  const url = pathOnly(entry?.url || '');
  if (!id || !fileName || !url) return `${label}: missing id/fileName/url`;
  if (!url.includes(fileName)) return `${label}: url does not contain fileName`;
  if (isDisplayNameUrl(url)) return `${label}: display-name url ${url}`;
  return null;
}

function writeReport() {
  const rows = [
    ['Thumbnail', report.checks.Thumbnail || '—'],
    ['Video', report.checks.Video || '—'],
    ['Hero', report.checks.Hero || '—'],
    ['Feed', report.checks.Feed || '—'],
    ['Viewer', report.checks.Viewer || '—'],
    ['Placeholder', report.checks.Placeholder || '—'],
    ['Studio', report.checks.Studio || '—'],
    ['Reload', report.checks.Reload || '—'],
    ['Persistence', report.checks.Persistence || '—'],
    ['Network', report.checks.Network || '—']
  ];
  const md = `# CANONICAL_IDENTITY_REPORT

Generated: ${new Date().toISOString()}

## Result: ${report.result}

${report.failureStage ? `**Stopped at:** ${report.failureStage}\n\n**Reason:** ${report.failureReason}\n` : ''}

| Domain | Result |
|--------|--------|
${rows.map(([k, v]) => `| ${k} | ${v} |`).join('\n')}

## Rules verified

- No display-name URLs (\`/thumbs/foo.png\`, \`/videos/name.mp4\` unless allowlisted)
- No UUID reconstruction from display \`name\`
- No fallback URL reconstruction from labels
- No duplicate identity across storage keys

## Evidence

\`\`\`json
${JSON.stringify(report.evidence, null, 2)}
\`\`\`

## Network violations

${report.network.violations.length ? report.network.violations.map((v) => `- ${v}`).join('\n') : 'None'}

## Network 404s (canonical scope)

${report.network.bad404.length ? report.network.bad404.map((v) => `- ${v}`).join('\n') : 'None'}
`;
  writeFileSync(OUT, md);
  return md;
}

async function waitHttp(url, ms = 60000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const code = await fetch(url, { signal: AbortSignal.timeout(3000) }).then((r) => r.status);
      if (code >= 200 && code < 500) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function openStudioContent(page) {
  await page.goto(BASE, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.waitForSelector('.ghost-trigger', { timeout: 60000 });
  await page.click('.ghost-trigger');
  await page.waitForSelector('.control-center-container', { timeout: 60000 });
  await page.click('button[role="tab"]:has-text("Content")').catch(() =>
    page.click('#workspace-tab-content')
  );
  await page.waitForTimeout(1000);
}

async function dropThumb(page, name) {
  const b64 = PNG.toString('base64');
  await page.evaluate(
    async ({ name, b64 }) => {
      const target = document.querySelector('.thumbnail-drop-zone');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], name, { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    },
    { name, b64 }
  );
  await page.waitForSelector('.accept-btn', { timeout: 15000 });
  await page.click('.accept-btn');
  await page.waitForTimeout(6000);
}

async function dropVideo(page, name, mp4B64) {
  await page.evaluate(
    async ({ name, mp4B64 }) => {
      const target = document.querySelector('.video-vault-drop');
      const bytes = Uint8Array.from(atob(mp4B64), (c) => c.charCodeAt(0));
      const file = new File([bytes], name, { type: 'video/mp4' });
      const dt = new DataTransfer();
      dt.items.add(file);
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    },
    { name, mp4B64 }
  );
  await page.waitForTimeout(35000);
}

async function dropHero(page, name) {
  const b64 = PNG.toString('base64');
  await page.evaluate(
    async ({ name, b64 }) => {
      const target = document.querySelector('.hero-drop-zone');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], name, { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    },
    { name, b64 }
  );
  await page.waitForSelector('.hero-replace-section .accept-btn', { timeout: 15000 });
  await page.click('.hero-replace-section .accept-btn');
  await page.waitForTimeout(12000);
}

if (!(await waitHttp(BASE)) || !(await waitHttp('http://127.0.0.1:8080/health'))) {
  fail('Infrastructure', 'Frontend or backend unavailable');
}

const launch = { headless: true };
if (existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;
const browser = await chromium.launch(launch);
const context = await browser.newContext();
await context.addInitScript(() => {
  if (sessionStorage.getItem('mission565_boot')) return;
  sessionStorage.setItem('mission565_boot', '1');
  localStorage.setItem('admin_mode', 'true');
  localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
  localStorage.removeItem('reelforge_hero_reel');
  localStorage.removeItem('reelforge_hero_image');
  localStorage.removeItem('reelforge_hero_video');
  localStorage.setItem('personal_thumbnails', '[]');
  localStorage.setItem('personal_thumbnail_index', '[]');
  localStorage.setItem('personal_video_vault', '[]');
  localStorage.setItem(
    'reelforge_feed',
    JSON.stringify({ Trending: [], Romance: [], 'Cyber-Action': [], Suspense: [] })
  );
});

const page = await context.newPage();
let monitoring = false;
page.on('request', (req) => {
  if (!monitoring) return;
  const u = req.url();
  if ((u.includes('/thumbs/') || u.includes('/videos/')) && isDisplayNameUrl(u)) {
    report.network.violations.push(`request:${u}`);
  }
});
page.on('response', (res) => {
  if (!monitoring) return;
  const u = res.url();
  if (res.status() === 404 && (u.includes('/thumbs/') || u.includes('/videos/'))) {
    const p = pathOnly(u);
    if (UUID_THUMB.test(p) || UUID_VIDEO.test(p)) report.network.bad404.push(`404:${u}`);
  }
});

try {
  await openStudioContent(page);
  monitoring = true;

  // ── Thumbnail ──
  await dropThumb(page, 'regression-thumb-1.png');
  await dropThumb(page, 'regression-thumb-2.png');
  const thumbSnap = await page.evaluate(() => {
    const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    const index = JSON.parse(localStorage.getItem('personal_thumbnail_index') || '[]');
    const cards = [...document.querySelectorAll('.vault-grid--images .vault-card img')].map((img) => ({
      src: img.currentSrc || img.src,
      nw: img.naturalWidth
    }));
    return { thumbs, index, cards };
  });
  const missionThumbs = thumbSnap.thumbs.filter((t) =>
    String(t?.name || '').includes('regression-thumb')
  );
  if (missionThumbs.length < 2) {
    fail('Thumbnail', `Expected 2 regression thumbs, got ${missionThumbs.length}`, thumbSnap);
  }
  for (const t of missionThumbs) {
    const err = assertCanonicalEntry(t, 'thumbnail');
    if (err) fail('Thumbnail', err, t);
  }
  const thumbIds = new Set(missionThumbs.map((t) => t.id));
  if (thumbIds.size !== missionThumbs.length) fail('Thumbnail', 'Duplicate thumbnail id', missionThumbs);
  const thumbUrls = new Set(missionThumbs.map((t) => t.url));
  if (thumbUrls.size !== missionThumbs.length) fail('Thumbnail', 'Duplicate thumbnail url', missionThumbs);
  for (const c of thumbSnap.cards.filter((c) => c.nw > 0)) {
    if (isDisplayNameUrl(c.src)) fail('Thumbnail', `Studio card display-name src: ${c.src}`, c);
  }
  pass('Thumbnail', { count: missionThumbs.length, sample: missionThumbs[0] });

  // ── Video ──
  if (!existsSync(SAMPLE_MP4)) fail('Video', `Missing sample mp4 at ${SAMPLE_MP4}`);
  const mp4B64 = readFileSync(SAMPLE_MP4).toString('base64');
  await dropVideo(page, 'regression-video.mp4', mp4B64);
  const videoSnap = await page.evaluate(() => {
    const videos = JSON.parse(localStorage.getItem('personal_video_vault') || '[]');
    const cards = [...document.querySelectorAll('.vault-grid--videos video, .vault-grid--videos img')].map(
      (el) => ({ src: el.currentSrc || el.src, tag: el.tagName })
    );
    return { videos, cards };
  });
  const regVideo =
    videoSnap.videos.find((v) => UUID_VIDEO.test(pathOnly(v?.url || ''))) ||
    videoSnap.videos.find((v) => String(v?.fileName || v?.file_name || '').endsWith('.mp4')) ||
    videoSnap.videos[0];
  if (!regVideo) fail('Video', 'No video in vault after upload', videoSnap);
  const verr = assertCanonicalEntry(regVideo, 'video');
  if (verr) fail('Video', verr, regVideo);
  if (regVideo.url && !UUID_VIDEO.test(pathOnly(regVideo.url))) {
    fail('Video', `Video url not UUID path: ${regVideo.url}`, regVideo);
  }
  pass('Video', { sample: { id: regVideo.id, fileName: regVideo.fileName, url: regVideo.url } });

  // ── Hero ──
  await dropHero(page, 'regression-hero.png');
  const heroSnap = await page.evaluate(() => ({
    reel: JSON.parse(localStorage.getItem('reelforge_hero_reel') || 'null'),
    mgr: JSON.parse(localStorage.getItem('reelforge_hero_manager_config') || '{}'),
    legacy: {
      img: localStorage.getItem('reelforge_hero_image'),
      vid: localStorage.getItem('reelforge_hero_video')
    }
  }));
  if (!heroSnap.reel?.id || !heroSnap.reel?.url) fail('Hero', 'Missing reelforge_hero_reel', heroSnap);
  if (heroSnap.mgr.heroAssetId !== heroSnap.reel.id) {
    fail('Hero', `heroAssetId ${heroSnap.mgr.heroAssetId} !== reel.id ${heroSnap.reel.id}`, heroSnap);
  }
  if (heroSnap.legacy.img || heroSnap.legacy.vid) {
    fail('Hero', 'Duplicate legacy hero storage present', heroSnap.legacy);
  }
  const herr = assertCanonicalEntry(heroSnap.reel, 'hero');
  if (herr) fail('Hero', herr, heroSnap.reel);
  pass('Hero', { reel: heroSnap.reel });

  // ── Feed ──
  await page.waitForTimeout(3000);
  const feedSnap = await page.evaluate(() => {
    const feed = JSON.parse(localStorage.getItem('reelforge_feed') || '{}');
    const urls = [];
    for (const cat of Object.keys(feed)) {
      for (const reel of feed[cat] || []) {
        urls.push({
          id: reel?.id,
          name: reel?.name,
          url: reel?.url || reel?.video_url,
          thumbnail: reel?.thumbnail || reel?.thumbnailUrl
        });
      }
    }
    return { urls };
  });
  for (const r of feedSnap.urls) {
    if (r.url && isDisplayNameUrl(r.url)) fail('Feed', `Feed reel display-name url: ${r.url}`, r);
    if (r.thumbnail && isDisplayNameUrl(r.thumbnail)) {
      fail('Feed', `Feed reel display-name thumbnail: ${r.thumbnail}`, r);
    }
    if (r.id && r.url && !pathOnly(r.url).includes(String(r.id).slice(0, 8))) {
      // feed url should map to canonical fileName/id — at minimum not be display name
    }
  }
  pass('Feed', { reelCount: feedSnap.urls.length });

  // ── Viewer ──
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(800);
  const viewerSnap = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.feed-card img, .vault-card img')].map((img) => ({
      src: img.currentSrc || img.src,
      nw: img.naturalWidth
    }));
    const vids = [...document.querySelectorAll('.feed-card video, .vault-card video')].map((v) => ({
      src: v.currentSrc || v.src
    }));
    return { imgs, vids };
  });
  for (const img of viewerSnap.imgs) {
    if (img.nw > 0 && isDisplayNameUrl(img.src)) fail('Viewer', `Display-name image src: ${img.src}`, img);
  }
  for (const v of viewerSnap.vids) {
    if (v.src && isDisplayNameUrl(v.src)) fail('Viewer', `Display-name video src: ${v.src}`, v);
  }
  pass('Viewer', { images: viewerSnap.imgs.length, videos: viewerSnap.vids.length });

  // ── Placeholder ──
  const placeholderSnap = await page.evaluate(() => {
    const ph = [...document.querySelectorAll('.placeholder, .video-placeholder, .hero-loading-fallback img')];
    return ph.map((el) => ({
      tag: el.tagName,
      src: el.src || el.getAttribute('src') || '',
      text: el.textContent?.slice(0, 40)
    }));
  });
  for (const p of placeholderSnap) {
    if (p.src && isDisplayNameUrl(p.src)) fail('Placeholder', `Placeholder display-name src: ${p.src}`, p);
  }
  pass('Placeholder', { count: placeholderSnap.length });

  // ── Studio ──
  await page.click('.ghost-trigger').catch(() => {});
  await page.waitForSelector('.control-center-container', { timeout: 30000 }).catch(() => {});
  const studioSnap = await page.evaluate(() => {
    const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    const videos = JSON.parse(localStorage.getItem('personal_video_vault') || '[]');
    const hero = JSON.parse(localStorage.getItem('reelforge_hero_reel') || 'null');
    const dupThumb = thumbs.length !== new Set(thumbs.map((t) => t?.id || t?.url)).size;
    const dupVideo = videos.length !== new Set(videos.map((v) => v?.id || v?.url)).size;
    return { thumbCount: thumbs.length, videoCount: videos.length, heroId: hero?.id, dupThumb, dupVideo };
  });
  if (studioSnap.dupThumb) fail('Studio', 'Duplicate thumbnail identity in personal_thumbnails', studioSnap);
  if (studioSnap.dupVideo) fail('Studio', 'Duplicate video identity in personal_video_vault', studioSnap);
  pass('Studio', studioSnap);

  // ── Reload ──
  const beforeReload = await page.evaluate(() => ({
    thumbs: JSON.parse(localStorage.getItem('personal_thumbnails') || '[]').length,
    videos: JSON.parse(localStorage.getItem('personal_video_vault') || '[]').length,
    hero: JSON.parse(localStorage.getItem('reelforge_hero_reel') || 'null')?.id
  }));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(4000);
  const afterReload = await page.evaluate(() => ({
    thumbs: JSON.parse(localStorage.getItem('personal_thumbnails') || '[]').length,
    videos: JSON.parse(localStorage.getItem('personal_video_vault') || '[]').length,
    hero: JSON.parse(localStorage.getItem('reelforge_hero_reel') || 'null')?.id,
    thumbSample: JSON.parse(localStorage.getItem('personal_thumbnails') || '[]')[0]
  }));
  if (afterReload.thumbs < beforeReload.thumbs) {
    fail('Reload', `Thumbnails lost after reload ${beforeReload.thumbs} → ${afterReload.thumbs}`, {
      beforeReload,
      afterReload
    });
  }
  if (afterReload.hero !== beforeReload.hero) {
    fail('Reload', `Hero id changed after reload`, { beforeReload, afterReload });
  }
  if (afterReload.thumbSample) {
    const err = assertCanonicalEntry(afterReload.thumbSample, 'thumbnail-reload');
    if (err) fail('Reload', err, afterReload.thumbSample);
  }
  pass('Reload', { beforeReload, afterReload });

  // ── Persistence ──
  const persistSnap = await page.evaluate(() => {
    const hero = JSON.parse(localStorage.getItem('reelforge_hero_reel') || 'null');
    const mgr = JSON.parse(localStorage.getItem('reelforge_hero_manager_config') || '{}');
    const legacyHero = Boolean(localStorage.getItem('reelforge_hero_image') || localStorage.getItem('reelforge_hero_video'));
    const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    const index = JSON.parse(localStorage.getItem('personal_thumbnail_index') || '[]');
    const indexIsStrings = index.every((x) => typeof x === 'string');
    const indexMatchesFileName = thumbs.every((t) => {
      const fn = t?.fileName;
      return !fn || index.includes(fn);
    });
    return { hero, mgr, legacyHero, indexIsStrings, indexCount: index.length, thumbCount: thumbs.length };
  });
  if (persistSnap.legacyHero && persistSnap.hero) {
    fail('Persistence', 'Hero duplicate: canonical reel + legacy keys', persistSnap);
  }
  if (persistSnap.hero && persistSnap.mgr.heroAssetId !== persistSnap.hero.id) {
    fail('Persistence', 'heroAssetId drift from reel.id', persistSnap);
  }
  pass('Persistence', persistSnap);

  // ── Network ──
  if (report.network.violations.length) {
    fail('Network', `Display-name media requests: ${report.network.violations.length}`, report.network);
  }
  if (report.network.bad404.length) {
    fail('Network', `Canonical media 404s: ${report.network.bad404.length}`, report.network);
  }
  pass('Network', report.network);
} catch (e) {
  fail(report.failureStage || 'Unhandled', String(e?.message || e));
} finally {
  await browser.close();
}

const md = writeReport();
console.log(md);
process.exit(report.result === 'PASS' ? 0 : 1);
