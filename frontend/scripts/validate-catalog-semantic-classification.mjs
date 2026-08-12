#!/usr/bin/env node
/**
 * Semantic classification + metadata enrichment — focused acceptance.
 */
import {
    classifyContent,
    classifyContentSemantic,
    normalizeClassificationMetadata,
    detectShelfFromTitle,
    isGenericMediaLabel,
    normalizeDiscoveryShelf
} from '../src/lib/feed/contentClassifier.js';
import {
    mergeMediaInventory,
    projectCatalogCard
} from '../src/lib/feed/catalogInventory.js';
import { distributeToShelves } from '../src/lib/feed/categoryDistribution.js';

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

console.log('\n[catalog-semantic-classification]');

console.log('\n[metadata normalization]');
{
    const meta = normalizeClassificationMetadata({
        name: '94E28916-619A-4356-88E7-90D1C71CAC2D.PNG',
        fileName: 'e1f08f0f-954f-4c39-848b-9f3fc72b5d02.png',
        category: 'HERO',
        type: 'image',
        tags: ['ignored-for-structure']
    });
    assert(meta.titleIsGeneric === true, 'UUID-like title marked generic');
    assert(meta.fileNameIsGeneric === true, 'UUID filename marked generic');
    assert(meta.normalizedCategory === 'Trending', 'HERO → Trending soft');
    assert(isGenericMediaLabel('IMG_0113.JPEG') === true, 'camera dump generic');
    assert(isGenericMediaLabel('Midnight Romance Kiss') === false, 'semantic title not generic');
}

console.log('\n[explicit category]');
{
    const c = classifyContent({ title: 'Anything', category: 'Suspense' });
    assert(c.primaryCategory === 'Suspense', 'explicit Suspense wins');
    assert(c.classificationSource === 'metadata', 'source metadata');
    assert(c.confidence === 1, 'explicit confidence 1');
}

console.log('\n[Romance]');
{
    const c = classifyContent({
        title: 'Harbor Romance',
        description: 'A love story about soulmate destiny',
        category: 'Trending'
    });
    assert(c.primaryCategory === 'Romance', 'Romance from strong title/description');
    assert(c.categories.includes('Trending'), 'Romance also lists Trending discovery');
    assert(c.classificationSource === 'keyword', 'Romance keyword source');
    assert(c.confidence > 0.5, 'Romance confidence > 0.5');
}

console.log('\n[Suspense]');
{
    const c = classifyContent({
        title: 'The Haunted Mystery',
        tags: ['suspense', 'psychological'],
        category: 'Trending'
    });
    assert(c.primaryCategory === 'Suspense', 'Suspense from strong signals');
    assert(c.signals.some((s) => s.includes('strong:')), 'Suspense strong signals present');
}

console.log('\n[Cyber-Action]');
{
    const c = classifyContent({
        title: 'Night Cyber Hack',
        description: 'Espionage combat mission downtown',
        category: 'Trending'
    });
    assert(c.primaryCategory === 'Cyber-Action', 'Cyber-Action from strong signals');
    assert(normalizeDiscoveryShelf('Action') === 'Cyber-Action', 'Action alias → Cyber-Action only');
}

console.log('\n[Trending fallback / weak words]');
{
    const ambiguous = classifyContent({ title: 'Morning Walk', category: 'Trending' });
    assert(ambiguous.primaryCategory === 'Trending', 'ambiguous → Trending');
    assert(ambiguous.classificationSource === 'fallback', 'ambiguous fallback source');

    const weakOnly = classifyContent({
        title: 'Dark Danger Secret',
        category: 'Trending'
    });
    assert(weakOnly.primaryCategory === 'Trending', 'weak generics alone → Trending');

    const actionOnly = classifyContent({ title: 'Big Action Night', category: 'Trending' });
    assert(actionOnly.primaryCategory === 'Trending', 'weak "action" alone → Trending');

    assert(detectShelfFromTitle('hot new special clip') === 'Trending', 'weak trending words alone stay Trending');
}

console.log('\n[generic filename no false category]');
{
    const c = classifyContent({
        title: 'IMG_0113.JPEG',
        fileName: 'b82062ed-7be9-4e3a-8193-f5d66b98f237.jpeg',
        category: 'Trending'
    });
    assert(c.primaryCategory === 'Trending', 'generic filename/title → Trending');
    assert(!c.signals.some((s) => s.startsWith('filename:strong:')), 'no filename strong false hit');
}

console.log('\n[multiple categories → deterministic primary]');
{
    const a = classifyContent({
        title: 'Romance love kiss meets cyber hack espionage',
        category: 'Trending'
    });
    const b = classifyContent({
        title: 'Romance love kiss meets cyber hack espionage',
        category: 'Trending'
    });
    assert(a.primaryCategory === b.primaryCategory, 'deterministic same input → same primary');
    assert(
        a.primaryCategory === 'Romance' || a.primaryCategory === 'Cyber-Action',
        `multi-signal primary is deterministic shelf (got ${a.primaryCategory})`
    );
}

