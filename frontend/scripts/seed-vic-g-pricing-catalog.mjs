#!/usr/bin/env node
/**
 * Seed Vic G catalog: E1/E2 free editorial copy, subscription gating (E3+), face poster.
 *
 * Usage:
 *   REELFORGE_API_BASE=http://127.0.0.1:8080 node scripts/seed-vic-g-pricing-catalog.mjs
 *   REELFORGE_API_BASE=https://reelforge-deploy-production.up.railway.app node scripts/seed-vic-g-pricing-catalog.mjs --verify-only
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LA_PRODUCTION_EPISODES, LA_PRODUCTION_SYNOPSIS } from '../src/lib/series/laProductionEpisodeGuide.js';
import { VIC_G_EPISODE_BINDINGS, VIC_G_SERIES_ID, VIC_G_SERIES_TITLE } from '../src/lib/series/vicGSeriesPackage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = String(process.env.REELFORGE_API_BASE || process.env.BACKEND_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const VERIFY_ONLY = process.argv.includes('--verify-only');
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const POSTER_BASENAME = 'vic-g-face-poster-power-of-support.png';
const POSTER_URL = `/thumbs/${POSTER_BASENAME}`;
const SEASON_ID = 'season-vic-g-1';
const ACCESS_MODE = 'SUBSCRIPTION';
const FREE_EPISODE_COUNT = 2;

/** @param {string} msg */
function log(msg) {
    console.log(`[seed-vic-g-pricing] ${msg}`);
}

/** @param {string} url @param {RequestInit} [init] */
async function apiFetch(url, init = {}) {
    const res = await fetch(url, init);
    const text = await res.text();
    /** @type {unknown} */
    let body;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = text;
    }
    if (!res.ok) {
        const detail =
            body && typeof body === 'object' && body !== null && 'error' in body
                ? String(/** @type {{ error?: string }} */ (body).error)
                : text.slice(0, 200);
        throw new Error(`${init.method || 'GET'} ${url} → ${res.status}: ${detail}`);
    }
    return body;
}

function authHeaders() {
    return {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
    };
}

/** @type {string} */
let adminToken = '';

