#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PANEL_PATH = join(ROOT, 'src/components/studio/HeroManagerPanel.svelte');
const INTEL_PATH = join(ROOT, 'src/lib/hero/heroIntelligence.js');
const REPORT_PATH = join(ROOT, 'hero-manager-menu-validation-report.json');

const panel = readFileSync(PANEL_PATH, 'utf8');
const intel = readFileSync(INTEL_PATH, 'utf8');

const checks = {
  heroType: {
    uiControlPresent: /data-hero-manager-type[\s\S]*bind:value=\{config\.heroType\}[\s\S]*on:change=\{applyConfig\}/.test(panel),
    configDefaultPresent: /heroType:\s*'[^']+'/.test(intel),
    updatePathPresent: /updateHeroManagerConfig\(patch,\s*feed/.test(intel)
  },
  backgroundSource: {
    uiControlPresent: /data-hero-manager-background-source[\s\S]*bind:value=\{config\.backgroundSource\}[\s\S]*on:change=\{applyConfig\}/.test(panel),
    configDefaultPresent: /backgroundSource:\s*'selection'/.test(intel),
    applyPathPresent: /config\.backgroundSource === 'custom_video'[\s\S]*config\.backgroundSource === 'custom_image'/.test(intel)
  },
  backgroundStyle: {
    uiControlPresent: /data-hero-manager-background-style[\s\S]*bind:value=\{config\.backgroundStyle\}[\s\S]*on:change=\{applyConfig\}/.test(panel),
    configDefaultPresent: /backgroundStyle:\s*'video'/.test(intel),
    presentationPathPresent: /resolveHeroBackgroundPresentation[\s\S]*backgroundStyle/.test(intel)
  },
  vaultHeroAsset: {
    uiControlPresent: /data-hero-manager-background-asset[\s\S]*bind:value=\{config\.heroAssetId\}[\s\S]*on:change=\{handleHeroAssetChange\}/.test(panel),
    handlerPresent: /function handleHeroAssetChange\(\)\s*\{[\s\S]*backgroundSource:\s*isVideoHeroAssetType/.test(panel),
    persistencePathPresent: /heroAssetId:\s*String\(sanitized\.heroAssetId \|\| ''\)\.trim\(\)/.test(intel)
  },
  autoRotate: {
    uiControlPresent: /data-hero-manager-auto-rotate[\s\S]*bind:checked=\{config\.autoRotate\}[\s\S]*on:change=\{applyConfig\}/.test(panel),
    rotationTimerPathPresent: /if \(config\.autoRotate\)\s*\{[\s\S]*startHeroRotation/.test(intel),
    stopPathPresent: /else\s*\{[\s\S]*stopHeroRotation\(\)/.test(intel)
  },
  carouselAutoplay: {
    uiControlPresent: /data-hero-manager-autoplay[\s\S]*bind:checked=\{config\.autoplayEnabled\}[\s\S]*on:change=\{applyConfig\}/.test(panel),
    defaultPresent: /autoplayEnabled:\s*true/.test(intel),
    consumePathPresent: /autoplayEnabled:\s*config\.autoplayEnabled !== false/.test(intel)
  },
  rotateEverySec: {
    uiControlPresent: /data-hero-manager-rotate-interval[\s\S]*config\.rotateIntervalMs[\s\S]*on:change=\{\(event\)\s*=>\s*\{[\s\S]*Math\.max\(10_000,\s*Number\(event\.currentTarget\.value\)\s*\*\s*1000/.test(panel),
    defaultPresent: /rotateIntervalMs:\s*30_000/.test(intel),
    runtimeUsePresent: /intervalMs:\s*config\.rotateIntervalMs/.test(intel)
  },
  carouselDurationSec: {
    uiControlPresent: /data-hero-manager-carousel-duration[\s\S]*config\.carouselDurationMs[\s\S]*Math\.max\(3000,\s*Number\(event\.currentTarget\.value\)\s*\*\s*1000/.test(panel),
    defaultPresent: /carouselDurationMs:\s*8000/.test(intel),
    runtimeUsePresent: /defaultDurationMs = Math\.max\(2500,\s*Number\(config\.carouselDurationMs\)/.test(intel)
  },
  carouselPriority: {
    uiControlPresent: /data-hero-manager-carousel-priority[\s\S]*bind:value=\{config\.carouselPriority\}[\s\S]*on:change=\{applyConfig\}/.test(panel),
    defaultPresent: /carouselPriority:\s*'video'/.test(intel),
    rankingUsePresent: /priority:\s*config\.carouselPriority/.test(intel)
  },
  transitionStyle: {
    uiControlPresent: /data-hero-manager-transition-style[\s\S]*bind:value=\{config\.carouselTransitionStyle\}[\s\S]*on:change=\{applyConfig\}/.test(panel),
    defaultPresent: /carouselTransitionStyle:\s*'fade'/.test(intel),
    runtimeUsePresent: /transitionStyle:\s*config\.carouselTransitionStyle/.test(intel)
  }
};

const score = Object.values(checks).reduce(
  (acc, section) => {
    const values = Object.values(section);
    acc.total += values.length;
    acc.passed += values.filter(Boolean).length;
    return acc;
  },
  { passed: 0, total: 0 }
);

const report = {
  generatedAt: new Date().toISOString(),
  checks,
  passRate: score.total > 0 ? Number((score.passed / score.total).toFixed(4)) : 0,
  passedChecks: score.passed,
  totalChecks: score.total,
  allMenuLogicChecksPass: score.passed === score.total,
  completionToken: score.passed === score.total
    ? 'HERO_MANAGER_MENU_LOGIC_VALIDATED=true'
    : 'HERO_MANAGER_MENU_LOGIC_VALIDATED=false'
};

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(report.completionToken);
