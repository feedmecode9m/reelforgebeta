/**
 * Viewer Intelligence Presentation Layer
 *
 * Rule: AI explains creator content. AI does not replace creator truth.
 *
 * Presentation provenance is partitioned into three explicit blocks:
 *   - creatorTruth          — titles, genres, descriptions, identity terms (authoritative)
 *   - intelligenceExplanation — NLP/AI viewer copy (“Exploring…”, themes, context)
 *   - discoveryContext      — shelf labels / keywords (non-authoritative ranking only)
 *
 * @see ../architecture/creatorTruthLayers.js
 * @see ../architecture/intelligenceProvenance.js
 * @see ../intelligence/contentIdentityGuard.js
 */

import {
    formatIntelligenceExplanation,
    PROVENANCE_SOURCE_TYPES
} from '../architecture/intelligenceProvenance.js';
import { CREATOR_TRUTH_PROSE_FIELDS } from '../architecture/intelligenceProvenance.js';
import { isLockedIdentityField, LOCKED_FIELDS } from '../intelligence/contentIdentityGuard.js';

/** Fields NLP must never silently replace on creatorTruth */
export const VIEWER_LOCKED_CREATOR_FIELDS = Object.freeze([
    'title',
    'episodeTitle',
    'seriesTitle',
    'genre',
    'description',
    'communityRepresented',
    'culturalRegion',
    'creatorName',
    'heroIdentity',
    'identityTerms'
]);

/**
 * Cultural / community phrasing that intelligence must not mutate or “improve”.
 * Matched as whole-phrase (case-insensitive) when present in creator title/description.
 * @type {ReadonlyArray<string>}
 */
export const PROTECTED_IDENTITY_PHRASES = Object.freeze([
    'black agriculture',
    'black legacy',
    'black land',
    'civil rights',
    'diaspora',
    'community builders',
    'cultural preservation',
    'food justice',
    'land ownership',
    'black innovation',
    'look@zakanda',
    'reelforge'
]);

/**
 * @typedef {Object} CreatorTruthBlock
 * @property {string} title
 * @property {string} description
 * @property {string} genre
 * @property {string[]} identityTerms
 * @property {string} sourceType
 * @property {true} authoritative
 */

/**
 * @typedef {Object} IntelligenceExplanationBlock
 * @property {string[]} lines Human-facing lines using Exploring / Themes detected / …
 * @property {string[]} themes
 * @property {string} suggestedContext
 * @property {string} sourceType
 * @property {false} authoritative
 */

/**
 * @typedef {Object} DiscoveryContextBlock
 * @property {string[]} shelfLabels
 * @property {string[]} keywords
 * @property {string[]} connectionTags
 * @property {string} sourceType
 * @property {false} authoritative
 */

/**
 * @typedef {Object} ViewerIntelligencePresentation
 * @property {CreatorTruthBlock} creatorTruth
 * @property {IntelligenceExplanationBlock} intelligenceExplanation
 * @property {DiscoveryContextBlock} discoveryContext
 * @property {{
 *   primaryTitle: string;
 *   officialGenre: string;
 *   officialDescription: string;
 *   showIntelligence: boolean;
 *   intelligenceLines: string[];
 *   discoveryChips: string[];
 * }} display
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function list(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => text(item)).filter(Boolean);
}

/**
 * Extract protected identity phrases that appear in creator content.
 * @param {string} haystack
 * @returns {string[]}
 */
export function extractProtectedIdentityTerms(haystack) {
    const lower = text(haystack).toLowerCase();
    if (!lower) return [];
    /** @type {string[]} */
    const found = [];
    for (const phrase of PROTECTED_IDENTITY_PHRASES) {
        if (lower.includes(phrase)) found.push(phrase);
    }
    return found;
}

/**
 * True when a proposed rewrite would alter or drop a protected identity phrase.
 * @param {string} original
 * @param {string} proposed
 */
export function wouldMutateIdentityTerms(original, proposed) {
    const o = text(original);
    const p = text(proposed);
    if (!o || !p || o === p) return false;
    const locked = extractProtectedIdentityTerms(o);
    if (!locked.length) return false;
    const propLower = p.toLowerCase();
    return locked.some((phrase) => !propLower.includes(phrase));
}

/**
 * Merge NLP candidate into creator field only when not locked and not identity-mutating.
 * Always returns the creator-side value for locked creatorTruth fields.
 *
 * @param {string} field
 * @param {unknown} creatorValue
 * @param {unknown} nlpValue
 * @returns {{ value: string; applied: boolean; blocked: boolean; reason: string | null }}
 */
