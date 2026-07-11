// Integração com o Cloudinary para guardar as imagens/anexos dos pedidos.
// Usa "upload não assinado" (unsigned upload preset), que permite enviar
// direto do navegador sem backend — do mesmo jeito que o Supabase é usado hoje.

const cloudName = (import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined)?.trim()
const uploadPreset = (import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined)?.trim()

/** true quando as variáveis do Cloudinary estão preenchidas no .env */
export const cloudinaryConfigurado = Boolean(cloudName && uploadPreset)

/**
 * Envia um arquivo direto para o Cloudinary e devolve a URL segura (https).
 * `auto/upload` aceita imagem, PDF e outros formatos.
 */
export async function uploadCloudinary(file: File): Promise<string> {
  if (!cloudName || !uploadPreset) throw new Error('Cloudinary não configurado')
  const form = new FormData()
  form.append('file', file)
  form.append('upload_preset', uploadPreset)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    let msg = `Falha no upload da imagem (HTTP ${res.status})`
    try {
      const err = (await res.json()) as { error?: { message?: string } }
      if (err?.error?.message) msg = err.error.message
    } catch {
      /* mantém a mensagem padrão */
    }
    throw new Error(msg)
  }
  const data = (await res.json()) as { secure_url?: string }
  if (!data.secure_url) throw new Error('Resposta inválida do Cloudinary')
  return data.secure_url
}

/**
 * Gera uma miniatura otimizada via transformação de URL do Cloudinary
 * (redimensiona + qualidade/formato automáticos) — economiza banda nas listas.
 */
export function miniaturaCloudinary(url: string, largura = 500): string {
  return url.includes('/upload/')
    ? url.replace('/upload/', `/upload/c_fill,w_${largura},q_auto,f_auto/`)
    : url
}
