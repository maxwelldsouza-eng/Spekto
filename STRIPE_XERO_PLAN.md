# Spekto — Stripe & Xero Payment Architecture Plan

**Status:** Design agreed, not yet built. This supersedes any earlier, more tentative discussion of Stripe Invoicing / Hosted Invoice Pages for the Client — that approach was considered and explicitly rejected in favour of the seamless, charge-immediately model described below. If any earlier notes or chat history reference Stripe's Invoicing product as the Client-facing mechanism, they are outdated; this document is the current source of truth.

**Core principle driving this design:** Payment should be seamless — the Client is never asked to "go pay an invoice." Charging happens automatically at the right trigger points in the existing inspection lifecycle. Stripe is the payment rail; Xero is the accounting system of record; Spekto's own backend is the orchestrator that keeps both in sync via webhooks, not a third-party connector like Zapier.

---

## 0. Prerequisites (one-time setup, not yet done)

- [ ] Stripe account created (test/sandbox mode is sufficient to build all of this — no business verification needed yet)
- [ ] Stripe Connect enabled on the platform account
- [ ] Xero account/organisation set up, with API access (Xero Developer app registered for OAuth)
- [ ] ABN obtained (sole trader or company — required for GST-compliant receipts/invoices either way)
- [ ] GST registration status confirmed (changes whether GST is itemized)
- [ ] Decision: does the Client save a card at registration, or at first inspection request? (Either is fine technically — pick based on desired UX friction.)

---

## 1. End-to-End Flow

### Step 1 — Client saves a payment method
**When:** At registration, or at first inspection request (decide and document which).
**Stripe:** Create a Stripe Customer for the Client (store `stripe_customer_id` on `users` or `client_profiles`). Use a **Setup Intent** to securely save their card without charging anything yet.
**Xero:** Not involved.
**Spekto DB:** Store `stripe_customer_id` against the Client.

### Step 2 — Scout completes Connect onboarding
**When:** At Scout registration, or before their first job acceptance (must happen before they can be paid — consider gating "Accept Job" on onboarding completion).
**Stripe:** Create a Stripe **Connect Express (or Standard) account** for the Scout. Redirect them through Stripe's hosted onboarding flow to collect bank details and identity verification. Store `stripe_account_id` (the `stripe_account_id` column already exists on the schema).
**Xero:** Not involved.
**Spekto DB:** Store `stripe_account_id` against the Scout. Track onboarding completion status (Stripe provides a webhook/flag for this — `account.updated` with `charges_enabled`/`payouts_enabled`).

### Step 3 — Client requests an inspection → charged immediately
**When:** The moment the Client submits the "New Inspection" form.
**Sequence (must happen in this order, with the inspection only finalized as `Posted` if payment succeeds):**
1. Create the `inspections` row with a transient/pending state (do not mark `Posted` yet).
2. Create a Stripe **Payment Intent** for the calculated total (per existing `pricing` table logic), using the Client's saved `stripe_customer_id` and payment method, and **confirm it immediately** (off-session or on-session depending on saved-card flow).
3. **If the charge succeeds:** update `inspections.status = 'Posted'`, store the Stripe receipt URL / Payment Intent ID against a new row in `payments`.
4. **If the charge fails** (declined card, insufficient funds, etc.): do **not** mark the inspection as `Posted`. Set a `PaymentFailed` state (new status value — needs adding to the `inspections` status enum/CHECK constraint if one exists) and surface a clear retry path to the Client (e.g. "update payment method and retry") rather than leaving the request silently stuck.
**Stripe artifact for the Client:** Use Stripe's auto-generated **receipt** (itemized with GST), not the separate Stripe Invoicing/Hosted Invoice Page product — a receipt is sufficient for amounts in Spekto's range and matches the "seamless, no separate pay step" requirement. Store the receipt URL (note: Stripe receipt URLs are also time-limited in some cases — verify expiry behavior and re-fetch on demand rather than caching forever, the same caveat that applied to Hosted Invoice Page URLs).
**Where the Client sees it:** `client/billing.html` — add a row per inspection with a "View Receipt" link, fetching a fresh URL from Stripe's API at click time rather than relying on a stored, potentially-expired link.

### Step 4 — Spekto pushes the payment to Xero
**When:** Triggered by Stripe's `payment_intent.succeeded` webhook (not polled, not via Zapier).
**Mechanism:** A Supabase Edge Function listens for this webhook, then calls Xero's API directly to create a matching invoice/sales record (or an already-paid invoice, since the money has already moved) attributed to the Client.
**Why a direct Edge Function call instead of a third-party connector (Zapier etc.):** Third-party connectors are an extra point of failure outside your own logging/retry control — if the connector's auth token expires or it hits a rate limit, real revenue could go unrecorded in Xero with no visibility. A direct webhook → Edge Function → Xero API call keeps this within Spekto's own observable, retryable infrastructure.
**Spekto DB:** Store the Xero invoice/transaction ID against the `payments` row for traceability and to support the refund flow (Section 5) later.

### Step 5 — Scout accepts, records, submits
No Stripe or Xero involvement. Existing logic (`Accepted → InProgress → Completed`), already built and working as of this handoff.

### Step 6 — Client views completed inspection and clicks "Release Payment"
No Stripe or Xero involvement at this exact moment — this is purely a Spekto-side approval step (the money was already collected from the Client back in Step 3; "release" here means authorizing payout to the Scout, not collecting from the Client again).
**Spekto DB:** `inspections.status → 'PendingPayment'` (this status already exists and is used this way).