export function resolveCreatorFieldAgainstNlp(field, creatorValue, nlpValue) {
    const creator = text(creatorValue);
    const nlp = text(nlpValue);
    const key = String(field || '').trim();

    if (
        VIEWER_LOCKED_CREATOR_FIELDS.includes(key) ||
        isLockedIdentityField(key) ||
        CREATOR_TRUTH_PROSE_FIELDS.includes(key)
    ) {
        if (nlp && nlp !== creator) {
            return {
                value: creator,
                applied: false,
                blocked: true,
                reason: 'nlp-cannot-overwrite-creator-truth'
            };
        }
        return { value: creator, applied: false, blocked: false, reason: null };
    }

    if (wouldMutateIdentityTerms(creator, nlp)) {
        return {
            value: creator,
            applied: false,
            blocked: true,
            reason: 'identity-term-protection'
        };
    }

    if (creator) {
        return { value: creator, applied: false, blocked: false, reason: null };
    }
    if (nlp) {
        return { value: nlp, applied: true, blocked: false, reason: null };
    }
    return { value: '', applied: false, blocked: false, reason: null };
}

/**
 * Build multi-line viewer intelligence copy (never titles/genres).
 *
 * @param {{
 *   title?: string;
 *   themes?: string[];
 *   mood?: string;
 *   location?: string;
 *   narrativeHints?: string[];
 *   rawExplanation?: string;
 * }} signals
 * @returns {string[]}
 */
