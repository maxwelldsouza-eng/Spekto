# Spekto — Task List

| # | Task | Priority | Status | Completed |
|---|------|----------|--------|-----------|
| 1 | Enable leaked password protection (HaveIBeenPwned) — requires Supabase Pro plan | Low | Pending | — |
| 2 | Fix mobile navigation — sidebar hides on mobile with no hamburger/drawer fallback (affects all client, scout, and admin screens) | High | Pending | — |
| 3 | Add `saved_properties` table and wire up `client/property-library.html` | Medium | Pending | — |
| 4 | Fix Google OAuth redirect URI — still pointing at `http://localhost:3000`, needs updating to GitHub Pages URL in Google Cloud Console | High | Pending | — |
| 5 | Re-enable email confirmation in Supabase Auth before launch (currently disabled for testing) | High | Pending | — |
| 6 | Configure custom SMTP — Supabase free tier limit is 2 emails/hour, will break at real usage volume | High | Pending | — |
| 7 | Build `admin/marketplace.html` — admin view of marketplace listings (file exists but needs full implementation review) | Medium | Pending | — |
| 8 | Verify Scout dispute response writes to `dispute_messages` table (may bypass the real table — same pattern as the old client bug) | High | Pending | — |
| 9 | Wire up `scout/ratings.html` — display only right now, no "leave review" flow exists | Medium | Pending | — |
| 10 | Stripe integration — client payment (Payment Intent), Scout payouts (Connect), refunds, webhooks | Critical | Completed | 2026-07-24 |
| 11 | Add Marketplace sidebar link to 6 missing client screens: `dashboard.html`, `new-inspection.html`, `inspection-detail.html`, `billing.html`, `disputes.html`, `settings.html` | Low | Pending | — |
| 12 | Clean up dirty test data — inspections with `status = 'Disputed'` but no matching row in `disputes` table | Low | Pending | — |
| 13 | Create a marketing website that integrates with Spekto | Medium | Pending | — |

---

## Completed

| # | Task | Completed |
|---|------|-----------|
| C1 | Fix ReferenceError crashing client and scout dashboards — tour step `element:` values used raw CSS selector syntax instead of strings | 2026-07-24 |
| C2 | Enable RLS on `notification_types` table — was publicly accessible, triggered two Supabase security alert emails (6 Jul + 20 Jul 2026) | 2026-07-24 |
| C3 | Tighten `dispute_messages` INSERT policy — replaced `WITH CHECK (true)` with membership check (IDOR risk) | 2026-07-24 |
| C4 | Tighten `users` INSERT policy — replaced `WITH CHECK (true)` with `auth.uid() = id` | 2026-07-24 |
| C5 | Revoke anon EXECUTE on 5 internal/admin functions (`auto_list_external_captures`, `detect_fraud_patterns`, `review_fraud_flag`, `handle_new_user`, `handle_user_email_confirmed`) | 2026-07-24 |
| C6 | Fix mutable `search_path` on 6 functions — schema injection vector (`check_inspection_not_disputed`, `sync_active_role_default`, `update_scout_rating_summary`, `handle_new_user`, `handle_user_email_confirmed`, `get_inspections_within_radius`) | 2026-07-24 |
| C7 | Disable public directory listing on `captures` storage bucket | 2026-07-24 |
