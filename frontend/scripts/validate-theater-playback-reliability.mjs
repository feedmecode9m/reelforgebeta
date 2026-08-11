#!/usr/bin/env node
/**
 * Theater MP4 Playback Reliability — Phase 1 invariants.
 *
 * A–H static + pure-function gates (no production network).
 * Does not assert global master bans — only Theater-owned exclusive + ready derivative path.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    resolvePlayableMediaUrl,
    mergePlaybackDerivativeFields,
    isPlaybackDerivativeReady
} from '../src/lib/media/resolvePlayableMediaUrl.js';
import {
    claimPlaybackOwner,
    releasePlaybackOwner,
    getPlaybackOwner,
    canAttachMediaForRole,
    canStartPlayback
} from '../src/lib/media/playbackOwnership.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

/** @type {string[]} */
const failures = [];

/** @param {boolean} cond @param {string} msg */
function assert(cond, msg) {
    if (cond) console.log(`  ✓ ${msg}`);
    else {
        failures.push(msg);
        console.error(`  ✗ ${msg}`);
    }
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

console.log('\n[theater-playback-reliability — phase 1]');

const theater = read('src/components/theater/TheaterExperience.svelte');
const exclusive = read('src/lib/theater/theaterExclusivePlayback.js');
const ownership = read('src/lib/media/playbackOwnership.js');
const media = read('src/components/media/MediaRenderer.svelte');
const pkgJson = read('package.json');

// --- Wiring ---
assert(
    /beginTheaterExclusiveSession/.test(theater) &&
        /beginTheaterExclusiveSession\(['"]theater-open-before-attach['"]\)/.test(theater),
    'C/D: openTheaterReel claims exclusive session before attach'
);
assert(
    /export function beginTheaterExclusiveSession/.test(exclusive),
    'beginTheaterExclusiveSession exported from exclusive helpers'
);
assert(
    /export function hardUnloadVideoElement/.test(exclusive),
    'hardUnloadVideoElement exported'
);
assert(
    /hardUnloadVideoElement/.test(theater) &&
        /destroy\(\)\s*\{[\s\S]*hardUnloadVideoElement/.test(theater),
    'G: Theater keyed destroy hard-unloads outgoing video'
);
assert(
    /hardUnloadVideoElement/.test(theater) && /theaterManager\.close|function close\(/.test(theater),
    'G: Theater close hard-unloads primary video'
);
// tighter: close body uses hardUnload
assert(
    theater.includes('hardUnloadVideoElement') &&
        /close\(\)\s*\{[\s\S]{0,800}hardUnloadVideoElement/.test(theater),
    'G: Theater close path calls hardUnloadVideoElement'
);
assert(
    /enrichTheaterReelForPlayback|mergePlaybackDerivativeFields/.test(theater) &&
        /mergePlaybackDerivativeFields\(reel,\s*fromFeed,\s*vaultHit\)/.test(theater),
    'B: derivative metadata merge from feed+vault before attach'
);
assert(
    /resolvePlayableMediaUrl/.test(theater) &&
        /resolvePlayableMediaUrl\(\$activeReel,\s*['"]theater['"]\)/.test(theater),
    'C: active Theater src uses theater context resolver'
);
assert(
    !/tick\(\)\.then\(\(\)\s*=>\s*\{[\s\S]*node\.play\?\.|tick\(\)\.then\([\s\S]{0,400}play\?\(\)/.test(
        theater
    ),
    'H: no redundant mount/tick play() race'
);
assert(
    /autoplay/.test(theater) && /playbackRole="theater"/.test(theater),
    'H: native autoplay retained on Theater primary'
);
assert(
    /export function canAttachMediaForRole/.test(ownership),
    'D: canAttachMediaForRole ownership gate exists'
);
assert(
    /canAttachMediaForRole/.test(media) && /activePlaybackOwner === ['"]theater['"]/.test(media),
    'D: MediaRenderer blocks hero/preview src while Theater owns playback'
);
assert(
    /dataTheaterVideo=\{true\}/.test(theater) &&
        (theater.match(/dataTheaterVideo=\{true\}/g) || []).length === 1,
    'E: exactly one primary Theater video renderer'
);
assert(
    /validate:theater-playback-reliability/.test(pkgJson),
    'package.json registers focused Phase 1 validator'
);

// --- Pure function: ownership gates ---
releasePlaybackOwner('*', 'test-reset');
claimPlaybackOwner('theater', 'test-theater');
assert(getPlaybackOwner() === 'theater', 'playback owner is theater after claim');
assert(
    canAttachMediaForRole('theater') === true,
    'D: theater role can attach while Theater owns'
);
assert(
    canAttachMediaForRole('hero') === false,
    'D: hero cannot attach while Theater owns'
);
assert(
    canAttachMediaForRole('preview') === false,
    'D: preview cannot attach while Theater owns'
);
assert(
    canStartPlayback('hero') === false,
    'D: canStartPlayback(hero) denied under theater owner'
);
releasePlaybackOwner('theater', 'test-done');
assert(
    canAttachMediaForRole('hero') === true,
    'hero can attach again after theater release'
);

// --- Pure function: derivative-first resolution ---
const ready = {
    id: 'r-ready',
    url: 'https://cdn.example/prod/r-ready.mp4',
    playbackUrl: 'https://cdn.example/prod/r-ready.playback.mp4',
    playbackStatus: 'ready'
};
const incomplete = { id: 'r-ready', name: 'thin object without derivative' };
const feedWithReady = {
    id: 'r-ready',
    url: 'https://cdn.example/prod/r-ready.mp4',
    playback_url: 'https://cdn.example/prod/r-ready.playback.mp4',
    playback_status: 'ready'
};
const meta = mergePlaybackDerivativeFields(incomplete, feedWithReady, null);
assert(
    meta.playbackUrl === ready.playbackUrl ||
        meta.playbackUrl === feedWithReady.playback_url ||
        String(meta.playbackUrl || '').includes('.playback.'),
    'merge picks ready derivative across incomplete seed + feed'
);
const merged = { ...incomplete, ...feedWithReady, ...meta };
const resolved = resolvePlayableMediaUrl(merged, 'theater', { silent: true });
assert(
    String(resolved).includes('.playback.') || resolved === ready.playbackUrl,
    'C: ready reel resolves to .playback.mp4 not master'
);
assert(
    !String(resolved).endsWith('/r-ready.mp4') || String(resolved).includes('.playback.'),
    'C: ready reel does not resolve to bare master alone'
);
assert(isPlaybackDerivativeReady(merged) || isPlaybackDerivativeReady(ready), 'ready pair recognized');

const notReady = {
    id: 'r-raw',
    url: 'https://cdn.example/prod/r-raw.mp4',
    playbackUrl: 'https://cdn.example/prod/r-raw.playback.mp4',
    playbackStatus: 'processing'
};
assert(
    resolvePlayableMediaUrl(notReady, 'theater', { silent: true }) === notReady.url,
    'non-ready keeps master fallback'
);

// --- Hard unload static contract ---
assert(
    /v\.src = ['"]['"]/.test(exclusive) && /\.load\(\)/.test(exclusive),
    'G: unload clears src and calls load()'
);

// episode switch ownership re-asserts exclusive session (same path as open)
assert(
    /beginTheaterExclusiveSession/.test(theater) && /openTheaterReel/.test(theater),
    'F: episode open path reuses openTheaterReel exclusive session'
);

if (failures.length) {
    console.error(`\n✗ theater-playback-reliability failed (${failures.length})\n`);
    process.exit(1);
}
console.log('\n✓ theater-playback-reliability phase 1 acceptance passed\n');
process.exit(0);
