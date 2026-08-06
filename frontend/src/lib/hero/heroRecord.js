/**
 * HeroRecord — versioned single source of truth for Smart Production Studio Hero state.
 *
 * Commit 2: persistence layer + legacy importer.
 * Commit 3: HeroReel compatibility projections (heroReelIdentity is a facade over this).
 *
 * Storage key: reelforge_hero_record
 *
 * Modes:
 * - selection — intelligence/episode-driven hero (no durable asset identity)
 * - asset    — custom vault/media hero (requires durable asset identity)
 * - none     — intentional blank menu backdrop (no durable asset identity)
 *
 * Status:
 * - ready              — fully resolved
 * - needs_reselection  — mode is safe selection; user must pick again
 * - unresolved_legacy  — durable legacy media found without a safe asset id
 */

/** @typedef {'selection' | 'asset' | 'none'} HeroRecordMode */
/** @typedef {'image' | 'video' | ''} HeroRecordMediaKind */
/** @typedef {'ready' | 'needs_reselection' | 'unresolved_legacy'} HeroRecordStatus */

/**
 * @typedef {Object} HeroRecord
 * @property {number} schemaVersion
 * @property {number} revision
 * @property {number} updatedAt
 * @property {HeroRecordMode} mode
 * @property {HeroRecordStatus} status
 * @property {string} assetId
 * @property {string} mediaUrl
 * @property {string} videoUrl
 * @property {string} posterUrl
 * @property {HeroRecordMediaKind} mediaKind
 * @property {string} fileName
 * @property {string} title
 * @property {string} heroTitle
 * @property {string} heroSubtitle
 * @property {string} heroDescription
 * @property {string} source
 */

/**
 * @typedef {Object} SaveHeroRecordOptions
 * @property {number} [expectedRevision]  // optimistic concurrency for multi-writer
 */

export const HERO_RECORD_STORAGE_KEY = 'reelforge_hero_record';
export const HERO_RECORD_SCHEMA_VERSION = 1;

/** Legacy keys read-only during one-way import (must match production). */
export const LEGACY_HERO_MANAGER_KEY = 'reelforge_hero_manager_config';
export const LEGACY_HERO_REEL_KEY = 'reelforge_hero_reel';
export const LEGACY_HERO_VIDEO_KEY = 'reelforge_hero_video';
export const LEGACY_HERO_IMAGE_KEY = 'reelforge_hero_image';

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)(\?|$)/i;

/**
 * @param {unknown} url
 * @returns {boolean}
 */
export function isUnsafeHeroMediaUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return true;
    const lower = raw.toLowerCase();
    return lower.startsWith('blob:') || lower.startsWith('data:');
}

/**
 * @param {unknown} url
 * @returns {boolean}
 */
export function isDurableHeroMediaUrl(url) {
    const raw = String(url || '').trim();
    if (!raw || isUnsafeHeroMediaUrl(raw)) return false;
    if (raw.startsWith('/') || /^https?:\/\//i.test(raw)) return true;
    return VIDEO_EXT.test(raw) || IMAGE_EXT.test(raw);
}

/**
 * @param {string} mediaUrl
 * @param {string} [mimeHint]
 * @returns {HeroRecordMediaKind}
 */
function inferMediaKind(mediaUrl, mimeHint = '') {
    const mime = String(mimeHint || '').toLowerCase();
    const url = String(mediaUrl || '').toLowerCase();
    if (mime.startsWith('video/') || VIDEO_EXT.test(url) || url.includes('/videos/')) return 'video';
    if (mime.startsWith('image/') || IMAGE_EXT.test(url) || url.includes('/thumbs/')) return 'image';
    return '';
}

/**
 * True when a string looks like a bare media path used as a fake id (never canonical).
 * @param {unknown} assetId
 */
function looksLikeUrlAsIdentity(assetId) {
    const id = String(assetId || '').trim();
    if (!id) return false;
    return (
        id.startsWith('/') ||
        /^https?:\/\//i.test(id) ||
        id.startsWith('blob:') ||
        id.startsWith('data:')
    );
}

/**
 * @returns {HeroRecord}
 */
export function createDefaultHeroRecord() {
    return {
        schemaVersion: HERO_RECORD_SCHEMA_VERSION,
        revision: 0,
        updatedAt: 0,
        mode: 'selection',
        status: 'ready',
        assetId: '',
        mediaUrl: '',
        videoUrl: '',
        posterUrl: '',
        mediaKind: '',
        fileName: '',
        title: '',
        heroTitle: '',
        heroSubtitle: '',
        heroDescription: '',
        source: 'default'
    };
}

/**
 * @param {unknown} value
 * @returns {HeroRecordMode | null}
 */
function normalizeMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    if (mode === 'selection' || mode === 'asset' || mode === 'none') {
        return /** @type {HeroRecordMode} */ (mode);
    }
    if (mode === 'custom_video' || mode === 'custom_image') return 'asset';
    return null;
}

/**
 * @param {unknown} value
 * @returns {HeroRecordStatus}
 */
