/**
 * Episode title → Hero Vault ready asset resolver (keyword family).
 *
 * Hero Vault remains the only media source. No uploads. No duplicate reels.
 *
 * Match priority:
 *   A. Strong multi-word asset match  ("STIRRED MALL WALK IN" → "STIRRED MALL WALK")
 *   B. Primary keyword family         ("STIRRED 1/2/99" → "STIRRED")
 *   C. Fuzzy fallback                 (only when A/B absent)
 *
 * Episode numbers are metadata only and never form match identity.
 * Never picks a random "latest" asset without a keyword basis.
 */

const VIDEO_EXT = /\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)(\?|$)/i;
const STOP_WORDS = new Set([
    'the',
    'a',
    'an',
    'and',
    'of',
    'to',
    'in',
    'for',
    'on',
    'at',
    'ep',
    'episode',
    'part',
    'pt',
    's',
    'e',
    'v'
]);

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeTitle(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\.(mp4|mov|webm|m4v|avi|mkv|jpe?g|png|webp|gif)$/i, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Searchable keywords from a vault or episode title.
 * Strips stop-words and bare episode/version numbers (STIRRED 1 → ["stirred"]).
 *
 * @param {unknown} title
 * @returns {string[]}
 */
export function extractKeywords(title) {
    const norm = normalizeTitle(title);
    if (!norm) return [];
    return norm
        .split(' ')
        .map((t) => t.trim())
        .filter((t) => t.length >= 2)
        .filter((t) => !STOP_WORDS.has(t))
        .filter((t) => !/^\d+$/.test(t));
}

/**
 * @param {unknown} title
 * @returns {string}
 */
export function primaryKeyword(title) {
    return extractKeywords(title)[0] || '';
}

/**
 * Digits trailing an episode/version marker in the raw title (metadata only).
 * @param {unknown} title
 * @returns {number | null}
 */
export function extractEpisodeNumberMetadata(title) {
    const norm = normalizeTitle(title);
    const m = norm.match(/(?:^|\s)(\d{1,4})\s*$/);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
}

/**
 * @param {Record<string, unknown> | null | undefined} item
 */
export function assetIdOf(item) {
    return String(item?.id || item?.assetId || item?.personal_video_id || '').trim();
}

/**
 * @param {Record<string, unknown> | null | undefined} item
 */
function assetTitleOf(item) {
    return String(
        item?.title || item?.name || item?.fileName || item?.file_name || item?.id || ''
    ).trim();
}

/**
 * @param {Record<string, unknown> | null | undefined} item
 */
function assetMediaUrlOf(item) {
    return String(
        item?.url ||
            item?.videoUrl ||
            item?.video_url ||
            item?.mediaUrl ||
            item?.src ||
            ''
    ).trim();
}

/**
 * @param {Record<string, unknown> | null | undefined} item
 */
function assetThumbOf(item) {
    return String(
        item?.thumbnailUrl ||
            item?.thumbnail_url ||
            item?.thumbnail ||
            item?.posterUrl ||
            item?.poster_url ||
            ''
    ).trim();
}

/**
 * @param {string} url
 * @param {string} [mime]
 */
export function isVideoAsset(url, mime = '') {
    const u = String(url || '').toLowerCase();
    const m = String(mime || '').toLowerCase();
    return m.startsWith('video/') || VIDEO_EXT.test(u) || u.includes('/videos/');
}

/**
 * @param {string} url
 * @param {string} [mime]
 */
export function isImageAsset(url, mime = '') {
    const u = String(url || '').toLowerCase();
    const m = String(mime || '').toLowerCase();
    return m.startsWith('image/') || IMAGE_EXT.test(u) || u.includes('/thumbs/');
}

/**
 * Ready Hero Vault pick gate (ignore pending/failed/blob stubs).
 * @param {Record<string, unknown> | null | undefined} entry
 */
export function isReadyVaultAsset(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.isPlaceholder === true) return false;
    const id = assetIdOf(entry);
    if (!id) return false;
    if (/^local-(pending|upload|interrupted)/i.test(id)) return false;

    const status = String(entry.status || entry.uploadStatus || 'ready').toLowerCase();
    if (status && status !== 'ready' && status !== 'complete' && status !== 'completed') {
        if (/fail|error|pending|upload|interrupt|process/.test(status)) return false;
    }
    if (entry.uploadError || entry.failed === true) return false;

    const url = assetMediaUrlOf(entry) || assetThumbOf(entry);
    if (!url || url.startsWith('blob:')) return false;
    return true;
}

