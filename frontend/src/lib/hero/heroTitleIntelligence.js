/**
 * Hero Vault Title Intelligence — first-class content identity for vault hero assets.
 *
 * Single source of truth: human-edited vault titles (not filenames).
 * NLP enrichment reuses pattern-style detectors already used across ReelForge content.
 * Presentation writes go through Content Identity Guard (propose → approve).
 */

import {
    IDENTITY_SOURCES,
    assertPresentationWriteAllowed,
    buildGovernedIdentity,
    mergeGovernedIdentity,
    resolvePresentationTitle
} from '../intelligence/contentIdentityGuard.js';
import {
    extractLocationFromText,
    locationDiscoveryTags,
    normalizeLocationEntity
} from '../intelligence/locationEntityNormalizer.js';

/** Default when no safe human title exists. */
export const UNTITLED_CREATOR_EXPERIENCE = 'Untitled Creator Experience';

const MEDIA_EXT = /\.(mov|mp4|webm|m4v|avi|mkv|jpe?g|png|gif|webp)(\b|$)/i;
const UUID_LIKE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UPLOAD_TEMP =
    /^(blob|tmp|temp|upload|pending|hero-(video|image)-|reelforge[_-]upload)[-_]?/i;

const STOPWORDS = new Set([
    'a',
    'an',
    'and',
    'as',
    'at',
    'by',
    'for',
    'from',
    'in',
    'into',
    'of',
    'on',
    'or',
    'the',
    'to',
    'with',
    'your',
    'our',
    'its',
    'live',
    'video',
    'reel',
    'final',
    'v1',
    'v2',
    'v3',
    'mp4',
    'mov',
    'webm'
]);

/** Category signals (aligned with contentAgents CATEGORY_DETECTOR + discovery travel/local). */
const CATEGORY_LEXICON = {
    travel: [
        'travel',
        'beach',
        'sunset',
        'drone',
        'coastal',
        'island',
        'vacation',
        'journey',
        'roadtrip',
        'miami',
        'atlanta',
        'downtown',
        'city',
        'skyline',
        'market',
        'nightlife'
    ],
    culture: ['culture', 'community', 'food', 'night', 'market', 'barbershop', 'heritage', 'legacy', 'festival'],
    action: ['action', 'chase', 'fight', 'combat', 'mission', 'race', 'stunt'],
    romance: ['love', 'romance', 'wedding', 'couple', 'heart'],
    suspense: ['mystery', 'dark', 'thriller', 'horror', 'secret', 'noir'],
    documentary: ['documentary', 'land', 'story', 'oral', 'history', 'interview'],
    music: ['music', 'concert', 'beat', 'dance', 'dj', 'live set'],
    sports: ['sports', 'game', 'match', 'court', 'field', 'training'],
    creator: ['studio', 'behind', 'bts', 'creator', 'vlog', 'day in']
};

const MOOD_LEXICON = {
    cinematic: ['cinematic', 'drone', 'sunset', 'golden', 'film', 'aerial', 'epic', 'skyline'],
    energetic: ['night', 'market', 'nightlife', 'party', 'live', 'pulse', 'club', 'downtown'],
    calm: ['calm', 'peaceful', 'quiet', 'morning', 'soft', 'serene'],
    dramatic: ['storm', 'intense', 'power', 'battle', 'legacy', 'power'],
    joyful: ['joy', 'celebration', 'festival', 'family', 'smile', 'pride'],
    mysterious: ['mystery', 'fog', 'noir', 'shadow', 'secret']
};

const PENDING_TITLE_PATCH_KEY = 'reelforge_pending_reel_title_patches';

/**
 * @param {unknown} value
 */
export function isUnsafeHeroFilenameTitle(value) {
    const text = String(value || '').trim();
    if (!text) return true;
    if (MEDIA_EXT.test(text)) return true;
    if (UUID_LIKE.test(text)) return true;
    if (UPLOAD_TEMP.test(text)) return true;
    // MICROS_STIRR_2026_FINAL style
    if (/^[A-Z0-9]+([_-][A-Z0-9]+){1,}$/.test(text) && text.includes('_')) return true;
    if (/^\d{6,}$/.test(text)) return true;
    if (text.length > 64 && !/\s/.test(text)) return true;
    return false;
}

/**
 * Humanize raw upload names when no better title exists (never returns .mov/.mp4 labels to UI).
 * @param {string} value
 */
