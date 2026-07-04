-- Viewer Experience extensions (Phase 1a.3) — themes, layout blueprints, metadata registry
-- Contract: docs/RESOLVED_VIEWER_EXPERIENCE_CONTRACT.md
-- Depends on: 202512288_viewer_experience_layer

-- ---------------------------------------------------------------------------
-- theme_token_sets + theme_tokens → RVE theme
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS theme_token_sets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS theme_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_set_id    UUID NOT NULL REFERENCES theme_token_sets(id) ON DELETE CASCADE,
    token_key       TEXT NOT NULL CHECK (token_key IN (
                        'hero_surface', 'panel_surface', 'accent_surface',
                        'typography_style', 'button_style', 'card_style', 'overlay_style'
                    )),
    token_value     JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (token_set_id, token_key)
);

-- ---------------------------------------------------------------------------
-- viewer_layout_presets → RVE layout (Blueprint System)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS viewer_layout_presets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    preset_key  TEXT NOT NULL UNIQUE CHECK (preset_key IN (
                    'MINIMAL', 'NETFLIX', 'REELSHORT', 'DOCUMENTARY',
                    'ARTIST_ACCESS', 'EDUCATIONAL', 'CUSTOM'
                )),
    name        TEXT NOT NULL,
    description TEXT,
    definition  JSONB NOT NULL DEFAULT '{}'::jsonb,
    status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- metadata_definitions + metadata_values → RVE metadata
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS metadata_definitions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_key       TEXT NOT NULL UNIQUE,
    label           TEXT NOT NULL,
    description     TEXT,
    data_type       TEXT NOT NULL CHECK (data_type IN (
                        'TEXT', 'URL', 'DATE', 'NUMBER', 'BOOLEAN', 'JSON'
                    )),
    validation      JSONB NOT NULL DEFAULT '{}'::jsonb,
    scope_levels    TEXT[] NOT NULL DEFAULT '{project,series,season,episode}',
    status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT metadata_definitions_field_key_reserved CHECK (
        field_key !~ '^(rf\\.|system\\.|internal\\.|ai\\.|ads\\.|recommendation\\.)'
        AND field_key ~ '^[a-z][a-z0-9_]*$'
    )
);

