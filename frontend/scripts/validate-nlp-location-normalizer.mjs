#!/usr/bin/env node
/**
 * Regression: NLP location entity normalization for Hero title intelligence.
 *
 * Cases:
 *  - "Vic G LA Story"
 *  - "Downtown Los Angeles Documentary"
 *  - "L.A. Street Stories"
 *  - "LosAngeles Creator Spotlight"
 *
 * Expected: location === "Los Angeles"
 * Creator title string is preserved (normalizedTitle matches input when safe).
 */
import {
    extractLocationFromText,
    normalizeLocationEntity
} from '../src/lib/intelligence/locationEntityNormalizer.js';
import { analyzeHeroTitle } from '../src/lib/hero/heroTitleIntelligence.js';

let failed = 0;

/** @param {string} label @param {unknown} actual @param {unknown} expected */
function assertEq(label, actual, expected) {
    if (actual === expected) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
}

/** @param {string} label @param {boolean} cond */
function assert(label, cond) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}`);
}

console.log('\n[normalizeLocationEntity]');
const la = normalizeLocationEntity('LA', { log: false });
assertEq('LA → Los Angeles', la?.canonical, 'Los Angeles');
assert('LA aliases include la', Boolean(la?.aliases?.includes('la')));
assert('LA aliases include los-angeles', Boolean(la?.aliases?.includes('los-angeles')));

const dotted = normalizeLocationEntity('L.A.', { log: false });
assertEq('L.A. → Los Angeles', dotted?.canonical, 'Los Angeles');

const full = normalizeLocationEntity('Los Angeles', { log: false });
assertEq('Los Angeles → Los Angeles', full?.canonical, 'Los Angeles');

const compact = normalizeLocationEntity('LosAngeles', { log: false });
assertEq('LosAngeles → Los Angeles', compact?.canonical, 'Los Angeles');

console.log('\n[extractLocationFromText boundaries]');
const fromAtlanta = extractLocationFromText('Atlanta Night Market', { log: false });
assertEq('Atlanta is not misread as LA', fromAtlanta?.canonical, 'Atlanta');

const titles = [
    'Vic G LA Story',
    'Downtown Los Angeles Documentary',
    'L.A. Street Stories',
    'LosAngeles Creator Spotlight'
];

console.log('\n[analyzeHeroTitle regression]');
for (const title of titles) {
    const intel = analyzeHeroTitle(title, { isVideo: true });
    console.log(`\n  title: ${JSON.stringify(title)}`);
    assertEq(`${title} → location Los Angeles`, intel.location, 'Los Angeles');
    assert(
        `${title} preserves creator title`,
        intel.normalizedTitle === title || intel.normalizedTitle.toLowerCase() === title.toLowerCase()
    );
    assert(
        `${title} discoveryTags has los-angeles`,
        intel.discoveryTags.includes('los-angeles')
    );
    assert(`${title} discoveryTags has la`, intel.discoveryTags.includes('la'));
    assert(
        `${title} does not tag as bare "La" display`,
        !intel.discoveryTags.includes('La') && intel.location !== 'La'
    );
}

const vic = analyzeHeroTitle('Vic G LA Story', { isVideo: true });
assert(
    'Vic G tokens still in discovery (creator signal)',
    vic.discoveryTags.some((t) => t === 'vic' || t === 'story') ||
        vic.storyKeywords.some((t) => t === 'vic' || t === 'story')
);

if (failed) {
    console.error(`\nFAILED: ${failed} assertion(s)\n`);
    process.exit(1);
}
console.log('\nPASSED: NLP location normalization regression\n');
