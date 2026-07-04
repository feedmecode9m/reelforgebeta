-- Series metadata API — frontend catalog persistence (series / seasons / episodes)

CREATE TABLE IF NOT EXISTS series (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    description   TEXT,
    genre         TEXT,
    release_year  INT,
    poster        TEXT,
    tags          JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_series_updated ON series(updated_at DESC);

CREATE TABLE IF NOT EXISTS seasons (
    id             TEXT PRIMARY KEY,
    series_id      TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    season_number  INT NOT NULL,
    title          TEXT,
    description    TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (series_id, season_number)
);

CREATE INDEX IF NOT EXISTS idx_seasons_series ON seasons(series_id);

CREATE TABLE IF NOT EXISTS episodes (
    id              TEXT PRIMARY KEY,
    season_id       TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    episode_number  INT NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    runtime         INT,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'ready', 'published', 'archived')),
    reel_id         TEXT,
    genre           TEXT,
    tags            JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (season_id, episode_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_episodes_reel_unique
    ON episodes(reel_id)
    WHERE reel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_episodes_season ON episodes(season_id);
CREATE INDEX IF NOT EXISTS idx_episodes_reel ON episodes(reel_id) WHERE reel_id IS NOT NULL;
