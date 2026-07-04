import { writable, get } from 'svelte/store';
import {
    fetchPlatformConfig,
    fetchPlatformStatus,
    updatePlatformSite,
    updatePlatformHero,
    updatePlatformFeatures,
    createPlatformCampaign,
    updatePlatformCampaign,
    deletePlatformCampaign
} from '../lib/api/platformConfig.js';

export const platformConfigEnabled = writable(false);
export const platformConfigLoading = writable(false);
export const platformConfigError = writable('');
export const platformConfig = writable(null);
export const platformConfigTab = writable('settings');

const DEFAULT_SITE = {
    site_name: 'ReelForge',
    site_tagline: '',
    site_description: '',
    logo_url: '',
    favicon_url: ''
};

const DEFAULT_HERO = {
    hero_enabled: true,
    hero_mode: 'STATIC',
    rotation_seconds: 8
};

const DEFAULT_FEATURES = {
    studio_hierarchy: false,
    hero_management: false,
    monetization: false,
    watch_tracking: false,
    analytics: false,
    intel: false
};

export async function loadPlatformConfig() {
    platformConfigLoading.set(true);
    platformConfigError.set('');
    try {
        const status = await fetchPlatformStatus();
        if (status?.disabled) {
            platformConfigEnabled.set(false);
            platformConfig.set(null);
            return { disabled: true };
        }
        platformConfigEnabled.set(true);
        const config = await fetchPlatformConfig();
        platformConfig.set(config);
        return config;
    } catch (err) {
        platformConfigEnabled.set(false);
        platformConfigError.set(err?.message || 'Failed to load platform config');
        return null;
    } finally {
        platformConfigLoading.set(false);
    }
}

export async function savePlatformSite(patch) {
    const updated = await updatePlatformSite(patch);
    platformConfig.update((c) => (c ? { ...c, site: updated } : c));
    return updated;
}

export async function savePlatformHero(patch) {
    const updated = await updatePlatformHero(patch);
    platformConfig.update((c) => (c ? { ...c, hero: updated } : c));
    return updated;
}

export async function savePlatformFeatures(patch) {
    const updated = await updatePlatformFeatures(patch);
    platformConfig.update((c) => (c ? { ...c, features: updated } : c));
    return updated;
}

export async function addPlatformCampaign(body) {
    const created = await createPlatformCampaign(body);
    platformConfig.update((c) =>
        c ? { ...c, campaigns: [created, ...(c.campaigns || [])] } : c
    );
    return created;
}

export async function editPlatformCampaign(id, patch) {
    const updated = await updatePlatformCampaign(id, patch);
    platformConfig.update((c) =>
        c
            ? {
                  ...c,
                  campaigns: (c.campaigns || []).map((row) => (row.id === id ? updated : row))
              }
            : c
    );
    return updated;
}

export async function removePlatformCampaign(id) {
    await deletePlatformCampaign(id);
    platformConfig.update((c) =>
        c ? { ...c, campaigns: (c.campaigns || []).filter((row) => row.id !== id) } : c
    );
}

export function getSiteDraft() {
    const c = get(platformConfig);
    return c?.site ? { ...c.site } : { ...DEFAULT_SITE };
}

export function getHeroDraft() {
    const c = get(platformConfig);
    return c?.hero ? { ...c.hero } : { ...DEFAULT_HERO };
}

export function getFeaturesDraft() {
    const c = get(platformConfig);
    return c?.features ? { ...c.features } : { ...DEFAULT_FEATURES };
}
