# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Spekto is a real-time property inspection SaaS. Clients (buyers/investors) post inspection jobs; Scouts (gig workers) record walkthroughs on-site. The platform also auto-lists completed external footage on a secondary marketplace. Full context, known bugs, and business rules are in `PROJECT_NOTES.md` — read it before making non-trivial changes.

## Development

**No build step.** The app is plain HTML/CSS/ES6 modules served directly via GitHub Pages. Open any `.html` file in a browser.

**Deployment:** Push to `main` → GitHub Pages auto-deploys to `https://maxwelldsouza-eng.github.io/Spekto/`

**There is no test suite.** Testing is manual via browser DevTools and the test accounts in `PROJECT_NOTES.md`.

## Architecture

```
config/supabase-config.js   — Supabase client (imported by all screens)
database/database.js        — All DB functions (~1,337 lines, 30+ exports)
auth/                       — Login, register, role selection, password reset
client/                     — Client-facing dashboard, new inspection, marketplace, disputes
scout/                      — Scout dashboard, recording screen, earnings, disputes
admin/                      — Admin portal: inspections, disputes, verification, users, payouts
```

Each `.html` file is a fully self-contained screen: inline `<style>`, `<script type="module">`, its own auth check, and imports from `database.js`. Navigation between screens is plain `<a>` tag redirects — no SPA router.

**Adding a new screen:**
1. Create the `.html` in the appropriate folder
2. Import: `import { supabase } from '../config/supabase-config.js'` and functions from `../database/database.js`
3. Guard the screen with `supabase.auth.getSession()` at load time
4. For admin screens, verify the user's email against the `admins` table using the `is_admin()` RLS helper

## Supabase & RLS

- **URL:** `https://nyvnvtxhlnjvfhcmnihh.supabase.co`
- **Anon key (public/safe):** `sb_publishable_AZSoskR9Ou8e-rl0QlPWUg_vOehXCRL`
- RLS is enabled on all tables. Policies use `auth.uid()` for user-scoped access and `is_admin()` for admin screens.
- **Known bug:** `is_admin()` currently fails with "permission denied for table users" — admin screens return empty results. See PROJECT_NOTES.md Section 6, Bug Class B for the current diagnosis.
- Trigger functions handle: auto-listing external captures to marketplace on inspection completion, holding payout batch items when a dispute is raised, and blocking disputed inspections from entering payout batches.

## Design System

```css
--purple: #560591        /* primary brand */
--light-tint: #F5EEFF   /* light section backgrounds */
--bg: #F7F5FA           /* page background */
--green: #22C55E        /* CTAs, success */
--dark: #1A0533         /* admin sidebar */
--red: #DC2626          /* errors, disputes */
```

Fonts: `DM Sans 800` (logo/headings), `Inter` (body). Icons: Tabler Icons via CDN (`@tabler/icons-webfont@2.44.0`). Client/Scout sidebars are 220px wide (purple); Admin sidebar is 230px wide (dark navy). The sidebar is hidden on mobile with no fallback navigation — a known unresolved gap.

## Key Business Rules

- Only **external** captures are auto-listed to the marketplace. Internal footage is never sold.
- Scouts have no visibility into marketplace resale of their recordings.
- A Scout cannot accept their own inspection (enforced by RLS).
- Only `PendingPayment` inspections can enter payout batches; `Disputed` ones are blocked by trigger.
- Scout ID verification must be manually approved by an admin before production use.

## Unbuilt / Broken Areas

- **Stripe integration** — database columns exist (`stripe_payment_intent_id`, etc.) but no Edge Functions, webhooks, or API calls have been implemented.
- **`admin/marketplace.html`** — referenced in nav but the file does not exist.
- **`admin/user-detail.html`** — generated previously but never committed.
- **Sidebar drift** — nav is copy-pasted into each file; 7 client screens are missing the marketplace link.

## Code Generation Note

Generate HTML directly. Do not use external tools (Google AI Studio, etc.) that may introduce stray code fences, wrong API keys, or broken inline SVGs.
