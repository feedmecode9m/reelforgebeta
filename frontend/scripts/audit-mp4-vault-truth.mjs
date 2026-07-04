import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4173';
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8080';
const REPO_ROOT = process.cwd();
const REPORT_PATH = path.join(REPO_ROOT, 'mp4-vault-truth-report.json');

const VIDEO_EXT = /\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i;

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function isVideoLike(input = {}) {
  const url = String(input.url || input.video_url || input.videoUrl || '').toLowerCase();
  const type = String(input.type || input.mime_type || input.mimeType || '').toLowerCase();
  const fileName = String(input.fileName || input.file_name || '').toLowerCase();
  return (
    type.startsWith('video/') ||
    url.includes('/videos/') ||
    VIDEO_EXT.test(url) ||
    VIDEO_EXT.test(fileName)
  );
}

function normalizePath(url = '') {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw, APP_URL);
    const pathname = parsed.pathname || '';
    if (pathname.startsWith('/videos/')) return pathname;
    if (pathname.startsWith('/thumbs/')) return pathname;
    return pathname;
  } catch {
    const clean = raw.split('?')[0];
    if (clean.includes('/videos/')) return `/${clean.split('/videos/').pop()}`.replace('//', '/videos/');
    if (clean.includes('/thumbs/')) return `/${clean.split('/thumbs/').pop()}`.replace('//', '/thumbs/');
    return clean.startsWith('/') ? clean : `/${clean}`;
  }
}

function fileNameFromPathLike(value = '') {
  const normalized = normalizePath(value);
  if (!normalized) return '';
  return normalized.split('/').pop() || '';
}

function canonicalAssetId(entry = {}) {
  return String(
    entry.assetId ||
      entry.id ||
      entry.reelId ||
      entry.fileName ||
      entry.file_name ||
      fileNameFromPathLike(entry.filePath || entry.url || entry.video_url || entry.videoUrl)
  ).trim();
}

function canonicalVideoPath(entry = {}) {
  const source = entry.filePath || entry.video_url || entry.videoUrl || entry.url || '';
  const p = normalizePath(source);
  if (p.startsWith('/videos/')) return p;
  if (VIDEO_EXT.test(p)) {
    const fileName = fileNameFromPathLike(p);
    return fileName ? `/videos/${fileName}` : p;
  }
  const fileName = String(entry.fileName || entry.file_name || '').trim();
  if (fileName && VIDEO_EXT.test(fileName)) return `/videos/${fileName}`;
  return '';
}

function makeAsset(entry = {}, source = '') {
  const filePath = canonicalVideoPath(entry);
  const fileName = String(entry.fileName || entry.file_name || fileNameFromPathLike(filePath || entry.url || '')).trim();
  return {
    assetId: canonicalAssetId(entry),
    title: String(entry.title || entry.name || entry.fileName || entry.file_name || '').trim(),
    fileName,
    filePath,
    url: String(entry.url || entry.video_url || entry.videoUrl || '').trim(),
    thumbnail: String(entry.thumbnail || entry.thumbnailUrl || entry.thumbnail_url || '').trim(),
    createdAt: String(entry.createdAt || entry.created_at || '').trim(),
    status: String(entry.status || '').trim(),
    source
  };
}

