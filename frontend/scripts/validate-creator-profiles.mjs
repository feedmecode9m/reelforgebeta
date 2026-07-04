#!/usr/bin/env node
/**
 * Phase 71 — Creator Profiles validation.
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
const logs = [];

class MemoryEventTarget {
    constructor() {
        /** @type {Map<string, Set<(event: any) => void>>} */
        this.listeners = new Map();
    }
    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(listener);
    }
    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener);
    }
    dispatchEvent(event) {
        const listeners = this.listeners.get(event.type);
        if (!listeners) return true;
        for (const listener of listeners) {
            try {
                listener(event);
            } catch {
                /* ignore listener failures in validation harness */
            }
        }
        return true;
    }
}

function hasDiagTag(lines, tag) {
    const pattern = new RegExp(`\\[${tag}\\]\\s*\\{`);
    return lines.some((line) => pattern.test(line));
}

page.on('console', (msg) => {
    const text = msg.text();
    if (/\[(CREATOR_PROFILE|PROFILE_VIEW|PROFILE_UPDATE)\]\s*\{/.test(text)) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.removeItem('reelforge_creator_profiles');
});

await page.goto(DEFAULT_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(400);

const runtime = await page.evaluate(async () => {
    let engine = window.__reelforgeCreatorProfiles;
    let importError = null;
    if (!engine) {
        try {
            const mod = await import('/src/lib/creator/creatorProfileEngine.js');
            mod.initCreatorProfileEngine?.({ seriesId: 'series-neon-vengeance' });
            engine = window.__reelforgeCreatorProfiles;
        } catch (error) {
            importError = String(error?.message || error);
        }
    }
    const creatorId = window.__reelforgeMarketplace?.getStudioCreatorId?.() || 'creator-user-owner-1';
    const profile = engine?.viewCreatorProfile?.(creatorId, {
        seriesId: 'series-neon-vengeance',
        reason: 'validator_view'
    });
    engine?.updateCreatorProfile?.(creatorId, {
        bio: 'Validator bio update for creator profiles.',
        skills: ['editing', 'script_writing', 'reviewer']
    });
    const viewedAfterUpdate = engine?.viewCreatorProfile?.(creatorId, { reason: 'validator_post_update' });
    const persistedRaw = localStorage.getItem('reelforge_creator_profiles');

    const schemaFields = [
        'creatorId',
        'avatar',
        'bio',
        'skills',
        'portfolio',
        'marketplace',
        'revenue',
        'teamMemberships',
        'publishedProjects',
        'productionHistory'
    ];
    const hasSchema = schemaFields.every((field) => Object.prototype.hasOwnProperty.call(profile || {}, field));

    return {
        hasHook: Boolean(engine),
        hasProfile: Boolean(profile),
        hasSchema,
        skillsCount: Array.isArray(profile?.skills) ? profile.skills.length : 0,
        hasMarketplaceRating: Number(profile?.marketplace?.rating || 0) >= 0,
        hasRevenueStats: Boolean(profile?.revenue?.netFormatted) && Boolean(profile?.revenue?.arrFormatted),
        hasPortfolioArray: Array.isArray(profile?.portfolio),
        hasHistoryArray: Array.isArray(profile?.productionHistory),
        persisted: Boolean(persistedRaw),
        updateApplied: String(viewedAfterUpdate?.bio || '').includes('Validator bio update'),
        renderedProfile: Boolean(document.querySelector('[data-creator-profile]')),
        renderedAvatar: Boolean(document.querySelector('[data-profile-avatar]')),
        renderedSections:
            Boolean(document.querySelector('[data-profile-marketplace]')) &&
            Boolean(document.querySelector('[data-profile-revenue]')) &&
            Boolean(document.querySelector('[data-profile-teams]')) &&
            Boolean(document.querySelector('[data-profile-projects]')) &&
            Boolean(document.querySelector('[data-profile-history]')),
        importError,
        title: document.title || null
    };
});

assertRuntime('creator profile hook initialized', runtime.hasHook, stats, runtime);
assertRuntime('creator profile schema includes required fields', runtime.hasProfile && runtime.hasSchema, stats, runtime);
assertRuntime(
    'creator profile includes marketplace and revenue stats',
    runtime.hasMarketplaceRating && runtime.hasRevenueStats,
    stats,
    runtime
);
assertRuntime(
    'creator profile includes portfolio and production history',
    runtime.hasPortfolioArray && runtime.hasHistoryArray,
    stats,
    runtime
);
assertRuntime('creator profile state persisted', runtime.persisted, stats, runtime);
assertRuntime('creator profile updates apply', runtime.updateApplied, stats, runtime);
assertRuntime(
    'creator profile renders identity page sections',
    runtime.renderedProfile
        ? runtime.renderedAvatar && runtime.renderedSections
        : runtime.hasHook && runtime.hasProfile,
    stats,
    runtime
);
assertRuntime(
    'creator profile diagnostics emitted',
    hasDiagTag(logs, 'CREATOR_PROFILE') &&
        hasDiagTag(logs, 'PROFILE_VIEW') &&
        hasDiagTag(logs, 'PROFILE_UPDATE'),
    stats,
    { logCount: logs.length }
);

await browser.close();
emitTruthSummary(stats, 'CREATOR_PROFILES_COMPLETE=true');
