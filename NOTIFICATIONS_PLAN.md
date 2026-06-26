# Spekto — Notifications & Email System Plan

This spec covers in-app notifications and transactional emails for Spekto. It is intended to be handed to Claude Code for implementation. Read the existing codebase and confirm schema/screen mapping before writing any code, per established workflow.

---

## 1. Overview

Spekto needs two parallel notification channels for key events:

1. **In-app notifications** — a bell icon / notification feed, always delivered, already partially built (`notifications` table and helper functions exist in `database.js`).
2. **Email notifications** — sent via **Resend**, not Supabase Auth. Supabase Auth continues to handle only its existing scope (signup confirmation, password reset) and is untouched by this system.

A single Supabase Edge Function, `notify`, is the only entry point for both channels. Every part of the app that triggers one of the events below calls `notify` instead of writing directly to the `notifications` table or sending email itself.

Some notification types are **mandatory** (always emailed, no opt-out). Others are **optional** (user can toggle email delivery off in Settings; in-app delivery is always on regardless).

---

## 2. Database Schema

### 2.1 `notifications` (existing table — add columns)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` — existing |
| `user_id` | `uuid` | FK → `users.id`, recipient — existing |
| `type` | `text` | Event type, see §2.2 — existing, add CHECK constraint |
| `inspection_id` | `uuid` | FK → `inspections.id`, nullable — existing |
| `message` | `text` | In-app notification text — existing |
| `is_read` | `boolean` | Default `false` — existing |
| `email_sent` | `boolean` | **New.** Default `false` |
| `email_sent_at` | `timestamptz` | **New.** Nullable |
| `created_at` | `timestamptz` | Default `now()` — existing |

```sql
alter table notifications
  add column if not exists email_sent boolean default false,
  add column if not exists email_sent_at timestamptz;

alter table notifications
  add constraint notifications_type_check
  check (type in (
    'welcome_client',
    'welcome_scout',
    'new_inspection_nearby',
    'inspection_declined',
    'inspection_cancelled_refund',
    'dispute_received',
    'dispute_resolved_client',
    'dispute_resolved_scout',
    'admin_message',
    'inspection_accepted',
    'payment_receipt',
    'inspection_completed',
    'payment_released'
  ));
```

### 2.2 `notification_types` (new reference table)

One row per event type. Adding a future event type is an `insert`, not a migration.

| Column | Type | Notes |
|---|---|---|
| `type` | `text` | PK. Matches `notifications.type` |
| `label` | `text` | Human-readable name shown in Settings |
| `is_mandatory` | `boolean` | If `true`, email always sends; Settings toggle shown locked/disabled |

```sql
create table notification_types (
  type text primary key,
  label text not null,
  is_mandatory boolean default false
);

insert into notification_types (type, label, is_mandatory) values
  ('welcome_client', 'Welcome email', true),
  ('welcome_scout', 'Welcome email', true),
  ('new_inspection_nearby', 'New inspection near me', false),
  ('inspection_declined', 'Scout declined my inspection', true),
  ('inspection_cancelled_refund', 'Cancellation & refund confirmation', true),
  ('dispute_received', 'Dispute received confirmation', true),
  ('dispute_resolved_client', 'Dispute resolved', true),
  ('dispute_resolved_scout', 'Dispute resolved', true),
  ('admin_message', 'Messages from Spekto Admin', true),
  ('inspection_accepted', 'Inspection accepted', false),
  ('payment_receipt', 'Payment receipts', true),
  ('inspection_completed', 'Inspection completed', false),
  ('payment_released', 'Payment released', false);
```

### 2.3 `notification_preferences` (new, per-user per-type)

| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` | FK → `users.id` on delete cascade |
| `type` | `text` | FK → `notification_types.type` |
| `email_enabled` | `boolean` | Default `true`. Only consulted when `is_mandatory = false` |
| `updated_at` | `timestamptz` | Default `now()` |

Primary key is the `(user_id, type)` pair.

```sql
create table notification_preferences (
  user_id uuid references users(id) on delete cascade,
  type text references notification_types(type),
  email_enabled boolean default true,
  updated_at timestamptz default now(),
  primary key (user_id, type)
);

alter table notification_preferences enable row level security;

create policy "Users can view own preferences"
  on notification_preferences for select
  using (auth.uid() = user_id);

create policy "Users can update own preferences"
  on notification_preferences for update
  using (auth.uid() = user_id);

