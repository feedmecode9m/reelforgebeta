-- Phase 13 — extend episodes with flat metadata fields for Series Metadata API

ALTER TABLE episodes
    ADD COLUMN IF NOT EXISTS series_id TEXT REFERENCES series(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS season_number INT,
    ADD COLUMN IF NOT EXISTS runtime_seconds INT,
    ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
    ADD COLUMN IF NOT EXISTS release_date DATE;

UPDATE episodes e
SET
    series_id = s.series_id,
    season_number = s.season_number,
    runtime_seconds = COALESCE(e.runtime_seconds, e.runtime)
FROM seasons s
WHERE e.season_id = s.id
  AND (e.series_id IS NULL OR e.season_number IS NULL OR e.runtime_seconds IS NULL);

CREATE INDEX IF NOT EXISTS idx_episodes_series ON episodes(series_id);
CREATE INDEX IF NOT EXISTS idx_episodes_series_season ON episodes(series_id, season_number);
