-- Stripe payments restoration: server-authoritative checkout + webhook ledger.
-- Minimal additive schema; does not replace existing revenue/creator models.

CREATE TABLE IF NOT EXISTS payment_customers (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_customers_stripe_customer
    ON payment_customers(stripe_customer_id);

CREATE TABLE IF NOT EXISTS payment_checkouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_session_id TEXT NOT NULL UNIQUE,
    stripe_customer_id TEXT,
    stripe_price_id TEXT NOT NULL,
    checkout_mode TEXT NOT NULL
        CHECK (checkout_mode IN ('payment', 'subscription')),
    checkout_status TEXT NOT NULL DEFAULT 'created'
        CHECK (checkout_status IN ('created', 'open', 'complete', 'expired', 'failed')),
    payment_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (payment_status IN ('pending', 'paid', 'failed', 'unpaid', 'no_payment_required')),
    amount_total_cents BIGINT,
    currency TEXT NOT NULL DEFAULT 'usd',
    episode_id TEXT,
    series_id TEXT,
    access_mode TEXT,
    profile_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_checkouts_user
    ON payment_checkouts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_checkouts_status
    ON payment_checkouts(checkout_status, payment_status);
CREATE INDEX IF NOT EXISTS idx_payment_checkouts_series
    ON payment_checkouts(series_id);
CREATE INDEX IF NOT EXISTS idx_payment_checkouts_episode
    ON payment_checkouts(episode_id);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
    stripe_event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    livemode BOOLEAN,
    processed BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'received'
        CHECK (status IN ('received', 'processed', 'duplicate', 'ignored', 'failed')),
    payload JSONB NOT NULL,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_type
    ON payment_webhook_events(event_type, created_at DESC);
