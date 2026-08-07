#!/usr/bin/env node
/**
 * Commit 6 — Viewer hydration exclusively from HeroRecord.
 *
 * Usage:
 *   node scripts/mission-hero-viewer-hydration.mjs
 *   npm run test:hero-viewer-hydration
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, '..');
const OUT =
    process.env.OUT || path.join(os.tmpdir(), 'reelforge-hero-viewer-hydration-tests.json');

const HERO_RECORD_KEY = 'reelforge_hero_record';
const HERO_REEL_KEY = 'reelforge_hero_reel';
const HERO_MANAGER_KEY = 'reelforge_hero_manager_config';
const HERO_VIDEO_KEY = 'reelforge_hero_video';

/** @type {Record<string, string>} */
const storage = {};

function installShims() {
    for (const key of Object.keys(storage)) delete storage[key];
    globalThis.localStorage = {
        getItem: (key) => (Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null),
        setItem: (key, value) => {
            storage[key] = String(value);
        },
        removeItem: (key) => {
            delete storage[key];
        },
        clear: () => {
            for (const key of Object.keys(storage)) delete storage[key];
        }
    };
    globalThis.window = {
        localStorage: globalThis.localStorage,
        dispatchEvent: () => true,
        addEventListener: () => {},
        removeEventListener: () => {},
        performance: { now: () => Date.now() },
        setInterval: () => 1,
        clearInterval: () => {},
        setTimeout: (fn) => {
            if (typeof fn === 'function') fn();
            return 1;
        },
        clearTimeout: () => {}
    };
    globalThis.performance = { now: () => Date.now() };
    globalThis.CustomEvent = class CustomEvent {
        constructor(type, init = {}) {
            this.type = type;
            this.detail = init.detail;
        }
    };
    globalThis.fetch = async () => ({ ok: true, status: 200 });
}

function wipe() {
    for (const key of Object.keys(storage)) delete storage[key];
}

function makeStores() {
    const state = { video: null, poster: null, failed: null };
    return {
        state,
        api: {
            setVideo: (v) => {
                state.video = v;
            },
            setPoster: (p) => {
                state.poster = p;
            },
            setFailed: (f) => {
                state.failed = f;
            }
        }
    };
}

/** @type {Array<{ id: string; pass: boolean; detail?: unknown }>} */
const results = [];

