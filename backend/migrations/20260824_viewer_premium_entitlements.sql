-- Viewer premium entitlements — Stripe subscription mirror keyed by anonymous viewer_id.
-- Restored for production sqlx parity (table already exists on Railway).

CREATE TABLE IF NOT EXISTS viewer_premium_entitlements (
    viewer_id TEXT PRIMARY KEY,
    plan TEXT NOT NULL CHECK (plan = ANY (ARRAY['premium_monthly'::text, 'premium_annual'::text])),
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    stripe_session_id TEXT,
    active_until TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_viewer_premium_active_until
    ON viewer_premium_entitlements(active_until);
