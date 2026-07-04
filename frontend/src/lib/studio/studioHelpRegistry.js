/**
 * Universal help content for Smart Production Studio panels.
 * Written at a 5th-grade reading level — no technical jargon.
 */

import { logStudioGuidanceDiag } from './studioGuidanceDiagnostics.js';

/** @typedef {Object} StudioHelpEntry
 * @property {string} title
 * @property {string} purpose
 * @property {string} howToUse
 * @property {string} commonMistakes
 * @property {string} safeUsage
 */

/** @type {Record<string, StudioHelpEntry>} */
export const STUDIO_HELP = {
    productionHealth: {
        title: 'Series Health',
        purpose: 'Tracks how ready your series is for viewers.',
        howToUse: 'Upload videos, attach them to episodes, then publish them. Watch the numbers go up as you finish each step.',
        commonMistakes: 'Publishing episodes before attaching videos.',
        safeUsage: 'Check the readiness score before releasing a season.'
    },
    readinessMeter: {
        title: 'Production Readiness',
        purpose: 'Shows how close your series is to being fully ready.',
        howToUse: 'Fill in episode details, attach videos, publish episodes, and set release dates. Each bar shows one part of readiness.',
        commonMistakes: 'Ignoring one bar while the others look good. All four areas matter.',
        safeUsage: 'Aim for high scores in every bar before launching to viewers.'
    },
    episodeOperations: {
        title: 'Episode Operations',
        purpose: 'Lists every episode and shows its video, publish, and release status.',
        howToUse: 'Sort and filter the table to find episodes that need work. Fix the ones marked as missing or draft first.',
        commonMistakes: 'Forgetting to check every season. Scroll or filter to see all episodes.',
        safeUsage: 'Review this table before you publish a new batch of episodes.'
    },
    missingAssetQueue: {
        title: 'Missing Asset Queue',
        purpose: 'Shows episodes that still need a video attached.',
        howToUse: 'Pick a video from the list and press Attach Reel. The episode leaves the queue when it has a video.',
        commonMistakes: 'Attaching the wrong video to the wrong episode number.',
        safeUsage: 'Clear this queue before you publish. Viewers need videos to watch.'
    },
    publishingProfiles: {
        title: 'Publishing Profiles',
        purpose: 'Chooses how your series looks and plays in the theater.',
        howToUse: 'Pick the profile that fits your show style. Test in the theater after you switch.',
        commonMistakes: 'Changing profiles while viewers are mid-watch without checking navigation.',
        safeUsage: 'Set your profile once per series and keep it steady during a release.'
    },
    seriesMetadata: {
        title: 'Series Metadata',
        purpose: 'Stores the title, season, episode number, and story details for each video.',
        howToUse: 'Select a reel, fill in the fields, and save. Theater and the episode list read these details.',
        commonMistakes: 'Saving the wrong season or episode number for a video.',
        safeUsage: 'Double-check season and episode numbers before you save.'
    },
    episodeBridge: {
        title: 'Episode Bridge',
        purpose: 'Links your uploaded videos to the correct episodes so viewers can move between them.',
        howToUse: 'Attach each reel to its episode. The bridge connects the video to the catalog automatically.',
        commonMistakes: 'Leaving episodes unlinked so the next episode button has nowhere to go.',
        safeUsage: 'Link every episode in order before you turn on auto-play.'
    },
    theaterProfiles: {
        title: 'Theater Profiles',
        purpose: 'Controls the look and feel of the full-screen player.',
        howToUse: 'Choose a publishing profile. The theater picks up colors, layout, and navigation from that choice.',
        commonMistakes: 'Expecting theater changes without saving your publishing profile first.',
        safeUsage: 'Preview one episode in the theater after any profile change.'
    },
    workflowTasks: {
        title: 'Production Workflow',
        purpose: 'Turns production gaps into trackable tasks you can assign and complete.',
        howToUse: 'Assign a task, use the action button to jump to the right studio panel, then mark it complete when done.',
        commonMistakes: 'Skipping blockers (missing videos) before publishing or scheduling.',
        safeUsage: 'Work blockers first, then follow the completion path top to bottom.'
    }
};

/**
 * @param {string} key
 * @returns {StudioHelpEntry | null}
 */
export function getStudioHelp(key) {
    return STUDIO_HELP[key] || null;
}

/**
 * Emit registry-loaded diagnostic once per session.
 */
export function auditStudioHelpRegistry() {
    if (typeof window !== 'undefined' && window.__studioHelpRegistryAudited) return;
    if (typeof window !== 'undefined') window.__studioHelpRegistryAudited = true;
    logStudioGuidanceDiag('STUDIO_HELP', {
        phase: 'registry_loaded',
        panels: Object.keys(STUDIO_HELP)
    });
}
