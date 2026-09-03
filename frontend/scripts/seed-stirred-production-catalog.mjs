#!/usr/bin/env node
/**
 * PRODUCTION ONLY — seed STIRRED catalog for Original Productions browse.
 *
 * Idempotent upsert via Series API. Resolves reel id from env or /api/reels name match.
 * Enforces STIRRED poster = own MP4 still (never Vic G face poster).
 *
 * Usage:
 *   REELFORGE_API_BASE=https://prod-host ADMIN_PASSWORD=secret node scripts/seed-stirred-production-catalog.mjs
 *   REELFORGE_API_BASE=https://prod-host node scripts/seed-stirred-production-catalog.mjs --verify-only
 *
 * Optional env:
 *   STIRRED_REEL_ID       — skip reel discovery
 *   STIRRED_SERIES_ID     — default series-stirred; production may use series-stirred-gate
 *   STIRRED_EPISODE_ID    — default ep-stirred-s01e01; production gate ep-series-stirred-gate-s1e4
 *   DRY_RUN=1             — print payloads, no writes
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const API_BASE = String(process.env.REELFORGE_API_BASE || process.env.BACKEND_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const REEL_ID_OVERRIDE = String(process.env.STIRRED_REEL_ID || '').trim();
const REEL_NAME_MATCH = String(process.env.STIRRED_REEL_NAME || 'STIRRED').trim();
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const VERIFY_ONLY = process.argv.includes('--verify-only');

/** Vic G face poster — must never be assigned to series-stirred (production incident). */
const VIC_G_FACE_POSTER_FRAGMENT = 'vic-g-face-poster-power-of-support';

const SERIES_ID = String(process.env.STIRRED_SERIES_ID || 'series-stirred').trim();
const EPISODE_ID = String(process.env.STIRRED_EPISODE_ID || 'ep-stirred-s01e01').trim();
const SEASON_ID = String(process.env.STIRRED_SEASON_ID || `season-${SERIES_ID.replace(/^series-/, '')}-1`).trim();
const GENRE = 'Drama';
const REEL_SHELF_CATEGORY = 'Suspense';

/** Authoritative copy from Stirred.pdf + STIRRED_Ep1_9x16_DP_Shot_List.pdf (Minaya Wright). */
const SEASON_TITLE = 'Season 1';
const SEASON_DESCRIPTION =
    "Billie's catering world in Atlanta — from the flashback that ended her first love with Case to the career-making event that could change everything. Episode 1 spans four scenes: apartment flashback montage, late-night van prep at Billie's Café & Catering with Sid, restless night with Kevin, and a dawn scramble when Billie wakes alone. Visual style: intimate, character-driven. 9:16 vertical.";

const EPISODE_DESCRIPTION =
    "Written by Minaya Wright. Years after a painful breakup with her first love Case, chef Billie pours everything into Billie's Café & Catering in Atlanta. A flashback montage replays their final fight — Case insisting he gave her everything, Billie needing him to be present — before the title card: Several Years Later. On the eve of a career-making event, Billie loads the van late at night while sous-chef Sid brings coffee; their hands brush on the lock and something flickers. Back home she can't sleep — memories of Case swirl, then unexpectedly Sid's face. She lets Kevin in from a dating app; when dawn hits at 2:47 A.M. she jolts awake alone and races against the clock. Intimate, character-driven vertical drama. Aspect ratio 9:16. Camera: handheld for memory/chaos, stable for control, handheld for anxiety.";

const SERIES_DESCRIPTION =
    "STIRRED — an intimate vertical drama written by Minaya Wright. Billie (late 20s, talented, exhausted, magnetic) owns Billie's Café & Catering in Atlanta. Sid (30s, creatively talented sous-chef) is her best friend; Kevin (30s, handsome, emotionally unavailable) is her usual hook-up; Case (late 20s) is the first love she can't forget. Torn between Case's ghost and Sid's steady pull, Billie chases the event that could change everything — while old habits and sleepless nights keep pulling her back. Visual style: intimate, character-driven. Shot 9:16 vertical.";

const EPISODE_TAGS = [
    'creator-confirmed',
    'creator-package',
    'STIRRED',
    'Episode 1',
    'drama',
    'Atlanta',
    'chef',
    'catering',
    "Billie's Café",
    'vertical',
    '9:16',
    'character-driven',
    'flashback',
    'handheld',
    'Billie',
    'Sid',
    'Case',
    'Kevin',
    'Minaya Wright'
];

