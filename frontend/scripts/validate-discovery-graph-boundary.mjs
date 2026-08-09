#!/usr/bin/env node
/**
 * Discovery Graph Boundary (Phase 10)
 *
 * PASS:
 * - discovery never writes truth
 * - discovery requires approval
 * - public viewer receives only approved relationships
 * - no internal metadata leakage
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

console.log('\nDiscovery Graph Boundary (Phase 10)\n');

console.log('[0] Static contracts');
const graphSrc = read('src/lib/discovery/discoveryGraph.js');
assert('createDiscoveryRelationship', graphSrc.includes('createDiscoveryRelationship'));
assert('validateDiscoveryRelationship', graphSrc.includes('validateDiscoveryRelationship'));
assert('resolvePublicDiscoveryConnections', graphSrc.includes('resolvePublicDiscoveryConnections'));
assert('forbidden truth fields', graphSrc.includes('DISCOVERY_FORBIDDEN_TRUTH_FIELDS'));

const recordSrc = read('src/lib/hero/heroRecord.js');
assert('HeroRecord discoveryGraph field', recordSrc.includes('discoveryGraph'));

const authoritySrc = read('src/lib/hero/heroPresentationAuthority.js');
assert(
    'public resolve includes discoveryConnections',
    authoritySrc.includes('discoveryConnections:')
);

const managerSrc = read('src/components/studio/HeroManagerPanel.svelte');
assert('Suggested Discovery Connections panel', managerSrc.includes('data-master-hero-discovery-review'));
assert('approve control', managerSrc.includes('data-discovery-approve'));
assert('reject control', managerSrc.includes('data-discovery-reject'));
assert('hide control', managerSrc.includes('data-discovery-hide'));

const heroExp = read('src/components/experiences/HeroExperience.svelte');
assert('discovery connections UI', heroExp.includes('data-discovery-connections'));
assert(
    'order before trust after intelligence',
    heroExp.includes('approved discovery connections') &&
        heroExp.indexOf('data-discovery-connections') <
            heroExp.indexOf('data-viewer-trust-signals')
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
    const graph = await vite.ssrLoadModule('/src/lib/discovery/discoveryGraph.js');
    const auth = await vite.ssrLoadModule('/src/lib/hero/heroPresentationAuthority.js');
    const engineMod = await vite.ssrLoadModule('/src/lib/hero/heroServerAuthorityEngine.js');
    const recordMod = await vite.ssrLoadModule('/src/lib/hero/heroRecord.js');

    const creatorTruth = auth.captureCreatorTruth({
        title: 'Black Agriculture Legacies',
        description: 'Land ownership archive',
        genre: 'Documentary'
    });

    console.log('\n[1] Discovery never writes truth');
    const truthWrite = graph.createDiscoveryRelationship({
        type: 'theme_connection',
        label: 'Land themes',
        genre: 'Cyber-Action',
        creatorTruth: { title: 'Stolen' },
        identity: 'identity-claim'
    });
    assert(
        'discovery never writes truth',
        truthWrite.ok === false &&
            truthWrite.errors.some((e) => e.includes('discovery_cannot_write_truth'))
    );

    const before = { ...creatorTruth };
    const after = { ...creatorTruth, genre: 'Discovery Hijack' };
    const mutate = graph.applyDiscoveryToCreatorTruth(before, after, {
        genre: 'Discovery Hijack'
    });
    assert('applyDiscoveryToCreatorTruth blocked', mutate.ok === false);
    assert('prior truth retained', mutate.creatorTruth?.genre === 'Documentary');

    const promote = graph.promoteDiscoveryToCreatorTruth('Trending Shelf', 'genre');
    assert('promote discovery blocked', promote.ok === false);

    console.log('\n[2] Discovery requires approval');
    const created = graph.createDiscoveryRelationship({
        type: 'theme_connection',
        label: 'Land stewardship',
        target: 'Soil archives',
        context: 'Related themes to explore'
    });
    assert('create draft ok', created.ok === true && created.relationship?.approved === false);

    const unapprovedPublic = graph.resolvePublicDiscoveryConnections({
        relationships: [created.relationship]
    });
    assert(
        'discovery requires approval',
        unapprovedPublic.visible === false && unapprovedPublic.connections.length === 0
    );

    const auto = graph.autoApproveDiscoveryRelationship(created.relationship);
    assert('auto-approve blocked', auto.ok === false);

    const approved = graph.approveDiscoveryRelationship(created.relationship, {
        approvedBy: 'admin-session-secret'
    });
    assert('manual approve ok', approved.ok === true && approved.relationship?.approved === true);

    const publicOk = graph.resolvePublicDiscoveryConnections({
        relationships: [approved.relationship]
    });
    assert(
        'public viewer receives only approved relationships',
        publicOk.visible === true &&
            publicOk.connections.length === 1 &&
            publicOk.connections[0].label === 'Land stewardship' &&
            publicOk.connections[0].authoritative === false
    );

    const pubJson = JSON.stringify(publicOk);
    assert(
        'no internal metadata leakage on public resolve',
        !pubJson.includes('admin-session-secret') &&
            !pubJson.includes('approvedBy') &&
            !pubJson.includes('suggestedBy') &&
            !pubJson.includes('sourceType') &&
            graph.findForbiddenDiscoveryPublicLeaks(publicOk).length === 0
    );

    console.log('\n[3] Reject / hide suppress public');
    const hist = graph.createDiscoveryRelationship({
        type: 'historical_context',
        label: 'Civil Rights era links'
    });
    const histAppr = graph.approveDiscoveryRelationship(hist.relationship, {
        approvedBy: 'admin-2'
    });
    const hidden = graph.hideDiscoveryRelationship(histAppr.relationship);
    assert(
        'hidden not public',
        graph.resolvePublicDiscoveryConnections({
            relationships: [hidden.relationship]
        }).connections.length === 0
    );

    const creatorLink = graph.createDiscoveryRelationship({
        type: 'creator_connection',
        label: 'Related land filmmakers',
        target: 'Community archive'
    });
    const rejected = graph.rejectDiscoveryRelationship(creatorLink.relationship, {
        rejectedBy: 'admin-2'
    });
    assert(
        'rejected not public',
        graph.resolvePublicDiscoveryConnections({
            relationships: [rejected.relationship]
        }).connections.length === 0
    );

    console.log('\n[4] Public hero package + storage separation');
    const published = auth.approveHeroPresentation(
        {
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
        },
        {
            publicTitle: 'Harvest Futures',
            publicDescription: 'Approved public copy',
            publicTheme: 'Land',
            approvedBy: 'master_hero_admin',
            actor: 'master_hero_admin',
            actorType: 'admin',
            sourceType: 'creator',
            publish: true
        }
    );
    assert('presentation publish ok', published.ok === true);

    const pubEvt = (published.recordPatch?.auditLog || []).find((e) => e.action === 'published');
    const discoveryGraph = graph.upsertDiscoveryRelationship(
        { relationships: [] },
        approved.relationship
    );
    const granted = engineMod.attachTestServerPublishGrant(
        {
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
            creatorTruth,
            ...published.recordPatch,
            discoveryGraph
        },
        {
            authorityEventId: pubEvt?.eventId || 'haevt-disc-1',
            heroId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            clientIntegrityHash: pubEvt?.integrityHash || 'fnv1a32_test'
        }
    );

    const viewer = auth.resolvePublicHeroViewerCopy(granted);
    assert(
        'public resolver returns approved discovery only',
        viewer.discoveryConnections?.visible === true &&
            viewer.discoveryConnections.connections.length === 1 &&
            viewer.discoveryConnections.authoritative === false
    );
    assert(
        'title still presentation not discovery',
        viewer.title === 'Harvest Futures' && viewer.titleSource === 'heroPresentation'
    );
    assert(
        'creatorTruth genre preserved separate from discovery',
        viewer.creatorTruth?.genre === 'Documentary'
    );

    bag.clear();
    const saved = recordMod.saveHeroRecord(granted);
    assert('discoveryGraph stored separately', Boolean(saved?.discoveryGraph?.relationships?.length));
    assert(
        'not collapsed into presentation',
        !JSON.stringify(saved.heroPresentation || {}).includes('Land stewardship')
    );
    assert(
        'not collapsed into creatorTruth',
        !JSON.stringify(saved.creatorTruth || {}).includes('Land stewardship')
    );

    console.log(
        failed === 0
            ? '\n✅ Discovery graph boundary validation PASSED\n'
            : `\n❌ ${failed} assertion(s) failed\n`
    );
    process.exit(failed === 0 ? 0 : 1);
} catch (err) {
    console.error(err);
    process.exit(1);
} finally {
    await vite.close();
}
