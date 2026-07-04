-- Phase 19 — multi-user production pipeline stages

CREATE TABLE IF NOT EXISTS episode_pipeline (
    id                TEXT PRIMARY KEY,
    episode_id        TEXT NOT NULL UNIQUE,
    stage             TEXT NOT NULL CHECK (stage IN (
        'IDEA', 'SCRIPT', 'STORYBOARD', 'PRODUCTION',
        'EDITING', 'REVIEW', 'READY', 'PUBLISHED'
    )),
    assigned_user_id  TEXT,
    approved_by       TEXT,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_episode_pipeline_stage ON episode_pipeline(stage);
CREATE INDEX IF NOT EXISTS idx_episode_pipeline_assigned ON episode_pipeline(assigned_user_id);
