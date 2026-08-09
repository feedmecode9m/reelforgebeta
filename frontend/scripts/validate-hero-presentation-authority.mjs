#!/usr/bin/env node
/**
 * Master Hero Admin / Public Presentation Authority.
 *
 * PASS:
 * - approved Hero presentation can publish
 * - admin context remains protected
 * - creator truth is immutable
 * - AI fields cannot become public truth
 * - discovery metadata cannot become Hero identity
 *
 * FAIL:
 * - direct NLP write into HeroRecord public fields
 * - discovery category promoted to genre/title
 * - missing approval provenance
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

console.log('\n[0] Static contracts');
const authoritySrc = read('src/lib/hero/heroPresentationAuthority.js');
assert('authority module exists', authoritySrc.includes('approveHeroPresentation'));
assert('visibility policy documents layers', authoritySrc.includes('admin_only') && authoritySrc.includes('heroPresentation'));
assert('NLP gate present', authoritySrc.includes('applyNlpToHeroPublicFields'));

const recordSrc = read('src/lib/hero/heroRecord.js');
assert('HeroRecord preserves creatorTruth', recordSrc.includes('creatorTruth'));
assert('HeroRecord preserves heroPresentation', recordSrc.includes('heroPresentation'));
assert('HeroRecord preserves adminContext', recordSrc.includes('adminContext'));

const managerSrc = read('src/components/studio/HeroManagerPanel.svelte');
assert('Master Hero Admin presentation UI', managerSrc.includes('data-master-hero-admin-presentation'));
assert('Approve control', managerSrc.includes('data-approve-hero-presentation'));
assert('Public title control', managerSrc.includes('data-public-hero-title'));

const heroExp = read('src/components/experiences/HeroExperience.svelte');
assert('Viewer resolves public presentation authority', heroExp.includes('resolvePublicHeroViewerCopy'));
assert('Intelligence labeled in viewer', heroExp.includes('data-intelligence-explanation'));

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

    console.log('\n[1] Creator truth immutable');
    const baseRecord = {
        mode: 'asset',
        status: 'ready',
        assetId: 'asset-hero-1',
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
    const truth1 = auth.captureCreatorTruth(baseRecord);
    assert('capture creator title', truth1.title === 'Black Agriculture Legacies');
    const truth2 = auth.captureCreatorTruth(
        { ...baseRecord, creatorTruth: truth1 },
        { title: 'NLP Rewritten Viral Headline', force: false }
    );
    assert('immutable without force', truth2.title === 'Black Agriculture Legacies');
    const blocked = auth.protectCreatorTruthFromNlp(truth1, {
        title: 'Generic Travel Vlog',
        genre: 'Cyber-Action'
    });
    assert('NLP title blocked', blocked.blocked.includes('title'));
    assert('NLP genre blocked', blocked.blocked.includes('genre'));
    assert('creator truth unchanged after protect', blocked.next.title === truth1.title);

    console.log('\n[2] Approved presentation publishes; admin context protected');
    const approved = auth.approveHeroPresentation(
        { ...baseRecord, creatorTruth: truth1 },
        {
            publicTitle: 'Harvest Futures',
            publicDescription: 'Admin-authored presentation for public Hero Vault.',
            publicTheme: 'Land & legacy',
            showIntelligence: true,
            approvedBy: 'master_hero_admin',
            actor: 'master_hero_admin',
            actorType: 'admin',
            sourceType: 'creator'
        }
    );
    assert('approval ok', approved.ok === true);
    assert('approvedBy set', approved.recordPatch?.heroPresentation?.approvedBy === 'master_hero_admin');
    assert('approvedAt set', Number(approved.recordPatch?.heroPresentation?.approvedAt) > 0);
    assert(
        'status published (live vault)',
        approved.recordPatch?.heroPresentation?.status === 'published'
    );
    assert(
        'legacy visibility public mirror',
        approved.recordPatch?.heroPresentation?.visibility === 'public'
    );
    assert(
        'creator truth retained',
        approved.recordPatch?.creatorTruth?.title === 'Black Agriculture Legacies'
    );
    assert(
        'admin context captures source title',
        approved.recordPatch?.adminContext?.sourceTitle === 'Black Agriculture Legacies'
    );

    // AI cannot approve.
    const aiApprove = auth.approveHeroPresentation(baseRecord, {
        publicTitle: 'AI Auto Publish',
        publicDescription: 'from nlp',
        approvedBy: 'assistant',
        sourceType: 'ai'
    });
    assert('AI cannot approve presentation', aiApprove.ok === false);

    console.log('\n[3] Viewer resolve order');
    const pubEvtPub = (approved.recordPatch.auditLog || []).find((e) => e.action === 'published');
    const viewerPublic = auth.resolvePublicHeroViewerCopy(
        engineMod.attachTestServerPublishGrant(
            {
                ...baseRecord,
                creatorTruth: truth1,
                heroPresentation: approved.recordPatch.heroPresentation,
                adminContext: approved.recordPatch.adminContext,
                auditLog: approved.recordPatch.auditLog
            },
            {
                authorityEventId: pubEvtPub?.eventId || 'haevt-pres-auth',
                heroId: baseRecord.assetId || 'hero',
                clientIntegrityHash: pubEvtPub?.integrityHash || 'fnv1a32_test'
            }
        )
    );
    assert('public title uses presentation', viewerPublic.title === 'Harvest Futures');
    assert('titleSource heroPresentation', viewerPublic.titleSource === 'heroPresentation');
    assert('intelligence non-authoritative', viewerPublic.intelligenceExplanation.authoritative === false);
    assert('admin notes not required on public title', viewerPublic.title !== 'AI Auto Publish');

    const viewerFallback = auth.resolvePublicHeroViewerCopy({
        ...baseRecord,
        creatorTruth: truth1,
        heroPresentation: auth.createEmptyHeroPresentation(),
        auditLog: []
    });
    assert(
        'fallback to creatorTruth when unapproved',
        viewerFallback.title === 'Black Agriculture Legacies' &&
            viewerFallback.titleSource === 'creatorTruth'
    );

    console.log('\n[4] FAIL paths');
    const nlpWrite = auth.applyNlpToHeroPublicFields(
        {
            publicTitle: 'NLP Title',
            genre: 'Cyber-Action',
            publicDescription: 'nlp copy'
        },
        'nlp'
    );
    assert('direct NLP write fails', nlpWrite.ok === false);
    assert('blocks publicTitle', nlpWrite.blocked.includes('publicTitle'));
    assert('blocks genre', nlpWrite.blocked.includes('genre'));

    const discoveryPromote = auth.promoteDiscoveryToHeroIdentity('Cyber-Action', 'genre');
    assert('discovery→genre fails', discoveryPromote.ok === false);
    assert(
        'discovery→title fails',
        auth.promoteDiscoveryToHeroIdentity('Trending', 'publicTitle').ok === false
    );

    const missingApproval = auth.auditHeroPresentationProvenance({
        heroPresentation: {
            publicTitle: 'Unapproved live',
            publicDescription: 'Should not be public',
            visibility: 'public',
            approvedBy: '',
            approvedAt: null
        }
    });
    assert('missing approval fails audit', missingApproval.ok === false);
    assert(
        'missing approvedBy flagged',
        missingApproval.errors.includes('missing_approval_approvedBy')
    );

    console.log('\n[5] HeroRecord persists authority layers');
    bag.clear();
    const pubEvt = (approved.recordPatch.auditLog || []).find((e) => e.action === 'published');
    const grantedPatch = engineMod.attachTestServerPublishGrant(
        {
            mode: 'asset',
            status: 'ready',
            assetId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            mediaUrl: 'https://cdn.example.com/videos/ok.mp4',
            videoUrl: 'https://cdn.example.com/videos/ok.mp4',
            mediaKind: 'video',
            title: 'Civil Rights Archive',
            heroTitle: 'Civil Rights Archive',
            heroDescription: 'Original creator copy',
            creatorTruth: auth.captureCreatorTruth({
                title: 'Civil Rights Archive',
                heroDescription: 'Original creator copy'
            }),
            ...approved.recordPatch,
            source: 'validate-hero-presentation-authority'
        },
        {
            authorityEventId: pubEvt?.eventId || 'haevt-pres-save',
            heroId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            clientIntegrityHash: pubEvt?.integrityHash || 'fnv1a32_test'
        }
    );
    const saved = recordMod.saveHeroRecord(grantedPatch);
    assert('saveHeroRecord ok', Boolean(saved));
    const loaded = recordMod.loadHeroRecord();
    assert(
        'loaded presentation is published',
        loaded.heroPresentation?.status === 'published' &&
            loaded.heroPresentation?.approvedBy === 'master_hero_admin'
    );
    assert(
        'loaded creator truth not NLP',
        loaded.creatorTruth?.title === 'Black Agriculture Legacies' ||
            loaded.creatorTruth?.title === 'Civil Rights Archive'
    );

    // Attempt NLP overwrite of creatorTruth via save patch → ignored.
    const tryNlp = recordMod.saveHeroRecord({
        creatorTruth: {
            title: 'Hijacked by NLP',
            description: 'should not stick',
            immutable: true
        },
        source: 'nlp-attack'
    });
    assert(
        'creator truth not hijacked by later save',
        tryNlp?.creatorTruth?.title !== 'Hijacked by NLP'
    );

    if (failed) {
        console.error(`\nFAIL validate-hero-presentation-authority (${failed})`);
        process.exit(1);
    }
    console.log('\nPASS validate-hero-presentation-authority');
    process.exit(0);
} catch (err) {
    console.error(err);
    process.exit(1);
} finally {
    await vite.close();
}
