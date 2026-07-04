#!/usr/bin/env node
/**
 * Phase 62C — Hero background truth validator (behavior-first).
 */
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
    assertRuntime,
    createTruthStats,
    emitTruthSummary,
    launchTruthBrowser,
    DEFAULT_BASE
} from './lib/validation-truth.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TRUTH_REPORT_PATH = join(ROOT, 'hero-background-truth-report.json');
const CERTIFICATION_PATH = join(ROOT, 'hero-background-certification.json');

const TEST_VAULT = [
    {
        id: 'hero-vault-png',
        name: 'hero-test.png',
        url: '/thumbs/hero-test.png',
        type: 'image/png',
        addedAt: new Date().toISOString()
    },
    {
        id: 'hero-vault-mp4',
        name: 'hero-test.mp4',
        url: '/videos/hero-test.mp4',
        thumbnail: '/thumbs/hero-test-poster.jpg',
        type: 'video/mp4',
        addedAt: new Date().toISOString()
    }
];

const SCENARIOS = [
    {
        id: 'custom-image',
        source: 'custom_image',
        style: 'image',
        assetId: 'hero-vault-png',
        imageUrl: '/thumbs/hero-test.png'
    },
    {
        id: 'custom-video',
        source: 'custom_video',
        style: 'video',
        assetId: 'hero-vault-mp4',
        videoUrl: '/videos/hero-test.mp4'
    }
];

const stats = createTruthStats();
const browser = await launchTruthBrowser();
const context = await browser.newContext();
const diagnostics = [];
const report = {
    phase: '62C',
    objective: 'Hero Background Truth Validator Repair',
    scenarios: [],
    diagnostics: {
        heroAssetResolveCount: 0,
        heroRenderCount: 0
    },
    outputs: {
        truthReportPath: TRUTH_REPORT_PATH,
        certificationPath: CERTIFICATION_PATH
    },
    success: false,
    completeToken: 'HERO_BACKGROUND_TRUTH_COMPLETE=false',
    generatedAt: new Date().toISOString()
};

/**
 * @param {import('playwright').Page} page
 */
function attachDiagnostics(page) {
    page.on('console', (msg) => {
        const line = msg.text();
        const assetResolveMatch = line.match(/\[HERO_ASSET_RESOLVE\]\s*(\{.*\})/);
        if (assetResolveMatch) {
            try {
                const payload = JSON.parse(assetResolveMatch[1]);
                diagnostics.push({ tag: 'HERO_ASSET_RESOLVE', payload });
                report.diagnostics.heroAssetResolveCount += 1;
            } catch {
                /* ignore malformed */
            }
        }
        const renderMatch = line.match(/\[HERO_RENDER\]\s*(\{.*\})/);
        if (renderMatch) {
            try {
                const payload = JSON.parse(renderMatch[1]);
                diagnostics.push({ tag: 'HERO_RENDER', payload });
                report.diagnostics.heroRenderCount += 1;
            } catch {
                /* ignore malformed */
            }
        }
    });
}

/**
 * @param {import('playwright').Page} page
 */
