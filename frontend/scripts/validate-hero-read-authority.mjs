#!/usr/bin/env node
/**
 * Hero Read Authority Validation (Phase 4)
 *
 * Verification: "Can this state be trusted?"
 * Presentation: only verified published claims reach the public vault.
 *
 * PASS:
 * - valid published hero resolves
 * - valid draft hero stays private
 * - creatorTruth remains immutable
 *
 * FAIL CLOSED:
 * - edited localStorage status
 * - deleted publish event
 * - modified integrity hash
 * - fake approval actor
 * - AI-generated approval attempt
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

console.log('\nHero Read Authority Validation\n');

console.log('[0] Module contracts');
const vSrc = read('src/lib/hero/heroAuthorityVerification.js');
assert('verifyHeroRecordIntegrity', vSrc.includes('export function verifyHeroRecordIntegrity'));
assert('verifyHeroAuditChain', vSrc.includes('export function verifyHeroAuditChain'));
assert('resolveVerifiedHeroRecord', vSrc.includes('export function resolveVerifiedHeroRecord'));
assert('no silent repair comment', vSrc.includes('never silently repair') || vSrc.includes('Do NOT recompute'));

const dSrc = read('src/lib/hero/heroIntegrityDiagnostics.js');
assert('getHeroIntegrityReport', dSrc.includes('getHeroIntegrityReport'));
assert('listIntegrityViolations', dSrc.includes('listIntegrityViolations'));

const recordSrc = read('src/lib/hero/heroRecord.js');
assert('load verifies', recordSrc.includes('verifyHeroRecordIntegrity'));
assert('unverified loader for admin', recordSrc.includes('loadHeroRecordUnverified'));

const authSrc = read('src/lib/hero/heroPresentationAuthority.js');
assert('resolver verifies', authSrc.includes('verifyHeroRecordIntegrity'));

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
    const verify = await vite.ssrLoadModule('/src/lib/hero/heroAuthorityVerification.js');
    const diag = await vite.ssrLoadModule('/src/lib/hero/heroIntegrityDiagnostics.js');
    const auth = await vite.ssrLoadModule('/src/lib/hero/heroPresentationAuthority.js');
    const recordMod = await vite.ssrLoadModule('/src/lib/hero/heroRecord.js');

    const base = {
        mode: 'asset',
        status: 'ready',
        assetId: 'hero-read-1',
        mediaUrl: 'https://cdn.example.com/v.mp4',
        videoUrl: 'https://cdn.example.com/v.mp4',
        mediaKind: 'video',
        title: 'Black Agriculture Legacies',
        heroTitle: 'Black Agriculture Legacies',
        heroDescription: 'Community land stewardship archive.',
        schemaVersion: 1,
        revision: 0,
        updatedAt: Date.now()
    };
    const truth = auth.captureCreatorTruth(base);

    console.log('\n[1] PASS — valid published / draft');
    const drafted = auth.draftHeroPresentation(
        { ...base, creatorTruth: truth },
        {
            publicTitle: 'Harvest Futures',
            publicDescription: 'Public body',
            publicTheme: 'Land',
            sourceType: 'creator',
            actor: 'master_hero_admin',
            actorType: 'admin'
        }
    );
    const published = auth.approveHeroPresentation(
        { ...base, creatorTruth: truth, ...drafted },
        {
            publicTitle: 'Harvest Futures',
            publicDescription: 'Public body',
            publicTheme: 'Land',
            approvedBy: 'master_hero_admin',
            actor: 'master_hero_admin',
            actorType: 'admin',
            sourceType: 'creator',
            publish: true
        }
    );
    assert('approve+publish ok', published.ok === true);

    const engineMod = await vite.ssrLoadModule('/src/lib/hero/heroServerAuthorityEngine.js');
    const pubEvt = (published.recordPatch.auditLog || []).find((e) => e.action === 'published');
    const publishedRecord = engineMod.attachTestServerPublishGrant(
        {
            ...base,
            creatorTruth: truth,
            ...published.recordPatch
        },
        {
            authorityEventId: pubEvt?.eventId || 'haevt-read-test',
            heroId: base.assetId,
            clientIntegrityHash: pubEvt?.integrityHash || 'fnv1a32_test'
        }
    );
    const vPub = verify.verifyHeroRecordIntegrity(publishedRecord);
    assert('valid published verifies', vPub.verified === true);

    const viewer = auth.resolvePublicHeroViewerCopy(publishedRecord);
    assert(
        'valid published hero resolves',
        viewer.isPublished === true &&
            viewer.title === 'Harvest Futures' &&
            viewer.verified === true
    );

    const draftOnly = {
        ...base,
        creatorTruth: truth,
        heroPresentation: drafted.heroPresentation,
        auditLog: drafted.auditLog
    };
    const vDraft = verify.verifyHeroRecordIntegrity(draftOnly);
    assert('valid draft verifies', vDraft.verified === true);
    const viewerDraft = auth.resolvePublicHeroViewerCopy(draftOnly);
    assert(
        'valid draft stays private',
        viewerDraft.isPublished === false &&
            viewerDraft.title === 'Black Agriculture Legacies' &&
            viewerDraft.titleSource === 'creatorTruth'
    );

    // Immutable creatorTruth
    const mutProtect = auth.protectCreatorTruthFromNlp(truth, {
        title: 'NLP Hijack'
    });
    assert('creatorTruth remains immutable', mutProtect.next.title === truth.title);

    console.log('\n[2] FAIL CLOSED — localStorage / audit tampering');
    // Edited status only
    const statusTamper = {
        ...publishedRecord,
        heroPresentation: {
            ...publishedRecord.heroPresentation,
            status: 'published',
            approvedBy: '',
            approvedAt: null
        }
    };
    // Wait - clearer: take published, clear metadata but keep status
    const metaTamper = {
        ...publishedRecord,
        heroPresentation: {
            ...published.recordPatch.heroPresentation,
            approvedBy: '',
            approvedAt: null
        }
    };
    assert(
        'missing approval metadata fails verify',
        verify.verifyHeroRecordIntegrity(metaTamper).verified === false
    );

    // Status edited to published without publish events (draft elevated)
    const statusOnly = {
        ...base,
        creatorTruth: truth,
        heroPresentation: {
            publicTitle: 'Fake Live',
            publicDescription: 'tampered',
            publicTheme: '',
            status: 'published',
            approvedBy: 'someone',
            approvedAt: Date.now(),
            visibility: 'public',
            showIntelligence: true
        },
        auditLog: []
    };
    assert(
        'edited localStorage status fails verify',
        verify.verifyHeroRecordIntegrity(statusOnly).verified === false
    );
    const statusViewer = auth.resolvePublicHeroViewerCopy(statusOnly);
    assert(
        'status-only tamper does not publish',
        statusViewer.isPublished === false &&
            statusViewer.title === 'Black Agriculture Legacies'
    );

    // Deleted publish event
    const log = [...(published.recordPatch.auditLog || [])];
    const withoutPublish = log.filter((e) => e.action !== 'published');
    const deletedPublish = {
        ...publishedRecord,
        auditLog: withoutPublish
    };
    const delResult = verify.verifyHeroRecordIntegrity(deletedPublish);
    assert('deleted publish event fails', delResult.verified === false);
    assert(
        'reason includes publish missing',
        delResult.violations.includes('published_without_publish_event') ||
            delResult.reason.includes('publish')
    );

    // Modified integrity hash
    const hashTamperLog = log.map((e, i) =>
        i === 0 ? { ...e, integrityHash: 'fnv1a32_deadbeef' } : e
    );
    const hashTamper = { ...publishedRecord, auditLog: hashTamperLog };
    assert(
        'modified integrity hash fails',
        verify.verifyHeroRecordIntegrity(hashTamper).verified === false &&
            verify
                .verifyHeroRecordIntegrity(hashTamper)
                .violations.includes('audit_hash_mismatch')
    );

    // Fake approval actor (intelligence)
    const fakeActorLog = log.map((e) =>
        e.action === 'approved'
            ? {
                  ...e,
                  actor: 'nlp-bot',
                  actorType: 'intelligence',
                  sourceType: 'ai',
                  source: 'ai',
                  // Recompute wrong deliberately by leaving old hash
                  integrityHash: e.integrityHash
              }
            : e
    );
    // Need valid hash for actor fields after change — hash mismatch or fake actor both fail
    const fakeWithHash = fakeActorLog.map((e) => {
        if (e.action !== 'approved') return e;
        const fields = {
            eventId: e.eventId,
            heroId: e.heroId,
            action: e.action,
            previousStatus: e.previousStatus,
            newStatus: e.newStatus,
            actor: 'nlp-bot',
            actorType: 'intelligence',
            sourceType: 'ai',
            timestamp: e.timestamp,
            changedFields: e.changedFields || []
        };
        // Use module hash
        return e;
    });
    const auditMod = await vite.ssrLoadModule('/src/lib/hero/heroAuditEvents.js');
    const fakeFixed = fakeActorLog.map((e) => {
        if (e.action !== 'approved') return e;
        const next = {
            ...e,
            actor: 'nlp-bot',
            actorType: 'intelligence',
            sourceType: 'ai',
            source: 'ai'
        };
        next.integrityHash = auditMod.computeHeroAuditIntegrityHash(next);
        return next;
    });
    const fakeResult = verify.verifyHeroRecordIntegrity({
        ...publishedRecord,
        auditLog: fakeFixed
    });
    assert(
        'fake approval actor fails',
        fakeResult.verified === false &&
            (fakeResult.violations.includes('fake_approval_actor') ||
                fakeResult.violations.includes('unauthorized_editorial_source'))
    );

    // AI-generated approval attempt
    const aiApprove = auth.approveHeroPresentation(base, {
        publicTitle: 'AI',
        publicDescription: 'nope',
        sourceType: 'ai',
        approvedBy: 'assistant',
        actorType: 'intelligence'
    });
    assert('AI-generated approval attempt fails', aiApprove.ok === false);

    console.log('\n[3] loadHeroRecord fail-closed surface');
    bag.clear();
    const pubEvtLoad = (published.recordPatch.auditLog || []).find((e) => e.action === 'published');
    recordMod.saveHeroRecord({
        mode: 'asset',
        status: 'ready',
        assetId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        mediaUrl: 'https://cdn.example.com/videos/ok.mp4',
        videoUrl: 'https://cdn.example.com/videos/ok.mp4',
        mediaKind: 'video',
        title: 'Black Agriculture Legacies',
        ...published.recordPatch,
        creatorTruth: truth,
        source: 'validate-hero-read-authority',
        ...engineMod.attachTestServerPublishGrant(
            { ...published.recordPatch, creatorTruth: truth },
            {
                authorityEventId: pubEvtLoad?.eventId || 'haevt-load-ok',
                heroId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                clientIntegrityHash: pubEvtLoad?.integrityHash || 'fnv1a32_test'
            }
        )
    });
    const loadedOk = recordMod.loadHeroRecord();
    assert(
        'load verified published',
        loadedOk.authorityVerified === true &&
            loadedOk.heroPresentation?.status === 'published'
    );

    // Tamper storage directly
    const raw = JSON.parse(bag.get('reelforge_hero_record'));
    raw.heroPresentation.status = 'published';
    raw.auditLog = [];
    bag.set('reelforge_hero_record', JSON.stringify(raw));

    const loadedTamper = recordMod.loadHeroRecord();
    assert(
        'tampered load scrubs public claims',
        loadedTamper.authorityVerified === false &&
            loadedTamper.heroPresentation?.status === 'draft'
    );
    // Storage not silently repaired
    const stillTampered = JSON.parse(bag.get('reelforge_hero_record'));
    assert(
        'storage not silently repaired',
        stillTampered.heroPresentation.status === 'published' &&
            Array.isArray(stillTampered.auditLog) &&
            stillTampered.auditLog.length === 0
    );

    const adminRaw = recordMod.loadHeroRecordUnverified();
    assert(
        'admin unverified still sees tamper',
        adminRaw.heroPresentation?.status === 'published'
    );

    const report = diag.getHeroIntegrityReport(adminRaw);
    assert(
        'diagnostics reports violations',
        report.verified === false && report.violations.length > 0
    );
    assert(
        'listIntegrityViolations works',
        diag.listIntegrityViolations(adminRaw).length > 0
    );

    if (failed) {
        console.error(`\nFAIL validate-hero-read-authority (${failed})`);
        process.exit(1);
    }
    console.log('\nPASS validate-hero-read-authority');
    process.exit(0);
} catch (err) {
    console.error(err);
    process.exit(1);
} finally {
    await vite.close();
}
