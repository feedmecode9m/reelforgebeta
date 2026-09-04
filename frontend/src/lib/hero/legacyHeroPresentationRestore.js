/**
 * Legacy Hero presentation — detection vs explicit restoration (isolated from creator catalog).
 *
 * Detection: is this server presentation row invalid?
 * Restoration: replace with a declared legacy canonical identity (admin/script only).
 *
 * No fuzzy catalog matching. No hydration-time identity mutation.
 */

const UUID_LIKE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Declared legacy Hero restoration targets — explicit, not inferred.
 * @type {Array<{
 *   featuredSeries: string;
 *   canonicalReelId: string;
 *   canonicalTitle: string;
 *   canonicalMediaUrl?: string;
 * }>}
 */
export const LEGACY_HERO_RESTORATION_TARGETS = [
    {
        featuredSeries: 'EPISODE 1 - ARRIVAL',
        canonicalReelId: '03ef898a-989f-42c3-bdbb-67f37338df65',
        canonicalTitle: '01 ARRIVAL OPEN v1'
    }
];

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeFeaturedSeriesKey(value) {
    return String(value || '').trim();
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function compactUuidLikeTitle(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, '-')
        .toLowerCase();
}

/**
 * @param {unknown} value
 */
export function isSpacedUuidLikeTitle(value) {
    const compact = compactUuidLikeTitle(value);
    return Boolean(compact && UUID_LIKE.test(compact));
}

/**
 * @param {unknown} url
 * @returns {string}
 */
export function extractMediaBasenameId(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
        const path = new URL(raw, 'https://placeholder.invalid').pathname;
        const base = path.split('/').filter(Boolean).pop() || '';
        return base.replace(/\.[a-z0-9]+$/i, '').toLowerCase();
    } catch {
        const tail = raw.split('/').filter(Boolean).pop() || '';
        return tail.replace(/\.[a-z0-9]+$/i, '').toLowerCase();
    }
}

/**
 * @param {unknown} value
 * @param {(value: unknown) => boolean} isUnsafeTitle
 */
function titleIsCorrupt(value, isUnsafeTitle) {
    const text = String(value || '').trim();
    if (!text) return true;
    return isUnsafeTitle(text) || isSpacedUuidLikeTitle(text);
}

/**
 * @param {Record<string, unknown> | null | undefined} patch
 * @param {Record<string, unknown> | null | undefined} remote
 * @param {(value: unknown) => boolean} isUnsafeTitle
 * @returns {{
 *   invalid: boolean;
 *   reasons: string[];
 *   featuredSeries: string;
 *   restorationTarget: (typeof LEGACY_HERO_RESTORATION_TARGETS)[number] | null;
 * }}
 */
export function detectInvalidHeroPresentation(patch, remote, isUnsafeTitle) {
    /** @type {string[]} */
    const reasons = [];
    if (!patch || typeof patch !== 'object') {
        return {
            invalid: false,
            reasons,
            featuredSeries: '',
            restorationTarget: null
        };
    }

    const presentation =
        remote?.presentation && typeof remote.presentation === 'object'
            ? /** @type {Record<string, unknown>} */ (remote.presentation)
            : {};

    const heroAssetId = String(patch.heroAssetId || '').trim().toLowerCase();
    const mediaUrl = String(patch.mediaUrl || patch.backgroundMediaUrl || '').trim();
    const mediaBasename = extractMediaBasenameId(mediaUrl);
    const title = String(patch.heroTitle || patch.heroAssetTitle || '').trim();
    const featuredSeries = normalizeFeaturedSeriesKey(
        patch.featuredSeries || presentation.featuredSeries || ''
    );

    if (titleIsCorrupt(title, isUnsafeTitle)) {
        reasons.push('unsafe_hero_title');
    }
    if (heroAssetId && mediaBasename && heroAssetId !== mediaBasename) {
        reasons.push('media_identity_mismatch');
    }
    if (!mediaUrl) {
        reasons.push('missing_media_url');
    }

    const restorationTarget = featuredSeries
        ? resolveLegacyHeroRestorationTarget(featuredSeries)
        : null;

    return {
        invalid: reasons.length > 0,
        reasons,
        featuredSeries,
        restorationTarget
    };
}

/**
 * @param {unknown} featuredSeries
 * @returns {(typeof LEGACY_HERO_RESTORATION_TARGETS)[number] | null}
 */
export function resolveLegacyHeroRestorationTarget(featuredSeries) {
    const key = normalizeFeaturedSeriesKey(featuredSeries);
    if (!key) return null;
    return (
        LEGACY_HERO_RESTORATION_TARGETS.find(
            (entry) => normalizeFeaturedSeriesKey(entry.featuredSeries) === key
        ) || null
    );
}

