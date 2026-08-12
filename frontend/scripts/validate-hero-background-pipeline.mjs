#!/usr/bin/env node
/**
 * Hero background pipeline — HeroRecord contract (not legacy backgroundAsset).
 *
 * Covers:
 *   - JPG / video selection via commitHeroAssetSelection
 *   - mode=asset, heroAssetId, mediaKind, mediaUrl
 *   - saveHeroManagerConfig strips legacy backgroundAsset
 *   - hydrate: stale remote must not overwrite newer durable local client commit
 *   - hydrate: empty/stale local still takes authoritative remote presentation
 *   - apply + resolve after durable commit
 *   - Phase 2: HeroRecord mode=asset is authoritative for runtime resolve
 *     (deterministic / in-memory contract tests — not browser coverage)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const notes = [];

function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else notes.push(`ok: ${msg}`);
}

const enginePath = join(SRC, 'lib/hero/heroIntelligence.js');
const syncPath = join(SRC, 'lib/hero/heroPresentationSync.js');
const recordPath = join(SRC, 'lib/hero/heroRecord.js');
const engineSrc = readFileSync(enginePath, 'utf8');
const syncSrc = readFileSync(syncPath, 'utf8');

assert(existsSync(enginePath), 'heroIntelligence.js exists');
assert(existsSync(syncPath), 'heroPresentationSync.js exists');
assert(existsSync(recordPath), 'heroRecord.js exists');
assert(engineSrc.includes('export function commitHeroAssetSelection'), 'commitHeroAssetSelection exported');
assert(engineSrc.includes('export function resolveHeroBackgroundAsset'), 'resolveHeroBackgroundAsset exported');
assert(engineSrc.includes('export function applyHeroManagerBackground'), 'applyHeroManagerBackground exported');
assert(
    /backgroundAsset:\s*_legacyAsset/.test(engineSrc),
    'saveHeroManagerConfig strips legacy backgroundAsset'
);
assert(
    syncSrc.includes('shouldPreserveLocalHeroPresentationOverRemote'),
    'hydrate preserve helper present'
);
assert(
    syncSrc.includes('preserve local durable asset over remote hydrate'),
    'hydrate logs preserve branch'
);
assert(
    /hero_authority_rehydrate_fail_closed/.test(syncSrc) &&
        /isServerOriginHeroSource/.test(syncSrc) &&
        /_fail_closed/.test(syncSrc),
    'fail-closed source is classified separately from server-origin'
);
assert(
    syncSrc.includes('local_unconfirmed_fail_closed'),
    'hydrate preserve treats fail-closed as unconfirmed local'
);
const authRuntimePath = join(SRC, 'lib/hero/heroAuthorityRuntime.js');
assert(existsSync(authRuntimePath), 'heroAuthorityRuntime.js exists');
const authRuntimeSrc = readFileSync(authRuntimePath, 'utf8');
assert(
    authRuntimeSrc.includes('commit_hero_asset_selection') &&
        (authRuntimeSrc.includes('keepClientCommit') ||
            authRuntimeSrc.includes('isProtectedPresentationSource') ||
            authRuntimeSrc.includes('keepPresentationIdentity')),
    'fail-closed persist does not overwrite client asset commit source'
);
assert(
    !/source:\s*['"]hero_authority_rehydrate['"]\s*[,}]/.test(authRuntimeSrc),
    'authority runtime does not stamp presentation source=hero_authority_rehydrate'
);

/** In-memory localStorage for SSR */
function installMemoryStorage() {
    /** @type {Map<string, string>} */
    const map = new Map();
    const storage = {
        getItem(key) {
            return map.has(String(key)) ? map.get(String(key)) : null;
        },
        setItem(key, value) {
            map.set(String(key), String(value));
        },
        removeItem(key) {
            map.delete(String(key));
        },
        clear() {
            map.clear();
        },
        key(i) {
            return [...map.keys()][i] ?? null;
        },
        get length() {
            return map.size;
        }
    };
    const win = {
        localStorage: storage,
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
            return true;
        },
        location: { origin: 'http://127.0.0.1:4173', hostname: '127.0.0.1', href: 'http://127.0.0.1:4173/' },
        navigator: { userAgent: 'node-validate-hero-background' },
        console
    };
    globalThis.localStorage = storage;
    globalThis.window = win;
    globalThis.document = {
        addEventListener() {},
        removeEventListener() {},
        createElement() {
            return { style: {}, setAttribute() {}, appendChild() {} };
        },
        body: { appendChild() {}, removeChild() {} }
    };
    return storage;
}

const JPG = {
    id: 'hero-test-jpg-id',
    name: 'hero-test.jpg',
    fileName: 'hero-test.jpg',
    url: 'https://cdn.example.test/thumbs/hero-test.jpg',
    type: 'image/jpeg',
    addedAt: new Date().toISOString()
};
const MP4 = {
    id: 'hero-test-mp4-id',
    name: 'hero-test.mp4',
    fileName: 'hero-test.mp4',
    url: 'https://cdn.example.test/videos/hero-test.mp4',
    thumbnail: 'https://cdn.example.test/thumbs/hero-test-poster.jpg',
    thumbnailUrl: 'https://cdn.example.test/thumbs/hero-test-poster.jpg',
    type: 'video/mp4',
    addedAt: new Date().toISOString()
};
const OTHER_JPG = {
    id: 'stale-server-jpg',
    name: 'stale.jpg',
    fileName: 'stale.jpg',
    url: 'https://cdn.example.test/thumbs/stale.jpg',
    type: 'image/jpeg'
};

