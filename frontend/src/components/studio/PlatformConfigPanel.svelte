<script>
import {
    platformConfigEnabled,
    platformConfigLoading,
    platformConfigError,
    platformConfig,
    platformConfigTab,
    loadPlatformConfig,
    savePlatformSite,
    savePlatformHero,
    savePlatformFeatures,
    addPlatformCampaign,
    removePlatformCampaign
} from '../../stores/platformConfigStore.js';
import {
    HERO_MODES,
    CAMPAIGN_TYPES,
    CAMPAIGN_STATUSES
} from '../../lib/api/platformConfig.js';

/** @type {boolean} */
export let active = false;

/** @type {(msg: string) => void} */
export let onStatus = () => {};

let siteDraft = {};
let heroDraft = {};
let featuresDraft = {};
let campaignName = '';
let campaignType = 'PROMOTION';
let campaignStatus = 'draft';
let campaignStartDate = '';
let campaignEndDate = '';
let saving = false;

$: if (active) {
    loadPlatformConfig();
}
$: if ($platformConfig?.site) {
    siteDraft = {
        site_name: $platformConfig.site.site_name || '',
        site_tagline: $platformConfig.site.site_tagline || '',
        site_description: $platformConfig.site.site_description || '',
        logo_url: $platformConfig.site.logo_url || '',
        favicon_url: $platformConfig.site.favicon_url || ''
    };
}
$: if ($platformConfig?.hero) {
    heroDraft = {
        hero_enabled: $platformConfig.hero.hero_enabled,
        hero_mode: $platformConfig.hero.hero_mode || 'STATIC',
        rotation_seconds: $platformConfig.hero.rotation_seconds ?? 8
    };
}
$: if ($platformConfig?.features) {
    featuresDraft = { ...$platformConfig.features };
}

async function handleSaveSite() {
    saving = true;
    try {
        await savePlatformSite({
            site_name: siteDraft.site_name,
            site_tagline: siteDraft.site_tagline,
            site_description: siteDraft.site_description,
            logo_url: siteDraft.logo_url || null,
            favicon_url: siteDraft.favicon_url || null
        });
        onStatus('✅ Site settings saved');
    } catch (err) {
        onStatus(`❌ ${err.message}`);
    } finally {
        saving = false;
    }
}

async function handleSaveHero() {
    saving = true;
    try {
        await savePlatformHero({
            hero_enabled: heroDraft.hero_enabled,
            hero_mode: heroDraft.hero_mode,
            rotation_seconds: Number(heroDraft.rotation_seconds) || 8
        });
        onStatus('✅ Hero configuration saved');
    } catch (err) {
        onStatus(`❌ ${err.message}`);
    } finally {
        saving = false;
    }
}

async function handleSaveFeatures() {
    saving = true;
    try {
        await savePlatformFeatures({
            studio_hierarchy: featuresDraft.studio_hierarchy,
            hero_management: featuresDraft.hero_management,
            monetization: featuresDraft.monetization,
            watch_tracking: featuresDraft.watch_tracking,
            analytics: featuresDraft.analytics,
            intel: featuresDraft.intel
        });
        onStatus('✅ Feature flags saved');
    } catch (err) {
        onStatus(`❌ ${err.message}`);
    } finally {
        saving = false;
    }
}

async function handleCreateCampaign() {
    const name = campaignName.trim();
    if (!name) return;
    saving = true;
    try {
        await addPlatformCampaign({
            campaign_name: name,
            campaign_type: campaignType,
            status: campaignStatus,
            start_date: campaignStartDate ? new Date(campaignStartDate).toISOString() : null,
            end_date: campaignEndDate ? new Date(campaignEndDate).toISOString() : null
        });
        campaignName = '';
        campaignStartDate = '';
        campaignEndDate = '';
        onStatus(`✅ Campaign "${name}" created`);
    } catch (err) {
        onStatus(`❌ ${err.message}`);
    } finally {
        saving = false;
    }
}

async function handleDeleteCampaign(id, name) {
    saving = true;
    try {
        await removePlatformCampaign(id);
        onStatus(`✅ Campaign "${name}" deleted`);
    } catch (err) {
        onStatus(`❌ ${err.message}`);
    } finally {
        saving = false;
    }
}
</script>

