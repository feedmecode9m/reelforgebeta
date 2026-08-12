#!/usr/bin/env node
/**
 * Catalog metadata enrichment + category population — focused acceptance.
 */
import {
    resolveCatalogMetadata,
    applyCatalogMetadata,
    resolveCatalogTitle,
    isMeaningfulTitle,
    isMeaningfulFileName,
    deriveMetadataEvidence
} from '../src/lib/feed/catalogMetadata.js';
import { classifyContent, classifyContentSemantic } from '../src/lib/feed/contentClassifier.js';
import { mergeMediaInventory, projectCatalogCard } from '../src/lib/feed/catalogInventory.js';
import { distributeToShelves } from '../src/lib/feed/categoryDistribution.js';
import { applyShelfRotation } from '../src/lib/feed/shelfRotation.js';
import { fillShelfPresentation } from '../src/lib/feed/fillShelfPresentation.js';

let failed = 0;
/** @param {boolean} cond @param {string} label */
function assert(cond, label) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}`);
}

console.log('\n[catalog-metadata-enrichment]');

console.log('\n[A meaningful title retained]');
{
    const meta = resolveCatalogMetadata({
        title: 'Forbidden Hearts',
        fileName: 'clip_0034.mp4',
        category: 'Trending'
    });
    assert(meta.title === 'Forbidden Hearts', 'meaningful title retained');
    assert(meta.titleSource === 'upload' || meta.titleSource === 'creator', 'title provenance set');
}

console.log('\n[B UUID filename rejected as title evidence]');
{
    const meta = resolveCatalogMetadata({
        name: '550e8400-e29b-41d4-a716-446655440000',
        fileName: '550e8400-e29b-41d4-a716-446655440000.mp4',
        category: 'Trending'
    });
    assert(isMeaningfulTitle(meta.title) === false, 'UUID not meaningful title');
    assert(meta.titleSource !== 'filename' || !isMeaningfulFileName(meta.fileName), 'UUID filename not title evidence');
    assert(classifyContent(applyCatalogMetadata({}, meta)).primaryCategory === 'Trending', 'UUID → Trending');
}

console.log('\n[C camera filename rejected]');
{
    assert(isMeaningfulTitle('IMG_20250812_193455') === false, 'camera dump not meaningful');
    assert(isMeaningfulFileName('IMG_000123.JPG') === false, 'camera filename rejected');
    const c = classifyContent(
        applyCatalogMetadata({
            name: 'IMG_20250812_193455',
            fileName: 'IMG_20250812_193455.jpg',
            category: 'Trending'
        })
    );
    assert(c.primaryCategory === 'Trending', 'camera dump classifies Trending');
}

console.log('\n[D creator category wins]');
{
    const enriched = applyCatalogMetadata({
        title: 'Whatever',
        description: 'cyber hack espionage combat',
        category: 'Trending',
        creatorCategory: 'Romance'
    });
    const c = classifyContent(enriched);
    assert(c.primaryCategory === 'Romance', 'creator Romance wins over cyber keywords');
    assert(c.classificationSource === 'metadata', 'creator path is metadata');
    assert(enriched.metadataSource === 'creator', 'provenance creator');
}

console.log('\n[E strong title evidence]');
{
    const c = classifyContent(
        applyCatalogMetadata({ title: 'Forbidden Hearts Romance', category: 'Trending' })
    );
    assert(c.primaryCategory === 'Romance', 'strong title → Romance');
}

console.log('\n[F description evidence]');
{
    const c = classifyContent(
        applyCatalogMetadata({
            title: 'Episode 3',
            description: 'A haunted mystery with psychological suspense',
            category: 'Trending'
        })
    );
    assert(c.primaryCategory === 'Suspense', 'description → Suspense');
}

console.log('\n[G tags evidence]');
{
    const c = classifyContent(
        applyCatalogMetadata({
            title: 'Night Run',
            tags: ['cyber', 'hack', 'espionage'],
            category: 'Trending'
        })
    );
    assert(c.primaryCategory === 'Cyber-Action', 'tags → Cyber-Action');
}

console.log('\n[H weak filename cannot overpower stronger metadata]');
{
    const c = classifyContent(
        applyCatalogMetadata({
            title: 'Harbor Romance Kiss',
            fileName: 'agent_mission_fight.mp4',
            category: 'Trending'
        })
    );
    assert(c.primaryCategory === 'Romance', 'title Romance beats weak/filename action cues');
}

console.log('\n[I generic → Trending]');
{
    const c = classifyContent(applyCatalogMetadata({ title: 'Morning Walk', category: 'Trending' }));
    assert(c.primaryCategory === 'Trending', 'generic → Trending');
}

console.log('\n[J poster-only is real inventory]');
{
    const card = projectCatalogCard({
        id: 'poster-1',
        title: 'Still Life',
        type: 'image',
        url: 'https://cdn.example/poster-1.jpg',
        posterUrl: 'https://cdn.example/poster-1.jpg',
        category: 'Trending'
    });
    assert(card.isPlaceholder === false, 'poster-only not placeholder');
    assert(card.playable === false, 'poster-only not playable');
    assert(String(card.posterUrl).includes('.jpg'), 'poster art present');
}

console.log('\n[K poster→MP4 one card]');
{
    const step = mergeMediaInventory(
        [
            {
                id: 'same-1',
                title: 'Forbidden Hearts',
                type: 'image',
                url: 'https://cdn.example/same-1.jpg',
                posterUrl: 'https://cdn.example/same-1.jpg',
                category: 'Trending'
            }
        ],
        [
            {
                id: 'same-1',
                title: 'Forbidden Hearts',
                type: 'video',
                url: 'https://cdn.example/same-1.mp4',
                category: 'Trending'
            }
        ]
    );
    assert(step.length === 1 && step[0].playable === true, 'poster→MP4 one playable card');
    assert(String(step[0].posterUrl).includes('.jpg'), 'poster kept');
}

console.log('\n[L MP4→poster one card]');
{
    const step = mergeMediaInventory(
        [{ id: 'same-2', type: 'video', url: 'https://cdn.example/same-2.mp4', category: 'Trending' }],
        [
            {
                id: 'same-2',
                type: 'image',
                url: 'https://cdn.example/same-2.jpg',
                posterUrl: 'https://cdn.example/same-2.jpg',
                category: 'Trending'
            }
        ]
    );
    assert(step.length === 1 && step[0].playable === true, 'MP4→poster still playable');
    assert(String(step[0].posterUrl).includes('.jpg'), 'poster attached');
}

console.log('\n[M richer metadata reclassifies]');
{
    let item = {
        id: 'reclass-1',
        title: 'clip_0034',
        fileName: 'clip_0034.mp4',
        type: 'image',
        url: 'https://cdn.example/reclass-1.jpg',
        posterUrl: 'https://cdn.example/reclass-1.jpg',
        category: 'Trending'
    };
    assert(classifyContent(applyCatalogMetadata(item)).primaryCategory === 'Trending', 'start Trending');
    item = {
        ...item,
        title: 'Forbidden Hearts',
        description: 'A romance between two people separated by rival families',
        titleSource: 'creator',
        metadataSource: 'creator'
    };
    const next = classifyContent(applyCatalogMetadata(item));
    assert(next.primaryCategory === 'Romance', 'richer metadata → Romance');
    const merged = mergeMediaInventory(
        [applyCatalogMetadata({ ...item, category: 'Trending' })],
        [applyCatalogMetadata(item)]
    );
    assert(merged.length === 1, 'reclassify keeps one durable id');
}

console.log('\n[N same durable ID never duplicates]');
{
    const m = mergeMediaInventory(
        [{ id: 'dup-1', title: 'A', type: 'video', url: 'https://cdn.example/dup-1.mp4' }],
        [{ id: 'dup-1', title: 'A+', description: 'romance love kiss', type: 'video', url: 'https://cdn.example/dup-1.mp4' }]
    );
    assert(m.length === 1, 'same id → one card');
}

console.log('\n[O filename similarity different IDs]');
{
    assert(
        mergeMediaInventory(
            [],
            [
                { id: 'a', fileName: 'vacation.mp4', type: 'video', url: 'https://cdn.example/a.mp4' },
                { id: 'b', fileName: 'vacation-final.mp4', type: 'video', url: 'https://cdn.example/b.mp4' }
            ]
        ).length === 2,
        'filename-similar different IDs remain separate'
    );
}

console.log('\n[P empty non-Trending omitted]');
{
    const cards = [
        projectCatalogCard({
            id: 't1',
            title: 'Morning Walk',
            type: 'video',
            url: 'https://cdn.example/t1.mp4',
            playable: true,
            category: 'Trending'
        })
    ];
    const dist = distributeToShelves(cards, { allowSoftFallback: false });
    assert(dist.shelves.Romance.length === 0, 'no fake Romance');
    const filled = fillShelfPresentation([], 'Romance', 5, { globalRealCount: 1 });
    assert(filled.length === 0, 'empty Romance omitted / no Coming Soon');
}

console.log('\n[Q Trending remains]');
{
    const cards = [
        projectCatalogCard({
            id: 'r1',
            title: 'Harbor Romance Kiss Soulmate',
            type: 'image',
            url: 'https://cdn.example/r1.jpg',
            posterUrl: 'https://cdn.example/r1.jpg',
            category: 'Trending'
        })
    ];
    const dist = distributeToShelves(cards, { allowSoftFallback: false });
    assert(dist.shelves.Trending.length >= 1, 'Trending discovery remains');
    assert(dist.shelves.Romance.length >= 1, 'Romance primary shelf when genuine');
}

console.log('\n[R rotation stable]');
{
    const shelves = {
        Trending: [
            { id: 'a', playable: true },
            { id: 'b', playable: false }
        ]
    };
    const r1 = applyShelfRotation(shelves, { sessionSeed: 'meta-seed' });
    const r2 = applyShelfRotation(shelves, { sessionSeed: 'meta-seed' });
    assert(
        JSON.stringify(r1.Trending.map((c) => c.id)) === JSON.stringify(r2.Trending.map((c) => c.id)),
        'same seed → same order'
    );
}

console.log('\n[S metadata provenance preserved]');
{
    const meta = resolveCatalogMetadata({
        creatorTitle: 'Studio Cut',
        creatorCategory: 'Suspense',
        description: 'haunted mystery',
        fileName: 'x.mp4'
    });
    assert(meta.titleSource === 'creator', 'titleSource creator');
    assert(meta.metadataSource === 'creator', 'metadataSource creator');
    assert(meta.explicitCategory === 'Suspense', 'explicit Suspense');
    const applied = applyCatalogMetadata({ id: 'p1' }, meta);
    assert(applied.metadataSource === 'creator', 'applied provenance');
    assert(Array.isArray(applied.catalogMetadataSignals), 'evidence signals stamped');
}

console.log('\n[T NLP-ready]');
{
    const base = await classifyContentSemantic({
        title: 'Haunted Mystery Night',
        category: 'Trending'
    });
    assert(base.primaryCategory === 'Suspense', 'semantic wrapper deterministic');
    const nlp = await classifyContentSemantic(
        { title: 'x', category: 'Trending' },
        {
            nlpProvider: async () => ({
                primaryCategory: 'Romance',
                categories: ['Romance', 'Trending'],
                confidence: 0.9,
                signals: ['nlp:demo'],
                classificationSource: 'nlp'
            })
        }
    );
    assert(nlp.classificationSource === 'nlp' && nlp.primaryCategory === 'Romance', 'nlp provider contract');
}

console.log('\n[evidence helper]');
{
    const ev = deriveMetadataEvidence({
        title: 'Secret Agent Pursuit',
        description: '',
        tags: [],
        fileName: ''
    });
    assert(
        ev.candidateCategories.some(
            (c) => c.category === 'Cyber-Action' && (c.strong.length > 0 || c.weak.includes('agent'))
        ),
        'Agent Pursuit yields Cyber-Action weak/strong candidates'
    );
    const strongEv = deriveMetadataEvidence({
        title: 'Night Cyber Hack Espionage',
        description: '',
        tags: [],
        fileName: ''
    });
    assert(
        strongEv.candidateCategories.some((c) => c.category === 'Cyber-Action' && c.strong.length > 0),
        'strong cyber title yields Cyber-Action strong candidates'
    );
}

console.log('\n[title resolution order]');
{
    const t = resolveCatalogTitle({
        creatorTitle: 'Creator Wins',
        title: 'Durable Secondary',
        fileName: 'meaningful_filename_here.mp4'
    });
    assert(t.title === 'Creator Wins' && t.titleSource === 'creator', 'creator title preferred');
}

if (failed > 0) {
    console.error(`\nFAIL — ${failed} assertion(s)`);
    process.exit(1);
}
console.log('\nPASS — catalog-metadata-enrichment');
process.exit(0);
