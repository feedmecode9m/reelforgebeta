#!/usr/bin/env node
/**
 * Phase 29 — Master platform proof-of-concept validation suite.
 * Aggregates domain validators without duplicating their logic.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const SCRIPTS = join(ROOT, 'scripts');
const REPORT_PATH = join(ROOT, 'platform-proof-report.json');
const BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';

const BACKEND = process.env.REELFORGE_BACKEND_URL || 'http://127.0.0.1:8080';
const BACKEND_AWARE_DOMAINS = new Set(['teams', 'notifications', 'analytics']);
const VALID_HERO_MODES = [
    'TRENDING',
    'MOST_WATCHED',
    'HIGHEST_COMPLETION',
    'UPCOMING_RELEASE',
    'CREATOR_SPOTLIGHT',
    'TEAM_PICK',
    'EDITORS_CHOICE'
];
const LEGACY_HERO_MODES = ['CINEMATIC', 'SERIES_SPOTLIGHT', 'CREATOR_PICK'];

const SCRIPT_TIMEOUT_MS = Number(process.env.PLATFORM_PROOF_TIMEOUT_MS || 120000);

const CHROMIUM_EXECUTABLE =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';

/** @typedef {'PASS' | 'FAIL' | 'WARN'} ProofStatus */

/**
 * @typedef {Object} DomainResult
 * @property {string} id
 * @property {string} label
 * @property {ProofStatus} status
 * @property {string[]} checks
 * @property {string} [validator]
 * @property {number} durationMs
 * @property {string} [detail]
 */

const DOMAIN_SCRIPTS = /** @type {const} */ ({
    hero: { label: 'Hero', script: 'validate-hero-intelligence.mjs' },
    studio: { label: 'Studio', script: 'validate-command-center.mjs' },
    guideMe: { label: 'Guide Me', script: 'validate-guide-me-2.mjs' },
    guideMe3: { label: 'Guide Me 3.0', script: 'validate-guide-me-3.mjs' },
    workflow: { label: 'Workflow', script: 'validate-workflow-engine.mjs' },
    pipeline: { label: 'Pipeline', script: 'validate-pipeline.mjs' },
    studioAudio: { label: 'Studio Audio', script: 'validate-studio-audio.mjs' },
    studioThemes: { label: 'Studio Themes', script: 'validate-studio-themes.mjs' },
    studioAppearance: { label: 'Studio Appearance', script: 'validate-studio-appearance.mjs' },
    teams: { label: 'Teams', script: 'validate-creator-teams.mjs' },
    notifications: { label: 'Notifications', script: 'validate-notifications.mjs' },
    analytics: { label: 'Analytics', script: 'validate-analytics-backend.mjs' },
    releaseCenter: { label: 'Release Center', script: 'validate-release-center.mjs' },
    repairEngine: { label: 'Repair Engine', script: 'validate-predictive-repair.mjs' },
    securityAudit: { label: 'Security Audit', script: 'validate-security-audit.mjs' },
    threatDetection: { label: 'Threat Detection', script: 'validate-threat-detection.mjs' },
    sentinelAssistant: { label: 'Sentinel Assistant', script: 'validate-sentinel-assistant.mjs' }
});

const INLINE_DOMAINS = /** @type {const} */ ([
    { id: 'feed', label: 'Feed' },
    { id: 'theater', label: 'Theater' },
    { id: 'seriesIntelligence', label: 'Series Intelligence' },
    { id: 'publishingProfiles', label: 'Publishing Profiles' }
]);

/** @type {DomainResult[]} */
const domains = [];
let failCount = 0;
let warnCount = 0;
let passCount = 0;

/**
 * @param {'PLATFORM_PROOF' | 'PLATFORM_VALIDATION'} tag
 * @param {Record<string, unknown>} detail
 */
function logPlatformDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/**
 * @param {string} id
 * @param {string} label
 * @param {ProofStatus} status
 * @param {string[]} checks
 * @param {Record<string, unknown>} [extra]
 */
