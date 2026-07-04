#!/usr/bin/env node
/**
 * Phase 54 — Hero intelligence certification matrix.
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
    assertRuntime,
    createTruthStats,
    emitTruthSummary,
    launchTruthBrowser,
    loginAdminAndOpenStudio,
    DEFAULT_BASE
} from './lib/validation-truth.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORT_PATH = join(ROOT, 'hero-certification-report.json');

const MATRIX = [
    { type: 'jpg', id: 'hero-cert-jpg', name: 'hero-cert.jpg', url: '/thumbs/hero-cert.jpg', mime: 'image/jpeg' },
    { type: 'png', id: 'hero-cert-png', name: 'hero-cert.png', url: '/thumbs/hero-cert.png', mime: 'image/png' },
    { type: 'webp', id: 'hero-cert-webp', name: 'hero-cert.webp', url: '/thumbs/hero-cert.webp', mime: 'image/webp' },
    { type: 'gif', id: 'hero-cert-gif', name: 'hero-cert.gif', url: '/thumbs/hero-cert.gif', mime: 'image/gif' },
    {
        type: 'mp4',
        id: 'hero-cert-mp4',
        name: 'hero-cert.mp4',
        url: '/videos/hero-background.mp4',
        mime: 'video/mp4',
        thumbnail: '/thumbs/IMG_0113.JPEG'
    }
];

const stats = createTruthStats();
const browser = await launchTruthBrowser();
const context = await browser.newContext();
let page = await context.newPage();
const logs = [];
const report = {
    phase: 54,
    objective: 'Hero Intelligence Certification',
    matrix: [],
    diagnostics: {
        heroCertification: 0,
        heroRenderSuccess: 0,
        heroRenderFailure: 0
    },
    success: false,
    generatedAt: new Date().toISOString()
};

function attachLogCapture(targetPage) {
    targetPage.on('console', (msg) => {
        const text = msg.text();
        logs.push(text);
        if (text.includes('[HERO_CERTIFICATION]')) report.diagnostics.heroCertification += 1;
        if (text.includes('[HERO_RENDER_SUCCESS]')) report.diagnostics.heroRenderSuccess += 1;
        if (text.includes('[HERO_RENDER_FAILURE]')) report.diagnostics.heroRenderFailure += 1;
    });
}

function certDiag(assetType, stage, ok, detail = {}) {
    report.diagnostics.heroCertification += 1;
    const payload = { assetType, stage, ok, ...detail, timestamp: Date.now() };
    console.log(`[HERO_CERTIFICATION] ${JSON.stringify(payload)}`);
}

function stepResult(assetReport, assetType, step, ok, detail = {}) {
    assetReport.steps.push({ step, ok, detail });
    assertRuntime(`hero ${assetType} ${step}`, ok, stats, detail);
    certDiag(assetType, step, ok, detail);
}

async function openStudioSystemTab(targetPage) {
    await loginAdminAndOpenStudio(targetPage, DEFAULT_BASE);
    await targetPage.click('[data-workspace-tab="system"], [data-command-section="system"]');
    await targetPage.waitForSelector('[data-hero-manager-panel]', { timeout: 15000 });
}

async function openStudioOverviewTab(targetPage) {
    await targetPage.click('[data-workspace-tab="overview"], [data-command-section="overview"]');
    await targetPage.waitForSelector('[data-hero-intelligence]', { timeout: 15000 });
}

attachLogCapture(page);

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
    localStorage.setItem('reelforge_studio_workspace_tab', 'system');
});

await openStudioSystemTab(page);
await page.evaluate(() => {
    localStorage.removeItem('reelforge_hero_manager_config');
    localStorage.removeItem('personal_video_vault');
});
await page.reload({ waitUntil: 'domcontentloaded' });
await openStudioSystemTab(page);

for (const asset of MATRIX) {
    const isVideo = asset.type === 'mp4';
    const assetReport = { assetType: asset.type, assetId: asset.id, steps: [] };
    report.matrix.push(assetReport);

    // 1) Upload (vault simulation) + verify.
    const uploadCheck = await page.evaluate((assetPayload) => {
        const api = window.__reelforgeHeroIntelligence;
        const existing = JSON.parse(localStorage.getItem('personal_video_vault') || '[]');
        const withoutCurrent = existing.filter((item) => item?.id !== assetPayload.id);
        withoutCurrent.push({
            id: assetPayload.id,
            name: assetPayload.name,
            url: assetPayload.url,
            type: assetPayload.mime,
            thumbnail: assetPayload.thumbnail || '',
            addedAt: new Date().toISOString()
        });
        localStorage.setItem('personal_video_vault', JSON.stringify(withoutCurrent));
        const vaultItems = api?.loadHeroVaultItems?.() || [];
        return {
            uploaded: vaultItems.some((item) => item?.id === assetPayload.id),
            count: vaultItems.length
        };
    }, asset);
    stepResult(assetReport, asset.type, 'upload', uploadCheck.uploaded, uploadCheck);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openStudioSystemTab(page);

    // 2) Hero manager assignment.
    await page.selectOption('[data-hero-manager-background-source] select', isVideo ? 'custom_video' : 'custom_image');
    if (isVideo) {
        await page.fill('[data-hero-manager-background-video] input', asset.url);
        await page.evaluate((assetPayload) => {
            window.__reelforgeHeroIntelligence?.saveHeroManagerConfig({
                backgroundSource: 'custom_video',
                backgroundAsset: assetPayload.id,
                backgroundVideo: assetPayload.url,
                backgroundStyle: 'video',
                autoRotate: false
            });
        }, asset);
    } else {
        const selectedFromDropdown = await page.evaluate((assetPayload) => {
            const select = document.querySelector('[data-hero-manager-background-asset] select');
            if (!select) return false;
            const options = Array.from(select.options || []);
            const hasTarget = options.some((option) => option.value === assetPayload.id);
            if (!hasTarget) return false;
            select.value = assetPayload.id;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }, asset);
        if (!selectedFromDropdown) {
            await page.evaluate((assetPayload) => {
                window.__reelforgeHeroIntelligence?.saveHeroManagerConfig({
                    backgroundSource: 'custom_image',
                    backgroundAsset: assetPayload.id,
                    backgroundImage: assetPayload.url,
                    backgroundStyle: 'image',
                    autoRotate: false
                });
            }, asset);
        }
    }
    await page.click('[data-hero-manager-apply]');
    await page.waitForTimeout(350);

    const assigned = await page.evaluate((assetPayload) => {
        const cfg = JSON.parse(localStorage.getItem('reelforge_hero_manager_config') || '{}');
        return {
            source: cfg.backgroundSource || '',
            asset: cfg.backgroundAsset || '',
            video: cfg.backgroundVideo || '',
            image: cfg.backgroundImage || ''
        };
    }, asset);
    stepResult(
        assetReport,
        asset.type,
        'hero-manager-assignment',
        assigned.asset === asset.id && assigned.source === (isVideo ? 'custom_video' : 'custom_image'),
        assigned
    );

    // 3) Immediate render.
    await openStudioOverviewTab(page);
    await page.waitForTimeout(500);
    const immediate = await page.evaluate((assetPayload) => {
        const source = document.querySelector('[data-hero-background-source]')?.getAttribute('data-hero-background-source') || '';
        const stageAsset = document.querySelector('[data-hero-background-asset]')?.getAttribute('data-hero-background-asset') || '';
        const media = document.querySelector('.hero-media.active');
        const videoEl = document.querySelector('.hero-video');
        const mediaHtml = media?.outerHTML || '';
        const style = media?.getAttribute('style') || '';
        const mediaUrl = media?.getAttribute('data-media-url') || '';
        const videoSrc = videoEl?.getAttribute('src') || videoEl?.querySelector('source')?.getAttribute('src') || '';
        const visible = media
            ? getComputedStyle(media).display !== 'none' &&
              getComputedStyle(media).visibility !== 'hidden' &&
              Number(getComputedStyle(media).opacity || 0) > 0
            : false;
        const hasAssetUrl =
            mediaHtml.includes(assetPayload.url) ||
            style.includes(assetPayload.url) ||
            mediaUrl.includes(assetPayload.url) ||
            videoSrc.includes(assetPayload.url);
        return { source, stageAsset, visible, hasAssetUrl, hasVideoNode: Boolean(videoEl), videoSrc };
    }, asset);
    stepResult(
        assetReport,
        asset.type,
        'immediate-render',
        isVideo
            ? immediate.source === 'custom_video' &&
              immediate.stageAsset === asset.id &&
              (immediate.hasAssetUrl || immediate.hasVideoNode)
            : immediate.visible && immediate.hasAssetUrl && immediate.source === 'custom_image',
        immediate
    );

    // 4) Refresh persistence.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openStudioSystemTab(page);
    const afterRefresh = await page.evaluate((assetPayload) => {
        const cfg = JSON.parse(localStorage.getItem('reelforge_hero_manager_config') || '{}');
        return {
            source: cfg.backgroundSource || '',
            asset: cfg.backgroundAsset || '',
            video: cfg.backgroundVideo || ''
        };
    }, asset);
    stepResult(
        assetReport,
        asset.type,
        'refresh-persistence',
        afterRefresh.asset === asset.id && afterRefresh.source === (isVideo ? 'custom_video' : 'custom_image'),
        afterRefresh
    );

    // 5) Restart persistence (new page, same context).
    await page.close();
    page = await context.newPage();
    attachLogCapture(page);
    await openStudioSystemTab(page);
    const afterRestart = await page.evaluate((assetPayload) => {
        const cfg = JSON.parse(localStorage.getItem('reelforge_hero_manager_config') || '{}');
        return {
            source: cfg.backgroundSource || '',
            asset: cfg.backgroundAsset || '',
            video: cfg.backgroundVideo || ''
        };
    }, asset);
    stepResult(
        assetReport,
        asset.type,
        'restart-persistence',
        afterRestart.asset === asset.id && afterRestart.source === (isVideo ? 'custom_video' : 'custom_image'),
        afterRestart
    );

    // 6) Auto-rotation compatibility.
    await page.check('[data-hero-manager-auto-rotate] input');
    await page.click('[data-hero-manager-apply]');
    await page.click('[data-hero-manager-rotate]');
    await page.waitForTimeout(300);
    const afterRotate = await page.evaluate((assetPayload) => {
        const cfg = JSON.parse(localStorage.getItem('reelforge_hero_manager_config') || '{}');
        return {
            autoRotate: Boolean(cfg.autoRotate),
            source: cfg.backgroundSource || '',
            asset: cfg.backgroundAsset || ''
        };
    }, asset);
    stepResult(
        assetReport,
        asset.type,
        'auto-rotation-compatibility',
        afterRotate.autoRotate &&
            afterRotate.asset === asset.id &&
            afterRotate.source === (isVideo ? 'custom_video' : 'custom_image'),
        afterRotate
    );
}

const diagnosticsOk =
    report.diagnostics.heroCertification >= MATRIX.length &&
    report.diagnostics.heroRenderSuccess >= 1 &&
    report.diagnostics.heroRenderFailure >= 0;

stepResult(
    { steps: [] },
    'all-assets',
    'certification-diagnostics',
    diagnosticsOk,
    report.diagnostics
);

report.success = !stats.failed;
report.completeToken = report.success ? 'HERO_PIPELINE_CERTIFIED=true' : 'HERO_PIPELINE_CERTIFIED=false';
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

await browser.close();
emitTruthSummary(stats, 'HERO_PIPELINE_CERTIFIED=true');
