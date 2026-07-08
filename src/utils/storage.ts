import { supabase } from '../lib/supabase'

/** Remove arquivos do bucket de anexos em lotes (o Storage limita o tamanho da chamada). */
export async function removerAnexosStorage(paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    await supabase.storage.from('anexos').remove(paths.slice(i, i + 100))
  }
}