const SERIES_TAGS = [
    'creator-confirmed',
    'creator-package',
    'STIRRED',
    'drama',
    'Atlanta',
    'vertical',
    '9:16',
    'character-driven',
    'Billie',
    'Sid',
    'Case',
    'Kevin',
    'Minaya Wright'
];

/** @param {string} msg */
function log(msg) {
    console.log(`[seed-stirred] ${msg}`);
}

/** @param {unknown} poster */
function assertNotVicGPoster(poster) {
    const value = String(poster || '');
    if (value.includes(VIC_G_FACE_POSTER_FRAGMENT)) {
        throw new Error(
            `STIRRED poster must not use Vic G face art (${VIC_G_FACE_POSTER_FRAGMENT}). Use STIRRED MP4 still /thumbs/{reelId}.jpg`
        );
    }
}

/** @param {unknown} text */
function assertNoGateFixturePollution(text) {
    const value = String(text || '');
    if (/GATE_DESC_A/i.test(value)) {
        throw new Error('STIRRED description still contains GATE_DESC_A fixture — re-seed from production handoff');
    }
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

async function adminToken() {
    const body = await apiFetch(`${API_BASE}/admin/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD })
    });
    const token = body && typeof body === 'object' && 'token' in body ? String(body.token) : '';
    if (!token) throw new Error('Admin auth did not return token');
    return token;
}

/** @returns {Promise<{ id: string; name: string; thumbnailPath?: string }>} */
async function resolveReelId() {
    if (REEL_ID_OVERRIDE) {
        return { id: REEL_ID_OVERRIDE, name: REEL_ID_OVERRIDE };
    }
    const reels = await apiFetch(`${API_BASE}/api/reels`);
    if (!Array.isArray(reels)) throw new Error('GET /api/reels did not return array');
    const match = reels.find((row) => {
        const name = String(row?.name || row?.title || '').toUpperCase();
        return name.includes(REEL_NAME_MATCH.toUpperCase());
    });
    if (!match?.id) {
        throw new Error(
            `No reel matching "${REEL_NAME_MATCH}" in ${API_BASE}/api/reels — upload MP4 first or set STIRRED_REEL_ID`
        );
    }
    return {
        id: String(match.id),
        name: String(match.name || match.title || match.id),
        thumbnailPath: match.thumbnailPath ? String(match.thumbnailPath) : undefined
    };
}

/** @param {string} reelId @param {string | undefined} thumbnailPath */
function posterPathForReel(reelId, thumbnailPath) {
    if (thumbnailPath && thumbnailPath.startsWith('/thumbs/')) return thumbnailPath;
    return `/thumbs/${reelId}.jpg`;
}

/** @param {string} reelId @param {string} posterPath @param {string} token */
async function seedCatalog(reelId, posterPath, token) {
    assertNotVicGPoster(posterPath);
    const auth = { Authorization: `Bearer ${token}` };

    const episodePayload = {
        seriesId: SERIES_ID,
        seasonNumber: 1,
        episodeNumber: 1,
        id: EPISODE_ID,
        title: 'Episode 1',
        description: EPISODE_DESCRIPTION,
        status: 'published',
        reelId,
        thumbnailUrl: posterPath,
        genre: GENRE,
        tags: EPISODE_TAGS
    };

    const seriesPayload = {
        title: 'STIRRED',
        description: SERIES_DESCRIPTION,
        genre: GENRE,
        poster: posterPath,
        tags: SERIES_TAGS,
        seasons: [
            {
                seasonId: SEASON_ID,
                seasonNumber: 1,
                title: SEASON_TITLE,
                description: SEASON_DESCRIPTION
            }
        ]
    };

    if (DRY_RUN) {
        log('DRY_RUN — episode payload:');
        console.log(JSON.stringify(episodePayload, null, 2));
        log('DRY_RUN — series payload:');
        console.log(JSON.stringify(seriesPayload, null, 2));
        return;
    }

    log(`Upserting episode ${EPISODE_ID} → reel ${reelId}`);
    await apiFetch(`${API_BASE}/api/episodes`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(episodePayload)
    });

    log(`Updating series ${SERIES_ID} (poster=${posterPath})`);
    await apiFetch(`${API_BASE}/api/series/${encodeURIComponent(SERIES_ID)}`, {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(seriesPayload)
    });

    log(`Setting reel shelf category ${REEL_SHELF_CATEGORY} (${reelId})`);
    await apiFetch(`${API_BASE}/api/reels/${encodeURIComponent(reelId)}/category`, {
        method: 'PATCH',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: REEL_SHELF_CATEGORY })
    });
}

/** @param {unknown} series @param {unknown} episode @param {unknown} [season] */
function verifySeriesRow(series, episode, season) {
    assertNotVicGPoster(series?.poster);
    assertNotVicGPoster(episode?.thumbnailUrl);
    assertNoGateFixturePollution(series?.description);
    assertNoGateFixturePollution(episode?.description);
    if (String(series?.genre || '') !== GENRE) {
        throw new Error(`Expected series genre ${GENRE}, got ${series?.genre || '—'}`);
    }
    if (String(episode?.genre || '') !== GENRE) {
        throw new Error(`Expected episode genre ${GENRE}, got ${episode?.genre || '—'}`);
    }
    if (String(series?.title || '') !== 'STIRRED') {
        throw new Error(`Expected series title STIRRED, got ${series?.title || '—'}`);
    }
    for (const [label, text] of [
        ['series description', series?.description],
        ['episode description', episode?.description],
        ['season description', season?.description]
    ]) {
        const value = String(text || '').trim();
        if (value.length < 120) {
            throw new Error(`${label} too short (${value.length} chars) — re-seed from Stirred.pdf`);
        }
        if (/GATE_DESC|Themes detected: vic|This story highlights vic/i.test(value)) {
            throw new Error(`${label} still contains stale gate/NLP pollution`);
        }
    }
    const tagBlob = [...(series?.tags || []), ...(episode?.tags || [])].join(' ').toLowerCase();
    if (/\bromance\b/.test(tagBlob) && !/\bdrama\b/.test(tagBlob)) {
        throw new Error('STIRRED tags should lead with drama, not romance');
    }
}

async function verifyBrowse() {
    const catalog = await apiFetch(`${API_BASE}/api/series`);
    if (!Array.isArray(catalog)) throw new Error('GET /api/series did not return array');

    const series = catalog.find((row) => row?.id === SERIES_ID);
    const season = series?.seasons?.[0];
    const episode = season?.episodes?.[0];
    log(`API series: ${series?.title || 'MISSING'} genre=${series?.genre || '—'}`);
    log(`API season: ${season?.title || 'MISSING'} desc=${String(season?.description || '').slice(0, 60)}…`);
    log(`API episode: ${episode?.episodeId || episode?.id || 'MISSING'} status=${episode?.status || '—'} genre=${episode?.genre || '—'}`);
    log(`API poster: ${series?.poster || episode?.thumbnailUrl || '—'}`);

    verifySeriesRow(series, episode, season);

    const gateRow = catalog.find((row) => String(row?.id || '').includes('stirred-gate'));
    if (gateRow) {
        log(`WARN: legacy series-stirred-gate still in API — retire in favor of ${SERIES_ID}`);
    }

    const vite = await createServer({
        root,
        logLevel: 'error',
        server: { middlewareMode: true },
        appType: 'custom'
    });
    try {
        const browse = await vite.ssrLoadModule('/src/lib/series/viewerSeriesBrowseCatalog.js');
        const result = browse.buildViewerSeriesBrowseCatalog(catalog);
        const inOriginal = result.sections?.original?.some((row) => row.seriesId === SERIES_ID);
        const row = result.all?.find((r) => r.seriesId === SERIES_ID);
        log(`Browse Original Productions includes STIRRED: ${inOriginal ? 'yes' : 'no'}`);
        if (!inOriginal) {
            throw new Error('STIRRED not in Original Productions browse projection');
        }
        if (row) {
            assertNotVicGPoster(row.posterSrc);
            log(`Browse posterSrc: ${row.posterSrc}`);
            log(`Browse genre: ${row.genre || '—'}`);
            log(`Browse path: ${row.path}`);
        }
    } finally {
        await vite.close();
    }
}

async function main() {
    log(`API base: ${API_BASE}`);
    if (VERIFY_ONLY) {
        await verifyBrowse();
        log('Verify-only OK');
        return;
    }

    const reel = await resolveReelId();
    const posterPath = posterPathForReel(reel.id, reel.thumbnailPath);
    log(`Reel: ${reel.name} (${reel.id})`);
    log(`Poster: ${posterPath}`);

    const token = await adminToken();
    await seedCatalog(reel.id, posterPath, token);
    await verifyBrowse();
    log('STIRRED production catalog seed complete');
}

main().catch((err) => {
    console.error('[seed-stirred] FAILED:', err?.message || err);
    process.exit(1);
});