async function adminAuth() {
    const body = await apiFetch(`${API_BASE}/admin/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD })
    });
    const token = String(/** @type {{ token?: string }} */ (body).token || '').trim();
    if (!token) throw new Error('Admin auth did not return token');
    adminToken = token;
}

async function seed() {
    await adminAuth();
    const auth = authHeaders();
    for (const binding of VIC_G_EPISODE_BINDINGS) {
        const guide = LA_PRODUCTION_EPISODES.find((ep) => ep.episodeNumber === binding.episodeNumber);
        const payload = {
            seriesId: VIC_G_SERIES_ID,
            seasonNumber: 1,
            episodeNumber: binding.episodeNumber,
            id: binding.episodeId,
            title: guide?.title || `Episode ${binding.episodeNumber}`,
            description: guide?.description || '',
            status: 'published',
            reelId: binding.reelId,
            tags: ['creator-package', 'creator-confirmed']
        };
        if (DRY_RUN) {
            log(`DRY_RUN episode E${binding.episodeNumber}: ${JSON.stringify(payload)}`);
            continue;
        }
        log(`Upsert episode ${binding.episodeId} (E${binding.episodeNumber}: ${payload.title})`);
        await apiFetch(`${API_BASE}/api/episodes`, {
            method: 'POST',
            headers: auth,
            body: JSON.stringify(payload)
        });
    }

    const seriesPayload = {
        title: VIC_G_SERIES_TITLE,
        description: LA_PRODUCTION_SYNOPSIS,
        poster: POSTER_URL,
        accessMode: ACCESS_MODE,
        freeEpisodeCount: FREE_EPISODE_COUNT,
        tags: ['creator-package', 'creator-confirmed'],
        seasons: [{ seasonId: SEASON_ID, seasonNumber: 1, title: 'Season 1' }]
    };
    if (DRY_RUN) {
        log(`DRY_RUN series: ${JSON.stringify(seriesPayload, null, 2)}`);
        return;
    }
    log(`Update series ${VIC_G_SERIES_ID} (${ACCESS_MODE}, free=${FREE_EPISODE_COUNT})`);
    await apiFetch(`${API_BASE}/api/series/${encodeURIComponent(VIC_G_SERIES_ID)}`, {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify(seriesPayload)
    });
}

/** @param {unknown} series */
function verify(series) {
    if (!series || typeof series !== 'object') throw new Error('series-vic-g missing from API');
    const rec = /** @type {Record<string, unknown>} */ (series);
    const accessMode = String(rec.accessMode || rec.access_mode || '').toUpperCase();
    const freeCount = Number(rec.freeEpisodeCount ?? rec.free_episode_count ?? FREE_EPISODE_COUNT);
    if (accessMode !== ACCESS_MODE) {
        throw new Error(`Expected accessMode ${ACCESS_MODE}, got ${accessMode || '—'}`);
    }
    if (!Number.isFinite(freeCount) || freeCount !== FREE_EPISODE_COUNT) {
        throw new Error(
            `Expected freeEpisodeCount ${FREE_EPISODE_COUNT}, got ${rec.freeEpisodeCount ?? rec.free_episode_count ?? '—'}`
        );
    }
    const poster = String(rec.poster || '');
    if (!poster.includes('vic-g-face-poster') && !poster.includes('/thumbs/')) {
        throw new Error(`Expected face poster path, got ${poster || '—'}`);
    }
    const seasons = /** @type {Array<{ episodes?: unknown[] }>} */ (rec.seasons || []);
    const episodes = seasons.flatMap((s) => s.episodes || []);
    if (episodes.length < 6) {
        throw new Error(`Expected 6 episodes, got ${episodes.length}`);
    }
    for (const n of [1, 2]) {
        const guide = LA_PRODUCTION_EPISODES.find((ep) => ep.episodeNumber === n);
        const ep = /** @type {Record<string, unknown>} */ (
            episodes.find((row) => Number(/** @type {{ episodeNumber?: number }} */ (row).episodeNumber) === n)
        );
        if (!ep) throw new Error(`Episode ${n} missing`);
        const title = String(ep.title || '').trim();
        if (title !== guide?.title) {
            throw new Error(`E${n} title expected "${guide?.title}", got "${title}"`);
        }
        const desc = String(ep.description || '');
        if (desc.length < 80) {
            throw new Error(`E${n} description too short (${desc.length} chars)`);
        }
    }
    for (const n of [3, 4, 5, 6]) {
        const ep = episodes.find((row) => Number(/** @type {{ episodeNumber?: number }} */ (row).episodeNumber) === n);
        if (!ep) throw new Error(`Paid episode E${n} missing`);
    }
    log(`PASS — ${episodes.length} episodes, ${accessMode}, free=${freeCount}, poster=${poster}`);
}

async function main() {
    log(`API ${API_BASE} verifyOnly=${VERIFY_ONLY}`);
    if (!VERIFY_ONLY) await seed();
    const series = await apiFetch(`${API_BASE}/api/series/${encodeURIComponent(VIC_G_SERIES_ID)}`);
    verify(series);
    const paymentsRes = await fetch(`${API_BASE}/api/payments/status`).catch(() => null);
    const payments = paymentsRes ? await paymentsRes.json().catch(() => ({})) : {};
    if (paymentsRes?.status === 401 || paymentsRes?.status === 403) {
        log('Payments API enabled (auth required for status)');
    } else if (payments?.enabled) {
        log(`Payments API enabled (publishableKey=${payments.publishableKeyConfigured ? 'yes' : 'no'})`);
    } else {
        log(`WARN: Payments API disabled — ${payments?.hint || payments?.error || 'unknown'}`);
    }
}

main().catch((err) => {
    console.error(`[seed-vic-g-pricing] FAIL: ${err.message || err}`);
    process.exit(1);
});
