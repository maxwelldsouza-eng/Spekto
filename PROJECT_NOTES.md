Spekto — Project Handoff Notes
Purpose of this document: This is a handoff for picking up development of Spekto using Claude Code (or any fresh AI coding session) without losing context from the build-and-debug work done so far in Claude.ai chat. It covers architecture, schema, business rules, known bugs (fixed and unfixed), and pending decisions.
Read this in full before making changes — several of the "known bugs" sections describe failure patterns (especially around RLS and triggers) that are likely to recur elsewhere in the codebase and are worth checking proactively rather than waiting to be reported.
---
1. What Spekto Is
A real-time property inspection marketplace connecting property buyers/investors (Clients) with gig workers (Scouts) who record property walkthrough videos on request. Clients post an inspection request for an address; a Scout accepts it, records video (external and/or internal footage), and submits it. External footage is also automatically resold on a secondary Marketplace to other Clients researching the same property.
This is a solo-founder project, currently in MVP/active-development phase, built entirely through AI-assisted pair-programming (Claude.ai chat). No payment processing is live yet — all of Stripe integration is still pending.
---
2. Tech Stack
Frontend: Plain HTML/CSS/JavaScript, one self-contained file per screen — no build step, no framework, no bundler. Each file has its own `<style>` block and `<script type="module">` block.
Backend: Supabase (PostgreSQL + Auth + Storage), project ID `nyvnvtxhlnjvfhcmnihh`, Tokyo region (ap-northeast-1).
Hosting: GitHub Pages, served from the repo root.
Payments: Stripe Connect — not yet integrated. Database has placeholder columns ready (`stripe_payment_intent_id`, `stripe_transfer_id`, `stripe_refund_id`, `stripe_account_id`) but no Edge Functions, no webhook handling, no actual API calls anywhere yet.
Fonts/Icons: Google Fonts (Inter, DM Sans) and Tabler Icons via CDN (`@tabler/icons-webfont`).
Repo: `https://github.com/maxwelldsouza-eng/Spekto` (public)
Live site: `https://maxwelldsouza-eng.github.io/Spekto/`
Supabase URL: `https://nyvnvtxhlnjvfhcmnihh.supabase.co`
Supabase publishable key (safe, client-side): `sb_publishable_AZSoskR9Ou8e-rl0QlPWUg_vOehXCRL`
Every screen creates its own Supabase client inline:
```javascript
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
const supabase = createClient(
  'https://nyvnvtxhlnjvfhcmnihh.supabase.co',
  'sb_publishable_AZSoskR9Ou8e-rl0QlPWUg_vOehXCRL'
)
```
---
3. Brand / Design System
Primary purple: `#560591`
Light tint: `#F5EEFF`
Page background: `#F7F5FA`
Green (CTAs/success): `#22C55E` (sometimes `#16A34A` for text)
Admin portal dark navy sidebar: `#1A0533`
Red (errors/disputes): `#DC2626` / `#991B1B`
Fonts: DM Sans 800 for the wordmark/headings, Inter for body text
Logo: a simple camera SVG lockup next to "SPEKTO" wordmark — reused identically across every screen's sidebar
Important workflow note from the founder: generate HTML directly rather than via other tools (e.g. Google AI Studio) — past attempts via other tools produced stray code fences, wrong API keys, or broken inline SVG logos.
---
4. Repository File Structure (verified live, as of this handoff)
```
auth/
  register.html
  verify-email.html
  select-role.html
  login.html
  forgot-password.html
  reset-password.html

client/
  dashboard.html
  new-inspection.html
  inspection-detail.html
  billing.html
  disputes.html
  settings.html
  property-library.html
  marketplace.html

scout/
  dashboard.html
  inspection-detail.html
  recording.html
  earnings.html
  disputes.html
  settings.html

admin/
  login.html
  dashboard.html
  inspections.html
  inspection-detail.html
  disputes.html
  dispute-detail.html
  verification.html
  users.html
  payouts.html

config/
  supabase-config.js

database/
  database.js
```
⚠️ NOT yet in the repo, despite having been built in chat and shown to the founder:
`admin/user-detail.html` — was generated and presented but never committed to GitHub. Exists only as a one-off file output from a past chat session, not on disk in the repo. If continuing this work, regenerate or locate this file before assuming it's live.
`admin/marketplace.html` — never built at all. Sidebar nav links to it from every admin screen, but the file doesn't exist (404).
⚠️ Known gap just identified, not yet fixed: Every Client-facing screen except `marketplace.html` and `property-library.html` is missing the "Marketplace" link in its sidebar nav (each screen has its own independent copy of the sidebar HTML, copy-pasted rather than shared via a template, so this kind of drift is structurally easy to introduce). A fix was prepared for 7 files (`dashboard.html`, `new-inspection.html`, `inspection-detail.html`, `property-library.html`, `billing.html`, `disputes.html`, `settings.html`) but may not yet be committed — verify in the live repo before assuming this is resolved.
⚠️ Mobile navigation is broken across the entire app. Every screen has CSS like:
```css
@media (max-width: 700px) { .sidebar { display: none; } .main { margin-left: 0; } }
```
This hides the sidebar entirely on phone-width screens with no alternative way to open it — no hamburger icon, no drawer, nothing. On an iPhone, a logged-in user can only ever see whichever single page they're currently on, with zero navigation. This affects Client, Scout, and Admin screens identically and needs a structural fix (hamburger toggle + slide-out drawer, or similar) rolled out across every file. Not yet started.
---
5. Database Schema (23 tables, Supabase PostgreSQL)
```
users, client_profiles, scout_profiles, scout_reviews, pricing, inspections,
instructions, captures, payments, notifications, admin_actions, admins,
content_flags, deleted_captures, disputes, dispute_messages, dispute_timeline,
payout_batches, payout_batch_items, marketplace_listings, marketplace_purchases,
marketplace_searches, marketplace_pricing
```
Key columns and relationships worth knowing
`users.role` vs `users.active_role`: `role` is the original signup type (`client` or `scout`), set once at registration and essentially never changed afterward through the UI. `active_role` is the currently active mode — a user can toggle between Client/Scout views, and this column tracks which dashboard they're currently using. These can legitimately differ and both matter. A user's actual capabilities (whether they truly have Scout features) are better confirmed by checking for a row in `scout_profiles` / `client_profiles`, not just these columns.
`inspections.status` flow: `Posted → Accepted → InProgress → Completed → PendingPayment → Disputed → Paid → Cancelled` (Disputed can branch off from several points).
Pricing (seeded in `pricing` table): External Only — Scout $35 / Client $60. Internal Only — Scout $50 / Client $75. Internal & External — Scout $65 / Client $90.
Marketplace pricing: $20 inc GST per listing purchase ($18.18 ex GST + $1.82 GST), 48hr buyer access window, max 3 downloads per purchase. Listing expiry: 365 days (changed from an original default of 90 days).
`disputes` table has strict CHECK constraints — these are NOT free text, and inserting any value outside these exact sets fails with Postgres error `23514`:
`dispute_type` ∈ `{'QualityDispute', 'PaymentDispute'}`
`reason` ∈ `{'VideoBlurry', 'WrongLocation', 'IncompleteWalkthrough', 'TooDark', 'PaymentNotReceived', 'IncorrectAmount', 'UnfairDispute', 'TechnicalError', 'Other'}`
`priority` ∈ `{'Low', 'Medium', 'High', 'Urgent'}`
`status` ∈ `{'Submitted', 'UnderReview', 'AwaitingResponse', 'DecisionMade', 'Resolved', 'Dismissed'}`
`resolution` ∈ `{'FullRefundToClient', 'PartialRefundToClient', 'PaymentReleasedToScout', 'PartialPaymentToScout', 'NoActionRequired', 'Dismissed', ...}` (full list not fully captured — re-check via `pg_get_constraintdef` before inserting a new resolution value)
Important: `dispute_type` is a coarse category, separate from `reason`. The four quality-related reasons (`VideoBlurry`, `WrongLocation`, `IncompleteWalkthrough`, `TooDark`) all map to `dispute_type = 'QualityDispute'`. The two payment-related reasons map to `'PaymentDispute'`.
`disputes.assigned_to` and `disputes.resolved_by` are foreign keys to `admins.id`, not `users.id` — easy to assume wrong when writing joins.
`admins` table is a separate table from `users` — admin identity/authorization is checked by matching the logged-in Supabase Auth user's email against `admins.email` (with `is_active = true`), not via a shared `id`/`user_id` foreign key. There is no column linking `admins` to `auth.users` directly other than email string matching.
Storage Buckets
`captures` (public) — Scout video uploads
`id-documents` (private) — Scout ID verification documents
Database Triggers (all currently live)
Trigger	Fires on	Function	Purpose
`on_inspection_completed`	`inspections` status → `Completed`	`auto_list_external_captures()`	Auto-lists all external captures to `marketplace_listings` (365-day expiry). Internal captures are never listed (privacy).
`on_inspection_disputed`	`inspections` status → `Disputed`	`handle_dispute_raised()`	Puts related `payout_batch_items` on hold and flips related `payments` to `Disputed` status.
`prevent_disputed_batch_entry`	insert into `payout_batch_items`	—	Blocks disputed inspections from entering a payout batch.
`ensure_active_role_set`	`BEFORE INSERT` on `users`	`sync_active_role_default()`	If `active_role` is left NULL at insert time, backfills it to match `role`. INSERT-only — does not auto-sync if `role` is changed later via UPDATE without also setting `active_role`. This gap was identified and deliberately left unaddressed (low risk — `role` is essentially never updated post-signup in any current screen).
Both `auto_list_external_captures()` and `handle_dispute_raised()` are now `SECURITY DEFINER` with `SET search_path = public` (see Section 6 — this was a major bug class, now fixed for these two specific functions). Any future trigger function that writes to a different table than the one it's attached to should be checked for the same issue before being trusted.
---
6. Major Bug Classes Found This Build — Read Before Writing New Triggers/Policies
These aren't isolated one-off bugs — they're systemic patterns in how this schema was built, and are highly likely to recur in any untested area of the app. Future work (including Claude Code sessions) should proactively check for these rather than waiting for a screen to visibly fail.
Bug Class A: Trigger functions without `SECURITY DEFINER` fail when they write to tables the calling user has no RLS permission on
What happened: `auto_list_external_captures()` and `handle_dispute_raised()` were both originally created as plain `SECURITY INVOKER` (the default) functions. When a Scout submits an inspection (triggering the first) or a Client raises a dispute (triggering the second), the trigger fires using that user's own session privileges, not an elevated role. Since the trigger needs to write to tables like `marketplace_listings` or `payments` — tables the calling user has no direct RLS permission to write to — the write inside the trigger gets rejected by RLS, and the entire transaction rolls back, including the original statement that looked like it should have succeeded (e.g. the `inspections.status` UPDATE itself silently reverts).
Symptom pattern: A status update appears to do nothing — no error shown in the UI (if error handling isn't wired up), the row in the database simply never changes, despite the request returning what looks like a normal response. The actual error only surfaces as a `403 Forbidden` in the Network tab / browser console, with a Postgres error like `new row violates row-level security policy for table "X"` — where `X` is NOT the table the front-end code thinks it's writing to, but a table written to by a trigger fired as a side effect.
Fix pattern:
```sql
CREATE OR REPLACE FUNCTION public.function_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
  -- identical body, no logic changes
$function$;
```
Always pull the exact current function body via `pg_get_functiondef()` before recreating it, to avoid accidentally changing behavior while fixing privileges.
Action item: Audit every other trigger function in the schema for `prosecdef = false` where the function writes to a table different from the one it's attached to. Run:
```sql
SELECT t.tgname, p.proname, p.prosecdef
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
JOIN pg_class c ON t.tgrelid = c.oid
WHERE NOT t.tgisinternal;
```
Anything with `prosecdef = false` should be manually reviewed.
Bug Class B: RLS policies were written only with "the user's own data" in mind — admins were never accounted for
What happened: Every RLS policy across nearly all 23 tables was written using conditions like `auth.uid() = client_id` or `auth.uid() = scout_id`. None of them had any clause accounting for admins — who are regular Supabase Auth users with no special Postgres role, whose only "admin-ness" comes from a row existing in the separate `admins` table. Since RLS has no built-in concept of "admin," every single admin portal screen querying any of these tables was silently returning zero rows, with no error — looking like "this feature is empty" rather than "this feature is broken."
This was caught on `disputes` specifically (admin Disputes screen showed "0" despite a real row existing) but the same audit revealed it affects almost every table, including `inspections`, `users`, `payments`, `captures`, `payout_batches`, `scout_profiles`, etc.
Fix applied: A reusable helper function:
```sql
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admins
    WHERE admins.email = auth.jwt() ->> 'email'
    AND admins.is_active = true
  );
$$;
```
...plus one new permissive policy per table, e.g.:
```sql
CREATE POLICY "Admins read all inspections" ON inspections FOR SELECT USING (is_admin());
```
A full migration was written adding `is_admin()`-based SELECT (and UPDATE/INSERT where the admin portal actually writes) policies across ~18 tables.
⚠️ THIS BUG IS NOT FULLY RESOLVED. After applying the migration, testing showed the `is_admin()`-gated policies were still failing with:
```
{code: '42501', message: 'permission denied for table users', hint: 'Grant the required privileges to the current role with: GRANT SELECT ON auth.users TO authenticated;'}
```
The function body was rewritten once already (from querying `auth.users` directly via `SELECT email FROM auth.users WHERE id = auth.uid()`, to using `auth.jwt() ->> 'email'` instead, specifically to avoid touching `auth.users`) — but the error persisted identically even after that fix, and after a `NOTIFY pgrst, 'reload schema'` cache-clear. This was being actively debugged (testing `is_admin()` directly via RPC call, checking session/JWT validity) when work was paused to switch tasks. This needs to be resolved before trusting that any admin screen relying on these new policies actually works. Re-test every admin screen after this is genuinely fixed — assume nothing currently works on the admin side until confirmed, since the underlying access-control mechanism is unverified.
Bug Class C: Save-state / partial-progress features only wired up the "happy path," silently dropping work done before that point
What happened (Scout recording screen): The "Save progress and continue later" button only ever updated `inspections.status` — it never actually uploaded the selected videos to Storage or inserted rows into `captures`. Only the "Submit Inspection" button had that logic. A Scout who selected a video, clicked Save Progress, and came back later would find their video silently gone, with no error at any point — because nothing was ever actually sent to the server in the first place.
A related second gap: even after fixing the upload, the recording screen had no code path to re-fetch and display already-uploaded captures on page load, so a returning Scout saw an empty upload zone even once uploads were fixed. A third instance of the same pattern: a recording checklist (`instructions.is_checked`) only updated in-memory JavaScript state, never writing to the database at all, so checked items reverted to unchecked on every page reload.
Fix pattern applied: A single shared upload function used by both Save Progress and Submit, with an `uploaded` flag per item to prevent double-uploads; a `loadExistingCaptures()` function called on page init to repopulate state from the database; and `toggleInstruction()` rewritten to write `is_checked` to the database immediately on every click rather than only updating local state.
Action item for any future "save and resume" feature: Check whether ALL user-entered state (not just the most obvious piece) is actually persisted, and whether the page's `init()` function actually re-reads everything that should be resumable — not just the primary record.
Bug Class D: Front-end "shortcuts" that bypass the real data model entirely
What happened: The Client's "raise a dispute" button was wired to directly set `inspections.status = 'Disputed'` and store the reason in a column called `inspections.dispute_reason` — completely bypassing the actual `disputes` table, despite a full dispute system (with `dispute_messages`, `dispute_timeline`, SLA fields, admin resolution workflow) having been built elsewhere in the app. The result: disputes appeared to work from the Client's point of view (status badge changed correctly) but no real dispute record ever existed, so the entire admin-side dispute management system had nothing to manage.
Fix applied: Rewrote the handler to properly insert into `disputes` with all required fields (mapped to the correct CHECK-constraint values — see Section 5), setting `due_at` and `scout_response_due_at` for SLA tracking, and only updating `inspections.status` after the dispute insert succeeds (not before/instead of it).
Action item: Be suspicious of any front-end action that "shortcuts" through a status column rather than writing to what looks like the properly-designed table for that concern. Search for similar patterns elsewhere (e.g., does the Scout's dispute response actually write to `dispute_messages`, or does it also bypass the real table?) — not yet checked.
---
7. Business Rules to Preserve (easy to accidentally violate when extending features)
Internal footage is never sold or shown on the Marketplace. Only external captures get auto-listed by `on_inspection_completed`. Any Marketplace-related UI offering an "Internal only" filter is a bug, not a feature — internal videos should never appear there at all, by design, for privacy reasons.
Scouts have no ownership stake in marketplace resale. Once an inspection is paid out, the video belongs to the Spekto platform. Scouts should have no menu link, no visibility, and no earnings view related to Marketplace listings or resale revenue — this was explicitly confirmed as a deliberate business rule, not an oversight.
Scout cannot accept their own inspection (i.e., a user in Scout mode can't fulfil a job they posted while in Client mode) — enforced at the RLS/query level (`scout_read_posted_inspections` policy excludes own client_id... verify this is still true if policies are touched).
Only `PendingPayment` inspections can enter a payout batch — `Disputed` inspections must never be paid out (`prevent_disputed_batch_entry` trigger enforces this).
Scout ID verification is required before being trusted in production — currently approve/reject is manual via the admin Verification screen, logged to `admin_actions`.
---
8. Authentication Notes
Email confirmation is currently disabled in Supabase Auth for ease of testing. Must be re-enabled before real launch.
Custom SMTP is not yet configured — Supabase free tier default has a 2-email/hour rate limit, which will be a problem at any real usage volume.
Google OAuth redirect URI is still pointed at `http://localhost:3000/auth/select-role.html` in Google Cloud Console — needs updating to the production GitHub Pages URL before Google sign-in will work in production.
Admin login requires both valid Supabase Auth credentials and a matching active row in `admins` (checked by email, see Section 5).
---
9. What's Genuinely Not Started Yet
Stripe integration — entirely unbuilt. Client payment (Payment Intent), Scout payouts (Connect, Tuesday batch transfers), refunds (admin-triggered from dispute resolution). Estimated several days of focused work: Edge Functions, webhooks, Connect onboarding, payout automation, refund logic, testing.
`admin/marketplace.html` — doesn't exist. Needed for admins to moderate/view marketplace listings.
Marketplace purchase flow — browsing and search work; the actual "buy" button is explicitly stubbed with a "coming soon" alert, blocked on Stripe.
Mobile navigation — see Section 4. Affects the entire app.
Scout response mechanism in disputes — unclear whether `scout/disputes.html`'s "respond" action actually writes to `dispute_messages`, or has the same bypass-the-real-table problem described in Bug Class D. Not yet verified.
Admin transition of disputes to `AwaitingResponse` — the status lifecycle includes this stage and the Scout's "Needs response" UI depends on it, but at the time of this handoff it wasn't confirmed whether admins have a clear, reliable way to trigger that transition (a `showStatusModal()` confirm-dialog flow exists for stepping through statuses, but hasn't been thoroughly tested end-to-end).
---
10. Test Accounts in the Database
Name	id	email	role	active_role
Maxwell Dsouza	`66cf5e78-af68-46b3-ba21-5cb50cf05110`	maxwelldsouza@gmail.com	client	client
John Scout	`ec7f9320-8126-4e3a-9bc6-b0d4656b7708`	maxwelldsouza+1@gmail.com	scout	scout
Test Client	`943d6e05-d48f-4e2f-8bd2-de006308d9a7`	joyce.dsouza06@gmail.com	client	client
Admin login: `maxwelldsouza@gmail.com` (separate row in `admins` table, role `superadmin`).
Note: Several test inspections created during this debugging session were left in inconsistent states — e.g. `inspections.status = 'Disputed'` with no corresponding row in `disputes`, leftover from before the Bug Class D fix was applied. Worth a cleanup pass (`SELECT i.id, i.status FROM inspections i LEFT JOIN disputes d ON d.inspection_id = i.id WHERE i.status = 'Disputed' AND d.id IS NULL;` to find them) before treating any current data as a clean reference set.
---
11. Recommended First Steps for Whoever (or whatever) Picks This Up
Resolve the open `is_admin()` / RLS issue (Section 6, Bug Class B) before trusting any admin screen. This is the single biggest unresolved item — likely something subtle about how the Supabase project handles JWTs or grants on `auth.users`, possibly project-specific. Worth checking Supabase's own RLS/JWT documentation for known issues with `SECURITY DEFINER` functions referencing `auth.*` schemas.
Audit other trigger functions for the same missing-`SECURITY DEFINER` pattern (Bug Class A) before they cause a confusing failure later.
Verify whether the Marketplace sidebar-link fix and the `client/inspection-detail.html` dispute-insert fix were actually committed to GitHub — both were generated and handed off in chat, but confirmation of an actual commit wasn't captured in this document.
Decide on mobile navigation approach and roll it out consistently — this is the most visible end-user-facing gap right now.
Treat every "this screen looks empty" report with suspicion rather than assuming it means "no data exists yet" — given Bug Class B, an empty-looking admin screen is more likely broken than genuinely empty.
