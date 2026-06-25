# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Spekto is a real-time property inspection SaaS. Clients (buyers/investors) post inspection jobs; Scouts (gig workers) record walkthroughs on-site. External footage from completed inspections is auto-listed on a secondary marketplace. Full context, schema details, and bug history are in `PROJECT_NOTES.md` — read it before making non-trivial changes.

## Development

**No build step for the frontend.** Plain HTML/CSS/ES6 modules served via GitHub Pages. Open any `.html` file in a browser.

**Deployment:** Push to `main` → GitHub Pages auto-deploys to `https://maxwelldsouza-eng.github.io/Spekto/`

**Edge Functions:** Managed via Supabase CLI (`supabase/functions/`). Deploy with `supabase functions deploy <name>`.

**There is no test suite.** Testing is manual via browser DevTools and the test accounts in `PROJECT_NOTES.md`.

## Architecture

```
config/supabase-config.js      — Supabase client singleton (imported by everything)
database/database.js           — All DB functions (~1,337 lines, 30+ named exports)
auth/                          — Login, register, role selection, verify-email, password reset
client/                        — dashboard, new-inspection, inspection-detail, marketplace,
                                  billing, disputes, settings, property-library
scout/                         — dashboard, inspection-detail, recording, earnings,
                                  disputes, settings, ratings
admin/                         — dashboard, inspections, inspection-detail, disputes,
                                  dispute-detail, verification, rights-to-work, users,
                                  user-detail, payouts, marketplace, settings, login
supabase/functions/            — Edge Functions (see list below)
```

Each `.html` file is fully self-contained: inline `<style>`, `<script type="module">`, its own auth check, and direct imports from `database.js`. No SPA router — navigation is plain `<a>` redirects.

**Never inline a new `createClient(...)` call.** Always import from the shared config:
```js
import { supabase } from '../config/supabase-config.js'
import { someFunction } from '../database/database.js'
```

### database.js sections

| Lines | Section |
|-------|---------|
| 1–30 | PRICING FUNCTIONS |
| 31–140 | USER FUNCTIONS |
| 141–202 | CLIENT PROFILE FUNCTIONS |
| 203–293 | SCOUT PROFILE FUNCTIONS |
| 294–598 | INSPECTION FUNCTIONS |
| 599–716 | CAPTURE FUNCTIONS |
| 717–827 | PAYMENT FUNCTIONS |
| 828–911 | NOTIFICATION FUNCTIONS |
| 912–1109 | DISPUTE FUNCTIONS |
| 1110–1190 | PAYOUT BATCH FUNCTIONS |
| 1191–end | MARKETPLACE FUNCTIONS |

### Edge Functions (`supabase/functions/`)

| Function | Purpose |
|----------|---------|
| `stripe-create-inspection` | Creates Payment Intent when client posts an inspection |
| `stripe-setup-intent` | Creates SetupIntent for saving a card |
| `stripe-save-payment-method` | Saves a card to the customer |
| `resume-inspection-payment` | Handles payment for previously drafted inspections |
| `stripe-connect-onboard` | Stripe Connect onboarding for Scouts |
| `stripe-payout-batch` | Runs Tuesday payout batch via Stripe Connect transfers |
| `stripe-webhook` | Handles Stripe webhook events (transfer.created, etc.) |
| `marketplace-purchase` | Handles marketplace listing purchases |
| `dispute-resolve` | Admin-triggered dispute resolution + refund/payout logic |
| `check-work-rights` | Validates Scout right-to-work documents |
| `create-inspection` | Direct DB inspection creation (fallback) |
| `send-auth-email` | Resend API email hook (bypasses Supabase SMTP) |
| `xero-oauth-callback` | Xero OAuth callback handler |
| `backfill-coords` | Backfills lat/lng on existing inspections |
| `_shared` | Shared utilities (CORS headers, etc.) |

### Adding a new screen
1. Create the `.html` in the appropriate folder.
2. Import from `../config/supabase-config.js` and `../database/database.js`.
3. Guard with `supabase.auth.getSession()` at load time.
4. Admin screens: verify against the `admins` table using the `is_admin()` RLS helper.

## Supabase & RLS

- **URL:** `https://nyvnvtxhlnjvfhcmnihh.supabase.co`
- **Anon key (public/safe):** `sb_publishable_AZSoskR9Ou8e-rl0QlPWUg_vOehXCRL`
- RLS is enabled on all tables. Standard policies use `auth.uid()`; admin access uses `is_admin()`.

