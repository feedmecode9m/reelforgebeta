-- Track whether on-disk video passed ffprobe validation before API exposure.
ALTER TABLE reels ADD COLUMN IF NOT EXISTS validated BOOLEAN NOT NULL DEFAULT false;

-- Existing ready video reels: mark validated only when file_name is set (backfill verifies on startup).
UPDATE reels
SET validated = false
WHERE status = 'ready' AND video_url LIKE '/videos/%';

CREATE INDEX IF NOT EXISTS idx_reels_ready_validated ON reels(status, validated)
WHERE status = 'ready';