function normalizeStatus(value) {
    const status = String(value || '').trim().toLowerCase();
    if (status === 'needs_reselection' || status === 'unresolved_legacy' || status === 'ready') {
        return /** @type {HeroRecordStatus} */ (status);
    }
    return 'ready';
}

/**
 * Fill videoUrl / posterUrl / mediaUrl consistently for an asset record.
 * @param {{
 *   mediaKind: HeroRecordMediaKind;
 *   mediaUrl?: string;
 *   videoUrl?: string;
 *   posterUrl?: string;
 * }} input
 */
function normalizeAssetMediaFields(input) {
    const mediaKind = input.mediaKind;
    let mediaUrl = String(input.mediaUrl || '').trim();
    let videoUrl = String(input.videoUrl || '').trim();
    let posterUrl = String(input.posterUrl || '').trim();

    if (mediaKind === 'video') {
        videoUrl = videoUrl || mediaUrl;
        mediaUrl = mediaUrl || videoUrl;
        if (posterUrl && isUnsafeHeroMediaUrl(posterUrl)) posterUrl = '';
        if (posterUrl && !isDurableHeroMediaUrl(posterUrl)) posterUrl = '';
    } else if (mediaKind === 'image') {
        posterUrl = posterUrl || mediaUrl;
        mediaUrl = mediaUrl || posterUrl;
        videoUrl = '';
    } else {
        mediaUrl = '';
        videoUrl = '';
        posterUrl = '';
    }

    return { mediaUrl, videoUrl, posterUrl, mediaKind };
}

/**
 * Validate a HeroRecord (or candidate). Does not write storage.
 * @param {unknown} candidate
 * @returns {{ ok: true, record: HeroRecord } | { ok: false, errors: string[] }}
 */
export function validateHeroRecord(candidate) {
    /** @type {string[]} */
    const errors = [];
    if (!candidate || typeof candidate !== 'object') {
        return { ok: false, errors: ['record_not_object'] };
    }
    const raw = /** @type {Record<string, unknown>} */ (candidate);

    const schemaVersion = Number(raw.schemaVersion);
    if (!Number.isFinite(schemaVersion) || schemaVersion < 1) {
        errors.push('invalid_schemaVersion');
    } else if (schemaVersion > HERO_RECORD_SCHEMA_VERSION) {
        errors.push('unsupported_schema_version');
    }

    const revision = Number(raw.revision);
    if (!Number.isFinite(revision) || revision < 0 || !Number.isInteger(revision)) {
        errors.push('invalid_revision');
    }

    const updatedAt = Number(raw.updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt < 0) {
        errors.push('invalid_updatedAt');
    }

    const mode = normalizeMode(raw.mode);
    if (!mode) errors.push('invalid_mode');

    const status = normalizeStatus(raw.status);
    const assetId = String(raw.assetId || '').trim();
    const fileName = String(raw.fileName || '').trim();
    const title = String(raw.title || '').trim();
    const heroTitle = typeof raw.heroTitle === 'string' ? raw.heroTitle : '';
    const heroSubtitle = typeof raw.heroSubtitle === 'string' ? raw.heroSubtitle : '';
    const heroDescription = typeof raw.heroDescription === 'string' ? raw.heroDescription : '';
    const source = typeof raw.source === 'string' ? raw.source : 'local';

    let mediaKind = /** @type {HeroRecordMediaKind} */ (
        raw.mediaKind === 'image' || raw.mediaKind === 'video' || raw.mediaKind === ''
            ? raw.mediaKind
            : ''
    );
    const mediaFields = normalizeAssetMediaFields({
        mediaKind:
            mediaKind ||
            inferMediaKind(
                String(raw.mediaUrl || raw.videoUrl || raw.posterUrl || ''),
                String(raw.type || '')
            ),
        mediaUrl: String(raw.mediaUrl || ''),
        videoUrl: String(raw.videoUrl || ''),
        posterUrl: String(raw.posterUrl || '')
    });
    if (!mediaKind) mediaKind = mediaFields.mediaKind;

    if (mediaFields.mediaUrl && isUnsafeHeroMediaUrl(mediaFields.mediaUrl)) {
        errors.push('unsafe_media_url');
    }
    if (mediaFields.videoUrl && isUnsafeHeroMediaUrl(mediaFields.videoUrl)) {
        errors.push('unsafe_video_url');
    }
    if (mediaFields.posterUrl && isUnsafeHeroMediaUrl(mediaFields.posterUrl)) {
        errors.push('unsafe_poster_url');
    }

    if (mode === 'asset') {
        if (!assetId) errors.push('asset_mode_requires_assetId');
        if (looksLikeUrlAsIdentity(assetId)) errors.push('asset_id_must_not_be_url');
        if (!mediaFields.mediaUrl || !isDurableHeroMediaUrl(mediaFields.mediaUrl)) {
            errors.push('asset_mode_requires_durable_mediaUrl');
        }
        if (mediaKind !== 'image' && mediaKind !== 'video') {
            errors.push('asset_mode_requires_mediaKind');
        }
        if (status !== 'ready') {
            // Asset mode is always ready when valid.
        }
    }

    if (mode === 'selection' || mode === 'none') {
        if (assetId) errors.push('non_asset_mode_must_not_have_assetId');
        if (mediaFields.mediaUrl) errors.push('non_asset_mode_must_not_have_mediaUrl');
        if (mediaFields.videoUrl) errors.push('non_asset_mode_must_not_have_videoUrl');
        if (mediaFields.posterUrl) errors.push('non_asset_mode_must_not_have_posterUrl');
        if (mediaKind) errors.push('non_asset_mode_must_not_have_mediaKind');
    }

    if (errors.length) return { ok: false, errors };

    const resolvedStatus =
        mode === 'asset'
            ? 'ready'
            : status === 'unresolved_legacy' || status === 'needs_reselection'
              ? status
              : 'ready';

    /** @type {HeroRecord} */
    const record = {
        schemaVersion: schemaVersion || HERO_RECORD_SCHEMA_VERSION,
        revision,
        updatedAt,
        mode: /** @type {HeroRecordMode} */ (mode),
        status: resolvedStatus,
        assetId: mode === 'asset' ? assetId : '',
        mediaUrl: mode === 'asset' ? mediaFields.mediaUrl : '',
        videoUrl: mode === 'asset' ? mediaFields.videoUrl : '',
        posterUrl: mode === 'asset' ? mediaFields.posterUrl : '',
        mediaKind: mode === 'asset' ? mediaKind : '',
        fileName: mode === 'asset' ? fileName : '',
        title: mode === 'asset' ? title || fileName || assetId : '',
        heroTitle,
        heroSubtitle,
        heroDescription,
        source
    };
    return { ok: true, record };
}

