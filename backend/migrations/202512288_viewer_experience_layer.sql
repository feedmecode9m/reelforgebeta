-- Viewer Experience Layer (Phase 1a.3) — core profiles, platform defaults, hierarchy attachments, slots
-- Contract: docs/RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md
-- Depends on: 202512284_studio_hierarchy, 202512285_platform_configuration

-- ---------------------------------------------------------------------------
-- experience_profile_families → RVE experience_profile (identity)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS experience_profile_families (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_families_slug
    ON experience_profile_families(slug)
    WHERE slug IS NOT NULL AND slug <> '';

-- ---------------------------------------------------------------------------
-- experience_profile_versions → RVE experience_profile + labels + visibility + monetization_presentation + watch_features (nullable overrides)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS experience_profile_versions (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_family_id           UUID NOT NULL REFERENCES experience_profile_families(id) ON DELETE RESTRICT,
    version                     INT NOT NULL DEFAULT 1,
    status                      TEXT NOT NULL DEFAULT 'DRAFT'
                                CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
    published_at                TIMESTAMPTZ,
    created_from_profile_id     UUID REFERENCES experience_profile_versions(id) ON DELETE SET NULL,
    changelog                   TEXT,

    content_format              TEXT NOT NULL DEFAULT 'GENERIC'
                                CHECK (content_format IN (
                                    'GENERIC', 'MICRO_DRAMA', 'DOCUMENTARY', 'MUSIC_VIDEO',
                                    'REALITY', 'EDUCATIONAL', 'CREATOR_COURSE', 'CREATOR_CHANNEL',
                                    'LIVESTREAM_REPLAY'
                                )),

    theme_token_set_id          UUID,
    layout_preset_id            UUID,

    project_label               TEXT,
    series_label                TEXT,
    season_label                TEXT,
    episode_label               TEXT,
    vip_label                   TEXT,
    trailer_label               TEXT,
    bonus_content_label         TEXT,

    hero_enabled                BOOLEAN,
    hero_mode                   TEXT CHECK (hero_mode IS NULL OR hero_mode IN (
                                    'OFF', 'STATIC_IMAGE', 'STATIC_VIDEO',
                                    'CAROUSEL_IMAGES', 'CAROUSEL_VIDEOS', 'MIXED')),
    hero_autoplay               BOOLEAN,
    hero_carousel_interval      INT CHECK (hero_carousel_interval IS NULL
                                    OR hero_carousel_interval BETWEEN 3 AND 120),
    hero_overlay_enabled        BOOLEAN,

    continue_watching_enabled   BOOLEAN,
    recommendations_enabled   BOOLEAN,
    artist_panel_enabled        BOOLEAN,
    credits_enabled             BOOLEAN,
    downloads_enabled           BOOLEAN,
    comments_enabled            BOOLEAN,
    cast_panel_enabled          BOOLEAN,
    trivia_enabled              BOOLEAN,
    timeline_enabled            BOOLEAN,

    paywall_style               TEXT,
    access_style                TEXT,
    cta_style                   TEXT,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (profile_family_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_versions_one_active
    ON experience_profile_versions(profile_family_id)
    WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_profile_versions_family_status
    ON experience_profile_versions(profile_family_id, status);

-- ---------------------------------------------------------------------------
-- platform_experience_defaults → RVE platform baseline (labels, visibility.hero, watch_features, monetization_presentation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_experience_defaults (
    id                          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),

    default_theme_token_set_id  UUID,
    default_layout_preset_id    UUID,

    hero_mode                   TEXT NOT NULL DEFAULT 'STATIC_IMAGE'
                                CHECK (hero_mode IN (
                                    'OFF', 'STATIC_IMAGE', 'STATIC_VIDEO',
                                    'CAROUSEL_IMAGES', 'CAROUSEL_VIDEOS', 'MIXED'
                                )),
    hero_enabled                BOOLEAN NOT NULL DEFAULT true,
    hero_autoplay               BOOLEAN NOT NULL DEFAULT false,
    hero_carousel_interval      INT NOT NULL DEFAULT 8
                                CHECK (hero_carousel_interval BETWEEN 3 AND 120),
    hero_overlay_enabled        BOOLEAN NOT NULL DEFAULT false,

    continue_watching_enabled   BOOLEAN NOT NULL DEFAULT false,
    recommendations_enabled     BOOLEAN NOT NULL DEFAULT false,
    artist_panel_enabled        BOOLEAN NOT NULL DEFAULT false,
    credits_enabled             BOOLEAN NOT NULL DEFAULT false,
    downloads_enabled           BOOLEAN NOT NULL DEFAULT false,
    comments_enabled            BOOLEAN NOT NULL DEFAULT false,
    cast_panel_enabled          BOOLEAN NOT NULL DEFAULT false,
    trivia_enabled              BOOLEAN NOT NULL DEFAULT false,
    timeline_enabled            BOOLEAN NOT NULL DEFAULT false,

    premium_cta_style           TEXT NOT NULL DEFAULT 'NONE'
                                CHECK (premium_cta_style IN (
                                    'NONE', 'SUBTLE', 'BANNER', 'MODAL', 'PILL'
                                )),
    paywall_style               TEXT,
    access_style                TEXT,
    cta_style                   TEXT,

    project_label               TEXT NOT NULL DEFAULT 'Project',
    series_label                TEXT NOT NULL DEFAULT 'Series',
    season_label                TEXT NOT NULL DEFAULT 'Season',
    episode_label               TEXT NOT NULL DEFAULT 'Episode',
    vip_label                   TEXT NOT NULL DEFAULT 'VIP',
    trailer_label               TEXT NOT NULL DEFAULT 'Trailer',
    bonus_content_label         TEXT NOT NULL DEFAULT 'Bonus',

    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_experience_defaults (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- experience_slot_assignments → RVE slots[] (campaign engine metadata)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS experience_slot_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_key        TEXT NOT NULL,
    campaign_id     UUID REFERENCES platform_campaigns(id) ON DELETE SET NULL,
    scope_type      TEXT NOT NULL
                    CHECK (scope_type IN ('platform', 'project', 'series', 'season', 'episode')),
    scope_id        UUID,
    status          TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled', 'active', 'ended')),
    content_ref     JSONB NOT NULL DEFAULT '{}'::jsonb,
    zone_hint       TEXT,
    start_at        TIMESTAMPTZ,
    end_at          TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slot_assignments_scope
    ON experience_slot_assignments(scope_type, scope_id);

CREATE INDEX IF NOT EXISTS idx_slot_assignments_campaign
    ON experience_slot_assignments(campaign_id)
    WHERE campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_slot_assignments_active
    ON experience_slot_assignments(status, start_at, end_at)
    WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- Hierarchy attachments → resolve_context + experience_profile selection
-- ---------------------------------------------------------------------------
ALTER TABLE studio_projects
    ADD COLUMN IF NOT EXISTS experience_profile_family_id UUID
        REFERENCES experience_profile_families(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS experience_profile_pin_version BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS experience_profile_version_id UUID
        REFERENCES experience_profile_versions(id) ON DELETE SET NULL;

ALTER TABLE studio_series
    ADD COLUMN IF NOT EXISTS experience_profile_family_id UUID
        REFERENCES experience_profile_families(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS experience_profile_pin_version BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS experience_profile_version_id UUID
        REFERENCES experience_profile_versions(id) ON DELETE SET NULL;

ALTER TABLE studio_seasons
    ADD COLUMN IF NOT EXISTS experience_profile_family_id UUID
        REFERENCES experience_profile_families(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS experience_profile_pin_version BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS experience_profile_version_id UUID
        REFERENCES experience_profile_versions(id) ON DELETE SET NULL;

ALTER TABLE studio_episodes
    ADD COLUMN IF NOT EXISTS experience_profile_family_id UUID
        REFERENCES experience_profile_families(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS experience_profile_pin_version BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS experience_profile_version_id UUID
        REFERENCES experience_profile_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_studio_projects_experience_family
    ON studio_projects(experience_profile_family_id)
    WHERE experience_profile_family_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_studio_series_experience_family
    ON studio_series(experience_profile_family_id)
    WHERE experience_profile_family_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_studio_seasons_experience_family
    ON studio_seasons(experience_profile_family_id)
    WHERE experience_profile_family_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_studio_episodes_experience_family
    ON studio_episodes(experience_profile_family_id)
    WHERE experience_profile_family_id IS NOT NULL;

-- Studio admin preference (runtime still gated by REELFORGE_EXPERIENCE_PROFILES env)
ALTER TABLE platform_feature_flags
    ADD COLUMN IF NOT EXISTS experience_profiles BOOLEAN NOT NULL DEFAULT false;
