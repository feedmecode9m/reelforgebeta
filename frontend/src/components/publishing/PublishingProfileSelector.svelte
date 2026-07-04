<script>
    import SmartHelpTooltip from '../studio/SmartHelpTooltip.svelte';
    import {
        activePublishingProfile,
        publishingProfileConfig,
        setActivePublishingProfile
    } from '../../lib/publishing/publishingProfileStore.js';
    import { PUBLISHING_PROFILE_ORDER, getPublishingProfile } from '../../lib/publishing/publishingProfiles.js';
</script>

<section class="publishing-profile-section" aria-labelledby="publishing-profile-heading" data-studio-walkthrough="publishingProfiles">
    <div class="smart-header">
        <div class="ai-badge">🚀 PUBLISHING PROFILE</div>
        <div class="publishing-profile-heading-row">
            <h3 id="publishing-profile-heading">Series Presentation Mode</h3>
            <SmartHelpTooltip helpKey="publishingProfiles" />
        </div>
        <p class="smart-subtitle">Controls metadata display, episode navigation, and theater chrome — uses shared series metadata</p>
    </div>

    <div class="publishing-profile-grid" role="radiogroup" aria-label="Publishing profile">
        {#each PUBLISHING_PROFILE_ORDER as profileId}
            {@const profile = getPublishingProfile(profileId)}
            <button
                type="button"
                class="publishing-profile-card"
                class:active={$activePublishingProfile === profileId}
                aria-pressed={$activePublishingProfile === profileId}
                style="--profile-color: {profile.theaterChrome.primaryColor}"
                on:click={() => setActivePublishingProfile(profileId)}
            >
                <span class="publishing-profile-card__icon">{profile.icon}</span>
                <span class="publishing-profile-card__label">{profile.label}</span>
                <span class="publishing-profile-card__desc">{profile.description}</span>
                <span class="publishing-profile-card__meta">
                    {profile.episodeNavigation.mode} · {profile.metadataDisplay.layout} metadata
                </span>
            </button>
        {/each}
    </div>

    {#if $publishingProfileConfig}
        <div class="publishing-profile-active" role="status">
            Active: <strong>{$publishingProfileConfig.label}</strong>
            — {$publishingProfileConfig.episodeNavigation.mode} navigation,
            {$publishingProfileConfig.theaterChrome.immersive916 ? '9:16 immersive' : 'widescreen'} chrome
        </div>
    {/if}
</section>

<style>
    .publishing-profile-heading-row {
        display: flex;
        align-items: center;
        gap: 0.35rem;
    }
    .publishing-profile-section {
        margin-top: 1.5rem;
        padding-top: 1.5rem;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        grid-column: 1 / -1;
    }
    .publishing-profile-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 0.75rem;
        margin-top: 0.85rem;
    }
    .publishing-profile-card {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.35rem;
        padding: 0.85rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.03);
        color: #fff;
        cursor: pointer;
        text-align: left;
        transition: border-color 0.2s ease, background 0.2s ease, transform 0.15s ease;
    }
    .publishing-profile-card:hover {
        border-color: var(--profile-color);
        background: rgba(255, 255, 255, 0.05);
    }
    .publishing-profile-card.active {
        border-color: var(--profile-color);
        background: color-mix(in srgb, var(--profile-color) 14%, transparent);
        box-shadow: 0 0 18px color-mix(in srgb, var(--profile-color) 25%, transparent);
    }
    .publishing-profile-card__icon {
        font-size: 1.25rem;
    }
    .publishing-profile-card__label {
        font-size: 0.9rem;
        font-weight: 700;
    }
    .publishing-profile-card__desc {
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.62);
        line-height: 1.4;
    }
    .publishing-profile-card__meta {
        font-size: 0.62rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.45);
    }
    .publishing-profile-active {
        margin-top: 0.75rem;
        font-size: 0.78rem;
        color: rgba(255, 255, 255, 0.65);
    }
</style>
