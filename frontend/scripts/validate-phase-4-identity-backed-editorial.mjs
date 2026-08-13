#!/usr/bin/env node
/**
 * Phase 4 prep — identity-backed editorial review validator.
 * Proves exact identity ≠ title/category write; missing authority blocks NLP decisions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    PHASE4_EXACT_MEDIA_IDENTITY,
    PHASE4_PROVISIONAL_EPISODE_GUIDE,
    buildPhase4IdentityBackedReview,
    buildIdentityBackedEditorialRow,
    applyIdentityBackedCategoryDecision,
    resolveEditorialMetadataStatus,
    canEnableEditorialCategoryActions,
    identityAloneMustNotPersist
} from '../src/lib/feed/identityBackedEditorialReview.js';
import {
    createMemoryStorage,
    loadCreatorCatalogMetadata,
    saveCreatorCatalogMetadata
} from '../src/lib/feed/creatorCatalogMetadata.js';
import { canPersistCategoryForAsset } from '../src/lib/feed/categorySuggestionReview.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let failed = 0;
function assert(cond, label) {
    if (cond) console.log(`  ✓ ${label}`);
    else {
        failed += 1;
        console.error(`  ✗ ${label}`);
    }
}

console.log('\n[phase-4-identity-backed-editorial]');

let fetchMutations = 0;
let titleMapWrites = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_input, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
        fetchMutations += 1;
        throw new Error(`BLOCKED ${method}`);
    }
    return { ok: true, json: async () => ([]) };
};

console.log('\n[six exact identity mappings]');
{
    assert(PHASE4_EXACT_MEDIA_IDENTITY.length === 6, 'six exact identities registered');
    assert(
        PHASE4_EXACT_MEDIA_IDENTITY.every((r) => r.identityConfidence === 'EXACT'),
        'all identityConfidence EXACT'
    );
    const ids = PHASE4_EXACT_MEDIA_IDENTITY.map((r) => r.productionId);
    assert(new Set(ids).size === 6, 'unique production IDs');
    assert(
        ids.includes('03ef898a-989f-42c3-bdbb-67f37338df65') &&
            ids.includes('201ec6ee-6822-4bda-9295-080beb6f4e35'),
        'arrival + amp identities present'
    );
}

console.log('\n[missing-authority / waiting state]');
{
    const beforeFetch = fetchMutations;
    const report = await buildPhase4IdentityBackedReview();
    assert(fetchMutations === beforeFetch, 'building review does not PATCH');
    assert(report.waitingCount === 6, 'all six waiting for authoritative metadata');
    assert(report.authoritativeCount === 0, 'zero authoritative without coworker list');
    for (const row of report.rows) {
        assert(row.workflowState === 'WAITING_FOR_AUTHORITATIVE_METADATA', `${row.productionId} waiting`);
        assert(row.metadataStatus === 'PROVISIONAL' || row.metadataStatus === 'MISSING', `${row.productionId} not AUTHORITATIVE`);
        assert(row.nlpRan === false, `${row.productionId} NLP not run as production decision`);
        assert(row.actionsEnabled === false, `${row.productionId} actions disabled`);
        assert(
            !canEnableEditorialCategoryActions(row),
            `${row.productionId} canEnable false`
        );
    }
}

console.log('\n[identity alone must not persist]');
{
    const safety = identityAloneMustNotPersist();
    assert(safety.writesTitle === false, 'identity alone writesTitle=false');
    assert(safety.writesDescription === false, 'identity alone writesDescription=false');
    assert(safety.patchesCategory === false, 'identity alone patchesCategory=false');
    const storage = createMemoryStorage();
    const id = PHASE4_EXACT_MEDIA_IDENTITY[0].productionId;
    const before = loadCreatorCatalogMetadata(id, { storage });
    const row = await buildIdentityBackedEditorialRow(
        { productionId: id, currentProductionTitle: '01 ARRIVAL OPEN v1' },
        { storage }
    );
    const blocked = applyIdentityBackedCategoryDecision(
        row,
        { action: 'accept', category: 'Romance' },
        { storage, patchCategory: true }
    );
    assert(blocked.ok === false, 'Accept blocked without authoritative metadata');
    assert(
        blocked.reason === 'WAITING_FOR_AUTHORITATIVE_METADATA',
        'block reason WAITING_FOR_AUTHORITATIVE_METADATA'
    );
    const after = loadCreatorCatalogMetadata(id, { storage });
    assert(after.title === before.title, 'no title write from identity-only Accept attempt');
    assert(after.category === before.category, 'no category write from identity-only Accept');
    assert(fetchMutations === 0, 'no category PATCH from blocked Accept');
}

console.log('\n[provisional episode-guide cannot become production metadata]');
{
    const status = resolveEditorialMetadataStatus({
        productionId: PHASE4_EXACT_MEDIA_IDENTITY[0].productionId,
        provisionalTitle: 'ARRIVAL'
    });
    assert(status.status === 'PROVISIONAL', 'provisional status');
    assert(status.workflowState === 'WAITING_FOR_AUTHORITATIVE_METADATA', 'provisional waits');
    assert(status.editorialTitle === '', 'provisional title not promoted to editorialTitle');
    assert(PHASE4_PROVISIONAL_EPISODE_GUIDE.length === 6, 'six provisional context labels');
}

console.log('\n[filename-only cannot persist category]');
{
    const storage = createMemoryStorage();
    const row = await buildIdentityBackedEditorialRow(
        {
            productionId: 'filename-only-fake',
            currentProductionTitle: '01_ARRIVAL_OPEN_v1.mp4',
            // trying to sneak filename as authority without flag
            authoritativeTitle: '01_ARRIVAL_OPEN_v1.mp4',
            authoritativeDescription: ''
        },
        { storage }
    );
    assert(row.metadataStatus !== 'AUTHORITATIVE', 'filename without description not authoritative');
    const attempt = applyIdentityBackedCategoryDecision(
        {
            ...row,
            metadataStatus: 'MISSING',
            identityConfidence: 'EXACT',
            productionId: PHASE4_EXACT_MEDIA_IDENTITY[0].productionId,
            actionsEnabled: false
        },
        { action: 'manual', category: 'Romance' },
        { storage, patchCategory: true }
    );
    assert(attempt.ok === false, 'filename-only persist blocked');
}

console.log('\n[authoritative fixture reaches existing NLP/review pipeline]');
{
    const storage = createMemoryStorage();
    const id = '03ef898a-989f-42c3-bdbb-67f37338df65';
    const beforeFetch = fetchMutations;
    const row = await buildIdentityBackedEditorialRow(
        {
            productionId: id,
            currentProductionTitle: '01 ARRIVAL OPEN v1',
            editorialAuthority: 'authoritative',
            authoritativeTitle: 'Love Me Until Morning',
            authoritativeDescription:
                'A romantic love story about soulmates kissing under the stars, their wedding and forever passion.'
        },
        { storage }
    );
    assert(fetchMutations === beforeFetch, 'authoritative NLP review does not PATCH');
    assert(row.metadataStatus === 'AUTHORITATIVE', 'AUTHORITATIVE when fixture supplied');
    assert(row.nlpRan === true, 'NLP ran for authoritative fixture');
    assert(row.suggestedCategory === 'Romance', 'Romance suggestion via existing pipeline');
    assert(row.actionsEnabled === true, 'actions enabled for authoritative + EXACT');
    assert(row.workflowState === 'READY_FOR_CREATOR_REVIEW', 'ready for creator review');

    // Explicit Accept with patchCategory false (local) — proves path, not production
    const saved = applyIdentityBackedCategoryDecision(
        row,
        { action: 'accept', category: 'Romance', title: row.editorialTitle },
        { storage, patchCategory: false }
    );
    assert(saved.ok === true, 'Accept persists via existing creator path (local)');
    assert(
        loadCreatorCatalogMetadata(id, { storage }).category === 'Romance',
        'creator category Romance after Accept'
    );
}

console.log('\n[creator lock protected]');
{
    const storage = createMemoryStorage();
    const id = 'd2aafde7-d7ba-492c-a860-20b51f7f4033';
    saveCreatorCatalogMetadata(
        id,
        { title: 'Locked Title', category: 'Suspense' },
        { storage, patchCategory: false }
    );
    const row = await buildIdentityBackedEditorialRow(
        {
            productionId: id,
            editorialAuthority: 'authoritative',
            authoritativeTitle: 'Cyber Strike: Tokyo',
            authoritativeDescription:
                'A cyberpunk hacker breach in neon Tokyo with combat operatives and digital warfare.'
        },
        { storage }
    );
    assert(row.creatorLocked === true, 'creatorLocked when category authored');
    const blocked = applyIdentityBackedCategoryDecision(
        { ...row, creatorLocked: true },
        { action: 'accept', category: 'Cyber-Action' },
        { storage, patchCategory: false }
    );
    assert(blocked.ok === false && blocked.reason === 'creator-lock', 'Accept blocked by creator lock');
    assert(
        loadCreatorCatalogMetadata(id, { storage }).category === 'Suspense',
        'Suspense lock preserved'
    );
}

console.log('\n[placeholder safety]');
{
    assert(!canPersistCategoryForAsset({ id: 'ai-black-stories-1' }).ok, 'demo id blocked');
    assert(!canPersistCategoryForAsset({ isPlaceholder: true, id: 'x' }).ok, 'placeholder blocked');
}

console.log('\n[UI wiring]');
{
    const panel = fs.readFileSync(
        path.join(root, 'src/components/studio/IdentityBackedEditorialReviewPanel.svelte'),
        'utf8'
    );
    const studio = fs.readFileSync(
        path.join(root, 'src/components/experiences/StudioExperience.svelte'),
        'utf8'
    );
    assert(panel.includes('data-identity-backed-editorial-review'), 'panel marker');
    assert(panel.includes('WAITING_FOR_AUTHORITATIVE_METADATA'), 'waiting copy');
    assert(panel.includes('data-actions-enabled'), 'actions enabled attr');
    assert(studio.includes('IdentityBackedEditorialReviewPanel'), 'Studio mounts panel');
}

assert(fetchMutations === 0, 'total production category PATCH attempts = 0');
assert(titleMapWrites === 0, 'no accidental title-map write counter');

const reportPath = path.join(root, 'artifacts', 'phase-4-identity-backed-editorial-report.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(
    reportPath,
    JSON.stringify(
        {
            phase: 'PHASE-4-IDENTITY-BACKED-EDITORIAL',
            status: 'PREP_COMPLETE_WAITING_FOR_AUTHORITATIVE_METADATA',
            exactIdentities: PHASE4_EXACT_MEDIA_IDENTITY.length,
            categoryPatchCount: fetchMutations,
            titleWrites: 0,
            descriptionWrites: 0,
            deploy: 0
        },
        null,
        2
    )
);
console.log(`  · wrote ${reportPath}`);

if (failed > 0) {
    console.error(`\nFAIL — ${failed}`);
    process.exit(1);
}
console.log('\nPASS — phase-4-identity-backed-editorial');
process.exit(0);
