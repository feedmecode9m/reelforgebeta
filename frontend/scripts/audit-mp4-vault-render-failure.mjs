import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:4173';
const ROOT = process.cwd();
const INPUT_REPORT = path.join(ROOT, 'mp4-vault-truth-report.json');
const OUTPUT_REPORT = path.join(ROOT, 'mp4-vault-render-failure.json');

function normalizePath(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw, APP_URL);
    return u.pathname || '';
  } catch {
    return raw.split('?')[0];
  }
}

function readJsonSafe(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeAssetType(asset = {}) {
  const fileName = String(asset.fileName || '').toLowerCase();
  const url = String(asset.url || '').toLowerCase();
  if (fileName.endsWith('.mov') || url.includes('.mov')) return 'mov';
  if (fileName.endsWith('.mp4') || url.includes('.mp4')) return 'mp4';
  return 'video';
}

const truthRaw = await fs.readFile(INPUT_REPORT, 'utf8');
const truth = JSON.parse(truthRaw);
const vaultInventory = Array.isArray(truth.vaultInventory) ? truth.vaultInventory : [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const runtime = await page.evaluate(() => {
  const parse = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  };

  const personalVideoVault = parse('personal_video_vault', []);
  const adminMode = parse('admin_mode', false);
  const heroManager = parse('reelforge_hero_manager_config', {});
  const heroVideo = localStorage.getItem('reelforge_hero_video') || '';

  const controlCenterOverlay = document.querySelector('.control-center-overlay.smart-studio-overlay');
  const activeWorkspacePanel = document.querySelector('[data-studio-workspace-panel]');
  const activeWorkspaceSection = activeWorkspacePanel?.getAttribute('data-active-section') || '';

  const vaultHost = document.querySelector('.personal-studio-section[data-content-panel="assets"]');
  const videoVaultGrid = document.querySelector('.video-vault-grid');
  const vaultCards = [...document.querySelectorAll('.video-vault-grid .video-vault-item')];
  const visibleCards = vaultCards.filter((el) => {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  });

  const heroRegistry = typeof window.__reelforgeHeroIntelligence?.loadHeroVaultItems === 'function'
    ? window.__reelforgeHeroIntelligence.loadHeroVaultItems()
    : [];

  const heroManagerAssetId = String(heroManager?.heroAssetId || '').trim();
  const heroManagerBackgroundSource = String(heroManager?.backgroundSource || '').trim();

  return {
    localStorage: {
      adminMode: Boolean(adminMode),
      personalVideoVault,
      heroVideo,
      heroManagerAssetId,
      heroManagerBackgroundSource
    },
    dom: {
      controlCenterOpen: Boolean(controlCenterOverlay),
      activeWorkspaceSection,
      vaultHostMounted: Boolean(vaultHost),
      videoVaultGridMounted: Boolean(videoVaultGrid),
      renderedCardCount: vaultCards.length,
      visibleCardCount: visibleCards.length
    },
    heroRegistry
  };
});

await browser.close();

const heroDefaultVideoPath = '/videos/hero-background.mp4';
const nonHeroStoreEntries = (runtime.localStorage.personalVideoVault || []).filter(Boolean);
const nonHeroStoreByPath = new Map(
  nonHeroStoreEntries.map((item) => [normalizePath(item.url || item.video_url || ''), item])
);

const controlCenterGate = runtime.dom.controlCenterOpen;
const contentTabGate = runtime.dom.activeWorkspaceSection === 'Content';
const componentMounted = runtime.dom.vaultHostMounted && runtime.dom.videoVaultGridMounted;

const renderFilterAudit = vaultInventory.map((asset) => {
  const filePath = normalizePath(asset.filePath || asset.url || '');
  const inPersonalStore = nonHeroStoreByPath.has(filePath);
  const passesFilter = Boolean(inPersonalStore);
  return {
    assetId: asset.assetId,
    assetType: normalizeAssetType(asset),
    passesFilter
  };
});

const storeVsUi = vaultInventory.map((asset) => {
  const filePath = normalizePath(asset.filePath || asset.url || '');
  const existsInStore = nonHeroStoreByPath.has(filePath);
  const reachesRenderLoop = Boolean(componentMounted && controlCenterGate && contentTabGate && existsInStore);
  const rendersCard = Boolean(reachesRenderLoop && runtime.dom.renderedCardCount > 0);
  return {
    assetId: asset.assetId,
    filePath,
    existsInStore,
    reachesRenderLoop,
    rendersCard
  };
});

const heroRegistryPaths = new Set(
  (runtime.heroRegistry || [])
    .map((item) => normalizePath(item.url || item.videoUrl || item.mediaUrl || ''))
    .filter(Boolean)
);
const vaultPaths = new Set(vaultInventory.map((item) => normalizePath(item.filePath || item.url || '')).filter(Boolean));
const viewerStorePaths = new Set(
  nonHeroStoreEntries.map((item) => normalizePath(item.url || item.video_url || '')).filter(Boolean)
);

const heroOrphanAudit = {
  assetId: 'hero-background',
  filePath: heroDefaultVideoPath,
  existsInVault: vaultPaths.has(heroDefaultVideoPath),
  existsInRegistry: heroRegistryPaths.has(heroDefaultVideoPath),
  existsInHeroManager:
    runtime.localStorage.heroManagerAssetId === 'hero-background' ||
    normalizePath(runtime.localStorage.heroVideo) === heroDefaultVideoPath,
  existsInViewerStore: viewerStorePaths.has(heroDefaultVideoPath)
};

const conditionalBlocks = [
  {
    file: 'frontend/src/components/experiences/StudioExperience.svelte',
    condition: '{#if $controlCenterOpen}',
    effect: 'Smart Production Studio (and VaultExperience) not mounted when false'
  },
  {
    file: 'frontend/src/components/experiences/StudioExperience.svelte',
    condition: '{#if $adminMode}',
    effect: 'Studio inner command-center content hidden when false'
  },
  {
    file: 'frontend/src/components/studio/StudioWorkspaceLayout.svelte',
    condition: '{:else if activeTab === "Content"}',
    effect: 'Content slot (includes VaultExperience) only rendered on Content tab'
  },
  {
    file: 'frontend/src/components/experiences/VaultExperience.svelte',
    condition: '{#if $personalVideos.length > 0}',
    effect: 'Video vault grid not rendered when store length is zero'
  },
  {
    file: 'frontend/src/components/experiences/VaultExperience.svelte',
    condition: '{#each $personalVideos.filter(Boolean) as video, vi ...}',
    effect: 'Null/undefined store items are removed before card creation'
  },
  {
    file: 'frontend/src/components/experiences/VaultExperience.svelte',
    condition: '{#if video}',
    effect: 'Per-entry guard blocks card output for falsy entries'
  }
];

let renderFailureRootCause = 'Unknown';
if (!controlCenterGate) {
  renderFailureRootCause = 'Vault component not mounted because Smart Production Studio overlay is closed ($controlCenterOpen=false)';
} else if (!runtime.localStorage.adminMode) {
  renderFailureRootCause = 'Vault component blocked by admin gate ($adminMode=false)';
} else if (!contentTabGate) {
  renderFailureRootCause = `Vault component blocked by workspace tab gate (activeTab=${runtime.dom.activeWorkspaceSection || 'unknown'}, required=Content)`;
} else if (!componentMounted) {
  renderFailureRootCause = 'VaultExperience host not mounted in DOM';
} else if (runtime.dom.renderedCardCount === 0) {
  renderFailureRootCause = 'Render loop receives no eligible entries after store filtering';
} else {
  renderFailureRootCause = 'Cards render, but visibility is blocked by CSS/layout';
}

let orphanHeroSource = 'unknown';
if (heroOrphanAudit.existsInHeroManager && !heroOrphanAudit.existsInVault) {
  orphanHeroSource = 'viewer_default_hero_store';
} else if (heroOrphanAudit.existsInRegistry && !heroOrphanAudit.existsInVault) {
  orphanHeroSource = 'hero_registry_only';
}

const report = {
  generatedAt: new Date().toISOString(),
  knownTruth: {
    TOTAL_VAULT_ASSETS: vaultInventory.length,
    VISIBLE_VAULT_CARDS: truth.summary?.VISIBLE_VAULT_CARDS ?? null,
    MISSING_ASSET_ROOT_CAUSE: truth.summary?.MISSING_ASSET_ROOT_CAUSE ?? null
  },
  step1_component: {
    component: 'VaultExperience',
    file: 'frontend/src/components/experiences/VaultExperience.svelte',
    renderLoop: '{#each $personalVideos.filter(Boolean) as video, vi (...) }',
    storeSource: 'personalVideos store (backed by localStorage key personal_video_vault)'
  },
  step2_renderFilterAudit: renderFilterAudit,
  step3_conditionalBlocks: conditionalBlocks,
  step4_storeVsUi: storeVsUi,
  step5_heroOrphanAudit: heroOrphanAudit,
  step6_rootCause: {
    RENDER_FAILURE_ROOT_CAUSE: renderFailureRootCause
  },
  runtimeSnapshot: runtime,
  summary: {
    TOTAL_VAULT_ASSETS: vaultInventory.length,
    RENDER_LOOP_COUNT: storeVsUi.filter((row) => row.reachesRenderLoop).length,
    VISIBLE_CARDS: runtime.dom.visibleCardCount,
    RENDER_FAILURE_ROOT_CAUSE: renderFailureRootCause,
    ORPHAN_HERO_SOURCE: orphanHeroSource
  },
  completionToken: 'MP4_VAULT_RENDER_FORENSIC_COMPLETE=true'
};

await fs.writeFile(OUTPUT_REPORT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary, null, 2));
console.log('MP4_VAULT_RENDER_FORENSIC_COMPLETE=true');
