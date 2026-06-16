import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://nyvnvtxhlnjvfhcmnihh.supabase.co'
const supabaseKey = 'sb_publishable_AZSoskR9Ou8e-rl0QlPWUg_vOehXCRL'

export const supabase = createClient(supabaseUrl, supabaseKey)
