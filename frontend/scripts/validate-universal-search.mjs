#!/usr/bin/env node
/**
 * Phase 62 — Universal NLP Search Engine validation.
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

page.on('console', (msg) => {
    const text = msg.text();
    if (
        text.includes('[SEARCH_INDEX]') ||
        text.includes('[SEARCH_QUERY]') ||
        text.includes('[SEARCH_NAVIGATION]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
    localStorage.removeItem('reelforge_universal_search_index');
    localStorage.setItem('reelforge_studio_workspace_tab', 'Overview');
    localStorage.setItem(
        'reelforge_creator_teams',
        JSON.stringify({
            teams: [{ id: 'team-validator', name: 'Validator Team', seriesId: 'series-neon-vengeance' }],
            members: { 'team-validator': [{ id: 'member-validator', displayName: 'Val Creator', role: 'OWNER' }] },
            activity: { 'team-validator': [] }
        })
    );
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await page.waitForSelector('[data-global-search-open]', { timeout: 15000 });

const runtime = await page.evaluate(async () => {
    const universal = window.__reelforgeUniversalSearch;
    if (!universal) {
        return {
            hasHook: false,
            indexedCount: 0,
            hasAllDomains: false,
            refreshesOnEvents: false,
            nlpMatchesQueries: false,
            resultShapeValid: false
        };
    }

    const indexed = universal?.indexUniversalSearchData?.() || { records: [] };
    const beforeUpdatedAt = indexed.updatedAt || 0;
    window.dispatchEvent(new CustomEvent('reelforge:workflow-tasks-updated'));
    await new Promise((resolve) => setTimeout(resolve, 260));
    const afterRaw = localStorage.getItem('reelforge_universal_search_index');
    const after = afterRaw ? JSON.parse(afterRaw) : null;

    const q1 = universal?.searchUniversal?.('show missing episodes') || { results: [] };
    const q2 = universal?.searchUniversal?.('security issues') || { results: [] };
    const q3 = universal?.searchUniversal?.('creator revenue') || { results: [] };
    const q4 = universal?.searchUniversal?.('upload reel') || { results: [] };

    const sample = q1.results[0] || q2.results[0] || q3.results[0] || q4.results[0] || null;
    const requiredDomains = [
        'reels',
        'episodes',
        'series',
        'workflows',
        'tasks',
        'notifications',
        'marketplace_listings',
        'creators',
        'teams',
        'revenue_insights',
        'security_incidents',
        'sentinel_recommendations',
        'guide_me_content',
        'daily_engagement_cards'
    ];
    const domainSet = new Set((indexed.records || []).map((record) => record.domain));
    const domains = Array.from(domainSet.values()).sort();
    const missingDomains = requiredDomains.filter((domain) => !domainSet.has(domain));

    return {
        hasHook: Boolean(universal),
        indexedCount: (indexed.records || []).length,
        hasAllDomains: requiredDomains.every((domain) => domainSet.has(domain)),
        missingDomains,
        domains,
        refreshesOnEvents: Number(after?.updatedAt || 0) >= beforeUpdatedAt,
        nlpMatchesQueries:
            q1.results.length > 0 && q2.results.length > 0 && q3.results.length > 0 && q4.results.length > 0,
        resultShapeValid: Boolean(
            sample &&
                typeof sample.title === 'string' &&
                typeof sample.description === 'string' &&
                typeof sample.targetType === 'string' &&
                typeof sample.targetId === 'string' &&
                typeof sample.confidenceScore === 'number'
        )
    };
});

assertRuntime('universal search hook initialized', runtime.hasHook, stats, runtime);
assertRuntime('universal search index built', runtime.indexedCount > 25, stats, runtime);
assertRuntime('universal search includes all required domains', runtime.hasAllDomains, stats, runtime);
assertRuntime('universal search refreshes index on events', runtime.refreshesOnEvents, stats, runtime);
assertRuntime('universal search handles NLP-style queries', runtime.nlpMatchesQueries, stats, runtime);
assertRuntime('universal search returns required result shape', runtime.resultShapeValid, stats, runtime);

await page.click('[data-global-search-open]');
await page.waitForSelector('[data-global-search-input]', { timeout: 10000 });
await page.fill('[data-global-search-input]', 'show missing episodes');
await page.waitForTimeout(500);
const resultCount = await page.locator('[data-global-search-result]').count();
if (resultCount > 0) {
    await page.locator('[data-global-search-result]').first().click();
}
await page.waitForTimeout(250);

assertRuntime(
    'clicking universal search result triggers navigation diagnostics',
    logs.some((line) => line.includes('[SEARCH_NAVIGATION]')),
    stats,
    { logCount: logs.length }
);
assertRuntime(
    'universal search diagnostics emitted',
    logs.some((line) => line.includes('[SEARCH_INDEX]')) &&
        logs.some((line) => line.includes('[SEARCH_QUERY]')),
    stats,
    { logCount: logs.length }
);

await browser.close();
emitTruthSummary(stats, 'UNIVERSAL_SEARCH_COMPLETE=true');
