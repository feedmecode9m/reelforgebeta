#!/usr/bin/env node
/**
 * LOCAL-MOBILE-EXPERIENCE-HARDENING-1 — gates 2–6 static + contract validation.
 * Does not reopen LOCAL-THEATER-MOBILE-PLAY-2 activation logic.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const failures = [];
const notes = [];

function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else notes.push(`ok: ${msg}`);
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

const diag = read('src/lib/device/mobileExperienceDiagnostics.js');
const card = read('src/components/viewer/ViewerSemanticCard.svelte');
const shell = read('src/lib/feed/viewerSemanticShell.js');
const reelshort = read('src/components/vertical/ReelshortExperience.svelte');
const theater = read('src/components/theater/TheaterExperience.svelte');
const episodeChip = read('src/components/series/EpisodeChip.svelte');
const seriesPage = read('src/components/series/SeriesPublicPage.svelte');
const auditPath = path.join(root, 'artifacts/mobile-surface-audit.json');

assert(fs.existsSync(auditPath), 'Gate 1: mobile-surface-audit.json exists');
assert(/MOBILE_IDENTITY_TRACE/.test(diag), 'Gate 2: MOBILE_IDENTITY_TRACE helper');
assert(/logMobileIdentityTrace/.test(card), 'Gate 2: ViewerSemanticCard logs identity trace');
assert(/seriesLine/.test(shell) && /episodeIdentity/.test(shell), 'Gate 2: shell carries series/S-E identity');
assert(/data-viewer-sem-identity/.test(card), 'Gate 2: card renders identity line');
assert(/MOBILE_SHELF_TRACE/.test(diag), 'Gate 3: MOBILE_SHELF_TRACE helper');
assert(/logMobileShelfTrace/.test(reelshort), 'Gate 3: Reelshort logs shelf trace');
assert(/detectMobilePresentation\(\) \|\| !prefersHoverPreview/.test(reelshort), 'Gate 4: feed hover preview skipped on mobile');
assert(/min-height:\s*44px/.test(episodeChip), 'Gate 4: EpisodeChip viewer min touch 44px');
assert(/safe-area-inset/.test(seriesPage), 'Gate 4: SeriesPublicPage safe-area padding');
assert(/handleTheaterPlayPointerUp/.test(theater), 'Gate 5: Theater play pointerup retained');
assert(/startTheaterPlayback/.test(theater), 'Gate 5: Theater startTheaterPlayback retained');
assert(!/on:touchend=\{handleTheaterVideoInteraction\}/.test(theater), 'Gate 5: no video touchend stopPropagation regression');

const persistChecks = {
    personal_video_vault: reelshort.includes('personal_video_vault'),
    personal_thumbnails: reelshort.includes('personal_thumbnails'),
    reel_titles_persistent: read('src/lib/hero/heroTitleIntelligence.js').includes('reel_titles_persistent'),
    reelforge_hero_reel: read('src/lib/hero/heroRecord.js').includes('reelforge_hero_reel'),
    seriesStore: /localStorage|persist|SERIES_STORAGE|reelforge_series/.test(read('src/lib/series/seriesStore.js'))
};
for (const [key, hit] of Object.entries(persistChecks)) {
    assert(hit, `Gate 6: persistence key ${key} still wired`);
}

const gateReport = {
    mission: 'LOCAL-MOBILE-EXPERIENCE-HARDENING-1',
    generatedAt: new Date().toISOString(),
    MOBILE_THEATER_REGRESSION: failures.some((f) => f.startsWith('Gate 5')) ? 'FAIL' : 'PASS',
    gates: {
        surfaceAudit: fs.existsSync(auditPath) ? 'PASS' : 'FAIL',
        identity: failures.some((f) => f.startsWith('Gate 2')) ? 'FAIL' : 'PASS',
        shelf: failures.some((f) => f.startsWith('Gate 3')) ? 'FAIL' : 'PASS',
        touch: failures.some((f) => f.startsWith('Gate 4')) ? 'FAIL' : 'PASS',
        theaterRegression: failures.some((f) => f.startsWith('Gate 5')) ? 'FAIL' : 'PASS',
        persistence: failures.some((f) => f.startsWith('Gate 6')) ? 'FAIL' : 'PASS'
    },
    notes,
    failures
};

fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
fs.writeFileSync(
    path.join(root, 'artifacts/mobile-experience-hardening-gates.json'),
    JSON.stringify(gateReport, null, 2)
);

if (failures.length) {
    console.error('FAIL validate-mobile-experience-hardening');
    for (const f of failures) console.error(' -', f);
    process.exit(1);
}
console.log('PASS validate-mobile-experience-hardening');
console.log(JSON.stringify(gateReport.gates, null, 2));
console.log('MOBILE_THEATER_REGRESSION', gateReport.MOBILE_THEATER_REGRESSION);
