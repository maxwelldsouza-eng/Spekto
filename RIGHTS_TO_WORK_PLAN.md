# RIGHTS_TO_WORK_PLAN.md

## Overview

Build a Rights to Work compliance feature for Spekto that verifies a Scout's legal right to work in Australia via the vSure VEVO API, gates job acceptance on a valid result, keeps a full historical record for compliance, and gives Admins a queue to handle exceptions.

This applies to every Scout. The passport uploaded at signup determines the path:
- **Australian passport** → DVS document check only. Treated as having unrestricted work rights. No VEVO check required.
- **Foreign passport** → DVS document check on the passport, PLUS a vSure VEVO work-rights check.

---

## 1. Database schema (Supabase / Postgres)

Create a new table `rights_to_work`. This is an append-only history table — never update a row's check result in place. Every new submission inserts a new row and marks the previous current row as no longer current.

```sql
create table rights_to_work (
  id uuid primary key default gen_random_uuid(),
  scout_id uuid not null references scouts(id),

  -- Document details (encrypt passport_number at rest)
  passport_number text not null,
  passport_country text not null, -- ISO-3 code, e.g. 'AUS', 'IND'
  given_name text not null,
  family_name text not null,
  date_of_birth date not null,

  -- Path taken
  check_type text not null check (check_type in ('citizen_au_passport', 'vevo_work_check')),

  -- vSure API response data (null if check_type = citizen_au_passport)
  vsure_check_id text,
  vsure_status text not null check (vsure_status in (
    'pending',
    'verified_unlimited',
    'verified_limited',
    'no_rights',
    'citizen_pr',
    'mismatch',
    'failed_technical'
  )),
  work_entitlement_raw text,
  visa_type_name text,
  visa_conditions text,
  visa_expiry_date date,
  checked_at timestamptz,

  -- Admin override / exception handling
  admin_decision text check (admin_decision in ('pending_review', 'allowed', 'denied')),
  admin_id uuid references admins(id),
  admin_note text,
  admin_decided_at timestamptz,

  -- Record state
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_rights_to_work_scout_current on rights_to_work (scout_id) where is_current = true;
create index idx_rights_to_work_expiry on rights_to_work (visa_expiry_date) where is_current = true;
```

