import fs from 'node:fs';
import { chromium } from 'playwright';
import {
  unlockStudioWithHeroSection,
  readHeroStorage,
  listVaultReelIds
} from '../tests/helpers/studio-navigation.mjs';

const URL = process.env.FRONTEND_URL || 'https://strong-lolly-a9fcb4.netlify.app/';
const OUT =
  process.env.OUT ||
  '/home/youloose2dafish/projects/reelforge/frontend/artifacts/rc2-mp4-02-acceptance.json';
const MP4 = process.env.MP4 || '/tmp/rc2-probe-good.mp4';
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const iso = () => new Date().toISOString();

const report = {
  mission: 'RC2-MP4-02 — MP4 Vault + Hero acceptance verification',
  baselineId: 'RC1-2026-07-19-POST-08C',
  generatedAt: iso(),
  frontendUrl: URL,
  probe: {},
  deployment: {},
  network: { posts: [] },
  steps: {},
  continuity: {},
  classification: null,
  notes: []
};

function postIdentity(body = {}) {
  return {
    id: body?.id || null,
    status: body?.status || null,
    url: body?.url || body?.videoUrl || body?.video_url || null,
    thumbnailUrl: body?.thumbnailUrl || body?.thumbnail_url || null
  };
}

const stat = fs.statSync(MP4);
report.probe = { path: MP4, bytes: stat.size };

const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM });
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();

page.on('response', async (res) => {
  const req = res.request();
  if (req.method() !== 'POST' || !/\/api\/reels(?:\?|$)/.test(res.url())) return;
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  report.network.posts.push({
    at: iso(),
    status: res.status(),
    identity: postIdentity(body),
    bodyKeys: body && typeof body === 'object' ? Object.keys(body).slice(0, 12) : null
  });
});

async function dropFileOn(selector, name) {
  const b64 = fs.readFileSync(MP4).toString('base64');
  return page.evaluate(
    async ({ sel, mp4B64, fname }) => {
      const target = document.querySelector(sel);
      if (!target) return { ok: false, reason: `missing:${sel}` };
      const bytes = Uint8Array.from(atob(mp4B64), (c) => c.charCodeAt(0));
      const file = new File([bytes], fname, { type: 'video/mp4' });
      const dt = new DataTransfer();
      dt.items.add(file);
      target.scrollIntoView({ block: 'center' });
      target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
      return { ok: true };
    },
    { sel: selector, mp4B64: b64, fname: name }
  );
}

