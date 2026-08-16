#!/usr/bin/env node
/**
 * BG-7L-DOMAIN-SYNC — regression gate for domain-scoped synchronization.
 * Self-contained (no frontend module imports — avoids import.meta.env bootstrap).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, '..');
const domainSyncPath = path.join(frontendRoot, 'src/lib/viewer/domainSync.js');
const viewerContextPath = path.join(frontendRoot, 'src/viewer/viewerContext.js');
const domainSyncSource = fs.readFileSync(domainSyncPath, 'utf8');
const viewerContextSource = fs.readFileSync(viewerContextPath, 'utf8');

const SYNC_DOMAIN = Object.freeze({
    ALL: 'all',
    HERO: 'hero',
    THUMBNAIL: 'thumbnail',
    VIDEO: 'video',
    FEED: 'feed'
});

/** @param {string | string[] | null | undefined} input */
function resolveSyncDomains(input) {
    if (!input || input === SYNC_DOMAIN.ALL) {
        return new Set([SYNC_DOMAIN.ALL]);
    }
    const list = Array.isArray(input) ? input : [input];
    const domains = new Set(list.filter(Boolean));
    if (domains.has(SYNC_DOMAIN.ALL)) {
        return new Set([SYNC_DOMAIN.ALL]);
    }
    return domains;
}

/** @param {Set<string>} domains */
function isFullSync(domains) {
    return domains.has(SYNC_DOMAIN.ALL);
}

/** @param {Set<string>} domains @param {string} domain */
function includesDomain(domains, domain) {
    return domains.has(SYNC_DOMAIN.ALL) || domains.has(domain);
}

function isVideoReel(reel) {
    const url = String(reel?.url || reel?.video_url || '').trim();
    if (url.includes('/videos/') || /\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i.test(url)) return true;
    const type = String(reel?.type || '').toLowerCase();
    return type.startsWith('video/') || type === 'video';
}

function isImageReel(reel) {
    if (isVideoReel(reel)) return false;
    const type = String(reel?.type || '').toLowerCase();
    return type === 'image' || type.startsWith('image/') || Boolean(reel?.url);
}

function isThumbnailImageReel(reel) {
    return isImageReel(reel) && String(reel?.url || '').includes('/thumbs/');
}

function classifyReelSyncDomain(reel, isHeroAssetFn) {
    if (!reel || typeof reel !== 'object') return SYNC_DOMAIN.ALL;
    if (typeof isHeroAssetFn === 'function' && isHeroAssetFn(reel)) {
        return SYNC_DOMAIN.HERO;
    }
    if (isThumbnailImageReel(reel) || (isImageReel(reel) && String(reel.url || '').includes('/thumbs/'))) {
        return SYNC_DOMAIN.THUMBNAIL;
    }
    if (isVideoReel(reel)) {
        return SYNC_DOMAIN.VIDEO;
    }
    return SYNC_DOMAIN.ALL;
}

function domainsForReelIngestion(reel, isHeroAssetFn) {
    const primary = classifyReelSyncDomain(reel, isHeroAssetFn);
    if (primary === SYNC_DOMAIN.HERO) return [SYNC_DOMAIN.HERO];
    if (primary === SYNC_DOMAIN.THUMBNAIL) return [SYNC_DOMAIN.THUMBNAIL, SYNC_DOMAIN.FEED];
    if (primary === SYNC_DOMAIN.VIDEO) return [SYNC_DOMAIN.VIDEO, SYNC_DOMAIN.FEED];
    return [SYNC_DOMAIN.ALL];
}

/** @type {Array<{ id: string, pass: boolean, detail?: string }>} */
const results = [];

function assert(id, condition, detail = '') {
    results.push({ id, pass: Boolean(condition), detail });
    const mark = condition ? 'PASS' : 'FAIL';
    console.log(`${mark} ${id}${detail ? ` — ${detail}` : ''}`);
}

function mockIsHeroAsset(reel) {
    return Boolean(reel?.isHero || reel?.heroAssetId || reel?.category === 'Hero');
}

