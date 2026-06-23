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

// ─── Xero helpers ────────────────────────────────────────────────────────────

async function getOrCreateXeroContact(email: string, name: string): Promise<string> {
  const searchRes = await xeroGet(`/Contacts?where=EmailAddress="${encodeURIComponent(email)}"`)
  if (searchRes.ok) {
    const data = await searchRes.json()
    if (data.Contacts?.length > 0) return data.Contacts[0].ContactID
  }

  const createRes = await xeroPost('/Contacts', {
    Contacts: [{ Name: name || email, EmailAddress: email }],
  })
  const createData = await createRes.json()
  if (!createRes.ok || !createData.Contacts?.[0]) {
    throw new Error(`Xero contact creation failed: ${JSON.stringify(createData)}`)
  }
  return createData.Contacts[0].ContactID
}

async function syncInvoiceToXero(paymentId: string): Promise<void> {
  // Fetch payment
  const { data: payment } = await supabase
    .from('payments')
    .select('id, amount, spekto_fee_ex_gst, gst, inspection_id, client_id')
    .eq('id', paymentId)
    .single()
  if (!payment) throw new Error(`Payment ${paymentId} not found`)

  // Fetch inspection address
  const { data: inspection } = await supabase
    .from('inspections')
    .select('address')
    .eq('id', payment.inspection_id)
    .single()

  // Fetch client details
  const { data: client } = await supabase
    .from('users')
    .select('email, first_name, last_name')
    .eq('id', payment.client_id)
    .single()
  if (!client) throw new Error('Client not found')

  const clientName = `${client.first_name ?? ''} ${client.last_name ?? ''}`.trim() || client.email
  const contactId = await getOrCreateXeroContact(client.email, clientName)
  const today = new Date().toISOString().split('T')[0]

  // Create ACCREC invoice (money Spekto earns from client)
  const invoiceRes = await xeroPost('/Invoices', {
    Invoices: [{
      Type: 'ACCREC',
      Contact: { ContactID: contactId },
      Status: 'AUTHORISED',
      DueDateString: today,
      LineAmountTypes: 'EXCLUSIVE',
      CurrencyCode: 'AUD',
      Reference: `INS-${payment.inspection_id.substring(0, 8).toUpperCase()}`,
      LineItems: [{
        Description: `Property Inspection — ${inspection?.address ?? payment.inspection_id}`,
        Quantity: 1,
        UnitAmount: payment.spekto_fee_ex_gst,
        TaxType: 'OUTPUT2',
        AccountCode: '200',
      }],
    }],
  })

  const invoiceJson = await invoiceRes.json()
  if (!invoiceRes.ok || invoiceJson.Invoices?.[0]?.HasErrors) {
    throw new Error(`Xero invoice failed: ${JSON.stringify(invoiceJson)}`)
  }
  const invoiceId = invoiceJson.Invoices[0].InvoiceID

  // Record payment to mark invoice as paid
  const pmtRes = await xeroPost('/Payments', {
    Payments: [{
      Invoice: { InvoiceID: invoiceId },
      Account: { Code: '090' },
      Date: today,
      Amount: payment.amount,
    }],
  })

  if (!pmtRes.ok) {
    const pmtJson = await pmtRes.json()
    throw new Error(`Xero payment recording failed: ${JSON.stringify(pmtJson)}`)
  }

  await supabase
    .from('payments')
    .update({ xero_invoice_id: invoiceId, xero_sync_status: 'Synced', updated_at: new Date().toISOString() })
    .eq('id', paymentId)
}