<div class="platform-config-section">
    <div class="smart-header">
        <div class="ai-badge">⚙️ PLATFORM CONFIG</div>
        <h3>Site Behavior Control</h3>
        <p class="smart-subtitle">Configure platform without code changes — playback unchanged until wired</p>
    </div>

    {#if $platformConfigLoading}
        <p class="platform-hint">Loading configuration...</p>
    {:else if !$platformConfigEnabled}
        <p class="platform-hint">
            Platform config API disabled. Set <code>REELFORGE_PLATFORM_CONFIG=true</code> on the backend.
        </p>
    {:else if $platformConfigError}
        <p class="platform-error">{$platformConfigError}</p>
    {:else}
        <div class="platform-tabs" role="tablist">
            {#each [
                { id: 'settings', label: 'Settings' },
                { id: 'hero', label: 'Hero' },
                { id: 'campaigns', label: 'Campaigns' },
                { id: 'features', label: 'Features' }
            ] as tab}
                <button
                    type="button"
                    class="platform-tab"
                    class:active={$platformConfigTab === tab.id}
                    role="tab"
                    aria-selected={$platformConfigTab === tab.id}
                    on:click={() => platformConfigTab.set(tab.id)}
                >
                    {tab.label}
                </button>
            {/each}
        </div>

        {#if $platformConfigTab === 'settings'}
            <div class="platform-panel" role="tabpanel">
                <label class="input-label-wrapper">SITE NAME<input bind:value={siteDraft.site_name} /></label>
                <label class="input-label-wrapper">TAGLINE<input bind:value={siteDraft.site_tagline} /></label>
                <label class="input-label-wrapper">DESCRIPTION<textarea bind:value={siteDraft.site_description} rows="2"></textarea></label>
                <label class="input-label-wrapper">LOGO URL<input bind:value={siteDraft.logo_url} placeholder="/thumbs/logo.png" /></label>
                <label class="input-label-wrapper">FAVICON URL<input bind:value={siteDraft.favicon_url} placeholder="/thumbs/favicon.ico" /></label>
                <button class="quick-upload-btn" type="button" disabled={saving} on:click={handleSaveSite}>Save site settings</button>
            </div>
        {:else if $platformConfigTab === 'hero'}
            <div class="platform-panel" role="tabpanel">
                <label class="platform-toggle">
                    <input type="checkbox" bind:checked={heroDraft.hero_enabled} />
                    <span>Hero enabled</span>
                </label>
                <label class="input-label-wrapper">HERO MODE
                    <select bind:value={heroDraft.hero_mode}>
                        {#each HERO_MODES as mode}<option value={mode}>{mode}</option>{/each}
                    </select>
                </label>
                <label class="input-label-wrapper">ROTATION (seconds)<input type="number" min="3" max="120" bind:value={heroDraft.rotation_seconds} /></label>
                <button class="quick-upload-btn" type="button" disabled={saving} on:click={handleSaveHero}>Save hero config</button>
            </div>
        {:else if $platformConfigTab === 'campaigns'}
            <div class="platform-panel" role="tabpanel">
                <div class="platform-campaign-form">
                    <label class="input-label-wrapper">CAMPAIGN NAME<input bind:value={campaignName} placeholder="Summer Premiere" /></label>
                    <label class="input-label-wrapper">TYPE
                        <select bind:value={campaignType}>
                            {#each CAMPAIGN_TYPES as t}<option value={t}>{t}</option>{/each}
                        </select>
                    </label>
                    <label class="input-label-wrapper">STATUS
                        <select bind:value={campaignStatus}>
                            {#each CAMPAIGN_STATUSES as s}<option value={s}>{s}</option>{/each}
                        </select>
                    </label>
                    <label class="input-label-wrapper">START DATE<input type="datetime-local" bind:value={campaignStartDate} /></label>
                    <label class="input-label-wrapper">END DATE<input type="datetime-local" bind:value={campaignEndDate} /></label>
                    <button class="quick-upload-btn" type="button" disabled={saving || !campaignName.trim()} on:click={handleCreateCampaign}>+ Add campaign</button>
                </div>
                <ul class="platform-campaign-list">
                    {#each ($platformConfig?.campaigns || []) as c (c.id)}
                        <li>
                            <span class="campaign-name">{c.campaign_name}</span>
                            <span class="campaign-meta">{c.campaign_type} · {c.status}</span>
                            <button type="button" class="clip-remove" aria-label="Delete campaign" disabled={saving} on:click={() => handleDeleteCampaign(c.id, c.campaign_name)}>✕</button>
                        </li>
                    {:else}
                        <li class="platform-hint">No campaigns yet.</li>
                    {/each}
                </ul>
            </div>
        {:else if $platformConfigTab === 'features'}
            <div class="platform-panel" role="tabpanel">
                <p class="platform-hint">Stored preferences — deployment env vars still gate runtime APIs.</p>
                {#each [
                    { key: 'studio_hierarchy', label: 'Studio hierarchy' },
                    { key: 'hero_management', label: 'Hero management' },
                    { key: 'monetization', label: 'Monetization' },
                    { key: 'watch_tracking', label: 'Watch tracking' },
                    { key: 'analytics', label: 'Analytics' },
                    { key: 'intel', label: 'Intel' }
                ] as flag}
                    <label class="platform-toggle">
                        <input type="checkbox" bind:checked={featuresDraft[flag.key]} />
                        <span>{flag.label}</span>
                    </label>
                {/each}
                <button class="quick-upload-btn" type="button" disabled={saving} on:click={handleSaveFeatures}>Save feature flags</button>
            </div>
        {/if}
    {/if}
</div>

<style>
    .platform-config-section {
        margin-top: 2rem;
        padding-top: 2rem;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    }
    .platform-hint {
        color: rgba(255, 255, 255, 0.55);
        font-size: 0.85rem;
        margin: 0.5rem 0;
    }
    .platform-error {
        color: #f87171;
        font-size: 0.85rem;
    }
    .platform-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        margin: 0.75rem 0 1rem;
    }
    .platform-tab {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #fff;
        padding: 0.35rem 0.75rem;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.8rem;
    }
    .platform-tab.active {
        border-color: var(--neon-cyan, #00f2ff);
        background: rgba(0, 242, 255, 0.12);
    }
    .platform-panel {
        display: grid;
        gap: 0.5rem;
    }
    .platform-panel textarea {
        width: 100%;
        background: rgba(0, 0, 0, 0.35);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #fff;
        border-radius: 6px;
        padding: 0.5rem;
    }
    .platform-toggle {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.85);
    }
    .platform-campaign-list {
        list-style: none;
        padding: 0;
        margin: 1rem 0 0;
        max-height: 160px;
        overflow-y: auto;
    }
    .platform-campaign-list li {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.35rem 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        font-size: 0.85rem;
    }
    .campaign-name {
        flex: 1;
        font-weight: 600;
    }
    .campaign-meta {
        color: rgba(255, 255, 255, 0.45);
        font-size: 0.75rem;
    }
</style>
