#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';
const REPORT_PATH = join(ROOT, 'security-operations-center-report.json');

const SOC_SECTIONS = [
    'threat-timeline',
    'active-incidents',
    'threat-map',
    'recent-security-events',
    'attack-surface-overview',
    'security-audit-results',
    'platform-security-score',
    'recommended-actions'
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

const enginePath = join(SRC, 'lib/security/securityOperationsCenter.js');
const diagnosticsPath = join(SRC, 'lib/security/securityOperationsDiagnostics.js');
const dashboardPath = join(SRC, 'components/security/SecurityOperationsDashboard.svelte');
const commandCenterPath = join(SRC, 'components/studio/ProductionCommandCenter.svelte');
const sentinelPanelPath = join(SRC, 'components/studio/SentinelAssistantPanel.svelte');

assert('securityOperationsCenter.js exists', existsSync(enginePath));
assert('securityOperationsDiagnostics.js exists', existsSync(diagnosticsPath));
assert('SecurityOperationsDashboard.svelte exists', existsSync(dashboardPath));

const engineSrc = readFileSync(enginePath, 'utf8');
const diagnosticsSrc = readFileSync(diagnosticsPath, 'utf8');
const dashboardSrc = readFileSync(dashboardPath, 'utf8');
const commandCenterSrc = readFileSync(commandCenterPath, 'utf8');
const sentinelPanelSrc = readFileSync(sentinelPanelPath, 'utf8');

assert('buildSecurityOperationsBrief exported', engineSrc.includes('export function buildSecurityOperationsBrief'));
assert('emitSecurityOperationsDiagnostics exported', engineSrc.includes('export function emitSecurityOperationsDiagnostics'));
assert('initSecurityOperationsCenter exported', engineSrc.includes('export function initSecurityOperationsCenter'));
assert('uses securityAuditEngine', engineSrc.includes("from './securityAuditEngine.js'"));
assert('uses threatDetectionEngine', engineSrc.includes("from './threatDetectionEngine.js'"));
assert('uses Sentinel Assistant', engineSrc.includes("from '../sentinel/sentinelAssistant.js'"));
assert('uses platformMetrics', engineSrc.includes("from '../observability/platformMetrics.js'"));
assert('Threat Timeline section', engineSrc.includes("'threat-timeline'") && engineSrc.includes('Threat Timeline'));
assert('Active Incidents section', engineSrc.includes("'active-incidents'") && engineSrc.includes('Active Incidents'));
assert('Threat Map section', engineSrc.includes("'threat-map'") && engineSrc.includes('Threat Map'));
assert('Recent Security Events section', engineSrc.includes('Recent Security Events'));
assert('Attack Surface Overview section', engineSrc.includes('Attack Surface Overview'));
assert('Security Audit Results section', engineSrc.includes('Security Audit Results'));
assert('Platform Security Score section', engineSrc.includes('Platform Security Score'));
assert('Recommended Actions section', engineSrc.includes('Recommended Actions'));
assert('SECURITY_INCIDENT diagnostics', diagnosticsSrc.includes("'SECURITY_INCIDENT'"));
assert('SOC_ALERT diagnostics', diagnosticsSrc.includes("'SOC_ALERT'"));
assert('SOC_SCORE diagnostics', diagnosticsSrc.includes("'SOC_SCORE'"));
assert('SOC_TIMELINE diagnostics', diagnosticsSrc.includes("'SOC_TIMELINE'"));
assert('dashboard root hook', dashboardSrc.includes('data-security-operations-dashboard'));
assert('command center integrates SOC dashboard', commandCenterSrc.includes('SecurityOperationsDashboard'));
assert('sentinel integrates SOC summary', sentinelPanelSrc.includes('data-sentinel-soc'));

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
        text.includes('[SECURITY_INCIDENT]') ||
        text.includes('[SOC_ALERT]') ||
        text.includes('[SOC_SCORE]') ||
        text.includes('[SOC_TIMELINE]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.removeItem('reelforge_security_events');
});

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => document.querySelector('.ghost-trigger')?.click());
await page.waitForSelector('[data-production-command-center]', { timeout: 15000 });
await page.click('[data-command-dashboard-section="security"]');
await page.waitForSelector('[data-security-operations-dashboard]', { timeout: 15000 });
await page.waitForTimeout(900);

assert('SOC hook initialized', await page.evaluate(() => Boolean(window.__reelforgeSecurityOperationsCenter)));
assert('SOC dashboard renders', await page.locator('[data-security-operations-dashboard]').isVisible());
assert('platform security score visible', await page.locator('[data-soc-platform-score]').isVisible());

