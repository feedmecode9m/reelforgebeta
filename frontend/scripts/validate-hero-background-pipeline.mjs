import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const FRONTEND = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';

const TEST_VAULT = [
    {
        id: 'hero-vault-jpg',
        name: 'hero-test.jpg',
        url: '/thumbs/hero-test.jpg',
        type: 'image/jpeg',
        addedAt: new Date().toISOString()
    },
    {
        id: 'hero-vault-png',
        name: 'hero-test.png',
        url: '/thumbs/hero-test.png',
        type: 'image/png',
        addedAt: new Date().toISOString()
    },
    {
        id: 'hero-vault-webp',
        name: 'hero-test.webp',
        url: '/thumbs/hero-test.webp',
        type: 'image/webp',
        addedAt: new Date().toISOString()
    },
    {
        id: 'hero-vault-gif',
        name: 'hero-test.gif',
        url: '/thumbs/hero-test.gif',
        type: 'image/gif',
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

let failed = false;

function assert(name, ok) {
    if (!ok) {
        failed = true;
        console.log(`FAIL: ${name}`);
    } else {
        console.log(`PASS: ${name}`);
    }
}

function parseDiagLogs(logs, tag) {
    return logs
        .map((line) => {
            const match = line.match(new RegExp(`\\[${tag}\\]\\s*(\\{.*\\})`));
            if (!match) return null;
            try {
                return JSON.parse(match[1]);
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

const enginePath = join(SRC, 'lib/hero/heroIntelligence.js');
const heroExperiencePath = join(SRC, 'components/experiences/HeroExperience.svelte');
const viewerContextPath = join(SRC, 'viewer/viewerContext.js');
const engineSrc = readFileSync(enginePath, 'utf8');
const heroExperienceSrc = readFileSync(heroExperiencePath, 'utf8');
const viewerContextSrc = readFileSync(viewerContextPath, 'utf8');

assert('heroIntelligence.js exists', existsSync(enginePath));
assert('HeroExperience.svelte exists', existsSync(heroExperiencePath));
assert('viewerContext.js exists', existsSync(viewerContextPath));
assert('HERO_BACKGROUND_SAVE diagnostic', engineSrc.includes("logHeroIntelligenceDiag('HERO_BACKGROUND_SAVE'"));
assert('HERO_ASSET_RESOLVE diagnostic', engineSrc.includes("logHeroIntelligenceDiag('HERO_ASSET_RESOLVE'"));
assert('HERO_ASSET_TYPE diagnostic', engineSrc.includes("logHeroIntelligenceDiag('HERO_ASSET_TYPE'"));
assert('HERO_RENDER diagnostic', heroExperienceSrc.includes("logHeroIntelligenceDiag('HERO_RENDER'"));
assert('HERO_VISIBILITY diagnostic', heroExperienceSrc.includes("logHeroIntelligenceDiag('HERO_VISIBILITY'"));
assert('backgroundAsset config field', engineSrc.includes('backgroundAsset'));
assert('resolveHeroBackgroundAsset exported', engineSrc.includes('export function resolveHeroBackgroundAsset'));
assert('applyHeroManagerBackground exported', engineSrc.includes('export function applyHeroManagerBackground'));
assert('HeroExperience uses backgroundSource', heroExperienceSrc.includes('backgroundSource'));
assert('HeroExperience uses backgroundAsset', heroExperienceSrc.includes('backgroundAsset'));
assert('viewerContext listens for hero-manager-updated', viewerContextSrc.includes("'reelforge:hero-manager-updated'"));
assert('viewerContext applies manager background', viewerContextSrc.includes('applyHeroManagerBackground'));

const browser = await chromium.launch({
    headless: true,
    executablePath:
        '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'
});

const page = await browser.newPage();
const logs = [];

page.on('console', (msg) => {
    const text = msg.text();
    if (
        text.includes('[HERO_BACKGROUND_SAVE]') ||
        text.includes('[HERO_ASSET_RESOLVE]') ||
        text.includes('[HERO_RENDER]') ||
        text.includes('[HERO_VISIBILITY]') ||
        text.includes('[HERO_ASSET_TYPE]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(({ vaultItems }) => {
    localStorage.removeItem('reelforge_hero_video');
    localStorage.removeItem('reelforge_hero_image');
    localStorage.setItem('personal_video_vault', JSON.stringify(vaultItems));
    localStorage.setItem('personal_thumbnails', JSON.stringify([]));
    localStorage.setItem('admin_mode', 'true');
}, { vaultItems: TEST_VAULT });

await page.goto(`${FRONTEND}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('[data-hero-intelligence]', { timeout: 15000 });
await page.waitForTimeout(800);

const assetTypes = ['jpg', 'png', 'webp', 'gif', 'mp4'];
for (const assetType of assetTypes) {
    const asset = TEST_VAULT.find((item) => item.id.includes(assetType));
    const isVideo = assetType === 'mp4';
    const result = await page.evaluate(
        ({ assetId, source, style, videoUrl, imageUrl, vaultItems }) => {
            localStorage.setItem('personal_video_vault', JSON.stringify(vaultItems));
            const api = window.__reelforgeHeroIntelligence;
            const config = api.saveHeroManagerConfig({
                heroType: 'TRENDING',
                backgroundSource: source,
                backgroundAsset: assetId,
                backgroundVideo: videoUrl,
                backgroundImage: imageUrl,
                backgroundStyle: style,
                autoRotate: false
            });
            const resolved = api.resolveHeroBackgroundAsset(config, vaultItems);
            const applied = api.applyHeroManagerBackground(config, {
                setVideo: (url) => {
                    window.__heroTestVideo = url;
                },
                setPoster: (url) => {
                    window.__heroTestPoster = url;
                },
                setFailed: () => {}
            }, { vaultItems });
            return {
                config,
                resolved,
                applied,
                video: window.__heroTestVideo || '',
                poster: window.__heroTestPoster || '',
                vaultCount: vaultItems.length
            };
        },
        {
            assetId: asset.id,
            source: isVideo ? 'custom_video' : 'custom_image',
            style: isVideo ? 'video' : 'image',
            videoUrl: isVideo ? asset.url : '',
            imageUrl: isVideo ? '' : asset.url,
            vaultItems: TEST_VAULT
        }
    );

    assert(`${assetType} asset resolves`, result.resolved.assetType === assetType);
    assert(`${assetType} vault match`, result.resolved.vaultMatch === true);
    assert(`${assetType} background applied`, result.applied === true);
    assert(
        `${assetType} store updated`,
        isVideo ? result.video === asset.url : result.poster === asset.url
    );
}

assert('HERO_BACKGROUND_SAVE emitted', parseDiagLogs(logs, 'HERO_BACKGROUND_SAVE').length >= 1);
assert('HERO_ASSET_RESOLVE emitted', parseDiagLogs(logs, 'HERO_ASSET_RESOLVE').length >= 1);
assert('HERO_ASSET_TYPE emitted', parseDiagLogs(logs, 'HERO_ASSET_TYPE').length >= 1);

await page.evaluate(({ vaultItems }) => {
    localStorage.setItem('personal_video_vault', JSON.stringify(vaultItems));
    window.__reelforgeHeroIntelligence.saveHeroManagerConfig({
        backgroundSource: 'custom_image',
        backgroundAsset: 'hero-vault-png',
        backgroundImage: '/thumbs/hero-test.png',
        autoRotate: true,
        rotateIntervalMs: 10_000
    });
}, { vaultItems: TEST_VAULT });

await page.waitForTimeout(300);

const persisted = await page.evaluate(() => {
    const raw = localStorage.getItem('reelforge_hero_manager_config');
    return raw ? JSON.parse(raw) : null;
});
assert('manager config persisted', persisted?.backgroundAsset === 'hero-vault-png');
assert('manager config survives refresh source', persisted?.backgroundSource === 'custom_image');

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-hero-intelligence]', { timeout: 15000 });
await page.waitForTimeout(800);

const afterRefresh = await page.evaluate(() => ({
    config: JSON.parse(localStorage.getItem('reelforge_hero_manager_config') || '{}'),
    poster: document.querySelector('.hero-media.active')?.getAttribute('data-media-url') || '',
    source: document.querySelector('[data-hero-background-source]')?.getAttribute('data-hero-background-source'),
    asset: document.querySelector('[data-hero-background-asset]')?.getAttribute('data-hero-background-asset')
}));

assert('refresh keeps backgroundAsset', afterRefresh.config.backgroundAsset === 'hero-vault-png');
assert('refresh keeps custom_image source', afterRefresh.config.backgroundSource === 'custom_image');
assert('hero stage exposes background source', afterRefresh.source === 'custom_image');
assert('hero stage exposes background asset', afterRefresh.asset === 'hero-vault-png');

await page.evaluate(() => {
    window.__reelforgeHeroIntelligence.rotateHeroSelection({});
});
await page.waitForTimeout(200);

const afterRotation = await page.evaluate(() => JSON.parse(localStorage.getItem('reelforge_hero_manager_config') || '{}'));
assert('rotation preserves custom background source', afterRotation.backgroundSource === 'custom_image');
assert('rotation preserves background asset', afterRotation.backgroundAsset === 'hero-vault-png');

const visibilityLogs = parseDiagLogs(logs, 'HERO_VISIBILITY');
assert('HERO_VISIBILITY emitted', visibilityLogs.length >= 1);
assert(
    'visibility tracks hero-background',
    visibilityLogs.some((entry) => entry.selector === '.hero-background')
);

const renderLogs = parseDiagLogs(logs, 'HERO_RENDER');
assert('HERO_RENDER emitted', renderLogs.length >= 1);
assert(
    'render log includes backgroundAsset',
    renderLogs.some((entry) => entry.backgroundAsset === 'hero-vault-png')
);

await browser.close();

console.log('\n=== Hero Background Pipeline Validation ===\n');
if (failed) {
    console.log('HERO_BACKGROUND_PIPELINE_COMPLETE=false');
    process.exit(1);
}

console.log('HERO_BACKGROUND_PIPELINE_COMPLETE=true');