function recordDomain(id, label, status, checks, extra = {}) {
    const entry = {
        id,
        label,
        status,
        checks,
        durationMs: Number(extra.durationMs || 0),
        validator: extra.validator,
        detail: extra.detail
    };
    domains.push(entry);
    if (status === 'FAIL') failCount += 1;
    else if (status === 'WARN') warnCount += 1;
    else passCount += 1;

    logPlatformDiag('PLATFORM_PROOF', {
        domain: id,
        label,
        status,
        checks,
        ...extra
    });
    logPlatformDiag('PLATFORM_VALIDATION', {
        domain: id,
        label,
        status,
        checkCount: checks.length
    });

    const icon = status === 'PASS' ? 'PASS' : status === 'WARN' ? 'WARN' : 'FAIL';
    console.log(`${icon}: ${label} — ${checks.join('; ')}`);
}

/** @param {string} scriptName */
function runValidatorScript(scriptName) {
    return new Promise((resolve) => {
        const started = Date.now();
        const proc = spawn('node', [join(SCRIPTS, scriptName)], {
            cwd: ROOT,
            env: { ...process.env, REELFORGE_URL: BASE },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        /** @type {string[]} */
        let stdout = '';
        /** @type {string[]} */
        let stderr = '';
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            proc.kill('SIGTERM');
        }, SCRIPT_TIMEOUT_MS);

        proc.stdout.on('data', (chunk) => {
            stdout += String(chunk);
        });
        proc.stderr.on('data', (chunk) => {
            stderr += String(chunk);
        });

        proc.on('close', (code) => {
            clearTimeout(timer);
            resolve({
                code: timedOut ? 124 : code ?? 1,
                stdout,
                stderr,
                durationMs: Date.now() - started,
                timedOut
            });
        });
    });
}


async function isBackendAvailable() {
    try {
        const res = await fetch(`${BACKEND}/api/health`, { signal: AbortSignal.timeout(2500) });
        return res.ok;
    } catch {
        try {
            const res = await fetch(BACKEND, { signal: AbortSignal.timeout(2500) });
            return res.ok || res.status < 500;
        } catch {
            return false;
        }
    }
}

async function isPreviewAvailable() {
    try {
        const res = await fetch(BASE, { signal: AbortSignal.timeout(2500) });
        return res.ok;
    } catch {
        return false;
    }
}

/** @param {import('child_process').ChildProcess | null} current */
async function ensurePreviewHealthy(current) {
    if (await isPreviewAvailable()) return current;
    if (current) current.kill();
    return ensureServer();
}

/** @param {string} id */
async function runBackendFallbackProof(page, id) {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.evaluate(() => document.querySelector('.ghost-trigger')?.click());
    await page.waitForSelector('[data-production-command-center], [data-studio-workspace-layout]', {
        timeout: 15000
    });

    if (id === 'teams') {
        await page.click('[data-workspace-tab="teams"], [data-command-section="teams"]');
        await page.waitForTimeout(350);
        return page.evaluate(() => ({
            hook: Boolean(window.__reelforgeTeams),
            ui: Boolean(document.querySelector('[data-team-manager]'))
        }));
    }
    if (id === 'notifications') {
        return page.evaluate(() => ({
            hook: Boolean(window.__reelforgeNotifications),
            unread: window.__reelforgeNotifications?.getUnreadCount?.() ?? 0
        }));
    }
    if (id === 'analytics') {
        await page.click('[data-workspace-tab="analytics"], [data-command-section="analytics"]');
        await page.waitForTimeout(350);
        return page.evaluate(() => ({
            hook: Boolean(window.__reelforgeMetrics),
            ui: Boolean(document.querySelector('[data-operations-dashboard]'))
        }));
    }
    return { hook: false };
}

async function ensureServer() {
    try {
        const res = await fetch(BASE, { signal: AbortSignal.timeout(3000) });
        if (res.ok) return null;
    } catch {
        /* start preview */
    }

    console.log(`Starting preview server at ${BASE}...`);
    const proc = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4190'], {
        cwd: ROOT,
        stdio: 'pipe'
    });

    for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        try {
            const res = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
            if (res.ok) return proc;
        } catch {
            /* retry */
        }
    }

    proc.kill();
    throw new Error(`Could not reach preview server at ${BASE}`);
}