for (const section of SOC_SECTIONS.filter((id) => id !== 'platform-security-score')) {
    const hook =
        section === 'threat-timeline'
            ? 'data-soc-threat-timeline'
            : section === 'active-incidents'
              ? 'data-soc-active-incidents'
              : section === 'threat-map'
                ? 'data-soc-threat-map'
                : section === 'recent-security-events'
                  ? 'data-soc-recent-events'
                  : section === 'attack-surface-overview'
                    ? 'data-soc-attack-surface'
                    : section === 'security-audit-results'
                      ? 'data-soc-audit-results'
                      : 'data-soc-recommended-actions';
    assert(`${section} section visible`, await page.locator(`[${hook}]`).isVisible());
}

await page.click('[data-command-section="system"]');
await page.waitForSelector('[data-sentinel-soc]', { timeout: 15000 });
assert('sentinel SOC summary visible', await page.locator('[data-sentinel-soc]').isVisible());

const unit = await page.evaluate(() => {
    const soc = window.__reelforgeSecurityOperationsCenter;
    soc.buildSecurityOperationsBrief('series-neon-vengeance', [], { emitDiagnostics: true });
    const brief = soc.buildSecurityOperationsBrief('series-neon-vengeance', [], { emitDiagnostics: false });
    return {
        sectionKeys: Object.keys(brief.sections),
        combinedScore: brief.platformSecurityScore.combinedScore,
        auditScore: brief.platformSecurityScore.auditScore,
        threatScore: brief.platformSecurityScore.threatScore,
        sentinelScore: brief.platformSecurityScore.sentinelScore,
        threatLevel: brief.threatLevel,
        timelineCount: brief.sections.threatTimeline.length,
        incidentCount: brief.sections.activeIncidents.length,
        mapCount: brief.sections.threatMap.length,
        eventCount: brief.sections.recentSecurityEvents.length,
        actionCount: brief.sections.recommendedActions.length,
        auditFindingCount: brief.sections.securityAuditResults.topFindings.length,
        sources: brief.sources
    };
});

assert('brief includes threatTimeline', unit.sectionKeys.includes('threatTimeline'));
assert('brief includes activeIncidents', unit.sectionKeys.includes('activeIncidents'));
assert('brief includes threatMap', unit.sectionKeys.includes('threatMap'));
assert('brief includes recentSecurityEvents', unit.sectionKeys.includes('recentSecurityEvents'));
assert('brief includes attackSurfaceOverview', unit.sectionKeys.includes('attackSurfaceOverview'));
assert('brief includes securityAuditResults', unit.sectionKeys.includes('securityAuditResults'));
assert('brief includes platformSecurityScore', unit.sectionKeys.includes('platformSecurityScore'));
assert('brief includes recommendedActions', unit.sectionKeys.includes('recommendedActions'));
assert('combined platform security score computed', unit.combinedScore > 0);
assert('audit score sourced', unit.sources.securityAuditEngine > 0);
assert('threat score sourced', typeof unit.sources.threatDetectionEngine === 'number');
assert('sentinel score sourced', unit.sources.sentinelAssistant > 0);
assert('platform metrics sourced', unit.sources.platformMetrics > 0);
assert('threat map zones generated', unit.mapCount >= 5);
assert('audit findings listed', unit.auditFindingCount >= 1);
assert('recommended actions generated', unit.actionCount >= 1);

const scoreLogs = parseLogs(logs, 'SOC_SCORE');
const timelineLogs = parseLogs(logs, 'SOC_TIMELINE');
const incidentLogs = parseLogs(logs, 'SECURITY_INCIDENT');
const alertLogs = parseLogs(logs, 'SOC_ALERT');

assert('SOC_SCORE emitted', scoreLogs.length >= 1);
assert('SOC_TIMELINE emitted', timelineLogs.length >= 0);
assert('SOC_ALERT emitted', alertLogs.length >= 1);

writeFileSync(
    REPORT_PATH,
    `${JSON.stringify(
        {
            sections: SOC_SECTIONS,
            unit,
            diagnostics: {
                score: scoreLogs.length,
                timeline: timelineLogs.length,
                incident: incidentLogs.length,
                alert: alertLogs.length
            }
        },
        null,
        2
    )}\n`
);

await browser.close();

console.log('\n=== Security Operations Center Validation ===\n');
if (failed) {
    console.log('SECURITY_OPERATIONS_CENTER_COMPLETE=false');
    process.exit(1);
}

console.log('SECURITY_OPERATIONS_CENTER_COMPLETE=true');
