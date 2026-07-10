import { ehUrlExterna } from '../lib/anexos'
import { supabase } from '../lib/supabase'

/**
 * Remove arquivos do bucket de anexos em lotes (o Storage limita o tamanho da chamada).
 * Anexos do Cloudinary (URLs http) são ignorados: apagá-los exigiria a chave secreta,
 * então permanecem lá — o registro no banco é removido normalmente.
 */
export async function removerAnexosStorage(paths: string[]) {
  const internos = paths.filter((p) => !ehUrlExterna(p))
  for (let i = 0; i < internos.length; i += 100) {
    await supabase.storage.from('anexos').remove(internos.slice(i, i + 100))
  }
}
