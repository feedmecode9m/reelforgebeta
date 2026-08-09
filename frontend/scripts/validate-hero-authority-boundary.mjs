#!/usr/bin/env node
/**
 * Hero Authority Boundary Validation (Phase 3)
 *
 * PASS:
 * - lifecycle transitions
 * - unauthorized publish rejection
 * - AI/NLP rejection
 * - immutable creatorTruth
 * - audit integrity
 * - missing actor rejection
 * - missing approval rejection
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

console.log('\nHero Authority Boundary Validation\n');

console.log('[0] Module contracts');
const boundarySrc = read('src/lib/hero/heroAuthorityBoundary.js');
assert('validateHeroTransition exported', boundarySrc.includes('export function validateHeroTransition'));
assert('fail-closed unknown source', boundarySrc.includes('never elevates') || boundarySrc.includes('SYSTEM'));
assert('lifecycle graph present', boundarySrc.includes('HERO_LIFECYCLE_TRANSITIONS'));

const syncSrc = read('src/lib/hero/heroAuthoritySync.js');
assert('serializeHeroAuthorityEvent', syncSrc.includes('serializeHeroAuthorityEvent'));
assert('createPendingAuthoritySync', syncSrc.includes('createPendingAuthoritySync'));
assert('validateServerAuthorityResponse', syncSrc.includes('validateServerAuthorityResponse'));

const auditSrc = read('src/lib/hero/heroAuditEvents.js');
assert('integrityHash support', auditSrc.includes('integrityHash'));
assert('actorType field', auditSrc.includes('actorType'));
assert('sourceType field', auditSrc.includes('sourceType'));

const authSrc = read('src/lib/hero/heroPresentationAuthority.js');
assert('authority uses validateHeroTransition', authSrc.includes('validateHeroTransition'));
assert('no unchecked default to creator on omit', authSrc.includes('normalizeHeroAuthoritySourceType'));

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
    const boundary = await vite.ssrLoadModule('/src/lib/hero/heroAuthorityBoundary.js');
    const audit = await vite.ssrLoadModule('/src/lib/hero/heroAuditEvents.js');
    const auth = await vite.ssrLoadModule('/src/lib/hero/heroPresentationAuthority.js');
    const sync = await vite.ssrLoadModule('/src/lib/hero/heroAuthoritySync.js');
    const recordMod = await vite.ssrLoadModule('/src/lib/hero/heroRecord.js');

    console.log('\n[1] Lifecycle transitions PASS');
    const okReview = boundary.validateHeroTransition({
        previousStatus: 'draft',
        nextStatus: 'review',
        action: 'submitted_for_review',
        sourceType: 'creator',
        actor: 'master_hero_admin',
        actorType: 'admin'
    });
    assert('draft → review', okReview.ok === true);

    const okApprove = boundary.validateHeroTransition({
        previousStatus: 'review',
        nextStatus: 'approved',
        action: 'approved',
        sourceType: 'creator',
        actor: 'master_hero_admin',
        actorType: 'admin',
        approvedBy: 'master_hero_admin',
        approvedAt: Date.now(),
        publicTitle: 'Title',
        publicDescription: 'Desc'
    });
    assert('review → approved', okApprove.ok === true);

    const okPublish = boundary.validateHeroTransition({
        previousStatus: 'approved',
        nextStatus: 'published',
        action: 'published',
        sourceType: 'creator',
        actor: 'master_hero_admin',
        actorType: 'admin',
        approvedBy: 'master_hero_admin',
        approvedAt: Date.now(),
        publicTitle: 'Title',
        publicDescription: 'Desc'
    });
    assert('approved → published', okPublish.ok === true);

    const okArchive = boundary.validateHeroTransition({
        previousStatus: 'published',
        nextStatus: 'archived',
        action: 'archived',
        sourceType: 'admin',
        actor: 'master_hero_admin',
        actorType: 'admin'
    });
    assert('published → archived', okArchive.ok === true);

    const badJump = boundary.validateHeroTransition({
        previousStatus: 'draft',
        nextStatus: 'published',
        action: 'published',
        sourceType: 'creator',
        actor: 'admin',
        actorType: 'admin',
        approvedBy: 'admin',
        approvedAt: Date.now(),
        publicTitle: 'X'
    });
    assert('draft → published direct rejected', badJump.ok === false);

    console.log('\n[2] Unauthorized / AI / missing metadata FAIL');
    const unknownSrc = boundary.normalizeHeroAuthoritySourceType('');
    assert('unknown sourceType → system', unknownSrc === 'system');
    assert(
        'unknown is not creator',
        boundary.normalizeHeroAuthoritySourceType('weird_token') === 'system'
    );

    const ai = boundary.validateHeroTransition({
        previousStatus: 'draft',
        nextStatus: 'approved',
        action: 'approved',
        sourceType: 'ai',
        actor: 'bot',
        actorType: 'intelligence',
        approvedBy: 'bot',
        approvedAt: Date.now(),
        publicTitle: 'AI'
    });
    assert('AI/NLP rejection', ai.ok === false);

    const nlp = boundary.validateHeroTransition({
        previousStatus: 'approved',
        nextStatus: 'published',
        action: 'published',
        sourceType: 'nlp',
        actor: 'nlp',
        actorType: 'intelligence',
        approvedBy: 'nlp',
        approvedAt: Date.now(),
        publicTitle: 'N'
    });
    assert('NLP publish rejection', nlp.ok === false);

    const disc = boundary.validateHeroTransition({
        previousStatus: 'approved',
        nextStatus: 'published',
        action: 'published',
        sourceType: 'discovery',
        actor: 'ranker',
        actorType: 'system',
        approvedBy: 'ranker',
        approvedAt: Date.now(),
        publicTitle: 'D'
    });
    assert('unauthorized publish rejection', disc.ok === false);

    const noActor = boundary.validateHeroTransition({
        previousStatus: 'approved',
        nextStatus: 'published',
        action: 'published',
        sourceType: 'creator',
        actor: '',
        actorType: 'admin',
        approvedBy: '',
        approvedAt: Date.now(),
        publicTitle: 'T',
        identity: { actorId: '', role: 'unknown', permissions: [], authenticated: false }
    });
    assert(
        'missing actor rejection',
        noActor.ok === false &&
            (noActor.errors.includes('missing_actor') ||
                noActor.errors.includes('unauthenticated_authority_actor'))
    );

    const noApproval = boundary.validateHeroTransition({
        previousStatus: 'approved',
        nextStatus: 'published',
        action: 'published',
        sourceType: 'creator',
        actor: 'admin',
        actorType: 'admin',
        approvedBy: '',
        approvedAt: null,
        publicTitle: 'T'
    });
    assert(
        'missing approval rejection',
        noApproval.ok === false && noApproval.errors.includes('missing_approval_metadata')
    );

    console.log('\n[3] Immutable creatorTruth');
    const mut = boundary.validateHeroTransition({
        previousStatus: 'draft',
        nextStatus: 'approved',
        action: 'approved',
        sourceType: 'creator',
        actor: 'admin',
        actorType: 'admin',
        approvedBy: 'admin',
        approvedAt: Date.now(),
        publicTitle: 'Ok',
        creatorTruthBefore: { title: 'Real Creator', immutable: true },
        creatorTruthAfter: { title: 'Hijacked NLP', immutable: true }
    });
    assert(
        'creatorTruth mutation rejected',
        mut.ok === false && mut.errors.includes('creator_truth_mutation_attempt')
    );

    console.log('\n[4] Audit integrity + authority path');
    const base = {
        mode: 'asset',
        status: 'ready',
        assetId: 'hero-boundary-1',
        mediaUrl: 'https://cdn.example.com/v.mp4',
        videoUrl: 'https://cdn.example.com/v.mp4',
        mediaKind: 'video',
        title: 'Creator Title',
        heroTitle: 'Creator Title',
        heroDescription: 'Creator desc',
        schemaVersion: 1,
        revision: 0,
        updatedAt: Date.now()
    };
    const truth = auth.captureCreatorTruth(base);

    const drafted = auth.draftHeroPresentation(
        { ...base, creatorTruth: truth },
        {
            publicTitle: 'Presentation',
            publicDescription: 'Public body',
            publicTheme: 'Theme',
            sourceType: 'creator',
            actor: 'master_hero_admin',
            actorType: 'admin'
        }
    );
    assert('draft via authority ok', drafted.ok !== false);

    const approved = auth.approveHeroPresentation(
        { ...base, creatorTruth: truth, ...drafted },
        {
            publicTitle: 'Presentation',
            publicDescription: 'Public body',
            publicTheme: 'Theme',
            approvedBy: 'master_hero_admin',
            actor: 'master_hero_admin',
            actorType: 'admin',
            sourceType: 'creator',
            publish: true
        }
    );
    assert('approve+publish ok', approved.ok === true);
    const log = audit.normalizeHeroAuditLog(approved.recordPatch?.auditLog);
    assert(
        'audit has approved+published',
        log.some((e) => e.action === 'approved') && log.some((e) => e.action === 'published')
    );
    assert(
        'events have integrityHash',
        log.every((e) => e.integrityHash && e.integrityHash.startsWith('fnv1a32_'))
    );
    assert(
        'events have actorType + sourceType',
        log.every((e) => e.actorType && e.sourceType)
    );
    assert(
        'hashes verify',
        log.every((e) => audit.verifyHeroAuditIntegrityHash(e))
    );

    const missingPublishAudit = audit.auditPublicHeroTransitionIntegrity({
        heroPresentation: { status: 'published', publicTitle: 'X', approvedBy: 'a', approvedAt: 1 },
        auditLog: []
    });
    assert('published without audit fails', missingPublishAudit.ok === false);

    const aiApprove = auth.approveHeroPresentation(base, {
        publicTitle: 'Nope',
        publicDescription: 'ai',
        sourceType: 'ai',
        approvedBy: 'assistant',
        actorType: 'intelligence'
    });
    assert('AI approve rejected by authority path', aiApprove.ok === false);

    const noSrcApprove = auth.approveHeroPresentation(base, {
        publicTitle: 'Missing src',
        publicDescription: 'body',
        // omit sourceType → system
        approvedBy: 'admin',
        actorType: 'admin'
    });
    assert('omitted sourceType cannot approve', noSrcApprove.ok === false);

    console.log('\n[5] Server handoff prep');
    const engineMod = await vite.ssrLoadModule('/src/lib/hero/heroServerAuthorityEngine.js');
    const pending = sync.createPendingAuthoritySync({
        record: { ...base, ...approved.recordPatch },
        events: log,
        heroPresentation: approved.recordPatch.heroPresentation,
        creatorTruth: truth,
        lifecycleStatus: 'published'
    });
    assert('pending sync created', pending.status === 'pending' && pending.payload.events.length > 0);
    assert('sync excludes intelligence authority', pending.payload.intelligenceContext === null);

    const pubEvtBoundary = log.find((e) => e.action === 'published');
    const goodSig = engineMod.mintServerSignature(
        engineMod.HERO_AUTHORITY_DEV_SECRET,
        'legacy-compat-1',
        base.assetId || 'hero',
        'published',
        pubEvtBoundary?.integrityHash || 'fnv1a32_test'
    );
    const serverOk = sync.validateServerAuthorityResponse({
        ok: true,
        accepted: true,
        authorityEventId: 'legacy-compat-1',
        acceptedEventIds: log.map((e) => e.eventId),
        serverTimestamp: Date.now(),
        serverSignature: goodSig,
        signatureVersion: 'srv1'
    });
    assert('server accept envelope ok', serverOk.ok === true);

    const serverBad = sync.validateServerAuthorityResponse({
        ok: true,
        accepted: true,
        authorityEventId: 'x',
        acceptedEventIds: log.map((e) => e.eventId),
        serverTimestamp: Date.now(),
        serverSignature: goodSig,
        promoteIntelligence: true
    });
    assert('server cannot promote intelligence', serverBad.ok === false);

    console.log('\n[6] Persistence through saveHeroRecord');
    bag.clear();
    const grantedPublished = engineMod.attachTestServerPublishGrant(
        {
            mode: 'asset',
            status: 'ready',
            assetId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            mediaUrl: 'https://cdn.example.com/videos/ok.mp4',
            videoUrl: 'https://cdn.example.com/videos/ok.mp4',
            mediaKind: 'video',
            title: 'Creator Title',
            ...approved.recordPatch
        },
        {
            authorityEventId: pubEvtBoundary?.eventId || 'haevt-boundary',
            heroId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            clientIntegrityHash: pubEvtBoundary?.integrityHash || 'fnv1a32_test'
        }
    );
    const saved = recordMod.saveHeroRecord({
        ...grantedPublished,
        source: 'validate-hero-authority-boundary'
    });
    assert('save ok', Boolean(saved));
    const loaded = recordMod.loadHeroRecord();
    assert(
        'persisted authority audit',
        loaded?.heroPresentation?.status === 'published' &&
            loaded?.authorityVerified === true &&
            (loaded?.auditLog || []).some((e) => e.action === 'published')
    );

    if (failed) {
        console.error(`\nFAIL validate-hero-authority-boundary (${failed})`);
        process.exit(1);
    }
    console.log('\nPASS validate-hero-authority-boundary');
    process.exit(0);
} catch (err) {
    console.error(err);
    process.exit(1);
} finally {
    await vite.close();
}