create policy "Users can insert own preferences"
  on notification_preferences for insert
  with check (auth.uid() = user_id);
```

No row needs to be pre-seeded — a missing row is treated as opted-in (`coalesce(email_enabled, true)`).

### 2.4 Existing columns relied on

- `inspections.reference_number` — human-readable inspection reference (e.g. `INS-30491`). **Already exists.**
- `disputes` table — needs an equivalent human-readable reference if not already present (e.g. `DSP-10482`). Confirm during implementation.

---

## 3. The `notify` Edge Function

Single entry point for both channels.

**Input:** `{ user_id, type, inspection_id?, dispute_id?, data: {...} }`

**Logic:**

```
1. Look up notification_types for `type` → get is_mandatory, label
2. Build in-app `message` text from template + data
3. Insert row into `notifications` (always — in-app delivery is unconditional)
4. Determine whether to email:
   - if is_mandatory = true → always send
   - else → look up notification_preferences for (user_id, type)
            → coalesce(email_enabled, true) → send if true
5. If sending:
   - build subject + body from template (§5) + data
   - call Resend API
   - update notifications row: email_sent = true, email_sent_at = now()
```

Preference check query:

```sql
select nt.is_mandatory, coalesce(np.email_enabled, true) as email_enabled
from notification_types nt
left join notification_preferences np
  on np.type = nt.type and np.user_id = $1
where nt.type = $2
```

**Email provider:** Resend, called via REST from the Edge Function. Sender domain: a verified Spekto domain (e.g. `notifications@spekto.com.au`), separate from Supabase Auth's email sending — no shared rate limits or templates.

---

## 4. Event List & Trigger Points

| # | Type | Recipient | Mandatory | Triggered from |
|---|---|---|---|---|
| 1 | `welcome_client` | Client | Yes | First login after email verification (Client role) |
| 2 | `welcome_scout` | Scout | Yes | First login after email verification (Scout role) |
| 3 | `new_inspection_nearby` | Scout | No | New inspection created, within 50km of Scout's address |
| 4 | `inspection_declined` | Client | Yes | Scout declines after previously accepting |
| 5 | `inspection_cancelled_refund` | Client | Yes | Client cancels inspection → refund issued |
| 6 | `dispute_received` | Client | Yes | Dispute created |
| 7 | `dispute_resolved_client` | Client | Yes | Dispute status → resolved |
| 8 | `dispute_resolved_scout` | Scout | Yes | Dispute status → resolved |
| 9 | `admin_message` | Client or Scout | Yes | Admin sends a message |
| 10 | `inspection_accepted` | Client | No | Inspection status → Accepted |
| 11 | `payment_receipt` | Client | Yes | Stripe webhook → `payment_intent.succeeded` |
| 12 | `inspection_completed` | Client | No | Inspection status → Completed |
| 13 | `payment_released` | Scout | No | Client triggers "Release Payment" |

**Detecting "first login" for #1/#2:** add a `welcomed_at timestamptz` column to `users` (or check `last_sign_in_at` equals `created_at` window on the Supabase Auth session) — confirm approach with existing schema during implementation.

**Detecting 50km radius for #3:** use stored Scout home address lat/lng (from Google Geocoding, already integrated) vs. new inspection's geocoded address. Confirm whether this runs as a DB trigger + Edge Function fan-out, or a scheduled job — recommend on-insert trigger calling `notify` once per nearby Scout.

---

## 5. Notification & Email Text (with bookmarks)

Bookmarks are resolved from: `users.full_name`, `inspections.reference_number`, `inspections.address`, `inspections.date`/`time`, `payments.amount`, Stripe metadata, `disputes` reference column, and constructed URLs.

### 1. Client welcome

**In-app:** `Welcome to Spekto, {{client_name}}!`

**Subject:** `Welcome to Spekto, {{client_name}}`

**Body:**
```
Hi {{client_name}},

Thanks for joining Spekto. We connect you with verified Scouts who can carry
out property inspections on your behalf — so you get the visual detail you
need without having to be there in person.

With Spekto you can:
- Post an inspection request for any property
- Get matched with a nearby verified Scout
- Receive a full video walkthrough and report
- Track every inspection from your dashboard

[Post Your First Inspection]({{new_inspection_link}})

Welcome aboard.
— The Spekto Team
```

### 2. Scout welcome

**In-app:** `Welcome to Spekto, {{scout_name}}! Complete your onboarding to start accepting jobs.`

**Subject:** `Welcome to Spekto — complete your onboarding to start earning`

**Body:**
```
Hi {{scout_name}},

