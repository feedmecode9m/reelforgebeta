#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';

const REQUIRED_INSIGHTS = [
    'what-next',
    'biggest-blocker',
    'fastest-readiness-gain',
    'release-risks',
    'missing-assets',
    'publishing-recommendations'
];

const ASSISTANT_MODES = ['beginner', 'creator', 'producer', 'executive'];

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

const enginePath = join(SRC, 'lib/studio/guideMeEngine.js');
const panelPath = join(SRC, 'components/studio/GuideMeAssistantPanel.svelte');
const assistantPath = join(SRC, 'lib/copilot/studioAssistant.js');

assert('guideMeEngine.js exists', existsSync(enginePath));
assert('GuideMeAssistantPanel.svelte exists', existsSync(panelPath));
assert('studioAssistant.js exists', existsSync(assistantPath));

const engineSrc = readFileSync(enginePath, 'utf8');
const panelSrc = readFileSync(panelPath, 'utf8');

assert('buildGuideMeOperationalBrief exported', engineSrc.includes('export function buildGuideMeOperationalBrief'));
assert('consumes sentinel assistant', engineSrc.includes('masterAnalysis') && engineSrc.includes('getSentinelGuideMeOverlay'));
assert('consumes creator copilot', engineSrc.includes('buildCreatorCopilotBrief'));
assert('consumes action engine', engineSrc.includes('buildStudioActionPlan'));
assert('consumes production health', engineSrc.includes('computeProductionReadiness'));
assert('consumes workflow engine', engineSrc.includes('getWorkflowTasksForSeries'));
assert('consumes release center', engineSrc.includes('buildReleaseCenterSnapshot'));
assert('consumes team manager', engineSrc.includes('getOpenTasksForAssignment'));
assert('GUIDEME_MISSION diagnostics', engineSrc.includes("'GUIDEME_MISSION'"));
assert('GUIDEME_ACTION diagnostics', engineSrc.includes("'GUIDEME_ACTION'"));
assert('GUIDEME_RECOMMENDATION diagnostics', engineSrc.includes("'GUIDEME_RECOMMENDATION'"));
assert('assistant modes defined', ASSISTANT_MODES.every((mode) => engineSrc.includes(`'${mode}'`)));

assert('panel mode selector', panelSrc.includes('data-guide-me-mode-select'));
assert('mission of the day label', panelSrc.includes('Mission of the Day') && panelSrc.includes('data-guideme-mission-of-day'));
assert('biggest blocker label', panelSrc.includes('Biggest Blocker') && panelSrc.includes('data-guideme-biggest-blocker'));
assert('fastest win label', panelSrc.includes('Fastest Win') && panelSrc.includes('data-guideme-fastest-win'));
assert('recommended next action label', panelSrc.includes('Recommended Next Action') && panelSrc.includes('data-guideme-next-action'));
assert('release readiness advice label', panelSrc.includes('Release Readiness Advice') && panelSrc.includes('data-guideme-release-advice'));
assert('context hooks in panel', panelSrc.includes('data-guide-me-context'));
assert('data-studio-assistant hook', panelSrc.includes('data-studio-assistant'));

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
        text.includes('[GUIDEME_MISSION]') ||
        text.includes('[GUIDEME_ACTION]') ||
        text.includes('[GUIDEME_RECOMMENDATION]') ||
        text.includes('[STUDIO_ASSISTANT]') ||
        text.includes('[GUIDE_ME_CONTEXT]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem('reelforge_studio_workspace_tab', 'Overview');
    localStorage.setItem(
        'reelforge_series_metadata',
        JSON.stringify({
            '4a50ca17-124c-401e-b4bd-d711b781be36': {
                reelId: '4a50ca17-124c-401e-b4bd-d711b781be36',
                episodeId: 'ep-neon-s01e02',
                seriesId: 'series-neon-vengeance',
                seasonNumber: 1,
                episodeNumber: 2,
                seriesName: 'Neon Vengeance',
                episodeTitle: 'Blood Protocol',
                episodeStatus: 'published',
                genre: 'Cyber-Action',
                description: 'Old allies resurface.',
                runtime: 298,
                releaseYear: 2024,
                updatedAt: Date.now()
            }
        })
    );
});

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => document.querySelector('.ghost-trigger')?.click());
await page.waitForSelector('[data-guide-me-assistant-panel]', { timeout: 15000 });
await page.waitForTimeout(1200);

assert('guide me hook initialized', await page.evaluate(() => Boolean(window.__reelforgeGuideMe?.buildGuideMeOperationalBrief)));
assert('studio assistant hook initialized', await page.evaluate(() => Boolean(window.__reelforgeStudioAssistant)));