### RLS policies
- Scouts: can `select` and `insert` only their own rows. No `update`/`delete` (history is immutable from the Scout's side).
- Admins: full `select`/`update` access (for admin_decision, admin_note fields only).

---

## 2. vSure API integration (Supabase Edge Function)

Create an Edge Function `check-work-rights` that:

1. Receives: `scout_id`, `passport_number`, `passport_country`, `given_name`, `family_name`, `date_of_birth`
2. If `passport_country === 'AUS'`:
   - Insert a row with `check_type = 'citizen_au_passport'`, `vsure_status = 'citizen_pr'`, skip the API call entirely
3. Else, call vSure v2 API:

```
POST https://platform.vsure.com.au/v2/visa-checks
Authorization: Bearer {VSURE_ACCESS_TOKEN}
Version: 2024-03-05
Content-Type: application/json

{
  "jurisdiction": "AUS",
  "environment": "production", // or "sandbox" while testing
  "mode": "fastcheck",
  "visa_check_schema": "australia",
  "australia": {
    "visa_check_type": "work"
  },
  "document": {
    "type": "passport",
    "country": "{passport_country}",
    "identifier": "{passport_number}",
    "given_name": "{given_name}",
    "family_name": "{family_name}",
    "date_of_birth": "{date_of_birth}" // yyyy-mm-dd
  }
}
```

4. Map the response to `vsure_status`:

| vSure response | vsure_status | admin_decision |
|---|---|---|
| `visa.australia.type_name = "Australian Permanent Resident or Citizen"` | `citizen_pr` | `allowed` (auto) |
| `work_entitlement` indicates unlimited rights | `verified_unlimited` | `allowed` (auto) |
| `work_entitlement = "LIMITED"` | `verified_limited` | `pending_review` |
| No work entitlement / visa has no work rights | `no_rights` | `denied` (hard block, auto) |
| VEVO could not identify the person ("Check DOB and passport data") | `mismatch` | `pending_review` |
| API/network error, VEVO unavailable, timeout | `failed_technical` | `pending_review` |

5. Insert the new row, set all previous rows for that `scout_id` to `is_current = false`, set this new row `is_current = true`.
6. Return the result to the calling client (success / which status / error message).

### Failure messaging to Scout
If `vsure_status = 'failed_technical'`, show in the Scout app:
> "We couldn't verify your work rights right now. Your account has been flagged for manual review — you'll be notified once it's resolved."

If `vsure_status = 'no_rights'`:
> "Your submitted details indicate you don't currently have work rights in Australia. Please contact support if you believe this is incorrect."

---

## 3. Scout Settings — Rights to Work section

New section in Scout Settings (`scout/settings.html` or equivalent):

- Shows current status: Verified ✅ / Pending Review ⏳ / Action Required ⚠️ / Expired ❌
- If foreign passport and a current record exists: show visa type, expiry date, days remaining
- "Update Rights to Work Details" button — opens a form to submit a new passport (photo upload + fields: passport number, country, given name, family name, DOB)
- Submitting triggers `check-work-rights` Edge Function and creates a new history row
- Previous submissions remain visible in a collapsed "History" list (read-only) for the Scout's own reference, but cannot be edited

---

## 4. Job acceptance guard

Wherever a Scout taps "Accept" on a job:

1. Query `rights_to_work` for `scout_id` where `is_current = true`
2. Allow accept only if:
   - `vsure_status in ('citizen_pr', 'verified_unlimited')`, OR
   - `admin_decision = 'allowed'` (covers limited-rights or mismatch cases an admin manually approved)
   - AND `visa_expiry_date` is null OR in the future
3. Otherwise block the Accept action with a message:
   > "You need to complete or update your Rights to Work verification before accepting jobs."

---

## 5. Admin Portal — Rights to Work section

New admin page, e.g. `admin/rights-to-work.html`:

- **Queue view**, filterable by status:
  - `failed_technical` (Technical Failures)
  - `mismatch` (Data Mismatches)
  - `verified_limited` (Limited Rights — needs judgment call)
  - `no_rights` (Hard Blocked — informational, no action needed unless overriding)
- Each row: Scout name, avatar, passport country, visa type, expiry date, vsure_status, submitted date
- Click into a row → detail view showing full vSure response, passport details, and an **Allow / Deny** action with a mandatory note field
- Action writes to `admin_decision`, `admin_id`, `admin_note`, `admin_decided_at` on that row

---

## 6. Expiry reminders

### Scheduled job (Supabase Cron / Edge Function, daily)

Query all `is_current = true` rows where `visa_expiry_date` is within 60, 30, or 14 days of today (and not already actioned today).

For each match:
1. **Admin reminder list** — surface in Admin → Rights to Work under a "Expiring Soon" tab, sorted by soonest expiry.
2. **Scout email notification** — send via your existing email provider:
   > Subject: Your Spekto work rights verification is expiring soon
   > Body: "Your visa-based work rights verification expires on {date}. Please update your details in Settings before this date to keep accepting jobs without interruption."

Track sent reminders (e.g. a `reminder_sent_30d`, `reminder_sent_14d` boolean on the row, or a separate `reminder_log` table) to avoid duplicate sends.

---

## 7. Environment variables needed

```
VSURE_ACCESS_TOKEN=
VSURE_ENVIRONMENT=sandbox  # change to production when live
```

---

## Build order recommendation for Claude Code

1. `rights_to_work` table + RLS policies
2. `check-work-rights` Edge Function (sandbox mode first)
3. Scout Settings UI — submission form + status display
4. Job acceptance guard (wire into existing Accept button logic)
5. Admin Rights to Work queue page + Allow/Deny action
6. Scheduled expiry-reminder job + email notification