/**
 * @param {Record<string, unknown>[]} [items]
 */
export function filterReadyVaultAssets(items = []) {
    if (!Array.isArray(items)) return [];
    const seen = new Set();
    /** @type {Record<string, unknown>[]} */
    const out = [];
    for (const item of items) {
        if (!isReadyVaultAsset(item)) continue;
        const id = assetIdOf(item);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(item);
    }
    return out;
}

/**
 * @typedef {'multiword' | 'primary' | 'fuzzy'} MatchTier
 */

/**
 * @typedef {{
 *   matched: true;
 *   assetId: string;
 *   thumbnail: string;
 *   mediaUrl: string;
 *   type: 'video' | 'image';
 *   title: string;
 *   keywords: string[];
 *   matchTier: MatchTier;
 *   score: number;
 * } | {
 *   matched: false;
 * }} EpisodeVaultResolveResult
 */

/**
 * Secondary content keywords (family primary removed).
 * @param {string[]} keywords
 */
function secondaryKeywords(keywords) {
    return keywords.slice(1);
}

/**
 * Score one ready asset against an episode title.
 * @param {string} episodeTitle
 * @param {Record<string, unknown>} asset
 * @returns {{ score: number; tier: MatchTier | null }}
 */
export function scoreEpisodeAgainstAsset(episodeTitle, asset) {
    const epNorm = normalizeTitle(episodeTitle);
    const assetTitle = assetTitleOf(asset);
    const assetNorm = normalizeTitle(assetTitle);
    if (!epNorm || !assetNorm) return { score: 0, tier: null };

    const epKw = extractKeywords(episodeTitle);
    const assetKw = extractKeywords(assetTitle);
    if (!epKw.length || !assetKw.length) return { score: 0, tier: null };

    const epPrimary = epKw[0] || '';
    const assetPrimary = assetKw[0] || '';
    const assetSet = new Set(assetKw);
    const epSecondary = secondaryKeywords(epKw);
    const assetSecondary = secondaryKeywords(assetKw);

    let secondaryHits = 0;
    for (const k of epSecondary) {
        if (assetSet.has(k)) secondaryHits += 1;
    }
    // Also count when episode secondary tokens appear as asset secondary
    // (MALL WALK ↔ STIRRED MALL WALK).
    let assetSecondaryHits = 0;
    for (const k of assetSecondary) {
        if (epKw.includes(k)) assetSecondaryHits += 1;
    }

    // ── A. Strong multi-word match ──────────────────────────────────────────
    // Requires at least one secondary content token on either side beyond the
    // family primary (mall / walk), not bare episode numbers.
    const multiwordCandidate =
        (epSecondary.length >= 1 && secondaryHits >= 1) ||
        (assetSecondary.length >= 1 && assetSecondaryHits >= 1 && epPrimary && assetSet.has(epPrimary));

    if (multiwordCandidate) {
        const cover =
            epSecondary.length > 0
                ? secondaryHits / epSecondary.length
                : assetSecondaryHits / Math.max(assetSecondary.length, 1);
        // Phrase containment boost (STIRRED MALL WALK ⊂ STIRRED MALL WALK IN)
        let phraseBoost = 0;
        const epPhrase = epKw.join(' ');
        const assetPhrase = assetKw.join(' ');
        if (epPhrase.includes(assetPhrase) || assetPhrase.includes(epPhrase)) {
            phraseBoost = 5_000;
        }
        // Prefer assets that carry multi-word identity rather than the bare family root
        const multiAssetBoost = assetSecondary.length >= 1 ? 2_000 : 0;
        return {
            score: 50_000 + secondaryHits * 2_000 + assetSecondaryHits * 1_500 + Math.round(cover * 1_000) + phraseBoost + multiAssetBoost,
            tier: 'multiword'
        };
    }

    // ── B. Primary keyword family ───────────────────────────────────────────
    // STIRRED 1 / STIRRED 99 → only primary "stirred"; numbers ignored.
    if (epPrimary && (assetPrimary === epPrimary || assetSet.has(epPrimary))) {
        // Pure family-root asset (keywords == [primary]) wins over multi-word siblings
        // when the episode itself is family-only (no secondary content tokens).
        const pureFamilyAsset = assetKw.length === 1 && assetKw[0] === epPrimary;
        const pureFamilyEpisode = epKw.length === 1;

        if (pureFamilyEpisode) {
            // Heavily prefer the bare family root over specialized multi-word titles.
            if (pureFamilyAsset) {
                return { score: 30_000, tier: 'primary' };
            }
            // Numbered variants of the same family (STIRRED 3 vault clip) still match family
            // but rank below bare "STIRRED".
            if (assetPrimary === epPrimary && assetSecondary.length === 0) {
                return { score: 28_000, tier: 'primary' };
            }
            // Multi-word relatives only as weak primary (mall walk shouldn't win STIRRED 1)
            return { score: 20_000 - assetSecondary.length * 500, tier: 'primary' };
        }

        // Episode has secondary tokens that did not form multiword (unlikely) → soft primary
        return { score: 22_000 + secondaryHits * 400, tier: 'primary' };
    }

    // ── C. Fuzzy fallback ───────────────────────────────────────────────────
    let overlap = 0;
    for (const k of epKw) {
        if (assetSet.has(k)) overlap += 1;
    }
    if (overlap >= 2) {
        return {
            score: 5_000 + overlap * 200,
            tier: 'fuzzy'
        };
    }
    if (overlap === 1) {
        const hit = epKw.find((k) => assetSet.has(k));
        if (hit && hit.length >= 5) {
            return { score: 1_000 + hit.length, tier: 'fuzzy' };
        }
    }

    return { score: 0, tier: null };
}

