import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { xeroPost, getOrCreateXeroContact } from '../_shared/xero-client.ts'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}
function ok(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('Unauthorized', 401)

  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authErr || !user) return err('Unauthorized', 401)

  // Verify admin
  const { data: adminRow } = await supabase.from('admins').select('id').eq('email', user.email).maybeSingle()
  if (!adminRow) return err('Forbidden', 403)

  // Get all PendingPayment inspections
  const { data: allPending } = await supabase
    .from('inspections')
    .select('id, address, scout_id, pricing_snapshot')
    .eq('status', 'PendingPayment')

  if (!allPending?.length) return ok({ batch_id: null, total: 0, processed: 0, skipped: 0, results: [] })

  // Exclude inspections already in an active/processing/paid batch item (allow re-batching of Failed items)
  const { data: existingItems } = await supabase
    .from('payout_batch_items')
    .select('inspection_id')
    .in('inspection_id', allPending.map(i => i.id))
    .in('status', ['Pending', 'Processing', 'Paid', 'OnHold'])

  const alreadyBatched = new Set((existingItems || []).map(i => i.inspection_id))
  const pendingInspections = allPending.filter(i => !alreadyBatched.has(i.id))

  if (!pendingInspections.length) {
    return ok({ batch_id: null, total: 0, processed: 0, skipped: 0, results: [], message: 'All pending inspections are already in a batch' })
  }

  // Create payout batch
  const now = new Date()
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const periodEnd = now.toISOString()
  const scheduledPayoutDate = now.toISOString().slice(0, 10)
  const batchRef = `BATCH-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const totalScoutPayouts = pendingInspections.reduce((s, i) => s + (parseFloat(i.pricing_snapshot?.pay_to_scout ?? '0')), 0)
  const { data: batch, error: batchErr } = await supabase
    .from('payout_batches')
    .insert({
      batch_reference: batchRef,
      status: 'Processing',
      period_start: periodStart,
      period_end: periodEnd,
      scheduled_payout_date: scheduledPayoutDate,
      total_amount: totalScoutPayouts,
      total_scout_payouts: totalScoutPayouts,
      created_by: user.id,
      created_at: now.toISOString(),
    })
    .select()
    .single()

  if (batchErr || !batch) return err('Failed to create batch: ' + (batchErr?.message ?? 'unknown'))

  const results: { inspection_id: string; status: string; transfer_id?: string; error?: string }[] = []
  let processed = 0
  let skipped = 0

  for (const insp of pendingInspections) {
    const scoutAmount = parseFloat(insp.pricing_snapshot?.pay_to_scout ?? '0')
    if (scoutAmount <= 0) {
      results.push({ inspection_id: insp.id, status: 'skipped', error: 'zero payout amount' })
      skipped++
      continue
    }

    // Get scout's Stripe account (stored on scout_profiles, not users)
    const { data: scout } = await supabase
      .from('scout_profiles')
      .select('stripe_account_id, stripe_payouts_enabled')
      .eq('user_id', insp.scout_id)
      .single()

    if (!scout?.stripe_account_id) {
      results.push({ inspection_id: insp.id, status: 'skipped', error: 'no Stripe Connect account' })
      skipped++
      continue
    }

    if (!scout?.stripe_payouts_enabled) {
      results.push({ inspection_id: insp.id, status: 'skipped', error: 'Stripe account not yet enabled for payouts' })
      skipped++
      continue
    }

    // Fetch payment record if it exists (nullable — legacy inspections may not have one)
    const { data: payment } = await supabase
      .from('payments')
      .select('id')
      .eq('inspection_id', insp.id)
      .maybeSingle()

    // Create batch item
    const { data: item, error: itemErr } = await supabase
      .from('payout_batch_items')
      .insert({
        batch_id: batch.id,
        inspection_id: insp.id,
        scout_id: insp.scout_id,
        payment_id: payment?.id ?? null,
        stripe_account_id: scout.stripe_account_id,
        scout_payout: scoutAmount,
        amount: scoutAmount,
        status: 'Pending',
        item_type: 'Payout',
        xero_sync_status: 'Pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (!item) {
      results.push({ inspection_id: insp.id, status: 'failed', error: 'could not create batch item: ' + (itemErr?.message ?? 'unknown') })
      continue
    }

    // Create Stripe Connect Transfer
    try {
      const transfer = await stripe.transfers.create({
        amount: Math.round(scoutAmount * 100),
        currency: 'aud',
        destination: scout.stripe_account_id,
        description: `Spekto payout — ${insp.address}`,
        metadata: { inspection_id: insp.id, batch_item_id: item.id, batch_id: batch.id },
      })

      await supabase
        .from('payout_batch_items')
        .update({ stripe_transfer_id: transfer.id, status: 'Paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', item.id)

      await supabase
        .from('inspections')
        .update({ status: 'Paid', updated_at: new Date().toISOString() })
        .eq('id', insp.id)

      results.push({ inspection_id: insp.id, status: 'paid', transfer_id: transfer.id })
      processed++

      // Xero sync — non-fatal
      try {
        const { data: scoutUser } = await supabase.from('users').select('email, first_name, last_name').eq('id', insp.scout_id).single()
        if (scoutUser) {
          const scoutName = `${scoutUser.first_name ?? ''} ${scoutUser.last_name ?? ''}`.trim() || scoutUser.email
          const contactId = await getOrCreateXeroContact(scoutUser.email, scoutName)
          if (contactId) {
            const xeroRes = await xeroPost('/Invoices', {
              Invoices: [{
                Type: 'ACCPAY',
                Contact: { ContactID: contactId },
                LineItems: [{
                  Description: `Spekto scout payout — ${insp.address}`,
                  Quantity: 1,
                  UnitAmount: scoutAmount,
                  AccountCode: '200',
                  TaxType: 'NONE',
                }],
                LineAmountTypes: 'EXCLUSIVE',
                Reference: `PAYOUT-${item.id}`,
                Status: 'AUTHORISED',
              }],
            })
            const xeroSync = xeroRes.ok ? 'Synced' : 'Failed'
            const xeroData = xeroRes.ok ? await xeroRes.json() : null
            if (!xeroRes.ok) console.error('Xero payout bill failed:', await xeroRes.text().catch(() => ''))
            await supabase.from('payout_batch_items').update({
              xero_bill_id: xeroData?.Invoices?.[0]?.InvoiceID ?? null,
              xero_sync_status: xeroSync,
              updated_at: new Date().toISOString(),
            }).eq('id', item.id)
          }
        }
      } catch (xeroErr: unknown) {
        console.error('Xero payout sync error (non-fatal):', xeroErr instanceof Error ? xeroErr.message : String(xeroErr))
      }
    } catch (stripeErr: unknown) {
      const msg = stripeErr instanceof Error ? stripeErr.message : String(stripeErr)
      await supabase
        .from('payout_batch_items')
        .update({ status: 'Failed', failure_reason: msg, updated_at: new Date().toISOString() })
        .eq('id', item.id)
      results.push({ inspection_id: insp.id, status: 'failed', error: msg })
    }
  }

  // Finalise batch
  await supabase
    .from('payout_batches')
    .update({
      status: processed > 0 ? 'Processed' : 'Failed',
      processed_at: new Date().toISOString(),
    })
    .eq('id', batch.id)

  return ok({ batch_id: batch.id, total: pendingInspections.length, processed, skipped, results })
})
