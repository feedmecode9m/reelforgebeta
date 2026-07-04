-- Platform Configuration Layer (additive singletons + campaigns)

CREATE TABLE IF NOT EXISTS platform_site_config (
    id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    site_name           TEXT NOT NULL DEFAULT 'ReelForge',
    site_tagline        TEXT NOT NULL DEFAULT '',
    site_description    TEXT NOT NULL DEFAULT '',
    logo_url            TEXT,
    favicon_url         TEXT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_hero_config (
    id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    hero_enabled        BOOLEAN NOT NULL DEFAULT true,
    hero_mode           TEXT NOT NULL DEFAULT 'STATIC'
                        CHECK (hero_mode IN (
                            'OFF', 'STATIC', 'CAROUSEL',
                            'FEATURED_SERIES', 'LATEST_RELEASE', 'PROMOTED'
                        )),
    rotation_seconds    INT NOT NULL DEFAULT 8 CHECK (rotation_seconds >= 3 AND rotation_seconds <= 120),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_feature_flags (
    id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    studio_hierarchy    BOOLEAN NOT NULL DEFAULT false,
    hero_management     BOOLEAN NOT NULL DEFAULT false,
    monetization        BOOLEAN NOT NULL DEFAULT false,
    watch_tracking      BOOLEAN NOT NULL DEFAULT false,
    analytics           BOOLEAN NOT NULL DEFAULT false,
    intel               BOOLEAN NOT NULL DEFAULT false,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_campaigns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_name   TEXT NOT NULL,
    campaign_type   TEXT NOT NULL
                    CHECK (campaign_type IN ('CONTEST', 'PREMIERE', 'PROMOTION', 'SPONSOR')),
    start_date      TIMESTAMPTZ,
    end_date        TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'scheduled', 'active', 'ended', 'archived')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_campaigns_status ON platform_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_platform_campaigns_dates ON platform_campaigns(start_date, end_date);

-- Seed defaults (idempotent)
INSERT INTO platform_site_config (id, site_name, site_tagline, site_description)
VALUES (1, 'ReelForge', 'Premium Access', 'AI-powered short-form production platform')
ON CONFLICT (id) DO NOTHING;

INSERT INTO platform_hero_config (id, hero_enabled, hero_mode, rotation_seconds)
VALUES (1, true, 'STATIC', 8)
ON CONFLICT (id) DO NOTHING;

INSERT INTO platform_feature_flags (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