/**
 * Persist helper — never throws on quota / security errors.
 * @param {HeroRecord} record
 * @returns {boolean}
 */
function writeHeroRecordToStorage(record) {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return false;
    try {
        localStorage.setItem(HERO_RECORD_STORAGE_KEY, JSON.stringify(record));
        return true;
    } catch (error) {
        console.warn('[HERO_RECORD_WRITE_FAILED]', {
            error: error?.message || String(error),
            mode: record?.mode,
            revision: record?.revision,
            ts: new Date().toISOString()
        });
        return false;
    }
}

/**
 * @typedef {'missing' | 'valid' | 'corrupt' | 'unsupported_schema' | 'invalid'} HeroRecordReadState
 */

/**
 * Inspect storage without migrating.
 * @returns {{ state: HeroRecordReadState; record: HeroRecord | null; errors?: string[]; rawPresent: boolean }}
 */
export function inspectHeroRecordStorage() {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return { state: 'missing', record: null, rawPresent: false };
    }
    let raw = null;
    try {
        raw = localStorage.getItem(HERO_RECORD_STORAGE_KEY);
    } catch {
        return { state: 'corrupt', record: null, errors: ['storage_read_failed'], rawPresent: false };
    }
    if (!raw) return { state: 'missing', record: null, rawPresent: false };

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { state: 'corrupt', record: null, errors: ['corrupt_json'], rawPresent: true };
    }

    const schemaVersion = Number(parsed?.schemaVersion);
    if (Number.isFinite(schemaVersion) && schemaVersion > HERO_RECORD_SCHEMA_VERSION) {
        return {
            state: 'unsupported_schema',
            record: null,
            errors: ['unsupported_schema_version'],
            rawPresent: true
        };
    }

    const validated = validateHeroRecord(parsed);
    if (!validated.ok) {
        return {
            state: 'invalid',
            record: null,
            errors: validated.errors,
            rawPresent: true
        };
    }
    return { state: 'valid', record: validated.record, rawPresent: true };
}

/**
 * @returns {HeroRecord | null}
 */
function readStoredHeroRecord() {
    const inspection = inspectHeroRecordStorage();
    return inspection.state === 'valid' ? inspection.record : null;
}

/**
 * Recover from corrupt / unsupported storage by writing a safe selection seed.
 * @param {string} source
 * @returns {HeroRecord | null}
 */
function recoverSafeSelectionRecord(source) {
    const fallback = {
        ...createDefaultHeroRecord(),
        mode: 'selection',
        status: 'needs_reselection',
        updatedAt: Date.now(),
        source
    };
    const validated = validateHeroRecord(fallback);
    if (!validated.ok) return null;
    if (!writeHeroRecordToStorage(validated.record)) return null;
    console.info('[HERO_RECORD_RECOVER]', {
        source,
        mode: validated.record.mode,
        status: validated.record.status,
        ts: new Date().toISOString()
    });
    return validated.record;
}

/**
 * Load validated HeroRecord. Runs one-way legacy migration when missing.
 * Corrupt / unsupported stored values are recovered safely.
 * @returns {HeroRecord}
 */
