#!/usr/bin/env node
/**
 * Creator Intent Boundary (Phase 11)
 *
 * PASS:
 * - private notes never reach viewer
 * - AI cannot create intent
 * - approval required
 * - provenance preserved
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

console.log('\nCreator Intent Boundary (Phase 11)\n');

console.log('[0] Static contracts');
const intentSrc = read('src/lib/hero/creatorIntentContext.js');
assert('createCreatorIntentContext', intentSrc.includes('createCreatorIntentContext'));
assert('validateCreatorIntentContext', intentSrc.includes('validateCreatorIntentContext'));
assert('resolvePublicCreatorIntent', intentSrc.includes('resolvePublicCreatorIntent'));
assert('blocked AI sources', intentSrc.includes('ai_cannot_create_intent'));

const recordSrc = read('src/lib/hero/heroRecord.js');
assert('HeroRecord creatorIntentContext', recordSrc.includes('creatorIntentContext'));

const authoritySrc = read('src/lib/hero/heroPresentationAuthority.js');
assert('public resolve includes creatorIntent', authoritySrc.includes('creatorIntent:'));

const managerSrc = read('src/components/studio/HeroManagerPanel.svelte');
assert('Creator Intent Context panel', managerSrc.includes('data-master-hero-creator-intent'));
assert('draft control', managerSrc.includes('data-creator-intent-draft'));
assert('approve control', managerSrc.includes('data-creator-intent-approve'));
assert('hide control', managerSrc.includes('data-creator-intent-hide'));

const heroExp = read('src/components/experiences/HeroExperience.svelte');
assert('creator intent UI', heroExp.includes('data-creator-intent'));
assert(
    'order: intent before intelligence',
    heroExp.includes('approved creatorIntentContext') &&
        heroExp.indexOf('data-creator-intent') < heroExp.indexOf('data-intelligence-explanation')
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
    const intent = await vite.ssrLoadModule('/src/lib/hero/creatorIntentContext.js');
    const auth = await vite.ssrLoadModule('/src/lib/hero/heroPresentationAuthority.js');
    const engineMod = await vite.ssrLoadModule('/src/lib/hero/heroServerAuthorityEngine.js');
    const recordMod = await vite.ssrLoadModule('/src/lib/hero/heroRecord.js');

    console.log('\n[1] AI cannot create intent');
    const fromAi = intent.createCreatorIntentContext({
        publicText: 'AI invented meaning',
        source: 'nlp',
        suppliedBy: 'gpt'
    });
    assert(
        'AI cannot create intent',
        fromAi.ok === false && fromAi.errors.includes('ai_cannot_create_intent')
    );
    assert('createIntentFromAi blocked', intent.createIntentFromAi({ text: 'x' }).ok === false);
    assert(
        'createIntentFromDiscovery blocked',
        intent.createIntentFromDiscovery({ text: 'x' }).ok === false
    );

    console.log('\n[2] Creator draft + approval required');
    const created = intent.createCreatorIntentContext({
        privateNotes: ['SECRET_PRIVATE_NOTE_NEVER_PUBLIC'],
        publicText: 'This hero preserves land ownership stories.',
        source: 'creator',
        suppliedBy: 'creator-user-1'
    });
    assert('creator draft ok', created.ok === true);
    assert(
        'provenance preserved on create',
        created.context?.provenance?.source === 'creator' &&
            created.context?.provenance?.suppliedBy === 'creator-user-1'
    );
    assert(
        'private notes stored',
        created.context?.privateNotes?.includes('SECRET_PRIVATE_NOTE_NEVER_PUBLIC')
    );

    const unapproved = intent.resolvePublicCreatorIntent(created.context);
    assert(
        'approval required',
        unapproved.visible === false && unapproved.reason === 'intent_requires_approval'
    );
    assert('private notes never on public resolve', !JSON.stringify(unapproved).includes('SECRET_'));

    const auto = intent.autoPublishCreatorIntent(created.context);
    assert('auto publish blocked', auto.ok === false);

    const approved = intent.approveCreatorIntentContext(created.context, {
        approvedBy: 'admin-session-secret'
    });
    assert('approve ok', approved.ok === true && approved.context?.publicStatement?.approved === true);
    assert(
        'provenance preserved after approve',
        approved.context?.provenance?.source === 'creator' &&
            approved.context?.provenance?.suppliedBy === 'creator-user-1'
    );

    const publicOk = intent.resolvePublicCreatorIntent(approved.context);
    assert(
        'public statement visible when approved',
        publicOk.visible === true &&
            publicOk.text === 'This hero preserves land ownership stories.' &&
            publicOk.authoritative === false
    );
    const pubJson = JSON.stringify(publicOk);
    assert(
        'private notes never reach viewer',
        !pubJson.includes('SECRET_') &&
            !pubJson.includes('privateNotes') &&
            !pubJson.includes('admin-session-secret') &&
            !pubJson.includes('approvedBy') &&
            intent.findForbiddenPublicIntentLeaks(publicOk).length === 0
    );

    const hidden = intent.hideCreatorIntentContext(approved.context);
    assert(
        'hidden suppresses public',
        intent.resolvePublicCreatorIntent(hidden.context).visible === false
    );

    console.log('\n[3] Public hero package integration');
    const creatorTruth = auth.captureCreatorTruth({
        title: 'Black Agriculture Legacies',
        description: 'Land ownership archive',
        genre: 'Documentary'
    });

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
            creatorIntentContext: approved.context
        },
        {
            authorityEventId: pubEvt?.eventId || 'haevt-intent-1',
            heroId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            clientIntegrityHash: pubEvt?.integrityHash || 'fnv1a32_test'
        }
    );

    const viewer = auth.resolvePublicHeroViewerCopy(granted);
    assert(
        'viewer creator intent visible',
        viewer.creatorIntent?.visible === true &&
            viewer.creatorIntent?.text === 'This hero preserves land ownership stories.'
    );
    assert(
        'viewer package omits private notes',
        !JSON.stringify(viewer.creatorIntent || {}).includes('SECRET_') &&
            viewer.adminContext === null
    );

    bag.clear();
    const saved = recordMod.saveHeroRecord(granted);
    assert(
        'private notes persisted on record',
        saved?.creatorIntentContext?.privateNotes?.includes('SECRET_PRIVATE_NOTE_NEVER_PUBLIC')
    );
    assert(
        'provenance preserved in storage',
        saved?.creatorIntentContext?.provenance?.source === 'creator' &&
            saved?.creatorIntentContext?.provenance?.suppliedBy === 'creator-user-1'
    );

    // Reject approve of AI-sourced context
    const aiReject = intent.approveCreatorIntentContext(
        {
            privateNotes: [],
            publicStatement: { text: 'fake', approved: false },
            provenance: { source: 'ai', suppliedBy: 'model' }
        },
        { approvedBy: 'admin' }
    );
    assert(
        'cannot approve AI invent intent',
        aiReject.ok === false && aiReject.errors.some((e) => e.includes('ai_cannot_create_intent'))
    );

    console.log(
        failed === 0
            ? '\n✅ Creator intent boundary validation PASSED\n'
            : `\n❌ ${failed} assertion(s) failed\n`
    );
    process.exit(failed === 0 ? 0 : 1);
} catch (err) {
    console.error(err);
    process.exit(1);
} finally {
    await vite.close();
}
