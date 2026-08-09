#!/usr/bin/env node
/**
 * Hero Audit Integrity Validation
 *
 * Immutable, append-only editorial audit trail for Hero Vault decisions.
 *
 * PASS:
 * - lifecycle actions generate audit events
 * - approval has actor + timestamp
 * - publish has actor + timestamp
 * - archive has actor + timestamp
 * - AI/discovery cannot create editorial events
 * - audit history remains append-only
 *
 * FAIL:
 * - missing event for state transition
 * - missing actor
 * - missing timestamp
 * - unauthorized source publishing
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

console.log('\nHero Audit Integrity Validation\n');

console.log('[0] Static contracts');
const auditSrc = read('src/lib/hero/heroAuditEvents.js');
assert('audit module exists', auditSrc.includes('createHeroAuditEvent'));
assert('append-only merge', auditSrc.includes('appendHeroAuditEvents'));
assert('actions include approved', auditSrc.includes("'approved'"));
assert('actions include published', auditSrc.includes("'published'"));
assert('actions include archived', auditSrc.includes("'archived'"));

const authoritySrc = read('src/lib/hero/heroPresentationAuthority.js');
assert('authority imports audit layer', authoritySrc.includes('heroAuditEvents'));
assert('approve writes auditLog', authoritySrc.includes('auditLog'));
assert('publish writes audit', authoritySrc.includes('HERO_AUDIT_ACTIONS.PUBLISHED'));
assert('archive writes audit', authoritySrc.includes('HERO_AUDIT_ACTIONS.ARCHIVED'));

const recordSrc = read('src/lib/hero/heroRecord.js');
assert('HeroRecord persists auditLog', recordSrc.includes('auditLog'));
assert('HeroRecord append-only merge', recordSrc.includes('mergeHeroAuditLogForPersistence'));

const managerSrc = read('src/components/studio/HeroManagerPanel.svelte');
assert('Manager approve uses authority', managerSrc.includes('approveHeroPresentation'));
assert('Manager draft uses authority', managerSrc.includes('draftHeroPresentation'));

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
    const audit = await vite.ssrLoadModule('/src/lib/hero/heroAuditEvents.js');
    const auth = await vite.ssrLoadModule('/src/lib/hero/heroPresentationAuthority.js');
    const recordMod = await vite.ssrLoadModule('/src/lib/hero/heroRecord.js');

    const baseRecord = {
        mode: 'asset',
        status: 'ready',
        assetId: 'hero-audit-asset-1',
        mediaUrl: 'https://cdn.example.com/videos/h.mp4',
        videoUrl: 'https://cdn.example.com/videos/h.mp4',
        posterUrl: '',
        mediaKind: 'video',
        fileName: 'h.mp4',
        title: 'Black Agriculture Legacies',
        heroTitle: 'Black Agriculture Legacies',
        heroDescription: 'Community land stewardship archive.',
        source: 'test',
        schemaVersion: 1,
        revision: 0,
        updatedAt: Date.now(),
        auditLog: []
    };

    console.log('\n[1] Lifecycle actions generate audit events');
    const drafted = auth.draftHeroPresentation(baseRecord, {
        publicTitle: 'Harvest Futures',
        publicDescription: 'Admin draft body',
        publicTheme: 'Land',
        actor: 'master_hero_admin',
        actorType: 'admin',
        sourceType: 'creator'
    });
    const draftActions = audit.normalizeHeroAuditLog(drafted.auditLog).map((e) => e.action);
    assert(
        'edited/created public fields produce audit event',
        draftActions.includes('created') || draftActions.includes('edited')
    );

    const approved = auth.approveHeroPresentation(
        { ...baseRecord, ...drafted, auditLog: drafted.auditLog },
        {
            publicTitle: 'Harvest Futures',
            publicDescription: 'Admin draft body',
            publicTheme: 'Land',
            approvedBy: 'master_hero_admin',
            actor: 'master_hero_admin',
            actorType: 'admin',
            sourceType: 'creator',
            publish: false
        }
    );
    assert('approve ok', approved.ok === true);
    const approveLog = audit.normalizeHeroAuditLog(approved.recordPatch?.auditLog);
    const approveEvt = approveLog.find((e) => e.action === 'approved');
    assert('approval creates approval event', Boolean(approveEvt));
    assert('approval has actor', Boolean(approveEvt?.actor));
    assert('approval has timestamp', Number(approveEvt?.timestamp) > 0);

    const published = auth.publishHeroPresentation(
        {
            ...baseRecord,
            ...approved.recordPatch
        },
        {
            sourceType: 'creator',
            actor: 'master_hero_admin',
            actorType: 'admin'
        }
    );
    assert('publish ok', published.ok === true);
    const publishLog = audit.normalizeHeroAuditLog(published.recordPatch?.auditLog);
    const publishEvt = publishLog.find((e) => e.action === 'published');
    assert('publishing creates publish event', Boolean(publishEvt));
    assert('publish has actor', Boolean(publishEvt?.actor));
    assert('publish has timestamp', Number(publishEvt?.timestamp) > 0);

    const archived = auth.archiveHeroPresentation(
        { ...baseRecord, ...published.recordPatch },
        { actor: 'master_hero_admin', actorType: 'admin', sourceType: 'creator' }
    );
    assert('archive ok', archived.ok === true);
    const archiveLog = audit.normalizeHeroAuditLog(archived.recordPatch?.auditLog);
    const archiveEvt = archiveLog.find((e) => e.action === 'archived');
    assert('archiving creates archive event', Boolean(archiveEvt));
    assert('archive has actor', Boolean(archiveEvt?.actor));
    assert('archive has timestamp', Number(archiveEvt?.timestamp) > 0);

    const oneStep = auth.approveHeroPresentation(baseRecord, {
        publicTitle: 'One Step Publish',
        publicDescription: 'approve+publish',
        approvedBy: 'master_hero_admin',
        actor: 'master_hero_admin',
        actorType: 'admin',
        sourceType: 'creator',
        publish: true
    });
    const oneLog = audit.normalizeHeroAuditLog(oneStep.recordPatch?.auditLog);
    assert(
        'approve+publish emits both events',
        oneLog.some((e) => e.action === 'approved') && oneLog.some((e) => e.action === 'published')
    );

    console.log('\n[2] FAIL — unauthorized sources');
    const aiApprovalEvent = audit.createHeroAuditEvent({
        heroId: 'x',
        action: 'approved',
        previousStatus: 'draft',
        newStatus: 'approved',
        actor: 'bot',
        source: 'ai',
        timestamp: Date.now()
    });
    assert('AI cannot create approval events', aiApprovalEvent.ok === false);

    const discoveryPublish = audit.createHeroAuditEvent({
        heroId: 'x',
        action: 'published',
        previousStatus: 'approved',
        newStatus: 'published',
        actor: 'ranker',
        source: 'discovery',
        timestamp: Date.now()
    });
    assert('discovery cannot create publish events', discoveryPublish.ok === false);

    const intelLifecycle = audit.createHeroAuditEvent({
        heroId: 'x',
        action: 'archived',
        previousStatus: 'published',
        newStatus: 'archived',
        actor: 'suggest',
        source: 'intelligence',
        timestamp: Date.now()
    });
    assert('intelligence cannot create lifecycle changes', intelLifecycle.ok === false);

    const aiApprove = auth.approveHeroPresentation(baseRecord, {
        publicTitle: 'Nope',
        publicDescription: 'ai',
        sourceType: 'ai',
        approvedBy: 'assistant'
    });
    assert('AI approve path fails', aiApprove.ok === false);
    assert('AI approve leaves no audit patch', aiApprove.recordPatch == null);

    const discPublish = auth.publishHeroPresentation(
        { ...baseRecord, ...approved.recordPatch },
        { sourceType: 'discovery' }
    );
    assert('discovery publish path fails', discPublish.ok === false);

    console.log('\n[3] FAIL — missing provenance / trail');
    const missingActor = audit.createHeroAuditEvent({
        action: 'published',
        previousStatus: 'approved',
        newStatus: 'published',
        actor: '',
        source: 'creator',
        timestamp: Date.now()
    });
    assert('missing actor fails', missingActor.ok === false);
    assert(
        'missing_actor error',
        missingActor.errors.includes('missing_actor')
    );

    const missingTs = audit.createHeroAuditEvent({
        action: 'approved',
        previousStatus: 'draft',
        newStatus: 'approved',
        actor: 'admin',
        actorType: 'admin',
        source: 'creator',
        timestamp: 0
    });
    assert('missing timestamp fails', missingTs.ok === false);

    const publicNoAudit = audit.auditPublicHeroTransitionIntegrity({
        heroPresentation: {
            status: 'published',
            publicTitle: 'Ghost publish',
            approvedBy: 'admin',
            approvedAt: Date.now()
        },
        auditLog: []
    });
    assert(
        'public Hero change without audit fails integrity',
        publicNoAudit.ok === false &&
            publicNoAudit.errors.includes('public_hero_change_without_publish_audit')
    );

    const missingTransition = audit.auditPublicHeroTransitionIntegrity({
        heroPresentation: { status: 'archived' },
        auditLog: []
    });
    assert(
        'missing event for state transition fails',
        missingTransition.ok === false &&
            missingTransition.errors.includes('missing_event_for_state_transition')
    );

    console.log('\n[4] Append-only history');
    const e1 = audit.createHeroAuditEvent({
        heroId: 'h1',
        action: 'edited',
        previousStatus: 'draft',
        newStatus: 'draft',
        actor: 'admin',
        actorType: 'admin',
        sourceType: 'creator',
        timestamp: 1000,
        changedFields: ['publicTitle']
    });
    const e2 = audit.createHeroAuditEvent({
        heroId: 'h1',
        action: 'approved',
        previousStatus: 'draft',
        newStatus: 'approved',
        actor: 'admin',
        actorType: 'admin',
        sourceType: 'creator',
        timestamp: 2000
    });
    assert('seed events ok', e1.ok && e2.ok);
    const history = audit.appendHeroAuditEvents([], [e1.event, e2.event]);
    assert('history length 2', history.length === 2);

    const reappend = audit.appendHeroAuditEvents(history, [e1.event]);
    assert('duplicate eventId does not mutate history', reappend.length === 2);

    const mutation = audit.assertAppendOnlyAuditHistory(history, [
        { ...history[0], actor: 'tampered' },
        history[1]
    ]);
    assert('history mutation detected', mutation.ok === false);

    const truncate = audit.assertAppendOnlyAuditHistory(history, [history[0]]);
    assert('truncate/overwrite detected', truncate.ok === false);

    const mergeGuard = audit.mergeHeroAuditLogForPersistence(history, [history[0]]);
    assert(
        'persistence merge refuses truncate of prior events',
        mergeGuard.auditLog.length === 2 && mergeGuard.rejected === true
    );

    console.log('\n[5] HeroRecord persistence (append-only)');
    bag.clear();
    const saved = recordMod.saveHeroRecord({
        mode: 'asset',
        status: 'ready',
        assetId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        mediaUrl: 'https://cdn.example.com/videos/ok.mp4',
        videoUrl: 'https://cdn.example.com/videos/ok.mp4',
        mediaKind: 'video',
        title: 'Civil Rights Archive',
        heroTitle: 'Civil Rights Archive',
        ...oneStep.recordPatch,
        source: 'validate-hero-audit-integrity'
    });
    assert('save with audit ok', Boolean(saved));
    // Audit persistence is schema-level; use unverified load (public load requires server receipt).
    const loaded = recordMod.loadHeroRecordUnverified();
    assert(
        'loaded audit retains publish',
        (loaded?.auditLog || []).some((e) => e.action === 'published')
    );
    const firstId = loaded.auditLog[0].eventId;
    const firstLen = loaded.auditLog.length;

    // Attempt overwrite of entire trail with empty history
    recordMod.saveHeroRecord({
        auditLog: [],
        source: 'tamper-empty'
    });
    const afterEmpty = recordMod.loadHeroRecordUnverified();
    assert(
        'empty overwrite preserved prior audit',
        afterEmpty.auditLog.length >= firstLen && afterEmpty.auditLog[0].eventId === firstId
    );

    // Append another event via publish path rebuild
    const more = auth.archiveHeroPresentation(afterEmpty, {
        actor: 'master_hero_admin',
        actorType: 'admin',
        sourceType: 'creator'
    });
    recordMod.saveHeroRecord({
        ...more.recordPatch,
        source: 'validate-archive-append'
    });
    const afterArchive = recordMod.loadHeroRecordUnverified();
    assert(
        'archive appends without losing history',
        afterArchive.auditLog.length > firstLen &&
            afterArchive.auditLog[0].eventId === firstId &&
            afterArchive.auditLog.some((e) => e.action === 'archived')
    );

    const integrityOk = audit.auditPublicHeroTransitionIntegrity({
        heroPresentation: oneStep.recordPatch.heroPresentation,
        auditLog: oneStep.recordPatch.auditLog
    });
    assert('published presentation with trail passes', integrityOk.ok === true);

    if (failed) {
        console.error(`\nFAIL validate-hero-audit-integrity (${failed})`);
        process.exit(1);
    }
    console.log('\nPASS validate-hero-audit-integrity');
    process.exit(0);
} catch (err) {
    console.error(err);
    process.exit(1);
} finally {
    await vite.close();
}
