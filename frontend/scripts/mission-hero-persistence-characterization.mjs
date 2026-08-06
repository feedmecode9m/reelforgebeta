#!/usr/bin/env node
/**
 * Characterization coverage for Smart Production Studio Hero persistence.
 *
 * Captures CURRENT behavior (pre–HeroRecord migration). No production changes.
 *
 * Behavioral focus:
 * - selected Hero survives restart
 * - blank stays blank
 * - selection uses selection content
 * - copy matches Hero
 * - conflicts resolve predictably
 * - Viewer hydrate paths (sync + async)
 * - commit event contracts
 * - mode transitions with reload
 *
 * Isolation:
 * - Fixtures that touch module-scoped migration state run in a FRESH Node process
 *   (new module graph — no shared legacyMigrated flag).
 *
 * Usage:
 *   node scripts/mission-hero-persistence-characterization.mjs
 *   npm run test:hero-persistence
 *
 * Report path (temp by default):
 *   OUT=/path node scripts/mission-hero-persistence-characterization.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = __filename;

const OUT =
    process.env.OUT ||
    path.join(os.tmpdir(), 'reelforge-hero-persistence-characterization.json');

const HERO_MANAGER_KEY = 'reelforge_hero_manager_config';
const HERO_REEL_KEY = 'reelforge_hero_reel';
const HERO_VIDEO_KEY = 'reelforge_hero_video';
const HERO_IMAGE_KEY = 'reelforge_hero_image';

const VIDEO_ID = 'char-hero-video-uuid-0001';
const IMAGE_ID = 'char-hero-image-uuid-0002';
const STALE_REEL_ID = 'char-stale-reel-uuid-9999';
const SELECTION_REEL_ID = 'selection-episode-reel-uuid';
const VIDEO_URL = '/videos/characterization-hero.mp4';
const IMAGE_URL = '/thumbs/characterization-hero.jpg';
const STALE_VIDEO_URL = '/videos/stale-hero.mp4';
const SELECTION_VIDEO_URL = '/videos/selection-episode.mp4';
const DEFAULT_HERO_PATH = '/videos/hero-background.mp4';

const videoVaultItem = {
    id: VIDEO_ID,
    name: 'Characterization Hero Video',
    title: 'Characterization Hero Video',
    fileName: 'characterization-hero.mp4',
    url: VIDEO_URL,
    type: 'video/mp4'
};
const imageVaultItem = {
    id: IMAGE_ID,
    name: 'Characterization Hero Image',
    title: 'Characterization Hero Image',
    fileName: 'characterization-hero.jpg',
    url: IMAGE_URL,
    type: 'image/jpeg'
};

/** @type {Record<string, string>} */
const storage = {};

/** @type {Map<string, Set<(event: any) => void>>} */
const eventListeners = new Map();

function installBrowserShims() {
    eventListeners.clear();
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
        },
        key: (index) => Object.keys(storage)[index] ?? null,
        get length() {
            return Object.keys(storage).length;
        }
    };
    globalThis.window = {
        localStorage: globalThis.localStorage,
        dispatchEvent(event) {
            const name = event?.type || event;
            for (const fn of eventListeners.get(name) || []) fn(event);
            return true;
        },
        addEventListener(name, fn) {
            if (!eventListeners.has(name)) eventListeners.set(name, new Set());
            eventListeners.get(name).add(fn);
        },
        removeEventListener(name, fn) {
            eventListeners.get(name)?.delete(fn);
        },
        performance: { now: () => Date.now() },
        location: { origin: 'http://127.0.0.1:5173', href: 'http://127.0.0.1:5173/' },
        __reelforgeSentinel: null
    };
    globalThis.CustomEvent = class CustomEvent {
        /**
         * @param {string} type
         * @param {{ detail?: unknown }} [init]
         */
        constructor(type, init = {}) {
            this.type = type;
            this.detail = init.detail;
        }
    };
    globalThis.performance = { now: () => Date.now() };
    globalThis.document = undefined;
    /** Default offline fetch: server default hero path is present; others are missing. */
    globalThis.fetch = async (input) => {
        const url = String(input || '');
        const ok = url.includes('hero-background');
        return { ok, status: ok ? 200 : 404 };
    };
}

function wipeStorage() {
    for (const key of Object.keys(storage)) delete storage[key];
}

function writeJson(key, value) {
    storage[key] = JSON.stringify(value);
}

function readJson(key) {
    const raw = storage[key];
    if (raw == null) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return { __parseError: true, raw };
    }
}