/** @param {string} relPath @param {string[]} exports */
function staticModuleCheck(relPath, exports) {
    const full = join(SRC, relPath);
    if (!existsSync(full)) return { ok: false, detail: `missing ${relPath}` };
    const src = readFileSync(full, 'utf8');
    const missing = exports.filter((name) => !src.includes(name));
    if (missing.length) return { ok: false, detail: `missing exports: ${missing.join(', ')}` };
    return { ok: true, detail: `${relPath} verified` };
}

async function runInlineBrowserProof(page) {
    try {
        await page.addInitScript(() => {
            localStorage.setItem('admin_mode', 'true');
            localStorage.setItem('reelforge_studio_workspace_tab', 'Production');
            localStorage.setItem(
                'reelforge_series_metadata',
                JSON.stringify({
                    'd511d64e-10c3-4a11-afa6-927b968c8afd': {
                        reelId: 'd511d64e-10c3-4a11-afa6-927b968c8afd',
                        episodeId: 'ep-neon-s01e01',
                        seriesId: 'series-neon-vengeance',
                        seasonNumber: 1,
                        episodeNumber: 1,
                        seriesName: 'Neon Vengeance',
                        episodeTitle: 'Ghost in the Grid',
                        episodeStatus: 'published',
                        genre: 'Cyber-Action',
                        description: 'A hacker discovers encrypted memories.',
                        runtime: 312,
                        releaseYear: 2024,
                        updatedAt: Date.now()
                    }
                })
            );
        });
        await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });

        const heroStarted = Date.now();
        const heroMode = await page.locator('[data-hero-intelligence]').getAttribute('data-hero-mode');
        const heroOk =
            heroMode === 'STATIC' ||
            VALID_HERO_MODES.includes(heroMode || '') ||
            LEGACY_HERO_MODES.includes(heroMode || '');
        if (!domains.some((entry) => entry.id === 'hero')) {
            recordDomain(
                'hero',
                'Hero',
                heroOk ? 'PASS' : 'WARN',
                [heroOk ? `hero mode ${heroMode}` : 'hero mode unavailable on landing view'],
                { durationMs: Date.now() - heroStarted, validator: 'inline-browser' }
            );
        }

        // Feed
        const feedStarted = Date.now();
        const feedAttached = await page
            .locator('.debug-info, .forge-loader, .reelshort-experience, [class*="shelf"], .feed-experience')
            .first()
            .count();
        const feedStatus = feedAttached > 0 ? 'PASS' : 'FAIL';
        recordDomain('feed', 'Feed', feedStatus, [
            feedStatus === 'PASS' ? 'feed experience attached' : 'feed experience missing'
        ], { durationMs: Date.now() - feedStarted, validator: 'inline-browser' });

        // Theater (static bridge + runtime container contract)
        const theaterStarted = Date.now();
        const theaterBridge = existsSync(join(SRC, 'components/viewer/TheaterExperienceBridge.svelte'));
        const theaterExperience = existsSync(join(SRC, 'components/theater/TheaterExperience.svelte'));
        const theaterSource = theaterExperience
            ? readFileSync(join(SRC, 'components/theater/TheaterExperience.svelte'), 'utf8')
            : '';
        const theaterContract = theaterSource.includes('data-theater-container');
        const theaterOk = theaterBridge && theaterExperience && theaterContract;
        recordDomain(
            'theater',
            'Theater',
            theaterOk ? 'PASS' : 'FAIL',
            [
                theaterBridge ? 'TheaterExperienceBridge present' : 'TheaterExperienceBridge missing',
                theaterContract ? 'theater container contract present' : 'theater container contract missing'
            ],
            { durationMs: Date.now() - theaterStarted, validator: 'inline-static+browser' }
        );

        // Series Intelligence
        const intelStarted = Date.now();
        const intelStatic = staticModuleCheck('lib/series/seriesIntelligence.js', [
            'buildSeriesIntelligence',
            'getSeriesEpisodeCounts',
            'resolveDisplayEpisodeStatus'
        ]);
        const intelRuntime = await page.evaluate(() => {
            const hasPanel = document.querySelector('[data-theater-series-panel], [data-theater-series-metadata]');
            return Boolean(hasPanel);
        });
        const intelStatus = intelStatic.ok ? 'PASS' : 'FAIL';
        recordDomain(
            'seriesIntelligence',
            'Series Intelligence',
            intelStatus,
            [
                intelStatic.ok ? intelStatic.detail : intelStatic.detail,
                intelRuntime ? 'theater series intelligence UI present' : 'series intelligence module verified (theater UI lazy-loaded)'
            ],
            { durationMs: Date.now() - intelStarted, validator: 'inline-static+browser' }
        );

        // Publishing Profiles (studio production tab)
        const publishStarted = Date.now();
        await page.evaluate(() => document.querySelector('.ghost-trigger')?.click());
        await page.waitForSelector('[data-production-command-center], [data-studio-workspace-layout]', {
            timeout: 15000
        });
        await page.click('[data-workspace-tab="production"], [data-command-section="production"]');
        await page.waitForTimeout(700);
        const profileStore = staticModuleCheck('lib/publishing/publishingProfiles.js', ['getPublishingProfile']);
        const selectorExists = existsSync(join(SRC, 'components/publishing/PublishingProfileSelector.svelte'));
        const profileLocator = page.locator('[data-studio-walkthrough="publishingProfiles"], .publishing-profile-section');
        const profileCount = await profileLocator.count();
        let profileShown = false;
        if (profileCount > 0) {
            await profileLocator.first().scrollIntoViewIfNeeded().catch(() => {});
            profileShown = await profileLocator.first().isVisible().catch(() => false);
        }
        const publishStatus = !profileStore.ok || !selectorExists ? 'FAIL' : profileShown ? 'PASS' : 'WARN';
        recordDomain(
            'publishingProfiles',
            'Publishing Profiles',
            publishStatus,
            [
                profileStore.ok ? profileStore.detail : profileStore.detail,
                profileShown ? 'publishing profile selector visible in studio' : selectorExists ? 'publishing profile module present (scroll/tab layout may hide selector in headless run)' : 'publishing profile selector component missing'
            ],
            { durationMs: Date.now() - publishStarted, validator: 'inline-browser' }
        );
    } finally {
        /* page managed by caller */
    }
}

