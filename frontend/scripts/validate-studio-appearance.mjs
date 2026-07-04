#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const FRONTEND = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';

const PROFILE_IDS = [
    'creator-dark',
    'creator-light',
    'cinematic',
    'command-center',
    'neon-studio'
];

const DENSITY_IDS = ['compact', 'comfortable', 'spacious'];
const FONT_SCALES = ['small', 'normal', 'large'];
const STORAGE_KEY = 'reelforge_studio_appearance';

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

const enginePath = join(SRC, 'lib/studio/studioAppearanceEngine.js');
const panelPath = join(SRC, 'components/studio/StudioAppearancePanel.svelte');

assert('studioAppearanceEngine.js exists', existsSync(enginePath));
assert('StudioAppearancePanel.svelte exists', existsSync(panelPath));

const engineSrc = readFileSync(enginePath, 'utf8');
const panelSrc = readFileSync(panelPath, 'utf8');

assert('engine defines appearance profiles', engineSrc.includes('APPEARANCE_PROFILES'));
assert('engine persists reelforge_studio_appearance', engineSrc.includes(STORAGE_KEY));
assert('engine logs APPEARANCE_THEME', engineSrc.includes('[APPEARANCE_THEME]') || engineSrc.includes("'APPEARANCE_THEME'"));
assert('engine logs APPEARANCE_DENSITY', engineSrc.includes("'APPEARANCE_DENSITY'"));
assert('engine logs APPEARANCE_ACCESSIBILITY', engineSrc.includes("'APPEARANCE_ACCESSIBILITY'"));
assert('panel exposes theme controls', panelSrc.includes('data-studio-appearance-theme'));
assert('panel exposes density controls', panelSrc.includes('data-studio-appearance-density'));
assert('panel exposes accessibility controls', panelSrc.includes('data-studio-appearance-accessibility'));

const browser = await chromium.launch({
    headless: true,
    executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'
});

const page = await browser.newPage();
const logs = [];

