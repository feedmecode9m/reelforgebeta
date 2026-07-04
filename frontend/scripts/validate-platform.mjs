#!/usr/bin/env node
/**
 * Phase 66B — Platform Truth Validation Expansion.
 * Enforces behavior-first runtime evidence and removes static false positives.
 */

import { existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { logPlatformTruth, parseTruthSummaryFromOutput } from './lib/validation-truth.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SCRIPTS = join(ROOT, 'scripts');
const BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';
const SCRIPT_TIMEOUT_MS = Number(process.env.PLATFORM_VALIDATION_TIMEOUT_MS || 180000);

const TRUTH_REPORT_PATH = join(ROOT, 'platform-truth-report.json');
const CERTIFICATION_REPORT_PATH = join(ROOT, 'platform-certification-report.json');
const VALIDATION_REPORT_PATH = join(ROOT, 'platform-validation-report.json');
const READINESS_REPORT_PATH = join(ROOT, 'platform-readiness-report.json');

/** @typedef {'PASS' | 'FAIL'} DomainStatus */

/**
 * @typedef {Object} DomainTarget
 * @property {string} id
 * @property {string} label
 * @property {string} script
 * @property {string} token
 */

/**
 * @typedef {Object} DomainResult
 * @property {string} id
 * @property {string} label
 * @property {string} script
 * @property {DomainStatus} status
 * @property {string | null} completeToken
 * @property {number} durationMs
 * @property {number} score
 * @property {number} staticChecks
 * @property {number} staticPassed
 * @property {number} runtimeChecks
 * @property {number} runtimePassed
 * @property {boolean} hasRuntimeDiagnostics
 * @property {boolean} hasVisibleStateEvidence
 * @property {string} detail
 */

/** @type {DomainTarget[]} */
const PLATFORM_DOMAINS = [
    { id: 'heroBackgroundPipeline', label: 'Hero Background Pipeline', script: 'validate-hero-background-truth.mjs', token: 'HERO_BACKGROUND_TRUTH_COMPLETE=true' },
    { id: 'marketplaceHub', label: 'Marketplace Hub', script: 'validate-marketplace-truth.mjs', token: 'MARKETPLACE_TRUTH_COMPLETE=true' },
    { id: 'revenueDashboard', label: 'Revenue Dashboard', script: 'validate-revenue-dashboard-truth.mjs', token: 'REVENUE_DASHBOARD_TRUTH_COMPLETE=true' },
    { id: 'discoveryEngine', label: 'Discovery Engine', script: 'validate-discovery-engine.mjs', token: 'DISCOVERY_ENGINE_COMPLETE=true' },
    { id: 'dailyEngagement', label: 'Daily Engagement', script: 'validate-daily-engagement.mjs', token: 'DAILY_ENGAGEMENT_COMPLETE=true' },
    { id: 'securityOperationsCenter', label: 'Security Operations Center', script: 'validate-security-operations-center-truth.mjs', token: 'SECURITY_OPERATIONS_CENTER_COMPLETE=true' },
    { id: 'securityEnforcement', label: 'Security Enforcement', script: 'validate-security-enforcement.mjs', token: 'SECURITY_ENFORCEMENT_COMPLETE=true' },
    { id: 'enterpriseFoundation', label: 'Enterprise Foundation', script: 'validate-enterprise-truth.mjs', token: 'ENTERPRISE_TRUTH_COMPLETE=true' },
    { id: 'multiUserPipelines', label: 'Multi-user Pipelines', script: 'validate-multi-user-pipeline-truth.mjs', token: 'MULTI_USER_PIPELINE_COMPLETE=true' },
    { id: 'globalSearch', label: 'Global Search', script: 'validate-global-search.mjs', token: 'GLOBAL_SEARCH_COMPLETE=true' },
    { id: 'heroCarousel', label: 'Hero Carousel', script: 'validate-hero-carousel.mjs', token: 'HERO_CAROUSEL_COMPLETE=true' },
    { id: 'supportReelForge', label: 'Support ReelForge', script: 'validate-support-reelforge.mjs', token: 'SUPPORT_REELFORGE_COMPLETE=true' }
];

const FALSE_POSITIVE_DOMAINS_REMOVED = [
    'platformTruthFlow',
    'revenueArchitecture',
    'theaterNavigation',
    'continueWatching',
    'teamNotifications',
    'securityAudit',
    'threatDetection',
    'sentinelAssistant',
    'heroIntelligence',
    'creatorCopilot',
    'guideMe',
    'productionHealth',
    'releaseCenter',
    'notifications',
    'teams',
    'workflowEngine',
    'commandCenter',
    'appearanceSystem'
];

/** @param {Record<string, unknown>} detail */
function logPlatformValidation(detail = {}) {
    console.log(`[PLATFORM_VALIDATION] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @param {string} output @param {string} tag */
function parseTaggedEntries(output, tag) {
    const regex = new RegExp(`\\[${tag}\\]\\s*(\\{.*\\})`, 'g');
    const entries = [];
    let match;
    while ((match = regex.exec(output)) !== null) {
        try {
            entries.push(JSON.parse(match[1]));
        } catch {
            /* ignore malformed payload */
        }
    }
    return entries;
}

/** @param {string} output @param {string} token */
function outputHasExactToken(output, token) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}$`, 'm').test(output);
}

/** @param {unknown[]} runtimeEntries */
function hasVisibleStateEvidence(runtimeEntries) {
    return runtimeEntries.some((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const payload = /** @type {Record<string, unknown>} */ (entry);
        const name = String(payload.name || '');
        if (/(visible|render|mounted|open|section|tab|panel|persist|updates|change|reachable|appears)/i.test(name)) {
            return true;
        }
        for (const [key, value] of Object.entries(payload)) {
            if (/(visible|render|mounted|open|changed|persist|count|selected|reachable)/i.test(key)) {
                if (typeof value === 'boolean' && value) return true;
                if (typeof value === 'number' && value > 0) return true;
            }
        }
        return false;
    });
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

        let stdout = '';
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

async function isPreviewAvailable() {
    try {
        const res = await fetch(BASE, { signal: AbortSignal.timeout(2500) });
        return res.ok;
    } catch {
        return false;
    }
}

async function ensurePreviewServer() {
    if (await isPreviewAvailable()) return null;
    console.log(`Starting preview server at ${BASE}...`);
    const proc = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4190'], {
        cwd: ROOT,
        stdio: 'pipe'
    });

    for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (await isPreviewAvailable()) return proc;
    }
    proc.kill();
    throw new Error(`Preview server unavailable at ${BASE}`);
}

