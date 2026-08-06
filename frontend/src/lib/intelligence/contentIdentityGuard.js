/**
 * Content Identity Guard — governance layer for creator-owned identity.
 *
 * Contract:
 *   Creator Data = Source of Truth
 *     └── AI/NLP Interpretation Layer → suggestions, tags, story framing, discovery signals
 *
 * AI enriches. It never silently overwrites creator identity.
 */

/** @enum {number} */
export const IDENTITY_SOURCES = Object.freeze({
    CREATOR_TITLE: 100,
    CREATOR_DESCRIPTION: 90,
    EPISODE_METADATA: 80,
    VERIFIED_TAGS: 70,
    NLP_INFERENCE: 40,
    AI_SUGGESTION: 20,
    FILENAME: 0
});

/** Human labels for audit UI / logs */
export const IDENTITY_SOURCE_LABELS = Object.freeze({
    [IDENTITY_SOURCES.CREATOR_TITLE]: 'creator',
    [IDENTITY_SOURCES.CREATOR_DESCRIPTION]: 'creator',
    [IDENTITY_SOURCES.EPISODE_METADATA]: 'episode',
    [IDENTITY_SOURCES.VERIFIED_TAGS]: 'verified',
    [IDENTITY_SOURCES.NLP_INFERENCE]: 'nlp',
    [IDENTITY_SOURCES.AI_SUGGESTION]: 'ai',
    [IDENTITY_SOURCES.FILENAME]: 'filename'
});

/**
 * Fields that AI/NLP must never auto-overwrite after creator ownership.
 * They may only change via explicit creator action (edit / accept promotion).
 */
export const LOCKED_FIELDS = Object.freeze([
    'title',
    'heroTitle',
    'heroAssetTitle',
    'creatorName',
    'episodeTitle',
    'brandName',
    'heroIdentity'
]);

/**
 * Soft fields NLP may enrich as proposals (and auto-store as unapproved side-channel).
 * Presentation writes require approval unless explicitly opted-in.
 */
export const ENRICHABLE_FIELDS = Object.freeze([
    'keywords',
    'mood',
    'category',
    'audience',
    'audienceSignal',
    'discoveryTags',
    'location',
    'storyKeywords',
    'suggestedDescription',
    'suggestedSubtitle',
    'heroDescription',
    'heroSubtitle'
]);

const SOURCE_NAME_TO_RANK = Object.freeze({
    creator: IDENTITY_SOURCES.CREATOR_TITLE,
    creator_title: IDENTITY_SOURCES.CREATOR_TITLE,
    creator_description: IDENTITY_SOURCES.CREATOR_DESCRIPTION,
    episode: IDENTITY_SOURCES.EPISODE_METADATA,
    episode_metadata: IDENTITY_SOURCES.EPISODE_METADATA,
    verified: IDENTITY_SOURCES.VERIFIED_TAGS,
    verified_tags: IDENTITY_SOURCES.VERIFIED_TAGS,
    nlp: IDENTITY_SOURCES.NLP_INFERENCE,
    nlp_inference: IDENTITY_SOURCES.NLP_INFERENCE,
    ai: IDENTITY_SOURCES.AI_SUGGESTION,
    ai_suggestion: IDENTITY_SOURCES.AI_SUGGESTION,
    filename: IDENTITY_SOURCES.FILENAME
});

/**
 * @param {number | string} source
 * @returns {number}
 */
export function rankOfSource(source) {
    if (typeof source === 'number' && Number.isFinite(source)) return source;
    const key = String(source || '')
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_');
    if (SOURCE_NAME_TO_RANK[key] != null) return SOURCE_NAME_TO_RANK[key];
    return IDENTITY_SOURCES.AI_SUGGESTION;
}

/**
 * @param {number | string} source
 * @returns {string}
 */
export function labelOfSource(source) {
    const rank = rankOfSource(source);
    return IDENTITY_SOURCE_LABELS[rank] || 'ai';
}

/**
 * @param {string} field
 */
export function isLockedIdentityField(field) {
    return LOCKED_FIELDS.includes(String(field || '').trim());
}

/**
 * @param {string} field
 */
export function isEnrichableField(field) {
    return ENRICHABLE_FIELDS.includes(String(field || '').trim());
}

/**
 * @param {{ value?: unknown; source?: number|string; confidence?: number }} fieldState
 * @param {number|string} challengerSource
 * @returns {boolean}
 */
