-- Phase 53 — revenue backend foundation

CREATE TABLE IF NOT EXISTS revenue_profiles (
    id              TEXT PRIMARY KEY,
    profile_type    TEXT NOT NULL,
    profile_ref_id  TEXT NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'USD',
    config          JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (profile_type, profile_ref_id)
);

CREATE INDEX IF NOT EXISTS idx_revenue_profiles_type_ref
    ON revenue_profiles(profile_type, profile_ref_id);

CREATE TABLE IF NOT EXISTS revenue_forecasts (
    id              TEXT PRIMARY KEY,
    profile_id      TEXT NOT NULL REFERENCES revenue_profiles(id) ON DELETE CASCADE,
    horizon_days    INTEGER NOT NULL CHECK (horizon_days > 0),
    gross_cents     BIGINT NOT NULL DEFAULT 0,
    net_cents       BIGINT NOT NULL DEFAULT 0,
    growth_rate     DOUBLE PRECISION NOT NULL DEFAULT 0.08,
    snapshot        JSONB NOT NULL DEFAULT '{}'::jsonb,
    forecasted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_revenue_forecasts_profile
    ON revenue_forecasts(profile_id, forecasted_at DESC);

CREATE TABLE IF NOT EXISTS creator_revenue (
    id                  TEXT PRIMARY KEY,
    creator_id          TEXT NOT NULL,
    profile_id          TEXT REFERENCES revenue_profiles(id) ON DELETE SET NULL,
    period_start        DATE,
    period_end          DATE,
    gross_cents         BIGINT NOT NULL DEFAULT 0,
    net_cents           BIGINT NOT NULL DEFAULT 0,
    platform_fee_cents  BIGINT NOT NULL DEFAULT 0,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creator_revenue_creator
    ON creator_revenue(creator_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS team_revenue (
    id                  TEXT PRIMARY KEY,
    team_id             TEXT NOT NULL,
    profile_id          TEXT REFERENCES revenue_profiles(id) ON DELETE SET NULL,
    period_start        DATE,
    period_end          DATE,
    gross_cents         BIGINT NOT NULL DEFAULT 0,
    net_cents           BIGINT NOT NULL DEFAULT 0,
    platform_fee_cents  BIGINT NOT NULL DEFAULT 0,
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_revenue_team
    ON team_revenue(team_id, recorded_at DESC);