/**
 * Diagnostic only — does not mutate patch or remote.
 * @param {Record<string, unknown> | null | undefined} remote
 * @param {Record<string, unknown> | null | undefined} patch
 * @param {(value: unknown) => boolean} isUnsafeTitle
 */
export function diagnoseInvalidHeroPresentation(remote, patch, isUnsafeTitle) {
    const result = detectInvalidHeroPresentation(patch, remote, isUnsafeTitle);
    if (result.invalid) {
        console.warn(
            '[HERO_PRESENTATION] invalid server row detected — explicit legacy restoration required',
            {
                reasons: result.reasons,
                featuredSeries: result.featuredSeries || null,
                hasDeclaredRestorationTarget: Boolean(result.restorationTarget),
                declaredCanonicalReelId: result.restorationTarget?.canonicalReelId || null,
                ts: new Date().toISOString()
            }
        );
    }
    return result;
}

/**
 * @param {Record<string, unknown> | null | undefined} reel
 * @returns {string}
 */
function reelDisplayTitle(reel) {
    if (!reel || typeof reel !== 'object') return '';
    return String(reel.name || reel.title || reel.fileName || '').trim();
}

/**
 * @param {Record<string, unknown> | null | undefined} reel
 * @returns {string}
 */
function reelMediaUrl(reel) {
    if (!reel || typeof reel !== 'object') return '';
    return String(reel.url || reel.videoUrl || reel.playbackUrl || '').trim();
}

/**
 * Build explicit legacy restoration patch (admin restore script / Studio only).
 * Fail closed — never picks an alternate reel.
 *
 * @param {{
 *   remote?: Record<string, unknown> | null;
 *   patch?: Record<string, unknown> | null;
 *   reels?: Array<Record<string, unknown>> | null;
 *   featuredSeries?: string;
 * }} input
 * @returns {{
 *   ok: boolean;
 *   error?: string;
 *   patch?: Record<string, unknown>;
 *   target?: (typeof LEGACY_HERO_RESTORATION_TARGETS)[number];
 *   details?: Record<string, unknown>;
 * }}
 */
export function buildLegacyHeroRestorationPatch(input = {}) {
    const remote = input.remote && typeof input.remote === 'object' ? input.remote : {};
    const basePatch =
        input.patch && typeof input.patch === 'object'
            ? { ...input.patch }
            : { ...remote };

    const presentation =
        remote.presentation && typeof remote.presentation === 'object'
            ? /** @type {Record<string, unknown>} */ (remote.presentation)
            : {};

    const featuredSeries = normalizeFeaturedSeriesKey(
        input.featuredSeries ||
            basePatch.featuredSeries ||
            presentation.featuredSeries ||
            ''
    );

    const target = resolveLegacyHeroRestorationTarget(featuredSeries);
    if (!target) {
        return {
            ok: false,
            error: 'NO_LEGACY_RESTORATION_TARGET',
            details: { featuredSeries: featuredSeries || null }
        };
    }

    const reels = Array.isArray(input.reels) ? input.reels : [];
    if (reels.length === 0) {
        return {
            ok: false,
            error: 'CATALOG_EMPTY',
            target,
            details: { featuredSeries }
        };
    }

    const canonicalReel = reels.find(
        (reel) => String(reel.id || '').trim() === target.canonicalReelId
    );
    if (!canonicalReel) {
        return {
            ok: false,
            error: 'CANONICAL_LEGACY_HERO_ASSET_UNAVAILABLE',
            target,
            details: {
                featuredSeries,
                canonicalReelId: target.canonicalReelId
            }
        };
    }

    const catalogTitle = reelDisplayTitle(canonicalReel);
    if (catalogTitle && catalogTitle !== target.canonicalTitle) {
        return {
            ok: false,
            error: 'CANONICAL_TITLE_MISMATCH',
            target,
            details: {
                expectedTitle: target.canonicalTitle,
                catalogTitle,
                canonicalReelId: target.canonicalReelId
            }
        };
    }

    const mediaUrl = String(target.canonicalMediaUrl || reelMediaUrl(canonicalReel) || '').trim();
    if (!mediaUrl) {
        return {
            ok: false,
            error: 'CANONICAL_LEGACY_HERO_MEDIA_UNAVAILABLE',
            target,
            details: { canonicalReelId: target.canonicalReelId }
        };
    }

    /** @type {Record<string, unknown>} */
    const patch = {
        ...basePatch,
        featuredSeries: target.featuredSeries,
        heroAssetId: target.canonicalReelId,
        heroTitle: target.canonicalTitle,
        heroAssetTitle: target.canonicalTitle,
        mediaUrl,
        backgroundMediaUrl: mediaUrl,
        backgroundSource: 'custom_video',
        backgroundStyle: 'video'
    };

    return { ok: true, patch, target };
}
