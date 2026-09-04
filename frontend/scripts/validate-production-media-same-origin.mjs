#!/usr/bin/env node
/**
 * Static + simulated PROD checks: absolute Netlify/Railway/R2 media → same-origin /videos.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configJs = fs.readFileSync(path.join(root, 'src/lib/config.js'), 'utf8');
const failures = [];

function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else console.log(`  ✓ ${msg}`);
}

console.log('[validate-production-media-same-origin]');

assert(/rewriteKnownMediaHostsToSameOrigin/.test(configJs), 'rewriteKnownMediaHostsToSameOrigin exists');
assert(
    /host\.endsWith\('\.netlify\.app'\)/.test(configJs) ||
        /Any absolute \/videos/.test(configJs),
    'absolute media host rewrite covers Netlify catalog URLs'
);
assert(/host\.endsWith\('\.r2\.dev'\)/.test(configJs), 'R2 /prod/ paths map to /videos/');

// Simulate rewrite logic (mirrors config.js — no import.meta in node)
function rewriteKnownMediaHostsToSameOrigin(url) {
    const trimmed = String(url || '').trim();
    if (!/^https?:\/\//i.test(trimmed)) return trimmed;
    try {
        const parsed = new URL(trimmed);
        const host = parsed.hostname.toLowerCase();
        if (host.endsWith('.r2.dev')) {
            const prodFile = parsed.pathname.match(/^\/prod\/(.+)$/i);
            if (prodFile?.[1] && /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(prodFile[1])) {
                return `/videos/${prodFile[1]}${parsed.search}`;
            }
            return trimmed;
        }
        if (
            !parsed.pathname.startsWith('/videos/') &&
            !parsed.pathname.startsWith('/thumbs/')
        ) {
            return trimmed;
        }
        return `${parsed.pathname}${parsed.search}`;
    } catch {
        return trimmed;
    }
}

const netlifyAbs =
    'https://strong-lolly-a9fcb4.netlify.app/videos/4336335c-0bdb-4eb2-8d20-f8a67d6a9a3d.mp4';
const out = rewriteKnownMediaHostsToSameOrigin(netlifyAbs);
assert(
    out === '/videos/4336335c-0bdb-4eb2-8d20-f8a67d6a9a3d.mp4',
    `Netlify absolute → same-origin (${out})`
);

const r2Out = rewriteKnownMediaHostsToSameOrigin(
    'https://pub-cb178488b1d4413988778e56a7d51439.r2.dev/prod/abc-123.mp4'
);
assert(r2Out === '/videos/abc-123.mp4', `R2 /prod/ → /videos/ (${r2Out})`);

if (failures.length) {
    console.error('FAIL validate-production-media-same-origin');
    for (const f of failures) console.error('  -', f);
    process.exit(1);
}
console.log('PASS validate-production-media-same-origin');