export function buildIntelligenceExplanationLines(signals = {}) {
    const title = text(signals.title);
    const themes = list(signals.themes);
    const mood = text(signals.mood);
    const location = text(signals.location);
    const narrative = list(signals.narrativeHints);
    const raw = text(signals.rawExplanation);

    /** @type {string[]} */
    const lines = [];

    if (title) {
        lines.push(`Exploring ${title}`);
    }
    if (themes.length) {
        lines.push(`Themes detected: ${themes.slice(0, 5).join(', ')}`);
    }
    if (mood || location) {
        const bits = [mood && `mood: ${mood}`, location && `place: ${location}`]
            .filter(Boolean)
            .join('; ');
        if (bits) lines.push(`Suggested context: ${bits}`);
    }
    if (narrative.length) {
        lines.push(`This story highlights ${narrative.slice(0, 3).join(', ')}`);
    } else if (themes.length === 1 && title) {
        lines.push(`This story highlights ${themes[0]}`);
    }
    if (raw && !lines.some((line) => line.includes(raw))) {
        // Normalize raw captions into presentation language when needed.
        if (/^(exploring|themes detected|suggested context|this story highlights)/i.test(raw)) {
            lines.push(raw);
        } else {
            lines.push(formatIntelligenceExplanation(raw, { fromTitle: Boolean(title) }));
        }
    }

    // Deduplicate while preserving order
    const seen = new Set();
    return lines.filter((line) => {
        const key = line.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Core builder: partition creator truth vs intelligence vs discovery.
 *
 * @param {{
 *   title?: string;
 *   description?: string;
 *   genre?: string;
 *   identityTerms?: string[];
 *   nlpTitle?: string;
 *   nlpGenre?: string;
 *   nlpDescription?: string;
 *   themes?: string[];
 *   mood?: string;
 *   location?: string;
 *   narrativeHints?: string[];
 *   intelligenceExplanation?: string;
 *   discoveryShelfLabels?: string[];
 *   discoveryKeywords?: string[];
 *   discoveryConnections?: string[];
 * }} input
 * @returns {ViewerIntelligencePresentation}
 */
export function buildViewerIntelligencePresentation(input = {}) {
    const titleResolve = resolveCreatorFieldAgainstNlp('title', input.title, input.nlpTitle);
    const genreResolve = resolveCreatorFieldAgainstNlp('genre', input.genre, input.nlpGenre);
    const descResolve = resolveCreatorFieldAgainstNlp(
        'description',
        input.description,
        input.nlpDescription
    );

    const identityTerms = Array.from(
        new Set([
            ...list(input.identityTerms),
            ...extractProtectedIdentityTerms(titleResolve.value),
            ...extractProtectedIdentityTerms(descResolve.value)
        ])
    );

    /** @type {CreatorTruthBlock} */
    const creatorTruth = {
        title: titleResolve.value,
        description: descResolve.value,
        genre: genreResolve.value,
        identityTerms,
        sourceType: PROVENANCE_SOURCE_TYPES.CREATOR,
        authoritative: true
    };

    const themes = list(input.themes);
    // Discovery shelf labels must never land in creatorTruth.genre
    const nlpGenreAsTheme = text(input.nlpGenre);
    if (nlpGenreAsTheme && nlpGenreAsTheme !== creatorTruth.genre) {
        if (!themes.some((t) => t.toLowerCase() === nlpGenreAsTheme.toLowerCase())) {
            themes.push(nlpGenreAsTheme);
        }
    }

    const lines = buildIntelligenceExplanationLines({
        title: creatorTruth.title,
        themes,
        mood: input.mood,
        location: input.location,
        narrativeHints: input.narrativeHints || identityTerms.slice(0, 3),
        rawExplanation: input.intelligenceExplanation
    });

    /** @type {IntelligenceExplanationBlock} */
    const intelligenceExplanation = {
        lines,
        themes,
        suggestedContext: lines.find((l) => /^Suggested context:/i.test(l)) || '',
        sourceType: PROVENANCE_SOURCE_TYPES.AI,
        authoritative: false
    };

    /** @type {DiscoveryContextBlock} */
    const discoveryContext = {
        shelfLabels: list(input.discoveryShelfLabels),
        keywords: list(input.discoveryKeywords),
        connectionTags: list(input.discoveryConnections),
        sourceType: PROVENANCE_SOURCE_TYPES.DISCOVERY,
        authoritative: false
    };

    return {
        creatorTruth,
        intelligenceExplanation,
        discoveryContext,
        display: {
            // Creator title always wins the primary slot.
            primaryTitle: creatorTruth.title,
            officialGenre: creatorTruth.genre,
            officialDescription: creatorTruth.description,
            showIntelligence: intelligenceExplanation.lines.length > 0,
            intelligenceLines: intelligenceExplanation.lines,
            discoveryChips: [
                ...discoveryContext.shelfLabels.map((s) => `Discovery: ${s}`),
                ...discoveryContext.keywords.map((k) => k)
            ].slice(0, 8)
        }
    };
}

/**
 * Featured Collection adapter — creator title/description first; keywords as discovery.
 *
 * @param {Record<string, unknown> | null | undefined} collection
 * @param {{ discoveryConnections?: string[] }} [extras]
 * @returns {ViewerIntelligencePresentation | null}
 */
export function presentFeaturedCollection(collection, extras = {}) {
    if (!collection || typeof collection !== 'object') return null;
    const title = text(collection.collectionTitle);
    if (!title) return null;

    return buildViewerIntelligencePresentation({
        title,
        description: text(collection.collectionDescription),
        genre: '', // collections are not series genre truth
        identityTerms: list(collection.communityRepresented),
        themes: [
            ...list(collection.educationalThemes),
            ...list(collection.communityRepresented)
        ],
        narrativeHints: list(collection.educationalThemes),
        discoveryShelfLabels: list(collection.sponsorshipCategories),
        discoveryKeywords: list(collection.searchKeywords),
        discoveryConnections: list(extras.discoveryConnections)
    });
}

/**
 * Apply an NLP proposal object to creatorTruth only through locked-field gate.
 * Returns blocked field list for audits / validators.
 *
 * @param {Record<string, unknown>} creatorTruth
 * @param {Record<string, unknown>} nlpProposal
 * @returns {{ next: Record<string, unknown>; blocked: string[]; written: string[] }}
 */
export function applyNlpProposalToCreatorTruth(creatorTruth, nlpProposal) {
    const next = { ...(creatorTruth && typeof creatorTruth === 'object' ? creatorTruth : {}) };
    /** @type {string[]} */
    const blocked = [];
    /** @type {string[]} */
    const written = [];

    const proposal = nlpProposal && typeof nlpProposal === 'object' ? nlpProposal : {};
    for (const [field, value] of Object.entries(proposal)) {
        if (value === undefined) continue;
        const result = resolveCreatorFieldAgainstNlp(field, next[field], value);
        if (result.blocked) {
            blocked.push(field);
            next[field] = result.value;
            continue;
        }
        if (result.applied) {
            written.push(field);
            next[field] = result.value;
        }
    }

    return { next, blocked, written };
}

/**
 * Static contract for validators.
 */
export function getViewerPresentationContract() {
    return {
        provenanceBlocks: ['creatorTruth', 'intelligenceExplanation', 'discoveryContext'],
        lockedCreatorFields: VIEWER_LOCKED_CREATOR_FIELDS,
        lockedIdentityFields: LOCKED_FIELDS,
        explanationLanguagePrefixes: [
            'Exploring ',
            'Themes detected: ',
            'Suggested context: ',
            'This story highlights '
        ],
        discoveryAuthoritative: false,
        intelligenceAuthoritative: false,
        creatorAuthoritative: true
    };
}
