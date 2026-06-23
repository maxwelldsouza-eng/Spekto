import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

const VSURE_CLIENT_ID = Deno.env.get('VSURE_CLIENT_ID') ?? ''
const VSURE_CLIENT_SECRET = Deno.env.get('VSURE_CLIENT_SECRET') ?? ''
const VSURE_TOKEN_URL = 'https://login.vsure.com.au/oauth/token'
const VSURE_API_BASE = 'https://platform.vsure.com.au/v2'
const VSURE_AUDIENCE = 'https://platform.vsure.com.au/v2'
const VSURE_ENV = Deno.env.get('VSURE_ENV') ?? 'sandbox' // 'live' in production

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

async function getVsureToken(): Promise<string> {
  const res = await fetch(VSURE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: VSURE_CLIENT_ID,
      client_secret: VSURE_CLIENT_SECRET,
      audience: VSURE_AUDIENCE,
      grant_type: 'client_credentials',
      scopes: VSURE_ENV === 'live' ? 'aus:live' : 'aus:sandbox',
    }),
  })
  if (!res.ok) throw new Error(`vSure token request failed: ${res.status}`)
  const data = await res.json()
  return data.access_token
}

function mapVsureResult(result: { code: string }, visa?: Record<string, unknown>): {
  vsure_status: string
  admin_decision: string
} {
  const code = result?.code ?? ''
  const typeName = (visa as { australia?: { type_name?: string } })?.australia?.type_name ?? ''
  const workEntitlement = (visa as { work_entitlement?: string })?.work_entitlement ?? ''

  if (code === 'SUCCESS') {
    if (typeName.toLowerCase().includes('citizen') || typeName.toLowerCase().includes('permanent resident') || String(visa?.australia?.['type']) === '998') {
      return { vsure_status: 'citizen_pr', admin_decision: 'allowed' }
    }
    if (workEntitlement === 'LIMITED') {
      return { vsure_status: 'verified_limited', admin_decision: 'pending_review' }
    }
    return { vsure_status: 'verified_unlimited', admin_decision: 'allowed' }
  }
  if (code === 'VEVO_NO_VISA') return { vsure_status: 'no_rights', admin_decision: 'denied' }
  if (code === 'VEVO_PERSON_NOT_FOUND') return { vsure_status: 'mismatch', admin_decision: 'pending_review' }
  if (['VEVO_LOGIN_ERROR', 'VEVO_ACCOUNT_NO_ACCESS'].includes(code)) return { vsure_status: 'failed_technical', admin_decision: 'pending_review' }
  return { vsure_status: 'failed_technical', admin_decision: 'pending_review' }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('Unauthorized', 401)

  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authErr || !user) return err('Unauthorized', 401)

  const body = await req.json()
  const { passport_country, passport_number, given_name, family_name, date_of_birth } = body

  if (!passport_country || !passport_number || !given_name || !family_name || !date_of_birth) {
    return err('All fields are required')
  }

  const now = new Date().toISOString()

  // Mark all previous records for this scout as non-current
  await supabase
    .from('rights_to_work')
    .update({ is_current: false })
    .eq('scout_id', user.id)
    .eq('is_current', true)

  // Australian passport → citizen/PR, no API call
  if (passport_country.toUpperCase() === 'AUS') {
    const { data: row } = await supabase
      .from('rights_to_work')
      .insert({
        scout_id: user.id,
        passport_number,
        passport_country: 'AUS',
        given_name,
        family_name,
        date_of_birth,
        check_type: 'citizen_au_passport',
        vsure_status: 'citizen_pr',
        vsure_result_code: 'AU_PASSPORT',
        admin_decision: 'allowed',
        is_current: true,
        checked_at: now,
        created_at: now,
      })
      .select()
      .single()

    await updateScoutProfile(user.id, 'citizen_pr')
    return ok({ vsure_status: 'citizen_pr', row })
  }

  // Foreign passport — check credentials before calling vSure
  if (!VSURE_CLIENT_ID || !VSURE_CLIENT_SECRET) {
    // No credentials configured — store as pending_review for admin
    const { data: row } = await supabase
      .from('rights_to_work')
      .insert({
        scout_id: user.id,
        passport_number,
        passport_country,
        given_name,
        family_name,
        date_of_birth,
        check_type: 'vevo_work_check',
        vsure_status: 'failed_technical',
        vsure_result_code: 'NO_CREDENTIALS',
        admin_decision: 'pending_review',
        is_current: true,
        checked_at: now,
        created_at: now,
      })
      .select()
      .single()

    await updateScoutProfile(user.id, 'failed_technical')
    return ok({ vsure_status: 'failed_technical', row })
  }

  // Call vSure
  let vsureStatus = 'failed_technical'
  let adminDecision = 'pending_review'
  let vsureCheckId: string | null = null
  let vsureResultCode: string | null = null
  let workEntitlementRaw: string | null = null
  let visaTypeName: string | null = null
  let visaConditions: unknown = null
  let visaExpiryDate: string | null = null
  let vevoPdfUrl: string | null = null

  try {
    const token = await getVsureToken()
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Version': '2024-03-05',
      'Content-Type': 'application/json',
    }

    // Step 1: Submit check
    const submitRes = await fetch(`${VSURE_API_BASE}/visa-checks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jurisdiction: 'AUS',
        environment: VSURE_ENV,
        mode: 'fastcheck',
        visa_check_schema: 'australia',
        australia: { visa_check_type: 'work' },
        document: {
          type: 'passport',
          country: passport_country,
          identifier: passport_number,
          given_name,
          family_name,
          date_of_birth,
        },
      }),
    })

    if (!submitRes.ok) throw new Error(`vSure submit failed: ${submitRes.status}`)
    const submitData = await submitRes.json()
    vsureCheckId = submitData.id

    // Step 2: Poll for result (3 attempts × 5s)
    let checkData: Record<string, unknown> = {}
    for (let attempt = 0; attempt < 4; attempt++) {
      await new Promise(r => setTimeout(r, attempt === 0 ? 3000 : 5000))
      const pollRes = await fetch(`${VSURE_API_BASE}/visa-checks/${vsureCheckId}`, { headers })
      if (!pollRes.ok) break
      checkData = await pollRes.json()
      if ((checkData.status as string) !== 'pending') break
    }

    if ((checkData.status as string) === 'completed') {
      const result = checkData.result as { code: string } | undefined
      const visa = checkData.visa as Record<string, unknown> | undefined

      if (result) {
        const mapped = mapVsureResult(result, visa)
        vsureStatus = mapped.vsure_status
        adminDecision = mapped.admin_decision
        vsureResultCode = result.code
      }

      if (visa) {
        workEntitlementRaw = (visa as { work_entitlement?: string }).work_entitlement ?? null
        visaTypeName = (visa as { australia?: { type_name?: string } }).australia?.type_name ?? null
        visaConditions = (visa as { australia?: { conditions?: unknown } }).australia?.conditions ?? null
        visaExpiryDate = (visa as { expiry_date?: string }).expiry_date ?? null
      }

      const attachments = checkData.attachments as Array<{ download_url?: string }> | undefined
      vevoPdfUrl = attachments?.[0]?.download_url ?? null
    } else if ((checkData.status as string) === 'failed') {
      vsureStatus = 'failed_technical'
      vsureResultCode = 'VEVO_CHECK_FAILED'
    }
    // still pending after all retries → failed_technical (defaults already set)
  } catch (apiErr) {
    console.error('vSure API error:', apiErr)
    vsureStatus = 'failed_technical'
    vsureResultCode = 'API_ERROR'
  }

  const { data: row } = await supabase
    .from('rights_to_work')
    .insert({
      scout_id: user.id,
      passport_number,
      passport_country,
      given_name,
      family_name,
      date_of_birth,
      check_type: 'vevo_work_check',
      vsure_check_id: vsureCheckId,
      vsure_status: vsureStatus,
      vsure_result_code: vsureResultCode,
      work_entitlement_raw: workEntitlementRaw,
      visa_type_name: visaTypeName,
      visa_conditions: visaConditions,
      visa_expiry_date: visaExpiryDate,
      vevo_pdf_url: vevoPdfUrl,
      admin_decision: adminDecision,
      is_current: true,
      checked_at: now,
      created_at: now,
    })
    .select()
    .single()

  await updateScoutProfile(user.id, vsureStatus)
  return ok({ vsure_status: vsureStatus, row })
})

async function updateScoutProfile(userId: string, vsureStatus: string) {
  const workRightsStatus = ['citizen_pr', 'verified_unlimited'].includes(vsureStatus) ? 'verified'
    : vsureStatus === 'no_rights' ? 'denied'
    : 'pending_review'

  await supabase
    .from('scout_profiles')
    .update({ work_rights_status: workRightsStatus, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
}
