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
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return err('Unauthorized', 401)

    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    )
    if (authErr || !user) return err('Unauthorized', 401)

    const body = await req.json()
    const { payment_method_id } = body
    if (!payment_method_id) return err('payment_method_id is required')

    const { data: userData } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single()

    if (!userData?.stripe_customer_id) return err('No Stripe customer found for this user', 404)

    const customerId = userData.stripe_customer_id

    // Attach the payment method to the customer (idempotent if already attached)
    const pm = await stripe.paymentMethods.retrieve(payment_method_id)
    if (pm.customer !== customerId) {
      await stripe.paymentMethods.attach(payment_method_id, { customer: customerId })
    }

    // Set as the default payment method on the customer
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: payment_method_id },
    })

    // Return card details so the UI can display "Visa ending 4242"
    const brand = pm.card?.brand ?? 'card'
    const last4 = pm.card?.last4 ?? '????'

    return ok({ success: true, brand, last4 })
  } catch (e: any) {
    const message = e?.message ?? 'Internal server error'
    return err(message, e?.statusCode ?? 500)
  }
})