export function humanizeRawTitleCandidate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const stripped = raw
        .replace(MEDIA_EXT, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!stripped || UUID_LIKE.test(stripped)) return '';
    return stripped
        .split(' ')
        .filter(Boolean)
        .map((token) => {
            const lower = token.toLowerCase();
            if (lower.length <= 2) return lower.toUpperCase();
            return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
        })
        .join(' ');
}

/**
 * Normalize a user-edited title into a durable display form.
 * @param {string} title
 */
export function normalizeHeroTitle(title) {
    const text = String(title || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) return '';
    if (isUnsafeHeroFilenameTitle(text)) {
        const humanized = humanizeRawTitleCandidate(text);
        return humanized || '';
    }
    // Strip trailing extensions even if mixed into display title
    return text.replace(MEDIA_EXT, '').trim();
}

/**
 * Fallback priority for user-facing hero text:
 * 1. persistent title  2. episode title  3. NLP/humanized  4. generic
 * @param {{
 *   editedTitle?: string;
 *   persistentTitle?: string;
 *   episodeTitle?: string;
 *   assetTitle?: string;
 *   fileName?: string;
 *   nlpTitle?: string;
 * }} sources
 */
export function resolveCanonicalHeroTitle(sources = {}) {
    const candidates = [
        sources.editedTitle,
        sources.persistentTitle,
        sources.episodeTitle,
        sources.nlpTitle,
        sources.assetTitle,
        sources.fileName
    ];
    for (const candidate of candidates) {
        const normalized = normalizeHeroTitle(candidate);
        if (normalized && !isUnsafeHeroFilenameTitle(normalized)) {
            return normalized;
        }
        // humanize last-chance raw names
        const human = humanizeRawTitleCandidate(candidate);
        if (human && !isUnsafeHeroFilenameTitle(human)) {
            return human;
        }
    }
    return UNTITLED_CREATOR_EXPERIENCE;
}

/** Existing vault title map — never invent another storage key. */
export const REEL_TITLES_PERSISTENT_KEY = 'reel_titles_persistent';

/**
 * Read durable reel title from the existing reel_titles_persistent map (browser only).
 * @param {string} assetId
 * @param {string} [storageKey]
 * @returns {string}
 */
export function lookupPersistentHeroTitle(assetId, storageKey = REEL_TITLES_PERSISTENT_KEY) {
    const id = String(assetId || '').trim();
    if (!id || typeof localStorage === 'undefined') return '';
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return '';
        const map = JSON.parse(raw);
        if (!map || typeof map !== 'object') return '';
        const entry = map[id];
        if (!entry || typeof entry !== 'object') return '';
        return String(
            /** @type {{ title?: string; title_original?: string }} */ (entry).title ||
                /** @type {{ title?: string; title_original?: string }} */ (entry).title_original ||
                ''
        ).trim();
    } catch {
        return '';
    }
}

/**
 * Same resolve inputs Hero Vault getDisplayTitle uses (plus optional session rename).
 * heroDescription is intentionally never an input.
 *
 * @param {{
 *   assetId?: string;
 *   editedTitle?: string;
 *   persistentTitle?: string;
 *   episodeTitle?: string;
 *   assetTitle?: string;
 *   fileName?: string;
 *   managerHeroTitle?: string;
 *   titlesStorageKey?: string;
 * }} [sources]
 * @returns {string}
 */
export function resolveActiveHeroCanonicalTitle(sources = {}) {
    const assetId = String(sources.assetId || '').trim();
    const persistentTitle =
        sources.persistentTitle !== undefined
            ? String(sources.persistentTitle || '').trim()
            : assetId
              ? lookupPersistentHeroTitle(assetId, sources.titlesStorageKey || REEL_TITLES_PERSISTENT_KEY)
              : '';
    return resolveCanonicalHeroTitle({
        editedTitle: sources.editedTitle,
        persistentTitle,
        episodeTitle: sources.episodeTitle,
        // Manager/server headline is an asset-level candidate, not description.
        assetTitle: sources.assetTitle || sources.managerHeroTitle,
        fileName: sources.fileName
    });
}

