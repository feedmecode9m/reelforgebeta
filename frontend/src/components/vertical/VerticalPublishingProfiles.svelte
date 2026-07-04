<script>
    /** Placeholder publishing profiles — vertical-first, coming soon. */
</script>

<div class="vertical-publishing-section">
    <div class="smart-header">
        <div class="ai-badge">📱 VERTICAL PUBLISHING</div>
        <h3>Episode Distribution Profiles</h3>
        <p class="smart-subtitle">Visual placeholders — pipeline wiring deferred</p>
    </div>
    <div class="publishing-profile-grid">
        <div class="publishing-profile-card tiktok">
            <div class="profile-preview-mock" aria-hidden="true">
                <div class="mock-drop-zone">
                    <span class="mock-icon">📲</span>
                    <span class="mock-label">Drop episode here</span>
                </div>
            </div>
            <h4>TikTok-style</h4>
            <p>Short-form pipeline</p>
            <span class="coming-soon-pill">Coming soon</span>
        </div>
        <div class="publishing-profile-card reelshort">
            <div class="profile-preview-mock" aria-hidden="true">
                <div class="mock-drop-zone animated">
                    <span class="mock-icon">🎬</span>
                    <span class="mock-label">Drop episode here</span>
                </div>
            </div>
            <h4>ReelShort-style</h4>
            <p>Episode chaining</p>
            <span class="coming-soon-pill">Coming soon</span>
        </div>
    </div>
</div>

<style>
    .vertical-publishing-section {
        margin-top: 2rem;
        padding-top: 2rem;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    }
    .publishing-profile-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 1rem;
        margin-top: 1rem;
    }
    .publishing-profile-card {
        background: rgba(0, 0, 0, 0.35);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        padding: 1rem;
        text-align: center;
    }
    .publishing-profile-card.tiktok {
        border-color: rgba(0, 242, 255, 0.35);
    }
    .publishing-profile-card.reelshort {
        border-color: rgba(255, 0, 255, 0.35);
    }
    .profile-preview-mock {
        aspect-ratio: 9 / 16;
        max-width: 120px;
        margin: 0 auto 0.75rem;
        border-radius: 8px;
        overflow: hidden;
        background: linear-gradient(180deg, #1a1a2e, #0f3460);
        border: 1px dashed rgba(255, 255, 255, 0.25);
    }
    .mock-drop-zone {
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.35rem;
        font-size: 0.65rem;
        color: rgba(255, 255, 255, 0.55);
    }
    .mock-drop-zone.animated {
        animation: mockPulse 2s ease-in-out infinite;
    }
    @keyframes mockPulse {
        0%,
        100% {
            opacity: 0.85;
        }
        50% {
            opacity: 1;
            box-shadow: inset 0 0 20px rgba(255, 0, 255, 0.25);
        }
    }
    .mock-icon {
        font-size: 1.5rem;
    }
    .publishing-profile-card h4 {
        margin: 0 0 0.25rem;
        font-size: 0.95rem;
    }
    .publishing-profile-card p {
        margin: 0 0 0.5rem;
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.55);
    }
    .coming-soon-pill {
        display: inline-block;
        padding: 0.2rem 0.5rem;
        border-radius: 999px;
        font-size: 0.65rem;
        background: rgba(255, 215, 0, 0.15);
        border: 1px solid rgba(255, 215, 0, 0.45);
        color: var(--neon-gold, #ffd700);
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }
</style>
