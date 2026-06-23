-- xero_tokens: single-row store for Xero OAuth2 tokens
-- Run once in the Supabase SQL editor

CREATE TABLE IF NOT EXISTS xero_tokens (
  id INTEGER PRIMARY KEY DEFAULT 1,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT xero_tokens_single_row CHECK (id = 1)
);

-- Only admins (service role) should read/write this table
ALTER TABLE xero_tokens ENABLE ROW LEVEL SECURITY;
-- No public access at all — Edge Functions use the service role key