async function openHeroStage(page) {
    if (!page.url() || page.url() === 'about:blank') {
        await page.goto(`${DEFAULT_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await page.waitForSelector('[data-hero-intelligence]', { timeout: 20000 });
    await page.waitForFunction(() => window.__reelforgeHeroIntelligence, { timeout: 10000 });
}

/**
 * @param {import('playwright').Page} page
 */
async function readManagerConfig(page) {
    return page.evaluate(() => JSON.parse(localStorage.getItem('reelforge_hero_manager_config') || '{}'));
}

/**
 * @param {import('playwright').Page} page
 */
async function readHeroVisibility(page) {
    return page.evaluate(() => {
        const stage = document.querySelector('[data-hero-intelligence]');
        const source = document.querySelector('[data-hero-background-source]')?.getAttribute('data-hero-background-source') || '';
        const activeMedia = document.querySelector('.hero-media.active');
        const video = document.querySelector('.hero-video');
        const mediaRendererNode = stage?.querySelector('[data-media-renderer]');
        const activeMediaVisible = Boolean(activeMedia) && (() => {
            const s = getComputedStyle(activeMedia);
            return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || '0') > 0;
        })();
        const videoVisible = Boolean(video) && (() => {
            const s = getComputedStyle(video);
            return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || '0') > 0;
        })();
        const videoSrc =
            video?.getAttribute('src') ||
            video?.querySelector('source')?.getAttribute('src') ||
            '';
        return {
            source,
            hasStage: Boolean(stage),
            hasActiveMedia: Boolean(activeMedia),
            activeMediaVisible,
            hasVideoNode: Boolean(video),
            videoVisible,
            videoSrc,
            hasMediaRendererNode: Boolean(mediaRendererNode)
        };
    });
}

/**
 * @param {import('playwright').Page} page
 * @param {typeof SCENARIOS[number]} scenario
 */
async function applyScenario(page, scenario) {
    await page.evaluate(({ payload, vaultItems }) => {
        localStorage.setItem('personal_video_vault', JSON.stringify(vaultItems));
        const api = window.__reelforgeHeroIntelligence;
        api.saveHeroManagerConfig(payload);
    }, {
        vaultItems: TEST_VAULT,
        payload: {
            backgroundSource: scenario.source,
            backgroundStyle: scenario.style,
            backgroundAsset: scenario.assetId,
            backgroundImage: scenario.imageUrl || '',
            backgroundVideo: scenario.videoUrl || '',
            autoRotate: true
        }
    });
    await page.waitForTimeout(550);
}

/**
 * @param {typeof SCENARIOS[number]} scenario
 * @param {number} diagStartIndex
 */
function findScenarioDiagnostics(scenario, diagStartIndex) {
    const slice = diagnostics.slice(diagStartIndex);
    const resolve = slice.find((entry) => {
        if (entry.tag !== 'HERO_ASSET_RESOLVE') return false;
        const media = String(entry.payload.mediaUrl || '');
        if (scenario.source === 'custom_image') {
            return entry.payload.assetType === 'png' && /hero-test\.png/i.test(media);
        }
        return (entry.payload.assetType === 'mp4' || entry.payload.assetType === 'video') && /hero-test\.mp4/i.test(media);
    });
    const render = slice.find((entry) => {
        if (entry.tag !== 'HERO_RENDER') return false;
        if (entry.payload.backgroundSource !== scenario.source) return false;
        if (scenario.source === 'custom_image') return /hero-test\.png/i.test(String(entry.payload.imageUrl || ''));
        return /hero-test\.mp4/i.test(String(entry.payload.videoUrl || ''));
    });
    return { resolve, render };
}

let page = await context.newPage();
attachDiagnostics(page);

await page.addInitScript(({ vaultItems }) => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('personal_video_vault', JSON.stringify(vaultItems));
    localStorage.setItem('personal_thumbnails', JSON.stringify([]));
    localStorage.setItem('reelforge_studio_workspace_tab', 'system');
}, { vaultItems: TEST_VAULT });

await openHeroStage(page);
await page.evaluate(({ vaultItems }) => {
    localStorage.removeItem('reelforge_hero_video');
    localStorage.removeItem('reelforge_hero_image');
    localStorage.removeItem('reelforge_hero_manager_config');
    localStorage.setItem('personal_video_vault', JSON.stringify(vaultItems));
    localStorage.setItem('personal_thumbnails', JSON.stringify([]));
}, { vaultItems: TEST_VAULT });
await page.reload({ waitUntil: 'domcontentloaded' });
await openHeroStage(page);

for (const scenario of SCENARIOS) {
    const diagStartIndex = diagnostics.length;
    const scenarioResult = {
        scenario: scenario.id,
        checks: {
            A_HERO_MANAGER_SAVES_CONFIGURATION: false,
            B_CONFIGURATION_PERSISTS_AFTER_REFRESH: false,
            C_HERO_MEDIA_VISIBLE_IN_REGION: false,
            D_ASSET_RESOLVES_THROUGH_HERO_ASSET_RESOLVE: false,
            E_RENDER_DIAGNOSTICS_EMIT_HERO_RENDER: false,
            F_CUSTOM_BACKGROUND_SURVIVES_ROTATION: false,
            G_CUSTOM_BACKGROUND_SURVIVES_RELOAD: false
        },
        evidence: {}
    };

    await applyScenario(page, scenario);
    const savedConfig = await readManagerConfig(page);
    scenarioResult.evidence.savedConfig = savedConfig;
    scenarioResult.checks.A_HERO_MANAGER_SAVES_CONFIGURATION =
        savedConfig.backgroundSource === scenario.source &&
        (scenario.source === 'custom_image'
            ? savedConfig.backgroundAsset === scenario.assetId
            : /hero-test\.mp4/i.test(String(savedConfig.backgroundVideo || '')));

    await page.reload({ waitUntil: 'domcontentloaded' });
    await openHeroStage(page);
    const afterRefreshConfig = await readManagerConfig(page);
    scenarioResult.evidence.afterRefreshConfig = afterRefreshConfig;
    scenarioResult.checks.B_CONFIGURATION_PERSISTS_AFTER_REFRESH =
        afterRefreshConfig.backgroundSource === scenario.source &&
        (scenario.source === 'custom_image'
            ? afterRefreshConfig.backgroundAsset === scenario.assetId
            : /hero-test\.mp4/i.test(String(afterRefreshConfig.backgroundVideo || '')));

    await page.waitForTimeout(500);
    const visibility = await readHeroVisibility(page);
    scenarioResult.evidence.visibility = visibility;
    scenarioResult.checks.C_HERO_MEDIA_VISIBLE_IN_REGION =
        visibility.hasStage &&
        visibility.source === scenario.source &&
        visibility.hasMediaRendererNode &&
        (scenario.source === 'custom_image'
            ? visibility.hasActiveMedia && visibility.activeMediaVisible
            : visibility.hasActiveMedia || visibility.hasVideoNode || visibility.videoVisible);

    const diagnosticsFound = findScenarioDiagnostics(scenario, diagStartIndex);
    scenarioResult.evidence.diagnostics = {
        heroAssetResolve: diagnosticsFound.resolve || null,
        heroRender: diagnosticsFound.render || null
    };
    scenarioResult.checks.D_ASSET_RESOLVES_THROUGH_HERO_ASSET_RESOLVE = Boolean(diagnosticsFound.resolve);
    scenarioResult.checks.E_RENDER_DIAGNOSTICS_EMIT_HERO_RENDER = Boolean(diagnosticsFound.render);

    await page.evaluate(() => {
        window.__reelforgeHeroIntelligence.rotateHeroSelection([]);
    });
    await page.waitForTimeout(350);
    const afterRotateConfig = await readManagerConfig(page);
    scenarioResult.evidence.afterRotateConfig = afterRotateConfig;
    scenarioResult.checks.F_CUSTOM_BACKGROUND_SURVIVES_ROTATION =
        afterRotateConfig.backgroundSource === scenario.source &&
        (scenario.source === 'custom_image'
            ? afterRotateConfig.backgroundAsset === scenario.assetId
            : /hero-test\.mp4/i.test(String(afterRotateConfig.backgroundVideo || '')));

    await page.close();
    page = await context.newPage();
    attachDiagnostics(page);
    await openHeroStage(page);
    await page.waitForTimeout(450);
    const reloadConfig = await readManagerConfig(page);
    const reloadVisibility = await readHeroVisibility(page);
    scenarioResult.evidence.afterReload = {
        config: reloadConfig,
        visibility: reloadVisibility
    };
    scenarioResult.checks.G_CUSTOM_BACKGROUND_SURVIVES_RELOAD =
        reloadConfig.backgroundSource === scenario.source &&
        (scenario.source === 'custom_image'
            ? reloadConfig.backgroundAsset === scenario.assetId
            : /hero-test\.mp4/i.test(String(reloadConfig.backgroundVideo || ''))) &&
        reloadVisibility.source === scenario.source &&
        reloadVisibility.hasMediaRendererNode;

    report.scenarios.push(scenarioResult);
    for (const [checkName, ok] of Object.entries(scenarioResult.checks)) {
        assertRuntime(`[${scenario.id}] ${checkName}`, ok, stats, {
            scenario: scenario.id
        });
    }
}

report.success = !stats.failed;
report.completeToken = report.success
    ? 'HERO_BACKGROUND_TRUTH_COMPLETE=true'
    : 'HERO_BACKGROUND_TRUTH_COMPLETE=false';

const certification = {
    phase: '62C',
    certified: report.success,
    token: report.completeToken,
    requirements: {
        A: 'Hero Manager saves configuration',
        B: 'Configuration persists after refresh',
        C: 'Hero image/video is visible in hero region',
        D: 'Hero asset resolves through [HERO_ASSET_RESOLVE]',
        E: 'Hero render diagnostics emit [HERO_RENDER]',
        F: 'Custom background survives rotation',
        G: 'Custom background survives reload'
    },
    scenarios: report.scenarios.map((scenario) => ({
        scenario: scenario.scenario,
        allChecksPassed: Object.values(scenario.checks).every(Boolean),
        checks: scenario.checks
    })),
    generatedAt: new Date().toISOString()
};

writeFileSync(TRUTH_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(CERTIFICATION_PATH, `${JSON.stringify(certification, null, 2)}\n`, 'utf8');

await browser.close();
emitTruthSummary(stats, 'HERO_BACKGROUND_TRUTH_COMPLETE=true');
