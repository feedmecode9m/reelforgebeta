/**
 * Hero background playback URL resolution (pure — safe for Node tests).
 *
 * Absolute http(s) / R2 / blob / data URLs are never rewritten to relative paths.
 * Relative `/videos/*` and `/thumbs/*` are joined to the configured backend origin.
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function trim(value) {
    return String(value || '').trim();
}

/**
 * True only for origin-less relative `/videos/*` paths (not absolute hosts).
 * Absolute railway/R2 https URLs must remain playable as-is.
 * @param {unknown} url
 * @returns {boolean}
 */
export function isRelativeVideosPath(url) {
    const raw = trim(url);
    return raw.startsWith('/videos/');
}

/**
 * Final hero playback resolver used by HeroExperience + background presentation.
 *
 * @param {unknown} url
 * @param {{ backendOrigin?: string; source?: string; silent?: boolean }} [options]
 * @returns {string}
 */
export function resolveHeroPlaybackUrl(url, options = {}) {
    const inputUrl = trim(url);
    const sourceTag = String(options.source || 'playback').trim() || 'playback';

    /** @param {string} resolvedUrl @param {string} source @param {boolean} stripped */
    const finish = (resolvedUrl, source, stripped) => {
        if (!options.silent) {
            console.info('[HERO_PLAYBACK_RESOLVE]', {
                inputUrl: inputUrl || null,
                resolvedUrl: resolvedUrl || null,
                source,
                stripped: stripped === true
            });
        }
        return resolvedUrl;
    };

    if (!inputUrl) {
        return finish('', `${sourceTag}:empty`, false);
    }

    if (inputUrl.startsWith('blob:') || inputUrl.startsWith('data:')) {
        return finish(inputUrl, `${sourceTag}:blob_or_data`, false);
    }

    // Peel `/thumbs/https://host/...` or `/thumbs/http://host/thumbs/file` before path join.
    const nakedAbs = inputUrl.match(/^\/(?:thumbs|videos)\/(https?:\/\/.+)$/i);
    if (nakedAbs) {
        return resolveHeroPlaybackUrl(nakedAbs[1], {
            ...options,
            source: `${sourceTag}:repair_double_prefix_abs`
        });
    }
    const embedded = inputUrl.match(
        /^\/(thumbs|videos)\/https?:\/\/[^/]+\/(thumbs|videos)\/(.+)$/i
    );
    if (embedded) {
        return resolveHeroPlaybackUrl(`/${embedded[2]}/${embedded[3]}`, {
            ...options,
            source: `${sourceTag}:repair_double_prefix_path`
        });
    }

    // Absolute — return unchanged (Railway, R2, CDN, any HTTPS host).
    if (/^https?:\/\//i.test(inputUrl)) {
        return finish(inputUrl, `${sourceTag}:absolute`, false);
    }

    // Relative media path → attach configured backend origin when available.
    if (inputUrl.startsWith('/videos/') || inputUrl.startsWith('/thumbs/')) {
        const origin = trim(options.backendOrigin).replace(/\/+$/, '');
        if (origin && /^https?:\/\//i.test(origin)) {
            return finish(`${origin}${inputUrl}`, `${sourceTag}:relative_with_origin`, false);
        }
        // Same-origin proxy fallback (Netlify /vite) — keep path, but report no strip of absolute.
        return finish(inputUrl, `${sourceTag}:relative_same_origin`, false);
    }

    // Bare filename → prefer /videos for hero playback.
    if (!inputUrl.startsWith('/') && !inputUrl.includes('://')) {
        const origin = trim(options.backendOrigin).replace(/\/+$/, '');
        const path = `/videos/${inputUrl.replace(/^\/+/, '')}`;
        if (origin && /^https?:\/\//i.test(origin)) {
            return finish(`${origin}${path}`, `${sourceTag}:bare_filename`, false);
        }
        return finish(path, `${sourceTag}:bare_filename_path`, false);
    }

    return finish(inputUrl, `${sourceTag}:passthrough`, false);
}

/**
 * Playback priority (never prefer origin-stripped localStorage over valid server absolute):
 * 1) server presentation mediaUrl (absolute first)
 * 2) HeroRecord mediaUrl
 * 3) catalog mediaUrl
 * 4) localStorage cache only (last resort)
 *
 * @param {{
 *   serverMediaUrl?: string;
 *   recordMediaUrl?: string;
 *   catalogMediaUrl?: string;
 *   localStorageMediaUrl?: string;
 * }} parts
 * @returns {{ mediaUrl: string; source: string }}
 */
export function pickHeroBackgroundMediaUrl(parts = {}) {
    const server = trim(parts.serverMediaUrl);
    const record = trim(parts.recordMediaUrl);
    const catalog = trim(parts.catalogMediaUrl);
    // Explicit localStorage tier — never wins over valid server/record/catalog media.
    const localCache = trim(parts.localStorageMediaUrl);

    // Prefer absolute server URL over anything, including relative catalog/local.
    if (server && /^https?:\/\//i.test(server)) {
        return { mediaUrl: server, source: 'server_presentation' };
    }
    if (record && /^https?:\/\//i.test(record)) {
        return { mediaUrl: record, source: 'hero_record' };
    }
    if (catalog && /^https?:\/\//i.test(catalog)) {
        return { mediaUrl: catalog, source: 'catalog' };
    }

    // Relative / empty tiers follow the same precedence (server → record → catalog → local).
    if (server) {
        return { mediaUrl: server, source: 'server_presentation' };
    }
    if (record) {
        return { mediaUrl: record, source: 'hero_record' };
    }
    if (catalog) {
        return { mediaUrl: catalog, source: 'catalog' };
    }
    if (localCache && /^https?:\/\//i.test(localCache)) {
        return { mediaUrl: localCache, source: 'localStorage_cache' };
    }
    if (localCache) {
        return { mediaUrl: localCache, source: 'localStorage_cache' };
    }
    return { mediaUrl: '', source: 'unavailable' };
}
