#!/usr/bin/env node
/**
 * Production handoff — deploy Vic G face poster for Original Productions browse.
 *
 * Copies creator PNG to public/thumbs and sets series-vic-g poster via Series API.
 * Episode thumbnailUrl values are untouched (stack behind face).
 *
 * Usage:
 *   VIC_G_FACE_POSTER_SOURCE=/path/to/poster.png \
 *   REELFORGE_API_BASE=https://host ADMIN_PASSWORD=secret \
 *   node scripts/seed-vic-g-face-poster.mjs
 *
 *   node scripts/seed-vic-g-face-poster.mjs --verify-only
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');

const API_BASE = String(process.env.REELFORGE_API_BASE || process.env.BACKEND_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const POSTER_SOURCE = String(process.env.VIC_G_FACE_POSTER_SOURCE || '').trim();
const POSTER_BASENAME = 'vic-g-face-poster-power-of-support.png';
const POSTER_URL = `/thumbs/${POSTER_BASENAME}`;
const SERIES_ID = 'series-vic-g';
const VERIFY_ONLY = process.argv.includes('--verify-only');
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

/** @param {string} msg */
function log(msg) {
    console.log(`[seed-vic-g-poster] ${msg}`);
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

function resolveThumbsDir() {
    const mediaRoot = process.env.MEDIA_ROOT
        ? path.resolve(process.env.MEDIA_ROOT)
        : fs.existsSync(path.join(repoRoot, 'public'))
          ? path.join(repoRoot, 'public')
          : path.join(repoRoot, 'backend', 'public');
    return path.join(mediaRoot, 'thumbs');
}

function resolveFrontendPublicThumbsDir() {
    return path.join(root, 'public', 'thumbs');
}

function copyPosterToThumbs() {
    const source =
        POSTER_SOURCE ||
        path.join(repoRoot, 'public', 'thumbs', POSTER_BASENAME);
    if (!fs.existsSync(source)) {
        throw new Error(
            `Face poster source missing: ${source}. Set VIC_G_FACE_POSTER_SOURCE to creator PNG.`
        );
    }
    const destDir = resolveThumbsDir();
    const dest = path.join(destDir, POSTER_BASENAME);
    const frontendDestDir = resolveFrontendPublicThumbsDir();
    const frontendDest = path.join(frontendDestDir, POSTER_BASENAME);
    if (DRY_RUN) {
        log(`DRY_RUN — would copy ${source} → ${dest}`);
        log(`DRY_RUN — would copy ${source} → ${frontendDest}`);
        return dest;
    }
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(source, dest);
    fs.mkdirSync(frontendDestDir, { recursive: true });
    fs.copyFileSync(source, frontendDest);
    log(`Copied poster → ${dest}`);
    log(`Copied poster → ${frontendDest}`);
    return dest;
}

/** @param {string} token @param {string} sourcePath */
async function uploadPosterToRemote(token, sourcePath) {
    const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(API_BASE);
    if (isLocal) return;
    const bytes = fs.readFileSync(sourcePath);
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'image/png' }), POSTER_BASENAME);
    const res = await fetch(`${API_BASE}/api/admin/deploy-static-thumb`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
    });
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
        throw new Error(`POST ${API_BASE}/api/admin/deploy-static-thumb → ${res.status}: ${detail}`);
    }
    log(`Uploaded poster to ${API_BASE}${/** @type {{ url?: string }} */ (body)?.url || POSTER_URL}`);
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

async function updateSeriesPoster(token) {
    const series = await apiFetch(`${API_BASE}/api/series/${encodeURIComponent(SERIES_ID)}`);
    const payload = {
        title: String(series?.title || 'Vic G'),
        description: String(series?.description || '').trim() || undefined,
        poster: POSTER_URL,
        tags: Array.isArray(series?.tags) ? series.tags : ['creator-package', 'creator-confirmed']
    };
    if (DRY_RUN) {
        log('DRY_RUN — series payload:');
        console.log(JSON.stringify(payload, null, 2));
        return;
    }
    log(`Setting ${SERIES_ID} poster → ${POSTER_URL}`);
    await apiFetch(`${API_BASE}/api/series/${encodeURIComponent(SERIES_ID)}`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
}

async function verifyBrowse() {
    const series = await apiFetch(`${API_BASE}/api/series/${encodeURIComponent(SERIES_ID)}`);
    log(`API poster: ${series?.poster || 'MISSING'}`);
    const episodes = series?.seasons?.[0]?.episodes || [];
    log(`Published episodes: ${episodes.filter((ep) => ep?.status === 'published').length}`);

    const catalog = await apiFetch(`${API_BASE}/api/series`);
    const vite = await createServer({
        root,
        logLevel: 'error',
        server: { middlewareMode: true },
        appType: 'custom'
    });
    try {
        const browse = await vite.ssrLoadModule('/src/lib/series/viewerSeriesBrowseCatalog.js');
        const result = browse.buildViewerSeriesBrowseCatalog(catalog);
        const vic = result.all?.find((row) => row.seriesId === SERIES_ID);
        log(`Browse posterSrc: ${vic?.posterSrc || 'MISSING'}`);
        log(`Browse episodeCount: ${vic?.episodeCount ?? 0}`);
        if (vic?.posterSrc !== POSTER_URL) {
            throw new Error(`Expected browse poster ${POSTER_URL}, got ${vic?.posterSrc}`);
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
    copyPosterToThumbs();
    const token = await adminToken();
    const source =
        POSTER_SOURCE ||
        path.join(repoRoot, 'public', 'thumbs', POSTER_BASENAME);
    await uploadPosterToRemote(token, source);
    await updateSeriesPoster(token);
    await verifyBrowse();
    log('Vic G face poster seed complete');
}

main().catch((err) => {
    console.error('[seed-vic-g-poster] FAILED:', err?.message || err);
    process.exit(1);
});
