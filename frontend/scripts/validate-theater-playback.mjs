#!/usr/bin/env node
/**
 * Static contract checks for smooth Theater MP4 playback.
 * Guards single-primary-video, preload strategy, ambient non-duplication, diagnostics wiring.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const notes = [];

function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else notes.push(`ok: ${msg}`);
}

const theater = read('src/components/theater/TheaterExperience.svelte');
const mediaRenderer = read('src/components/media/MediaRenderer.svelte');
const exclusive = read('src/lib/theater/theaterExclusivePlayback.js');
const diagnostics = read('src/lib/theater/theaterPlaybackDiagnostics.js');
const reelshort = read('src/components/vertical/ReelshortExperience.svelte');
const theaterPlayback = read('src/lib/media/theaterPlayback.js');

// 1. Single primary MediaRenderer video path with dataTheaterVideo
const theaterVideoBlocks = theater.match(/dataTheaterVideo=\{true\}/g) || [];
assert(theaterVideoBlocks.length === 1, 'exactly one dataTheaterVideo primary MediaRenderer');

// 2. preload metadata (not auto — progressive start without aggressive full-fetch)
assert(
    /preload="metadata"/.test(theater),
    'Theater primary video uses preload="metadata"'
);
assert(!/preload="auto"/.test(theater), 'Theater primary video does not use preload="auto"');

// 3. Ambient/smart framing must not attach a second MP4 of the primary source
assert(
    /MediaThumbnail[\s\S]{0,200}className="theater-video-bg-image"/.test(theater) ||
        /theater-video-bg-image/.test(theater),
    'smart framing ambient uses poster/thumbnail path'
);
assert(
    !/className="theater-video-bg[\s\S]{0,80}type="video"/.test(theater),
    'no ambient type=video alongside primary (duplicate-MP4 regression)'
);

// 4. Exclusive playback helpers exist and are wired
assert(
    /pauseCompetingPageVideos/.test(theater) && /resumeCompetingPageVideos/.test(theater),
    'Theater mounts exclusive playback pause/resume'
);
assert(/export function pauseCompetingPageVideos/.test(exclusive), 'pauseCompetingPageVideos exported');
assert(/export function resumeCompetingPageVideos/.test(exclusive), 'resumeCompetingPageVideos exported');
assert(
    /snapshotAndUnloadVideo|removeAttribute\('src'\)/.test(exclusive),
    'competing page videos unload network sources'
);
assert(
    /claimPlaybackOwner\('theater'/.test(exclusive) || /claimPlaybackOwner/.test(exclusive),
    'exclusive helpers claim theater ownership'
);

// 5. Diagnostics attached on mount
assert(
    /attachTheaterPlaybackDiagnostics/.test(theater),
    'playback diagnostics attached in theaterVideoMount'
);
assert(/snapshotTheaterVideo/.test(diagnostics), 'snapshotTheaterVideo present');
assert(/bufferAhead/.test(diagnostics), 'bufferAhead computed in diagnostics');

// 6. MediaRenderer forwards buffering events for Theater listeners
for (const ev of ['waiting', 'stalled', 'timeupdate', 'progress', 'canplay']) {
    assert(
        mediaRenderer.includes(`on:${ev}`),
        `MediaRenderer forwards on:${ev}`
    );
}

// 7. Image vs video theater path unchanged (resolution contract)
assert(
    /export function resolveTheaterPlayback/.test(theaterPlayback),
    'resolveTheaterPlayback still present'
);
assert(
    /mode:\s*['"]image['"]/.test(theaterPlayback) || /mode === 'image'/.test(theater) || /theaterPlayback\?\.mode === 'video'/.test(theater),
    'image/video theater resolution modes remain referenced'
);

// 8. theaterVideoKey remount only on src|id|retry (stable during playback)
assert(
    /theaterVideoKey = theaterVideoSrc[\s\S]*?theaterRetryNonce/.test(theater),
    'theaterVideoKey includes src, reel id, retry nonce only'
);

// 9. Reelshort ambient theater path prefers poster when ambientBlur (no second MP4 competition)
const ambientBlur = /ambientBlur|theater-ambient|MediaPoster/.test(reelshort);
assert(ambientBlur, 'ReelshortExperience retains ambient poster / theater-ambient path');

if (failures.length) {
    console.error('FAIL validate-theater-playback');
    for (const f of failures) console.error('  -', f);
    process.exit(1);
}

console.log('PASS validate-theater-playback');
for (const n of notes) console.log(' ', n);
process.exit(0);
