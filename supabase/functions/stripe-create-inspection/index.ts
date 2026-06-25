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

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

function ok(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS })
  }

  // Verify the caller is authenticated
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('Unauthorized', 401)

  const { data: { user }, error: authErr } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', ''),
  )
  if (authErr || !user) return err('Unauthorized', 401)

  const body = await req.json()
  const { address, inspection_type, date, time, property_link, pricing_snapshot, instructions, latitude, longitude } = body

  if (!address || !inspection_type || !date || !time || !pricing_snapshot) {
    return err('Missing required fields')
  }

  const totalAud = parseFloat(pricing_snapshot.total)
  if (isNaN(totalAud) || totalAud <= 0) return err('Invalid pricing')
  const amountCents = Math.round(totalAud * 100)

  // --- 1. Get or create Stripe customer ---
  const { data: userData, error: userErr } = await supabase
    .from('users')
    .select('email, first_name, last_name, stripe_customer_id')
    .eq('id', user.id)
    .single()

  if (userErr || !userData) return err('User not found', 404)

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

  // --- 2. List saved payment methods ---
  const paymentMethods = await stripe.paymentMethods.list({
    customer: customerId,
    type: 'card',
  })
  const defaultPm = paymentMethods.data[0] ?? null

  // --- 3. Create the inspection as Draft ---
  const { data: inspection, error: inspErr } = await supabase
    .from('inspections')
    .insert({
      client_id: user.id,
      address,
      inspection_type,
      date,
      time,
      property_link: property_link || null,
      pricing_snapshot,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      status: 'Draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (inspErr || !inspection) {
    return err('Failed to create inspection: ' + (inspErr?.message ?? 'unknown'))
  }

  // Insert instructions if provided
  if (Array.isArray(instructions) && instructions.length > 0) {
    await supabase.from('instructions').insert(
      instructions.map((inst: { text: string }, i: number) => ({
        inspection_id: inspection.id,
        text: inst.text,
        display_order: i,
      }))
    )
  }

  // --- 4. Create PaymentIntent ---
  const piParams: Stripe.PaymentIntentCreateParams = {
    amount: amountCents,
    currency: 'aud',
    customer: customerId,
    description: `Spekto inspection at ${address}`,
    metadata: {
      inspection_id: inspection.id,
      supabase_user_id: user.id,
    },
    ...(defaultPm
      ? {
          payment_method: defaultPm.id,
          confirm: true,
          off_session: true,
        }
      : {
          setup_future_usage: 'off_session',
        }),
  }

  let pi: Stripe.PaymentIntent
  try {
    pi = await stripe.paymentIntents.create(piParams)
  } catch (stripeErr: unknown) {
    // Clean up draft inspection if PI creation fails
    await supabase.from('inspections').delete().eq('id', inspection.id)
    const msg = stripeErr instanceof Error ? stripeErr.message : String(stripeErr)
    return err('Stripe error: ' + msg)
  }

  // --- 5. Record the payment row ---
  await supabase.from('payments').insert({
    inspection_id: inspection.id,
    client_id: user.id,
    amount: totalAud,
    scout_payout: parseFloat(pricing_snapshot.pay_to_scout ?? 0),
    spekto_fee_ex_gst: parseFloat(pricing_snapshot.fee_excluding_gst ?? 0),
    gst: parseFloat(pricing_snapshot.gst ?? 0),
    currency: 'aud',
    status: 'Pending',
    stripe_payment_intent_id: pi.id,
    payment_type: 'Charge',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })

  // --- 6. Branch on PaymentIntent status ---
  if (pi.status === 'succeeded') {
    await supabase
      .from('inspections')
      .update({ status: 'Posted', updated_at: new Date().toISOString() })
      .eq('id', inspection.id)
    return ok({ success: true, inspection_id: inspection.id })
  }

  if (pi.status === 'requires_action') {
    return ok({
      requires_action: true,
      client_secret: pi.client_secret,
      inspection_id: inspection.id,
    })
  }

  // requires_payment_method (no saved card, or card failed)
  return ok({
    requires_payment_method: true,
    client_secret: pi.client_secret,
    inspection_id: inspection.id,
  })
})
