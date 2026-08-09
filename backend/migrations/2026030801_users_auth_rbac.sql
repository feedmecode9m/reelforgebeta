-- AUTH-1: identity + RBAC foundation
-- Roles: viewer | creator | admin (default registration = viewer)
--
-- Local DBs may already have a Phase 17 creator-teams `users` table (TEXT ids,
-- no password_hash). That collides with AUTH-1 UUID accounts. Relocate the
-- legacy directory first so health/auth migrations can complete.

DO $$
BEGIN
    -- Only rename when the existing table is the teams directory (TEXT PK, no auth columns).
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
    )
    AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'id'
          AND data_type = 'text'
    )
    AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'password_hash'
    )
    AND NOT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'team_users'
    )
    THEN
        ALTER TABLE users RENAME TO team_users;

        IF EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'team_members_user_id_fkey'
        ) THEN
            ALTER TABLE team_members DROP CONSTRAINT team_members_user_id_fkey;
        END IF;
        IF EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'team_activity_user_id_fkey'
        ) THEN
            ALTER TABLE team_activity DROP CONSTRAINT team_activity_user_id_fkey;
        END IF;

        ALTER TABLE team_members
            ADD CONSTRAINT team_members_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES team_users(id) ON DELETE CASCADE;
        ALTER TABLE team_activity
            ADD CONSTRAINT team_activity_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES team_users(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer'
        CHECK (role IN ('viewer', 'creator', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx
    ON users (lower(email));

CREATE TABLE IF NOT EXISTS user_sessions (
    token TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx ON user_sessions (expires_at);

COMMENT ON TABLE users IS 'AUTH-1 user accounts (password_hash is bcrypt; never expose).';
COMMENT ON TABLE user_sessions IS 'AUTH-1 opaque bearer sessions for browser restore.';