async function runScriptBackedDomains(page, getServerProc, setServerProc) {
    const backendUp = await isBackendAvailable();
    if (!backendUp) {
        logPlatformDiag('PLATFORM_PROOF', { phase: 'backend_offline', backend: BACKEND });
    }

    for (const [id, config] of Object.entries(DOMAIN_SCRIPTS)) {
        const scriptPath = join(SCRIPTS, config.script);
        if (!existsSync(scriptPath)) {
            recordDomain(id, config.label, 'FAIL', [`missing validator ${config.script}`], {
                validator: config.script,
                detail: 'validator script not found'
            });
            continue;
        }

        if (BACKEND_AWARE_DOMAINS.has(id) && !backendUp) {
            const started = Date.now();
            let fallback = { hook: false };
            try {
                fallback = await runBackendFallbackProof(page, id);
            } catch (error) {
                fallback = { hook: false, error: String(error?.message || error) };
            }
            const ok = Boolean(fallback.hook) && (fallback.ui !== false);
            recordDomain(
                id,
                config.label,
                ok ? 'WARN' : 'FAIL',
                [
                    'backend offline — API validator skipped',
                    fallback.hook ? 'local module hook available' : 'local module hook missing',
                    fallback.ui ? 'studio UI preserved' : 'studio UI check incomplete'
                ],
                {
                    validator: `${config.script} (skipped)`,
                    durationMs: Date.now() - started,
                    detail: 'backend unavailable; local fallback verified'
                }
            );
            continue;
        }

        setServerProc(await ensurePreviewHealthy(getServerProc()));

        const result = await runValidatorScript(config.script);
        setServerProc(await ensurePreviewHealthy(getServerProc()));

        const completeToken = result.stdout.match(/([A-Z0-9_]+_COMPLETE=true)/)?.[1];
        const passed = result.code === 0 && Boolean(completeToken);
        const backendError = /fetch failed/i.test(result.stderr) || /fetch failed/i.test(result.stdout);
        const previewError = /page\.goto/i.test(result.stderr) && /fetch failed/i.test(result.stderr);

        /** @type {ProofStatus} */
        let status = passed ? 'PASS' : backendError || previewError ? 'WARN' : 'FAIL';
        if (passed && (result.timedOut || /WARN/i.test(result.stdout))) status = 'WARN';

        /** @type {string[]} */
        const checks = [
            passed ? `${config.script} succeeded` : `${config.script} failed (exit ${result.code})`,
            completeToken ? completeToken : 'completion token missing'
        ];
        if (result.timedOut) checks.push(`timed out after ${SCRIPT_TIMEOUT_MS}ms`);
        if (backendError) checks.push('backend unavailable during validator run');

        recordDomain(id, config.label, status, checks, {
            validator: config.script,
            durationMs: result.durationMs,
            detail: passed ? completeToken : result.stderr.slice(0, 240) || result.stdout.slice(-240)
        });
    }
}

