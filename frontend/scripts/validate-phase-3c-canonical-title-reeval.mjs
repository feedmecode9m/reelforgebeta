#!/usr/bin/env node
/**
 * Phase 3C — canonical title edit → NLP re-evaluation (no auto category PATCH).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    reevaluateAfterCanonicalTitleSave,
    persistCreatorCategoryChoice,
    canPersistCategoryForAsset,
    gatherEditorialClassificationContext
} from '../src/lib/feed/categorySuggestionReview.js';
import {
    createMemoryStorage,
    saveCreatorCatalogMetadata,
    loadCreatorCatalogMetadata
} from '../src/lib/feed/creatorCatalogMetadata.js';
import { LA_PRODUCTION_EDITORIAL_EPISODES } from '../src/lib/feed/editorialContextEvaluation.js';
import { SERIES_METADATA_STORAGE_KEY } from '../src/lib/series/seriesMetadataStorage.js';

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

console.log('\n[phase-3c-canonical-title-reeval]');

let fetchMutations = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
        fetchMutations += 1;
        throw new Error(`BLOCKED ${method}`);
    }
    return { ok: true, json: async () => ({}) };
};

console.log('\n[description authority exists]');
{
    const src = fs.readFileSync(
        path.join(root, 'src/lib/feed/creatorCatalogMetadata.js'),
        'utf8'
    );
    assert(src.includes('description'), 'description field in creator catalog metadata');
    assert(src.includes('REEL_TITLES_PERSISTENT_KEY'), 'reel_titles_persistent primary');
    const storage = createMemoryStorage();
    saveCreatorCatalogMetadata(
        'desc-auth-1',
        { title: 'ARRIVAL', description: 'Team arrives in LA for the music video production.' },
        { storage, patchCategory: false }
    );
    const meta = loadCreatorCatalogMetadata('desc-auth-1', { storage });
    assert(meta.description.includes('music video'), 'durable description loadable');
    const gathered = gatherEditorialClassificationContext(
        'desc-auth-1',
        { title: 'ARRIVAL' },
        { storage }
    );
    assert(gathered.description.includes('music video'), 'gather uses durable description');
}

console.log('\n[title edit → re-eval → suggestion display → zero category PATCH]');
{
    const storage = createMemoryStorage();
    const id = '3c-romance-1';
    // Simulate title-only save into persistent map (no category)
    saveCreatorCatalogMetadata(
        id,
        { title: 'Love Me Until Morning', description: '' },
        { storage, patchCategory: false }
    );
    const before = fetchMutations;
    const review = await reevaluateAfterCanonicalTitleSave(
        id,
        'Love Me Until Morning',
        {},
        { storage }
    );
    assert(fetchMutations === before, 're-eval display causes 0 category PATCH');
    assert(review.offer === true, 'Romance offer after title');
    assert(review.suggestedCategory === 'Romance', 'suggests Romance');
    assert(review.taxonomyFit === 'A' || review.confidence >= 0.85, 'strong taxonomy');
    assert(review.classificationState === 'STRONG_SHELF_MATCH' || review.offer, 'strong state');

    const cyber = await reevaluateAfterCanonicalTitleSave(
        '3c-cyber-1',
        'Cyber Strike: Tokyo',
        {},
        { storage }
    );
    assert(cyber.suggestedCategory === 'Cyber-Action' && cyber.offer, 'Cyber-Action control');

    const house = await reevaluateAfterCanonicalTitleSave(
        '3c-suspense-1',
        'The Last House',
        {},
        { storage }
    );
    assert(house.suggestedCategory === 'Suspense' && house.offer, 'Suspense control');
}

console.log('\n[LA Production editorial → Case F]');
{
    const storage = createMemoryStorage();
    for (const ep of LA_PRODUCTION_EDITORIAL_EPISODES) {
        const id = `3c-la-ep${ep.episodeNumber}`;
        saveCreatorCatalogMetadata(
            id,
            { title: ep.editorialTitle, description: ep.description },
            { storage, patchCategory: false }
        );
        // series companion
        const map = {};
        map[id] = {
            reelId: id,
            seriesName: ep.seriesTitle,
            episodeTitle: ep.episodeTitle,
            description: ep.description,
            seasonNumber: 1,
            episodeNumber: ep.episodeNumber
        };
        storage.setItem(SERIES_METADATA_STORAGE_KEY, JSON.stringify(map));

        const before = fetchMutations;
        const review = await reevaluateAfterCanonicalTitleSave(
            id,
            ep.editorialTitle,
            { seriesName: ep.seriesTitle, episodeTitle: ep.episodeTitle },
            { storage }
        );
        assert(fetchMutations === before, `EP${ep.episodeNumber} re-eval 0 PATCH`);
        assert(review.offer === false, `EP${ep.episodeNumber} no Accept offer`);
        assert(
            review.classificationState === 'UNDERSTOOD_NO_SHELF_FIT',
            `EP${ep.episodeNumber} Case F state (got ${review.classificationState})`
        );
        assert(review.taxonomyFit === 'F', `EP${ep.episodeNumber} taxonomy F`);
        assert(review.recommendedShelf === 'Trending', `EP${ep.episodeNumber} recommended Trending`);
        assert(
            /No valid Romance\/Cyber-Action\/Suspense/i.test(review.shelfFitReason || ''),
            `EP${ep.episodeNumber} shelf-fit reason`
        );
        assert(review.showManualHelper === true, `EP${ep.episodeNumber} manual helper`);
        console.log(
            `  · EP${ep.episodeNumber} ${ep.editorialTitle} → ${review.classificationState} / ${review.recommendedShelf}`
        );
    }
}

console.log('\n[creator lock preserved]');
{
    const storage = createMemoryStorage();
    const id = '3c-lock-1';
    saveCreatorCatalogMetadata(
        id,
        { title: 'Cyber Strike: Tokyo', category: 'Romance' },
        { storage, patchCategory: false }
    );
    const before = fetchMutations;
    const review = await reevaluateAfterCanonicalTitleSave(
        id,
        'Cyber Strike: Tokyo',
        {},
        { storage }
    );
    assert(fetchMutations === before, 'locked re-eval 0 PATCH');
    assert(review.creatorLocked === true, 'creatorLocked');
    assert(review.classificationState === 'CREATOR_LOCKED', 'CREATOR_LOCKED state');
    assert(review.currentCategory === 'Romance', 'current Romance preserved');
    assert(review.offer === false, 'Accept offer suppressed under lock');
    assert(review.suggestedCategory === 'Cyber-Action', 'NLP still diagnostic');
}

console.log('\n[explicit Accept / Override / Manual → one persist each]');
{
    const storage = createMemoryStorage();
    const id = '3c-accept-1';
    const a = persistCreatorCategoryChoice(
        id,
        { title: 'Love Me Until Morning', category: 'Romance' },
        { storage, patchCategory: false, asset: { id } }
    );
    assert(Boolean(a), 'Accept persists once (local)');
    const o = persistCreatorCategoryChoice(
        id,
        { title: 'Love Me Until Morning', category: 'Suspense' },
        { storage, patchCategory: false, asset: { id } }
    );
    assert(Boolean(o) && loadCreatorCatalogMetadata(id, { storage }).category === 'Suspense', 'Override');
    const m = persistCreatorCategoryChoice(
        id,
        { title: 'Love Me Until Morning', category: 'Cyber-Action' },
        { storage, patchCategory: false, asset: { id } }
    );
    assert(
        Boolean(m) && loadCreatorCatalogMetadata(id, { storage }).category === 'Cyber-Action',
        'Manual'
    );
    assert(
        !canPersistCategoryForAsset({ id: 'ai-black-stories-x' }).ok,
        'placeholder/demo still blocked'
    );
}

console.log('\n[UI wiring]');
{
    const vault = fs.readFileSync(
        path.join(root, 'src/components/series/VaultEpisodeCreatorStatus.svelte'),
        'utf8'
    );
    const hero = fs.readFileSync(
        path.join(root, 'src/components/studio/HeroManagerPanel.svelte'),
        'utf8'
    );
    assert(vault.includes('UNDERSTOOD / NO SHELF FIT') || vault.includes('data-nlp-case-f'), 'Vault Case F UI');
    assert(vault.includes('data-classification-state'), 'Vault classification state attr');
    assert(hero.includes('reevaluateAfterCanonicalTitleSave'), 'Hero uses reevaluate helper');
    assert(hero.includes('data-nlp-case-f') || hero.includes('UNDERSTOOD'), 'Hero Case F UI');
    assert(hero.includes('CREATOR LOCKED') || hero.includes('data-nlp-creator-lock'), 'Hero lock UI');
}

assert(fetchMutations === 0, 'total category PATCH attempts during Phase 3C = 0');

if (failed > 0) {
    console.error(`\nFAIL — ${failed}`);
    process.exit(1);
}
console.log('\nPASS — phase-3c-canonical-title-reeval');
process.exit(0);
