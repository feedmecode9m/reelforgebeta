#!/usr/bin/env node
/**
 * Scope A — video inventory / prune key normalization.
 * Absolute and relative /videos/ URLs must share one inventory key.
 */
import { createServer } from 'vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const server = await createServer({
    root,
    configFile: join(root, 'vite.config.js'),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error'
});

/** @type {typeof import('../src/lib/deletionSync.js')} */
const deletionSync = await server.ssrLoadModule('/src/lib/deletionSync.js');
const { videoInventoryKey, pruneFeedAgainstBackendVideos } = deletionSync;

let failed = 0;
/** @param {boolean} cond @param {string} label */
function assert(cond, label) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}`);
}

const relative = '/videos/foo.mp4';
const absolute = 'https://example.com/videos/foo.mp4';
const absoluteQs = 'https://example.com/videos/foo.mp4?x=123';
const r2 = 'https://pub-example.r2.dev/prod/abc.mp4';
const thumb = '/thumbs/abc.jpg';

const kRel = videoInventoryKey(relative);
const kAbs = videoInventoryKey(absolute);
const kQs = videoInventoryKey(absoluteQs);

console.log('videoInventoryKey normalization');
assert(kRel === '/videos/foo.mp4', 'relative /videos/ key');
assert(kAbs === '/videos/foo.mp4', 'absolute /videos/ → pathname key');
assert(kQs === '/videos/foo.mp4', 'absolute /videos/ with query → pathname key');
assert(kRel === kAbs && kAbs === kQs, 'relative + absolute + query share one key');

const kR2 = videoInventoryKey(r2);
assert(kR2 === r2 || kR2.includes('/prod/'), 'R2 /prod/ remains non-/videos/ key');
assert(!kR2.startsWith('/videos/'), 'R2 /prod/ is not treated as /videos/ inventory');

assert(videoInventoryKey(thumb) === '/thumbs/abc.jpg' || videoInventoryKey(thumb).includes('/thumbs/'), 'thumbs path preserved');

const inventory = new Set(
    [relative, absolute, absoluteQs, r2]
        .map((u) => videoInventoryKey(u))
        .filter((u) => u.startsWith('/videos/'))
);
assert(inventory.size === 1, 'inventory Set contains one /videos/ key');
assert(inventory.has('/videos/foo.mp4'), 'inventory Set has /videos/foo.mp4');

console.log('pruneFeedAgainstBackendVideos round-trip');
const feed = {
    Trending: [
        { id: '1', url: absolute, title: 'abs' },
        { id: '2', url: relative, title: 'rel' },
        { id: '3', url: r2, title: 'r2' },
        { id: '4', url: 'https://example.com/videos/stale.mp4', title: 'stale' }
    ]
};
const { feed: pruned, removed } = pruneFeedAgainstBackendVideos(feed, inventory);
const kept = (pruned.Trending || []).map((r) => r.id).sort().join(',');
assert(kept === '1,2,3', 'keeps matching absolute+relative /videos/ and R2 /prod/');
assert(removed === 1, 'removes only stale /videos/ absent from inventory');

await server.close();

if (failed) {
    console.error(`\nFAILED: ${failed} assertion(s)`);
    process.exit(1);
}
console.log('\nPASS validate-video-inventory-key');
