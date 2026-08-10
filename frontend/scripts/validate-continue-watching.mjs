#!/usr/bin/env node
/** Continue Watching rail from position model. */
import fs from 'fs';
import { createServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else console.log(`  ok: ${msg}`);
}
function fsRead(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}
const bag = new Map();
globalThis.localStorage = {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => bag.set(String(k), String(v)),
    removeItem: (k) => bag.delete(k),
    clear: () => bag.clear()
};
globalThis.window = {
    localStorage: globalThis.localStorage,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true
};

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});
try {
    const progress = await vite.ssrLoadModule('/src/lib/series/seriesWatchProgress.js');
    progress.savePlaybackPosition({
        viewerId: 'v1',
        reelId: 'stirred-e2',
        position: 400,
        duration: 900
    });
    progress.savePlaybackPosition({
        viewerId: 'v1',
        reelId: 'done-one',
        position: 900,
        duration: 900,
        completed: true
    });
    const list = progress.listContinueWatching({ viewerId: 'v1' });
    assert(list.some((r) => r.reelId === 'stirred-e2'), 'continue list has in-progress reel');
    assert(!list.some((r) => r.reelId === 'done-one'), 'completed excluded');
    const label = progress.formatRemainingLabel(400, 900);
    assert(/remaining/.test(label), `remaining label (${label})`);

    // Surface consumers (not API-only)
    const page = fsRead('src/components/series/SeriesPublicPage.svelte');
    const home = fsRead('src/lib/discovery/homepageDiscoveryFeed.js');
    assert(/listContinueWatching/.test(page), 'SeriesPublicPage consumes listContinueWatching');
    assert(/listContinueWatching/.test(home), 'homepage feed consumes listContinueWatching');

    if (failures.length) {
        console.error('FAIL validate-continue-watching\n' + failures.map((f) => `  - ${f}`).join('\n'));
        process.exit(1);
    }
    console.log('PASS validate-continue-watching');
} finally {
    await vite.close();
}
