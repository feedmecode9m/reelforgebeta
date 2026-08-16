#!/usr/bin/env node
/**
 * HERO-ID-BRIDGE-02 — Episode/reel identity contract regression.
 * Requires backend with migration 20260725_reels_episode_id applied.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT || path.join(__dirname, '../artifacts/hero-identity-bridge-02.json');
const API_URL = (process.env.API_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const ADMIN_PASSWORDS = (process.env.ADMIN_PASSWORD || 'admin123,Gaff1505!,SMART_PRODUCTION').split(',');
const EPISODE_ID = 'ep-neon-s01e02';

const failures = [];

function assert(name, ok, detail = null) {
    const status = ok ? 'PASS' : 'FAIL';
    console.info(`[HERO_IDENTITY_BRIDGE_02_ASSERT] ${status} ${name}`, detail || '');
    if (!ok) failures.push(name);
}

async function apiLogin() {
    for (const pw of ADMIN_PASSWORDS) {
        const res = await fetch(`${API_URL}/admin/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw.trim() })
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.token) return body.token;
    }
    throw new Error('API login failed');
}

function ensureTinyMp4() {
    const dir = path.join('/tmp', 'hero-id-bridge-02');
    fs.mkdirSync(dir, { recursive: true });
    const mp4 = path.join(dir, 'bridge-02-test-3s.mp4');
    if (!fs.existsSync(mp4)) {
        try {
            execFileSync(
                'ffmpeg',
                [
                    '-y',
                    '-hide_banner',
                    '-loglevel',
                    'error',
                    '-f',
                    'lavfi',
                    '-i',
                    'testsrc=size=160x120:rate=24:duration=3',
                    '-c:v',
                    'libx264',
                    '-pix_fmt',
                    'yuv420p',
                    '-movflags',
                    '+faststart',
                    mp4
                ],
                { stdio: 'pipe' }
            );
        } catch (err) {
            throw new Error(`ffmpeg fixture failed: ${err.stderr?.toString() || err.message}`);
        }
    }
    return mp4;
}

function resolveReelForEpisode(episodeId, feedReels) {
    return feedReels.find((reel) => {
        const linked = reel?.episodeId || reel?.episode_id;
        return linked && String(linked) === episodeId;
    }) || null;
}

async function waitForReadyReel(token, reelId, timeoutMs = 120000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const res = await fetch(`${API_URL}/api/reels/${reelId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
            const body = await res.json();
            if (body.status === 'ready' && body.validated !== false) return body;
            if (body.status === 'failed') throw new Error(body.errorMessage || 'reel failed');
        }
        await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error(`Timed out waiting for reel ${reelId}`);
}

async function main() {
    const token = await apiLogin();
    const mp4 = ensureTinyMp4();
    const form = new FormData();
    const blob = new Blob([fs.readFileSync(mp4)], { type: 'video/mp4' });
    form.append('video', blob, 'hero-bridge-02.mp4');
    form.append('episodeId', EPISODE_ID);
    form.append('title', 'Hero Bridge 02 Test');
    form.append('category', 'Trending');

    const createRes = await fetch(`${API_URL}/api/reels`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
    });
    const created = await createRes.json().catch(() => ({}));
    assert('post_api_reels_accepts_episodeId', createRes.ok || createRes.status === 202, {
        status: createRes.status,
        body: created
    });
    const reelId = String(created.id || '');
    assert('post_api_reels_returns_uuid', /^[0-9a-f-]{36}$/i.test(reelId), { reelId });

    if (reelId) {
        const statusRes = await fetch(`${API_URL}/api/reels/${reelId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const statusBody = await statusRes.json().catch(() => ({}));
        assert('get_api_reel_by_id_returns_episodeId', statusBody.episodeId === EPISODE_ID, {
            reelId,
            episodeId: statusBody.episodeId
        });

        await waitForReadyReel(token, reelId).catch((err) => {
            assert('reel_reaches_ready', false, { error: err.message });
        });
    }

    const listRes = await fetch(`${API_URL}/api/reels?status=ready`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const reels = await listRes.json().catch(() => []);
    const bound = Array.isArray(reels)
        ? reels.find((r) => String(r.id) === reelId)
        : null;
    assert('get_api_reels_returns_episodeId', bound?.episodeId === EPISODE_ID, {
        reelId,
        episodeId: bound?.episodeId
    });

    const resolved = resolveReelForEpisode(EPISODE_ID, reels);
    assert('resolveReelForEpisode_finds_bound_reel', resolved?.id === reelId, {
        expectedReelId: reelId,
        resolvedId: resolved?.id || null
    });
    assert('resolveReelForEpisode_has_media_url', Boolean(resolved?.url), {
        url: resolved?.url || null
    });

    const summary = {
        mission: 'HERO-ID-BRIDGE-02',
        apiUrl: API_URL,
        episodeId: EPISODE_ID,
        reelId,
        boundEpisodeId: bound?.episodeId || null,
        resolvedReelId: resolved?.id || null,
        resolvedMediaUrl: resolved?.url || null,
        allPass: failures.length === 0,
        failures
    };

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
    console.info('[HERO_IDENTITY_BRIDGE_02_SUMMARY]', summary);
    console.log(`Wrote ${OUT}`);

    if (failures.length) process.exit(1);
}

main().catch((err) => {
    console.error('[HERO_IDENTITY_BRIDGE_02_ERROR]', err);
    process.exit(1);
});
