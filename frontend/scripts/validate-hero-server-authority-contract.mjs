#!/usr/bin/env node
/**
 * Hero Server Authority Contract Validation (Phase 5)
 *
 * PASS:
 * - contract schema
 * - identity resolver
 * - sync payload creation
 * - backend response validation
 *
 * FAIL:
 * - missing actor
 * - fake approval
 * - unsigned publish response
 * - invalid lifecycle transition
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

console.log('\nHero Server Authority Contract Validation\n');

console.log('[0] Static contracts');
const contractSrc = read('src/lib/hero/heroAuthorityContract.js');
assert('HeroAuthorityEvent schema module', contractSrc.includes('validateHeroAuthorityEvent'));
assert('serverSignature field', contractSrc.includes('serverSignature'));
assert('clientIntegrityHash field', contractSrc.includes('clientIntegrityHash'));

const idSrc = read('src/lib/auth/authorityIdentity.js');
assert('resolveAuthorityIdentity', idSrc.includes('export function resolveAuthorityIdentity'));
assert('dev identity path', idSrc.includes('local_development'));

const syncSrc = read('src/lib/hero/heroAuthoritySync.js');
assert('prepareAuthoritySubmission', syncSrc.includes('prepareAuthoritySubmission'));
assert('validateAuthorityResponse', syncSrc.includes('validateAuthorityResponse'));

const mig = read('src/lib/hero/HERO_AUTHORITY_SERVER_MIGRATION.md');
assert('migration notes exist', mig.includes('Backend module') || mig.includes('Backend responsibilities'));
assert('append-only documented', mig.includes('append only') || mig.includes('append-only'));

const boundarySrc = read('src/lib/hero/heroAuthorityBoundary.js');
assert('boundary uses identity resolver', boundarySrc.includes('resolveAuthorityIdentity'));

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});

try {
    const contract = await vite.ssrLoadModule('/src/lib/hero/heroAuthorityContract.js');
    const identity = await vite.ssrLoadModule('/src/lib/auth/authorityIdentity.js');
    const sync = await vite.ssrLoadModule('/src/lib/hero/heroAuthoritySync.js');
    const boundary = await vite.ssrLoadModule('/src/lib/hero/heroAuthorityBoundary.js');
    const audit = await vite.ssrLoadModule('/src/lib/hero/heroAuditEvents.js');
    const auth = await vite.ssrLoadModule('/src/lib/hero/heroPresentationAuthority.js');

    console.log('\n[1] Contract schema PASS');
    const sampleLocal = audit.createHeroAuditEvent({
        heroId: 'hero-1',
        action: 'approved',
        previousStatus: 'draft',
        newStatus: 'approved',
        actor: 'dev_master_hero_admin',
        actorType: 'admin',
        sourceType: 'creator',
        timestamp: Date.now(),
        changedFields: ['status']
    });
    assert('local audit event created', sampleLocal.ok === true);
    const mapped = contract.toHeroAuthorityContractEvent(sampleLocal.event);
    assert('maps to contract event', mapped.ok === true && mapped.event?.serverSignature === null);
    assert('contract has actorId', Boolean(mapped.event?.actorId));
    assert('contract has clientIntegrityHash', Boolean(mapped.event?.clientIntegrityHash));
    assert(
        'required fields present',
        contract.HERO_AUTHORITY_EVENT_REQUIRED_FIELDS.every((k) =>
            Object.prototype.hasOwnProperty.call(mapped.event, k === 'clientIntegrityHash' ? 'clientIntegrityHash' : k) ||
            k === 'changedFields'
        )
    );

    console.log('\n[2] Identity resolver PASS / FAIL');
    const devId = identity.resolveAuthorityIdentity({ allowDevIdentity: true });
    assert('dev identity authenticated', devId.authenticated === true && Boolean(devId.actorId));
    assert('dev role admin', devId.role === 'admin');
    assert('dev has publish permission', identity.identityHasPermission(devId, 'hero:publish'));

    const sessionId = identity.resolveAuthorityIdentity({
        session: { actorId: 'user-42', role: 'admin', permissions: ['hero:publish'] }
    });
    assert('session identity preferred', sessionId.actorId === 'user-42' && sessionId.source === 'session');

    const prodNone = identity.resolveAuthorityIdentity({ allowDevIdentity: false });
    assert(
        'production without session unauthenticated',
        prodNone.authenticated === false && !prodNone.actorId
    );

    console.log('\n[3] Sync payload creation PASS');
    const base = {
        mode: 'asset',
        status: 'ready',
        assetId: 'hero-contract-1',
        mediaUrl: 'https://cdn.example.com/v.mp4',
        videoUrl: 'https://cdn.example.com/v.mp4',
        mediaKind: 'video',
        title: 'Creator Title',
        schemaVersion: 1,
        revision: 2,
        updatedAt: Date.now()
    };
    const truth = auth.captureCreatorTruth(base);
    const approved = auth.approveHeroPresentation(
        { ...base, creatorTruth: truth },
        {
            publicTitle: 'Public',
            publicDescription: 'Body',
            approvedBy: 'dev_master_hero_admin',
            actor: 'dev_master_hero_admin',
            actorType: 'admin',
            sourceType: 'creator',
            publish: true
        }
    );
    assert('authority path produces events', approved.ok === true);

    const submission = sync.prepareAuthoritySubmission({
        record: { ...base, ...approved.recordPatch, creatorTruth: truth },
        events: approved.recordPatch.auditLog,
        previousStatus: 'draft',
        nextStatus: 'published',
        action: 'published',
        sourceType: 'creator',
        heroPresentation: approved.recordPatch.heroPresentation,
        creatorTruth: truth,
        identity: devId
    });
    assert('prepareAuthoritySubmission ok', submission.ok === true);
    assert('payload has heroRecordRef', Boolean(submission.payload?.heroRecordRef?.heroId));
    assert('payload has lifecycleTransition', submission.payload?.lifecycleTransition?.nextStatus === 'published');
    assert('payload has provenance', submission.payload?.provenance?.actorId === devId.actorId);
    assert(
        'events unsigned on client',
        (submission.payload?.events || []).every((e) => e.serverSignature === null)
    );
    assert('intelligence null on authority payload', submission.payload?.intelligenceContext === null);

    console.log('\n[4] Backend response validation PASS / FAIL');
    const engineMod = await vite.ssrLoadModule('/src/lib/hero/heroServerAuthorityEngine.js');
    const goodSig = engineMod.mintServerSignature(
        engineMod.HERO_AUTHORITY_DEV_SECRET,
        'srv-evt-1',
        'hero-contract-1',
        'published',
        'fnv1a32_test'
    );
    const good = sync.validateAuthorityResponse(
        {
            accepted: true,
            authorityEventId: 'srv-evt-1',
            serverTimestamp: Date.now(),
            serverSignature: goodSig
        },
        { expectedPublish: true }
    );
    assert('signed accepted response ok', good.ok === true);

    const unsigned = sync.validateAuthorityResponse(
        {
            accepted: true,
            authorityEventId: 'srv-evt-2',
            serverTimestamp: Date.now()
            // no signature
        },
        { expectedPublish: true }
    );
    assert(
        'unsigned publish response fails',
        unsigned.ok === false &&
            (unsigned.errors.includes('missing_signature') ||
                unsigned.errors.includes('unsigned_publish_response'))
    );

    const noId = sync.validateAuthorityResponse({
        accepted: true,
        serverTimestamp: Date.now(),
        serverSignature: 'sig'
    });
    assert(
        'accepted without authorityEventId fails',
        noId.ok === false && noId.errors.includes('accepted_without_authority_event_id')
    );

    console.log('\n[5] FAIL paths');
    const missingActorSub = sync.prepareAuthoritySubmission({
        record: base,
        events: approved.recordPatch.auditLog,
        identity: { actorId: '', role: 'unknown', permissions: [], authenticated: false }
    });
    assert(
        'missing actor fails prep',
        missingActorSub.ok === false && missingActorSub.errors.includes('missing_actor')
    );

    const fakeApproval = contract.validateHeroAuthorityEvent({
        eventId: 'e1',
        heroId: 'h1',
        action: 'approved',
        previousStatus: 'draft',
        newStatus: 'approved',
        actorId: 'bot',
        actorRole: 'intelligence',
        sourceType: 'ai',
        timestamp: Date.now(),
        changedFields: [],
        clientIntegrityHash: 'fnv1a32_aaaaaaaa',
        serverSignature: null
    });
    assert(
        'fake approval fails contract',
        fakeApproval.ok === false && fakeApproval.errors.includes('fake_approval')
    );

    const invalidLifecycle = boundary.validateHeroTransition({
        previousStatus: 'draft',
        nextStatus: 'published',
        action: 'published',
        sourceType: 'creator',
        actor: 'dev_master_hero_admin',
        actorType: 'admin',
        approvedBy: 'dev_master_hero_admin',
        approvedAt: Date.now(),
        publicTitle: 'X',
        identity: devId
    });
    assert(
        'invalid lifecycle transition fails',
        invalidLifecycle.ok === false &&
            invalidLifecycle.errors.includes('invalid_lifecycle_transition')
    );

    const unauth = boundary.validateHeroTransition({
        previousStatus: 'approved',
        nextStatus: 'published',
        action: 'published',
        sourceType: 'creator',
        actor: '',
        approvedBy: '',
        approvedAt: Date.now(),
        publicTitle: 'X',
        identity: { actorId: '', role: 'unknown', permissions: [], authenticated: false }
    });
    assert(
        'unauthenticated / missing actor fails closed',
        unauth.ok === false &&
            (unauth.errors.includes('unauthenticated_authority_actor') ||
                unauth.errors.includes('missing_actor'))
    );

    if (failed) {
        console.error(`\nFAIL validate-hero-server-authority-contract (${failed})`);
        process.exit(1);
    }
    console.log('\nPASS validate-hero-server-authority-contract');
    process.exit(0);
} catch (err) {
    console.error(err);
    process.exit(1);
} finally {
    await vite.close();
}