/**
 * Same durable resolver for any linked reel/asset projection (Video Vault, Series/Episode,
 * Theater, Studio). Never invents storage — uses reel_titles_persistent first.
 * @param {string} assetId
 * @param {{
 *   editedTitle?: string;
 *   persistentTitle?: string;
 *   episodeTitle?: string;
 *   assetTitle?: string;
 *   fileName?: string;
 *   managerHeroTitle?: string;
 *   titlesStorageKey?: string;
 * }} [sources]
 * @returns {string}
 */
export function resolveLinkedAssetDisplayTitle(assetId, sources = {}) {
    return resolveActiveHeroCanonicalTitle({
        ...sources,
        assetId: String(assetId || sources.assetId || '').trim()
    });
}

/**
 * Reconcile presentation/manager heroTitle to vault-canonical resolve for the active assetId.
 * Does not rewrite heroDescription. Does not invent title storage.
 *
 * @template {Record<string, unknown>} T
 * @param {T | null | undefined} config
 * @param {{
 *   assetId?: string;
 *   editedTitle?: string;
 *   persistentTitle?: string;
 *   episodeTitle?: string;
 *   assetTitle?: string;
 *   fileName?: string;
 *   titlesStorageKey?: string;
 * }} [options]
 * @returns {T | null | undefined}
 */
export function reconcileActivePresentationHeroTitle(config, options = {}) {
    if (!config || typeof config !== 'object') return config;
    const assetId = String(options.assetId || config.heroAssetId || '').trim();
    if (!assetId) return config;

    const managerTitle = String(config.heroTitle || config.heroAssetTitle || '').trim();
    const assetTitle = String(
        options.assetTitle !== undefined ? options.assetTitle : managerTitle
    ).trim();
    const persistentTitle =
        options.persistentTitle !== undefined
            ? String(options.persistentTitle || '').trim()
            : lookupPersistentHeroTitle(assetId, options.titlesStorageKey || REEL_TITLES_PERSISTENT_KEY);
    const editedTitle =
        options.editedTitle !== undefined ? String(options.editedTitle || '').trim() : '';
    const episodeTitle = String(options.episodeTitle || '').trim();
    const fileName = String(options.fileName || '').trim();

    const hasStrongSignal = Boolean(
        editedTitle ||
            persistentTitle ||
            episodeTitle ||
            (assetTitle && !isUnsafeHeroFilenameTitle(assetTitle))
    );
    if (!hasStrongSignal) return config;

    const title = resolveCanonicalHeroTitle({
        editedTitle,
        persistentTitle,
        episodeTitle,
        assetTitle,
        fileName
    });
    if (!title) return config;
    // Avoid promoting Untitled when the only signals were unsafe filenames.
    if (title === UNTITLED_CREATOR_EXPERIENCE && !editedTitle && !persistentTitle && !episodeTitle) {
        return config;
    }

    if (
        String(config.heroTitle || '').trim() === title &&
        String(config.heroAssetTitle || '').trim() === title
    ) {
        return config;
    }

    return {
        ...config,
        heroTitle: title,
        heroAssetTitle: title
    };
}

/**
 * @param {string} text
 */
function tokenize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t && t.length > 2 && !STOPWORDS.has(t));
}

/**
 * @param {string} lower
 * @param {Record<string, string[]>} lexicon
 */
function bestLexiconMatch(lower, lexicon) {
    let best = '';
    let bestScore = 0;
    for (const [key, words] of Object.entries(lexicon)) {
        let score = 0;
        for (const w of words) {
            if (lower.includes(w)) score += w.includes(' ') ? 2 : 1;
        }
        if (score > bestScore) {
            bestScore = score;
            best = key;
        }
    }
    return bestScore > 0 ? best : '';
}

/**
 * Lightweight title NLP for hero storytelling / discovery.
 * @param {string} title
 * @param {{ assetType?: string; isVideo?: boolean; categoryHint?: string; description?: string } | null} [metadata]
 * @returns {{
 *   normalizedTitle: string;
 *   category: string;
 *   mood: string;
 *   location: string;
 *   storyKeywords: string[];
 *   audienceSignal: string;
 *   heroDescription: string;
 *   discoveryTags: string[];
 *   heroSubtitle: string;
 *   isFilenameProtected: boolean;
 * }}
 */
