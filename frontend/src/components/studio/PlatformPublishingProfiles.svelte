<script>
    import { PLATFORM_PROFILE_ORDER } from '../../lib/platformProfiles.js';
    import YouTubeProfile from './profiles/YouTubeProfile.svelte';
    import TikTokProfile from './profiles/TikTokProfile.svelte';
    import InstagramProfile from './profiles/InstagramProfile.svelte';
    import FacebookProfile from './profiles/FacebookProfile.svelte';
    import LinkedInProfile from './profiles/LinkedInProfile.svelte';
    import XProfile from './profiles/XProfile.svelte';

    const PROFILE_COMPONENTS = {
        youtube: YouTubeProfile,
        tiktok: TikTokProfile,
        instagram: InstagramProfile,
        facebook: FacebookProfile,
        linkedin: LinkedInProfile,
        x: XProfile
    };
</script>

<section class="platform-publishing-section" aria-labelledby="platform-publishing-heading">
    <div class="smart-header">
        <div class="ai-badge">📡 PLATFORM PUBLISHING</div>
        <h3 id="platform-publishing-heading">Multi-Platform Distribution</h3>
        <p class="smart-subtitle">Connect accounts and queue episodes — visual placeholders until OAuth pipeline ships</p>
    </div>

    <div class="platform-profiles-grid">
        {#each PLATFORM_PROFILE_ORDER as platformId}
            <svelte:component this={PROFILE_COMPONENTS[platformId]} />
        {/each}
    </div>
</section>

<style>
    .platform-publishing-section {
        margin-top: 2rem;
        padding-top: 2rem;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        grid-column: 1 / -1;
    }

    .platform-profiles-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 1rem;
        margin-top: 1rem;
    }

    @media (min-width: 1100px) {
        .platform-profiles-grid {
            grid-template-columns: repeat(3, 1fr);
        }
    }
</style>