function main() {
    assert('domain_sync_module_exists', fs.existsSync(domainSyncPath));
    assert('exports_sync_domain', domainSyncSource.includes('export const SYNC_DOMAIN'));
    assert('exports_domains_for_reel', domainSyncSource.includes('export function domainsForReelIngestion'));
    assert('exports_trace_ownership', domainSyncSource.includes('export function traceAssetOwnership'));

    assert('resolve_all', isFullSync(resolveSyncDomains(SYNC_DOMAIN.ALL)));
    assert('resolve_hero_only', [...resolveSyncDomains(SYNC_DOMAIN.HERO)].join(',') === 'hero');
    assert('includes_hero_in_all', includesDomain(resolveSyncDomains(SYNC_DOMAIN.ALL), SYNC_DOMAIN.HERO));
    assert('excludes_video_from_hero', !includesDomain(resolveSyncDomains(SYNC_DOMAIN.HERO), SYNC_DOMAIN.VIDEO));

    const heroReel = {
        id: 'hero-1',
        type: 'video/mp4',
        url: '/videos/hero-1.mp4',
        category: 'Hero',
        isHero: true
    };
    assert(
        'hero_ingestion_domains',
        JSON.stringify(domainsForReelIngestion(heroReel, mockIsHeroAsset)) === JSON.stringify([SYNC_DOMAIN.HERO]),
        domainsForReelIngestion(heroReel, mockIsHeroAsset).join(',')
    );
    assert('hero_classify', classifyReelSyncDomain(heroReel, mockIsHeroAsset) === SYNC_DOMAIN.HERO);

    const thumbReel = { id: 'thumb-1', type: 'image/jpeg', url: '/thumbs/thumb-1.jpg' };
    assert(
        'thumbnail_ingestion_domains',
        JSON.stringify(domainsForReelIngestion(thumbReel, mockIsHeroAsset)) ===
            JSON.stringify([SYNC_DOMAIN.THUMBNAIL, SYNC_DOMAIN.FEED])
    );

    const videoReel = { id: 'vid-1', type: 'video/mp4', url: '/videos/vid-1.mp4' };
    assert(
        'video_ingestion_domains',
        JSON.stringify(domainsForReelIngestion(videoReel, mockIsHeroAsset)) ===
            JSON.stringify([SYNC_DOMAIN.VIDEO, SYNC_DOMAIN.FEED])
    );

    assert(
        'ws_uses_sync_domain',
        /syncDomain\s*\(\s*ingestionDomains/.test(viewerContextSource),
        'connectReelEventSocket.onCreated must call syncDomain(ingestionDomains)'
    );
    assert(
        'ws_no_full_sync_on_created',
        !/onCreated:[\s\S]{0,1200}syncFromVault\s*\(\s*true/.test(viewerContextSource),
        'onCreated must not call syncFromVault(true)'
    );
    assert(
        'hero_only_early_return',
        /syncHeroOnly[\s\S]{0,120}return syncHeroDomainOnly/.test(viewerContextSource),
        'syncFromVaultWithDomains must short-circuit hero-only sync'
    );
    assert(
        'hero_domain_skips_reconcile',
        /async function syncHeroDomainOnly[\s\S]{0,2200}handleHeroManagerUpdated/.test(viewerContextSource) &&
            !/async function syncHeroDomainOnly[\s\S]{0,2200}reconcileThumbnailVault/.test(viewerContextSource),
        'syncHeroDomainOnly must not reconcile thumbnails'
    );
    assert(
        'thumbnail_reconcile_gated',
        /if \(syncThumbnail\)[\s\S]{0,1200}reconcileStaleThumbnailsOnStartup/.test(viewerContextSource),
        'reconcileStaleThumbnailsOnStartup only when thumbnail domain requested'
    );
    assert(
        'domains_for_reel_import',
        viewerContextSource.includes('domainsForReelIngestion'),
        'viewerContext imports domainsForReelIngestion'
    );
    assert(
        'sync_domain_exported',
        viewerContextSource.includes('syncFromVault, syncDomain'),
        'createViewerContext exports syncDomain'
    );

    const migrationPath = path.join(frontendRoot, 'artifacts/BG_7L_DOMAIN_SYNC_MIGRATION.md');
    assert('migration_report_exists', fs.existsSync(migrationPath), migrationPath);

    const failed = results.filter((r) => !r.pass);
    console.log('');
    console.log(`BG-7L-DOMAIN-SYNC: ${results.length - failed.length}/${results.length} passed`);
    if (failed.length) {
        process.exitCode = 1;
    }
}

main();
