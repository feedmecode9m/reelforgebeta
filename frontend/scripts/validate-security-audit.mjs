#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';

const REQUIRED_DOMAINS = [
    'uploadEndpoints',
    'mediaRoutes',
    'notificationRoutes',
    'workflowApis',
    'teamApis',
    'authentication',
    'permissions',
    'localStorageUsage',
    'apiExposure',
    'environmentVariables'
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

function parseLogs(logs, tag) {
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

const enginePath = join(SRC, 'lib/security/securityAuditEngine.js');
assert('securityAuditEngine.js exists', existsSync(enginePath));

const engineSrc = readFileSync(enginePath, 'utf8');
assert('runSecurityAudit exported', engineSrc.includes('export function runSecurityAudit'));
assert('SECURITY_AUDIT diagnostics', engineSrc.includes("logSecurityDiag('SECURITY_AUDIT'"));
assert('SECURITY_RISK diagnostics', engineSrc.includes("logSecurityDiag('SECURITY_RISK'"));
assert('SECURITY_SCORE diagnostics', engineSrc.includes("logSecurityDiag('SECURITY_SCORE'"));
assert('audits upload endpoints', engineSrc.includes("'uploadEndpoints'"));
assert('audits media routes', engineSrc.includes("'mediaRoutes'"));
assert('audits notification routes', engineSrc.includes("'notificationRoutes'"));
assert('audits workflow apis', engineSrc.includes("'workflowApis'"));
assert('audits team apis', engineSrc.includes("'teamApis'"));
assert('audits authentication', engineSrc.includes("'authentication'"));
assert('audits permissions', engineSrc.includes("'permissions'"));
assert('audits localStorage usage', engineSrc.includes("'localStorageUsage'"));
assert('audits api exposure', engineSrc.includes("'apiExposure'"));
assert('audits environment variables', engineSrc.includes("'environmentVariables'"));

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
        text.includes('[SECURITY_AUDIT]') ||
        text.includes('[SECURITY_RISK]') ||
        text.includes('[SECURITY_SCORE]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.removeItem('reelforge_admin_session_token');
    localStorage.setItem('admin_mode', 'false');
});

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => Boolean(window.__reelforgeSecurityAudit?.runSecurityAudit), null, {
    timeout: 15000
});
await page.waitForTimeout(800);

assert('security audit hook initialized', await page.evaluate(() => Boolean(window.__reelforgeSecurityAudit)));

const auditLogs = parseLogs(logs, 'SECURITY_AUDIT');
const riskLogs = parseLogs(logs, 'SECURITY_RISK');
const scoreLogs = parseLogs(logs, 'SECURITY_SCORE');

assert('SECURITY_AUDIT emitted on boot', auditLogs.some((entry) => entry.phase === 'engine_initialized' || entry.phase === 'complete'));
assert('SECURITY_RISK emitted', riskLogs.length >= 1);
assert('SECURITY_SCORE emitted', scoreLogs.some((entry) => typeof entry.score === 'number'));

const report = await page.evaluate(() => window.__reelforgeSecurityAudit.runSecurityAudit({ emitDiagnostics: false }));

assert('score is 0-100', report.score >= 0 && report.score <= 100);
assert('categories include severity buckets', ['Critical', 'High', 'Medium', 'Low'].every((key) => key in report.categories));
assert('risk report generated', Array.isArray(report.riskReport?.risks));
assert('score report generated', typeof report.scoreReport?.grade === 'string');
assert('recommendations generated', Array.isArray(report.recommendations) && report.recommendations.length >= 1);
assert('all domains audited', REQUIRED_DOMAINS.every((id) => report.domains.some((domain) => domain.id === id)));

assert(
    'upload endpoints audited',
    report.domains.some((domain) => domain.id === 'uploadEndpoints' && domain.risks.length >= 1)
);
assert(
    'authentication risks cataloged',
    report.findings.some((risk) => risk.domain === 'authentication')
);

writeFileSync(join(ROOT, 'security-risk-report.json'), `${JSON.stringify(report.riskReport, null, 2)}\n`);
writeFileSync(join(ROOT, 'security-score-report.json'), `${JSON.stringify(report.scoreReport, null, 2)}\n`);

console.log('\n--- Security Score Report ---');
console.log(`Score: ${report.score}/100 (${report.scoreReport.grade})`);
console.log(`Findings: ${report.findings.length}`);
console.log(
    `Categories: Critical=${report.categories.Critical}, High=${report.categories.High}, Medium=${report.categories.Medium}, Low=${report.categories.Low}`
);
console.log('\nTop recommendations:');
for (const rec of report.recommendations.slice(0, 5)) {
    console.log(`- ${rec}`);
}

await browser.close();

console.log('\n=== Security Audit Validation ===\n');
if (failed) {
    console.log('SECURITY_AUDIT_COMPLETE=false');
    process.exit(1);
}

console.log('SECURITY_AUDIT_COMPLETE=true');
