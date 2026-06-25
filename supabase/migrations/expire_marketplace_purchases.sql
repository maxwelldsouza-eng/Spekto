-- Enable pg_cron extension (requires Supabase dashboard: Database > Extensions > pg_cron)
create extension if not exists pg_cron;

-- Schedule a job to expire marketplace purchases whose access window has closed.
-- Runs every hour. Updates status from 'paid' to 'expired' where access_expires_at has passed.
select cron.schedule(
  'expire-marketplace-purchases',   -- job name (unique)
  '0 * * * *',                      -- every hour on the hour
  $$
    update marketplace_purchases
    set status = 'expired', updated_at = now()
    where status = 'paid'
      and access_expires_at is not null
      and access_expires_at < now();
  $$
);
