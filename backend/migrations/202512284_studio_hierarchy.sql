-- Phase B: Project → Series → Season → Episode hierarchy (additive layer above reels)

CREATE TABLE IF NOT EXISTS studio_projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    slug        TEXT,
    status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'archived')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_studio_projects_status ON studio_projects(status);

CREATE TABLE IF NOT EXISTS studio_series (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES studio_projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'in_production', 'live', 'archived')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_studio_series_project ON studio_series(project_id);

CREATE TABLE IF NOT EXISTS studio_seasons (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    series_id      UUID NOT NULL REFERENCES studio_series(id) ON DELETE CASCADE,
    season_number  INT NOT NULL,
    title          TEXT,
    sort_order     INT NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (series_id, season_number)
);

CREATE INDEX IF NOT EXISTS idx_studio_seasons_series ON studio_seasons(series_id);

CREATE TABLE IF NOT EXISTS studio_episodes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id       UUID NOT NULL REFERENCES studio_seasons(id) ON DELETE CASCADE,
    reel_id         UUID REFERENCES reels(id) ON DELETE SET NULL,
    episode_number  INT NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    publish_status  TEXT NOT NULL DEFAULT 'published'
                    CHECK (publish_status IN ('draft', 'scheduled', 'published', 'archived')),
    scheduled_at    TIMESTAMPTZ,
    published_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (season_id, episode_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_studio_episodes_reel_unique
    ON studio_episodes(reel_id)
    WHERE reel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_studio_episodes_season ON studio_episodes(season_id);
CREATE INDEX IF NOT EXISTS idx_studio_episodes_reel ON studio_episodes(reel_id);

-- Idempotent seed: default catalog project
INSERT INTO studio_projects (id, name, slug, status)
SELECT
    '00000000-0000-4000-8000-000000000001'::uuid,
    'ReelForge Catalog',
    'reelforge-catalog',
    'active'
WHERE NOT EXISTS (
    SELECT 1 FROM studio_projects WHERE slug = 'reelforge-catalog'
);
