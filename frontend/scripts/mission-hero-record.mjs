#!/usr/bin/env node
/**
 * HeroRecord unit coverage — Commit 2 (persistence layer + legacy importer).
 * Offline, no Vite, no production heroIntelligence wiring.
 *
 * Usage:
 *   node scripts/mission-hero-record.mjs
 *   npm run test:hero-record
 *
 * Report defaults to os.tmpdir(); never writes under frontend/artifacts.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = path.resolve(__dirname, '../src/lib/hero/heroRecord.js');
const OUT =
    process.env.OUT || path.join(os.tmpdir(), 'reelforge-hero-record-tests.json');

/** @type {Record<string, string>} */
const storage = {};
/** @type {any[]} */
const events = [];
/** @type {{ failNextWrite?: boolean; failAlways?: boolean }} */
const writeControl = { failNextWrite: false, failAlways: false };

function installShims() {
    for (const key of Object.keys(storage)) delete storage[key];
    events.length = 0;
    writeControl.failNextWrite = false;
    writeControl.failAlways = false;
    globalThis.localStorage = {
        getItem: (key) => (Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null),
        setItem: (key, value) => {
            if (writeControl.failAlways || writeControl.failNextWrite) {
                writeControl.failNextWrite = false;
                throw new Error('QuotaExceededError');
            }
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
        dispatchEvent(event) {
            events.push(event);
            return true;
        },
        addEventListener() {},
        removeEventListener() {}
    };
    globalThis.CustomEvent = class CustomEvent {
        constructor(type, init = {}) {
            this.type = type;
            this.detail = init.detail;
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

function wipe() {
    for (const key of Object.keys(storage)) delete storage[key];
    events.length = 0;
    writeControl.failNextWrite = false;
    writeControl.failAlways = false;
}

async function main() {
    installShims();
    const hero = await import(pathToFileURL(MODULE_PATH).href);

    const {
        HERO_RECORD_STORAGE_KEY,
        HERO_RECORD_SCHEMA_VERSION,
        LEGACY_HERO_MANAGER_KEY,
        LEGACY_HERO_REEL_KEY,
        LEGACY_HERO_VIDEO_KEY,
        LEGACY_HERO_IMAGE_KEY,
        createDefaultHeroRecord,
        validateHeroRecord,
        loadHeroRecord,
        saveHeroRecord,
        migrateLegacyHeroRecordIfNeeded,
        applyHeroRecordToStores,
        inspectHeroRecordStorage,
        isUnsafeHeroMediaUrl,
        isDurableHeroMediaUrl
    } = hero;

    // ── validateHeroRecord ──────────────────────────────────────────────────
    wipe();
    assert(
        'validate.default_selection_ok',
        validateHeroRecord(createDefaultHeroRecord()).ok === true
    );
    assert(
        'validate.asset_requires_identity',
        validateHeroRecord({
            schemaVersion: 1,
            revision: 0,
            updatedAt: 1,
            mode: 'asset',
            status: 'ready',
            assetId: '',
            mediaUrl: '/videos/a.mp4',
            videoUrl: '/videos/a.mp4',
            posterUrl: '',
            mediaKind: 'video'
        }).ok === false
    );
    assert(
        'validate.asset_requires_durable_url',
        validateHeroRecord({
            schemaVersion: 1,
            revision: 0,
            updatedAt: 1,
            mode: 'asset',
            status: 'ready',
            assetId: 'id-1',
            mediaUrl: 'blob:http://x/1',
            videoUrl: 'blob:http://x/1',
            posterUrl: '',
            mediaKind: 'video'
        }).ok === false
    );
    assert(
        'validate.asset_id_must_not_be_url',
        validateHeroRecord({
            schemaVersion: 1,
            revision: 0,
            updatedAt: 1,
            mode: 'asset',
            status: 'ready',
            assetId: '/videos/legacy.mp4',
            mediaUrl: '/videos/legacy.mp4',
            videoUrl: '/videos/legacy.mp4',
            posterUrl: '',
            mediaKind: 'video'
        }).ok === false
    );
    assert(
        'validate.selection_rejects_asset_id',
        validateHeroRecord({
            schemaVersion: 1,
            revision: 0,
            updatedAt: 1,
            mode: 'selection',
            status: 'ready',
            assetId: 'x',
            mediaUrl: '',
            videoUrl: '',
            posterUrl: '',
            mediaKind: ''
        }).ok === false
    );
    assert(
        'validate.none_rejects_media',
        validateHeroRecord({
            schemaVersion: 1,
            revision: 0,
            updatedAt: 1,
            mode: 'none',
            status: 'ready',
            assetId: '',
            mediaUrl: '/videos/a.mp4',
            videoUrl: '/videos/a.mp4',
            posterUrl: '',
            mediaKind: 'video'
        }).ok === false
    );
    assert(
        'validate.valid_asset_ok',
        validateHeroRecord({
            schemaVersion: 1,
            revision: 0,
            updatedAt: 1,
            mode: 'asset',
            status: 'ready',
            assetId: 'asset-1',
            mediaUrl: '/videos/hero.mp4',
            videoUrl: '/videos/hero.mp4',
            posterUrl: '/thumbs/hero.jpg',
            mediaKind: 'video'
        }).ok === true
    );
    assert(
        'validate.unsupported_schema_version',
        validateHeroRecord({
            schemaVersion: 99,
            revision: 0,
            updatedAt: 1,
            mode: 'selection',
            status: 'ready',
            assetId: '',
            mediaUrl: '',
            videoUrl: '',
            posterUrl: '',
            mediaKind: ''
        }).ok === false
    );
    assert('unsafe.blob', isUnsafeHeroMediaUrl('blob:http://localhost/1') === true);
    assert('unsafe.data', isUnsafeHeroMediaUrl('data:image/png;base64,xx') === true);
    assert('durable.root_relative', isDurableHeroMediaUrl('/videos/hero.mp4') === true);

    // ── save / load / revision ──────────────────────────────────────────────
    wipe();
    const saved = saveHeroRecord({
        mode: 'asset',
        assetId: 'v1',
        mediaUrl: '/videos/one.mp4',
        mediaKind: 'video',
        posterUrl: '/thumbs/one.jpg',
        title: 'One',
        heroTitle: 'Title One'
    });
    assert(
        'save.asset_persists',
        saved?.mode === 'asset' &&
            saved?.assetId === 'v1' &&
            saved?.videoUrl === '/videos/one.mp4' &&
            saved?.posterUrl === '/thumbs/one.jpg',
        saved
    );
    assert('save.schema_version', saved?.schemaVersion === HERO_RECORD_SCHEMA_VERSION);
    const firstRev = saved?.revision;
    const saved2 = saveHeroRecord({ heroTitle: 'Title Two' });
    assert(
        'save.revision_increments',
        typeof firstRev === 'number' && saved2?.revision === firstRev + 1,
        { firstRev, second: saved2?.revision }
    );
    assert('save.updatedAt_moves', Number(saved2?.updatedAt) >= Number(saved?.updatedAt));
    assert(
        'save.event_dispatched',
        events.some((e) => e.type === 'reelforge:hero-record-updated' && e.detail?.assetId === 'v1')
    );

    // revision precondition
    const conflict = saveHeroRecord(
        { heroTitle: 'Conflict' },
        { expectedRevision: 999 }
    );
    assert('save.revision_precondition_conflict', conflict === null);
    const okPre = saveHeroRecord(
        { heroTitle: 'Precond OK' },
        { expectedRevision: loadHeroRecord().revision }
    );
    assert(
        'save.revision_precondition_match',
        okPre?.heroTitle === 'Precond OK',
        okPre
    );

    const loaded = loadHeroRecord();
    assert(
        'load.reads_persisted',
        loaded.mode === 'asset' && loaded.assetId === 'v1' && loaded.heroTitle === 'Precond OK',
        loaded
    );

    const toNone = saveHeroRecord({ mode: 'none' });
    assert(
        'save.none_strips_asset_identity',
        toNone?.mode === 'none' &&
            toNone.assetId === '' &&
            toNone.mediaUrl === '' &&
            toNone.videoUrl === '' &&
            toNone.posterUrl === '',
        toNone
    );
    assert(
        'save.rejects_blob_url',
        saveHeroRecord({
            mode: 'asset',
            assetId: 'blob-id',
            mediaUrl: 'blob:http://x/1',
            mediaKind: 'video'
        }) === null
    );
    assert('save.reject_does_not_clobber', loadHeroRecord().mode === 'none');

    // write failure handling
    writeControl.failNextWrite = true;
    const writeFail = saveHeroRecord({
        mode: 'asset',
        assetId: 'will-fail',
        mediaUrl: '/videos/fail.mp4',
        mediaKind: 'video'
    });
    assert('save.write_failure_returns_null', writeFail === null);
    assert('save.write_failure_keeps_prior', loadHeroRecord().mode === 'none');

    // ── applyHeroRecordToStores / poster preservation ───────────────────────
    wipe();
    saveHeroRecord({
        mode: 'asset',
        assetId: 'img-1',
        mediaUrl: '/thumbs/a.jpg',
        mediaKind: 'image'
    });
    const st = { video: 'x', poster: 'y', failed: null };
    applyHeroRecordToStores(loadHeroRecord(), {
        setVideo: (v) => {
            st.video = v;
        },
        setPoster: (p) => {
            st.poster = p;
        },
        setFailed: (f) => {
            st.failed = f;
        }
    });
    assert('apply.image_sets_poster_clears_video', st.poster === '/thumbs/a.jpg' && st.video === '');

    saveHeroRecord({
        mode: 'asset',
        assetId: 'vid-1',
        mediaUrl: '/videos/a.mp4',
        videoUrl: '/videos/a.mp4',
        posterUrl: '/thumbs/a-poster.jpg',
        mediaKind: 'video'
    });
    st.poster = 'stale-poster';
    applyHeroRecordToStores(loadHeroRecord(), {
        setVideo: (v) => {
            st.video = v;
        },
        setPoster: (p) => {
            st.poster = p;
        },
        setFailed: (f) => {
            st.failed = f;
        }
    });
    assert(
        'apply.video_preserves_poster',
        st.video === '/videos/a.mp4' && st.poster === '/thumbs/a-poster.jpg',
        st
    );

    saveHeroRecord({ mode: 'none' });
    applyHeroRecordToStores(loadHeroRecord(), {
        setVideo: (v) => {
            st.video = v;
        },
        setPoster: (p) => {
            st.poster = p;
        },
        setFailed: (f) => {
            st.failed = f;
        }
    });
    assert('apply.none_clears_media', st.video === '' && st.poster === '');

    st.video = 'keep';
    saveHeroRecord({ mode: 'selection' });
    const appliedSelection = applyHeroRecordToStores(loadHeroRecord(), {
        setVideo: (v) => {
            st.video = v;
        },
        setPoster: (p) => {
            st.poster = p;
        },
        setFailed: (f) => {
            st.failed = f;
        }
    });
    assert(
        'apply.selection_does_not_mutate_media',
        appliedSelection === false && st.video === 'keep'
    );

    // ── Existing record wins ────────────────────────────────────────────────
    wipe();
    saveHeroRecord({ mode: 'none', heroTitle: 'Canonical' });
    storage[LEGACY_HERO_MANAGER_KEY] = JSON.stringify({
        backgroundSource: 'custom_video',
        heroAssetId: 'should-not-import',
        heroTitle: 'Legacy'
    });
    storage[LEGACY_HERO_REEL_KEY] = JSON.stringify({
        id: 'should-not-import',
        url: '/videos/stale.mp4',
        type: 'video/mp4',
        backgroundSource: 'custom_video'
    });
    const won = migrateLegacyHeroRecordIfNeeded();
    assert(
        'migrate.existing_record_wins',
        won?.mode === 'none' && won?.heroTitle === 'Canonical',
        won
    );
    assert(
        'migrate.idempotent_second_call',
        migrateLegacyHeroRecordIfNeeded()?.mode === 'none' && loadHeroRecord().mode === 'none'
    );

    // ── none + stale reel stays none ────────────────────────────────────────
    wipe();
    storage[LEGACY_HERO_MANAGER_KEY] = JSON.stringify({
        backgroundSource: 'none',
        heroAssetId: '',
        heroTitle: 'Blank Intent'
    });
    storage[LEGACY_HERO_REEL_KEY] = JSON.stringify({
        id: 'stale-reel',
        url: '/videos/stale.mp4',
        type: 'video/mp4',
        backgroundSource: 'custom_video'
    });
    storage[LEGACY_HERO_VIDEO_KEY] = '/videos/also-stale.mp4';
    const noneWins = migrateLegacyHeroRecordIfNeeded();
    assert(
        'migrate.none_plus_stale_reel_stays_none',
        noneWins?.mode === 'none' &&
            noneWins.assetId === '' &&
            noneWins.mediaUrl === '' &&
            noneWins.heroTitle === 'Blank Intent',
        noneWins
    );

    // ── selection + stale reel stays selection ──────────────────────────────
    wipe();
    storage[LEGACY_HERO_MANAGER_KEY] = JSON.stringify({
        backgroundSource: 'selection',
        heroAssetId: '',
        heroTitle: 'Selection Intent'
    });
    storage[LEGACY_HERO_REEL_KEY] = JSON.stringify({
        id: 'stale-reel-2',
        url: '/videos/stale2.mp4',
        type: 'video/mp4',
        backgroundSource: 'custom_video'
    });
    const selectionWins = migrateLegacyHeroRecordIfNeeded();
    assert(
        'migrate.selection_plus_stale_reel_stays_selection',
        selectionWins?.mode === 'selection' &&
            selectionWins.assetId === '' &&
            selectionWins.mediaUrl === '' &&
            selectionWins.heroTitle === 'Selection Intent',
        selectionWins
    );

    // ── matched manager + reel → asset ──────────────────────────────────────
    wipe();
    storage[LEGACY_HERO_MANAGER_KEY] = JSON.stringify({
        backgroundSource: 'custom_video',
        heroAssetId: 'mgr-asset',
        heroTitle: 'From Manager',
        heroSubtitle: 'Sub',
        heroDescription: 'Desc'
    });
    storage[LEGACY_HERO_REEL_KEY] = JSON.stringify({
        id: 'mgr-asset',
        url: '/videos/mgr.mp4',
        fileName: 'mgr.mp4',
        name: 'Mgr',
        type: 'video/mp4',
        thumbnail: '/thumbs/mgr.jpg',
        backgroundSource: 'custom_video'
    });
    const fromMgr = migrateLegacyHeroRecordIfNeeded();
    assert(
        'migrate.manager_asset_matched',
        fromMgr?.mode === 'asset' &&
            fromMgr.assetId === 'mgr-asset' &&
            fromMgr.mediaUrl === '/videos/mgr.mp4' &&
            fromMgr.videoUrl === '/videos/mgr.mp4' &&
            fromMgr.posterUrl === '/thumbs/mgr.jpg' &&
            fromMgr.heroTitle === 'From Manager' &&
            fromMgr.source === 'migrate_manager_asset',
        fromMgr
    );
    storage[LEGACY_HERO_MANAGER_KEY] = JSON.stringify({
        backgroundSource: 'custom_image',
        heroAssetId: 'other'
    });
    assert(
        'migrate.one_way_after_seed',
        migrateLegacyHeroRecordIfNeeded()?.assetId === 'mgr-asset'
    );

    // ── mismatched asset identity rejected ──────────────────────────────────
    wipe();
    storage[LEGACY_HERO_MANAGER_KEY] = JSON.stringify({
        backgroundSource: 'custom_image',
        heroAssetId: 'img-prefer'
    });
    storage[LEGACY_HERO_REEL_KEY] = JSON.stringify({
        id: 'other-reel',
        url: '/videos/other.mp4',
        type: 'video/mp4',
        backgroundSource: 'custom_video'
    });
    storage[LEGACY_HERO_IMAGE_KEY] = '/thumbs/img-prefer.jpg';
    const mismatched = migrateLegacyHeroRecordIfNeeded();
    assert(
        'migrate.mismatched_identity_rejected',
        mismatched?.mode === 'selection' &&
            mismatched?.status === 'needs_reselection' &&
            mismatched?.assetId === '' &&
            mismatched?.mediaUrl === '' &&
            mismatched?.source === 'migrate_manager_asset_unmatched',
        mismatched
    );

    // ── Hero reel alone (no manager mode) ───────────────────────────────────
    wipe();
    storage[LEGACY_HERO_REEL_KEY] = JSON.stringify({
        id: 'reel-only',
        url: '/videos/reel-only.mp4',
        type: 'video/mp4',
        name: 'Reel Only',
        backgroundSource: 'custom_video'
    });
    const fromReel = migrateLegacyHeroRecordIfNeeded();
    assert(
        'migrate.hero_reel_when_no_manager',
        fromReel?.mode === 'asset' &&
            fromReel.assetId === 'reel-only' &&
            fromReel.source === 'migrate_hero_reel',
        fromReel
    );

    // ── Durable legacy URLs never become assetId ────────────────────────────
    wipe();
    storage[LEGACY_HERO_VIDEO_KEY] = '/videos/legacy-key.mp4';
    const fromLegacyVideo = migrateLegacyHeroRecordIfNeeded();
    assert(
        'migrate.legacy_video_unresolved_no_url_identity',
        fromLegacyVideo?.mode === 'selection' &&
            fromLegacyVideo?.status === 'unresolved_legacy' &&
            fromLegacyVideo?.assetId === '' &&
            fromLegacyVideo?.mediaUrl === '' &&
            fromLegacyVideo?.source === 'migrate_legacy_video_unresolved',
        fromLegacyVideo
    );

    wipe();
    storage[LEGACY_HERO_IMAGE_KEY] = '/thumbs/legacy-key.jpg';
    const fromLegacyImage = migrateLegacyHeroRecordIfNeeded();
    assert(
        'migrate.legacy_image_unresolved_no_url_identity',
        fromLegacyImage?.mode === 'selection' &&
            fromLegacyImage?.status === 'unresolved_legacy' &&
            fromLegacyImage?.assetId === '',
        fromLegacyImage
    );

    // blob/data rejected
    wipe();
    storage[LEGACY_HERO_VIDEO_KEY] = 'blob:http://127.0.0.1/x';
    const rejectBlobMigrate = migrateLegacyHeroRecordIfNeeded();
    assert(
        'migrate.rejects_blob',
        rejectBlobMigrate?.mode === 'selection' && !rejectBlobMigrate.mediaUrl,
        rejectBlobMigrate
    );

    // default selection
    wipe();
    const fromDefault = migrateLegacyHeroRecordIfNeeded();
    assert(
        'migrate.default_selection',
        fromDefault?.mode === 'selection' &&
            fromDefault.assetId === '' &&
            storage[HERO_RECORD_STORAGE_KEY] != null,
        fromDefault
    );

    // load triggers migration
    wipe();
    storage[LEGACY_HERO_REEL_KEY] = JSON.stringify({
        id: 'via-load',
        url: '/videos/via-load.mp4',
        type: 'video/mp4',
        backgroundSource: 'custom_video'
    });
    const viaLoad = loadHeroRecord();
    assert(
        'load.triggers_migration',
        viaLoad.mode === 'asset' && viaLoad.assetId === 'via-load',
        viaLoad
    );

    // ── corrupt / unsupported recovery ──────────────────────────────────────
    wipe();
    storage[HERO_RECORD_STORAGE_KEY] = '{not-json';
    assert('inspect.corrupt_json', inspectHeroRecordStorage().state === 'corrupt');
    const recoveredCorrupt = loadHeroRecord();
    assert(
        'recover.corrupt_json',
        recoveredCorrupt.mode === 'selection' &&
            recoveredCorrupt.status === 'needs_reselection' &&
            recoveredCorrupt.source === 'recover_corrupt_json',
        recoveredCorrupt
    );
    assert(
        'recover.corrupt_rewrites_valid_json',
        inspectHeroRecordStorage().state === 'valid'
    );

    wipe();
    storage[HERO_RECORD_STORAGE_KEY] = JSON.stringify({
        schemaVersion: 99,
        revision: 3,
        updatedAt: 1,
        mode: 'asset',
        status: 'ready',
        assetId: 'future',
        mediaUrl: '/videos/x.mp4',
        videoUrl: '/videos/x.mp4',
        posterUrl: '',
        mediaKind: 'video'
    });
    assert(
        'inspect.unsupported_schema',
        inspectHeroRecordStorage().state === 'unsupported_schema'
    );
    const recoveredVersion = loadHeroRecord();
    assert(
        'recover.unsupported_schema',
        recoveredVersion.mode === 'selection' &&
            recoveredVersion.schemaVersion === HERO_RECORD_SCHEMA_VERSION &&
            recoveredVersion.source === 'recover_unsupported_schema',
        recoveredVersion
    );

    // migration write failure
    wipe();
    storage[LEGACY_HERO_REEL_KEY] = JSON.stringify({
        id: 'write-fail-reel',
        url: '/videos/write-fail.mp4',
        type: 'video/mp4',
        backgroundSource: 'custom_video'
    });
    writeControl.failAlways = true;
    const migrateWriteFail = migrateLegacyHeroRecordIfNeeded();
    assert('migrate.write_failure_returns_null', migrateWriteFail === null);
    writeControl.failAlways = false;

    // ── report to temp path only ────────────────────────────────────────────
    const failed = results.filter((r) => !r.pass);
    const report = {
        mission: 'hero-record',
        phase: 'commit-2-review-fixes',
        generatedAt: new Date().toISOString(),
        reportPath: OUT,
        summary: {
            total: results.length,
            passed: results.filter((r) => r.pass).length,
            failed: failed.length
        },
        pass: failed.length === 0,
        completionToken:
            failed.length === 0 ? 'HERO_RECORD_TESTS=true' : 'HERO_RECORD_TESTS=false',
        failures: failed.map((f) => f.id),
        results
    };

    const outDir = path.dirname(OUT);
    // Refuse writing into the repo frontend/artifacts tree by default.
    const frontendArtifacts = path.resolve(__dirname, '../artifacts');
    if (path.resolve(OUT).startsWith(frontendArtifacts + path.sep) && !process.env.OUT) {
        console.error('Refusing default report path under frontend/artifacts');
        process.exitCode = 1;
        return;
    }
    try {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    } catch (error) {
        console.error('Failed to write report:', error?.message || error);
        process.exitCode = 1;
        console.log(report.completionToken);
        console.log(`summary: ${report.summary.passed}/${report.summary.total} passed`);
        if (failed.length) {
            console.log('failures:', failed.map((f) => f.id).join(', '));
            process.exitCode = 1;
        }
        return;
    }

    console.log(report.completionToken);
    console.log(`report: ${OUT}`);
    console.log(`summary: ${report.summary.passed}/${report.summary.total} passed`);
    if (failed.length) {
        console.log('failures:', failed.map((f) => f.id).join(', '));
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
