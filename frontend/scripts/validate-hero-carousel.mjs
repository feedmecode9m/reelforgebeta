#!/usr/bin/env node
/**
 * Phase 59 — Hero Carousel 2.0 validation.
 */
import {
    assertRuntime,
    createTruthStats,
    emitTruthSummary,
    launchTruthBrowser,
    loginAdminAndOpenStudio,
    DEFAULT_BASE
} from './lib/validation-truth.mjs';

const stats = createTruthStats();
const browser = await launchTruthBrowser();
const page = await browser.newPage();
const logs = [];

function hasDiagTag(lines, tag) {
    const pattern = new RegExp(`\\[${tag}\\]\\s*\\{`);
    return lines.some((line) => pattern.test(line));
}

page.on('console', (msg) => {
    const text = msg.text();
    if (/\[(HERO_CAROUSEL|HERO_SLIDE|HERO_TRANSITION|HERO_CAMPAIGN|HERO_ROTATION)\]\s*\{/.test(text)) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await page.waitForSelector('[data-production-command-center]', { timeout: 15000 });
await page.waitForSelector('[data-hero-intelligence]', { timeout: 15000 });
await page.waitForTimeout(350);

const runtime = await page.evaluate(async () => {
    const hero = window.__reelforgeHeroIntelligence;
    const feed = (() => {
        const list = window.__reelforgeReels;
        if (Array.isArray(list)) return list;
        if (list && typeof list === 'object') return Object.values(list).flat();
        return [];
    })();

    const selection = hero?.selectHeroContent?.('TRENDING', feed, { seriesId: 'series-neon-vengeance' });
    hero?.saveHeroManagerConfig?.({
        carouselTransitionStyle: 'zoom',
        carouselPriority: 'sentinel_recommendation',
        carouselDurationMs: 4000,
        heroTypography: 'serif_dramatic',
        autoplayEnabled: true
    });
    hero?.rotateHeroSelection?.(feed, { seriesId: 'series-neon-vengeance' });
    const slides = hero?.buildHeroCarouselSlides?.(feed, { seriesId: 'series-neon-vengeance' }) || [];
    const configuredTypes = new Set(hero?.HERO_SLIDE_TYPES || []);
    const slideTypes = new Set(slides.map((slide) => slide.type));
    const supportsRequiredTypes =
        configuredTypes.has('sentinel_recommendation') &&
        (slideTypes.has('video') || slideTypes.has('image')) &&
        slideTypes.has('sentinel_recommendation') &&
        slideTypes.size >= 4;

    const config = hero?.loadHeroManagerConfig?.() || {};
    window.dispatchEvent(new CustomEvent('reelforge:hero-manager-updated', { detail: config }));

    return {
        hasHook: Boolean(hero),
        selectionMode: selection?.mode || null,
        slideCount: slides.length,
        slideTypes: [...slideTypes],
        supportsRequiredTypes,
        transitionStyle: config.carouselTransitionStyle || null,
        durationMs: config.carouselDurationMs || 0,
        carouselPriority: config.carouselPriority || null,
        heroTypography: config.heroTypography || null,
        autoplayEnabled: config.autoplayEnabled !== false,
        hasSlideOverrides: Array.isArray(config.carouselSlideOverrides) && config.carouselSlideOverrides.length >= 8,
        hasTimeline: Boolean(document.querySelector('[data-hero-carousel-timeline]')),
        hasControls: Boolean(document.querySelector('[data-hero-carousel-controls]')),
        hasCountdown: Boolean(document.querySelector('[data-hero-countdown-overlay]')),
        hasSplitLayout: Boolean(document.querySelector('[data-hero-split-layout]')),
        hasUpcomingCard: Boolean(document.querySelector('[data-hero-upcoming-card]'))
    };
});

assertRuntime('hero carousel hook initialized', runtime.hasHook, stats, runtime);
assertRuntime('hero carousel builds slides', runtime.slideCount >= 4, stats, runtime);
assertRuntime('hero carousel supports required slide families', runtime.supportsRequiredTypes, stats, runtime);
assertRuntime('hero carousel timeline renders', runtime.hasTimeline, stats, runtime);
assertRuntime(
    'hero carousel admin controls persisted',
    runtime.transitionStyle === 'zoom' &&
        runtime.carouselPriority === 'sentinel_recommendation' &&
        runtime.heroTypography === 'serif_dramatic' &&
        runtime.autoplayEnabled &&
        runtime.durationMs >= 4000,
    stats,
    runtime
);
assertRuntime(
    'hero carousel diagnostics emitted',
    hasDiagTag(logs, 'HERO_CAROUSEL') &&
        hasDiagTag(logs, 'HERO_SLIDE') &&
        (hasDiagTag(logs, 'HERO_TRANSITION') || hasDiagTag(logs, 'HERO_ROTATION')) &&
        (hasDiagTag(logs, 'HERO_CAMPAIGN') || hasDiagTag(logs, 'HERO_ROTATION')),
    stats,
    { logCount: logs.length }
);

await browser.close();
emitTruthSummary(stats, 'HERO_CAROUSEL_COMPLETE=true');