function makeStores() {
    const state = { video: /** @type {string|null} */ (null), poster: /** @type {string|null} */ (null), failed: /** @type {boolean|null} */ (null) };
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

/**
 * Capture reelforge hero events for contract checks.
 * @returns {{ list: any[]; detach: () => void }}
 */
function attachEventCapture(types = ['reelforge:hero-manager-updated', 'reelforge:hero-intelligence-updated']) {
    /** @type {any[]} */
    const list = [];
    /** @type {Array<[string, (e: any) => void]>} */
    const pairs = [];
    for (const type of types) {
        const handler = (event) => {
            list.push({ type, detail: event?.detail ?? null });
        };
        window.addEventListener(type, handler);
        pairs.push([type, handler]);
    }
    return {
        list,
        detach() {
            for (const [type, handler] of pairs) window.removeEventListener(type, handler);
        }
    };
}

/** @type {Array<{ id: string; pass: boolean; detail?: unknown }>} */
const results = [];

/**
 * @param {string} id
 * @param {boolean} condition
 * @param {unknown} [detail]
 */
function assert(id, condition, detail) {
    const pass = Boolean(condition);
    results.push({ id, pass, detail: detail ?? null });
    // Keep console compact — only ids; full detail lives in the report.
    console.log(`${pass ? 'PASS' : 'FAIL'} ${id}`);
}

/**
 * @param {import('vite').ViteDevServer} server
 */
async function loadHeroModules(server) {
    const intel = await server.ssrLoadModule('/src/lib/hero/heroIntelligence.js');
    const reel = await server.ssrLoadModule('/src/lib/hero/heroReelIdentity.js');
    return { intel, reel };
}

/**
 * Snapshot durable hero state for "survives restart" checks.
 */
function capturePersistentSnapshot() {
    return {
        manager: readJson(HERO_MANAGER_KEY),
        reel: readJson(HERO_REEL_KEY),
        legacyVideo: storage[HERO_VIDEO_KEY] ?? null,
        legacyImage: storage[HERO_IMAGE_KEY] ?? null
    };
}

/**
 * Re-seed storage from a snapshot (simulates cold session storage).
 * @param {ReturnType<typeof capturePersistentSnapshot>} snap
 */
function restoreSnapshot(snap) {
    wipeStorage();
    if (snap.manager && !snap.manager.__parseError) writeJson(HERO_MANAGER_KEY, snap.manager);
    else if (snap.manager?.__parseError) storage[HERO_MANAGER_KEY] = String(snap.manager.raw);
    if (snap.reel && !snap.reel.__parseError) writeJson(HERO_REEL_KEY, snap.reel);
    else if (snap.reel?.__parseError) storage[HERO_REEL_KEY] = String(snap.reel.raw);
    if (snap.legacyVideo != null) storage[HERO_VIDEO_KEY] = snap.legacyVideo;
    if (snap.legacyImage != null) storage[HERO_IMAGE_KEY] = snap.legacyImage;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fresh-process isolation (new module graph per call)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} caseId
 * @param {Record<string, string>} seed
 * @returns {{ pass: boolean; results: typeof results; error?: string }}
 */
function runIsolatedCase(caseId, seed = {}) {
    const seedPath = path.join(
        os.tmpdir(),
        `reelforge-hero-char-seed-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
    );
    const resultPath = `${seedPath}.result.json`;
    fs.writeFileSync(seedPath, JSON.stringify(seed), 'utf8');
    try {
        const child = spawnSync(process.execPath, [SCRIPT_PATH, '--fresh-case', caseId], {
            cwd: FRONTEND_ROOT,
            env: {
                ...process.env,
                HERO_CHAR_SEED: seedPath,
                HERO_CHAR_RESULT: resultPath
            },
            encoding: 'utf8',
            maxBuffer: 20 * 1024 * 1024
        });
        if (child.status !== 0 && !fs.existsSync(resultPath)) {
            return {
                pass: false,
                results: [
                    {
                        id: `fresh.${caseId}.process`,
                        pass: false,
                        detail: {
                            status: child.status,
                            stderr: (child.stderr || '').slice(-2000),
                            stdout: (child.stdout || '').slice(-2000)
                        }
                    }
                ],
                error: `child failed status=${child.status}`
            };
        }
        const payload = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        return payload;
    } finally {
        try {
            fs.unlinkSync(seedPath);
        } catch {
            /* ignore */
        }
        try {
            fs.unlinkSync(resultPath);
        } catch {
            /* ignore */
        }
    }
}

/**
 * Run a single isolated fixture (invoked only as a child via --fresh-case).
 * @param {string} caseId
 * @param {{ intel: any; reel: any }} modules
 */
async function executeFreshCase(caseId, modules) {
    const { intel, reel } = modules;
    const {
        loadHeroManagerConfig,
        saveHeroManagerConfig,
        hydrateHeroBackgroundStoresSync,
        hydrateHeroBackgroundStores,
        resolveHeroBackgroundPresentation,
        commitHeroAssetSelection,
        getDefaultHeroManagerConfig
    } = intel;
    const { loadHeroReel, migrateLegacyHeroStorageIfNeeded } = reel;

    wipeStorage();
    const seedPath = process.env.HERO_CHAR_SEED;
    if (seedPath && fs.existsSync(seedPath)) {
        const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
        for (const [k, v] of Object.entries(seed || {})) {
            storage[k] = String(v);
        }
    }

    switch (caseId) {
        case 'legacy.migrate_custom_video_keys': {
            // Migration fixture — storage keys only matter as input to migration.
            storage[HERO_MANAGER_KEY] = JSON.stringify({
                backgroundSource: 'custom_video',
                heroAssetId: 'legacy-video-asset',
                backgroundStyle: 'video'
            });
            storage[HERO_VIDEO_KEY] = VIDEO_URL;
            storage[HERO_IMAGE_KEY] = IMAGE_URL;
            migrateLegacyHeroStorageIfNeeded();
            const migrated = loadHeroReel();
            const afterKeys = {
                hasReel: Boolean(storage[HERO_REEL_KEY]),
                videoKey: storage[HERO_VIDEO_KEY] ?? null,
                imageKey: storage[HERO_IMAGE_KEY] ?? null
            };
            assert(
                'fresh.legacy.migrate_video_creates_playable_reel',
                migrated?.id === 'legacy-video-asset' &&
                    migrated?.url === VIDEO_URL &&
                    migrated?.backgroundSource === 'custom_video',
                migrated
            );
            assert(
                'fresh.legacy.migrate_removes_legacy_media_keys',
                afterKeys.videoKey == null && afterKeys.imageKey == null && afterKeys.hasReel,
                afterKeys
            );
            // Restart: reel survives; hydrate prefers aligned manager+reel.
            writeJson(HERO_MANAGER_KEY, {
                ...getDefaultHeroManagerConfig(),
                backgroundSource: 'custom_video',
                heroAssetId: 'legacy-video-asset',
                backgroundStyle: 'video'
            });
            const snap = capturePersistentSnapshot();
            restoreSnapshot(snap);
            const stores = makeStores();
            const mode = hydrateHeroBackgroundStoresSync(stores.api);
            assert(
                'fresh.legacy.selected_hero_survives_restart',
                mode === 'video' && stores.state.video === VIDEO_URL,
                { mode, stores: stores.state }
            );
            break;
        }
        case 'legacy.unsafe_blob_video': {
            // blob: video is not migrated into hero reel (migrate skips blob).
            storage[HERO_MANAGER_KEY] = JSON.stringify({
                backgroundSource: 'custom_video',
                heroAssetId: 'blob-hero',
                backgroundStyle: 'video'
            });
            storage[HERO_VIDEO_KEY] = 'blob:http://127.0.0.1:5173/dead-blob';
            migrateLegacyHeroStorageIfNeeded();
            assert('fresh.unsafe.blob_not_migrated_to_reel', loadHeroReel() === null, loadHeroReel());
            const stores = makeStores();
            const mode = hydrateHeroBackgroundStoresSync(stores.api);
            // Blob key stripped during hydrate; without reel/manager media → pending_default
            assert(
                'fresh.unsafe.blob_strip_or_skip_during_hydrate',
                storage[HERO_VIDEO_KEY] == null || mode === 'pending_default' || mode === 'unchanged',
                { mode, videoKey: storage[HERO_VIDEO_KEY] ?? null, stores: stores.state }
            );
            break;
        }
        case 'legacy.unsafe_data_image': {
            const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
            storage[HERO_MANAGER_KEY] = JSON.stringify({
                backgroundSource: 'selection',
                heroAssetId: '',
                backgroundStyle: 'image'
            });
            storage[HERO_IMAGE_KEY] = dataUrl;
            migrateLegacyHeroStorageIfNeeded();
            assert(
                'fresh.unsafe.data_image_not_migrated_to_reel',
                loadHeroReel() === null,
                loadHeroReel()
            );
            const stores = makeStores();
            const mode = hydrateHeroBackgroundStoresSync(stores.api);
            // Current behavior: selection does not short-circuit none path; data: poster is used.
            assert(
                'fresh.unsafe.data_image_hydrate_behavior',
                mode === 'image' && stores.state.poster === dataUrl && stores.state.video === '',
                { mode, stores: stores.state }
            );
            break;
        }
        case 'unsafe.malformed_manager_json': {
            storage[HERO_MANAGER_KEY] = '{not-json';
            writeJson(HERO_REEL_KEY, {
                id: VIDEO_ID,
                fileName: 'characterization-hero.mp4',
                name: 'Video',
                url: VIDEO_URL,
                type: 'video/mp4',
                backgroundSource: 'custom_video'
            });
            const cfg = loadHeroManagerConfig();
            assert(
                'fresh.unsafe.malformed_manager_falls_back_safely',
                cfg.backgroundSource === 'none' || cfg.backgroundSource === 'selection' || typeof cfg.heroAssetId === 'string',
                cfg
            );
            // Blank-ish default after parse failure — must not crash; reel may remain untouched.
            assert('fresh.unsafe.malformed_manager_load_does_not_throw', true);
            assert(
                'fresh.unsafe.malformed_manager_blank_or_default',
                cfg.backgroundSource === 'none' && cfg.heroAssetId === '',
                { backgroundSource: cfg.backgroundSource, heroAssetId: cfg.heroAssetId }
            );
            break;
        }
        case 'unsafe.malformed_reel_json': {
            writeJson(HERO_MANAGER_KEY, {
                ...getDefaultHeroManagerConfig(),
                backgroundSource: 'custom_video',
                heroAssetId: VIDEO_ID,
                backgroundStyle: 'video'
            });
            storage[HERO_REEL_KEY] = '{bad-reel';
            assert('fresh.unsafe.malformed_reel_loads_null', loadHeroReel() === null);
            const stores = makeStores();
            // Manager custom + missing usable reel → vault/manager apply or pending.
            const mode = hydrateHeroBackgroundStoresSync(stores.api, {});
            assert(
                'fresh.unsafe.malformed_reel_does_not_crash_hydrate',
                mode === 'pending_default' || mode === 'video' || mode === 'image' || mode === 'unchanged',
                { mode, stores: stores.state }
            );
            break;
        }
        case 'unsafe.empty_urls': {
            writeJson(HERO_MANAGER_KEY, {
                ...getDefaultHeroManagerConfig(),
                backgroundSource: 'custom_video',
                heroAssetId: 'empty-url-asset',
                backgroundStyle: 'video'
            });
            writeJson(HERO_REEL_KEY, {
                id: 'empty-url-asset',
                fileName: '',
                name: 'Empty',
                url: '',
                type: 'video/mp4',
                backgroundSource: 'custom_video'
            });
            // loadHeroReel requires url — empty url rejected
            assert('fresh.unsafe.empty_reel_url_rejected', loadHeroReel() === null);
            const stores = makeStores();
            const mode = hydrateHeroBackgroundStoresSync(stores.api);
            assert(
                'fresh.unsafe.empty_urls_pending_or_blank',
                mode === 'pending_default' || (stores.state.video == null || stores.state.video === ''),
                { mode, stores: stores.state }
            );
            break;
        }
        case 'hydrate.none_ignores_stale_reel': {
            writeJson(HERO_MANAGER_KEY, {
                ...getDefaultHeroManagerConfig(),
                backgroundSource: 'none',
                heroAssetId: '',
                backgroundStyle: 'gradient_overlay',
                heroTitle: 'Blank Intentional'
            });
            writeJson(HERO_REEL_KEY, {
                id: STALE_REEL_ID,
                fileName: 'stale.mp4',
                name: 'Stale',
                url: STALE_VIDEO_URL,
                type: 'video/mp4',
                backgroundSource: 'custom_video'
            });
            const cfg = loadHeroManagerConfig();
            assert(
                'fresh.conflict.none_stays_blank_on_load',
                cfg.backgroundSource === 'none' && cfg.heroAssetId === '',
                cfg
            );
            const stores = makeStores();
            const mode = hydrateHeroBackgroundStoresSync(stores.api);
            assert(
                'fresh.conflict.none_hydrate_clears_viewer_media',
                mode === 'unchanged' && stores.state.video === '' && stores.state.poster === '',
                { mode, stores: stores.state }
            );
            // Stale reel may still sit in storage until an explicit none save — document current behavior.
            assert(
                'fresh.conflict.none_hydrate_does_not_require_reel_purge',
                Boolean(storage[HERO_REEL_KEY]),
                { reelPresent: Boolean(storage[HERO_REEL_KEY]) }
            );
            break;
        }
        case 'hydrate.id_mismatch': {
            writeJson(HERO_MANAGER_KEY, {
                ...getDefaultHeroManagerConfig(),
                backgroundSource: 'custom_video',
                heroAssetId: VIDEO_ID,
                backgroundStyle: 'video'
            });
            writeJson(HERO_REEL_KEY, {
                id: STALE_REEL_ID,
                fileName: 'stale.mp4',
                name: 'Stale',
                url: STALE_VIDEO_URL,
                type: 'video/mp4',
                backgroundSource: 'custom_video'
            });
            // Seed vault so manager id can resolve without reel match.
            writeJson('personal_video_vault', [videoVaultItem]);
            const stores = makeStores();
            const mode = hydrateHeroBackgroundStoresSync(stores.api);
            assert(
                'fresh.conflict.mismatch_prefers_manager_or_vault_not_stale_reel',
                mode === 'video' && stores.state.video === VIDEO_URL,
                { mode, stores: stores.state, reel: loadHeroReel() }
            );
            break;
        }
        case 'hydrate.custom_missing_reel': {
            writeJson(HERO_MANAGER_KEY, {
                ...getDefaultHeroManagerConfig(),
                backgroundSource: 'custom_video',
                heroAssetId: VIDEO_ID,
                backgroundStyle: 'video'
            });
            // No reel key. Vault present.
            writeJson('personal_video_vault', [videoVaultItem]);
            const stores = makeStores();
            const mode = hydrateHeroBackgroundStoresSync(stores.api);
            assert(
                'fresh.conflict.custom_missing_reel_uses_manager_vault',
                mode === 'video' && stores.state.video === VIDEO_URL,
                { mode, stores: stores.state }
            );
            break;
        }
        case 'hydrate.reel_invalid_manager': {
            storage[HERO_MANAGER_KEY] = '%%%invalid%%%';
            writeJson(HERO_REEL_KEY, {
                id: VIDEO_ID,
                fileName: 'ok.mp4',
                name: 'Video',
                url: VIDEO_URL,
                type: 'video/mp4',
                backgroundSource: 'custom_video'
            });
            const cfg = loadHeroManagerConfig();
            const stores = makeStores();
            const mode = hydrateHeroBackgroundStoresSync(stores.api);
            // Invalid manager → defaults to none path after finalize → clears media.
            assert(
                'fresh.conflict.invalid_manager_with_reel_resolves_predictably',
                cfg.backgroundSource === 'none' && mode === 'unchanged' && stores.state.video === '',
                { cfg: { backgroundSource: cfg.backgroundSource, heroAssetId: cfg.heroAssetId }, mode, stores: stores.state }
            );
            break;
        }
        case 'hydrate.custom_image_stale_video_key': {
            writeJson(HERO_MANAGER_KEY, {
                ...getDefaultHeroManagerConfig(),
                backgroundSource: 'custom_image',
                heroAssetId: IMAGE_ID,
                backgroundStyle: 'image'
            });
            writeJson(HERO_REEL_KEY, {
                id: IMAGE_ID,
                fileName: 'characterization-hero.jpg',
                name: 'Image',
                url: IMAGE_URL,
                type: 'image/jpeg',
                backgroundSource: 'custom_image'
            });
            storage[HERO_VIDEO_KEY] = STALE_VIDEO_URL;
            const stores = makeStores();
            const mode = hydrateHeroBackgroundStoresSync(stores.api);
            assert(
                'fresh.conflict.custom_image_ignores_stale_video_key',
                mode === 'image' &&
                    stores.state.poster === IMAGE_URL &&
                    (stores.state.video === '' || stores.state.video == null),
                { mode, stores: stores.state, videoKey: storage[HERO_VIDEO_KEY] ?? null }
            );
            break;
        }
        case 'hydrate.custom_video_stale_image_key': {
            writeJson(HERO_MANAGER_KEY, {
                ...getDefaultHeroManagerConfig(),
                backgroundSource: 'custom_video',
                heroAssetId: VIDEO_ID,
                backgroundStyle: 'video'
            });
            writeJson(HERO_REEL_KEY, {
                id: VIDEO_ID,
                fileName: 'characterization-hero.mp4',
                name: 'Video',
                url: VIDEO_URL,
                type: 'video/mp4',
                backgroundSource: 'custom_video'
            });
            storage[HERO_IMAGE_KEY] = '/thumbs/stale-poster.jpg';
            const stores = makeStores();
            const mode = hydrateHeroBackgroundStoresSync(stores.api);
            assert(
                'fresh.conflict.custom_video_prefers_reel_over_stale_image_key',
                mode === 'video' && stores.state.video === VIDEO_URL,
                { mode, stores: stores.state, imageKey: storage[HERO_IMAGE_KEY] ?? null }
            );
            break;
        }
        case 'hydrate.defaults_async': {
            // Current default manager is backgroundSource=none → blank menu, not pending_default.
            const emptyStores = makeStores();
            const emptyMode = hydrateHeroBackgroundStoresSync(emptyStores.api);
            assert(
                'fresh.hydrate.empty_storage_is_blank_none',
                emptyMode === 'unchanged' &&
                    emptyStores.state.video === '' &&
                    emptyStores.state.poster === '',
                { emptyMode, stores: emptyStores.state }
            );
            assert(
                'fresh.hydrate.empty_async_short_circuits_without_server_default',
                (await hydrateHeroBackgroundStores(emptyStores.api, {
                    HERO_VIDEO_PATHS: [DEFAULT_HERO_PATH]
                })) === 'unchanged' && emptyStores.state.video === '',
                emptyStores.state
            );

            // Non-none manager without resolvable media reaches pending_default, then async default.
            writeJson(HERO_MANAGER_KEY, {
                ...getDefaultHeroManagerConfig(),
                backgroundSource: 'selection',
                heroAssetId: '',
                backgroundStyle: 'video'
            });
            const stores = makeStores();
            const syncMode = hydrateHeroBackgroundStoresSync(stores.api);
            assert(
                'fresh.hydrate.selection_without_media_is_pending_default',
                syncMode === 'pending_default',
                syncMode
            );
            const asyncMode = await hydrateHeroBackgroundStores(stores.api, {
                HERO_VIDEO_PATHS: [DEFAULT_HERO_PATH]
            });
            assert(
                'fresh.hydrate.async_applies_server_default_for_pending',
                asyncMode === 'default' && stores.state.video === DEFAULT_HERO_PATH,
                { asyncMode, stores: stores.state }
            );
            break;
        }
        case 'hydrate.defaults_async_missing': {
            writeJson(HERO_MANAGER_KEY, {
                ...getDefaultHeroManagerConfig(),
                backgroundSource: 'selection',
                heroAssetId: '',
                backgroundStyle: 'video'
            });
            globalThis.fetch = async () => ({ ok: false, status: 404 });
            const stores = makeStores();
            const asyncMode = await hydrateHeroBackgroundStores(stores.api, {
                HERO_VIDEO_PATHS: ['/videos/definitely-missing-hero.mp4']
            });
            assert(
                'fresh.hydrate.async_missing_marks_failed',
                asyncMode === 'missing' && stores.state.failed === true && stores.state.video === '',
                { asyncMode, stores: stores.state }
            );
            break;
        }
        case 'restart.selection_content': {
            writeJson(HERO_MANAGER_KEY, {
                ...getDefaultHeroManagerConfig(),
                backgroundSource: 'selection',
                heroAssetId: '',
                backgroundStyle: 'video',
                heroTitle: 'Selection Title'
            });
            const snap = capturePersistentSnapshot();
            restoreSnapshot(snap);
            const cfg = loadHeroManagerConfig();
            const presentation = resolveHeroBackgroundPresentation(cfg, null, {
                reelId: SELECTION_REEL_ID,
                videoUrl: SELECTION_VIDEO_URL,
                posterUrl: '',
                title: 'Episode'
            });
            assert(
                'fresh.restart.selection_uses_selection_content',
                cfg.backgroundSource === 'selection' &&
                    presentation.backgroundSource === 'selection' &&
                    presentation.assetId === SELECTION_REEL_ID &&
                    presentation.vaultMatch === false &&
                    presentation.videoUrl === SELECTION_VIDEO_URL,
                presentation
            );
            break;
        }
        case 'restart.copy_matches_hero': {
            writeJson(HERO_MANAGER_KEY, {
                ...getDefaultHeroManagerConfig(),
                backgroundSource: 'custom_video',
                heroAssetId: VIDEO_ID,
                backgroundStyle: 'video',
                heroTitle: 'My Hero Title',
                heroSubtitle: 'My Subtitle',
                heroDescription: 'My Description'
            });
            writeJson(HERO_REEL_KEY, {
                id: VIDEO_ID,
                fileName: 'characterization-hero.mp4',
                name: 'Characterization Hero Video',
                url: VIDEO_URL,
                type: 'video/mp4',
                backgroundSource: 'custom_video'
            });
            const snap = capturePersistentSnapshot();
            restoreSnapshot(snap);
            const cfg = loadHeroManagerConfig();
            assert(
                'fresh.restart.copy_matches_hero',
                cfg.heroTitle === 'My Hero Title' &&
                    cfg.heroSubtitle === 'My Subtitle' &&
                    cfg.heroDescription === 'My Description' &&
                    cfg.heroAssetId === VIDEO_ID,
                {
                    heroTitle: cfg.heroTitle,
                    heroSubtitle: cfg.heroSubtitle,
                    heroDescription: cfg.heroDescription,
                    heroAssetId: cfg.heroAssetId
                }
            );
            break;
        }
        default:
            assert(`fresh.unknown_case.${caseId}`, false, caseId);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-process suite (shared module graph — no migration-state dependence)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {{ intel: any; reel: any }} modules
 */
async function runSharedGraphSuite(modules) {
    const { intel, reel } = modules;
    const {
        getDefaultHeroManagerConfig,
        loadHeroManagerConfig,
        saveHeroManagerConfig,
        commitHeroVideoIdentity,
        commitHeroAssetSelection,
        resolveHeroBackgroundPresentation,
        applyHeroManagerBackground,
        applyHeroSelection,
        hydrateHeroBackgroundStoresSync,
        hydrateHeroBackgroundStores
    } = intel;
    const { loadHeroReel, saveHeroReel, clearHeroReel, resolveActiveHeroVideoReel } = reel;

    // ── Behavioral baselines ────────────────────────────────────────────────
    wipeStorage();
    const defaults = getDefaultHeroManagerConfig();
    assert(
        'behavior.blank_default',
        defaults.backgroundSource === 'none' && defaults.heroAssetId === '',
        { backgroundSource: defaults.backgroundSource, heroAssetId: defaults.heroAssetId }
    );

    // Custom video — selected hero survives restart
    wipeStorage();
    const videoCfg = commitHeroAssetSelection(VIDEO_ID, [videoVaultItem]);
    assert(
        'behavior.custom_video_selected',
        videoCfg?.backgroundSource === 'custom_video' &&
            videoCfg?.heroAssetId === VIDEO_ID &&
            loadHeroReel()?.url === VIDEO_URL,
        { backgroundSource: videoCfg?.backgroundSource, heroAssetId: videoCfg?.heroAssetId, reel: loadHeroReel() }
    );
    const videoSnap = capturePersistentSnapshot();
    restoreSnapshot(videoSnap);
    const reloadedVideo = loadHeroManagerConfig();
    const reloadedReel = loadHeroReel();
    assert(
        'behavior.selected_video_survives_restart',
        reloadedVideo.backgroundSource === 'custom_video' &&
            reloadedVideo.heroAssetId === VIDEO_ID &&
            reloadedReel?.id === VIDEO_ID &&
            reloadedReel?.url === VIDEO_URL,
        { config: { backgroundSource: reloadedVideo.backgroundSource, heroAssetId: reloadedVideo.heroAssetId }, reel: reloadedReel }
    );
    const restartStores = makeStores();
    const restartMode = hydrateHeroBackgroundStoresSync(restartStores.api);
    assert(
        'behavior.viewer_hydrates_selected_video_after_restart',
        restartMode === 'video' && restartStores.state.video === VIDEO_URL,
        { restartMode, stores: restartStores.state }
    );

    // Custom image
    wipeStorage();
    const imageCfg = commitHeroAssetSelection(IMAGE_ID, [imageVaultItem]);
    assert(
        'behavior.custom_image_selected',
        imageCfg?.backgroundSource === 'custom_image' && imageCfg?.heroAssetId === IMAGE_ID,
        imageCfg && { backgroundSource: imageCfg.backgroundSource, heroAssetId: imageCfg.heroAssetId }
    );
    const imageSnap = capturePersistentSnapshot();
    restoreSnapshot(imageSnap);
    const imageHydrate = makeStores();
    assert(
        'behavior.selected_image_survives_restart',
        hydrateHeroBackgroundStoresSync(imageHydrate.api) === 'image' &&
            imageHydrate.state.poster === IMAGE_URL,
        imageHydrate.state
    );
    assert(
        'behavior.custom_image_not_active_video_reel',
        resolveActiveHeroVideoReel() === null
    );

    // Selection uses selection content
    wipeStorage();
    saveHeroManagerConfig({
        backgroundSource: 'selection',
        heroAssetId: '',
        backgroundStyle: 'video'
    });
    const selectionCfg = loadHeroManagerConfig();
    const selectionPres = resolveHeroBackgroundPresentation(selectionCfg, [videoVaultItem], {
        reelId: SELECTION_REEL_ID,
        videoUrl: SELECTION_VIDEO_URL,
        posterUrl: '',
        title: 'Episode Pick'
    });
    assert(
        'behavior.selection_uses_selection_content',
        selectionPres.backgroundSource === 'selection' &&
            selectionPres.assetId === SELECTION_REEL_ID &&
            selectionPres.vaultMatch === false &&
            selectionPres.videoUrl === SELECTION_VIDEO_URL,
        {
            assetId: selectionPres.assetId,
            vaultMatch: selectionPres.vaultMatch,
            videoUrl: selectionPres.videoUrl
        }
    );
    assert(
        'behavior.selection_apply_does_not_override_user_selection_mode',
        applyHeroManagerBackground(selectionCfg, makeStores().api) === false
    );

    // Blank stays blank
    wipeStorage();
    commitHeroAssetSelection(VIDEO_ID, [videoVaultItem]);
    commitHeroAssetSelection('');
    const blankSnap = capturePersistentSnapshot();
    restoreSnapshot(blankSnap);
    const blankCfg = loadHeroManagerConfig();
    const blankStores = makeStores();
    const blankMode = hydrateHeroBackgroundStoresSync(blankStores.api);
    assert(
        'behavior.blank_stays_blank_after_restart',
        blankCfg.backgroundSource === 'none' &&
            blankCfg.heroAssetId === '' &&
            blankMode === 'unchanged' &&
            blankStores.state.video === '' &&
            blankStores.state.poster === '',
        { blankCfg: { backgroundSource: blankCfg.backgroundSource, heroAssetId: blankCfg.heroAssetId }, blankMode, stores: blankStores.state }
    );
    const blankPres = resolveHeroBackgroundPresentation(blankCfg, [videoVaultItem], {
        reelId: SELECTION_REEL_ID,
        videoUrl: SELECTION_VIDEO_URL
    });
    assert(
        'behavior.blank_presentation_ignores_selection_and_vault',
        blankPres.useVideo === false && blankPres.useImage === false && blankPres.backgroundSource === 'none',
        blankPres
    );

    // Copy matches hero
    wipeStorage();
    commitHeroAssetSelection(VIDEO_ID, [videoVaultItem]);
    saveHeroManagerConfig({
        heroTitle: 'Studio Title',
        heroSubtitle: 'Studio Subtitle',
        heroDescription: 'Studio Description'
    });
    const copySnap = capturePersistentSnapshot();
    restoreSnapshot(copySnap);
    const copyCfg = loadHeroManagerConfig();
    assert(
        'behavior.copy_matches_hero_after_restart',
        copyCfg.heroTitle === 'Studio Title' &&
            copyCfg.heroSubtitle === 'Studio Subtitle' &&
            copyCfg.heroDescription === 'Studio Description' &&
            copyCfg.heroAssetId === VIDEO_ID,
        {
            heroTitle: copyCfg.heroTitle,
            heroSubtitle: copyCfg.heroSubtitle,
            heroDescription: copyCfg.heroDescription,
            heroAssetId: copyCfg.heroAssetId
        }
    );

    // Blocked clear without source transition (current conflict rule)
    wipeStorage();
    saveHeroManagerConfig({
        backgroundSource: 'custom_image',
        heroAssetId: IMAGE_ID,
        backgroundStyle: 'image'
    });
    const blocked = saveHeroManagerConfig({ heroAssetId: '' });
    assert(
        'behavior.conflict_clear_without_source_keeps_asset',
        blocked.heroAssetId === IMAGE_ID,
        { heroAssetId: blocked.heroAssetId }
    );

    // Legacy field strip on save
    wipeStorage();
    const withLegacy = saveHeroManagerConfig({
        backgroundSource: 'custom_video',
        heroAssetId: VIDEO_ID,
        backgroundStyle: 'video',
        backgroundAsset: 'legacy-bg-asset',
        backgroundVideo: VIDEO_URL,
        backgroundImage: IMAGE_URL
    });
    const stored = readJson(HERO_MANAGER_KEY);
    assert(
        'behavior.legacy_fields_not_persisted',
        stored &&
            !Object.prototype.hasOwnProperty.call(stored, 'backgroundAsset') &&
            !Object.prototype.hasOwnProperty.call(stored, 'backgroundVideo') &&
            !Object.prototype.hasOwnProperty.call(stored, 'backgroundImage') &&
            !Object.prototype.hasOwnProperty.call(withLegacy, 'backgroundAsset'),
        { keys: stored && Object.keys(stored).filter((k) => k.startsWith('background')) }
    );

    // ── Event contracts ─────────────────────────────────────────────────────
    wipeStorage();
    const capture = attachEventCapture();
    const committed = commitHeroVideoIdentity({
        id: VIDEO_ID,
        fileName: 'characterization-hero.mp4',
        name: 'Characterization Hero Video',
        url: VIDEO_URL,
        type: 'video/mp4',
        backgroundSource: 'custom_video'
    });
    const managerEvents = capture.list.filter((e) => e.type === 'reelforge:hero-manager-updated');
    assert('events.commit_fires_manager_updated', managerEvents.length >= 1, {
        count: managerEvents.length
    });
    const detail = managerEvents[managerEvents.length - 1]?.detail || {};
    // Viewer handleHeroManagerUpdated needs backgroundSource + heroType (+ asset pointer for apply path).
    assert(
        'events.payload_sufficient_for_viewer_update',
        detail.backgroundSource === 'custom_video' &&
            detail.heroAssetId === VIDEO_ID &&
            typeof detail.heroType === 'string' &&
            detail.backgroundStyle === 'video',
        {
            backgroundSource: detail.backgroundSource,
            heroAssetId: detail.heroAssetId,
            heroType: detail.heroType,
            backgroundStyle: detail.backgroundStyle
        }
    );

    capture.list.length = 0;
    saveHeroManagerConfig({
        heroTitle: 'Event Title',
        heroSubtitle: 'Event Sub',
        heroDescription: 'Event Desc'
    });
    const copyEvent = capture.list.find((e) => e.type === 'reelforge:hero-manager-updated');
    assert(
        'events.copy_edit_payload_includes_copy_fields',
        copyEvent?.detail?.heroTitle === 'Event Title' &&
            copyEvent?.detail?.heroSubtitle === 'Event Sub' &&
            copyEvent?.detail?.heroDescription === 'Event Desc' &&
            copyEvent?.detail?.heroAssetId === VIDEO_ID,
        copyEvent?.detail && {
            heroTitle: copyEvent.detail.heroTitle,
            heroSubtitle: copyEvent.detail.heroSubtitle,
            heroDescription: copyEvent.detail.heroDescription,
            heroAssetId: copyEvent.detail.heroAssetId
        }
    );

    capture.list.length = 0;
    const selectionPayload = {
        mode: 'TRENDING',
        source: 'FEATURED_SERIES',
        title: 'Selection Event Title',
        subtitle: 'Sub',
        insight: 'Insight',
        reelId: SELECTION_REEL_ID,
        videoUrl: SELECTION_VIDEO_URL,
        posterUrl: ''
    };
    applyHeroSelection(selectionPayload, makeStores().api, {
        respectUserOverride: false,
        applyBackground: true
    });
    const intelEvents = capture.list.filter((e) => e.type === 'reelforge:hero-intelligence-updated');
    assert('events.apply_selection_fires_intelligence_updated', intelEvents.length >= 1);
    assert(
        'events.intelligence_payload_has_media_identity',
        intelEvents[0]?.detail?.reelId === SELECTION_REEL_ID &&
            intelEvents[0]?.detail?.videoUrl === SELECTION_VIDEO_URL,
        intelEvents[0]?.detail
    );
    capture.detach();
    assert('events.commit_returned_config', committed?.heroAssetId === VIDEO_ID, committed);

    // ── Mode transitions: selection → asset → none → selection ──────────────
    wipeStorage();
    saveHeroManagerConfig({
        backgroundSource: 'selection',
        heroAssetId: '',
        backgroundStyle: 'video',
        heroTitle: 'T0 Selection'
    });
    let snap = capturePersistentSnapshot();
    restoreSnapshot(snap);
    let cfg = loadHeroManagerConfig();
    assert(
        'transition.step1_selection_persists',
        cfg.backgroundSource === 'selection' && cfg.heroTitle === 'T0 Selection',
        { backgroundSource: cfg.backgroundSource, heroTitle: cfg.heroTitle }
    );

    const assetCfg = commitHeroAssetSelection(VIDEO_ID, [videoVaultItem]);
    saveHeroManagerConfig({
        heroTitle: 'T1 Asset Title',
        heroSubtitle: 'T1 Sub',
        heroDescription: 'T1 Desc'
    });
    snap = capturePersistentSnapshot();
    restoreSnapshot(snap);
    cfg = loadHeroManagerConfig();
    assert(
        'transition.step2_asset_survives_reload',
        cfg.backgroundSource === 'custom_video' &&
            cfg.heroAssetId === VIDEO_ID &&
            cfg.heroTitle === 'T1 Asset Title' &&
            loadHeroReel()?.id === VIDEO_ID,
        {
            backgroundSource: cfg.backgroundSource,
            heroAssetId: cfg.heroAssetId,
            heroTitle: cfg.heroTitle,
            reelId: loadHeroReel()?.id
        }
    );
    assert(
        'transition.step2_copy_matches_hero',
        cfg.heroTitle === 'T1 Asset Title' && cfg.heroSubtitle === 'T1 Sub',
        { heroTitle: cfg.heroTitle, heroSubtitle: cfg.heroSubtitle }
    );
    assert(
        'transition.step2_identity_active_video',
        resolveActiveHeroVideoReel()?.id === VIDEO_ID
    );

    saveHeroManagerConfig({
        backgroundSource: 'none',
        heroAssetId: '',
        heroTitle: 'T2 Blank'
    });
    snap = capturePersistentSnapshot();
    restoreSnapshot(snap);
    cfg = loadHeroManagerConfig();
    const noneStores = makeStores();
    const noneMode = hydrateHeroBackgroundStoresSync(noneStores.api);
    assert(
        'transition.step3_none_stays_blank_after_reload',
        cfg.backgroundSource === 'none' &&
            cfg.heroAssetId === '' &&
            cfg.heroTitle === 'T2 Blank' &&
            loadHeroReel() === null &&
            noneMode === 'unchanged' &&
            noneStores.state.video === '',
        {
            backgroundSource: cfg.backgroundSource,
            heroTitle: cfg.heroTitle,
            reel: loadHeroReel(),
            noneMode,
            stores: noneStores.state
        }
    );

    saveHeroManagerConfig({
        backgroundSource: 'selection',
        heroAssetId: '',
        backgroundStyle: 'video',
        heroTitle: 'T3 Back to Selection'
    });
    snap = capturePersistentSnapshot();
    restoreSnapshot(snap);
    cfg = loadHeroManagerConfig();
    const backPres = resolveHeroBackgroundPresentation(cfg, [videoVaultItem], {
        reelId: SELECTION_REEL_ID,
        videoUrl: SELECTION_VIDEO_URL
    });
    assert(
        'transition.step4_selection_restored_after_reload',
        cfg.backgroundSource === 'selection' &&
            cfg.heroTitle === 'T3 Back to Selection' &&
            backPres.videoUrl === SELECTION_VIDEO_URL &&
            backPres.vaultMatch === false,
        {
            backgroundSource: cfg.backgroundSource,
            heroTitle: cfg.heroTitle,
            presentation: {
                videoUrl: backPres.videoUrl,
                vaultMatch: backPres.vaultMatch
            }
        }
    );

    // Dual-write coordination after commit
    wipeStorage();
    commitHeroVideoIdentity({
        id: VIDEO_ID,
        fileName: 'characterization-hero.mp4',
        name: 'Characterization Hero Video',
        url: VIDEO_URL,
        type: 'video/mp4',
        backgroundSource: 'custom_video'
    });
    const mgrRaw = readJson(HERO_MANAGER_KEY);
    const reelRaw = readJson(HERO_REEL_KEY);
    assert(
        'behavior.manager_pointer_matches_reel_identity',
        mgrRaw?.heroAssetId === reelRaw?.id && mgrRaw?.backgroundSource === 'custom_video',
        { managerId: mgrRaw?.heroAssetId, reelId: reelRaw?.id }
    );

    // Silence unused after transitions (committed earlier)
    void assetCfg;
    void clearHeroReel;
    void hydrateHeroBackgroundStores;
    void saveHeroReel;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrypoints
// ─────────────────────────────────────────────────────────────────────────────

const FRESH_CASES = [
    'legacy.migrate_custom_video_keys',
    'legacy.unsafe_blob_video',
    'legacy.unsafe_data_image',
    'unsafe.malformed_manager_json',
    'unsafe.malformed_reel_json',
    'unsafe.empty_urls',
    'hydrate.none_ignores_stale_reel',
    'hydrate.id_mismatch',
    'hydrate.custom_missing_reel',
    'hydrate.reel_invalid_manager',
    'hydrate.custom_image_stale_video_key',
    'hydrate.custom_video_stale_image_key',
    'hydrate.defaults_async',
    'hydrate.defaults_async_missing',
    'restart.selection_content',
    'restart.copy_matches_hero'
];

async function runFreshChildMain(caseId) {
    installBrowserShims();
    const server = await createServer({
        root: FRONTEND_ROOT,
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error'
    });
    try {
        results.length = 0;
        const modules = await loadHeroModules(server);
        await executeFreshCase(caseId, modules);
        const payload = {
            pass: results.every((r) => r.pass),
            results
        };
        const resultPath = process.env.HERO_CHAR_RESULT;
        if (resultPath) {
            fs.writeFileSync(resultPath, JSON.stringify(payload), 'utf8');
        }
        process.exitCode = payload.pass ? 0 : 1;
    } catch (error) {
        const payload = {
            pass: false,
            results: [
                {
                    id: `fresh.${caseId}.harness`,
                    pass: false,
                    detail: error?.message || String(error)
                }
            ],
            error: error?.message || String(error)
        };
        const resultPath = process.env.HERO_CHAR_RESULT;
        if (resultPath) {
            fs.writeFileSync(resultPath, JSON.stringify(payload), 'utf8');
        }
        process.exitCode = 1;
    } finally {
        await server.close();
    }
}

async function runParentMain() {
    installBrowserShims();
    const server = await createServer({
        root: FRONTEND_ROOT,
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error'
    });

    try {
        console.log('— Shared module graph suite —');
        const modules = await loadHeroModules(server);
        await runSharedGraphSuite(modules);

        console.log('— Fresh process fixtures (isolated module graphs) —');
        for (const caseId of FRESH_CASES) {
            const isolated = runIsolatedCase(caseId, {});
            for (const row of isolated.results || []) {
                results.push(row);
                console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.id}`);
            }
            if (isolated.error && !(isolated.results || []).length) {
                assert(`fresh.${caseId}.error`, false, isolated.error);
            }
        }

        const failed = results.filter((r) => !r.pass);
        const report = {
            mission: 'hero-persistence-characterization',
            phase: 'pre-HeroRecord',
            generatedAt: new Date().toISOString(),
            reportPath: OUT,
            isolation: {
                sharedGraphAssertions: results.filter((r) => !String(r.id).startsWith('fresh.')).length,
                freshProcessCases: FRESH_CASES.length
            },
            results,
            summary: {
                total: results.length,
                passed: results.filter((r) => r.pass).length,
                failed: failed.length
            },
            pass: failed.length === 0,
            completionToken:
                failed.length === 0
                    ? 'HERO_PERSISTENCE_CHARACTERIZATION=true'
                    : 'HERO_PERSISTENCE_CHARACTERIZATION=false',
            failures: failed.map((f) => f.id)
        };

        fs.mkdirSync(path.dirname(OUT), { recursive: true });
        fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        console.log(report.completionToken);
        console.log(`report: ${OUT}`);
        console.log(`summary: ${report.summary.passed}/${report.summary.total} passed`);
        if (failed.length) {
            console.log('failures:', failed.map((f) => f.id).join(', '));
            process.exitCode = 1;
        }
    } catch (error) {
        console.error('Characterization harness failed:', error);
        process.exitCode = 1;
        try {
            fs.writeFileSync(
                OUT,
                JSON.stringify(
                    {
                        mission: 'hero-persistence-characterization',
                        pass: false,
                        harnessError: error?.message || String(error),
                        results
                    },
                    null,
                    2
                ),
                'utf8'
            );
        } catch {
            /* ignore */
        }
    } finally {
        await server.close();
    }
}

const freshArgIdx = process.argv.indexOf('--fresh-case');
if (freshArgIdx !== -1) {
    const caseId = process.argv[freshArgIdx + 1];
    await runFreshChildMain(caseId);
} else {
    await runParentMain();
}
