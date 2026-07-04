-- Phase 16 — centralized analytics event collection

CREATE TABLE IF NOT EXISTS analytics_events (
    id          TEXT PRIMARY KEY,
    event_type  TEXT NOT NULL,
    user_id     TEXT,
    series_id   TEXT,
    episode_id  TEXT,
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_series ON analytics_events(series_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_episode ON analytics_events(episode_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_day ON analytics_events(user_id, created_at);
