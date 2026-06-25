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

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return new Response('Missing stripe-signature header', { status: 400 })
  }

  const body = await req.text()
  let event: Stripe.Event

  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret)
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message)
    return new Response('Webhook signature verification failed: ' + err.message, { status: 400 })
  }

  console.log('Received Stripe event: ' + event.type)

  try {
    switch (event.type) {

      case 'transfer.reversed': {
        const transfer = event.data.object as Stripe.Transfer
        const batchItemId = transfer.metadata?.batch_item_id
        if (batchItemId) {
          await supabase
            .from('payout_batch_items')
            .update({
              status: 'Failed',
              failure_reason: 'Transfer reversed by Stripe',
              updated_at: new Date().toISOString(),
            })
            .eq('id', batchItemId)
        }
        break
      }

      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent

        if (pi.metadata?.inspection_id) {
          await supabase
            .from('inspections')
            .update({ status: 'Posted', updated_at: new Date().toISOString() })
            .eq('id', pi.metadata.inspection_id)
            .eq('status', 'Draft')

          await supabase
            .from('payments')
            .update({ status: 'succeeded', updated_at: new Date().toISOString() })
            .eq('stripe_payment_intent_id', pi.id)

        } else if (pi.metadata?.type === 'marketplace' && pi.metadata?.purchase_id) {
          await supabase
            .from('marketplace_purchases')
            .update({ status: 'paid', purchased_at: new Date().toISOString() })
            .eq('id', pi.metadata.purchase_id)
        }
        break
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent
        if (pi.metadata?.inspection_id) {
          await supabase
            .from('payments')
            .update({ status: 'failed', updated_at: new Date().toISOString() })
            .eq('stripe_payment_intent_id', pi.id)
        }
        break
      }

      default:
        console.log('Unhandled event type: ' + event.type)
    }
  } catch (err: any) {
    console.error('Webhook handler error:', err)
    return new Response('Internal handler error', { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
