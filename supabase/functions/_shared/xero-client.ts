import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
)

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'

export interface XeroTokenRow {
  id: number
  access_token: string
  refresh_token: string
  tenant_id: string
  expires_at: string
  updated_at: string
}

export async function getXeroToken(): Promise<XeroTokenRow> {
  const { data, error } = await supabase
    .from('xero_tokens')
    .select('*')
    .eq('id', 1)
    .single()

  if (error || !data) throw new Error('Xero not connected — run the OAuth flow first')

  const expiresAt = new Date(data.expires_at).getTime()
  const nowMs = Date.now()

  if (expiresAt - nowMs < 5 * 60 * 1000) {
    return await refreshXeroToken(data)
  }

  return data as XeroTokenRow
}

async function refreshXeroToken(current: XeroTokenRow): Promise<XeroTokenRow> {
  const clientId = Deno.env.get('XERO_CLIENT_ID')!
  const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')!

  const res = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refresh_token,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Xero token refresh failed: ${text}`)
  }

  const tokens = await res.json()
  const updated: Partial<XeroTokenRow> = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? current.refresh_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }

  await supabase.from('xero_tokens').update(updated).eq('id', 1)

  return { ...current, ...updated } as XeroTokenRow
}

export async function xeroPost(path: string, body: unknown): Promise<Response> {
  const token = await getXeroToken()
  return fetch(`${XERO_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token.access_token}`,
      'Xero-Tenant-Id': token.tenant_id,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

export async function xeroGet(path: string): Promise<Response> {
  const token = await getXeroToken()
  return fetch(`${XERO_API_BASE}${path}`, {
    headers: {
      'Authorization': `Bearer ${token.access_token}`,
      'Xero-Tenant-Id': token.tenant_id,
      'Accept': 'application/json',
    },
  })
}

export async function getOrCreateXeroContact(email: string, name: string): Promise<string | null> {
  try {
    const searchRes = await xeroGet(`/Contacts?where=EmailAddress%3D%3D%22${encodeURIComponent(email)}%22`)
    if (searchRes.ok) {
      const data = await searchRes.json()
      if (data.Contacts?.length > 0) return data.Contacts[0].ContactID
    }
    const createRes = await xeroPost('/Contacts', {
      Contacts: [{ Name: name || email, EmailAddress: email }],
    })
    if (!createRes.ok) return null
    const createData = await createRes.json()
    return createData.Contacts?.[0]?.ContactID ?? null
  } catch {
    return null
  }
}
