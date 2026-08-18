#!/usr/bin/env node
/**
 * LOCAL-MOBILE-PLAYBACK-TRACE-1/3 — static contract for [MOBILE_PLAY_TRACE]
 * plus DEV-only remote sink [MOBILE_PLAY_TRACE_REMOTE].
 * Trace instrumentation only. Does not rewrite playback or replace PLAY-2.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const failures = [];
const notes = [];

function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else notes.push(`ok: ${msg}`);
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

const diag = read('src/lib/device/mobileExperienceDiagnostics.js');
const card = read('src/components/viewer/ViewerSemanticCard.svelte');
const reelshort = read('src/components/vertical/ReelshortExperience.svelte');
const viewerCtx = read('src/viewer/viewerContext.js');
const theater = read('src/components/theater/TheaterExperience.svelte');

assert(/MOBILE_PLAY_TRACE/.test(diag), 'Gate A: MOBILE_PLAY_TRACE helper');
assert(/export function logMobilePlayTrace/.test(diag), 'Gate A: logMobilePlayTrace exported');
assert(/describeElementUnderPoint/.test(diag), 'Gate A: overlay hit-test helper');
assert(/MOBILE_PLAY_TRACE_REMOTE/.test(diag), 'Gate A3: remote sink marker');
assert(/\/api\/debug\/mobile-trace/.test(diag), 'Gate A3: POST /api/debug/mobile-trace');
assert(/import\.meta\.env\.DEV/.test(diag), 'Gate A3: remote sink is DEV-only');

assert(/logMobilePlayTrace\('CLICK'/.test(card), 'Gate B: card CLICK phase');
assert(/logMobilePlayTrace\('HANDOFF_INVOKE'/.test(card), 'Gate B1: HANDOFF_INVOKE before onActivate');
assert(/logMobilePlayTrace\('HANDOFF_ERROR'/.test(card), 'Gate B1: HANDOFF_ERROR on onActivate throw');
assert(/onActivate/.test(card) && /logMobilePlayTrace/.test(card), 'Gate B: card still calls onActivate after trace');

assert(/logMobilePlayTrace\('ACTIVATE_REEL'/.test(reelshort), 'Gate C: activateReel phase');
assert(
    reelshort.indexOf("logMobilePlayTrace('ACTIVATE_REEL'") < reelshort.indexOf('logTheaterOpen(reel'),
    'Gate B1: ACTIVATE_REEL logs before logTheaterOpen'
);
assert(/logMobilePlayTrace\('HANDOFF_ON_OPEN_THEATER'/.test(reelshort), 'Gate C: handoff phase');
assert(/onOpenTheater\(reel\)/.test(reelshort), 'Gate C: canonical onOpenTheater retained');

assert(/safeMetricId|safeRandomId/.test(read('src/lib/observability/platformMetrics.js')), 'Gate B1: metrics UUID safe on insecure context');
assert(/safeRandomId/.test(read('src/lib/api/watch.js')), 'Gate B1: viewer id UUID safe on insecure context');
assert(/LOCAL-MOBILE-PLAYBACK-FIX-B1/.test(read('src/lib/theater/theaterDiagnostics.js')), 'Gate B1: logTheaterOpen cannot abort handoff');

assert(/logMobilePlayTrace\('VIEWER_HANDLE_CARD_CLICK'/.test(viewerCtx), 'Gate D: viewer handleCardClick');
assert(/logMobilePlayTrace\('VIEWER_OPEN_THEATER'/.test(viewerCtx), 'Gate D: viewer openTheater');
assert(/openTheaterReel\(reel\)/.test(viewerCtx), 'Gate D: openTheaterReel handoff retained');

assert(/logMobilePlayTrace\('OPEN_THEATER_REEL'/.test(theater), 'Gate E: openTheaterReel entry');
assert(/logMobilePlayTrace\('OPEN_THEATER_REEL_AFTER_TICK'/.test(theater), 'Gate E: video mount after tick');
assert(/logMobilePlayTrace\('THEATER_PLAY_POINTER_UP'/.test(theater), 'Gate E: mobile Play chrome');
assert(/logMobilePlayTrace\('START_THEATER_PLAYBACK'/.test(theater), 'Gate E: video.play path');
assert(/logMobilePlayTrace\('VIDEO_MOUNT'/.test(theater), 'Gate T4: VIDEO_MOUNT');
assert(/logMobilePlayTrace\('VIDEO_READY_POLL'/.test(theater), 'Gate T4: VIDEO_READY_POLL 1s');
assert(/logMobilePlayTrace\('VIDEO_LOAD_CALL'/.test(theater), 'Gate T4: load() when currentSrc empty');
assert(/logMobilePlayTrace\('PLAY_RESULT'/.test(theater), 'Gate T4: play() fulfilled');
assert(/logMobilePlayTrace\('PLAY_REJECT'/.test(theater), 'Gate T4: play() rejected');
assert(/snapshotMobileTheaterVideo/.test(diag), 'Gate T4: src/source/network snapshot');
assert(/VIDEO_LOADED_METADATA/.test(read('src/lib/theater/theaterPlaybackDiagnostics.js')), 'Gate T4: loadedmetadata → MOBILE_PLAY_TRACE');
assert(/VIDEO_CANPLAY/.test(read('src/lib/theater/theaterPlaybackDiagnostics.js')), 'Gate T4: canplay → MOBILE_PLAY_TRACE');
assert(/handleTheaterPlayPointerUp/.test(theater), 'Gate F: PLAY-2 pointerup retained (no rewrite)');
assert(/startTheaterPlayback/.test(theater), 'Gate F: PLAY-2 startTheaterPlayback retained');

assert(
    /pointer-events:\s*none/.test(reelshort) &&
        /viewer-discovery-rail__tabs/.test(reelshort) &&
        /pointer-events:\s*auto/.test(reelshort),
    'Gate G: discovery rail does not steal card taps (pointer-events fix)'
);

const pathMap = {
    phases: [
        'CLICK',
        'HANDOFF_INVOKE',
        'ACTIVATE_REEL',
        'HANDOFF_ON_OPEN_THEATER',
        'VIEWER_HANDLE_CARD_CLICK',
        'VIEWER_OPEN_THEATER',
        'VIEWER_OPEN_THEATER_COMPLETE',
        'OPEN_THEATER_REEL',
        'OPEN_THEATER_REEL_SET_ACTIVE',
        'OPEN_THEATER_REEL_AFTER_TICK',
        'VIDEO_MOUNT',
        'VIDEO_READY_POLL',
        'VIDEO_LOADED_METADATA',
        'VIDEO_CANPLAY',
        'VIDEO_ERROR',
        'THEATER_PLAY_POINTER_UP',
        'VIDEO_LOAD_CALL',
        'PLAY_RESULT',
        'PLAY_REJECT',
        'TOGGLE_THEATER_PLAYBACK',
        'START_THEATER_PLAYBACK',
        'START_THEATER_PLAYBACK_DONE'
    ],
    canonicalPath:
        'ViewerSemanticCard → activateReel → onOpenTheater/handleCardClick → openTheater → openTheaterReel → (autoplay / mobile Play chrome) → startTheaterPlayback → video.play()',
    note: 'No separate mobilePlay() path found. Decorative ▶ on cards is aria-hidden; whole card is the activate control.'
};

const report = {
    mission: 'LOCAL-MOBILE-PLAYBACK-TRACE-1',
    generatedAt: new Date().toISOString(),
    status: failures.length ? 'FAIL' : 'PASS',
    pathMap,
    notes,
    failures
};

fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
fs.writeFileSync(
    path.join(root, 'artifacts/mobile-playback-trace-gates.json'),
    JSON.stringify(report, null, 2)
);

if (failures.length) {
    console.error('LOCAL-MOBILE-PLAYBACK-TRACE-1 FAIL\n', failures.join('\n'));
    process.exit(1);
}
console.log('LOCAL-MOBILE-PLAYBACK-TRACE-1 PASS');
console.log(JSON.stringify({ phases: pathMap.phases.length, canonicalPath: pathMap.canonicalPath }, null, 2));
