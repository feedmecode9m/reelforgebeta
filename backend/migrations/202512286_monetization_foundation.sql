-- Monetization Foundation (metadata only — no payment processing)

ALTER TABLE studio_projects
    ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'FREE'
    CHECK (access_mode IN ('FREE', 'EPISODE_LOCK', 'SEASON_PASS', 'VIP', 'SUBSCRIPTION'));

ALTER TABLE studio_series
    ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'FREE'
    CHECK (access_mode IN ('FREE', 'EPISODE_LOCK', 'SEASON_PASS', 'VIP', 'SUBSCRIPTION'));

ALTER TABLE studio_series
    ADD COLUMN IF NOT EXISTS free_episode_count INT NOT NULL DEFAULT 0
    CHECK (free_episode_count >= 0);

ALTER TABLE studio_series
    ADD COLUMN IF NOT EXISTS season_price NUMERIC(10, 2);

ALTER TABLE studio_series
    ADD COLUMN IF NOT EXISTS vip_price NUMERIC(10, 2);

ALTER TABLE studio_seasons
    ADD COLUMN IF NOT EXISTS access_mode TEXT
    CHECK (access_mode IS NULL OR access_mode IN (
        'FREE', 'EPISODE_LOCK', 'SEASON_PASS', 'VIP', 'SUBSCRIPTION'
    ));

ALTER TABLE studio_episodes
    ADD COLUMN IF NOT EXISTS is_free_override BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE studio_episodes
    ADD COLUMN IF NOT EXISTS early_access BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE studio_episodes
    ADD COLUMN IF NOT EXISTS release_date TIMESTAMPTZ;

ALTER TABLE studio_episodes
    ADD COLUMN IF NOT EXISTS unlock_after_episode INT
    CHECK (unlock_after_episode IS NULL OR unlock_after_episode >= 1);
