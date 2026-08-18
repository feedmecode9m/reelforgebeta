-- HERO-ID-BRIDGE-02: persist catalog episode identity on reels for feed resolution
ALTER TABLE reels ADD COLUMN IF NOT EXISTS episode_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_reels_episode_id
    ON reels(episode_id)
    WHERE episode_id IS NOT NULL;
