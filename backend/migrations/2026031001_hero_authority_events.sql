-- Hero Authority Event log — append-only publish truth boundary.
-- Frontend requests publication; backend grants (signs) publication.

CREATE TABLE IF NOT EXISTS hero_authority_events (
    id                  TEXT PRIMARY KEY,
    hero_id             TEXT NOT NULL,
    action              TEXT NOT NULL,
    previous_status     TEXT NOT NULL,
    new_status          TEXT NOT NULL,
    actor_id            TEXT NOT NULL,
    actor_role          TEXT NOT NULL,
    source_type         TEXT NOT NULL,
    changed_fields      JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    client_hash         TEXT NOT NULL,
    server_signature    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hero_authority_events_hero_id_created
    ON hero_authority_events (hero_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_hero_authority_events_hero_id
    ON hero_authority_events (hero_id);

COMMENT ON TABLE hero_authority_events IS
    'Append-only Hero Vault authority audit. No UPDATE/DELETE in application paths.';
COMMENT ON COLUMN hero_authority_events.client_hash IS
    'Client integrity hash (advisory; never a server signature).';
COMMENT ON COLUMN hero_authority_events.server_signature IS
    'Server-minted signature granting this authority event.';
