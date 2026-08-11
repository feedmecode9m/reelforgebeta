-- Vic G creator series package: structural catalog bindings for production reel IDs.
-- Display titles remain client/canonical reel title authority (reel_titles_persistent), not this package.
-- Safe to re-apply (ON CONFLICT). Does not invent marketing episode titles.

INSERT INTO series (id, title, description, tags, updated_at)
VALUES (
    'series-vic-g',
    'Vic G',
    '',
    '["creator-package","creator-confirmed"]'::jsonb,
    now()
)
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    tags = EXCLUDED.tags,
    updated_at = now();

INSERT INTO seasons (id, series_id, season_number, title, updated_at)
VALUES (
    'season-vic-g-1',
    'series-vic-g',
    1,
    'Season 1',
    now()
)
ON CONFLICT (id) DO UPDATE SET
    series_id = EXCLUDED.series_id,
    season_number = EXCLUDED.season_number,
    title = EXCLUDED.title,
    updated_at = now();

-- Detach these reels from any other episode before exclusive bind
UPDATE episodes
SET reel_id = NULL, updated_at = now()
WHERE reel_id IN (
    '03ef898a-989f-42c3-bdbb-67f37338df65',
    'd2aafde7-d7ba-492c-a860-20b51f7f4033',
    '3894107e-ae44-43c5-af72-b3f5d5e0ad90'
)
  AND id NOT IN ('ep-vic-g-s01e01', 'ep-vic-g-s01e02', 'ep-vic-g-s01e03');

INSERT INTO episodes (
    id, season_id, episode_number, title, description, status, reel_id, tags, updated_at
) VALUES
    (
        'ep-vic-g-s01e01',
        'season-vic-g-1',
        1,
        '',
        '',
        'published',
        '03ef898a-989f-42c3-bdbb-67f37338df65',
        '["creator-package"]'::jsonb,
        now()
    ),
    (
        'ep-vic-g-s01e02',
        'season-vic-g-1',
        2,
        '',
        '',
        'published',
        'd2aafde7-d7ba-492c-a860-20b51f7f4033',
        '["creator-package"]'::jsonb,
        now()
    ),
    (
        'ep-vic-g-s01e03',
        'season-vic-g-1',
        3,
        '',
        '',
        'published',
        '3894107e-ae44-43c5-af72-b3f5d5e0ad90',
        '["creator-package"]'::jsonb,
        now()
    )
ON CONFLICT (id) DO UPDATE SET
    season_id = EXCLUDED.season_id,
    episode_number = EXCLUDED.episode_number,
    title = EXCLUDED.title,
    status = EXCLUDED.status,
    reel_id = EXCLUDED.reel_id,
    tags = EXCLUDED.tags,
    updated_at = now();
