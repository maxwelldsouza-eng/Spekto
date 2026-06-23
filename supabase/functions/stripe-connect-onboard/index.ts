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

const BASE_URL = 'https://maxwelldsouza-eng.github.io/Spekto/scout'

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

  const { data: userData } = await supabase
    .from('users')
    .select('stripe_account_id, first_name, last_name, email')
    .eq('id', user.id)
    .single()

  if (!userData) return err('User not found', 404)

  let accountId = userData.stripe_account_id

  // If account exists, check if it's fully onboarded
  if (accountId) {
    const account = await stripe.accounts.retrieve(accountId)
    if (account.charges_enabled && account.payouts_enabled) {
      return ok({ already_active: true, account_id: accountId })
    }
    // Account exists but onboarding incomplete — generate a fresh link
  } else {
    // Create new Connect Express account
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'AU',
      email: userData.email,
      capabilities: { transfers: { requested: true } },
      business_type: 'individual',
      metadata: { supabase_user_id: user.id },
    })
    accountId = account.id

    await Promise.all([
      supabase.from('users').update({ stripe_account_id: accountId, updated_at: new Date().toISOString() }).eq('id', user.id),
      supabase.from('scout_profiles').update({ stripe_account_id: accountId, updated_at: new Date().toISOString() }).eq('user_id', user.id),
    ])
  }

  // Generate onboarding link
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${BASE_URL}/settings.html?stripe=refresh`,
    return_url: `${BASE_URL}/settings.html?stripe=success`,
    type: 'account_onboarding',
  })

  return ok({ url: accountLink.url, account_id: accountId })
})