console.log('\n[progressive reclassification]');
{
    const poster = {
        id: 'prog-1',
        title: 'Untitled Still',
        type: 'image',
        url: 'https://cdn.example/prog-1.jpg',
        posterUrl: 'https://cdn.example/prog-1.jpg',
        category: 'Trending'
    };
    const c0 = classifyContent(poster);
    assert(c0.primaryCategory === 'Trending', 'initial poster → Trending');

    const withMeta = {
        ...poster,
        title: 'Midnight Romance',
        description: 'A love story of soulmate passion'
    };
    const c1 = classifyContent(withMeta);
    assert(c1.primaryCategory === 'Romance', 'later metadata → Romance');

    const withMp4 = mergeMediaInventory([withMeta], [
        {
            id: 'prog-1',
            title: 'Midnight Romance',
            description: 'A love story of soulmate passion',
            type: 'video',
            url: 'https://cdn.example/prog-1.mp4',
            video_url: 'https://cdn.example/prog-1.mp4',
            category: 'Trending'
        }
    ]);
    assert(withMp4.length === 1, 'progressive MP4 enrichment → one card');
    assert(withMp4[0].playable === true, 'progressive MP4 playable');
    assert(String(withMp4[0].posterUrl).includes('.jpg'), 'progressive poster preserved');
    const c2 = classifyContent(withMp4[0]);
    assert(c2.primaryCategory === 'Romance', 'after MP4, stronger Romance evidence kept');
}

console.log('\n[identity safety]');
{
    const poster = {
        id: 'id-1',
        type: 'image',
        url: 'https://cdn.example/id-1.jpg',
        posterUrl: 'https://cdn.example/id-1.jpg',
        category: 'Trending'
    };
    const mp4 = {
        id: 'id-1',
        type: 'video',
        url: 'https://cdn.example/id-1.mp4',
        category: 'Trending',
        title: 'Cyber Hack Espionage'
    };
    const p2m = mergeMediaInventory([poster], [mp4]);
    assert(p2m.length === 1 && p2m[0].playable === true, 'poster→MP4 identity preserved');
    const m2p = mergeMediaInventory([mp4], [poster]);
    assert(m2p.length === 1 && String(m2p[0].posterUrl).includes('.jpg'), 'MP4→poster identity preserved');

    const sep = mergeMediaInventory(
        [],
        [
            { id: 'a', fileName: 'vacation.mp4', type: 'video', url: 'https://cdn.example/a.mp4' },
            { id: 'b', fileName: 'vacation-final.mp4', type: 'video', url: 'https://cdn.example/b.mp4' }
        ]
    );
    assert(sep.length === 2, 'filename-similar different IDs remain separate');
}

console.log('\n[no fake category padding]');
{
    const cards = [
        projectCatalogCard(
            { id: 't1', title: 'Morning Walk', type: 'video', url: 'https://cdn.example/t1.mp4', playable: true, category: 'Trending' },
            { classification: classifyContent({ title: 'Morning Walk', category: 'Trending' }) }
        )
    ];
    const dist = distributeToShelves(cards, { allowSoftFallback: false });
    assert(dist.shelves.Romance.length === 0, 'no fake Romance padding');
    assert(dist.shelves.Suspense.length === 0, 'no fake Suspense padding');
    assert(dist.shelves['Cyber-Action'].length === 0, 'no fake Cyber-Action padding');
    assert(dist.shelves.Trending.length >= 1, 'Trending remains fallback shelf');
}

console.log('\n[NLP-ready contract]');
{
    const base = await classifyContentSemantic({ title: 'Haunted Mystery Night', category: 'Trending' });
    assert(base.primaryCategory === 'Suspense', 'semantic wrapper defaults to deterministic');
    const nlp = await classifyContentSemantic(
        { title: 'Whatever', category: 'Trending' },
        {
            nlpProvider: async () => ({
                primaryCategory: 'Romance',
                categories: ['Romance', 'Trending'],
                confidence: 0.88,
                signals: ['nlp:demo'],
                classificationSource: 'nlp'
            })
        }
    );
    assert(nlp.primaryCategory === 'Romance', 'nlp provider contract honored');
    assert(nlp.classificationSource === 'nlp', 'nlp source preserved');
    assert(typeof nlp.confidence === 'number' && Array.isArray(nlp.signals), 'nlp shape intact');
}

if (failed > 0) {
    console.error(`\nFAIL — ${failed} assertion(s)`);
    process.exit(1);
}
console.log('\nPASS — catalog-semantic-classification');
process.exit(0);