async function syncBillToXero(batchItemId: string): Promise<void> {
  // Fetch payout batch item
  const { data: item } = await supabase
    .from('payout_batch_items')
    .select('id, amount, scout_id, inspection_id')
    .eq('id', batchItemId)
    .single()
  if (!item) throw new Error(`Batch item ${batchItemId} not found`)

  // Fetch inspection address
  const { data: inspection } = await supabase
    .from('inspections')
    .select('address')
    .eq('id', item.inspection_id)
    .single()

  // Fetch scout details
  const { data: scout } = await supabase
    .from('users')
    .select('email, first_name, last_name')
    .eq('id', item.scout_id)
    .single()
  if (!scout) throw new Error('Scout not found')

  const scoutName = `${scout.first_name ?? ''} ${scout.last_name ?? ''}`.trim() || scout.email
  const contactId = await getOrCreateXeroContact(scout.email, scoutName)
  const today = new Date().toISOString().split('T')[0]

  // Create ACCPAY bill (money Spekto pays to scout)
  const billRes = await xeroPost('/Invoices', {
    Invoices: [{
      Type: 'ACCPAY',
      Contact: { ContactID: contactId },
      Status: 'AUTHORISED',
      DueDateString: today,
      LineAmountTypes: 'EXCLUSIVE',
      CurrencyCode: 'AUD',
      Reference: `PAYOUT-${item.inspection_id.substring(0, 8).toUpperCase()}`,
      LineItems: [{
        Description: `Scout payout — ${inspection?.address ?? item.inspection_id}`,
        Quantity: 1,
        UnitAmount: item.amount,
        TaxType: 'NONE',
        AccountCode: '477',
      }],
    }],
  })

  const billJson = await billRes.json()
  if (!billRes.ok || billJson.Invoices?.[0]?.HasErrors) {
    throw new Error(`Xero bill failed: ${JSON.stringify(billJson)}`)
  }
  const billId = billJson.Invoices[0].InvoiceID

  // Record payment to mark bill as paid
  const pmtRes = await xeroPost('/Payments', {
    Payments: [{
      Invoice: { InvoiceID: billId },
      Account: { Code: '090' },
      Date: today,
      Amount: item.amount,
    }],
  })

  if (!pmtRes.ok) {
    const pmtJson = await pmtRes.json()
    throw new Error(`Xero bill payment failed: ${JSON.stringify(pmtJson)}`)
  }

  await supabase
    .from('payout_batch_items')
    .update({ xero_bill_id: billId, xero_sync_status: 'Synced', updated_at: new Date().toISOString() })
    .eq('id', batchItemId)
}

// ─── Stripe event handlers ────────────────────────────────────────────────────

async function logEvent(eventId: string, eventType: string, payload: unknown, error?: string) {
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
  if (pi.metadata?.type === 'marketplace') {
    await handleMarketplacePurchaseSucceeded(pi)
  } else {
    await handleInspectionPaymentSucceeded(pi)
  }
}

async function handleInspectionPaymentSucceeded(pi: Stripe.PaymentIntent) {
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
      .update({ status: 'Posted', updated_at: new Date().toISOString() })
      .eq('id', payment.inspection_id)
      .eq('status', 'Draft'),
  ])

  // Store Stripe receipt URL from the charge object
  try {
    const piExpanded = await stripe.paymentIntents.retrieve(pi.id, { expand: ['latest_charge'] })
    const charge = piExpanded.latest_charge as Stripe.Charge
    if (charge?.receipt_url) {
      await supabase
        .from('payments')
        .update({ stripe_receipt_url: charge.receipt_url })
        .eq('id', payment.id)
    }
  } catch (e) {
    console.error('Could not store receipt URL:', e)
  }

  try {
    await syncInvoiceToXero(payment.id)
  } catch (xeroErr) {
    console.error('Xero invoice sync failed:', xeroErr)
    await supabase
      .from('payments')
      .update({ xero_sync_status: 'Failed', updated_at: new Date().toISOString() })
      .eq('id', payment.id)
  }
}

async function handleMarketplacePurchaseSucceeded(pi: Stripe.PaymentIntent) {
  const purchaseId = pi.metadata?.purchase_id
  if (!purchaseId) return

  await supabase
    .from('marketplace_purchases')
    .update({ status: 'paid', purchased_at: new Date().toISOString() })
    .eq('id', purchaseId)
    .eq('status', 'pending')

  try {
    await syncMarketplaceInvoiceToXero(purchaseId)
  } catch (xeroErr) {
    console.error('Xero marketplace sync failed:', xeroErr)
    await supabase
      .from('marketplace_purchases')
      .update({ xero_sync_status: 'Failed' })
      .eq('id', purchaseId)
  }
}

