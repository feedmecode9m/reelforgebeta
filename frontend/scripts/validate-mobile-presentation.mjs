#!/usr/bin/env node
/**
 * Static contract: local LAN + production mobile presentation wiring.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const repo = path.resolve(root, '..');

function read(rel, fromRepo = false) {
    return fs.readFileSync(path.join(fromRepo ? repo : root, rel), 'utf8');
}

/** @type {string[]} */
const failures = [];

function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else console.log(`  ✓ ${msg}`);
}

const indexHtml = read('index.html');
const vite = read('vite.config.js');
const startDev = read('scripts/start-dev.sh', true);
const mediaRenderer = read('src/components/media/MediaRenderer.svelte');
const theater = read('src/components/theater/TheaterExperience.svelte');
const mobileLib = read('src/lib/device/mobilePresentation.js');
const configJs = read('src/lib/config.js');
const netlifyToml = read('netlify.toml');
const redirects = read('public/_redirects');
const backendCors = read('backend/src/main.rs', true);
const viewerCss = read('src/viewer/viewer.css');

console.log('[validate-mobile-presentation]');

assert(
    /viewport-fit=cover/.test(indexHtml),
    'index.html viewport-fit=cover (iOS safe-area)'
);
assert(
    /apple-mobile-web-app-capable/.test(indexHtml),
    'index.html apple-mobile-web-app-capable'
);
assert(/rel="manifest"/.test(indexHtml), 'index.html links PWA manifest');

assert(/host:\s*true/.test(vite), 'Vite server listens on LAN (host: true)');
assert(/preview:[\s\S]*host:\s*true/.test(vite), 'Vite preview listens on LAN');

assert(
    /--host 0\.0\.0\.0/.test(startDev),
    'start-dev.sh binds Vite to 0.0.0.0 for phones'
);

assert(
    /export function detectMobilePresentation/.test(mobileLib),
    'shared detectMobilePresentation exists'
);
assert(
    /from '\.\.\/\.\.\/lib\/device\/mobilePresentation\.js'/.test(theater),
    'Theater uses shared mobile presentation helper'
);

assert(
    /export let playsinline = true/.test(mediaRenderer),
    'MediaRenderer defaults playsinline for iOS inline playback'
);
assert(
    /webkit-playsinline/.test(mediaRenderer),
    'MediaRenderer sets webkit-playsinline'
);

assert(
    /rewriteDevLoopbackAbsoluteToSameOrigin/.test(configJs),
    'LAN phones rewrite localhost URLs to same-origin'
);
assert(
    /rewriteKnownMediaHostsToSameOrigin|rewriteProductionProxyMediaToSameOrigin/.test(configJs),
    'production rewrites absolute /videos|/thumbs hosts to same-origin proxy'
);
assert(
    /netlify\.app\/videos|Any absolute \/videos/.test(configJs) ||
        /Strip origin for proxied media paths/.test(configJs),
    'Netlify absolute video URLs rewrite to same-origin (lookatzakanda parity)'
);
assert(
    /lookatzakanda\.com/.test(configJs),
    'custom domain lookatzakanda.com uses same-origin proxy host guard'
);
assert(
    /VITE_USE_SAME_ORIGIN_API\s*=\s*"true"/.test(netlifyToml),
    'netlify.toml bakes VITE_USE_SAME_ORIGIN_API for production mobile'
);
assert(
    /from = "\/videos\/\*"/.test(netlifyToml) &&
        /reelforge-deploy-production\.up\.railway\.app\/videos/.test(netlifyToml),
    'netlify.toml proxies /videos to Railway'
);
assert(
    /from = "\/thumbs\/\*"[\s\S]*force = false/.test(netlifyToml),
    'netlify.toml serves bundled /thumbs before Railway proxy'
);
assert(
    /\/videos\/\*\s+https:\/\/reelforge-deploy-production\.up\.railway\.app\/videos/.test(
        redirects
    ),
    'public/_redirects proxies /videos for same-origin mobile theater'
);

assert(
    /fn is_local_dev_browser_origin/.test(backendCors),
    'backend CORS allows LAN origins in non-production'
);

assert(
    /height:\s*52vh/.test(viewerCss) && /max-width:\s*640px/.test(viewerCss),
    'hero stage is shorter on mobile so feed is reachable'
);

if (failures.length) {
    console.error('FAIL validate-mobile-presentation');
    for (const f of failures) console.error('  -', f);
    process.exit(1);
}

console.log('PASS validate-mobile-presentation');
process.exit(0);
