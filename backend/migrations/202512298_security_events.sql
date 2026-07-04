-- Phase 49 — security backend foundation

CREATE TABLE IF NOT EXISTS security_events (
    id              TEXT PRIMARY KEY,
    source          TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    category        TEXT,
    severity        TEXT,
    title           TEXT,
    message         TEXT,
    series_id       TEXT,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    event_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_timestamp ON security_events(event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_source ON security_events(source);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type);
