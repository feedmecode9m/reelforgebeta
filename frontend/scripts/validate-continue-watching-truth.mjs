#!/usr/bin/env node
/**
 * Phase 44 — Continue watching runtime validation (local progress path).
 */
import {
    assertRuntime,
    createTruthStats,
    emitTruthSummary,
    launchTruthBrowser,
    DEFAULT_BASE
} from './lib/validation-truth.mjs';

const stats = createTruthStats();
const browser = await launchTruthBrowser();
const page = await browser.newPage();

await page.addInitScript(() => {
    localStorage.setItem(
        'reelforge_series_watch_progress',
        JSON.stringify({
            'ep-neon-s01e01': 42
        })
    );
});

await page.goto(`${DEFAULT_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__reelforgeHeroIntelligence, { timeout: 15000 });

const localProgress = await page.evaluate(() => {
    const raw = localStorage.getItem('reelforge_series_watch_progress');
    const map = raw ? JSON.parse(raw) : {};
    const entry = map['ep-neon-s01e01'];
    return {
        ok: Number(entry) === 42,
        percent: Number(entry) || 0
    };
});

assertRuntime('local watch progress persisted', localProgress.ok, stats, localProgress);

const heroCandidate = await page.evaluate(() => {
    const api = window.__reelforgeHeroIntelligence;
    if (!api?.selectHeroContent) return { ok: false };
    const selection = api.selectHeroContent('CONTINUE_WATCHING', []);
    return {
        ok: selection?.source === 'continue_watching' || Boolean(selection?.title),
        source: selection?.source || '',
        title: selection?.title || ''
    };
});

assertRuntime(
    'hero intelligence consumes continue watching signals',
    heroCandidate.ok,
    stats,
    heroCandidate
);

await browser.close();
emitTruthSummary(stats, 'CONTINUE_WATCHING_TRUTH_COMPLETE=true');