### Step 7 — Inspection marked Payment Pending to Scout
Matches existing `PendingPayment` status and `payout_batch_items` table structure — no new schema needed, this is already modeled correctly.

### Step 8 — Weekly manual batch trigger
**Where:** `admin/payouts.html` (already exists, built around this exact "Tuesday batch" concept).
**Mechanism:** Admin clicks a button that gathers all `PendingPayment` inspections not already in a batch, creates a `payout_batches` row, and a `payout_batch_items` row per inspection.
**Note:** `prevent_disputed_batch_entry` trigger already correctly blocks disputed inspections from entering a batch — confirm this still behaves correctly once real Stripe transfers are wired in underneath it.

### Step 9 — Stripe pays the Scout; receipt surfaces in the app
**Mechanism:** For each `payout_batch_item`, create a Stripe Connect **Transfer** to the Scout's `stripe_account_id` for their payout amount (per the existing pricing split).
**Receipt:** Stripe's transfer confirmation becomes the Scout's "payment receipt" — store the Transfer ID against the specific `payout_batch_item` / inspection.
**Where the Scout sees it:** `scout/earnings.html` — show a receipt/confirmation per paid job, fetched fresh from Stripe at view time (same expiry caution as Step 3's receipts).

### Step 10 — Spekto pushes the payout to Xero
**When:** Triggered by Stripe's transfer-succeeded webhook.
**Mechanism:** Same direct-Edge-Function pattern as Step 4 — book this as an expense/bill in Xero against the Scout, so Xero reflects actual money paid out, not just money collected.
**Spekto DB:** Store the Xero bill/transaction ID against the `payout_batch_item` row.

---

## 2. Refunds (Full and Partial) — Design Principles

This is flagged as its own, more complex piece of work — **do not attempt to build this as a quick addition to Steps 1–10. Build and fully test the core flow above first.**

### Core rule: refunds are new rows, never edits to existing rows
A refund must never modify the original `payments` row's amount. Instead, create a **new row** representing the refund, referencing the original payment (e.g. `payments.refund_of_payment_id` or similar — schema TBD). This means the full transaction history is always reconstructable by reading the rows in order:
```
Original charge:    $60.00
Partial refund:    -$20.00
------------------------
Net to Client:       $40.00
```
...rather than a single row that's been overwritten and lost its own history.

### Both sides need this treatment
- **Client-side refund:** A Stripe **Refund** object against the original Payment Intent. New row in `payments` (or a dedicated `refunds` table — check which fits the existing schema better) recording the refund amount, reason, and linkage to the original charge and to the dispute that triggered it (`disputes.resolution` already has values like `FullRefundToClient`, `PartialRefundToClient` — this is where they connect).
- **Scout-side adjustment:** If a dispute results in `PartialPaymentToScout` or `NoActionRequired` (i.e., the Scout's payout is reduced or withheld), this needs its own row too — not just a silent change to what gets included in the next payout batch. The Scout should be able to see, after the fact, "you were paid $35 originally, then $15 was withheld due to dispute resolution" as two distinct visible records, not one quietly-smaller number with no explanation.

### Xero must reflect this as credit notes, not edited invoices
Xero has native support for **credit notes** against an existing invoice — a refund should create a credit note in Xero linked to the original invoice, not modify the original invoice's recorded amount. This preserves the same "every transaction is its own row" principle inside Xero itself, matching the Spekto-side design.

### Where this connects to existing admin tooling
This entire section is the backend implementation of the resolution actions already designed in `admin/dispute-detail.html` (Full refund to Client / Partial refund / Release to Scout / Dismiss) — those buttons currently exist as UI concepts; this is the missing logic that needs to sit behind them once Stripe/Xero are live. **Do not build the resolution buttons' real logic until Steps 1–10 above are working end-to-end and tested**, since refund logic depends on the original charge/payout records already existing in a known-good shape.

---

## 3. Build Sequencing Recommendation

1. Stripe Customer + Setup Intent (Client card save) — Step 1
2. Stripe Connect onboarding (Scout) — Step 2
3. Payment Intent charge on inspection creation, including the `PaymentFailed` path — Step 3
4. Stripe → Xero sync via webhook + Edge Function for the Client charge — Step 4
5. Connect Transfer for Scout payout, wired into the existing `admin/payouts.html` batch flow — Steps 7–9
6. Stripe → Xero sync via webhook + Edge Function for the Scout payout — Step 10
7. **Stop and test the entire above flow end-to-end with real test-mode transactions before touching refunds.**
8. Refunds: schema design first (new table or new columns — decide and document), then Stripe Refund + Xero credit note logic, then wire into the admin dispute resolution buttons.

---

## 4. Open Decisions Not Yet Made

- Client card save timing: registration vs. first inspection request.
- Exact schema shape for refund records (new `refunds` table vs. additional columns/rows in `payments`) — decide before Section 2 work begins.
- Whether Scout Connect onboarding blocks job acceptance until complete, or is enforced some other way.
- Whether to add a `PaymentFailed` inspection status to the existing CHECK constraint (if one exists on `inspections.status`) — confirm current constraint values before assuming this is a simple addition.
- Receipt/document URL expiry handling — confirm Stripe's actual expiry behavior for receipts (not just Hosted Invoice Pages, which were ruled out) before deciding whether to cache URLs at all or always fetch fresh.
