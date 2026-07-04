<script>
    import { getPlatformProfile, primaryAspectRatio } from '../../../lib/platformProfiles.js';

    /** @type {string} */
    export let platformId = 'youtube';

    $: profile = getPlatformProfile(platformId);
    $: aspectCss = profile ? primaryAspectRatio(profile.aspect) : '16 / 9';
</script>

{#if profile}
    <article
        class="platform-profile-card"
        style="--platform-color: {profile.primaryColor}; --preview-aspect: {aspectCss};"
        data-platform={platformId}
    >
        <header class="platform-profile-header">
            <span class="platform-icon" aria-hidden="true">{profile.icon}</span>
            <h4 class="platform-name">{profile.name}</h4>
        </header>

        <div class="connection-card">
            <div class="connection-status">
                <span class="status-dot disconnected" aria-hidden="true"></span>
                <span class="status-label">Disconnected</span>
            </div>
            <button type="button" class="connect-btn" disabled title="Visual placeholder — OAuth wiring deferred">
                Connect
            </button>
        </div>

        <span class="requirements-badge">{profile.requirementBadge}</span>

        <div class="preview-mockup platform-preview-{profile.previewVariant}" aria-hidden="true">
            <div class="preview-chrome">
                {#if profile.previewVariant === 'youtube'}
                    <span class="chrome-bar youtube-bar"></span>
                {:else if profile.previewVariant === 'tiktok'}
                    <span class="chrome-side tiktok-side"></span>
                {:else if profile.previewVariant === 'instagram'}
                    <span class="chrome-dots instagram-dots">♥ ○ ↗</span>
                {:else if profile.previewVariant === 'facebook'}
                    <span class="chrome-bar facebook-bar"></span>
                {:else if profile.previewVariant === 'linkedin'}
                    <span class="chrome-label linkedin-label">Professional</span>
                {:else if profile.previewVariant === 'x'}
                    <span class="chrome-label x-label">Post</span>
                {/if}
            </div>
            <div class="preview-frame">
                <span class="preview-placeholder">Your content</span>
            </div>
        </div>

        <div class="publishing-queue">
            <h5 class="queue-title">Publishing queue</h5>
            <ul class="queue-list">
                {#each profile.queuePlaceholders as item}
                    <li class="queue-item">
                        <span class="queue-status">○</span>
                        <span>{item}</span>
                    </li>
                {/each}
            </ul>
            <p class="queue-hint">Pipeline wiring deferred</p>
        </div>
    </article>
{/if}

<style>
    .platform-profile-card {
        background: rgba(0, 0, 0, 0.35);
        border: 1px solid color-mix(in srgb, var(--platform-color) 35%, transparent);
        border-radius: 12px;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        min-width: 0;
    }

    .platform-profile-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .platform-icon {
        font-size: 1.25rem;
    }

    .platform-name {
        margin: 0;
        font-size: 1rem;
        color: var(--platform-color);
    }

    .connection-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.5rem 0.65rem;
        background: rgba(255, 255, 255, 0.04);
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .connection-status {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.65);
    }

    .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
    }

    .status-dot.disconnected {
        background: #f59e0b;
        box-shadow: 0 0 6px rgba(245, 158, 11, 0.5);
    }

    .connect-btn {
        padding: 0.25rem 0.65rem;
        font-size: 0.7rem;
        border-radius: 6px;
        border: 1px solid color-mix(in srgb, var(--platform-color) 55%, transparent);
        background: color-mix(in srgb, var(--platform-color) 18%, transparent);
        color: #fff;
        cursor: not-allowed;
        opacity: 0.85;
    }

    .requirements-badge {
        align-self: flex-start;
        font-size: 0.65rem;
        padding: 0.2rem 0.45rem;
        border-radius: 999px;
        background: color-mix(in srgb, var(--platform-color) 20%, transparent);
        border: 1px solid color-mix(in srgb, var(--platform-color) 45%, transparent);
        color: rgba(255, 255, 255, 0.85);
        letter-spacing: 0.03em;
    }

    .preview-mockup {
        position: relative;
        border-radius: 8px;
        overflow: hidden;
        background: #111;
        border: 1px dashed rgba(255, 255, 255, 0.15);
    }

    .preview-frame {
        aspect-ratio: var(--preview-aspect);
        max-height: 140px;
        margin: 0 auto;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(145deg, #1a1a2e 0%, #0f0f1a 100%);
    }

    .preview-placeholder {
        font-size: 0.65rem;
        color: rgba(255, 255, 255, 0.4);
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }

    .preview-chrome {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 1;
    }

    .chrome-bar {
        display: block;
        height: 4px;
        width: 100%;
    }

    .youtube-bar {
        background: #ff0000;
    }

    .facebook-bar {
        background: #1877f2;
    }

    .chrome-side.tiktok-side {
        position: absolute;
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        width: 4px;
        height: 40%;
        background: rgba(255, 255, 255, 0.25);
        border-radius: 2px;
    }

    .chrome-dots.instagram-dots {
        position: absolute;
        bottom: 6px;
        left: 8px;
        font-size: 0.55rem;
        color: rgba(255, 255, 255, 0.5);
        letter-spacing: 0.2em;
    }

    .chrome-label {
        position: absolute;
        top: 6px;
        left: 8px;
        font-size: 0.55rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        opacity: 0.7;
    }

    .linkedin-label {
        color: #0a66c2;
    }

    .x-label {
        color: rgba(255, 255, 255, 0.55);
    }

    .publishing-queue {
        margin-top: 0.15rem;
    }

    .queue-title {
        margin: 0 0 0.35rem;
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.5);
    }

    .queue-list {
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .queue-item {
        display: flex;
        align-items: flex-start;
        gap: 0.35rem;
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.7);
        padding: 0.25rem 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }

    .queue-item:last-child {
        border-bottom: none;
    }

    .queue-status {
        color: rgba(255, 255, 255, 0.35);
        flex-shrink: 0;
    }

    .queue-hint {
        margin: 0.35rem 0 0;
        font-size: 0.6rem;
        color: rgba(255, 215, 0, 0.65);
        font-style: italic;
    }
</style>
