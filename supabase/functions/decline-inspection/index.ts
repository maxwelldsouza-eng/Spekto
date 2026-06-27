import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

async function callNotify(params: { user_id: string; type: string; inspection_id?: string; extra?: Record<string, string> }): Promise<void> {
  try {
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/notify`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
  } catch (e: unknown) { console.error('[callNotify] error:', e instanceof Error ? e.message : String(e)) }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('Unauthorized', 401)

  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authErr || !user) return err('Unauthorized', 401)

  const { inspection_id } = await req.json()
  if (!inspection_id) return err('Missing inspection_id')

  // Load inspection — confirm caller is the scout
  const { data: inspection } = await supabase
    .from('inspections')
    .select('id, address, ref_number, status, scout_id, client_id')
    .eq('id', inspection_id)
    .single()

  if (!inspection) return err('Inspection not found', 404)
  if (inspection.scout_id !== user.id) return err('Forbidden', 403)
  if (!['Accepted', 'InProgress'].includes(inspection.status)) {
    return err(`Cannot decline an inspection with status "${inspection.status}"`)
  }

  // Get scout name before clearing scout_id
  const { data: scout } = await supabase
    .from('users').select('first_name, last_name').eq('id', user.id).single()
  const scoutName = scout ? `${scout.first_name ?? ''} ${scout.last_name ?? ''}`.trim() : 'Your Scout'

  // Update inspection — return to pool
  const { error: updateErr } = await supabase
    .from('inspections')
    .update({ scout_id: null, status: 'Posted', updated_at: new Date().toISOString() })
    .eq('id', inspection_id)
    .eq('scout_id', user.id)
    .in('status', ['Accepted', 'InProgress'])

  if (updateErr) return err('Could not decline this job. Please try again.')

  // Notify the client (non-fatal)
  if (inspection.client_id) {
    await callNotify({ user_id: inspection.client_id, type: 'inspection_declined', inspection_id, extra: { scoutName } })
  }

  return ok({ success: true })
})
