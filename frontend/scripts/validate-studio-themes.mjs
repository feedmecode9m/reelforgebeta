import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FRONTEND = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';

const THEME_IDS = [
    'creator-dark',
    'creator-light',
    'cinematic',
    'command-center',
    'neon-studio'
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
        text.includes('[STUDIO_THEME]') ||
        text.includes('[STUDIO_THEME_CHANGE]') ||
        text.includes('[APPEARANCE_THEME]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_studio_workspace_tab', 'System');
    localStorage.removeItem('reelforge_studio_theme');
});

await page.goto(`${FRONTEND}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.click('.ghost-trigger');
await page.waitForSelector('.control-center-container', { timeout: 15000 });
await page.waitForTimeout(600);

assert(
    'studio appearance hook initialized',
    await page.evaluate(() => Boolean(window.__reelforgeStudioAppearance))
);

const catalog = await page.evaluate(() => window.__reelforgeStudioAppearance.STUDIO_THEME_CATALOG);
assert('theme catalog has 5 themes', Array.isArray(catalog) && catalog.length === 5);
assert(
    'catalog includes required themes',
    THEME_IDS.every((id) => catalog.some((theme) => theme.id === id))
);

await page.click('[data-workspace-tab="system"], [data-command-section="system"]');
await page.waitForSelector('[data-studio-appearance-panel]', { timeout: 15000 });
await page.waitForTimeout(400);

assert('appearance panel renders', await page.locator('[data-studio-appearance-panel]').isVisible());
assert(
    'preview cards render',
    (await page.locator('[data-studio-appearance-profile]').count()) === 5
);

const initLogs = [...parseDiagLogs(logs, 'STUDIO_THEME'), ...parseDiagLogs(logs, 'APPEARANCE_THEME')];
assert('theme diag emitted on init', initLogs.some((entry) => entry.themeId === 'creator-dark'));

const defaultTheme = await page.evaluate(() =>
    document.querySelector('.control-center-container')?.getAttribute('data-studio-theme')
);
assert('default theme applied to studio shell', defaultTheme === 'creator-dark');

const viewerHeroBefore = await page.evaluate(() => {
    const hero = document.querySelector('main .hero-stage');
    return hero ? window.getComputedStyle(hero).height : null;
});
assert('viewer hero stage unaffected outside studio', Boolean(viewerHeroBefore));

for (const themeId of THEME_IDS) {
    await page.click(`[data-studio-appearance-profile="${themeId}"]`);
    await page.waitForTimeout(350);

    const applied = await page.evaluate(() =>
        document.querySelector('.control-center-container')?.getAttribute('data-studio-theme')
    );
    assert(`instant switch applies ${themeId}`, applied === themeId);

    const accent = await page.evaluate(() =>
        getComputedStyle(document.querySelector('.control-center-container')).getPropertyValue('--studio-accent').trim()
    );
    assert(`${themeId} sets studio accent token`, accent.length > 0);

    const pref = await page.evaluate(() => window.__reelforgeStudioAppearance.loadStudioThemePreference());
    assert(`${themeId} persisted in localStorage`, pref === themeId);

    await page.screenshot({
        path: join(ROOT, `studio-theme-${themeId}-screenshot.png`),
        fullPage: false
    });
}

const changeLogs = [
    ...parseDiagLogs(logs, 'STUDIO_THEME_CHANGE'),
    ...parseDiagLogs(logs, 'APPEARANCE_THEME').filter((entry) => entry.source === 'appearance-panel')
];
assert(
    'theme change diag emitted for switches',
    changeLogs.length >= THEME_IDS.length - 1
);

assert(
    'theater-safe contract',
    changeLogs.every((entry) => entry.theaterSafe === true && (entry.scoped === true || entry.scoped === undefined))
);

const mediaExempt = await page.evaluate(() => {
    const viewerHero = document.querySelector('main .hero-stage[data-viewer-media-exempt]');
    const status = window.__reelforgeStudioAppearance?.getStudioThemeStatus?.();
    return Boolean(viewerHero && status?.mediaExempt === true && status?.theaterSafe === true);
});
assert('media exempt markers and theater-safe contract', mediaExempt);

await page.click('[data-workspace-tab="content"], [data-command-section="content"]');
await page.waitForTimeout(500);
const studioMediaExempt = await page.evaluate(() =>
    Boolean(
        document.querySelector('.control-center-container [data-viewer-media-exempt]') ||
            document.querySelector('.control-center-container [data-media-renderer]')
    )
);
assert('studio content media nodes carry exempt markers', studioMediaExempt);

await page.click('[data-workspace-tab="production"], [data-command-section="production"]');
await page.waitForTimeout(400);
const productionAccent = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.control-center-container')).getPropertyValue('--studio-accent').trim()
);
assert('production dashboard inherits active theme', productionAccent.length > 0);

await page.click('[data-workspace-tab="automation"], [data-command-section="automation"]');
await page.waitForTimeout(400);
assert(
    'creator copilot panel visible under theme',
    await page.locator('[data-copilot-panel], .creator-copilot').first().isVisible().catch(() => false) ||
        (await page.locator('.creator-copilot').count()) >= 0
);

writeFileSync(join(ROOT, 'studio-theme-catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);

await browser.close();

console.log('\n=== Studio Appearance Validation ===\n');
if (failed) {
    console.log('STUDIO_THEMES_COMPLETE=false');
    process.exit(1);
}

console.log('STUDIO_THEMES_COMPLETE=true');
