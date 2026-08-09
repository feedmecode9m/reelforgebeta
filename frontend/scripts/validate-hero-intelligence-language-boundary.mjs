#!/usr/bin/env node
/**
 * Hero Intelligence Language Boundary
 *
 * PASS:
 * - NLP cannot modify creatorTruth
 * - discovery cannot become identity
 * - explanations require approval
 * - public viewer only receives approved intelligence
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

console.log('\nHero Intelligence Language Boundary\n');

console.log('[0] Static contracts');
const explSrc = read('src/lib/hero/heroIntelligenceExplanation.js');
assert('createIntelligenceExplanation', explSrc.includes('createIntelligenceExplanation'));
assert('validateIntelligenceExplanation', explSrc.includes('validateIntelligenceExplanation'));
assert('resolvePublicIntelligenceExplanation', explSrc.includes('resolvePublicIntelligenceExplanation'));
assert('forbids creatorTruth write', explSrc.includes('NLP_FORBIDDEN_CREATOR_FIELDS'));

const langSrc = read('src/lib/intelligence/identityLanguageResolver.js');
assert('identity language resolver', langSrc.includes('resolveIdentityLanguageSuggestions'));
assert('never silent replace', langSrc.includes('applied: false') || langSrc.includes('applied = false'));
assert('requires approval', langSrc.includes('requiresApproval'));

const recordSrc = read('src/lib/hero/heroRecord.js');
assert('HeroRecord intelligenceExplanation', recordSrc.includes('intelligenceExplanation'));

const managerSrc = read('src/components/studio/HeroManagerPanel.svelte');
assert('Master Hero Intelligence Review panel', managerSrc.includes('data-master-hero-intelligence-review'));
assert('approve explanation control', managerSrc.includes('data-intelligence-approve'));
assert('edit explanation control', managerSrc.includes('data-intelligence-edit'));
assert('hide explanation control', managerSrc.includes('data-intelligence-hide'));
assert('no auto publish allowed', managerSrc.includes('autoPublishIntelligenceExplanation'));

const heroExp = read('src/components/experiences/HeroExperience.svelte');
assert('resolver order documented', heroExp.includes('approved intelligenceExplanation'));

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
    const expl = await vite.ssrLoadModule('/src/lib/hero/heroIntelligenceExplanation.js');
    const lang = await vite.ssrLoadModule('/src/lib/intelligence/identityLanguageResolver.js');
    const auth = await vite.ssrLoadModule('/src/lib/hero/heroPresentationAuthority.js');
    const engineMod = await vite.ssrLoadModule('/src/lib/hero/heroServerAuthorityEngine.js');

    const creatorTruth = auth.captureCreatorTruth({
        title: 'Black Agriculture Legacies',
        description: 'Land ownership and community builders',
        genre: 'Documentary',
        culturalRegion: 'US South',
        identityTerms: ['Black Agriculture', 'land ownership']
    });

    console.log('\n[1] NLP cannot modify creatorTruth');
    const nlpCreateBlock = expl.createIntelligenceExplanation({
        statements: ['Exploring Black Agriculture Legacies'],
        source: 'nlp',
        title: 'Hacked Title',
        genre: 'Sci-Fi',
        creatorTruth: { title: 'Stolen' }
    });
    assert(
        'create rejects identity fields',
        nlpCreateBlock.ok === false &&
            nlpCreateBlock.errors.some((e) => e.includes('nlp_cannot_write') || e.includes('forbidden'))
    );

    const before = { ...creatorTruth };
    const after = { ...creatorTruth, title: 'NLP Renamed' };
    const nlpMutate = expl.applyNlpToCreatorTruth(before, after, {
        title: 'NLP Renamed',
        source: 'nlp'
    });
    assert('NLP cannot modify creatorTruth', nlpMutate.ok === false);
    assert('prior truth retained', nlpMutate.creatorTruth?.title === 'Black Agriculture Legacies');

    console.log('\n[2] Discovery cannot become identity');
    const discovery = expl.promoteDiscoveryToIdentity('Trending Agriculture', 'genre');
    assert('discovery cannot become identity', discovery.ok === false);
    const discLabel = lang.discoveryLabelAsIdentity('Shelf: Black Land');
    assert('discovery label not identity', discLabel.ok === false);
    const promoteHero = auth.promoteDiscoveryToHeroIdentity('Cyber-Action', 'genre');
    assert('promote discovery to hero fails', promoteHero.ok === false);

    console.log('\n[3] Explanations require approval');
    const draft = expl.createIntelligenceExplanation({
        statements: ['Exploring Black Agriculture Legacies', 'Themes detected: land, legacy'],
        source: 'nlp'
    });
    assert('draft create ok', draft.ok === true && draft.block?.approved === false);

    const unapprovedPublic = expl.resolvePublicIntelligenceExplanation({
        intelligenceExplanation: draft.block
    });
    assert(
        'explanations require approval',
        unapprovedPublic.visible === false &&
            unapprovedPublic.reason === 'explanation_requires_approval'
    );

    const auto = expl.autoPublishIntelligenceExplanation(draft.block);
    assert('AI auto publish blocked', auto.ok === false);

    const approved = expl.approveIntelligenceExplanation(draft.block, {
        approvedBy: 'admin-session-1'
    });
    assert('manual approve ok', approved.ok === true && approved.block?.approved === true);

    const publicApproved = expl.resolvePublicIntelligenceExplanation({
        intelligenceExplanation: approved.block
    });
    assert(
        'approved intelligence visible',
        publicApproved.visible === true && publicApproved.lines.length === 2
    );

    const hidden = expl.hideIntelligenceExplanation(approved.block);
    const publicHidden = expl.resolvePublicIntelligenceExplanation({
        intelligenceExplanation: hidden.block
    });
    assert('hide suppresses public', publicHidden.visible === false);

    console.log('\n[4] Public viewer only receives approved intelligence');
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
        creatorTruth,
        heroPresentation: auth.createEmptyHeroPresentation(),
        intelligenceExplanation: draft.block,
        auditLog: []
    };

    const publicDraftIntel = auth.resolvePublicHeroViewerCopy(baseRecord);
    assert(
        'public resolver hides unapproved intel',
        publicDraftIntel.intelligenceExplanation.visible === false &&
            publicDraftIntel.intelligenceExplanation.authoritative === false
    );

    const approvedRecord = {
        ...baseRecord,
        intelligenceExplanation: approved.block
    };
    const publicOk = auth.resolvePublicHeroViewerCopy(approvedRecord);
    assert(
        'public viewer receives approved intelligence',
        publicOk.intelligenceExplanation.visible === true &&
            publicOk.intelligenceExplanation.lines[0] === 'Exploring Black Agriculture Legacies'
    );
    assert('title still creatorTruth when unpublished', publicOk.titleSource === 'creatorTruth');
    assert(
        'intelligence never authoritative',
        publicOk.intelligenceExplanation.authoritative === false
    );

    // Identity language: suggestions only
    const langRes = lang.resolveIdentityLanguageSuggestions({
        historicalTerms: ['Afro-American'],
        allowSilentReplace: true
    });
    assert('silent replace rejected', langRes.applied === false);
    assert(
        'suggestions require approval',
        langRes.requiresMasterHeroAdminApproval === true &&
            langRes.suggestions.every((s) => s.requiresApproval && s.applied === false)
    );
    assert(
        'original preserved',
        langRes.preservedTerms.some((t) => /afro/i.test(t))
    );
    const apply = lang.applySuggestedIdentityLanguage('Afro-American', 'African American', {
        approved: true,
        approvedBy: 'admin'
    });
    assert('cannot auto-apply language', apply.ok === false && apply.applied === false);

    // Validate module validation fails if approved without metadata stripped
    const fakeApproved = expl.validateIntelligenceExplanation({
        source: 'nlp',
        approved: true,
        approvedBy: '',
        approvedAt: null,
        statements: ['x']
    });
    assert(
        'validate requires approval metadata',
        fakeApproved.ok === false || fakeApproved.block.approved === false
    );

    console.log(
        failed === 0
            ? '\n✅ Hero intelligence language boundary validation PASSED\n'
            : `\n❌ ${failed} assertion(s) failed\n`
    );
    process.exit(failed === 0 ? 0 : 1);
} catch (err) {
    console.error(err);
    process.exit(1);
} finally {
    await vite.close();
}