export function loadHeroRecord() {
    const inspection = inspectHeroRecordStorage();
    if (inspection.state === 'valid' && inspection.record) {
        return inspection.record;
    }
    if (inspection.state === 'corrupt' || inspection.state === 'unsupported_schema') {
        const recovered = recoverSafeSelectionRecord(
            inspection.state === 'corrupt'
                ? 'recover_corrupt_json'
                : 'recover_unsupported_schema'
        );
        if (recovered) return recovered;
    }
    // missing | invalid → attempt one-way legacy import
    migrateLegacyHeroRecordIfNeeded();
    const after = readStoredHeroRecord();
    if (after) return after;
    return createDefaultHeroRecord();
}

/**
 * Persist a HeroRecord (merge patch). Increments revision.
 * Rejects invalid / unsafe records and revision conflicts.
 * @param {Partial<HeroRecord> | Record<string, unknown>} [patch]
 * @param {SaveHeroRecordOptions} [options]
 * @returns {HeroRecord | null}
 */
export function saveHeroRecord(patch = {}, options = {}) {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;

    const existing = readStoredHeroRecord();
    if (
        options.expectedRevision != null &&
        existing != null &&
        Number(existing.revision) !== Number(options.expectedRevision)
    ) {
        console.warn('[HERO_RECORD_REVISION_CONFLICT]', {
            expected: options.expectedRevision,
            actual: existing.revision,
            ts: new Date().toISOString()
        });
        return null;
    }

    const base = existing || createDefaultHeroRecord();
    const merged = {
        ...base,
        ...patch,
        schemaVersion: HERO_RECORD_SCHEMA_VERSION
    };

    const mode = normalizeMode(merged.mode) || base.mode;
    if (mode === 'selection' || mode === 'none') {
        merged.mode = mode;
        merged.assetId = '';
        merged.mediaUrl = '';
        merged.videoUrl = '';
        merged.posterUrl = '';
        merged.mediaKind = '';
        merged.fileName = '';
        merged.title = '';
        if (!merged.status || merged.status === 'ready') {
            merged.status = mode === 'selection' && patch.status ? patch.status : 'ready';
        }
        if (mode === 'none') merged.status = 'ready';
    } else {
        merged.mode = 'asset';
        merged.status = 'ready';
        merged.assetId = String(merged.assetId || '').trim();
        const fields = normalizeAssetMediaFields({
            mediaKind:
                /** @type {HeroRecordMediaKind} */ (merged.mediaKind) ||
                inferMediaKind(
                    String(merged.mediaUrl || merged.videoUrl || merged.posterUrl || ''),
                    String(/** @type {any} */ (patch).type || '')
                ),
            mediaUrl: String(merged.mediaUrl || ''),
            videoUrl: String(merged.videoUrl || ''),
            posterUrl: String(merged.posterUrl || '')
        });
        merged.mediaUrl = fields.mediaUrl;
        merged.videoUrl = fields.videoUrl;
        merged.posterUrl = fields.posterUrl;
        merged.mediaKind = fields.mediaKind;
    }

    const nextRevision =
        existing != null
            ? Math.max(Number(existing.revision) || 0, 0) + 1
            : Math.max(Number(merged.revision) || 0, 0);
    merged.revision = nextRevision;
    merged.updatedAt = Date.now();
    if (!String(merged.source || '').trim() || merged.source === 'default') {
        merged.source = 'local';
    }

    const validated = validateHeroRecord(merged);
    if (!validated.ok) {
        console.warn('[HERO_RECORD_SAVE_REJECTED]', { errors: validated.errors, patch });
        return null;
    }

    if (!writeHeroRecordToStorage(validated.record)) {
        return null;
    }

    console.info('[HERO_RECORD_SAVE]', {
        mode: validated.record.mode,
        status: validated.record.status,
        assetId: validated.record.assetId || '',
        revision: validated.record.revision,
        source: validated.record.source,
        ts: new Date().toISOString()
    });

    try {
        window.dispatchEvent(
            new CustomEvent('reelforge:hero-record-updated', { detail: validated.record })
        );
    } catch {
        /* non-browser or missing CustomEvent */
    }

    return validated.record;
}

/**
 * Apply durable asset / blank modes to media stores.
 * Selection mode does not touch media (caller supplies episode content).
 * Video assets preserve posterUrl when present.
 * @param {HeroRecord | null | undefined} record
 * @param {{ setVideo?: (url: string) => void; setPoster?: (url: string) => void; setFailed?: (failed: boolean) => void }} [stores]
 * @returns {boolean} true when stores were mutated
 */
export function applyHeroRecordToStores(record, stores = {}) {
    const validated = validateHeroRecord(record);
    const active = validated.ok ? validated.record : null;
    if (!active) return false;

    if (active.mode === 'none') {
        stores.setVideo?.('');
        stores.setPoster?.('');
        stores.setFailed?.(false);
        return true;
    }

    if (active.mode === 'selection') {
        return false;
    }

    if (active.mediaKind === 'video') {
        const videoUrl = active.videoUrl || active.mediaUrl;
        stores.setVideo?.(videoUrl);
        if (active.posterUrl) {
            stores.setPoster?.(active.posterUrl);
        }
        stores.setFailed?.(false);
        return true;
    }

    if (active.mediaKind === 'image') {
        const poster = active.posterUrl || active.mediaUrl;
        stores.setPoster?.(poster);
        stores.setVideo?.('');
        stores.setFailed?.(false);
        return true;
    }
    return false;
}

