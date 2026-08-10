-- Phase 0.5 / Phase 1: additive playback derivative metadata (nullable).
-- Does not change video_url or ready semantics.

ALTER TABLE reels ADD COLUMN IF NOT EXISTS playback_url TEXT;
ALTER TABLE reels ADD COLUMN IF NOT EXISTS playback_status TEXT;
ALTER TABLE reels ADD COLUMN IF NOT EXISTS playback_file_size BIGINT;
ALTER TABLE reels ADD COLUMN IF NOT EXISTS playback_profile TEXT;
ALTER TABLE reels ADD COLUMN IF NOT EXISTS playback_file_name TEXT;

COMMENT ON COLUMN reels.playback_url IS 'Optional web mezzanine path/URL; master remains video_url';
COMMENT ON COLUMN reels.playback_status IS 'pending|processing|ready|failed|skipped — independent of reels.status';
COMMENT ON COLUMN reels.playback_profile IS 'e.g. web_720p_h264';
