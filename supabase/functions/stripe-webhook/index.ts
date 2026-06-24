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

      case 'transfer.paid': {
        const transfer = event.data.object as Stripe.Transfer
        const batchItemId = transfer.metadata?.batch_item_id
        const batchId = transfer.metadata?.batch_id

        if (batchItemId) {
          const { data: item } = await supabase
            .from('payout_batch_items')
            .update({
              status: 'Paid',
              paid_at: new Date(transfer.created * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', batchItemId)
            .select('inspection_id')
            .single()

          if (item?.inspection_id) {
            await supabase
              .from('inspections')
              .update({ status: 'Paid', updated_at: new Date().toISOString() })
              .eq('id', item.inspection_id)
          }
        }

        if (batchId) {
          const { data: unpaid } = await supabase
            .from('payout_batch_items')
            .select('id')
            .eq('batch_id', batchId)
            .not('status', 'in', '("Paid","Cancelled")')

          if (!unpaid?.length) {
            await supabase
              .from('payout_batches')
              .update({ status: 'Processed', updated_at: new Date().toISOString() })
              .eq('id', batchId)
          }
        }
        break
      }

      case 'transfer.failed': {
        const transfer = event.data.object as Stripe.Transfer
        const batchItemId = transfer.metadata?.batch_item_id
        if (batchItemId) {
          await supabase
            .from('payout_batch_items')
            .update({
              status: 'Failed',
              failure_reason: 'Transfer failed after submission to Stripe',
              updated_at: new Date().toISOString(),
            })
            .eq('id', batchItemId)
        }
        break
      }

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
        const inspectionId = pi.metadata?.inspection_id
        if (inspectionId) {
          await supabase
            .from('inspections')
            .update({ status: 'Posted', updated_at: new Date().toISOString() })
            .eq('id', inspectionId)
            .eq('status', 'Draft')

          await supabase
            .from('payments')
            .update({ status: 'succeeded', updated_at: new Date().toISOString() })
            .eq('stripe_payment_intent_id', pi.id)
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
