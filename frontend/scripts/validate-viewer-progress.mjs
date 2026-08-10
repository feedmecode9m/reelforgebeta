#!/usr/bin/env node
/** Viewer progress position model. */
import { createServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else console.log(`  ok: ${msg}`);
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
    const row = progress.savePlaybackPosition({
        viewerId: 'v1',
        reelId: 'reel-e2',
        position: 205,
        duration: 600
    });
    assert(row?.percent === 34, `percent ~34 (got ${row?.percent})`);
    assert(row?.position === 205, 'position stored');
    const again = progress.getPlaybackPosition('reel-e2');
    assert(again?.position === 205, 'progress survives get');
    // reload storage
    const reopened = progress.loadWatchPositionMap()['reel-e2'];
    assert(reopened?.duration === 600, 'progress survives storage map');

    if (failures.length) {
        console.error('FAIL validate-viewer-progress\n' + failures.map((f) => `  - ${f}`).join('\n'));
        process.exit(1);
    }
    console.log('PASS validate-viewer-progress');
} finally {
    await vite.close();
}
