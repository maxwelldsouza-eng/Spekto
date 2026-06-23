import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const errorParam = url.searchParams.get('error')
  const errorDesc = url.searchParams.get('error_description') ?? ''

  if (errorParam) {
    return html(`<h2>Xero authorisation failed</h2><p>${errorParam}: ${errorDesc}</p>`, 400)
  }

  if (!code) {
    return html('<h2>Missing authorisation code</h2>', 400)
  }

  const clientId = Deno.env.get('XERO_CLIENT_ID')!
  const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')!
  const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/xero-oauth-callback`

  // Exchange authorisation code for tokens
  const tokenRes = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })

  if (!tokenRes.ok) {
    const text = await tokenRes.text()
    console.error('Token exchange failed:', text)
    return html(`<h2>Token exchange failed</h2><pre>${text}</pre>`, 500)
  }

  const { access_token, refresh_token, expires_in } = await tokenRes.json()

  // Get the connected organisation (tenant)
  const connectionsRes = await fetch('https://api.xero.com/connections', {
    headers: {
      'Authorization': `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
  })

  if (!connectionsRes.ok) {
    return html('<h2>Failed to fetch Xero connections</h2>', 500)
  }

  const connections = await connectionsRes.json()
  if (!connections.length) {
    return html('<h2>No Xero organisation connected</h2><p>Please ensure you have at least one organisation in your Xero account.</p>', 400)
  }

  const tenantId = connections[0].tenantId
  const tenantName = connections[0].tenantName ?? 'Unknown'
  const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString()

  // Upsert single-row token store
  const { error: upsertErr } = await supabase.from('xero_tokens').upsert(
    {
      id: 1,
      access_token,
      refresh_token,
      tenant_id: tenantId,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  )

  if (upsertErr) {
    console.error('Failed to store tokens:', upsertErr)
    return html(`<h2>Failed to save tokens</h2><pre>${upsertErr.message}</pre>`, 500)
  }

  return html(`
    <h2 style="color:#22C55E">✓ Xero connected successfully</h2>
    <p>Organisation: <strong>${tenantName}</strong></p>
    <p>Tenant ID: <code>${tenantId}</code></p>
    <p>Tokens stored. You can close this tab.</p>
  `)
})

function html(body: string, status = 200): Response {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Xero OAuth</title>
    <style>body{font-family:sans-serif;max-width:600px;margin:60px auto;padding:0 20px}</style>
    </head><body>${body}</body></html>`,
    { status, headers: { 'Content-Type': 'text/html' } },
  )
}
