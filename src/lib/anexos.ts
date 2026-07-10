// Camada única de anexos: usa o Cloudinary quando configurado; caso contrário,
// o Storage do Supabase. Assim a troca é só preencher as variáveis do Cloudinary
// no .env — nada mais no código muda, e os anexos antigos continuam abrindo.

import { cloudinaryConfigurado, miniaturaCloudinary, uploadCloudinary } from './cloudinary'
import { supabase } from './supabase'

/** Um anexo externo (Cloudinary) é guardado como URL http; o interno, como caminho do Storage. */
export const ehUrlExterna = (path: string) => /^https?:\/\//i.test(path)

/**
 * Envia um anexo e devolve o valor a guardar em `anexos.path`
 * (URL do Cloudinary ou caminho do Storage do Supabase).
 */
export async function enviarAnexo(file: File, numeroPedido: number): Promise<string> {
  if (cloudinaryConfigurado) return uploadCloudinary(file)
  // sufixo aleatório evita colisão quando vários arquivos sobem no mesmo instante
  const seguro = file.name.replace(/[^\w.\-]/g, '_')
  const path = `${numeroPedido}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${seguro}`
  const { error } = await supabase.storage.from('anexos').upload(path, file)
  if (error) throw error
  return path
}

/** URL para exibir ou baixar um anexo (miniatura opcional para imagens). */
export async function urlAnexo(path: string, opts?: { miniatura?: boolean }): Promise<string> {
  if (ehUrlExterna(path)) return opts?.miniatura ? miniaturaCloudinary(path) : path
  const { data } = await supabase.storage.from('anexos').createSignedUrl(path, 3600)
  return data?.signedUrl ?? ''
}

/** Resolve várias URLs de uma vez (para listas). Retorna um mapa path → url. */
export async function urlsAnexos(
  paths: string[],
  opts?: { miniatura?: boolean },
): Promise<Record<string, string>> {
  const mapa: Record<string, string> = {}
  const internas: string[] = []
  for (const p of paths) {
    if (ehUrlExterna(p)) mapa[p] = opts?.miniatura ? miniaturaCloudinary(p) : p
    else internas.push(p)
  }
  if (internas.length > 0) {
    const { data } = await supabase.storage.from('anexos').createSignedUrls(internas, 3600)
    for (const s of data ?? []) if (s.signedUrl && s.path) mapa[s.path] = s.signedUrl
  }
  return mapa
}
