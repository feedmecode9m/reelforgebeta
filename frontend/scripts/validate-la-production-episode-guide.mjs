#!/usr/bin/env node
/**
 * Los Angeles Production All Episodes editorial overlay — contract tests.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    isLosAngelesProductionFamily,
    matchLaProductionEpisodeNumber,
    presentLaProductionEpisode,
    presentLaProductionSeries,
    presentLaProductionHeader,
    LA_PRODUCTION_SERIES_TITLE
} from '../src/lib/series/laProductionEpisodeGuide.js';
import {
    overlayLaProductionForClassification,
    presentEpisodeOperationTitle,
    seedContentIntelligenceFromLaGuide,
    suggestCreatorCatalogEpisodeFields,
    suggestCreatorCatalogSeriesFields,
    LA_PRODUCTION_STUDIO_SERIES_TITLE
} from '../src/lib/series/laProductionStudioEnrichment.js';

let failed = 0;
function assert(label, cond) {
    if (cond) console.log(`  ✓ ${label}`);
    else {
        failed += 1;
        console.error(`  ✗ ${label}`);
    }
}

console.log('\n[la-production-episode-guide]');

assert(
    'lone Arrival OPEN is not this production family',
    !isLosAngelesProductionFamily(['01 ARRIVAL OPEN v1'])
);

assert(
    'SET SHOOTING PT1 + PT2 is the production family',
    isLosAngelesProductionFamily(['04_SET_SHOOTING_PT 1_V1.mp4', '05_SET_SHOOTING_PT 2_V1.mp4'])
);

assert('PT 1 maps to episode 3', matchLaProductionEpisodeNumber('04_SET_SHOOTING_PT 1_V1') === 3);
assert('PT 2 maps to episode 4', matchLaProductionEpisodeNumber('05_SET_SHOOTING_PT 2_V1') === 4);
assert('Poom Poom maps to episode 2', matchLaProductionEpisodeNumber('POOM POOM TUESDAY') === 2);

const family = ['04_SET_SHOOTING_PT 1_V1.mp4', '05_SET_SHOOTING_PT 2_V1.mp4', '06_CONDO_WIND_DOWN.mp4'];
const partOne = presentLaProductionEpisode({
    familyItems: family,
    title: '04_SET_SHOOTING_PT 1_V1',
    currentTitle: '04_SET_SHOOTING_PT 1_V1',
    episodeNumber: 4
});
assert(partOne.active === true, 'overlay active for SET SHOOTING family');
assert(partOne.title === 'Soundstage Shoot: Part One', `PT1 title (got ${partOne.title})`);
assert(/soundstage/i.test(partOne.description), 'PT1 uses guide description');

const series = presentLaProductionSeries({ familyItems: family, episodeCount: 3 });
assert(series.active === true, 'series chrome active');
assert(series.seriesTitle === LA_PRODUCTION_SERIES_TITLE, 'series title from guide');
assert(/Vic-G/i.test(series.synopsis), 'series synopsis from guide');

const stirred = presentLaProductionEpisode({
    familyItems: family,
    title: 'STIRRED 1',
    currentTitle: 'STIRRED 1',
    episodeNumber: 1
});
assert(
    stirred.title === 'STIRRED 1' || stirred.title === '',
    `STIRRED keeps its title (got ${stirred.title})`
);
assert(!/Arrival/i.test(stirred.title), 'STIRRED is not overwritten with Arrival');

const creatorKept = presentLaProductionEpisode({
    familyItems: family,
    title: 'Soundstage Shoot: Part One',
    currentTitle: 'My Custom Master Edit',
    episodeNumber: 3
});
assert(
    creatorKept.title === 'My Custom Master Edit',
    `creator Master Edit wins (got ${creatorKept.title})`
);

const solo = presentLaProductionEpisode({
    familyItems: ['Motherland'],
    title: '04_SET_SHOOTING_PT 1_V1',
    currentTitle: 'Motherland',
    fileName: '04_SET_SHOOTING_PT 1_V1.mp4'
});
assert(solo.active === true, 'solo SET SHOOTING vault MP4 overlays without a sibling family');
assert(solo.title === 'Soundstage Shoot: Part One', `solo PT1 title (got ${solo.title})`);
assert(/soundstage/i.test(solo.description), 'solo PT1 description from guide');

const arrivalSolo = presentLaProductionEpisode({
    familyItems: ['Motherland'],
    title: '01 ARRIVAL OPEN v1',
    currentTitle: '01 ARRIVAL OPEN v1'
});
assert(arrivalSolo.active === false, 'lone Arrival OPEN still does not overlay');

const header = presentLaProductionHeader({
    familyItems: ['Motherland'],
    seriesTitle: 'Motherland',
    episodeCount: 1,
    selectedTitle: '04_SET_SHOOTING_PT 1_V1',
    selectedFileName: '04_SET_SHOOTING_PT 1_V1.mp4'
});
assert(header.headingTitle === 'Soundstage Shoot: Part One', `header title (got ${header.headingTitle})`);
assert(header.countLine === '1 episode', `header count (got ${header.countLine})`);
assert(/soundstage/i.test(header.description), 'header description sits with title + count');

const arrivalHeader = presentLaProductionHeader({
    familyItems: ['Vic G', 'Arrival'],
    seriesTitle: 'Arrival',
    episodeCount: 2,
    selectedTitle: 'Arrival'
});
assert(arrivalHeader.headingTitle === 'Arrival', `Arrival header title (got ${arrivalHeader.headingTitle})`);
assert(arrivalHeader.countLine === '2 episodes', `Arrival header count (got ${arrivalHeader.countLine})`);
assert(/arrive in Los Angeles/i.test(arrivalHeader.description), 'Arrival PDF wording under All Episodes');

const catalogEp = suggestCreatorCatalogEpisodeFields(
    { title: '04_SET_SHOOTING_PT 1_V1', episodeNumber: 1, description: '' },
    ['04_SET_SHOOTING_PT 1_V1.mp4', '05_SET_SHOOTING_PT 2_V1.mp4'],
    { fileName: '04_SET_SHOOTING_PT 1_V1.mp4' }
);
assert(catalogEp.active === true, 'Creator Catalog suggestion active');
assert(catalogEp.title === 'Soundstage Shoot: Part One', `catalog title (got ${catalogEp.title})`);
assert(/soundstage/i.test(catalogEp.description), 'catalog description from guide');

const catalogSeries = suggestCreatorCatalogSeriesFields(
    { title: 'Motherland', description: '' },
    ['04_SET_SHOOTING_PT 1_V1.mp4', 'Arrival']
);
assert(catalogSeries.active === true, 'Creator Catalog series suggestion active');
assert(
    catalogSeries.seriesTitle === LA_PRODUCTION_STUDIO_SERIES_TITLE,
    `series title is production not Motherland (got ${catalogSeries.seriesTitle})`
);
assert(/Vic-G and the team arrive/i.test(catalogSeries.seriesDescription), 'series description from guide');

const opsTitle = presentEpisodeOperationTitle({
    episodeTitle: 'Motherland',
    episodeNumber: 3,
    familyItems: ['04_SET_SHOOTING_PT 1_V1.mp4'],
    reel: { fileName: '04_SET_SHOOTING_PT 1_V1.mp4' }
});
assert(opsTitle === 'Soundstage Shoot: Part One', `Episode Operations title (got ${opsTitle})`);

const classified = overlayLaProductionForClassification(
    { title: 'Arrival', name: 'Arrival', description: '' },
    [{ title: 'Arrival' }]
);
assert(classified.enrichmentTitle === 'Arrival', 'category audit uses Arrival');
assert(/arrive in Los Angeles/i.test(classified.description), 'category audit gets Arrival wording');

const stirredClassified = overlayLaProductionForClassification(
    { title: 'STIRRED 1', name: 'STIRRED 1' },
    [{ title: 'STIRRED 1' }]
);
assert(
    stirredClassified.enrichmentTitle == null,
    'STIRRED is not rewritten by the production guide'
);

const intelligence = seedContentIntelligenceFromLaGuide(
    { series: { seriesTitle: 'Vic G' }, episode: {}, discovery: {}, community: {}, educational: {} },
    { familyItems: ['Arrival', 'Vic G'], title: 'Arrival' }
);
assert(intelligence.active === true, 'Content Intelligence seed active');
assert(
    intelligence.series.seriesTitle === LA_PRODUCTION_STUDIO_SERIES_TITLE,
    `intelligence series is not Vic G (got ${intelligence.series.seriesTitle})`
);
assert(intelligence.episode.episodeTitle === 'Arrival', 'intelligence episode title Arrival');
assert(
    /arrive in Los Angeles/i.test(intelligence.episode.episodeDescription),
    'intelligence episode description from guide'
);
assert(
    Array.isArray(intelligence.discovery.topics) &&
        intelligence.discovery.topics.some((t) => /los angeles/i.test(String(t))),
    'Discovery Fields include Los Angeles'
);
assert(!/motherland/i.test(JSON.stringify(intelligence)), 'intelligence payload has no Motherland');

const emptyVaultSeed = seedContentIntelligenceFromLaGuide(
    { series: {}, episode: {}, discovery: {}, community: {}, educational: {} },
    {}
);
assert(emptyVaultSeed.active === true, 'intelligence seeds from the episode guide without a vault match');
assert(
    emptyVaultSeed.episode.episodeTitle === 'Arrival',
    `empty vault seed starts at Arrival (got ${emptyVaultSeed.episode.episodeTitle})`
);
assert(/arrive in Los Angeles/i.test(emptyVaultSeed.episode.episodeDescription), 'empty vault seed has Arrival wording');

const poomSeed = seedContentIntelligenceFromLaGuide(
    { series: {}, episode: {}, discovery: {}, community: {}, educational: {} },
    { episodeNumber: 2 },
    { force: true }
);
assert(
    poomSeed.episode.episodeTitle === 'Poom Poom Tuesday',
    `episode 2 seed (got ${poomSeed.episode.episodeTitle})`
);

const panelSrc = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../src/components/studio/ContentIntelligencePanel.svelte'),
    'utf8'
);
assert(/data-content-intelligence-guide/.test(panelSrc), 'Content Intelligence shows episode guide source');
assert(/LA_PRODUCTION_EPISODES/.test(panelSrc), 'Content Intelligence lists production guide episodes');
assert(/Load episode guide/.test(panelSrc), 'Content Intelligence can load the episode guide into fields');

if (failed) {
    console.error(`FAIL validate-la-production-episode-guide (${failed})`);
    process.exit(1);
}
console.log('PASS validate-la-production-episode-guide');