export function canOverwriteField(fieldState, challengerSource) {
    const currentRank = rankOfSource(fieldState?.source ?? IDENTITY_SOURCES.FILENAME);
    const nextRank = rankOfSource(challengerSource);
    // Equal rank only overwrites when confidence of challenger is strictly higher is handled by caller.
    return nextRank > currentRank;
}

/**
 * Normalize a governed field entry.
 * @param {unknown} value
 * @param {number|string} source
 * @param {number} [confidence]
 * @param {{ approved?: boolean; proposed?: boolean }} [flags]
 */
export function makeGovernedValue(value, source, confidence = 1, flags = {}) {
    const rank = rankOfSource(source);
    const conf = Math.max(0, Math.min(1, Number(confidence)));
    return {
        value: value == null ? '' : value,
        source: labelOfSource(rank),
        sourceRank: rank,
        confidence: Number.isFinite(conf) ? conf : rankToDefaultConfidence(rank),
        approved: flags.approved === true,
        proposed: flags.proposed === true,
        updatedAt: new Date().toISOString()
    };
}

/**
 * @param {number} rank
 */
export function rankToDefaultConfidence(rank) {
    if (rank >= IDENTITY_SOURCES.CREATOR_TITLE) return 1;
    if (rank >= IDENTITY_SOURCES.CREATOR_DESCRIPTION) return 0.95;
    if (rank >= IDENTITY_SOURCES.EPISODE_METADATA) return 0.9;
    if (rank >= IDENTITY_SOURCES.VERIFIED_TAGS) return 0.85;
    if (rank >= IDENTITY_SOURCES.NLP_INFERENCE) return 0.75;
    if (rank >= IDENTITY_SOURCES.AI_SUGGESTION) return 0.55;
    return 0.1;
}

/**
 * Dispatch audit event for intelligence proposals / approvals.
 * @param {{
 *   reelId: string;
 *   changedField: string;
 *   previousValue?: unknown;
 *   newValue?: unknown;
 *   source?: string|number;
 *   confidence?: number;
 *   approved?: boolean;
 * }} detail
 */
export function dispatchIntelligenceUpdated(detail) {
    if (typeof window === 'undefined') return;
    const payload = {
        reelId: String(detail.reelId || '').trim(),
        changedField: String(detail.changedField || '').trim(),
        previousValue: detail.previousValue ?? null,
        newValue: detail.newValue ?? null,
        source: labelOfSource(detail.source ?? IDENTITY_SOURCES.NLP_INFERENCE),
        confidence:
            typeof detail.confidence === 'number'
                ? detail.confidence
                : rankToDefaultConfidence(rankOfSource(detail.source)),
        approved: detail.approved === true,
        updatedAt: new Date().toISOString()
    };
    window.dispatchEvent(new CustomEvent('reelforge:intelligence-updated', { detail: payload }));
    console.info('[CONTENT_IDENTITY_GUARD]', payload);
}

/**
 * Build a governed identity graph from creator title + NLP analysis.
 * NLP fields land as unapproved proposals; creator title is locked truth.
 *
 * @param {{
 *   reelId: string;
 *   creatorTitle: string;
 *   titleSource?: number|string;
 *   nlp?: {
 *     category?: string;
 *     mood?: string;
 *     location?: string;
 *     storyKeywords?: string[];
 *     audienceSignal?: string;
 *     heroDescription?: string;
 *     heroSubtitle?: string;
 *     discoveryTags?: string[];
 *     isFilenameProtected?: boolean;
 *   } | null;
 *   previousIdentity?: Record<string, unknown> | null;
 * }} input
 */
