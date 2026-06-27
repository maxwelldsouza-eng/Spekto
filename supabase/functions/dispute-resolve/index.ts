import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { xeroPost, xeroGet } from '../_shared/xero-client.ts'

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

async function getOrCreateXeroContact(email: string, name: string): Promise<string> {
  const searchRes = await xeroGet(`/Contacts?where=EmailAddress="${encodeURIComponent(email)}"`)
  if (searchRes.ok) {
    const data = await searchRes.json()
    if (data.Contacts?.length > 0) return data.Contacts[0].ContactID
  }
  const createRes = await xeroPost('/Contacts', { Contacts: [{ Name: name || email, EmailAddress: email }] })
  const createData = await createRes.json()
  return createData.Contacts[0].ContactID
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('Unauthorized', 401)

  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authErr || !user) return err('Unauthorized', 401)

  const { data: adminRow } = await supabase.from('admins').select('id').eq('email', user.email).maybeSingle()
  if (!adminRow) return err('Forbidden', 403)

  const body = await req.json()
  const { dispute_id, resolution, client_notes, scout_notes, partial_refund_amount } = body

  if (!dispute_id || !resolution) return err('Missing dispute_id or resolution')

  // Load dispute + inspection + original charge payment
  const { data: dispute, error: disputeErr } = await supabase
    .from('disputes')
    .select('id, inspection_id, status')
    .eq('id', dispute_id)
    .single()

  if (disputeErr || !dispute) return err('Dispute not found', 404)
  if (['Resolved', 'Dismissed'].includes(dispute.status)) return err('Dispute already resolved')

  const { data: inspection } = await supabase
    .from('inspections')
    .select('id, address, client_id, scout_id')
    .eq('id', dispute.inspection_id)
    .single()

  const { data: originalPayment } = await supabase
    .from('payments')
    .select('id, stripe_payment_intent_id, amount, spekto_fee_ex_gst, gst, xero_invoice_id, client_id')
    .eq('inspection_id', dispute.inspection_id)
    .eq('payment_type', 'Charge')
    .eq('status', 'Completed')
    .maybeSingle()

  const now = new Date().toISOString()
  const today = now.split('T')[0]

  // ── Update dispute ──────────────────────────────────────────────────────────
  const { error: updateErr } = await supabase
    .from('disputes')
    .update({
      status: 'Resolved',
      resolution,
      resolution_notes: client_notes || scout_notes || null,
      resolved_by: adminRow.id,
      resolved_at: now,
      updated_at: now,
    })
    .eq('id', dispute_id)

  if (updateErr) return err('Failed to update dispute: ' + updateErr.message)

  // ── Log admin action ────────────────────────────────────────────────────────
  await supabase.from('admin_actions').insert({
    admin_id: adminRow.id,
    action_type: 'DisputeResolution',
    target_table: 'disputes',
    target_id: dispute_id,
    new_value: resolution,
    notes: client_notes || scout_notes || null,
  })

  // ── Handle each resolution type ─────────────────────────────────────────────
  const isFullRefund = resolution === 'FullRefundToClient'
  const isPartialRefund = resolution === 'PartialRefundToClient'
  const isRelease = resolution === 'PaymentReleasedToScout'
  const isFraud = resolution === 'WithheldFraud'

  if (isFullRefund || isPartialRefund || isFraud) {
    if (!originalPayment?.stripe_payment_intent_id) {
      // No payment on record (draft inspection) — just cancel
      await supabase.from('inspections').update({ status: isFraud ? 'Cancelled' : 'PendingPayment', updated_at: now }).eq('id', dispute.inspection_id)
      await notifyDisputeParties(dispute.inspection_id, inspection?.client_id, inspection?.scout_id, resolution, client_notes, scout_notes)
      return ok({ success: true, refunded: false, note: 'No Stripe payment found — inspection cancelled without charge reversal' })
    }

    const refundAmount = (isFullRefund || isFraud)
      ? originalPayment.amount
      : Math.min(parseFloat(partial_refund_amount ?? '0'), originalPayment.amount)

    if (refundAmount <= 0) return err('Refund amount must be greater than zero')

    // Stripe refund
    let stripeRefundId: string | null = null
    try {
      const refund = await stripe.refunds.create({
        payment_intent: originalPayment.stripe_payment_intent_id,
        amount: Math.round(refundAmount * 100),
        reason: 'requested_by_customer',
        metadata: { dispute_id, resolution, admin_id: adminRow.id },
      })
      stripeRefundId = refund.id
    } catch (stripeErr: unknown) {
      const msg = stripeErr instanceof Error ? stripeErr.message : String(stripeErr)
      return err('Stripe refund failed: ' + msg)
    }

    // Record refund in payments ledger (new row, never edit original)
    const refundExGst = Math.round((refundAmount / 1.1) * 100) / 100
    const { data: refundPayment } = await supabase
      .from('payments')
      .insert({
        inspection_id: dispute.inspection_id,
        client_id: originalPayment.client_id,
        amount: -refundAmount,
        spekto_fee_ex_gst: -refundExGst,
        gst: -(refundAmount - refundExGst),
        currency: 'aud',
        status: 'Refunded',
        payment_type: isFullRefund ? 'Refund' : 'PartialRefund',
        stripe_refund_id: stripeRefundId,
        related_payment_id: originalPayment.id,
        xero_sync_status: 'Pending',
        created_at: now,
        updated_at: now,
      })
      .select()
      .single()

    // Update inspection status
    await supabase.from('inspections').update({ status: isFraud ? 'Cancelled' : 'PendingPayment', updated_at: now }).eq('id', dispute.inspection_id)

    // Flag scout account on fraud
    if (isFraud && inspection?.scout_id) {
      await supabase
        .from('users')
        .update({ is_active: false, updated_at: now })
        .eq('id', inspection.scout_id)
      await supabase
        .from('scout_profiles')
        .update({ scout_status: 'Suspended', updated_at: now })
        .eq('user_id', inspection.scout_id)
    }

    // Xero credit note (non-fatal)
    if (refundPayment && originalPayment.xero_invoice_id) {
      try {
        const { data: clientUser } = await supabase.from('users').select('email, first_name, last_name').eq('id', originalPayment.client_id).single()
        if (clientUser) {
          const clientName = `${clientUser.first_name ?? ''} ${clientUser.last_name ?? ''}`.trim() || clientUser.email
          const contactId = await getOrCreateXeroContact(clientUser.email, clientName)

          const cnRes = await xeroPost('/CreditNotes', {
            CreditNotes: [{
              Type: 'ACCREC',
              Contact: { ContactID: contactId },
              Date: today,
              DueDate: today,
              Status: 'AUTHORISED',
              CurrencyCode: 'AUD',
              Reference: `REFUND-${dispute_id.substring(0, 8).toUpperCase()}`,
              LineItems: [{
                Description: `${isFullRefund ? 'Full' : 'Partial'} refund — ${inspection?.address ?? dispute.inspection_id}`,
                Quantity: 1,
                UnitAmount: refundAmount,
                AccountCode: '200',
              }],
            }],
          })

          if (cnRes.ok) {
            const cnData = await cnRes.json()
            const cnId = cnData.CreditNotes?.[0]?.CreditNoteID
            if (cnId) {
              await supabase
                .from('payments')
                .update({ xero_invoice_id: cnId, xero_sync_status: 'Synced' })
                .eq('id', refundPayment.id)
            }
          }
        }
      } catch (xeroErr) {
        console.error('Xero credit note failed:', xeroErr)
        if (refundPayment) {
          await supabase.from('payments').update({ xero_sync_status: 'Failed' }).eq('id', refundPayment.id)
        }
      }
    }

    await notifyDisputeParties(dispute.inspection_id, inspection?.client_id, inspection?.scout_id, resolution, client_notes, scout_notes, refundAmount)
    return ok({ success: true, refunded: true, stripe_refund_id: stripeRefundId, amount: refundAmount })
  }

  if (isRelease) {
    await supabase.from('inspections').update({ status: 'PendingPayment', updated_at: now }).eq('id', dispute.inspection_id)
    await notifyDisputeParties(dispute.inspection_id, inspection?.client_id, inspection?.scout_id, resolution, client_notes, scout_notes)
    return ok({ success: true })
  }

  await notifyDisputeParties(dispute.inspection_id, inspection?.client_id, inspection?.scout_id, resolution, client_notes, scout_notes)
  return ok({ success: true })
})