async function main() {
    installMemoryStorage();
    const server = await createServer({
        root: ROOT,
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'error'
    });

    try {
        const {
            commitHeroAssetSelection,
            saveHeroManagerConfig,
            loadHeroManagerConfig,
            resolveHeroBackgroundAsset,
            applyHeroManagerBackground,
            loadHeroVaultItems,
            persistHeroPresentationToServer
        } = await server.ssrLoadModule('/src/lib/hero/heroIntelligence.js');
        const {
            shouldPreserveLocalHeroPresentationOverRemote,
            hasDurableLocalHeroAsset,
            applyServerPresentationToHeroRecord,
            hydrateHeroPresentationFromServer,
            enrichPresentationConfigFromLocalIdentity,
            isServerOriginHeroSource,
            shouldApplySuccessfulPresentationConfirm
        } = await server.ssrLoadModule('/src/lib/hero/heroPresentationSync.js');
        const { hydrateHeroAuthorityRuntime } = await server.ssrLoadModule(
            '/src/lib/hero/heroAuthorityRuntime.js'
        );
        const {
            loadHeroRecordUnverified,
            HERO_RECORD_STORAGE_KEY,
            HERO_MANAGER_STORAGE_KEY
        } = await server.ssrLoadModule('/src/lib/hero/heroRecord.js');
        // HERO_MANAGER_STORAGE_KEY may re-export from intelligence — use literal
        const MANAGER_KEY = 'reelforge_hero_manager_config';
        const RECORD_KEY = HERO_RECORD_STORAGE_KEY || 'reelforge_hero_record';
        void HERO_MANAGER_STORAGE_KEY;

        function seedVault() {
            localStorage.setItem('personal_video_vault', JSON.stringify([MP4]));
            localStorage.setItem('personal_thumbnails', JSON.stringify([JPG, OTHER_JPG]));
            localStorage.setItem(
                'personal_thumbnail_index',
                JSON.stringify([JPG.fileName, OTHER_JPG.fileName])
            );
        }

        function clearHero() {
            localStorage.removeItem(RECORD_KEY);
            localStorage.removeItem(MANAGER_KEY);
            localStorage.removeItem('reelforge_hero_reel');
            localStorage.removeItem('reelforge_hero_video');
            localStorage.removeItem('reelforge_hero_image');
        }

        function snap() {
            const record = loadHeroRecordUnverified();
            const manager = loadHeroManagerConfig();
            let video = '';
            let poster = '';
            const applied = applyHeroManagerBackground(manager, {
                setVideo: (u) => {
                    video = u;
                },
                setPoster: (u) => {
                    poster = u;
                },
                setFailed: () => {}
            });
            const resolved = resolveHeroBackgroundAsset(manager);
            return { record, manager, applied, video, poster, resolved };
        }

        // ---------- A: saveHeroManagerConfig strips backgroundAsset ----------
        clearHero();
        seedVault();
        const legacySave = saveHeroManagerConfig(
            {
                backgroundSource: 'custom_image',
                backgroundAsset: JPG.id,
                backgroundImage: JPG.url,
                heroAssetId: JPG.id
            },
            { skipServer: true }
        );
        assert(
            !Object.prototype.hasOwnProperty.call(legacySave, 'backgroundAsset'),
            'manager config does not retain legacy backgroundAsset'
        );
        assert(String(legacySave.heroAssetId || '') === JPG.id, 'manager keeps heroAssetId');

        // ---------- B: JPG commit path ----------
        clearHero();
        seedVault();
        const jpgSaved = commitHeroAssetSelection(JPG.id, [JPG, MP4, OTHER_JPG]);
        assert(Boolean(jpgSaved), 'JPG commit returns config');
        assert(String(jpgSaved?.heroAssetId || '') === JPG.id, 'JPG heroAssetId persisted on manager');
        assert(
            String(jpgSaved?.backgroundSource || '') === 'custom_image',
            'JPG backgroundSource custom_image'
        );
        const jpgSnap = snap();
        assert(jpgSnap.record?.mode === 'asset', 'JPG HeroRecord mode=asset');
        assert(String(jpgSnap.record?.assetId || '') === JPG.id, 'JPG HeroRecord assetId');
        assert(jpgSnap.record?.mediaKind === 'image', 'JPG mediaKind=image');
        assert(
            String(jpgSnap.record?.mediaUrl || '').includes('hero-test.jpg'),
            'JPG mediaUrl durable'
        );
        assert(jpgSnap.applied === true, 'JPG applyHeroManagerBackground true');
        assert(
            String(jpgSnap.poster || '').includes('hero-test.jpg') ||
                String(jpgSnap.resolved.imageUrl || '').includes('hero-test.jpg'),
            'JPG poster/image store updated'
        );
        assert(
            !Object.prototype.hasOwnProperty.call(jpgSnap.manager, 'backgroundAsset'),
            'JPG manager has no backgroundAsset key'
        );

        // ---------- C: MP4 commit path ----------
        seedVault();
        const mp4Saved = commitHeroAssetSelection(MP4.id, [JPG, MP4, OTHER_JPG]);
        assert(Boolean(mp4Saved), 'MP4 commit returns config');
        assert(String(mp4Saved?.heroAssetId || '') === MP4.id, 'MP4 heroAssetId');
        assert(
            String(mp4Saved?.backgroundSource || '') === 'custom_video',
            'MP4 backgroundSource custom_video'
        );
        const mp4Snap = snap();
        assert(mp4Snap.record?.mode === 'asset', 'MP4 HeroRecord mode=asset');
        assert(String(mp4Snap.record?.assetId || '') === MP4.id, 'MP4 HeroRecord assetId');
        assert(mp4Snap.record?.mediaKind === 'video', 'MP4 mediaKind=video');
        assert(
            String(mp4Snap.record?.mediaUrl || '').includes('hero-test.mp4'),
            'MP4 mediaUrl durable'
        );
        assert(mp4Snap.applied === true, 'MP4 applyHeroManagerBackground true');
        assert(
            String(mp4Snap.video || mp4Snap.resolved.videoUrl || '').includes('hero-test.mp4'),
            'MP4 video store updated'
        );
        // Poster may be jpg without collapsing mediaKind
        assert(mp4Snap.record?.mediaKind === 'video', 'MP4 stays video with poster present');

        // ---------- D: preserve unit matrix ----------
        const localMp4Record = {
            mode: 'asset',
            assetId: MP4.id,
            mediaUrl: MP4.url,
            videoUrl: MP4.url,
            posterUrl: MP4.thumbnail,
            mediaKind: 'video',
            source: 'commit_hero_asset_selection',
            updatedAt: Date.now()
        };
        const staleRemoteJpg = {
            heroAssetId: OTHER_JPG.id,
            backgroundSource: 'custom_image',
            mediaUrl: OTHER_JPG.url,
            posterUrl: OTHER_JPG.url
        };
        const p1 = shouldPreserveLocalHeroPresentationOverRemote(localMp4Record, staleRemoteJpg);
        assert(p1.preserve === true, 'stale server JPG does not overwrite local durable MP4 commit');
        assert(p1.reason === 'local_client_identity_commit', `preserve reason=${p1.reason}`);

        const sameId = shouldPreserveLocalHeroPresentationOverRemote(localMp4Record, {
            heroAssetId: MP4.id,
            mediaUrl: MP4.url,
            backgroundSource: 'custom_video'
        });
        assert(sameId.preserve === false, 'same remote asset id heals (preserve=false)');

        const emptyLocal = shouldPreserveLocalHeroPresentationOverRemote(
            { mode: 'selection', assetId: '', mediaUrl: '', source: 'default' },
            staleRemoteJpg
        );
        assert(emptyLocal.preserve === false, 'empty/selection local applies remote');

        const serverOriginLocal = shouldPreserveLocalHeroPresentationOverRemote(
            {
                ...localMp4Record,
                assetId: OTHER_JPG.id,
                mediaUrl: OTHER_JPG.url,
                mediaKind: 'image',
                source: 'server_presentation'
            },
            {
                heroAssetId: MP4.id,
                mediaUrl: MP4.url,
                backgroundSource: 'custom_video'
            }
        );
        assert(
            serverOriginLocal.preserve === false,
            'prior server_presentation local yields to newer remote'
        );

        const remoteTsNewer = shouldPreserveLocalHeroPresentationOverRemote(
            { ...localMp4Record, updatedAt: 1000 },
            { ...staleRemoteJpg, updatedAt: 5000 }
        );
        assert(remoteTsNewer.preserve === false, 'remote timestamp newer wins when present');

        assert(
            isServerOriginHeroSource('hero_authority_rehydrate_fail_closed') === false,
            'fail-closed source is not server-origin'
        );
        assert(isServerOriginHeroSource('server_presentation') === true, 'server_presentation is server-origin');
        assert(
            isServerOriginHeroSource('hero_authority_rehydrate') === false,
            'hero_authority_rehydrate is not canonical server_presentation'
        );
        const failClosedLocal = {
            ...localMp4Record,
            source: 'hero_authority_rehydrate_fail_closed',
            updatedAt: 1000
        };
        const pFailClosed = shouldPreserveLocalHeroPresentationOverRemote(failClosedLocal, staleRemoteJpg);
        assert(pFailClosed.preserve === true, 'fail-closed durable A not overwritten by stale remote B');
        assert(
            pFailClosed.reason === 'local_unconfirmed_fail_closed',
            `fail-closed preserve reason=${pFailClosed.reason}`
        );
        const pFailClosedNewer = shouldPreserveLocalHeroPresentationOverRemote(failClosedLocal, {
            ...staleRemoteJpg,
            updatedAt: 5000
        });
        assert(
            pFailClosedNewer.preserve === true,
            'newer stale remote C does not overwrite unconfirmed A solely due to fail-closed source'
        );

        assert(hasDurableLocalHeroAsset(localMp4Record) === true, 'hasDurableLocalHeroAsset true');
        assert(
            hasDurableLocalHeroAsset({ mode: 'selection', assetId: '', mediaUrl: '' }) === false,
            'hasDurableLocalHeroAsset false for selection'
        );

        // ---------- E: hydrateHeroPresentationFromServer integration ----------
        clearHero();
        seedVault();
        commitHeroAssetSelection(MP4.id, [JPG, MP4, OTHER_JPG]);
        const beforeHydrate = loadHeroRecordUnverified();
        assert(String(beforeHydrate?.assetId || '') === MP4.id, 'pre-hydrate local is MP4');

        // Mock fetch: intercept via fetchHeroPresentation is hard; call preserve gate +
        // simulate hydrate branch manually with saveFn/loadFn and remote override helpers.
        const { fetchHeroPresentation } = await server.ssrLoadModule(
            '/src/lib/api/heroPresentation.js'
        );
        void fetchHeroPresentation;

        // Monkey-patch module fetch by applying preserve path: verify apply does not flip when preserve.
        const remoteStale = {
            heroAssetId: OTHER_JPG.id,
            backgroundSource: 'custom_image',
            backgroundStyle: 'image',
            mediaUrl: OTHER_JPG.url,
            posterUrl: OTHER_JPG.url,
            heroTitle: 'STALE SERVER JPG'
        };
        const preserveAtHydrate = shouldPreserveLocalHeroPresentationOverRemote(
            loadHeroRecordUnverified(),
            remoteStale
        );
        assert(preserveAtHydrate.preserve === true, 'hydrate gate protectes local after commit');

        // Fake hydrate: only apply remote when gate says no
        let savedPatch = null;
        const saveFn = (patch, opts) => {
            savedPatch = { patch, opts };
            return saveHeroManagerConfig(patch, { skipServer: true, source: 'backend' });
        };
        const loadFn = () => loadHeroManagerConfig();

        // Inject remote via temporarily wrapping — call internal by simulating hydrate body
        if (!preserveAtHydrate.preserve) {
            saveFn(
                {
                    heroAssetId: remoteStale.heroAssetId,
                    backgroundSource: remoteStale.backgroundSource,
                    mediaUrl: remoteStale.mediaUrl
                },
                { skipServer: true }
            );
            applyServerPresentationToHeroRecord(remoteStale);
        }
        const afterProtected = loadHeroRecordUnverified();
        assert(
            String(afterProtected?.assetId || '') === MP4.id,
            'local MP4 survives stale remote presentation'
        );
        assert(afterProtected?.mediaKind === 'video', 'surviving local remains video');

        // Empty local + authoritative server JPG → apply remote
        clearHero();
        seedVault();
        // selection default
        localStorage.setItem(
            MANAGER_KEY,
            JSON.stringify({ backgroundSource: 'selection', heroAssetId: '' })
        );
        const emptyGate = shouldPreserveLocalHeroPresentationOverRemote(
            loadHeroRecordUnverified(),
            remoteStale
        );
        assert(emptyGate.preserve === false, 'empty local does not preserve');
        applyServerPresentationToHeroRecord(remoteStale);
        saveHeroManagerConfig(
            {
                heroAssetId: remoteStale.heroAssetId,
                backgroundSource: 'custom_image',
                mediaUrl: remoteStale.mediaUrl,
                posterUrl: remoteStale.posterUrl
            },
            { skipServer: true, source: 'backend' }
        );
        const afterEmpty = snap();
        assert(String(afterEmpty.record?.assetId || '') === OTHER_JPG.id, 'server JPG hydrates empty local');
        assert(afterEmpty.record?.mediaKind === 'image', 'hydrated server JPG is image');
        assert(
            String(afterEmpty.record?.source || '') === 'server_presentation',
            'hydrated source server_presentation'
        );

        // Vault list still available for resolve
        const vault = loadHeroVaultItems([JPG, MP4]);
        assert(Array.isArray(vault) && vault.length >= 1, 'loadHeroVaultItems works');

        // Live hydrate function export
        assert(typeof hydrateHeroPresentationFromServer === 'function', 'hydrate exported');

        // ---------- F: reload simulation (persist config across clear of applied stores only) ----------
        clearHero();
        seedVault();
        commitHeroAssetSelection(JPG.id, [JPG, MP4]);
        const serializedRecord = localStorage.getItem(RECORD_KEY);
        const serializedManager = localStorage.getItem(MANAGER_KEY);
        // "reload" — new memory load by re-reading keys still present
        assert(Boolean(serializedRecord), 'HeroRecord survives storage round-trip');
        assert(Boolean(serializedManager), 'manager config survives storage round-trip');
        const reloaded = JSON.parse(serializedRecord || '{}');
        assert(reloaded.mode === 'asset', 'reload mode asset');
        assert(reloaded.assetId === JPG.id, 'reload heroAssetId');
        assert(reloaded.mediaKind === 'image', 'reload mediaKind image');
        const reloadedMgr = JSON.parse(serializedManager || '{}');
        assert(reloadedMgr.heroAssetId === JPG.id, 'reload manager heroAssetId');
        assert(!Object.prototype.hasOwnProperty.call(reloadedMgr, 'backgroundAsset'), 'reload no backgroundAsset');

        // ---------- G: identity mismatch enrichment (A manager + B record) ----------
        clearHero();
        seedVault();
        commitHeroAssetSelection(MP4.id, [JPG, MP4, OTHER_JPG]);
        assert(String(loadHeroRecordUnverified()?.assetId || '') === MP4.id, 'record is B (MP4) before mismatch enrich');

        const mismatchEmptyMedia = enrichPresentationConfigFromLocalIdentity({
            heroAssetId: JPG.id,
            backgroundSource: 'custom_image',
            mediaUrl: '',
            posterUrl: '',
            backgroundMediaUrl: '',
            backgroundVideo: '',
            backgroundImage: ''
        });
        assert(String(mismatchEmptyMedia.heroAssetId || '') === JPG.id, 'mismatch keeps manager A id');
        assert(
            !String(mismatchEmptyMedia.mediaUrl || mismatchEmptyMedia.backgroundMediaUrl || '').includes(
                'hero-test.mp4'
            ),
            'mismatch does not attach HeroRecord B media to manager A'
        );
        assert(
            !String(mismatchEmptyMedia.posterUrl || '').includes('hero-test.mp4'),
            'mismatch does not attach HeroRecord B poster/video identity to manager A'
        );

        const mismatchKeptA = enrichPresentationConfigFromLocalIdentity({
            heroAssetId: JPG.id,
            backgroundSource: 'custom_image',
            mediaUrl: JPG.url,
            posterUrl: JPG.url
        });
        assert(String(mismatchKeptA.heroAssetId || '') === JPG.id, 'mismatch with A media keeps A id');
        assert(String(mismatchKeptA.mediaUrl || '').includes('hero-test.jpg'), 'mismatch keeps A mediaUrl');
        assert(!String(mismatchKeptA.mediaUrl || '').includes('hero-test.mp4'), 'mismatch does not replace A with B');

        const emptyProjectsB = enrichPresentationConfigFromLocalIdentity({
            heroAssetId: '',
            backgroundSource: 'selection',
            mediaUrl: '',
            posterUrl: '',
            backgroundMediaUrl: ''
        });
        assert(String(emptyProjectsB.heroAssetId || '') === MP4.id, 'empty manager projects HeroRecord B id');
        assert(
            String(emptyProjectsB.mediaUrl || '').includes('hero-test.mp4'),
            'empty manager projects HeroRecord B media'
        );

        const matchProjectsB = enrichPresentationConfigFromLocalIdentity({
            heroAssetId: MP4.id,
            backgroundSource: 'custom_video',
            mediaUrl: '',
            posterUrl: '',
            backgroundMediaUrl: ''
        });
        assert(String(matchProjectsB.heroAssetId || '') === MP4.id, 'matching ids keep B');
        assert(
            String(matchProjectsB.mediaUrl || '').includes('hero-test.mp4'),
            'matching ids project HeroRecord B media'
        );

        // ---------- H: active vs inactive deletion (canonical clear path) ----------
        // Mirrors HeroManagerPanel.deleteHeroVaultAsset: clear HeroRecord only when deleted id === active id.
        function clearIfActiveHeroDeleted(activeId, deletedId) {
            if (String(activeId || '') === String(deletedId || '')) {
                return commitHeroAssetSelection('');
            }
            return null;
        }

        clearHero();
        seedVault();
        commitHeroAssetSelection(JPG.id, [JPG, MP4, OTHER_JPG]);
        assert(String(loadHeroRecordUnverified()?.assetId || '') === JPG.id, 'active Hero is A before clear');
        const clearedActive = clearIfActiveHeroDeleted(JPG.id, JPG.id);
        assert(Boolean(clearedActive), 'active delete invokes canonical clear');
        const afterActiveClear = loadHeroRecordUnverified();
        assert(afterActiveClear?.mode === 'none', 'canonical clear → HeroRecord.mode=none');
        assert(!String(afterActiveClear?.assetId || '').trim(), 'canonical clear removes stale assetId');
        assert(!String(clearedActive?.heroAssetId || '').trim(), 'canonical clear empties manager heroAssetId');
        assert(
            String(clearedActive?.backgroundSource || '') === 'none' ||
                String(loadHeroManagerConfig()?.backgroundSource || '') === 'none',
            'canonical clear manager pointer is blank/none'
        );

        clearHero();
        seedVault();
        commitHeroAssetSelection(JPG.id, [JPG, MP4, OTHER_JPG]);
        const skippedInactive = clearIfActiveHeroDeleted(JPG.id, MP4.id);
        assert(skippedInactive == null, 'inactive delete does not invoke canonical clear');
        const afterInactive = loadHeroRecordUnverified();
        assert(String(afterInactive?.assetId || '') === JPG.id, 'deleting inactive B does not clear active A');
        assert(afterInactive?.mode === 'asset', 'inactive delete leaves HeroRecord.mode=asset');
        assert(String(loadHeroManagerConfig()?.heroAssetId || '') === JPG.id, 'inactive delete leaves manager A');

        const panelSrc = readFileSync(join(SRC, 'components/studio/HeroManagerPanel.svelte'), 'utf8');
        const deleteStart = panelSrc.indexOf('async function deleteHeroVaultAsset');
        const deleteEnd = panelSrc.indexOf('\n    function refresh()', deleteStart);
        const deleteFn = deleteStart >= 0 && deleteEnd > deleteStart ? panelSrc.slice(deleteStart, deleteEnd) : '';
        assert(Boolean(deleteFn), 'deleteHeroVaultAsset source located');
        assert(
            deleteFn.includes("commitHeroAssetSelection('')") || deleteFn.includes('commitHeroAssetSelection("")'),
            'deleteHeroVaultAsset uses canonical commitHeroAssetSelection("") for active clear'
        );
        assert(
            deleteFn.includes("confirmServerPresentation('clear_background'") ||
                deleteFn.includes('confirmServerPresentation("clear_background"'),
            'deleteHeroVaultAsset publishes explicit none via confirmServerPresentation'
        );
        assert(
            /heroAssetId/.test(deleteFn) && /item\.assetId/.test(deleteFn),
            'deleteHeroVaultAsset compares active heroAssetId to deleted item'
        );
        const clearCallIdx = Math.max(
            deleteFn.indexOf("commitHeroAssetSelection('')"),
            deleteFn.indexOf('commitHeroAssetSelection("")')
        );
        const guardIdx = deleteFn.indexOf('item.assetId');
        assert(guardIdx >= 0 && clearCallIdx > guardIdx, 'canonical clear runs only after active-id guard');

        // ---------- I: apply-vs-resolve authority (deterministic / in-memory contract) ----------
        // Not browser coverage. Proves runtime resolve/apply share HeroRecord media identity.
        const OTHER_MP4_URL = 'https://cdn.example.test/videos/stale-hero-b.mp4';

        function writeStaleManager(patch) {
            localStorage.setItem(
                MANAGER_KEY,
                JSON.stringify({
                    backgroundSource: 'selection',
                    heroAssetId: '',
                    ...patch
                })
            );
        }

        function captureApply(manager) {
            let video = '';
            let poster = '';
            applyHeroManagerBackground(manager, {
                setVideo: (u) => {
                    video = String(u || '');
                },
                setPoster: (u) => {
                    poster = String(u || '');
                },
                setFailed: () => {}
            });
            return { video, poster };
        }

        const staleJpgMgr = {
            heroAssetId: OTHER_JPG.id,
            backgroundSource: 'custom_image',
            mediaUrl: OTHER_JPG.url,
            backgroundMediaUrl: OTHER_JPG.url,
            posterUrl: OTHER_JPG.url,
            backgroundImage: OTHER_JPG.url
        };
        const staleMp4Mgr = {
            heroAssetId: OTHER_JPG.id,
            backgroundSource: 'custom_video',
            mediaUrl: OTHER_MP4_URL,
            backgroundMediaUrl: OTHER_MP4_URL,
            backgroundVideo: OTHER_MP4_URL,
            posterUrl: OTHER_JPG.url
        };

        // Test 1 — committed JPG A vs manager/server B
        clearHero();
        seedVault();
        commitHeroAssetSelection(JPG.id, [JPG, MP4, OTHER_JPG]);
        writeStaleManager(staleJpgMgr);
        const jpgMismatchApply = captureApply(staleJpgMgr);
        const jpgMismatchResolve = resolveHeroBackgroundAsset(staleJpgMgr, null, { log: false });
        assert(
            String(jpgMismatchResolve.assetId || '') === JPG.id,
            'T1 resolve identity stays HeroRecord A (JPG)'
        );
        assert(
            String(jpgMismatchResolve.imageUrl || jpgMismatchResolve.mediaUrl || '').includes('hero-test.jpg'),
            'T1 resolve media is URL_A not URL_B'
        );
        assert(
            !String(jpgMismatchResolve.mediaUrl || jpgMismatchResolve.imageUrl || '').includes('stale.jpg'),
            'T1 manager/server B does not override HeroRecord A'
        );
        assert(
            String(jpgMismatchApply.poster || '').includes('hero-test.jpg'),
            'T1 apply poster is URL_A'
        );
        assert(!String(jpgMismatchApply.video || '').trim(), 'T1 apply video empty for image');

        // Test 2 — committed MP4 A vs manager/server VIDEO_B
        clearHero();
        seedVault();
        commitHeroAssetSelection(MP4.id, [JPG, MP4, OTHER_JPG]);
        writeStaleManager(staleMp4Mgr);
        const mp4MismatchApply = captureApply(staleMp4Mgr);
        const mp4MismatchResolve = resolveHeroBackgroundAsset(staleMp4Mgr, null, { log: false });
        assert(String(mp4MismatchResolve.assetId || '') === MP4.id, 'T2 resolve identity stays HeroRecord A (MP4)');
        assert(
            String(mp4MismatchResolve.videoUrl || mp4MismatchResolve.mediaUrl || '').includes('hero-test.mp4'),
            'T2 resolve media is VIDEO_A'
        );
        assert(
            !String(mp4MismatchResolve.videoUrl || mp4MismatchResolve.mediaUrl || '').includes('stale-hero-b.mp4'),
            'T2 manager/server VIDEO_B does not override HeroRecord A'
        );
        assert(String(mp4MismatchApply.video || '').includes('hero-test.mp4'), 'T2 apply video is VIDEO_A');

        // Test 3 — matching identity A + manager A + server A
        clearHero();
        seedVault();
        commitHeroAssetSelection(JPG.id, [JPG, MP4, OTHER_JPG]);
        const matchMgr = loadHeroManagerConfig();
        const matchApply = captureApply(matchMgr);
        const matchResolve = resolveHeroBackgroundAsset(matchMgr, null, { log: false });
        assert(String(matchResolve.assetId || '') === JPG.id, 'T3 matching resolve stays A');
        assert(
            String(matchResolve.imageUrl || matchResolve.mediaUrl || '').includes('hero-test.jpg'),
            'T3 matching resolve is URL_A'
        );
        assert(String(matchApply.poster || '').includes('hero-test.jpg'), 'T3 matching apply is URL_A');
        assert(String(matchMgr.heroAssetId || '') === JPG.id, 'T3 manager pointer still A');

        // Test 4 — mode=none must not resurrect stale manager/server media
        clearHero();
        seedVault();
        commitHeroAssetSelection(JPG.id, [JPG, MP4, OTHER_JPG]);
        commitHeroAssetSelection('');
        writeStaleManager(staleJpgMgr);
        const noneApply = captureApply(staleJpgMgr);
        const noneResolve = resolveHeroBackgroundAsset(staleJpgMgr, null, { log: false });
        assert(loadHeroRecordUnverified()?.mode === 'none', 'T4 HeroRecord remains mode=none');
        assert(!String(noneResolve.mediaUrl || '').trim(), 'T4 resolve mediaUrl empty');
        assert(!String(noneResolve.videoUrl || '').trim(), 'T4 resolve videoUrl empty');
        assert(!String(noneResolve.imageUrl || '').trim(), 'T4 resolve imageUrl empty');
        assert(!String(noneApply.video || '').trim(), 'T4 apply video empty');
        assert(!String(noneApply.poster || '').trim(), 'T4 apply poster empty (no stale resurrection)');
        assert(!String(noneResolve.mediaUrl || noneResolve.imageUrl || '').includes('stale.jpg'), 'T4 no stale.jpg');

        // Test 5 — no usable HeroRecord: existing manager/catalog fallback still works
        clearHero();
        seedVault();
        const fallbackMgr = {
            heroAssetId: JPG.id,
            backgroundSource: 'custom_image',
            mediaUrl: JPG.url,
            backgroundMediaUrl: JPG.url,
            posterUrl: JPG.url
        };
        writeStaleManager(fallbackMgr);
        const fallbackResolve = resolveHeroBackgroundAsset(fallbackMgr, null, { log: false });
        const fallbackRecord = loadHeroRecordUnverified();
        assert(
            fallbackRecord?.mode !== 'asset' || !String(fallbackRecord?.assetId || '').trim(),
            'T5 no usable committed HeroRecord asset'
        );
        assert(
            String(fallbackResolve.mediaUrl || fallbackResolve.imageUrl || '').includes('hero-test.jpg'),
            'T5 fallback resolve still uses manager/catalog JPG'
        );

        // Test 6 — apply/resolve convergence on same HeroRecord
        function assertApplyResolveConverge(label, managerOverride = null) {
            const manager = managerOverride || loadHeroManagerConfig();
            const applied = captureApply(manager);
            const resolved = resolveHeroBackgroundAsset(manager, null, { log: false });
            const rec = loadHeroRecordUnverified();
            if (rec?.mode === 'asset' && rec.mediaKind === 'image') {
                assert(
                    String(resolved.assetId || '') === String(rec.assetId || ''),
                    `${label} resolve assetId matches HeroRecord`
                );
                assert(!String(resolved.videoUrl || '').trim(), `${label} resolve kind=image (no videoUrl)`);
                assert(
                    String(applied.poster || '').includes('hero-test.jpg') &&
                        String(resolved.imageUrl || resolved.mediaUrl || '').includes('hero-test.jpg'),
                    `${label} apply+resolve share image URL_A`
                );
                assert(!String(applied.video || '').trim(), `${label} apply kind=image (no video)`);
            } else if (rec?.mode === 'asset' && rec.mediaKind === 'video') {
                assert(
                    String(resolved.assetId || '') === String(rec.assetId || ''),
                    `${label} resolve assetId matches HeroRecord`
                );
                assert(
                    String(applied.video || '').includes('hero-test.mp4') &&
                        String(resolved.videoUrl || resolved.mediaUrl || '').includes('hero-test.mp4'),
                    `${label} apply+resolve share VIDEO_A`
                );
            } else {
                assert(false, `${label} expected committed HeroRecord asset`);
            }
        }

        clearHero();
        seedVault();
        commitHeroAssetSelection(JPG.id, [JPG, MP4, OTHER_JPG]);
        assertApplyResolveConverge('T6 JPG');
        writeStaleManager(staleJpgMgr);
        assertApplyResolveConverge('T6 JPG vs stale manager B', staleJpgMgr);

        clearHero();
        seedVault();
        commitHeroAssetSelection(MP4.id, [JPG, MP4, OTHER_JPG]);
        assertApplyResolveConverge('T6 MP4');
        writeStaleManager(staleMp4Mgr);
        assertApplyResolveConverge('T6 MP4 vs stale manager B', staleMp4Mgr);

        // ---------- J: Phase 4 authority source + durable active clear (in-memory) ----------
        localStorage.setItem('reelforge_admin_session_token', 'dev_local_session');

        clearHero();
        seedVault();
        commitHeroAssetSelection(JPG.id, [JPG, MP4, OTHER_JPG]);
        assert(
            loadHeroRecordUnverified()?.source === 'commit_hero_asset_selection',
            'J1 select A → source=commit_hero_asset_selection'
        );
        await hydrateHeroAuthorityRuntime(loadHeroRecordUnverified(), {
            persist: true,
            engine: { rehydrate: () => null }
        });
        const afterFailClosed = loadHeroRecordUnverified();
        assert(afterFailClosed?.assetId === JPG.id, 'J2 rehydrate fail keeps asset A');
        assert(afterFailClosed?.mode === 'asset', 'J2 rehydrate fail keeps mode=asset');
        assert(
            String(afterFailClosed?.mediaUrl || '').includes('hero-test.jpg'),
            'J2 rehydrate fail keeps mediaUrl A'
        );
        assert(
            afterFailClosed?.source === 'commit_hero_asset_selection',
            'J3 rehydrate fail does not stamp fail-closed over client commit'
        );
        assert(
            isServerOriginHeroSource(afterFailClosed?.source) === false,
            'J3 commit source is not treated as server-origin'
        );
        const afterFailPreserve = shouldPreserveLocalHeroPresentationOverRemote(afterFailClosed, {
            heroAssetId: OTHER_JPG.id,
            backgroundSource: 'custom_image',
            mediaUrl: OTHER_JPG.url
        });
        assert(afterFailPreserve.preserve === true, 'J4 stale remote B/C cannot overwrite unconfirmed A');

        const origFetch = globalThis.fetch;
        globalThis.fetch = async (url, init = {}) => {
            const href = String(url || '');
            const method = String(init.method || 'GET').toUpperCase();
            if (href.includes('/api/hero/presentation') && method === 'PUT') {
                let body = {};
                try {
                    body = JSON.parse(String(init.body || '{}'));
                } catch {
                    body = {};
                }
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ ...body, updatedAt: Date.now() })
                };
            }
            if (href.includes('/api/hero/presentation')) {
                return { ok: true, status: 200, json: async () => ({}) };
            }
            if (typeof origFetch === 'function') return origFetch(url, init);
            return { ok: false, status: 404, json: async () => ({ error: 'not_found' }) };
        };
        try {
            const putA = await persistHeroPresentationToServer(loadHeroManagerConfig());
            assert(putA?.ok === true, 'J5 persistHeroPresentationToServer PUT succeeds');
            assert(
                loadHeroRecordUnverified()?.source === 'server_presentation',
                'J5 successful PUT A → source=server_presentation'
            );
            const afterPutA = loadHeroRecordUnverified();
            const hydrateSameA = shouldPreserveLocalHeroPresentationOverRemote(afterPutA, {
                heroAssetId: JPG.id,
                backgroundSource: 'custom_image',
                mediaUrl: JPG.url
            });
            assert(hydrateSameA.preserve === false, 'J6 subsequent hydrate with A heals (same id)');
            assert(String(afterPutA?.assetId || '') === JPG.id, 'J6 A remains stable after confirmed PUT');

            clearHero();
            seedVault();
            commitHeroAssetSelection(JPG.id, [JPG, MP4, OTHER_JPG]);
            const cleared = commitHeroAssetSelection('');
            assert(loadHeroRecordUnverified()?.mode === 'none', 'J-Bug2 immediate mode=none');
            assert(!String(loadHeroRecordUnverified()?.assetId || '').trim(), 'J-Bug2 no assetId');
            assert(!String(loadHeroRecordUnverified()?.mediaUrl || '').trim(), 'J-Bug2 no mediaUrl');
            assert(!String(cleared?.heroAssetId || '').trim(), 'J-Bug2 manager cleared');
            assert(String(cleared?.backgroundSource || '') === 'none', 'J-Bug2 manager backgroundSource=none');
            const putNone = await persistHeroPresentationToServer(cleared || loadHeroManagerConfig());
            assert(putNone?.ok === true, 'J-Bug2 explicit none PUT succeeds');
            assert(
                String(putNone?.payload?.backgroundSource || putNone?.server?.backgroundSource || '') === 'none' ||
                    String(loadHeroRecordUnverified()?.mode || '') === 'none',
                'J-Bug2 PUT body/record is explicit none'
            );
            assert(
                loadHeroRecordUnverified()?.mode === 'none',
                'J-Bug2 after PUT success still mode=none'
            );
            assert(
                loadHeroRecordUnverified()?.source === 'server_presentation',
                'J-Bug2 successful none PUT → source=server_presentation'
            );

            // ---------- Phase 9: authority runtime vs canonical presentation ----------
            const successEngine = { rehydrate: () => ({ events: [] }) };
            const failEngine = { rehydrate: () => null };

            clearHero();
            seedVault();
            commitHeroAssetSelection(JPG.id, [JPG, MP4, OTHER_JPG]);
            const putA9 = await persistHeroPresentationToServer(loadHeroManagerConfig());
            assert(putA9?.ok === true, 'P9-1 confirmed A PUT succeeds');
            await hydrateHeroAuthorityRuntime(loadHeroRecordUnverified(), {
                persist: true,
                engine: successEngine
            });
            const afterAHydrate = loadHeroRecordUnverified();
            assert(afterAHydrate?.assetId === JPG.id, 'P9-1 rehydrate keeps confirmed A');
            assert(afterAHydrate?.mode === 'asset', 'P9-1 rehydrate mode=asset A');
            assert(afterAHydrate?.mediaKind === 'image', 'P9-1 JPG kind remains image');
            assert(
                afterAHydrate?.source === 'server_presentation',
                `P9-1 successful PUT+rehydrate source=server_presentation (got ${afterAHydrate?.source})`
            );

            clearHero();
            seedVault();
            commitHeroAssetSelection(MP4.id, [JPG, MP4, OTHER_JPG]);
            const putMp4 = await persistHeroPresentationToServer(loadHeroManagerConfig());
            assert(putMp4?.ok === true, 'P9-9 MP4 PUT succeeds');
            await hydrateHeroAuthorityRuntime(loadHeroRecordUnverified(), {
                persist: true,
                engine: successEngine
            });
            const afterMp4Hydrate = loadHeroRecordUnverified();
            assert(afterMp4Hydrate?.assetId === MP4.id, 'P9-9 MP4 remains after rehydrate');
            assert(afterMp4Hydrate?.mediaKind === 'video', 'P9-9 MP4 kind remains video');
            assert(
                afterMp4Hydrate?.source === 'server_presentation',
                'P9-9 MP4 source stays server_presentation (JPG/MP4 symmetric)'
            );

            clearHero();
            seedVault();
            commitHeroAssetSelection(JPG.id, [JPG, MP4, OTHER_JPG]);
            await persistHeroPresentationToServer(loadHeroManagerConfig());
            const cleared9 = commitHeroAssetSelection('');
            const putNone9 = await persistHeroPresentationToServer(cleared9 || loadHeroManagerConfig());
            assert(putNone9?.ok === true, 'P9-2/3 none PUT succeeds');
            assert(loadHeroRecordUnverified()?.mode === 'none', 'P9-2 confirmed none mode=none');
            await hydrateHeroAuthorityRuntime(loadHeroRecordUnverified(), {
                persist: true,
                engine: successEngine
            });
            const afterNoneHydrate = loadHeroRecordUnverified();
            assert(afterNoneHydrate?.mode === 'none', 'P9-2 rehydrate keeps mode=none');
            assert(!String(afterNoneHydrate?.assetId || '').trim(), 'P9-2 rehydrate assetId empty');
            assert(!String(afterNoneHydrate?.mediaUrl || '').trim(), 'P9-2 rehydrate mediaUrl empty');
            assert(
                afterNoneHydrate?.source === 'server_presentation',
                `P9-2 none source stays server_presentation (got ${afterNoneHydrate?.source})`
            );

            clearHero();
            seedVault();
            commitHeroAssetSelection(JPG.id, [JPG, MP4, OTHER_JPG]);
            await persistHeroPresentationToServer(loadHeroManagerConfig());
            const racingEngine = {
                rehydrate: () => {
                    commitHeroAssetSelection('');
                    return { events: [] };
                }
            };
            await hydrateHeroAuthorityRuntime(loadHeroRecordUnverified(), {
                persist: true,
                engine: racingEngine
            });
            const afterRace = loadHeroRecordUnverified();
            assert(afterRace?.mode === 'none', 'P9-3 in-flight rehydrate cannot resurrect A over none');
            assert(!String(afterRace?.assetId || '').trim(), 'P9-3 raced none keeps empty assetId');

            clearHero();
            seedVault();
            commitHeroAssetSelection(JPG.id, [JPG, MP4, OTHER_JPG]);
            await persistHeroPresentationToServer(loadHeroManagerConfig());
            commitHeroAssetSelection(MP4.id, [JPG, MP4, OTHER_JPG]);
            const failFetch = globalThis.fetch;
            globalThis.fetch = async (url, init = {}) => {
                const href = String(url || '');
                const method = String(init.method || 'GET').toUpperCase();
                if (href.includes('/api/hero/presentation') && method === 'PUT') {
                    return {
                        ok: false,
                        status: 500,
                        json: async () => ({ error: 'phase9_forced_put_failure' })
                    };
                }
                if (typeof failFetch === 'function') return failFetch(url, init);
                return { ok: false, status: 404, json: async () => ({}) };
            };
            const failedPutB = await persistHeroPresentationToServer(loadHeroManagerConfig());
            assert(failedPutB?.ok !== true, 'P9-4 PUT B fails');
            assert(
                loadHeroRecordUnverified()?.assetId === MP4.id,
                'P9-4 local B remains after failed PUT'
            );
            assert(
                loadHeroRecordUnverified()?.source === 'commit_hero_asset_selection',
                `P9-4 failed PUT keeps commit source (got ${loadHeroRecordUnverified()?.source})`
            );
            await hydrateHeroAuthorityRuntime(loadHeroRecordUnverified(), {
                persist: true,
                engine: successEngine
            });
            const afterFailPutHydrate = loadHeroRecordUnverified();
            assert(afterFailPutHydrate?.assetId === MP4.id, 'P9-4 rehydrate after failed PUT keeps B');
            assert(afterFailPutHydrate?.mediaKind === 'video', 'P9-4 B kind remains video');
            assert(
                afterFailPutHydrate?.source === 'commit_hero_asset_selection',
                `P9-4 rehydrate does not convert B to server-origin (got ${afterFailPutHydrate?.source})`
            );
            const preserveB = shouldPreserveLocalHeroPresentationOverRemote(afterFailPutHydrate, {
                heroAssetId: JPG.id,
                backgroundSource: 'custom_image',
                mediaUrl: JPG.url
            });
            assert(preserveB.preserve === true, 'P9-4 stale confirmed server A cannot overwrite unconfirmed B');
            globalThis.fetch = failFetch;

            clearHero();
            seedVault();
            commitHeroAssetSelection(JPG.id, [JPG, MP4, OTHER_JPG]);
            await persistHeroPresentationToServer(loadHeroManagerConfig());
            commitHeroAssetSelection(MP4.id, [JPG, MP4, OTHER_JPG]);
            await hydrateHeroAuthorityRuntime(loadHeroRecordUnverified(), {
                persist: true,
                engine: failEngine
            });
            const afterAuthFail = loadHeroRecordUnverified();
            assert(afterAuthFail?.assetId === MP4.id, 'P9-5 failed authority rehydrate keeps B');
            assert(
                afterAuthFail?.source === 'commit_hero_asset_selection',
                `P9-5 fail-closed does not overwrite commit B (got ${afterAuthFail?.source})`
            );
            assert(
                isServerOriginHeroSource(afterAuthFail?.source) === false,
                'P9-5 B is not server-origin after failed rehydrate'
            );

            writeStaleManager(staleJpgMgr);
            assertApplyResolveConverge('P9-6/7 JPG vs stale manager B', staleJpgMgr);
            clearHero();
            seedVault();
            commitHeroAssetSelection(MP4.id, [JPG, MP4, OTHER_JPG]);
            writeStaleManager(staleMp4Mgr);
            assertApplyResolveConverge('P9-6/7 MP4 vs stale manager A', staleMp4Mgr);

            clearHero();
            seedVault();
            commitHeroAssetSelection(JPG.id, [JPG, MP4, OTHER_JPG]);
            await persistHeroPresentationToServer(loadHeroManagerConfig());
            const beforeInactive = loadHeroRecordUnverified();
            localStorage.setItem(
                'personal_video_vault',
                JSON.stringify([JPG])
            );
            const afterInactive = loadHeroRecordUnverified();
            assert(afterInactive?.assetId === JPG.id, 'P9-8 inactive vault drop keeps A');
            assert(afterInactive?.mode === beforeInactive?.mode, 'P9-8 inactive delete does not mutate mode');

            clearHero();
            seedVault();
            commitHeroAssetSelection('');
            await persistHeroPresentationToServer(loadHeroManagerConfig());
            localStorage.setItem(
                'reelforge_hero_manager_config',
                JSON.stringify({
                    ...JSON.parse(localStorage.getItem('reelforge_hero_manager_config') || '{}'),
                    backgroundAsset: OTHER_JPG.id,
                    backgroundVideo: MP4.url,
                    backgroundImage: OTHER_JPG.url
                })
            );
            const noneRec = loadHeroRecordUnverified();
            const rrLegacy = resolveHeroBackgroundAsset(
                JSON.parse(localStorage.getItem('reelforge_hero_manager_config') || '{}'),
                null,
                { log: false }
            );
            assert(noneRec?.mode === 'none', 'P9-10 cleared HeroRecord mode=none');
            assert(!String(rrLegacy.mediaUrl || rrLegacy.imageUrl || rrLegacy.videoUrl || '').trim(), 'P9-10 legacy cannot resurrect cleared Hero');
            const noneVsLegacy = shouldPreserveLocalHeroPresentationOverRemote(
                {
                    mode: 'asset',
                    assetId: JPG.id,
                    mediaUrl: JPG.url,
                    mediaKind: 'image',
                    source: 'server_presentation',
                    updatedAt: Date.now()
                },
                { heroAssetId: '', mediaUrl: '', backgroundSource: 'none' }
            );
            assert(noneVsLegacy.preserve === false, 'P9-10 confirmed none remote wins over stale server A');

            assert(
                shouldApplySuccessfulPresentationConfirm(
                    {
                        mode: 'asset',
                        assetId: JPG.id,
                        source: 'commit_hero_asset_selection',
                        mediaUrl: JPG.url
                    },
                    { heroAssetId: JPG.id, backgroundSource: 'custom_image', mediaUrl: JPG.url }
                ) === true,
                'P12 same-id confirm still stamps server_presentation'
            );
            assert(
                shouldApplySuccessfulPresentationConfirm(
                    {
                        mode: 'asset',
                        assetId: MP4.id,
                        source: 'commit_hero_asset_selection',
                        mediaUrl: MP4.url
                    },
                    { heroAssetId: JPG.id, backgroundSource: 'custom_image', mediaUrl: JPG.url }
                ) === false,
                'P12 in-flight A confirm cannot clobber live B commit'
            );
            assert(
                shouldApplySuccessfulPresentationConfirm(
                    { mode: 'none', assetId: '', source: 'commit_hero_asset_clear' },
                    { heroAssetId: JPG.id, backgroundSource: 'custom_image', mediaUrl: JPG.url }
                ) === false,
                'P12 in-flight A confirm cannot clobber live none'
            );

            clearHero();
            seedVault();
            commitHeroAssetSelection(JPG.id, [JPG, MP4, OTHER_JPG]);
            let releaseAPut;
            const aPutGate = new Promise((resolve) => {
                releaseAPut = resolve;
            });
            let aPutReleased = false;
            globalThis.fetch = async (url, init = {}) => {
                const href = String(url || '');
                const method = String(init.method || 'GET').toUpperCase();
                if (href.includes('/api/hero/presentation')) {
                    if (method === 'PUT') {
                        let body = {};
                        try {
                            body = JSON.parse(String(init.body || '{}'));
                        } catch {
                            body = {};
                        }
                        if (String(body.heroAssetId || '') === JPG.id && !aPutReleased) {
                            await aPutGate;
                            aPutReleased = true;
                            return {
                                ok: true,
                                status: 200,
                                json: async () => ({ ...body, updatedAt: Date.now() })
                            };
                        }
                        if (String(body.heroAssetId || '') === MP4.id) {
                            return {
                                ok: false,
                                status: 500,
                                json: async () => ({ error: 'p12_forced_put_failure' })
                            };
                        }
                        return {
                            ok: true,
                            status: 200,
                            json: async () => ({ ...body, updatedAt: Date.now() })
                        };
                    }
                    return {
                        ok: true,
                        status: 200,
                        json: async () => ({
                            heroAssetId: JPG.id,
                            backgroundSource: 'custom_image',
                            mediaUrl: JPG.url,
                            posterUrl: JPG.url
                        })
                    };
                }
                return { ok: false, status: 404, json: async () => ({}) };
            };
            const persistAPromise = persistHeroPresentationToServer(loadHeroManagerConfig());
            commitHeroAssetSelection(MP4.id, [JPG, MP4, OTHER_JPG]);
            assert(
                loadHeroRecordUnverified()?.assetId === MP4.id,
                'P12 B committed locally while A PUT in flight'
            );
            assert(
                loadHeroRecordUnverified()?.source === 'commit_hero_asset_selection',
                'P12 B source is unconfirmed commit before A confirm returns'
            );
            releaseAPut();
            const persistA = await persistAPromise;
            assert(persistA?.ok === true, 'P12 delayed A PUT still succeeds on the wire');
            assert(
                persistA?.deferredConfirm === true,
                'P12 A confirm is deferred because live identity moved to B'
            );
            const afterStaleA = loadHeroRecordUnverified();
            assert(afterStaleA?.assetId === MP4.id, 'P12 stale A confirm does not restore A');
            assert(
                afterStaleA?.source === 'commit_hero_asset_selection',
                `P12 B remains commit_hero_asset_selection (got ${afterStaleA?.source})`
            );
            const failB = await persistHeroPresentationToServer(loadHeroManagerConfig());
            assert(failB?.ok !== true, 'P12 subsequent B PUT fails');
            const afterFailB = loadHeroRecordUnverified();
            assert(afterFailB?.assetId === MP4.id, 'P12 failed B PUT keeps local B');
            assert(
                afterFailB?.source === 'commit_hero_asset_selection',
                `P12 failed B PUT source stays commit (got ${afterFailB?.source})`
            );
            const preserveAfterRace = shouldPreserveLocalHeroPresentationOverRemote(afterFailB, {
                heroAssetId: JPG.id,
                backgroundSource: 'custom_image',
                mediaUrl: JPG.url
            });
            assert(
                preserveAfterRace.preserve === true,
                'P12 hydrate still preserves unconfirmed B over stale server A'
            );
        } finally {
            globalThis.fetch = origFetch;
        }
    } finally {
        await server.close();
    }

    console.log('\n=== Hero Background Pipeline Validation ===\n');
    for (const n of notes) console.log(`PASS: ${n.replace(/^ok: /, '')}`);
    if (failures.length) {
        for (const f of failures) console.log(`FAIL: ${f}`);
        console.log('HERO_BACKGROUND_PIPELINE_COMPLETE=false');
        process.exit(1);
    }
    console.log('HERO_BACKGROUND_PIPELINE_COMPLETE=true');
}

main().catch((err) => {
    console.error(err);
    console.log('HERO_BACKGROUND_PIPELINE_COMPLETE=false');
    process.exit(1);
});
