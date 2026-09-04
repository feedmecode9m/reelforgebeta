#!/usr/bin/env node
/**
 * Explicit legacy Hero restoration — admin PUT only. No catalog inference.
 *
 * Usage:
 *   REELFORGE_ADMIN_TOKEN=… node scripts/restore-production-hero-presentation.mjs
 *
 * Optional:
 *   REELFORGE_API_URL=https://reelforge-deploy-production.up.railway.app
 *   LEGACY_FEATURED_SERIES="EPISODE 1 - ARRIVAL"
 */
import {
    buildLegacyHeroRestorationPatch,
    LEGACY_HERO_RESTORATION_TARGETS
} from '../src/lib/hero/legacyHeroPresentationRestore.js';
import { buildServerPresentationPayload } from '../src/lib/hero/heroPresentationCore.js';

const API_BASE = String(
    process.env.REELFORGE_API_URL ||
        process.env.VITE_API_URL ||
        'https://reelforge-deploy-production.up.railway.app'
).replace(/\/$/, '');

const ADMIN_TOKEN = String(process.env.REELFORGE_ADMIN_TOKEN || '').trim();
const FEATURED_SERIES =
    String(process.env.LEGACY_FEATURED_SERIES || '').trim() ||
    LEGACY_HERO_RESTORATION_TARGETS[0]?.featuredSeries ||
    'EPISODE 1 - ARRIVAL';

/** @param {string} path */
async function apiGet(path) {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return res.json();
}

/** @param {string} path @param {Record<string, unknown>} body */
async function apiPut(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${ADMIN_TOKEN}`
        },
        body: JSON.stringify(body)
    });
    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = { raw: text };
    }
    if (!res.ok) {
        throw new Error(`PUT ${path} → ${res.status}: ${text.slice(0, 240)}`);
    }
    return data;
}

async function main() {
    console.log('[restore-production-hero] explicit legacy restoration');
    console.log('[restore-production-hero] API', API_BASE);
    console.log('[restore-production-hero] featuredSeries', FEATURED_SERIES);

    const remote = await apiGet('/api/hero/presentation');
    const reels = await apiGet('/api/reels');
    if (!Array.isArray(reels)) {
        throw new Error('Expected array from GET /api/reels');
    }

    const restoration = buildLegacyHeroRestorationPatch({
        remote,
        patch: {
            ...remote,
            ...(remote.presentation && typeof remote.presentation === 'object'
                ? remote.presentation
                : {}),
            heroAssetId: remote.heroAssetId,
            mediaUrl: remote.mediaUrl,
            posterUrl: remote.posterUrl,
            heroTitle: remote.heroTitle,
            heroSubtitle: remote.heroSubtitle,
            heroDescription: remote.heroDescription,
            backgroundSource: remote.backgroundSource,
            backgroundStyle: remote.backgroundStyle,
            featuredSeries: FEATURED_SERIES
        },
        reels,
        featuredSeries: FEATURED_SERIES
    });

    if (!restoration.ok) {
        console.error('[restore-production-hero] FAIL CLOSED', {
            error: restoration.error,
            details: restoration.details || null,
            target: restoration.target || null
        });
        process.exit(1);
    }

    const payload = buildServerPresentationPayload(restoration.patch);
    console.log('[restore-production-hero] declared canonical PUT payload', {
        heroAssetId: payload.heroAssetId,
        heroTitle: payload.heroTitle,
        mediaUrl: payload.mediaUrl ? String(payload.mediaUrl).slice(0, 120) : null,
        featuredSeries: FEATURED_SERIES
    });

    if (!ADMIN_TOKEN) {
        console.log(
            '\nDry run only — set REELFORGE_ADMIN_TOKEN to apply.\n' +
                'This script PUTs exactly the declared legacy canonical Hero — no catalog search.\n'
        );
        return;
    }

    const saved = await apiPut('/api/hero/presentation', payload);
    console.log('[restore-production-hero] saved', {
        heroAssetId: saved?.heroAssetId,
        heroTitle: saved?.heroTitle,
        mediaUrl: saved?.mediaUrl ? String(saved.mediaUrl).slice(0, 120) : null,
        updatedAt: saved?.updatedAt
    });
}

main().catch((error) => {
    console.error('[restore-production-hero] failed', error);
    process.exit(1);
});