const CLIENT_DECISION: Record<string, string> = {
  FullRefundToClient: 'Full refund issued — amount will appear within 5–10 business days.',
  PartialRefundToClient: 'Partial refund issued — amount will appear within 5–10 business days.',
  PaymentReleasedToScout: 'Payment has been released to the Scout.',
  WithheldFraud: 'Full refund issued — amount will appear within 5–10 business days.',
}
const SCOUT_DECISION: Record<string, string> = {
  FullRefundToClient: 'A full refund was issued to the client. Your payout for this job is included in the next payout batch.',
  PartialRefundToClient: 'A partial refund was issued to the client. Your payout for this job is included in the next payout batch.',
  PaymentReleasedToScout: 'Resolved in your favour — payment included in the next payout batch.',
  WithheldFraud: 'Account suspended due to fraud determination. Contact support if you believe this is an error.',
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

async function notifyDisputeParties(
  inspection_id: string,
  client_id?: string,
  scout_id?: string,
  resolution?: string,
  client_notes?: string | null,
  scout_notes?: string | null,
  refundAmount?: number,
) {
  const clientDecision = (CLIENT_DECISION[resolution ?? ''] ?? 'Dispute resolved.') +
    (refundAmount ? ` Refund: $${refundAmount.toFixed(2)}.` : '') +
    (client_notes ? ` Admin note: ${client_notes}` : '')
  const scoutDecision = (SCOUT_DECISION[resolution ?? ''] ?? 'Dispute resolved.') +
    (scout_notes ? ` Admin note: ${scout_notes}` : '')

  const promises: Promise<void>[] = []
  if (client_id) promises.push(callNotify({ user_id: client_id, type: 'dispute_resolved_client', inspection_id, extra: { decision_text: clientDecision } }))
  if (scout_id) promises.push(callNotify({ user_id: scout_id, type: 'dispute_resolved_scout', inspection_id, extra: { decision_text: scoutDecision } }))
  await Promise.all(promises)
}
