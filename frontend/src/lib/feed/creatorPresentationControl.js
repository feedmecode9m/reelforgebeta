/**
 * Creator presentation control — future-ready editing model.
 *
 * AI suggests presentation; creator decides; persist only on explicit action.
 * Phase 5 keeps allowPersist=false in Studio — this module never auto-writes.
 */

import { getActiveDiscoveryShelves, isActiveShelf } from './discoveryTaxonomy.js';
import { PRESENTATION_THEMES } from './presentationThemeSystem.js';

/** @typedef {'draft' | 'suggested' | 'approved' | 'published'} PresentationControlState */

/**
 * @typedef {Object} CreatorPresentationDraft
 * @property {string} assetId
 * @property {string} title
 * @property {string} description
 * @property {string} shelf
 * @property {string[]} tags
 * @property {string} mood
 * @property {string} cardPresentationStyle
 * @property {PresentationControlState} state
 * @property {boolean} aiAssisted
 * @property {boolean} creatorDecides
 * @property {boolean} canPersist
 * @property {string} workflow
 */

/**
 * Build a creator-facing presentation draft from a semantic profile.
 * Does not invent titles/descriptions — copies only what the profile already has.
 *
 * @param {Record<string, unknown>} profile
 * @param {{ allowPersist?: boolean }} [options]
 * @returns {CreatorPresentationDraft}
 */
export function buildCreatorPresentationDraft(profile = {}, options = {}) {
    const allowPersist = Boolean(options.allowPersist);
    const assetId = String(profile.identity || profile.assetId || '').trim();
    const title = String(profile.canonicalTitle || profile.title || '').trim();
    const description = String(profile.description || '').trim();
    const shelfRaw = String(profile.shelfCategory || profile.category || '').trim();
    const shelf = isActiveShelf(shelfRaw) ? shelfRaw : '';
    const tags = Array.isArray(profile.keywords)
        ? profile.keywords.map(String).filter(Boolean)
        : Array.isArray(profile.themes)
          ? profile.themes.map(String).filter(Boolean).slice(0, 8)
          : [];
    const mood = String(profile.mood || '').trim();
    const style =
        String(profile.presentation?.family || profile.presentationFamily || '').trim() ||
        'neutral';

    return {
        assetId,
        title,
        description,
        shelf,
        tags,
        mood,
        cardPresentationStyle: PRESENTATION_THEMES[style] ? style : 'neutral',
        state: 'suggested',
        aiAssisted: true,
        creatorDecides: true,
        canPersist: allowPersist,
        workflow: 'Asset → AI understanding → Suggested presentation → Creator approval → Published'
    };
}

/**
 * Active shelf options for creator UI (expandable taxonomy — active only).
 * @returns {readonly string[]}
 */
export function creatorShelfChoices() {
    return getActiveDiscoveryShelves();
}

/**
 * Presentation style choices for creator UI.
 * @returns {readonly string[]}
 */
export function creatorPresentationStyleChoices() {
    return Object.freeze(Object.keys(PRESENTATION_THEMES));
}
