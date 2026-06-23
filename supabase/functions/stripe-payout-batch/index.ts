import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

  // Exclude inspections already in a non-failed batch item
  const { data: existingItems } = await supabase
    .from('payout_batch_items')
    .select('inspection_id')
    .in('inspection_id', allPending.map(i => i.id))
    .not('status', 'eq', 'failed')

  const alreadyBatched = new Set((existingItems || []).map(i => i.inspection_id))
  const pendingInspections = allPending.filter(i => !alreadyBatched.has(i.id))

  if (!pendingInspections.length) {
    return ok({ batch_id: null, total: 0, processed: 0, skipped: 0, results: [], message: 'All pending inspections are already in a batch' })
  }

  // Create payout batch
  const { data: batch, error: batchErr } = await supabase
    .from('payout_batches')
    .insert({
      status: 'Processing',
      total_amount: pendingInspections.reduce((s, i) => s + (parseFloat(i.pricing_snapshot?.pay_to_scout ?? '0')), 0),
      created_by: user.id,
      created_at: new Date().toISOString(),
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

    // Get scout's Stripe account
    const { data: scout } = await supabase
      .from('users')
      .select('stripe_account_id')
      .eq('id', insp.scout_id)
      .single()

    if (!scout?.stripe_account_id) {
      results.push({ inspection_id: insp.id, status: 'skipped', error: 'no Stripe Connect account' })
      skipped++
      continue
    }

    // Create batch item
    const { data: item } = await supabase
      .from('payout_batch_items')
      .insert({
        batch_id: batch.id,
        inspection_id: insp.id,
        scout_id: insp.scout_id,
        amount: scoutAmount,
        status: 'pending',
        item_type: 'Payout',
        xero_sync_status: 'Pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (!item) {
      results.push({ inspection_id: insp.id, status: 'failed', error: 'could not create batch item' })
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
        .update({ stripe_transfer_id: transfer.id, status: 'processing', updated_at: new Date().toISOString() })
        .eq('id', item.id)

      results.push({ inspection_id: insp.id, status: 'paid', transfer_id: transfer.id })
      processed++
    } catch (stripeErr: unknown) {
      const msg = stripeErr instanceof Error ? stripeErr.message : String(stripeErr)
      await supabase
        .from('payout_batch_items')
        .update({ status: 'failed', failure_reason: msg, updated_at: new Date().toISOString() })
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
