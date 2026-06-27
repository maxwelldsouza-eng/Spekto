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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  })
}
function ok(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

async function callNotify(params: { user_id: string; type: string; inspection_id?: string; extra?: Record<string, string> }): Promise<void> {
  try {
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/notify`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
  } catch (e: unknown) { console.error('[callNotify] error:', e instanceof Error ? e.message : String(e)) }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('Unauthorized', 401)

  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authErr || !user) return err('Unauthorized', 401)

  const { inspection_id } = await req.json()
  if (!inspection_id) return err('Missing inspection_id')

  // Load inspection — must belong to this client and be in Posted status
  const { data: inspection } = await supabase
    .from('inspections')
    .select('id, address, status, client_id, ref_number')
    .eq('id', inspection_id)
    .eq('client_id', user.id)
    .single()

  if (!inspection) return err('Inspection not found', 404)
  if (inspection.status !== 'Posted') return err(`Cannot cancel an inspection with status "${inspection.status}"`)

  const now = new Date().toISOString()
  const today = now.split('T')[0]

  // Load the completed charge payment
  const { data: payment } = await supabase
    .from('payments')
    .select('id, amount, stripe_payment_intent_id, xero_invoice_id')
    .eq('inspection_id', inspection_id)
    .eq('payment_type', 'Charge')
    .eq('status', 'Completed')
    .maybeSingle()

  if (!payment?.stripe_payment_intent_id) {
    // No payment on record — just cancel
    await supabase.from('inspections')
      .update({ status: 'Cancelled', cancelled_at: now, cancelled_by: user.id, updated_at: now })
      .eq('id', inspection_id)
    return ok({ success: true, refunded: false })
  }

  const refundAmount = parseFloat(payment.amount)

  // Issue Stripe refund
  let stripeRefundId: string
  try {
    const refund = await stripe.refunds.create({
      payment_intent: payment.stripe_payment_intent_id,
      reason: 'requested_by_customer',
      metadata: { inspection_id, cancelled_by: user.id },
    })
    stripeRefundId = refund.id
  } catch (stripeErr: unknown) {
    const msg = stripeErr instanceof Error ? stripeErr.message : String(stripeErr)
    return err('Stripe refund failed: ' + msg)
  }

  // Record refund payment row
  const { data: refundPayment } = await supabase.from('payments').insert({
    inspection_id,
    client_id: user.id,
    amount: -refundAmount,
    currency: 'aud',
    status: 'Refunded',
    payment_type: 'Refund',
    stripe_refund_id: stripeRefundId,
    related_payment_id: payment.id,
    xero_sync_status: 'Pending',
    created_at: now,
    updated_at: now,
  }).select().single()

  // Cancel inspection + mark original payment refunded
  await Promise.all([
    supabase.from('inspections')
      .update({ status: 'Cancelled', cancelled_at: now, cancelled_by: user.id, updated_at: now })
      .eq('id', inspection_id),
    supabase.from('payments')
      .update({ status: 'Refunded', updated_at: now })
      .eq('id', payment.id),
  ])

  // Xero credit note — non-fatal
  if (refundPayment) {
    try {
      const { data: client } = await supabase.from('users')
        .select('email, first_name, last_name')
        .eq('id', user.id)
        .single()
      if (client) {
        const clientName = `${client.first_name ?? ''} ${client.last_name ?? ''}`.trim() || client.email
        const contactId = await getOrCreateXeroContact(client.email, clientName)
        if (contactId) {
          const cnRes = await xeroPost('/CreditNotes', {
            CreditNotes: [{
              Type: 'ACCREC',
              Contact: { ContactID: contactId },
              Date: today,
              DueDate: today,
              Status: 'AUTHORISED',
              CurrencyCode: 'AUD',
              Reference: `CANCEL-${inspection_id.substring(0, 8).toUpperCase()}`,
              LineItems: [{
                Description: `Cancelled inspection refund — ${inspection.address}`,
                Quantity: 1,
                UnitAmount: refundAmount,
                AccountCode: '200',
              }],
            }],
          })
          const xeroSync = cnRes.ok ? 'Synced' : 'Failed'
          const xeroData = cnRes.ok ? await cnRes.json() : null
          if (!cnRes.ok) console.error('Xero credit note failed:', await cnRes.text().catch(() => ''))
          await supabase.from('payments').update({
            xero_invoice_id: xeroData?.CreditNotes?.[0]?.CreditNoteID ?? null,
            xero_sync_status: xeroSync,
            updated_at: now,
          }).eq('id', refundPayment.id)
        }
      }
    } catch (xeroErr: unknown) {
      console.error('Xero credit note error (non-fatal):', xeroErr instanceof Error ? xeroErr.message : String(xeroErr))
    }
  }

  await callNotify({ user_id: user.id, type: 'inspection_cancelled_refund', inspection_id, extra: { amount: refundAmount.toFixed(2) } })

  return ok({ success: true, refunded: true, refund_amount: refundAmount, stripe_refund_id: stripeRefundId })
})
