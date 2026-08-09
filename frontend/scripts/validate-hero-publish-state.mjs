#!/usr/bin/env node
/**
 * Hero Publish State Validation
 *
 * Ensures Hero Vault publication follows an explicit lifecycle and that only
 * approved editorial decisions can become public.
 *
 * PASS:
 * - lifecycle enforcement
 * - approval enforcement
 * - public resolver safety
 * - provenance separation
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

const LIFECYCLE = ['draft', 'review', 'approved', 'published', 'archived'];

console.log('\nHero Publish State Validation\n');

console.log('[0] Static integration contracts');
const authoritySrc = read('src/lib/hero/heroPresentationAuthority.js');
assert('lifecycle statuses defined', LIFECYCLE.every((s) => authoritySrc.includes(`'${s}'`)));
assert('approveHeroPresentation present', authoritySrc.includes('approveHeroPresentation'));
assert('publishHeroPresentation present', authoritySrc.includes('publishHeroPresentation'));
assert('resolvePublicHeroViewerCopy present', authoritySrc.includes('resolvePublicHeroViewerCopy'));
assert('isPublicHeroPresentation present', authoritySrc.includes('isPublicHeroPresentation'));

const recordSrc = read('src/lib/hero/heroRecord.js');
assert('HeroRecord persists heroPresentation', recordSrc.includes('heroPresentation'));
assert('HeroRecord persists creatorTruth', recordSrc.includes('creatorTruth'));
assert('HeroRecord persists adminContext', recordSrc.includes('adminContext'));

const managerSrc = read('src/components/studio/HeroManagerPanel.svelte');
assert('Hero Manager approval flow', managerSrc.includes('approveHeroPresentation'));
assert('Approve control', managerSrc.includes('data-approve-hero-presentation'));

const heroExp = read('src/components/experiences/HeroExperience.svelte');
assert('HeroExperience public resolver', heroExp.includes('resolvePublicHeroViewerCopy'));

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
    const auth = await vite.ssrLoadModule('/src/lib/hero/heroPresentationAuthority.js');
    const engineMod = await vite.ssrLoadModule('/src/lib/hero/heroServerAuthorityEngine.js');
    const recordMod = await vite.ssrLoadModule('/src/lib/hero/heroRecord.js');

    const baseRecord = {
        mode: 'asset',
        status: 'ready',
        assetId: 'asset-publish-1',
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
        updatedAt: Date.now()
    };

    const truth = auth.captureCreatorTruth(baseRecord);

    let lifecyclePass = true;
    let approvalPass = true;
    let resolverPass = true;
    let provenancePass = true;

    console.log('\n[1] Hero lifecycle states');
    for (const s of LIFECYCLE) {
        const normalized = auth.normalizeHeroPresentation({ status: s, publicTitle: 'T' });
        const ok = normalized.status === s;
        assert(`status supports ${s}`, ok);
        if (!ok) lifecyclePass = false;
    }
    assert(
        'HERO_PRESENTATION_STATUS_VALUES length 5',
        Array.isArray(auth.HERO_PRESENTATION_STATUS_VALUES) &&
            auth.HERO_PRESENTATION_STATUS_VALUES.length === 5
    );

    console.log('\n[2] Public visibility rules — PASS');
    const approvedOnly = auth.approveHeroPresentation(
        { ...baseRecord, creatorTruth: truth },
        {
            publicTitle: 'Harvest Futures',
            publicDescription: 'Admin presentation.',
            publicTheme: 'Land',
            approvedBy: 'master_hero_admin',
            actor: 'master_hero_admin',
            actorType: 'admin',
            sourceType: 'creator',
            publish: false
        }
    );
    assert('approval ok (approved, not published)', approvedOnly.ok === true);
    assert(
        'status is approved',
        approvedOnly.recordPatch?.heroPresentation?.status === 'approved'
    );
    assert(
        'approved can publish',
        auth.canPublishHeroPresentation(approvedOnly.recordPatch.heroPresentation) === true
    );

    const published = auth.publishHeroPresentation(
        {
            ...baseRecord,
            creatorTruth: truth,
            heroPresentation: approvedOnly.recordPatch.heroPresentation,
            adminContext: approvedOnly.recordPatch.adminContext,
            auditLog: approvedOnly.recordPatch.auditLog
        },
        {
            sourceType: 'creator',
            actor: 'master_hero_admin',
            actorType: 'admin'
        }
    );
    assert('publish from approved ok', published.ok === true);
    assert(
        'status is published',
        published.recordPatch?.heroPresentation?.status === 'published'
    );
    assert(
        'published is public presentation',
        auth.isPublicHeroPresentation(published.recordPatch.heroPresentation) === true
    );

    const pubEvt = (published.recordPatch.auditLog || []).find((e) => e.action === 'published');
    const viewerPublished = auth.resolvePublicHeroViewerCopy(
        engineMod.attachTestServerPublishGrant(
            {
                ...baseRecord,
                creatorTruth: truth,
                heroPresentation: published.recordPatch.heroPresentation,
                auditLog: published.recordPatch.auditLog,
                adminContext: {
                    editorialNotes: 'SECRET ADMIN NOTE',
                    identityNotes: 'INTERNAL'
                }
            },
            {
                authorityEventId: pubEvt?.eventId || 'haevt-publish-state',
                heroId: baseRecord.assetId,
                clientIntegrityHash: pubEvt?.integrityHash || 'fnv1a32_test'
            }
        )
    );
    assert(
        'published resolves to public Hero Vault title',
        viewerPublished.title === 'Harvest Futures' &&
            viewerPublished.isPublished === true &&
            viewerPublished.titleSource === 'heroPresentation'
    );
    if (viewerPublished.title !== 'Harvest Futures') resolverPass = false;

    // draft remains admin-only
    const drafted = auth.draftHeroPresentation(
        { ...baseRecord, creatorTruth: truth },
        {
            publicTitle: 'Draft Public Title Leak',
            publicDescription: 'should not be public',
            sourceType: 'creator',
            actor: 'master_hero_admin',
            actorType: 'admin'
        }
    );
    assert('draft status', drafted.heroPresentation.status === 'draft');
    const viewerDraft = auth.resolvePublicHeroViewerCopy({
        ...baseRecord,
        creatorTruth: truth,
        heroPresentation: drafted.heroPresentation
    });
    assert(
        'draft remains admin-only (creatorTruth fallback)',
        viewerDraft.title === 'Black Agriculture Legacies' &&
            viewerDraft.titleSource === 'creatorTruth' &&
            viewerDraft.isPublished === false
    );
    if (viewerDraft.title === 'Draft Public Title Leak') {
        lifecyclePass = false;
        resolverPass = false;
    }

    const reviewLayers = auth.submitHeroPresentationForReview(
        { ...baseRecord, creatorTruth: truth },
        {
            publicTitle: 'Review Leak Title',
            publicDescription: 'review body',
            sourceType: 'creator',
            actor: 'master_hero_admin',
            actorType: 'admin'
        }
    );
    assert('review status', reviewLayers.heroPresentation.status === 'review');
    const viewerReview = auth.resolvePublicHeroViewerCopy({
        ...baseRecord,
        creatorTruth: truth,
        heroPresentation: reviewLayers.heroPresentation
    });
    assert(
        'review remains admin-only',
        viewerReview.title !== 'Review Leak Title' && viewerReview.isPublished === false
    );
    if (viewerReview.title === 'Review Leak Title') lifecyclePass = false;

    const archived = auth.archiveHeroPresentation(
        {
            ...baseRecord,
            creatorTruth: truth,
            heroPresentation: published.recordPatch.heroPresentation,
            auditLog: published.recordPatch.auditLog
        },
        {
            actor: 'master_hero_admin',
            actorType: 'admin',
            sourceType: 'creator'
        }
    );
    assert('archived status', archived.heroPresentation.status === 'archived');
    const viewerArchived = auth.resolvePublicHeroViewerCopy({
        ...baseRecord,
        creatorTruth: truth,
        heroPresentation: archived.heroPresentation
    });
    assert(
        'archived does not appear publicly',
        viewerArchived.title !== 'Harvest Futures' && viewerArchived.isPublished === false
    );
    if (viewerArchived.isPublished) lifecyclePass = false;

    console.log('\n[3] Public visibility rules — FAIL cases');
    const failDraftPublic = auth.resolvePublicHeroViewerCopy({
        ...baseRecord,
        creatorTruth: truth,
        heroPresentation: {
            publicTitle: 'Should Never Leak Draft',
            publicDescription: 'draft body',
            status: 'draft',
            approvedBy: '',
            approvedAt: null
        }
    });
    assert(
        'FAIL: draft Hero must not appear in public vault',
        failDraftPublic.title !== 'Should Never Leak Draft' && !failDraftPublic.isPublished
    );
    if (failDraftPublic.title === 'Should Never Leak Draft') lifecyclePass = false;

    const failReviewPublic = auth.resolvePublicHeroViewerCopy({
        ...baseRecord,
        creatorTruth: truth,
        heroPresentation: {
            publicTitle: 'Should Never Leak Review',
            status: 'review',
            approvedBy: 'someone',
            approvedAt: Date.now()
        }
    });
    assert(
        'FAIL: review Hero must not appear in public vault',
        failReviewPublic.title !== 'Should Never Leak Review' && !failReviewPublic.isPublished
    );

    const failArchivedPublic = auth.resolvePublicHeroViewerCopy({
        ...baseRecord,
        creatorTruth: truth,
        heroPresentation: {
            publicTitle: 'Should Never Leak Archived',
            status: 'archived',
            approvedBy: 'master_hero_admin',
            approvedAt: Date.now()
        }
    });
    assert(
        'FAIL: archived Hero must not appear in public vault',
        failArchivedPublic.title !== 'Should Never Leak Archived' &&
            !failArchivedPublic.isPublished
    );

    const missingMeta = auth.auditHeroPresentationProvenance({
        heroPresentation: {
            publicTitle: 'Missing meta live',
            publicDescription: 'no approval',
            status: 'published',
            approvedBy: '',
            approvedAt: null
        }
    });
    assert('FAIL: missing approval metadata cannot audit clean', missingMeta.ok === false);
    assert(
        'missing approval flagged',
        missingMeta.errors.some((e) => String(e).includes('missing_approval'))
    );
    if (missingMeta.ok) approvalPass = false;

    const missingMetaResolve = auth.resolvePublicHeroViewerCopy({
        ...baseRecord,
        creatorTruth: truth,
        heroPresentation: {
            publicTitle: 'Meta-less Public',
            publicDescription: 'should fall back',
            status: 'published',
            approvedBy: '',
            approvedAt: null
        }
    });
    assert(
        'missing approval metadata does not publish copy',
        missingMetaResolve.title !== 'Meta-less Public' &&
            missingMetaResolve.titleSource === 'creatorTruth'
    );
    if (missingMetaResolve.isPublished) approvalPass = false;

    console.log('\n[4] Approval authority rules');
    assert(
        'approvedBy on approved',
        Boolean(approvedOnly.recordPatch.heroPresentation.approvedBy)
    );
    assert(
        'approvedAt on approved',
        Number(approvedOnly.recordPatch.heroPresentation.approvedAt) > 0
    );
    assert('approvedBy on published', Boolean(published.recordPatch.heroPresentation.approvedBy));
    assert(
        'approvedAt on published',
        Number(published.recordPatch.heroPresentation.approvedAt) > 0
    );

    const aiApprove = auth.approveHeroPresentation(baseRecord, {
        publicTitle: 'AI Auto',
        publicDescription: 'nope',
        sourceType: 'ai'
    });
    assert('FAIL: AI cannot approve', aiApprove.ok === false);
    if (aiApprove.ok) approvalPass = false;

    const nlpApprove = auth.approveHeroPresentation(baseRecord, {
        publicTitle: 'NLP Auto',
        publicDescription: 'nope',
        sourceType: 'nlp'
    });
    assert('FAIL: NLP cannot approve', nlpApprove.ok === false);

    const discoveryApprove = auth.approveHeroPresentation(baseRecord, {
        publicTitle: 'Discovery Auto',
        publicDescription: 'nope',
        sourceType: 'discovery'
    });
    assert('FAIL: discovery metadata cannot approve', discoveryApprove.ok === false);

    const intelPublish = auth.publishViaIntelligenceExplanation(baseRecord, {
        themes: ['trending']
    });
    assert(
        'FAIL: intelligenceExplanation cannot set published',
        intelPublish.ok === false
    );
    if (intelPublish.ok) approvalPass = false;

    const intelStatus = auth.applyNlpToHeroPublicFields(
        { status: 'published', publicTitle: 'X' },
        'intelligence'
    );
    assert('FAIL: NLP cannot write status=published', intelStatus.ok === false);

    console.log('\n[5] Provenance rules');
    const beforeTruth = auth.captureCreatorTruth({ ...baseRecord, creatorTruth: truth });
    const afterPublishTruth = published.recordPatch.creatorTruth;
    assert(
        'creatorTruth immutable during publish',
        afterPublishTruth.title === beforeTruth.title && afterPublishTruth.immutable !== false
    );
    const nlpProtect = auth.protectCreatorTruthFromNlp(beforeTruth, {
        title: 'Hijack Title'
    });
    assert('creatorTruth cannot be modified by NLP', nlpProtect.blocked.includes('title'));
    if (!nlpProtect.blocked.includes('title')) provenancePass = false;

    assert(
        'adminContext null on public resolve',
        viewerPublished.adminContext === null
    );
    if (viewerPublished.adminContext && viewerPublished.adminContext.editorialNotes) {
        provenancePass = false;
        console.error('  ✗ admin notes leaked into public resolve');
        failed += 1;
    } else {
        assert('admin notes never in public Hero output', true);
    }

    assert(
        'public heroPresentation exposes only public fields shape',
        viewerPublished.heroPresentation &&
            'publicTitle' in viewerPublished.heroPresentation &&
            !('approvedBy' in (viewerPublished.heroPresentation || {})) &&
            !('editorialNotes' in (viewerPublished.heroPresentation || {}))
    );

    // Must not return intelligence/discovery as identity when unpublished
    const intelOnlyRecord = {
        ...baseRecord,
        creatorTruth: { title: '', description: '', immutable: true },
        heroTitle: '',
        title: '',
        heroPresentation: { status: 'draft' }
    };
    const intelOnlyViewer = auth.resolvePublicHeroViewerCopy(intelOnlyRecord, {
        intelligenceThemes: ['Cyber-Action Trend'],
        forceShowIntelligence: true
    });
    assert(
        'never intelligence-only as title identity',
        intelOnlyViewer.titleSource !== 'intelligence' &&
            intelOnlyViewer.title !== 'Cyber-Action Trend' &&
            intelOnlyViewer.intelligenceExplanation?.authoritative === false
    );
    if (intelOnlyViewer.titleSource === 'intelligence') resolverPass = false;

    console.log('\n[6] HeroRecord persistence');
    bag.clear();
    const saved = recordMod.saveHeroRecord(
        engineMod.attachTestServerPublishGrant(
            {
                mode: 'asset',
                status: 'ready',
                assetId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                mediaUrl: 'https://cdn.example.com/videos/ok.mp4',
                videoUrl: 'https://cdn.example.com/videos/ok.mp4',
                mediaKind: 'video',
                title: 'Black Agriculture Legacies',
                heroTitle: 'Black Agriculture Legacies',
                creatorTruth: truth,
                ...published.recordPatch,
                source: 'validate-hero-publish-state'
            },
            {
                authorityEventId: pubEvt?.eventId || 'haevt-publish-state-save',
                heroId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                clientIntegrityHash: pubEvt?.integrityHash || 'fnv1a32_test'
            }
        )
    );
    assert('save published record', Boolean(saved));
    const loaded = recordMod.loadHeroRecord();
    assert(
        'persisted status published',
        loaded?.heroPresentation?.status === 'published'
    );
    assert(
        'persisted approval metadata',
        Boolean(loaded?.heroPresentation?.approvedBy) &&
            Boolean(loaded?.heroPresentation?.approvedAt)
    );

    if (failed) {
        console.error(`\nFAIL validate-hero-publish-state (${failed})`);
        process.exit(1);
    }

    console.log('\nHero Publish State Validation');
    console.log('\nPASS:');
    console.log(lifecyclePass ? '- lifecycle enforcement' : '- lifecycle enforcement (incomplete)');
    console.log(approvalPass ? '- approval enforcement' : '- approval enforcement (incomplete)');
    console.log(resolverPass ? '- public resolver safety' : '- public resolver safety (incomplete)');
    console.log(provenancePass ? '- provenance separation' : '- provenance separation (incomplete)');
    console.log('\nPASS validate-hero-publish-state');
    process.exit(0);
} catch (err) {
    console.error(err);
    process.exit(1);
} finally {
    await vite.close();
}