/**
 * Stable tie-break among same-tier candidates (deterministic — no random latest pick).
 * @param {{ asset: Record<string, unknown>; score: number; tier: MatchTier }} a
 * @param {{ asset: Record<string, unknown>; score: number; tier: MatchTier }} b
 * @param {string[]} epKeywords
 */
function compareCandidates(a, b, epKeywords) {
    if (b.score !== a.score) return b.score - a.score;

    const aKw = extractKeywords(assetTitleOf(a.asset));
    const bKw = extractKeywords(assetTitleOf(b.asset));
    const targetLen = Math.max(epKeywords.length, 1);

    // Prefer pure family root when episode is family-only.
    if (targetLen === 1) {
        if (aKw.length !== bKw.length) return aKw.length - bKw.length;
    } else {
        // Prefer closer multi-word coverage length to episode keywords.
        const aDelta = Math.abs(aKw.length - targetLen);
        const bDelta = Math.abs(bKw.length - targetLen);
        if (aDelta !== bDelta) return aDelta - bDelta;
    }

    // Prefer shorter normalized titles (STIRRED over STIRRED 3).
    const aTitle = normalizeTitle(assetTitleOf(a.asset));
    const bTitle = normalizeTitle(assetTitleOf(b.asset));
    if (aTitle.length !== bTitle.length) return aTitle.length - bTitle.length;

    // Prefer video over image.
    const aVideo = isVideoAsset(assetMediaUrlOf(a.asset), String(a.asset.type || '')) ? 1 : 0;
    const bVideo = isVideoAsset(assetMediaUrlOf(b.asset), String(b.asset.type || '')) ? 1 : 0;
    if (bVideo !== aVideo) return bVideo - aVideo;

    // Deterministic last resort: stable asset id order (never recency).
    return assetIdOf(a.asset).localeCompare(assetIdOf(b.asset));
}

/**
 * Resolve episode title against ready Hero Vault assets.
 *
 * @param {string} episodeTitle
 * @param {Record<string, unknown>[]} readyVaultAssets
 * @returns {EpisodeVaultResolveResult}
 */