export function buildGovernedIdentity(input) {
    const reelId = String(input.reelId || '').trim();
    const creatorTitle = String(input.creatorTitle || '').trim();
    const titleSource = rankOfSource(input.titleSource ?? IDENTITY_SOURCES.CREATOR_TITLE);
    const nlp = input.nlp || {};
    const prev = input.previousIdentity && typeof input.previousIdentity === 'object' ? input.previousIdentity : {};

    const confidenceForNlpField = (field) => {
        // Lightweight heuristics: location tokens weaker than mood/category on full title signals.
        if (field === 'location') return nlp.location ? 0.72 : 0;
        if (field === 'category') return nlp.category ? 0.86 : 0;
        if (field === 'mood') return nlp.mood ? 0.8 : 0;
        if (field === 'suggestedDescription' || field === 'heroDescription') return 0.7;
        if (field === 'suggestedSubtitle' || field === 'heroSubtitle') return 0.68;
        return 0.75;
    };

    /** @type {Record<string, ReturnType<typeof makeGovernedValue>>} */
    const fields = {
        title: makeGovernedValue(
            creatorTitle,
            titleSource,
            titleSource >= IDENTITY_SOURCES.CREATOR_TITLE ? 1 : rankToDefaultConfidence(titleSource),
            { approved: true, proposed: false }
        )
    };

    // Preserve a higher-authority prior title if caller tries to demote (e.g. filename after creator title).
    const priorTitle = prev.fields?.title || prev.title;
    if (priorTitle && typeof priorTitle === 'object') {
        if (!canOverwriteField(priorTitle, titleSource) && String(priorTitle.value || '').trim()) {
            fields.title = {
                ...priorTitle,
                approved: true,
                proposed: false
            };
        }
    }

    /** @type {Record<string, ReturnType<typeof makeGovernedValue>>} */
    const proposals = {};

    const propose = (field, value) => {
        if (value == null || value === '' || (Array.isArray(value) && !value.length)) return;
        const conf = confidenceForNlpField(field);
        proposals[field] = makeGovernedValue(value, IDENTITY_SOURCES.NLP_INFERENCE, conf, {
            approved: false,
            proposed: true
        });
        dispatchIntelligenceUpdated({
            reelId,
            changedField: field,
            previousValue: prev.proposals?.[field]?.value ?? prev.fields?.[field]?.value ?? null,
            newValue: value,
            source: IDENTITY_SOURCES.NLP_INFERENCE,
            confidence: conf,
            approved: false
        });
    };

    propose('category', nlp.category);
    propose('mood', nlp.mood);
    propose('location', nlp.location);
    propose('storyKeywords', nlp.storyKeywords);
    propose('audienceSignal', nlp.audienceSignal);
    propose('discoveryTags', nlp.discoveryTags);
    propose('suggestedDescription', nlp.heroDescription);
    propose('suggestedSubtitle', nlp.heroSubtitle);
    // Aliases used by presentation mapping
    propose('heroDescription', nlp.heroDescription);
    propose('heroSubtitle', nlp.heroSubtitle);

    // Keep previously accepted enrichments (approved creator-desc or approved NLP).
    const accepted = {};
    const priorAccepted = prev.accepted || prev.fields || {};
    for (const [key, entry] of Object.entries(priorAccepted)) {
        if (!entry || typeof entry !== 'object') continue;
        if (entry.approved === true && key !== 'title') {
            accepted[key] = entry;
            fields[key] = entry;
        }
    }

    return {
        reelId,
        version: 1,
        contract: 'creator-source-of-truth',
        fields,
        proposals,
        accepted,
        assistantHint: buildAssistantHint(creatorTitle, nlp),
        updatedAt: new Date().toISOString()
    };
}

/**
 * Studio-assistant voice (never rewrites).
 * @param {string} title
 * @param {Record<string, unknown>} nlp
 */
export function buildAssistantHint(title, nlp = {}) {
    const category = String(nlp.category || '').trim();
    const location = String(nlp.location || '').trim();
    if (category && location) {
        return `This title suggests a ${category} experience in ${location}. Apply discovery tags and story framing?`;
    }
    if (category === 'travel') {
        return 'This title suggests a travel experience. Add travel discovery tags?';
    }
    if (category === 'culture' || /market|food|bbq|festival/i.test(title)) {
        return 'This title suggests food & culture. Accept story framing for the hero landscape?';
    }
    if (category) {
        return `This title suggests “${category}”. Review AI story framing before publishing.`;
    }
    return 'NLP has draft discovery signals ready — accept only what matches your intent.';
}

/**
 * Approve a single proposal into accepted identity + optional presentation mapping.
 * @param {Record<string, unknown>} identity
 * @param {string} field
 * @param {{ editedValue?: unknown }} [options]
 */