### ⚠️ Trigger functions MUST be SECURITY DEFINER

Any trigger writing to a table other than the one it's attached to will silently roll back the entire transaction as `SECURITY INVOKER`. Symptom: a status update that appears to do nothing.

```sql
CREATE OR REPLACE FUNCTION public.function_name()
 RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path = public
AS $function$ -- body unchanged $function$;
```

Audit all triggers:
```sql
SELECT t.tgname, p.proname, p.prosecdef
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
JOIN pg_class c ON t.tgrelid = c.oid
WHERE NOT t.tgisinternal;
```

## Key Data Model Facts

**`inspections.status` flow:**
`Posted → Accepted → InProgress → Completed → PendingPayment → Disputed → Paid → Cancelled`
Also: `Draft` (inspection posted but payment not completed yet)

**`disputes` table has strict CHECK constraints** — inserting outside these sets fails with Postgres `23514` (silent fail):
- `dispute_type` ∈ `{'QualityDispute', 'PaymentDispute'}`
- `reason` ∈ `{'VideoBlurry', 'WrongLocation', 'IncompleteWalkthrough', 'TooDark', 'PaymentNotReceived', 'IncorrectAmount', 'UnfairDispute', 'TechnicalError', 'Other'}`
- `priority` ∈ `{'Low', 'Medium', 'High', 'Urgent'}`
- `status` ∈ `{'Submitted', 'UnderReview', 'AwaitingResponse', 'DecisionMade', 'Resolved', 'Dismissed'}`
- Before adding a `resolution` value, verify the constraint:
  ```sql
  SELECT pg_get_constraintdef(oid) FROM pg_constraint
  WHERE conrelid = 'disputes'::regclass AND conname LIKE '%resolution%';
  ```

**`admins` vs `users`:** Admin identity is checked by matching `auth.jwt() ->> 'email'` against `admins.email` (`is_active = true`). No FK links `admins` to `auth.users`. `disputes.assigned_to` and `disputes.resolved_by` are FKs to `admins.id`, not `users.id`.

**`users.role` vs `users.active_role`:** `role` is set once at signup. `active_role` tracks the current dashboard mode. Check `scout_profiles`/`client_profiles` for actual capability.

**Payout batch items:** `status` ∈ `{'Pending', 'Processing', 'Failed', 'Paid'}` (CHECK constraint — do not use other values).

## Design System

```css
--purple: #560591        /* primary brand */
--light-tint: #F5EEFF   /* light section backgrounds */
--bg: #F7F5FA           /* page background */
--green: #22C55E        /* CTAs, success */
--dark: #1A0533         /* admin sidebar */
--red: #DC2626          /* errors, disputes */
```

Fonts: `DM Sans 800` (logo/headings), `Inter` (body). Icons: Tabler Icons via CDN (`@tabler/icons-webfont@2.44.0`). Client/Scout sidebars 220px wide (purple); Admin sidebar 230px wide (dark navy). Sidebar hidden on mobile with no fallback nav — known unresolved gap.

## Key Business Rules

- Only **external** captures are auto-listed to the marketplace. Internal footage is never sold.
- Scouts have no visibility into marketplace resale of their recordings.
- A Scout cannot accept their own inspection (enforced by RLS).
- Only `PendingPayment` inspections can enter payout batches; `Disputed` ones are blocked by trigger.
- Scout ID verification and right-to-work must be manually approved by an admin before production use.
- Payout batches run on Tuesdays via `stripe-payout-batch`; webhook (`stripe-webhook`) transitions batch items to `Paid` on successful transfer.

## Known Gaps

- **Mobile navigation** — sidebar hides on mobile with no hamburger/drawer fallback. Affects all screens.
- **Xero integration** — OAuth callback exists (`xero-oauth-callback`) but integration is not complete.
- **Email confirmation** — currently disabled in Supabase Auth for testing. Must be re-enabled before launch.
- **Google OAuth redirect** — still pointed at `http://localhost:3000` in Google Cloud Console; needs updating to the production GitHub Pages URL.

## Code Generation Note

Generate HTML directly. Do not use external tools (Google AI Studio, etc.) that may introduce stray code fences, wrong API keys, or broken inline SVGs.
