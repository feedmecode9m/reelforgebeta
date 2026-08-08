#!/usr/bin/env node
/**
 * VIEWER-1 frontend contract smoke (no live API required).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    applyPendingResume,
    clearPendingResume,
    setPendingResume
} from '../src/lib/viewer/resumePosition.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function mustExist(rel) {
    const p = path.join(root, rel);
    assert.ok(fs.existsSync(p), `missing ${rel}`);
}

mustExist('src/lib/api/viewerAccount.js');
mustExist('src/lib/viewer/resumePosition.js');
mustExist('src/components/auth/AccountShell.svelte');
mustExist('src/components/navigation/ConsumerChrome.svelte');
mustExist('src/components/navigation/ConsumerHeader.svelte');
mustExist('src/components/navigation/ConsumerFooter.svelte');

// Phase 2 consumer chrome contracts
const chrome = fs.readFileSync(path.join(root, 'src/components/navigation/ConsumerChrome.svelte'), 'utf8');
assert.ok(/ConsumerHeader/.test(chrome), 'ConsumerChrome includes header');
assert.ok(/ConsumerFooter/.test(chrome), 'ConsumerChrome includes footer');

const header = fs.readFileSync(path.join(root, 'src/components/navigation/ConsumerHeader.svelte'), 'utf8');
assert.ok(/refreshProfileAvatar/.test(header), 'header refreshes avatar reactively');
assert.ok(/buildLoginPath/.test(header), 'header Sign In uses return path');

const menu = fs.readFileSync(path.join(root, 'src/components/account/AccountMenu.svelte'), 'utf8');
assert.ok(/Escape/.test(menu), 'account menu Escape close');
assert.ok(menu.includes('/account#continue-watching'), 'Continue Watching shortcut');
assert.ok(menu.includes('/account#my-list'), 'My List shortcut');
assert.ok(/isAdminRole/.test(menu), 'studio remains role gated');

const series = fs.readFileSync(
    path.join(root, 'src/components/series/SeriesPublicPage.svelte'),
    'utf8'
);
assert.ok(/ConsumerChrome/.test(series), 'series page shares consumer chrome');
assert.ok(!/REELFORGE/.test(series), 'no legacy REELFORGE brand on series page');

// Resume rules
clearPendingResume();
setPendingResume('reel-1', 45, { durationSeconds: 120, completed: false });
const video = {
    duration: 120,
    currentTime: 0
};
assert.equal(applyPendingResume(video, 'reel-1'), true);
assert.ok(video.currentTime >= 44 && video.currentTime <= 46);

clearPendingResume();
setPendingResume('reel-1', 110, { durationSeconds: 120, completed: true });
const video2 = { duration: 120, currentTime: 0 };
assert.equal(applyPendingResume(video2, 'reel-1'), false);
assert.equal(video2.currentTime, 0);

console.log('✓ VIEWER-1 / Phase 2 consumer chrome foundation checks passed');
