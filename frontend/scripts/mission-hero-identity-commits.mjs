#!/usr/bin/env node
/**
 * Commit 4 — Hero identity commits route through HeroRecord (explicit commands).
 *
 * Usage:
 *   node scripts/mission-hero-identity-commits.mjs
 *   npm run test:hero-identity-commits
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, '..');
const OUT =
    process.env.OUT || path.join(os.tmpdir(), 'reelforge-hero-identity-commits-tests.json');

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
        performance: { now: () => Date.now() }
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

/**
 * @param {() => void} fn
 * @returns {number}
 */
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

/** @type {Array<{ id: string; pass: boolean; detail?: unknown }>} */
const results = [];

function assert(id, condition, detail) {
    const pass = Boolean(condition);
    results.push({ id, pass, detail: detail ?? null });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${id}`);
}

const VAULT_VIDEO = {
    id: 'asset-hero-vid-001',
    fileName: 'hero-vid.mp4',
    name: 'Hero Vault Video',
    title: 'Hero Vault Video',
    url: '/videos/hero-vid-001.mp4',
    thumbnail: '/thumbs/hero-vid-001.jpg',
    type: 'video/mp4'
};

const VAULT_IMAGE = {
    id: 'asset-hero-img-001',
    fileName: 'hero-img.jpg',
    name: 'Hero Vault Image',
    title: 'Hero Vault Image',
    url: '/thumbs/hero-img-001.jpg',
    type: 'image/jpeg'
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
            validateHeroRecord,
            selectHeroAsset,
            setHeroMode,
            projectHeroRecordToManagerPointer,
            projectHeroRecordToReel
        } = recordApi;
        const { loadHeroReel } = reelApi;
        const {
            commitHeroVideoIdentity,
            commitHeroAssetSelection,
            saveHeroManagerConfig,
            loadHeroManagerConfig
        } = intelApi;

        // ── Explicit commands ────────────────────────────────────────────────
        wipe();
        assert(
            'command.select_asset',
            selectHeroAsset({
                assetId: 'cmd-1',
                mediaUrl: '/videos/cmd-1.mp4',
                mediaKind: 'video'
            })?.mode === 'asset',
            loadHeroRecord()
        );
        assert('command.set_none', setHeroMode('none')?.mode === 'none', loadHeroRecord());
        assert(
            'command.set_selection',
            setHeroMode('selection')?.mode === 'selection',
            loadHeroRecord()
        );

        // ── Asset selection: one HeroRecord revision ─────────────────────────
        wipe();
        const writesAsset = countHeroRecordWrites(() => {
            commitHeroAssetSelection(VAULT_VIDEO.id, [VAULT_VIDEO]);
        });
        let record = loadHeroRecord();
        const validated = validateHeroRecord(record);
        const manager = loadHeroManagerConfig();
        assert(
            'commit.asset_one_record_write',
            writesAsset === 1 &&
                validated.ok &&
                record.mode === 'asset' &&
                record.assetId === VAULT_VIDEO.id &&
                record.mediaUrl.includes('hero-vid-001'),
            { writesAsset, revision: record.revision, mode: record.mode, assetId: record.assetId }
        );
        assert(
            'commit.asset_manager_compat_pointer',
            manager.backgroundSource === 'custom_video' && manager.heroAssetId === VAULT_VIDEO.id,
            manager
        );
        const pointer = projectHeroRecordToManagerPointer(record);
        assert(
            'projection.manager_matches_record',
            pointer.backgroundSource === manager.backgroundSource &&
                pointer.heroAssetId === manager.heroAssetId,
            { pointer, manager }
        );

        // ── Video identity commit ────────────────────────────────────────────
        wipe();
        const writesVideo = countHeroRecordWrites(() => {
            commitHeroVideoIdentity({
                id: 'video-identity-9',
                fileName: 'ident.mp4',
                name: 'Identity Hero',
                url: '/videos/ident-9.mp4',
                thumbnail: '/thumbs/ident-9.jpg',
                type: 'video/mp4',
                backgroundSource: 'custom_video'
            });
        });
        record = loadHeroRecord();
        const managerVideo = loadHeroManagerConfig();
        assert(
            'commit.video_one_record_write',
            writesVideo === 1 &&
                record.mode === 'asset' &&
                record.assetId === 'video-identity-9' &&
                record.mediaKind === 'video',
            { writesVideo, record }
        );
        assert(
            'commit.video_manager_compat',
            managerVideo.backgroundSource === 'custom_video' &&
                managerVideo.heroAssetId === 'video-identity-9',
            managerVideo
        );

        // ── HeroReel adapter shape remains valid ─────────────────────────────
        const reel = loadHeroReel();
        assert(
            'adapter.hero_reel_shape',
            reel?.id === 'video-identity-9' &&
                reel?.url === '/videos/ident-9.mp4' &&
                reel?.backgroundSource === 'custom_video',
            reel
        );
        const projected = projectHeroRecordToReel(record);
        assert(
            'adapter.project_matches_load',
            projected?.id === reel?.id && projected?.url === reel?.url,
            { projected, reel }
        );

        // ── Safe none transition (explicit identity command) ─────────────────
        wipe();
        commitHeroAssetSelection(VAULT_IMAGE.id, [VAULT_IMAGE]);
        const revBefore = loadHeroRecord().revision;
        const writesNone = countHeroRecordWrites(() => {
            commitHeroAssetSelection('');
        });
        record = loadHeroRecord();
        const managerNone = loadHeroManagerConfig();
        assert(
            'transition.asset_to_none_one_write',
            writesNone === 1 &&
                record.mode === 'none' &&
                !record.assetId &&
                managerNone.backgroundSource === 'none' &&
                !managerNone.heroAssetId &&
                (revBefore === 0 ? record.revision >= 0 : record.revision === revBefore + 1),
            { writesNone, revBefore, revision: record.revision, managerNone }
        );
        assert('transition.none_reel_null', loadHeroReel() === null, loadHeroReel());

        // ── saveHeroManagerConfig does NOT write HeroRecord identity ─────────
        wipe();
        selectHeroAsset({
            assetId: 'keep-asset',
            mediaUrl: '/videos/keep.mp4',
            mediaKind: 'video'
        });
        const revKeep = loadHeroRecord().revision;
        const writesManagerOnly = countHeroRecordWrites(() => {
            saveHeroManagerConfig({
                heroAssetId: '',
                backgroundSource: 'none',
                backgroundStyle: 'gradient_overlay'
            });
        });
        assert(
            'manager.save_does_not_write_record',
            writesManagerOnly === 0 &&
                loadHeroRecord().assetId === 'keep-asset' &&
                loadHeroRecord().revision === revKeep,
            {
                writesManagerOnly,
                revKeep,
                revision: loadHeroRecord().revision,
                assetId: loadHeroRecord().assetId
            }
        );

        // ── Image projection ─────────────────────────────────────────────────
        wipe();
        commitHeroAssetSelection(VAULT_IMAGE.id, [VAULT_IMAGE]);
        record = loadHeroRecord();
        const imgPointer = projectHeroRecordToManagerPointer(record);
        assert(
            'projection.image_manager',
            record.mediaKind === 'image' &&
                imgPointer.backgroundSource === 'custom_image' &&
                imgPointer.heroAssetId === VAULT_IMAGE.id,
            { mode: record.mode, mediaKind: record.mediaKind, imgPointer }
        );
    } finally {
        await server.close();
    }

    const failed = results.filter((r) => !r.pass);
    const report = {
        suite: 'hero-identity-commits',
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
        for (const f of failed) {
            console.error('FAIL detail', f.id, f.detail);
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