CREATE TABLE IF NOT EXISTS metadata_values (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    definition_id   UUID NOT NULL REFERENCES metadata_definitions(id) ON DELETE RESTRICT,
    scope_type      TEXT NOT NULL CHECK (scope_type IN ('project', 'series', 'season', 'episode')),
    scope_id        UUID NOT NULL,
    value_jsonb     JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (definition_id, scope_type, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_metadata_values_scope
    ON metadata_values(scope_type, scope_id);

CREATE INDEX IF NOT EXISTS idx_metadata_values_gin
    ON metadata_values USING GIN (value_jsonb);

-- ---------------------------------------------------------------------------
-- Foreign keys deferred from 288
-- ---------------------------------------------------------------------------
ALTER TABLE experience_profile_versions
    ADD CONSTRAINT fk_profile_versions_theme_set
        FOREIGN KEY (theme_token_set_id) REFERENCES theme_token_sets(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_profile_versions_layout_preset
        FOREIGN KEY (layout_preset_id) REFERENCES viewer_layout_presets(id) ON DELETE SET NULL;

ALTER TABLE platform_experience_defaults
    ADD CONSTRAINT fk_platform_defaults_theme_set
        FOREIGN KEY (default_theme_token_set_id) REFERENCES theme_token_sets(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_platform_defaults_layout_preset
        FOREIGN KEY (default_layout_preset_id) REFERENCES viewer_layout_presets(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Seed: theme token sets
-- ---------------------------------------------------------------------------
INSERT INTO theme_token_sets (id, name, slug, status)
VALUES
    ('10000000-0000-4000-8000-000000000001', 'Default ReelForge', 'default-reelforge', 'ACTIVE'),
    ('10000000-0000-4000-8000-000000000002', 'Documentary', 'documentary', 'ACTIVE'),
    ('10000000-0000-4000-8000-000000000003', 'Artist Access', 'artist-access', 'ACTIVE'),
    ('10000000-0000-4000-8000-000000000004', 'Micro Drama', 'micro-drama', 'ACTIVE'),
    ('10000000-0000-4000-8000-000000000005', 'Educational', 'educational', 'ACTIVE')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO theme_tokens (token_set_id, token_key, token_value)
SELECT s.id, 'hero_surface', '{"variant":"default"}'::jsonb
FROM theme_token_sets s WHERE s.slug = 'default-reelforge'
ON CONFLICT (token_set_id, token_key) DO NOTHING;

INSERT INTO theme_tokens (token_set_id, token_key, token_value)
SELECT s.id, 'panel_surface', '{"variant":"dark"}'::jsonb
FROM theme_token_sets s WHERE s.slug = 'documentary'
ON CONFLICT (token_set_id, token_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed: layout presets (Blueprint System)
-- ---------------------------------------------------------------------------
INSERT INTO viewer_layout_presets (id, preset_key, name, description, definition, status)
VALUES
    (
        '20000000-0000-4000-8000-000000000001',
        'MINIMAL',
        'Minimal',
        'Hero + categories only',
        '{"panels":{"hero":{"visible":true,"zone":"top"},"categories":{"visible":true,"zone":"main_shelf"}},"shelf_order":["categories"]}'::jsonb,
        'ACTIVE'
    ),
    (
        '20000000-0000-4000-8000-000000000002',
        'NETFLIX',
        'Netflix',
        'Hero, continue watching, recommendations',
        '{"panels":{"hero":{"visible":true,"zone":"top"},"continue_watching":{"visible":true,"zone":"below_hero"},"recommendations":{"visible":true,"zone":"main_shelf"},"categories":{"visible":true,"zone":"main_shelf"}},"shelf_order":["continue_watching","recommendations","categories"],"cta":{"zone":"hero_overlay"}}'::jsonb,
        'ACTIVE'
    ),
    (
        '20000000-0000-4000-8000-000000000003',
        'REELSHORT',
        'ReelShort',
        'Vertical micro-drama layout',
        '{"panels":{"hero":{"visible":true,"zone":"top"},"continue_watching":{"visible":true,"zone":"below_hero"},"recommendations":{"visible":true,"zone":"main_shelf"},"timeline":{"visible":true,"zone":"theater_bottom"}},"shelf_order":["continue_watching","recommendations"],"cta":{"zone":"hero_overlay"}}'::jsonb,
        'ACTIVE'
    ),
    (
        '20000000-0000-4000-8000-000000000004',
        'DOCUMENTARY',
        'Documentary',
        'Cinematic documentary shelves',
        '{"panels":{"hero":{"visible":true,"zone":"top"},"continue_watching":{"visible":true,"zone":"below_hero"},"categories":{"visible":true,"zone":"main_shelf"},"credits":{"visible":true,"zone":"theater_end"},"cast_panel":{"visible":true,"zone":"theater_sidebar"}},"shelf_order":["continue_watching","categories"],"cta":{"zone":"hero_overlay"}}'::jsonb,
        'ACTIVE'
    ),
    (
        '20000000-0000-4000-8000-000000000005',
        'ARTIST_ACCESS',
        'Artist Access',
        'Music video / artist sidebar',
        '{"panels":{"hero":{"visible":true,"zone":"top"},"artist_panel":{"visible":true,"zone":"theater_sidebar"},"recommendations":{"visible":true,"zone":"main_shelf"},"downloads":{"visible":true,"zone":"theater_sidebar"}},"shelf_order":["recommendations"],"cta":{"zone":"hero_overlay"}}'::jsonb,
        'ACTIVE'
    ),
    (
        '20000000-0000-4000-8000-000000000006',
        'EDUCATIONAL',
        'Educational',
        'Course-style layout',
        '{"panels":{"hero":{"visible":true,"zone":"top"},"continue_watching":{"visible":true,"zone":"below_hero"},"categories":{"visible":true,"zone":"main_shelf"}},"shelf_order":["continue_watching","categories"]}'::jsonb,
        'ACTIVE'
    ),
    (
        '20000000-0000-4000-8000-000000000007',
        'CUSTOM',
        'Custom',
        'Admin-editable experimental layout',
        '{"panels":{},"shelf_order":[]}'::jsonb,
        'ACTIVE'
    )
ON CONFLICT (preset_key) DO NOTHING;

-- Platform defaults: NETFLIX layout + default-reelforge theme
UPDATE platform_experience_defaults
SET
    default_layout_preset_id = (
        SELECT id FROM viewer_layout_presets WHERE preset_key = 'NETFLIX' LIMIT 1
    ),
    default_theme_token_set_id = (
        SELECT id FROM theme_token_sets WHERE slug = 'default-reelforge' LIMIT 1
    )
WHERE id = 1;

-- Sync hero baseline from platform_hero_config (v1 → v2 contract enum mapping)
UPDATE platform_experience_defaults d
SET
    hero_enabled = h.hero_enabled,
    hero_carousel_interval = h.rotation_seconds,
    hero_mode = CASE h.hero_mode
        WHEN 'OFF' THEN 'OFF'
        WHEN 'STATIC' THEN 'STATIC_IMAGE'
        WHEN 'CAROUSEL' THEN 'CAROUSEL_IMAGES'
        WHEN 'FEATURED_SERIES' THEN 'MIXED'
        WHEN 'LATEST_RELEASE' THEN 'MIXED'
        WHEN 'PROMOTED' THEN 'MIXED'
        ELSE 'STATIC_IMAGE'
    END,
    updated_at = now()
FROM platform_hero_config h
WHERE d.id = 1 AND h.id = 1;

-- ---------------------------------------------------------------------------
-- Seed: metadata definitions (Label Registry — custom fields)
-- ---------------------------------------------------------------------------
INSERT INTO metadata_definitions (field_key, label, data_type, scope_levels, sort_order)
VALUES
    ('artist_name', 'Artist Name', 'TEXT', '{project,series,season,episode}', 10),
    ('sponsor_name', 'Sponsor Name', 'TEXT', '{project,series,season,episode}', 20),
    ('merch_url', 'Merch URL', 'URL', '{project,series,season,episode}', 30),
    ('tour_date', 'Tour Date', 'DATE', '{project,series,season,episode}', 40),
    ('vip_link', 'VIP Link', 'URL', '{project,series,season,episode}', 50),
    ('bonus_content_url', 'Bonus Content URL', 'URL', '{episode}', 60),
    ('download_package_url', 'Download Package URL', 'URL', '{episode}', 70)
ON CONFLICT (field_key) DO NOTHING;