function assert(id, condition, detail) {
    const pass = Boolean(condition);
    results.push({ id, pass, detail: detail ?? null });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${id}`);
}

async function main() {
    installShims();
    const server = await createServer({
        root: FRONTEND_ROOT,
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error'
    });

    try {
        const recordApi = await server.ssrLoadModule('/src/lib/hero/heroRecord.js');
        const intelApi = await server.ssrLoadModule('/src/lib/hero/heroIntelligence.js');

        const {
            loadHeroRecord,
            saveHeroRecord,
            selectHeroAsset,
            setHeroMode,
            updateHeroPresentation,
            applyHeroRecordBackground,
            HERO_RECORD_STORAGE_KEY
        } = recordApi;
        const {
            hydrateHeroBackgroundStoresSync,
            hydrateHeroBackgroundStores,
            hasUserHeroOverride,
            applyHeroManagerBackground,
            saveHeroManagerConfig,
            loadHeroManagerConfig
        } = intelApi;

        assert('api.record_key', HERO_RECORD_STORAGE_KEY === HERO_RECORD_KEY);

        // ── A. Fresh boot: asset / selection / none ─────────────────────────
        wipe();
        selectHeroAsset({
            assetId: 'boot-asset',
            mediaUrl: '/videos/boot-asset.mp4',
            mediaKind: 'video',
            videoUrl: '/videos/boot-asset.mp4',
            posterUrl: '/thumbs/boot.jpg',
            heroTitle: 'Boot Asset Title'
        });
        // Stale legacy keys must not win.
        storage[HERO_REEL_KEY] = JSON.stringify({
            id: 'stale-reel',
            url: '/videos/stale.mp4',
            type: 'video/mp4',
            backgroundSource: 'custom_video'
        });
        storage[HERO_VIDEO_KEY] = '/videos/stale-key.mp4';
        let stores = makeStores();
        let mode = hydrateHeroBackgroundStoresSync(stores.api);
        assert(
            'boot.asset_shows_record_media',
            mode === 'video' && stores.state.video === '/videos/boot-asset.mp4',
            { mode, stores: stores.state }
        );

        wipe();
        setHeroMode('selection', { source: 'test_selection' });
        saveHeroManagerConfig({ backgroundSource: 'selection', heroAssetId: '' });
        stores = makeStores();
        mode = hydrateHeroBackgroundStoresSync(stores.api);
        assert(
            'boot.selection_is_pending_for_intelligence',
            mode === 'pending_default' && (stores.state.video == null || stores.state.video === ''),
            { mode, stores: stores.state }
        );
        // Stale video key does not attach in selection.
        storage[HERO_VIDEO_KEY] = '/videos/should-not-attach.mp4';
        stores = makeStores();
        mode = hydrateHeroBackgroundStoresSync(stores.api);
        assert(
            'boot.selection_ignores_legacy_video_key',
            mode === 'pending_default' && stores.state.video !== '/videos/should-not-attach.mp4',
            { mode, stores: stores.state }
        );

        wipe();
        setHeroMode('none', { source: 'test_none' });
        saveHeroManagerConfig({ backgroundSource: 'none', heroAssetId: '' });
        storage[HERO_REEL_KEY] = JSON.stringify({
            id: 'stale',
            url: '/videos/stale.mp4',
            type: 'video/mp4',
            backgroundSource: 'custom_video'
        });
        stores = makeStores();
        stores.state.video = '/videos/prefilled.mp4';
        mode = hydrateHeroBackgroundStoresSync(stores.api);
        assert(
            'boot.none_clears_media',
            mode === 'unchanged' && stores.state.video === '' && stores.state.poster === '',
            { mode, stores: stores.state }
        );

        // ── B. Conflict matrix ─────────────────────────────────────────────
        wipe();
        selectHeroAsset({
            assetId: 'winner-asset',
            mediaUrl: '/videos/winner.mp4',
            mediaKind: 'video'
        });
        storage[HERO_REEL_KEY] = JSON.stringify({
            id: 'stale-reel',
            url: '/videos/stale-reel.mp4',
            type: 'video/mp4',
            backgroundSource: 'custom_video'
        });
        stores = makeStores();
        mode = hydrateHeroBackgroundStoresSync(stores.api);
        assert(
            'conflict.asset_beats_stale_reel',
            mode === 'video' && stores.state.video === '/videos/winner.mp4',
            { mode, stores: stores.state }
        );

        wipe();
        setHeroMode('none');
        storage[HERO_REEL_KEY] = JSON.stringify({
            id: 'stale-reel',
            url: '/videos/stale-reel.mp4',
            type: 'video/mp4',
            backgroundSource: 'custom_video'
        });
        stores = makeStores();
        mode = hydrateHeroBackgroundStoresSync(stores.api);
        assert(
            'conflict.none_beats_stale_reel',
            mode === 'unchanged' && stores.state.video === '',
            { mode, stores: stores.state, reelPresent: Boolean(storage[HERO_REEL_KEY]) }
        );

        wipe();
        setHeroMode('selection');
        // Stale manager still claims custom asset
        saveHeroManagerConfig({
            backgroundSource: 'custom_video',
            heroAssetId: 'manager-stale-asset',
            backgroundStyle: 'video'
        });
        storage[HERO_REEL_KEY] = JSON.stringify({
            id: 'manager-stale-asset',
            url: '/videos/manager-stale.mp4',
            type: 'video/mp4',
            backgroundSource: 'custom_video'
        });
        stores = makeStores();
        mode = hydrateHeroBackgroundStoresSync(stores.api);
        assert(
            'conflict.selection_beats_stale_manager_custom',
            mode === 'pending_default' && stores.state.video !== '/videos/manager-stale.mp4',
            { mode, stores: stores.state, record: loadHeroRecord() }
        );

        // ── C. Live update via applyHeroRecordBackground ───────────────────
        wipe();
        selectHeroAsset({
            assetId: 'live-1',
            mediaUrl: '/videos/live-1.mp4',
            mediaKind: 'video'
        });
        stores = makeStores();
        applyHeroRecordBackground(loadHeroRecord(), stores.api);
        assert('live.asset_applied', stores.state.video === '/videos/live-1.mp4', stores.state);

        setHeroMode('none');
        applyHeroRecordBackground(loadHeroRecord(), stores.api);
        assert('live.none_clears', stores.state.video === '', stores.state);

        selectHeroAsset({
            assetId: 'live-2',
            mediaUrl: '/videos/live-2.mp4',
            mediaKind: 'video',
            heroTitle: 'Live Title'
        });
        applyHeroRecordBackground(loadHeroRecord(), stores.api);
        assert(
            'live.asset_switch',
            stores.state.video === '/videos/live-2.mp4' && loadHeroRecord().heroTitle === 'Live Title',
            { stores: stores.state, record: loadHeroRecord() }
        );

        // ── D. Manager-only + override intelligence rules ──────────────────
        wipe();
        selectHeroAsset({
            assetId: 'ovr-1',
            mediaUrl: '/videos/ovr-1.mp4',
            mediaKind: 'video'
        });
        assert('intel.asset_is_override', hasUserHeroOverride({}) === true);

        setHeroMode('selection');
        assert('intel.selection_not_override', hasUserHeroOverride({}) === false);

        setHeroMode('none');
        assert('intel.none_is_override', hasUserHeroOverride({}) === true);

        wipe();
        selectHeroAsset({
            assetId: 'mgr-only',
            mediaUrl: '/videos/mgr-only.mp4',
            mediaKind: 'video'
        });
        const before = loadHeroRecord().mediaUrl;
        // Manager-only save (no identity write) must not change HeroRecord media.
        saveHeroManagerConfig({
            heroType: 'CONTINUE_WATCHING',
            autoRotate: false,
            carouselDurationMs: 11000
        });
        assert(
            'regression.manager_settings_keep_record_media',
            loadHeroRecord().mediaUrl === before &&
                loadHeroManagerConfig().carouselDurationMs === 11000,
            { record: loadHeroRecord(), manager: loadHeroManagerConfig() }
        );
        stores = makeStores();
        applyHeroManagerBackground(loadHeroManagerConfig(), stores.api);
        assert(
            'regression.manager_background_uses_record_asset',
            stores.state.video === '/videos/mgr-only.mp4',
            stores.state
        );

        // Image asset
        wipe();
        selectHeroAsset({
            assetId: 'img-1',
            mediaUrl: '/thumbs/img-1.jpg',
            mediaKind: 'image'
        });
        stores = makeStores();
        mode = hydrateHeroBackgroundStoresSync(stores.api);
        assert(
            'boot.image_asset',
            mode === 'image' && stores.state.poster === '/thumbs/img-1.jpg' && stores.state.video === '',
            { mode, stores: stores.state }
        );

        // Async hydrate respects none (no server default resurrection)
        wipe();
        setHeroMode('none');
        stores = makeStores();
        const asyncNone = await hydrateHeroBackgroundStores(stores.api, {
            HERO_VIDEO_PATHS: ['/videos/default-should-not-apply.mp4']
        });
        assert(
            'async.none_skips_server_default',
            asyncNone === 'unchanged' && stores.state.video === '',
            { asyncNone, stores: stores.state }
        );

        // Presentation updates do not change media kind
        wipe();
        selectHeroAsset({
            assetId: 'pres-1',
            mediaUrl: '/videos/pres-1.mp4',
            mediaKind: 'video'
        });
        updateHeroPresentation({ heroTitle: 'Presented', heroDescription: 'Body' });
        stores = makeStores();
        mode = hydrateHeroBackgroundStoresSync(stores.api);
        assert(
            'copy.presentation_preserves_media',
            mode === 'video' &&
                stores.state.video === '/videos/pres-1.mp4' &&
                loadHeroRecord().heroTitle === 'Presented',
            { mode, record: loadHeroRecord() }
        );
    } finally {
        await server.close();
    }

    const failed = results.filter((r) => !r.pass);
    const report = {
        suite: 'hero-viewer-hydration',
        total: results.length,
        passed: results.length - failed.length,
        failed: failed.length,
        results,
        ts: new Date().toISOString()
    };
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(`\n${report.passed}/${report.total} passed → ${OUT}`);
    if (failed.length) {
        process.exitCode = 1;
        for (const f of failed) console.error('FAIL detail', f.id, f.detail);
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
