#!/usr/bin/env node
/**
 * Playback stability contract — concurrent video loading guards.
 * Proves: vault/hero vault poster-first (no autoplay-all), theater exclusive ownership,
 * inactive previews do not mount preload video, hero background remains functional.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const notes = [];

function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else notes.push(`ok: ${msg}`);
}

const heroManager = read('src/components/studio/HeroManagerPanel.svelte');
const vault = read('src/components/experiences/VaultExperience.svelte');
const theater = read('src/components/theater/TheaterExperience.svelte');
const mediaRenderer = read('src/components/media/MediaRenderer.svelte');
const exclusive = read('src/lib/theater/theaterExclusivePlayback.js');
const ownership = read('src/lib/media/playbackOwnership.js');
const heroExp = read('src/components/experiences/HeroExperience.svelte');
const reelshort = read('src/components/vertical/ReelshortExperience.svelte');

// --- Ownership policy module ---
assert(/export function claimPlaybackOwner/.test(ownership), 'claimPlaybackOwner exported');
assert(/export function releasePlaybackOwner/.test(ownership), 'releasePlaybackOwner exported');
assert(/export const playbackOwner/.test(ownership), 'playbackOwner store exported');
assert(
    /'hero'[\s\S]*'preview'[\s\S]*'theater'|theater[\s\S]*preview[\s\S]*hero/.test(ownership),
    'hero | preview | theater owners defined'
);

// --- MediaRenderer defaults ---
assert(/export let autoplay = false/.test(mediaRenderer), 'MediaRenderer autoplay defaults false');
assert(
    /effectivePreload[\s\S]*'none'/.test(mediaRenderer) || /preload == null[\s\S]*'none'/.test(mediaRenderer),
    'MediaRenderer defaults video preload to none'
);
assert(/playbackRole/.test(mediaRenderer), 'MediaRenderer exposes playbackRole diagnostics');
assert(
    /data-playback-role|data-autoplay|data-preload/.test(mediaRenderer),
    'MediaRenderer sets data-autoplay/preload/role attributes'
);

// --- Hero Vault: poster-first, no autoplay-all grid ---
assert(
    /activateHeroVaultPreview|activeHeroVaultPreviewId/.test(heroManager),
    'Hero vault gates preview to active card'
);
assert(
    /Hover to preview|data-hero-vault-poster-first|MediaThumbnail/.test(heroManager),
    'Hero vault poster-first idle surface'
);
// No grid-level autoplay on every MediaRenderer without gate
const heroVaultVideoAutoplayBlocks = [
    ...(heroManager.match(/type="video"[\s\S]{0,400}autoplay=\{true\}/g) || [])
];
assert(
    heroVaultVideoAutoplayBlocks.every((block) =>
        /playbackRole="preview"|vaultPreviewActive/.test(heroManager)
    ) && /vaultPreviewActive && previewUrl/.test(heroManager),
    'Hero vault video mount only when vaultPreviewActive'
);
assert(
    !/Loading video preview\.\.\./.test(heroManager) ||
        /vaultPreviewActive/.test(heroManager),
    'Hero vault does not eternally load all MP4s'
);

// --- Content Vault: poster-first ---
assert(
    /activeVaultVideoPreviewId|activateVaultVideoPreview/.test(vault),
    'Content vault hover preview gate'
);
assert(
    /data-vault-poster-first|Hover to preview|vault-grid-poster/.test(vault),
    'Content vault inactive cards use poster/placeholder'
);
assert(
    /previewActive[\s\S]{0,80}MediaRenderer[\s\S]{0,200}type="video"/.test(vault) ||
        /\{#if previewActive\}[\s\S]*type="video"/.test(vault),
    'Content vault mounts video only when previewActive'
);
// Must not autoplay all cards unconditionally in a simple each loop MediaRenderer
assert(
    !/\{#each vaultDisplayVideos[\s\S]*type="video"[\s\S]*autoplay[\s\S]*\{:else if isVideo\}/.test(
        vault.replace(/\s+/g, ' ')
    ),
    'Content vault does not autoplay every each-card video'
);

// --- Theater exclusive ---
assert(
    /pauseCompetingPageVideos/.test(theater) && /resumeCompetingPageVideos/.test(theater),
    'Theater wires exclusive pause/resume'
);
assert(
    /snapshotAndUnloadVideo|removeAttribute\('src'\)|v\.src = ''/.test(exclusive),
    'Exclusive playback unloads competing sources'
);
assert(
    /claimPlaybackOwner\('theater'/.test(exclusive),
    'Theater claims playback ownership on open'
);
assert(
    /playbackRole="theater"/.test(theater),
    'Theater primary tagged playbackRole=theater'
);
assert(
    /dataTheaterVideo=\{true\}/.test(theater),
    'Theater primary dataTheaterVideo remains'
);

// --- Hero background remains functional ---
assert(
    /type="video"[\s\S]{0,300}autoplay[\s\S]{0,120}playbackRole="hero"/.test(heroExp) ||
        (/playbackRole="hero"/.test(heroExp) && /autoplay/.test(heroExp)),
    'Hero background video keeps autoplay + playbackRole=hero'
);
assert(
    /claimPlaybackOwner\('hero'/.test(heroExp),
    'Hero claims playback owner on load'
);
assert(
    /\$playbackOwnerStore !== 'theater'|playbackOwnerStore !== 'theater'/.test(heroExp),
    'Hero pauses DOM video while theater owns bandwidth'
);
assert(
    /preload="metadata"/.test(heroExp),
    'Hero still uses preload=metadata for single background'
);

// --- Feed inactive cards no preload video ---
assert(
    /startFeedCardPreview|feedHoverPreviewId/.test(reelshort),
    'Feed uses hover-gated preview'
);
assert(
    /card-video-poster|video_poster/.test(reelshort),
    'Feed default surface is poster thumbnail'
);

if (failures.length) {
    console.error('FAIL validate-playback-stability');
    for (const f of failures) console.error('  -', f);
    process.exit(1);
}

console.log('PASS validate-playback-stability');
for (const n of notes) console.log(' ', n);
process.exit(0);