export function analyzeHeroTitle(title, metadata = null) {
    const raw = String(title || '').trim();
    const filenameProtected = isUnsafeHeroFilenameTitle(raw);
    // Creator-facing title only — never rewritten by location NLP.
    const normalizedTitle = resolveCanonicalHeroTitle({
        editedTitle: raw,
        nlpTitle: humanizeRawTitleCandidate(raw)
    });

    const lower = normalizedTitle.toLowerCase();
    const tokens = tokenize(normalizedTitle);
    const metaBits = String(metadata?.description || metadata?.categoryHint || '').toLowerCase();
    // Prefer raw + normalized so compact forms (LosAngeles) still extract.
    const haystack = `${raw} ${normalizedTitle} ${metaBits}`;

    // Semantic location normalization BEFORE story / tags / audience assembly.
    const extracted =
        extractLocationFromText(haystack, { log: true }) ||
        extractLocationFromText(raw, { log: true });
    let resolvedLocation = extracted?.canonical || '';
    let resolvedAliases = extracted?.aliases || (resolvedLocation ? locationDiscoveryTags(resolvedLocation) : []);
    if (!resolvedLocation && metadata?.location) {
        const fromMeta = normalizeLocationEntity(String(metadata.location), { log: true });
        if (fromMeta) {
            resolvedLocation = fromMeta.canonical;
            resolvedAliases = fromMeta.aliases;
        }
    }

    const category =
        bestLexiconMatch(`${lower} ${metaBits}`, CATEGORY_LEXICON) ||
        (metadata?.isVideo === false ? 'creator' : 'creator');
    const mood = bestLexiconMatch(`${lower} ${metaBits}`, MOOD_LEXICON) || 'cinematic';

    const storyKeywords = Array.from(
        new Set([
            ...tokens.slice(0, 10),
            // slug tokens from location, not title-cased "La"
            ...resolvedAliases.filter((a) => a.length > 1),
            category,
            mood
        ])
    ).slice(0, 12);

    const audienceByCategory = {
        travel: 'travel discovery',
        culture: 'community culture seekers',
        action: 'high-energy viewers',
        romance: 'romance and relationship audiences',
        suspense: 'thriller fans',
        documentary: 'documentary audiences',
        music: 'music discovery',
        sports: 'sports fans',
        creator: 'creator vault audiences'
    };
    // Audience signal can reference normalized place without rewriting title.
    const baseAudience = audienceByCategory[category] || 'creator vault audiences';
    const audienceSignal = resolvedLocation
        ? `${baseAudience} · ${resolvedLocation}`
        : baseAudience;

    const isVideo = metadata?.isVideo !== false;
    const placeClause = resolvedLocation ? ` in ${resolvedLocation}` : '';
    const moodClause = mood === 'cinematic' ? 'cinematic' : mood;

    let heroDescription = '';
    if (category === 'travel') {
        heroDescription = `Discover a ${moodClause} travel moment${placeClause} — ${normalizedTitle}.`;
    } else if (category === 'culture' || /market|night|food|downtown/i.test(normalizedTitle)) {
        heroDescription = `Explore a live city experience featuring food, culture, and nightlife${placeClause}.`;
    } else if (category === 'documentary') {
        heroDescription = `A grounded documentary spotlight: ${normalizedTitle}.`;
    } else if (isVideo) {
        heroDescription = resolvedLocation
            ? `Trending local experience from ${resolvedLocation}, captured from the creator vault.`
            : `Trending local experience captured from the creator vault.`;
    } else {
        heroDescription = `Featured still from the creator vault: ${normalizedTitle}.`;
    }

    const heroSubtitle =
        resolvedLocation || category === 'travel'
            ? `Trending ${category === 'travel' ? 'travel' : 'local'} experience${
                  resolvedLocation ? ` in ${resolvedLocation}` : ''
              } captured from the creator vault.`
            : `Trending local experience captured from the creator vault.`;

    const discoveryTags = Array.from(
        new Set([
            category,
            mood,
            ...locationDiscoveryTags(resolvedLocation, resolvedAliases),
            'hero-background',
            isVideo ? 'vault-video' : 'vault-image',
            ...storyKeywords.slice(0, 6)
        ])
    );

    return {
        normalizedTitle,
        category,
        mood,
        location: resolvedLocation,
        storyKeywords,
        audienceSignal,
        heroDescription,
        discoveryTags,
        heroSubtitle,
        isFilenameProtected: filenameProtected,
        locationAliases: resolvedAliases
    };
}

