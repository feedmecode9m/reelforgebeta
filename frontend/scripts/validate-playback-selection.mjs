#!/usr/bin/env node
/**
 * Phase 2 — playback URL selection (resolvePlayableMediaUrl).
 * Theater prefers ready derivative; master fallback always available.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
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

function read(relFromFrontend) {
    return fs.readFileSync(path.join(frontendRoot, relFromFrontend), 'utf8');
}

// --- 1. Ready derivative → theater uses optimized ---
{
    const reel = {
        playbackUrl: 'optimized.mp4',
        playbackStatus: 'ready',
        url: 'master.mp4'
    };
    const result = resolvePlayableMediaUrl(reel, 'theater', { silent: true });
    assert(result === 'optimized.mp4', 'theater returns optimized.mp4 when derivative ready');
}

// --- 2. Null derivative → master ---
{
    const reel = {
        playbackUrl: null,
        url: 'master.mp4'
    };
    const result = resolvePlayableMediaUrl(reel, 'theater', { silent: true });
    assert(result === 'master.mp4', 'theater falls back to master when playbackUrl null');
}

// --- 3. Legacy reels without playback fields ---
{
    const reel = {
        id: 'legacy-1',
        url: 'https://cdn.example/videos/old.mp4',
        name: 'Legacy'
    };
    const result = resolvePlayableMediaUrl(reel, 'theater', { silent: true });
    assert(
        result === 'https://cdn.example/videos/old.mp4',
        'existing reels without playback fields continue working'
    );
    assert(!isPlaybackDerivativeReady(reel), 'legacy reel is not derivative-ready');
    assert(getMasterMediaUrl(reel) === result, 'master equals resolved for legacy');
}

// Snake_case API shape + not ready → master
{
    const reel = {
        playback_url: 'optimized.mp4',
        playback_status: 'processing',
        url: 'master.mp4'
    };
    assert(
        resolvePlayableMediaUrl(reel, 'theater', { silent: true }) === 'master.mp4',
        'processing derivative does not replace master'
    );
}

// Studio / download always master
{
    const reel = {
        playbackUrl: 'optimized.mp4',
        playbackStatus: 'ready',
        url: 'master.mp4'
    };
    assert(
        resolvePlayableMediaUrl(reel, 'download', { silent: true }) === 'master.mp4',
        'download context uses master'
    );
    assert(
        resolvePlayableMediaUrl(reel, 'studio', { silent: true }) === 'master.mp4',
        'studio context uses master'
    );
    assert(
        resolvePlayableMediaUrl(reel, 'vault_preview', { silent: true }) === 'optimized.mp4',
        'vault_preview prefers ready derivative'
    );
    assert(
        resolvePlayableMediaUrl(reel, 'hero', { silent: true }) === 'optimized.mp4',
        'hero prefers ready derivative'
    );
}

// --- Wiring guards ---
const theaterPlayback = read('src/lib/media/theaterPlayback.js');
assert(
    /resolvePlayableMediaUrl/.test(theaterPlayback),
    'theaterPlayback imports resolvePlayableMediaUrl'
);
assert(
    /'theater'|\"theater\"/.test(theaterPlayback),
    'theaterPlayback passes theater context'
);

const theaterExp = read('src/components/theater/TheaterExperience.svelte');
assert(
    /resolvePlayableMediaUrl\(\$activeReel,\s*['"]theater['"]\)/.test(theaterExp),
    'TheaterExperience uses resolvePlayableMediaUrl for primary video src'
);

const contract = read('src/lib/api/reelContract.js');
assert(/playbackUrl/.test(contract), 'normalizeReel preserves playbackUrl');
assert(/playbackStatus/.test(contract), 'normalizeReel preserves playbackStatus');
assert(
    /function reelToVaultEntry[\s\S]*playbackUrl[\s\S]*playbackStatus/.test(contract) ||
        /reelToVaultEntry[\s\S]{0,800}playbackUrl/.test(contract),
    'reelToVaultEntry preserves playback derivative fields'
);

const cleanupAgent = read('src/lib/viewer/aiCleanupAgent.js');
assert(
    /vaultPlaybackUrl|playbackUrl: vaultPlaybackUrl/.test(cleanupAgent),
    'distributeVideoToFeed carries playbackUrl into feed redistributes'
);

assert(
    /mergePlaybackDerivativeFields/.test(theaterExp),
    'Theater open merges derivative fields across feed/vault sources'
);

const resolverSrc = read('src/lib/media/resolvePlayableMediaUrl.js');
assert(
    /\[PLAYBACK_DERIVATIVE\]/.test(resolverSrc) && /source=playback_url|source=\$\{/.test(resolverSrc),
    'DEV diagnostics for derivative selection'
);
assert(
    /\[PLAYBACK_FALLBACK\]/.test(resolverSrc) && /no_derivative/.test(resolverSrc),
    'DEV diagnostics for master fallback'
);
assert(
    !/remove.*master|delete.*url/.test(resolverSrc),
    'resolver does not remove master path'
);

// --- 4. Theater ownership validators remain PASS ---
function runNpmScript(script) {
    const r = spawnSync('npm', ['run', script], {
        cwd: frontendRoot,
        encoding: 'utf8',
        env: process.env
    });
    return r;
}

const stability = runNpmScript('validate:playback-stability');
assert(stability.status === 0, 'validate:playback-stability remains PASS');
if (stability.status !== 0) {
    failures.push(`playback-stability stderr: ${(stability.stderr || '').slice(0, 400)}`);
}

const theaterVal = runNpmScript('validate:theater-playback');
assert(theaterVal.status === 0, 'validate:theater-playback remains PASS');
if (theaterVal.status !== 0) {
    failures.push(`theater-playback stderr: ${(theaterVal.stderr || '').slice(0, 400)}`);
}

// --- 5. Build remains PASS ---
const build = spawnSync('npm', ['run', 'build'], {
    cwd: frontendRoot,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024
});
assert(build.status === 0, 'frontend build remains PASS');
if (build.status !== 0) {
    failures.push(`build stderr: ${(build.stderr || build.stdout || '').slice(-600)}`);
}

// Phase 0.5 backend contract still present (no API shape change required beyond Phase 1)
assert(
    fs.existsSync(path.join(repoRoot, 'backend/migrations/2026081001_playback_derivative_fields.sql')),
    'backend derivative migration still present'
);

if (failures.length) {
    console.error('FAIL validate-playback-selection');
    for (const f of failures) console.error('  -', f);
    process.exit(1);
}

console.log('PASS validate-playback-selection');
for (const n of notes) console.log(' ', n);
process.exit(0);
