/**
 * Phase 2.5 — deterministic multi-signal local NLP provider (suggestion-only).
 *
 * Signal hierarchy (provider does not invent title authority):
 *   canonical title (already resolved into meta.title)
 *   → description / tags / series / episode
 *   → combination patterns
 *   → generic-title penalty
 *   → Trending fallback
 *
 * Creator locks are enforced by classifyContentSemantic — not here.
 * No network / OpenAI / Ollama.
 */

import {
    DISCOVERY_SHELVES,
    isGenericMediaLabel,
    normalizeDiscoveryShelf,
    classifyContentSemantic
} from './contentClassifier.js';

/** @type {ReadonlySet<string>} */
export const GENERIC_TITLE_TOKENS = Object.freeze(
    new Set([
        'after',
        'home',
        'open',
        'arrival',
        'motherland',
        'journey',
        'life',
        'dream',
        'dreams',
        'day',
        'night',
        'story',
        'stories',
        'one',
        'two',
        'the',
        'a',
        'an',
        'and',
        'of',
        'in',
        'to',
        'for',
        'on',
        'at',
        'with'
    ])
);

/** Strong / medium / weak lexicons per shelf — precompiled Sets for O(tokens). */
export const SEMANTIC_LEXICONS = Object.freeze({
    Romance: Object.freeze({
        strong: Object.freeze(
            new Set([
                'love',
                'lover',
                'lovers',
                'romance',
                'romantic',
                'kiss',
                'kissing',
                'soulmate',
                'wedding',
                'marriage',
                'dating',
                'passion',
                'sweetheart',
                'valentine',
                'affair',
                'breakup',
                'desire'
            ])
        ),
        medium: Object.freeze(
            new Set([
                'heart',
                'hearts',
                'relationship',
                'forever',
                'together',
                'feelings',
                'tender',
                'sweet',
                'emotional',
                'chemistry',
                'attraction',
                'destiny',
                'couple'
            ])
        ),
        weak: Object.freeze(new Set(['morning', 'evening', 'night', 'until', 'me']))
    }),
    'Cyber-Action': Object.freeze({
        strong: Object.freeze(
            new Set([
                'cyber',
                'cyberpunk',
                'hacker',
                'hacking',
                'hack',
                'espionage',
                'android',
                'protocol',
                'breach',
                'surveillance',
                'operative',
                'extraction',
                'gunfight',
                'shootout',
                'assassin',
                'mercenary'
            ])
        ),
        medium: Object.freeze(
            new Set([
                'digital',
                'network',
                'terminal',
                'system',
                'neon',
                'agent',
                'strike',
                'combat',
                'mission',
                'pursuit',
                'weapon',
                'weapons',
                'futuristic',
                'ai'
            ])
        ),
        weak: Object.freeze(new Set(['tokyo', 'city', 'future', 'tech', 'code']))
    }),
    Suspense: Object.freeze({
        strong: Object.freeze(
            new Set([
                'mystery',
                'suspense',
                'horror',
                'haunted',
                'paranormal',
                'whodunit',
                'cliffhanger',
                'murder',
                'disappearance',
                'hunted',
                'trapped',
                'sinister',
                'ominous'
            ])
        ),
        medium: Object.freeze(
            new Set([
                'missing',
                'secret',
                'hidden',
                'shadow',
                'witness',
                'investigation',
                'danger',
                'threat',
                'escape',
                'stranger',
                'evidence',
                'betrayal',
                'warning',
                'locked',
                'isolated',
                'unknown',
                'reveal'
            ])
        ),
        weak: Object.freeze(new Set(['last', 'house', 'night', 'dark', 'fear']))
    }),
    Trending: Object.freeze({
        strong: Object.freeze(new Set(['viral', 'trending', 'premiere', 'breaking', 'barbershop'])),
        medium: Object.freeze(new Set(['exclusive', 'special', 'hot'])),
        weak: Object.freeze(new Set(['new', 'latest', 'popular']))
    })
});

/**
 * Combination patterns — require multi-token / phrase evidence.
 * @type {ReadonlyArray<{ shelf: string; weight: number; signal: string; test: (hay: string, tokens: Set<string>) => boolean }>}
 */
