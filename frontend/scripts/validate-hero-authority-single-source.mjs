#!/usr/bin/env node
/**
 * Hero Authority Single Source of Truth (Phase 7)
 *
 * PASS:
 * - server receipt required
 * - local publish without receipt rejected
 * - server event ordering enforced
 * - client cannot downgrade/upgrade lifecycle independently
 * - public resolver ignores unverified states
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

console.log('\nHero Authority Single Source of Truth (Phase 7)\n');

console.log('[0] Static contracts');
const rehydrateSrc = read('src/lib/hero/heroAuthorityRehydration.js');
assert('fetchHeroAuthorityEvents', rehydrateSrc.includes('fetchHeroAuthorityEvents'));
assert('requestHeroAuthorityPublish', rehydrateSrc.includes('requestHeroAuthorityPublish'));
assert('applyHeroAuthorityRehydration', rehydrateSrc.includes('applyHeroAuthorityRehydration'));

const engineSrc = read('src/lib/hero/heroServerAuthorityEngine.js');
assert('signatureVersion srv1', engineSrc.includes('SIGNATURE_VERSION_SRV1'));
assert('srv2 prepared', engineSrc.includes('SIGNATURE_VERSION_SRV2'));
assert('isServerGrantedPublished', engineSrc.includes('isServerGrantedPublished'));

const verifySrc = read('src/lib/hero/heroAuthorityVerification.js');
assert('local_only_published rejection', verifySrc.includes('local_only_published'));
assert('server_authority_state', verifySrc.includes('server_authority_state') || verifySrc.includes('missing_server_authority_state'));

const managerSrc = read('src/components/studio/HeroManagerPanel.svelte');
assert(
    'manager uses authenticated/server-first publish',
    managerSrc.includes('requestAuthenticatedHeroPublish') ||
        managerSrc.includes('requestHeroAuthorityPublish')
);
assert('no optimistic copy', managerSrc.includes('server grants') || managerSrc.includes('Requesting server'));

const backend = fs.readFileSync(
    path.join(root, '..', 'backend/src/api/hero_authority.rs'),
    'utf8'
);
assert('GET by heroId path handler', backend.includes('get_authority_events_for_hero'));
assert('signature version field', backend.includes('SIGNATURE_VERSION_SRV1'));
assert('verify before trust', backend.includes('verify_server_signature'));

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
    const engineMod = await vite.ssrLoadModule('/src/lib/hero/heroServerAuthorityEngine.js');
    const rehydrate = await vite.ssrLoadModule('/src/lib/hero/heroAuthorityRehydration.js');
    const verify = await vite.ssrLoadModule('/src/lib/hero/heroAuthorityVerification.js');
    const auth = await vite.ssrLoadModule('/src/lib/hero/heroPresentationAuthority.js');
    const identity = await vite.ssrLoadModule('/src/lib/auth/authorityIdentity.js');

    const engine = engineMod.createInMemoryHeroAuthorityEngine();
    const id = identity.resolveAuthorityIdentity({});

    const base = {
        mode: 'asset',
        status: 'ready',
        assetId: 'hero-sot-1',
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

    console.log('\n[1] PASS — server receipt required + server-first publish');
    const granted = await rehydrate.requestHeroAuthorityPublish(
        { ...base, creatorTruth: truth },
        {
            publicTitle: 'Vault Title',
            publicDescription: 'Vault body',
            publicTheme: 'Land',
            actor: id.actorId,
            actorType: 'admin',
            sourceType: 'creator',
            engine
        }
    );
    assert('server-first publish ok', granted.ok === true && granted.published === true);
    assert('server receipt required present', Boolean(granted.record?.serverAuthorityReceipt));
    assert(
        'serverAuthorityState verified published',
        granted.record?.serverAuthorityState?.status === 'published' &&
            granted.record?.serverAuthorityState?.verified === true
    );
    assert(
        'signatureVersion srv1',
        granted.record?.serverAuthorityReceipt?.signatureVersion === 'srv1'
    );

    const vOk = verify.verifyHeroRecordIntegrity(granted.record);
    assert('published with server grant verifies', vOk.verified === true);

    const viewer = auth.resolvePublicHeroViewerCopy(granted.record);
    assert(
        'public shows vault title',
        viewer.isPublished === true && viewer.title === 'Vault Title'
    );

    console.log('\n[2] FAIL — local publish without receipt rejected');
    const localOnly = auth.approveHeroPresentation(
        { ...base, creatorTruth: truth },
        {
            publicTitle: 'Local Leak',
            publicDescription: 'should not publish',
            publicTheme: 'X',
            approvedBy: id.actorId,
            actor: id.actorId,
            actorType: 'admin',
            sourceType: 'creator',
            publish: true
        }
    );
    assert('local prepare ok', localOnly.ok === true);
    const localRecord = {
        ...base,
        creatorTruth: truth,
        ...localOnly.recordPatch
    };
    assert(
        'local publish without receipt rejected',
        verify.verifyHeroRecordIntegrity(localRecord).verified === false
    );
    assert(
        'violations include local_only_published or missing receipt',
        verify
            .verifyHeroRecordIntegrity(localRecord)
            .violations.some((v) =>
                ['local_only_published', 'missing_server_authority_receipt', 'server_not_granted_published'].includes(
                    v
                )
            )
    );
    const localViewer = auth.resolvePublicHeroViewerCopy(localRecord);
    assert(
        'public resolver ignores local-only published',
        localViewer.isPublished === false &&
            localViewer.titleSource === 'creatorTruth' &&
            localViewer.title === 'Creator Title'
    );

    console.log('\n[3] Server event ordering enforced');
    const ordered = engineMod.validateServerEventOrdering([
        {
            previousStatus: 'draft',
            newStatus: 'review',
            serverTimestamp: 100,
            verified: true
        },
        {
            previousStatus: 'review',
            newStatus: 'approved',
            serverTimestamp: 200,
            verified: true
        },
        {
            previousStatus: 'approved',
            newStatus: 'published',
            serverTimestamp: 300,
            verified: true
        }
    ]);
    assert('ordered chain ok', ordered.ok === true && ordered.terminalStatus === 'published');

    const disordered = engineMod.validateServerEventOrdering([
        { previousStatus: 'draft', newStatus: 'review', serverTimestamp: 300, verified: true },
        { previousStatus: 'review', newStatus: 'approved', serverTimestamp: 100, verified: true }
    ]);
    assert(
        'disordered events fail',
        disordered.ok === false && disordered.errors.includes('server_event_order_invalid')
    );

    const chainBreak = engineMod.validateServerEventOrdering([
        { previousStatus: 'draft', newStatus: 'review', serverTimestamp: 100, verified: true },
        {
            previousStatus: 'approved',
            newStatus: 'published',
            serverTimestamp: 200,
            verified: true
        }
    ]);
    assert('lifecycle chain break fails', chainBreak.ok === false);

    console.log('\n[4] Client cannot upgrade/downgrade independently');
    // Upgrade: force published status without grant
    const upgraded = {
        ...granted.record,
        heroPresentation: {
            ...granted.record.heroPresentation,
            status: 'published'
        },
        serverAuthorityReceipt: null,
        serverAuthorityState: null
    };
    assert(
        'client upgrade without server rejected',
        verify.verifyHeroRecordIntegrity(upgraded).verified === false
    );
    assert(
        'public ignores upgraded state',
        auth.resolvePublicHeroViewerCopy(upgraded).isPublished === false
    );

    // Downgrade: wipe local status while server grant says published — public uses grant + verify
    const downgraded = {
        ...granted.record,
        heroPresentation: {
            ...granted.record.heroPresentation,
            status: 'draft'
        }
    };
    // Not published presentation → public creatorTruth; verification may still pass if not claiming published
    const downViewer = auth.resolvePublicHeroViewerCopy(downgraded);
    assert(
        'client downgrade cannot show presentation as published',
        downViewer.isPublished === false
    );

    // Tamper: change local status to archived while keeping fake grant mismatch
    const mismatched = {
        ...granted.record,
        serverAuthorityState: {
            ...granted.record.serverAuthorityState,
            status: 'archived'
        }
    };
    assert(
        'state/status mismatch fails grant',
        engineMod.isServerGrantedPublished(mismatched) === false
    );

    console.log('\n[5] Rehydration from server history');
    const hist = engine.rehydrate(base.assetId);
    assert('rehydrate returns events', Array.isArray(hist.events) && hist.events.length >= 1);
    const localThenHydrate = {
        ...base,
        creatorTruth: truth,
        heroPresentation: {
            publicTitle: 'Stale Local',
            publicDescription: '',
            publicTheme: '',
            status: 'published',
            approvedBy: id.actorId,
            approvedAt: Date.now(),
            visibility: 'public',
            showIntelligence: true
        },
        auditLog: localOnly.recordPatch.auditLog,
        serverAuthorityReceipt: null,
        serverAuthorityState: null
    };
    // Without grant local publish fails public.
    assert(
        'stale local published not public pre-hydrate',
        auth.resolvePublicHeroViewerCopy(localThenHydrate).isPublished === false
    );

    const applied = rehydrate.applyHeroAuthorityRehydration(granted.record, hist);
    assert('rehydration apply ok', applied.ok === true);
    assert('rehydrated still granted published', applied.isPublished === true);

    console.log(
        failed === 0
            ? '\n✅ Hero authority single-source validation PASSED\n'
            : `\n❌ ${failed} assertion(s) failed\n`
    );
    process.exit(failed === 0 ? 0 : 1);
} catch (err) {
    console.error(err);
    process.exit(1);
} finally {
    await vite.close();
}
