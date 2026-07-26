-- GST & Invoicing — foundation schema
-- Safe to ship: gst_registered defaults to false, so no live charging behaviour changes
-- until an admin explicitly flips it on via the new Company Settings screen.

-- 1. Company-level GST config (single row)
CREATE TABLE company_settings (
  id integer PRIMARY KEY DEFAULT 1,
  abn text,
  trading_name text,
  gst_registered boolean NOT NULL DEFAULT false,
  gst_effective_from date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_settings_single_row CHECK (id = 1)
);

INSERT INTO company_settings (id, abn, trading_name, gst_registered, gst_effective_from)
VALUES (1, '00 000 000 000', 'Spekto Pty Ltd', false, CURRENT_DATE);

ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage company settings" ON company_settings
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- 2. Scout GST fields (abn already exists on scout_profiles — reused, not duplicated)
ALTER TABLE scout_profiles
  ADD COLUMN is_gst_registered boolean NOT NULL DEFAULT false,
  ADD COLUMN gst_registered_from date,
  ADD COLUMN gst_status_confirmed_at timestamptz,
  ADD COLUMN rcti_agreement_accepted_at timestamptz;

-- 3. Pricing auto-compute — gst/total can never drift from the formula regardless of write path.
-- Formula reflects the confirmed principal-supplier model: GST on the FULL supply
-- (pay_to_scout + fee_excluding_gst), not on the fee alone. This trigger always computes
-- the mathematically correct value; the booking-time GATE (whether to actually charge it)
-- lives in application code, checking company_settings.gst_registered / gst_effective_from.
CREATE OR REPLACE FUNCTION public.compute_pricing_gst()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.gst := round((NEW.pay_to_scout + NEW.fee_excluding_gst) * 0.10, 2);
  NEW.total := NEW.pay_to_scout + NEW.fee_excluding_gst + NEW.gst;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_compute_pricing_gst
  BEFORE INSERT OR UPDATE ON public.pricing
  FOR EACH ROW
  EXECUTE FUNCTION public.compute_pricing_gst();

-- Re-save existing rows so gst/total reflect the formula immediately (still $0 GST charged
-- to clients until gst_registered is flipped on — this only affects what the admin screen
-- and pricing table display, not what's actually charged).
UPDATE pricing SET updated_at = now();

-- 4. Payments — new GST reporting columns, populated at payout time (not booking time),
-- since a Scout's GST registration status can change between accepting and completing a job.
ALTER TABLE payments
  ADD COLUMN scout_gross_payout numeric,
  ADD COLUMN scout_gst_component numeric,
  ADD COLUMN spekto_gst_collected numeric,
  ADD COLUMN spekto_gst_credit numeric,
  ADD COLUMN spekto_net_gst_remitted numeric,
  ADD COLUMN spekto_margin numeric;

-- 5. Client-facing tax invoices
CREATE SEQUENCE invoice_number_seq START 1;

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number text NOT NULL UNIQUE,
  inspection_id uuid NOT NULL REFERENCES inspections(id),
  client_id uuid NOT NULL REFERENCES users(id),
  payment_id uuid NOT NULL REFERENCES payments(id),
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  supply_value_ex_gst numeric NOT NULL,
  gst numeric NOT NULL,
  total numeric NOT NULL,
  pdf_url text,
  xero_invoice_id text,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'voided', 'partially_refunded')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clients read own invoices" ON invoices FOR SELECT USING (auth.uid() = client_id);
CREATE POLICY "Admins read all invoices" ON invoices FOR SELECT USING (is_admin());

-- 6. Scout-facing RCTIs (only created when the Scout is GST-registered)
CREATE SEQUENCE rcti_number_seq START 1;

CREATE TABLE scout_rctis (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  rcti_number text NOT NULL UNIQUE,
  inspection_id uuid NOT NULL REFERENCES inspections(id),
  scout_id uuid NOT NULL REFERENCES users(id),
  payment_id uuid NOT NULL REFERENCES payments(id),
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  supply_value_ex_gst numeric NOT NULL,
  gst numeric NOT NULL,
  total numeric NOT NULL,
  pdf_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE scout_rctis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Scouts read own RCTIs" ON scout_rctis FOR SELECT USING (auth.uid() = scout_id);
CREATE POLICY "Admins read all RCTIs" ON scout_rctis FOR SELECT USING (is_admin());

-- 7. Notification types for invoice/RCTI emails (reuses the existing notify() pattern)
INSERT INTO notification_types (type, label, is_mandatory) VALUES
  ('invoice_issued', 'Tax invoice issued', true),
  ('rcti_issued', 'RCTI issued', true);
