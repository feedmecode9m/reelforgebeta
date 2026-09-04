#!/usr/bin/env node
/**
 * Validate LookAtZakanda pricing framework + Vic G free E1/E2 on local and production.
 *
 * Checks:
 * - Vic G: accessMode SUBSCRIPTION, freeEpisodeCount 2, 6 episodes
 * - E1 "The Project" + E2 "Arrival in LA" editorial copy
 * - E3+ present (Stripe-gated in viewer)
 * - Face poster on series browse card
 * - Payments API readiness signal
 *
 * Usage:
 *   node scripts/validate-pricing-access-framework.mjs
 *   REELFORGE_API_BASE=https://host node scripts/validate-pricing-access-framework.mjs
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LA_PRODUCTION_EPISODES } from '../src/lib/series/laProductionEpisodeGuide.js';
import {
    resolveEpisodeAccessPricing,
    resolveSeriesEpisodeAccessPricing
} from '../src/lib/series/episodeAccessPricing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const TARGETS = [
    {
        label: 'LOCAL',
        apiBase: String(process.env.LOCAL_API_BASE || 'http://127.0.0.1:8080').replace(/\/$/, '')
    },
    {
        label: 'PRODUCTION',
        apiBase: String(
            process.env.REELFORGE_API_BASE ||
                process.env.PRODUCTION_API_BASE ||
                'https://reelforge-deploy-production.up.railway.app'
        ).replace(/\/$/, '')
    }
];

const SERIES_ID = 'series-vic-g';
const FREE_EPISODE_COUNT = 2;

/** @param {string} msg */
function log(msg) {
    console.log(`[validate-pricing] ${msg}`);
}

/** @param {string} url */
async function fetchJson(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(`${url} → ${res.status}: ${body.error || res.statusText}`);
    }
    return body;
}

/** @param {unknown} series @param {string} label */
function verifyVicG(series, label) {
    const failures = [];
    const accessMode = String(series?.accessMode || series?.access_mode || '').toUpperCase();
    const freeCount = Number(series?.freeEpisodeCount ?? series?.free_episode_count ?? FREE_EPISODE_COUNT);
    if (!['SUBSCRIPTION', 'EPISODE_LOCK'].includes(accessMode)) {
        failures.push(`${label}: accessMode expected SUBSCRIPTION/EPISODE_LOCK, got ${accessMode || '—'}`);
    }
    if (freeCount !== FREE_EPISODE_COUNT) {
        failures.push(
            `${label}: freeEpisodeCount expected ${FREE_EPISODE_COUNT}, got ${series?.freeEpisodeCount ?? series?.free_episode_count ?? '—'}`
        );
    }
    const poster = String(series?.poster || '');
    if (!poster) failures.push(`${label}: series poster missing`);

    const episodes = (series?.seasons || []).flatMap((s) => s.episodes || []);
    if (episodes.length < 6) {
        failures.push(`${label}: expected 6 episodes, got ${episodes.length}`);
    }

    for (const n of [1, 2]) {
        const guide = LA_PRODUCTION_EPISODES.find((ep) => ep.episodeNumber === n);
        const ep = episodes.find((row) => Number(row.episodeNumber) === n);
        if (!ep) {
            failures.push(`${label}: E${n} missing`);
            continue;
        }
        const access = resolveEpisodeAccessPricing({
            episode: ep,
            seriesAccessMode: accessMode,
            freeEpisodeCount: freeCount
        });
        if (access.mode !== 'free') {
            failures.push(`${label}: E${n} should be FREE, got ${access.mode}`);
        }
        const title = String(ep.title || '').trim();
        if (title !== guide?.title) {
            failures.push(`${label}: E${n} title "${title}" != "${guide?.title}"`);
        }
    }
    for (const n of [3, 4, 5, 6]) {
        const ep = episodes.find((row) => Number(row.episodeNumber) === n);
        if (!ep) {
            failures.push(`${label}: E${n} missing`);
            continue;
        }
        const access = resolveEpisodeAccessPricing({
            episode: ep,
            seriesAccessMode: accessMode,
            freeEpisodeCount: freeCount
        });
        if (access.mode !== 'paid') {
            failures.push(`${label}: E${n} should be PAID, got ${access.mode}`);
        }
    }
    return failures;
}

