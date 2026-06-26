import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { xeroPost, getOrCreateXeroContact } from '../_shared/xero-client.ts'
import { sendNotification } from '../_shared/notify.ts'

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
          const inspectionId = pi.metadata.inspection_id

          await supabase
            .from('inspections')
            .update({ status: 'Posted', updated_at: new Date().toISOString() })
            .eq('id', inspectionId)
            .eq('status', 'Draft')

          await supabase
            .from('payments')
            .update({ status: 'Completed', updated_at: new Date().toISOString() })
            .eq('stripe_payment_intent_id', pi.id)

          // Payment receipt notification
          try {
            const clientId = pi.metadata?.supabase_user_id
            if (clientId) {
              const amountDollars = ((pi.amount ?? 0) / 100).toFixed(2)
              const last4 = (pi.payment_method as any)?.card?.last4 ?? ''
              await sendNotification(supabase, {
                user_id: clientId,
                type: 'payment_receipt',
                inspection_id: inspectionId,
                extra: {
                  amount: amountDollars,
                  ...(last4 ? { payment_method_last4: last4 } : {}),
                  receipt_number: pi.id,
                },
              })
            }
          } catch (notifyErr: any) {
            console.error('Payment receipt notification failed (non-fatal):', notifyErr.message)
          }

          // Xero sync — non-fatal
          try {
            const { data: payment } = await supabase
              .from('payments')
              .select('id, amount, client_id')
              .eq('stripe_payment_intent_id', pi.id)
              .single()

            if (payment) {
              const clientId = payment.client_id ?? pi.metadata?.supabase_user_id
              const { data: client } = await supabase
                .from('users')
                .select('email, first_name, last_name')
                .eq('id', clientId)
                .single()

              if (client) {
                const clientName = `${client.first_name ?? ''} ${client.last_name ?? ''}`.trim() || client.email
                const contactId = await getOrCreateXeroContact(client.email, clientName)
                if (contactId) {
                  const xeroRes = await xeroPost('/Invoices', {
                    Invoices: [{
                      Type: 'ACCREC',
                      Contact: { ContactID: contactId },
                      DueDate: new Date().toISOString().split('T')[0],
                      LineItems: [{
                        Description: `Spekto inspection – ${inspectionId}`,
                        Quantity: 1,
                        UnitAmount: parseFloat(payment.amount),
                        AccountCode: '200',
                      }],
                      Reference: `INS-${inspectionId}`,
                      Status: 'AUTHORISED',
                    }],
                  })
                  const xeroSync = xeroRes.ok ? 'Synced' : 'Failed'
                  const xeroData = xeroRes.ok ? await xeroRes.json() : null
                  if (!xeroRes.ok) console.error('Xero invoice failed:', await xeroRes.text().catch(() => ''))
                  await supabase.from('payments').update({
                    xero_invoice_id: xeroData?.Invoices?.[0]?.InvoiceID ?? null,
                    xero_sync_status: xeroSync,
                    updated_at: new Date().toISOString(),
                  }).eq('id', payment.id)
                }
              }
            }
          } catch (xeroErr: any) {
            console.error('Xero inspection sync error (non-fatal):', xeroErr.message)
          }

        } else if (pi.metadata?.type === 'marketplace' && pi.metadata?.purchase_id) {
          const purchaseId = pi.metadata.purchase_id

          await supabase
            .from('marketplace_purchases')
            .update({ status: 'Completed', purchased_at: new Date().toISOString() })
            .eq('id', purchaseId)

          // Xero sync — non-fatal
          try {
            const { data: purchase } = await supabase
              .from('marketplace_purchases')
              .select('id, amount, buyer_id, buyer_email')
              .eq('id', purchaseId)
              .single()

            if (purchase) {
              let buyerEmail = purchase.buyer_email
              let buyerName = buyerEmail
              if (purchase.buyer_id) {
                const { data: buyer } = await supabase
                  .from('users')
                  .select('email, first_name, last_name')
                  .eq('id', purchase.buyer_id)
                  .single()
                if (buyer) {
                  buyerEmail = buyer.email
                  buyerName = `${buyer.first_name ?? ''} ${buyer.last_name ?? ''}`.trim() || buyer.email
                }
              }
              if (buyerEmail) {
                const contactId = await getOrCreateXeroContact(buyerEmail, buyerName ?? buyerEmail)
                if (contactId) {
                  const xeroRes = await xeroPost('/Invoices', {
                    Invoices: [{
                      Type: 'ACCREC',
                      Contact: { ContactID: contactId },
                      DueDate: new Date().toISOString().split('T')[0],
                      LineItems: [{
                        Description: `Spekto marketplace purchase – ${purchaseId}`,
                        Quantity: 1,
                        UnitAmount: parseFloat(purchase.amount),
                        AccountCode: '200',
                      }],
                      Reference: `MP-${purchaseId}`,
                      Status: 'AUTHORISED',
                    }],
                  })
                  const xeroSync = xeroRes.ok ? 'Synced' : 'Failed'
                  const xeroData = xeroRes.ok ? await xeroRes.json() : null
                  if (!xeroRes.ok) console.error('Xero marketplace invoice failed:', await xeroRes.text().catch(() => ''))
                  await supabase.from('marketplace_purchases').update({
                    xero_invoice_id: xeroData?.Invoices?.[0]?.InvoiceID ?? null,
                    xero_sync_status: xeroSync,
                  }).eq('id', purchaseId)
                }
              }
            }
          } catch (xeroErr: any) {
            console.error('Xero marketplace sync error (non-fatal):', xeroErr.message)
          }
        }
        break
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent
        if (pi.metadata?.inspection_id) {
          await supabase
            .from('payments')
            .update({ status: 'Failed', updated_at: new Date().toISOString() })
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
