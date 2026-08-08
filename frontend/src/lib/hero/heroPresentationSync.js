/**
 * Hero presentation sync: backend is source of truth; localStorage is cache only.
 */
import {
    buildServerPresentationPayload,
    logHeroSource,
    mapServerPresentationToManagerPatch,
    setLastHeroConfigSource
} from './heroPresentationCore.js';
import {
    fetchHeroPresentation,
    putHeroPresentation
} from '../api/heroPresentation.js';

export {
    getLastHeroConfigSource,
    setLastHeroConfigSource,
    logHeroSource,
    sanitizeHeroConfigLocationIntelligence,
    buildServerPresentationPayload,
    mapServerPresentationToManagerPatch
} from './heroPresentationCore.js';

/**
 * Server → localStorage cache. Does not re-POST.
 * @param {(patch: Record<string, unknown>, options?: { skipServer?: boolean; source?: string }) => Record<string, unknown>} saveFn
 * @param {() => Record<string, unknown>} loadFn
 * @returns {Promise<{ hydrated: boolean; config: Record<string, unknown> | null; source: string }>}
 */
export async function hydrateHeroPresentationFromServer(saveFn, loadFn) {
    const remote = await fetchHeroPresentation();
    const local = loadFn();
    const localId = String(local?.heroAssetId || '').trim();
    const patch = mapServerPresentationToManagerPatch(remote);
    const remoteId = String(patch?.heroAssetId || remote?.heroAssetId || '').trim();

    if (patch && (remoteId || String(patch.heroTitle || '').trim())) {
        const next = saveFn(patch, { skipServer: true, source: 'backend' });
        const title = String(next?.heroTitle || patch.heroTitle || '').trim();
        const bg =
            String(remote?.mediaUrl || patch.backgroundMediaUrl || next?.mediaUrl || '').trim() ||
            '';
        logHeroSource({
            source: 'backend',
            heroAssetId: String(next?.heroAssetId || remoteId),
            title,
            backgroundUrl: bg
        });
        return { hydrated: true, config: next, source: 'backend' };
    }

    // One-time migrate: admin browser has local SoT that never hit server.
    if (localId && !remoteId) {
        console.info('[HERO_PRESENTATION] local has asset, server empty — migrating if admin', {
            heroAssetId: localId
        });
        const pushed = await putHeroPresentation(buildServerPresentationPayload(local));
        if (pushed) {
            logHeroSource({
                source: 'backend',
                heroAssetId: localId,
                title: String(local.heroTitle || ''),
                backgroundUrl: String(local.backgroundMediaUrl || local.mediaUrl || '')
            });
            return { hydrated: true, config: local, source: 'backend' };
        }
    }

    const source = localId ? 'localStorage' : 'default';
    logHeroSource({
        source,
        heroAssetId: localId,
        title: String(local?.heroTitle || ''),
        backgroundUrl: String(local?.backgroundMediaUrl || local?.mediaUrl || '')
    });
    setLastHeroConfigSource(source);
    return { hydrated: false, config: local, source };
}

/**
 * Push current config to server (admin). Fire-and-forget safe.
 * @param {Record<string, unknown>} config
 */
export async function pushHeroPresentationToServer(config) {
    const payload = buildServerPresentationPayload(config);
    if (!String(payload.heroAssetId || '').trim() && !String(payload.heroTitle || '').trim()) {
        if (String(config?.backgroundSource || '').trim() !== 'none' && !payload.heroAssetId) {
            return null;
        }
    }
    const saved = await putHeroPresentation(payload);
    if (saved) {
        console.info('[HERO_PRESENTATION] server write ok', {
            heroAssetId: payload.heroAssetId,
            title: payload.heroTitle
        });
    }
    return saved;
}
