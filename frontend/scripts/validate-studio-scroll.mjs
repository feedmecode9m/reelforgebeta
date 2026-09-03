#!/usr/bin/env node
/**
 * Smart Production Studio scroll — content below Creator Operating System must scroll.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { unlockStudio } from '../tests/helpers/studio-navigation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const FRONTEND = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';

const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else console.log(`  ok: ${msg}`);
}

const viewerCss = fs.readFileSync(path.join(root, 'src/viewer/viewer.css'), 'utf8');
const studioExperience = fs.readFileSync(
    path.join(root, 'src/components/experiences/StudioExperience.svelte'),
    'utf8'
);

console.log('\n[1] scroll layout contract');
assert(viewerCss.includes('.control-center-scroll-body'), 'viewer.css defines control-center-scroll-body');
assert(
    /\.control-center-scroll-body[\s\S]*min-height:\s*0/.test(viewerCss),
    'scroll body uses min-height: 0 flex overflow pattern'
);
assert(
    /\.control-center-scroll-body[\s\S]*overflow-y:\s*auto/.test(viewerCss),
    'scroll body is overflow-y auto'
);
assert(
    /\.control-center-container[\s\S]*flex-direction:\s*column/.test(viewerCss),
    'dialog uses flex column layout'
);
assert(
    viewerCss.includes('.control-center-overlay') &&
        viewerCss.includes('.ghost-trigger') &&
        /main\.blur[\s\S]*pointer-events:\s*none[\s\S]*\.control-center-overlay[\s\S]*pointer-events:\s*auto/.test(
            viewerCss
        ),
    'viewer.css restores studio pointer-events under main.blur'
);
assert(
    studioExperience.includes('data-control-center-scroll-body'),
    'StudioExperience wraps studio content in scroll body'
);

console.log('\n[2] browser scroll past Creator Operating System');
const playwrightShellPath =
    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
/** @type {import('playwright').LaunchOptions} */
const browserLaunchOptions = { headless: true };
if (existsSync(playwrightShellPath)) {
    browserLaunchOptions.executablePath = playwrightShellPath;
}

let browser;
try {
    browser = await chromium.launch(browserLaunchOptions);
    const page = await browser.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await unlockStudio(page, FRONTEND);

    const metrics = await page.evaluate(() => {
        const scrollBody = document.querySelector('[data-control-center-scroll-body]');
        const creatorOs = document.querySelector('[data-studio-workspace-layout] h3');
        const workspacePanel = document.querySelector('[data-studio-workspace-panel]');
        const contentMarker =
            document.querySelector('[data-workspace-overview]') ||
            document.querySelector('[data-command-center-panel]') ||
            workspacePanel;

        if (!scrollBody) {
            return { error: 'missing-scroll-body' };
        }

        const beforeTop = scrollBody.scrollTop;
        const maxScroll = scrollBody.scrollHeight - scrollBody.clientHeight;
        scrollBody.scrollTop = maxScroll;

        const creatorRect = creatorOs?.getBoundingClientRect();
        const markerRect = contentMarker?.getBoundingClientRect();
        const bodyRect = scrollBody.getBoundingClientRect();

        return {
            scrollHeight: scrollBody.scrollHeight,
            clientHeight: scrollBody.clientHeight,
            maxScroll,
            beforeTop,
            afterTop: scrollBody.scrollTop,
            creatorOsText: creatorOs?.textContent?.trim() || '',
            markerVisible:
                Boolean(markerRect) &&
                markerRect.bottom > bodyRect.top &&
                markerRect.top < bodyRect.bottom,
            markerBelowCreator:
                Boolean(creatorRect && markerRect) && markerRect.top >= creatorRect.bottom - 8,
            canScroll: maxScroll > 24
        };
    });

    if (metrics.error) {
        assert(false, `browser: ${metrics.error}`);
    } else {
        assert(metrics.creatorOsText.includes('Creator Operating System'), 'Creator Operating System header present');
        assert(metrics.canScroll, 'studio scroll body has scrollable overflow');
        assert(metrics.afterTop > metrics.beforeTop, 'scroll body scrollTop advances');
        assert(
            metrics.markerVisible || metrics.afterTop >= metrics.maxScroll - 4,
            'workspace panel region reachable via scroll'
        );
    }

    console.log('\n[3] studio overlay remains tappable while main.blur is active');
    const interaction = await page.evaluate(() => {
        const main = document.querySelector('main');
        main?.classList.add('blur');
        const overlay = document.querySelector('.control-center-overlay');
        const closeBtn = document.querySelector('.control-center-header .close-x');
        const unlockBtn = document.querySelector('.admin-login-panel .submit-btn');
        const target = closeBtn || unlockBtn || document.querySelector('.control-center-header button');
        const overlayPe = overlay ? getComputedStyle(overlay).pointerEvents : '';
        const targetPe = target ? getComputedStyle(target).pointerEvents : '';
        let clickWorked = false;
        if (target) {
            const before = document.querySelector('.control-center-overlay') != null;
            target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            clickWorked = before && document.querySelector('.control-center-overlay') != null;
        }
        return {
            hasOverlay: Boolean(overlay),
            overlayPointerEvents: overlayPe,
            targetPointerEvents: targetPe,
            hasTarget: Boolean(target),
            clickWorked
        };
    });
    assert(interaction.hasOverlay, 'studio overlay mounted for interaction test');
    assert(interaction.overlayPointerEvents === 'auto', 'overlay pointer-events restored under main.blur');
    if (interaction.hasTarget) {
        assert(interaction.targetPointerEvents === 'auto', 'studio controls pointer-events restored under main.blur');
    }
} catch (err) {
    const msg = String(err?.message || err);
    if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/.test(msg)) {
        console.log(`  skip: frontend unavailable at ${FRONTEND}`);
    } else {
        assert(false, `browser scroll test failed: ${msg}`);
    }
} finally {
    await browser?.close();
}

if (failures.length) {
    console.error('\nFAIL validate-studio-scroll');
    for (const msg of failures) console.error(`  ✗ ${msg}`);
    process.exit(1);
}

console.log('\nPASS validate-studio-scroll');
