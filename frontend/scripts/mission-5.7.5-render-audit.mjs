#!/usr/bin/env node
/** MISSION 5.7.5 — Render source audit (investigation only, no patches) */
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173/';
const API = process.env.API_URL || 'http://127.0.0.1:8080';
const OUT = join(process.cwd(), 'MISSION_5_7_5_RENDER_SOURCE_AUDIT.md');
const CHROMIUM = '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

const audit = {
  result: 'INVESTIGATION',
  firstDivergence: null,
  divergenceStage: null,
  counts: {},
  cards: [],
  stores: {},
  vaultLogs: [],
  backendReels: [],
  duplicationSources: []
};

async function waitHttp(url) {
  for (let i = 0; i < 60; i++) {
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

async function fetchBackendThumbs() {
  try {
    const res = await fetch(`${API}/api/reels`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const reels = await res.json();
    return (Array.isArray(reels) ? reels : []).filter((r) => {
      const t = String(r?.type || '').toLowerCase();
      const url = String(r?.url || '');
      return t === 'image' || url.includes('/thumbs/');
    });
  } catch {
    return [];
  }
}

async function diskExists(page, url) {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return null;
  const path = url.startsWith('http') ? url : `${BASE.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}`;
  try {
    const status = await page.request.fetch(path, { method: 'HEAD' }).then((r) => r.status());
    return status === 200;
  } catch {
    return false;
  }
}

if (!(await waitHttp(BASE))) {
  console.error('Frontend unavailable');
  process.exit(1);
}

audit.backendReels = await fetchBackendThumbs();

const launch = { headless: true };
if (existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;
const browser = await chromium.launch(launch);
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  window.__vaultAuditLogs = [];
  const orig = console.info.bind(console);
  console.info = (...args) => {
    const tag = String(args[0] || '');
    if (tag.startsWith('[VAULT_')) {
      window.__vaultAuditLogs.push({ tag, payload: args[1], at: Date.now() });
    }
    orig(...args);
  };
});

const page = await ctx.newPage();
try {
  // Phase A: reproduce Mission 5.7.3 forensic 20-card vault (5 canonical + 15 phantom)
  await page.goto(BASE, { waitUntil: 'load', timeout: 120000 });
  await page.evaluate(() => {
    const thumbs = [];
    const index = [];
    for (let i = 0; i < 15; i++) {
      const fn = `phantom-no-id-${i}.png`;
      thumbs.push({ fileName: fn, url: `/thumbs/${fn}`, name: fn, orphaned: true });
      index.push(fn);
    }
    for (let i = 0; i < 5; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      const fn = `${id}.png`;
      thumbs.push({ id, fileName: fn, url: `/thumbs/${fn}`, name: `canonical-${i}.png` });
      index.push(fn);
    }
    localStorage.setItem('personal_thumbnails', JSON.stringify(thumbs));
    localStorage.setItem('personal_thumbnail_index', JSON.stringify(index));
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_admin_session_token', 'rf_forensic_test');
  });
  audit.scenario = 'forensic-20-repro';

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3000);
  await page.click('.ghost-trigger').catch(() => {});
  await page.waitForSelector('.control-center-container', { timeout: 60000 }).catch(() => {});
  await page.click('button[role="tab"]:has-text("Content")').catch(() => {});
  await page.waitForTimeout(8000);
  await page.waitForFunction(() => window.__thumbCanonicalizationReady === true, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const snap = await page.evaluate(async () => {
    const thumbs = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
    const index = JSON.parse(localStorage.getItem('personal_thumbnail_index') || '[]');
    const feed = JSON.parse(localStorage.getItem('reelforge_feed') || '{}');
    const feedThumbs = Object.values(feed)
      .flat()
      .filter((r) => r?.isPersonalThumbnail || String(r?.url || '').includes('/thumbs/'));

    const cards = [...document.querySelectorAll('.vault-grid--images .vault-card')].map((card, renderIndex) => {
      const placeholder = Boolean(card.querySelector('.placeholder'));
      const img = card.querySelector('img');
      const label = card.querySelector('.thumbnail-label')?.textContent?.trim() || '';
      const orphanLabel = card.querySelector('.batch-select-label.orphan-entry') ? true : false;
      return {
        renderIndex,
        label,
        placeholder,
        orphanLabel,
        imgSrc: img?.currentSrc || img?.src || null,
        imgNaturalWidth: img?.naturalWidth || 0
      };
    });

    const heading = [...document.querySelectorAll('h4')].find((h) => h.textContent?.includes('Your Thumbnails'))?.textContent;

    return {
      heading,
      cards,
      stores: {
        personal_thumbnails: thumbs,
        personal_thumbnail_index: index,
        feedPersonalThumbs: feedThumbs
      },
      logs: window.__vaultAuditLogs || []
    };
  });

  const backendById = new Map(audit.backendReels.map((r) => [String(r.id), r]));
  const backendByFile = new Map();
  for (const r of audit.backendReels) {
    const fn = String(r.fileName || r.file_name || r.url?.split('/').pop() || '').trim();
    if (fn) backendByFile.set(fn, r);
  }

  for (const dom of snap.cards) {
    const i = dom.renderIndex;
    const indexItem = snap.stores.personal_thumbnail_index[i];
    const key = typeof indexItem === 'string' ? indexItem : String(indexItem?.fileName || indexItem?.id || '').trim();
    const stored = snap.stores.personal_thumbnails.find((t) => {
      if (!t) return false;
      if (typeof t === 'string') return String(t).trim() === key;
      const fk = String(t.fileName || t.file_name || '').trim();
      const id = String(t.id || '').trim();
      return fk === key || id === key;
    });
    const fileName =
      stored && typeof stored === 'object'
        ? String(stored.fileName || stored.file_name || '').trim()
        : key;
    const url =
      stored && typeof stored === 'object'
        ? String(stored.url || '')
        : fileName
          ? `/thumbs/${fileName}`
          : '';
    const backend = stored?.id ? backendById.get(String(stored.id)) : backendByFile.get(fileName);
    const disk = await diskExists(page, dom.imgSrc || url);

    audit.cards.push({
      renderIndex: i,
      displayName: stored?.name || stored?.title || fileName || key,
      id: stored?.id || null,
      fileName: fileName || null,
      url: dom.imgSrc || url || null,
      thumbnail: stored?.thumbnail || null,
      thumbnailUrl: stored?.thumbnailUrl || null,
      placeholder: dom.placeholder,
      orphaned: stored?.orphaned ?? dom.orphanLabel,
      active_upload: Boolean(String(stored?.url || '').startsWith('blob:') || String(stored?.url || '').startsWith('data:')),
      storeOrigin: 'personalThumbnailCollection',
      componentOrigin: 'VaultExperience.svelte:1285',
      collectionItem: indexItem,
      backendExists: Boolean(backend),
      diskExists: disk,
      hasStoredMetadata: Boolean(stored)
    });
  }

  audit.counts = {
    backendReels: audit.backendReels.length,
    personal_thumbnails: snap.stores.personal_thumbnails.length,
    personal_thumbnail_index: snap.stores.personal_thumbnail_index.length,
    personalThumbnailCollection_derived: snap.stores.personal_thumbnail_index.length,
    renderedCards: snap.cards.length,
    heading: snap.heading,
    feedPersonalThumbs: snap.stores.feedPersonalThumbs.length,
    placeholders: snap.cards.filter((c) => c.placeholder).length
  };

  audit.stores = {
    personal_thumbnails: snap.stores.personal_thumbnails,
    personal_thumbnail_index: snap.stores.personal_thumbnail_index,
    feedPersonalThumbs: snap.stores.feedPersonalThumbs
  };

  audit.vaultLogs = snap.logs;

  // Find first count mismatch in pipeline
  const pipeline = [
    ['backendReels', audit.counts.backendReels],
    ['personal_thumbnails', audit.counts.personal_thumbnails],
    ['personal_thumbnail_index', audit.counts.personal_thumbnail_index],
    ['renderedCards', audit.counts.renderedCards]
  ];
  for (let i = 1; i < pipeline.length; i++) {
    if (pipeline[i][1] !== pipeline[i - 1][1]) {
      if (!audit.firstDivergence) {
        audit.firstDivergence = {
          stage: `${pipeline[i - 1][0]} (${pipeline[i - 1][1]}) → ${pipeline[i][0]} (${pipeline[i][1]})`,
          expected: pipeline[i - 1][1],
          actual: pipeline[i][1],
          delta: pipeline[i][1] - pipeline[i - 1][1],
          type: 'count_pipeline_mismatch'
        };
        audit.divergenceStage = pipeline[i][0];
      }
    }
  }

  // Reports vs runtime: backend empty but local vault populated
  if (audit.counts.backendReels === 0 && audit.counts.personal_thumbnails > 0) {
    audit.reportsVsRuntime = {
      stage: `backend (${audit.counts.backendReels}) vs personal_thumbnails (${audit.counts.personal_thumbnails})`,
      type: 'reports_vs_runtime',
      explanation: 'Validation reports count backend/canonical deletes; UI renders personal_thumbnail_index regardless of backend catalog.',
      file: 'frontend/src/viewer/viewerContext.js',
      function: 'createPersistentStore + reloadVaultStoresFromStorage',
      line: '276, 790',
      renderBinding: 'frontend/src/components/experiences/VaultExperience.svelte:1285'
    };
    if (!audit.firstDivergence) audit.firstDivergence = audit.reportsVsRuntime;
  }

  // UI vs store divergence (rendered ≠ collection feeding #each)
  if (!audit.firstDivergence && audit.counts.renderedCards !== audit.counts.personal_thumbnail_index) {
    audit.firstDivergence = {
      stage: `personal_thumbnail_index (${audit.counts.personal_thumbnail_index}) → renderedCards (${audit.counts.renderedCards})`,
      type: 'ui_vs_store'
    };
  }

  // metadata vs index divergence
  if (!audit.firstDivergence && audit.counts.personal_thumbnails !== audit.counts.personal_thumbnail_index) {
    audit.firstDivergence = {
      stage: `personal_thumbnails (${audit.counts.personal_thumbnails}) → personal_thumbnail_index (${audit.counts.personal_thumbnail_index})`,
      type: 'metadata_vs_index',
      file: 'frontend/src/viewer/viewerContext.js',
      function: 'reloadVaultStoresFromStorage / createPersistentStore',
      line: '790 / 276'
    };
  }

  // placeholder cards without metadata
  const orphanCards = audit.cards.filter((c) => c.placeholder && !c.hasStoredMetadata);
  if (!audit.firstDivergence && orphanCards.length) {
    audit.firstDivergence = {
      stage: `rendered placeholder cards without personal_thumbnails metadata (${orphanCards.length})`,
      type: 'synthetic_or_missing_metadata',
      sample: orphanCards[0]
    };
  }

  // Check duplication sources
  if (audit.counts.personal_thumbnail_index > 0) audit.duplicationSources.push('personal_thumbnail_index');
  if (audit.counts.personal_thumbnails > 0) audit.duplicationSources.push('personal_thumbnails');
  if (audit.counts.feedPersonalThumbs > 0) audit.duplicationSources.push('reelforge_feed (isPersonalThumbnail)');
} finally {
  await browser.close();
}

function cardReport(c) {
  return `### Card ${c.renderIndex}

| Field | Value |
|-------|-------|
| renderIndex | ${c.renderIndex} |
| store | ${c.storeOrigin} |
| component | ${c.componentOrigin} |
| collectionItem | \`${JSON.stringify(c.collectionItem)}\` |
| displayName | ${c.displayName || '—'} |
| id | ${c.id || '—'} |
| fileName | ${c.fileName || '—'} |
| url | ${c.url || '—'} |
| placeholder | ${c.placeholder} |
| orphaned | ${c.orphaned} |
| active_upload | ${c.active_upload} |
| hasStoredMetadata | ${c.hasStoredMetadata} |
| backendExists | ${c.backendExists} |
| diskExists | ${c.diskExists} |
`;
}

const md = `# MISSION_5_7_5_RENDER_SOURCE_AUDIT

Generated: ${new Date().toISOString()}

## Mode: Investigation only (no patches)

---

## 1. Complete render pipeline

\`\`\`
DOM Card (.vault-grid--images .vault-card)
  ↓ #each in VaultExperience.svelte:1285
  ↓ ($personalThumbnailCollection ?? []).filter(Boolean)
  ↓ Svelte store: personalThumbnailCollection
  ↓ createPersistentStore('personal_thumbnail_index') — init loads index from localStorage
  ↓ viewerContext.reloadVaultStoresFromStorage() — sets index from personal_thumbnails fileNames
  ↓ mediaBootstrap.ingestThumbReelsToVault() — refreshes metadata only (no new entries since 5.7.2)
  ↓ localStorage: personal_thumbnails (metadata) + personal_thumbnail_index (render keys)
  ↓ backend GET /api/reels
\`\`\`

**Card content resolution (per item):**
\`\`\`
collection item (string fileName or object)
  ↓ getVaultImageReel(img, i) — vaultUtils.js:237
  ↓ findStoredThumbnailEntry(personal_thumbnails)
  ↓ resolve url → MediaThumbnail OR {:else} .placeholder div
\`\`\`

---

## 2. Store ownership diagram

\`\`\`mermaid
flowchart TD
  subgraph localStorage
    PT[personal_thumbnails<br/>metadata objects]
    PI[personal_thumbnail_index<br/>fileName keys]
  end
  subgraph viewerContext
    PCS[personalThumbnailCollection store]
    RVS[reloadVaultStoresFromStorage]
    SFV[syncFromVault]
    MB[bootstrapMediaFromBackend]
  end
  subgraph VaultExperience
    EACH["#each personalThumbnailCollection"]
    GVR[getVaultImageReel]
    DOM[DOM vault-card]
  end
  BE[GET /api/reels]
  PI -->|createPersistentStore init| PCS
  PT --> RVS
  RVS -->|set fileNames| PCS
  RVS -->|write| PT
  RVS -->|write| PI
  BE --> SFV
  SFV --> RVS
  MB --> PT
  PCS --> EACH
  EACH --> GVR
  PT --> GVR
  GVR --> DOM
\`\`\`

---

## 3. Count comparison table

| Stage | Count |
|-------|------:|
| Backend reels (/thumbs/) | ${audit.counts.backendReels} |
| personal_thumbnails (localStorage) | ${audit.counts.personal_thumbnails} |
| personal_thumbnail_index (localStorage) | ${audit.counts.personal_thumbnail_index} |
| personalThumbnailCollection (derived) | ${audit.counts.personalThumbnailCollection_derived} |
| Rendered DOM cards | ${audit.counts.renderedCards} |
| Placeholder cards | ${audit.counts.placeholders} |
| Feed personal thumbnails | ${audit.counts.feedPersonalThumbs} |
| UI heading | ${audit.counts.heading || '—'} |

---

## 4. First divergence

${audit.firstDivergence ? `**STOP — first mismatch:**

\`\`\`json
${JSON.stringify(audit.firstDivergence, null, 2)}
\`\`\`` : '**No count mismatch in pipeline** — rendered UI matches personal_thumbnail_index.'}

---

## 5. Exact file / function / line

| Responsibility | Location |
|----------------|----------|
| Render loop source | \`VaultExperience.svelte:1285\` — \`{#each ($personalThumbnailCollection ?? []).filter(Boolean)}\` |
| Heading count | \`VaultExperience.svelte:1235\` — \`{$personalThumbnailCollection.length}\` |
| Store definition | \`viewerContext.js:276\` — \`createPersistentStore(CONFIG.THUMBNAIL_INDEX_KEY)\` |
| Index ← metadata sync | \`viewerContext.js:790\` — \`personalThumbnailCollection.set(normalizedThumbs.map(fileName))\` |
| Placeholder branch | \`VaultExperience.svelte:1310-1311\` — \`{:else} div.placeholder\` when \`!isImage(reel) \|\| !reel.url\` |
| Dynamic placeholder on 404 | \`vaultUtils.js:166-170\` — \`handleVaultMediaError\` injects \`.placeholder\` |
| Metadata lookup | \`vaultUtils.js:237\` — \`getVaultImageReel\` |

**Rendered cards originate from:** \`personalThumbnailCollection\` backed by \`personal_thumbnail_index\` localStorage, **not** directly from backend catalog or feed.

---

## 6. Duplication source checklist

${['personal_thumbnails', 'personal_thumbnail_index', 'viewerContext', 'bootstrap merge', 'demo data', 'placeholder generator', 'derived store', 'cached collection', 'another source']
  .map((s) => {
    const hit =
      (s === 'personal_thumbnails' && audit.counts.personal_thumbnails > 0) ||
      (s === 'personal_thumbnail_index' && audit.counts.personal_thumbnail_index > 0) ||
      (s === 'viewerContext' && audit.counts.personal_thumbnail_index > 0) ||
      (s === 'bootstrap merge' && audit.vaultLogs.some((l) => l.tag === '[VAULT_BOOTSTRAP]')) ||
      (s === 'demo data' && false) ||
      (s === 'placeholder generator' && audit.counts.placeholders > 0) ||
      (s === 'derived store' && audit.counts.personal_thumbnail_index > 0) ||
      (s === 'cached collection' && audit.counts.personal_thumbnail_index > 0);
    return `- [${hit ? 'x' : ' '}] ${s}`;
  })
  .join('\n')}

---

## 7. Per-card forensic report

${audit.cards.map(cardReport).join('\n')}

---

## 8. Store dumps (summary)

### personal_thumbnail_index (${audit.stores.personal_thumbnail_index?.length ?? 0})

\`\`\`json
${JSON.stringify(audit.stores.personal_thumbnail_index, null, 2)}
\`\`\`

### personal_thumbnails (${audit.stores.personal_thumbnails?.length ?? 0})

\`\`\`json
${JSON.stringify(audit.stores.personal_thumbnails, null, 2)}
\`\`\`

---

## 9. Instrumentation log sample

\`\`\`json
${JSON.stringify(audit.vaultLogs.slice(-40), null, 2)}
\`\`\`

---

## 10. Placeholder analysis

${audit.cards
  .filter((c) => c.placeholder)
  .map(
    (c) =>
      `- Card ${c.renderIndex}: placeholder=${c.placeholder}, id=${c.id || 'none'}, fileName=${c.fileName || 'none'}, backend=${c.backendExists}, disk=${c.diskExists}, orphaned=${c.orphaned}`
  )
  .join('\n') || 'No placeholder cards in vault grid.'}

**Placeholder creation paths:**
1. **Template** (\`VaultExperience.svelte:1310\`) — \`getVaultImageReel\` returns empty url or non-image
2. **Error handler** (\`vaultUtils.js:166\`) — image 404 triggers dynamic \`.placeholder\` insertion

---

Audit command: \`node scripts/mission-5.7.5-render-audit.mjs\`
`;

writeFileSync(OUT, md);
console.log(`Audit written: ${OUT}`);
console.log(JSON.stringify(audit.counts, null, 2));
if (audit.firstDivergence) console.log('FIRST DIVERGENCE:', JSON.stringify(audit.firstDivergence));
