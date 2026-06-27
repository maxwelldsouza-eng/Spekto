import 'react-native-url-polyfill/auto'
import { createClient } from '@supabase/supabase-js'
import AsyncStorage from '@react-native-async-storage/async-storage'

const SUPABASE_URL = 'https://nyvnvtxhlnjvfhcmnihh.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_AZSoskR9Ou8e-rl0QlPWUg_vOehXCRL'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
