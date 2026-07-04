-- Cross-device Studio sync state (series metadata, mappings, schedules, watch progress)

CREATE TABLE IF NOT EXISTS studio_sync_state (
    workspace_id  TEXT PRIMARY KEY DEFAULT 'default',
    payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_studio_sync_updated ON studio_sync_state(updated_at DESC);
