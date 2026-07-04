-- Phase 15 — PostgreSQL workflow task persistence

CREATE TABLE IF NOT EXISTS workflow_tasks (
    id            TEXT PRIMARY KEY,
    series_id     TEXT NOT NULL,
    episode_id    TEXT,
    task_type     TEXT NOT NULL,
    priority      INT NOT NULL DEFAULT 4,
    status        TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETE')),
    assigned_to   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at  TIMESTAMPTZ,
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_workflow_tasks_series ON workflow_tasks(series_id);
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_status ON workflow_tasks(status);
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_priority ON workflow_tasks(priority);