const COMBINATION_RULES = Object.freeze([
    {
        shelf: 'Romance',
        weight: 4.5,
        signal: 'combo:love-me-until',
        test: (hay) => /\blove\s+me\b/.test(hay) || /\buntil\s+morning\b/.test(hay)
    },
    {
        shelf: 'Romance',
        weight: 3.5,
        signal: 'combo:love-in',
        test: (hay) => /\blove\s+in\b/.test(hay) || /\bin\s+love\b/.test(hay)
    },
    {
        shelf: 'Cyber-Action',
        weight: 5,
        signal: 'combo:cyber-strike',
        test: (hay, tokens) =>
            /\bcyber\s*strike\b/.test(hay) || (tokens.has('cyber') && tokens.has('strike'))
    },
    {
        shelf: 'Cyber-Action',
        weight: 4,
        signal: 'combo:cyber-mission',
        test: (_hay, tokens) =>
            tokens.has('cyber') &&
            (tokens.has('mission') ||
                tokens.has('combat') ||
                tokens.has('agent') ||
                tokens.has('operative'))
    },
    {
        shelf: 'Cyber-Action',
        weight: 3.5,
        signal: 'combo:hack-breach',
        test: (_hay, tokens) =>
            (tokens.has('hack') || tokens.has('hacker') || tokens.has('hacking')) &&
            (tokens.has('breach') ||
                tokens.has('protocol') ||
                tokens.has('network') ||
                tokens.has('system'))
    },
    {
        shelf: 'Suspense',
        weight: 4.5,
        signal: 'combo:last-house',
        test: (hay, tokens) => /\blast\s+house\b/.test(hay) || (tokens.has('last') && tokens.has('house'))
    },
    {
        shelf: 'Suspense',
        weight: 3.5,
        signal: 'combo:missing-secret',
        test: (_hay, tokens) =>
            (tokens.has('missing') || tokens.has('disappearance')) &&
            (tokens.has('secret') ||
                tokens.has('house') ||
                tokens.has('night') ||
                tokens.has('shadow'))
    },
    {
        shelf: 'Romance',
        weight: 3.2,
        signal: 'combo:agent-of-love',
        test: (hay, tokens) =>
            /\bagent\s+of\s+love\b/.test(hay) || (tokens.has('love') && tokens.has('agent'))
    },
    {
        shelf: 'Cyber-Action',
        weight: 2.8,
        signal: 'combo:neon-city',
        test: (_hay, tokens) => tokens.has('neon') && (tokens.has('city') || tokens.has('hearts') || tokens.has('heart'))
    },
    {
        shelf: 'Romance',
        weight: 2.8,
        signal: 'combo:neon-hearts',
        test: (_hay, tokens) =>
            (tokens.has('neon') || tokens.has('cyber')) && (tokens.has('heart') || tokens.has('hearts'))
    },
    {
        shelf: 'Suspense',
        weight: 3.2,
        signal: 'combo:midnight-betrayal',
        test: (hay, tokens) =>
            /\bmidnight\s+betrayal\b/.test(hay) || (tokens.has('betrayal') && tokens.has('midnight'))
    }
]);

/**
 * Cross-shelf conflict pairs — when both score meaningfully, dampen confidence.
 * @type {ReadonlyArray<readonly [string, string]>}
 */
const CONFLICT_PAIRS = Object.freeze([
    Object.freeze(/** @type {const} */ (['Romance', 'Cyber-Action'])),
    Object.freeze(/** @type {const} */ (['Romance', 'Suspense'])),
    Object.freeze(/** @type {const} */ (['Cyber-Action', 'Suspense']))
]);

/**
 * @param {string} value
 * @returns {string}
 */
