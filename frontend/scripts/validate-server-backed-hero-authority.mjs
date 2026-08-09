#!/usr/bin/env node
/**
 * Server-backed Hero Authority Validation (Phase 6)
 *
 * PASS:
 * - valid server receipt
 * - signed publish event
 * - approved → published flow
 *
 * FAIL:
 * - fake server signature
 * - missing receipt
 * - unsigned publish
 * - invalid actor
 * - duplicate authority event
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

console.log('\nServer-Backed Hero Authority Validation (Phase 6)\n');

console.log('[0] Static contracts');
const syncSrc = read('src/lib/hero/heroAuthoritySync.js');
assert('submitAuthorityEvent', syncSrc.includes('export async function submitAuthorityEvent'));
assert('applyServerAuthorityReceipt', syncSrc.includes('applyServerAuthorityReceipt'));
assert('buildAuthorityEventRequestBody', syncSrc.includes('buildAuthorityEventRequestBody'));

const engineSrc = read('src/lib/hero/heroServerAuthorityEngine.js');
assert('mintServerSignature', engineSrc.includes('export function mintServerSignature'));
assert('createInMemoryHeroAuthorityEngine', engineSrc.includes('createInMemoryHeroAuthorityEngine'));

const verifySrc = read('src/lib/hero/heroAuthorityVerification.js');
assert(
    'published requires server receipt',
    verifySrc.includes('missing_server_authority_receipt') &&
        verifySrc.includes('hasValidServerAuthorityReceipt')
);

const mig = read('src/lib/hero/HERO_AUTHORITY_SERVER_MIGRATION.md');
assert('frontend requests publication', /requests publication/i.test(mig));
assert('backend grants publication', /grants publication/i.test(mig));
assert('viewer verified only', /verified publication/i.test(mig));

const backendApi = fs.readFileSync(
    path.join(root, '..', 'backend/src/api/hero_authority.rs'),
    'utf8'
);
assert('backend hero_authority module', backendApi.includes('post_authority_event'));
assert('backend HeroAuthorityEvent store', backendApi.includes('hero_authority_events'));
assert(
    'backend rejects duplicate',
    backendApi.includes('duplicate_authority_event')
);

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
    const sync = await vite.ssrLoadModule('/src/lib/hero/heroAuthoritySync.js');
    const engineMod = await vite.ssrLoadModule('/src/lib/hero/heroServerAuthorityEngine.js');
    const auth = await vite.ssrLoadModule('/src/lib/hero/heroPresentationAuthority.js');
    const verify = await vite.ssrLoadModule('/src/lib/hero/heroAuthorityVerification.js');
    const identity = await vite.ssrLoadModule('/src/lib/auth/authorityIdentity.js');

    const engine = engineMod.createInMemoryHeroAuthorityEngine();
    const base = {
        mode: 'asset',
        status: 'ready',
        assetId: 'hero-server-auth-1',
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
    const id = identity.resolveAuthorityIdentity({});

    console.log('\n[1] PASS — review → approved → published + signed receipt');
    const reviewed = auth.submitHeroPresentationForReview(
        { ...base, creatorTruth: truth },
        {
            publicTitle: 'Vault Title',
            publicDescription: 'Vault body',
            publicTheme: 'Land',
            actor: id.actorId,
            actorType: 'admin',
            sourceType: 'creator'
        }
    );
    assert('submit for review ok', reviewed.ok === true);

    const approved = auth.approveHeroPresentation(
        {
            ...base,
            creatorTruth: truth,
            heroPresentation: reviewed.recordPatch?.heroPresentation || reviewed.heroPresentation,
            auditLog: reviewed.recordPatch?.auditLog || reviewed.auditLog
        },
        {
            publicTitle: 'Vault Title',
            publicDescription: 'Vault body',
            publicTheme: 'Land',
            approvedBy: id.actorId,
            actor: id.actorId,
            actorType: 'admin',
            sourceType: 'creator',
            publish: false
        }
    );
    assert('approve from review ok', approved.ok === true);

    const published = auth.publishHeroPresentation(
        {
            ...base,
            creatorTruth: truth,
            ...approved.recordPatch
        },
        {
            actor: id.actorId,
            actorType: 'admin',
            sourceType: 'creator',
            approvedBy: id.actorId
        }
    );
    assert('publish ok', published.ok === true);

    let record = {
        ...base,
        creatorTruth: truth,
        ...published.recordPatch
    };

    // Server grants approve then publish (sequence on engine)
    const approveEvt = (record.auditLog || []).find((e) => e.action === 'approved');
    const publishEvt = (record.auditLog || []).find((e) => e.action === 'published');
    assert('client publish event present', Boolean(publishEvt && approveEvt));

    const approveSubmit = await sync.submitAuthorityEvent(
        {
            eventId: approveEvt.eventId,
            heroId: base.assetId,
            action: 'approved',
            previousStatus: 'review',
            newStatus: 'approved',
            actorId: id.actorId,
            actorRole: 'admin',
            sourceType: 'creator',
            changedFields: approveEvt.changedFields || ['status'],
            clientIntegrityHash: approveEvt.integrityHash
        },
        { engine, record }
    );
    assert('server accepts approve', approveSubmit.ok === true);

    const publishSubmit = await sync.submitAuthorityEvent(
        {
            eventId: publishEvt.eventId,
            heroId: base.assetId,
            action: 'published',
            previousStatus: 'approved',
            newStatus: 'published',
            actorId: id.actorId,
            actorRole: 'admin',
            sourceType: 'creator',
            changedFields: ['status'],
            clientIntegrityHash: publishEvt.integrityHash
        },
        { engine, record, expectedPublish: true }
    );
    assert('signed publish event accepted', publishSubmit.ok === true);
    assert(
        'valid server receipt',
        Boolean(publishSubmit.receipt?.serverSignature?.startsWith('srv1:'))
    );
    record = publishSubmit.record;

    const vOk = verify.verifyHeroRecordIntegrity(record);
    assert('published + receipt verifies', vOk.verified === true);

    const viewer = auth.resolvePublicHeroViewerCopy(record);
    assert(
        'public shows published presentation',
        viewer.isPublished === true && viewer.title === 'Vault Title'
    );

    console.log('\n[2] FAIL — fake signature / missing receipt / unsigned / invalid actor / dup');
    const missingReceipt = { ...record, serverAuthorityReceipt: null };
    const vMissing = verify.verifyHeroRecordIntegrity(missingReceipt);
    assert(
        'missing receipt fails',
        vMissing.verified === false &&
            vMissing.violations.includes('missing_server_authority_receipt')
    );
    const viewerMissing = auth.resolvePublicHeroViewerCopy(missingReceipt);
    assert(
        'missing receipt → creatorTruth only',
        viewerMissing.isPublished === false &&
            viewerMissing.titleSource === 'creatorTruth' &&
            viewerMissing.title === 'Creator Title'
    );

    const fakeReceipt = {
        ...record,
        serverAuthorityReceipt: {
            authorityEventId: 'fake',
            serverTimestamp: Date.now(),
            serverSignature: 'fake-not-a-signature'
        }
    };
    assert(
        'fake server signature fails',
        verify.verifyHeroRecordIntegrity(fakeReceipt).verified === false
    );

    const unsigned = {
        ...record,
        serverAuthorityReceipt: {
            authorityEventId: 'x',
            serverTimestamp: Date.now(),
            serverSignature: ''
        }
    };
    assert(
        'unsigned publish fails',
        verify.verifyHeroRecordIntegrity(unsigned).verified === false
    );

    const badActor = await sync.submitAuthorityEvent(
        {
            eventId: `bad-actor-${Date.now()}`,
            heroId: base.assetId,
            action: 'published',
            previousStatus: 'approved',
            newStatus: 'published',
            actorId: '',
            actorRole: 'admin',
            sourceType: 'creator',
            changedFields: ['status'],
            clientIntegrityHash: publishEvt.integrityHash
        },
        { engine }
    );
    assert(
        'invalid actor rejected',
        badActor.ok === false &&
            (badActor.reason === 'unauthenticated_actor' ||
                badActor.errors.includes('unauthenticated_actor') ||
                badActor.errors.some((e) => String(e).includes('unauthenticated')))
    );

    const aiActor = await sync.submitAuthorityEvent(
        {
            eventId: `ai-${Date.now()}`,
            heroId: base.assetId,
            action: 'published',
            previousStatus: 'approved',
            newStatus: 'published',
            actorId: 'nlp-bot',
            actorRole: 'intelligence',
            sourceType: 'ai',
            changedFields: ['status'],
            clientIntegrityHash: publishEvt.integrityHash
        },
        { engine }
    );
    assert('AI editorial rejected', aiActor.ok === false);

    const dup = await sync.submitAuthorityEvent(
        {
            eventId: publishEvt.eventId,
            heroId: base.assetId,
            action: 'published',
            previousStatus: 'approved',
            newStatus: 'published',
            actorId: id.actorId,
            actorRole: 'admin',
            sourceType: 'creator',
            changedFields: ['status'],
            clientIntegrityHash: publishEvt.integrityHash
        },
        { engine }
    );
    assert(
        'duplicate authority event rejected',
        dup.ok === false &&
            (dup.reason === 'duplicate_authority_event' ||
                dup.errors.includes('duplicate_authority_event'))
    );

    const draftApprove = await sync.submitAuthorityEvent(
        {
            eventId: `draft-approve-${Date.now()}`,
            heroId: base.assetId,
            action: 'approved',
            previousStatus: 'draft',
            newStatus: 'approved',
            actorId: id.actorId,
            actorRole: 'admin',
            sourceType: 'creator',
            changedFields: ['status'],
            clientIntegrityHash: approveEvt.integrityHash
        },
        { engine }
    );
    assert(
        'approval without review rejected',
        draftApprove.ok === false &&
            (draftApprove.reason === 'approval_without_review_state' ||
                draftApprove.errors.includes('approval_without_review_state'))
    );

    console.log('\n[3] Contract helpers');
    const prepared = sync.prepareAuthoritySubmission({
        record,
        events: [publishEvt],
        previousStatus: 'approved',
        nextStatus: 'published',
        action: 'published',
        sourceType: 'creator',
        identity: id
    });
    assert('prepareAuthoritySubmission ok', prepared.ok === true);
    const flat = sync.buildAuthorityEventRequestBody(prepared.payload);
    assert('flattens wire body', flat?.action === 'published' && Boolean(flat.clientIntegrityHash));

    console.log(
        failed === 0
            ? '\n✅ Server-backed hero authority validation PASSED\n'
            : `\n❌ ${failed} assertion(s) failed\n`
    );
    process.exit(failed === 0 ? 0 : 1);
} catch (err) {
    console.error(err);
    process.exit(1);
} finally {
    await vite.close();
}
