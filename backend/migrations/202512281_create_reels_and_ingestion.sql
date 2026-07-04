-- Reels source of truth + async ingestion jobs
CREATE TABLE IF NOT EXISTS reels (
    id              UUID PRIMARY KEY,
    title           TEXT NOT NULL DEFAULT '',
    category        TEXT NOT NULL DEFAULT 'Trending',
    description     TEXT,
    video_url       TEXT,
    thumbnail_url   TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','ready','failed')),
    error_message   TEXT,
    file_name       TEXT NOT NULL DEFAULT '',
    file_size       BIGINT,
    mime_type       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upgrade legacy reels table (missing ingestion columns)
ALTER TABLE reels ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE reels ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE reels ADD COLUMN IF NOT EXISTS file_name TEXT NOT NULL DEFAULT '';
ALTER TABLE reels ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE reels ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE reels ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill status for rows created before ingestion pipeline
UPDATE reels SET status = 'ready' WHERE status IS NULL OR status = '';
UPDATE reels SET file_name = COALESCE(
    NULLIF(split_part(video_url, '/', array_length(string_to_array(video_url, '/'), 1)), ''),
    id::text
) WHERE file_name IS NULL OR file_name = '';

CREATE INDEX IF NOT EXISTS idx_reels_status ON reels(status);
CREATE INDEX IF NOT EXISTS idx_reels_created_at ON reels(created_at DESC);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reel_id         UUID NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','claimed','completed','failed')),
    attempts        INT NOT NULL DEFAULT 0,
    max_attempts    INT NOT NULL DEFAULT 3,
    claimed_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON ingestion_jobs(status, created_at);
