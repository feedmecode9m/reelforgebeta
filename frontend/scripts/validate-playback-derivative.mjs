#!/usr/bin/env node
/**
 * Phase 0.5 / Phase 1 playback derivative contract + Phase 2 FE selection wiring.
 * Master url remains canonical; frontend prefers ready playbackUrl in theater/hero/vault_preview.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function read(relFromRepo) {
    return fs.readFileSync(path.join(repoRoot, relFromRepo), 'utf8');
}

function exists(relFromRepo) {
    return fs.existsSync(path.join(repoRoot, relFromRepo));
}

// --- Migration ---
assert(
    exists('backend/migrations/2026081001_playback_derivative_fields.sql'),
    'migration 2026081001_playback_derivative_fields.sql present'
);
const migration = read('backend/migrations/2026081001_playback_derivative_fields.sql');
for (const col of [
    'playback_url',
    'playback_status',
    'playback_file_size',
    'playback_profile',
    'playback_file_name'
]) {
    assert(migration.includes(col), `migration adds ${col}`);
}
assert(/ADD COLUMN IF NOT EXISTS/.test(migration), 'migration is additive IF NOT EXISTS');

// --- Transcode module ---
const transcode = read('backend/src/ingestion/transcode.rs');
assert(/PLAYBACK_PROFILE_WEB_720P_H264/.test(transcode), 'web_720p_h264 profile constant');
assert(/libx264/.test(transcode), 'H.264 encode');
assert(/aac/.test(transcode) || /AAC/.test(transcode), 'AAC audio');
assert(/yuv420p/.test(transcode), 'yuv420p pixel format');
assert(/\+faststart|faststart/.test(transcode), 'faststart enabled');
assert(/4M|maxrate/.test(transcode), 'bitrate cap ~4M');
assert(/playback_transcode_enabled/.test(transcode), 'PLAYBACK_TRANSCODE feature flag');
assert(
    /\.playback\.mp4|playback_file_name/.test(transcode),
    'derivative named reelId.playback.mp4'
);

// --- Worker integration ---
const worker = read('backend/src/ingestion/worker.rs');
assert(/attempt_playback_derivative|materialize_playback_derivative/.test(worker), 'worker calls playback derivative materialize');
assert(/mark_ready/.test(worker), 'worker still mark_ready');
assert(
    /attempt_playback_derivative[\s\S]*mark_ready|materialize_playback_derivative[\s\S]*mark_ready|playback[\s\S]*mark_ready/.test(
        worker
    ),
    'derivative attempted around ready path'
);
const playbackDerivSrc = read('backend/src/ingestion/playback_derivative.rs');
assert(
    /master remains playable|STATUS_FAILED|set_playback_derivative[\s\S]*STATUS_FAILED/.test(
        playbackDerivSrc
    ) || /master remains playable|STATUS_FAILED/.test(worker),
    'transcode failure records failed without failing ready path'
);
assert(/extract_thumbnail_at_1s|ffmpeg_thumb/.test(worker), 'thumbnail generation retained');

// --- DB helpers ---
const reelsDb = read('backend/src/db/reels.rs');
assert(/set_playback_derivative/.test(reelsDb), 'set_playback_derivative present');
assert(/playback_url/.test(reelsDb), 'ReelRow includes playback_url');
assert(
    /SET status = 'ready'[\s\S]*thumbnail_url/.test(reelsDb) ||
        /mark_ready[\s\S]*status = 'ready'/.test(reelsDb),
    'mark_ready semantics unchanged (status + thumb)'
);

// --- API contract additive only ---
const contract = read('backend/src/reel_contract.rs');
assert(/playback_url/.test(contract), 'ReelV1 includes playback_url');
assert(/playback_status/.test(contract), 'ReelV1 includes playback_status');
assert(/pub url: String/.test(contract), 'master url field still present');
assert(
    /canonical_media_url\(&video_url\)|url: db::canonical_media_url/.test(contract),
    'url still derived from video_url master'
);

// --- Storage upload ---
const r2 = read('backend/src/storage/r2.rs');
assert(/pub async fn put_file/.test(r2), 'R2 put_file for derivative upload');

// --- Delete does not ignore playback ---
const handlers = read('backend/src/handlers.rs');
assert(
    /\.playback\.mp4|playback_file_name/.test(handlers),
    'delete_reel cleans playback derivative'
);

// --- Frontend Phase 2: theater selects ready playbackUrl via resolver ---
const resolver = read('frontend/src/lib/media/resolvePlayableMediaUrl.js');
assert(
    /export function resolvePlayableMediaUrl/.test(resolver),
    'resolvePlayableMediaUrl is the single selection helper'
);
assert(/playbackStatus === ['"]ready['"]|status === ['"]ready['"]/.test(resolver), 'ready gate for derivative');
assert(/getMasterMediaUrl|master/.test(resolver), 'master fallback retained');

const theaterPlayback = read('frontend/src/lib/media/theaterPlayback.js');
assert(
    /playbackUrl|resolvePlayableMediaUrl/.test(theaterPlayback),
    'frontend theaterPlayback selects via resolvePlayableMediaUrl when ready'
);

const theaterExp = read('frontend/src/components/theater/TheaterExperience.svelte');
assert(
    /resolvePlayableMediaUrl\(\$activeReel,\s*['"]theater['"]\)/.test(theaterExp),
    'TheaterExperience primary src uses resolvePlayableMediaUrl'
);

const mediaRenderer = read('frontend/src/components/media/MediaRenderer.svelte');
assert(
    /export let autoplay = false/.test(mediaRenderer),
    'MediaRenderer autoplay default unchanged/false'
);

// --- Ownership validators still intact ---
assert(
    exists('frontend/scripts/validate-playback-stability.mjs'),
    'validate-playback-stability.mjs still present'
);
assert(
    exists('frontend/scripts/validate-theater-playback.mjs'),
    'validate-theater-playback.mjs still present'
);

// --- module export ---
const ingestMod = read('backend/src/ingestion/mod.rs');
assert(/mod transcode/.test(ingestMod), 'ingestion module exports transcode');
assert(/mod playback_derivative/.test(ingestMod), 'ingestion module exports playback_derivative');
assert(/mod playback_repair/.test(ingestMod), 'ingestion module exports playback_repair');

const shared = read('backend/src/ingestion/playback_derivative.rs');
assert(/materialize_playback_derivative/.test(shared), 'shared materialize for encode+store');
assert(
    /r2_upload failed[\s\S]*STATUS_FAILED|not marking ready/.test(shared),
    'shared path refuses ready on R2 failure'
);

const repair = read('backend/src/ingestion/playback_repair.rs');
assert(/--dry-run/.test(repair), 'playback-repair dry-run default path documented');
assert(/REELFORGE_PLAYBACK_REPAIR_APPLY/.test(repair), 'apply requires explicit env gate');

const workerShared = read('backend/src/ingestion/worker.rs');
assert(
    /playback_derivative::materialize_playback_derivative/.test(workerShared),
    'worker uses shared materialize (no dual pipeline)'
);

if (failures.length) {
    console.error('FAIL validate-playback-derivative');
    for (const f of failures) console.error('  -', f);
    process.exit(1);
}

console.log('PASS validate-playback-derivative');
for (const n of notes) console.log(' ', n);
process.exit(0);
