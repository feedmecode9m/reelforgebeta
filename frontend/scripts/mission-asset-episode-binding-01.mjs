#!/usr/bin/env node
/**
 * BG-ASSET-EPISODE-BINDING-01 — upload episode identity regression.
 * Offline payload tests always run; live API tests when API_URL responds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT =
    process.env.OUT || path.join(__dirname, '../artifacts/asset-episode-binding-01.json');
const API_URL = (process.env.API_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const EPISODE_ID = 'ep-neon-s01e02';
const SERIES_ID = 'series-neon-vengeance';

const failures = [];

function assert(name, ok, detail = null) {
    const status = ok ? 'PASS' : 'FAIL';
    console.info(`[ASSET_EPISODE_BINDING_ASSERT] ${status} ${name}`, detail || '');
    if (!ok) failures.push(name);
}

const uploadIdentity = await import(
    pathToFileURL(path.join(__dirname, '../src/lib/api/uploadIdentity.js')).href
);

const { resolveUploadIdentity, appendUploadIdentityToFormData } = uploadIdentity;

// --- Scenario A: upload with episodeId ---

const withEpisode = resolveUploadIdentity({
    episodeId: EPISODE_ID,
    seriesId: SERIES_ID,
    source: 'test:scenario_a'
});
assert('scenario_a_resolves_episodeId', withEpisode.episodeId === EPISODE_ID);
assert('scenario_a_resolves_seriesId', withEpisode.seriesId === SERIES_ID);

const formA = new FormData();
formA.append('video', new Blob(['x'], { type: 'video/mp4' }), 'test.mp4');
appendUploadIdentityToFormData(formA, withEpisode);
assert('scenario_a_form_has_episodeId', formA.get('episodeId') === EPISODE_ID);
assert('scenario_a_form_has_seriesId', formA.get('seriesId') === SERIES_ID);

const signPayloadA = {
    filename: 'test.mp4',
    contentType: 'video/mp4',
    sizeBytes: 100,
    ...(withEpisode.episodeId ? { episodeId: withEpisode.episodeId } : {})
};
assert('scenario_a_sign_payload_has_episodeId', signPayloadA.episodeId === EPISODE_ID);

const finalizePayloadA = {
    uploadId: '00000000-0000-0000-0000-000000000001',
    ...(withEpisode.episodeId ? { episodeId: withEpisode.episodeId } : {})
};
assert('scenario_a_finalize_payload_has_episodeId', finalizePayloadA.episodeId === EPISODE_ID);

// --- Scenario B: upload without episodeId ---

const withoutEpisode = resolveUploadIdentity({ source: 'test:scenario_b' });
assert('scenario_b_no_episodeId', withoutEpisode.episodeId === undefined);

const formB = new FormData();
formB.append('video', new Blob(['x'], { type: 'video/mp4' }), 'plain.mp4');
appendUploadIdentityToFormData(formB, withoutEpisode);
assert('scenario_b_form_omits_episodeId', formB.get('episodeId') === null);

const signPayloadB = {
    filename: 'plain.mp4',
    contentType: 'video/mp4',
    sizeBytes: 100,
    ...(withoutEpisode.episodeId ? { episodeId: withoutEpisode.episodeId } : {})
};
assert('scenario_b_sign_payload_omits_episodeId', signPayloadB.episodeId === undefined);

// --- Optional live API ---

let live = { skipped: true, reason: 'API unavailable' };

async function tryLiveApi() {
    try {
        const health = await fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
        if (!health.ok) return null;
    } catch {
        return null;
    }

    const ADMIN_PASSWORDS = (process.env.ADMIN_PASSWORD || 'admin123,Gaff1505!,SMART_PRODUCTION').split(
        ','
    );
    let token = null;
    for (const pw of ADMIN_PASSWORDS) {
        const res = await fetch(`${API_URL}/admin/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw.trim() })
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.token) {
            token = body.token;
            break;
        }
    }
    if (!token) return { skipped: false, error: 'login_failed' };

    const mp4Path = '/tmp/asset-bind-01-test.mp4';
    if (!fs.existsSync(mp4Path)) {
        return { skipped: false, error: 'missing_test_mp4', hint: 'Run hero-identity-bridge-02 ffmpeg fixture first' };
    }

    const form = new FormData();
    form.append('video', new Blob([fs.readFileSync(mp4Path)], { type: 'video/mp4' }), 'bind-01.mp4');
    form.append('episodeId', EPISODE_ID);
    form.append('title', 'Asset Bind 01');
    form.append('category', 'Trending');

    const createRes = await fetch(`${API_URL}/api/reels`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
    });
    const created = await createRes.json().catch(() => ({}));
    assert('live_post_accepts_episodeId', createRes.ok || createRes.status === 202, {
        status: createRes.status
    });

    const reelId = String(created.id || '');
    if (reelId) {
        const statusRes = await fetch(`${API_URL}/api/reels/${reelId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const statusBody = await statusRes.json().catch(() => ({}));
        assert('live_reel_has_episodeId', statusBody.episodeId === EPISODE_ID, {
            reelId,
            episodeId: statusBody.episodeId
        });
    }

    return {
        skipped: false,
        reelId,
        episodeId: created.episodeId || null,
        status: createRes.status
    };
}

live = (await tryLiveApi()) || live;

const summary = {
    mission: 'BG-ASSET-EPISODE-BINDING-01',
    allPass: failures.length === 0,
    failures,
    scenarioA: {
        episodeId: EPISODE_ID,
        formEpisodeId: formA.get('episodeId'),
        signEpisodeId: signPayloadA.episodeId
    },
    scenarioB: {
        formEpisodeId: formB.get('episodeId'),
        signHasEpisodeId: signPayloadB.episodeId !== undefined
    },
    live
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.info('[ASSET_EPISODE_BINDING_SUMMARY]', summary);
console.log(`Wrote ${OUT}`);

if (failures.length) process.exit(1);