async function main() {
    console.log('\n=== ReelForge Platform Truth Validation (Phase 66B) ===\n');
    logPlatformTruth('suite_start', { url: BASE, domainCount: PLATFORM_DOMAINS.length, phase: '66B' });
    logPlatformValidation({ phase: 'start', url: BASE, domainCount: PLATFORM_DOMAINS.length });

    /** @type {DomainResult[]} */
    const domains = [];
    let previewProc = null;

    try {
        previewProc = await ensurePreviewServer();
        logPlatformValidation({ phase: 'preview_ready', url: BASE });
        logPlatformTruth('preview_ready', { url: BASE });
    } catch (error) {
        logPlatformValidation({ phase: 'preview_failed', error: String(error?.message || error) });
        logPlatformTruth('preview_failed', { error: String(error?.message || error) });
    }

    for (const domain of PLATFORM_DOMAINS) {
        const scriptPath = join(SCRIPTS, domain.script);
        const started = Date.now();
        if (!existsSync(scriptPath)) {
            const result = {
                id: domain.id,
                label: domain.label,
                script: domain.script,
                status: /** @type {DomainStatus} */ ('FAIL'),
                completeToken: null,
                durationMs: Date.now() - started,
                score: 0,
                staticChecks: 0,
                staticPassed: 0,
                runtimeChecks: 0,
                runtimePassed: 0,
                hasRuntimeDiagnostics: false,
                hasVisibleStateEvidence: false,
                detail: 'validator script missing'
            };
            domains.push(result);
            console.log(`FAIL: ${domain.label} — missing ${domain.script}`);
            continue;
        }

        const run = await runValidatorScript(domain.script);
        const output = `${run.stdout}\n${run.stderr}`;
        const summary = parseTruthSummaryFromOutput(output);
        const runtimeEntries = parseTaggedEntries(output, 'VALIDATION_RUNTIME');
        const staticEntries = parseTaggedEntries(output, 'VALIDATION_STATIC');

        const runtimeChecks = summary?.runtimeChecks ?? runtimeEntries.length;
        const runtimePassed = summary?.runtimePassed ?? runtimeEntries.filter((entry) => entry?.ok === true).length;
        const staticChecks = summary?.staticChecks ?? staticEntries.length;
        const staticPassed = summary?.staticPassed ?? staticEntries.filter((entry) => entry?.ok === true).length;

        const hasToken = outputHasExactToken(run.stdout, domain.token);
        const hasRuntimeDiagnostics = runtimeEntries.length > 0;
        const visibleStateEvidence = hasVisibleStateEvidence(runtimeEntries);
        const runtimeComplete = runtimeChecks > 0 && runtimePassed === runtimeChecks;
        const passed = run.code === 0 && hasToken && runtimeComplete && hasRuntimeDiagnostics && visibleStateEvidence;

        const result = {
            id: domain.id,
            label: domain.label,
            script: domain.script,
            status: /** @type {DomainStatus} */ (passed ? 'PASS' : 'FAIL'),
            completeToken: hasToken ? domain.token : null,
            durationMs: run.durationMs,
            score: passed ? 100 : 0,
            staticChecks,
            staticPassed,
            runtimeChecks,
            runtimePassed,
            hasRuntimeDiagnostics,
            hasVisibleStateEvidence: visibleStateEvidence,
            detail: passed
                ? 'runtime_behavior_validated'
                : run.timedOut
                    ? 'validator timeout'
                    : `token=${hasToken}; runtime=${runtimePassed}/${runtimeChecks}; diagnostics=${hasRuntimeDiagnostics}; visibleState=${visibleStateEvidence}`
        };

        domains.push(result);

        logPlatformValidation({
            phase: 'domain',
            domain: domain.id,
            status: result.status,
            runtimeChecks,
            runtimePassed,
            hasRuntimeDiagnostics,
            hasVisibleStateEvidence: visibleStateEvidence,
            token: result.completeToken
        });
        logPlatformTruth('domain_result', {
            domain: domain.id,
            status: result.status,
            runtimeChecks,
            runtimePassed,
            hasRuntimeDiagnostics,
            hasVisibleStateEvidence: visibleStateEvidence
        });
        console.log(`${result.status}: ${domain.label} — ${domain.script} (${run.durationMs}ms)`);
    }

    if (previewProc) previewProc.kill();

    const passCount = domains.filter((domain) => domain.status === 'PASS').length;
    const failCount = domains.length - passCount;
    const validatedDomains = domains.filter((domain) => domain.status === 'PASS').map((domain) => domain.id);
    const failedDomains = domains.filter((domain) => domain.status !== 'PASS').map((domain) => domain.id);

    const staticChecks = domains.reduce((sum, domain) => sum + domain.staticChecks, 0);
    const staticPassed = domains.reduce((sum, domain) => sum + domain.staticPassed, 0);
    const runtimeChecks = domains.reduce((sum, domain) => sum + domain.runtimeChecks, 0);
    const runtimePassed = domains.reduce((sum, domain) => sum + domain.runtimePassed, 0);
    const runtimeScore = runtimeChecks > 0 ? Math.round((runtimePassed / runtimeChecks) * 100) : 0;
    const platformScore = Math.round(domains.reduce((sum, domain) => sum + domain.score, 0) / PLATFORM_DOMAINS.length);
    const actualReadinessScore = Math.round(runtimeScore * 0.75 + platformScore * 0.25);

    const platformComplete = failCount === 0;
    const platformTruthComplete = platformComplete && runtimeChecks > 0 && runtimePassed === runtimeChecks;

    const truthReport = {
        generatedAt: new Date().toISOString(),
        phase: '66B',
        reelforgeUrl: BASE,
        validatedDomains,
        failedDomains,
        falsePositiveDomainsRemoved: FALSE_POSITIVE_DOMAINS_REMOVED,
        staticChecks,
        staticPassed,
        runtimeChecks,
        runtimePassed,
        runtimeScore,
        platformScore,
        actualReadinessScore,
        summary: {
            pass: passCount,
            fail: failCount,
            total: domains.length
        },
        domains
    };

    const certificationReport = {
        generatedAt: truthReport.generatedAt,
        phase: '66B',
        platformComplete,
        platformTruthComplete,
        tokens: {
            REELFORGE_PLATFORM_COMPLETE: platformComplete,
            REELFORGE_PLATFORM_TRUTH_COMPLETE: platformTruthComplete
        },
        failingDomains: failedDomains,
        falsePositiveDomainsRemoved: FALSE_POSITIVE_DOMAINS_REMOVED,
        finalPlatformScore: platformScore,
        runtimeScore,
        actualReadinessScore
    };

    const validationReport = {
        generatedAt: truthReport.generatedAt,
        platformScore,
        actualReadinessScore,
        platformComplete,
        platformTruthComplete,
        domains
    };

    const readinessReport = {
        generatedAt: truthReport.generatedAt,
        platformScore,
        runtimeScore,
        actualReadinessScore,
        criticalDomains: failedDomains,
        strongDomains: validatedDomains
    };

    writeFileSync(TRUTH_REPORT_PATH, `${JSON.stringify(truthReport, null, 2)}\n`, 'utf8');
    writeFileSync(CERTIFICATION_REPORT_PATH, `${JSON.stringify(certificationReport, null, 2)}\n`, 'utf8');
    writeFileSync(VALIDATION_REPORT_PATH, `${JSON.stringify(validationReport, null, 2)}\n`, 'utf8');
    writeFileSync(READINESS_REPORT_PATH, `${JSON.stringify(readinessReport, null, 2)}\n`, 'utf8');

    console.log('\n=== Platform Truth Summary ===');
    console.log(`Runtime Checks: ${runtimePassed}/${runtimeChecks}`);
    console.log(`Platform Score: ${platformScore}/100`);
    console.log(`Actual Readiness Score: ${actualReadinessScore}/100`);
    console.log(`PASS: ${passCount} · FAIL: ${failCount}`);
    console.log(`Truth Report: ${TRUTH_REPORT_PATH}`);
    console.log(`Certification Report: ${CERTIFICATION_REPORT_PATH}`);

    console.log(`\nREELFORGE_PLATFORM_COMPLETE=${platformComplete ? 'true' : 'false'}`);
    console.log(`REELFORGE_PLATFORM_TRUTH_COMPLETE=${platformTruthComplete ? 'true' : 'false'}`);
    process.exit(platformTruthComplete ? 0 : 1);
}

main().catch((error) => {
    logPlatformValidation({ phase: 'fatal', error: String(error?.message || error) });
    logPlatformTruth('suite_fatal', { error: String(error?.message || error) });
    console.error(error);
    process.exit(1);
});
