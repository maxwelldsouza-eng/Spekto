import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, webhook-id, webhook-timestamp, webhook-signature' } })
  }

  const payload = await req.text()
  const headers = Object.fromEntries(req.headers)

  let data: { user: { email: string }; email_data: { token_hash: string; redirect_to: string; email_action_type: string } }
  try {
    const wh = new Webhook(HOOK_SECRET)
    data = wh.verify(payload, headers) as typeof data
  } catch (e) {
    console.error('Webhook verification failed:', e)
    return err('Unauthorized', 401)
  }

  const { user, email_data } = data
  const toEmail = user?.email
  const actionType = email_data?.email_action_type
  const tokenHash = email_data?.token_hash
  const redirectTo = email_data?.redirect_to ?? `${SUPABASE_URL}/auth/v1/verify`

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
