#!/usr/bin/env node
/**
 * Creator Truth + Intelligence Interpretation boundary checks.
 * Static + light behavioral assertions (no full integration).
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

const arch = read('src/lib/architecture/creatorTruthLayers.js');
assert('architecture doc module exists', arch.includes('CREATOR TRUTH LAYER'));
assert('architecture docs intelligence layer', arch.includes('INTELLIGENCE INTERPRETATION LAYER'));
assert('architecture docs discovery layer', arch.includes('DISCOVERY LAYER'));
assert('architecture docs demo layer', arch.includes('DEMO / TEST LAYER'));

const repair = read('src/lib/series/studioRepairEngine.js');
assert(
    'repair does not invent default synopsis for write',
    !/saveReelSeriesMetadata\([^)]*description:\s*description/.test(repair) &&
        !/saveReelSeriesMetadata\([^,]+,\s*\{\s*description\s*\}/.test(repair)
);
assert(
    'generate-default-description blocked or non-repairable',
    repair.includes('blocked-synthetic-description') ||
        repair.includes("repairable: false")
);
assert(
    'repair module cites creator truth boundary',
    repair.includes('Creator Truth') || repair.includes('creator-truth')
);
assert(
    'no invent runtime 300 fallback',
    !/runtime\s*:\s*300\b/.test(repair) && !/\?\s*ctx\.episode\.runtime[^:]*:\s*300/.test(repair)
);

const agents = read('src/lib/viewer/contentAgents.js');
assert(
    'category detector labeled discovery-only',
    /DISCOVERY LAYER ONLY/.test(agents)
);
assert(
    'contentAgents does not write seriesCatalog',
    !/seriesCatalog\.(set|update)/.test(agents)
);

const discovery = read('src/lib/discovery/discoveryEngine.js');
assert('discovery engine is ranking-only docs', /DISCOVERY LAYER/.test(discovery));
assert(
    'discovery does not mutate seriesCatalog',
    !/seriesCatalog\.(set|update)/.test(discovery)
);

const seriesIntel = read('src/lib/series/seriesIntelligence.js');
assert('seriesIntelligence is interpretation-only', /INTERPRETATION/.test(seriesIntel));

const hero = read('src/lib/hero/heroIntelligence.js');
assert('hero uses isDemoSeriesId helper', hero.includes('isDemoSeriesId'));
assert(
    'hero has no hardcoded neon-vengeance comparisons',
    !/s\.id !== 'series-neon-vengeance'/.test(hero)
);

const store = read('src/lib/series/seriesStore.js');
assert(
    'seriesStore has no top-level mockSeriesData import',
    !/^import .*mockSeriesData/m.test(store)
);
assert('demo load only in resetSeriesCatalogToMock', store.includes('resetSeriesCatalogToMock'));

// Behavioral: repair blocks synthetic description write
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
    const repairMod = await vite.ssrLoadModule('/src/lib/series/studioRepairEngine.js');
    const result = repairMod.executeRepair({
        id: 'test-synth',
        repairable: true,
        action: 'generate-default-description',
        episodeId: 'ep-x',
        reelId: 'reel-x',
        issue: 'missing-description',
        severity: 'HIGH',
        label: 'x',
        detail: 'x'
    });
    assert(
        'executeRepair blocks synthetic description',
        result && result.ok === false
    );

    if (failed) {
        console.error(`\nFAIL validate-architecture-boundary (${failed})`);
        process.exit(1);
    }
    console.log('\nPASS validate-architecture-boundary');
    process.exit(0);
} catch (err) {
    console.error(err);
    process.exit(1);
} finally {
    await vite.close();
}
