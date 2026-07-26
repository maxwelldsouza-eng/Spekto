ALTER TABLE inspections
  ADD COLUMN listing_type text NOT NULL DEFAULT 'Sale' CHECK (listing_type IN ('Sale', 'Rent')),
  ADD COLUMN agent_first_name text,
  ADD COLUMN agent_last_name text,
  ADD COLUMN agent_phone text,
  ADD COLUMN agent_email text;