export function resolveEpisodeVaultAsset(episodeTitle, readyVaultAssets = []) {
    const ready = filterReadyVaultAssets(readyVaultAssets);
    const epKeywords = extractKeywords(episodeTitle);

    if (!String(episodeTitle || '').trim()) {
        return { matched: false };
    }

    /** @type {{ asset: Record<string, unknown>; score: number; tier: MatchTier }[]} */
    const multiword = [];
    /** @type {{ asset: Record<string, unknown>; score: number; tier: MatchTier }[]} */
    const primary = [];
    /** @type {{ asset: Record<string, unknown>; score: number; tier: MatchTier }[]} */
    const fuzzy = [];

    for (const asset of ready) {
        const { score, tier } = scoreEpisodeAgainstAsset(episodeTitle, asset);
        if (!tier || score <= 0) continue;
        const row = { asset, score, tier };
        if (tier === 'multiword') multiword.push(row);
        else if (tier === 'primary') primary.push(row);
        else fuzzy.push(row);
    }

    // Strict priority cascade — never fall through tiers when a stronger tier hit exists.
    /** @type {{ asset: Record<string, unknown>; score: number; tier: MatchTier } | null} */
    let chosen = null;
    if (multiword.length) {
        multiword.sort((a, b) => compareCandidates(a, b, epKeywords));
        chosen = multiword[0];
    } else if (primary.length) {
        primary.sort((a, b) => compareCandidates(a, b, epKeywords));
        chosen = primary[0];
    } else if (fuzzy.length) {
        fuzzy.sort((a, b) => compareCandidates(a, b, epKeywords));
        chosen = fuzzy[0];
    }

    if (!chosen) {
        return { matched: false };
    }

    const mediaUrl = assetMediaUrlOf(chosen.asset);
    const mime = String(chosen.asset.type || '');
    const type = isVideoAsset(mediaUrl, mime)
        ? /** @type {'video'} */ ('video')
        : isImageAsset(mediaUrl, mime)
          ? /** @type {'image'} */ ('image')
          : /** @type {'video'} */ ('video');

    let thumbnail = assetThumbOf(chosen.asset);
    if (!thumbnail && type === 'image') {
        thumbnail = mediaUrl;
    }
    if (!thumbnail && type === 'video') {
        const imagePeer = ready.find((item) => {
            if (assetIdOf(item) === assetIdOf(chosen.asset)) return false;
            const u = assetMediaUrlOf(item);
            if (!isImageAsset(u, String(item.type || ''))) return false;
            const { score, tier } = scoreEpisodeAgainstAsset(episodeTitle, item);
            return Boolean(tier && score > 0);
        });
        if (imagePeer) thumbnail = assetMediaUrlOf(imagePeer) || assetThumbOf(imagePeer);
    }

    return {
        matched: true,
        assetId: assetIdOf(chosen.asset),
        thumbnail: thumbnail || '',
        mediaUrl,
        type,
        title: assetTitleOf(chosen.asset),
        keywords: extractKeywords(assetTitleOf(chosen.asset)),
        matchTier: chosen.tier,
        score: chosen.score
    };
}

/**
 * Build a Theater-compatible reel from a resolve result (no media copy).
 * @param {string} episodeTitle
 * @param {Extract<EpisodeVaultResolveResult, { matched: true }>} resolved
 * @param {{ episodeId?: string; seriesId?: string; seasonNumber?: number; episodeNumber?: number } | null} [ctx]
 */
export function theaterReelFromVaultResolve(episodeTitle, resolved, ctx = null) {
    if (!resolved?.matched || !resolved.mediaUrl || !resolved.assetId) return null;
    return {
        id: resolved.assetId,
        name: episodeTitle || resolved.title,
        title: episodeTitle || resolved.title,
        url: resolved.mediaUrl,
        video_url: resolved.mediaUrl,
        videoUrl: resolved.mediaUrl,
        thumbnailUrl: resolved.thumbnail || '',
        thumbnail_url: resolved.thumbnail || '',
        type: resolved.type === 'image' ? 'image/jpeg' : 'video/mp4',
        status: 'ready',
        episodeId: ctx?.episodeId || null,
        episode_id: ctx?.episodeId || null,
        seriesId: ctx?.seriesId || null,
        seasonNumber: ctx?.seasonNumber ?? null,
        episodeNumber: ctx?.episodeNumber ?? null,
        isPersonalVideo: true,
        mediaAssetId: resolved.assetId,
        vaultMatchTier: resolved.matchTier
    };
}

/**
 * @param {unknown} detail
 */
export function logEpisodeVaultResolve(detail = {}) {
    console.info('[EPISODE_VAULT_RESOLVE]', {
        ...detail,
        ts: new Date().toISOString()
    });
}
