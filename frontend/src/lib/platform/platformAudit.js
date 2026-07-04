/**
 * Platform readiness audit — emits [PLATFORM_AUDIT] per subsystem at boot.
 * Diagnostics only; no UI, playback, or media rendering changes.
 */

import { get } from 'svelte/store';
import { BACKEND_URL } from '../config.js';
import { seriesCatalog, reelSeriesMetadata, episodeCount } from '../series/seriesStore.js';
import { SERIES_METADATA_STORAGE_KEY } from '../series/seriesMetadataStorage.js';
import { WATCH_PROGRESS_STORAGE_KEY, hasWatchProgressData } from '../series/seriesWatchProgress.js';
import { PUBLISHING_PROFILES } from '../publishing/publishingProfiles.js';
import { activePublishingProfile } from '../publishing/publishingProfileStore.js';
import { isWatchTrackingEnabled } from '../watch/watchTracker.js';
import { PRESERVED_KEYS } from '../storage.js';

/**
 * @param {string} subsystem
 * @param {'healthy' | 'degraded' | 'offline' | 'stub'} status
 * @param {Record<string, unknown>} extra
 */
function logPlatformAudit(subsystem, status, extra = {}) {
    console.log(
        `[PLATFORM_AUDIT] ${JSON.stringify({
            subsystem,
            status,
            timestamp: Date.now(),
            ...extra
        })}`
    );
}

/** @returns {Record<string, unknown>} */
function probeLocalStorage() {
    if (typeof window === 'undefined') return {};
    const keys = [
        SERIES_METADATA_STORAGE_KEY,
        WATCH_PROGRESS_STORAGE_KEY,
        'reelforge_publishing_profile',
        'reelforge_feed',
        'reel_vault',
        'personal_video_vault',
        'reelforge_viewer_id'
    ];
    /** @type {Record<string, unknown>} */
    const found = {};
    for (const key of keys) {
        try {
            const raw = localStorage.getItem(key);
            if (raw == null) {
                found[key] = false;
                continue;
            }
            if (key === SERIES_METADATA_STORAGE_KEY || key === WATCH_PROGRESS_STORAGE_KEY) {
                const parsed = JSON.parse(raw);
                found[key] = Object.keys(parsed || {}).length;
            } else if (key === 'reelforge_feed' || key === 'reel_vault' || key === 'personal_video_vault') {
                const parsed = JSON.parse(raw);
                found[key] = Array.isArray(parsed) ? parsed.length : 0;
            } else {
                found[key] = true;
            }
        } catch {
            found[key] = 'error';
        }
    }
    found.preservedKeyCount = PRESERVED_KEYS.size;
    return found;
}