assert('assistant panel renders', await page.locator('[data-guide-me-assistant-panel]').isVisible());
assert('mode selector renders', await page.locator('[data-guide-me-mode-select]').isVisible());
assert('context strip renders', await page.locator('[data-guide-me-context]').isVisible());
assert('mission of the day renders', await page.locator('[data-guideme-mission-of-day]').isVisible());
assert('biggest blocker renders', await page.locator('[data-guideme-biggest-blocker]').isVisible());
assert('fastest win renders', await page.locator('[data-guideme-fastest-win]').isVisible());
assert('recommended next action renders', await page.locator('[data-guideme-next-action]').isVisible());
assert('release readiness advice renders', await page.locator('[data-guideme-release-advice]').isVisible());
assert('projected readiness renders', await page.locator('[data-mission-projected-readiness]').isVisible());

for (const id of REQUIRED_INSIGHTS) {
    assert(`insight ${id} renders`, await page.locator(`[data-studio-assistant-insight="${id}"]`).isVisible());
}

const missionLogs = parseLogs(logs, 'GUIDEME_MISSION');
const actionLogs = parseLogs(logs, 'GUIDEME_ACTION');
const recommendationLogs = parseLogs(logs, 'GUIDEME_RECOMMENDATION');

assert('GUIDEME_MISSION emitted', missionLogs.some((entry) => entry.missionOfTheDay || entry.phase === 'engine_initialized'));
assert('GUIDEME_ACTION emitted', actionLogs.length >= 1);
assert('GUIDEME_RECOMMENDATION emitted', recommendationLogs.length >= 1);

const missionText = await page.locator('[data-guideme-mission-of-day] .guide-me-assistant__value').innerText();
assert('mission of the day has actionable copy', missionText.length > 12);

const projected = await page.locator('[data-mission-projected-readiness]').innerText();
assert('projected readiness shows percent values', /\d+%/.test(projected));

for (const mode of ASSISTANT_MODES) {
    await page.selectOption('[data-guide-me-mode-select] select', mode);
    await page.waitForTimeout(350);
    const stored = await page.evaluate(() => window.__reelforgeGuideMe.loadGuideMeAssistantMode());
    assert(`mode ${mode} persisted`, stored === mode);
}

const unit = await page.evaluate(() => {
    const brief = window.__reelforgeGuideMe.buildGuideMeOperationalBrief('series-neon-vengeance', [], {
        mode: 'producer',
        silent: true
    });
    return {
        mode: brief.mode,
        contextKeys: Object.keys(brief.context),
        hasMission: Boolean(brief.missionOfTheDay),
        hasBlocker: Boolean(brief.biggestBlocker?.title),
        hasFastest: Boolean(brief.fastestWin?.title),
        hasNext: Boolean(brief.recommendedNextAction?.title),
        hasReleaseAdvice: Boolean(brief.releaseReadinessAdvice?.summary),
        insightCount: brief.insights.length,
        workflowKnown: typeof brief.context.workflowState?.openTasks === 'number',
        publishingKnown: typeof brief.context.publishingState?.launchReadinessScore === 'number'
    };
});

assert('unit brief mode applied', unit.mode === 'producer');
assert('unit knows series context', unit.contextKeys.includes('seriesId') && unit.contextKeys.includes('readinessScore'));
assert('unit knows workflow state', unit.workflowKnown);
assert('unit knows publishing state', unit.publishingKnown);
assert('unit generates mission of the day', unit.hasMission);
assert('unit generates biggest blocker', unit.hasBlocker);
assert('unit generates fastest win', unit.hasFastest);
assert('unit generates recommended next action', unit.hasNext);
assert('unit generates release readiness advice', unit.hasReleaseAdvice);
assert('unit generates six insights', unit.insightCount === 6);

writeFileSync(
    join(ROOT, 'guide-me-3-report.json'),
    `${JSON.stringify(
        {
            modes: ASSISTANT_MODES,
            diagnostics: {
                mission: parseLogs(logs, 'GUIDEME_MISSION').length,
                action: parseLogs(logs, 'GUIDEME_ACTION').length,
                recommendation: parseLogs(logs, 'GUIDEME_RECOMMENDATION').length
            }
        },
        null,
        2
    )}\n`
);

await page.screenshot({
    path: join(ROOT, 'guide-me-3-assistant-panel-screenshot.png'),
    fullPage: false
});

await browser.close();

console.log('\n=== Guide Me 3.0 Validation ===\n');
if (failed) {
    console.log('GUIDEME_3_COMPLETE=false');
    process.exit(1);
}

console.log('GUIDEME_3_COMPLETE=true');