page.on('console', (msg) => {
    const text = msg.text();
    if (
        text.includes('[APPEARANCE_THEME]') ||
        text.includes('[APPEARANCE_DENSITY]') ||
        text.includes('[APPEARANCE_ACCESSIBILITY]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_studio_workspace_tab', 'System');
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('reelforge_studio_theme');
});

await page.goto(`${FRONTEND}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.click('.ghost-trigger');
await page.waitForSelector('.control-center-container', { timeout: 15000 });
await page.waitForTimeout(600);

assert(
    'appearance engine hook initialized',
    await page.evaluate(() => Boolean(window.__reelforgeStudioAppearanceEngine))
);

const profiles = await page.evaluate(() => window.__reelforgeStudioAppearanceEngine.APPEARANCE_PROFILES);
assert('appearance catalog has 5 profiles', Array.isArray(profiles) && profiles.length === 5);
assert(
    'catalog includes required profiles',
    PROFILE_IDS.every((id) => profiles.some((profile) => profile.id === id))
);

await page.click('[data-workspace-tab="system"], [data-command-section="system"]');
await page.waitForSelector('[data-studio-appearance-panel]', { timeout: 15000 });
await page.waitForTimeout(400);

assert('appearance panel renders', await page.locator('[data-studio-appearance-panel]').isVisible());
assert(
    'profile cards render',
    (await page.locator('[data-studio-appearance-profile]').count()) === 5
);

const themeLogs = parseDiagLogs(logs, 'APPEARANCE_THEME');
assert('APPEARANCE_THEME emitted on init', themeLogs.some((entry) => entry.themeId === 'creator-dark'));

const defaultTheme = await page.evaluate(() =>
    document.querySelector('.control-center-container')?.getAttribute('data-studio-theme')
);
assert('default profile applied to studio shell', defaultTheme === 'creator-dark');

const defaultDensity = await page.evaluate(() =>
    document.querySelector('.control-center-container')?.getAttribute('data-studio-density')
);
assert('default density applied', defaultDensity === 'comfortable');

for (const profileId of PROFILE_IDS) {
    await page.click(`[data-studio-appearance-profile="${profileId}"]`);
    await page.waitForTimeout(350);

    const applied = await page.evaluate(() =>
        document.querySelector('.control-center-container')?.getAttribute('data-studio-theme')
    );
    assert(`instant switch applies ${profileId}`, applied === profileId);

    const stored = await page.evaluate((key) => {
        try {
            return JSON.parse(localStorage.getItem(key) || '{}').theme;
        } catch {
            return null;
        }
    }, STORAGE_KEY);
    assert(`${profileId} persisted in ${STORAGE_KEY}`, stored === profileId);
}

assert(
    'APPEARANCE_THEME emitted for profile switches',
    parseDiagLogs(logs, 'APPEARANCE_THEME').length >= PROFILE_IDS.length
);

for (const density of DENSITY_IDS) {
    await page.selectOption('[data-studio-appearance-density] select', density);
    await page.waitForTimeout(300);

    const applied = await page.evaluate(() =>
        document.querySelector('.control-center-container')?.getAttribute('data-studio-density')
    );
    assert(`density ${density} applied`, applied === density);
}

assert(
    'APPEARANCE_DENSITY emitted',
    parseDiagLogs(logs, 'APPEARANCE_DENSITY').length >= DENSITY_IDS.length
);

for (const fontScale of FONT_SCALES) {
    await page.selectOption('[data-studio-appearance-font-scale] select', fontScale);
    await page.waitForTimeout(250);

    const applied = await page.evaluate(() =>
        document.querySelector('.control-center-container')?.getAttribute('data-studio-font-scale')
    );
    assert(`font scale ${fontScale} applied`, applied === fontScale);
}

await page.check('[data-studio-color-blind-safe] input');
await page.waitForTimeout(250);
assert(
    'color blind safe mode applied',
    await page.evaluate(() =>
        document.querySelector('.control-center-container')?.hasAttribute('data-studio-color-blind-safe')
    )
);

await page.check('[data-studio-reduced-motion] input');
await page.waitForTimeout(250);
assert(
    'reduced motion applied',
    await page.evaluate(() =>
        document.querySelector('.control-center-container')?.hasAttribute('data-studio-reduced-motion')
    )
);

await page.check('[data-studio-focus-mode] input');
await page.waitForTimeout(250);
assert(
    'focus mode applied',
    await page.evaluate(() =>
        document.querySelector('.control-center-container')?.hasAttribute('data-studio-focus-mode')
    )
);

const contrastScore = await page.evaluate(() =>
    document.querySelector('.control-center-container')?.getAttribute('data-studio-contrast-score')
);
assert('contrast score attribute set', Boolean(contrastScore && Number(contrastScore) > 0));

const accessibilityLogs = parseDiagLogs(logs, 'APPEARANCE_ACCESSIBILITY');
assert('APPEARANCE_ACCESSIBILITY emitted', accessibilityLogs.length >= 1);
assert(
    'accessibility log includes contrast score',
    accessibilityLogs.some((entry) => typeof entry.contrastScore === 'number')
);

const mediaExempt = await page.evaluate(() => {
    const viewerHero = document.querySelector('main .hero-stage[data-viewer-media-exempt]');
    const status = window.__reelforgeStudioAppearanceEngine?.getStudioAppearanceStatus?.();
    return Boolean(viewerHero && status?.mediaExempt === true && status?.theaterSafe === true);
});
assert('theater-safe and media exempt contract', mediaExempt);

writeFileSync(
    join(ROOT, 'studio-appearance-report.json'),
    `${JSON.stringify(
        {
            profiles: PROFILE_IDS,
            densities: DENSITY_IDS,
            fontScales: FONT_SCALES,
            storageKey: STORAGE_KEY,
            diagnostics: {
                theme: parseDiagLogs(logs, 'APPEARANCE_THEME').length,
                density: parseDiagLogs(logs, 'APPEARANCE_DENSITY').length,
                accessibility: parseDiagLogs(logs, 'APPEARANCE_ACCESSIBILITY').length
            }
        },
        null,
        2
    )}\n`
);

await browser.close();

console.log('\n=== Studio Appearance Validation ===\n');
if (failed) {
    console.log('STUDIO_APPEARANCE_COMPLETE=false');
    process.exit(1);
}

console.log('STUDIO_APPEARANCE_COMPLETE=true');