function hay(value) {
    return value == null ? '' : String(value).trim().toLowerCase();
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeClassificationText(text) {
    return hay(text)
        .replace(/[^a-z0-9\s]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

/**
 * @param {number} confidence
 * @returns {'strong' | 'good' | 'weak' | 'manual' | 'none'}
 */
export function confidenceBand(confidence) {
    const n = Number(confidence);
    if (!Number.isFinite(n) || n < 0) return 'none';
    if (n >= 0.85) return 'strong';
    if (n >= 0.7) return 'good';
    if (n >= 0.5) return 'weak';
    if (n > 0) return 'manual';
    return 'none';
}

/**
 * @param {string} primary
 * @param {number} confidence
 * @param {string[]} signals
 * @param {{
 *   alternativeCategory?: string;
 *   ambiguous?: boolean;
 *   scoreBreakdown?: Record<string, number>;
 *   confidenceBand?: string;
 * }} [extra]
 * @returns {import('./contentClassifier.js').ContentClassification}
 */
function nlpResult(primary, confidence, signals, extra = {}) {
    const shelf = normalizeDiscoveryShelf(primary);
    const conf = Math.max(0, Math.min(1, confidence));
    /** @type {string[]} */
    const categories = shelf === 'Trending' ? [shelf] : [shelf, 'Trending'];
    const alt = extra.alternativeCategory
        ? normalizeDiscoveryShelf(extra.alternativeCategory)
        : '';
    if (alt && alt !== shelf && alt !== 'Trending' && !categories.includes(alt)) {
        categories.push(alt);
    }
    return {
        primaryCategory: shelf,
        categories,
        confidence: conf,
        signals,
        classificationSource: 'nlp',
        suggestedCategory: shelf,
        suggestedConfidence: conf,
        alternativeCategory: alt && alt !== shelf ? alt : undefined,
        ambiguous: Boolean(extra.ambiguous),
        confidenceBand: extra.confidenceBand || confidenceBand(conf),
        scoreBreakdown: extra.scoreBreakdown
    };
}

/**
 * Weighted multi-field semantic score.
 * @param {import('./contentClassifier.js').NormalizedClassificationMetadata} meta
 */
export function scoreSemanticSignals(meta) {
    /** @type {Record<string, number>} */
    const scores = { Trending: 0, Romance: 0, 'Cyber-Action': 0, Suspense: 0 };
    /** @type {string[]} */
    const signals = [];

    /** @type {Array<{ label: string; text: string; weight: number }>} */
    const layers = [
        { label: 'title', text: meta.titleIsGeneric ? '' : meta.title || '', weight: 1.0 },
        { label: 'description', text: meta.description || '', weight: 0.75 },
        { label: 'tags', text: (meta.tags || []).join(' '), weight: 0.85 },
        { label: 'series', text: meta.seriesTitle || '', weight: 0.55 },
        { label: 'episode', text: meta.episodeTitle || '', weight: 0.55 }
    ];

    for (const layer of layers) {
        if (!layer.text) continue;
        const layerHay = hay(layer.text);
        const tokens = new Set(tokenizeClassificationText(layer.text));

        for (const shelf of /** @type {string[]} */ (['Romance', 'Cyber-Action', 'Suspense', 'Trending'])) {
            const lex = SEMANTIC_LEXICONS[shelf];
            if (!lex) continue;
            for (const tok of tokens) {
                if (lex.strong.has(tok)) {
                    scores[shelf] += 3 * layer.weight;
                    signals.push(`${layer.label}:strong:${tok}`);
                } else if (lex.medium.has(tok)) {
                    scores[shelf] += 1.6 * layer.weight;
                    signals.push(`${layer.label}:medium:${tok}`);
                } else if (lex.weak.has(tok)) {
                    scores[shelf] += 0.55 * layer.weight;
                    signals.push(`${layer.label}:weak:${tok}`);
                }
            }
        }

        const comboWeight = layer.label === 'title' ? 1 : 0.6;
        for (const rule of COMBINATION_RULES) {
            if (rule.test(layerHay, tokens)) {
                scores[rule.shelf] += rule.weight * layer.weight * comboWeight;
                signals.push(`${layer.label}:${rule.signal}`);
            }
        }
    }

    return { scores, signals: [...new Set(signals)] };
}

/**
 * @param {Record<string, number>} scores
 * @returns {Array<{ category: string; score: number }>}
 */
function rankShelves(scores) {
    return ['Romance', 'Cyber-Action', 'Suspense', 'Trending']
        .map((category) => ({ category, score: scores[category] || 0 }))
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return DISCOVERY_SHELVES.indexOf(a.category) - DISCOVERY_SHELVES.indexOf(b.category);
        });
}

/**
 * @param {Record<string, number>} scores
 * @param {number} minScore
 */
function detectAmbiguity(scores, minScore = 1.55) {
    /** @type {string[]} */
    const competing = [];
    for (const [a, b] of CONFLICT_PAIRS) {
        if ((scores[a] || 0) >= minScore && (scores[b] || 0) >= minScore) {
            competing.push(a, b);
        }
    }
    return [...new Set(competing)];
}

/**
 * Deterministic local NLP provider for classifyContentSemantic.
 *
 * @param {import('./contentClassifier.js').NormalizedClassificationMetadata} meta
 * @param {Record<string, unknown>} _content
 * @returns {import('./contentClassifier.js').ContentClassification}
 */
export function defaultTitleNlpProvider(meta, _content = {}) {
    const title = meta && typeof meta.title === 'string' ? meta.title.trim() : '';
    const hasSecondaryContext = Boolean(
        (meta.description && String(meta.description).trim()) ||
            (meta.seriesTitle && String(meta.seriesTitle).trim()) ||
            (meta.episodeTitle && String(meta.episodeTitle).trim()) ||
            (Array.isArray(meta.tags) && meta.tags.some((t) => String(t || '').trim()))
    );

    const titleUnusable =
        !title || Boolean(meta.titleIsGeneric) || isGenericMediaLabel(title);

    // Empty/generic title with no other fields → manual Trending.
    // If description/series/episode/tags exist, continue so secondary context can score.
    if (titleUnusable && !hasSecondaryContext) {
        return nlpResult('Trending', 0.12, ['nlp:empty-or-generic-title'], {
            ambiguous: false,
            confidenceBand: 'manual'
        });
    }

    const titleTokens = titleUnusable ? [] : tokenizeClassificationText(title);
    const meaningfulTitleTokens = titleTokens.filter((t) => !GENERIC_TITLE_TOKENS.has(t));
    const genericOnly = titleUnusable || meaningfulTitleTokens.length === 0;

    if (
        !hasSecondaryContext &&
        titleTokens.length <= 2 &&
        titleTokens.every((t) => GENERIC_TITLE_TOKENS.has(t) || t.length <= 2)
    ) {
        return nlpResult(
            'Trending',
            0.15,
            ['nlp:generic-title-penalty', `nlp:title:${title.slice(0, 80)}`],
            { ambiguous: false, confidenceBand: 'manual' }
        );
    }

    // When title is generic-only but secondary context exists, skip title-layer scoring
    // so weak tokens (e.g. "arrival") do not dilute description/series evidence.
    const scoreMeta =
        genericOnly && hasSecondaryContext
            ? { ...meta, title: titleUnusable ? '' : title, titleIsGeneric: true }
            : meta;

    const { scores, signals } = scoreSemanticSignals(scoreMeta);
    const ranked = rankShelves(scores);
    const top = ranked[0] || { category: 'Trending', score: 0 };
    const second = ranked[1] || { category: 'Trending', score: 0 };
    const competing = detectAmbiguity(scores);

    const genreTop = ranked.find((r) => r.category !== 'Trending') || top;
    const hasGenreEvidence = genreTop.score >= 2.2 && genreTop.category !== 'Trending';

    if (!hasGenreEvidence) {
        const conf = genericOnly && !hasSecondaryContext ? 0.14 : hasSecondaryContext ? 0.2 : 0.18;
        /** @type {string[]} */
        const reasonSignals = hasSecondaryContext
            ? ['nlp:insufficient-signals', 'nlp:context-without-shelf-fit']
            : ['nlp:insufficient-signals'];
        return nlpResult('Trending', conf, [...reasonSignals, ...signals.slice(0, 6)], {
            ambiguous: false,
            confidenceBand: 'manual',
            scoreBreakdown: { ...scores }
        });
    }

    let confidence = Math.min(0.96, 0.42 + genreTop.score * 0.09);
    let ambiguous = false;
    let alternative = '';

    if (competing.length >= 2) {
        ambiguous = true;
        const ordered = competing
            .map((c) => ({ category: c, score: scores[c] || 0 }))
            .sort((a, b) => b.score - a.score);
        const primary = ordered[0]?.category || genreTop.category;
        alternative = ordered[1]?.category || '';
        const gap = (ordered[0]?.score || 0) - (ordered[1]?.score || 0);
        confidence = Math.min(0.68, 0.48 + gap * 0.06 + (ordered[0]?.score || 0) * 0.03);
        return nlpResult(
            primary,
            confidence,
            [`nlp:conflict:${competing.join('+')}`, ...signals.slice(0, 10)],
            {
                alternativeCategory: alternative,
                ambiguous: true,
                confidenceBand: confidenceBand(confidence),
                scoreBreakdown: { ...scores }
            }
        );
    }

    if (
        second.category !== 'Trending' &&
        second.score >= 1.55 &&
        genreTop.score - second.score < 2.0 &&
        genreTop.category !== second.category
    ) {
        ambiguous = true;
        alternative = second.category;
        confidence = Math.min(0.66, confidence * 0.78);
        return nlpResult(genreTop.category, confidence, ['nlp:near-tie', ...signals.slice(0, 10)], {
            alternativeCategory: alternative,
            ambiguous: true,
            confidenceBand: confidenceBand(confidence),
            scoreBreakdown: { ...scores }
        });
    }

    if (signals.some((s) => s.includes('combo:cyber-strike') || s.includes('combo:love-me-until'))) {
        confidence = Math.max(confidence, 0.9);
    }
    if (signals.some((s) => s.includes('combo:last-house'))) {
        confidence = Math.max(confidence, 0.86);
    }

    // Generic title alone is weak; do not cap when secondary context drove genre evidence.
    if (genericOnly && !hasSecondaryContext) {
        confidence = Math.min(confidence, 0.42);
    }

    return nlpResult(genreTop.category, confidence, signals.slice(0, 12), {
        alternativeCategory: alternative || undefined,
        ambiguous,
        confidenceBand: confidenceBand(confidence),
        scoreBreakdown: { ...scores }
    });
}

/**
 * Entry: canonical title → multi-signal NLP → suggestion (+ creator lock upstream).
 *
 * @param {Record<string, unknown> | null | undefined} content
 * @param {{ nlpProvider?: Function }} [options]
 * @returns {Promise<import('./contentClassifier.js').ContentClassification>}
 */
export async function suggestShelfClassification(content, options = {}) {
    return classifyContentSemantic(content, {
        ...options,
        nlpProvider: options.nlpProvider ?? defaultTitleNlpProvider
    });
}
