-- For temporary registration sessions
CREATE TABLE IF NOT EXISTS registration_states (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    data BYTEA NOT NULL, -- Binary data for PasskeyRegistration
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- For permanent user credentials
CREATE TABLE IF NOT EXISTS credentials (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    credential_id BYTEA NOT NULL,
    public_key BYTEA NOT NULL, -- Binary data for Passkey
    created_at TIMESTAMPTZ DEFAULT NOW()
);