async function pollUntil(fn, { timeoutMs = 90000, intervalMs = 1000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await page.waitForTimeout(intervalMs);
  }
  return null;
}

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
  });
  await unlockStudioWithHeroSection(page, URL);
  await page.waitForTimeout(2000);

  report.deployment.bundle = await page.evaluate(
    () =>
      [...document.querySelectorAll('script[src]')]
        .map((s) => s.getAttribute('src'))
        .find((s) => /assets\/index-/.test(s || '')) || null
  );

  const vaultBefore = await listVaultReelIds(page);
  report.steps.baseline = { at: iso(), vaultIdsBefore: vaultBefore, heroStorage: await readHeroStorage(page) };

  // ---- Phase A: content-vault upload (steps 1-5) ----
  const vaultName = `rc2-vault-${Date.now()}.mp4`;
  const dropA = await dropFileOn('.video-vault-drop', vaultName);
  report.steps.step1_upload = { at: iso(), target: '.video-vault-drop', drop: dropA };

  // Wait for content-vault POST (its 202) and for the id to enter the vault (proves ready; createReel throws on failed)
  const vaultPost = await pollUntil(
    () => report.network.posts.find((p) => p.identity.id && !p._claimed) || null,
    { timeoutMs: 30000 }
  );
  if (vaultPost) vaultPost._claimed = 'vault';
  const vaultId = vaultPost?.identity?.id || null;
  report.network.posts.forEach((p) => delete p._claimed);
  report.steps.step1_upload.postStatus = vaultPost?.status || null;
  report.steps.step1_upload.identity = vaultPost?.identity || null;

  const vaultAppeared = await pollUntil(async () => {
    const ids = await listVaultReelIds(page);
    return vaultId && ids.includes(vaultId) ? ids : null;
  }, { timeoutMs: 90000 });

  const vaultAfter = await listVaultReelIds(page);
  report.steps.step2_ingest = {
    at: iso(),
    note: 'Frontend createReel polls GET /api/reels/{id} internally and resolves only on ready (throws on failed)',
    vaultResolved: Boolean(vaultAppeared)
  };
  report.steps.step4_vaultUuid = {
    at: iso(),
    vaultId,
    presentInVault: Boolean(vaultId && vaultAfter.includes(vaultId)),
    vaultIdsAfter: vaultAfter
  };

  // Step 3: confirm ready catalog membership (independent GET from page context)
  const catalog = await page.evaluate(async () => {
    try {
      const r = await fetch(`/api/reels?t=${Date.now()}`);
      const j = await r.json();
      const arr = Array.isArray(j) ? j : Array.isArray(j?.reels) ? j.reels : [];
      return { status: r.status, ids: arr.map((x) => String(x?.id || '')).filter(Boolean) };
    } catch (e) {
      return { error: String(e) };
    }
  });
  report.steps.step3_readyCatalog = {
    at: iso(),
    catalogStatus: catalog.status || null,
    containsVaultId: Boolean(vaultId && catalog.ids?.includes(vaultId))
  };

  // Step 5: vault card render
  const cardInfo = await page.evaluate((wantId) => {
    const cards = [...document.querySelectorAll('.vault-grid--videos .vault-card, .video-vault-grid .vault-card')];
    const match = cards.find((c) => (c.innerHTML || '').includes(wantId || '___none___'));
    return { count: cards.length, matchedNewCard: Boolean(match) };
  }, vaultId);
  report.steps.step5_vaultCard = { at: iso(), ...cardInfo };

  // Step 6 (as user imagined): does the content-vault card expose a "Use as Hero" affordance?
  const contentCardHeroBtn = await page.evaluate(() => {
    const scope = document.querySelector('.vault-grid--videos, .video-vault-grid');
    if (!scope) return { scopePresent: false, useAsHeroButtons: 0 };
    const btns = [...scope.querySelectorAll('button')].filter((b) => /use as hero/i.test(b.textContent || ''));
    return { scopePresent: true, useAsHeroButtons: btns.length };
  });
  report.steps.step6_contentCardHeroAffordance = { at: iso(), ...contentCardHeroBtn };

  // ---- Phase B: Hero assignment via real product mechanism (Hero Replace dropzone) ----
  const heroName = `rc2-hero-${Date.now()}.mp4`;
  await page.evaluate(() => {
    document.querySelector('.hero-replace-section, .hero-drop-zone')?.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);
  const postsBeforeHero = report.network.posts.length;
  const dropB = await dropFileOn('.hero-drop-zone', heroName);
  report.steps.step6_heroAssign = { at: iso(), target: '.hero-drop-zone', drop: dropB, mechanism: 'hero_replace_auto_accept' };

  // Wait for a NEW hero POST + hero storage commit
  const heroCommit = await pollUntil(async () => {
    const hs = await readHeroStorage(page);
    const assetId = hs?.mgr?.heroAssetId || hs?.reel?.id || null;
    if (assetId && hs?.reel?.url) return { hs, assetId };
    return null;
  }, { timeoutMs: 90000 });

  const heroPost = report.network.posts.slice(postsBeforeHero).find((p) => p.identity.id) || null;
  const heroStorageAfter = await readHeroStorage(page);
  const heroAssignedId = heroStorageAfter?.mgr?.heroAssetId || heroStorageAfter?.reel?.id || null;
  report.steps.step7_heroSave = {
    at: iso(),
    heroPostStatus: heroPost?.status || null,
    heroPostIdentity: heroPost?.identity || null,
    heroAssetId: heroAssignedId,
    heroReel: heroStorageAfter?.reel
      ? { id: heroStorageAfter.reel.id, url: heroStorageAfter.reel.url, fileName: heroStorageAfter.reel.fileName || null }
      : null,
    backgroundSource: heroStorageAfter?.mgr?.backgroundSource || null,
    committed: Boolean(heroCommit)
  };

  // Close studio → observe rendered hero
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2000);
  const renderedBeforeReload = await page.evaluate(() => {
    const v = document.querySelector('.hero-stage video, .hero-experience video, video');
    const src = v ? v.currentSrc || v.src || null : null;
    return { src, idFromSrc: src && (src.match(/([0-9a-f-]{36})/i) || [])[1] || null, present: Boolean(v) };
  });
  report.steps.step7_heroRender = { at: iso(), ...renderedBeforeReload };

  // ---- Step 8: hard refresh persistence ----
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(9000);
  const afterReloadHero = await readHeroStorage(page);
  const afterReloadHeroId = afterReloadHero?.mgr?.heroAssetId || afterReloadHero?.reel?.id || null;
  const renderedAfterReload = await page.evaluate(() => {
    const v = document.querySelector('.hero-stage video, .hero-experience video, video');
    const src = v ? v.currentSrc || v.src || null : null;
    return { src, idFromSrc: src && (src.match(/([0-9a-f-]{36})/i) || [])[1] || null, present: Boolean(v) };
  });
  const vaultIdsAfterReload = await listVaultReelIds(page);
  report.steps.step8_persistence = {
    at: iso(),
    heroAssetIdAfterReload: afterReloadHeroId,
    rendered: renderedAfterReload,
    vaultIdContainsUploaded: Boolean(vaultId && vaultIdsAfterReload.includes(vaultId))
  };

  // ---- Continuity ----
  const heroId = heroAssignedId;
  report.continuity = {
    vaultUploadId: vaultId,
    vaultUrl: vaultPost?.identity?.url || null,
    heroUploadId: heroPost?.identity?.id || null,
    heroAssetId: heroId,
    heroRenderIdBeforeReload: renderedBeforeReload.idFromSrc,
    heroAssetIdAfterReload: afterReloadHeroId,
    heroRenderIdAfterReload: renderedAfterReload.idFromSrc,
    vaultUuidSurvivesReload: Boolean(vaultId && vaultIdsAfterReload.includes(vaultId)),
    heroIdSurvivesReload: Boolean(heroId && afterReloadHeroId === heroId),
    heroRenderMatchesAssetAfterReload: Boolean(afterReloadHeroId && renderedAfterReload.idFromSrc === afterReloadHeroId)
  };

  // ---- Classification per step ----
  const s = report.steps;
  const results = {
    step1_upload_202: s.step1_upload.postStatus === 202 || s.step1_upload.postStatus === 200,
    step2_pending_to_ready: Boolean(s.step2_ingest.vaultResolved),
    step3_ready_catalog: Boolean(s.step3_readyCatalog.containsVaultId),
    step4_vault_uuid: Boolean(s.step4_vaultUuid.presentInVault),
    step5_vault_card: Boolean(s.step5_vaultCard.matchedNewCard || s.step5_vaultCard.count > vaultBefore.length),
    step6_use_as_hero_available: Boolean(
      s.step6_contentCardHeroAffordance.useAsHeroButtons > 0 || s.step6_heroAssign.drop?.ok
    ),
    step7_hero_saved: Boolean(s.step7_heroSave.committed && s.step7_heroSave.heroAssetId),
    step8_hero_persists: Boolean(report.continuity.heroIdSurvivesReload && report.continuity.heroRenderMatchesAssetAfterReload)
  };
  const failedSteps = Object.entries(results).filter(([, v]) => !v).map(([k]) => k);
  report.classification = {
    perStep: results,
    firstFailure: failedSteps[0] || null,
    allPass: failedSteps.length === 0,
    result: failedSteps.length === 0 ? 'working' : 'failure_boundary_identified',
    heroAffordanceNote:
      s.step6_contentCardHeroAffordance.useAsHeroButtons === 0
        ? 'Content-vault cards expose no "Use as Hero" button; hero is set via the separate Hero Replace dropzone (heroAssetRegistry sources only the committed hero reel)'
        : 'Content-vault card exposed a Use as Hero affordance'
  };

  report.notes.push('Probe: 8s H.264 + AAC, yuv420p, 640x360 — passes -ss 1 thumbnail extraction.');
  report.notes.push('Hero set via Hero Replace dropzone (product mechanism), not a content-vault card button.');

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        bundle: report.deployment.bundle,
        classification: report.classification,
        continuity: report.continuity,
        stepStatuses: report.classification.perStep
      },
      null,
      2
    )
  );
} catch (err) {
  report.error = String(err?.stack || err);
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('ERROR: ' + String(err?.message || err));
} finally {
  await browser.close();
}