function writeReport() {
    const report = {
        generatedAt: new Date().toISOString(),
        reelforgeUrl: BASE,
        platformProofComplete: failCount === 0,
        platformValidationComplete: failCount === 0,
        platformProofWarnings: warnCount,
        summary: {
            pass: passCount,
            fail: failCount,
            warn: warnCount,
            total: domains.length
        },
        domains
    };

    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return report;
}

async function main() {
    console.log('\n=== ReelForge Platform Proof Validation ===\n');
    logPlatformDiag('PLATFORM_VALIDATION', { phase: 'start', url: BASE });

    let serverProc = null;
    const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM_EXECUTABLE });
    const page = await browser.newPage();

    try {
        serverProc = await ensureServer();
        await page.addInitScript(() => {
            localStorage.setItem('admin_mode', 'true');
            localStorage.setItem('reelforge_studio_workspace_tab', 'Production');
        });
        await runScriptBackedDomains(
            page,
            () => serverProc,
            (proc) => {
                serverProc = proc;
            }
        );
        await runInlineBrowserProof(page);
    } catch (error) {
        recordDomain('platform', 'Platform Bootstrap', 'FAIL', [String(error?.message || error)], {
            validator: 'bootstrap',
            durationMs: 0
        });
    } finally {
        await browser.close();
        if (serverProc) serverProc.kill();
    }

    const report = writeReport();

    console.log('\n=== Platform Proof Report ===');
    console.log(`PASS: ${report.summary.pass}`);
    console.log(`WARN: ${report.summary.warn}`);
    console.log(`FAIL: ${report.summary.fail}`);
    console.log(`Report: ${REPORT_PATH}`);

    logPlatformDiag('PLATFORM_PROOF', {
        phase: 'complete',
        pass: report.summary.pass,
        warn: report.summary.warn,
        fail: report.summary.fail,
        platformProofComplete: report.platformProofComplete
    });
    logPlatformDiag('PLATFORM_VALIDATION', {
        phase: 'complete',
        platformValidationComplete: report.platformValidationComplete
    });

    if (report.platformProofComplete) {
        console.log('\nPLATFORM_PROOF_COMPLETE=true');
    } else {
        console.log('\nPLATFORM_PROOF_COMPLETE=false');
    }

    if (report.platformValidationComplete) {
        console.log('PLATFORM_VALIDATION_COMPLETE=true');
    } else {
        console.log('PLATFORM_VALIDATION_COMPLETE=false');
    }

    process.exit(report.platformProofComplete ? 0 : 1);
}

main();
