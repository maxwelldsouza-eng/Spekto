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
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

function ok(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('Unauthorized', 401)

  const { data: { user }, error: authErr } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', ''),
  )
  if (authErr || !user) return err('Unauthorized', 401)

  const body = await req.json()
  const { listing_id } = body
  if (!listing_id) return err('Missing listing_id')

  // Get listing
  const { data: listing } = await supabase
    .from('marketplace_listings')
    .select('id, address, price, status')
    .eq('id', listing_id)
    .single()

  if (!listing) return err('Listing not found', 404)
  if (listing.status !== 'Active') return err('This listing is no longer available')

  // Check already purchased
  const { data: existing } = await supabase
    .from('marketplace_purchases')
    .select('id')
    .eq('listing_id', listing_id)
    .eq('buyer_id', user.id)
    .eq('status', 'paid')
    .maybeSingle()

  if (existing) return ok({ already_purchased: true, purchase_id: existing.id })

  // Price: listing.price is inc GST, default $20
  const priceIncGst = parseFloat(listing.price ?? '20')
  const amountCents = Math.round(priceIncGst * 100)

  // Get or create Stripe customer
  const { data: userData } = await supabase
    .from('users')
    .select('email, first_name, last_name, stripe_customer_id')
    .eq('id', user.id)
    .single()

  if (!userData) return err('User not found', 404)

  let customerId = userData.stripe_customer_id

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: userData.email,
      name: `${userData.first_name ?? ''} ${userData.last_name ?? ''}`.trim() || undefined,
      metadata: { supabase_user_id: user.id },
    })
    customerId = customer.id
    await supabase
      .from('users')
      .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
      .eq('id', user.id)
  }

  // Check for saved payment method
  const paymentMethods = await stripe.paymentMethods.list({ customer: customerId, type: 'card' })
  const defaultPm = paymentMethods.data[0] ?? null

  // Create purchase row (pending — webhook will mark as paid on success)
  const { data: purchase, error: purchaseErr } = await supabase
    .from('marketplace_purchases')
    .insert({
      listing_id,
      buyer_id: user.id,
      purchase_price: priceIncGst,
      status: 'pending',
      created_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (purchaseErr || !purchase) {
    return err('Failed to create purchase record: ' + (purchaseErr?.message ?? 'unknown'))
  }

  // Create PaymentIntent
  let pi: Stripe.PaymentIntent
  try {
    pi = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'aud',
      customer: customerId,
      description: `Spekto Marketplace — ${listing.address}`,
      metadata: {
        type: 'marketplace',
        listing_id,
        purchase_id: purchase.id,
        supabase_user_id: user.id,
      },
      ...(defaultPm
        ? { payment_method: defaultPm.id, confirm: true, off_session: true }
        : { setup_future_usage: 'off_session' }),
    })
  } catch (stripeErr: unknown) {
    await supabase.from('marketplace_purchases').delete().eq('id', purchase.id)
    const msg = stripeErr instanceof Error ? stripeErr.message : String(stripeErr)
    return err('Stripe error: ' + msg)
  }

  // Store PI id on purchase row
  await supabase
    .from('marketplace_purchases')
    .update({ stripe_payment_intent_id: pi.id })
    .eq('id', purchase.id)

  if (pi.status === 'succeeded') {
    // Webhook will also fire but update is idempotent
    await supabase
      .from('marketplace_purchases')
      .update({ status: 'paid', purchased_at: new Date().toISOString() })
      .eq('id', purchase.id)
    return ok({ success: true, purchase_id: purchase.id })
  }

  if (pi.status === 'requires_action') {
    return ok({ requires_action: true, client_secret: pi.client_secret, purchase_id: purchase.id })
  }

  // requires_payment_method — client will collect card
  return ok({ requires_payment_method: true, client_secret: pi.client_secret, purchase_id: purchase.id })
})