/**
 * @param {string} key
 * @returns {unknown}
 */
function readLocalJson(key) {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * @param {unknown} manager
 * @returns {{
 *   mode: HeroRecordMode | null;
 *   assetId: string;
 *   preferredKind: HeroRecordMediaKind;
 *   copy: Pick<HeroRecord, 'heroTitle' | 'heroSubtitle' | 'heroDescription'>;
 * }}
 */
function interpretManagerConfig(manager) {
    if (!manager || typeof manager !== 'object') {
        return {
            mode: null,
            assetId: '',
            preferredKind: '',
            copy: { heroTitle: '', heroSubtitle: '', heroDescription: '' }
        };
    }
    const row = /** @type {Record<string, unknown>} */ (manager);
    const backgroundSource = String(row.backgroundSource || '').trim();
    const assetId = String(row.heroAssetId || row.backgroundAsset || '').trim();
    const copy = {
        heroTitle: typeof row.heroTitle === 'string' ? row.heroTitle : '',
        heroSubtitle: typeof row.heroSubtitle === 'string' ? row.heroSubtitle : '',
        heroDescription: typeof row.heroDescription === 'string' ? row.heroDescription : ''
    };

    if (backgroundSource === 'custom_video' || backgroundSource === 'custom_image') {
        if (assetId && !looksLikeUrlAsIdentity(assetId)) {
            return {
                mode: 'asset',
                assetId,
                preferredKind: backgroundSource === 'custom_video' ? 'video' : 'image',
                copy
            };
        }
        return { mode: null, assetId: '', preferredKind: '', copy };
    }
    if (backgroundSource === 'none') {
        return { mode: 'none', assetId: '', preferredKind: '', copy };
    }
    if (backgroundSource === 'selection') {
        return { mode: 'selection', assetId: '', preferredKind: '', copy };
    }
    return { mode: null, assetId: '', preferredKind: '', copy };
}

/**
 * @param {unknown} reel
 * @returns {{
 *   assetId: string;
 *   mediaUrl: string;
 *   mediaKind: HeroRecordMediaKind;
 *   videoUrl: string;
 *   posterUrl: string;
 *   fileName: string;
 *   title: string;
 * } | null}
 */
function interpretHeroReel(reel) {
    if (!reel || typeof reel !== 'object') return null;
    const row = /** @type {Record<string, unknown>} */ (reel);
    const assetId = String(row.id || '').trim();
    const mediaUrl = String(row.url || '').trim();
    if (!assetId || looksLikeUrlAsIdentity(assetId) || !isDurableHeroMediaUrl(mediaUrl)) {
        return null;
    }
    const mediaKind =
        row.backgroundSource === 'custom_image'
            ? /** @type {const} */ ('image')
            : row.backgroundSource === 'custom_video'
              ? /** @type {const} */ ('video')
              : inferMediaKind(mediaUrl, String(row.type || ''));
    if (mediaKind !== 'image' && mediaKind !== 'video') return null;

    const thumb = String(row.thumbnail || row.thumbnailUrl || row.posterUrl || '').trim();
    const posterUrl =
        mediaKind === 'video' && isDurableHeroMediaUrl(thumb)
            ? thumb
            : mediaKind === 'image'
              ? mediaUrl
              : '';

    return {
        assetId,
        mediaUrl,
        mediaKind,
        videoUrl: mediaKind === 'video' ? mediaUrl : '',
        posterUrl,
        fileName: String(row.fileName || '').trim(),
        title: String(row.name || row.title || '').trim()
    };
}

/**
 * Manager custom asset only when identity + media are a matched pair.
 * @param {ReturnType<typeof interpretManagerConfig>} managerView
 * @param {ReturnType<typeof interpretHeroReel>} reelView
 * @returns {Partial<HeroRecord> | null}
 */
function tryManagerAssetMatch(managerView, reelView) {
    if (managerView.mode !== 'asset' || !managerView.assetId) return null;
    // Only accept media that is proven to belong to the same asset id.
    if (!reelView || reelView.assetId !== managerView.assetId) return null;
    if (managerView.preferredKind && reelView.mediaKind !== managerView.preferredKind) {
        // Kind mismatch (manager video vs reel image) → not a safe match.
        return null;
    }
    return {
        mode: 'asset',
        status: 'ready',
        assetId: managerView.assetId,
        mediaUrl: reelView.mediaUrl,
        videoUrl: reelView.videoUrl,
        posterUrl: reelView.posterUrl,
        mediaKind: reelView.mediaKind,
        fileName: reelView.fileName,
        title: reelView.title || managerView.assetId,
        ...managerView.copy,
        source: 'migrate_manager_asset'
    };
}

/**
 * @returns {Partial<HeroRecord>}
 */
function selectionFallback(managerView, source, status = 'ready') {
    return {
        mode: 'selection',
        status,
        assetId: '',
        mediaUrl: '',
        videoUrl: '',
        posterUrl: '',
        mediaKind: '',
        fileName: '',
        title: '',
        ...managerView.copy,
        source
    };
}

/**
 * Build a candidate HeroRecord from legacy keys using strict precedence.
 * Does not read existing HeroRecord (caller handles that).
 * @returns {Partial<HeroRecord>}
 */
function buildLegacyImportCandidate() {
    const manager = readLocalJson(LEGACY_HERO_MANAGER_KEY);
    const reel = readLocalJson(LEGACY_HERO_REEL_KEY);
    const legacyVideo =
        typeof localStorage !== 'undefined'
            ? String(localStorage.getItem(LEGACY_HERO_VIDEO_KEY) || '').trim()
            : '';
    const legacyImage =
        typeof localStorage !== 'undefined'
            ? String(localStorage.getItem(LEGACY_HERO_IMAGE_KEY) || '').trim()
            : '';

    const managerView = interpretManagerConfig(manager);
    const reelView = interpretHeroReel(reel);

    // Explicit manager none — wins over stale reel / legacy media.
    if (managerView.mode === 'none') {
        return {
            mode: 'none',
            status: 'ready',
            assetId: '',
            mediaUrl: '',
            videoUrl: '',
            posterUrl: '',
            mediaKind: '',
            fileName: '',
            title: '',
            ...managerView.copy,
            source: 'migrate_manager_none'
        };
    }

    // Explicit manager selection — wins over stale reel / legacy media.
    if (managerView.mode === 'selection') {
        return selectionFallback(managerView, 'migrate_manager_selection', 'ready');
    }

    // Manager custom asset only when id + media match (via hero reel identity).
    const matched = tryManagerAssetMatch(managerView, reelView);
    if (matched) return matched;

    // Manager claims custom asset but media identity cannot be matched safely.
    if (managerView.mode === 'asset' && managerView.assetId) {
        return selectionFallback(
            managerView,
            'migrate_manager_asset_unmatched',
            'needs_reselection'
        );
    }

    // Hero Reel metadata (only when manager did not assert none/selection/custom)
    if (reelView && managerView.mode == null) {
        return {
            mode: 'asset',
            status: 'ready',
            assetId: reelView.assetId,
            mediaUrl: reelView.mediaUrl,
            videoUrl: reelView.videoUrl,
            posterUrl: reelView.posterUrl,
            mediaKind: reelView.mediaKind,
            fileName: reelView.fileName,
            title: reelView.title || reelView.assetId,
            ...managerView.copy,
            source: 'migrate_hero_reel'
        };
    }

    // Durable legacy URLs without a safe canonical asset id → unresolved, never URL-as-id.
    if (isDurableHeroMediaUrl(legacyVideo) || isDurableHeroMediaUrl(legacyImage)) {
        return selectionFallback(
            managerView,
            isDurableHeroMediaUrl(legacyVideo)
                ? 'migrate_legacy_video_unresolved'
                : 'migrate_legacy_image_unresolved',
            'unresolved_legacy'
        );
    }

    // Default selection
    return selectionFallback(managerView, 'migrate_default_selection', 'ready');
}

/**
 * One-way, idempotent import from legacy multi-key storage into HeroRecord.
 *
 * Precedence:
 * 1. Existing valid HeroRecord (always wins)
 * 2. Explicit manager none (over stale reel/legacy)
 * 3. Explicit manager selection (over stale reel/legacy)
 * 4. Manager custom asset only when identity + media match
 * 5. Hero Reel alone (when manager has no explicit mode)
 * 6. Durable legacy URLs → unresolved_legacy reselection (never URL-as-assetId)
 * 7. Default selection
 *
 * @returns {HeroRecord | null}
 */
export function migrateLegacyHeroRecordIfNeeded() {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;

    const inspection = inspectHeroRecordStorage();
    if (inspection.state === 'valid' && inspection.record) {
        return inspection.record;
    }
    if (inspection.state === 'corrupt') {
        const recovered = recoverSafeSelectionRecord('recover_corrupt_json');
        if (recovered) return recovered;
    }
    if (inspection.state === 'unsupported_schema') {
        const recovered = recoverSafeSelectionRecord('recover_unsupported_schema');
        if (recovered) return recovered;
    }

    const candidate = buildLegacyImportCandidate();
    const next = {
        ...createDefaultHeroRecord(),
        ...candidate,
        schemaVersion: HERO_RECORD_SCHEMA_VERSION,
        revision: 0,
        updatedAt: Date.now()
    };

    // Hard reject unsafe media if any slipped through.
    if (
        (next.mediaUrl && isUnsafeHeroMediaUrl(next.mediaUrl)) ||
        (next.videoUrl && isUnsafeHeroMediaUrl(next.videoUrl)) ||
        (next.posterUrl && isUnsafeHeroMediaUrl(next.posterUrl))
    ) {
        Object.assign(next, selectionFallback(
            { mode: null, assetId: '', preferredKind: '', copy: {
                heroTitle: String(next.heroTitle || ''),
                heroSubtitle: String(next.heroSubtitle || ''),
                heroDescription: String(next.heroDescription || '')
            }},
            'migrate_default_selection_unsafe_rejected',
            'needs_reselection'
        ));
    }

    // Never persist URL-as-identity.
    if (next.mode === 'asset' && looksLikeUrlAsIdentity(next.assetId)) {
        Object.assign(
            next,
            selectionFallback(
                {
                    mode: null,
                    assetId: '',
                    preferredKind: '',
                    copy: {
                        heroTitle: String(next.heroTitle || ''),
                        heroSubtitle: String(next.heroSubtitle || ''),
                        heroDescription: String(next.heroDescription || '')
                    }
                },
                'migrate_default_selection_url_identity_rejected',
                'needs_reselection'
            )
        );
    }

    const validated = validateHeroRecord(next);
    if (!validated.ok) {
        const recovered = recoverSafeSelectionRecord('migrate_default_selection_invalid_rejected');
        if (recovered) {
            console.info('[HERO_RECORD_MIGRATE]', {
                source: recovered.source,
                mode: recovered.mode,
                errors: validated.errors,
                ts: new Date().toISOString()
            });
        }
        return recovered;
    }

    if (!writeHeroRecordToStorage(validated.record)) {
        return null;
    }

    console.info('[HERO_RECORD_MIGRATE]', {
        source: validated.record.source,
        mode: validated.record.mode,
        status: validated.record.status,
        assetId: validated.record.assetId || '',
        revision: validated.record.revision,
        ts: new Date().toISOString()
    });
    return validated.record;
}

// ── HeroReel compatibility projections (Commit 3 adapter) ───────────────────

/**
 * @typedef {Object} HeroReelProjection
 * @property {string} id
 * @property {string} fileName
 * @property {string} name
 * @property {string} url
 * @property {string} [thumbnail]
 * @property {string} type
 * @property {'custom_image' | 'custom_video'} backgroundSource
 */

/**
 * Project a HeroRecord into the public HeroReel shape.
 * Only asset mode produces a reel; selection/none yield null (no fake assets).
 * @param {HeroRecord | null | undefined} record
 * @returns {HeroReelProjection | null}
 */
export function projectHeroRecordToReel(record) {
    const validated = validateHeroRecord(record);
    if (!validated.ok) return null;
    const active = validated.record;
    if (active.mode !== 'asset') return null;
    if (!active.assetId || !active.mediaUrl) return null;

    const isVideo = active.mediaKind === 'video';
    const url = isVideo ? active.videoUrl || active.mediaUrl : active.posterUrl || active.mediaUrl;
    if (!url || !isDurableHeroMediaUrl(url)) return null;

    /** @type {HeroReelProjection} */
    const reel = {
        id: active.assetId,
        fileName:
            active.fileName ||
            url.split('/').pop()?.split('?')[0] ||
            '',
        name: active.title || active.fileName || active.assetId || 'Hero',
        url,
        type: isVideo ? 'video/mp4' : 'image/jpeg',
        backgroundSource: isVideo ? 'custom_video' : 'custom_image'
    };
    if (isVideo && active.posterUrl && isDurableHeroMediaUrl(active.posterUrl)) {
        reel.thumbnail = active.posterUrl;
    }
    return reel;
}

/**
 * Build a HeroRecord asset patch from a public HeroReel object.
 * @param {{
 *   id?: string;
 *   fileName?: string;
 *   name?: string;
 *   url?: string;
 *   thumbnail?: string;
 *   type?: string;
 *   backgroundSource?: string;
 * } | null | undefined} reel
 * @returns {Partial<HeroRecord> | null}
 */
export function buildHeroRecordPatchFromReel(reel) {
    if (!reel?.id || !reel?.url) return null;
    const assetId = String(reel.id || '').trim();
    const mediaUrl = String(reel.url || '').trim();
    if (!assetId || looksLikeUrlAsIdentity(assetId) || !isDurableHeroMediaUrl(mediaUrl)) {
        return null;
    }
    const isVideo =
        reel.backgroundSource === 'custom_video' ||
        String(reel.type || '').startsWith('video/') ||
        inferMediaKind(mediaUrl, String(reel.type || '')) === 'video';
    const mediaKind = /** @type {HeroRecordMediaKind} */ (isVideo ? 'video' : 'image');
    const posterRaw = String(reel.thumbnail || '').trim();
    const posterUrl =
        isVideo && isDurableHeroMediaUrl(posterRaw)
            ? posterRaw
            : !isVideo
              ? mediaUrl
              : '';

    return {
        mode: 'asset',
        status: 'ready',
        assetId,
        mediaUrl,
        videoUrl: isVideo ? mediaUrl : '',
        posterUrl,
        mediaKind,
        fileName: String(reel.fileName || '').trim(),
        title: String(reel.name || reel.fileName || assetId).trim(),
        source: 'hero_reel_adapter'
    };
}

// ── Explicit HeroRecord commands (Commit 4 identity writes) ─────────────────

/**
 * Select a durable hero asset — ONE HeroRecord write.
 * @param {{
 *   assetId: string;
 *   mediaUrl: string;
 *   mediaKind: 'image' | 'video';
 *   videoUrl?: string;
 *   posterUrl?: string;
 *   fileName?: string;
 *   title?: string;
 *   heroTitle?: string;
 *   heroSubtitle?: string;
 *   heroDescription?: string;
 *   source?: string;
 * }} input
 * @returns {HeroRecord | null}
 */
export function selectHeroAsset(input) {
    const assetId = String(input?.assetId || '').trim();
    const mediaUrl = String(input?.mediaUrl || '').trim();
    const mediaKind = input?.mediaKind === 'image' || input?.mediaKind === 'video' ? input.mediaKind : '';
    if (!assetId || !mediaUrl || !mediaKind) return null;

    /** @type {Partial<HeroRecord>} */
    const patch = {
        mode: 'asset',
        status: 'ready',
        assetId,
        mediaUrl,
        mediaKind,
        videoUrl: mediaKind === 'video' ? String(input.videoUrl || mediaUrl).trim() : '',
        posterUrl: String(input.posterUrl || (mediaKind === 'image' ? mediaUrl : '')).trim(),
        fileName: String(input.fileName || '').trim(),
        title: String(input.title || input.fileName || assetId).trim(),
        source: String(input.source || 'select_hero_asset').trim()
    };
    if (typeof input.heroTitle === 'string') patch.heroTitle = input.heroTitle;
    if (typeof input.heroSubtitle === 'string') patch.heroSubtitle = input.heroSubtitle;
    if (typeof input.heroDescription === 'string') patch.heroDescription = input.heroDescription;

    return saveHeroRecord(patch);
}

/**
 * Set non-asset hero mode (selection | none) — ONE HeroRecord write.
 * Does not invent asset identity.
 * @param {'selection' | 'none'} mode
 * @param {{
 *   status?: HeroRecordStatus;
 *   heroTitle?: string;
 *   heroSubtitle?: string;
 *   heroDescription?: string;
 *   source?: string;
 * }} [options]
 * @returns {HeroRecord | null}
 */
export function setHeroMode(mode, options = {}) {
    const normalized = mode === 'none' || mode === 'selection' ? mode : null;
    if (!normalized) return null;

    /** @type {Partial<HeroRecord>} */
    const patch = {
        mode: normalized,
        status:
            normalized === 'none'
                ? 'ready'
                : options.status === 'needs_reselection' || options.status === 'unresolved_legacy'
                  ? options.status
                  : 'ready',
        source: String(options.source || 'set_hero_mode').trim()
    };
    if (typeof options.heroTitle === 'string') patch.heroTitle = options.heroTitle;
    if (typeof options.heroSubtitle === 'string') patch.heroSubtitle = options.heroSubtitle;
    if (typeof options.heroDescription === 'string') patch.heroDescription = options.heroDescription;

    return saveHeroRecord(patch);
}

/**
 * Update presentation/copy fields without changing mode or asset identity — ONE write.
 * @param {{
 *   heroTitle?: string;
 *   heroSubtitle?: string;
 *   heroDescription?: string;
 *   title?: string;
 *   source?: string;
 * }} patch
 * @returns {HeroRecord | null}
 */
export function updateHeroPresentation(patch = {}) {
    /** @type {Partial<HeroRecord>} */
    const next = {
        source: String(patch.source || 'update_hero_presentation').trim()
    };
    if (typeof patch.heroTitle === 'string') next.heroTitle = patch.heroTitle;
    if (typeof patch.heroSubtitle === 'string') next.heroSubtitle = patch.heroSubtitle;
    if (typeof patch.heroDescription === 'string') next.heroDescription = patch.heroDescription;
    if (typeof patch.title === 'string') next.title = patch.title;

    const keys = Object.keys(next).filter((k) => k !== 'source');
    if (!keys.length) {
        return readStoredHeroRecord() || loadHeroRecord();
    }
    return saveHeroRecord(next);
}

/**
 * Map HeroRecord identity → manager config compatibility fields.
 * @param {HeroRecord | null | undefined} record
 * @returns {{ backgroundSource: string; heroAssetId: string; backgroundStyle?: string }}
 */
export function projectHeroRecordToManagerPointer(record) {
    const validated = validateHeroRecord(record);
    if (!validated.ok) {
        return { backgroundSource: 'selection', heroAssetId: '' };
    }
    const active = validated.record;
    if (active.mode === 'none') {
        return { backgroundSource: 'none', heroAssetId: '', backgroundStyle: 'gradient_overlay' };
    }
    if (active.mode === 'selection') {
        return { backgroundSource: 'selection', heroAssetId: '' };
    }
    // asset
    const backgroundSource =
        active.mediaKind === 'image' ? 'custom_image' : 'custom_video';
    const backgroundStyle = active.mediaKind === 'image' ? 'image' : 'video';
    return {
        backgroundSource,
        heroAssetId: active.assetId,
        backgroundStyle
    };
}
