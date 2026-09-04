-- Public catalog monetization — mirrors studio_series access rules for viewer API + Stripe checkout.

ALTER TABLE series
    ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'FREE'
    CHECK (access_mode IN ('FREE', 'EPISODE_LOCK', 'SEASON_PASS', 'VIP', 'SUBSCRIPTION'));

ALTER TABLE series
    ADD COLUMN IF NOT EXISTS free_episode_count INT NOT NULL DEFAULT 2
    CHECK (free_episode_count >= 0);

-- Vic G: first two episodes free (The Project, Arrival in LA); remainder subscription-gated.
UPDATE series
SET access_mode = 'SUBSCRIPTION',
    free_episode_count = 2,
    updated_at = now()
WHERE id = 'series-vic-g';
