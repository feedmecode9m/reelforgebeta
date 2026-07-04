/**
 * Phase 44 — Shared validation truth utilities.
 * Runtime checks gate pass/fail; static checks are logged only via [VALIDATION_STATIC].
 */

import { chromium } from 'playwright';

export const DEFAULT_BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';
export const DEFAULT_BACKEND = process.env.REELFORGE_BACKEND_URL || 'http://127.0.0.1:8080';

export const DEFAULT_CHROMIUM =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

/**
 * @typedef {Object} TruthStats
 * @property {number} staticChecks
 * @property {number} staticPassed
 * @property {number} runtimeChecks
 * @property {number} runtimePassed
 * @property {boolean} failed
 */

/** @returns {TruthStats} */
export function createTruthStats() {
    return {
        staticChecks: 0,
        staticPassed: 0,
        runtimeChecks: 0,
        runtimePassed: 0,
        failed: false
    };
}

/**
 * @param {string} tag
 * @param {Record<string, unknown>} detail
 */
export function logPlatformTruth(tag, detail = {}) {
    console.log(`[PLATFORM_TRUTH] ${JSON.stringify({ tag, ...detail, timestamp: Date.now() })}`);
}

/**
 * @param {string} name
 * @param {boolean} ok
 * @param {Record<string, unknown>} [detail]
 */
export function logValidationRuntime(name, ok, detail = {}) {
    console.log(
        `[VALIDATION_RUNTIME] ${JSON.stringify({ name, ok, ...detail, timestamp: Date.now() })}`
    );
}

/**
 * @param {string} name
 * @param {boolean} ok
 * @param {Record<string, unknown>} [detail]
 */
export function logValidationStatic(name, ok, detail = {}) {
    console.log(
        `[VALIDATION_STATIC] ${JSON.stringify({ name, ok, ...detail, timestamp: Date.now() })}`
    );
}

/**
 * @param {string} name
 * @param {boolean} ok
 * @param {TruthStats} stats
 * @param {Record<string, unknown>} [detail]
 */
export function assertRuntime(name, ok, stats, detail = {}) {
    stats.runtimeChecks += 1;
    if (ok) {
        stats.runtimePassed += 1;
        console.log(`PASS: ${name}`);
    } else {
        stats.failed = true;
        console.log(`FAIL: ${name}`);
    }
    logValidationRuntime(name, ok, detail);
}

/**
 * @param {string} name
 * @param {boolean} ok
 * @param {TruthStats} stats
 */
export function assertStatic(name, ok, stats) {
    stats.staticChecks += 1;
    if (ok) stats.staticPassed += 1;
    logValidationStatic(name, ok);
}

/**
 * @param {TruthStats} stats
 * @param {string} completeToken
 */
export function emitTruthSummary(stats, completeToken) {
    const summary = {
        staticChecks: stats.staticChecks,
        staticPassed: stats.staticPassed,
        runtimeChecks: stats.runtimeChecks,
        runtimePassed: stats.runtimePassed,
        failed: stats.failed
    };
    console.log(`[VALIDATION_TRUTH_SUMMARY] ${JSON.stringify(summary)}`);
    logPlatformTruth('validator_complete', { completeToken, ...summary });
    if (stats.failed) {
        console.log(`${completeToken.replace('=true', '=false')}`);
        process.exit(1);
    }
    console.log(completeToken);
    process.exit(0);
}

/** @param {{ headless?: boolean }} [options] */
export async function launchTruthBrowser(options = {}) {
    return chromium.launch({
        headless: options.headless !== false,
        executablePath: DEFAULT_CHROMIUM
    });
}

/**
 * Real admin login via studio UI (not localStorage admin_mode shortcut).
 * @param {import('playwright').Page} page
 * @param {string} [base]
 * @param {string} [password]
 */
export async function loginAdminAndOpenStudio(page, base = DEFAULT_BASE, password = 'SMART_PRODUCTION') {
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.ghost-trigger', { timeout: 15000 });
    await page.click('.ghost-trigger');
    await page.waitForSelector('.admin-login-panel input[type="password"]', { timeout: 15000 });
    await page.fill('.admin-login-panel input[type="password"]', password);
    await page.click('.admin-login-panel .submit-btn');
    await page.waitForSelector('[data-production-command-center]', { timeout: 20000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {string} sectionId
 */
export async function openCommandCenterSection(page, sectionId) {
    const tab = page.locator(`[data-command-dashboard-section="${sectionId}"]`);
    await tab.waitFor({ state: 'visible', timeout: 10000 });
    await tab.click();
    await page.waitForSelector(`[data-command-dashboard-detail="${sectionId}"]`, { timeout: 10000 });
    await page.waitForTimeout(400);
}

/**
 * @param {string} stdout
 */
export function parseTruthSummaryFromOutput(stdout) {
    const match = stdout.match(/\[VALIDATION_TRUTH_SUMMARY\]\s*(\{.*\})/);
    if (!match) return null;
    try {
        return JSON.parse(match[1]);
    } catch {
        return null;
    }
}

/**
 * @param {string} stdout
 */
export function countTaggedChecks(stdout, tag) {
    const regex = new RegExp(`\\[${tag}\\]\\s*(\\{.*?\\})`, 'g');
    let count = 0;
    let passed = 0;
    let match;
    while ((match = regex.exec(stdout)) !== null) {
        count += 1;
        try {
            const payload = JSON.parse(match[1]);
            if (payload.ok === true) passed += 1;
        } catch {
            /* ignore */
        }
    }
    return { count, passed };
}

/**
 * @param {string} path
 * @param {RequestInit} [options]
 */
export async function fetchBackendJson(path, options = {}) {
    const res = await fetch(`${DEFAULT_BACKEND}${path}`, {
        ...options,
        signal: AbortSignal.timeout(8000)
    });
    const body = await res.json().catch(() => ({}));
    return { res, body, ok: res.ok };
}