/**
 * Compact story context bound to a hero asset selection.
 * Framing is advisory until creator approval elevates it into presentation.
 * @param {string} assetId
 * @param {ReturnType<typeof analyzeHeroTitle>} intelligence
 * @param {{ approved?: boolean }} [flags]
 */
export function buildHeroStoryContext(assetId, intelligence, flags = {}) {
    return {
        heroAssetId: String(assetId || '').trim(),
        heroAssetTitle: intelligence.normalizedTitle,
        headline: intelligence.normalizedTitle,
        supportingStory: intelligence.heroSubtitle,
        description: intelligence.heroDescription,
        category: intelligence.category,
        mood: intelligence.mood,
        location: intelligence.location,
        storyKeywords: intelligence.storyKeywords,
        audienceSignal: intelligence.audienceSignal,
        discoveryTags: intelligence.discoveryTags,
        approved: flags.approved === true,
        updatedAt: new Date().toISOString()
    };
}

/**
 * Manager config fields from title intelligence under Content Identity Guard.
 * Creator title binds; NLP story/tags become unapproved proposals (not silent overwrites).
 *
 * @param {string} assetId
 * @param {string} title
 * @param {{
 *   isVideo?: boolean;
 *   force?: boolean;
 *   previous?: Record<string, unknown>;
 *   titleSource?: number|string;
 *   explicitCreatorAction?: boolean;
 * }} [options]
 */
export function buildHeroManagerPatchFromTitleIntel(assetId, title, options = {}) {
    const intelligence = analyzeHeroTitle(title, {
        isVideo: options.isVideo !== false
    });
    const prev = options.previous || {};
    const explicitCreatorAction = options.explicitCreatorAction === true || options.force === true;
    const titleSource =
        options.titleSource ??
        (explicitCreatorAction ? IDENTITY_SOURCES.CREATOR_TITLE : IDENTITY_SOURCES.CREATOR_TITLE);

    const governed = mergeGovernedIdentity(
        /** @type {Record<string, unknown>|null} */ (prev.contentIdentity || null),
        buildGovernedIdentity({
            reelId: assetId,
            creatorTitle: intelligence.normalizedTitle,
            titleSource,
            nlp: intelligence,
            previousIdentity: prev.contentIdentity || null
        })
    );

    const context = buildHeroStoryContext(assetId, intelligence, { approved: false });
    const presentationTitle = resolvePresentationTitle(governed, intelligence.normalizedTitle);

    /** @type {Record<string, unknown>} */
    const patch = {
        heroCopySourceAssetId: assetId,
        // Locked identity — creator title only
        heroAssetTitle: presentationTitle,
        contentIdentity: governed,
        heroIntelligenceProposals: governed.proposals || {},
        heroTitleIntelligence: {
            ...intelligence,
            // Governed field map (confidence + source)
            governed: governed.fields,
            proposals: governed.proposals,
            assistantHint: governed.assistantHint,
            contract: 'creator-source-of-truth'
        },
        // Unapproved story framing lives beside presentation; not auto-applied.
        heroStoryContext: {
            ...context,
            approved: false,
            pendingApproval: true
        }
    };

    // Title write: only when empty, filename-like, or explicit creator bind (edit title / select asset).
    const prevTitle = String(prev.heroTitle || '').trim();
    const mayWriteTitle =
        assertPresentationWriteAllowed('heroTitle', titleSource, { explicitCreatorAction }) &&
        (explicitCreatorAction ||
            !prevTitle ||
            isUnsafeHeroFilenameTitle(prevTitle) ||
            String(prev.heroCopySourceAssetId || '') === String(assetId));

    if (mayWriteTitle) {
        // Creator vault title is source of truth for landscape headline.
        patch.heroTitle = presentationTitle;
    }

    // NEVER auto-write heroDescription / heroSubtitle from NLP.
    // Restore previously accepted presentation only.
    const acceptedDesc =
        governed.accepted?.suggestedDescription ||
        governed.accepted?.heroDescription ||
        governed.fields?.heroDescription;
    const acceptedSub =
        governed.accepted?.suggestedSubtitle ||
        governed.accepted?.heroSubtitle ||
        governed.fields?.heroSubtitle;

    if (acceptedDesc?.approved && acceptedDesc.value) {
        patch.heroDescription = acceptedDesc.value;
        patch.heroStoryContext = {
            ...context,
            description: acceptedDesc.value,
            approved: true,
            pendingApproval: false
        };
    }
    if (acceptedSub?.approved && acceptedSub.value) {
        patch.heroSubtitle = acceptedSub.value;
    }

    // Strip stock demo description when force-rebinding if not creator-approved NLP.
    const prevDescription = String(prev.heroDescription || '').trim();
    if (
        explicitCreatorAction &&
        (!acceptedDesc?.approved) &&
        (/black land ownership/i.test(prevDescription) ||
            /editorial content now reflects/i.test(prevDescription))
    ) {
        // Clear misleading stock copy without injecting AI text.
        patch.heroDescription = '';
    }

    const prevSubtitle = String(prev.heroSubtitle || '').trim();
    if (
        explicitCreatorAction &&
        (!acceptedSub?.approved) &&
        (/cinematic spotlight/i.test(prevSubtitle) || /live from your (video|thumbnail) vault/i.test(prevSubtitle))
    ) {
        // Leave blank until creator accepts story proposal.
        patch.heroSubtitle = '';
    }

    return { patch, intelligence, context, contentIdentity: governed };
}

