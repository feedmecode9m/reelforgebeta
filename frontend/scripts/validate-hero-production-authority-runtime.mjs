#!/usr/bin/env node
/**
 * Hero Production Authority Runtime (Phase 8)
 *
 * PASS:
 * - authenticated publish required
 * - actor cannot self-escalate
 * - server state overrides local state
 * - stale cache cannot publish
 * - public resolver requires verified receipt
 * - draft editing still works without server publish
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let failed = 0;
function assert(label, cond) {
    if (cond) console.log(`  ✓ ${label}`);
    else {
        failed += 1;
        console.error(`  ✗ ${label}`);
    }
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

console.log('\nHero Production Authority Runtime (Phase 8)\n');

console.log('[0] Static contracts');
const idSrc = read('src/lib/auth/authorityIdentity.js');
assert('session binding helpers', idSrc.includes('readRuntimeAuthSession'));
assert('assertNoClientActorEscalation', idSrc.includes('assertNoClientActorEscalation'));
assert('publishAuthorityIdentityBridge', idSrc.includes('publishAuthorityIdentityBridge'));

const runtimeSrc = read('src/lib/hero/heroAuthorityRuntime.js');
assert('hydrateHeroAuthorityRuntime', runtimeSrc.includes('hydrateHeroAuthorityRuntime'));
assert('requestAuthenticatedHeroPublish', runtimeSrc.includes('requestAuthenticatedHeroPublish'));
assert('saveHeroDraftLocally', runtimeSrc.includes('saveHeroDraftLocally'));

const uiSrc = read('src/lib/hero/heroAuthorityUiState.js');
assert('pending approval state', uiSrc.includes('pending_approval'));
assert('waiting auth state', uiSrc.includes('waiting_for_authentication'));
assert('published and verified only', uiSrc.includes('published_and_verified'));
assert('server unavailable', uiSrc.includes('server_unavailable'));

const managerSrc = read('src/components/studio/HeroManagerPanel.svelte');
assert('manager uses requestAuthenticatedHeroPublish', managerSrc.includes('requestAuthenticatedHeroPublish'));
assert('manager rehydrates', managerSrc.includes('hydrateHeroAuthorityRuntime'));
assert('no master_hero_admin approve actor', !managerSrc.includes("actor: 'master_hero_admin'"));

const heroExp = read('src/components/experiences/HeroExperience.svelte');
assert('vault rehydrates authority', heroExp.includes('hydrateHeroAuthorityRuntime'));

const engineSrc = read('src/lib/hero/heroServerAuthorityEngine.js');
assert('srv1 active', engineSrc.includes('SIGNATURE_VERSION_SRV1'));
assert('srv2 contract prepared', engineSrc.includes('SIGNATURE_VERSION_SRV2'));

const backend = fs.readFileSync(
    path.join(root, '..', 'backend/src/api/hero_authority.rs'),
    'utf8'
);
assert('bind_session_actor', backend.includes('bind_session_actor'));
assert('client elevated reject', backend.includes('client_supplied_elevated_actor'));

const bag = new Map();
globalThis.localStorage = {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => bag.set(String(k), String(v)),
    removeItem: (k) => bag.delete(k),
    clear: () => bag.clear()
};
globalThis.window = {
    localStorage: globalThis.localStorage,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true
};

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});

try {
    const identity = await vite.ssrLoadModule('/src/lib/auth/authorityIdentity.js');
    const runtime = await vite.ssrLoadModule('/src/lib/hero/heroAuthorityRuntime.js');
    const ui = await vite.ssrLoadModule('/src/lib/hero/heroAuthorityUiState.js');
    const engineMod = await vite.ssrLoadModule('/src/lib/hero/heroServerAuthorityEngine.js');
    const auth = await vite.ssrLoadModule('/src/lib/hero/heroPresentationAuthority.js');
    const verify = await vite.ssrLoadModule('/src/lib/hero/heroAuthorityVerification.js');
    const recordMod = await vite.ssrLoadModule('/src/lib/hero/heroRecord.js');

    const base = {
        mode: 'asset',
        status: 'ready',
        assetId: 'hero-prod-1',
        mediaUrl: 'https://cdn.example.com/v.mp4',
        videoUrl: 'https://cdn.example.com/v.mp4',
        mediaKind: 'video',
        title: 'Creator Title',
        heroTitle: 'Creator Title',
        heroDescription: 'Creator body',
        schemaVersion: 1,
        revision: 0,
        updatedAt: Date.now()
    };
    const truth = auth.captureCreatorTruth(base);

    console.log('\n[1] Authenticated publish required');
    const unauth = identity.resolveAuthorityIdentity({ allowDevIdentity: false });
    assert('production without session unauthenticated', unauth.authenticated === false);

    const noAuthPublish = await runtime.requestAuthenticatedHeroPublish(
        { ...base, creatorTruth: truth },
        {
            publicTitle: 'X',
            publicDescription: 'Y',
            allowDevIdentity: false,
            sourceType: 'creator'
        }
    );
    assert(
        'authenticated publish required',
        noAuthPublish.ok === false &&
            (noAuthPublish.reason === 'waiting_for_authentication' ||
                noAuthPublish.ui?.id === 'waiting_for_authentication')
    );

    console.log('\n[2] Actor cannot self-escalate');
    const sessionId = identity.resolveAuthorityIdentity({
        session: {
            actorId: 'user-admin-9',
            role: 'admin',
            permissions: [...identity.HERO_AUTHORITY_PERMISSIONS]
        }
    });
    assert('session identity admin', sessionId.actorId === 'user-admin-9');

    const escalate = identity.assertNoClientActorEscalation(sessionId, {
        actor: 'master_hero_admin',
        approvedBy: 'root'
    });
    assert(
        'actor cannot self-escalate',
        escalate.ok === false && escalate.errors.includes('client_supplied_elevated_actor')
    );

    const escalateCall = await runtime.requestAuthenticatedHeroPublish(
        { ...base, creatorTruth: truth },
        {
            publicTitle: 'Vault',
            publicDescription: 'Body',
            sourceType: 'creator',
            actor: 'superroot',
            approvedBy: 'superroot',
            session: {
                actorId: 'user-admin-9',
                role: 'admin',
                permissions: [...identity.HERO_AUTHORITY_PERMISSIONS]
            }
        }
    );
    assert(
        'publish rejects elevated actor fields',
        escalateCall.ok === false &&
            String(escalateCall.reason).includes('elevated')
    );

    console.log('\n[3] Server state overrides local + stale cache');
    const engine = engineMod.createInMemoryHeroAuthorityEngine();
    const granted = await runtime.requestAuthenticatedHeroPublish(
        { ...base, creatorTruth: truth },
        {
            publicTitle: 'Vault Title',
            publicDescription: 'Vault body',
            publicTheme: 'Land',
            sourceType: 'creator',
            engine,
            session: {
                actorId: 'user-admin-9',
                role: 'admin',
                permissions: [...identity.HERO_AUTHORITY_PERMISSIONS]
            }
        }
    );
    assert('authenticated publish ok', granted.ok === true && granted.published === true);

    // Stale cache: local published without receipt
    const stale = {
        ...base,
        creatorTruth: truth,
        heroPresentation: {
            publicTitle: 'Stale Leak',
            publicDescription: 'nope',
            publicTheme: '',
            status: 'published',
            approvedBy: 'user-admin-9',
            approvedAt: Date.now(),
            visibility: 'public',
            showIntelligence: true
        },
        auditLog: [],
        serverAuthorityReceipt: null,
        serverAuthorityState: null
    };
    assert(
        'stale cache cannot publish (verify)',
        verify.verifyHeroRecordIntegrity(stale).verified === false
    );
    assert(
        'public resolver ignores stale cache',
        auth.resolvePublicHeroViewerCopy(stale).isPublished === false
    );

    // Hydrate with empty server history strips local publish
    const emptyEngine = engineMod.createInMemoryHeroAuthorityEngine();
    const hydrated = await runtime.hydrateHeroAuthorityRuntime(stale, {
        engine: emptyEngine,
        persist: false
    });
    assert(
        'server state overrides local published → not granted',
        hydrated.isPublished === false &&
            hydrated.record?.heroPresentation?.status !== 'published'
    );

    // Hydrate with real history wins
    const withGrant = await runtime.hydrateHeroAuthorityRuntime(granted.record, {
        engine,
        persist: false
    });
    assert('server history preserves verified publish', withGrant.isPublished === true);

    console.log('\n[4] Public resolver requires verified receipt');
    assert(
        'verified grant resolves public presentation',
        auth.resolvePublicHeroViewerCopy(granted.record).isPublished === true &&
            auth.resolvePublicHeroViewerCopy(granted.record).title === 'Vault Title'
    );

    const receiptOnly = {
        ...granted.record,
        serverAuthorityState: null
    };
    assert(
        'receipt alone insufficient without state',
        auth.resolvePublicHeroViewerCopy(receiptOnly).isPublished === false
    );

    console.log('\n[5] Draft editing works without server publish');
    bag.clear();
    const draftSaved = runtime.saveHeroDraftLocally({
        mode: 'asset',
        status: 'ready',
        assetId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        mediaUrl: 'https://cdn.example.com/videos/ok.mp4',
        videoUrl: 'https://cdn.example.com/videos/ok.mp4',
        mediaKind: 'video',
        title: 'Draft Title',
        creatorTruth: truth,
        heroPresentation: {
            publicTitle: 'Draft Public',
            publicDescription: 'local only',
            publicTheme: '',
            status: 'draft',
            approvedBy: '',
            approvedAt: null,
            visibility: 'draft',
            showIntelligence: true
        }
    });
    assert('draft save ok', Boolean(draftSaved));
    const draftViewer = auth.resolvePublicHeroViewerCopy(draftSaved);
    assert(
        'draft editing still works without server publish',
        draftViewer.isPublished === false &&
            draftViewer.titleSource === 'creatorTruth'
    );

    const draftUi = ui.resolveHeroAuthorityUiState(draftSaved, {
        identity: sessionId
    });
    assert(
        'draft UI not published label',
        draftUi.id === 'draft_editing' && draftUi.canShowPublished === false
    );

    const verifiedUi = ui.resolveHeroAuthorityUiState(granted.record, {
        identity: sessionId
    });
    assert(
        'published_and_verified UI only when granted',
        verifiedUi.id === 'published_and_verified' && verifiedUi.canShowPublished === true
    );

    // srv2 contract shape only
    assert(
        'srv2 shape recognized as signature shape',
        engineMod.isServerSignatureShape(
            'srv2:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
        ) === true
    );
    assert(
        'srv2 not trusted as receipt',
        engineMod.normalizeServerAuthorityReceipt({
            authorityEventId: 'x',
            serverTimestamp: Date.now(),
            serverSignature:
                'srv2:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
            signatureVersion: 'srv2'
        }) === null
    );

    console.log(
        failed === 0
            ? '\n✅ Hero production authority runtime validation PASSED\n'
            : `\n❌ ${failed} assertion(s) failed\n`
    );
    process.exit(failed === 0 ? 0 : 1);
} catch (err) {
    console.error(err);
    process.exit(1);
} finally {
    await vite.close();
}
