#!/usr/bin/env node
/**
 * Homepage hero Watch Now / Learn More — featured MP4 theater + campaign override.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    isLegacyHeroDemoCopy,
    resolveHeroCtaIntent,
    sanitizeHeroCtaTarget
} from '../src/lib/hero/heroCtaIntent.js';
import { presentLaProductionEpisode } from '../src/lib/series/laProductionEpisodeGuide.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(__dirname, '..');

let failed = 0;
function assert(cond, label) {
    if (cond) console.log(`  ✓ ${label}`);
    else {
        failed += 1;
        console.error(`  ✗ ${label}`);
    }
}

const reel = {
    id: 'hero-mp4-1',
    name: 'Arrival',
    title: 'Arrival',
    url: '/videos/hero-mp4-1.mp4',
    type: 'video/mp4'
};

console.log('\n[hero-cta-actions]');

const watchNav = resolveHeroCtaIntent({
    kind: 'watch',
    campaignTarget: 'https://example.com/campaign',
    featuredReel: reel
});
assert(watchNav.action === 'theater', 'Watch Now plays the featured MP4 even if a campaign URL is set');

const watchPlaceholder = resolveHeroCtaIntent({
    kind: 'watch',
    campaignTarget: '/watch',
    featuredReel: reel
});
assert(watchPlaceholder.action === 'theater', 'Hero Manager /watch placeholder does not reload the homepage');
assert(sanitizeHeroCtaTarget('/') === '', 'bare / is not a campaign URL');
assert(sanitizeHeroCtaTarget('/watch') === '', '/watch placeholder is not a campaign URL');

const watchOffsiteNoReel = resolveHeroCtaIntent({
    kind: 'watch',
    campaignTarget: 'https://example.com/campaign',
    featuredReel: null
});
assert(watchOffsiteNoReel.action === 'navigate', 'Watch Now can follow a campaign URL when there is no featured MP4');

const watchDemo = resolveHeroCtaIntent({
    kind: 'watch',
    campaignTarget: '/series/neon-vengeance',
    featuredReel: reel
});
assert(watchDemo.action === 'theater', 'legacy Neon Vengeance path does not steal Watch Now');
assert(watchDemo.reel === reel, 'Watch Now plays featured reel');
assert(sanitizeHeroCtaTarget('/series/series-neon-vengeance') === '', 'series-neon-vengeance id is not a campaign URL');
assert(sanitizeHeroCtaTarget('/series/black-agriculture') === '', 'old collection title slug is not a campaign URL');
assert(sanitizeHeroCtaTarget('Neon Vengeance') === '', 'Neon Vengeance label is not a campaign URL');
assert(isLegacyHeroDemoCopy('Black Agriculture') === true, 'Black Agriculture is leftover category title copy');
assert(isLegacyHeroDemoCopy('Ghost in the Grid') === true, 'demo episode titles are leftover copy');
assert(isLegacyHeroDemoCopy('Black Agriculture stories curated for documentary discovery.') === true, 'curated-for category blurbs are leftover copy');
assert(isLegacyHeroDemoCopy('Arrival') === false, 'real episode titles are not treated as leftover category copy');

const watchNone = resolveHeroCtaIntent({ kind: 'watch', featuredReel: null });
assert(watchNone.action === 'none', 'Watch Now is a no-op without a featured MP4');

const learnFamily = resolveHeroCtaIntent({
    kind: 'learn',
    featuredReel: reel,
    relatedMemberCount: 3
});
assert(learnFamily.action === 'episodes', 'Learn More opens All Episodes when a family exists');

const learnSolo = resolveHeroCtaIntent({
    kind: 'learn',
    featuredReel: reel,
    relatedMemberCount: 1
});
assert(learnSolo.action === 'expand', 'Learn More expands hero copy without a family');

const learnCampaign = resolveHeroCtaIntent({
    kind: 'learn',
    campaignTarget: '/about-the-film',
    featuredReel: reel,
    relatedMemberCount: 4
});
assert(learnCampaign.action === 'navigate', 'Learn More campaign URL overrides episodes');
assert(learnCampaign.target === '/about-the-film', 'Learn More campaign target preserved');

const guide = presentLaProductionEpisode({
    title: 'Arrival',
    currentTitle: 'Arrival',
    fileName: '01 ARRIVAL OPEN v1.mp4'
});
assert(/Los Angeles|anticipation/i.test(guide.description || ''), `guide copy available for expand (got "${String(guide.description || '').slice(0, 48)}")`);

const heroSrc = readFileSync(join(frontendRoot, 'src/components/experiences/HeroExperience.svelte'), 'utf8');
assert(/handleHeroWatchNow/.test(heroSrc), 'HeroExperience wires Watch Now handler');
assert(/reelforge:hero-watch-now/.test(heroSrc), 'HeroExperience dispatches Watch Now theater event');
assert(/reelforge:hero-learn-more/.test(heroSrc), 'HeroExperience dispatches Learn More theater event');
assert(/data-hero-learn-more/.test(heroSrc), 'Learn More button is marked');
assert(!/goToSlide\(activeSlideIndex \+ 1, 'learn_more'\)/.test(heroSrc), 'Learn More no longer advances the carousel');

const viewerSrc = readFileSync(join(frontendRoot, 'src/viewer/viewerContext.js'), 'utf8');
assert(/reelforge:hero-watch-now/.test(viewerSrc) && /openTheater\(reel\)/.test(viewerSrc), 'viewer opens Theater from Watch Now');
assert(/reelforge:hero-learn-more/.test(viewerSrc), 'viewer opens Theater from Learn More');

const theaterSrc = readFileSync(
    join(frontendRoot, 'src/components/theater/TheaterExperience.svelte'),
    'utf8'
);
assert(/heroCtaSuppressAutoOpen/.test(theaterSrc), 'Watch Now suppresses All Episodes auto-open');
assert(/heroCtaPendingEpisodes/.test(theaterSrc), 'Learn More can open All Episodes');
assert(/hero-learn-more/.test(theaterSrc) && /isMobileTheater/.test(theaterSrc), 'mobile auto-open race still considered');

if (failed) {
    console.error(`\n[hero-cta-actions] ${failed} failed`);
    process.exit(1);
}
console.log('\n[hero-cta-actions] ok');
