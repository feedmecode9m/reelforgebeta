-- VIEWER-1: consumer account personalization foundation
-- Authenticated viewers: profile, playback history, watchlist (no content mutation).

-- Profile fields on users (no public profiles)
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS display_name TEXT,
    ADD COLUMN IF NOT EXISTS avatar_placeholder TEXT,
    ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN users.display_name IS 'VIEWER-1 private display name (not a public profile).';
COMMENT ON COLUMN users.avatar_placeholder IS 'VIEWER-1 avatar initial/code placeholder.';
COMMENT ON COLUMN users.settings IS 'VIEWER-1 account preferences JSON.';

-- Playback history (account-scoped; distinct from anonymous watch_progress)
CREATE TABLE IF NOT EXISTS viewer_playback_history (
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reel_id             UUID NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
    position_seconds    DOUBLE PRECISION NOT NULL DEFAULT 0,
    duration_seconds    DOUBLE PRECISION,
    completed           BOOLEAN NOT NULL DEFAULT false,
    last_watched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, reel_id)
);

CREATE INDEX IF NOT EXISTS idx_viewer_history_user_watched
    ON viewer_playback_history (user_id, last_watched_at DESC);

CREATE INDEX IF NOT EXISTS idx_viewer_history_user_active
    ON viewer_playback_history (user_id, last_watched_at DESC)
    WHERE completed = false;

-- My List / favorites (viewer personalization only)
CREATE TABLE IF NOT EXISTS viewer_watchlist (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reel_id     UUID NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, reel_id)
);

CREATE INDEX IF NOT EXISTS idx_viewer_watchlist_user_created
    ON viewer_watchlist (user_id, created_at DESC);

COMMENT ON TABLE viewer_playback_history IS 'VIEWER-1 continue-watching / resume foundation.';
COMMENT ON TABLE viewer_watchlist IS 'VIEWER-1 My List foundation (no content powers).';
