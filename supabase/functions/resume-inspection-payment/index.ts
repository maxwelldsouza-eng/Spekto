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

  const { inspection_id } = await req.json()
  if (!inspection_id) return err('Missing inspection_id')

  const { data: inspection } = await supabase
    .from('inspections')
    .select('id, client_id, status, pricing_snapshot, address, inspection_type')
    .eq('id', inspection_id)
    .eq('client_id', user.id)
    .eq('status', 'Draft')
    .single()

  if (!inspection) return err('Inspection not found or not in Draft status', 404)

  const amount = parseFloat(inspection.pricing_snapshot?.total ?? '0')
  if (amount <= 0) return err('Invalid inspection amount')

  try {
    const pi = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'aud',
      automatic_payment_methods: { enabled: true },
      metadata: {
        inspection_id: inspection.id,
        client_id: user.id,
        inspection_type: inspection.inspection_type,
        address: inspection.address,
      },
    })

    return ok({
      client_secret: pi.client_secret,
      inspection_id: inspection.id,
      amount: Math.round(amount * 100),
      pricing_snapshot: inspection.pricing_snapshot,
    })
  } catch (stripeErr: unknown) {
    const msg = stripeErr instanceof Error ? stripeErr.message : String(stripeErr)
    return err('Payment setup failed: ' + msg)
  }
})
