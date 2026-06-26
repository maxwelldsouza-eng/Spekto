import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendNotification } from '../_shared/notify.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  })
}
function ok(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

// Types that frontend users can trigger (with restrictions)
// 'own'    — caller must be the user_id (notifying themselves)
// 'admin'  — caller must be an admin
// 'scout'  — caller must be the inspection's scout_id
// 'client' — caller must be the inspection's client_id (can notify client or scout on that inspection)
const FRONTEND_ALLOWED: Record<string, 'own' | 'admin' | 'scout' | 'client'> = {
  welcome_client: 'own',
  welcome_scout: 'own',
  admin_message: 'admin',
  inspection_accepted: 'scout',
  inspection_completed: 'scout',
  dispute_received: 'client',
  dispute_raised: 'client',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const authHeader = req.headers.get('Authorization') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`

  let callerUserId: string | null = null
  let callerEmail: string | null = null

  if (!isServiceRole) {
    const { data: { user }, error } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (error || !user) return err('Unauthorized', 401)
    callerUserId = user.id
    callerEmail = user.email ?? null
  }

  const body = await req.json()
  const { user_id, type, inspection_id, extra } = body

  if (!user_id || !type) return err('Missing user_id or type')

  // Validate frontend callers
  if (!isServiceRole) {
    const rule = FRONTEND_ALLOWED[type]
    if (!rule) return err('Forbidden', 403)

    if (rule === 'own') {
      if (callerUserId !== user_id) return err('Forbidden', 403)
      // Idempotency: skip if welcome already sent
      const { data: existing } = await supabase.from('notifications')
        .select('id').eq('user_id', user_id).in('type', ['welcome_client', 'welcome_scout']).maybeSingle()
      if (existing) return ok({ success: true, skipped: true })
    }

    if (rule === 'admin') {
      const { data: adminRow } = await supabase.from('admins')
        .select('id').eq('email', callerEmail).maybeSingle()
      if (!adminRow) return err('Forbidden', 403)
    }

    if (rule === 'scout') {
      if (!inspection_id) return err('inspection_id required', 400)
      const { data: insp } = await supabase.from('inspections')
        .select('scout_id').eq('id', inspection_id).single()
      if (insp?.scout_id !== callerUserId) return err('Forbidden', 403)
    }

    if (rule === 'client') {
      if (!inspection_id) return err('inspection_id required', 400)
      const { data: insp } = await supabase.from('inspections')
        .select('client_id, scout_id').eq('id', inspection_id).single()
      if (insp?.client_id !== callerUserId) return err('Forbidden', 403)
      // user_id must be either the client themselves or the scout on the inspection
      if (user_id !== insp.client_id && user_id !== insp.scout_id) return err('Forbidden', 403)
    }
  }

  await sendNotification(supabase, { user_id, type, inspection_id, extra })
  return ok({ success: true })
})