Thanks for joining Spekto as a Scout. You'll be capturing property
inspection videos for Clients, earning a payout for every job you complete.

Before you can start accepting jobs, complete these 4 steps:

1. Identity verification — confirm who you are
2. Right to work verification — confirm your work eligibility
3. Home address — so we can match you to nearby jobs
4. Connect your bank account via Stripe — so we can pay you

[Complete Onboarding]({{onboarding_link}})

Once all 4 are done, you'll start seeing inspection jobs near you.
— The Spekto Team
```

### 3. New inspection near Scout

**In-app:** `New inspection near you — {{address}}, {{distance}}km away.`

**Subject:** `New inspection job near you — Ref: {{inspection_ref}}`

**Body:**
```
Hi {{scout_name}},

A new inspection has been posted near you:

Reference: {{inspection_ref}}
Address: {{address}}
Distance: {{distance}}km from you
Date requested: {{inspection_date}}
Payout: {{scout_payout_amount}}

Jobs are accepted on a first-come basis.

[View & Accept Job]({{inspections_list_link}})
```

### 4. Scout declines after accepting (→ Client)

**In-app:** `{{scout_name}} is no longer able to complete your inspection at {{address}}. We're finding you a new Scout.`

**Subject:** `Update on your inspection (Ref: {{inspection_ref}}) — we're reassigning your Scout`

**Body:**
```
Hi {{client_name}},

Unfortunately {{scout_name}} is no longer able to complete your inspection:

Reference: {{inspection_ref}}
Address: {{address}}
Originally scheduled: {{inspection_date}}

We're already looking for another available Scout in the area and will
notify you as soon as someone accepts. No action is needed from you, and
you have not been charged again.

[View Inspection Status]({{inspection_link}})
```

### 5. Client cancels — refund confirmation

**In-app:** `Your inspection at {{address}} has been cancelled. A refund of {{amount}} is on its way.`

**Subject:** `Cancellation confirmed — refund processed (Ref: {{inspection_ref}})`

**Body:**
```
Hi {{client_name}},

Your inspection has been cancelled as requested:

Reference: {{inspection_ref}}
Address: {{address}}
Amount refunded: {{amount}}
Refund method: {{payment_method_last4}}

Refunds typically appear on your statement within 5–10 business days,
depending on your bank.

[View Inspection]({{inspection_link}})
```

### 6. Dispute received — confirmation (→ Client)

**In-app:** `Your dispute for {{address}} has been received and is under review.`

**Subject:** `We've received your dispute (Ref: {{dispute_ref}})`

**Body:**
```
Hi {{client_name}},

We've received your dispute regarding:

Reference: {{dispute_ref}}
Address: {{address}}
Reason: {{dispute_reason}}

Our team will review this and respond within 48 hours.

[View Dispute]({{dispute_link}})
```

### 7. Dispute resolved — decision (→ Client)

**In-app:** `Your dispute for {{address}} has been resolved.`

**Subject:** `Your dispute has been resolved (Ref: {{dispute_ref}})`

**Body:**
```
Hi {{client_name}},

Your dispute has been reviewed and resolved:

Reference: {{dispute_ref}}
Address: {{address}}
Decision: {{dispute_decision_text}}

[View Details]({{dispute_link}})
```

### 8. Dispute resolved — decision (→ Scout)

**In-app:** `The dispute for {{address}} has been resolved.`

**Subject:** `Dispute resolution (Ref: {{dispute_ref}}) — {{address}}`

**Body:**
```
Hi {{scout_name}},

The dispute relating to your inspection has been resolved:

Reference: {{dispute_ref}}
Address: {{address}}
Decision: {{dispute_decision_text_scout}}

[View Details]({{dispute_link}})
```

### 9. Admin sends a message

**In-app:** `You have a new message from Spekto Admin.`

**Subject:** `New message from Spekto Admin{{#if inspection_ref}} (Ref: {{inspection_ref}}){{/if}}`

**Body:**
```
Hi {{recipient_name}},

Spekto Admin has sent you a message{{#if inspection_ref}} regarding
inspection {{inspection_ref}} — {{address}}{{/if}}.

[View Message]({{message_link}})
```

### 10. Scout accepts inspection (→ Client)

**In-app:** `Your inspection at {{address}} has been accepted by {{scout_name}}.`

