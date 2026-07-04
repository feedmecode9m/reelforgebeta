-- Watch Intelligence Foundation: event collection + progress (no AI, no recommendations)

CREATE TABLE IF NOT EXISTS watch_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type          TEXT NOT NULL
                        CHECK (event_type IN (
                            'PLAY', 'PAUSE', 'RESUME', 'SEEK',
                            'COMPLETE', 'NEXT_EPISODE', 'EXIT'
                        )),
    episode_id          UUID REFERENCES studio_episodes(id) ON DELETE SET NULL,
    reel_id             UUID REFERENCES reels(id) ON DELETE SET NULL,
    session_id          UUID NOT NULL,
    viewer_id           TEXT NOT NULL,
    started_at          TIMESTAMPTZ,
    ended_at            TIMESTAMPTZ,
    position_seconds    DOUBLE PRECISION NOT NULL DEFAULT 0,
    duration_seconds    DOUBLE PRECISION,
    completion_percent  DOUBLE PRECISION,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_watch_events_session ON watch_events(session_id);
CREATE INDEX IF NOT EXISTS idx_watch_events_reel ON watch_events(reel_id)
    WHERE reel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_watch_events_episode ON watch_events(episode_id)
    WHERE episode_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_watch_events_viewer_created ON watch_events(viewer_id, created_at DESC);

-- Denormalized progress for resume / continue-watching APIs
CREATE TABLE IF NOT EXISTS watch_progress (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    viewer_id           TEXT NOT NULL,
    episode_id          UUID REFERENCES studio_episodes(id) ON DELETE CASCADE,
    reel_id             UUID NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
    session_id          UUID NOT NULL,
    position_seconds    DOUBLE PRECISION NOT NULL DEFAULT 0,
    duration_seconds    DOUBLE PRECISION,
    completion_percent  DOUBLE PRECISION NOT NULL DEFAULT 0,
    last_event_type     TEXT,
    started_at          TIMESTAMPTZ,
    ended_at            TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_progress_viewer_episode
    ON watch_progress(viewer_id, episode_id)
    WHERE episode_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_progress_viewer_reel
    ON watch_progress(viewer_id, reel_id)
    WHERE episode_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_watch_progress_viewer_updated
    ON watch_progress(viewer_id, updated_at DESC);
