#!/usr/bin/env node
/**
 * Viewer Trust Boundary (Phase 9)
 *
 * PASS:
 * - admin fields never reach viewer
 * - discovery cannot appear as identity
 * - NLP remains explanation only
 * - creator attribution preserved
 * - public output contains only approved presentation signals
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

console.log('\nViewer Trust Boundary (Phase 9)\n');

console.log('[0] Static contracts');
const trustSrc = read('src/lib/viewer/viewerTrustPresentation.js');
assert('resolveViewerTrustSignals', trustSrc.includes('resolveViewerTrustSignals'));
assert('Creator Collection label', trustSrc.includes('Creator Collection'));
assert('Featured Collection label', trustSrc.includes('Featured Collection'));
assert('Explore Themes label', trustSrc.includes('Explore Themes'));
assert('forbidden key list', trustSrc.includes('FORBIDDEN_VIEWER_TRUST_KEYS'));

const heroExp = read('src/components/experiences/HeroExperience.svelte');
assert('trust signals UI', heroExp.includes('data-viewer-trust-signals'));
assert(
    'display order documented',
    heroExp.includes('viewer trust signals') &&
        heroExp.includes('approved intelligenceExplanation')
);

const authoritySrc = read('src/lib/hero/heroPresentationAuthority.js');
assert(
    'public resolve includes trustSignals',
    authoritySrc.includes('trustSignals: resolveViewerTrustSignals')
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
    const trust = await vite.ssrLoadModule('/src/lib/viewer/viewerTrustPresentation.js');
    const auth = await vite.ssrLoadModule('/src/lib/hero/heroPresentationAuthority.js');
    const engineMod = await vite.ssrLoadModule('/src/lib/hero/heroServerAuthorityEngine.js');
    const expl = await vite.ssrLoadModule('/src/lib/hero/heroIntelligenceExplanation.js');

    const creatorTruth = auth.captureCreatorTruth({
        title: 'Black Agriculture Legacies',
        description: 'Land ownership archive',
        genre: 'Documentary',
        identityTerms: ['Black Agriculture']
    });

    const approved = expl.approveIntelligenceExplanation(
        expl.createIntelligenceExplanation({
            statements: ['Exploring Black Agriculture Legacies'],
            source: 'nlp'
        }).block,
        { approvedBy: 'admin-internal-should-not-leak' }
    );

    const baseRecord = {
        mode: 'asset',
        status: 'ready',
        assetId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        mediaUrl: 'https://cdn.example.com/v.mp4',
        videoUrl: 'https://cdn.example.com/v.mp4',
        mediaKind: 'video',
        title: 'Black Agriculture Legacies',
        schemaVersion: 1,
        revision: 1,
        updatedAt: Date.now(),
        creatorTruth
    };

    const published = auth.approveHeroPresentation(baseRecord, {
        publicTitle: 'Harvest Futures',
        publicDescription: 'Approved public copy',
        publicTheme: 'Land · Legacy',
        approvedBy: 'master_hero_admin',
        actor: 'master_hero_admin',
        actorType: 'admin',
        sourceType: 'creator',
        publish: true
    });
    assert('publish auth path ok', published.ok === true);

    const pubEvt = (published.recordPatch?.auditLog || []).find((e) => e.action === 'published');
    const granted = engineMod.attachTestServerPublishGrant(
        {
            ...baseRecord,
            ...published.recordPatch,
            featuredSeries: 'Land Stewardship Archive',
            featuredCollection: 'Black Legacy Stories',
            intelligenceExplanation: approved.block,
            adminContext: {
                ...(published.recordPatch?.adminContext || {}),
                editorialNotes: 'SECRET_ADMIN_EDITORIAL',
                identityNotes: 'SECRET_IDENTITY_NOTES'
            },
            discoveryContext: {
                shelfLabels: ['Trending AI Shelf'],
                keywords: ['Cyber-Action'],
                sourceType: 'discovery'
            }
        },
        {
            authorityEventId: pubEvt?.eventId || 'haevt-trust-1',
            heroId: baseRecord.assetId,
            clientIntegrityHash: pubEvt?.integrityHash || 'fnv1a32_test'
        }
    );

    console.log('\n[1] Admin fields never reach viewer trust surface');
    const signals = trust.resolveViewerTrustSignals(granted, {
        featuredCollection: granted.featuredCollection,
        featuredSeries: granted.featuredSeries
    });
    assert('creator collection present', signals.creatorCollection?.value === 'Land Stewardship Archive');
    assert('featured collection present', signals.featuredCollection?.value === 'Black Legacy Stories');
    assert(
        'explore themes from presentation only',
        signals.exploreThemes?.values?.includes('Land') ||
            signals.exploreThemes?.values?.some((t) => /land/i.test(t))
    );
    const leaks = trust.findForbiddenViewerTrustLeaks(signals);
    assert('admin fields never reach viewer trust', leaks.length === 0);
    const signalJson = JSON.stringify(signals);
    assert(
        'no admin notes / actor secrets in trust JSON',
        !signalJson.includes('SECRET_') &&
            !signalJson.includes('admin-actor-secret') &&
            !signalJson.includes('editorialNotes') &&
            !signalJson.includes('sourceType')
    );

    console.log('\n[2] Discovery cannot appear as identity');
    const disc = trust.promoteDiscoveryToTrustSignal('Trending AI Shelf', 'creatorCollection');
    assert('discovery promote blocked', disc.ok === false);
    const discTrust = trust.resolveViewerTrustSignals(
        {
            ...granted,
            featuredSeries: '',
            creatorCollection: '',
            featuredCollection: ''
        },
        { discoveryKeywords: ['Cyber-Action', 'Trending AI Shelf'] }
    );
    assert(
        'discovery cannot appear as identity',
        !discTrust.items.some((i) =>
            JSON.stringify(i).toLowerCase().includes('cyber') ||
            JSON.stringify(i).toLowerCase().includes('trending ai')
        )
    );

    console.log('\n[3] NLP remains explanation only');
    const publicCopy = auth.resolvePublicHeroViewerCopy(granted, {
        featuredCollection: granted.featuredCollection,
        featuredSeries: granted.featuredSeries
    });
    assert(
        'nlp explanation visible when approved',
        publicCopy.intelligenceExplanation?.visible === true &&
            publicCopy.intelligenceExplanation?.authoritative === false
    );
    assert(
        'nlp not used as title identity',
        publicCopy.title === 'Harvest Futures' &&
            publicCopy.titleSource === 'heroPresentation'
    );
    assert(
        'intelligence has no sourceType leak on public surface',
        publicCopy.intelligenceExplanation?.sourceType == null &&
            publicCopy.intelligenceExplanation?.source == null
    );

    console.log('\n[4] Creator attribution preserved');
    const packed = trust.buildPublicViewerPresentation(granted, {
        publicCopy,
        featuredCollection: granted.featuredCollection,
        featuredSeries: granted.featuredSeries
    });
    assert(
        'creator attribution preserved',
        packed.creatorAttribution?.title === 'Black Agriculture Legacies' &&
            packed.creatorAttribution?.genre === 'Documentary'
    );
    assert(
        'public title remains approved presentation',
        packed.title === 'Harvest Futures' && packed.isPublished === true
    );

    console.log('\n[5] Public output only approved presentation signals');
    assert(
        'display order includes trust last',
        Array.isArray(packed.displayOrder) &&
            packed.displayOrder[0] === 'heroPresentation' &&
            packed.displayOrder.includes('discoveryConnections') &&
            packed.displayOrder[packed.displayOrder.length - 1] === 'viewerTrustSignals'
    );
    const packLeaks = trust.findForbiddenViewerTrustLeaks(packed);
    assert('public package has no forbidden keys', packLeaks.length === 0);
    const packJson = JSON.stringify(packed);
    assert(
        'public package excludes admin architecture',
        !packJson.includes('SECRET_') &&
            !packJson.includes('admin-actor') &&
            !packJson.includes('auditLog') &&
            !packJson.includes('serverSignature') &&
            !packJson.includes('nlpConfidence')
    );

    // Unapproved presentation: featured / themes withheld
    const draftSignals = trust.resolveViewerTrustSignals({
        ...baseRecord,
        featuredSeries: 'Land Stewardship Archive',
        featuredCollection: 'Black Legacy Stories',
        heroPresentation: {
            publicTitle: 'Draft',
            publicDescription: '',
            publicTheme: 'Land',
            status: 'draft',
            approvedBy: '',
            approvedAt: null
        },
        serverAuthorityReceipt: null,
        serverAuthorityState: null
    });
    assert(
        'featured withheld without approved presentation',
        draftSignals.featuredCollection == null && draftSignals.exploreThemes == null
    );
    assert(
        'creator collection may still attribute',
        draftSignals.creatorCollection?.value === 'Land Stewardship Archive'
    );

    console.log(
        failed === 0
            ? '\n✅ Viewer trust boundary validation PASSED\n'
            : `\n❌ ${failed} assertion(s) failed\n`
    );
    process.exit(failed === 0 ? 0 : 1);
} catch (err) {
    console.error(err);
    process.exit(1);
} finally {
    await vite.close();
}
