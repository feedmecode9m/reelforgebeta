#!/usr/bin/env node
/**
 * Commit 3 — HeroReel compatibility adapter over HeroRecord.
 *
 * Uses Vite SSR for modules that need import.meta.env (config → reelContract).
 *
 * Usage:
 *   node scripts/mission-hero-reel-adapter.mjs
 *   npm run test:hero-reel-adapter
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, '..');
const OUT =
    process.env.OUT || path.join(os.tmpdir(), 'reelforge-hero-reel-adapter-tests.json');

const HERO_RECORD_KEY = 'reelforge_hero_record';
const HERO_REEL_KEY = 'reelforge_hero_reel';
const HERO_MANAGER_KEY = 'reelforge_hero_manager_config';

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
        const reelApi = await server.ssrLoadModule('/src/lib/hero/heroReelIdentity.js');
        const recordApi = await server.ssrLoadModule('/src/lib/hero/heroRecord.js');

        const {
            loadHeroReel,
            saveHeroReel,
            clearHeroReel,
            resolveActiveHeroVideoReel,
            migrateLegacyHeroStorageIfNeeded,
            heroReelFromUploadResponse,
            HERO_REEL_STORAGE_KEY
        } = reelApi;
        const {
            loadHeroRecord,
            saveHeroRecord,
            projectHeroRecordToReel,
            HERO_RECORD_STORAGE_KEY
        } = recordApi;

        assert('api.storage_key_compatible', HERO_REEL_STORAGE_KEY === HERO_REEL_KEY);

        // ── Public shape from save/load ─────────────────────────────────────
        wipe();
        const saved = saveHeroReel({
            id: 'reel-adapter-001',
            fileName: 'adapter.mp4',
            name: 'Adapter Hero',
            url: '/videos/adapter.mp4',
            thumbnail: '/thumbs/adapter.jpg',
            type: 'video/mp4',
            backgroundSource: 'custom_video'
        });
        assert(
            'shape.save_returns_hero_reel',
            saved?.id === 'reel-adapter-001' &&
                saved?.url === '/videos/adapter.mp4' &&
                saved?.fileName === 'adapter.mp4' &&
                saved?.name === 'Adapter Hero' &&
                saved?.backgroundSource === 'custom_video' &&
                saved?.thumbnail === '/thumbs/adapter.jpg' &&
                typeof saved?.type === 'string',
            saved
        );

        const loaded = loadHeroReel();
        assert(
            'shape.load_matches_public_api',
            loaded?.id === saved.id &&
                loaded?.url === saved.url &&
                loaded?.backgroundSource === 'custom_video' &&
                loaded?.name === 'Adapter Hero',
            loaded
        );

        // HeroRecord is owner
        const record = loadHeroRecord();
        assert(
            'owner.record_is_asset',
            record.mode === 'asset' &&
                record.assetId === 'reel-adapter-001' &&
                record.mediaKind === 'video' &&
                record.videoUrl === '/videos/adapter.mp4' &&
                Boolean(storage[HERO_RECORD_STORAGE_KEY]),
            record
        );

        // Round trip
        wipe();
        saveHeroReel({
            id: 'round-1',
            fileName: 'round.mp4',
            name: 'Round',
            url: '/videos/round.mp4',
            type: 'video/mp4',
            backgroundSource: 'custom_video'
        });
        const snap = storage[HERO_RECORD_STORAGE_KEY];
        // Simulate cold load by wiping in-memory only? storage persists.
        const again = loadHeroReel();
        assert(
            'roundtrip.save_load',
            again?.id === 'round-1' && again?.url === '/videos/round.mp4',
            again
        );
        assert('roundtrip.record_storage_present', Boolean(snap));

        // asset record projects
        wipe();
        saveHeroRecord({
            mode: 'asset',
            assetId: 'proj-vid',
            mediaUrl: '/videos/proj.mp4',
            videoUrl: '/videos/proj.mp4',
            posterUrl: '/thumbs/proj.jpg',
            mediaKind: 'video',
            fileName: 'proj.mp4',
            title: 'Projected'
        });
        const fromRecord = loadHeroReel();
        assert(
            'project.asset_video_to_reel',
            fromRecord?.id === 'proj-vid' &&
                fromRecord?.url === '/videos/proj.mp4' &&
                fromRecord?.thumbnail === '/thumbs/proj.jpg' &&
                fromRecord?.backgroundSource === 'custom_video',
            fromRecord
        );
        assert(
            'project.helper_matches_load',
            projectHeroRecordToReel(loadHeroRecord())?.id === fromRecord?.id
        );

        wipe();
        saveHeroRecord({
            mode: 'asset',
            assetId: 'proj-img',
            mediaUrl: '/thumbs/img.jpg',
            posterUrl: '/thumbs/img.jpg',
            mediaKind: 'image',
            fileName: 'img.jpg',
            title: 'Image Hero'
        });
        const imgReel = loadHeroReel();
        assert(
            'project.asset_image_to_reel',
            imgReel?.id === 'proj-img' &&
                imgReel?.url === '/thumbs/img.jpg' &&
                imgReel?.backgroundSource === 'custom_image',
            imgReel
        );

        // selection mode — no fake reel
        wipe();
        saveHeroRecord({ mode: 'selection', heroTitle: 'Select' });
        assert('selection.no_hero_reel', loadHeroReel() === null);
        assert(
            'selection.resolve_active_video_null',
            resolveActiveHeroVideoReel() === null
        );

        // none mode clears derived reel
        wipe();
        saveHeroReel({
            id: 'to-clear',
            fileName: 'c.mp4',
            name: 'C',
            url: '/videos/c.mp4',
            type: 'video/mp4',
            backgroundSource: 'custom_video'
        });
        assert('none.precondition_has_reel', Boolean(loadHeroReel()));
        saveHeroRecord({ mode: 'none' });
        assert('none.load_hero_reel_null', loadHeroReel() === null);
        assert('none.resolve_active_null', resolveActiveHeroVideoReel() === null);

        // clearHeroReel
        wipe();
        saveHeroReel({
            id: 'clr-1',
            fileName: 'clr.mp4',
            name: 'Clr',
            url: '/videos/clr.mp4',
            type: 'video/mp4',
            backgroundSource: 'custom_video'
        });
        clearHeroReel();
        assert('clear.derived_reel_null', loadHeroReel() === null);
        assert(
            'clear.record_not_asset',
            loadHeroRecord().mode === 'selection' || loadHeroRecord().mode === 'none',
            loadHeroRecord()
        );
        assert(
            'clear.legacy_mirror_gone',
            storage[HERO_REEL_KEY] == null
        );

        // clear preserves none
        wipe();
        saveHeroRecord({ mode: 'none' });
        clearHeroReel();
        assert('clear.preserves_none', loadHeroRecord().mode === 'none');

        // resolve active video
        wipe();
        saveHeroReel({
            id: 'active-v',
            fileName: 'a.mp4',
            name: 'A',
            url: '/videos/a.mp4',
            type: 'video/mp4',
            backgroundSource: 'custom_video'
        });
        assert(
            'resolve.active_video_reel',
            resolveActiveHeroVideoReel()?.id === 'active-v',
            resolveActiveHeroVideoReel()
        );
        // manager none suppresses even with asset record during dual-write
        storage[HERO_MANAGER_KEY] = JSON.stringify({
            backgroundSource: 'none',
            heroAssetId: ''
        });
        assert(
            'resolve.manager_none_suppresses',
            resolveActiveHeroVideoReel() === null
        );

        // upload helper still yields HeroReel shape (caller then saveHeroReel)
        wipe();
        const fromUpload = heroReelFromUploadResponse(
            {
                id: 'up-1',
                url: '/videos/up.mp4',
                name: 'Up',
                type: 'video/mp4'
            },
            'video'
        );
        assert(
            'upload.helper_shape',
            fromUpload?.id === 'up-1' &&
                fromUpload?.backgroundSource === 'custom_video' &&
                fromUpload?.url === '/videos/up.mp4',
            fromUpload
        );
        const afterUploadSave = saveHeroReel(fromUpload);
        assert('upload.save_via_record', afterUploadSave?.id === 'up-1');

        // migrate entry seeds HeroRecord
        wipe();
        storage[HERO_MANAGER_KEY] = JSON.stringify({
            backgroundSource: 'custom_video',
            heroAssetId: 'mig-1'
        });
        storage[HERO_REEL_KEY] = JSON.stringify({
            id: 'mig-1',
            url: '/videos/mig.mp4',
            type: 'video/mp4',
            name: 'Mig',
            backgroundSource: 'custom_video'
        });
        migrateLegacyHeroStorageIfNeeded();
        assert(
            'migrate.via_compatibility_entry',
            loadHeroReel()?.id === 'mig-1' && loadHeroRecord().mode === 'asset',
            { reel: loadHeroReel(), record: loadHeroRecord() }
        );

        // reject URL-as-identity write-through
        wipe();
        const rejectUrlId = saveHeroReel({
            id: '/videos/bad-id.mp4',
            fileName: 'bad.mp4',
            name: 'Bad',
            url: '/videos/bad-id.mp4',
            type: 'video/mp4',
            backgroundSource: 'custom_video'
        });
        assert('save.rejects_url_as_identity', rejectUrlId === null);

        const failed = results.filter((r) => !r.pass);
        const report = {
            mission: 'hero-reel-adapter',
            phase: 'commit-3',
            generatedAt: new Date().toISOString(),
            reportPath: OUT,
            summary: {
                total: results.length,
                passed: results.filter((r) => r.pass).length,
                failed: failed.length
            },
            pass: failed.length === 0,
            completionToken:
                failed.length === 0
                    ? 'HERO_REEL_ADAPTER_TESTS=true'
                    : 'HERO_REEL_ADAPTER_TESTS=false',
            failures: failed.map((f) => f.id),
            results
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
        console.error(error);
        process.exitCode = 1;
    } finally {
        await server.close();
    }
}

main();