**Subject:** `Your inspection has been accepted (Ref: {{inspection_ref}})`

**Body:**
```
Hi {{client_name}},

Good news — {{scout_name}} has accepted your inspection request.

Reference: {{inspection_ref}}
Address: {{address}}
Date: {{inspection_date}}
Time: {{inspection_time}}

[View Inspection]({{inspection_link}})
```

### 11. Payment receipt (→ Client, mandatory)

**Subject:** `Receipt — Spekto Inspection Payment (Ref: {{inspection_ref}})`

**Body:**
```
Hi {{client_name}},

This confirms your payment for the following inspection:

Reference: {{inspection_ref}}
Address: {{address}}
Date: {{inspection_date}}
Amount paid: {{amount}}
Payment method: {{payment_method_last4}}
Receipt number: {{receipt_number}}

[View Inspection]({{inspection_link}})

Thank you for using Spekto.
```

*Confirm whether Stripe's own emailed receipt (if email receipts are enabled on the Payment Element/Checkout) already covers this before building a custom send.*

### 12. Scout completes inspection (→ Client)

**In-app:** `Your inspection at {{address}} has been completed.`

**Subject:** `Your inspection is complete (Ref: {{inspection_ref}})`

**Body:**
```
Hi {{client_name}},

{{scout_name}} has completed your inspection.

Reference: {{inspection_ref}}
Address: {{address}}
Completed: {{completion_datetime}}

Your inspection report and video are ready to view.

[View Report]({{inspection_link}})
```

### 13. Client releases payment (→ Scout)

**In-app:** `Payment released for your inspection at {{address}}. Expect payout by Tuesday.`

**Subject:** `Payment released (Ref: {{inspection_ref}}) — {{address}}`

**Body:**
```
Hi {{scout_name}},

{{client_name}} has released payment for the inspection you completed.

Reference: {{inspection_ref}}
Address: {{address}}
Amount: {{scout_payout_amount}}
Expected payout date: {{payout_date}}

Payouts are processed in weekly batches each Tuesday.

[View Inspection]({{inspection_link}})
```

---

## 6. Bookmark Reference

| Bookmark | Source |
|---|---|
| `{{client_name}}` / `{{scout_name}}` / `{{recipient_name}}` | `users.full_name` |
| `{{address}}` | `inspections.address` |
| `{{inspection_ref}}` | `inspections.reference_number` (existing) |
| `{{dispute_ref}}` | `disputes` human-readable reference (confirm/add column) |
| `{{inspection_date}}` / `{{inspection_time}}` | `inspections.date` / `inspections.time` |
| `{{completion_datetime}}` | `inspections.updated_at` on status → Completed |
| `{{amount}}` / `{{scout_payout_amount}}` | `payments.amount` (client amount vs. Scout payout split) |
| `{{payment_method_last4}}` | Stripe payment method metadata |
| `{{receipt_number}}` | `payments.stripe_payment_intent_id` or sequential receipt ID |
| `{{payout_date}}` | Calculated — next Tuesday from release date |
| `{{distance}}` | Calculated at trigger time — Scout home address vs. inspection address |
| `{{dispute_reason}}` / `{{dispute_decision_text}}` / `{{dispute_decision_text_scout}}` | `disputes.reason` / resolution fields |
| `{{message_link}}` / `{{inspection_link}}` / `{{dispute_link}}` / `{{onboarding_link}}` / `{{new_inspection_link}}` / `{{inspections_list_link}}` | Constructed URLs to relevant screens |

---

## 7. Settings Screen

Render one toggle per row from `notification_types` joined to the current user's `notification_preferences`:

- Locked/disabled toggle (with "required" label) when `is_mandatory = true`
- Active toggle, bound to `email_enabled`, when `is_mandatory = false`

In-app delivery is never toggled off — only email delivery is user-controlled.

---

## 8. Open Items to Confirm During Implementation

1. Does `disputes` already have a human-readable reference column equivalent to `inspections.reference_number`? If not, add one.
2. How is "first login after verification" detected — new `users.welcomed_at` column, or derived from existing Auth session data?
3. Does Stripe's own receipt emailing (if enabled) make a custom #11 email redundant?
4. Confirm 50km radius calculation approach for #3 — DB trigger vs. scheduled job — and whether high-density areas need this batched into a digest rather than one email per posting.
5. Resend account + domain verification (`notifications@spekto.com.au` or similar) to be set up before `notify` function can send live email.
