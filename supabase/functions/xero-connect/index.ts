Deno.serve(async (_req: Request) => {
  const clientId = Deno.env.get('XERO_CLIENT_ID')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')

  if (!clientId || !supabaseUrl) {
    return new Response('Missing XERO_CLIENT_ID or SUPABASE_URL env vars', { status: 500 })
  }

  const redirectUri = `${supabaseUrl}/functions/v1/xero-oauth-callback`

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid profile email accounting.transactions accounting.contacts offline_access',
  })

  const authUrl = `https://login.xero.com/identity/connect/authorize?${params}`

  return Response.redirect(authUrl, 302)
})
