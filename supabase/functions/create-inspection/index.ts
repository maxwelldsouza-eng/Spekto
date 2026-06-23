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

  const body = await req.json()
  const { address, inspection_type, date, time, property_link, pricing_snapshot, instructions } = body

  if (!address || !inspection_type || !date || !time) return err('Missing required fields')
  if (!pricing_snapshot?.total) return err('Missing pricing')

  const amountCents = Math.round(parseFloat(pricing_snapshot.total) * 100)
  const now = new Date().toISOString()

  // Create inspection as Draft
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
      status: 'Draft',
      created_at: now,
      updated_at: now,
    })
    .select()
    .single()

  if (inspErr || !inspection) return err('Failed to create inspection: ' + (inspErr?.message ?? 'unknown'))

  // Save instructions
  if (instructions?.length > 0) {
    await supabase.from('instructions').insert(
      instructions.map((inst: { text: string; is_checked: boolean; display_order: number }) => ({
        inspection_id: inspection.id,
        text: inst.text,
        is_checked: inst.is_checked,
        display_order: inst.display_order,
      }))
    )
  }

  // Create Stripe PaymentIntent
  let clientSecret: string
  let paymentIntentId: string
  try {
    const pi = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'aud',
      automatic_payment_methods: { enabled: true },
      metadata: {
        inspection_id: inspection.id,
        client_id: user.id,
        inspection_type,
        address,
      },
    })
    clientSecret = pi.client_secret!
    paymentIntentId = pi.id
  } catch (stripeErr: unknown) {
    await supabase.from('inspections').delete().eq('id', inspection.id)
    const msg = stripeErr instanceof Error ? stripeErr.message : String(stripeErr)
    return err('Payment setup failed: ' + msg)
  }

  // Create pending payment record
  await supabase.from('payments').insert({
    inspection_id: inspection.id,
    client_id: user.id,
    amount: parseFloat(pricing_snapshot.total),
    spekto_fee_ex_gst: parseFloat(pricing_snapshot.fee_excluding_gst),
    gst: parseFloat(pricing_snapshot.gst),
    currency: 'aud',
    status: 'pending',
    payment_type: 'inspection',
    stripe_payment_intent_id: paymentIntentId,
    created_at: now,
    updated_at: now,
  })

  return ok({ client_secret: clientSecret, inspection_id: inspection.id, amount: amountCents })
})
