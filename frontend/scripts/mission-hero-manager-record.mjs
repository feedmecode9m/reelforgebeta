#!/usr/bin/env node
/**
 * Commit 5 — Hero Manager asset + copy edits via HeroRecord.
 *
 * Usage:
 *   node scripts/mission-hero-manager-record.mjs
 *   npm run test:hero-manager-record
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, '..');
const OUT =
    process.env.OUT || path.join(os.tmpdir(), 'reelforge-hero-manager-record-tests.json');

const HERO_RECORD_KEY = 'reelforge_hero_record';

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
}

function wipe() {
    for (const key of Object.keys(storage)) delete storage[key];
}

/** @type {Array<{ id: string; pass: boolean; detail?: unknown }>} */
const results = [];

function assert(id, condition, detail) {
    const pass = Boolean(condition);
    results.push({ id, pass, detail: detail ?? null });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${id}`);
}

function countHeroRecordWrites(fn) {
    let count = 0;
    const orig = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = (key, value) => {
        if (key === HERO_RECORD_KEY) count += 1;
        return orig.call(globalThis.localStorage, key, value);
    };
    try {
        fn();
        return count;
    } finally {
        globalThis.localStorage.setItem = orig;
    }
}

const VAULT_VIDEO = {
    id: 'mgr-asset-vid-001',
    fileName: 'mgr-video.mp4',
    name: 'Manager Vault Video',
    title: 'Manager Vault Video',
    url: '/videos/mgr-vid-001.mp4',
    thumbnail: '/thumbs/mgr-vid-001.jpg',
    type: 'video/mp4'
};

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
        const reelApi = await server.ssrLoadModule('/src/lib/hero/heroReelIdentity.js');
        const intelApi = await server.ssrLoadModule('/src/lib/hero/heroIntelligence.js');

        const {
            loadHeroRecord,
            selectHeroAsset,
            setHeroMode,
            updateHeroPresentation,
            projectHeroRecordToManagerPointer,
            mergeHeroRecordIntoManagerConfig,
            projectManagerConfigFromHeroRecord,
            validateHeroRecord
        } = recordApi;
        const { loadHeroReel } = reelApi;
        const {
            commitHeroAssetSelection,
            saveHeroManagerConfig,
            loadHeroManagerConfig
        } = intelApi;

        // ── merge: identity from record, manager-only preserved ──────────────
        wipe();
        selectHeroAsset({
            assetId: 'merge-a',
            mediaUrl: '/videos/merge-a.mp4',
            mediaKind: 'video',
            heroTitle: 'Record Title',
            heroSubtitle: 'Record Sub',
            heroDescription: 'Record Desc'
        });
        const managerOnly = saveHeroManagerConfig({
            heroType: 'CONTINUE_WATCHING',
            autoRotate: true,
            carouselDurationMs: 12000,
            carouselTransitionStyle: 'fade',
            heroTypography: { scale: 'lg' },
            seasonalCampaigns: [{ id: 'winter', active: true }],
            storyScheduledFor: '2026-12-01T00:00',
            // stale identity fields — must not win over HeroRecord
            heroAssetId: 'stale',
            backgroundSource: 'selection',
            heroTitle: 'Manager Stale Title'
        });
        const merged = mergeHeroRecordIntoManagerConfig(managerOnly, loadHeroRecord());
        assert(
            'merge.identity_from_record',
            merged.heroAssetId === 'merge-a' &&
                merged.backgroundSource === 'custom_video' &&
                merged.heroTitle === 'Record Title' &&
                merged.heroSubtitle === 'Record Sub' &&
                merged.heroDescription === 'Record Desc',
            merged
        );
        assert(
            'merge.manager_only_preserved',
            merged.heroType === 'CONTINUE_WATCHING' &&
                merged.autoRotate === true &&
                merged.carouselDurationMs === 12000 &&
                merged.storyScheduledFor === '2026-12-01T00:00' &&
                Array.isArray(merged.seasonalCampaigns) &&
                merged.seasonalCampaigns[0]?.id === 'winter',
            merged
        );

        // ── project manager patch from record for persist compatibility ──────
        const projected = projectManagerConfigFromHeroRecord(
            {
                heroType: 'TRENDING',
                autoRotate: false,
                carouselDurationMs: 8000,
                heroTitle: 'ignored until record overlay',
                backgroundSource: 'none',
                heroAssetId: ''
            },
            loadHeroRecord()
        );
        assert(
            'project.compat_fields_from_record',
            projected.backgroundSource === 'custom_video' &&
                projected.heroAssetId === 'merge-a' &&
                projected.heroTitle === 'Record Title' &&
                projected.heroType === 'TRENDING' &&
                projected.carouselDurationMs === 8000,
            projected
        );

        // ── asset commit: one revision + manager pointer + reel adapter ───────
        wipe();
        const writes = countHeroRecordWrites(() => {
            commitHeroAssetSelection(VAULT_VIDEO.id, [VAULT_VIDEO]);
        });
        let record = loadHeroRecord();
        let manager = loadHeroManagerConfig();
        const view = mergeHeroRecordIntoManagerConfig(manager, record);
        assert(
            'commit.one_record_write',
            writes === 1 && validateHeroRecord(record).ok && record.mode === 'asset',
            { writes, record }
        );
        assert(
            'commit.manager_pointer_compat',
            manager.backgroundSource === 'custom_video' && manager.heroAssetId === VAULT_VIDEO.id,
            manager
        );
        assert(
            'commit.merged_view_matches',
            view.heroAssetId === VAULT_VIDEO.id && view.backgroundSource === 'custom_video',
            view
        );
        const reel = loadHeroReel();
        assert(
            'adapter.reel_after_manager_select',
            reel?.id === VAULT_VIDEO.id && reel?.url === VAULT_VIDEO.url,
            reel
        );

        // ── presentation command is authoritative for copy ───────────────────
        wipe();
        selectHeroAsset({
            assetId: 'copy-1',
            mediaUrl: '/videos/copy-1.mp4',
            mediaKind: 'video'
        });
        updateHeroPresentation({
            heroTitle: 'Presented',
            heroSubtitle: 'Subline',
            heroDescription: 'Body'
        });
        saveHeroManagerConfig({
            heroTitle: 'stale manager copy',
            heroSubtitle: 'stale sub',
            heroDescription: 'stale desc',
            heroAssetId: 'copy-1',
            backgroundSource: 'custom_video'
        });
        const copyView = mergeHeroRecordIntoManagerConfig(loadHeroManagerConfig(), loadHeroRecord());
        assert(
            'copy.record_wins_in_merge',
            copyView.heroTitle === 'Presented' &&
                copyView.heroSubtitle === 'Subline' &&
                copyView.heroDescription === 'Body',
            copyView
        );

        // ── mode transitions via setHeroMode (panel path) ────────────────────
        wipe();
        selectHeroAsset({
            assetId: 'mode-1',
            mediaUrl: '/videos/mode-1.mp4',
            mediaKind: 'video',
            heroTitle: 'Keep Me'
        });
        setHeroMode('selection', { source: 'manager_background_source' });
        assert(
            'mode.selection_clears_asset',
            loadHeroRecord().mode === 'selection' &&
                !loadHeroRecord().assetId &&
                loadHeroRecord().heroTitle === 'Keep Me',
            loadHeroRecord()
        );
        assert('mode.selection_reel_null', loadHeroReel() === null, loadHeroReel());

        setHeroMode('none', { source: 'manager_background_source' });
        assert(
            'mode.none',
            loadHeroRecord().mode === 'none' && projectHeroRecordToManagerPointer(loadHeroRecord()).backgroundSource === 'none',
            loadHeroRecord()
        );

        // ── manager settings roundtrip with projected identity (no auto-rotate timer) ──
        wipe();
        selectHeroAsset({
            assetId: 'rotate-1',
            mediaUrl: '/videos/rotate-1.mp4',
            mediaKind: 'video',
            heroTitle: 'Rotate Title'
        });
        const patch = projectManagerConfigFromHeroRecord(
            {
                heroType: 'MOST_WATCHED',
                autoRotate: false,
                rotateIntervalMs: 45000,
                carouselDurationMs: 9000
            },
            loadHeroRecord()
        );
        const updated = saveHeroManagerConfig(patch);
        const rotatedView = mergeHeroRecordIntoManagerConfig(updated, loadHeroRecord());
        assert(
            'persist.manager_settings_roundtrip',
            rotatedView.heroType === 'MOST_WATCHED' &&
                rotatedView.autoRotate === false &&
                rotatedView.rotateIntervalMs === 45000 &&
                rotatedView.heroAssetId === 'rotate-1' &&
                rotatedView.heroTitle === 'Rotate Title',
            rotatedView
        );
    } finally {
        await server.close();
    }

    const failed = results.filter((r) => !r.pass);
    const report = {
        suite: 'hero-manager-record',
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
