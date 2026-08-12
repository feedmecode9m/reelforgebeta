#!/usr/bin/env node
/**
 * Theater playback derivative contract (read-only).
 *
 * 1) resolvePlayableMediaUrl(reel, 'theater') prefers ready playbackUrl
 * 2) master fallback when derivative not ready
 * 3) production /api/reels inventory shape (optional live; never mutates)
 * 4) backend repair CLI + shared materialize module still present
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    resolvePlayableMediaUrl,
    isPlaybackDerivativeReady,
    getMasterMediaUrl
} from '../src/lib/media/resolvePlayableMediaUrl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(frontendRoot, '..');

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const notes = [];

function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else notes.push(`ok: ${msg}`);
}

function readRepo(rel) {
    return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

// --- Unit: theater resolver contract ---
{
    const ready = {
        id: 'unit-ready',
        url: 'https://cdn.example/prod/master.mp4',
        playbackUrl: 'https://cdn.example/prod/unit.playback.mp4',
        playbackStatus: 'ready'
    };
    const got = resolvePlayableMediaUrl(ready, 'theater', { silent: true });
    assert(
        got === ready.playbackUrl,
        'theater returns playbackUrl when playbackStatus=ready'
    );
    assert(isPlaybackDerivativeReady(ready), 'isPlaybackDerivativeReady true for ready pair');
    assert(
        getMasterMediaUrl(ready) === ready.url,
        'master url preserved alongside ready derivative'
    );
}

{
    const missing = {
        id: 'unit-missing',
        url: 'https://cdn.example/prod/master.mp4'
    };
    assert(
        resolvePlayableMediaUrl(missing, 'theater', { silent: true }) === missing.url,
        'theater falls back to master when no derivative fields'
    );
}

{
    const failed = {
        id: 'unit-failed',
        url: 'https://cdn.example/prod/master.mp4',
        playbackUrl: 'https://cdn.example/prod/stale.playback.mp4',
        playbackStatus: 'failed'
    };
    assert(
        resolvePlayableMediaUrl(failed, 'theater', { silent: true }) === failed.url,
        'theater falls back to master when playbackStatus=failed'
    );
}

{
    const processing = {
        id: 'unit-processing',
        url: 'https://cdn.example/prod/master.mp4',
        playback_url: 'https://cdn.example/prod/proc.playback.mp4',
        playback_status: 'processing'
    };
    assert(
        resolvePlayableMediaUrl(processing, 'theater', { silent: true }) === processing.url,
        'theater ignores non-ready snake_case derivative'
    );
}

// Wiring: TheaterExperience still selects via theater context
const theaterExp = readRepo('frontend/src/components/theater/TheaterExperience.svelte');
assert(
    /resolvePlayableMediaUrl\(\$activeReel,\s*['"]theater['"]\)/.test(theaterExp) ||
        /resolveTheaterAttachUrl\(\$activeReel\)/.test(theaterExp),
    'TheaterExperience primary URL uses resolvePlayableMediaUrl(..., theater)'
);
// Phase 4: preload remains metadata until derivative path proven live
assert(
    /preload=["']metadata["']/.test(theaterExp),
    'Theater preload still metadata (no premature preload=auto)'
);

// Backend pipeline modules
const playbackDeriv = readRepo('backend/src/ingestion/playback_derivative.rs');
assert(/materialize_playback_derivative/.test(playbackDeriv), 'shared materialize_playback_derivative');
assert(/STATUS_READY/.test(playbackDeriv), 'ready status constant');
assert(
    /not marking ready|STATUS_FAILED/.test(playbackDeriv) &&
        /r2_upload failed/.test(playbackDeriv),
    'R2 upload failure does not mark ready'
);
assert(/SkippedAlreadyReady|already ready/.test(playbackDeriv), 'idempotent skip when ready');

const repair = readRepo('backend/src/ingestion/playback_repair.rs');
assert(/--dry-run/.test(repair), 'playback-repair dry-run mode');
assert(/REELFORGE_PLAYBACK_REPAIR_APPLY/.test(repair), 'apply gated by env flag');
assert(/--apply/.test(repair), 'playback-repair --apply path exists');

const worker = readRepo('backend/src/ingestion/worker.rs');
assert(
    /playback_derivative::materialize_playback_derivative/.test(worker),
    'ingest worker reuses shared materialize path'
);

const mainRs = readRepo('backend/src/main.rs');
assert(
    /playback-repair/.test(mainRs) && /playback_repair::run/.test(mainRs),
    'main dispatches cargo run -- playback-repair'
);

const reelsDb = readRepo('backend/src/db/reels.rs');
assert(
    /list_all_reels_for_playback_inventory/.test(reelsDb),
    'inventory query for all reels (incl incomplete)'
);

// Production API (read-only inventory) — does not require secrets; never mutates.
const API =
    process.env.REELFORGE_API_BASE?.replace(/\/$/, '') ||
    'https://reelforge-deploy-production.up.railway.app';

async function inventoryProduction() {
    const url = `${API}/api/reels`;
    const res = await fetch(url, { method: 'GET' });
    assert(res.ok, `GET ${url} responds ${res.status}`);
    const reels = await res.json();
    assert(Array.isArray(reels), 'GET /api/reels returns array');

    let readyMasterNoPlayback = 0;
    let readyPlayback = 0;
    let incompletePlayback = 0;
    let nonVideo = 0;
    /** @type {string[]} */
    const sampleMissing = [];

    for (const r of reels) {
        const master = String(r.url || '').trim();
        const pb = String(r.playbackUrl || r.playback_url || '').trim();
        const st = String(r.playbackStatus || r.playback_status || '')
            .trim()
            .toLowerCase();
        const videoish =
            /\.mp4($|\?)/i.test(master) ||
            /\.mov($|\?)/i.test(master) ||
            master.includes('/videos/');
        if (!videoish) {
            nonVideo += 1;
            continue;
        }
        if (st === 'ready' && pb) {
            readyPlayback += 1;
            // Live contract: resolver must return derivative when API fields present.
            const selected = resolvePlayableMediaUrl(
                {
                    url: master,
                    playbackUrl: pb,
                    playbackStatus: st
                },
                'theater',
                { silent: true }
            );
            assert(
                selected === pb,
                `prod reel ${r.id} with ready playback maps to derivative in theater`
            );
        } else if (st && st !== 'ready') {
            incompletePlayback += 1;
        } else {
            readyMasterNoPlayback += 1;
            if (sampleMissing.length < 5) sampleMissing.push(String(r.id));
            const selected = resolvePlayableMediaUrl(
                { url: master, playbackUrl: pb || undefined, playbackStatus: st || undefined },
                'theater',
                { silent: true }
            );
            assert(
                selected === master,
                `prod reel ${r.id} without ready derivative falls back to master`
            );
        }

        // Contract: master must remain on every ready reel row.
        assert(Boolean(master), `prod reel ${r.id} retains master url field`);
    }

    notes.push(
        `prod inventory ready_master_no_playback=${readyMasterNoPlayback} ready_playback=${readyPlayback} incomplete_playback=${incompletePlayback} non_video_or_image=${nonVideo} total=${reels.length}`
    );
    if (sampleMissing.length) {
        notes.push(`prod sample missing-derivative ids: ${sampleMissing.join(', ')}`);
    }

    // Field serialize: when any derivative exists, camelCase keys should appear.
    // Today production has none — still assert code contract allows them via first empty row shape check optional.
    assert(
        !reels.some((r) => r.playbackStatus === 'ready' && !r.playbackUrl && !r.playback_url),
        'no reel claims ready playback without a playbackUrl'
    );
}

await inventoryProduction().catch((err) => {
    failures.push(`production inventory fetch failed: ${err?.message || err}`);
});

if (failures.length) {
    console.error('FAIL validate-theater-derivative-contract');
    for (const f of failures) console.error('  -', f);
    process.exit(1);
}

console.log('PASS validate-theater-derivative-contract');
for (const n of notes) console.log(' ', n);
process.exit(0);
