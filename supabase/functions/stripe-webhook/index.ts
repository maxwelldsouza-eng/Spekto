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

async function logEvent(
  eventId: string,
  eventType: string,
  payload: unknown,
  error?: string,
) {
  await supabase.from('webhook_events').upsert(
    {
      source: 'stripe',
      event_type: eventType,
      event_id: eventId,
      payload,
      processed: !error,
      processed_at: new Date().toISOString(),
      error: error ?? null,
    },
    { onConflict: 'event_id' },
  )
}

async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent) {
  const { data: payment } = await supabase
    .from('payments')
    .select('id, inspection_id')
    .eq('stripe_payment_intent_id', pi.id)
    .maybeSingle()

  if (!payment) return

  await Promise.all([
    supabase
      .from('payments')
      .update({ status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', payment.id),
    supabase
      .from('inspections')
      .update({ status: 'Paid', updated_at: new Date().toISOString() })
      .eq('id', payment.inspection_id)
      .in('status', ['PendingPayment', 'Disputed']),
  ])
}

async function handlePaymentIntentFailed(pi: Stripe.PaymentIntent) {
  const lastError = pi.last_payment_error?.message ?? 'Payment failed'

  const { data: payment } = await supabase
    .from('payments')
    .select('id')
    .eq('stripe_payment_intent_id', pi.id)
    .maybeSingle()

  if (!payment) return

  await supabase
    .from('payments')
    .update({ status: 'failed', updated_at: new Date().toISOString() })
    .eq('id', payment.id)

  // Notify the client
  const { data: paymentFull } = await supabase
    .from('payments')
    .select('inspection_id, client_id')
    .eq('id', payment.id)
    .single()

  if (paymentFull?.client_id) {
    await supabase.from('notifications').insert({
      user_id: paymentFull.client_id,
      type: 'payment_failed',
      inspection_id: paymentFull.inspection_id,
      message: `Payment failed for your inspection. Reason: ${lastError}. Please update your payment method in Settings.`,
    })
  }
}

async function handleTransferCreated(transfer: Stripe.Transfer) {
  await supabase
    .from('payout_batch_items')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('stripe_transfer_id', transfer.id)
}

async function handleTransferUpdated(transfer: Stripe.Transfer) {
  // A transfer moving to 'paid' means funds have reached the connected account
  if (transfer.reversed) return // handled by transfer.reversed event

  await supabase
    .from('payout_batch_items')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_transfer_id', transfer.id)
    .eq('status', 'processing')
}

async function handleTransferReversed(transfer: Stripe.Transfer) {
  const reversal = transfer.reversals?.data?.[0]
  const reason = reversal?.metadata?.reason ?? 'Transfer reversed by Stripe'

  const { data: item } = await supabase
    .from('payout_batch_items')
    .select('id, scout_id, inspection_id')
    .eq('stripe_transfer_id', transfer.id)
    .maybeSingle()

  if (!item) return

  await supabase
    .from('payout_batch_items')
    .update({
      status: 'reversed',
      failure_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', item.id)

  // Notify the scout that their payout was reversed
  if (item.scout_id) {
    await supabase.from('notifications').insert({
      user_id: item.scout_id,
      type: 'payout_reversed',
      inspection_id: item.inspection_id,
      message: `A payout transfer was reversed. Reason: ${reason}. Please contact support.`,
    })
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const signature = req.headers.get('stripe-signature')
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')

  if (!signature || !webhookSecret) {
    return new Response('Missing signature or webhook secret', { status: 400 })
  }

  const body = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret)
  } catch (err) {
    console.error('Signature verification failed:', err)
    return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 })
  }

  let handlerError: string | undefined

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent)
        break
      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent)
        break
      case 'transfer.created':
        await handleTransferCreated(event.data.object as Stripe.Transfer)
        break
      case 'transfer.updated':
        await handleTransferUpdated(event.data.object as Stripe.Transfer)
        break
      case 'transfer.reversed':
        await handleTransferReversed(event.data.object as Stripe.Transfer)
        break
      default:
        // Ignore unhandled event types — still return 200 so Stripe stops retrying
        break
    }
  } catch (err) {
    handlerError = err instanceof Error ? err.message : String(err)
    console.error(`Handler error for ${event.type}:`, err)
  }

  await logEvent(event.id, event.type, event.data.object, handlerError)

  // Always return 200 — a non-2xx response causes Stripe to retry for 72 hours
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
