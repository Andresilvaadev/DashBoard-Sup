import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabaseConfigurado = Boolean(url && anonKey && !url.includes('SEU_PROJETO'))

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'anon')

/**
 * Cliente auxiliar sem persistência de sessão — usado pelo admin para
 * cadastrar funcionários via signUp sem derrubar a própria sessão.
 * Criado sob demanda para não conflitar com o cliente principal.
 */
export function criarClienteSignup() {
  return createClient(url ?? 'http://localhost', anonKey ?? 'anon', {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: 'sb-signup-temp' },
  })
}