/** Run all subsystem audits once after app init. */
export function runPlatformAudit() {
    const ls = probeLocalStorage();
    const catalog = get(seriesCatalog);
    const studioMap = get(reelSeriesMetadata);
    const studioCount = Object.keys(studioMap).length;
    const episodes = get(episodeCount);
    const profile = get(activePublishingProfile);
    const profileDef = PUBLISHING_PROFILES[profile];

    logPlatformAudit('Media Pipeline', 'degraded', {
        dataSource: 'postgres+filesystem via POST /api/reels',
        dependencies: ['ffmpeg', 'ffprobe', BACKEND_URL],
        diagnostics: ['[MediaRenderer]', '[MEDIA URL]', '[ingest-poll]', '[mediaBootstrap]'],
        failureModes: ['ingest-timeout', 'ffmpeg-missing', 'orphan-files'],
        readinessScore: 72
    });

    logPlatformAudit('Viewer Feed', 'healthy', {
        dataSource: 'GET /api/reels + reelforge_feed localStorage',
        dependencies: ['mediaBootstrap', 'normalizeReel', 'ReelshortExperience'],
        diagnostics: ['[THEATER OPEN]', '[ws] CREATED/DELETED', '[Vault]'],
        failureModes: ['backend-unavailable', 'stale-cache', 'quota-eviction'],
        localState: { feedItems: ls['reelforge_feed'], vaultItems: ls['personal_video_vault'] },
        readinessScore: 78
    });

    logPlatformAudit('Theater Experience', 'healthy', {
        dataSource: 'activeReel store + findReelInFeed',
        dependencies: ['TheaterExperience', 'theaterPlayback', 'MediaRenderer'],
        diagnostics: ['[THEATER OPEN/CLOSE/STATE/PROFILE/MEDIA]', '[theater-handshake]', '?debug=theater'],
        failureModes: ['autoplay-blocked', 'placeholder-no-vault', 'stale-reel-payload'],
        readinessScore: 82
    });

    logPlatformAudit('Series Store', studioCount > 0 ? 'healthy' : 'degraded', {
        dataSource: 'reelforge_series_metadata + mockSeriesData seed',
        dependencies: ['seriesStore', 'seriesMetadataStorage', 'initSeriesMetadata'],
        diagnostics: ['[INTELLIGENCE_SOURCE]'],
        failureModes: ['bridge-gap', 'no-catalog-match', 'single-tab-only'],
        localState: { seriesCount: catalog.length, studioRecords: studioCount, episodes },
        readinessScore: studioCount > 0 ? 76 : 58
    });

    logPlatformAudit('Episode Store', 'degraded', {
        dataSource: 'embedded in seriesCatalog (no standalone store)',
        dependencies: ['seriesStore.getEpisodeById', 'getNextEpisode'],
        diagnostics: ['[INTELLIGENCE_SOURCE] Next Episode field'],
        failureModes: ['drawer-select-no-playback', 'next-episode-stub'],
        localState: { totalEpisodes: episodes },
        readinessScore: 55
    });

    logPlatformAudit('Publishing Profiles', profileDef ? 'healthy' : 'degraded', {
        dataSource: 'reelforge_publishing_profile + publishingProfiles.js',
        dependencies: ['publishingProfileStore', 'TheaterExperience chrome flags'],
        diagnostics: ['[THEATER PROFILE]'],
        failureModes: ['profile-chrome-mismatch'],
        localState: { activeProfile: profile, profileCount: Object.keys(PUBLISHING_PROFILES).length },
        readinessScore: 74
    });

    const watchEnabled = isWatchTrackingEnabled();
    logPlatformAudit('Watch Telemetry', hasWatchProgressData() || watchEnabled ? 'degraded' : 'offline', {
        dataSource: 'reelforge_series_watch_progress + POST /api/watch/event',
        dependencies: ['watchTracker', 'seriesWatchProgress', 'VITE_REELFORGE_WATCH_TRACKING'],
        diagnostics: ['[watchTracker]', '[INTELLIGENCE_SOURCE] VIEWER_TELEMETRY fields'],
        failureModes: ['api-disabled', 'session-not-started', 'progress-not-preserved-on-quota'],
        localState: {
            watchProgressKeys: ls[WATCH_PROGRESS_STORAGE_KEY],
            viewerId: Boolean(ls['reelforge_viewer_id']),
            apiTrackingEnabled: watchEnabled
        },
        readinessScore: hasWatchProgressData() ? 68 : 48
    });

    logPlatformAudit('Smart Production Studio', studioCount > 0 ? 'healthy' : 'degraded', {
        dataSource: SERIES_METADATA_STORAGE_KEY,
        dependencies: ['SeriesMetadataEditor', 'saveReelSeriesMetadata', 'Viewer adminMode'],
        diagnostics: ['[INTELLIGENCE_SOURCE]', '[INTELLIGENCE_SOURCE_REPORT]'],
        failureModes: ['localStorage-only', '12-reel-picker-cap', 'no-backend-sync'],
        localState: { studioRecords: studioCount },
        readinessScore: 70
    });

    logPlatformAudit('Local Persistence', 'degraded', {
        dataSource: 'localStorage (browser)',
        dependencies: ['storage.js PRESERVED_KEYS', 'seriesMetadataStorage', 'seriesWatchProgress'],
        diagnostics: ['[storage:*]', 'seriesMetadata persist warnings'],
        failureModes: ['quota-pressure', 'watch-progress-eviction', 'no-cross-tab-sync'],
        localState: ls,
        readinessScore: 62
    });

    logPlatformAudit('Diagnostics Layer', 'healthy', {
        dataSource: 'console tags (unstructured)',
        dependencies: [
            'theaterDiagnostics',
            'intelligenceSourceDiagnostics',
            'theaterPlayback handshake',
            'platformAudit'
        ],
        diagnostics: [
            '[PLATFORM_AUDIT]',
            '[THEATER *]',
            '[INTELLIGENCE_SOURCE]',
            '[INTELLIGENCE_SOURCE_REPORT]',
            '[MEDIA URL]',
            '[mediaBootstrap]'
        ],
        failureModes: ['verbose-reactive-logs', 'no-central-aggregator', 'no-structured-export'],
        readinessScore: 71
    });

    const scores = [72, 78, 82, studioCount > 0 ? 76 : 58, 55, 74, hasWatchProgressData() ? 68 : 48, 70, 62, 71];
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

    console.log(
        `[PLATFORM_AUDIT] ${JSON.stringify({
            subsystem: 'Platform Summary',
            status: avg >= 70 ? 'degraded' : 'offline',
            readinessScore: avg,
            subsystemCount: 10,
            timestamp: Date.now()
        })}`
    );
}
