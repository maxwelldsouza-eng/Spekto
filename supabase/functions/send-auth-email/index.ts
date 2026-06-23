const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? ''
const FROM = 'Spekto <onboarding@resend.dev>'
const SUPABASE_URL = 'https://nyvnvtxhlnjvfhcmnihh.supabase.co'

function ok() {
  return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } })
}

async function verifySignature(req: Request, body: string): Promise<boolean> {
  const msgId = req.headers.get('webhook-id')
  const msgTimestamp = req.headers.get('webhook-timestamp')
  const msgSignature = req.headers.get('webhook-signature')

  if (!msgId || !msgTimestamp || !msgSignature) return false

  const ts = parseInt(msgTimestamp)
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false

  // HOOK_SECRET is the raw secret; auth config stores it as v1,whsec_<base64(secret)>
  const secretBytes = new TextEncoder().encode(HOOK_SECRET)
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const toSign = `${msgId}.${msgTimestamp}.${body}`
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(toSign))
  const computed = 'v1,' + btoa(String.fromCharCode(...new Uint8Array(sig)))

  return msgSignature.split(' ').some(s => s === computed)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, webhook-id, webhook-timestamp, webhook-signature' } })
  }

  const rawBody = await req.text()

  const valid = await verifySignature(req, rawBody)
  if (!valid) return err('Unauthorized', 401)

  const payload = JSON.parse(rawBody)
  const { user, email_data } = payload

  const toEmail: string = user?.email
  const actionType: string = email_data?.email_action_type
  const tokenHash: string = email_data?.token_hash
  const redirectTo: string = email_data?.redirect_to ?? `${SUPABASE_URL}/auth/v1/verify`

  if (!toEmail || !tokenHash) return err('Missing required fields')

  const confirmUrl = `${SUPABASE_URL}/auth/v1/verify?token=${tokenHash}&type=${actionType}&redirect_to=${encodeURIComponent(redirectTo)}`

  const subjects: Record<string, string> = {
    signup: 'Confirm your Spekto account',
    recovery: 'Reset your Spekto password',
    invite: "You've been invited to Spekto",
    magiclink: 'Your Spekto sign-in link',
    email_change: 'Confirm your new email address',
    reauthentication: 'Confirm your identity',
  }

  const bodies: Record<string, string> = {
    signup: `<div style="font-family:Inter,sans-serif;max-width:480px;margin:auto;padding:32px">
      <h2 style="color:#560591">Confirm your email</h2>
      <p>Thanks for signing up to Spekto. Click the button below to confirm your email address.</p>
      <a href="${confirmUrl}" style="display:inline-block;background:#560591;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">Confirm email address</a>
      <p style="color:#6b7280;font-size:13px">If you didn't create an account, you can ignore this email.</p>
    </div>`,
    recovery: `<div style="font-family:Inter,sans-serif;max-width:480px;margin:auto;padding:32px">
      <h2 style="color:#560591">Reset your password</h2>
      <p>We received a request to reset your Spekto password. Click below to choose a new one.</p>
      <a href="${confirmUrl}" style="display:inline-block;background:#560591;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">Reset password</a>
      <p style="color:#6b7280;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
    </div>`,
    magiclink: `<div style="font-family:Inter,sans-serif;max-width:480px;margin:auto;padding:32px">
      <h2 style="color:#560591">Your sign-in link</h2>
      <p>Click below to sign in to Spekto. This link expires in 1 hour.</p>
      <a href="${confirmUrl}" style="display:inline-block;background:#560591;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">Sign in to Spekto</a>
    </div>`,
  }

  const subject = subjects[actionType] ?? 'Action required — Spekto'
  const html = bodies[actionType] ?? `<p>Click <a href="${confirmUrl}">here</a> to continue.</p>`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [toEmail], subject, html }),
  })

  if (!res.ok) {
    const resBody = await res.text()
    console.error('Resend error:', resBody)
    return err('Failed to send email', 500)
  }

  return ok()
})