/**
 * Emit real-time title update with full intelligence payload.
 * @param {{
 *   reelId: string;
 *   oldTitle?: string;
 *   newTitle: string;
 *   heroBound?: boolean;
 *   episodeId?: string | null;
 *   intelligence?: ReturnType<typeof analyzeHeroTitle> | null;
 *   source?: string;
 * }} detail
 */
export function dispatchVaultTitleUpdated(detail) {
    if (typeof window === 'undefined') return;
    const payload = {
        reelId: String(detail.reelId || '').trim(),
        oldTitle: String(detail.oldTitle || '').trim(),
        newTitle: String(detail.newTitle || '').trim(),
        title: String(detail.newTitle || detail.title || '').trim(),
        heroBound: Boolean(detail.heroBound),
        episodeId: detail.episodeId || null,
        updatedAt: new Date().toISOString(),
        intelligence: detail.intelligence || null,
        source: detail.source || 'hero-title-intelligence'
    };
    window.dispatchEvent(new CustomEvent('reelforge:vault-title-updated', { detail: payload }));
    window.dispatchEvent(new CustomEvent('reelforge:hero-title-intelligence', { detail: payload }));
    console.info('[HERO_TITLE_INTELLIGENCE]', payload);
}

/**
 * Queue PATCH title when backend is offline (reconcile later).
 * @param {string} reelId
 * @param {string} title
 */
export function queuePendingTitlePatch(reelId, title) {
    if (typeof window === 'undefined' || !reelId || !title) return;
    try {
        const raw = localStorage.getItem(PENDING_TITLE_PATCH_KEY);
        const list = raw ? JSON.parse(raw) : [];
        const next = Array.isArray(list) ? list.filter((row) => row?.reelId !== reelId) : [];
        next.push({
            reelId,
            title,
            queuedAt: new Date().toISOString()
        });
        localStorage.setItem(PENDING_TITLE_PATCH_KEY, JSON.stringify(next.slice(-50)));
    } catch {
        /* ignore */
    }
}

/**
 * Flush queued title PATCHes when network/auth recovers.
 * @param {(headers?: Record<string, string>) => Record<string, string>} [authHeaders]
 */
export async function reconcilePendingTitlePatches(authHeaders = () => ({})) {
    if (typeof window === 'undefined') return { flushed: 0 };
    let list = [];
    try {
        list = JSON.parse(localStorage.getItem(PENDING_TITLE_PATCH_KEY) || '[]');
    } catch {
        list = [];
    }
    if (!Array.isArray(list) || !list.length) return { flushed: 0 };

    const remaining = [];
    let flushed = 0;
    for (const row of list) {
        const reelId = String(row?.reelId || '').trim();
        const title = String(row?.title || '').trim();
        if (!reelId || !title) continue;
        try {
            const res = await fetch(`/api/reels/${encodeURIComponent(reelId)}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    ...authHeaders()
                },
                body: JSON.stringify({ title })
            });
            if (res.ok) flushed += 1;
            else remaining.push(row);
        } catch {
            remaining.push(row);
        }
    }
    try {
        localStorage.setItem(PENDING_TITLE_PATCH_KEY, JSON.stringify(remaining));
    } catch {
        /* ignore */
    }
    return { flushed, remaining: remaining.length };
}