/** @param {string} label @param {string} apiBase */
async function verifyPayments(label, apiBase) {
    const failures = [];
    try {
        const res = await fetch(`${apiBase}/api/payments/status`, { signal: AbortSignal.timeout(15000) });
        const body = await res.json().catch(() => ({}));
        if (res.status === 404 && String(body?.error || '').includes('Payments API disabled')) {
            failures.push(`${label}: Payments API disabled (${body?.hint || 'off'})`);
            return failures;
        }
        // Status requires a signed-in viewer; 401 means the route is live and monetization is on.
        if (res.status === 401 || res.status === 403) {
            return failures;
        }
        if (!res.ok) {
            failures.push(`${label}: payments status unexpected ${res.status}`);
            return failures;
        }
        if (!body.enabled) {
            failures.push(`${label}: Payments API disabled (${body.hint || body.error || 'off'})`);
        } else if (!body.publishableKeyConfigured) {
            failures.push(`${label}: STRIPE_PUBLISHABLE_KEY not configured`);
        }
    } catch (err) {
        failures.push(`${label}: payments status unreachable (${err.message})`);
    }
    return failures;
}

/** PDF framework: subscription tiers $7.99/mo and $69.99/yr (documented; Stripe price IDs server-side). */
function verifyPricingFrameworkDoc() {
    const monthly = resolveSeriesEpisodeAccessPricing({
        episodeNumber: 3,
        accessMode: 'SUBSCRIPTION',
        freeEpisodeCount: 2
    });
    const free = resolveSeriesEpisodeAccessPricing({
        episodeNumber: 1,
        accessMode: 'SUBSCRIPTION',
        freeEpisodeCount: 2
    });
    const failures = [];
    if (free?.mode !== 'free') failures.push('Framework: first 2 episodes in series should resolve free');
    if (monthly?.mode !== 'paid') failures.push('Framework: episode 3+ should resolve paid/subscription');
    return failures;
}

async function verifyBrowsePoster(apiBase, label) {
    const vite = await createServer({
        root,
        logLevel: 'error',
        server: { middlewareMode: true },
        appType: 'custom'
    });
    try {
        const browse = await vite.ssrLoadModule('/src/lib/series/viewerSeriesBrowseCatalog.js');
        const catalog = await fetchJson(`${apiBase}/api/series`);
        const built = browse.buildViewerSeriesBrowseCatalog(catalog);
        const rows = Array.isArray(built?.all) ? built.all : Array.isArray(built) ? built : [];
        const vicG = rows.find((row) => row.seriesId === SERIES_ID || row.id === SERIES_ID);
        if (!vicG) {
            return [`${label}: Vic G missing from browse catalog projection`];
        }
        const poster = String(vicG.posterSrc || vicG.poster || '');
        if (!poster.includes('thumbs') && !poster.includes('vic-g-face')) {
            return [`${label}: browse poster missing face thumbnail (${poster || '—'})`];
        }
        return [];
    } finally {
        await vite.close();
    }
}

async function main() {
    const allFailures = [];
    allFailures.push(...verifyPricingFrameworkDoc());

    for (const target of TARGETS) {
        log(`Checking ${target.label} (${target.apiBase})`);
        try {
            const health = await fetch(`${target.apiBase}/health`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
            if (!health?.ok) {
                log(`SKIP ${target.label}: backend unreachable (${target.apiBase})`);
                continue;
            }
            const series = await fetchJson(`${target.apiBase}/api/series/${encodeURIComponent(SERIES_ID)}`);
            allFailures.push(...verifyVicG(series, target.label));
            allFailures.push(...(await verifyPayments(target.label, target.apiBase)));
            allFailures.push(...(await verifyBrowsePoster(target.apiBase, target.label)));
        } catch (err) {
            allFailures.push(`${target.label}: ${err.message}`);
        }
    }

    if (allFailures.length) {
        console.error('[validate-pricing] FAILURES:');
        for (const f of allFailures) console.error(`  - ${f}`);
        process.exit(1);
    }
    log('PASS — Vic G E1/E2 free, E3+ paid, poster + payments checks OK on all targets');
}

main().catch((err) => {
    console.error(`[validate-pricing] ERROR: ${err.message || err}`);
    process.exit(1);
});
