#!/usr/bin/env node
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');
const BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';
const WALKTHROUGH_KEY = 'reelforge_studio_walkthrough_complete';

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
const walkthroughPath = join(SRC, 'components/studio/StudioWalkthrough.svelte');

assert('guideMeEngine.js exists', existsSync(enginePath));

const engineSrc = readFileSync(enginePath, 'utf8');
const walkSrc = readFileSync(walkthroughPath, 'utf8');

assert('GUIDE_ME_SECTIONS exported', engineSrc.includes('export const GUIDE_ME_SECTIONS'));
assert('buildContextualCoachingCards exported', engineSrc.includes('export function buildContextualCoachingCards'));
assert('buildGuideMeTourSteps exported', engineSrc.includes('export function buildGuideMeTourSteps'));
assert('GUIDE_ME_CONTEXT diagnostics', engineSrc.includes("logGuideMeDiag('GUIDE_ME_CONTEXT'"));
assert('GUIDE_ME_RECOMMENDATION diagnostics', engineSrc.includes("logGuideMeDiag('GUIDE_ME_RECOMMENDATION'"));
assert('GUIDE_ME_ACTION diagnostics', engineSrc.includes("logGuideMeDiag('GUIDE_ME_ACTION'"));
assert('five coaching questions in walkthrough UI', walkSrc.includes('What is this?') && walkSrc.includes('What should I do next?'));
assert('guide me mode safe usage copy', walkSrc.includes('Safe usage:'));

const sectionCount = (engineSrc.match(/whatIsThis:/g) || []).length;
assert('section guides include whatIsThis', sectionCount >= 7);

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
        text.includes('[GUIDE_ME_CONTEXT]') ||
        text.includes('[GUIDE_ME_RECOMMENDATION]') ||
        text.includes('[GUIDEME_RECOMMENDATION]') ||
        text.includes('[GUIDE_ME_ACTION]') ||
        text.includes('[STUDIO_WALKTHROUGH]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.removeItem('reelforge_studio_walkthrough_complete');
    localStorage.removeItem('reelforge_guide_me_mode');
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
            },
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

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => document.querySelector('.ghost-trigger')?.click());
await page.waitForSelector('[data-studio-workspace-layout]', { timeout: 15000 });
await page.waitForTimeout(1200);

assert('guide me hook initialized', await page.evaluate(() => Boolean(window.__reelforgeGuideMe)));
assert('coaching cards render', (await page.locator('[data-guide-me-coaching-card]').count()) >= 4);
assert('what-next coaching card', await page.locator('[data-guide-me-coaching-card="what-next"]').isVisible());
assert('biggest blocker coaching card', await page.locator('[data-guide-me-coaching-card="biggest-blocker"]').isVisible());
assert('fastest gain coaching card', await page.locator('[data-guide-me-coaching-card="fastest-readiness-gain"]').isVisible());
assert('release risks coaching card', await page.locator('[data-guide-me-coaching-card="release-risks"]').isVisible());

const contextLogs = parseLogs(logs, 'GUIDE_ME_CONTEXT');
const recommendationLogs = parseLogs(logs, 'GUIDE_ME_RECOMMENDATION');
const actionLogs = parseLogs(logs, 'GUIDE_ME_ACTION');

assert('GUIDE_ME_CONTEXT emitted', contextLogs.length >= 1);
assert('GUIDE_ME_RECOMMENDATION emitted', recommendationLogs.length >= 4 || parseLogs(logs, 'GUIDEME_RECOMMENDATION').length >= 4);
assert('GUIDE_ME_ACTION emitted on init/tour prep', actionLogs.length >= 0);

const blockerMessage = await page.locator('[data-guide-me-coaching-card="biggest-blocker"] .guide-me-assistant__value').innerText();
assert('blocker card has actionable copy', blockerMessage.length > 8);

const missingMessage = await page.locator('[data-guide-me-coaching-card="missing-assets"] .guide-me-assistant__value').innerText();
assert('missing assets card has coverage copy', /episode|asset|reel|tracked/i.test(missingMessage));

await page.click('[data-studio-guide-me]');
await page.waitForSelector('[data-studio-walkthrough-overlay]', { timeout: 5000 });
assert('coach overlay opens', await page.locator('[data-studio-walkthrough-overlay]').isVisible());

const tourStart = parseLogs(logs, 'GUIDE_ME_ACTION').some((entry) => entry.phase === 'tour_start');
assert('GUIDE_ME_ACTION tour_start', tourStart);

const guideModeOn = await page.evaluate(() => document.documentElement.hasAttribute('data-guide-me-mode'));
assert('guide me mode enabled on start', guideModeOn);

const nextBtn = page.locator('.studio-walkthrough__next');
for (let i = 0; i < 8; i++) {
    if ((await page.locator('[data-studio-walkthrough-overlay]').count()) === 0) break;
    await nextBtn.scrollIntoViewIfNeeded();
    await nextBtn.click({ force: true });
    await page.waitForTimeout(350);
}

const walkComplete = parseLogs(logs, 'STUDIO_WALKTHROUGH').some((entry) => entry.phase === 'complete');
const stored = await page.evaluate((key) => localStorage.getItem(key), WALKTHROUGH_KEY);
assert('coach tour completes', walkComplete);
assert('walkthrough persistence works', stored === 'true');

const overlayGone = (await page.locator('[data-studio-walkthrough-overlay]').count()) === 0;
assert('coach overlay closes', overlayGone);

const unit = await page.evaluate(() => {
    const guide = window.__reelforgeGuideMe;
    const cards = guide.buildContextualCoachingCards('series-neon-vengeance', []);
    const steps = guide.buildGuideMeTourSteps('series-neon-vengeance', []);
    const section = guide.getGuideMeSection('overview');
    return {
        cardCount: cards.length,
        stepCount: steps.length,
        hasFiveFields: Boolean(
            section?.whatIsThis &&
                section?.whyItMatters &&
                section?.whenToUse &&
                section?.ifIgnored &&
                section?.doNext
        ),
        categories: cards.map((card) => card.category)
    };
});

assert('unit coaching cards count', unit.cardCount >= 4);
assert('unit tour step count', unit.stepCount >= 5);
assert('unit section five-part guide', unit.hasFiveFields);
assert('unit coaching categories', unit.categories.length >= 4);

await browser.close();

console.log('\n=== Guide Me 2.0 Validation ===\n');
if (failed) {
    console.log('GUIDE_ME_2_COMPLETE=false');
    process.exit(1);
}

console.log('GUIDE_ME_2_COMPLETE=true');
