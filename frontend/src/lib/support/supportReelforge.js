/**
 * Phase 60 — Support ReelForge layer.
 */

export const SUPPORT_CONFIG_STORAGE_KEY = 'reelforge_support_config';

export const SUPPORT_METHOD_IDS = /** @type {const} */ ([
    'patreon',
    'kofi',
    'github_sponsors',
    'custom'
]);

/**
 * @typedef {Object} SupportMethodConfig
 * @property {boolean} enabled
 * @property {string} label
 * @property {string} url
 */

/**
 * @typedef {Object} SupportConfig
 * @property {string} message
 * @property {string} ctaLabel
 * @property {Record<typeof SUPPORT_METHOD_IDS[number], SupportMethodConfig>} methods
 */

/** @returns {SupportConfig} */
export function getDefaultSupportConfig() {
    return {
        message: 'We built ReelForge with love and creators in mind.',
        ctaLabel: 'Support ReelForge',
        methods: {
            patreon: {
                enabled: true,
                label: 'Patreon',
                url: 'https://www.patreon.com/'
            },
            kofi: {
                enabled: true,
                label: 'Ko-fi',
                url: 'https://ko-fi.com/'
            },
            github_sponsors: {
                enabled: true,
                label: 'GitHub Sponsors',
                url: 'https://github.com/sponsors'
            },
            custom: {
                enabled: false,
                label: 'Custom URL',
                url: ''
            }
        }
    };
}

/** @returns {SupportConfig} */
export function loadSupportConfig() {
    if (typeof window === 'undefined') return getDefaultSupportConfig();
    try {
        const raw = localStorage.getItem(SUPPORT_CONFIG_STORAGE_KEY);
        if (!raw) return getDefaultSupportConfig();
        const parsed = JSON.parse(raw);
        const defaults = getDefaultSupportConfig();
        return {
            ...defaults,
            ...parsed,
            methods: {
                ...defaults.methods,
                ...(parsed.methods || {})
            }
        };
    } catch {
        return getDefaultSupportConfig();
    }
}

/** @param {Partial<SupportConfig>} patch */
export function saveSupportConfig(patch = {}) {
    const merged = {
        ...loadSupportConfig(),
        ...patch,
        methods: {
            ...loadSupportConfig().methods,
            ...(patch.methods || {})
        }
    };
    if (typeof window !== 'undefined') {
        localStorage.setItem(SUPPORT_CONFIG_STORAGE_KEY, JSON.stringify(merged));
        window.dispatchEvent(new CustomEvent('reelforge:support-config-updated', { detail: merged }));
    }
    return merged;
}

/**
 * @param {'SUPPORT_CLICK'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logSupportDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @param {SupportConfig} [config] */
export function getEnabledSupportMethods(config = loadSupportConfig()) {
    return SUPPORT_METHOD_IDS.map((methodId) => ({
        id: methodId,
        ...(config.methods?.[methodId] || {})
    })).filter((method) => method.enabled && typeof method.url === 'string' && method.url.trim());
}

/**
 * @param {string} method
 * @param {string} url
 * @param {Record<string, unknown>} [meta]
 */
export function trackSupportClick(method, url, meta = {}) {
    logSupportDiag('SUPPORT_CLICK', {
        method,
        url,
        ...meta
    });
}

let supportInitialized = false;

export function initSupportReelforge() {
    if (typeof window === 'undefined' || supportInitialized) return;
    supportInitialized = true;
    window.__reelforgeSupport = {
        SUPPORT_CONFIG_STORAGE_KEY,
        SUPPORT_METHOD_IDS,
        getDefaultSupportConfig,
        loadSupportConfig,
        saveSupportConfig,
        getEnabledSupportMethods,
        trackSupportClick
    };
}
