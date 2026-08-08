-- Public admin hero presentation (site-wide). localStorage is cache only.

ALTER TABLE platform_hero_config
    ADD COLUMN IF NOT EXISTS hero_asset_id TEXT,
    ADD COLUMN IF NOT EXISTS background_source TEXT DEFAULT 'selection',
    ADD COLUMN IF NOT EXISTS background_style TEXT DEFAULT 'video',
    ADD COLUMN IF NOT EXISTS media_url TEXT,
    ADD COLUMN IF NOT EXISTS poster_url TEXT,
    ADD COLUMN IF NOT EXISTS hero_label TEXT,
    ADD COLUMN IF NOT EXISTS hero_title TEXT,
    ADD COLUMN IF NOT EXISTS hero_subtitle TEXT,
    ADD COLUMN IF NOT EXISTS hero_description TEXT,
    ADD COLUMN IF NOT EXISTS presentation JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN platform_hero_config.hero_asset_id IS
    'Canonical vault/reel asset uuid selected as public hero background';
COMMENT ON COLUMN platform_hero_config.presentation IS
    'Full public presentation payload (story context, intel, CTAs) JSON';