export function approveIdentityProposal(identity, field, options = {}) {
    const graph = cloneIdentity(identity);
    const key = String(field || '').trim();
    const proposal = graph.proposals?.[key];
    if (!proposal) {
        return { identity: graph, presentationPatch: {}, approved: false };
    }

    if (isLockedIdentityField(key) && rankOfSource(proposal.source) < IDENTITY_SOURCES.CREATOR_TITLE) {
        // Never promote NLP onto locked identity keys (title stays creator).
        return { identity: graph, presentationPatch: {}, approved: false, blocked: true };
    }

    const value = options.editedValue !== undefined ? options.editedValue : proposal.value;
    const approved = makeGovernedValue(value, IDENTITY_SOURCES.CREATOR_DESCRIPTION, 1, {
        approved: true,
        proposed: false
    });
    // Mark creator approval elevates source for presentation purposes.
    approved.source = 'creator';
    approved.sourceRank = IDENTITY_SOURCES.CREATOR_DESCRIPTION;
    approved.fromNlp = true;

    graph.accepted = { ...(graph.accepted || {}), [key]: approved };
    graph.fields = { ...(graph.fields || {}), [key]: approved };
    if (graph.proposals) {
        const { [key]: _drop, ...rest } = graph.proposals;
        // Also drop aliases if approving description/subtitle
        delete rest[aliasInverse(key)];
        graph.proposals = rest;
    }
    graph.updatedAt = new Date().toISOString();

    dispatchIntelligenceUpdated({
        reelId: graph.reelId,
        changedField: key,
        previousValue: proposal.value,
        newValue: value,
        source: 'creator',
        confidence: 1,
        approved: true
    });

    return {
        identity: graph,
        presentationPatch: mapApprovedFieldToPresentation(key, value),
        approved: true
    };
}

/**
 * @param {string} field
 */
function aliasInverse(field) {
    if (field === 'suggestedDescription') return 'heroDescription';
    if (field === 'heroDescription') return 'suggestedDescription';
    if (field === 'suggestedSubtitle') return 'heroSubtitle';
    if (field === 'heroSubtitle') return 'suggestedSubtitle';
    return '';
}

/**
 * @param {string} field
 * @param {unknown} value
 */
export function mapApprovedFieldToPresentation(field, value) {
    /** @type {Record<string, unknown>} */
    const patch = {};
    if (field === 'suggestedDescription' || field === 'heroDescription') {
        patch.heroDescription = value;
    } else if (field === 'suggestedSubtitle' || field === 'heroSubtitle') {
        patch.heroSubtitle = value;
    } else if (field === 'title' || field === 'heroTitle') {
        // Only via creator path
        patch.heroTitle = value;
        patch.heroAssetTitle = value;
    }
    return patch;
}

/**
 * Ignore / dismiss a proposal without applying presentation.
 * @param {Record<string, unknown>} identity
 * @param {string} field
 */
export function ignoreIdentityProposal(identity, field) {
    const graph = cloneIdentity(identity);
    const key = String(field || '').trim();
    const prev = graph.proposals?.[key];
    if (graph.proposals) {
        const next = { ...graph.proposals };
        delete next[key];
        const alias = aliasInverse(key);
        if (alias) delete next[alias];
        graph.proposals = next;
    }
    graph.ignored = {
        ...(graph.ignored || {}),
        [key]: {
            value: prev?.value ?? null,
            ignoredAt: new Date().toISOString()
        }
    };
    graph.updatedAt = new Date().toISOString();
    dispatchIntelligenceUpdated({
        reelId: graph.reelId,
        changedField: key,
        previousValue: prev?.value ?? null,
        newValue: null,
        source: IDENTITY_SOURCES.NLP_INFERENCE,
        confidence: prev?.confidence ?? 0,
        approved: false
    });
    return graph;
}

/**
 * Presentation-safe title: never AI-suggested replacement of creator title.
 * @param {Record<string, unknown> | null | undefined} identity
 * @param {string} [fallback]
 */
export function resolvePresentationTitle(identity, fallback = '') {
    const title = identity?.fields?.title;
    if (title && String(title.value || '').trim()) return String(title.value).trim();
    return String(fallback || '').trim();
}

/**
 * Soft discovery payload (safe for tags/mood; not titles).
 * Includes unapproved proposals for the discovery graph side-channel.
 * @param {Record<string, unknown> | null | undefined} identity
 */