function dedupeByAssetId(entries) {
  const map = new Map();
  for (const entry of entries) {
    const id = entry.assetId || entry.filePath || entry.url;
    if (!id) continue;
    const existing = map.get(id);
    if (!existing) {
      map.set(id, { ...entry, source: [entry.source].filter(Boolean) });
      continue;
    }
    const mergedSources = new Set([...(existing.source || []), entry.source].filter(Boolean));
    map.set(id, {
      ...existing,
      title: existing.title || entry.title,
      fileName: existing.fileName || entry.fileName,
      filePath: existing.filePath || entry.filePath,
      url: existing.url || entry.url,
      thumbnail: existing.thumbnail || entry.thumbnail,
      createdAt: existing.createdAt || entry.createdAt,
      status: existing.status || entry.status,
      source: [...mergedSources]
    });
  }
  return [...map.values()];
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

function parseDbRows(raw) {
  const lines = String(raw || '').trim().split('\n').filter(Boolean);
  return lines.map((line) => {
    const [id, title, file_name, video_url, thumbnail_url, status, created_at, mime_type] = line.split('|');
    return {
      id,
      title,
      fileName: file_name,
      video_url,
      thumbnail_url,
      status,
      created_at,
      mime_type
    };
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);

const runtime = await page.evaluate(() => {
  const parse = (key, fallback = []) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  };

  const personalVideoVault = parse('personal_video_vault', []);
  const reelVault = parse('reel_vault', []);
  const heroConfig = parse('reelforge_hero_manager_config', {});
  const heroVideoStore = localStorage.getItem('reelforge_hero_video') || '';
  const heroImageStore = localStorage.getItem('reelforge_hero_image') || '';

  const heroIntel = window.__reelforgeHeroIntelligence || {};
  const heroVaultItems = typeof heroIntel.loadHeroVaultItems === 'function'
    ? heroIntel.loadHeroVaultItems()
    : [];
  const heroRegistry = typeof heroIntel.resolveHeroBackgroundPresentation === 'function' &&
    typeof heroIntel.loadHeroManagerConfig === 'function'
    ? [heroIntel.resolveHeroBackgroundPresentation(heroIntel.loadHeroManagerConfig())]
    : [];

  const cardNodes = [...document.querySelectorAll('.video-vault-grid .video-vault-item')];
  const visibleCardNodes = cardNodes.filter((el) => {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  });
  const visibleVaultCardMedia = visibleCardNodes.map((el) => {
    const video = el.querySelector('video');
    return {
      src: video?.currentSrc || video?.getAttribute('src') || '',
      poster: video?.getAttribute('poster') || '',
      label: el.querySelector('.thumbnail-label')?.textContent?.trim() || ''
    };
  });

  const heroVideoNodes = [...document.querySelectorAll('.hero-stage video, .hero-background video, video.hero-video-element')]
    .map((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        src: el.currentSrc || el.getAttribute('src') || '',
        poster: el.getAttribute('poster') || '',
        className: el.className || '',
        visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      };
    })
    .filter((node) => node.visible && node.src);

  return {
    personalVideoVault,
    reelVault,
    heroConfig,
    heroVideoStore,
    heroImageStore,
    heroVaultItems,
    heroRegistry,
    visibleVaultCardsCount: visibleCardNodes.length,
    visibleVaultCardMedia,
    heroVideoNodes
  };
});

await browser.close();

const apiReels = toArray(await fetchJson(`${BACKEND_URL}/api/reels`));
const mediaStorage = (await fetchJson(`${BACKEND_URL}/api/media/storage`)) || { videos: [], thumbnails: [] };
const dbRaw = execSync(
  'docker compose exec -T db psql -U user -d reelforge -Atc "SELECT id,title,file_name,video_url,thumbnail_url,status,created_at,mime_type FROM reels ORDER BY created_at DESC;"',
  { cwd: REPO_ROOT, encoding: 'utf8' }
);
const dbRows = parseDbRows(dbRaw);

const apiVideoAssets = apiReels.filter((row) => isVideoLike(row)).map((row) => makeAsset(row, 'database_api_reels'));
const dbVideoAssets = dbRows.filter((row) => isVideoLike(row)).map((row) => makeAsset(row, 'database_reels_table'));
const personalVideoAssets = toArray(runtime.personalVideoVault)
  .filter((row) => isVideoLike(row))
  .map((row) => makeAsset(row, 'personalVideos_store'));
const vaultStoreVideoAssets = toArray(runtime.reelVault)
  .filter((row) => isVideoLike(row))
  .map((row) => makeAsset(row, 'vault_store'));
const heroRegistryAssets = toArray(runtime.heroVaultItems)
  .filter((row) => isVideoLike(row))
  .map((row) => makeAsset(row, 'hero_registry'));
const storageVideoAssets = toArray(mediaStorage.videos)
  .filter((name) => VIDEO_EXT.test(String(name)))
  .map((name) =>
    makeAsset(
      {
        id: String(name).replace(/\.[^.]+$/, ''),
        title: String(name),
        fileName: String(name),
        url: `/videos/${name}`
      },
      'backend_public_videos'
    )
  );

const vaultInventory = dedupeByAssetId([
  ...apiVideoAssets,
  ...dbVideoAssets,
  ...personalVideoAssets,
  ...vaultStoreVideoAssets,
  ...heroRegistryAssets,
  ...storageVideoAssets
]);

const byPath = (items) => new Set(items.map((item) => canonicalVideoPath(item)).filter(Boolean));
const pathInStorage = byPath(storageVideoAssets);
const pathInDb = byPath(dbVideoAssets);
const pathInPersonal = byPath(personalVideoAssets);
const pathInVaultStore = byPath(vaultStoreVideoAssets);
const pathInHeroRegistry = byPath(heroRegistryAssets);

const storageTruth = vaultInventory.map((asset) => {
  const p = canonicalVideoPath(asset);
  return {
    assetId: asset.assetId,
    filePath: p,
    present: {
      backendPublicVideos: p ? pathInStorage.has(p) : false,
      databaseReelsTable: p ? pathInDb.has(p) : false,
      personalVideosStore: p ? pathInPersonal.has(p) : false,
      vaultStore: p ? pathInVaultStore.has(p) : false,
      heroRegistry: p ? pathInHeroRegistry.has(p) : false
    }
  };
});

const visibleUiPaths = new Set(
  toArray(runtime.visibleVaultCardMedia)
    .map((item) => normalizePath(item.src))
    .filter((p) => p.startsWith('/videos/'))
);

const cardVisibility = vaultInventory.map((asset) => {
  const p = canonicalVideoPath(asset);
  const truth = storageTruth.find((row) => row.assetId === asset.assetId);
  return {
    assetId: asset.assetId,
    filePath: p,
    storage: Boolean(truth?.present.backendPublicVideos || truth?.present.databaseReelsTable),
    store: Boolean(truth?.present.personalVideosStore || truth?.present.vaultStore),
    ui: p ? visibleUiPaths.has(p) : false
  };
});

const heroVideoNodes = toArray(runtime.heroVideoNodes).map((node) => ({
  ...node,
  filePath: normalizePath(node.src),
  assetId: fileNameFromPathLike(node.src).replace(/\.[^.]+$/, '')
}));

const heroRelationship = heroVideoNodes.map((heroNode) => {
  const matching = vaultInventory.filter(
    (asset) =>
      canonicalVideoPath(asset) === heroNode.filePath ||
      String(asset.assetId || '') === String(heroNode.assetId || '')
  );
  const duplicateHeroNodes = heroVideoNodes.filter((row) => row.filePath === heroNode.filePath);
  let status = 'MATCHED';
  if (matching.length === 0) status = 'ORPHANED';
  else if (duplicateHeroNodes.length > 1 || matching.length > 1) status = 'DUPLICATED';

  const sourceStore =
    matching[0]?.source?.[0] ||
    (storageTruth.find((row) => row.filePath === heroNode.filePath)?.present.heroRegistry
      ? 'hero_registry'
      : 'unknown');

  return {
    assetId: heroNode.assetId,
    filePath: heroNode.filePath,
    sourceStore,
    matchingVaultAsset: matching[0]?.assetId || null,
    status
  };
});

const duplicateByAssetId = {};
for (const asset of vaultInventory) {
  duplicateByAssetId[asset.assetId] = (duplicateByAssetId[asset.assetId] || 0) + 1;
}
const duplicatedVaultRecords = Object.values(duplicateByAssetId).some((count) => count > 1);
const duplicatedHeroRecords = heroRelationship.filter((row) => row.status === 'DUPLICATED').length > 0;
const orphanedHero = heroRelationship.some((row) => row.status === 'ORPHANED');
const stalePersistence = storageTruth.some(
  (row) =>
    (row.present.personalVideosStore || row.present.vaultStore) &&
    !row.present.databaseReelsTable &&
    !row.present.backendPublicVideos
);
const duplicateRenderers = heroVideoNodes.length > 1;

let duplicateOrigin = 'NONE_DETECTED';
if (duplicatedVaultRecords) duplicateOrigin = 'A) duplicate vault records';
else if (duplicatedHeroRecords) duplicateOrigin = 'B) duplicate Hero records';
else if (duplicateRenderers) duplicateOrigin = 'C) duplicate renderers';
else if (orphanedHero) duplicateOrigin = 'D) orphaned Hero asset';
else if (stalePersistence) duplicateOrigin = 'E) stale persistence';

const missingAssets = cardVisibility.filter((row) => !row.ui);
const dbByPath = new Map(dbVideoAssets.map((asset) => [canonicalVideoPath(asset), asset]));
const missingAssetDiagnostics = missingAssets.map((asset) => {
  const db = dbByPath.get(asset.filePath);
  let disappeared = 'render';
  if (!asset.storage) disappeared = 'storage';
  else if (!asset.store) disappeared = 'store';
  else if (db && String(db.status || '').toLowerCase() !== 'ready') disappeared = 'sync';
  else if (runtime.visibleVaultCardsCount === 0 && personalVideoAssets.length > 0) disappeared = 'render';
  return {
    assetId: asset.assetId,
    filePath: asset.filePath,
    disappeared
  };
});

let missingAssetRootCause = 'none';
if (runtime.visibleVaultCardsCount === 0 && personalVideoAssets.length > 0) {
  missingAssetRootCause = 'render';
} else if (
  dbVideoAssets.some(
    (asset) =>
      String(asset.status || '').toLowerCase() === 'processing' &&
      !pathInStorage.has(canonicalVideoPath(asset))
  )
) {
  missingAssetRootCause = 'sync';
} else if (missingAssetDiagnostics.some((row) => row.disappeared === 'render')) {
  missingAssetRootCause = 'render';
} else if (missingAssetDiagnostics.some((row) => row.disappeared === 'store')) {
  missingAssetRootCause = 'store';
} else if (missingAssetDiagnostics.some((row) => row.disappeared === 'storage')) {
  missingAssetRootCause = 'storage';
}

const visibleVaultCards = [
  {
    component: 'frontend/src/components/experiences/VaultExperience.svelte',
    renderLoop: "{#each $personalVideos.filter(Boolean) as video, vi (...) }",
    dataSource: '$personalVideos',
    visibleCardCount: runtime.visibleVaultCardsCount
  }
];

const report = {
  generatedAt: new Date().toISOString(),
  inputs: {
    appUrl: APP_URL,
    backendUrl: BACKEND_URL
  },
  vaultInventory,
  visibleVaultCards,
  storageTruth,
  heroRelationship,
  cardVisibility,
  duplicateAnalysis: {
    DUPLICATE_ORIGIN: duplicateOrigin
  },
  missingMp4Analysis: {
    missingAssets: missingAssetDiagnostics,
    MISSING_ASSET_ROOT_CAUSE: missingAssetRootCause
  },
  summary: {
    TOTAL_VAULT_ASSETS: vaultInventory.length,
    VISIBLE_VAULT_CARDS: runtime.visibleVaultCardsCount,
    HERO_VIDEO_ASSET_ID: heroRelationship[0]?.assetId || '',
    DUPLICATE_ORIGIN: duplicateOrigin,
    MISSING_ASSET_ROOT_CAUSE: missingAssetRootCause
  },
  completionToken: 'MP4_VAULT_TRUTH_COMPLETE=true'
};

await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary, null, 2));
console.log('MP4_VAULT_TRUTH_COMPLETE=true');
