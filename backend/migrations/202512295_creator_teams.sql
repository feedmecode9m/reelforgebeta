-- Phase 17 — collaborative production teams

CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    email        TEXT,
    avatar_url   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    series_id  TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
    id        TEXT PRIMARY KEY,
    team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL CHECK (role IN ('OWNER', 'PRODUCER', 'EDITOR', 'WRITER', 'REVIEWER')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS team_activity (
    id            TEXT PRIMARY KEY,
    team_id       TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
    activity_type TEXT NOT NULL,
    payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teams_series ON teams(series_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_activity_team ON team_activity(team_id, created_at DESC);

INSERT INTO users (id, display_name, email)
VALUES
    ('user-owner-1', 'Alex Rivera', 'alex@reelforge.studio'),
    ('user-producer-1', 'Jordan Kim', 'jordan@reelforge.studio'),
    ('user-editor-1', 'Sam Ortiz', 'sam@reelforge.studio'),
    ('user-writer-1', 'Casey Blake', 'casey@reelforge.studio'),
    ('user-reviewer-1', 'Morgan Lee', 'morgan@reelforge.studio')
ON CONFLICT (id) DO NOTHING;