export function resolveDiscoverySignals(identity) {
    const getVal = (key) => {
        const accepted = identity?.accepted?.[key] || identity?.fields?.[key];
        if (accepted?.value != null && accepted.value !== '') return accepted.value;
        const prop = identity?.proposals?.[key];
        return prop?.value ?? null;
    };
    return {
        category: getVal('category'),
        mood: getVal('mood'),
        location: getVal('location'),
        storyKeywords: getVal('storyKeywords') || [],
        audienceSignal: getVal('audienceSignal'),
        discoveryTags: getVal('discoveryTags') || [],
        suggestedDescription: getVal('suggestedDescription') || getVal('heroDescription'),
        suggestedSubtitle: getVal('suggestedSubtitle') || getVal('heroSubtitle'),
        pendingApproval: Boolean(
            identity?.proposals?.suggestedDescription ||
                identity?.proposals?.heroDescription ||
                identity?.proposals?.suggestedSubtitle
        )
    };
}

/**
 * Whether a write to a presentation field is allowed from a given source.
 * @param {string} field
 * @param {number|string} source
 * @param {{ explicitCreatorAction?: boolean }} [opts]
 */
export function assertPresentationWriteAllowed(field, source, opts = {}) {
    const f = String(field || '').trim();
    const rank = rankOfSource(source);
    if (isLockedIdentityField(f) || f === 'heroTitle' || f === 'heroAssetTitle') {
        return (
            opts.explicitCreatorAction === true ||
            rank >= IDENTITY_SOURCES.CREATOR_TITLE ||
            // filename→humanize only when no title yet (caller), using filename rank
            rank === IDENTITY_SOURCES.FILENAME
        );
    }
    if (f === 'heroDescription' || f === 'heroSubtitle') {
        // Only creator-approved / creator-direct writes
        return opts.explicitCreatorAction === true || rank >= IDENTITY_SOURCES.CREATOR_DESCRIPTION;
    }
    return true;
}

/**
 * Merge NLP proposals onto identity without touching locked creator title.
 * @param {Record<string, unknown> | null} existing
 * @param {ReturnType<typeof buildGovernedIdentity>} next
 */
export function mergeGovernedIdentity(existing, next) {
    if (!existing || typeof existing !== 'object') return next;
    const base = cloneIdentity(existing);
    const priorTitle = base.fields?.title;
    // Keep higher-authority title
    if (priorTitle && next.fields?.title) {
        if (!canOverwriteField(priorTitle, next.fields.title.sourceRank)) {
            next.fields.title = priorTitle;
        }
    }
    // Preserve accepted approvals
    next.accepted = { ...(base.accepted || {}), ...(next.accepted || {}) };
    for (const [k, v] of Object.entries(next.accepted)) {
        next.fields[k] = v;
    }
    // Merge ignored so we don't re-spam dismissed story once
    next.ignored = { ...(base.ignored || {}), ...(next.ignored || {}) };
    if (next.ignored) {
        for (const key of Object.keys(next.ignored)) {
            if (next.proposals?.[key]) {
                // Re-propose only if NLP text changed
                const newVal = JSON.stringify(next.proposals[key].value);
                const oldVal = JSON.stringify(next.ignored[key]?.value);
                if (newVal === oldVal) {
                    delete next.proposals[key];
                    const alias = aliasInverse(key);
                    if (alias) delete next.proposals[alias];
                }
            }
        }
    }
    next.reelId = next.reelId || base.reelId;
    return next;
}

/**
 * @param {Record<string, unknown>} identity
 */
function cloneIdentity(identity) {
    try {
        return JSON.parse(JSON.stringify(identity || {}));
    } catch {
        return { ...(identity || {}), fields: {}, proposals: {}, accepted: {} };
    }
}

/**
 * Convenience: pending story proposal text for Hero Manager UI.
 * @param {Record<string, unknown> | null | undefined} identity
 */
export function getPendingStoryProposal(identity) {
    const desc =
        identity?.proposals?.suggestedDescription ||
        identity?.proposals?.heroDescription ||
        null;
    const sub =
        identity?.proposals?.suggestedSubtitle || identity?.proposals?.heroSubtitle || null;
    if (!desc && !sub) return null;
    return {
        description: desc?.value || '',
        subtitle: sub?.value || '',
        confidence: desc?.confidence || sub?.confidence || 0,
        source: desc?.source || sub?.source || 'nlp',
        assistantHint: identity?.assistantHint || ''
    };
}
