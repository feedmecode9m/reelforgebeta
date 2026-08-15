#!/usr/bin/env node
/**
 * PHASE-HERO-LOCK-1 — durable Hero override must block selection background application.
 * Does not touch upload / feed / identity / ViewerSemanticCard.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ARTIFACTS = join(ROOT, 'artifacts');

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const notes = [];

function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else notes.push(`ok: ${msg}`);
}

const engineSrc = readFileSync(join(ROOT, 'src/lib/hero/heroIntelligence.js'), 'utf8');
const viewerSrc = readFileSync(join(ROOT, 'src/viewer/viewerContext.js'), 'utf8');

assert(engineSrc.includes('export function hasDurableHeroOverride'), 'hasDurableHeroOverride exported');
assert(engineSrc.includes('durable_hero_override'), 'applyHeroSelection logs durable_hero_override');
assert(engineSrc.includes('vault_or_feed_candidate_forbidden') || engineSrc.includes('canonical_hero_reel'), 'recovery prefers canonical only');
assert(engineSrc.includes("reason: 'durable_hero_override'"), 'recovery skips when durable lock set');
assert(viewerSrc.includes('hasDurableHeroOverride'), 'viewerContext imports durable lock');
assert(!engineSrc.includes("category = 'HERO'"), 'heroIntelligence does not hardcode HERO category on vault');

const server = await createServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error'
});

try {
    const mod = await server.ssrLoadModule('/src/lib/hero/heroIntelligence.js');
    const recordMod = await server.ssrLoadModule('/src/lib/hero/heroRecord.js');

    /** @type {Record<string, string>} */
    const mem = Object.create(null);
    globalThis.CustomEvent =
        globalThis.CustomEvent ||
        class CustomEvent {
            /**
             * @param {string} type
             * @param {{ detail?: unknown }} [init]
             */
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        };
    const dispatchEvent = () => true;
    /** @type {any} */
    const win = {
        dispatchEvent,
        addEventListener: () => {},
        removeEventListener: () => {},
        localStorage: {
            getItem: (k) => (k in mem ? mem[k] : null),
            setItem: (k, v) => {
                mem[k] = String(v);
            },
            removeItem: (k) => {
                delete mem[k];
            },
            clear: () => {
                for (const k of Object.keys(mem)) delete mem[k];
            }
        }
    };
    globalThis.window = win;
    globalThis.localStorage = win.localStorage;
    globalThis.dispatchEvent = dispatchEvent;

    const ARRIVAL = '73adb67a-6d97-43fd-8fc6-3a4b4ce0b3ee';
    const NEW_MOVIE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

    // Seed durable Hero = Arrival
    recordMod.selectHeroAsset({
        assetId: ARRIVAL,
        mediaUrl: `/videos/${ARRIVAL}.mp4`,
        videoUrl: `/videos/${ARRIVAL}.mp4`,
        mediaKind: 'video',
        fileName: 'Arrival.mp4',
        title: 'Arrival',
        source: 'phase_hero_lock_1_test'
    });
    mod.saveHeroManagerConfig(
        {
            heroAssetId: ARRIVAL,
            backgroundSource: 'custom_video',
            backgroundStyle: 'video',
            mediaUrl: `/videos/${ARRIVAL}.mp4`
        },
        { skipServer: true }
    );

    assert(mod.hasDurableHeroOverride() === true, 'durable lock true for asset+custom_video');
    assert(mod.hasUserHeroOverride() === true, 'user override includes durable');

    let appliedVideo = '';
    const stores = {
        setVideo: (url) => {
            appliedVideo = String(url || '');
        },
        setPoster: () => {},
        setFailed: () => {}
    };

    // Re-assert locked background first
    appliedVideo = '';
    mod.applyHeroSelection(
        {
            mode: 'TRENDING',
            source: 'featured_series',
            videoUrl: `/videos/${NEW_MOVIE}.mp4`,
            reelId: NEW_MOVIE,
            title: 'NewMovie'
        },
        stores,
        { respectUserOverride: true, applyBackground: true }
    );

    assert(
        !appliedVideo.includes(NEW_MOVIE),
        'selection applyBackground blocked — NewMovie not written'
    );
    assert(
        appliedVideo.includes(ARRIVAL) || appliedVideo === '',
        'locked path keeps Arrival (or re-asserts without NewMovie)'
    );

    // Manager-only durable (selection record cleared to selection without clearing manager)
    recordMod.setHeroMode('selection', { source: 'phase_hero_lock_1_selection_sim' });
    // Keep manager custom_video + Arrival id
    mod.saveHeroManagerConfig(
        {
            heroAssetId: ARRIVAL,
            backgroundSource: 'custom_video',
            backgroundStyle: 'video',
            mediaUrl: `/videos/${ARRIVAL}.mp4`
        },
        { skipServer: true }
    );
    assert(
        mod.hasDurableHeroOverride() === true,
        'durable lock true for manager custom_video+heroAssetId even if record mode=selection'
    );

    appliedVideo = 'polluted';
    const blocked = mod.applyHeroSelection(
        {
            mode: 'TRENDING',
            source: 'featured_series',
            videoUrl: `/videos/${NEW_MOVIE}.mp4`,
            reelId: NEW_MOVIE,
            title: 'NewMovie'
        },
        stores,
        { respectUserOverride: true, applyBackground: true }
    );
    assert(blocked === false, 'applyHeroSelection returns false under durable lock');
    assert(!String(appliedVideo).includes(NEW_MOVIE), 'NewMovie still not applied under manager lock');

    // Unlocked selection may apply
    recordMod.setHeroMode('selection', { source: 'phase_hero_lock_1_unlocked' });
    mod.saveHeroManagerConfig(
        {
            heroAssetId: '',
            backgroundSource: 'selection',
            backgroundStyle: 'gradient_overlay',
            mediaUrl: ''
        },
        { skipServer: true }
    );
    assert(mod.hasDurableHeroOverride() === false, 'durable lock false in pure selection mode');
    appliedVideo = '';
    mod.applyHeroSelection(
        {
            mode: 'TRENDING',
            source: 'featured_series',
            videoUrl: `/videos/${NEW_MOVIE}.mp4`,
            reelId: NEW_MOVIE,
            title: 'NewMovie'
        },
        stores,
        { respectUserOverride: true, applyBackground: true }
    );
    assert(appliedVideo.includes(NEW_MOVIE), 'unlocked selection still applies candidate video');
} finally {
    await server.close();
}

mkdirSync(ARTIFACTS, { recursive: true });
const report = {
    mission: 'PHASE-HERO-LOCK-1',
    generatedAt: new Date().toISOString(),
    pass: failures.length === 0,
    notes,
    failures
};
writeFileSync(join(ARTIFACTS, 'phase-hero-lock-1-validation.json'), JSON.stringify(report, null, 2));

if (failures.length) {
    console.error('FAIL — phase-hero-lock-1');
    for (const f of failures) console.error('  ✗', f);
    process.exit(1);
}
console.log('PASS — phase-hero-lock-1');
for (const n of notes) console.log('  ✓', n);
