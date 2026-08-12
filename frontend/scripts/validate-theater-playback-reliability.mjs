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
    isPlaybackDerivativeReady,
    enrichReelForTheaterPlayback,
    stampReadyPlaybackDerivative,
    resolveTheaterAttachUrl,
    resetReadyPlaybackDerivativeMemory
} from '../src/lib/media/resolvePlayableMediaUrl.js';
import {
    claimPlaybackOwner,
    releasePlaybackOwner,
    getPlaybackOwner,
    canAttachMediaForRole,
    canStartPlayback,
    setTheaterProtectedMaster,
    clearTheaterProtectedMaster,
    isTheaterProtectedMasterUrl
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

console.log('\n[theater-playback-reliability — phase 1+2]');

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
    /enrichTheaterReelForPlayback|enrichReelForTheaterPlayback/.test(theater) &&
        /enrichReelForTheaterPlayback\(reel,\s*\[fromFeed,\s*vaultHit\]\)/.test(theater),
    'B: derivative metadata merge from feed+vault before attach'
);
assert(
    /stampReadyPlaybackDerivative/.test(theater) && /setTheaterProtectedMaster/.test(theater),
    'P2: remount restamps ready derivative and protects master identity'
);
assert(
    /resolvePlayableMediaUrl/.test(theater) &&
        (/resolvePlayableMediaUrl\(\$activeReel,\s*['"]theater['"]\)/.test(theater) ||
            /resolveTheaterAttachUrl\(\$activeReel\)/.test(theater)),
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
    /isTheaterProtectedMasterUrl/.test(media) && /isTheaterProtectedMasterUrl/.test(exclusive),
    'P2: MediaRenderer + exclusive unload guard Theater-owned master URLs'
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

// --- Phase 2: E1 → E2 → E3 → E1 remount (thin reconstruct must not fall to master) ---
resetReadyPlaybackDerivativeMemory();
clearTheaterProtectedMaster();

const E1_ID = '03ef898a-989f-42c3-bdbb-67f37338df65';
const E2_ID = 'd2aafde7-d7ba-492c-a860-20b51f7f4033';
const E3_ID = '3894107e-ae44-43c5-af72-b3f5d5e0ad90';
const e1Canonical = {
    id: E1_ID,
    url: `https://cdn.example/prod/${E1_ID}.mp4`,
    playbackUrl: `https://cdn.example/prod/${E1_ID}.playback.mp4`,
    playbackStatus: 'ready'
};
const e2Canonical = {
    id: E2_ID,
    url: `https://cdn.example/prod/${E2_ID}.mp4`,
    playbackUrl: `https://cdn.example/prod/${E2_ID}.playback.mp4`,
    playbackStatus: 'ready'
};
const e3Canonical = {
    id: E3_ID,
    url: `https://cdn.example/prod/${E3_ID}.mp4`,
    playback_url: `https://cdn.example/prod/${E3_ID}.playback.mp4`,
    playback_status: 'ready'
};

const e1Open = enrichReelForTheaterPlayback(e1Canonical, []);
assert(
    resolveTheaterAttachUrl(e1Open) === e1Canonical.playbackUrl,
    'P2: first E1 attach uses .playback.mp4'
);
assert(
    resolvePlayableMediaUrl(e1Open, 'theater', { silent: true }) === e1Canonical.playbackUrl,
    'P2 invariant: ready + playbackUrl must not resolve to master'
);

const e2Open = enrichReelForTheaterPlayback(e2Canonical, []);
assert(
    resolveTheaterAttachUrl(e2Open).includes(`${E2_ID}.playback.mp4`),
    'P2: E2 attach uses .playback.mp4'
);
const e3Open = enrichReelForTheaterPlayback(e3Canonical, []);
assert(
    resolveTheaterAttachUrl(e3Open).includes(`${E3_ID}.playback.mp4`),
    'P2: E3 attach uses .playback.mp4'
);

// Chip reconstruct: seed has only id+master; feed still has ready pair; memory from first E1.
const e1ThinRemount = { id: E1_ID, name: '01 ARRIVAL OPEN', url: e1Canonical.url };
const e1FeedRedistributed = {
    id: E1_ID,
    url: e1Canonical.url,
    playbackUrl: e1Canonical.playbackUrl,
    playbackStatus: 'ready'
};
const e1Remount = enrichReelForTheaterPlayback(e1ThinRemount, [e1FeedRedistributed]);
assert(
    isPlaybackDerivativeReady(e1Remount),
    'P2: remounted E1 object carries ready derivative metadata'
);
assert(
    resolveTheaterAttachUrl(e1Remount) === e1Canonical.playbackUrl,
    'P2: E1→E2→E3→E1 remount resolves .playback.mp4 not master'
);
assert(
    resolvePlayableMediaUrl(e1Remount, 'theater', { silent: true }) !== e1Canonical.url,
    'P2: remount resolver does not return bare master'
);

// Even thinner: feed lost derivative fields; recall from first E1 open.
const e1MemoryOnly = enrichReelForTheaterPlayback(
    { id: E1_ID, url: e1Canonical.url, title: 'reconstructed chip' },
    [{ id: E1_ID, url: e1Canonical.url }]
);
assert(
    resolveTheaterAttachUrl(e1MemoryOnly) === e1Canonical.playbackUrl,
    'P2: recalled ready pair survives feed-stripped E1 remount'
);

// stamp after episode overlay (applyEpisodeFields-style)
const afterEpisodeFields = stampReadyPlaybackDerivative({
    ...e1ThinRemount,
    episodeId: 'ep-vic-g-s01e01',
    seriesId: 'series-vic-g'
});
assert(
    resolveTheaterAttachUrl(afterEpisodeFields) === e1Canonical.playbackUrl,
    'P2: stamp after episode fields still prefers ready derivative'
);

// non-ready unchanged
const processingOnly = enrichReelForTheaterPlayback(
    {
        id: 'r-processing',
        url: 'https://cdn.example/prod/r-processing.mp4',
        playbackUrl: 'https://cdn.example/prod/r-processing.playback.mp4',
        playbackStatus: 'processing'
    },
    []
);
assert(
    resolveTheaterAttachUrl(processingOnly) === 'https://cdn.example/prod/r-processing.mp4',
    'P2: non-ready still falls back to master'
);

// Exclusive-master: Theater owns → hero/preview cannot attach; protected master blocked
releasePlaybackOwner('*', 'p2-reset');
claimPlaybackOwner('theater', 'p2-theater');
setTheaterProtectedMaster(E1_ID, e1Canonical.url);
assert(
    canAttachMediaForRole('hero') === false,
    'P2: hero cannot attach while Theater owns'
);
assert(
    isTheaterProtectedMasterUrl(e1Canonical.url) === true,
    'P2: E1 master URL is protected while Theater owns'
);
assert(
    isTheaterProtectedMasterUrl(e1Canonical.playbackUrl) === false,
    'P2: E1 .playback.mp4 is not treated as protected master'
);
assert(
    isTheaterProtectedMasterUrl(`https://cdn.example/prod/${E2_ID}.mp4`) === false,
    'P2: other reel masters are not auto-protected'
);
releasePlaybackOwner('theater', 'p2-done');
clearTheaterProtectedMaster();
assert(
    isTheaterProtectedMasterUrl(e1Canonical.url) === false,
    'P2: protected master clears after Theater release'
);
resetReadyPlaybackDerivativeMemory();

if (failures.length) {
    console.error(`\n✗ theater-playback-reliability failed (${failures.length})\n`);
    process.exit(1);
}
console.log('\n✓ theater-playback-reliability phase 1+2 acceptance passed\n');
process.exit(0);