async function syncMarketplaceInvoiceToXero(purchaseId: string): Promise<void> {
  const { data: purchase } = await supabase
    .from('marketplace_purchases')
    .select('id, purchase_price, buyer_id, listing_id')
    .eq('id', purchaseId)
    .single()
  if (!purchase) throw new Error('Purchase not found')

  const { data: listing } = await supabase
    .from('marketplace_listings')
    .select('address')
    .eq('id', purchase.listing_id)
    .single()

  const { data: buyer } = await supabase
    .from('users')
    .select('email, first_name, last_name')
    .eq('id', purchase.buyer_id)
    .single()
  if (!buyer) throw new Error('Buyer not found')

  const buyerName = `${buyer.first_name ?? ''} ${buyer.last_name ?? ''}`.trim() || buyer.email
  const contactId = await getOrCreateXeroContact(buyer.email, buyerName)
  const today = new Date().toISOString().split('T')[0]

  const priceIncGst = purchase.purchase_price
  const priceExGst = Math.round((priceIncGst / 1.1) * 100) / 100

  const invoiceRes = await xeroPost('/Invoices', {
    Invoices: [{
      Type: 'ACCREC',
      Contact: { ContactID: contactId },
      Status: 'AUTHORISED',
      DueDateString: today,
      LineAmountTypes: 'EXCLUSIVE',
      CurrencyCode: 'AUD',
      Reference: `MKT-${purchaseId.substring(0, 8).toUpperCase()}`,
      LineItems: [{
        Description: `Marketplace video — ${listing?.address ?? purchase.listing_id}`,
        Quantity: 1,
        UnitAmount: priceExGst,
        TaxType: 'OUTPUT2',
        AccountCode: '260',
      }],
    }],
  })

  const invoiceJson = await invoiceRes.json()
  if (!invoiceRes.ok || invoiceJson.Invoices?.[0]?.HasErrors) {
    throw new Error(`Xero marketplace invoice failed: ${JSON.stringify(invoiceJson)}`)
  }
  const invoiceId = invoiceJson.Invoices[0].InvoiceID

  const pmtRes = await xeroPost('/Payments', {
    Payments: [{
      Invoice: { InvoiceID: invoiceId },
      Account: { Code: '090' },
      Date: today,
      Amount: priceIncGst,
    }],
  })

  if (!pmtRes.ok) {
    const pmtJson = await pmtRes.json()
    throw new Error(`Xero marketplace payment failed: ${JSON.stringify(pmtJson)}`)
  }

  await supabase
    .from('marketplace_purchases')
    .update({ xero_invoice_id: invoiceId, xero_sync_status: 'Synced' })
    .eq('id', purchaseId)
}

async function handlePaymentIntentFailed(pi: Stripe.PaymentIntent) {
  const lastError = pi.last_payment_error?.message ?? 'Payment failed'

  const { data: payment } = await supabase
    .from('payments')
    .select('id, inspection_id, client_id')
    .eq('stripe_payment_intent_id', pi.id)
    .maybeSingle()

  if (!payment) return

  await supabase
    .from('payments')
    .update({ status: 'failed', updated_at: new Date().toISOString() })
    .eq('id', payment.id)

  if (payment.client_id) {
    await supabase.from('notifications').insert({
      user_id: payment.client_id,
      type: 'payment_failed',
      inspection_id: payment.inspection_id,
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
  if (transfer.reversed) return

  const { data: item } = await supabase
    .from('payout_batch_items')
    .select('id')
    .eq('stripe_transfer_id', transfer.id)
    .eq('status', 'processing')
    .maybeSingle()

  if (!item) return

  await supabase
    .from('payout_batch_items')
    .update({ status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', item.id)

  // Sync to Xero — failure is non-fatal
  try {
    await syncBillToXero(item.id)
  } catch (xeroErr) {
    console.error('Xero bill sync failed:', xeroErr)
    await supabase
      .from('payout_batch_items')
      .update({ xero_sync_status: 'Failed', updated_at: new Date().toISOString() })
      .eq('id', item.id)
  }
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
    .update({ status: 'reversed', failure_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', item.id)

  if (item.scout_id) {
    await supabase.from('notifications').insert({
      user_id: item.scout_id,
      type: 'payout_reversed',
      inspection_id: item.inspection_id,
      message: `A payout transfer was reversed. Reason: ${reason}. Please contact support.`,
    })
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

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
        break
    }
  } catch (err) {
    handlerError = err instanceof Error ? err.message : String(err)
    console.error(`Handler error for ${event.type}:`, err)
  }

  await logEvent(event.id, event.type, event.data.object, handlerError)

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
