import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const RESEND_FROM = 'Spekto <onboarding@resend.dev>'

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

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('Unauthorized', 401)

  const { data: { user }, error: authErr } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', ''),
  )
  if (authErr || !user) return err('Unauthorized', 401)

  const body = await req.json()
  const { inspection_id } = body
  if (!inspection_id) return err('Missing inspection_id')

  const { data: inspection, error: inspErr } = await supabase
    .from('inspections')
    .select('address, date, time, client_id, scout_id, agent_first_name, agent_last_name, agent_email')
    .eq('id', inspection_id)
    .single()

  if (inspErr || !inspection) return err('Inspection not found', 404)

  // Only the Scout assigned to this inspection (or the caller acting as them) may trigger this
  if (inspection.scout_id !== user.id) return err('Forbidden', 403)

  // Nothing to do if the client never entered an agent email
  if (!inspection.agent_email) return ok({ success: true, skipped: 'no_agent_email' })

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) {
    console.warn('[notify-agent] RESEND_API_KEY not set — skipping email')
    return ok({ success: true, skipped: 'no_resend_key' })
  }

  const [{ data: client }, { data: scout }] = await Promise.all([
    supabase.from('users').select('first_name, last_name, email').eq('id', inspection.client_id).single(),
    supabase.from('users').select('first_name, last_name').eq('id', inspection.scout_id).single(),
  ])

  const clientName = `${client?.first_name ?? ''} ${client?.last_name ?? ''}`.trim() || 'A Spekto client'
  const scoutName = `${scout?.first_name ?? ''} ${scout?.last_name ?? ''}`.trim() || 'A Spekto Scout'
  const formattedDate = inspection.date ? inspection.date.split('-').reverse().join('/') : ''
  const formattedTime = inspection.time ? String(inspection.time).slice(0, 5) : ''
  const inspectionDateTime = [formattedDate, formattedTime].filter(Boolean).join(' at ')

  const subject = `Upcoming Property Inspection – ${inspection.address}`
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F5FA;font-family:Inter,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F5FA;padding:32px 16px">
<tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="background:#560591;border-radius:12px 12px 0 0;padding:20px 28px">
  <span style="font-family:'DM Sans',Arial,sans-serif;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px">Spekto</span>
</td></tr>
<tr><td style="background:#fff;padding:28px 32px;border-radius:0 0 12px 12px">
  <p style="margin:0 0 16px;font-size:15px;color:#0D0D0D;font-weight:600">Hi,</p>
  <div style="font-size:14px;color:#444;line-height:1.7">
    <p>This is a courtesy note to let you know that a video inspection has been booked for your listing at ${inspection.address} through Spekto, a remote property inspection platform.</p>
    <p>${clientName} has requested the inspection, and ${scoutName}, one of our verified Spekto Scouts, will be attending on ${clientName}'s behalf on ${inspectionDateTime} to film a walkthrough of the property.</p>
    <p>${scoutName} will arrive at the scheduled time, film the inspection, and leave promptly once complete. No further action is needed from you — this email is simply to make sure you're aware someone will be attending on the customer's behalf.</p>
    <p style="margin-top:28px;color:#555">The Spekto Team</p>
  </div>
</td></tr>
</table></td></tr>
</table></body></html>`

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to: inspection.agent_email, subject, html }),
  })

  if (!resendRes.ok) {
    console.error('[notify-agent] Resend error:', await resendRes.text().catch(() => ''))
    return err('Failed to send agent email', 502)
  }

  return ok({ success: true })
})
